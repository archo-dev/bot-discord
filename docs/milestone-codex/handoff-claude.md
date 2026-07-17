# Passation complète à Claude

## Statut

M01 et M02 sont terminées et présentes sur `master` au point de départ `7de2b5a`. M03 « gouvernance des modules et capacités » est implémentée sur la branche `milestone/module-governance`, sans migration distante ni déploiement. Les milestones M04 à M10 et les cinq éléments de backlog restent validés au niveau produit, sans autorisation implicite d’implémentation.

M02 apporte la matrice deny-by-default des mutations, le durcissement OAuth/session/navigateur, le protocole HMAC interne avec rotation et anti-rejeu, les quotas durables, l’audit administrateur et les runbooks. La migration additive locale est `0021_public_security.sql`. La cible de rollout est `dual` pendant la rotation puis `signed`; CSP reste volontairement report-only au premier déploiement. Aucun déploiement ni migration distante n’a été effectué pendant le développement.

M03 ajoute un registre partagé de 17 modules, la migration additive locale `0022_module_governance.sql`, une source de vérité `guild_modules`, un dual-read des six flags historiques, les gates Worker/Gateway, le diagnostic signé des intents/permissions, les routes panel GET/PATCH et le Centre des modules. Les modules système ne sont pas désactivables et une désactivation ne supprime aucune donnée. Le catalogue, les états, la procédure d’ajout, le rollout et le rollback sont documentés dans `docs/modules.md`.

M04 (performance) est livrée : code-splitting du panel (JS initial ~117 kB gzip, budget CI < 180 kB), parallélisation des lectures `/internal/config`, coalescence du cache gateway, retries Discord bornés idempotents, Error Boundary des chunks lazy. Aucune migration.

M05 (livraison fiable) : migration additive `0023_reliable_delivery.sql` (`processed_events`), endpoint signé `POST /internal/events/batch` (dédup atomique par `eventId`, ACK par événement), outbox persistante `node:sqlite` sur le VPS (dispatcher partitionné, backoff+jitter, Retry-After, dead-letter bornée, backpressure, arrêt gracieux). Fiabilise `voice_log/channel_activity/member_snapshot/gateway_event` derrière `GATEWAY_RELIABLE_TYPES` (**vide par défaut = livraison directe inchangée**). xp/automod/starboard restent directs (effet Discord non rejouable). Exploitation, runbooks, replay et rollback dans `docs/reliable-delivery.md`. Le Worker reste seul écrivain D1.

M06 (onboarding + centre modules) : migration additive `0024_onboarding.sql` (colonnes `onboarding_completed_at/onboarding_preset/onboarding_dismissed_steps` sur `guilds`). Landing publique React + endpoint public `GET /api/invite` (invitation à permissions minimales calculées depuis le registre, jamais Administrateur). `GET /api/guilds/:id/onboarding` dérive une checklist du DTO modules M03 (réutilise `responseFor`) ; presets transactionnels `POST /onboarding/preset` (dryRun/apply, admin-only via la matrice M02, modules bloqués ignorés, rien hors preset touché) ; `POST /onboarding/dismiss`. Le centre des modules M03 est réutilisé tel quel. Documentation dans `docs/onboarding.md`. Aucune modification Gateway. **Livré sur `master`, migré remote et déployé** (2026-07-17).

M07 (sauvegarde/restauration) : migration additive `0025_config_snapshots.sql`. Snapshots canoniques versionnés de **2 modules seulement** (Config `general` + Automod), sérialiseurs allowlistés (jamais de secret — test anti-secret), checksum SHA-256, rétention 25/guilde. Routes admin-only `config-snapshots` (list/create/get), `/:id/diff`, `/:id/restore` (sélectif, atomique, snapshot pré-restore), `/:id/export`, `config-import/validate`+`/apply` (remap rôles/salons explicite, snapshot pré-import). Contrat shared `config-backup.ts` (zod, refs, remap, canonicalJson, diff). 4 mutations ajoutées à la matrice M02 (total 27). Panel : page « Sauvegarde » (`/backup`). Aucune écriture Gateway (cache 60 s). Documentation `docs/config-backup.md`. Développé sur `milestone/config-backup` ; **statut : à valider (pas de migration remote ni déploiement sans accord).**

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
- M3 est désormais la source de vérité implémentée du centre modules, quotas et capacités ; elle doit être migrée, déployée et observée séparément avant M4.
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

- Schémas D1 exacts des milestones M04+ après profilage et revue des volumes ; le schéma M03 est figé dans `0022_module_governance.sql`.
- Date de passage CSP de `report` à `enforce`, après observation en production.
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
