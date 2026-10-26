/** Resolves GLB paths to Vercel Blob in production and to public/models in dev. */
import manifest from "./model-manifest.json";

const blobUrls: Record<string, string> = manifest;

/** `key` is the path under public/models, e.g. "rim/rim.glb". */
export function modelUrl(key: string) {
  if (import.meta.env.DEV) return `/models/${key}`;
  return blobUrls[key] ?? `/models/${key}`;
}

/** Origin of the Blob store, for preconnect. Undefined until models are uploaded. */
export const MODEL_ORIGIN = import.meta.env.DEV
  ? undefined
  : Object.values(blobUrls).map((url) => new URL(url).origin)[0];
