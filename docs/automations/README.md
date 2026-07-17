# Studio d’automatisations M10

Le Studio exécute des workflows multiguildes de forme « SI / ET-OU / ALORS ». Il réutilise les frontières existantes : le Gateway observe Discord, l’outbox livre les événements de façon durable, le Worker valide et exécute, D1 reste l’unique source de vérité, et le Panel consomme les contrats de `@bot/shared`.

## Architecture

```text
Discord Gateway ──> outbox SQLite ──> POST /internal/events/batch
Interactions HTTP ──────────────────> Worker emit
Writes métier D1 ──> triggers SQL ──> automation_event_queue
Cron Worker ────────────────────────> automation_event_queue
                                      │
                                      v
                         Automation Engine (Worker)
                         registre Trigger/Condition/Action
                                      │
                ┌─────────────────────┼─────────────────────┐
                v                     v                     v
          Discord REST         écritures D1        tâches différées
                                                     (action Wait)
```

Le moteur ne contient aucun `switch` d’exécution central. Les implémentations sont enregistrées dans trois `Map` typées dans `packages/worker/src/automation/registry.ts`. `assertAutomationRegistryComplete()` fait échouer le démarrage ou les tests si un composant déclaré dans le catalogue n’a pas d’implémentation.

Le contrat partagé dans `packages/shared/src/automation.ts` contient les identifiants, métadonnées, champs de configuration, schémas Zod, variables, DTO d’API et moteur de templates. Le Panel construit ses cartes depuis `GET .../automations/catalog` : un nouveau champ déclaré apparaît donc sans formulaire codé en dur.

## Garanties d’exécution

- idempotence : unicité `(workflow_id, event_id)` et action-run `(execution_id, position)` ;
- concurrence : claim D1 par `UPDATE ... RETURNING` et limites atomiques par `UPSERT ... WHERE` ;
- reprise : leases de 30 secondes, cinq tentatives avec backoff pour files et tâches différées ;
- anti-spam : plafond par workflow/minute et cooldown par utilisateur, salon ou serveur ;
- anti-boucle : profondeur bornée à 4, TTL événement de 10 minutes, suppression des événements de rôle produits par le moteur, et absence de réémission des mutations métier portant l’acteur `automation` ;
- tolérance : `continueOnError`, circuit breaker de 15 minutes après cinq échecs consécutifs ;
- sécurité : validation Zod stricte, aucune évaluation de code, regex bornées, webhook HTTPS public seulement, mentions désactivées par défaut, contrôles owner/hiérarchie Discord ;
- observabilité : corrélation, code d’erreur borné, durée par action/exécution, statistiques journalières et audit administratif sans payload sensible.

## Schéma D1

Migration : `packages/worker/migrations/0031_automation_studio.sql`.

| Table | Rôle | Rétention |
|---|---|---|
| `guild_module_extensions` | gouvernance additive du module `automations` | durée de vie du serveur |
| `admin_audit_log_v2` | audit versionné incluant la capability M10 | 90 jours |
| `automation_workflows` | définition courante et circuit breaker | jusqu’à suppression |
| `automation_workflow_revisions` | snapshots immuables | conservés pour audit |
| `automation_event_queue` | livraison, lease, retry, TTL | 7 jours |
| `automation_executions` | résultat corrélé | 90 jours |
| `automation_action_runs` | état idempotent de chaque action | avec exécutions |
| `automation_stats_daily` | agrégats de performance | 400 jours |
| `automation_rate_limits` | buckets atomiques | 2 jours |
| `automation_scheduled_tasks` | reprise après `wait` | 7 jours après terminaison |
| `automation_event_suppressions` | garde anti-boucle courte | expiration puis purge |

La table historique `guild_modules` n’est pas reconstruite : sa contrainte fermée M01–M09 est étendue via `guild_module_extensions`, lue par les mêmes requêtes de gouvernance.

## Endpoints Panel

Tous sont sous `/api/guilds/:guildId`, protégés par session, accès multiguilde et capability `automations_write` pour les mutations.

- `GET /automations/catalog`
- `GET /automations`
- `GET /automations/executions?workflowId=`
- `GET /automations/stats?workflowId=`
- `POST /automations`
- `GET|PUT|DELETE /automations/:id`
- `PATCH /automations/:id/state`
- `POST /automations/:id/duplicate`
- `GET /automations/:id/revisions`
- `GET /automations/:id/export`
- `POST /automations/:id/simulate`
- `POST /automations/import/validate`
- `POST /automations/import`

Le Gateway reçoit les abonnements utiles via `/internal/config/:guildId` et remet les événements dans l’endpoint durable existant `/internal/events/batch` avec le type `automation_event`.

## Catalogue MVP

Le catalogue livré comprend 17 triggers, 17 conditions et 20 actions. Les identifiants canoniques et leurs schémas sont dans `packages/shared/src/automation.ts`; cette source prévaut sur les libellés traduits du Panel.

## Limites connues

- Les expressions cron sont évaluées en UTC avec cinq champs ; les extensions non standard (`L`, `W`, `#`) ne sont pas prises en charge.
- Les actions Discord déjà acceptées par l’API juste avant une interruption réseau ne peuvent pas offrir un « exactly once » absolu ; les retries sautent toutefois toute action marquée réussie.
- Les messages issus du bot et les mutations métier produites par une automatisation ne redéclenchent pas un workflow en v1. C’est un choix de sûreté anti-boucle.
- Le contenu de message n’est transporté que lorsqu’un trigger actif le nécessite, puis il suit la rétention courte de la file.
