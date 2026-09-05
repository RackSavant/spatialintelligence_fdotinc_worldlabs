import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Placeholder identity until real auth lands. Everything is scoped to one
 * local user so project/photo/edit ownership is already modelled correctly
 * and swapping in a session lookup later is a one-line change.
 */
const DEV_EMAIL = "dev@localhost";

export async function ensureDevUser(): Promise<string> {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, DEV_EMAIL))
    .limit(1);
  if (existing.length) return existing[0].id;

  const [created] = await db
    .insert(schema.users)
    .values({ email: DEV_EMAIL })
    .returning({ id: schema.users.id });
  return created.id;
}
