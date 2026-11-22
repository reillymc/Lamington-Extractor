import { FetchFailedError, UnsupportedMediaTypeError } from "../errors.ts";
import type { SafeFetchBuffer } from "../utils/safeFetch.ts";

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
            validateResponse: (response) => {
                if (!response.ok) {
                    throw new FetchFailedError(
                        `Image request failed with status ${response.status}`,
                    );
                }

                if (
                    !isSupportedImageContentType(
                        response.headers.get("content-type"),
                    )
                ) {
                    throw new UnsupportedMediaTypeError(
                        "Unsupported image content type",
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
