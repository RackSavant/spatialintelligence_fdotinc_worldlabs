import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publicUrl } from "@/lib/storage";
import { SplatViewer } from "@/components/viewer";
import type { WorldSemantics } from "@/lib/world-frame";

const SAMPLE_SPLAT = "https://sparkjs.dev/assets/splats/butterfly.spz";

/** Prefer a higher-detail variant when Marble returned several. */
function pickVariant(spzKeys: Record<string, string>): string | null {
  const keys = Object.keys(spzKeys);
  if (keys.length === 0) return null;
  return spzKeys[keys.find((k) => /high|full|original/i.test(k)) ?? keys[0]];
}

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const worldId = typeof params.world === "string" ? params.world : null;

  let spzUrl = typeof params.splat === "string" ? params.splat : SAMPLE_SPLAT;
  let colliderUrl = typeof params.collider === "string" ? params.collider : undefined;
  let panoUrl = typeof params.pano === "string" ? params.pano : undefined;
  let semantics: WorldSemantics | undefined;

  if (worldId) {
    const [world] = await db
      .select()
      .from(schema.worlds)
      .where(eq(schema.worlds.id, worldId))
      .limit(1);

    if (world) {
      const key = pickVariant(world.spzKeys ?? {});
      if (key) spzUrl = publicUrl(key);
      if (world.colliderKey) colliderUrl = publicUrl(world.colliderKey);
      if (world.panoKey) panoUrl = publicUrl(world.panoKey);
      semantics = {
        metricScaleFactor: world.metricScaleFactor,
        groundPlaneOffset: world.groundPlaneOffset,
      };
    }
  }

  return (
    <main className="h-dvh w-full">
      <SplatViewer
        spzUrl={spzUrl}
        colliderUrl={colliderUrl}
        panoUrl={panoUrl}
        semantics={semantics}
      />
    </main>
  );
}
