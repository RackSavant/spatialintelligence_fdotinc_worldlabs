/**
 * Types mirrored from the Marble Public API v1 OpenAPI spec.
 * Source of truth: .agents/skills/marble-developer-api/references/openapi.yaml
 */

export type MarbleModel =
  | "marble-1.1-plus"
  | "marble-1.1"
  | "marble-1.0"
  | "marble-1.0-draft";

/**
 * How to read the splat asset in real-world units:
 *   metric_xyz  = raw_xyz * metric_scale_factor
 *   aligned_xyz = metric_xyz - (0, ground_plane_offset, 0)
 * metric_scale_factor === 1.0 means scale could NOT be inferred.
 */
export interface WorldSemanticsMetadata {
  metric_scale_factor: number | null;
  ground_plane_offset: number | null;
}

export interface SplatAssets {
  /** variant name -> signed URL. SPZ is the only splat format the API returns. */
  spz_urls: Record<string, string> | null;
  semantics_metadata: WorldSemanticsMetadata | null;
}

export interface MeshAssets {
  /** GLB. Raycast target for furniture placement. */
  collider_mesh_url: string | null;
}

export interface ImageryAssets {
  pano_url: string | null;
}

export interface WorldAssets {
  caption: string | null;
  imagery: ImageryAssets | null;
  mesh: MeshAssets | null;
  splats: SplatAssets | null;
  thumbnail_url: string | null;
}

export interface World {
  world_id: string;
  display_name: string;
  world_marble_url: string;
  assets?: WorldAssets | null;
  tags?: string[] | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface OperationError {
  code?: number | string;
  message?: string;
  details?: unknown;
}

export interface Operation<T> {
  operation_id: string;
  done: boolean;
  error?: OperationError | null;
  metadata?: { progress?: number; progress_percent?: number } & Record<string, unknown>;
  response?: T | null;
  cost?: { line_items?: unknown } & Record<string, unknown>;
  created_at?: string;
  updated_at?: string | null;
  /** Operations and their signed asset URLs expire. Mirror assets promptly. */
  expires_at?: string | null;
}

export type MediaAssetKind = "image" | "video";

export interface MediaAsset {
  media_asset_id: string;
  file_name: string;
  kind: MediaAssetKind;
  extension?: string | null;
  created_at: string;
}

export interface UploadUrlInfo {
  upload_url: string;
  upload_method: string;
  required_headers?: Record<string, string> | null;
  curl_example?: string | null;
}

export interface MediaAssetPrepareUploadResponse {
  media_asset: MediaAsset;
  upload_info: UploadUrlInfo;
}

export type WorldPrompt =
  | { type: "text"; text_prompt: string; disable_recaption?: boolean }
  | {
      type: "image";
      image_prompt: { source: "media_asset"; media_asset_id: string; is_pano?: boolean };
      text_prompt?: string;
    }
  | {
      type: "multi-image";
      multi_image_prompt: Array<{ source: "media_asset"; media_asset_id: string }>;
      text_prompt?: string;
    };

export interface GenerateWorldRequest {
  display_name?: string;
  model: MarbleModel;
  world_prompt: WorldPrompt;
}
