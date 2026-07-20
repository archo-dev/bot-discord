# Brief d'exécution — M7 · Slots serveurs & gating des offres

> Voir aussi : [milestones](../E4-milestones.md#m7--slots-serveurs--gating-des-offres) · [abonnements & entitlements](../../06-subscriptions-and-entitlements.md) · [modèle de données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [brief M6](./M6-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m07-slots-gating` après commit + push de ce brief sur `master`.

## 1. Contexte

- **Après M6** : moteur d'entitlements pur (`@bot/shared/entitlement.ts`, `resolveEffectiveEntitlement`), tables `plans` (seedé) + `entitlements` + **`entitlement_guild_assignments`** (schéma déjà créé en `0033`, colonnes `state`/`assigned_at`/`assigned_by`/`last_reassigned_at`/`released_at`) + `subscription_events`. `GET /api/subscription` renvoie le plan effectif (défaut Gratuit) derrière `platform.entitlements` (off en prod). La gateway lit `GET /internal/guilds/:id/config` (type `GuildGatewayConfig`).
- **But de M7** : rendre les **emplacements de serveurs (slots)** opérationnels — **affecter/retirer** un serveur à l'entitlement de l'utilisateur (dans la limite des slots du plan effectif), **downgrade** (suspension des serveurs excédentaires **sans suppression** de config) + **réactivation** au ré-upgrade, **cooldown** anti-abus de réaffectation, et **exposer le plan effectif de chaque guilde** dans `GuildGatewayConfig` (consommé par la gateway). Tout **derrière `platform.entitlements`** (off ⇒ tout Gratuit, aucune suspension).

## 2. Objectif utilisateur

L'utilisateur voit ses emplacements (utilisés/disponibles), affecte les serveurs qu'il administre à son plan payé/offert, et comprend qu'un downgrade **suspend** (jamais ne supprime) la config des serveurs excédentaires — réactivables au ré-upgrade. La gateway connaît le plan de chaque guilde pour un futur gating fin.

## 3. Périmètre (autorisé)

- **`@bot/shared`** : `AssignmentState`, DTO `SlotAssignment` / `SubscriptionAssignmentsResponse`, **`resolveSlotAssignments` pur** (sélection active/suspendu déterministe au downgrade), `GuildPlan` type, constante `SLOT_REASSIGN_COOLDOWN_HOURS`.
- **Worker** : queries `db/queries/assignments.ts` (SQL brut : lister/affecter/retirer/reconcilier, plan effectif d'une guilde) ; service `api/assignments.ts` (validation + cooldown + reconcile) ; routes **user-level** `GET/POST/DELETE /api/subscription/assignment(s)` (session ; mutation ⇒ **vérif `manage_guild` explicite** sur le serveur cible) ; enrichissement `GET /internal/guilds/:id/config` avec `plan` ; le tout **flag-gated `platform.entitlements`**.
- **Gateway** : `GuildGatewayConfig.plan?` (type) consommé (pass-through cache) — **pas** de matrice feature→plan (D29 non tranchée).
- **Panel** : composants réutilisables `SlotMeter`, `LockedFeature` + helpers purs d'affichage (la **page** interactive d'emplacements compose ces primitives en **M8** avec l'espace abonnement).
- **Tests** : `resolveSlotAssignments` pur (panel) ; service d'affectation sur D1 (sans `fetchMock`) : affecter, retirer, downgrade→suspension, réactivation, cooldown, isolation ; `plan` dans la config interne (sans `fetchMock`).

## 4. Hors périmètre (interdit)

- ❌ **Nouvelle migration** : `0033` couvre déjà `entitlement_guild_assignments` (aucune colonne manquante). **Aucune migration M7.**
- ❌ **Matrice feature_key→plan** (D29 non tranchée) : on expose le **plan**, on ne code pas quel module chaque offre débloque.
- ❌ Billing / prix / checkout / prestataire ; Studio / grants (création d'entitlements = M12/M13 ; en M7 les entitlements de test viennent d'`insertEntitlement` M6).
- ❌ **Page** `/app/subscription` complète (= M8) — M7 livre les primitives UI, pas l'écran final.
- ❌ Migration distante, déploiement, secret, dépendance, lockfile, domaine, activation du flag en prod.
- ❌ Modification du schéma `PANEL_MUTATION_POLICIES` (les mutations restent **user-level**, hors `/guilds/:guildId` ⇒ hors `enforcePanelMutationPolicy`).

## 5. Audit des fichiers réels

| Fichier | Rôle | Décision M7 | Risque |
|---------|------|-------------|--------|
| `packages/worker/migrations/0033_entitlements.sql` | Tables entitlements + **assignments** | **Réutiliser** (aucune nouvelle migration) | Nul |
| `packages/shared/src/entitlement.ts` | Moteur M6 | **Réutiliser** (`resolveEffectiveEntitlement`, `PLANS`) | Nul |
| `packages/worker/src/config/flags.ts` | `getWorkerFlags` | **Réutiliser** (`platform.entitlements`) | Nul |
| `packages/worker/src/auth/guard.ts` | `getUserGuilds`, `canManageGuild` | **Réutiliser** pour la vérif `manage_guild` en handler | Faible |
| `packages/worker/src/internal/config.ts` | Config gateway | **Étendre** avec `plan` | Faible |
| `packages/gateway/src/worker-api.ts` | Type `GuildGatewayConfig` | **Étendre** `plan?` (optionnel, rétrocompat) | Faible |
| `packages/worker/src/index.ts` | Montage `/api` | **Ajouter** `assignmentsRouter` (user-level) | Faible |
| `packages/panel/src/ui/*`, `components/*` | Kit | **Ajouter** `SlotMeter`, `LockedFeature` | Faible |

## 6. Modèle d'affectation (dans le schéma `0033`, sans migration)

États dérivés des colonnes existantes :
- **live/actif** (consomme un slot) : `state='active' AND released_at IS NULL`.
- **suspendu** (excédentaire au downgrade, **config conservée**, réactivable) : `state='suspended' AND released_at IS NULL`.
- **retiré** (l'utilisateur a libéré le slot) : `released_at IS NOT NULL` (on pose `state='suspended'` pour libérer l'index unique partiel `(guild_id) WHERE state='active'`).

Opérations (service, appliquées **backend**) :
- **Affecter** : flag ON ; guilde `bot_installed` ; **`manage_guild` vérifié** sur la guilde cible ; guilde sans affectation **live** ailleurs ; l'utilisateur a un **entitlement actif** avec un slot **libre** ; **cooldown** respecté ⇒ INSERT `state='active'`.
- **Retirer** : sur l'affectation live de l'utilisateur ⇒ `released_at=now`, `state='suspended'`. **Config de la guilde jamais supprimée** ; la guilde repasse Gratuit (invariant 4).
- **Reconcile (downgrade/upgrade)** : pour un entitlement, capacité = `slots(plan effectif)` ; parmi ses affectations non-retirées triées par récence (`last_reassigned_at`/`assigned_at` desc), garder les **N** plus récentes `active`, suspendre le reste ; au ré-upgrade, réactiver les suspendues (récence) jusqu'à capacité. **Jamais de suppression.**
- **Cooldown (D7, défaut 24 h)** : une guilde **retirée** ne peut être réaffectée qu'après `SLOT_REASSIGN_COOLDOWN_HOURS` depuis son `released_at` le plus récent (anti « partage tournant »). Première affectation et autres guildes non impactées.

Fonction pure `resolveSlotAssignments(assignments, effectiveSlots)` → `{ active[], suspended[] }` (garde les `effectiveSlots` plus récentes actives), déterministe, testée exhaustivement.

## 7. API (lecture + mutations, session requise)

- **`GET /api/subscription/assignments`** (user-level, no Discord) → `SubscriptionAssignmentsResponse` : `plan` effectif, `slots`, `used`, `available`, liste `{ guildId, state, assignedAt }`. Scopé `session.userId` ⇒ **aucune fuite inter-user**. Flag OFF ⇒ plan Gratuit, `slots=1`, liste vide.
- **`POST /api/subscription/assignment`** `{ guildId }` → affecte. Vérifs : flag ON (sinon `feature_disabled`) ; `guildId` valide + `bot_installed` ; **`manage_guild`** (owner/`MANAGE_GUILD` réel via `getUserGuilds`) sinon 403 ; slot libre + cooldown sinon 409 (`no_slot_available` / `guild_already_assigned` / `reassign_cooldown`).
- **`DELETE /api/subscription/assignment`** `{ guildId }` → retire (idem vérif `manage_guild`).
- Mutations **user-level** (hors `/guilds/:guildId`) ⇒ vérif `manage_guild` **explicite en handler** (réutilise `getUserGuilds`+`canManageGuild`), pas via `enforcePanelMutationPolicy`. Validation zod stricte du corps ; `browserMutationOrigin` (déjà global `/api/*`) protège du CSRF.

## 8. Gating gateway (`GuildGatewayConfig.plan`)

- `GET /internal/guilds/:id/config` ajoute `plan: { id, rank, slots }` = plan **effectif de la guilde** (`resolveGuildPlan` : affectation live → entitlement → `resolveEffectiveEntitlement`; défaut **Gratuit**). Flag OFF ⇒ toujours Gratuit.
- Gateway : `GuildGatewayConfig.plan?` **optionnel** (rétrocompat), lu via le cache. **Pas** de gating par-module (D29) ; l'infrastructure est prête, l'application fine viendra avec le mapping features→offres.

## 9. Panel

- `components/SlotMeter.tsx` (emplacements utilisés/disponibles, a11y) et `components/LockedFeature.tsx` (verrou + incitation, jamais l'unique barrière — double une garde backend). Helpers purs `lib/slots.ts` (libellés utilisés/disponibles/suspendus). **Pas** de page interactive (M8). Budget initial inchangé (composants non importés par le chunk initial tant que M8 ne les monte pas).

## 10. Feature flag & sécurité

- **`platform.entitlements`** (off par défaut) gouverne slots + gating + plan de guilde. OFF ⇒ tout Gratuit, **aucune suspension**, `/api/subscription/assignment*` renvoie `feature_disabled`. **Rollback** = flag off (plan effectif forcé Gratuit, aucune suspension) — conforme E4 M7.
- **Backend = vérité** ; UI jamais l'unique barrière.
- **`manage_guild` réel** requis pour affecter/retirer (owner/`MANAGE_GUILD`), pas un grant panel — on ne peut attacher que des serveurs qu'on contrôle réellement. **Multitenant** : lectures scopées `session.userId` ; mutation scopée à la guilde vérifiée ; aucune fuite inter-user/inter-guilde.
- **Suspension jamais suppression** (invariant 4) ; cooldown anti-abus ; `paid` non révocable (M6, inchangé).

## 11. Tests

**Shared/pur (panel) — `slots.test.ts`** : `resolveSlotAssignments` (aucun downgrade → tout actif ; downgrade 5→3 → 3 actives récentes, 2 suspendues ; upgrade → réactivation ; égalités déterministes ; capacité 0/1).
**Worker — `assignments.test.ts`** (D1, **sans `fetchMock`**, auto-suffisant) : affecter consomme un slot ; dépassement de slots → 409 ; retirer libère + `released_at` + config guilde intacte ; downgrade (entitlement business→premium) → serveurs excédentaires `suspended` (config intacte) ; réactivation au ré-upgrade ; **cooldown** (retirer puis réaffecter < 24 h → 409 ; > 24 h → OK) ; **isolation** (assignments d'un autre user invisibles) ; flag OFF → `feature_disabled` + plan Gratuit ; `GET /api/subscription/assignments` exige une session.
**Worker — config interne** (dans `internal.test.ts` ou dédié, sans `fetchMock`) : `plan` = Gratuit par défaut ; = plan de l'entitlement quand une affectation live existe (flag ON).

> Le happy-path HTTP des mutations (vérif `manage_guild`) passe par Discord (`getUserGuilds`) → non exécutable de façon fiable ici (limitation `fetchMock`/loopback du poste). Couverture : **service testé directement sur D1** + garde `manage_guild` déjà couverte par `api-guard`/`security-policy`. Validation `manage_guild` relue en revue.

**Validations monorepo** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; `wrangler deploy --dry-run` ; `git diff --check`.

## 12. Critères d'acceptation

1. Affecter/retirer un serveur consomme/libère un slot ; **jamais** de suppression de config guilde.
2. **Downgrade** ⇒ serveurs excédentaires `suspended` (config intacte) ; **ré-upgrade** ⇒ réactivation.
3. **Cooldown** de réaffectation appliqué (anti-abus).
4. `GuildGatewayConfig.plan` = plan effectif de la guilde (défaut Gratuit) ; gateway rétrocompat.
5. Flag OFF ⇒ tout Gratuit, aucune suspension, mutations `feature_disabled` ⇒ **aucune régression**.
6. Isolation stricte (scopé user/guilde) ; **aucune fuite inter-user/inter-guilde** ; `manage_guild` requis pour muter.
7. **Aucune migration** (0033 suffit) ; aucune dépendance/migration distante/déploiement ; budget panel inchangé.
8. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 13. Rollback

- **Fonctionnel** : `platform.entitlements` off → plan effectif Gratuit, slots ignorés, aucune suspension.
- **Code** : `git revert` de `master..feat/m07-slots-gating`. Aucune migration ⇒ revert net ; aucune donnée détruite (les affectations éventuelles restent des lignes inertes).

## 14. Stratégie de commits (Conventional + réf `M7`, ordre `CLAUDE.md`)

```
docs(platform): M7 execution brief                                        # poussé seul sur master AVANT la branche
feat(shared): server slot assignment model + downgrade resolution (M7)
feat(worker): slot assignments API and per-guild plan gating (M7)
feat(gateway): expose effective guild plan from config (M7)
feat(panel): SlotMeter and LockedFeature primitives (M7)
test(platform): cover slot assignment, downgrade and cooldown (M7)
docs(platform): M7 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 15. Rapport final attendu

`docs/platform-split/execution/reports/M7-report.md` : livré, modèle d'affectation, API, gating gateway, décisions (cooldown 24 h, mutations user-level, pas de matrice features), budget, diffstat, hashes, commits, validations, confirmations (aucune migration/déploiement/dépendance ; flag off ; suspension jamais suppression ; aucune fuite inter-user/guilde).

---

## Micro-décisions M7 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m7.1 | Nouvelle migration ? | **Non** — `0033` couvre les assignations |
| m7.2 | Emplacement des mutations | **User-level** `/api/subscription/assignment` + vérif `manage_guild` en handler (évite `PANEL_MUTATION_POLICIES`) |
| m7.3 | Cooldown réaffectation (D7) | **24 h** par guilde (depuis `released_at`) |
| m7.4 | Downgrade sans choix (D8) | **Déterministe** : garder les N plus récentes actives, suspendre le reste (réversible) |
| m7.5 | Cumul de slots | **Non** (meilleur plan, M6) |
| m7.6 | Matrice feature→plan (D29) | **Différée** — M7 expose le plan, ne code pas le mapping |
| m7.7 | Page emplacements | **M8** — M7 livre `SlotMeter`/`LockedFeature` |
