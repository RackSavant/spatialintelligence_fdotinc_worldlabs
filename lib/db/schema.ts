import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const assetSource = pgEnum("asset_source", ["catalog", "generated"]);

export const mediaKind = pgEnum("media_kind", ["image", "video"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  createdAt: createdAt(),
});

export const projects = pgTable("projects", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Room captures: stills and walkthrough video both live here. */
export const photos = pgTable("photos", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  kind: mediaKind("kind").notNull().default("image"),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes"),
  createdAt: createdAt(),
});

/**
 * Nano Banana renders. parentEditId makes this a tree, not a linear history —
 * users branch and compare rather than destructively overwrite.
 */
export const edits = pgTable(
  "edits",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    photoId: uuid("photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
    parentEditId: uuid("parent_edit_id").references((): AnyPgColumn => edits.id, {
      onDelete: "set null",
    }),
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),
    r2Key: text("r2_key").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [index("edits_project_idx").on(t.projectId)],
);

export const worlds = pgTable(
  "worlds",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceEditId: uuid("source_edit_id").references(() => edits.id, { onDelete: "set null" }),
    /** Generate straight from an unedited photo when no edit is chosen. */
    sourcePhotoId: uuid("source_photo_id").references(() => photos.id, { onDelete: "set null" }),
    /** Text-to-world instead of image-to-world. Mutually exclusive with the above. */
    textPrompt: text("text_prompt"),

    marbleWorldId: text("marble_world_id"),
    operationId: text("operation_id"),
    model: text("model").notNull(),
    status: jobStatus("status").notNull().default("queued"),

    /**
     * hash(projectId, sourceEditId, model, promptVersion). The unique index is
     * the real double-charge guard — workflow replay protects against retries,
     * this protects against double-submits too.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    /** From assets.splats.semantics_metadata — no manual calibration needed. */
    metricScaleFactor: real("metric_scale_factor"),
    groundPlaneOffset: real("ground_plane_offset"),

    /** variant -> R2 key, mirrored from the expiring signed URLs. */
    spzKeys: jsonb("spz_keys").$type<Record<string, string>>(),
    colliderKey: text("collider_key"),
    panoKey: text("pano_key"),
    thumbKey: text("thumb_key"),
    caption: text("caption"),

    error: jsonb("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("worlds_idempotency_key_idx").on(t.idempotencyKey),
    index("worlds_project_idx").on(t.projectId),
  ],
);

export const assets = pgTable("assets", {
  id: id(),
  source: assetSource("source").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  r2Key: text("r2_key").notNull(),
  /** Real-world bounding box in metres, after `scale` is applied. */
  bboxM: jsonb("bbox_m").$type<{ x: number; y: number; z: number }>(),
  /**
   * Multiplier from model units to metres. Asset pipelines routinely normalise
   * models to a unit box, which makes a chair and a table the same size.
   */
  scale: real("scale").notNull().default(1),
  createdAt: createdAt(),
});

/** Stored in worldGroup-local space: metres, Y-up, ground plane at y=0. */
export const placements = pgTable(
  "placements",
  {
    id: id(),
    worldId: uuid("world_id").notNull().references(() => worlds.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    position: jsonb("position").$type<[number, number, number]>().notNull(),
    quaternion: jsonb("quaternion").$type<[number, number, number, number]>().notNull(),
    scale: real("scale").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("placements_world_idx").on(t.worldId)],
);

/** Mirror of workflow run state so the UI polls Postgres, not the engine. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    runId: text("run_id").notNull(),
    kind: text("kind").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    worldId: uuid("world_id").references(() => worlds.id, { onDelete: "cascade" }),
    progress: integer("progress"),
    /** Human-readable status from the provider, e.g. "IN_PROGRESS — ...". */
    detail: text("detail"),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_run_id_idx").on(t.runId), index("jobs_project_idx").on(t.projectId)],
);
