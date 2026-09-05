"use client";

import dynamic from "next/dynamic";

/**
 * ssr:false is mandatory, not an optimisation. Spark needs WebGL2, spawns a
 * Web Worker for splat sorting and loads WASM for ray-splat intersection —
 * none of which exist during a server render.
 */
export const SplatViewer = dynamic(() => import("./SplatScene"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-black font-mono text-sm text-white">
      booting renderer…
    </div>
  ),
});
