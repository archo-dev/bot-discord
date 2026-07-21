# Brief d'exécution — M8 · Espace abonnement client

> Voir aussi : [milestones](../E4-milestones.md#m8--espace-abonnement-client) · [client](../../03-client-platform.md) · [abonnements](../../06-subscriptions-and-entitlements.md) · [brief M6](./M6-brief.md) · [brief M7](./M7-brief.md)

> ⚠️ **Brief, pas exécution.** Exécution sur branche `feat/m08-subscription-space` après commit + push de ce brief sur `master`.

## 1. Contexte

- **Après M6/M7** : `GET /api/subscription` (plan effectif, défaut Gratuit, M6), `GET /api/subscription/assignments` (emplacements used/available/suspended, M7), tous derrière `platform.entitlements`. Primitives panel prêtes : `PlanBadge` (M4), `SlotMeter`/`LockedFeature` (M7). L'app connectée = `GuildList` (`/`) + `GuildLayout` (`/guilds/:id/*`). Auth : `GET /api/me`, `POST /auth/logout`, `POST /auth/revoke-all` existants ; `SessionData` porte `createdAt`/`lastSeenAt`/`absoluteExpiresAt`.
- **But de M8** : livrer une **surface utilisateur** (sans paiement) — `/app/subscription` (plan effectif, emplacements, état ; changement d'offre = « bientôt » → `/pricing`) et `/app/account` (profil, session courante, déconnexion globale). **Aucun checkout, aucune mutation d'entitlement.** Derrière `platform.entitlements`.

## 2. Objectif utilisateur

Connecté, l'utilisateur voit **son plan effectif** et **ses emplacements** (utilisés/disponibles/suspendus), comprend l'état de son abonnement, et gère son compte (profil, session, « se déconnecter partout »). Aucune action de paiement (M9+). Aucune fuite de données d'un autre utilisateur.

## 3. Périmètre (autorisé)

- **`@bot/shared`** : DTO `AccountResponse` (`api-types/subscription.ts` ou `guild.ts`).
- **Worker** : `GET /api/account` (session requise, **niveau user, hors guilde**) — profil + métadonnées de la **session courante**. **Aucune** écriture, **aucune** nouvelle table.
- **Panel** : source de flag `platform.entitlements` (build-time `VITE_PLATFORM_ENTITLEMENTS`, défaut off) ; `layouts/AppLayout` (shell « espace client » : nav Serveurs/Abonnement/Compte) ; pages `pages/app/Subscription.tsx` + `pages/app/Account.tsx` (lazy) ; routes `/app/subscription` + `/app/account` **gardées par le flag** ; liens de nav conditionnels dans l'en-tête `GuildList`. Compose `PlanBadge`, `SlotMeter`, `LockedFeature`.
- **Tests** : worker `/api/account` (session, scope user, métadonnées, isolation) ; panel purs (résolution du flag, helpers d'affichage éventuels, non-régression routage).

## 4. Hors périmètre (interdit)

- ❌ **Paiement / checkout / billing / prestataire** (M9). Le CTA « Changer d'offre » pointe vers `/pricing` (« bientôt »), aucune action.
- ❌ **Mutation d'entitlement / de slot** ici (l'affectation vit dans M7 `/api/subscription/assignment`) — M8 est **lecture** + gestion de compte (déconnexion globale via l'endpoint existant).
- ❌ Nouvelle **migration** / table ; changement Gateway ; dépendance ; domaine ; secret ; migration distante ; déploiement ; activation du flag en prod.
- ❌ Listing exhaustif multi-sessions (pas d'index user→sessions ; M8 montre la **session courante** + « se déconnecter partout » = `POST /auth/revoke-all` existant).

## 5. Audit des fichiers réels

| Fichier | Rôle | Décision M8 | Risque |
|---------|------|-------------|--------|
| `packages/worker/src/api/guilds.ts` (`GET /me`) | Profil de session | **Modèle** pour `/api/account` (nouveau routeur `api/account.ts`) | Faible |
| `packages/worker/src/auth/session.ts` (`SessionData`) | `createdAt/lastSeenAt/absoluteExpiresAt` | **Réutiliser** (métadonnées session) | Nul |
| `packages/worker/src/auth/oauth.ts` (`/auth/revoke-all`) | Déconnexion globale | **Réutiliser** (bouton compte) | Nul |
| `packages/panel/src/lib/flags.ts` | Flags panel (publicSite) | **Étendre** : `platform.entitlements` (build-time) | Faible |
| `packages/panel/src/App.tsx` | Routage connecté | **Ajouter** `/app/*` gardé par flag | Faible |
| `packages/panel/src/pages/GuildList.tsx` | En-tête connecté | **Ajouter** liens nav (flag ON) | Faible |
| `components/PlanBadge.tsx`, `SlotMeter.tsx`, `LockedFeature.tsx` | Primitives | **Composer** | Nul |

## 6. API `GET /api/account` (lecture, session, hors guilde)

- Montée sous `/api` (`requireSession`), **hors `/guilds/:guildId`** (niveau user), comme `/api/subscription` (M6).
- Réponse `AccountResponse` : `{ id, username, globalName, avatar, session: { createdAt, lastSeenAt, expiresAt } }` (ISO 8601). Strictement la **session courante** (`c.get("session")`) ⇒ **aucune fuite inter-user**. Aucun `accessToken`/secret exposé.
- Handler mince (pas de service lourd) ; pas de D1.

## 7. Panel

- **`layouts/AppLayout.tsx`** : en-tête de marque + nav (Serveurs `/`, Abonnement `/app/subscription`, Compte `/app/account`) + avatar/nom + `<Outlet/>`. Responsive, a11y (`aria-current`), cohérent Nocturne. `<Suspense>` autour de l'Outlet.
- **`pages/app/Subscription.tsx`** (lazy) : `GET /api/subscription` → `PlanBadge` + libellé plan effectif + état (`source`, `endAt`, lifetime) ; `GET /api/subscription/assignments` → `SlotMeter` (used/available/suspended) + liste des serveurs affectés (état actif/suspendu) ; **CTA « Changer d'offre »** → `/pricing` (« bientôt », aucune action). Si `entitlementsEnabled=false` : afficher « Gratuit » + note « offres bientôt disponibles ». États chargement/erreur.
- **`pages/app/Account.tsx`** (lazy) : profil (avatar, nom, id), **session courante** (connecté depuis, dernière activité, expire le), bouton **« Se déconnecter partout »** (`POST /auth/revoke-all` → reload). États chargement/erreur.
- **Routage** (`App.tsx`) : `/app/subscription` + `/app/account` sous `AppLayout`, rendus **uniquement si `platform.entitlements` ON** (sinon catch-all `Navigate to "/"`). Liens nav dans `GuildList` conditionnels au flag. **Flag OFF ⇒ comportement identique à l'existant.**
- **Budget** : pages `/app/*` **lazy** (chunk séparé) → bundle initial **inchangé** ; `AppLayout`/pages non importés par le chunk initial.

## 8. Feature flag

- **`platform.entitlements`** (déjà au catalogue). Source panel **build-time** `VITE_PLATFORM_ENTITLEMENTS === "true"` (défaut off, absent en prod) — même mécanique que `VITE_PLATFORM_PUBLIC_SITE` (M2). OFF ⇒ routes `/app/*` absentes (catch-all `/`), nav masquée. **Rollback** = flag off (page masquée), conforme E4 M8.
- Côté données, `/api/subscription` renvoie déjà `entitlementsEnabled` (état du flag Worker) : la page reflète le plan réel (Gratuit si Worker off), sans dépendre du seul flag build-time.

## 9. Sécurité

- **Backend = vérité** : plan/slots recalculés serveur (M6/M7) ; l'UI ne décide rien.
- **`requireSession`**, niveau user, **scopé `session.userId`** ⇒ aucune fuite inter-user ; **aucune** surface par-guilde ⇒ aucun risque inter-guilde.
- Aucune donnée sensible exposée (`accessToken` jamais renvoyé) ; aucune mutation d'abonnement ; « se déconnecter partout » réutilise l'endpoint audité existant.

## 10. Tests

- **Worker — `account.test.ts`** (D1/session, **sans `fetchMock`**) : `GET /api/account` exige une session (401) ; renvoie profil + `session.{createdAt,lastSeenAt,expiresAt}` ISO ; **aucun `accessToken`/champ interne** ; deux sessions d'users distincts → chacune ne voit que la sienne (isolation).
- **Panel (purs)** : `getPlatformFlags` avec `VITE_PLATFORM_ENTITLEMENTS` (off défaut / on / invalide) ; helpers d'affichage éventuels (`lib/account` : formats de date session) ; non-régression `flags-panel`, `navigation`, `lazy-routes`.
- **Validations** : `pnpm -r check` ; panel/gateway verts ; worker par lots ; build panel + **budget ≤ 180 KiB** (pages lazy) ; `wrangler deploy --dry-run` ; `git diff --check`.

## 11. Critères d'acceptation

1. `GET /api/account` : session requise, scopé user, profil + session courante, **aucune fuite** ni secret.
2. `/app/subscription` (flag ON) : plan effectif (`PlanBadge`), emplacements (`SlotMeter`), état ; **aucune action de paiement** (CTA → `/pricing`).
3. `/app/account` (flag ON) : profil + session + « se déconnecter partout ».
4. Flag OFF ⇒ `/app/*` absents (catch-all `/`), nav masquée ⇒ **aucune régression**.
5. **Aucune migration/dépendance/changement Gateway/domaine/secret** ; budget initial inchangé (pages lazy).
6. `pnpm -r check` + suites concernées vertes ; dry-run OK ; `git diff --check` propre.

## 12. Rollback

- **Fonctionnel** : `platform.entitlements` (build panel) off → `/app/*` masqués.
- **Code** : `git revert` de `master..feat/m08-subscription-space`. Aucune migration/dépendance ⇒ revert net.

## 13. Stratégie de commits (Conventional + réf `M8`)

```
docs(platform): M8 execution brief                                    # poussé seul sur master AVANT la branche
feat(worker): account read endpoint (profile + current session) (M8)
feat(panel): client subscription & account space behind flag (M8)
test(platform): cover account endpoint and subscription space (M8)
docs(platform): M8 completion report
```
Chaque commit vert ; merge **fast-forward** après validation.

## 14. Rapport final attendu

`docs/platform-split/execution/reports/M8-report.md` : livré, API `/api/account`, pages, décision de flag, réutilisation des primitives, budget, diffstat, hashes, commits, validations, confirmations (aucun paiement/billing/migration/déploiement ; flag off ; aucune fuite inter-user).

---

## Micro-décisions M8 (défauts)

| # | Question | Défaut |
|---|----------|--------|
| m8.1 | Flag | **`platform.entitlements`** build-time (`VITE_PLATFORM_ENTITLEMENTS`) |
| m8.2 | Sessions | **Session courante** + « se déconnecter partout » (endpoint existant) ; pas d'index multi-sessions |
| m8.3 | Changer d'offre | **« Bientôt »** → `/pricing` (aucune action, billing = M9) |
| m8.4 | Emplacement des pages | **`/app/subscription`, `/app/account`** sous `AppLayout` |
| m8.5 | Nouvelle table ? | **Non** (M8 = lecture + réutilisation) |
