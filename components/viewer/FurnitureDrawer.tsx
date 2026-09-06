"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { unzipSync } from "fflate";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface FurnitureAsset {
  id: string;
  name: string;
  category: string;
  url: string;
  bboxM: { x: number; y: number; z: number } | null;
  /** Model units -> metres. Normalised assets need this or everything is 1m. */
  scale: number;
  /** Radians about X to stand a mis-authored model upright. */
  rotationX: number;
  /** Standing on the floor, or hung from the ceiling. */
  mount: "floor" | "ceiling";
}

interface Props {
  assets: FurnitureAsset[];
  /** Re-fetch after an upload or seed; the list is owned by the scene. */
  onRefresh: () => Promise<void> | void;
  selectedId: string | null;
  onSelect: (asset: FurnitureAsset | null) => void;
  /** Drawer steals the mouse, so the viewer releases pointer lock while open. */
  onOpenChange?: (open: boolean) => void;
}

const MODEL_RE = /\.(glb)$/i;

/** Measure in the browser so bounding boxes are real metres, not guesses. */
async function measure(bytes: Uint8Array): Promise<{ x: number; y: number; z: number } | null> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "model/gltf-binary" }));
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    return { x: +size.x.toFixed(4), y: +size.y.toFixed(4), z: +size.z.toFixed(4) };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FurnitureDrawer({
  assets,
  onRefresh,
  selectedId,
  onSelect,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  async function ingestModel(name: string, bytes: Uint8Array, category: string) {
    const bboxM = await measure(bytes);
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, contentType: "model/gltf-binary", bboxM }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "could not register asset");
    const { upload } = await res.json();
    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: bytes as BodyInit,
    });
    if (!put.ok) throw new Error(`storage rejected ${name} (${put.status})`);
  }

  async function seedFromRepo() {
    setBusy("Loading bundled models…");
    setNote(null);
    try {
      const res = await fetch("/api/assets/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "seed failed");
      await refresh();
      const parts = [`${json.added.length} bundled model${json.added.length === 1 ? "" : "s"} loaded`];
      if (json.skipped?.length) parts.push(`${json.skipped.length} skipped`);
      setNote(parts.join(" · "));
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function ingest(files: File[]) {
    let added = 0;
    const skipped: string[] = [];
    setNote(null);

    try {
      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          setBusy(`Unpacking ${file.name}…`);
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
          for (const [path, bytes] of Object.entries(entries)) {
            // __MACOSX holds resource forks, not models.
            if (path.startsWith("__MACOSX") || path.endsWith("/")) continue;
            if (!MODEL_RE.test(path)) {
              if (/\.(gltf|obj|fbx|usdz)$/i.test(path)) skipped.push(path.split("/").pop()!);
              continue;
            }
            const name = path.split("/").pop()!.replace(MODEL_RE, "");
            setBusy(`Measuring ${name}…`);
            await ingestModel(name, bytes, file.name.replace(/\.zip$/i, ""));
            added++;
          }
        } else if (MODEL_RE.test(file.name)) {
          setBusy(`Measuring ${file.name}…`);
          await ingestModel(
            file.name.replace(MODEL_RE, ""),
            new Uint8Array(await file.arrayBuffer()),
            "uploaded",
          );
          added++;
        } else {
          skipped.push(file.name);
        }
      }

      await refresh();
      const parts = [`${added} model${added === 1 ? "" : "s"} added`];
      if (skipped.length) {
        // .glb is self-contained; .gltf packs reference external .bin/textures
        // that would not survive being uploaded on their own.
        parts.push(`${skipped.length} skipped (only .glb is supported)`);
      }
      setNote(parts.join(" · "));
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void ingest(Array.from(e.dataTransfer.files));
  }

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center">
      {open && (
        <div
          className="pointer-events-auto mb-2 w-[min(900px,94vw)] rounded-lg border border-white/15 bg-neutral-950/95 p-4 backdrop-blur"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-xs text-white/50">
              furniture · click a model, then click in the room to place it
            </p>
            <button
              onClick={() => setOpen(false)}
              className="font-mono text-xs text-white/50 hover:text-white"
            >
              close ▾
            </button>
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className={`mb-3 cursor-pointer rounded border border-dashed p-4 text-center font-mono text-xs transition-colors ${
              dragOver ? "border-green-400 bg-green-400/10 text-green-300" : "border-white/20 text-white/50"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".zip,.glb"
              className="hidden"
              onChange={(e) => e.target.files && ingest(Array.from(e.target.files))}
            />
            {busy ?? "drop a .zip of assets or .glb files here — or click to browse"}
          </div>

          {note && <p className="mb-3 font-mono text-xs text-amber-300">{note}</p>}

          {assets.length === 0 ? (
            <div className="py-6 text-center">
              <p className="mb-3 font-mono text-xs text-white/30">No furniture yet.</p>
              <button
                onClick={seedFromRepo}
                disabled={!!busy}
                className="rounded border border-white/25 px-3 py-1.5 font-mono text-xs text-white hover:border-white/50 disabled:opacity-40"
              >
                load models bundled with the repo
              </button>
            </div>
          ) : (
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
              {assets.map((a) => {
                const isSelected = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(isSelected ? null : a)}
                    className={`rounded border p-2 text-left transition-colors ${
                      isSelected
                        ? "border-green-400 bg-green-400/10"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <p className="truncate text-xs text-white">{a.name}</p>
                    <p className="font-mono text-[10px] text-white/40">
                      {a.bboxM
                        ? `${a.bboxM.x.toFixed(2)} × ${a.bboxM.y.toFixed(2)} × ${a.bboxM.z.toFixed(2)} m`
                        : "unmeasured"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto mb-3 rounded-full border border-white/20 bg-neutral-950/90 px-4 py-2 font-mono text-xs text-white backdrop-blur hover:border-white/40"
      >
        {selected ? `placing: ${selected.name} ▴` : `furniture (${assets.length}) ▴`}
      </button>
    </div>
  );
}
