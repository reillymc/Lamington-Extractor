import { afterEach, describe, it, mock } from "node:test";
import { expect } from "expect";
import {
    ExtractionLimitError,
    FetchFailedError,
    UnsupportedMediaTypeError,
} from "../../src/errors.ts";
import { createImageFetchService } from "../../src/services/imageFetchService.ts";
import { createSafeFetchBuffer } from "../../src/utils/safeFetch.ts";

const imageService = createImageFetchService(createSafeFetchBuffer());

const mockFetch = (implementation: typeof fetch) =>
    mock.method(globalThis, "fetch", implementation);

afterEach(() => {
    mock.restoreAll();
});

describe("image fetch service", () => {
    it("fetches supported image content", async () => {
        mockFetch(
            async () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { "content-type": "image/png" },
                }),
        );

        await expect(
            imageService.fetchImage("https://example.com/image.png"),
        ).resolves.toEqual({
            body: Buffer.from([1, 2, 3]),
            contentType: "image/png",
        });
    });

    it("rejects unsupported image content types", async () => {
        mockFetch(
            async () =>
                new Response("<html></html>", {
                    status: 200,
                    headers: { "content-type": "text/html" },
                }),
        );

        await expect(
            imageService.fetchImage("https://example.com/image.jpg"),
        ).rejects.toThrow(UnsupportedMediaTypeError);
    });

    it("rejects failed upstream requests", async () => {
        mockFetch(async () => new Response("missing", { status: 404 }));

        await expect(
            imageService.fetchImage("https://example.com/image.jpg"),
        ).rejects.toThrow(FetchFailedError);
    });

    it("rejects oversized images", async () => {
        mockFetch(
            async () =>
                new Response(Buffer.alloc(4), {
                    status: 200,
                    headers: {
                        "content-type": "image/jpeg",
                        "content-length": String(5 * 1024 * 1024 + 1),
                    },
                }),
        );

        await expect(
            imageService.fetchImage("https://example.com/image.jpg"),
        ).rejects.toThrow(ExtractionLimitError);
    });
});
