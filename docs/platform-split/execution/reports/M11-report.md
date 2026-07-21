# Rapport de fin de milestone — M11 · Support client

> Brief : [../briefs/M11-brief.md](../briefs/M11-brief.md) · Milestone : [../E4-milestones.md](../E4-milestones.md#m11--support-client) · Abonnements : [../../06-subscriptions-and-entitlements.md](../../06-subscriptions-and-entitlements.md) · Données : [../../08-data-model.md](../../08-data-model.md) · E2 §5 (D9)

## Résumé

M11 est **terminé et vert**. **Support client** : un utilisateur ouvre des tickets, liste **ses** tickets, consulte le fil (**messages non internes uniquement**), répond, ferme. La **priorité est calculée par le backend depuis le plan effectif** à l'ouverture (`business→high`, `premium→normal`, `free→low`) et **figée** ensuite (perte de plan **signalée**, jamais déprioritisée). Tout est **scopé `session.userId`** (aucune fuite inter-user), `guild_id` = simple métadonnée (aucune donnée de guilde), `internal=1` et l'`assignee` opérateur **jamais exposés**. Derrière **`platform.support`** (nouveau flag, off). **Aucune action opérateur / vue cross-guilde (= Studio M12), aucune suppression physique, aucune dépendance, aucune migration distante, aucun déploiement.** Page `/app/support` **lazy** ⇒ budget inchangé.

- **Branche** : `feat/m11-client-support`
- **HEAD initial** (master) : `d43f64b` (brief M11)
- **HEAD final** : `fb9e10a`

## Livré

### Migration `0036_support.sql` (additive)
- `support_tickets` : `user_id, guild_id (nullable, métadonnée), plan_at_open (CHECK), priority (CHECK low|normal|high, figée), subject, status (CHECK open|pending|resolved|closed), assignee (nullable — Studio M12), plan_changed_since_open, timestamps`. Index `(user_id, updated_at)`, **`(status, priority, created_at)`** (file M12), `(assignee, status)`.
- `support_messages` : `ticket_id (FK CASCADE), author ('user'|'operator:<id>'|'system'), body, internal (0/1 — jamais renvoyé si 1), created_at`. Index `(ticket_id, created_at)`. **Aucun SQL destructif.**

### `@bot/shared`
- `flags.ts` : **`platform.support`** (catalogue, défaut off).
- `api-types/support.ts` : DTOs + **`supportPriorityForPlan(planId)`** pur (`free→low`, `premium→normal`, `business→high`). `SupportMessageAuthor` = `user|operator|system` (**jamais l'id opérateur**).

### Worker
- `db/queries/support.ts` : `insertSupportTicket`/`insertSupportMessage`, `getTicketForUser` (**scopé**), `listUserTickets` (paginé, scopé), `listClientMessages` (**`internal=0` uniquement**), `updateTicketStatusForUser`, `bumpTicketUpdatedAt`, **`listSupportQueue`** (priorité desc, ancienneté asc — consommée M12).
- `api/support.ts` : `GET/POST /api/support/tickets`, `GET /api/support/tickets/:id`, `POST …/:id/messages`, `PATCH …/:id` [fermeture]. Session, **scopé user**, flag `platform.support` (off → **404 `feature_disabled`**). Services `createTicket`/`buildTicketDetail`/`addClientMessage`/`closeClientTicket`/`resolveUserPlan` (**plan injecté** → testables). `resolveUserPlan` réutilise l'entitlement (respecte `platform.entitlements`, défaut Gratuit). Validation zod (sujet/corps bornés). Mutations loggées (télémétrie).
- `config/flags.ts` (+`platform.support` via `env.PLATFORM_SUPPORT`) ; `env.ts` (`PLATFORM_SUPPORT?`).

### Panel
- `VITE_PLATFORM_SUPPORT` → `platform.support`. `pages/app/Support.tsx` (lazy) : mes tickets, nouveau ticket (sujet + message, **aucun champ priorité**), fil (messages non internes), réponse, fermeture, signalement « plan modifié depuis l'ouverture ». Helpers purs `lib/support.ts`. Route `/app/support` + nav `AppLayout` **conditionnelles à `platform.support`** (sous `platform.entitlements`).

## Règles (backend = vérité)
- Priorité = `supportPriorityForPlan(resolveEffectiveEntitlement(user).planId)` à l'ouverture, **figée**. `planChangedSinceOpen` **calculé à la lecture** (plan effectif ≠ `plan_at_open`), **aucune écriture sur GET**.
- Réponse : append (`user`, non interne) ; `closed` → 409 ; `resolved` → réouverture (`open`). Fermeture client → `closed`. **Aucune suppression physique.**
- **Isolation** : lectures/mutations filtrées `user_id = session.userId` (ticket d'autrui → 404). `internal=1` exclu ; `assignee`/id opérateur jamais exposés.

## Fichiers (17 · +863 / −4)

```
 packages/worker/migrations/0036_support.sql | +39
 packages/shared/src/api-types/support.ts    | +63  (DTOs + supportPriorityForPlan pur)
 packages/shared/src/flags.ts                | +/-  (platform.support)
 packages/worker/src/db/queries/support.ts   | +148
 packages/worker/src/api/support.ts          | +187 (routes + services)
 packages/worker/src/config/flags.ts         | +1
 packages/worker/src/env.ts                  | +2
 packages/worker/src/index.ts                | +2   (montage supportRouter)
 packages/panel/src/pages/app/Support.tsx    | +212
 packages/panel/src/lib/support.ts           | +27
 packages/panel/src/App.tsx                  | +3   (route /app/support)
 packages/panel/src/layouts/AppLayout.tsx    | +9   (nav Support)
 packages/panel/src/lib/flags.ts             | +2   (VITE_PLATFORM_SUPPORT)
 packages/worker/test/support.test.ts        | +126 (9 tests)
 packages/panel/test/support.test.ts         | +36  (3 tests)
```
**Non touchés** : Gateway, `@bot/ui`, `wrangler.jsonc`, `package.json`, **lockfile**, migrations antérieures.

## Validations

| Vérification | Résultat |
|--------------|----------|
| Typecheck monorepo (`pnpm -r check`) | ✅ 5/5 |
| Tests panel | ✅ **114 / 22 fichiers** (avant M11 : 111/21 ; +3) |
| Tests Gateway | ✅ 207 (flag ajouté au catalogue, sans impact) |
| Tests Worker — `support` | ✅ **9/9** ; `billing`/`entitlements`/`account` ✅ (non-régression) |
| Build panel + budget | ✅ **152.9 kB / 180 kB** (page `/app/support` lazy) |
| Worker `deploy --dry-run` | ✅ |
| `git diff --check master..HEAD` | ✅ propre |
| Migration `0036` sur base propre | ✅ (via `readD1Migrations`) |

> **Limitation d'environnement** : suite Worker complète instable (loopback `ConnectEx`, **zéro échec d'assertion**) → suites par lots. `support` (D1 + session, **sans `fetchMock`**) passe de façon fiable.

## Couverture des tests (9 worker + 3 panel)
Priorité dérivée du plan (business→high) · **priorité figée** (perte de plan → reste high + `planChangedSinceOpen`) · **notes internes invisibles** (+ id opérateur masqué) · **isolation** (404 inter-user, liste scopée) · transitions (réponse, `closed`→409, réouverture d'un `resolved`, fermeture) · **file triée** (priorité desc, ancienneté asc) · résolution du plan effectif (flag off→free, on→business) · HTTP (401 sans session, 404 `feature_disabled` flag off) · `supportPriorityForPlan` pur + helpers + flag panel.

## Commits
| Hash | Message |
|------|---------|
| `d43f64b` | `docs(platform): M11 execution brief` (poussé seul sur `master` avant la branche) |
| `149c5b7` | `feat(worker): client support storage and API (plan-priced, scoped) (M11)` |
| `d28b0e8` | `feat(panel): client support experience behind flag (M11)` |
| `fb9e10a` | `test(platform): cover support priority, isolation and internal notes (M11)` |

## Confirmations
- **Aucune priorité fournie par le client** (dérivée backend) · **aucune confiance au plan frontend** · **`internal` jamais renvoyé** · `assignee`/opérateur jamais exposés · **isolation** user garantie (guild = métadonnée) · **aucune suppression physique** (statuts) · **aucun Studio / outil développeur** (assign/cross-guild = M12) · **aucune dépendance/lockfile** · **aucune migration distante** · **aucun déploiement** · **flag `platform.support` off en prod** · M12 non commencé.

## Rollback
- **Fonctionnel** : `platform.support` off → support masqué (repli contact simple) ; données conservées.
- **Code** : `git revert` de `master..feat/m11-client-support`. Migration `0036` **additive** (tables vides) → revert de code les laisse inutilisées ; **aucun `DROP`**.
