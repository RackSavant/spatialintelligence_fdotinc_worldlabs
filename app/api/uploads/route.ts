import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { presignPut } from "@/lib/storage";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

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

  const ext = body.contentType.split("/")[1].replace("jpeg", "jpg");
  const key = `projects/${body.projectId}/photos/${randomUUID()}.${ext}`;

  const [photo] = await db
    .insert(schema.photos)
    .values({ projectId: body.projectId, r2Key: key, contentType: body.contentType })
    .returning();

  const upload = await presignPut(key, body.contentType);
  return NextResponse.json({ photo, upload }, { status: 201 });
}
