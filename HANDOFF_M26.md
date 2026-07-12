Rapport — M24 (commandes sociales), M25 (multi-serveurs), M26 (vocaux temporaires)

Analyse du projet

- Langage : TypeScript strict, monorepo pnpm (archodev, pnpm 10.13).
- Framework Discord : deux moitiés — worker sans discord.js (HTTP Interactions via discord-api-types@^0.38, Hono sur Cloudflare Workers) et gateway discord.js@^14.16.3 (Node 22, VPS).
- Point d'entrée : worker packages/worker/src/index.ts (POST /interactions, vérif Ed25519) ; gateway packages/gateway/src/index.ts.
- Commandes : registre builtins (src/interactions/builtins/index.ts), un handler par domaine ; définitions dans scripts/register-commands.ts.
- Événements : modules registerX(client, cache, api) dans le gateway.
- Enregistrement slash : hybride — register:dev (guilde de test, instantané) / register:global (prod, ≤1 h). Le chemin global existait déjà.
- Stockage : Cloudflare D1 (SQL brut, migrations NNNN_*.sql), le worker est l'unique écrivain ; le gateway lit/écrit via /internal/* (bearer). Tout est scopé guild_id.
- Risques repérés : aucune API GIF existante (→ liste locale) ; aucun guildCreate/channelDelete ni création de salon côté gateway (→ tout neuf pour M26) ; le multi-serveurs était déjà en place (isolation guild_id + register:global).

Modifications réalisées

- /kiss + module générique : social-data.ts (data-driven, sans import, partagé worker↔script) génère les 6 handlers et les définitions de commandes. /kiss /hug /pat /slap /poke /cuddle : réponse immédiate, GIF aléatoire en embed, ping ciblé, refus d'auto-ciblage (sauf slap), variante bot.
- Commandes globales : déjà supportées ; rien retiré. Documentation register:dev vs global clarifiée.
- Isolation multi-serveurs : déjà guild_id-scoped ; les nouvelles tables/cooldowns le respectent (cooldown rename stocké par salon en D1, cooldown création par guild:user en mémoire gateway).
- Événement nouveau serveur : guildCreate → upsert immédiat de la guilde (fin du piège « panel vide avant /ping ») + message de bienvenue dans le premier salon accessible. guildDelete → bot_installed=0 (données conservées) + invalidation du cache.
- Vocaux temporaires : lobby « rejoindre pour créer », création/déplacement/suppression différée, réconciliation au démarrage, gestion suppression manuelle du salon/lobby, anti-abus.
- Config : /tempvoice setup|disable|status|reset (admin). Propriétaire : /voice rename|limit|lock|unlock|permit|reject|kick|transfer|claim.
- Persistance : migration 0019 (settings + registre des salons). Gestion d'erreurs : réutilise le pattern deferred → waitUntil → editOriginal et UserError pour messages propres ; jamais de crash.

Fichiers créés

- packages/worker/src/interactions/builtins/social-data.ts — données + définitions des actions sociales (sans dépendance).
- packages/worker/src/interactions/builtins/social.ts — génère les 6 handlers.
- packages/worker/src/internal/guilds.ts — endpoints internes installed/uninstalled.
- packages/gateway/src/guild-lifecycle.ts — listeners guildCreate/guildDelete + bienvenue.
- packages/worker/migrations/0019_temp_voice.sql — 2 tables + index.
- packages/shared/src/api-types/temp-voice.ts — DTO.
- packages/worker/src/db/queries/temp-voice.ts — requêtes settings + registre.
- packages/worker/src/api/temp-voice.ts — GET/PUT panel.
- packages/worker/src/internal/temp-voice.ts — endpoints gateway (bulk list, register/unregister, lobby-deleted).
- packages/worker/src/interactions/builtins/temp-voice.ts — handlers /tempvoice et /voice.
- packages/gateway/src/temp-voice.ts — cœur runtime (création/suppression/réconciliation).
- packages/panel/src/pages/TempVoice.tsx — page de config.
- Tests : test/social.test.ts, test/guild-lifecycle.test.ts, test/temp-voice.test.ts, test/voice-commands.test.ts.

Fichiers modifiés

- respond.ts (option allowedMentionUsers), builtins/index.ts (+8 handlers), scripts/register-commands.ts (+8 commandes).
- internal/routes.ts, internal/config.ts (agrégat tempVoice), worker/src/index.ts (mount api), db/queries.ts (barrel).
- shared/api-types/index.ts (barrel), shared/permissions.ts (+MANAGE_CHANNELS).
- gateway/worker-api.ts (config tempVoice + méthodes, call accepte DELETE), gateway/index.ts (+2 modules).
- panel/App.tsx (route), panel/GuildLayout.tsx (sidebar).
- README.md, roadmap.md.

Base de données et migrations

- 0019_temp_voice.sql : guild_tempvoice_settings (PK guild_id → guilds) et temp_voice_channels (PK channel_id, owner_id, last_renamed_at) + INDEX idx_temp_voice_guild. Non destructive (CREATE only), aucune donnée existante touchée.
- Appliquée : en local (migrate:local ✅) et via les tests. À exécuter au déploiement : pnpm run migrate:remote.

Tests effectués (réellement exécutés)

Commande: pnpm -r check
Résultat: ✅ 4 packages typecheck
────────────────────────────────────────
Commande: pnpm --filter @bot/worker test
Résultat: ✅ 25 fichiers, 175 tests (dont 6
social, 4 guild-lifecycle, 8 temp-voice, 5
voice-commands)
────────────────────────────────────────
Commande: pnpm --filter @bot/panel build
Résultat: ✅ build OK
────────────────────────────────────────
Commande: pnpm --filter @bot/worker run
migrate:local
Résultat: ✅ 0019 appliquée
────────────────────────────────────────
Commande: pnpm register:dev
Résultat: ✅ 32 commandes sur la guilde de test

Non testé localement (impossible sans Discord réel + VPS) : le runtime gateway — temp-voice.ts et guild-lifecycle.ts n'ont pas de test automatisé (le repo n'en a aucun côté gateway) et n'ont été validés que par le typecheck. La création réelle d'un salon, le déplacement, la suppression, la réconciliation au redémarrage et le message de bienvenue doivent être vérifiés manuellement une fois le gateway déployé.

Configuration restante (à votre main)

1. Déployer : pnpm run migrate:remote → pnpm --filter @bot/worker run deploy → redéployer le gateway (git bundle + scp + systemctl restart botdiscord-gateway).
2. pnpm register:global pour la prod (≤1 h de propagation) — le dev est déjà fait.
3. Remplacer les URLs Tenor placeholder dans social-data.ts par des liens que vous aurez validés (un GIF cassé n'affiche rien, mais mieux vaut des vrais).
4. Par serveur : /tempvoice setup (ou la page panel).
- Aucune nouvelle variable d'env, aucun nouveau secret, aucun changement d'intents dans le portail.

Permissions nécessaires (minimales, jamais Administrateur)

- Social + bienvenue : Voir les salons, Envoyer des messages, Intégrer des liens.
- Vocaux temporaires (dans la catégorie) : Voir le salon, Se connecter, Gérer les salons, Déplacer des membres.
- Intents inchangés : Guilds couvre déjà guildCreate/guildDelete/channelDelete/voiceStateUpdate ; GuildVoiceStates déjà présent.

Procédure de test manuel

1. /kiss : /kiss user:@X → embed + GIF, X pingé ; /kiss sur soi → refus éphémère ; /slap sur soi → autorisé.
2. Deux serveurs : configurer /tempvoice différemment sur 2 serveurs → aucune fuite de config (clé guild_id).
3. /tempvoice setup (sans param) → crée « ➕ Créer un salon » ; ou setup salon:#vocal.
4. Création auto : rejoindre le lobby → un salon est créé, vous y êtes déplacé.
5. /voice : rename, limit, lock/unlock, permit/reject, kick, transfer, claim (tester non-propriétaire → refus).
6. Suppression auto : quitter → salon supprimé après ~5 s ; revenir avant → suppression annulée.
7. Redémarrage gateway avec un salon vivant → réconciliation (salon vide supprimé, orphelins purgés).
8. Permissions insuffisantes : retirer « Gérer les salons » au bot → /tempvoice status liste les perms requises ; la création échoue proprement (log gateway).

Améliorations proposées (priorisées — non implémentées)

1. Tests automatisés du gateway (Moyen) — le repo n'a aucun test côté gateway ; temp-voice/guild-lifecycle/automod/voice ne sont couverts que par typecheck. → packages/gateway/test/* avec mocks discord.js.
2. Brique « tâches planifiées » (Moyen) — déjà top backlog ; débloque tempban/tempmute, /remindme, giveaways. → migration scheduled_tasks, worker/src/cron.ts, queries/api.
3. Panneau vocal à boutons (Moyen) — remplacer/compléter /voice par un message interactif dans le salon temporaire (rename via modal, lock, limite). Améliore la feature qu'on vient de livrer. → worker/interactions/components/, gateway/temp-voice.ts.
4. Code-splitting du panel (Facile) — le bundle fait 983 kB (warning au build). → React.lazy sur les pages dans App.tsx.
5. Logger structuré côté gateway (Facile) — tout est console.log/error sans niveaux ni format. → gateway/src/util.ts.
6. Suivi d'invitations (Moyen) — « invité par X », classement (intent GuildInvites). → gateway cache invites + invites table + page Stats.
7. Auto-mod IA / /summarize (Moyen→Difficile) — l'infra Claude est disponible ; différenciateur fort. → appel API Claude depuis le worker (lire la skill claude-api).
8. Réconciliation musique au redémarrage (Moyen) — aujourd'hui aucune ; réutiliser le pattern de réconciliation introduit pour temp-voice. → gateway/music/controller.ts.
9. Purge de rétention mod_actions/gateway_events (Facile) — non nettoyées (limite déjà notée au README). → worker/src/cron.ts.

Les trois commits sur master : 530cc6b (M24), ae0ad99 (M25), 2800ca0 (M26). Rien n'est déployé en prod — c'est votre étape.