# Bot Discord d'administration + Panel web — 100% Cloudflare

Bot de modération Discord (slash commands via HTTP Interactions) et panel web de configuration, hébergés sur **Cloudflare Workers + D1 + KV**. Aucun serveur à maintenir.

## Architecture

**Option A — HTTP Interactions** (choisie) : le bot répond aux slash commands via le endpoint HTTP de Discord (signature Ed25519 vérifiée sur chaque requête). Pas de connexion Gateway :

| Fonctionne dès maintenant | Nécessite le futur service Gateway (Option B) |
|---|---|
| `/ban` `/kick` `/mute` `/warn` `/warnings` `/clear` `/unban` `/ping` | Auto-modération temps réel sur chaque message |
| Commandes personnalisées slash (builder simple + avancé) | Commandes déclenchées par mot-clé |
| Seuil de warns → timeout automatique (au moment du `/warn`) | Rôle automatique à l'arrivée |
| Logs de modération dans un salon dédié | Logs d'arrivées/départs |
| Panel web complet (OAuth2 Discord) | |

L'architecture est prête pour l'Option B : les fonctionnalités gateway sont déjà modélisées en base (tables `auto_roles`, `gateway_events`, triggers `keyword`) et une API interne `/internal/*` (bearer token) attend le futur service Node.js (discord.js v14). Il suffira de le brancher — aucune refonte.

```
packages/
├── shared/   # Schéma zod des commandes perso (liste blanche = frontière de sécurité), types API
├── worker/   # Cloudflare Worker : interactions Discord + API panel (Hono) + D1 + KV
└── panel/    # SPA React (Vite + Tailwind) servie par le même Worker
scripts/register-commands.ts   # Enregistrement des slash commands built-in
```

## Prérequis

- Node.js ≥ 20, [pnpm](https://pnpm.io) ≥ 10
- Un compte Cloudflare (le free tier suffit)
- Une application Discord : <https://discord.com/developers/applications> → **New Application**

## 1. Configuration Discord

Dans le [Developer Portal](https://discord.com/developers/applications), pour votre application :

1. **General Information** : notez `Application ID` et `Public Key`.
2. **Bot** : notez le `Token` (Reset Token si besoin).
3. **OAuth2** : notez le `Client Secret`, et ajoutez les **redirects** :
   - `http://localhost:5173/auth/callback` (dev)
   - `https://<votre-worker>.workers.dev/auth/callback` (prod, après le premier déploiement)
4. **Invitez le bot** sur votre serveur (remplacez `CLIENT_ID`) :

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=1101659218950
```

> Permissions incluses : Ban/Kick/Timeout des membres, Gérer les messages, Gérer les rôles, Envoyer des messages, Liens intégrés, Historique, Voir les salons.

## 2. Développement local

```bash
pnpm install

# Secrets locaux
cp packages/worker/.dev.vars.example packages/worker/.dev.vars
# → remplir DISCORD_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_CLIENT_SECRET,
#   SESSION_SECRET, INTERNAL_API_TOKEN (chaînes aléatoires), et ajouter
#   DEV_GUILD_ID=<id de votre serveur de test>
# Dans packages/worker/wrangler.jsonc : renseigner DISCORD_CLIENT_ID

# Base D1 locale + build du panel (requis par wrangler assets)
pnpm build
pnpm migrate:local

# Terminal 1 — worker (port 8787)
pnpm dev
# Terminal 2 — panel avec hot-reload (port 5173, proxy /api et /auth vers 8787)
pnpm dev:panel

# Enregistrer les slash commands sur votre serveur de test (propagation instantanée)
pnpm register:dev
```

**Tester les interactions Discord en local** : Discord doit joindre votre worker en HTTPS. Exposez le port 8787 :

```bash
cloudflared tunnel --url http://localhost:8787
```

puis collez `https://<tunnel>.trycloudflare.com/interactions` dans **General Information → Interactions Endpoint URL**. Discord envoie immédiatement un PING signé : l'URL n'est acceptée que si la vérification Ed25519 fonctionne. Tapez ensuite `/ping` sur votre serveur.

Panel : ouvrez <http://localhost:5173>, connectez-vous avec Discord. Seuls apparaissent les serveurs où vous avez « Gérer le serveur » **et** où le bot est installé (le bot s'enregistre en base à la première interaction — lancez `/ping` une fois si la liste est vide).

## 3. Déploiement sur Cloudflare

```bash
cd packages/worker

# Créer les ressources (une seule fois) et reporter les ids dans wrangler.jsonc
npx wrangler d1 create botdiscord      # → database_id
npx wrangler kv namespace create KV    # → id

# Renseigner aussi dans wrangler.jsonc :
#   vars.DISCORD_CLIENT_ID  = votre Application ID
#   vars.PANEL_ORIGIN       = https://<votre-worker>.workers.dev

# Secrets de production
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET        # ex: openssl rand -hex 32
npx wrangler secret put INTERNAL_API_TOKEN    # ex: openssl rand -hex 32

# Migrations puis déploiement
npx wrangler d1 migrations apply botdiscord --remote
cd ../.. && pnpm deploy
```

Ensuite, dans le Developer Portal :

1. **Interactions Endpoint URL** → `https://<votre-worker>.workers.dev/interactions`
2. **OAuth2 Redirects** → ajouter `https://<votre-worker>.workers.dev/auth/callback`
3. Enregistrer les commandes globalement : `pnpm register:global` (propagation ≤ 1 h)

Smoke test : `/ping` sur un serveur, login sur `https://<votre-worker>.workers.dev`, création d'une commande perso, `/warn` sur un compte de test, vérification du salon de logs.

## Variables d'environnement

| Nom | Type | Description |
|---|---|---|
| `DISCORD_CLIENT_ID` | var (`wrangler.jsonc`) | Application ID Discord |
| `PANEL_ORIGIN` | var (`wrangler.jsonc`) | Origine du panel (redirect OAuth) |
| `DISCORD_TOKEN` | secret | Token du bot |
| `DISCORD_PUBLIC_KEY` | secret | Clé publique (vérif Ed25519 des interactions) |
| `DISCORD_CLIENT_SECRET` | secret | Secret OAuth2 |
| `SESSION_SECRET` | secret | Aléatoire (sessions) |
| `INTERNAL_API_TOKEN` | secret | Bearer de l'API `/internal/*` (futur gateway) |
| `DEV_GUILD_ID` | `.dev.vars` uniquement | Serveur de test pour `pnpm register:dev` |

## Sécurité

- **Signature Ed25519** vérifiée sur chaque interaction (WebCrypto), 401 sinon.
- **Permissions revérifiées côté serveur à chaque requête** : le panel recontrôle `MANAGE_GUILD`/`ADMINISTRATOR` via l'API Discord (cache 60 s) ou un grant explicite (`panel_access`, rôle vérifié via REST). Les handlers de commandes lisent les bits de permission du payload d'interaction signé — jamais du client.
- **Liste blanche stricte** pour les commandes avancées : schéma zod versionné (`packages/shared/src/command-logic.ts`), validé à l'écriture **et** relu à l'exécution. Aucune exécution de code arbitraire, pas d'`eval`, variables par substitution de chaîne pure.
- **Webhooks sortants** : https uniquement, IP littérales/localhost/domaines internes refusés, timeout 5 s, réponse jamais réinterprétée. Risque résiduel : DNS rebinding (non totalement évitable depuis un Worker) — option future : allowlist de domaines par serveur.
- **Rate limiting** KV sur les endpoints sensibles (création/édition de commandes, config, révocation de warns). Best-effort : KV est cohérent à ~60 s près entre points de présence — suffisant contre les rafales, pas une garantie stricte (compromis assumé, pas de Durable Objects).

## Limites connues / compromis

- **Cooldowns et rate limits best-effort** (cohérence éventuelle de KV, voir ci-dessus).
- **Cache de permissions 60 s** : un rôle retiré conserve l'accès panel jusqu'à 60 s.
- **`bot_installed`** peut devenir obsolète si le bot est expulsé (pas d'événement sans gateway) ; corrigé automatiquement au premier appel REST en échec (403/404).
- **Limite Discord : 100 commandes/serveur** ; le panel plafonne à 80. Les créations sont limitées à ~200/jour/serveur par Discord.
- **Croissance des tables** `mod_actions`/`gateway_events` : prévoir une purge périodique (> 90 j) via un cron trigger si le volume devient significatif.
- **Warns hors-ligne** : le seuil n'est évalué qu'au moment du `/warn` (pas de rétro-application).

## Roadmap Option B — service Gateway

Un petit service Node.js (discord.js v14, ~256 Mo de RAM, Fly.io ou VPS) pourra se brancher sans refonte :

- lit la config par serveur via `GET /internal/guilds/:id/config` et les commandes mot-clé via `GET /internal/guilds/:id/commands?trigger=keyword` (header `Authorization: Bearer INTERNAL_API_TOKEN`) ;
- écrit les événements temps réel via `POST /internal/guilds/:id/events` et les actions d'automod via `POST /internal/guilds/:id/mod-actions` ;
- active : déclencheurs mot-clé, rôles auto à l'arrivée, logs join/leave, auto-modération temps réel. Le panel affichera alors « Gateway connectée ».

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` / `pnpm dev:panel` | Worker local (8787) / panel Vite (5173) |
| `pnpm build` | Build du panel (requis avant `wrangler dev`/`deploy`) |
| `pnpm test` | Tests vitest (workerd réel, D1/KV locaux, REST Discord mocké) |
| `pnpm check` | `tsc --noEmit` sur les 3 packages |
| `pnpm register:dev` / `register:global` | Enregistre les slash commands built-in |
| `pnpm migrate:local` / `migrate:remote` | Applique les migrations D1 |
| `pnpm deploy` | Build panel + `wrangler deploy` |
