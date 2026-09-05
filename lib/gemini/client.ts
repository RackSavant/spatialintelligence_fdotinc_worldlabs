/**
 * Nano Banana (Gemini image) client, against the Interactions API.
 *
 * The response shape here is the one thing in this codebase most likely to
 * drift: the docs themselves tell you to read `output_image` defensively. So
 * we check the documented path first and fall back to walking the response for
 * any image block, which also covers the older generateContent shape
 * (candidates[].content.parts[].inlineData).
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Pro is the higher-fidelity edit model; flash is cheaper and faster. */
export type NanoBananaModel = "gemini-3-pro-image" | "gemini-3.1-flash-image";

export const DEFAULT_MODEL: NanoBananaModel = "gemini-3-pro-image";

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryable: boolean,
    readonly retryAfter?: string,
  ) {
    super(`Gemini ${status}${retryable ? " (retryable)" : ""}: ${body.slice(0, 500)}`);
    this.name = "GeminiError";
  }
}

export interface EditImageInput {
  apiKey: string;
  prompt: string;
  image: { bytes: Uint8Array; mimeType: string };
  model?: NanoBananaModel;
}

export interface EditImageResult {
  bytes: Uint8Array;
  mimeType: string;
}

interface ImageBlock {
  data: string;
  mimeType: string;
}

function asImageBlock(node: unknown): ImageBlock | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const mime = (obj.mime_type ?? obj.mimeType) as unknown;
  const data = obj.data as unknown;
  if (typeof data === "string" && data.length > 0 && typeof mime === "string" && mime.startsWith("image/")) {
    return { data, mimeType: mime };
  }
  return null;
}

function findImage(node: unknown, seen = new Set<object>()): ImageBlock | null {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node as object)) return null;
  seen.add(node as object);

  const direct = asImageBlock(node);
  if (direct) return direct;

  const values = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  for (const value of values) {
    const found = findImage(value, seen);
    if (found) return found;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export async function editImage({
  apiKey,
  prompt,
  image,
  model = DEFAULT_MODEL,
}: EditImageInput): Promise<EditImageResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        { type: "image", mime_type: image.mimeType, data: toBase64(image.bytes) },
      ],
    }),
  });

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new GeminiError(
      res.status,
      await res.text(),
      retryable,
      res.headers.get("retry-after") ?? undefined,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  const block = asImageBlock(json.output_image) ?? asImageBlock(json.outputImage) ?? findImage(json);

  if (!block) {
    // A 200 with no image is usually a safety block or a text-only reply.
    throw new GeminiError(200, `no image in response: ${JSON.stringify(json).slice(0, 800)}`, false);
  }

  return { bytes: new Uint8Array(Buffer.from(block.data, "base64")), mimeType: block.mimeType };
}
