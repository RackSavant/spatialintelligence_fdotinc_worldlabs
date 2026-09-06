import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { presignPut } from "@/lib/storage";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Marble caps video prompts at 100MB. */
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const ALLOWED = new Set([...IMAGE_TYPES, ...VIDEO_TYPES]);
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * Hands the browser a presigned target and records the row up front. Bytes
 * never pass through this route — Vercel caps request bodies around 4.5MB and
 * room photos routinely exceed it.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    fileName?: string;
    contentType?: string;
  };

  if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!body.contentType || !ALLOWED.has(body.contentType)) {
    return NextResponse.json(
      { error: `contentType must be one of ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  const kind = VIDEO_TYPES.has(body.contentType) ? "video" : "image";
  const ext = EXT[body.contentType];
  const key = `projects/${body.projectId}/${kind === "video" ? "videos" : "photos"}/${randomUUID()}.${ext}`;

  const [photo] = await db
    .insert(schema.photos)
    .values({ projectId: body.projectId, r2Key: key, contentType: body.contentType, kind })
    .returning();

  const upload = await presignPut(key, body.contentType);
  return NextResponse.json({ photo, upload }, { status: 201 });
}
