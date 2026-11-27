import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const packagePath = resolve(rootDirectory, "package.json");
const specPath = resolve(rootDirectory, "openapi.yaml");

const { version } = JSON.parse(readFileSync(packagePath, "utf8")) as {
    version: string;
};

const spec = readFileSync(specPath, "utf8");
const versionPattern =
    /(^info:\n(?:[ \t]+.*\n)*?[ \t]+version:[ \t]*)\S+([ \t]*$)/m;

if (!versionPattern.test(spec)) {
    throw new Error(`Could not find info.version in ${specPath}`);
}

const updatedSpec = spec.replace(versionPattern, `$1${version}$2`);

if (updatedSpec === spec) {
    console.log(`openapi.yaml info.version already at ${version}`);
    process.exit(0);
}

writeFileSync(specPath, updatedSpec);
console.log(`openapi.yaml info.version -> ${version}`);
