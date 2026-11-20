import { describe, it } from "node:test";
import { expect } from "expect";
import { FetchFailedError, NoRecipeFoundError } from "../../src/errors.ts";
import { createRecipeExtractionService } from "../../src/services/recipeExtractionService.ts";

const ok = (html: string) => async () => ({
    ok: true,
    status: 200,
    text: html,
});

const recipePage = (recipe: unknown) =>
    `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify(
        recipe,
    )}</script></head><body></body></html>`;

describe("recipe extraction service", () => {
    it("extracts metadata", async () => {
        const service = createRecipeExtractionService(
            ok(
                '<html><head><title>Fallback</title><meta property="og:title" content="Recipe Name"><meta property="og:image" content="https://example.com/image.jpg"></head></html>',
            ),
        );

        await expect(
            service.extractRecipeMetadata("https://example.com/recipe"),
        ).resolves.toEqual({
            name: "Recipe Name",
            imageUrl: "https://example.com/image.jpg",
        });
    });

    it("falls back to the page title for metadata", async () => {
        const service = createRecipeExtractionService(
            ok("<html><head><title>Title Name</title></head></html>"),
        );

        await expect(
            service.extractRecipeMetadata("https://example.com/recipe"),
        ).resolves.toEqual({ name: "Title Name" });
    });

    it("extracts a normalized recipe", async () => {
        const service = createRecipeExtractionService(
            ok(
                recipePage({
                    "@type": "Recipe",
                    name: "Test Recipe",
                    recipeIngredient: ["1 cup flour", "2 eggs"],
                    recipeInstructions: ["Mix", "Bake"],
                    recipeCuisine: ["Italian"],
                    recipeCategory: ["Dinner"],
                }),
            ),
        );

        const recipe = await service.extractRecipe(
            "https://example.com/recipe",
        );

        expect(recipe.name).toBe("Test Recipe");
        expect(recipe.method).toStrictEqual([
            {
                name: "Method",
                items: [{ content: "Mix" }, { content: "Bake" }],
            },
        ]);
        expect(recipe.tagCandidates).toStrictEqual({
            cuisine: ["italian"],
            category: ["dinner"],
        });
        expect(recipe.ingredients?.[0]?.items[0]).toMatchObject({
            name: "flour",
            amount: { representation: "number", value: "1" },
            unit: "cup",
        });
    });

    it("finds a recipe inside a graph", async () => {
        const service = createRecipeExtractionService(
            ok(
                recipePage({
                    "@context": "https://schema.org",
                    "@graph": [{ "@type": "Recipe", name: "Graph Recipe" }],
                }),
            ),
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).resolves.toMatchObject({ name: "Graph Recipe" });
    });

    it("rejects a page without a recipe", async () => {
        const service = createRecipeExtractionService(
            ok("<html><head></head><body>No recipe</body></html>"),
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(NoRecipeFoundError);
    });

    it("rejects a non-ok response", async () => {
        const service = createRecipeExtractionService(async () => ({
            ok: false,
            status: 404,
            text: "not found",
        }));

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(FetchFailedError);
    });
});
