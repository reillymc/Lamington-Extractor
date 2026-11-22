export class ExtractorError extends Error {
    status: number;
    innerError: unknown;

    constructor({
        status,
        message,
        innerError,
    }: {
        status: number;
        message: string;
        innerError?: unknown;
    }) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.innerError = innerError;
    }
}

export class InvalidRequestError extends ExtractorError {
    constructor(message = "Invalid request", innerError?: unknown) {
        super({ status: 400, message, innerError });
    }
}

export class InvalidUrlError extends ExtractorError {
    constructor(message = "Invalid URL") {
        super({ status: 400, message });
    }
}

export class ExtractionLimitError extends ExtractorError {
    constructor(message = "Recipe content exceeds extraction limits") {
        super({ status: 413, message });
    }
}

export class NoRecipeFoundError extends ExtractorError {
    constructor(message = "No recipe found") {
        super({ status: 422, message });
    }
}

export class UnauthorizedError extends ExtractorError {
    constructor(message = "Unauthorized") {
        super({ status: 401, message });
    }
}

export class TooManyRequestsError extends ExtractorError {
    constructor(message = "Too many concurrent requests") {
        super({ status: 429, message });
    }
}

export class FetchFailedError extends ExtractorError {
    constructor(
        message = "Failed to fetch remote content",
        innerError?: unknown,
    ) {
        super({ status: 502, message, innerError });
    }
}

export class InternalError extends ExtractorError {
    constructor(message = "Internal extractor error", innerError?: unknown) {
        super({ status: 500, message, innerError });
    }
}
