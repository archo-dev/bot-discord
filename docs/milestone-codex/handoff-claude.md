# Passation complète à Claude

## Statut

Documentation de phase 2. Les dix milestones et cinq éléments de backlog sont **validés au niveau produit**, mais aucune implémentation n’est autorisée implicitement. Une milestone précise doit être demandée et planifiée avant tout code.

## Architecture actuelle

- Monorepo pnpm, TypeScript strict.
- `packages/worker` : Hono sur Cloudflare Workers, OAuth/panel/interactions/internal, seul écrivain D1.
- `packages/gateway` : Node 22 + discord.js sur VPS, événements temps réel, musique et vocal ; D1 uniquement via `/internal/*`.
- `packages/panel` : React 19, Vite, Tailwind 4, TanStack Query, React Router, Recharts, design Nocturne.
- `packages/shared` : Zod, DTO, permissions, logique commandes/variables/XP.
- D1 SQL brut, KV pour sessions/cache/cooldowns/rate limits, cron quotidien de rétention.

Lire obligatoirement `CLAUDE.md`, `README.md`, `roadmap.md`, les migrations et la fiche de milestone concernée.

## Conventions critiques

- Tout est scopé par `guildId` ; Worker seul écrivain D1.
- Ordre feature : migration → shared → worker queries/API/internal → gateway → panel → tests.
- Mutations panel réservées admin ; modérateur lecture seule.
- Tailwind v4 utilise `bg-(--var)`.
- Déploiement Worker : toujours `pnpm --filter @bot/worker run deploy`.
- Migrations distantes et déploiements nécessitent validation explicite.
- Ne jamais afficher/committer `.dev.vars`, tokens, secrets, contenu privé ou données personnelles.

## Objectifs produit

Passer de 10–20 serveurs de 100–200 membres à une ouverture publique progressive, sans usine à gaz, SaaS payant ou coût imprévisible. Modules activables, expérience administrateur claire, architecture modulaire et préparation freemium non prioritaire.

## Ordre validé

### Phase A — Fondations

1. Observabilité/SLO.
2. Sécurité multi-tenant.
3. Gouvernance modules/capacités.
4. Performance/coûts.

### Phase B — Fiabilité et croissance

5. Livraison fiable Gateway→Worker.
6. Onboarding/centre modules.
7. Sauvegarde/restauration.
8. Analytics privées.

### Phase C — Avancé

9. Tickets d’équipe.
10. Studio d’automatisations.

Le scheduler `scheduled_tasks` est C2.0, prérequis du studio ; s’il dépasse 5–7 jours, le traiter dans une branche et un déploiement autonomes.

## Backlog validé

Suggestions/votes ; tâches planifiées/rappels/giveaways ; FAQ sans IA payante ; i18n FR/EN ; réputation/saisons. Voir `alternatives.md`. Aucun prompt d’implémentation n’est figé car les métriques futures doivent revalider le scope.

## Dépendances

- M1 mesure toutes les suivantes.
- M2 précède toute ouverture et action avancée.
- M3 est la source de vérité du centre modules, quotas et capacités.
- M4 fournit budgets à M5/M10.
- M5 est requis pour événements fiables de M9/M10.
- M7 fournit rollback/révisions à M9/M10.
- M8 guide le choix du backlog et mesure M6/M9/M10.

## Décisions prises

- Pas de service payant imposé.
- Pas d’IA nécessitant API externe dans la roadmap principale.
- Analytics sans contenu/PII, séparées de l’observabilité.
- Sécurité de base jamais premium.
- Worker reste seul écrivain D1.
- Une milestone majeure à la fois, branche/commits/validation/déploiement séparés.
- Pas de copie exhaustive d’un concurrent.

## Décisions encore ouvertes

- Schémas D1 exacts après profilage et revue des volumes.
- Mécanisme CSRF final.
- Stockage outbox VPS (SQLite vs fichiers segmentés).
- Seuils SLO/budgets après baseline.
- Scheduler Cloudflare exact et fréquence/coût.
- Date et cible de l’ouverture publique/pilotes.
- Entitlements futurs ; aucun système de paiement n’est autorisé maintenant.

## Risques principaux

Surcollecte de données, permissions/intents Discord, rate limits Discord/YouTube, perte/doublon événements, divergence Gateway/Worker, migrations ordonnées, bundle panel, complexité UX des workflows et coût support.

## Fichiers importants

- `CLAUDE.md`, `README.md`, `roadmap.md`.
- `packages/worker/src/index.ts`, `env.ts`, `auth/*`, `ratelimit.ts`, `discord/rest.ts`, `internal/*`, `db/queries/*`, `cron.ts`.
- `packages/gateway/src/worker-api.ts`, `config-cache.ts`, `events.ts`, modules temps réel.
- `packages/panel/src/App.tsx`, `pages/GuildLayout.tsx`, `lib/api.ts`, `lib/queryClient.ts`, `ui/`.
- `packages/shared/src/` et `packages/worker/migrations/`.

## Commandes de validation

```powershell
pnpm --filter @bot/panel check
pnpm --filter @bot/panel build
pnpm --filter @bot/worker test
pnpm -r check
pnpm -r test
```

Il n’existe pas actuellement de script lint panel. Signaler cette absence, ne pas inventer un résultat.

## Règles Git et méthode

1. Vérifier master et worktree propre.
2. Branche `milestone/<nom>` dédiée et point de restauration.
3. Audit/plan avant code ; stopper si comportement/API/données doit changer hors scope.
4. Commits par phase.
5. Migrations additives, backup/rollback, local d’abord.
6. Tests/check/build et documentation.
7. Aucun déploiement/migration remote sans validation explicite.
8. Observer le déploiement séparé avant milestone suivante.

## Comportement attendu avant implémentation

Claude doit relire la fiche, vérifier les dépendances réellement déployées, inspecter code et données uniquement en lecture sûre, distinguer faits/hypothèses, proposer fichiers/routes/tables/risques et demander validation du plan si exigée. Il ne doit pas développer plusieurs milestones ensemble ni « préparer au passage » un backlog.

## Référence documentaire

Le README donne la vision ; `roadmap.md` fait foi pour ordre/gates ; chaque fichier `01`–`10` fait foi pour le scope et le prompt ; `alternatives.md` est le backlog officiel.
