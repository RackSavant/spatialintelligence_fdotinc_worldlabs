import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { presignPut, publicUrl } from "@/lib/storage";

const MODEL_TYPES: Record<string, string> = {
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
};

export async function GET() {
  const rows = await db.select().from(schema.assets).orderBy(desc(schema.assets.createdAt));
  return NextResponse.json({
    assets: rows.map((a) => ({ ...a, url: publicUrl(a.r2Key) })),
  });
}

/**
 * Creates the catalog row and hands back a presigned target. The browser
 * unzips and measures the model, so bounding boxes arrive already in metres
 * and never need a server-side glTF parse.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    category?: string;
    contentType?: string;
    bboxM?: { x: number; y: number; z: number };
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const ext = MODEL_TYPES[body.contentType ?? ""];
  if (!ext) {
    return NextResponse.json(
      { error: `contentType must be one of ${Object.keys(MODEL_TYPES).join(", ")}` },
      { status: 400 },
    );
  }

  const key = `assets/${randomUUID()}.${ext}`;
  const [asset] = await db
    .insert(schema.assets)
    .values({
      source: "catalog",
      name: body.name.trim().slice(0, 120),
      category: body.category?.trim() || "uncategorised",
      r2Key: key,
      bboxM: body.bboxM ?? null,
    })
    .returning();

  const upload = await presignPut(key, body.contentType!);
  return NextResponse.json({ asset: { ...asset, url: publicUrl(key) }, upload }, { status: 201 });
}
