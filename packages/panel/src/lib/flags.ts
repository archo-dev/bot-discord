import { resolveFlags, type FlagState } from "@bot/shared";

/*
 * Source PANEL des feature flags de plateforme (M2).
 *
 * Source build-time via Vite : `VITE_PLATFORM_PUBLIC_SITE="true"` active
 * `platform.publicSite`. **Défaut off** (variable absente en production →
 * flag off, aucune surface publique). S'appuie sur le résolveur pur de
 * @bot/shared (M1). Le paramètre `env` est injectable pour les tests.
 * Le branchement runtime (vars Worker → /api/me) est différé (voir brief M2).
 */

type FlagEnv = Record<string, unknown> | undefined;

function readEnv(): FlagEnv {
  // import.meta.env est inliné par Vite au build ; undefined hors bundler.
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** État résolu des flags de plateforme côté panel (défaut off). */
export function getPlatformFlags(env: FlagEnv = readEnv()): FlagState {
  return resolveFlags({
    "platform.publicSite": env?.["VITE_PLATFORM_PUBLIC_SITE"] === "true",
  });
}
