# Brief d'exécution — M2 · Shell public & couche de routes publiques

> Voir aussi : [milestones](../E4-milestones.md#m2--shell-public--routes-publiques) · [dépendances](../E5-dependencies-critical-path.md) · [stratégie git](../E6-branching-strategy.md) · [client](../../03-client-platform.md) · [UX/UI](../../10-ux-ui-direction.md) · [brief M1](./M1-brief.md)

> ⚠️ **Brief, pas exécution.** Décrit **quoi faire** en M2. **Aucun code écrit ici.** Exécution sur branche `feat/m02-public-shell` après validation.

## 1. Contexte

- **État après M1** : `@bot/ui` amorcé (tokens partagés + primitive `Badge`), mécanisme de **feature flags** dans `@bot/shared` (`PLATFORM_FLAGS`, `resolveFlags`, `isFlagEnabled`), **tous off par défaut**. M1 fusionné et publié.
- **Commit de référence** : `b4dfef4` (master synchronisé avec `origin/master`).
- **Architecture existante (réelle)** :
  - `packages/panel/src/main.tsx` : **data router à splat unique** `createBrowserRouter([{ path: "*", element: <App/> }])` (requis par `useBlocker`/SaveBar).
  - `packages/panel/src/App.tsx` : **gate d'auth implicite** — `useQuery(["me"])` sur `/api/me` ; `isPending` → squelette ; `401` → `<Landing/>` (seule surface publique) ; succès → `<Routes>` (`/` = `GuildList`, `/guilds/:guildId/*` = `GuildLayout` + pages modules, `*` → `Navigate to="/"`).
  - `packages/panel/src/pages/Landing.tsx` : page publique autonome (header Wordmark + « Ouvrir le panel », hero, modules, footer), consomme `/api/invite`.
  - `packages/panel/src/pages/GuildLayout.tsx` : shell connecté (sidebar `NAV_GROUPS`, header, drawer mobile avec focus-trap, footer utilisateur).
  - **Worker** : `packages/worker/wrangler.jsonc` → `assets.not_found_handling: "single-page-application"`, `run_worker_first` = `/api/*`,`/auth/*`,`/interactions`,`/internal/*`,`/health`,`/`,`/index.html`,`/assets/*`. **Conséquence clé : tout nouveau chemin client (ex. `/pricing`) est servi par le fallback SPA → `index.html`, sans aucune modification Worker.**
- **But de M2** : poser les **fondations du shell public et de la navigation publique** — séparation propre entre routes publiques / espace connecté / layouts / navigation / routage / garde de flag — **sans construire la landing commerciale complète** (c'est M3) et **sans toucher l'app connectée**.

## 2. Objectif utilisateur

Rendre possible (uniquement quand le flag `platform.publicSite` est activé, donc **pas en production**) : naviguer sur un **espace public minimal** servi **sans session** — un shell cohérent (en-tête de marque + navigation + pied de page) avec des pages **placeholder** (`/features`, `/pricing`, `/updates`, `/status`, `/legal/*`) et un accès clair à la connexion Discord. **Aucun bénéfice visible en production** à ce stade : M2 est un socle. La valeur réelle (contenu marketing) arrive en M3–M5.

## 3. Périmètre (changements autorisés)

- **Panel uniquement.** Introduire :
  - une **taxonomie de routes** (module pur : ensemble des chemins publics + décision de shell).
  - une **source de flag côté panel** pour `platform.publicSite` (build-time Vite, off par défaut).
  - un **`PublicLayout`** (en-tête + navigation + pied de page + `<Outlet/>`) et ses composants (`PublicHeader`, `PublicNav`, `PublicFooter`).
  - des **pages publiques placeholder** minimales (features, pricing, updates, status, legal) — **pas** de contenu marketing final.
  - le **câblage dans `App.tsx`** d'une branche publique **gardée par le flag**, **additive**, sans modifier l'arbre connecté.
  - des **tests unitaires** (taxonomie, décision de shell, flag) + non-régression.
- **URLs existantes préservées** : `/`, `/guilds/:guildId/*` inchangées ; les chemins publics sont **nouveaux et additifs**.

## 4. Hors périmètre (interdictions)

- ❌ Billing, entitlements, offres payantes actives, Studio développeur.
- ❌ Migration D1, changement Worker/`wrangler.jsonc`, changement Gateway, logique métier Discord.
- ❌ Domaine custom (on reste sur `*.workers.dev`), secrets, déploiement, push.
- ❌ Dépendance, lockfile, renommage de package (`panel` **reste** `panel` — voir §Contradiction).
- ❌ **Landing commerciale complète** (M3), pages marketing riches, `/pricing` réel avec prix (M4), vraies notes de mise à jour (M5).
- ❌ Refonte visuelle du panel connecté, refonte du routing (« big bang »), suppression de routes existantes.
- ❌ Extraction prématurée de composants vers `@bot/ui` (aucun nouvel export `@bot/ui` requis en M2 — voir §9).
- ❌ **Activation de `platform.publicSite` en production.**

## 5. Audit du dépôt (fichiers réels concernés)

| Fichier | Rôle actuel | Problème / manque pour M2 | Décision recommandée | Risque |
|---------|-------------|---------------------------|----------------------|--------|
| `packages/panel/src/main.tsx` | Data router splat unique | Aucun (le splat couvre déjà toute route) | **Ne pas modifier** | Nul |
| `packages/panel/src/App.tsx` | Gate implicite + `<Routes>` connecté | Pas de couche publique ; 401 → Landing bloque toute autre route | **Modifier a minima** : brancher une branche publique **gardée par flag**, garder le comportement flag-off identique | Moyen (cœur du routage) → couvert par tests de caractérisation |
| `packages/panel/src/pages/Landing.tsx` | Page publique autonome (header+footer inline) | Réutilisable comme home public mais chrome dupliqué si mis sous `PublicLayout` | **Extraire le corps** en `LandingContent` (sans header/footer) ; `Landing` = wrapper autonome conservé pour le flag-off | Faible |
| `packages/panel/src/pages/GuildLayout.tsx` | Shell connecté | Aucun (ne pas toucher) | **Ne pas modifier** ; s'en inspirer pour le focus-trap mobile public | Nul |
| `packages/panel/src/lib/queryClient.ts` / `api.ts` | Data-fetching, `["me"]` | `["me"]` utile pour l'état de connexion du header public | **Réutiliser** (le header public lit `["me"]` : 401 = déconnecté) | Faible |
| `packages/worker/wrangler.jsonc` | SPA fallback | — | **Ne pas modifier** (fallback SPA suffit) | Nul |
| `packages/panel/test/navigation.test.ts` / `lazy-routes.test.ts` | Tests nav/chunks (purs) | Doivent rester verts | **Ne pas casser** ; ajouter des tests publics à part | Faible |
| `packages/shared/src/flags.ts` | Catalogue + `resolveFlags` (M1) | Pas encore sourcé côté panel | **Réutiliser** ; ajouter une source panel (build-time) | Faible |

## 6. Architecture cible M2

**Principe : additif, gardé par flag, réversible. Flag OFF ⇒ comportement identique à master.**

### Arbre de routes (flag ON)

```
/                         → (déconnecté) PublicLayout > Home (LandingContent)     [flag ON]
                            (connecté)   GuildList                                 [inchangé]
/features                 → PublicLayout > FeaturesStub          [flag ON, sinon → /]
/pricing                  → PublicLayout > PricingStub           [flag ON, sinon → /]
/updates                  → PublicLayout > UpdatesStub           [flag ON, sinon → /]
/status                   → PublicLayout > StatusStub            [flag ON, sinon → /]
/legal/mentions|privacy   → PublicLayout > LegalStub             [flag ON, sinon → /]
/guilds/:guildId/*        → GuildLayout + pages modules          [INCHANGÉ]
*                         → Navigate to "/"                       [INCHANGÉ]
```

- **Flag OFF (défaut, production)** : les chemins publics **n'existent pas** côté routage → ils retombent sur le catch-all `Navigate to="/"` **exactement comme aujourd'hui** ; `/` garde la gate implicite (401 → `Landing` autonome). **Zéro changement observable.**
- **Layouts** : `PublicLayout` (public) vs `GuildLayout` (connecté) — deux shells distincts, aucun partage forcé.
- **Guards** : la garde publique = **le flag** (rendu conditionnel) ; la gate connectée (`["me"]` 401) reste la garde de l'espace connecté.
- **Décision de shell** : extraite dans une **fonction pure** `resolveShell(pathname, { publicSite })` → `"public" | "connected"` (testable en node, sans DOM), pour garder `App.tsx` mince et le comportement vérifiable.
- **Fallback** : toute route inconnue → `Navigate to="/"` (inchangé).
- **Compatibilité** : l'app connectée (`/`, `/guilds/:guildId/*`) est **strictement inchangée**.

## 7. Lots d'implémentation

- **Lot A — Caractérisation & taxonomie** : tests de **caractérisation** figeant le comportement flag-off (public path → redirect `/`, 401 → Landing) ; module pur `src/lib/public-routes.ts` (liste `PUBLIC_PATHS`, `isPublicPath`, `resolveShell`) + tests.
- **Lot B — Source de flag panel** : `src/lib/flags.ts` — lit `import.meta.env.VITE_PLATFORM_PUBLIC_SITE` (défaut absent = off) et appelle `resolveFlags` de `@bot/shared` ; expose `usePlatformFlags()`/`getPlatformFlags(env?)` **injectable pour les tests** ; off par défaut ; tests on/off.
- **Lot C — PublicLayout & shell** : `PublicLayout` + `PublicHeader` (Wordmark + nav + état de connexion via `["me"]`) + `PublicNav` + `PublicFooter` ; extraction de `LandingContent` depuis `Landing.tsx`.
- **Lot D — Pages stub & câblage `App.tsx`** : pages placeholder minimales (features/pricing/updates/status/legal), **lazy-loadées** ; branche publique dans `App.tsx` **gardée par le flag**, additive.
- **Lot E — Navigation responsive & a11y** : menu mobile du `PublicHeader` (disclosure + focus, inspiré du drawer `GuildLayout`), états actifs (`aria-current`), `focus-visible`, `prefers-reduced-motion`.
- **Lot F — Tests, budget & doc** : suite complète, contrôle budget, `wrangler deploy --dry-run`, rapport `execution/reports/M2-report.md`.

## 8. Fichiers probables

**Créés (panel) :**
- `packages/panel/src/lib/public-routes.ts` — taxonomie + `resolveShell` (pur). *Cœur testable.*
- `packages/panel/src/lib/flags.ts` — source panel du flag (build-time), injectable.
- `packages/panel/src/layouts/PublicLayout.tsx` — shell public (Outlet).
- `packages/panel/src/components/public/PublicHeader.tsx`, `PublicNav.tsx`, `PublicFooter.tsx`.
- `packages/panel/src/pages/public/{Features,Pricing,Updates,Status,Legal}.tsx` — **stubs** minimaux.
- `packages/panel/src/pages/LandingContent.tsx` — corps de Landing extrait (partagé Landing ⇄ Home public).
- `packages/panel/test/public-routes.test.ts`, `flags-panel.test.ts`, `public-shell.test.ts` — tests purs.

**Modifiés (panel) :**
- `packages/panel/src/App.tsx` — branche publique gardée par flag (additive).
- `packages/panel/src/pages/Landing.tsx` — délègue son corps à `LandingContent` (comportement flag-off identique).

**NON modifiés :** `packages/worker/*`, `packages/gateway/*`, `packages/ui/*` (aucun nouvel export), `packages/shared/*` (le mécanisme M1 suffit), `package.json`, `pnpm-lock.yaml`, `migrations/*`, `wrangler.jsonc`, `main.tsx`.

## 9. UX/UI

- **Desktop** : `PublicHeader` — Wordmark à gauche (réutilise `ui/brand.tsx`), nav horizontale (Fonctions, Tarifs, Mises à jour, Statut) au centre/droite, bouton d'action à droite (« Se connecter » → `/auth/login` si déconnecté ; « Ouvrir le panel » → `/` si connecté). `PublicFooter` sobre (liens produit/légal/statut + mention). Conteneur `max-w-6xl` cohérent avec Landing.
- **Mobile** : nav repliée en menu (disclosure) avec ouverture/fermeture au clavier, **focus géré** (piste : réutiliser le patron focus-trap de `GuildLayout`), fermeture à `Échap`.
- **Header/Footer** : réutilisent **tokens Nocturne** (`@bot/ui/theme.css`) et primitives existantes (`Button`, `Icon`, `Wordmark`) — **aucune nouvelle couleur**, aucun asset lourd.
- **Accessibilité** : landmarks (`<header>`, `<nav aria-label>`, `<main>`, `<footer>`), `aria-current="page"` sur l'onglet actif, anneaux `focus-visible`, cibles tactiles ≥ 44 px, `prefers-reduced-motion` respecté.
- **États actifs** : lien courant surligné (même logique que les onglets `GuildLayout`).
- **Responsive** : mobile-first ; le shell public ne casse jamais la largeur (`max-w-full`, overflow maîtrisé).
- **Cohérence avec le panel** : même marque, même palette, même typographie — la transition public → connecté ne doit pas paraître deux sites ([doc 03](../../03-client-platform.md)).
- **Stubs** : chaque page placeholder affiche un titre + une phrase « Bientôt » + un CTA vers `/auth/login` ou `/` — **pas** de contenu marketing.

## 10. Feature flag

- **Clé** : `platform.publicSite` (déjà déclarée dans `@bot/shared`, défaut `false`).
- **Source (M2)** : **build-time Vite** — `import.meta.env.VITE_PLATFORM_PUBLIC_SITE === "true"`. Wrappé par `src/lib/flags.ts` qui appelle `resolveFlags({ "platform.publicSite": … })`. **Choix retenu** : build-time (zéro changement backend, réversible). Le branchement **runtime** (vars Worker → `/api/me` → panel) est **différé** (quand un flag devra être togglé sans rebuild) — voir §Décisions.
- **Comportement OFF (défaut, prod)** : routes publiques absentes → catch-all `Navigate to="/"` ; gate implicite intacte → **comportement identique à master**.
- **Comportement ON (dev/preview uniquement)** : routes publiques rendues via `PublicLayout`.
- **Tests** : `getPlatformFlags(env)` testé sur env vide (off), `VITE_PLATFORM_PUBLIC_SITE="true"` (on), valeur invalide (off) ; `resolveShell` testé pour les deux états.
- **Rollback** : ne rien définir (défaut off) ; ou revert de branche.
- **Absence d'activation en production** : le build de prod **ne définit pas** `VITE_PLATFORM_PUBLIC_SITE` → off. À **vérifier explicitement** dans le rapport M2.

## 11. Compatibilité OAuth

- **Login** : liens vers `/auth/login` (inchangé) depuis `PublicHeader` et les stubs. **Ne pas** modifier `packages/worker/src/auth/*`.
- **Callback** : `/auth/callback` inchangé ; retour vers `/` après session (comportement worker existant).
- **Redirections** : le flag OFF conserve la redirection catch-all → `/` ; le flag ON n'altère jamais `/auth/*`.
- **Session** : le `PublicHeader` lit `["me"]` (401 = déconnecté → « Se connecter » ; succès → « Ouvrir le panel »). Aucune écriture de session côté panel.
- **Deep links** : un chemin public profond (`/pricing`) est servi par le fallback SPA (index.html) → React route côté client ; un deep link connecté (`/guilds/:id/...`) en 401 → **Landing** (inchangé).
- **Erreur auth** : gestion existante (`ErrorCard` sur erreur non-401) **inchangée**.
- **Retour vers la route initiale après login** : **hors périmètre M2** (le worker redirige vers `/`) — noté comme amélioration future, à ne pas introduire ici.

## 12. Tests obligatoires

- **Unitaires (purs, node)** : `public-routes` (taxonomie, `isPublicPath`, `resolveShell` off/on), `flags-panel` (off défaut, on, invalide).
- **Routing / navigation** : caractérisation flag-off (public → `/`, 401 → Landing) ; `navigation.test.ts` et `lazy-routes.test.ts` **restent verts**.
- **OAuth non régressif** : aucun fichier `/auth` modifié ; suites Worker **vertes** (289).
- **Responsive / a11y** : vérifs structurelles possibles en pur (présence landmarks/aria dans les composants via tests légers) ; contrôle visuel manuel documenté (pas de jsdom dans le repo).
- **Build** : `pnpm --filter @bot/panel build` OK.
- **Budget bundle** : **≤ 180 KiB gzip** (stubs lazy-loadés ; vérifier la marge).
- **Worker `wrangler deploy --dry-run`** : OK (assets buildés).
- **Monorepo complet** : `pnpm -r check` + tests Gateway (207) + Worker (289) + Panel (≥ 53 + nouveaux).

## 13. Critères d'acceptation (mesurables)

1. **Flag OFF** : comportement panel **identique à master** — public paths → `Navigate to="/"`, 401 → `Landing` ; `navigation.test.ts`/`lazy-routes.test.ts` verts.
2. **Flag ON (build dev)** : `/features`,`/pricing`,`/updates`,`/status`,`/legal/*` rendent `PublicLayout` **sans session** ; `/` déconnecté rend la home publique ; `/guilds/:id/*` et `/` connecté **inchangés**.
3. `resolveShell` et la taxonomie sont **couverts** par des tests purs (off + on).
4. **Aucun** changement Worker/Gateway/`@bot/ui`/migration/dépendance/lockfile/`wrangler.jsonc`.
5. **Budget ≤ 180 KiB gzip** (build passe).
6. `pnpm -r check` vert ; toutes les suites vertes ; `wrangler deploy --dry-run` OK.
7. `platform.publicSite` **non activé** dans le build de production (vérifié).

## 14. Rollback

- **Fonctionnel** : flag off par défaut → aucune surface publique active ; rien à désactiver.
- **Code** : `git revert` de la plage `master..feat/m02-public-shell` (branche isolée). Aucune migration, aucune dépendance → revert net.
- **Repli de périmètre** : si l'extraction `LandingContent` s'avère risquée, garder `Landing.tsx` **intact** et faire pointer la home publique (flag ON) directement sur `Landing` autonome (léger doublon de chrome accepté sur la home ; stubs restant sous `PublicLayout`).

## 15. Stratégie de commits (Conventional + réf `M2`, ordre `CLAUDE.md`)

```
test(panel): characterization + public route taxonomy (M2)
feat(panel): platform.publicSite flag source (build-time, off default) (M2)
feat(panel): public layout & shell (header/nav/footer, LandingContent) (M2)
feat(panel): public route stubs behind flag + App wiring (M2)
test(panel): public routing/nav tests + budget (M2)
```

- Chaque commit **fonctionnel et testé** ; ≤ ~400 lignes de diff significatif ; M2 global reste **M**.
- Merge en fast-forward après validation complète + contrôle visuel (flag ON en dev).

## 16. Rapport final attendu (après implémentation)

`docs/platform-split/execution/reports/M2-report.md` avec : branche, HEAD initial/final, architecture retenue, décision de source de flag, taxonomie/`resolveShell`, composants publics créés, `LandingContent`, fichiers modifiés, résultats (typecheck, tests @bot/ui/panel/gateway/worker, builds, dry-run), **budget avant/après**, diffstat, hashes, messages de commit, état Git, et confirmations : aucun code produit non prévu, aucune migration, aucune dépendance, aucun changement Worker/Gateway/`@bot/ui`, aucun déploiement, aucun push, **flag off en prod**.

---

## Contradictions relevées & résolution

1. **E4 M2 mentionne « [différé/optionnel] renommage `packages/panel` → `client-web` »** et **« remplace la gate implicite `["me"]` »**, alors que les contraintes exigent aucun renommage et aucune suppression de routes.
   - **Résolution (la plus sûre, à acter)** :
     - **Pas de renommage** en M2 (`panel` reste `panel`, cf. D28 différé) — le renommage n'est ni requis ni souhaitable ici.
     - **Ne pas *remplacer* la gate implicite, la *compléter*** : la couche publique est **additive et gardée par flag** ; la gate `["me"]` reste la garde de l'espace connecté et **le comportement flag-off est identique à master**. Le remplacement total de la gate est **différé** (jusqu'à ce que l'app connectée migre sous `/app`, prévu bien plus tard — hors M2).
   - Aucune autre contradiction détectée entre E4/E5/03/10 et l'orientation M2.

## Micro-décisions M2 (défauts proposés, confirmables au démarrage)

| # | Question | Défaut proposé | Impact |
|---|----------|----------------|--------|
| m2.1 | Source du flag | **Build-time Vite (`VITE_PLATFORM_PUBLIC_SITE`)** ; runtime différé | Lot B |
| m2.2 | `LandingContent` extrait ? | **Oui** (partagé Landing ⇄ home) ; repli = Landing intact | Lot C/§14 |
| m2.3 | Home publique (`/` déconnecté, flag ON) | **`PublicLayout` > `LandingContent`** | Lot C/D |
| m2.4 | Contenu des stubs | **Placeholder « Bientôt » + CTA**, pas de marketing | Lot D |
| m2.5 | Nouvel export `@bot/ui` ? | **Non** (chrome public reste dans le panel) | §9 |
| m2.6 | Retour vers route initiale post-login | **Hors M2** (redirection worker vers `/` conservée) | §11 |

> Aucune de ces micro-décisions n'est irréversible ; elles se confirment à l'ouverture de `feat/m02-public-shell`.
