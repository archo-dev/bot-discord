# 12 — Stratégie de tests & de mise en production

> Voir aussi : [audit](./01-current-state-audit.md) · [abonnements](./06-subscriptions-and-entitlements.md) · [sécurité](./09-security-model.md) · [roadmap](./11-migration-roadmap.md)

Objectif : livrer la couche SaaS **sans régression** et de façon **réversible**, en s'appuyant sur le socle de test existant (41 fichiers `packages/worker/test/*.test.ts` via `@cloudflare/vitest-pool-workers`, D1/KV réels miniflare — [doc 01](./01-current-state-audit.md) §12).

> ⚠️ **Piège projet à respecter** (`CLAUDE.md`) : vitest-pool-workers **rollback D1/KV entre chaque test** ; seuls les seeds de `beforeAll` persistent → **chaque test doit être auto-suffisant**. Commande : `pnpm --filter @bot/worker test`.

## Pyramide de tests

| Niveau | Portée | Outil | Cible SaaS |
|--------|--------|-------|-----------|
| **Unitaire (pur)** | Logique déterministe sans I/O | vitest | Résolution d'entitlement, machine d'états, priorité, calcul de slots, mapping plan→features |
| **Intégration (worker)** | Routes + D1/KV réels | vitest-pool-workers | `/api/subscription`, `/api/billing`, `/webhooks/*`, `/studio-api/*`, dev-auth, quotas |
| **E2E (parcours)** | Bout en bout UI→backend | **[Hypothèse : Playwright — doc 13]** | Découverte→essai→upsell→paiement→gestion, downgrade, support |
| **Non-fonctionnel** | Charge, sécurité, a11y | k6/pentest/axe **[Hypothèse]** | Rate-limits, replay, isolation, contraste AA |

## 1. Tests unitaires (cœur métier, priorité maximale)

La **résolution du meilleur entitlement actif** est pure et déterministe ([doc 06](./06-subscriptions-and-entitlements.md)) → couverture exhaustive :

- Rang de plan (business>premium>free), tie-breakers (lifetime, `end_at`, priorité d'origine, `created_at`).
- **Cumul** : Premium payé + Business offert 30 j → effectif Business ; expiration/révocation du Business → **retour auto** à Premium payé.
- **Lifetime** : `end_at IS NULL`, priorité à plan égal.
- **Fenêtres** : `start_at` futur, `end_at` passé, `suspended`, `past_due` exclus.
- **Slots** : dérivés du meilleur plan (1/3/5), **pas d'addition** par défaut ([doc 06](./06-subscriptions-and-entitlements.md) §slots).
- **Invariants** [doc 08](./08-data-model.md) : `paid` jamais `revocable`, `origin_ref` cohérent, unicité `trial`/`redemption`.

## 2. Tests d'intégration (worker, D1/KV réels)

- **Auth** : session valide/expirée/idle/révoquée (global + par-user) ; refresh ; `401/403/404` sans retry.
- **Permissions** : `requireGuildAccess` (admin/modérateur lecture seule via `enforcePanelMutationPolicy`) ; `requireDeveloper(permission)` pour chaque droit de la matrice ([doc 09](./09-security-model.md)).
- **Billing** : mapping `billing_customers`/`billing_subscriptions` ↔ entitlement `paid` ; **jamais** de `paid` créé hors webhook.
- **Webhooks** : signature valide/invalide, **idempotence** (rejeu sans effet), transitions `active/past_due/cancelled/expired`, ordre d'arrivée désordonné.
- **Downgrade** : 5→3→1, suspension **sans suppression** de config, réactivation post-upgrade.
- **Cumul entitlements** : scénarios multi-origines en base réelle.
- **Slots** : affectation/réaffectation (cooldown anti-abus), retrait → plan `free` sans effacement.
- **Support** : priorité figée à l'ouverture, perte de plan signalée non déprioritisée, `internal=1` jamais renvoyé.
- **Release notes** : seuls `published` visibles, ciblage `audience`, publication idempotente.
- **Studio** : chaque route `/studio-api/*` refuse l'accès sans opérateur `active` + permission ; **aucune** route studio répondant sur le domaine client.

### Idempotence & rejeu (bloc critique)

- Réutiliser le pattern `internal_request_nonces`/`processed_events` : un événement webhook rejoué **n'a aucun effet** (test dédié par type d'événement).
- Fenêtre temporelle, nonce consommé, signature obligatoire (rejet si absente/mauvaise).

## 3. Tests E2E (parcours utilisateur)

**[Hypothèse outil : Playwright — [doc 13]]**. Parcours prioritaires ([doc 03](./03-client-platform.md)) :

1. Découverte → `/pricing` → invite → login → onboarding 1er serveur.
2. Upsell : action verrouillée (`LockedFeature`) → `/app/subscription` → paiement (sandbox) → droits appliqués.
3. Gestion d'emplacements : affecter, réaffecter (cooldown), retirer.
4. Downgrade Business→Premium : écran de sélection (3/5), 2 serveurs `suspended` (config intacte).
5. Support : ouverture ticket → priorité auto → suivi.
6. Studio : octroi grant → révocation ; lifetime avec saisie `LIFETIME` + step-up.

## 4. Multi-tenant & isolation

- **Scoping `guildId`** systématique : un utilisateur ne voit jamais les données d'une autre guilde.
- **Cross-tenant leak** : tests négatifs (accès guilde non autorisée → 403/404).
- **Isolation client↔studio** : cookie/secret/domaine séparés ; aucune session client acceptée côté studio et inversement ([doc 09](./09-security-model.md)).
- **PII** : emails billing, notes internes **jamais** exposés au client (tests de filtrage de réponse).

## 5. Sécurité (tests dédiés)

- **Origin/CSRF** : mutations rejetées si `Origin`/`Referer` hors allowlist (`browserMutationOrigin`) ; `sameSite=Strict` studio.
- **Rate-limits** : `durablePanelQuota`/`security_quota_usage` ; limites renforcées sur `grant`/`grant_lifetime`.
- **Révocabilité** : impossible de révoquer un `paid` par le chemin « accès offert » (test de garde backend).
- **Lifetime** : impossible sans permission dédiée + saisie exacte.
- **Audit** : append-only vérifié (aucune route UPDATE/DELETE) ; chaque action sensible produit une entrée.
- **Pentest [Hypothèse — [doc 13]]** : revue ciblée avant lancement (étape 15/19) — escalade client→studio, escalade intra-studio, compromis de compte développeur, replay, fuite inter-guilde ([doc 09](./09-security-model.md) modèle de menaces).

## 6. Charge & performance

- **Charge [Hypothèse : k6 — [doc 13]]** sur `/webhooks/*` (bursts prestataire), résolution d'entitlement (cache KV + invalidation), file support.
- **Latence** : la résolution est recalculée côté backend à chaque requête sensible ; vérifier l'efficacité du cache KV et son **invalidation** sur tout événement d'entitlement.
- **Budget bundle** : `scripts/check-bundle-budget.mjs` (180 KiB gzip) — le build **échoue** au-delà ; Recharts et pages marketing en lazy-load.

## 7. Accessibilité & responsive (client)

- Contraste **AA**, navigation clavier, focus-trap (existant), `aria-live` (toasts/save-states), `prefers-reduced-motion`.
- Responsive mobile-first des pages publiques ; drawer panel conservé.
- Vérification axe (**[Hypothèse]**) sur les pages clés (pricing, panel, onboarding).

## 8. Stratégie de release

- **Feature flags** : chaque brique activable/désactivable sans redeploy ([doc 11](./11-migration-roadmap.md) étape 17). Rollback = bascule de flag.
- **Déploiement progressif** : guildes pilotes → cohortes → général ; le Studio d'abord réservé au propriétaire.
- **Rétrocompatibilité** : défaut plan Gratuit → aucune régression pour l'existant.
- **Migrations additives** : `pnpm run migrate:remote` à **chaque** déploiement de milestone (`CLAUDE.md` — une migration oubliée a déjà cassé la prod). Jamais de migration destructive ; suspension jamais suppression.
- **Secrets** : `wrangler secret bulk fichier.json` puis suppression du fichier — **jamais** `Write-Output "x" | wrangler secret put` (CRLF → 401 Ed25519, piège connu).

## 9. Smoke tests de production

Après chaque déploiement de milestone, vérifier en prod (sans muter de vraies données) :

- `/status` reflète Worker/Gateway/D1/KV réels (heartbeat `gateway:status`, health).
- Login OAuth (client) + login Studio (opérateur) fonctionnels, cookies **séparés**.
- Lecture `/api/subscription` (plan effectif) et `/api/me` OK ; `/updates` publie bien.
- Webhook prestataire : événement de test → entitlement `paid` créé (**idempotent** au rejeu).
- Aucune route studio ne répond sur le domaine client (test négatif).
- Rollback flag testé (activer puis désactiver une brique).

> Rappel : `/ping` sur le serveur de test remplit la table `guilds` (piège « panel vide après install » — `CLAUDE.md`).

## 10. Observabilité comme filet

- Erreurs agrégées (`/errors`), métriques (`/metrics`, `operation_metrics`, `product_metrics*`), timelines ([doc 04](./04-developer-studio.md), [doc 11](./11-migration-roadmap.md) étape 18).
- Alerting minimal sur échecs webhook, pics d'erreurs, quotas dépassés — **détecter avant les clients**.
- Respect `docs/privacy-analytics.md` : pas de PII dans les métriques.

## Critères de sortie (Definition of Done, par milestone)

1. `pnpm -r check` (typecheck) vert.
2. `pnpm --filter @bot/worker test` vert (tests auto-suffisants).
3. Build panel OK + **budget 180 KiB tenu**.
4. Invariants [doc 08](./08-data-model.md) couverts par test.
5. Nouvelles routes auditées + permissions vérifiées serveur.
6. Migration additive appliquée en remote ; rollback flag documenté.
7. Smoke tests prod passés.

## Séparation décision qualité / technique / produit

- **Qualité** : couverture des invariants, isolation multi-tenant, idempotence, a11y AA.
- **Technique** : vitest-pool-workers (tests auto-suffisants), flags, migrations additives, secrets via `bulk`.
- **Produit** : parcours E2E prioritaires, engagements support (non-SLA), cohortes de rollout.
