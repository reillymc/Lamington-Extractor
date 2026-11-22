import {
    lookup as dnsLookup,
    type LookupAddress,
    type LookupAllOptions,
} from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";
import {
    ExtractionLimitError,
    FetchFailedError,
    InvalidUrlError,
    UnsupportedMediaTypeError,
} from "../errors.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(["80", "443"]);
const TEXT_CONTENT_TYPES = new Set([
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
        throw new InvalidUrlError(`Unsupported protocol: ${url.protocol}`);
    }

    if (url.username || url.password) {
        throw new InvalidUrlError("URL credentials are not allowed");
    }

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (!ALLOWED_PORTS.has(port)) {
        throw new InvalidUrlError(`Disallowed port: ${port}`);
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    if (isLocalHostname(hostname)) {
        throw new InvalidUrlError(`Disallowed host: ${hostname}`);
    }

    if (isIP(hostname) !== 0) {
        throw new InvalidUrlError(`Disallowed address: ${hostname}`);
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
                    new InvalidUrlError(`Disallowed host: ${hostname}`),
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

// Node's global fetch is backed by undici and honours the `dispatcher` option.
const defaultFetch: FetchImplementation = (input, init) =>
    fetch(input, init as RequestInit) as Promise<Response>;

export type SafeFetchResult = {
    ok: boolean;
    status: number;
    text: string;
};

export type SafeFetchBufferResult = {
    ok: boolean;
    status: number;
    body: Buffer;
    contentType: string | null;
};

type SafeFetchTextOptions = {
    validateResponse?: (response: Response) => void;
};

export type SafeFetchBufferOptions = {
    maxBytes?: number;
    validateResponse?: (response: Response) => void;
};

export type SafeFetchBuffer = (
    input: string,
    options?: SafeFetchBufferOptions,
) => Promise<SafeFetchBufferResult>;

const isAllowedContentType = (
    contentType: string | null,
    allowedContentTypes: ReadonlySet<string>,
): boolean => {
    if (!contentType) return true;
    if (allowedContentTypes.size === 0) return true;

    const baseType = contentType.split(";")[0]?.trim().toLowerCase();
    return !!baseType && allowedContentTypes.has(baseType);
};

const readCappedBody = async (
    response: Response,
    maxBytes: number,
): Promise<Buffer> => {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new ExtractionLimitError("Response exceeds size limit");
    }

    if (!response.body) return Buffer.alloc(0);

    const reader = response.body.getReader();
    const chunks: Array<Uint8Array> = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new ExtractionLimitError("Response exceeds size limit");
            }
            chunks.push(value);
        }
    }

    return Buffer.concat(chunks);
};

const readCappedText = async (
    response: Response,
    maxBytes: number,
): Promise<string> =>
    (await readCappedBody(response, maxBytes)).toString("utf8");

const mapReadError = (error: unknown): never => {
    if (error instanceof ExtractionLimitError) throw error;
    if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
        throw new FetchFailedError("Request timed out", error);
    }
    throw new FetchFailedError("Failed to read remote content", error);
};

const fetchWithSafeRedirects = async (
    input: string,
    fetchImplementation: FetchImplementation,
    dispatcher: Dispatcher,
    validateResponse?: (response: Response) => void,
): Promise<Response> => {
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
                (error.name === "AbortError" || error.name === "TimeoutError")
            ) {
                throw new FetchFailedError("Request timed out", error);
            }
            throw new FetchFailedError("Failed to fetch remote content", error);
        }

        if (REDIRECT_STATUSES.has(response.status)) {
            await response.body?.cancel().catch(() => undefined);

            if (redirectCount >= MAX_REDIRECTS) {
                throw new FetchFailedError("Too many redirects");
            }

            const location = response.headers.get("location");
            if (!location) {
                throw new FetchFailedError("Redirect missing Location header");
            }

            try {
                current = new URL(location, current);
            } catch {
                throw new FetchFailedError("Invalid redirect location");
            }
            continue;
        }

        if (validateResponse) {
            try {
                validateResponse(response);
            } catch (error) {
                await response.body?.cancel().catch(() => undefined);
                throw error;
            }
        }

        return response;
    }
};

const validateTextResponse = (response: Response): void => {
    if (
        !isAllowedContentType(
            response.headers.get("content-type"),
            TEXT_CONTENT_TYPES,
        )
    ) {
        throw new UnsupportedMediaTypeError("Unsupported content type");
    }
};

export const createSafeFetchText = (
    fetchImplementation: FetchImplementation = defaultFetch,
    dispatcher: Dispatcher = safeDispatcher,
) => {
    return async (
        input: string,
        { validateResponse = validateTextResponse }: SafeFetchTextOptions = {},
    ): Promise<SafeFetchResult> => {
        const response = await fetchWithSafeRedirects(
            input,
            fetchImplementation,
            dispatcher,
            validateResponse,
        );

        let text: string;
        try {
            text = await readCappedText(response, DEFAULT_MAX_BYTES);
        } catch (error) {
            throw mapReadError(error);
        }

        return { ok: response.ok, status: response.status, text };
    };
};

export const createSafeFetchBuffer = (
    fetchImplementation: FetchImplementation = defaultFetch,
    dispatcher: Dispatcher = safeDispatcher,
): SafeFetchBuffer => {
    return async (
        input: string,
        {
            maxBytes = DEFAULT_MAX_BYTES,
            validateResponse,
        }: SafeFetchBufferOptions = {},
    ): Promise<SafeFetchBufferResult> => {
        const response = await fetchWithSafeRedirects(
            input,
            fetchImplementation,
            dispatcher,
            validateResponse,
        );

        let body: Buffer;
        try {
            body = await readCappedBody(response, maxBytes);
        } catch (error) {
            throw mapReadError(error);
        }

        return {
            ok: response.ok,
            status: response.status,
            body,
            contentType: response.headers.get("content-type"),
        };
    };
};
