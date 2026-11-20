import { createHash, timingSafeEqual } from "node:crypto";
import express, {
    type NextFunction,
    type Request,
    type Response,
} from "express";
import helmet from "helmet";
import {
    ExtractorError,
    InternalError,
    InvalidUrlError,
    TooManyRequestsError,
    UnauthorizedError,
} from "./errors.ts";
import type { RecipeExtractionService } from "./services/recipeExtractionService.ts";

const MAX_URL_LENGTH = 2_048;
const MAX_CONCURRENCY = 8;

const safeEqual = (left: string, right: string): boolean => {
    const leftHash = createHash("sha256").update(left).digest();
    const rightHash = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
};

const requireApiKey =
    (apiKey: string | undefined) =>
    (request: Request, _response: Response, next: NextFunction) => {
        if (!apiKey) {
            next();
            return;
        }

        const header = request.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

        if (!token || !safeEqual(token, apiKey)) {
            next(new UnauthorizedError());
            return;
        }

        next();
    };

const limitConcurrency = (maxConcurrency: number) => {
    let active = 0;

    return (_request: Request, response: Response, next: NextFunction) => {
        if (active >= maxConcurrency) {
            next(new TooManyRequestsError());
            return;
        }

        active += 1;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active -= 1;
        };

        response.once("finish", release);
        response.once("close", release);
        next();
    };
};

const readUrl = (body: unknown): string => {
    if (!body || typeof body !== "object" || !("url" in body)) {
        throw new InvalidUrlError();
    }

    const url = (body as { url?: unknown }).url;
    if (
        typeof url !== "string" ||
        url.length === 0 ||
        url.length > MAX_URL_LENGTH
    ) {
        throw new InvalidUrlError();
    }

    return url;
};

const errorHandler = (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
) => {
    const extractorError =
        error instanceof ExtractorError
            ? error
            : new InternalError("Internal extractor error", error);

    if (extractorError.status >= 500) {
        console.error(extractorError.message, extractorError.innerError);
    }

    return response.status(extractorError.status).json({
        error: true,
        code: extractorError.code,
        message: extractorError.message,
    });
};

export type AppOptions = {
    service: RecipeExtractionService;
    apiKey?: string;
};

export const createApp = ({ service, apiKey }: AppOptions) => {
    if (process.env.NODE_ENV === "production" && !apiKey) {
        throw new Error("EXTRACTOR_API_KEY is required in production");
    }

    return express()
        .use(helmet())
        .use(express.json({ limit: "16kb" }))
        .use(limitConcurrency(MAX_CONCURRENCY))
        .get("/health", (_request, response) => {
            response.status(204).send();
        })
        .use("/v1", requireApiKey(apiKey))
        .post("/v1/recipeMetadata", async (request, response) => {
            const url = readUrl(request.body);
            const data = await service.extractRecipeMetadata(url);
            response.status(200).json(data);
        })
        .post("/v1/recipe", async (request, response) => {
            const url = readUrl(request.body);
            const data = await service.extractRecipe(url);
            response.status(200).json(data);
        })
        .use(errorHandler);
};
