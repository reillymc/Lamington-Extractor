import { describe, it } from "node:test";
import { expect } from "expect";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
    it("allows an API key to be omitted outside production", () => {
        const config = loadConfig({ NODE_ENV: "development" });
        expect(config.apiKey).toBeUndefined();
    });

    it("disables auth outside production by default", () => {
        const config = loadConfig({
            NODE_ENV: "development",
            EXTRACTOR_API_KEY: "test-key",
        });
        expect(config.apiKey).toBeUndefined();
    });

    it("requires an API key in production", () => {
        expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
            "EXTRACTOR_API_KEY is required",
        );
    });

    it("accepts a production API key", () => {
        const config = loadConfig({
            NODE_ENV: "production",
            EXTRACTOR_API_KEY: "test-key",
        });
        expect(config.apiKey).toBe("test-key");
    });

    it("enables auth outside production when requested", () => {
        const config = loadConfig({
            NODE_ENV: "development",
            EXTRACTOR_REQUIRE_AUTH: "true",
            EXTRACTOR_API_KEY: "test-key",
        });
        expect(config.apiKey).toBe("test-key");
    });

    it("requires an API key when auth is explicitly enabled", () => {
        expect(() =>
            loadConfig({
                NODE_ENV: "development",
                EXTRACTOR_REQUIRE_AUTH: "true",
            }),
        ).toThrow("EXTRACTOR_API_KEY is required");
    });
});
