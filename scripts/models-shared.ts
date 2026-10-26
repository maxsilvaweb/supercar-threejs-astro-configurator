/** Shared helpers for the model upload, sync, and check scripts. */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const MODELS_DIR = join(import.meta.dirname, "../public/models");
export const MANIFEST_PATH = join(import.meta.dirname, "../src/lib/model-manifest.json");
export const CONSTANTS_PATH = join(import.meta.dirname, "../src/lib/constants.ts");

export type Manifest = Record<string, string>;

export async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

export async function writeManifest(manifest: Manifest) {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Every GLB under public/models, as keys relative to that folder. */
export async function localModelKeys() {
  const entries = await readdir(MODELS_DIR, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".glb"))
    .map((entry) => relative(MODELS_DIR, join(MODELS_DIR, entry)).split("\\").join("/"))
    .sort();
}

/** Keys the app asks for through modelUrl("...") in constants.ts. */
export async function referencedModelKeys() {
  const source = await readFile(CONSTANTS_PATH, "utf8");
  return [...source.matchAll(/modelUrl\("([^"]+)"\)/g)].map((match) => match[1]);
}

export function contentHash(data: Buffer) {
  return createHash("sha256").update(data).digest("hex").slice(0, 12);
}

/** "rim/rim.glb" + hash → "models/rim/rim.<hash>.glb" */
export function blobPathname(key: string, hash: string) {
  return `models/${key.replace(/\.glb$/, `.${hash}.glb`)}`;
}
