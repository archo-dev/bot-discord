/** Release-notes storage & read helpers (M5). Public reads are strictly limited
 * to published, in-window, audience='all' notes; the predicate lives here so the
 * API layer can never accidentally widen it. Raw SQL only (no ORM). */

/** Full row as stored. Internal columns are stripped before serialization. */
export interface ReleaseNoteRow {
  id: number;
  slug: string;
  version: string | null;
  title: string;
  summary: string | null;
  body_md: string | null;
  sections_json: string | null;
  module_tags_json: string | null;
  audience: string;
  status: string;
  publish_at: string | null;
  published_at: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** SQL fragment: a note is publicly visible. `?1` must be bound to the ISO `now`. */
const PUBLIC_PREDICATE =
  `status = 'published' AND published_at IS NOT NULL AND published_at <= ?1 AND audience = 'all'`;

// List rows stay lean: no body_md (potentially large). Detail selects it too.
const LIST_COLUMNS =
  `slug, version, title, summary, sections_json, module_tags_json, published_at`;
const DETAIL_COLUMNS = `${LIST_COLUMNS}, body_md`;

export interface ListPublishedOptions {
  now: string;
  /** 1-based page. */
  page: number;
  pageSize: number;
  /** Optional module-tag filter (already validated by the caller). */
  module?: string;
}

export interface PublishedListResult {
  rows: ReleaseNoteRow[];
  total: number;
}

/**
 * Published notes for the public list, newest first. When `module` is set, only
 * notes whose module_tags_json contains that exact tag are returned. Filtering on
 * a JSON array is done as a bounded LIKE on the serialized form (tags are short
 * slugs); the result is re-checked in JS by the caller when mapping tags.
 */
export async function listPublishedReleaseNotes(
  db: D1Database,
  opts: ListPublishedOptions,
): Promise<PublishedListResult> {
  const offset = (opts.page - 1) * opts.pageSize;
  // Match the tag as a quoted JSON string element to avoid substring collisions
  // (e.g. "mod" must not match "moderation"): tags are stored as JSON strings.
  const moduleParam = opts.module ? `%${JSON.stringify(opts.module)}%` : undefined;

  const listStmt = db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM release_notes
        WHERE ${PUBLIC_PREDICATE}${moduleParam ? ` AND module_tags_json LIKE ?4` : ``}
        ORDER BY published_at DESC, id DESC
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(...(moduleParam ? [opts.now, opts.pageSize, offset, moduleParam] : [opts.now, opts.pageSize, offset]));

  const countStmt = db
    .prepare(
      `SELECT COUNT(*) AS n FROM release_notes
        WHERE ${PUBLIC_PREDICATE}${moduleParam ? ` AND module_tags_json LIKE ?2` : ``}`,
    )
    .bind(...(moduleParam ? [opts.now, moduleParam] : [opts.now]));

  const results = await db.batch<ReleaseNoteRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as ReleaseNoteRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}

/** A single published note by slug, or null if not published/unknown (no leak). */
export async function getPublishedReleaseNoteBySlug(
  db: D1Database,
  slug: string,
  now: string,
): Promise<ReleaseNoteRow | null> {
  const row = await db
    .prepare(
      `SELECT ${DETAIL_COLUMNS} FROM release_notes WHERE slug = ?2 AND ${PUBLIC_PREDICATE} LIMIT 1`,
    )
    .bind(now, slug)
    .first<ReleaseNoteRow>();
  return row ?? null;
}

/** Serialized module_tags_json of every currently-public note (for distinct tags). */
export async function listPublishedModuleTagBlobs(db: D1Database, now: string): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT module_tags_json FROM release_notes
        WHERE ${PUBLIC_PREDICATE} AND module_tags_json IS NOT NULL`,
    )
    .bind(now)
    .all<{ module_tags_json: string | null }>();
  return (res.results ?? []).map((r) => r.module_tags_json ?? "").filter((s) => s.length > 0);
}

/** Insert helper for tests and future seed/CLI. Not exposed via any public API. */
export interface InsertReleaseNoteInput {
  slug: string;
  title: string;
  version?: string | null;
  summary?: string | null;
  bodyMd?: string | null;
  sections?: unknown;
  moduleTags?: string[] | null;
  audience?: string;
  status?: string;
  publishAt?: string | null;
  publishedAt?: string | null;
  author?: string | null;
}

// --- Studio surface (M12): drafts included, plus create/publish. Studio-only,
// gated by requireDeveloper('updates.publish'); never reachable from the client. ---

export interface StudioReleaseNoteRow {
  slug: string;
  version: string | null;
  title: string;
  status: string;
  published_at: string | null;
  updated_at: string;
}

/** All notes (any status, incl. drafts) for the Studio list, newest first. */
export async function listReleaseNotesForStudio(
  db: D1Database,
  page: number,
  pageSize: number,
): Promise<{ rows: StudioReleaseNoteRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const listStmt = db
    .prepare(
      `SELECT slug, version, title, status, published_at, updated_at FROM release_notes
        ORDER BY updated_at DESC, id DESC LIMIT ?1 OFFSET ?2`,
    )
    .bind(pageSize, offset);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM release_notes`);
  const results = await db.batch<StudioReleaseNoteRow | { n: number }>([listStmt, countStmt]);
  const rows = (results[0]?.results ?? []) as StudioReleaseNoteRow[];
  const total = ((results[1]?.results?.[0] as { n: number } | undefined)?.n) ?? 0;
  return { rows, total };
}

/** Create a draft note (status='draft'). Returns false if the slug already exists. */
export async function createDraftReleaseNote(
  db: D1Database,
  input: { slug: string; title: string; version?: string | null; summary?: string | null; author?: string | null },
): Promise<boolean> {
  const existing = await db.prepare(`SELECT 1 FROM release_notes WHERE slug = ?1`).bind(input.slug).first();
  if (existing) return false;
  await insertReleaseNote(db, {
    slug: input.slug,
    title: input.title,
    version: input.version ?? null,
    summary: input.summary ?? null,
    status: "draft",
    author: input.author ?? null,
  });
  return true;
}

/** Publish a note by slug: status='published', published_at=now. Returns false if unknown. */
export async function publishReleaseNote(db: D1Database, slug: string, now: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE release_notes
          SET status = 'published',
              published_at = COALESCE(published_at, ?2),
              archived_at = NULL,
              updated_at = datetime('now')
        WHERE slug = ?1`,
    )
    .bind(slug, now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function insertReleaseNote(db: D1Database, input: InsertReleaseNoteInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO release_notes
         (slug, version, title, summary, body_md, sections_json, module_tags_json,
          audience, status, publish_at, published_at, author)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      input.slug,
      input.version ?? null,
      input.title,
      input.summary ?? null,
      input.bodyMd ?? null,
      input.sections === undefined ? null : JSON.stringify(input.sections),
      input.moduleTags == null ? null : JSON.stringify(input.moduleTags),
      input.audience ?? "all",
      input.status ?? "draft",
      input.publishAt ?? null,
      input.publishedAt ?? null,
      input.author ?? null,
    )
    .run();
}
