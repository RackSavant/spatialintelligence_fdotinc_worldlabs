# Floor Plan Reimagine — Software Engineer Spec

## 1. What we are building

A simple web app that lets a user upload an image of a 2D floor plan and instantly "reimagine" it as a 3D world using World Labs.

**User flow:**

1. Tap the upload button.
2. Select or take a photo of a floor plan.
3. The app sends the image to World Labs.
4. World Labs generates a 3D world from the floor plan.
5. The app shows the generated world thumbnail and a link to view it in Marble.

That is the entire MVP. Inventory, drag-and-drop, and 3D asset placement are Phase 2.

## 2. System flow

```mermaid
flowchart LR
    A[User uploads floor plan] --> B[Miniapp UI compresses image]
    B --> C[POST /marble/v1/worlds:generate]
    C --> D[Poll /marble/v1/operations/{id}]
    D --> E[World generated]
    E --> F[Display thumbnail]
    F --> G[User opens Marble viewer]
```

## 3. API details

### Generate world

```http
POST https://api.worldlabs.ai/marble/v1/worlds:generate
Content-Type: application/json
WLT-Api-Key: {WLT_API_KEY}
```

```json
{
  "display_name": "Floor Plan Reimagine",
  "model": "marble-1.1",
  "world_prompt": {
    "type": "image",
    "image_prompt": {
      "source": "data_base64",
      "data_base64": "<base64-jpg>",
      "extension": "jpg"
    },
    "text_prompt": "A realistic 3D interior based on this floor plan"
  }
}
```

### Poll status

```http
GET https://api.worldlabs.ai/marble/v1/operations/{operation_id}
WLT-Api-Key: {WLT_API_KEY}
```

When `done: true`, use:

- `response.assets.thumbnail_url` for the 2D preview
- `response.world_marble_url` for the full 3D viewer

## 4. File structure

```
floorplan-reimagine/
├── .env
├── .gitignore
├── index.html
├── package.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── worldlabs.ts
│   └── config.ts
└── README.md
```

## 5. UI states

```
[ Upload ] -> [ Uploading ] -> [ Generating ] -> [ View World ]
```

### Wireframe

```
+------------------------+
|  Floor Plan Reimagine  |
+------------------------+
|  [Upload floor plan]   |
|        image           |
+------------------------+
|  Generating world...   |   <- loading
|  Progress: 42%         |
+------------------------+
|  [World thumbnail]     |   <- result
|                        |
|  [Open in Marble]      |
+------------------------+
```

## 6. Environment variables

```bash
# .env
VITE_WLT_API_KEY=your_world_labs_key
```

`.gitignore` must include `.env`.

## 7. 4-hour build checklist

- [ ] `bunx create-vite@latest floorplan-reimagine --template react-ts`
- [ ] Add `.env` with `VITE_WLT_API_KEY`
- [ ] Add `src/config.ts` with `WLT_API_KEY` and `WORLD_LABS_BASE`
- [ ] Create `src/worldlabs.ts` helper for generate + poll
- [ ] Create `src/App.tsx` with file input + image compression
- [ ] Test with one floor plan photo and save the `thumbnail_url`
- [ ] Hardcode the saved `thumbnail_url` as a demo fallback

## 8. Phase 2 (not this build)

1. Store floor plans and results in Convex.
2. Add inventory items as draggable elements onto the world.
3. Use Tripo/Mint to generate 3D assets for specific items.
4. Allow multiple reimaginations from one floor plan.

## 9. Open questions

1. Is the input a **physical hand-drawn floor plan**, a **digital image**, or a **photo of a room**?
2. Which World Labs model? `marble-1.1` (standard) or `marble-1.1-plus` (larger, more credits)?
3. Do we save generated world URLs for later, or is this a one-shot app?
