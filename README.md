# Marble Hack

Photo → Nano Banana edit → Marble world → furnished 3D scene.

Next.js (App Router) front end, Gaussian splats rendered with
[Spark 2.1](https://sparkjs.dev) + Three.js, Marble world generation run as a
durable [Workflow](https://workflow-sdk.dev).

## Run it

```bash
npm install
cp .env.example .env.local   # fill in before anything hits an external API
npm run dev                  # http://localhost:3000
```

Routes:

| Route | What |
| --- | --- |
| `/` | Projects |
| `/projects/<id>` | Upload a photo, run Nano Banana edits, branch the history |
| `/viewer` | Splat viewer — `?splat=<spz-url>&collider=<glb-url>` |

The viewer renders a sample splat out of the box, so it works before you have
generated anything.

### Local services

`npm run dev` expects Postgres on 5432. With Homebrew:

```bash
pg_ctl -D /opt/homebrew/var/postgresql@16 start
createdb marble
npx drizzle-kit push
```

Leave the `R2_*` vars blank and uploads fall back to `public/uploads/` on disk,
served at `/uploads`. That path routes bytes through a Next route, so it is
**dev only** — production needs R2 or it will hit Vercel's ~4.5MB body cap.

## Generate a world from the API

The standalone CLI still works for one-off generation without the app running:

```bash
set -a && . ./.env.local && set +a
npm run world -- "a mystical forest with glowing mushrooms"
```

Add `--model marble-1.1-plus` for larger outdoor scenes (costs more credits).
The API is **not free** — you need a payment method and purchased credits, or
every request 402s.

## Layout

| Path | What |
| --- | --- |
| `app/` | Next.js App Router pages |
| `components/viewer/` | Spark scene; `index.tsx` is the `ssr:false` wrapper |
| `lib/world-frame.ts` | Marble asset space → metric, Y-up, ground-at-zero |
| `lib/marble/` | Typed Public API v1 client |
| `lib/gemini/` | Nano Banana image editing client |
| `lib/storage/` | R2, with a local-disk fallback for dev |
| `lib/db/` | Drizzle schema + connection |
| `scripts/generate-world.mjs` | CLI: text prompt → world → downloaded `.spz` |

## Things that cost time

- **Splats are Y-down, in arbitrary units, with the ground at an arbitrary
  height.** `assets.splats.semantics_metadata` gives `metric_scale_factor` and
  `ground_plane_offset` to fix all three — no manual calibration needed. The
  order matters (scale, then ground offset, then flip) and a single `Object3D`
  can't express it, because its local matrix is always `T * R * S`. Hence the
  nested groups in `lib/world-frame.ts`. Place furniture in `worldGroup`, in
  metres, with the ground at `y=0`.
- **`metric_scale_factor` of `1.0` means scale could not be inferred**, not that
  the world is 1:1. The viewer warns when this happens.
- **`antialias: false` is deliberate.** MSAA does nothing for splats and is a
  large performance hit. Spark's own docs call this out.
- **A backgrounded or occluded tab renders black.** `requestAnimationFrame`
  doesn't fire, so Spark never completes its first sort readback and issues zero
  draw calls. Don't debug a black screen from a tab that isn't visible — it is
  not a Spark bug. `document.visibilityState` tells you.
- **`renderer.setSize(w, h, false)` skips CSS sizing**, so the canvas lays out at
  its buffer size and you view a zoomed crop. Let three.js set both.
- **Spark needs `ssr: false`.** It requires WebGL2, spawns a Web Worker for splat
  sorting and loads WASM for ray-splat intersection — none of which exist during
  a server render.
- **The API returns `.spz` only.** `.ply` and `.rad` are Marble web-app exports,
  not API assets.
- **Marble operations and their asset URLs expire** (`expires_at`). Mirror assets
  into our own storage as the first thing after a generation completes.

## World generation

`POST /api/worlds` inserts the row, then starts the `buildWorld` workflow.
Three things carry the weight:

- **`worlds.idempotency_key` is unique** — `hash(project, source, model, prompt
  version)`. Workflow step memoization stops a retry re-billing; the constraint
  also stops a double-click or a second tab. A duplicate submit returns the
  existing world with `deduplicated: true` and starts no run.
- **The poll loop sleeps** (10s early, then 30s, 90 attempts). `sleep()` in a
  workflow consumes no compute, so a 12-minute generation is ~40 cheap steps
  rather than one function fighting a timeout.
- **Mirroring runs first** once the operation completes, before anything else
  touches the result, because the signed URLs expire.

Error mapping: 402 is **fatal** (out of credits — retrying burns the budget and
hides the real problem), 429 and 5xx are retryable, everything else is fatal.

The UI polls `/api/worlds/<id>`, which reads the `jobs` table. Nothing in the
front end talks to the workflow engine, so swapping engines touches one file.

## Placing furniture

Raycast the collider mesh (`assets.mesh.collider_mesh_url`), not the splats.
`SplatMesh.raycast()` works and is the fallback when no collider exists, but it
hits a fuzzy visual surface and gives noisy normals, so objects jitter and tilt.

Spark merges splats with opaque Three.js geometry through the Z buffer in a
single instanced draw call, so GLB furniture occludes correctly with no custom
depth pass. Keep furniture materials opaque — transparent mesh interop is
undocumented.

## Reference

- Marble: <https://marble.worldlabs.ai> · API docs: <https://docs.worldlabs.ai/api>
- Spark docs: <https://sparkjs.dev> · examples: <https://sparkjs.dev/examples>

The `marble-developer-api` skill is installed in `.agents/skills/` — ask Claude
to "use the marble-developer-api skill" for API work.
