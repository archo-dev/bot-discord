import type { OnboardingPresetId } from "@bot/shared";

export interface OnboardingProgressRow {
  onboarding_completed_at: string | null;
  onboarding_preset: string | null;
  onboarding_dismissed_steps: string | null;
}

export async function getOnboardingProgress(db: D1Database, guildId: string): Promise<OnboardingProgressRow> {
  const row = await db.prepare(
    `SELECT onboarding_completed_at, onboarding_preset, onboarding_dismissed_steps
       FROM guilds WHERE id = ?1`,
  ).bind(guildId).first<OnboardingProgressRow>();
  return row ?? { onboarding_completed_at: null, onboarding_preset: null, onboarding_dismissed_steps: null };
}

/** Parses the dismissed-steps JSON column defensively (corrupt/legacy value → empty). */
export function parseDismissedSteps(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export async function setOnboardingDismissedSteps(db: D1Database, guildId: string, steps: string[]): Promise<void> {
  await db.prepare(`UPDATE guilds SET onboarding_dismissed_steps = ?2, updated_at = datetime('now') WHERE id = ?1`)
    .bind(guildId, JSON.stringify([...new Set(steps)])).run();
}

export async function markOnboardingComplete(db: D1Database, guildId: string): Promise<void> {
  await db.prepare(
    `UPDATE guilds SET onboarding_completed_at = COALESCE(onboarding_completed_at, datetime('now')), updated_at = datetime('now') WHERE id = ?1`,
  ).bind(guildId).run();
}

/**
 * Prepared statement recording an applied preset + completion, meant to ride in the
 * same D1 batch as the module toggles so a preset application is atomic.
 */
export function applyOnboardingPresetStatement(db: D1Database, guildId: string, preset: OnboardingPresetId): D1PreparedStatement {
  return db.prepare(
    `UPDATE guilds
        SET onboarding_preset = ?2,
            onboarding_completed_at = COALESCE(onboarding_completed_at, datetime('now')),
            updated_at = datetime('now')
      WHERE id = ?1`,
  ).bind(guildId, preset);
}
