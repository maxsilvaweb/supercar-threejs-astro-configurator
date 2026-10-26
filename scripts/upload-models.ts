/**
 * Uploads new or changed GLBs from public/models to Vercel Blob under content-hashed
 * names, then rewrites src/lib/model-manifest.json. Unchanged files are skipped.
 *
 *   bun run models:upload            upload changes
 *   bun run models:upload --prune    also delete blobs the manifest no longer uses
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { del, list, put } from "@vercel/blob";
import { blobPathname, contentHash, localModelKeys, MODELS_DIR, readManifest, writeManifest } from "./models-shared";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Passed explicitly: with BLOB_STORE_ID set, the SDK would otherwise prefer the dev OIDC token, which Blob rejects.
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN is missing. Tick Development on the store connection in Vercel, then run vercel env pull.");
  process.exit(1);
}

const manifest = await readManifest();
const next = { ...manifest };
let uploaded = 0;

for (const key of await localModelKeys()) {
  const data = await readFile(join(MODELS_DIR, key));
  const pathname = blobPathname(key, contentHash(data));
  if (manifest[key] && new URL(manifest[key]).pathname === `/${pathname}`) continue;

  console.log(`↑ ${key} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
  const blob = await put(pathname, data, {
    token,
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: ONE_YEAR,
    contentType: "model/gltf-binary",
    multipart: data.length > 8 * 1024 * 1024,
  });
  next[key] = blob.url;
  uploaded++;
}

await writeManifest(next);
console.log(uploaded ? `Uploaded ${uploaded} model(s); manifest updated.` : "All models already up to date.");

if (process.argv.includes("--prune")) {
  const keep = new Set(Object.values(next).map((url) => new URL(url).pathname.slice(1)));
  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix: "models/", cursor });
    stale.push(...page.blobs.filter((blob) => !keep.has(blob.pathname)).map((blob) => blob.url));
    cursor = page.cursor;
  } while (cursor);
  if (stale.length) await del(stale, { token });
  console.log(`Pruned ${stale.length} unused blob(s).`);
}
