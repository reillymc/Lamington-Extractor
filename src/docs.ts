import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";

const specPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../openapi.yaml",
);

const spec = parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;

spec.servers = [{ url: "/" }];

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
].join("; ");

export const createDocsRouter = (): Router => {
    const router = Router();

    router.use((_request, response, next) => {
        response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
        next();
    });

    router.get(
        "/",
        swaggerUi.setup(spec, {
            customSiteTitle: "Lamington Extractor API",
        }),
    );
    router.use(swaggerUi.serveWithOptions({ redirect: false }));

    return router;
};
