import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";
import { createRecipeExtractionService } from "./services/recipeExtractionService.ts";
import { createSafeFetchText } from "./utils/safeFetch.ts";

const DEFAULT_PORT = 3001;

const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const config = loadConfig();
const fetchText = createSafeFetchText();
const service = createRecipeExtractionService(fetchText);
const app = createApp({
    service,
    apiKey: config.apiKey,
});

const server = app.listen(port, () => {
    console.log(`Lamington Extractor Started: http://localhost:${port}`);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception, closing server:", error);
    process.exit(1);
});

process.once("SIGTERM", () => {
    console.log("SIGTERM received, closing server");
    server.close((error) => {
        if (error) {
            console.error("Failed to close server:", error);
            process.exitCode = 1;
            return;
        }

        process.exitCode = 0;
    });
});
