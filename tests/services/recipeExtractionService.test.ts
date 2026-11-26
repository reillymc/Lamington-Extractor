import { describe, it } from "node:test";
import { expect } from "expect";
import { NoRecipeFoundError } from "../../src/errors.ts";
import { createRecipeExtractionService } from "../../src/services/recipeExtractionService.ts";

const responseMetadata = {
    status: 200,
    statusText: "OK",
    host: "example.com",
    contentType: "text/html",
    server: null,
    mitigation: null,
};

const ok = (html: string) => async () => ({
    ok: true,
    ...responseMetadata,
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

    it("rejects a non-ok response with upstream context", async () => {
        const service = createRecipeExtractionService(async () => ({
            ok: false,
            status: 404,
            statusText: "Not Found",
            host: "example.com",
            contentType: "text/html",
            server: null,
            mitigation: null,
            text: "not found",
        }));

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(
            "Upstream request failed: example.com returned 404 Not Found",
        );
    });

    it("includes upstream mitigation details in the error message", async () => {
        const service = createRecipeExtractionService(async () => ({
            ok: false,
            status: 403,
            statusText: "Forbidden",
            host: "example.com",
            contentType: "text/html; charset=UTF-8",
            server: "cloudflare",
            mitigation: "challenge",
            text: "",
        }));

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(
            "Upstream request failed: example.com returned 403 Forbidden (server: cloudflare, cf-mitigated: challenge)",
        );
    });

    const challengeResponse = {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        host: "example.com",
        contentType: "text/html; charset=UTF-8",
        server: "cloudflare",
        mitigation: "challenge",
        text: "",
    };

    it("falls back to an archive snapshot for a 403 html response", async () => {
        const service = createRecipeExtractionService(
            async () => challengeResponse,
            async () => ({
                text: recipePage({
                    "@type": "Recipe",
                    name: "Archived Recipe",
                }),
                timestamp: "20261005085029",
            }),
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).resolves.toMatchObject({ name: "Archived Recipe" });
    });

    it("uses the archive for metadata extraction", async () => {
        const service = createRecipeExtractionService(
            async () => challengeResponse,
            async () => ({
                text: "<html><head><title>Archived Metadata</title></head></html>",
                timestamp: "20261005085029",
            }),
        );

        await expect(
            service.extractRecipeMetadata("https://example.com/recipe"),
        ).resolves.toEqual({ name: "Archived Metadata" });
    });

    it("reports when no archive capture is available", async () => {
        const service = createRecipeExtractionService(
            async () => challengeResponse,
            async () => null,
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(
            "Upstream request failed: example.com returned 403 Forbidden (server: cloudflare, cf-mitigated: challenge); no recent archive capture found",
        );
    });

    it("does not use the archive for non-403 responses", async () => {
        let archiveCalls = 0;
        const service = createRecipeExtractionService(
            async () => ({
                ...challengeResponse,
                status: 404,
                statusText: "Not Found",
            }),
            async () => {
                archiveCalls += 1;
                return null;
            },
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow(
            "Upstream request failed: example.com returned 404 Not Found (server: cloudflare, cf-mitigated: challenge)",
        );
        expect(archiveCalls).toBe(0);
    });

    it("does not use the archive for non-html 403 responses", async () => {
        let archiveCalls = 0;
        const service = createRecipeExtractionService(
            async () => ({
                ...challengeResponse,
                contentType: "application/json",
            }),
            async () => {
                archiveCalls += 1;
                return null;
            },
        );

        await expect(
            service.extractRecipe("https://example.com/recipe"),
        ).rejects.toThrow("403 Forbidden");
        expect(archiveCalls).toBe(0);
    });
});
