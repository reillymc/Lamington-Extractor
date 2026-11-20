export type ExtractorConfig = {
    apiKey: string | undefined;
};

export const loadConfig = (
    env: NodeJS.ProcessEnv = process.env,
): ExtractorConfig => {
    const apiKey = env.EXTRACTOR_API_KEY?.trim() || undefined;

    if (env.NODE_ENV === "production" && !apiKey) {
        throw new Error("EXTRACTOR_API_KEY is required in production");
    }

    return { apiKey };
};
