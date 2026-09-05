import { eq } from "drizzle-orm";
import { FatalError, RetryableError, sleep } from "workflow";
import { db, schema } from "@/lib/db";
import { requireKey } from "@/lib/env";
import { marble, MarbleError } from "@/lib/marble/client";
import type { MarbleModel, World } from "@/lib/marble/types";
import { mirrorFromUrl } from "@/lib/storage";
import { getBytes } from "@/lib/storage";

/**
 * Marble generation as a durable workflow.
 *
 * The shape is dictated by three properties of the API: generation takes
 * minutes, it is billed per call, and both the operation and its asset URLs
 * expire. So every call that spends money is its own memoized step, the poll
 * loop sleeps rather than blocking a function, and mirroring assets is the
 * first thing that happens once the operation completes.
 */

const POLL_BUDGET = 90;

/** Marble's retry decision, mapped onto the workflow engine's. */
function rethrowAsWorkflowError(err: unknown): never {
  if (err instanceof MarbleError) {
    if (err.retryable) {
      throw new RetryableError(
        err.message,
        err.retryAfterSeconds != null
          ? { retryAfter: new Date(Date.now() + err.retryAfterSeconds * 1000) }
          : {},
      );
    }
    // 402 lands here on purpose: out of credits is not fixed by retrying.
    throw new FatalError(err.message);
  }
  throw err;
}

interface SourceInfo {
  storageKey: string;
  contentType: string;
  model: MarbleModel;
  displayName: string;
}

async function loadSource(worldId: string): Promise<SourceInfo> {
  "use step";

  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId)).limit(1);
  if (!world) throw new FatalError(`world ${worldId} not found`);

  await db
    .update(schema.worlds)
    .set({ status: "running" })
    .where(eq(schema.worlds.id, worldId));

  if (world.sourceEditId) {
    const [edit] = await db
      .select()
      .from(schema.edits)
      .where(eq(schema.edits.id, world.sourceEditId))
      .limit(1);
    if (!edit) throw new FatalError(`source edit ${world.sourceEditId} not found`);
    return {
      storageKey: edit.r2Key,
      contentType: "image/png",
      model: world.model as MarbleModel,
      displayName: edit.prompt.slice(0, 60),
    };
  }

  if (world.sourcePhotoId) {
    const [photo] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, world.sourcePhotoId))
      .limit(1);
    if (!photo) throw new FatalError(`source photo ${world.sourcePhotoId} not found`);
    return {
      storageKey: photo.r2Key,
      contentType: photo.contentType,
      model: world.model as MarbleModel,
      displayName: "Room photo",
    };
  }

  throw new FatalError(`world ${worldId} has no source image`);
}

async function uploadSourceToMarble(source: SourceInfo): Promise<string> {
  "use step";
  const apiKey = requireKey("WORLDLABS_API_KEY");
  const bytes = await getBytes(source.storageKey);
  const fileName = source.storageKey.split("/").pop() ?? "source.png";
  try {
    return await marble(apiKey).uploadMedia(bytes, fileName, "image", source.contentType);
  } catch (err) {
    rethrowAsWorkflowError(err);
  }
}

async function startGeneration(
  worldId: string,
  mediaAssetId: string,
  model: MarbleModel,
  displayName: string,
): Promise<string> {
  "use step";
  const apiKey = requireKey("WORLDLABS_API_KEY");

  // Step memoization means a workflow replay won't re-bill this, and the
  // unique idempotency_key on worlds blocks a duplicate submit upstream.
  try {
    const operation = await marble(apiKey).generateWorld({
      display_name: displayName,
      model,
      world_prompt: {
        type: "image",
        image_prompt: { source: "media_asset", media_asset_id: mediaAssetId },
      },
    });

    await db
      .update(schema.worlds)
      .set({ operationId: operation.operation_id })
      .where(eq(schema.worlds.id, worldId));

    return operation.operation_id;
  } catch (err) {
    rethrowAsWorkflowError(err);
  }
}

interface PollResult {
  done: boolean;
  progress: number | null;
  errorMessage: string | null;
  world: World | null;
}

async function pollOperation(worldId: string, operationId: string): Promise<PollResult> {
  "use step";
  const apiKey = requireKey("WORLDLABS_API_KEY");

  let operation;
  try {
    operation = await marble(apiKey).getOperation(operationId);
  } catch (err) {
    rethrowAsWorkflowError(err);
  }

  const progress = operation.metadata?.progress ?? operation.metadata?.progress_percent ?? null;
  if (progress != null) {
    await db
      .update(schema.jobs)
      .set({ progress: Math.round(progress), updatedAt: new Date() })
      .where(eq(schema.jobs.worldId, worldId));
  }

  return {
    done: Boolean(operation.done),
    progress: progress != null ? Math.round(progress) : null,
    errorMessage: operation.error ? JSON.stringify(operation.error) : null,
    world: operation.response ?? null,
  };
}

interface MirroredAssets {
  spzKeys: Record<string, string>;
  colliderKey: string | null;
  panoKey: string | null;
  thumbKey: string | null;
}

async function mirrorAssets(worldId: string, world: World): Promise<MirroredAssets> {
  "use step";

  const assets = world.assets;
  const prefix = `worlds/${worldId}`;
  const spzUrls = assets?.splats?.spz_urls ?? {};

  const [spzEntries, colliderKey, panoKey, thumbKey] = await Promise.all([
    Promise.all(
      Object.entries(spzUrls).map(async ([variant, url]) => {
        const key = await mirrorFromUrl(url, `${prefix}/${variant}.spz`);
        return [variant, key] as const;
      }),
    ),
    assets?.mesh?.collider_mesh_url
      ? mirrorFromUrl(assets.mesh.collider_mesh_url, `${prefix}/collider.glb`)
      : Promise.resolve(null),
    assets?.imagery?.pano_url
      ? mirrorFromUrl(assets.imagery.pano_url, `${prefix}/pano.jpg`)
      : Promise.resolve(null),
    assets?.thumbnail_url
      ? mirrorFromUrl(assets.thumbnail_url, `${prefix}/thumb.jpg`)
      : Promise.resolve(null),
  ]);

  return { spzKeys: Object.fromEntries(spzEntries), colliderKey, panoKey, thumbKey };
}

async function finalizeWorld(worldId: string, world: World, assets: MirroredAssets) {
  "use step";

  const semantics = world.assets?.splats?.semantics_metadata;

  await db
    .update(schema.worlds)
    .set({
      status: "succeeded",
      marbleWorldId: world.world_id,
      caption: world.assets?.caption ?? null,
      metricScaleFactor: semantics?.metric_scale_factor ?? null,
      groundPlaneOffset: semantics?.ground_plane_offset ?? null,
      spzKeys: assets.spzKeys,
      colliderKey: assets.colliderKey,
      panoKey: assets.panoKey,
      thumbKey: assets.thumbKey,
      completedAt: new Date(),
    })
    .where(eq(schema.worlds.id, worldId));

  await db
    .update(schema.jobs)
    .set({ status: "succeeded", progress: 100, updatedAt: new Date() })
    .where(eq(schema.jobs.worldId, worldId));
}

async function failWorld(worldId: string, message: string) {
  "use step";
  await db
    .update(schema.worlds)
    .set({ status: "failed", error: { message }, completedAt: new Date() })
    .where(eq(schema.worlds.id, worldId));
  await db
    .update(schema.jobs)
    .set({ status: "failed", error: { message }, updatedAt: new Date() })
    .where(eq(schema.jobs.worldId, worldId));
}

export async function buildWorld(worldId: string) {
  "use workflow";

  try {
    const source = await loadSource(worldId);
    const mediaAssetId = await uploadSourceToMarble(source);
    const operationId = await startGeneration(
      worldId,
      mediaAssetId,
      source.model,
      source.displayName,
    );

    let result: PollResult | null = null;
    for (let attempt = 0; attempt < POLL_BUDGET; attempt++) {
      result = await pollOperation(worldId, operationId);
      if (result.done) break;
      // Tight early, then back off — most worlds take minutes, not seconds.
      await sleep(attempt < 10 ? "10s" : "30s");
    }

    if (!result?.done) {
      throw new FatalError(`generation exceeded the polling budget for world ${worldId}`);
    }
    if (result.errorMessage) {
      throw new FatalError(`generation failed: ${result.errorMessage}`);
    }
    if (!result.world) {
      throw new FatalError("operation completed with no world in the response");
    }

    // Marble's signed URLs expire — copy before doing anything else.
    const assets = await mirrorAssets(worldId, result.world);
    await finalizeWorld(worldId, result.world, assets);

    return { worldId, marbleWorldId: result.world.world_id };
  } catch (err) {
    await failWorld(worldId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
