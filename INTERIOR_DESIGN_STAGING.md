# Interior Design Staging — Software Engineer Spec

## 1. Product idea

A user walks into a room and records a short video with their phone or Mentra glasses. The app sends the video to World Labs and generates a navigable 3D world of the room. The user then picks a design style and drags 3D furniture/decor assets (Tripo/Mint) into the generated world to stage it.

## 2. User flow

```mermaid
flowchart LR
    A[Record room video] --> B[Upload / compress video]
    B --> C[World Labs video-to-world]
    C --> D[Generated 3D room]
    D --> E[Choose style preset]
    E --> F[Drag/drop staging assets]
    F --> G[Save/share staged world]
```

## 3. Tech stack

| Layer | Tool |
|---|---|
| Capture | Phone camera / Mentra glasses video |
| Video-to-world | World Labs `worlds:generate` with `video_prompt` |
| 3D viewer | Marble URL or SparkJS/Three.js custom viewer |
| Staging assets | Tripo text-to-3D or Mint 3D asset generation |
| Asset catalog | Convex `assets` table |
| Saved designs | Convex `rooms` / `stagings` tables |
| Frontend | Vite + React + Convex |

## 4. World Labs video input

```http
POST https://api.worldlabs.ai/marble/v1/worlds:generate
Content-Type: application/json
WLT-Api-Key: {WLT_API_KEY}
```

```json
{
  "display_name": "Interior Staging",
  "model": "marble-1.1",
  "world_prompt": {
    "type": "video",
    "video_prompt": {
      "source": "data_base64",
      "data_base64": "<short-mp4-base64>",
      "extension": "mp4"
    },
    "text_prompt": "A bright, modern living room with natural lighting, clean layout, neutral walls, and open floor space for furniture placement"
  }
}
```

- Recommended formats: `mp4`, `mov`, `mkv`.
- `data_base64` is limited to 10MB; for longer videos upload to Convex/Cloudflare and use `source: "uri"` or `media_asset`.
- Poll `/operations/{id}` until `done`.

## 5. Prompts for 20 interior staging Tripo assets

| Asset | Tripo prompt |
|---|---|
| 1 | A modern beige linen 3-seat sofa, minimalist style, soft shadows |
| 2 | A round walnut coffee table, Scandinavian design |
| 3 | A contemporary floor lamp with a black metal stand and white shade |
| 4 | A large monochrome abstract wall art in a thin black frame |
| 5 | A mid-century modern armchair with teal fabric upholstery |
| 6 | A rectangular oak dining table with clean lines |
| 7 | A set of four upholstered dining chairs in grey fabric |
| 8 | A tall fiddle-leaf fig plant in a white ceramic planter |
| 9 | A plush neutral area rug with subtle geometric pattern |
| 10 | A minimalist wooden bookshelf with open shelves |
| 11 | A low-profile media console with oak doors |
| 12 | A king-size bed with a light grey upholstered headboard |
| 13 | A pair of matching white nightstands with brass handles |
| 14 | A round wall mirror with a thin gold frame |
| 15 | A set of decorative throw pillows in earth tones |
| 16 | A modern pendant light with a frosted glass globe |
| 17 | A velvet ottoman in mustard yellow |
| 18 | A wooden console table with tapered legs |
| 19 | A ceramic vase with dried pampas grass arrangement |
| 20 | A sheer linen curtain panel in off-white |

## 6. Convex schema additions

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    title: v.string(),
    videoStorageId: v.optional(v.id("_storage")),
    prompt: v.string(),
    status: v.string(),
    thumbnailUrl: v.optional(v.string()),
    worldMarbleUrl: v.optional(v.string()),
    worldId: v.optional(v.string()),
    style: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  stagings: defineTable({
    roomId: v.id("rooms"),
    assetId: v.id("assets"),
    position: v.object({ x: v.number(), y: v.number() }),
    scale: v.optional(v.number()),
    rotation: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  assets: defineTable({
    name: v.string(),
    prompt: v.string(),
    tags: v.array(v.string()),
    url: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_tag", ["tags"]),
});
```

## 7. 4-hour MVP scope

1. User records a short room video (file upload).
2. App compresses and sends to World Labs as `data_base64` (or uploads to Convex storage and uses URL).
3. App polls and shows the generated room thumbnail.
4. App shows the 20 Tripo asset thumbnails.
5. User can click an asset to add it to a simple 2D overlay on the room thumbnail.
6. Save the staging to Convex.

## 8. Hard prompt for interior staging

```
A bright, photorealistic 3D interior of a modern living space based on this video. 
Clean, open layout with neutral walls, large windows, natural daylight, soft shadows, 
polished floors, and minimal existing furniture. Designed for interior design staging 
with empty areas ready for furniture placement. High-end residential aesthetic, 4K architectural visualization.
```

## 9. Open questions

1. Is the input a **phone video file** or a **live Mentra glasses stream**?
2. Do we want **one-click style presets** (modern, Scandinavian, bohemian, minimalist)?
3. Is staging 2D overlay (Phase 1) or true 3D placement inside the generated world (Phase 2)?
4. Do we pre-generate the 20 Tripo assets before the demo?
