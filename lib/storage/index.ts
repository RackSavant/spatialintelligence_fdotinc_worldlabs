import { r2Config } from "@/lib/env";
import * as local from "./local";
import * as r2 from "./r2";

export function usingR2(): boolean {
  return r2Config() !== null;
}

export function publicUrl(key: string): string {
  return usingR2() ? r2.publicUrl(key) : local.publicUrl(key);
}

export function putBytes(key: string, body: Uint8Array, contentType: string): Promise<string> {
  return usingR2() ? r2.putBytes(key, body, contentType) : local.putBytes(key, body, contentType);
}

export function getBytes(key: string): Promise<Uint8Array> {
  return usingR2() ? r2.getBytes(key) : local.getBytes(key);
}

export interface PresignedUpload {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

/**
 * Browser uploads bytes straight to storage. On R2 that's a presigned PUT;
 * locally it's a dev route, which keeps the client code identical either way.
 * The local path routes bytes through Next, so it would hit Vercel's ~4.5MB
 * body cap in production — it is never used there.
 */
export async function presignPut(key: string, contentType: string): Promise<PresignedUpload> {
  if (usingR2()) {
    return {
      key,
      url: await r2.presignPut(key, contentType),
      method: "PUT",
      headers: { "Content-Type": contentType },
    };
  }
  return {
    key,
    url: `/api/dev-upload?key=${encodeURIComponent(key)}`,
    method: "PUT",
    headers: { "Content-Type": contentType },
  };
}

/**
 * Copy a Marble signed URL into our own storage. Marble asset URLs and the
 * operation itself carry an expires_at, so this runs before anything else once
 * a generation completes.
 */
export async function mirrorFromUrl(url: string, key: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mirror ${key}: source responded ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return putBytes(key, new Uint8Array(await res.arrayBuffer()), contentType);
}
