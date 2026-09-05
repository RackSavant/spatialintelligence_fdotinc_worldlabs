import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

// Reuse across HMR reloads and warm serverless invocations.
const sql = globalThis.__sql ?? postgres(env().DATABASE_URL, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
