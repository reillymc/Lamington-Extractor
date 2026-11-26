import {
    createSafeFetchText,
    type SafeFetchResult,
    type SafeFetchTextOptions,
} from "./safeFetch.ts";

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const SNAPSHOT_ENDPOINT = "https://web.archive.org/web";
const TIMESTAMP_PATTERN = /^\d{14}$/;
const MAX_AGE_DAYS = 365;
const TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;

type ArchiveFetchText = (
    input: string,
    options?: SafeFetchTextOptions,
) => Promise<SafeFetchResult>;

export type ArchiveSnapshot = {
    text: string;
    timestamp: string;
};

export type ArchiveFetcher = (url: string) => Promise<ArchiveSnapshot | null>;

const buildCdxUrl = (url: string): string => {
    const from = new Date(Date.now() - MAX_AGE_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
    const params = new URLSearchParams({
        url,
        output: "json",
        fl: "timestamp",
        limit: "-1",
        from,
    });

    params.append("filter", "statuscode:200");
    params.append("filter", "mimetype:text/html");

    return `${CDX_ENDPOINT}?${params.toString()}`;
};

const readLatestTimestamp = (text: string): string | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }

    if (!Array.isArray(parsed)) return null;

    const last: unknown = parsed.at(-1);
    if (!Array.isArray(last)) return null;

    const timestamp: unknown = last[0];
    return typeof timestamp === "string" && TIMESTAMP_PATTERN.test(timestamp)
        ? timestamp
        : null;
};

export const createArchiveFetcher =
    (fetchText: ArchiveFetchText = createSafeFetchText()): ArchiveFetcher =>
    async (url: string) => {
        try {
            const target = new URL(url);
            if (target.protocol !== "http:" && target.protocol !== "https:") {
                return null;
            }
            target.hash = "";

            const cdxResponse = await fetchText(buildCdxUrl(target.href), {
                validateResponse: () => undefined,
                timeoutMs: TIMEOUT_MS,
            });

            if (!cdxResponse.ok) return null;

            const timestamp = readLatestTimestamp(cdxResponse.text);
            if (!timestamp) return null;

            const snapshotUrl = `${SNAPSHOT_ENDPOINT}/${timestamp}id_/${target.href}`;
            const snapshot = await fetchText(snapshotUrl, {
                timeoutMs: TIMEOUT_MS,
            });

            if (!snapshot.ok) return null;

            return {
                text: snapshot.text,
                timestamp,
            };
        } catch {
            return null;
        }
    };
