import { load } from "cheerio";
import {
    ExtractionLimitError,
    ExtractorError,
    FetchFailedError,
    InternalError,
    NoRecipeFoundError,
} from "../errors.ts";
import type {
    ExtractedRecipeMetadata,
    NormalizedExtractedRecipe,
} from "../spec/index.ts";
import {
    convertRecipe,
    findRecipe,
    isRecipe,
} from "../utils/recipeConverter.ts";
import type { SafeFetchResult } from "../utils/safeFetch.ts";

type FetchText = (url: string) => Promise<SafeFetchResult>;

export interface RecipeExtractionService {
    extractRecipeMetadata(url: string): Promise<ExtractedRecipeMetadata>;
    extractRecipe(url: string): Promise<NormalizedExtractedRecipe>;
}

export const createRecipeExtractionService = (
    fetchText: FetchText,
): RecipeExtractionService => ({
    extractRecipeMetadata: async (url: string) => {
        try {
            const response = await fetchText(url);
            if (!response.ok) {
                throw new FetchFailedError(
                    `Request failed with status ${response.status}`,
                );
            }

            const page = load(response.text);
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
            throw new InternalError("Failed to extract recipe metadata", error);
        }
    },
    extractRecipe: async (url: string) => {
        try {
            const response = await fetchText(url);
            if (!response.ok) {
                throw new FetchFailedError(
                    `Request failed with status ${response.status}`,
                );
            }

            const page = load(response.text);
            let recipeData: unknown = null;
            const graphBudget = { visited: 0 };

            page('script[type="application/ld+json"]').each((_, element) => {
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
                    if (error instanceof ExtractionLimitError) throw error;
                }
            });

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
});
