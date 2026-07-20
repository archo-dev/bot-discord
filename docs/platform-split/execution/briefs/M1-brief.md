# Brief d'exécution — M1 · Fondations & design system

> Voir aussi : [milestones](../E4-milestones.md#m1--fondations--design-system) · [dépendances](../E5-dependencies-critical-path.md) · [stratégie git](../E6-branching-strategy.md) · [UX/UI](../../10-ux-ui-direction.md)

> ⚠️ **Brief, pas exécution.** Ce document décrit **quoi faire** en M1 ; **aucun code n'est écrit ici**. Il sera exécuté sur une branche dédiée après validation.

## 0. Décisions validées applicables à M1

| Décision | Choix | Effet sur M1 |
|----------|-------|--------------|
| Roadmap ([E4](../E4-milestones.md)) | **Validée telle quelle** | On exécute M1 tel que spécifié |
| Hébergement (D17/A1) | **`*.workers.dev` d'abord**, bascule `archodev.fr`/`studio.archodev.fr` plus tard | M1 **ne crée aucun domaine** ; rien à changer côté DNS/OAuth en M1 |
| Nom du plan intermédiaire (D16) | **Premium** | Les **constantes de plan** posées en M1 utilisent `display_name = "Premium"` (clé technique `premium` inchangée) |

## 1. Objectif

Poser le **socle commun** sans aucun risque produit : amorcer le package **`@bot/ui`** (tokens + primitives réellement partagées) et introduire un **mécanisme de feature flags** de déploiement (défaut **off** = comportement actuel). Aucune fonctionnalité utilisateur, aucune surface nouvelle.

**Résultat attendu** : le panel reste **strictement identique** (visuel + comportement), mais il consomme désormais `@bot/ui` pour ≥1 primitive et les tokens, et un flag est activable/désactivable proprement.

## 2. Non-objectifs (exclusions explicites)

- ❌ **Aucun** renommage de package (`panel` reste `panel` — D28 différé).
- ❌ **Aucun** domaine custom, **aucun** nouveau Worker, **aucune** route.
- ❌ **Aucune** migration D1, **aucun** modèle d'entitlements (c'est M6).
- ❌ **Aucune** logique de plan/billing/gating (M4/M6/M7/M9).
- ❌ **Aucune** extraction du kit complet : on extrait **les tokens + 1–2 primitives découplées seulement**.
- ❌ **Ne pas** déplacer les composants couplés (`entity-select`, `savebar`, `combobox`, `charts`, microcopie) — ils restent applicatifs ([doc 02](../../02-product-architecture.md)).

## 3. État réel du dépôt (constaté)

- Monorepo `packages/*`, `pnpm@10.13.1`, TS strict (`tsconfig.base.json` : `noEmit`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `noUncheckedIndexedAccess`).
- **`@bot/shared`** = package **TS brut** : `exports: { ".": "./src/index.ts" }`, `check: tsc --noEmit`, consommateurs le **bundlent**. → **`@bot/ui` doit suivre ce même pattern.**
- **Panel** : React 19, Vite 6, **Tailwind v4 CSS-first** (`@tailwindcss/vite`, pas de `tailwind.config.js`), Recharts. `build = vite build && node scripts/check-bundle-budget.mjs`.
- **Tokens** : `packages/panel/src/index.css` (399 lignes) — bloc **`@theme`** (remap des échelles `zinc`/`indigo`, `--radius-*`, `--font-*`) + bloc **`:root`** (sémantiques `--bg-*`, `--surface-*`, `--primary*`, `--viz-*`, `--text-*`, `--aurora`, `--shadow-vault`). Primaire « Aurora Iris » `#6b4ef2`.
- **Kit UI** : barrel `packages/panel/src/ui/kit.tsx` → `export * from "./kit/{buttons,forms,surfaces,feedback,navigation,layout,segmented}.js"`. Autres : `toast`, `overlay`, `savebar`, `skeleton`, `icons`, `brand`, `error-boundary`, etc.
- **Budget** : `BUNDLE_BUDGET_GZIP_BYTES = 184320` (180 KiB), le build **échoue** au-delà.
- **Aucun** mécanisme de feature-flag de plateforme aujourd'hui (les « flags » trouvés sont des bits Discord / message flags, sans rapport).

## 4. Périmètre découpé en lots

### Lot A — Scaffolding `packages/ui` (`@bot/ui`)  · S

Créer un package **TS brut** calqué sur `@bot/shared` :

- `packages/ui/package.json` : `name: "@bot/ui"`, `private: true`, `type: module`, `exports` incluant l'entrée TS et le CSS de thème (ex. `"."` → `./src/index.ts`, `"./theme.css"` → `./src/theme/tokens.css`), `scripts.check = "tsc --noEmit"`. **React en `peerDependencies`** (+ `devDependencies` pour le typecheck) — les consommateurs fournissent React.
- `packages/ui/tsconfig.json` : `extends ../../tsconfig.base.json`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`, `types: ["react"]`, `include: ["src"]`.
- `packages/ui/src/index.ts` : barrel initial (vide → primitives du Lot C).
- Ajouter `"@bot/ui": "workspace:*"` aux `dependencies` de `packages/panel/package.json`.

> ⚠️ **Attendu à l'implémentation** : l'ajout du package + dépendance `workspace:*` **modifiera `pnpm-lock.yaml`** (normal et acceptable **au moment de coder M1**, hors de ce brief).

### Lot B — Extraction des design tokens vers `@bot/ui`  · M (spike en premier)

- **Spike Tailwind v4 (à faire en tout premier)** : vérifier que déplacer le bloc de tokens dans `packages/ui/src/theme/tokens.css` puis l'`@import` depuis `packages/panel/src/index.css` (après `@import "tailwindcss";`) **conserve** le fonctionnement du `@theme` (remap `zinc`/`indigo`) et des utilitaires. Tailwind v4 doit voir le CSS importé.
  - **Si le spike passe** : `tokens.css` devient la **source canonique** ; `index.css` du panel ne garde que l'import + le spécifique app.
  - **Si le spike échoue / est fragile** : **repli** — garder les tokens dans le panel pour M1, n'extraire que les **primitives** (Lot C), et re-planifier l'extraction des tokens en tâche dédiée. **Ne pas** forcer une extraction qui casserait silencieusement le reskin ([piège Tailwind v4 : `bg-(--var)` OK, `bg-[--var]` ignoré silencieusement](../../../../CLAUDE.md)).
- Contrôle **visuel** obligatoire : le panel doit être **pixel-identique** avant/après (pages clés : landing, liste serveurs, une page module, une modale).

### Lot C — Extraire 1–2 primitives découplées  · S/M

- **Critère de sélection** : primitive **présentationnelle pure**, sans dépendance `react-router`, `AccessContext`, ni domaine Discord.
- **Candidats recommandés (dans l'ordre)** : (1) une primitive « feuille » simple (badge / pastille d'état) pour **prouver le pipeline** ; (2) **boutons** (`ui/kit/buttons.tsx`) si le spike token est vert et que le découplage est trivial.
- Méthode : déplacer la primitive dans `packages/ui/src/…`, l'exporter du barrel `@bot/ui`, remplacer l'usage côté panel par l'import `@bot/ui`, **supprimer** l'ancienne définition (pas de doublon).
- **Périmètre minimal assumé** : viser **1** primitive fiable plutôt que 2 fragiles. E4 dit « 1–2 » → **1 suffit** pour valider M1.

### Lot D — Mécanisme de feature flags (plateforme)  · S/M

- **Emplacement** : `@bot/shared` (frontière de types partagée worker/panel/gateway), ex. `packages/shared/src/flags.ts`.
- **Contenu** :
  - un **catalogue typé** de flags de rollout (ex. `platform.publicSite`, `platform.entitlements`, `platform.billing` — **tous défaut `false`**), avec description.
  - une fonction **pure** `resolveFlags(source): FlagState` (défaut off ; `source` = objet de config injecté, ex. vars Worker), **testable unitairement**.
  - export via le barrel `@bot/shared`.
- **Périmètre M1** : livrer **le mécanisme + les tests**, PAS le plombage complet (le branchement `worker vars → /api/me → panel` se fera quand un flag sera réellement utilisé, dès M2). Le panel peut lire un `resolveFlags` avec source vide (tout off) sans changer de comportement.
- **Justification** : introduire le mécanisme tôt (E4/[E5](../E5-dependencies-critical-path.md)) rend chaque brique SaaS activable/rollback par flag.

## 5. Packages touchés

| Package | Nature du changement |
|---------|----------------------|
| `packages/ui` | **Neuf** (scaffolding, tokens, primitive(s), barrel) |
| `packages/panel` | Ajout dép `@bot/ui`, `index.css` importe les tokens, ≥1 import de primitive migré |
| `packages/shared` | Ajout `src/flags.ts` + export barrel |
| racine | `pnpm-lock.yaml` régénéré (à l'implémentation) ; éventuel ajout au script `check` (déjà `pnpm -r check`, donc automatique) |

## 6. D1 / Routes / API / Sécurité / Observabilité

- **D1** : **aucun** changement (pas de migration).
- **Routes / API** : **aucune**.
- **Sécurité** : **aucune** surface nouvelle (pas de session, pas d'endpoint).
- **Observabilité** : **aucune** (socle).

## 7. Tests & vérification (obligatoires avant merge)

Sous PowerShell, préfixer le PATH d'abord (piège projet) :

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
pnpm -r check                    # typecheck tous packages, dont @bot/ui
pnpm --filter @bot/panel build   # build + budget 180 KiB (doit passer)
pnpm --filter @bot/shared check   # flags.ts typé
pnpm --filter @bot/worker test   # non-régression (aucune raison de casser)
```

Plus :
- **Test unitaire** de `resolveFlags` (défaut off, source partielle, valeurs typées) — auto-suffisant (piège vitest-pool-workers : rollback D1/KV entre tests).
- **Contrôle visuel** panel identique (Lot B/C).
- `git diff --check` propre.

## 8. Critères d'acceptation

1. `@bot/ui` existe, **typecheck vert**, consommé par le panel pour **les tokens** (si spike OK) **et ≥1 primitive**.
2. Le panel est **visuellement et fonctionnellement identique** (aucune régression).
3. **Budget 180 KiB gzip tenu** (le build passe).
4. Catalogue de flags **typé**, `resolveFlags` **pur et testé**, défaut **off** partout.
5. Aucune migration, aucune route, aucun domaine, aucun renommage.
6. `pnpm -r check` vert.

## 9. Rollback

- **Code** : `git revert` du merge de la branche `feat/m01-foundations` (branche isolée = revert net) ; le panel retrouve ses tokens/primitives locaux.
- **Fonctionnel** : les flags étant **off par défaut**, aucun comportement n'est activé → rien à désactiver.
- **Repli Lot B** : si l'extraction des tokens s'avère fragile, livrer M1 **sans** extraction de tokens (primitive + flags seulement) et replanifier.

## 10. Plan de branche & commits (cf. [E6](../E6-branching-strategy.md))

- **Branche** : `feat/m01-foundations`.
- **Commits** (Conventional + réf `M1`, ordre d'implémentation `CLAUDE.md`) :

```
feat(shared): catalogue de feature flags + resolveFlags (M1)
test(shared): résolution des flags (défaut off) (M1)
chore(ui): scaffolding package @bot/ui (TS brut, pattern @bot/shared) (M1)
feat(ui): extraction des design tokens Nocturne (M1)      # si spike OK
feat(ui): première primitive partagée + barrel (M1)
refactor(panel): consommer @bot/ui (tokens + primitive) (M1)
```

- **Taille** : viser ≤ ~400 lignes de diff significatif par commit ; M1 global reste **M**.
- **Merge** : après tests verts + contrôle visuel ; historique linéaire.

## 11. Micro-décisions M1 (défauts proposés, confirmables au démarrage)

| # | Question | Défaut proposé | Impact |
|---|----------|----------------|--------|
| m1.1 | Extraire les tokens en M1 ou repli si fragile ? | **Tenter le spike ; repli si fragile** | Périmètre Lot B |
| m1.2 | Quelle(s) primitive(s) extraire d'abord ? | **1 primitive feuille (badge/état)**, boutons ensuite si trivial | Périmètre Lot C |
| m1.3 | Où vivent les flags ? | **`@bot/shared/src/flags.ts`** (frontière partagée) | Lot D |
| m1.4 | Plombage complet des flags en M1 ? | **Non** — mécanisme + tests seulement, branchement dès M2 | Lot D |

> Ces micro-décisions n'ont **aucune conséquence irréversible** ; elles peuvent être confirmées à l'ouverture de la branche.

## 12. Definition of Done

M1 est terminé quand : `@bot/ui` est amorcé et consommé sans régression visuelle, le budget tient, le mécanisme de flags est en place (off par défaut) et testé, `pnpm -r check` est vert, et un **rapport de fin de milestone** est produit ([E6](../E6-branching-strategy.md) §rapports : `execution/reports/M1-report.md`, créé au moment de l'implémentation).
