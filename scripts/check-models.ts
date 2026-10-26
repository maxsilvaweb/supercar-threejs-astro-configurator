/**
 * Build guard: every model the app references must resolve, either to a live Blob URL in
 * the manifest or to a file in public/models. Warns when a local file differs from Blob.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { blobPathname, contentHash, MODELS_DIR, readManifest, referencedModelKeys } from "./models-shared";

const manifest = await readManifest();
const keys = await referencedModelKeys();
const errors: string[] = [];

await Promise.all(
  keys.map(async (key) => {
    const file = join(MODELS_DIR, key);
    const url = manifest[key];
    if (!url) {
      if (!existsSync(file)) errors.push(`${key}: not in the manifest and not in public/models`);
      return;
    }
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) errors.push(`${key}: ${url} → ${response.status}`);
    if (existsSync(file)) {
      const expected = `/${blobPathname(key, contentHash(await readFile(file)))}`;
      if (new URL(url).pathname !== expected) console.warn(`⚠ ${key} changed locally; run bun run models:upload`);
    }
  }),
);

if (errors.length) {
  console.error(`Model check failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`Model check passed (${keys.length} models).`);
