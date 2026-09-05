import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db, schema } from "@/lib/db";
import { buildWorld } from "@/workflows/build-world";

/**
 * Retry a world without re-billing. The workflow skips generation whenever
 * worlds.operation_id is already set, so this recovers a run that died in a
 * later step while Marble kept working.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, id)).limit(1);
  if (!world) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (world.status === "succeeded") {
    return NextResponse.json({ error: "world already succeeded" }, { status: 409 });
  }

  const run = await start(buildWorld, [world.id]);

  await db
    .insert(schema.jobs)
    .values({ runId: run.runId, kind: "build-world", status: "running", projectId: world.projectId, worldId: world.id })
    .onConflictDoNothing({ target: schema.jobs.runId });

  return NextResponse.json({ worldId: world.id, runId: run.runId, resumedOperation: world.operationId });
}
