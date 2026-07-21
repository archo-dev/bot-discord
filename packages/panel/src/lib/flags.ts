import { resolveFlags, type FlagState } from "@bot/shared";

/*
 * Source PANEL des feature flags de plateforme (M2).
 *
 * Sources build-time via Vite (défaut off, variables absentes en production) :
 *   - `VITE_PLATFORM_PUBLIC_SITE="true"`  → `platform.publicSite`  (site public, M2)
 *   - `VITE_PLATFORM_ENTITLEMENTS="true"` → `platform.entitlements` (espace client, M8)
 *   - `VITE_PLATFORM_BILLING="true"`      → `platform.billing`      (facturation, M9)
 *   - `VITE_PLATFORM_SUPPORT="true"`      → `platform.support`      (support client, M11)
 * S'appuie sur le résolveur pur de @bot/shared (M1). Le paramètre `env` est
 * injectable pour les tests. Le branchement runtime est différé (voir brief M2) ;
 * la page abonnement reflète en plus l'état réel via `/api/subscription`.
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
    "platform.entitlements": env?.["VITE_PLATFORM_ENTITLEMENTS"] === "true",
    "platform.billing": env?.["VITE_PLATFORM_BILLING"] === "true",
    "platform.support": env?.["VITE_PLATFORM_SUPPORT"] === "true",
    "platform.launch": env?.["VITE_PLATFORM_LAUNCH"] === "true",
  });
}
