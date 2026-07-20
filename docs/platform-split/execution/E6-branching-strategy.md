# E6 — Stratégie de branches & commits

> Voir aussi : [milestones](./E4-milestones.md) · [dépendances](./E5-dependencies-critical-path.md) · [tests & release](../12-testing-and-release-strategy.md)

> ℹ️ **Aucune action Git dans cette étape** : ce document **propose** une méthode compatible avec le dépôt actuel. Rien n'est exécuté ici.

## État actuel du dépôt (observé)

- Branche principale : **`master`**.
- **Conventional Commits** en pratique (`feat(scope): …`, `fix(worker): …`, `refactor(moderation): …`, `perf(panel): …`).
- `CLAUDE.md` mentionne aussi la convention **« 1 feature = 1 commit `Mxx: …` sur `master` »** et un **ordre d'implémentation** imposé : `migration → shared DTO → worker (queries → api → internal → config) → gateway → panel → tests worker`.
- Déploiement gateway par **git bundle + scp** (pas de GitHub) ; worker via `wrangler` ; migrations via `pnpm run migrate:remote`.

## Principe proposé : 1 milestone = 1 branche, réconcilié avec les deux conventions

Adopter une **branche par milestone** (revue/rollback nets), avec des **commits Conventional** à l'intérieur, et une **référence de milestone** systématique (`M6`, `M7`…) pour garder la traçabilité voulue par `CLAUDE.md`.

### Nommage de branche

```
feat/m06-entitlements
feat/m07-slots-gating
feat/m12-studio-minimal
```
Format : `feat/m<NN>-<slug-court>` (deux chiffres pour le tri). Pour un correctif : `fix/m07-...`.

### Commits à l'intérieur d'une branche

- **Conventional Commits** avec **scope = package** et **référence milestone** dans le corps ou le sujet.
- Suivre l'**ordre d'implémentation** `CLAUDE.md` → un commit par couche quand c'est lisible :

```
feat(shared): DTO entitlement/subscription (M6)
feat(worker): migration 0033 entitlements + queries (M6)
feat(worker): resolveEffectiveEntitlement + /api/subscription (M6)
test(worker): résolution & invariants entitlements (M6)
```

- **Alternative** (petits milestones) : **un seul commit** `feat(worker): moteur d'entitlements (M6)` — acceptable si le diff reste lisible.

### Taille maximale conseillée

- Cible : **≤ ~400 lignes de diff** significatif par commit, **≤ ~1500** par branche de milestone (hors migrations/fixtures).
- Un milestone **XL** (ex. M12 Studio) se **sous-découpe** en branches enchaînées `feat/m12a-…`, `feat/m12b-…` mergées dans l'ordre — jamais un unique commit géant.

## Tests obligatoires avant merge

Bloquants (repris de [doc 12](../12-testing-and-release-strategy.md)) :

1. `pnpm -r check` (typecheck strict) **vert**.
2. `pnpm --filter @bot/worker test` **vert** — tests **auto-suffisants** (rollback D1/KV entre tests, piège vitest-pool-workers).
3. `pnpm --filter @bot/panel build` OK + **budget 180 KiB gzip tenu**.
4. Invariants du milestone couverts (ex. `paid` non révocable, idempotence webhook, suspension≠suppression).
5. `git diff --check` propre (pas de trailing whitespace/marqueurs de conflit).

## Règles de merge

- **Merge vers `master`** après revue + tests verts. Historique **linéaire** conseillé : **rebase** de la branche sur `master` puis merge (fast-forward) ou **squash** si les commits internes sont bruités.
- **Un milestone = une unité mergée** cohérente et **réversible par flag** (E4).
- **Ne jamais** merger un milestone dont le flag ne permet pas un rollback propre.
- Respecter les **points de non-retour** ([E5](./E5-dependencies-critical-path.md)) : migrations, prestataire, DNS, premier payant, lifetime → validation explicite avant merge.
- **Ne pas** contourner les hooks (`--no-verify`) ni la signature sans demande explicite.

## Migrations

- **Additives** uniquement, numérotées à partir de **`0032`** (`packages/worker/migrations/`).
- **Une migration par milestone** au plus, commitée **avant** les queries qui l'utilisent (ordre `CLAUDE.md`).
- **`pnpm run migrate:remote` à chaque déploiement de milestone** (une migration oubliée a déjà cassé la prod — `CLAUDE.md`).
- **Jamais** de migration destructive : suspension d'usage par flag, pas suppression de table/colonne en prod.

## Déploiement (par milestone, quand pertinent)

- **Worker + panel** : `pnpm --filter @bot/worker run deploy` (toujours `run` — pnpm 10).
- **Gateway** : `git bundle` + scp vers le VPS + `systemctl restart botdiscord-gateway` (recette `roadmap.md`).
- **Secrets** : `wrangler secret bulk fichier.json` puis suppression du fichier — **jamais** `Write-Output | wrangler secret put` (CRLF → 401).
- **Studio (M12+)** : binaire/déploiement **séparés** (Worker studio), secrets distincts.
- **Ordre** : `migrate:remote` → deploy worker → (si besoin) deploy gateway → activer le flag par cohorte.

## Rollback

| Niveau | Moyen |
|--------|-------|
| Fonctionnel | **Bascule de feature flag** (défaut : off = rétrocompat Gratuit) — instantané |
| Code | `git revert` du merge de milestone (branche isolée = revert net) |
| Déploiement | Re-deploy de la version précédente (Worker Cloudflare garde l'historique) |
| Données | Migrations **additives** → pas de rollback destructif ; on **désactive l'usage**, on ne supprime pas |

## Rapports de fin de milestone

À produire à la clôture de chaque milestone (documentaire, pas de code) :

- Résumé (objectif atteint, écarts).
- Diffstat + hash du/des merge(s).
- Résultats des tests obligatoires (copie de sortie).
- Migration(s) appliquée(s) + confirmation `migrate:remote`.
- État du/des feature flag(s) et procédure de rollback vérifiée.
- Décisions ([E7](./E7-decision-queue.md)) consommées ou nouvellement débloquées.
- Smoke tests prod (si déployé).

> Convention de rapport : un fichier `docs/platform-split/execution/reports/M<NN>-report.md` **[proposition]**, créé au moment de l'implémentation (hors périmètre de ce dossier de planification).

## Résumé

- **1 milestone → 1 branche `feat/m<NN>-slug`**, commits Conventional avec réf `M<NN>`, ordre d'implémentation `CLAUDE.md`.
- **Merge** après tests verts + revue ; historique linéaire ; réversible par flag.
- **Migrations additives `0032+`**, `migrate:remote` systématique, jamais destructif.
- **Rollback** d'abord par flag, puis revert/redeploy ; données jamais supprimées.
