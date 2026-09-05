# Marble Hack

Gaussian-splat scene running on [Spark 2.1](https://sparkjs.dev) + Three.js, plus a
script for generating Marble worlds through the World API.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Renders a sample splat out of the box. To view your own:

```
http://localhost:5173/?splat=/worlds/my-world.spz
```

## Generate a world from the API

```bash
cp .env.example .env          # paste your key from platform.worldlabs.ai/api-keys
set -a && . ./.env && set +a
npm run world -- "a mystical forest with glowing mushrooms"
```

Generates, polls until done, and downloads every `.spz` variant into `public/worlds/`
along with the full world JSON. Add `--model marble-1.1-plus` for larger outdoor
scenes (costs more credits).

The API is **not free** — you need a payment method and purchased credits on the
account before any request works, or you get a 402.

## Layout

| Path | What |
| --- | --- |
| `src/main.js` | Spark scene: renderer, splat mesh, FPS/pointer controls |
| `scripts/generate-world.mjs` | Text prompt → generated world → downloaded `.spz` |
| `public/worlds/` | Splat files (gitignored) |

In dev, `scene`, `camera`, `renderer`, `spark`, `world`, and `controls` are on
`window` for console poking.

## Things that cost time

- **Splats are Y-down.** `world.quaternion.set(1, 0, 0, 0)` flips the world upright.
  Skip it and everything is upside down.
- **`antialias: false` is deliberate.** MSAA does nothing for splats and is a large
  performance hit. Spark's own docs call this out.
- **A backgrounded tab renders black.** `requestAnimationFrame` doesn't fire in a
  hidden tab, so the canvas stays at whatever was last drawn. Don't debug a black
  screen from a tab that isn't focused — it is not a Spark bug.
- **`.spz` for the web**, `.ply` only for tooling (3-5x larger), `.rad` for streaming
  world-scale scenes above ~1M splats.

## Adding physics

Not wired up yet. When you have a collider mesh, add Rapier:

```bash
npm install @dimforge/rapier3d-compat
```

Build colliders at <https://splat-collider-builder.netlify.app/> (draw volumes over
a `.spz`, export `.glb`). Reference integration: <https://github.com/bmild/spark-physics>.

## Reference

- Marble: <https://marble.worldlabs.ai> — coupon `WORLD-MODEL-HACK` to download splats
- API docs: <https://docs.worldlabs.ai/api> · Spark docs: <https://sparkjs.dev/2.0.0-preview>
- Spark examples: <https://sparkjs.dev/examples>

The `marble-developer-api` agent skill is installed in `.agents/skills/` — ask Claude
to "use the marble-developer-api skill" for API work.
