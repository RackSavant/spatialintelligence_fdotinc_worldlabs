import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Dev-only fallback so the pipeline runs before R2 credentials exist.
 * Writes under public/uploads, which Next serves at /uploads.
 */
const ROOT = resolve(process.cwd(), "public", "uploads");

function safePath(key: string): string {
  const full = resolve(ROOT, key);
  // resolve() collapses ../ — reject anything that escaped the root.
  if (full !== ROOT && !full.startsWith(ROOT + "/")) {
    throw new Error(`refusing to write outside uploads root: ${key}`);
  }
  return full;
}

export function publicUrl(key: string) {
  return `/uploads/${key}`;
}

export async function putBytes(key: string, body: Uint8Array, _contentType: string) {
  const path = safePath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return key;
}

export async function getBytes(key: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(safePath(key)));
}

export { join, ROOT };
