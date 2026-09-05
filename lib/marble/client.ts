import type {
  GenerateWorldRequest,
  MediaAssetKind,
  MediaAssetPrepareUploadResponse,
  Operation,
  World,
} from "./types";

const BASE = "https://api.worldlabs.ai/marble/v1";

/**
 * Carries the retry decision with the error so callers (workflow steps, the CLI)
 * map to FatalError / RetryableError without re-deriving it from a status code.
 *
 * 402 is deliberately FATAL: the account is out of credits, and retrying just
 * burns the retry budget and hides the real problem from the user.
 */
export class MarbleError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryable: boolean,
    /** Seconds, parsed from the Retry-After header. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`Marble ${status}${retryable ? " (retryable)" : ""}: ${body.slice(0, 500)}`);
    this.name = "MarbleError";
  }
}

/** Retry-After is either delta-seconds or an HTTP date; normalise to seconds. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - Date.now()) / 1000);
}

function classify(status: number, retryAfterHeader: string | null) {
  if (status === 429) {
    return { retryable: true, retryAfterSeconds: parseRetryAfter(retryAfterHeader) ?? 60 };
  }
  if (status >= 500) return { retryable: true, retryAfterSeconds: undefined };
  return { retryable: false, retryAfterSeconds: undefined };
}

async function call<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "WLT-Api-Key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const { retryable, retryAfterSeconds } = classify(res.status, res.headers.get("retry-after"));
    throw new MarbleError(res.status, await res.text(), retryable, retryAfterSeconds);
  }
  return res.json() as Promise<T>;
}

export function marble(apiKey: string) {
  return {
    generateWorld: (req: GenerateWorldRequest) =>
      call<Operation<World>>(apiKey, "/worlds:generate", {
        method: "POST",
        body: JSON.stringify(req),
      }),

    getOperation: (operationId: string) =>
      call<Operation<World>>(apiKey, `/operations/${operationId}`),

    getWorld: (worldId: string) => call<World>(apiKey, `/worlds/${worldId}`),

    deleteWorld: (worldId: string) =>
      call<unknown>(apiKey, `/worlds/${worldId}`, { method: "DELETE" }),

    getCredits: () => call<Record<string, unknown>>(apiKey, "/credits"),

    prepareUpload: (fileName: string, kind: MediaAssetKind, extension?: string) =>
      call<MediaAssetPrepareUploadResponse>(apiKey, "/media-assets:prepare_upload", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName.slice(0, 64), kind, extension }),
      }),

    /** prepare_upload -> PUT bytes to the signed URL -> return the media_asset_id. */
    async uploadMedia(
      bytes: ArrayBuffer | Uint8Array,
      fileName: string,
      kind: MediaAssetKind,
      contentType: string,
    ): Promise<string> {
      const extension = fileName.split(".").pop()?.toLowerCase();
      const prepared = await this.prepareUpload(fileName, kind, extension);
      const { upload_url, upload_method, required_headers } = prepared.upload_info;

      const res = await fetch(upload_url, {
        method: upload_method || "PUT",
        headers: { "Content-Type": contentType, ...(required_headers ?? {}) },
        body: bytes as BodyInit,
      });
      if (!res.ok) {
        const { retryable, retryAfterSeconds } = classify(res.status, res.headers.get("retry-after"));
        throw new MarbleError(res.status, await res.text(), retryable, retryAfterSeconds);
      }
      return prepared.media_asset.media_asset_id;
    },
  };
}

export type MarbleClient = ReturnType<typeof marble>;
