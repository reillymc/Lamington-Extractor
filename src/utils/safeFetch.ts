import {
    lookup as dnsLookup,
    type LookupAddress,
    type LookupAllOptions,
} from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";
import {
    DisallowedUrlError,
    ExtractionLimitError,
    FetchFailedError,
    InvalidUrlError,
} from "../errors.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(["80", "443"]);
const ALLOWED_CONTENT_TYPES = new Set([
    "text/html",
    "application/xhtml+xml",
    "text/plain",
]);

const USER_AGENT = "LamingtonRecipeExtractor/1.0";

const BLOCKED_IPV4_RANGES = ["198.18.0.0/15"].map(
    (range) => ipaddr.parseCIDR(range) as [ipaddr.IPv4, number],
);

const BLOCKED_IPV6_RANGES = [
    "2001:2::/48",
    "2001:10::/28",
    "2001:20::/28",
    "2001:db8::/32",
    "3fff::/20",
    "5f00::/16",
].map((range) => ipaddr.parseCIDR(range) as [ipaddr.IPv6, number]);

const isBlockedIpv6Address = (address: ipaddr.IPv6): boolean =>
    BLOCKED_IPV6_RANGES.some(([network, prefixLength]) =>
        address.match(network, prefixLength),
    );

const isBlockedIpv4Address = (address: ipaddr.IPv4): boolean =>
    BLOCKED_IPV4_RANGES.some(([network, prefixLength]) =>
        address.match(network, prefixLength),
    );

export const isPublicAddress = (address: string): boolean => {
    try {
        const parsed = ipaddr.parse(address);

        if (parsed.kind() === "ipv4") {
            const ipv4 = parsed as ipaddr.IPv4;
            return ipv4.range() === "unicast" && !isBlockedIpv4Address(ipv4);
        }

        const ipv6 = parsed as ipaddr.IPv6;
        if (ipv6.isIPv4MappedAddress()) {
            return isPublicAddress(ipv6.toIPv4Address().toString());
        }

        return ipv6.range() === "unicast" && !isBlockedIpv6Address(ipv6);
    } catch {
        return false;
    }
};

const isLocalHostname = (hostname: string): boolean => {
    const lower = hostname.toLowerCase().replace(/\.+$/, "");
    return (
        lower === "localhost" ||
        lower.endsWith(".localhost") ||
        lower.endsWith(".local")
    );
};

const assertSafeTarget = (url: URL): void => {
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new DisallowedUrlError(`Unsupported protocol: ${url.protocol}`);
    }

    if (url.username || url.password) {
        throw new DisallowedUrlError("URL credentials are not allowed");
    }

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (!ALLOWED_PORTS.has(port)) {
        throw new DisallowedUrlError(`Disallowed port: ${port}`);
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    if (isLocalHostname(hostname)) {
        throw new DisallowedUrlError(`Disallowed host: ${hostname}`);
    }

    if (isIP(hostname) !== 0) {
        throw new DisallowedUrlError(`Disallowed address: ${hostname}`);
    }
};

type DnsResolver = (
    hostname: string,
    options: LookupAllOptions,
    callback: (
        error: NodeJS.ErrnoException | null,
        addresses: LookupAddress[],
    ) => void,
) => void;

export const createSafeLookup =
    (resolver: DnsResolver = dnsLookup): LookupFunction =>
    (hostname, options, callback) => {
        const lookupOptions: LookupAllOptions = {
            ...options,
            all: true,
            verbatim: true,
        };

        resolver(hostname, lookupOptions, (error, addresses) => {
            if (error) {
                callback(error, "", 0);
                return;
            }

            if (
                addresses.length === 0 ||
                addresses.some(({ address }) => !isPublicAddress(address))
            ) {
                callback(
                    new DisallowedUrlError(`Disallowed host: ${hostname}`),
                    "",
                    0,
                );
                return;
            }

            if (options.all) {
                callback(null, addresses);
                return;
            }

            const [address] = addresses;
            if (!address) {
                callback(
                    new Error(`Unable to resolve host: ${hostname}`),
                    "",
                    0,
                );
                return;
            }

            callback(null, address.address, address.family);
        });
    };

const safeDispatcher = new Agent({
    connect: {
        lookup: createSafeLookup(),
    },
});

type FetchImplementation = (
    input: RequestInfo | URL,
    init: RequestInit & { dispatcher: Dispatcher },
) => Promise<Response>;

const defaultFetch: FetchImplementation = (input, init) =>
    fetch(input, init as RequestInit) as Promise<Response>;

export type SafeFetchResult = {
    ok: boolean;
    status: number;
    text: string;
};

const isAllowedContentType = (
    contentType: string | null,
    allowedContentTypes: ReadonlySet<string>,
): boolean => {
    if (!contentType) return true;
    if (allowedContentTypes.size === 0) return true;

    const baseType = contentType.split(";")[0]?.trim().toLowerCase();
    return !!baseType && allowedContentTypes.has(baseType);
};

const readCappedText = async (
    response: Response,
    maxBytes: number,
): Promise<string> => {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new ExtractionLimitError("Response exceeds size limit");
    }

    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks: Array<Uint8Array> = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ExtractionLimitError("Response exceeds size limit");
            }
            chunks.push(value);
        }
    }

    return Buffer.concat(chunks).toString("utf8");
};

export const createSafeFetchText = (
    fetchImplementation: FetchImplementation = defaultFetch,
    dispatcher: Dispatcher = safeDispatcher,
) => {
    return async (input: string): Promise<SafeFetchResult> => {
        let current: URL;
        try {
            current = new URL(input);
        } catch {
            throw new InvalidUrlError();
        }

        const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

        for (let redirectCount = 0; ; redirectCount += 1) {
            assertSafeTarget(current);

            let response: Response;
            try {
                response = await fetchImplementation(current, {
                    redirect: "manual",
                    signal,
                    headers: { "user-agent": USER_AGENT },
                    dispatcher,
                });
            } catch (error) {
                if (
                    error instanceof Error &&
                    (error.name === "AbortError" ||
                        error.name === "TimeoutError")
                ) {
                    throw new FetchFailedError("Request timed out", error);
                }
                throw new FetchFailedError(
                    "Failed to fetch remote content",
                    error,
                );
            }

            if (REDIRECT_STATUSES.has(response.status)) {
                await response.body?.cancel().catch(() => undefined);

                if (redirectCount >= MAX_REDIRECTS) {
                    throw new FetchFailedError("Too many redirects");
                }

                const location = response.headers.get("location");
                if (!location) {
                    throw new FetchFailedError(
                        "Redirect missing Location header",
                    );
                }

                try {
                    current = new URL(location, current);
                } catch {
                    throw new FetchFailedError("Invalid redirect location");
                }
                continue;
            }

            if (
                !isAllowedContentType(
                    response.headers.get("content-type"),
                    ALLOWED_CONTENT_TYPES,
                )
            ) {
                await response.body?.cancel().catch(() => undefined);
                throw new FetchFailedError("Unsupported content type");
            }

            let text: string;
            try {
                text = await readCappedText(response, MAX_RESPONSE_BYTES);
            } catch (error) {
                if (error instanceof ExtractionLimitError) throw error;
                if (
                    error instanceof Error &&
                    (error.name === "AbortError" ||
                        error.name === "TimeoutError")
                ) {
                    throw new FetchFailedError("Request timed out", error);
                }
                throw new FetchFailedError(
                    "Failed to read remote content",
                    error,
                );
            }
            return { ok: response.ok, status: response.status, text };
        }
    };
};

export const safeFetchText = createSafeFetchText();
