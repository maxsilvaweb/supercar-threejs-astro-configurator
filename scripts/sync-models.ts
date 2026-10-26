/** Downloads any GLB listed in the manifest that is missing from public/models (fresh clones). */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MODELS_DIR, readManifest } from "./models-shared";

let downloaded = 0;
for (const [key, url] of Object.entries(await readManifest())) {
  const file = join(MODELS_DIR, key);
  if (existsSync(file)) continue;
  console.log(`↓ ${key}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  downloaded++;
}
console.log(downloaded ? `Downloaded ${downloaded} model(s).` : "All models present.");
