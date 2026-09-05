"use client";

import type { FurnitureAsset } from "./FurnitureDrawer";

/**
 * Always-visible slots so furniture can be switched mid-walk with the number
 * keys, without opening the drawer and losing the scene.
 */
export function Hotbar({
  assets,
  selectedId,
  onSelect,
}: {
  assets: FurnitureAsset[];
  selectedId: string | null;
  onSelect: (asset: FurnitureAsset | null) => void;
}) {
  if (assets.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center">
      <div className="pointer-events-auto flex gap-1 rounded-lg border border-white/15 bg-neutral-950/85 p-1 backdrop-blur">
        {assets.slice(0, 9).map((asset, index) => {
          const active = asset.id === selectedId;
          return (
            <button
              key={asset.id}
              onClick={() => onSelect(active ? null : asset)}
              title={asset.name}
              className={`relative w-24 rounded px-2 py-1.5 text-left transition-colors ${
                active ? "bg-green-400/20 ring-1 ring-green-400" : "hover:bg-white/10"
              }`}
            >
              <span className="absolute right-1 top-0.5 font-mono text-[10px] text-white/40">
                {index + 1}
              </span>
              <p className="truncate pr-3 text-[11px] leading-tight text-white">{asset.name}</p>
              <p className="font-mono text-[9px] text-white/40">
                {asset.bboxM ? `${asset.bboxM.x.toFixed(2)}×${asset.bboxM.z.toFixed(2)}m` : "—"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
