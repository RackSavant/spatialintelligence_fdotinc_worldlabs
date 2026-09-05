import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensureDevUser } from "@/lib/dev-user";

export async function GET() {
  const userId = await ensureDevUser();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.createdAt));
  return NextResponse.json({ projects: rows });
}

export async function POST(request: Request) {
  const userId = await ensureDevUser();
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const [project] = await db
    .insert(schema.projects)
    .values({ userId, name: body.name?.trim() || "Untitled room" })
    .returning();
  return NextResponse.json({ project }, { status: 201 });
}
