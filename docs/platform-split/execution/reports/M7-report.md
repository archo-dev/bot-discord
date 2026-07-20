# Rapport de fin de milestone — M7 · Slots serveurs & gating des offres

> Brief : [../briefs/M7-brief.md](../briefs/M7-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m7--slots-serveurs--gating-des-offres) · Métier : [../../06-subscriptions-and-entitlements.md](../../06-subscriptions-and-entitlements.md)

## Résumé

M7 est **terminé et vert**. Les **emplacements de serveurs (slots)** sont opérationnels : un utilisateur **affecte/retire** les serveurs qu'il administre à son entitlement effectif (dans la limite des slots du plan), un **downgrade suspend** les serveurs excédentaires (**config jamais supprimée**) et les **réactive** au ré-upgrade, un **cooldown** anti-abus borne la réaffectation, et le **plan effectif de chaque guilde** est exposé dans `GuildGatewayConfig` pour la gateway. Tout est **derrière `platform.entitlements`** (off ⇒ tout Gratuit, aucune suspension). **Aucune migration** (le schéma `0033` suffisait), aucune dépendance, aucune migration distante, aucun déploiement ; budget panel inchangé.

- **Branche** : `feat/m07-slots-gating`
- **HEAD initial** (master) : `829023a` (brief M7)
- **HEAD final** : `5dbfb87`

## Livré

### `@bot/shared`
- **`assignments.ts`** : `AssignmentState`, `AssignmentCandidate`, `SLOT_REASSIGN_COOLDOWN_HOURS` (24 h), et **`resolveSlotAssignments(candidates, slots)`** — répartition **pure/déterministe** active/suspendu (garde les `slots` plus récentes actives, suspend le reste ; départage stable par `guildId`).
- **`entitlement.ts`** : extraction de **`pickBestEntitlementIndex`** (retrouve la ligne source du meilleur entitlement ; `resolveEffectiveEntitlement` le réutilise).
- **`api-types/subscription.ts`** : `SlotAssignment`, `SubscriptionAssignmentsResponse`, `GuildPlan`.

### Worker
- **`db/queries/assignments.ts`** : SQL brut — `listUserAssignments`, `getGuildLiveAssignment`, `getGuildEntitlementRow`, `getGuildLastReleasedAt`, `insertAssignment`, `releaseGuildAssignment`. Cycle de vie dans le schéma `0033` : *live* (`state='active' AND released_at IS NULL`), *suspendu* (dérivé, non persisté), *retiré* (`released_at` + `state='suspended'` pour libérer l'index unique partiel).
- **`api/assignments.ts`** : service `resolveUserSlots` (réconciliation **en mémoire, sans écriture sur lecture**), `buildAssignmentsResponse`, `assignGuild`, `releaseGuild`, `resolveGuildPlan`. Routes **user-level** : `GET /api/subscription/assignments` ; `POST`/`DELETE /api/subscription/assignment` (mutation ⇒ **`manage_guild` réel** vérifié via `getUserGuilds`+`canManageGuild`). Flag-gated (`feature_disabled` si off) ; erreurs `no_active_entitlement`/`guild_already_assigned`/`reassign_cooldown`/`no_slot_available`/`not_assigned`.
- **`internal/config.ts`** : `GET /internal/guilds/:id/config` expose **`plan`** = plan effectif de la guilde (`resolveGuildPlan`, Gratuit par défaut / flag off).

### Gateway
- `GuildGatewayConfig.plan?` (optionnel, rétrocompat) — le plan effectif transite par le cache de config vers tous les modules. **Pas** de matrice feature→plan (D29 non tranchée) : infrastructure prête, application fine différée.

### Panel
- `components/SlotMeter.tsx` (jauge emplacements, a11y `progressbar`), `components/LockedFeature.tsx` (verrou + incitation `/pricing`, jamais l'unique barrière), helpers purs `lib/slots.ts`. Primitives réutilisables ; la **page** interactive d'emplacements est composée en **M8**. Non importées par le chunk initial ⇒ **budget inchangé**.

## Décisions (micro)
| # | Décision |
|---|----------|
| Migration | **Aucune** — `0033` couvre `entitlement_guild_assignments` |
| Mutations | **User-level** `/api/subscription/assignment` + vérif `manage_guild` en handler (évite `PANEL_MUTATION_POLICIES`) |
| Cooldown (D7) | **24 h** par guilde depuis `released_at` |
| Downgrade sans choix (D8) | **Déterministe** : garder les N plus récentes actives, suspendre le reste (réversible) |
| Suspension over-capacity | **Dérivée** à la lecture (jamais persistée) ⇒ lectures sans écriture |
| Matrice feature→plan (D29) | **Différée** — le plan est exposé, le mapping non codé |
| Page emplacements | **M8** — M7 livre `SlotMeter`/`LockedFeature` |

## Fichiers (16 · +798 / −9)

```
 packages/shared/src/assignments.ts              | +51  (resolveSlotAssignments pur)
 packages/shared/src/entitlement.ts              | +32/-9 (pickBestEntitlementIndex)
 packages/shared/src/api-types/subscription.ts   | +29  (DTO slots)
 packages/shared/src/index.ts                    | +1
 packages/worker/src/db/queries/assignments.ts   | +108 (SQL affectations)
 packages/worker/src/api/assignments.ts          | +200 (service + routes)
 packages/worker/src/db/queries.ts               | +1
 packages/worker/src/index.ts                    | +5   (montage assignmentsRouter)
 packages/worker/src/internal/config.ts          | +7   (plan dans la config gateway)
 packages/gateway/src/worker-api.ts              | +4   (GuildGatewayConfig.plan?)
 packages/panel/src/components/SlotMeter.tsx     | +33
 packages/panel/src/components/LockedFeature.tsx | +41
 packages/panel/src/lib/slots.ts                 | +28
 packages/panel/test/slots.test.ts               | +82  (9 tests purs)
 packages/worker/test/assignments.test.ts        | +181 (15 tests D1/API)
 packages/worker/test/internal.test.ts           | +4   (assertion plan)
```
**Aucune migration**, aucune dépendance/lockfile, aucun changement `wrangler.jsonc`/`PANEL_MUTATION_POLICIES`.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel (dont `slots` pur) | ✅ **105 / 18 fichiers** (avant M7 : 96/17 ; +9) |
| Tests Gateway | ✅ **207** (type `plan?` optionnel, rétrocompat) |
| Tests Worker — `assignments` + `internal` | ✅ **19/19** (isolé, sans `fetchMock`) ; `entitlements`+`release-notes` ✅ (non-régression M5/M6) |
| Build panel + budget | ✅ **152.5 kB / 180 kB** (primitives tree-shaken, inchangé) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration | **Aucune** (0033 suffit) |

> **Limitation d'environnement** : la suite Worker complète en un run reste instable (loopback `ConnectEx` du fallback service vitest-pool-workers, **zéro échec d'assertion**) → suites lancées **par lots**. Le happy-path HTTP des mutations passe par Discord (`getUserGuilds`) → non exécutable de façon fiable ici (`fetchMock`) ; couvert par le **service testé directement sur D1** + garde `manage_guild` déjà couverte (`api-guard`).

## Preview locale (Partie 1)
Migrations `0001→0033` appliquées sur D1 locale isolée (`.wrangler/preview-state`), panel buildé flag ON, 2 notes fixtures ; `wrangler dev` sur `http://127.0.0.1:8787` vérifié (landing, `/updates`, `/pricing`, `/api/updates` → 2 notes sans fuite, slug inconnu → 404) puis **arrêté proprement**.

## Commits
| Hash | Message |
|------|---------|
| `829023a` | `docs(platform): M7 execution brief` (poussé seul sur `master` avant la branche) |
| `45457c7` | `feat(shared): server slot assignment model + downgrade resolution (M7)` |
| `6c165a0` | `feat(worker): slot assignments API and per-guild plan gating (M7)` |
| `cd25cb7` | `feat(gateway): expose effective guild plan from config (M7)` |
| `9bdfd80` | `feat(panel): SlotMeter and LockedFeature primitives (M7)` |
| `5dbfb87` | `test(platform): cover slot assignment, downgrade and cooldown (M7)` |

## Sécurité (confirmations)
- **Backend = vérité** : slots, plan effectif, révocabilité recalculés serveur ; UI jamais l'unique barrière.
- **`manage_guild` réel** requis pour affecter/retirer (owner/`MANAGE_GUILD`, pas un grant panel) → on n'attache que des serveurs qu'on contrôle.
- **Isolation** : lectures scopées `session.userId` ; mutations à la guilde vérifiée ; **aucune fuite inter-user/inter-guilde** (tests d'isolation verts).
- **Suspension jamais suppression** (invariant 4, testé : 5 lignes conservées au downgrade) ; **cooldown** anti-abus ; `paid` non révocable (M6, inchangé).
- **Flag off par défaut** ⇒ tout Gratuit, aucune suspension, mutations `feature_disabled` ⇒ **aucune régression**.

## Confirmations
- **Aucune migration** (0033 suffit) · **aucune migration distante** · **aucun déploiement** · **aucun billing/prix/checkout** · **aucune matrice feature→plan** (D29 différée) · **aucune dépendance/lockfile** · **aucun changement `wrangler.jsonc`/domaine/secret** · **flag `platform.entitlements` off en prod** · M8 non commencé.

## Rollback
- **Fonctionnel** : `platform.entitlements` off → plan effectif Gratuit, slots ignorés, aucune suspension.
- **Code** : `git revert` de `master..feat/m07-slots-gating`. **Aucune migration** ⇒ revert net ; aucune donnée détruite.
