import { describe, it } from "node:test";
import { expect } from "expect";
import { createArchiveFetcher } from "../../src/utils/archiveFetcher.ts";
import type {
    SafeFetchResult,
    SafeFetchTextOptions,
} from "../../src/utils/safeFetch.ts";

const safeResult = (
    text: string,
    overrides: Partial<SafeFetchResult> = {},
): SafeFetchResult => ({
    ok: true,
    status: 200,
    statusText: "OK",
    host: "example.com",
    contentType: "text/html",
    server: null,
    mitigation: null,
    text,
    ...overrides,
});

const createFetcher = (
    responses: (
        input: string,
        options?: SafeFetchTextOptions,
    ) => SafeFetchResult | Promise<SafeFetchResult>,
) =>
    createArchiveFetcher(async (input, fetchOptions) =>
        responses(input, fetchOptions),
    );

const cdx = (timestamps: string[]) =>
    JSON.stringify([["timestamp"], ...timestamps.map((value) => [value])]);

describe("createArchiveFetcher", () => {
    it("fetches the latest capture and returns the raw snapshot", async () => {
        const calls: string[] = [];
        const fetcher = createFetcher((input) => {
            calls.push(input);

            if (input.includes("/cdx/search/cdx")) {
                return safeResult(cdx(["20250101000000", "20261005085029"]), {
                    contentType: "application/json",
                });
            }

            return safeResult("<html>archived recipe</html>");
        });

        const result = await fetcher("https://example.com/recipe");

        expect(result).toEqual({
            text: "<html>archived recipe</html>",
            timestamp: "20261005085029",
        });
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatch(/from=\d{8}/);
        expect(calls[0]).toContain("filter=statuscode%3A200");
        expect(calls[0]).toContain("filter=mimetype%3Atext%2Fhtml");
    });

    it("returns null when no captures exist", async () => {
        const fetcher = createFetcher(() => safeResult(cdx([])));

        await expect(fetcher("https://example.com/recipe")).resolves.toBeNull();
    });

    it("ignores invalid timestamps", async () => {
        const fetcher = createFetcher(() =>
            safeResult(cdx(["not-a-timestamp"])),
        );

        await expect(fetcher("https://example.com/recipe")).resolves.toBeNull();
    });

    it("returns null when the CDX request fails", async () => {
        const fetcher = createFetcher(() =>
            safeResult("", {
                ok: false,
                status: 503,
                statusText: "Unavailable",
            }),
        );

        await expect(fetcher("https://example.com/recipe")).resolves.toBeNull();
    });

    it("returns null when the CDX response is malformed", async () => {
        const fetcher = createFetcher(() => safeResult("not json"));

        await expect(fetcher("https://example.com/recipe")).resolves.toBeNull();
    });

    it("returns null when the snapshot request fails", async () => {
        const fetcher = createFetcher((input) => {
            if (input.includes("/cdx/search/cdx")) {
                return safeResult(cdx(["20261005085029"]));
            }

            return safeResult("", {
                ok: false,
                status: 404,
                statusText: "Not Found",
            });
        });

        await expect(fetcher("https://example.com/recipe")).resolves.toBeNull();
    });

    it("rejects unsupported protocols without fetching", async () => {
        let called = false;
        const fetcher = createFetcher(() => {
            called = true;
            return safeResult(cdx(["20261005085029"]));
        });

        await expect(fetcher("ftp://example.com/recipe")).resolves.toBeNull();
        expect(called).toBe(false);
    });
});
