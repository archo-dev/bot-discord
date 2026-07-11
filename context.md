# Contexte du projet — botdiscord

> Document de référence : tout ce qui a été fait, comment c'est architecturé, où on en est, et ce qui reste.
> Dernière mise à jour : 2026-07-11 (design v2 « Nocturne 2 » : Phases 0+1 terminées + gros de la Phase 2, voir §8 ; M14 toujours bloqué sur domaine utilisateur).

## 1. Vue d'ensemble

Bot Discord d'administration **100% serverless Cloudflare** avec panel web de configuration, en cours d'extension vers les fonctionnalités type **Draftbot** (tickets, modération, automod, bienvenue, rôles, logs, XP) et **Rythm** (musique).

- **Production** : `https://botdiscord.armand-dedo.workers.dev` (Worker + panel servis par la même origine)
- **Application Discord** : ID `1524597895859536074`
- **Serveur de test** : `1406188083380092989`
- **Repo** : monorepo pnpm workspaces, TypeScript strict partout

### Choix d'architecture fondamentaux (actés, ne pas remettre en cause)

1. **Pas de discord.js dans le Worker.** Le bot fonctionne en **HTTP Interactions** : Discord POSTe sur `/interactions`, chaque requête est vérifiée **Ed25519** (WebCrypto). Les appels sortants passent par un client REST maison (`fetch` typé avec `discord-api-types/v10`).
2. **Option A → B** : d'abord tout en Worker (fait), puis un **service Gateway** (Node 22 + discord.js v14 sur un VPS ~5€/mois) pour les événements temps réel et la musique. Le contrat `/internal/*` (bearer `INTERNAL_API_TOKEN`) existe depuis le début pour ça.
3. **Le Worker est l'unique écrivain D1.** Le futur gateway lira/écrira exclusivement via `/internal/*`.
4. **Sécurité** : schémas zod de `@bot/shared` = frontière de validation ; permissions Discord réelles re-vérifiées côté serveur sur chaque requête panel ; whitelist stricte d'actions pour les commandes custom (pas d'eval) ; jamais de channel ID client sans vérifier `channel.guild_id === guildId` ; tout est **par guildId**, jamais global.

## 2. Structure du monorepo

```
packages/
  shared/   @bot/shared  — schémas zod, types API (DTOs), variables {user}/{server}, permissions
  worker/   @bot/worker  — Hono 4 sur Cloudflare Workers : /interactions, /auth, /api, /internal ; D1 + KV
  panel/    @bot/panel   — Vite 6 + React 19 + react-router 7 + TanStack Query 5 + Tailwind 4
  gateway/  @bot/gateway — Node 22 + discord.js v14 (VPS) : heartbeat, cache config 60 s, HTTP Hono (GATEWAY_HTTP_TOKEN)
scripts/
  register-commands.ts   — enregistrement des slash commands (pnpm register:dev)
```

Fichiers clés du Worker :

| Fichier | Rôle |
|---|---|
| `src/index.ts` | Composition Hono : health, interactions, auth, internal, puis `/api` (session + `requireGuildAccess`) |
| `src/interactions/router.ts` | Vérif Ed25519, dispatch type 2 (commandes), 3 (composants), 5 (modals) |
| `src/interactions/builtins/` | Commandes intégrées (ping, modération, history…) |
| `src/interactions/components/` | Handlers de composants par préfixe de `custom_id` (`ticket:`, `brole:`) |
| `src/db/queries.ts` | Couche SQL typée (SQL brut, pas d'ORM) |
| `src/discord/rest.ts` | Client REST Discord (`discordFetch`, `discordUpload` multipart) |
| `src/auth/guard.ts` | `requireSession` + `requireGuildAccess` (permissions réelles re-vérifiées) |
| `src/internal/routes.ts` | API interne pour le futur gateway (bearer token) |
| `migrations/` | Migrations D1 versionnées (wrangler) |

## 3. Ce qui est livré (commits)

### M1 — Bot minimal (`5d0b9f2`)
Endpoint `/interactions` vérifié Ed25519, `/ping`, script d'enregistrement des commandes.

### M2 — Base de données (`914b12d`)
Schéma D1 (5 migrations initiales), couche de requêtes typée, upsert automatique de la guilde à chaque interaction (`ensureGuild`).

### M3 — Auth + panel (`828637b`)
OAuth2 Discord, sessions KV, garde d'accès par guilde, API panel (guilds/config/channels/roles/panel-access/auto-roles), squelette React.

### M4+M5 — Commandes personnalisées (`9429d0a`)
Moteur à actions whitelistées (conditions, cooldowns, garde SSRF), API CRUD avec révisions + enregistrement Discord, builder panel (mode simple + avancé).

### M6+M7 — Modération + API interne (`22b644c`)
`/warn /mute /kick /ban /unban /warnings /clear`, seuil de warns → timeout auto, mod-logs (page ModLog du panel), API `/internal/*` pour le gateway, README de déploiement.

### Déploiement production (`ee10fdf`)
- D1 créée (`464ca130-…`) + migrations remote, KV créée (`364e4736…`), ids câblés dans `wrangler.jsonc`
- 5 secrets uploadés (`DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`)
- Endpoint d'interactions validé dans le Developer Portal, commandes enregistrées sur le serveur de test
- Panel accessible via OAuth (le serveur apparaît après la première interaction, ex. `/ping`)

### M8 — Tickets + composants d'interaction (`a1cce30`) — 86/86 tests
- Router : gestion des types 3 (MessageComponent) et 5 (ModalSubmit), dispatch par préfixe de `custom_id`
- Migration `0006_tickets.sql` : `ticket_settings` + `tickets` (numérotation atomique `RETURNING`)
- Flux complet : panneau publié depuis le panel → bouton « Ouvrir un ticket » → salon privé `ticket-NNNN` avec overwrites (créateur + rôles staff + bot) → bouton Fermer → modal raison → transcript (messages paginés, max 500) stocké en D1 + posté en `.txt` → salon supprimé
- Anti-abus : refus si ticket déjà ouvert, cooldown KV
- Panel : page **Tickets** (réglages, publication du panneau, liste + lecture des transcripts)

### M9 — `/history` + rôles par bouton (`8e94d7d`) — 91/91 tests

- `/history @membre` : embed de l'historique de modération (réutilise `listModActions` + compte de warns actifs), permission `MODERATE_MEMBERS`, enregistré via `register-commands.ts`
- Migration `0007_button_roles.sql` : `button_role_messages` + `button_roles`
- Handler `brole:<id>` : toggle add/remove du rôle via REST, message clair en cas d'erreur de hiérarchie (403)
- API `api/button-roles.ts` : GET liste / POST publication (vérifie l'appartenance du salon, rollback si échec) / DELETE
- Panel : page **Rôles** (`Roles.tsx`, route + onglet) — composeur de message (jusqu'à 25 boutons : rôle/libellé/emoji/couleur)
- Vérifié : typecheck, 91/91 tests worker, build panel, `pnpm register:dev` (9 commandes)

### M10 — Service Gateway + guide VPS — 93/93 tests

- `packages/gateway` : discord.js v14 (intent `Guilds`), heartbeat 60 s → `POST /internal/gateway/heartbeat`, cache config mémoire 60 s, serveur HTTP Hono bearer `GATEWAY_HTTP_TOKEN` (`GET /health`), `.env.example`, tsx dev / tsup build, `pnpm dev:gateway`
- Worker : endpoint heartbeat → KV `gateway:status` (TTL 180 s), `gatewayConnected` de l'overview lit la présence de la clé ; `Env.GATEWAY_ORIGIN`/`GATEWAY_HTTP_TOKEN` optionnels
- README : guide VPS complet pas à pas (SSH, ufw, nvm, systemd, cloudflared, ffmpeg)
- **✅ VPS en production** (2026-07-09) : OVH Ubuntu 24.04, IP `164.132.98.139`, user `ubuntu` (clé SSH seule, ufw, root/mdp SSH désactivés), Node 22 NodeSource, service systemd `botdiscord-gateway`, bot « Le Batard#1241 » connecté, heartbeat en KV → badge vert. Pas de GitHub : déploiement par `git bundle` + scp. cloudflared + secrets `GATEWAY_ORIGIN`/`GATEWAY_HTTP_TOKEN` côté Worker : reportés à M14 (le `GATEWAY_HTTP_TOKEN` du VPS est déjà généré, dans son `.env`)

## 4. État prod

Migrations 0006+0007 appliquées en remote le 2026-07-09 (⚠️ la 0006/M8 avait été oubliée lors du commit M8 — toujours appliquer les migrations remote au moment du déploiement du milestone). Worker déployé (version `13172eee`), `/health` 200, commandes (dont `/history`) enregistrées sur le serveur de test.

Test manuel M9 restant : `/history @membre` sur Discord ; panel → Rôles → publier un message → cliquer les boutons.

## 5. Feuille de route (plan approuvé, décisions utilisateur actées)

Décisions : **Gateway sur VPS ~5€/mois** (utilisateur débutant → setup guidé pas à pas), **musique en dernier**, **XP/niveaux inclus**.

| Milestone | Contenu | Où |
|---|---|---|
| **M10** ✅ | Scaffold `packages/gateway` (discord.js v14, Hono node, heartbeat → KV `gateway:status`, cache config 60 s), guide VPS complet (SSH, ufw, nvm, systemd, cloudflared), badge « Gateway connecté » dans le panel — livré, installation VPS restante | VPS |
| **M11** ✅ | Bienvenue/départ + auto-rôles à l'arrivée + logs serveur (migration 0008) — livré, déployé (Worker `8885b143`, gateway VPS à jour, intents activés) | Gateway |
| **M12** ✅ | Auto-modération : anti-spam/invite/lien/mots, exemptions, sanctions via `/internal` qui insèrent aussi des `warnings` (migration 0009) — livré, déployé (Worker `67806992`, gateway VPS à jour) | Gateway |
| **M13** ✅ | XP/niveaux : gain par message, `/rank`, `/leaderboard`, rôles récompense, page Classement (migration 0010) — livré, déployé (Worker `6ff6ad68`, gateway VPS à jour) | Gateway + Worker |
| **M14** 🔶 | Musique : DisTube v5 + yt-dlp + ffmpeg, Spotify → recherche YouTube, forward Worker→gateway (token d'interaction), état panel par polling KV (migration 0011 playlists) — **code livré + gateway VPS OK** ; reste tunnel cloudflared `gateway.<domaine>` + secrets Worker `GATEWAY_ORIGIN`/`GATEWAY_HTTP_TOKEN` + migration 0011 remote + deploy | Gateway |

Frontière technique : tout ce qui est interaction HTTP (boutons, modals, slash commands) reste dans le Worker ; tout ce qui exige un WebSocket ou du vocal (événements membres/messages, musique) va sur le gateway.

## 6. Commandes de développement

```powershell
pnpm -r check                          # typecheck tout le monorepo
pnpm --filter '@bot/worker' test       # suite vitest-pool-workers (workerd réel, D1/KV réels, fetchMock)
pnpm --filter '@bot/panel' build       # build du panel
pnpm --filter '@bot/worker' dev        # worker local (lit .dev.vars)
pnpm register:dev                      # (ré)enregistre les slash commands sur le serveur de test
pnpm --filter '@bot/worker' exec wrangler deploy
pnpm --filter '@bot/worker' exec wrangler d1 migrations apply botdiscord --remote
```

Secrets locaux : `packages/worker/.dev.vars` (gitignoré). Un commit = un milestone, message style `M8: ticket system + component interactions`.

## 7. Leçons apprises (pièges à ne pas re-tomber dedans)

1. **Jamais `Write-Output "valeur" | wrangler secret put NAME`** sous PowerShell : le pipe ajoute un CRLF et le `\r` corrompt le secret (toutes les vérifs Ed25519 échouaient en 401). Toujours `wrangler secret bulk fichier.json`, puis supprimer le fichier.
2. **vitest-pool-workers rollback D1/KV entre chaque test** d'un même fichier : seuls les seeds de `beforeAll` persistent ; chaque test doit être auto-suffisant.
3. **Modals discord-api-types** : l'union des composants de soumission n'a pas uniformément `.components` — utiliser `"components" in row ? row.components : "component" in row ? [row.component] : []`.
4. **PATH Windows** : préfixer git/pnpm dans les sessions PowerShell si introuvables (voir mémoire `botdiscord-env-windows`).
5. **DNS local capricieux** : si `*.workers.dev` ne résout pas, tester via 1.1.1.1 (`curl.exe --resolve host:443:IP`) avant de suspecter le déploiement.
6. **Panel vide après install** : la table `guilds` se remplit à la première interaction — lancer `/ping` sur le serveur.
7. **Catégories de salons** : l'endpoint channels renvoie aussi le type 4 (catégorie, nécessaire pour les tickets) — filtrer `ch.type !== 4` dans les selects de salons texte, cache `channels:v2:`.
8. **`@bot/shared` est du TS brut** (`exports: ./src/index.ts`) : tout consommateur Node runtime (gateway) doit le **bundler** — `noExternal: ["@bot/shared"]` dans `tsup.config.ts`. Le build passait tant que rien n'était importé à runtime ; découvert au premier `import { substituteVariables }` (crash ERR_MODULE_NOT_FOUND en prod).
9. **Intents privilégiés** : `GuildMembers` et `MessageContent` doivent être activés dans le Developer Portal (Bot → Privileged Gateway Intents), sinon le login échoue en « Used disallowed intents ». Fait pour cette app.

## 8. Chantier design v2 « Nocturne 2 » (panel, non commité)

Spécification : `docs/design_system_v2.md` · plan : `docs/ux_improvement_plan.md`. État au 2026-07-11 (tout front, typecheck + build verts) :

**Fait :**
- Phase 0 : tokens v2 (`index.css` : info, state-layers, motion, z-index, skeleton), Inter self-hostée (`public/fonts`), primitives `ui/` (toast + Toaster global, Modal/ConfirmModal avec focus trap, SaveBar + useDirty, skeletons, EmptyState, IconButton, Tooltip, Pagination, ErrorCard, InfoTile, UserCell dégradée dans `cells.tsx`), `lib/queryClient.ts` (MutationCache global : toast d'erreur systématique, `meta.successMessage`/`silentError`)
- Phase 1 : toutes les pages migrées (8 pages de réglages avec SaveBar + les autres : Dashboard, ModLog, Music, GuildList, App, CommandEditor, transcript Tickets) — zéro `confirm()`, zéro « Chargement… », skeletons partout, EmptyStates à registres, révocation de warn via ConfirmModal
- Phase 2 (partiel) : sidebar groupée + carte serveur unifiée + sous-titre par page + titres de document + favicon (GuildLayout), drawer mobile avec focus trap + Échap, Tabs ARIA (flèches), chips 40 px, dates relatives doublées d'absolu (`TimeAgo`), UserCell partout (mode dégradé : ID abrégé copiable — l'endpoint de résolution de membres reste à faire côté Worker)
- Phase 3 (partiel) : transitions de page 150 ms (H2), garde de navigation interne de la SaveBar (`useBlocker` + modale « Quitter sans enregistrer ? ») — a nécessité le passage de `<BrowserRouter>` à `createBrowserRouter` (route splat, `main.tsx`), +58 kB de bundle (warning vite > 500 kB, code-splitting en option future)
- Phase 3 — E5 erreurs par champ : le Worker enrichit ses 400 `invalid_body` avec `fields` (helper `api/validation.ts`, `z.flattenError`, routes panel uniquement — `/internal` inchangé) ; `ApiError.fields` + `fieldError()` (avec traduction FR des messages zod) côté panel ; `Field` du kit a une prop `error` (bordure danger, `aria-invalid`/`aria-describedby`) ; câblé sur Config, Welcome, Levels, Automod, Tickets (publication) et CommandEditor (`duplicate_name` sous le champ Nom)

**Reste (Phase 2/3) :** Combobox salons/rôles/membres (E3/E4, dépend du même endpoint), UserCell enrichie (avatar+pseudo), sparkline/deltas Dashboard (dépendances back). `SaveFeedback` du kit est déprécié (plus utilisé).

## 9. Risques assumés

- **Musique fragile** (YouTube casse régulièrement les libs — cause de la mort de Rythm) : DisTube maintenu, mises à jour ponctuelles à prévoir.
- **VPS = deuxième endroit où vit le token bot** : setup durci (clés SSH, ufw, pas de port public grâce au tunnel Cloudflare).
- **Anti-spam en mémoire** (perdu au restart) et **transcripts en D1** (cap ~500 messages) : suffisant pour un bot privé, R2 en option future.
