import { describe, it } from "node:test";
import { expect } from "expect";
import request from "supertest";
import {
    ExtractionLimitError,
    UnsupportedMediaTypeError,
} from "../../src/errors.ts";
import { createApp } from "../../src/server.ts";
import type { ImageFetchService } from "../../src/services/imageFetchService.ts";
import type { RecipeExtractionService } from "../../src/services/recipeExtractionService.ts";

const recipeService: RecipeExtractionService = {
    extractRecipeMetadata: async () => ({
        name: "Test Recipe",
        imageUrl: "https://example.com/image.jpg",
    }),
    extractRecipe: async () => ({
        name: "Test Recipe",
        method: [{ name: "Method", items: [{ content: "Cook it." }] }],
        tagCandidates: { cuisine: ["italian"] },
    }),
};

const imageService: ImageFetchService = {
    fetchImage: async () => ({
        body: Buffer.from([1, 2, 3]),
        contentType: "image/png",
    }),
};

describe("extractor routes", () => {
    it("reports health", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        ).get("/health");
        expect(response.status).toBe(204);
    });

    it("extracts metadata", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipeMetadata")
            .send({ url: "https://example.com/recipe" });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            name: "Test Recipe",
            imageUrl: "https://example.com/image.jpg",
        });
    });

    it("extracts a recipe", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipe")
            .send({ url: "https://example.com/recipe" });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            name: "Test Recipe",
            method: [{ name: "Method", items: [{ content: "Cook it." }] }],
            tagCandidates: { cuisine: ["italian"] },
        });
    });

    it("rejects a missing url", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipe")
            .send({});

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            error: true,
            message: "Invalid URL",
        });
    });

    it("rejects an oversized url", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipe")
            .send({ url: `https://example.com/${"a".repeat(2048)}` });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            error: true,
            message: "Invalid URL",
        });
    });

    it("requires the api key when configured", async () => {
        const app = createApp({
            recipeService,
            imageService,
            apiKey: "secret",
        });

        const unauthorized = await request(app)
            .post("/v1/recipe")
            .send({ url: "https://example.com/recipe" });
        expect(unauthorized.status).toBe(401);
        expect(unauthorized.body).toMatchObject({
            error: true,
            message: "Unauthorized",
        });

        const authorized = await request(app)
            .post("/v1/recipe")
            .set("Authorization", "Bearer secret")
            .send({ url: "https://example.com/recipe" });
        expect(authorized.status).toBe(200);
    });

    it("rejects malformed JSON", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipe")
            .set("Content-Type", "application/json")
            .send('{"url":');

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            error: true,
            message: "Invalid request",
        });
    });

    it("rejects an oversized request body", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/recipe")
            .send({
                url: `https://example.com/${"a".repeat(20_000)}`,
            });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            error: true,
            message: "Invalid request",
        });
    });

    it("returns extraction limit errors with 413", async () => {
        const limited: RecipeExtractionService = {
            ...recipeService,
            extractRecipe: async () => {
                throw new ExtractionLimitError();
            },
        };

        const response = await request(
            createApp({ recipeService: limited, imageService }),
        )
            .post("/v1/recipe")
            .send({ url: "https://example.com/recipe" });

        expect(response.status).toBe(413);
        expect(response.body).toMatchObject({
            error: true,
            message: "Recipe content exceeds extraction limits",
        });
    });

    it("returns controlled service errors", async () => {
        const failing: RecipeExtractionService = {
            extractRecipeMetadata: async () => {
                throw new Error("boom");
            },
            extractRecipe: async () => {
                throw new Error("boom");
            },
        };

        const response = await request(
            createApp({ recipeService: failing, imageService }),
        )
            .post("/v1/recipe")
            .send({ url: "https://example.com/recipe" });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
            error: true,
            message: "Internal extractor error",
        });
    });
});

describe("fetch image", () => {
    it("returns image bytes", async () => {
        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/image")
            .send({ url: "https://example.com/image.png" });

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("image/png");
        expect(response.body).toEqual(Buffer.from([1, 2, 3]));
    });

    it("returns controlled image errors", async () => {
        const imageService: ImageFetchService = {
            fetchImage: async () => {
                throw new UnsupportedMediaTypeError(
                    "Unsupported image content type",
                );
            },
        };

        const response = await request(
            createApp({ recipeService, imageService }),
        )
            .post("/v1/image")
            .send({ url: "https://example.com/image.svg" });

        expect(response.status).toBe(415);
        expect(response.body).toMatchObject({
            error: true,
            message: "Unsupported image content type",
        });
    });
});
