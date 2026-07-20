import { Hono } from "hono";
import { z } from "zod";
import {
  RELEASE_NOTE_CHANGE_TYPES,
  type ReleaseNoteChangeType,
  type ReleaseNoteDetail,
  type ReleaseNoteSection,
  type ReleaseNoteSummary,
  type ReleaseNotesListResponse,
} from "@bot/shared";
import type { Env } from "../env.js";
import { buildInvite } from "./onboarding.js";
import {
  getPublishedReleaseNoteBySlug,
  listPublishedModuleTagBlobs,
  listPublishedReleaseNotes,
  type ReleaseNoteRow,
} from "../db/queries.js";

/**
 * Unauthenticated, read-only endpoints for the public landing page and updates.
 * Mounted on the root app (outside the session-guarded /api sub-app). No secrets,
 * no per-tenant data: release notes are global product content and only the
 * `published`, in-window, `audience='all'` subset is ever served. Internal
 * columns (author, status, publish_at, audience, timestamps) are never returned.
 */
export const publicRouter = new Hono<{ Bindings: Env }>();

publicRouter.get("/api/invite", (c) => c.json(buildInvite(c.env)));

const CHANGE_TYPE_SET = new Set<string>(RELEASE_NOTE_CHANGE_TYPES);

/** Defensive JSON parse of a string[] column (corrupt/legacy value → []). */
function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Defensive parse of sections_json → validated [{type, items}]. */
function parseSections(raw: string | null): ReleaseNoteSection[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReleaseNoteSection[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const type = (entry as { type?: unknown }).type;
    const items = (entry as { items?: unknown }).items;
    if (typeof type !== "string" || !CHANGE_TYPE_SET.has(type)) continue;
    if (!Array.isArray(items)) continue;
    const cleanItems = items.filter((i): i is string => typeof i === "string");
    if (cleanItems.length === 0) continue;
    out.push({ type: type as ReleaseNoteChangeType, items: cleanItems });
  }
  return out;
}

/** Change categories present in a note, in canonical order (badges + filtering). */
function changeTypesFrom(sections: ReleaseNoteSection[]): ReleaseNoteChangeType[] {
  const present = new Set(sections.map((s) => s.type));
  return RELEASE_NOTE_CHANGE_TYPES.filter((t) => present.has(t));
}

/** Normalize a stored timestamp to ISO 8601. Accepts ISO ("…T…Z") or the SQLite
 * "YYYY-MM-DD HH:MM:SS" (UTC) form; falls back to the raw value if unparseable. */
function toIso(value: string | null): string {
  if (!value) return "";
  const candidate = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function toSummary(row: ReleaseNoteRow): ReleaseNoteSummary {
  const sections = parseSections(row.sections_json);
  return {
    slug: row.slug,
    version: row.version,
    title: row.title,
    summary: row.summary,
    moduleTags: parseStringArray(row.module_tags_json),
    changeTypes: changeTypesFrom(sections),
    publishedAt: toIso(row.published_at),
  };
}

function toDetail(row: ReleaseNoteRow): ReleaseNoteDetail {
  const sections = parseSections(row.sections_json);
  return { ...toSummary(row), bodyMd: row.body_md ?? null, sections };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  module: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .optional(),
});

publicRouter.get("/api/updates", async (c) => {
  const parsed = listQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    module: c.req.query("module"),
  });
  if (!parsed.success) {
    return c.json({ error: "invalid_query", fields: parsed.error.flatten().fieldErrors }, 400);
  }
  const { page, pageSize, module } = parsed.data;
  const now = new Date().toISOString();

  const [{ rows, total }, tagBlobs] = await Promise.all([
    listPublishedReleaseNotes(c.env.DB, { now, page, pageSize, module }),
    listPublishedModuleTagBlobs(c.env.DB, now),
  ]);

  const modules = [...new Set(tagBlobs.flatMap((blob) => parseStringArray(blob)))].sort();
  const body: ReleaseNotesListResponse = {
    items: rows.map(toSummary),
    total,
    page,
    pageSize,
    modules,
  };
  c.header("cache-control", "public, max-age=60");
  return c.json(body);
});

publicRouter.get("/api/updates/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return c.json({ error: "not_found" }, 404);
  const now = new Date().toISOString();
  const row = await getPublishedReleaseNoteBySlug(c.env.DB, slug, now);
  if (!row) return c.json({ error: "not_found" }, 404);
  c.header("cache-control", "public, max-age=60");
  return c.json(toDetail(row));
});
