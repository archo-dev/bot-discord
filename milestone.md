# Milestones — botdiscord

> Suivi détaillé de l'avancement. Vue complémentaire de [context.md](context.md) (qui décrit l'architecture).
> Règle : **un milestone = migration + API + panel + tests + commit + rapport.**
> Avant chaque commit : `pnpm -r check` → `pnpm --filter '@bot/worker' test` → `pnpm --filter '@bot/panel' build`.
>
> Dernière mise à jour : 2026-07-09

| # | Milestone | Statut | Commit |
|---|---|---|---|
| M1 | Bot minimal (Ed25519 + /ping) | ✅ Livré | `5d0b9f2` |
| M2 | Base D1 + couche de requêtes | ✅ Livré | `914b12d` |
| M3 | OAuth2 + panel React | ✅ Livré | `828637b` |
| M4+M5 | Commandes personnalisées | ✅ Livré | `9429d0a` |
| M6+M7 | Modération + API interne | ✅ Livré | `22b644c` |
| — | Déploiement production | ✅ Livré | `ee10fdf` |
| M8 | Tickets + composants d'interaction | ✅ Livré | `a1cce30` |
| M9 | /history + rôles par bouton | ✅ Livré | `8e94d7d` |
| M10 | Service Gateway + VPS | ✅ Livré + VPS en production (badge vert) | `5f8ec67` |
| M11 | Bienvenue/départ + auto-rôles + logs | ✅ Livré + déployé (test join/leave restant) | `9b734c9` |
| M12 | Auto-modération | ✅ Livré + déployé (test manuel restant) | `f67fec7` |
| M13 | XP / Niveaux | ✅ Livré + déployé (test manuel restant) | `c2a0503` |
| M14 | Musique | 🔶 Code livré + gateway VPS OK ; tunnel + deploy Worker restants | `503a909` |

---

## ✅ M1 — Bot minimal (`5d0b9f2`)

- Endpoint `POST /interactions` avec vérification **Ed25519** (WebCrypto) sur chaque requête
- Réponse PONG (type 1), commande `/ping`
- `scripts/register-commands.ts` + `pnpm register:dev` (enregistrement sur le serveur de test via `DEV_GUILD_ID`)

## ✅ M2 — Base de données (`914b12d`)

- 5 migrations D1 initiales (guilds, guild_config, custom_commands, auto_roles, …)
- `src/db/queries.ts` : couche SQL brute typée (pattern à réutiliser pour toute nouvelle table)
- `ensureGuild` : upsert automatique de la guilde à chaque interaction reçue

## ✅ M3 — Auth + panel (`828637b`)

- OAuth2 Discord (login), sessions en KV, `SESSION_SECRET`
- `requireSession` + `requireGuildAccess` : permissions Discord **réelles** re-vérifiées côté serveur à chaque requête
- API panel : guilds, config, channels, roles, panel-access, auto-roles
- Squelette React : Vite + react-router + TanStack Query + Tailwind

## ✅ M4+M5 — Commandes personnalisées (`9429d0a`)

- Moteur d'exécution à **actions whitelistées** (pas d'eval) : reply, embed, add/remove role, DM, webhook (garde SSRF)…
- Conditions, cooldowns (KV), variables `{user} {server} {membercount}` (`@bot/shared/variables`)
- API CRUD avec révisions + enregistrement automatique auprès de Discord
- Panel : builder mode simple + mode avancé (`CommandEditor.tsx` — pattern de formulaire de référence)

## ✅ M6+M7 — Modération + API interne (`22b644c`)

- `/warn /mute /kick /ban /unban /warnings /clear` avec permissions natives Discord
- Seuil de warns → timeout automatique ; `mod_actions` + `warnings` en D1 ; `postModLog`
- Panel : page **ModLog** (paginée)
- `/internal/*` (bearer `INTERNAL_API_TOKEN`) : contrat posé pour le futur gateway
- README de déploiement

## ✅ Déploiement production (`ee10fdf`)

- D1 `464ca130-…` migrée (remote), KV `364e4736…`, ids câblés dans `wrangler.jsonc`
- 5 secrets via `wrangler secret bulk` (⚠️ jamais via pipe PowerShell — voir context.md §7)
- Endpoint validé dans le Developer Portal, Worker sur `https://botdiscord.archodev.workers.dev`
- Commandes enregistrées sur le serveur de test `1406188083380092989`

## ✅ M8 — Tickets + composants d'interaction (`a1cce30`) — 86/86 tests

- Router : types 3 (MessageComponent) et 5 (ModalSubmit), dispatch par préfixe de `custom_id`, registre `interactions/components/`
- Migration `0006_tickets.sql` : `ticket_settings`, `tickets` (numérotation atomique)
- Flux : panneau publié depuis le panel → `ticket:open` (refus si déjà ouvert + cooldown KV) → salon `ticket-NNNN` avec overwrites → `ticket:close` → modal raison → transcript paginé (≤500 messages) en D1 + `.txt` posté → salon supprimé
- `discordUpload` (multipart) ajouté à `rest.ts`, `modal()` ajouté à `respond.ts`
- Panel : page **Tickets** (réglages, publication, liste + visionneuse de transcripts)

**Test manuel** : panel → Tickets → configurer catégorie + salon transcripts + rôles staff → publier le panneau → ouvrir/fermer un ticket sur Discord.

## ✅ M9 — /history + rôles par bouton (`8e94d7d`) — 91/91 tests

- `/history @membre` — embed historique (`listModActions` + warns actifs), permission `MODERATE_MEMBERS`, ajouté à `register-commands.ts`
- Migration `0007_button_roles.sql` — `button_role_messages`, `button_roles` ; queries D1 dans `queries.ts`
- Handler `brole:<id>` (`components/button-roles.ts`) — toggle PUT/DELETE du rôle, hint hiérarchie sur 403
- API `api/button-roles.ts` — GET/POST (vérif salon + rollback)/DELETE, câblée dans `index.ts` ; DTOs dans `@bot/shared/api-types`
- Panel : page **Rôles** (`Roles.tsx`, ≤25 boutons), route + onglet
- Vérifications : `pnpm -r check` ✅ · tests worker **91/91** ✅ · build panel ✅ · `pnpm register:dev` ✅ (9 commandes dont `/history`)

**Prod** : migrations 0006+0007 appliquées en remote (0006/M8 avait été oubliée), Worker déployé (version `13172eee`), `/health` 200.

**Test manuel restant** : `/history @membre` sur Discord ; panel → Rôles → publier un message → cliquer les boutons.

## ✅ M10 — Service Gateway + VPS (`5f8ec67`) — 93/93 tests

- [x] Scaffold `packages/gateway` (`@bot/gateway`) : Node 22 + discord.js v14 (intent `Guilds` seul pour l'instant), tsx en dev / tsup en build, `.env.example`, `pnpm dev:gateway` à la racine
- [x] Mini serveur HTTP Hono (@hono/node-server, `src/http.ts`) protégé par `GATEWAY_HTTP_TOKEN` — `GET /health` (ready, guildCount, wsPing, uptime)
- [x] Heartbeat : POST `/internal/gateway/heartbeat` toutes les 60 s → KV `gateway:status` (TTL 180 s : silence = déconnecté, zéro cleanup)
- [x] Cache config mémoire 60 s (`src/config-cache.ts`) via `/internal/guilds/:id/config`
- [x] Worker : endpoint heartbeat (zod), `Env.GATEWAY_ORIGIN`/`GATEWAY_HTTP_TOKEN` optionnels
- [x] Panel : badge « Gateway connectée » branché sur la présence de la clé KV (tooltip selon l'état)
- [x] Guide VPS pas à pas dans le README : achat (~5€), clés SSH, user non-root, ufw + durcissement sshd, nvm/Node 22, pnpm, clone/build, `.env`, systemd `botdiscord-gateway`, cloudflared, ffmpeg, procédure de mise à jour
- [x] Tests : heartbeat 401/400/200 + KV (`internal.test.ts`), badge overview (`api-guard.test.ts`) ; smoke test du binaire (validation env propre)

**✅ Validé le 2026-07-09** : VPS OVH Ubuntu 24.04 (`164.132.98.139`, user `ubuntu`), service systemd `botdiscord-gateway` actif, bot connecté (« Le Batard#1241 »), Worker déployé (`4e6e7ee9`), heartbeat visible en KV → badge vert. Particularités vs guide README : pas de GitHub (code envoyé par `git bundle` + scp), Node via NodeSource (`/usr/bin/node`), utilisateur `ubuntu` d'OVH réutilisé (clé SSH + sudo sans mdp), cloudflared/`GATEWAY_ORIGIN` reportés à M14 (pas de domaine).

**Env gateway** : `DISCORD_TOKEN`, `WORKER_ORIGIN`, `INTERNAL_API_TOKEN`, `GATEWAY_HTTP_TOKEN`, `GATEWAY_PORT`.

## ✅ M11 — Bienvenue/départ + auto-rôles + logs serveur (`9b734c9` + fix `f224eba`) — 97/97 tests

- [x] Migration 0008 : `welcome_settings` (messages avec variables, défauts FR), `log_settings` (salon + 5 toggles) — appliquée en remote
- [x] Worker : `api/welcome.ts` (GET/PUT welcome + log-settings, vérif appartenance des salons), `/internal/guilds/:id/config` enrichi (`welcome` + `logs`, défauts si pas de ligne)
- [x] Gateway : `events.ts` — `guildMemberAdd` (auto-rôles + message bienvenue + embed log + event D1), `guildMemberRemove`, `messageDelete/Update` (skip bots et unfurls), `guildMemberUpdate` (surnom/rôles) ; intents `GuildMembers`/`GuildMessages`/`MessageContent` + `Partials.Message`
- [x] Panel : page **Bienvenue** (bienvenue/départ avec chips de variables, logs serveur), onglet + route ; badge « Nécessite le Gateway » retiré de Config
- [x] Fix build gateway : `@bot/shared` (TS brut) doit être bundlé — `tsup.config.ts` `noExternal`
- [x] Déployé : Worker `8885b143`, migration 0008 remote, gateway M11 actif sur le VPS, intents privilégiés activés dans le portail
- [ ] **Test manuel restant** : panel → Bienvenue (salon + messages + logs) → join/leave avec un compte jetable → vérifier message, auto-rôle et embeds

## ✅ M12 — Auto-modération (`f67fec7`) — 102/102 tests

- [x] Migration 0009 : `automod_settings` (anti-spam max/fenêtre, anti-invite, anti-lien + whitelist JSON, mots interdits, exemptions rôles/salons, action delete|warn|timeout + durée) — appliquée en remote
- [x] Gateway `automod.ts` : pipeline `messageCreate` — exemptions (ManageMessages toujours exempté, rôles/salons) → mots → invites → liens (suffixe de domaine) → spam (fenêtre glissante mémoire + sweep 5 min) → delete + notice auto-supprimée 5 s
- [x] `/internal/guilds/:id/automod-sanctions` : warn → `warnings` + `mod_actions` + **seuil warns → auto_timeout** (même mécanique que `/warn`, modérateur « automod ») ; timeout → PATCH REST + `mod_actions` ; embeds ModLog partout
- [x] Action `delete` seule : pas de ligne `mod_actions` (contrainte CHECK) — embed posté par le gateway dans le salon de mod-log
- [x] Panel : page **Auto-mod** (sanction, anti-spam, invitations/liens + whitelist, mots interdits, exemptions par chips)
- [x] Déployé : Worker `67806992`, migration 0009 remote, gateway M12 actif (config automod visible sur `/internal` prod)
- [ ] **Test manuel restant** : configurer l'automod dans le panel → avec un compte **sans** « Gérer les messages », poster une invite/spam → sanction + ModLog

## ✅ M13 — XP / Niveaux (`c2a0503`) — 106/106 tests

- [x] `@bot/shared/xp` : courbe 5n²+50n+100 (`xpForNextLevel`, `totalXpForLevel`, `levelFromXp`)
- [x] Migration 0010 : `xp_settings` (min/max, cooldown, annonce + salon optionnel, récompenses JSON), `xp_members` (PK guild+user, username rafraîchi à chaque gain) — appliquée en remote
- [x] Gateway `xp.ts` : cooldown mémoire par membre + sweep → POST `/internal/guilds/:id/xp` (fire-and-forget)
- [x] `/internal/xp` : montant aléatoire, upsert, level-up → rôles récompense (rattrapage ≤ niveau) + annonce REST (salon dédié ou salon du message)
- [x] Builtins `/rank` (niveau, rang, barre de progression) + `/leaderboard` (top 10) — enregistrées (11 commandes)
- [x] Panel : onglet **Niveaux** (réglages, récompenses niveau→rôle, classement top 20)
- [x] Déployé : Worker `6ff6ad68`, migration 0010 remote, gateway M13 actif (⚠️ un 7403 Cloudflare transitoire sur la 1ʳᵉ tentative de migration — retry OK)
- [ ] **Test manuel restant** : panel → Niveaux → activer → envoyer des messages → `/rank`, `/leaderboard`, récompense de niveau

## 🔶 M14 — Musique (`503a909`) — 111/111 tests, tunnel restant

**Fait et vérifié :**

- [x] VPS : opusscript + libsodium-wrappers (JS pur, zéro build natif), yt-dlp binaire (extraction YouTube confirmée depuis le VPS), ffmpeg, DisTube v5 + `@distube/yt-dlp` (dernier) + `@distube/spotify`
- [x] Gateway `music.ts` : DisTube + intent `GuildVoiceStates`, dispatcher `POST /music` (bearer), now-playing embed rafraîchi 15 s, état → KV via `/internal`, auto-disconnect via event `disconnect`
- [x] Worker : `gateway/forward.ts` (forward bearer + token d'interaction, message propre si injoignable), `builtins/music.ts` (14 commandes + sous-commandes playlist), `/internal` music-state + playlists, `api/music.ts` (état + contrôles panel + liste playlists)
- [x] Migration 0011 `playlists` (écrite, **pas encore appliquée en remote**)
- [x] Panel : page **Musique** (now-playing, barre de progression, file, boutons pause/skip/stop, playlists) — polling KV 4 s
- [x] Gateway M14 déployé sur le VPS et démarré proprement (DisTube init OK)

**Reste (bloqué sur action utilisateur) :**

- [ ] Domaine rattaché à Cloudflare → tunnel cloudflared `gateway.<domaine>` → localhost:8788 (guide README §8)
- [ ] Secrets Worker `GATEWAY_ORIGIN` + `GATEWAY_HTTP_TOKEN` (le token est déjà dans le `.env` du VPS)
- [ ] Migration 0011 remote + `wrangler deploy` + `pnpm register:dev` (autorisation utilisateur)
- [ ] Validation : `/play` sur Discord + contrôles + vue panel

⚠️ Risque assumé : YouTube casse régulièrement les libs de musique — `yt-dlp` à mettre à jour ponctuellement (`sudo curl -L …/yt-dlp -o /usr/local/bin/yt-dlp`).
