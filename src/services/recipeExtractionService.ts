import { load } from "cheerio";
import {
    ExtractionLimitError,
    ExtractorError,
    InternalError,
    NoRecipeFoundError,
} from "../errors.ts";
import type {
    ExtractedRecipeMetadata,
    NormalizedExtractedRecipe,
} from "../spec/index.ts";
import type { ArchiveFetcher } from "../utils/archiveFetcher.ts";
import {
    convertRecipe,
    findRecipe,
    isRecipe,
} from "../utils/recipeConverter.ts";
import type { SafeFetchResult } from "../utils/safeFetch.ts";
import { createUpstreamHttpError } from "../utils/upstreamError.ts";

type FetchText = (url: string) => Promise<SafeFetchResult>;

export interface RecipeExtractionService {
    extractRecipeMetadata(url: string): Promise<ExtractedRecipeMetadata>;
    extractRecipe(url: string): Promise<NormalizedExtractedRecipe>;
}

const isHtmlContentType = (contentType: string | null): boolean => {
    const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
    return mediaType === "text/html" || mediaType === "application/xhtml+xml";
};

const shouldTryArchive = (response: SafeFetchResult): boolean =>
    response.status === 403 && isHtmlContentType(response.contentType);

export const createRecipeExtractionService = (
    fetchText: FetchText,
    archiveFetcher?: ArchiveFetcher,
): RecipeExtractionService => {
    const getHtml = async (url: string): Promise<string> => {
        const response = await fetchText(url);
        if (response.ok) return response.text;

        let archiveNote = "";

        if (archiveFetcher && shouldTryArchive(response)) {
            const snapshot = await archiveFetcher(url);
            if (snapshot) {
                console.info(
                    `Using archive snapshot for ${response.host} (${snapshot.timestamp})`,
                );
                return snapshot.text;
            }
            archiveNote = "; no recent archive capture found";
        }

        const error = createUpstreamHttpError(response);
        if (archiveNote) {
            error.message += archiveNote;
        }
        throw error;
    };

    return {
        extractRecipeMetadata: async (url: string) => {
            try {
                const html = await getHtml(url);
                const page = load(html);
                const name =
                    page('meta[property="og:title"]').attr("content")?.trim() ||
                    page("title").text().trim();
                const imageUrl = page('meta[property="og:image"]')
                    .attr("content")
                    ?.trim();

                if (!name) {
                    throw new NoRecipeFoundError(
                        "Could not extract a name from the URL.",
                    );
                }

                return {
                    name: name.slice(0, 1024),
                    ...(imageUrl ? { imageUrl: imageUrl.slice(0, 2048) } : {}),
                };
            } catch (error) {
                if (error instanceof ExtractorError) throw error;
                throw new InternalError(
                    "Failed to extract recipe metadata",
                    error,
                );
            }
        },
        extractRecipe: async (url: string) => {
            try {
                const html = await getHtml(url);
                const page = load(html);
                let recipeData: unknown = null;
                const graphBudget = { visited: 0 };

                page('script[type="application/ld+json"]').each(
                    (_, element) => {
                        const scriptContent = page(element).html();
                        if (!scriptContent) return;

                        try {
                            const json = JSON.parse(scriptContent);
                            const recipe = findRecipe(json, graphBudget);
                            if (recipe) {
                                recipeData = recipe;
                                return false;
                            }
                        } catch (error) {
                            if (error instanceof ExtractionLimitError)
                                throw error;
                        }
                    },
                );

                if (!isRecipe(recipeData)) {
                    throw new NoRecipeFoundError(
                        "No valid JSON-LD recipe object found on the page.",
                    );
                }

                return convertRecipe(recipeData);
            } catch (error) {
                if (error instanceof ExtractorError) throw error;
                throw new InternalError("Failed to extract recipe", error);
            }
        },
    };
};
