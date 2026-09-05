import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { readGlbBounds } from "@/lib/gltf-bounds";
import { publicUrl, putBytes } from "@/lib/storage";

interface ManifestEntry {
  id: string;
  name: string;
  path: string;
  tags?: string[];
}

/**
 * Load the models committed to the repo into the catalog.
 *
 * They live in assets/models/, outside public/, so they aren't servable as-is.
 * This copies them into storage and measures them from the glTF accessors, so
 * a repo model ends up indistinguishable from one dropped into the drawer.
 */
export async function POST() {
  const manifestPath = join(process.cwd(), "src", "data", "assets.json");
  let manifest: ManifestEntry[];
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return NextResponse.json({ error: "src/data/assets.json not found" }, { status: 404 });
  }

  const added: unknown[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const entry of manifest) {
    if (!entry.path?.toLowerCase().endsWith(".glb")) {
      skipped.push({ name: entry.name, reason: `not a .glb (${entry.path?.split(".").pop()})` });
      continue;
    }

    const existing = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(eq(schema.assets.name, entry.name))
      .limit(1);
    if (existing.length) {
      skipped.push({ name: entry.name, reason: "already in catalog" });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(join(process.cwd(), entry.path)));
    } catch {
      skipped.push({ name: entry.name, reason: "file missing" });
      continue;
    }

    let bounds;
    try {
      bounds = readGlbBounds(bytes);
    } catch (err) {
      skipped.push({ name: entry.name, reason: (err as Error).message });
      continue;
    }
    if (bounds.primitives === 0) {
      // The stiletto GLB is an empty FBX2glTF stub — real geometry is in the .fbx.
      skipped.push({ name: entry.name, reason: "no geometry in the GLB" });
      continue;
    }

    const key = `assets/${entry.id}.glb`;
    await putBytes(key, bytes, "model/gltf-binary");

    const [asset] = await db
      .insert(schema.assets)
      .values({
        source: "catalog",
        name: entry.name,
        category: entry.tags?.[0] ?? "furniture",
        r2Key: key,
        bboxM: bounds.size,
      })
      .returning();

    added.push({ name: asset.name, category: asset.category, bboxM: asset.bboxM, url: publicUrl(key) });
  }

  return NextResponse.json({ added, skipped });
}
