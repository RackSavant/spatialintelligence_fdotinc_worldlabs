import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import type { MarbleModel } from "@/lib/marble/types";
import { buildWorld } from "@/workflows/build-world";

const MODELS: MarbleModel[] = ["marble-1.1", "marble-1.1-plus", "marble-1.0", "marble-1.0-draft"];

/** Bump when the prompt construction changes, so old worlds don't collide. */
const PROMPT_VERSION = "v1";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    projectId?: string;
    editId?: string;
    photoId?: string;
    model?: MarbleModel;
  };

  if (!body.projectId || (!body.editId && !body.photoId)) {
    return NextResponse.json(
      { error: "projectId and one of editId or photoId are required" },
      { status: 400 },
    );
  }

  const model = body.model ?? "marble-1.1";
  if (!MODELS.includes(model)) {
    return NextResponse.json({ error: `model must be one of ${MODELS.join(", ")}` }, { status: 400 });
  }

  if (!env().WORLDLABS_API_KEY) {
    return NextResponse.json(
      { error: "WORLDLABS_API_KEY is not set. Add it to .env.local before generating a world." },
      { status: 503 },
    );
  }

  const idempotencyKey = createHash("sha256")
    .update([body.projectId, body.editId ?? body.photoId, model, PROMPT_VERSION].join("|"))
    .digest("hex");

  /**
   * The unique index on idempotency_key is the real double-charge guard.
   * Workflow replay protects against retries; this also covers a user
   * double-clicking, or two tabs submitting the same source at once.
   */
  const inserted = await db
    .insert(schema.worlds)
    .values({
      projectId: body.projectId,
      sourceEditId: body.editId ?? null,
      sourcePhotoId: body.editId ? null : (body.photoId ?? null),
      model,
      idempotencyKey,
      status: "queued",
    })
    .onConflictDoNothing({ target: schema.worlds.idempotencyKey })
    .returning();

  if (inserted.length === 0) {
    const [existing] = await db
      .select()
      .from(schema.worlds)
      .where(eq(schema.worlds.idempotencyKey, idempotencyKey))
      .limit(1);
    return NextResponse.json({ world: existing, deduplicated: true }, { status: 200 });
  }

  const world = inserted[0];
  const run = await start(buildWorld, [world.id]);

  await db.insert(schema.jobs).values({
    runId: run.runId,
    kind: "build-world",
    status: "running",
    projectId: body.projectId,
    worldId: world.id,
  });

  return NextResponse.json({ world, runId: run.runId }, { status: 201 });
}
