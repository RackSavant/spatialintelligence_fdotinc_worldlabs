import { z } from "zod";

/**
 * Only DATABASE_URL is required to boot. Everything else is validated at the
 * point of use, so a partially-configured dev machine runs the parts it can
 * instead of failing at import time with an unrelated error.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WORLDLABS_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid environment:\n${issues.join("\n")}\n\nCopy .env.example to .env.local and fill it in.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Blank-but-present is the normal state of a fresh .env.local, so treat "" as unset. */
export function requireKey(name: "GEMINI_API_KEY" | "WORLDLABS_API_KEY"): string {
  const value = env()[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local before using this route.`);
  }
  return value;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

/** null when R2 isn't configured — storage falls back to local disk in dev. */
export function r2Config(): R2Config | null {
  const e = env();
  if (
    !e.R2_ACCOUNT_ID ||
    !e.R2_ACCESS_KEY_ID ||
    !e.R2_SECRET_ACCESS_KEY ||
    !e.R2_BUCKET ||
    !e.R2_PUBLIC_BASE_URL
  ) {
    return null;
  }
  return {
    accountId: e.R2_ACCOUNT_ID,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET,
    publicBaseUrl: e.R2_PUBLIC_BASE_URL.replace(/\/$/, ""),
  };
}
