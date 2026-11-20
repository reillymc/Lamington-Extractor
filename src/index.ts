import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";
import { createRecipeExtractionService } from "./services/recipeExtractionService.ts";
import { createSafeFetchText } from "./utils/safeFetch.ts";

const PORT = 3001;

const config = loadConfig();
const fetchText = createSafeFetchText();
const service = createRecipeExtractionService(fetchText);
const app = createApp({
    service,
    apiKey: config.apiKey,
});

const server = app.listen(PORT, () => {
    console.log(`Lamington Extractor Started: http://localhost:${PORT}`);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception, closing server:", error);
    process.exit(1);
});

process.on("SIGTERM", () => {
    server.close(() => {
        process.exit(0);
    });
});
