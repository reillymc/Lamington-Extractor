export class ExtractorError extends Error {
    status: number;
    code: string;
    innerError: unknown;

    constructor({
        status,
        code,
        message,
        innerError,
    }: {
        status: number;
        code: string;
        message: string;
        innerError?: unknown;
    }) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.innerError = innerError;
    }
}

export class InvalidUrlError extends ExtractorError {
    constructor(message = "Invalid URL") {
        super({ status: 400, code: "INVALID_URL", message });
    }
}

export class DisallowedUrlError extends ExtractorError {
    constructor(message = "URL is not allowed") {
        super({ status: 400, code: "DISALLOWED_URL", message });
    }
}

export class ExtractionLimitError extends ExtractorError {
    constructor(message = "Recipe content exceeds extraction limits") {
        super({ status: 400, code: "EXTRACTION_LIMIT", message });
    }
}

export class NoRecipeFoundError extends ExtractorError {
    constructor(message = "No recipe found") {
        super({ status: 422, code: "NO_RECIPE_FOUND", message });
    }
}

export class FetchFailedError extends ExtractorError {
    constructor(
        message = "Failed to fetch remote content",
        innerError?: unknown,
    ) {
        super({
            status: 502,
            code: "FETCH_FAILED",
            message,
            innerError,
        });
    }
}

export class UnauthorizedError extends ExtractorError {
    constructor(message = "Unauthorized") {
        super({ status: 401, code: "INTERNAL", message });
    }
}

export class TooManyRequestsError extends ExtractorError {
    constructor(message = "Too many concurrent requests") {
        super({ status: 429, code: "INTERNAL", message });
    }
}

export class InternalError extends ExtractorError {
    constructor(message = "Internal extractor error", innerError?: unknown) {
        super({ status: 500, code: "INTERNAL", message, innerError });
    }
}
