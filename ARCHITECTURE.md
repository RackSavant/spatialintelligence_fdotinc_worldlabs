# The Next.js app

Photo or video → Nano Banana edit → Marble world → walkable splat scene → furniture.

Next.js 16 App Router, Gaussian splats via [Spark 2.1](https://sparkjs.dev) +
Three.js, Marble generation run as a durable [Workflow](https://workflow-sdk.dev),
Drizzle over Postgres, R2 for blobs.

> This is separate from the standalone `viewer/` and `stiletto-viewer.html`
> pages, which are static and don't go through the app.

## Run it

```bash
npm install
cp .env.example .env.local     # WORLDLABS_API_KEY and GEMINI_API_KEY
pg_ctl -D /opt/homebrew/var/postgresql@16 start
createdb marble && npx drizzle-kit push
npm run dev                    # http://localhost:3000
```

| Route | What |
| --- | --- |
| `/` | Projects |
| `/projects/<id>` | Upload a photo or walkthrough video, run Nano Banana edits, generate a world |
| `/viewer` | `?world=<id>`, or `?splat=<url>&collider=<url>` |

Leave `R2_*` blank and uploads fall back to `public/uploads/` on disk. That path
routes bytes through a Next route, so it is **dev only** — production needs R2
or it hits Vercel's ~4.5MB body cap.

## Layout

| Path | What |
| --- | --- |
| `app/` | Routes and API handlers |
| `components/viewer/` | Spark scene, FPS controls, furniture drawer |
| `lib/world-frame.ts` | Marble asset space → metric, Y-up, ground-at-zero |
| `lib/marble/` | Typed Public API v1 client |
| `lib/gemini/` | Nano Banana image editing client |
| `lib/storage/` | R2, with a local-disk fallback for dev |
| `workflows/build-world.ts` | The durable generation workflow |

## Things that cost time

- **Splats are Y-down, in arbitrary units, ground at an arbitrary height.**
  `assets.splats.semantics_metadata` gives `metric_scale_factor` and
  `ground_plane_offset` to fix all three — no manual calibration needed.
  Confirmed on real output: 2.07, 1.98 and 1.94 across three worlds, i.e.
  genuinely inferred, not the `1.0` "could not infer" fallback.
- **The transform order is scale → ground offset → flip, and one `Object3D`
  cannot express it**, because its local matrix is always `T * R * S`. Hence the
  nested groups in `lib/world-frame.ts`. Place furniture in `worldGroup`, in
  metres, ground at `y=0`.
- **Don't frame the bounding box on a Marble world.** It's the panoramic dome —
  24m across with a floor at `y=-15.7` on a real world, mostly far-field and
  sky. Framing it puts the camera outside the room. Stand at the origin at eye
  height instead.
- **`metadata.progress` is an object** (`{status, description}`), not a number.
  Rounding it produced `NaN`, which failed an integer write, which killed the
  step — stranding a generation Marble had already billed for.
- **Marble operations and their asset URLs expire** (`expires_at`). Mirror
  assets into our own storage as the first thing after a generation completes.
- **`worlds.idempotency_key` is unique on purpose.** Step memoization stops a
  retry re-billing; the constraint also stops a double-click or a second tab.
  And `buildWorld` skips generation whenever `operation_id` is already set, so
  a bug in a late step can never re-bill an early one. `POST
  /api/worlds/<id>/resume` recovers a failed world for free.
- **402 is fatal, deliberately.** Out of credits is not fixed by retrying.
  429 and 5xx are retryable.
- **The API returns `.spz` only.** `.ply` and `.rad` are Marble web-app exports.
- **Spark needs `ssr: false`.** WebGL2, a Web Worker for splat sorting and WASM
  for ray-splat intersection — none exist during a server render.
- **`renderer.setSize(w, h, false)` skips CSS sizing**, so the canvas lays out
  at buffer size and you view a zoomed crop. Let three.js set both.
- **`antialias: false` is deliberate.** MSAA does nothing for splats and costs
  a lot. Spark's own docs call this out.
- **A backgrounded or occluded tab renders black.** `requestAnimationFrame`
  doesn't fire, so Spark never completes its first sort readback and issues
  zero draw calls. `document.visibilityState` tells you. Not a Spark bug.

## Navigation

Pointer-lock FPS, not orbit. Yaw and pitch are tracked separately so the camera
never rolls, and movement derives from yaw alone so looking up doesn't walk you
into the ceiling. Speeds are metres per second (2.6 walk, 6.5 sprint), which is
only meaningful because worlds are metric. The collider mesh doubles as a floor
probe — raycast down each frame, hold eye height, smoothed.

Click to capture the mouse · WASD to move · shift to sprint · click to place ·
esc to release.

## Furniture

Raycast the collider (`assets.mesh.collider_mesh_url`), not the splats.
`SplatMesh.raycast()` works and is the fallback when no collider exists, but it
hits a fuzzy visual surface with noisy normals, so objects jitter and tilt.

Spark merges splats with opaque Three.js geometry through the Z buffer in a
single instanced draw call, so GLB furniture occludes correctly with no custom
depth pass. Keep furniture materials opaque — transparent mesh interop is
undocumented.

The drawer unpacks `.zip` packs in the browser with fflate and measures each
model with a `Box3` before upload, so catalog bounding boxes are real metres and
the server never parses glTF. **Only `.glb` is ingested** — a `.gltf` references
external `.bin` and texture files that would not survive being uploaded alone.
