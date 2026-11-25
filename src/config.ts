type ExtractorConfig = {
    apiKey: string | undefined;
};

export const loadConfig = (
    env: NodeJS.ProcessEnv = process.env,
): ExtractorConfig => {
    const isProduction = env.NODE_ENV === "production";
    const apiKey = env.EXTRACTOR_API_KEY?.trim() || undefined;
    const requireAuth =
        isProduction || env.EXTRACTOR_REQUIRE_AUTH?.toLowerCase() === "true";

    if (requireAuth && !apiKey) {
        throw new Error(
            isProduction
                ? "EXTRACTOR_API_KEY is required in production"
                : "EXTRACTOR_API_KEY is required when EXTRACTOR_REQUIRE_AUTH is enabled",
        );
    }

    return { apiKey: requireAuth ? apiKey : undefined };
};
