import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publicUrl } from "@/lib/storage";

/** The UI polls this, not the workflow engine — jobs mirrors run state. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, id)).limit(1);
  if (!world) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.worldId, id)).limit(1);

  const spzKeys = world.spzKeys ?? {};
  return NextResponse.json({
    world: {
      ...world,
      spzUrls: Object.fromEntries(
        Object.entries(spzKeys).map(([variant, key]) => [variant, publicUrl(key)]),
      ),
      colliderUrl: world.colliderKey ? publicUrl(world.colliderKey) : null,
      thumbUrl: world.thumbKey ? publicUrl(world.thumbKey) : null,
    },
    job: job ?? null,
  });
}
