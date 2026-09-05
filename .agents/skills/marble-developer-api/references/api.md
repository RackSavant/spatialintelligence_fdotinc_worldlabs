# World Labs API v1 Reference

This reference summarizes the World Labs / Marble Public API v1. Use
`openapi.yaml` for exact schema names, required fields, and client generation.

## Base URL and Auth

Base URL:

```text
https://api.worldlabs.ai
```

All public API paths are under `/marble/v1`.

Authenticate with the API-key header:

```http
WLT-Api-Key: YOUR_API_KEY
```

Do not use `Authorization: Bearer ...`.

## Endpoint Map

| Purpose | Method and path |
| --- | --- |
| Generate a world | `POST /marble/v1/worlds:generate` |
| Poll an operation | `GET /marble/v1/operations/{operation_id}` |
| Get a world | `GET /marble/v1/worlds/{world_id}` |
| List worlds | `POST /marble/v1/worlds:list` |
| Delete a world | `DELETE /marble/v1/worlds/{world_id}` |
| Prepare media upload | `POST /marble/v1/media-assets:prepare_upload` |
| Get media asset metadata | `GET /marble/v1/media-assets/{media_asset_id}` |
| Convert depth pano to RGB | `POST /marble/v1/pano:depth_to_rgb` |
| Get remaining credits | `GET /marble/v1/credits` |

## Models

Use explicit model names:

| Marble model | API `model` |
| --- | --- |
| Marble 1.1 Plus | `marble-1.1-plus` |
| Marble 1.1 | `marble-1.1` |
| Marble 1.0 | `marble-1.0` |
| Marble 1.0 Draft | `marble-1.0-draft` |

## World Generation Flow

1. Call `POST /marble/v1/worlds:generate`.
2. Save the returned `operation_id`.
3. Poll `GET /marble/v1/operations/{operation_id}` until `done` is `true`.
4. Read `response.world_id` and output assets from the completed operation.
5. If the caller needs the latest world object, call
   `GET /marble/v1/worlds/{world_id}`.

Minimal text prompt:

```json
{
  "display_name": "Mystical Forest",
  "model": "marble-1.1",
  "world_prompt": {
    "type": "text",
    "text_prompt": "A mystical forest with glowing mushrooms"
  }
}
```

The completed operation response contains a world snapshot. Useful asset fields
include:

- `assets.splats.spz_urls`: Gaussian splat files in SPZ format.
- `assets.mesh.collider_mesh_url`: Collider mesh in GLB format.
- `assets.imagery.pano_url`: Panorama image.
- `assets.thumbnail_url`: Thumbnail image.
- `assets.caption`: AI-generated world description.

## Media Asset Upload Flow

Use this flow for local image or video files:

1. Call `POST /marble/v1/media-assets:prepare_upload` with `file_name`,
   `extension`, and `kind`.
2. Upload the file with `PUT` to the returned signed `upload_url`, using the
   returned `required_headers`.
3. Use the returned media asset id in `world_prompt`.

Image prompt using a media asset:

```json
{
  "model": "marble-1.1",
  "world_prompt": {
    "type": "image",
    "image_prompt": {
      "source": "media_asset",
      "media_asset_id": "550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

For panorama images, set `is_pano: true` in `image_prompt`.

## Prompt Inputs

World generation supports:

- Text prompts.
- Image prompts from inline content, URL content, or uploaded media assets.
- Multi-image prompts.
- Video prompts from inline content, URL content, or uploaded media assets.

Use `openapi.yaml` to verify the exact schema for the prompt variant before
writing generated client code.

## Operation Handling

Operation responses include:

- `operation_id`
- `done`
- `error`
- `metadata`
- `response`
- `created_at`
- `updated_at`
- `expires_at`

If `done` is `false`, continue polling. If `done` is `true` and `error` is set,
surface the error. If `done` is `true` and `response` is set, parse the result
according to the operation type.

## Credits

Call `GET /marble/v1/credits` to check the authenticated API user's remaining
credit balance.

Requests that cannot start because the account is out of credits return
`402 Payment Required`. Surface the response body to the user; it links to the
World Labs Platform billing page for adding credits or enabling auto-refill.

## API Key Safety

Never include real API keys in prompts, commits, logs, screenshots, generated
tests, or docs examples. Use `YOUR_API_KEY` or environment variables in examples.
