import { UnsupportedMediaTypeError } from "../errors.ts";
import {
    readSafeFetchMetadata,
    type SafeFetchBuffer,
} from "../utils/safeFetch.ts";
import { createUpstreamHttpError } from "../utils/upstreamError.ts";

const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
]);

const isSupportedImageContentType = (contentType: string | null): boolean => {
    if (!contentType) return false;

    const [mediaType] = contentType.split(";", 1);
    return SUPPORTED_IMAGE_CONTENT_TYPES.has(
        mediaType?.trim().toLowerCase() ?? "",
    );
};

export type FetchedImage = {
    body: Buffer;
    contentType: string;
};

export interface ImageFetchService {
    fetchImage(url: string): Promise<FetchedImage>;
}

export const createImageFetchService = (
    fetchBuffer: SafeFetchBuffer,
): ImageFetchService => ({
    fetchImage: async (url: string) => {
        const result = await fetchBuffer(url, {
            maxBytes: MAX_REMOTE_IMAGE_BYTES,
            validateResponse: (response, url) => {
                if (!response.ok) {
                    throw createUpstreamHttpError(
                        readSafeFetchMetadata(response, url),
                    );
                }

                const contentType = response.headers.get("content-type");
                if (!isSupportedImageContentType(contentType)) {
                    const mediaType = contentType
                        ?.split(";", 1)[0]
                        ?.trim()
                        .toLowerCase();
                    throw new UnsupportedMediaTypeError(
                        mediaType
                            ? `Unsupported image content type: ${mediaType}`
                            : "Unsupported image content type",
                    );
                }
            },
        });

        return {
            body: result.body,
            contentType: result.contentType ?? "application/octet-stream",
        };
    },
});
