import { FetchFailedError } from "../errors.ts";
import type { SafeFetchMetadata } from "./safeFetch.ts";

const formatContext = (
    metadata: Pick<SafeFetchMetadata, "server" | "mitigation">,
): string => {
    const parts: string[] = [];

    if (metadata.server) parts.push(`server: ${metadata.server}`);
    if (metadata.mitigation) parts.push(`cf-mitigated: ${metadata.mitigation}`);

    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
};

export const createUpstreamHttpError = (
    metadata: Pick<
        SafeFetchMetadata,
        "status" | "statusText" | "host" | "server" | "mitigation"
    >,
): FetchFailedError => {
    const reason = metadata.statusText.trim();
    const status = reason
        ? `${metadata.status} ${reason}`
        : String(metadata.status);

    return new FetchFailedError(
        `Upstream request failed: ${metadata.host} returned ${status}${formatContext(metadata)}`,
    );
};
