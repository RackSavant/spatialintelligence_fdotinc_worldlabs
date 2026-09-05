import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publicUrl } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [photos, edits, worlds] = await Promise.all([
    db.select().from(schema.photos).where(eq(schema.photos.projectId, id)).orderBy(asc(schema.photos.createdAt)),
    db.select().from(schema.edits).where(eq(schema.edits.projectId, id)).orderBy(asc(schema.edits.createdAt)),
    db.select().from(schema.worlds).where(eq(schema.worlds.projectId, id)).orderBy(asc(schema.worlds.createdAt)),
  ]);

  return NextResponse.json({
    project,
    photos: photos.map((p) => ({ ...p, url: publicUrl(p.r2Key) })),
    edits: edits.map((e) => ({ ...e, url: publicUrl(e.r2Key) })),
    worlds,
  });
}
