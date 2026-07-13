# Gouvernance des modules — M03

## Inventaire avant implémentation

Cet inventaire décrit l’état constaté au début de M03. Il distingue un module produit d’un simple sous-réglage : les auto-rôles appartiennent à l’accueil, les logs serveur à la configuration générale, et l’XP vocal aux niveaux.

| ID stable | État historique | Worker/API et commandes | Gateway / intents | Stockage principal | Conséquence attendue d’une désactivation globale |
|---|---|---|---|---|---|
| `general` | toujours actif ; sous-réglages dans `guilds` et `log_settings` | config, surnom, salons/rôles/membres ; `/ping` | logs serveur ; Guilds, GuildMembers, GuildMessages, MessageContent | `guilds`, `log_settings` | non désactivable : socle de guilde |
| `custom_commands` | `custom_commands.enabled` par commande, aucun gate global | CRUD commandes ; slash et mots-clés | mots-clés ; GuildMessages + MessageContent | `custom_commands`, révisions | aucune commande custom exécutée ; définitions conservées |
| `tickets` | `ticket_settings.enabled` | settings, publication, composants/modals | aucun handler Gateway | `ticket_settings`, `tickets` | nouveaux tickets refusés ; tickets existants conservés |
| `button_roles` | chaque message publié reste actif, aucun gate global | publication/suppression, composants | aucun | `button_role_messages`, `button_roles` | composants refusés ; messages/rôles conservés |
| `welcome` | `welcome_enabled`, `leave_enabled`, auto-rôles individuels | accueil, départ, auto-rôles | GuildMembers | `welcome_settings`, `auto_roles` | accueil/départ/auto-rôles ignorés ; config conservée |
| `automod` | flags par règle, mots bannis implicites | settings, sanctions internes | GuildMessages + MessageContent | `automod_settings`, warnings/actions | aucun message inspecté par l’automod |
| `levels` | `xp_settings.enabled` et `voice_enabled` | settings, leaderboard, `/rank`, `/leaderboard` | messages + vocal ; MessageContent, GuildVoiceStates | `xp_settings`, `xp_members` | aucun gain ; consultation/paramètres conservés |
| `starboard` | `starboard_settings.enabled` | settings, endpoint interne | GuildMessageReactions | settings, posts | réactions ignorées ; posts existants conservés |
| `temp_voice` | `guild_tempvoice_settings.enabled` | settings, `/tempvoice`, `/voice`, endpoints internes | GuildVoiceStates | settings, salons temporaires | aucune création ; salons existants non supprimés |
| `music` | aucun flag global | état/contrôles, commandes musique | Gateway + GuildVoiceStates | KV état, `playlists` | nouvelles commandes refusées ; lecture en cours non détruite automatiquement |
| `moderation` | toujours actif | warnings/actions, commandes de modération | automod seulement, traité séparément | `warnings`, `mod_actions` | non désactivable : fonction de sécurité fondamentale |
| `voice_logs` | join/leave/move toujours persistés ; toggles seulement pour les embeds | lecture paginée, lots internes | GuildVoiceStates | `voice_logs`, `log_settings` | aucun nouvel événement vocal persisté ou publié |
| `stats` | collecte Gateway toujours active ; présence pilotée par env | endpoints stats et lots internes | messages/vocal, présence optionnelle | snapshots, activité | collecte stoppée ; historique conservé |
| `panel_access` | toujours actif | grants utilisateurs/rôles | aucun | `panel_access` | non désactivable : frontière d’autorisation |
| `health` | toujours actif, admin seulement | `/health` et diagnostic M01 | heartbeat | métriques D1 + KV | non désactivable : fondation opérationnelle |
| `audit` | toujours actif, admin seulement | audit M02 | aucun | `admin_audit_log` | non désactivable : contrôle de sécurité |
| `social` | toujours actif, non représenté dans le panel | `/kiss`, `/hug`, `/pat`, `/slap`, `/poke`, `/cuddle` | aucun | aucun | commandes sociales refusées, sans perte de données |

## Écarts confirmés

- Les sources d’activation sont réparties entre six tables, des lignes de commandes et des comportements « toujours actifs ».
- Le panel, les interactions Worker et les handlers Gateway n’appliquent pas le même gate.
- Le contrat `GuildGatewayConfig` est recopié manuellement et ne porte ni version ni état global.
- Les intents sont configurés globalement au démarrage ; leur absence n’est pas exprimée par module.
- Les permissions du bot sont détectées tard, au moment d’une action Discord, sans diagnostic central.
- Aucun module ne déclare version de configuration, dépendances, conflit, quota ou conséquence de désactivation.
- Les commandes sociales constituent un module réel mais n’étaient pas listées dans les pages du panel.

## Architecture M03 retenue

`MODULE_REGISTRY` dans `@bot/shared` devient l’unique catalogue statique. D1 stocke uniquement l’état variable par guilde dans `guild_modules`. Le Worker calcule l’état effectif et ses raisons ; le Gateway reçoit une projection compacte versionnée et ne touche jamais D1 ; le panel consomme le DTO Worker.

La table centrale porte `enabled`, `config_version` et `authority` :

- `legacy` pendant le backfill des modules historiquement pilotés par un flag ; leur valeur est dérivée de ce flag tant qu’aucune écriture M03 n’a eu lieu ;
- `governance` dès une mutation du centre ou d’une route de réglage mise à jour ; la ligne centrale devient alors la gate d’exécution ;
- les colonnes historiques restent des sous-réglages et un filet de rollback, jamais une seconde gate silencieuse.

Les routes de réglage existantes synchronisent la ligne centrale. Une désactivation M03 ne supprime ni configuration, ni commande, ni message publié, ni historique. Les modules fondamentaux (`general`, `moderation`, `panel_access`, `health`, `audit`) ne sont pas désactivables.

## Dépendances et risques de cycle

La première version évite les dépendances artificielles. Les modules fondamentaux sont des capacités de plateforme, pas des parents dans le graphe. Les dépendances fonctionnelles futures devront être déclarées par ID et validées par un test acyclique. Les besoins Gateway, Worker, intents et permissions sont des prérequis, pas des dépendances de module.

## Compatibilité de déploiement

1. Appliquer `0022` avant le nouveau Worker : backfill déterministe, aucune suppression.
2. Déployer un Worker qui enrichit la config interne sans retirer les champs historiques : ancien Gateway compatible.
3. Déployer le nouveau Gateway : absence de `governanceVersion/modules` = comportement historique.
4. Déployer le panel en dernier.

Rollback applicatif : revenir au panel/Worker/Gateway précédent et conserver `guild_modules`. Les anciennes applications ignorent la table ; les flags historiques et toute la configuration restent disponibles.
