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
  /** Overrides the category default when the true height is known. */
  realHeightM?: number;
  /** Explicit upright correction, in degrees about X. Wins over detection. */
  rotationXDeg?: number;
}

const SEATING = new Set(["chair", "sofa", "stool", "seat", "bench", "lounge"]);

/** Words that mean the piece hangs rather than stands. */
const CEILING_HINTS = ["pendant", "chandelier", "ceiling"];

function haystack(entry: ManifestEntry): string {
  return `${entry.id} ${entry.name} ${(entry.tags ?? []).join(" ")}`.toLowerCase();
}

function mountFor(entry: ManifestEntry): "floor" | "ceiling" {
  return CEILING_HINTS.some((h) => haystack(entry).includes(h)) ? "ceiling" : "floor";
}

/**
 * Seating is wide at the seat and narrow at the backrest. If a model's top
 * footprint dwarfs its bottom, it was authored upside down — which is what
 * happened to the sled chair, whose thin backrest panel sat on the floor.
 *
 * Deliberately limited to seating: a bowl coffee table legitimately has a top
 * far wider than its base, and would be flipped by this test.
 */
function uprightCorrection(entry: ManifestEntry, profile: { bottomArea: number; topArea: number } | null): number {
  if (entry.rotationXDeg !== undefined) return (entry.rotationXDeg * Math.PI) / 180;
  if (!profile || profile.bottomArea <= 0) return 0;
  const isSeating = entry.tags?.some((t) => SEATING.has(t));
  if (!isSeating || mountFor(entry) === "ceiling") return 0;
  return profile.topArea / profile.bottomArea > 2 ? Math.PI : 0;
}

/**
 * Typical real-world heights, in metres. Needed because asset pipelines
 * normalise models to a unit bounding box — glTF-Transform did exactly that to
 * every model here, leaving a coffee table and a chair both 1m tall.
 */
const HEIGHT_BY_TAG: Record<string, number> = {
  table: 0.4,
  desk: 0.75,
  chair: 0.82,
  stool: 0.65,
  sofa: 0.8,
  bed: 0.6,
  lamp: 1.5,
  shelf: 1.8,
};

/** A model is "normalised" when its largest dimension sits suspiciously at 1. */
function looksNormalised(size: { x: number; y: number; z: number }): boolean {
  const largest = Math.max(size.x, size.y, size.z);
  return Math.abs(largest - 1) < 0.02;
}

function targetHeight(entry: ManifestEntry): number | undefined {
  if (entry.realHeightM !== undefined) return entry.realHeightM;
  // A pendant's own height is the fixture, not the drop from the ceiling —
  // the "lamp" default of 1.5m is a floor lamp and would be absurd hanging.
  if (mountFor(entry) === "ceiling") return 0.4;
  // Bar stools sit a good deal higher than the generic stool default.
  if (haystack(entry).includes("bar") && entry.tags?.includes("stool")) return 0.75;
  return entry.tags?.map((t) => HEIGHT_BY_TAG[t]).find((h) => h !== undefined);
}

function realScale(entry: ManifestEntry, size: { x: number; y: number; z: number }): number {
  const target = targetHeight(entry);
  if (!target || size.y <= 0) return 1;
  // Only correct models that were clearly normalised; leave true-scale ones be.
  if (!looksNormalised(size) && entry.realHeightM === undefined) return 1;
  return target / size.y;
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

    const scale = realScale(entry, bounds.size!);
    const rotationX = uprightCorrection(entry, bounds.profile);
    const mount = mountFor(entry);
    const sized = {
      x: +(bounds.size!.x * scale).toFixed(4),
      y: +(bounds.size!.y * scale).toFixed(4),
      z: +(bounds.size!.z * scale).toFixed(4),
    };

    const [asset] = await db
      .insert(schema.assets)
      .values({
        source: "catalog",
        name: entry.name,
        category: entry.tags?.[0] ?? "furniture",
        r2Key: key,
        bboxM: sized,
        scale,
        rotationX,
        mount,
      })
      .returning();

    added.push({
      name: asset.name,
      modelUnits: bounds.size,
      scale: +scale.toFixed(3),
      uprightFlip: rotationX !== 0,
      mount,
      profile: bounds.profile,
      bboxM: asset.bboxM,
      url: publicUrl(key),
    });
  }

  return NextResponse.json({ added, skipped });
}
