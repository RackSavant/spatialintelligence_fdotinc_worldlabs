import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireKey } from "@/lib/env";
import { DEFAULT_MODEL, editImage, GeminiError, type NanoBananaModel } from "@/lib/gemini/client";
import { getBytes, publicUrl, putBytes } from "@/lib/storage";

/**
 * One Nano Banana edit. The source is either a photo or an earlier edit —
 * editing an edit is what makes the history a tree rather than a line.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    photoId?: string;
    parentEditId?: string;
    prompt?: string;
    model?: NanoBananaModel;
  };

  if (!body.projectId || !body.photoId || !body.prompt?.trim()) {
    return NextResponse.json(
      { error: "projectId, photoId and prompt are required" },
      { status: 400 },
    );
  }

  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, body.photoId))
    .limit(1);
  if (!photo) return NextResponse.json({ error: "photo not found" }, { status: 404 });

  // Branching from an edit means that edit's output is the input image.
  let sourceKey = photo.r2Key;
  let sourceType = photo.contentType;
  if (body.parentEditId) {
    const [parent] = await db
      .select()
      .from(schema.edits)
      .where(eq(schema.edits.id, body.parentEditId))
      .limit(1);
    if (!parent) return NextResponse.json({ error: "parent edit not found" }, { status: 404 });
    sourceKey = parent.r2Key;
    sourceType = "image/png";
  }

  let apiKey: string;
  try {
    apiKey = requireKey("GEMINI_API_KEY");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }

  const model = body.model ?? DEFAULT_MODEL;

  try {
    const source = await getBytes(sourceKey);
    const result = await editImage({
      apiKey,
      prompt: body.prompt.trim(),
      image: { bytes: source, mimeType: sourceType },
      model,
    });

    const ext = result.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const key = `projects/${body.projectId}/edits/${randomUUID()}.${ext}`;
    await putBytes(key, result.bytes, result.mimeType);

    const [edit] = await db
      .insert(schema.edits)
      .values({
        projectId: body.projectId,
        photoId: photo.id,
        parentEditId: body.parentEditId ?? null,
        prompt: body.prompt.trim(),
        model,
        r2Key: key,
      })
      .returning();

    return NextResponse.json({ edit: { ...edit, url: publicUrl(key) } }, { status: 201 });
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json(
        { error: err.message, retryable: err.retryable },
        { status: err.retryable ? 503 : 502 },
      );
    }
    throw err;
  }
}
