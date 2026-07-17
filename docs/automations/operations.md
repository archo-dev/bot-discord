# Migration, exploitation, dépannage et rollback

## Déploiement

Ordre obligatoire : typecheck → tests → build/budget → CI Linux → sauvegarde D1 → migration `0031_automation_studio.sql` → Worker/Panel → Gateway → contrôles de production. La migration est additive et laisse le module désactivé sur tous les serveurs existants.

Après migration, vérifier les onze tables ajoutées/étendues par M10 et les index `idx_automation_*`. Les producteurs métier de warn, mute et tickets ajoutent leur événement dans le même batch D1 que la mutation, uniquement si le module et un workflow correspondant sont actifs. Activer ensuite le module depuis le Panel seulement sur un serveur de validation, créer un workflow inactif, lancer la simulation, puis activer.

## Diagnostic

- Workflow actif mais aucune exécution : vérifier le module `automations`, le heartbeat Gateway et `automationTriggers` dans la config interne.
- `skipped / conditions_not_met` : utiliser le même contexte dans le mode test.
- `skipped / rate_limited` : attendre la fin du cooldown ou du bucket minute.
- `failed / owner_protected` ou `*_hierarchy_insufficient` : remonter le rôle du bot ; ne contournez pas le contrôle.
- Circuit ouvert : corriger l’action, puis désactiver/réactiver le workflow.
- Tâche `wait` bloquée : vérifier le cron minute, le lease et `last_error_code` dans `automation_scheduled_tasks`.
- Événements Gateway en attente : inspecter les métriques de l’outbox et `/internal/events/batch`.

## Rollback applicatif

1. Désactiver le module `automations` pour chaque serveur concerné. Cela stoppe toute nouvelle exécution sans supprimer les définitions.
2. Revenir aux versions précédentes Worker, Panel et Gateway.
3. Ne pas supprimer les tables M10 : les anciens binaires les ignorent et les données restent disponibles pour un redéploiement corrigé.
4. Si nécessaire, restaurer la sauvegarde D1 effectuée juste avant migration selon la procédure générale du dépôt. Cette option restaure toute la base, pas uniquement M10.

La suppression des tables ou la modification destructive de `guild_modules` ne fait pas partie du rollback normal.
