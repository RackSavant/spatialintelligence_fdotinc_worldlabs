import { NextResponse } from "next/server";
import { usingR2 } from "@/lib/storage";
import { putBytes } from "@/lib/storage/local";

/** Dev-only receiver for the local storage fallback. Disabled once R2 is set. */
export async function PUT(request: Request) {
  if (usingR2()) {
    return NextResponse.json({ error: "R2 is configured; use the presigned URL" }, { status: 400 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  await putBytes(key, bytes, contentType);
  return NextResponse.json({ key, bytes: bytes.byteLength });
}
