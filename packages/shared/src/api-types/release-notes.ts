/** Public release-notes DTOs (M5). Read-only surface: GET /api/updates[/:slug].
 * Only published, in-window, audience='all' notes are ever serialized here, and
 * internal columns (author, status, publish_at, audience, timestamps) are never
 * exposed. See docs/platform-split/execution/briefs/M5-brief.md. */

import type { Paginated } from "./common.js";

/** Change buckets shown as category badges on a note. */
export type ReleaseNoteChangeType = "new" | "improved" | "fixed" | "security";

export const RELEASE_NOTE_CHANGE_TYPES: readonly ReleaseNoteChangeType[] = [
  "new",
  "improved",
  "fixed",
  "security",
] as const;

/** A structured group of change items within a note detail. */
export interface ReleaseNoteSection {
  type: ReleaseNoteChangeType;
  items: string[];
}

/** List-row projection: enough for a card + filtering, never the full body. */
export interface ReleaseNoteSummary {
  slug: string;
  version: string | null;
  title: string;
  summary: string | null;
  moduleTags: string[];
  /** Which change categories the note contains (badges + filtering). */
  changeTypes: ReleaseNoteChangeType[];
  /** ISO 8601 publication timestamp. */
  publishedAt: string;
}

/** Full note for the /updates/:slug detail view. */
export interface ReleaseNoteDetail extends ReleaseNoteSummary {
  bodyMd: string | null;
  sections: ReleaseNoteSection[];
}

/** Paginated list plus the distinct module tags across published notes (filter UI). */
export interface ReleaseNotesListResponse extends Paginated<ReleaseNoteSummary> {
  modules: string[];
}
