# Brief d'exécution — M11 · Support client

> Voir aussi : [milestones](../E4-milestones.md#m11--support-client) · [client](../../03-client-platform.md) · [studio](../../04-developer-studio.md) · [abonnements](../../06-subscriptions-and-entitlements.md) · [données](../../08-data-model.md) · [sécurité](../../09-security-model.md) · [E2 §5 (D9)](../E2-decision-fiches.md) · [brief M8](./M8-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m11-client-support` après commit + push de ce brief sur `master`. **Client uniquement — pas de Studio (M12), pas d'outil développeur.**

## 1. Contexte

- **Après M6/M8/M10** : moteur d'entitlements (`resolveEffectiveEntitlement`, M6), `GET /api/subscription` (plan effectif, défaut Gratuit), espace client `/app/*` sous `AppLayout` derrière `platform.entitlements` (M8 : `/app/subscription`, `/app/account` ; M9 : `/app/billing` derrière `platform.billing`). Auth : `requireSession`, endpoints user-level hors guilde. Pagination : `Paginated<T>` (`@bot/shared`). Priorité support **relative non-SLA** (E2 D9, doc 06) : Gratuit < Premium < Business, **figée à l'ouverture**.
- **But de M11** : **support client** — un utilisateur ouvre des tickets, liste **ses** tickets, consulte le fil (**messages non internes uniquement**), répond, ferme. La **priorité est calculée par le backend depuis le plan effectif** à l'ouverture, **figée** ensuite (perte de plan signalée, jamais déprioritisée). **Aucune** action opérateur (assignation, notes internes, vue cross-guilde = **Studio M12**).

## 2. Périmètre (autorisé)

- **Migration `0036_support`** (additive, locale) : `support_tickets`, `support_messages`.
- **`@bot/shared`** : `flags.ts` (+ `platform.support`), `api-types/support.ts` (DTOs + `supportPriorityForPlan` **pur**).
- **Worker** : `db/queries/support.ts` ; `api/support.ts` (`GET/POST /api/support/tickets`, `GET /api/support/tickets/:id`, `POST /api/support/tickets/:id/messages`, `PATCH /api/support/tickets/:id` [fermeture client]) — session, **scopé `userId`**, priorité du plan effectif, **`internal=1` jamais renvoyé** ; `config/flags.ts` (+`platform.support`) ; `env.ts` (`PLATFORM_SUPPORT?`).
- **Panel** : `VITE_PLATFORM_SUPPORT` ; `pages/app/Support.tsx` (mes tickets + nouveau + fil + réponse + fermeture) ; route `/app/support` + nav `AppLayout` **gardées par `platform.support`** (sous l'espace client).
- **Tests** : priorité figée, notes internes invisibles, isolation inter-user, file triée (priorité/ancienneté), flag off, `supportPriorityForPlan` pur.

## 3. Hors périmètre (interdit)

- ❌ **Studio / vue cross-guilde / assignation / notes internes créées ou lues côté client** = **M12**. Le schéma porte `assignee`/`internal` pour M12 ; M11 ne les expose ni ne les écrit côté client.
- ❌ **Priorité fournie par le client** (jamais) ; **confiance à un plan envoyé par le frontend** (jamais) — priorité = plan effectif backend.
- ❌ **Suppression physique** de ticket/message (statuts uniquement ; `closed`).
- ❌ Nouvelle dépendance ; secret ; migration distante ; déploiement ; migration destructive ; activation de flag en prod.
- ❌ Tout travail **M12**.

## 4. Modèle de données — migration `0036` (additive, [doc 08](../../08-data-model.md))

### `support_tickets`
`id` PK AUTOINCREMENT · `user_id` (snowflake) · `guild_id` (nullable, **métadonnée** — aucune donnée de guilde exposée) · `plan_at_open` (CHECK `free|premium|business`) · `priority` (CHECK `low|normal|high`, **dérivée du plan**, figée) · `subject` · `status` (CHECK `open|pending|resolved|closed`, défaut `open`) · `assignee` (nullable, opérateur — **M12**) · `plan_changed_since_open` (0/1, défaut 0) · `created_at` · `updated_at`.
Index : `(user_id, updated_at)` (mes tickets), `(status, priority, created_at)` (file — consommée par le Studio M12), `(assignee, status)`.

### `support_messages`
`id` PK AUTOINCREMENT · `ticket_id` (FK `support_tickets` ON DELETE CASCADE) · `author` (`user` | `operator:<id>` | `system`) · `body` · `internal` (0/1, défaut 0 ; **jamais renvoyé au client si 1**) · `created_at`.
Index : `(ticket_id, created_at)`.

**Aucun SQL destructif.** Priorité : `free→low`, `premium→normal`, `business→high` (`supportPriorityForPlan`).

## 5. Règles métier (backend = vérité)

- **Ouverture** : priorité = `supportPriorityForPlan(resolveEffectiveEntitlement(userId).planId)` ; `plan_at_open` = ce plan. Insère ticket (`open`) + 1er message (`author='user'`, `internal=0`).
- **Priorité figée** : jamais recalculée. À la **lecture**, `planChangedSinceOpen` = (plan effectif courant ≠ `plan_at_open`) — **calculé, non déprioritisant** (dérivé, aucune écriture sur lecture).
- **File d'attente** (helper, consommé M12) : `ORDER BY` rang de priorité **desc**, `created_at` **asc** (ancienneté — anti-famine).
- **Réponse client** : append message (`user`, `internal=0`) si ticket non `closed` ; `updated_at` bumpé ; un ticket `resolved` repasse `open` (réouverture).
- **Fermeture client** : `status='closed'` sur **son** ticket.
- **Isolation** : toute lecture/mutation filtrée par `user_id = session.userId` (ticket d'autrui → **404**). `internal=1` **exclu** des réponses client. `assignee` **jamais** exposé.

## 6. API (session, user-level, flag `platform.support`)

- `GET /api/support/tickets?page=&pageSize=` → `Paginated<SupportTicketSummary>` (scopé user, tri `updated_at` desc).
- `POST /api/support/tickets` `{ subject, body, guildId? }` → crée (priorité backend). Validation zod (longueurs bornées ; `guildId` snowflake optionnel).
- `GET /api/support/tickets/:id` → `SupportTicketDetail` (résumé + messages **non internes**), 404 si non-propriétaire.
- `POST /api/support/tickets/:id/messages` `{ body }` → append (404 si non-propriétaire ; 409 si `closed`).
- `PATCH /api/support/tickets/:id` `{ status: 'closed' }` → ferme (404 si non-propriétaire).
- Flag off ⇒ **404 `feature_disabled`**. Service `resolveUserSupportPlan` réutilise l'entitlement (respecte `platform.entitlements`). Mutations loggées (télémétrie `core`/write, requestId).

DTO (`api-types/support.ts`) : `SupportPriority`, `SupportTicketStatus`, `supportPriorityForPlan`, `SupportMessageAuthor` (`user|operator|system` — **jamais l'id opérateur**), `SupportTicketSummary`, `SupportMessageView`, `SupportTicketDetail`, `SupportTicketsListResponse`, `CreateSupportTicketRequest`, `CreateSupportMessageRequest`.

## 7. Panel `/app/support`

- `pages/app/Support.tsx` (lazy) sous `AppLayout` : liste (sujet, badge priorité, statut, date), **Nouveau ticket** (sujet + message), **détail** (fil des messages non internes, zone de réponse, bouton **Fermer**), états chargement/erreur/vide. `PlanBadge`/priorité réutilisent le style Nocturne. Route `/app/support` + nav (Support) **conditionnelles à `platform.support`** (sous `platform.entitlements`). **Aucun** champ « priorité » saisissable. Page **lazy** ⇒ budget initial inchangé.

## 8. Feature flag

- **`platform.support`** (nouveau, catalogue `@bot/shared`, **off** par défaut). Worker `env.PLATFORM_SUPPORT` ; panel `VITE_PLATFORM_SUPPORT` (build-time). Off ⇒ API `feature_disabled`, route/nav absentes ⇒ **repli = formulaire de contact simple** (hors périmètre code : la page n'apparaît pas). **Rollback** = flag off (conforme E4 M11).

## 9. Sécurité & isolation

- **Backend = vérité** : priorité **calculée** du plan effectif, **jamais** du frontend ; aucun champ priorité client.
- **Scope strict** `user_id = session.userId` (tickets + messages) ⇒ **aucune fuite inter-user** ; `guild_id` = simple métadonnée (aucune donnée de guilde lue) ⇒ **aucune fuite inter-guilde**.
- **`internal=1` jamais renvoyé** ; `assignee`/id opérateur jamais exposés.
- **Aucune suppression physique** (statuts). Mutations sensibles **loggées** (télémétrie) ; l'audit opérateur immuable = M14.
- Flag off par défaut.

## 10. Tests (`support.test.ts`, D1/session, sans `fetchMock`)

1. `supportPriorityForPlan` (free/premium/business → low/normal/high) — pur.
2. Ouverture : priorité = plan effectif (business→high) ; `plan_at_open` correct.
3. **Priorité figée** : ticket ouvert `business` (high) ; l'utilisateur perd le plan (effectif free) ⇒ ticket **reste high** + `planChangedSinceOpen=true`.
4. **Notes internes invisibles** : message `internal=1` **absent** du détail client.
5. **Isolation** : ticket d'un autre user ⇒ 404 (détail, réponse, fermeture) ; liste scopée.
6. Réponse : append ; `closed` ⇒ 409 ; réouverture d'un `resolved`.
7. Fermeture : `status='closed'`.
8. **File triée** (helper) : (priorité desc, ancienneté asc).
9. Pagination bornée ; validation (sujet/corps).
10. `GET/POST /api/support/*` exigent une session (401) ; flag off ⇒ 404 `feature_disabled`.

**Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `0036` s'applique sur base propre ; **additif**.
2. Ticket porte **plan/priorité d'ouverture** (backend) ; priorité **figée** ; `planChangedSinceOpen` signalé.
3. **Note interne invisible** au client ; `assignee`/opérateur jamais exposés.
4. **Isolation** stricte user (404 inter-user) ; guild = métadonnée ; aucune fuite.
5. File triée (priorité, ancienneté).
6. Flag `platform.support` off ⇒ support masqué/`feature_disabled` ⇒ aucune régression.
7. Aucune dépendance/migration distante/déploiement/suppression physique ; budget panel inchangé.
8. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.support` off → support masqué (repli contact simple) ; données conservées.
- **Code** : `git revert` de `master..feat/m11-client-support`. Migration `0036` **additive** (tables vides) → revert de code les laisse inutilisées ; **aucun `DROP`**.

## 13. Stratégie de commits (Conventional + réf `M11`)

```
docs(platform): M11 execution brief                                        # poussé seul sur master AVANT la branche
feat(worker): client support storage and API (plan-priced, scoped) (M11)   # migration + shared DTO + queries + api + flag
feat(panel): client support experience behind flag (M11)
test(platform): cover support priority, isolation and internal notes (M11)
docs(platform): M11 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M11-report.md` : modèle support, règles de priorité (figée), API, flag, isolation, budget, diffstat, hashes, commits, validations, confirmations (aucune priorité client/plan frontend/suppression physique/Studio/dépendance/déploiement/migration distante ; `internal` invisible ; flag off).

---

## Micro-décisions M11 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m11.1 | Flag | **`platform.support`** (nouveau, off) — nesté sous `platform.entitlements` pour la page |
| m11.2 | Priorité | 3 niveaux `low/normal/high` ← `free/premium/business`, **figée** à l'ouverture |
| m11.3 | `guild_id` | **Métadonnée optionnelle** (aucune donnée de guilde exposée) — pas de vérif Discord |
| m11.4 | Actions opérateur (assign/internal/cross-guild) | **M12** — schéma prêt, non exposé client |
| m11.5 | `planChangedSinceOpen` | **Calculé à la lecture** (dérivé, aucune écriture sur GET) |
| m11.6 | Suppression | **Aucune physique** — statut `closed` |
| m11.7 | Audit | **Télémétrie** (mutations loggées) ; audit opérateur immuable = M14 |
