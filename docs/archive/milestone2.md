M15 — Permissions panel : admin (écriture) vs modérateur (lecture seule)

Migration 0012_panel_access_levels.sql : ALTER TABLE panel_access ADD COLUMN level TEXT NOT NULL DEFAULT 'admin' CHECK (level IN ('admin','moderator')) — grants existants ⇒ admin, rétro-compatible. Le mapping rôle Discord → accès existe déjà (panel_access.subject_type='role').

Worker
- packages/worker/src/auth/guard.ts : GuildAccess devient "manage_guild" | "panel_admin" | "panel_moderator" ; requireGuildAccess résout le niveau (plusieurs grants ⇒ max = admin).
- packages/worker/src/index.ts : middleware global api.use("/guilds/:guildId/*", …) → 403 {error:"read_only_access"} si méthode ∈ {POST, PUT, PATCH, DELETE} et accès = panel_moderator. Modérateur = strictement lecture seule (musique et actions de modération incluses). Documenter routes read-only vs admin dans milestone.md.
- packages/worker/src/api/guilds.ts : GET /api/guilds/:guildId renvoie access: "admin" | "moderator" ; POST panel-access accepte level (gestion des accès reste requireManageGuild).
- packages/worker/src/db/queries.ts : listPanelAccess retourne level, insert avec level.

Shared : packages/shared/src/api-types.ts — level sur PanelAccessDto, access sur le DTO guild.

Panel
- packages/panel/src/pages/GuildLayout.tsx : AccessContext (canWrite) alimenté par le GET guild + nouveau hook src/lib/access.ts (useCanWrite()).
- src/ui/savebar.tsx + boutons de mutation : disabled + tooltip « Lecture seule » — passage sur Config, Welcome, Roles, Levels, Automod, Tickets, Commands, Music, ModLog.
- src/pages/PanelAccess.tsx : sélecteur de niveau par grant.

Tests : modérateur → 403 sur écritures / 200 sur GET ; admin → 200 ; manage_guild inchangé.

M16 — Nickname du bot par guilde

Migration 0013_guild_nickname.sql : ALTER TABLE guilds ADD COLUMN custom_nickname TEXT.

- packages/worker/src/api/guilds.ts : PATCH /api/guilds/:guildId/nickname (admin via M15, rate-limité) — zod {nickname: string 1..32 | null} ; écrit D1 puis discordJson(env, "PATCH", "/guilds/:id/members/@me", {nick}) ; 403 Discord ⇒ 409 {error:"missing_permission"} (valeur stockée quand même, badge « non appliqué »). null ⇒ reset.
- packages/panel/src/pages/Config.tsx : champ « Surnom du bot » + message d'erreur clair si permission manquante.
- Action manuelle : vérifier la permission Change Nickname du bot sur chaque serveur.

M17 — Logs vocaux

Migration 0014_voice_logs.sql : table voice_logs(id PK, guild_id, user_id, user_tag, action CHECK(join|leave|move|mute|unmute|deafen|undeafen), channel_id, from_channel_id, created_at) + index (guild_id, created_at DESC) et (guild_id, user_id, created_at DESC) ; + 4 colonnes log_voice_join/leave/move/state (DEFAULT 0) sur log_settings.

Gateway (intent GuildVoiceStates déjà actif)
- Nouveau packages/gateway/src/voice.ts : registerVoice(client, cache, api) sur Events.VoiceStateUpdate — classification join/leave/move/(un)mute/(un)deafen ; embeds vers le salon de logs via le helper sendTo existant (events.ts:22) selon les 4 toggles (format 🔊 rejoint / 🔴 quitte / ➡️ change de salon). join/leave/move TOUJOURS persistés en D1 (l'historique panel est indépendant du salon de logs) ; mute/deafen persistés seulement si toggle actif.
- packages/gateway/src/worker-api.ts : postVoiceLogs(guildId, entries[]) avec buffer 5 s (lisser les rafales).
- Étendre le DTO GuildGatewayConfig (worker-api.ts + logRowToDto dans packages/worker/src/api/welcome.ts) avec les 4 flags ; registerVoice dans packages/gateway/src/index.ts.

Worker : POST /internal/guilds/:guildId/voice-logs (zod, batch max 50) dans src/internal/routes.ts ; nouveau src/api/voice-logs.ts : GET /api/guilds/:guildId/voice-logs?userId&channelId&action&from&to&cursor (keyset pagination, lecture seule ⇒ modérateur OK) ; insertVoiceLogs/listVoiceLogs dans queries.ts.

Panel : nouvelle page src/pages/VoiceLog.tsx (route /guilds/:id/voicelog + entrée sidebar dans GuildLayout.tsx) — filtres membre (réutiliser lib/members.tsx), salon (entity-select), dates ; table style ModLog. 4 toggles dans la section logs de Welcome.tsx.

M18 — Collecte stats + premier cron Cloudflare

Migration 0015_stats_tables.sql :
- member_snapshots(guild_id, bucket 'YYYY-MM-DDTHH:00', total, humans, bots, created_at, PK(guild_id, bucket))
- channel_activity(guild_id, channel_id, day 'YYYY-MM-DD', message_count, voice_seconds, PK(guild_id, channel_id, day)) + index (guild_id, day)

Gateway — nouveau packages/gateway/src/stats.ts (registerStats) :
- Compteur messages : Map<guildId, Map<channelId, count>> sur messageCreate (bots exclus), flush 60 s → POST /internal/.../channel-activity. Aucun scan d'historique.
- Sessions vocales : map userId → {channelId, since} branchée sur voice.ts ; à leave/move, incrémente voice_seconds dans le même buffer. Flush sur SIGTERM (hook shutdown existant) ; sessions en cours perdues au restart = accepté.
- Snapshot horaire (setInterval 3600 s + au ready) : total = guild.memberCount, humans/bots via guild.members.fetch() (try/catch, fallback cache sur grosses guildes).
- Presence : étendre le payload heartbeat (index.ts) avec presence: {[guildId]: {online, idle, dnd, offline}} depuis guild.presences.cache — champ vide tant que l'intent n'est pas actif.

Worker :
- src/internal/routes.ts : POST .../member-snapshots (INSERT OR REPLACE), POST .../channel-activity (upsert ON CONFLICT … SET message_count = message_count + excluded.message_count), schéma heartbeat étendu (presence dans la même clé KV).
- wrangler.jsonc : "triggers": {"crons": ["23 4 * * *"]} ; src/index.ts : export default {fetch: app.fetch, scheduled} ; nouveau src/cron.ts : purge voice_logs >90 j, channel_activity >180 j, snapshots horaires >14 j sauf T00:00, quotidiens >400 j.

M19 — Page Stats

Pas de migration. Nouveau packages/worker/src/api/stats.ts (toutes GET ⇒ accessibles modérateur) :
- GET .../stats/members?days=7|30|90 → snapshots (horaires si 7 j, quotidiens sinon) + deltas {day, joins, leaves} agrégés depuis gateway_events (rétroactif).
- GET .../stats/channels?days=1|7|30 → top 10 salons par messages et par voice_seconds.
- GET .../stats/presence → lit KV gateway:status ; null si intent absent/gateway down.
- GET .../stats/events → REST scheduled-events + cache KV events:{guildId} TTL 300 s.

Panel : ajouter Recharts (pnpm add recharts dans packages/panel) ; lire la skill dataviz avant d'écrire les charts ; nouveau src/ui/charts.tsx (wrappers Recharts stylés palette VizColor/--viz-* de kit.tsx/index.css, thème dark, états vides) : LineChart membres (humans/bots), BarChart horizontal top salons (onglets messages/vocal), PieChart donut presence, barres ± joins/leaves. Nouvelle page src/pages/Stats.tsx (layout bento : line chart large, donut, cartes événements à venir triées par date, bar chart salons) + route + sidebar. Si presence === null → carte d'aide « Activer Presence Intent ».

Gateway : ajouter GatewayIntentBits.GuildPresences dans index.ts — déployer APRÈS l'action portail, sinon crash « Used disallowed intents » au login.

Actions manuelles : ① Portail dev Discord → Bot → Presence Intent ON (privilégié ; vérification Discord requise à 100+ serveurs) ; ② restart gateway systemd. La page doit rester fonctionnelle sans l'intent (dégradation propre).

M20 — Carte membre sur mentions (messages du bot)

Décision actée : 1 carte par mention unique, cap 3 embeds.

Migration 0016_mention_cards.sql : ALTER TABLE guilds ADD COLUMN mention_cards INTEGER NOT NULL DEFAULT 0 (opt-in).

Shared — nouveau packages/shared/src/member-card.ts : extractUserMentions(content) (regex <@!?(\d+)>, dédup, ordre d'apparition ; rôles/@everyone naturellement exclus) + buildMemberCardEmbed(info) pur (avatar thumbnail, tag, création compte dérivée du snowflake (id >> 22) + 1420070400000, arrivée serveur, rôles principaux, statut si dispo).

Worker (envois REST : réponses custom commands, annonce level-up XP) : nouveau src/discord/member-card.ts — withMemberCards(env, guildId, payload) : si mention_cards, extrait mentions, fetch membre REST en réutilisant le cache KV membre 60 s de guard.ts, append embeds (cap 3, max 10 total). Intégration via un helper central d'envoi plutôt que patcher chaque site. Toggle admin-only ; exposer mentionCards dans /internal/guilds/:id/config.

Gateway (envois discord.js : welcome, réponses keyword) : wrapper dans sendTo (events.ts) via cfg.mentionCards — membre via guild.members.fetch(id), statut presence si M19 actif. NE PAS wrapper les embeds de logs (bruit).

Panel : toggle dans Config.tsx avec note sur le comportement multi-mentions.

M21 — Refonte design : densité

Pas de migration/route. Une passe par groupe de pages, avant/après documenté (captures dans milestone.md), à faire valider page par page avant généralisation.

1. Audit : pour chaque page, repérer les vides (min-height arbitraires, paddings en cascade, colonnes non étendues) ; comparer hauteur contenu vs 100vh − header.
2. Tokens : spacing scale stricte dans src/index.css ; garde-fous : gap ≥ 12 px entre éléments de même niveau, padding cartes ≥ 16 px, whitespace généreuse autour des actions (boutons, switches), contraste net entre cartes (bordure/fond) en densifiant.
3. src/ui/kit.tsx : variante Card compacte, grilles adaptatives repeat(auto-fill, minmax(280px, 1fr)), utilitaires bento.
4. GuildLayout.tsx : max-w-6xl → max-w-7xl pour Dashboard/Stats ; suppression des min-height arbitraires.
5. Passage : Dashboard (bento KPI + mod actions + mini-stats), Stats, Config/Welcome/Automod/Levels (formulaires 2 colonnes), ModLog/VoiceLog (tables pleine hauteur), Tickets/Roles/Commands/Music.
6. Cible : contenu dans 100vh − header quand légitime (scroll OK pour les historiques), viewports 1440×900 et 1920×1080.

---
Risques transverses

- GUILD_PRESENCES : intent privilégié — portail AVANT déploiement gateway (M19), sinon crash au login.
- Quota KV free (1000 écritures/jour, ~720 déjà prises par le heartbeat) : jamais de nouvel interval d'écriture KV — presence dans le heartbeat, scheduled events à la demande.
- Croissance D1 : purge cron M18 obligatoire (rétentions actées 90/180/400 j).
- Rate limits Discord : members.fetch() horaire (M18), fetch membre par mention (M20, mitigé par cap 3 + cache KV 60 s), PATCH nick (rare).
- Restart gateway : compteurs en mémoire → flush SIGTERM, pertes résiduelles acceptées.

Actions manuelles utilisateur (récap)

1. M16 : permission Change Nickname du bot sur chaque serveur.
2. M19 : Presence Intent ON au portail dev → restart gateway systemd (VPS ubuntu@164.132.98.139).

Vérification (par milestone)

- Worker : pnpm test (vitest-pool-workers) — nouveaux tests : garde 403 modérateur, insert/list voice_logs, upsert channel_activity incrémental (2 posts = somme), agrégations stats, purge (bornes), extractUserMentions/buildMemberCardEmbed/withMemberCards.
- Migrations : pnpm migrate:local puis migrate:remote au déploiement.
- Manuel documenté : M15 compte modérateur (tout visible, rien modifiable) ; M16 surnoms distincts sur 2 serveurs ; M17 join/leave/move vocal → embeds + lignes filtrables ; M18 après 24 h wrangler d1 execute montre snapshots + compteurs cohérents ; M19 graphes cohérents et page OK sans intent ; M20 commande custom avec mention → carte, toggle off → rien ; M21 revue avant/après page par page.
- Non-régression : commandes existantes (modération, XP, musique, tickets) après chaque déploiement gateway.
- Doc : à chaque milestone, màj milestone.md + context.md + README (nouvelles variables/permissions : Presence Intent, Change Nickname, mapping rôle → niveau d'accès).