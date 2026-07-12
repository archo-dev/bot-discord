# Bot Discord d'administration + Panel web — 100% Cloudflare

Bot de modération Discord (slash commands via HTTP Interactions) et panel web de configuration, hébergés sur **Cloudflare Workers + D1 + KV**. Aucun serveur à maintenir.

## Architecture

Deux moitiés complémentaires, **toutes deux en production** :

| Worker Cloudflare (HTTP Interactions) | Service Gateway (Node + discord.js, VPS) |
|---|---|
| Slash commands : modération (`/ban` `/kick` `/mute` `/warn` `/warnings` `/clear` `/unban` `/history`), `/ping`, `/rank`, `/leaderboard`, musique, commandes sociales (`/kiss` `/hug` `/pat` `/slap` `/poke` `/cuddle`) | Auto-modération temps réel (spam/invites/liens/mots) |
| Commandes personnalisées (builder simple + avancé), déclencheurs mot-clé | Bienvenue/départ, auto-rôles à l'arrivée |
| Tickets (panneau, transcripts), rôles par bouton | Logs serveur + logs vocaux, starboard, cartes membre |
| Seuil de warns → timeout automatique, mod-logs | XP messages + XP vocal, stats (snapshots, activité) |
| Panel web complet (OAuth2 Discord) | Lecture audio (DisTube + yt-dlp) |

Le Worker répond aux interactions via le endpoint HTTP de Discord (signature Ed25519 vérifiée sur chaque requête) et est l'**unique écrivain D1**. Le gateway ne touche jamais la base : il lit/écrit via l'API interne `/internal/*` (bearer token).

```
packages/
├── shared/   # Schéma zod des commandes perso (liste blanche = frontière de sécurité), types API
├── worker/   # Cloudflare Worker : interactions Discord + API panel (Hono) + D1 + KV
├── panel/    # SPA React (Vite + Tailwind) servie par le même Worker
└── gateway/  # Service Node 22 + discord.js v14 (VPS) : événements temps réel, vocal, musique
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

Panel : ouvrez <http://localhost:5173>, connectez-vous avec Discord. Seuls apparaissent les serveurs où vous avez « Gérer le serveur » **et** où le bot est installé. Le bot s'enregistre en base dès qu'il rejoint un serveur (événement `guildCreate` du gateway, M25) ; sans gateway en local, l'enregistrement a lieu à la première interaction — lancez `/ping` une fois si la liste est vide.

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
| `INTERNAL_API_TOKEN` | secret | Bearer de l'API `/internal/*` (gateway → Worker) |
| `GATEWAY_ORIGIN` | secret (optionnel) | URL du tunnel vers le gateway (Worker → gateway, M14) |
| `GATEWAY_HTTP_TOKEN` | secret (optionnel) | Bearer des endpoints HTTP du gateway |
| `DEV_GUILD_ID` | `.dev.vars` uniquement | Serveur de test pour `pnpm register:dev` |

Variables du **gateway** (`packages/gateway/.env`, voir `.env.example`) : `DISCORD_TOKEN`, `WORKER_ORIGIN`, `INTERNAL_API_TOKEN`, `GATEWAY_HTTP_TOKEN`, `GATEWAY_PORT`.

## Sécurité

- **Signature Ed25519** vérifiée sur chaque interaction (WebCrypto), 401 sinon.
- **Permissions revérifiées côté serveur à chaque requête** : le panel recontrôle `MANAGE_GUILD`/`ADMINISTRATOR` via l'API Discord (cache 60 s) ou un grant explicite (`panel_access`, rôle vérifié via REST). Les handlers de commandes lisent les bits de permission du payload d'interaction signé — jamais du client.
- **Liste blanche stricte** pour les commandes avancées : schéma zod versionné (`packages/shared/src/command-logic.ts`), validé à l'écriture **et** relu à l'exécution. Aucune exécution de code arbitraire, pas d'`eval`, variables par substitution de chaîne pure.
- **Webhooks sortants** : https uniquement, IP littérales/localhost/domaines internes refusés, timeout 5 s, réponse jamais réinterprétée. Risque résiduel : DNS rebinding (non totalement évitable depuis un Worker) — option future : allowlist de domaines par serveur.
- **Rate limiting** KV sur les endpoints sensibles (création/édition de commandes, config, révocation de warns). Best-effort : KV est cohérent à ~60 s près entre points de présence — suffisant contre les rafales, pas une garantie stricte (compromis assumé, pas de Durable Objects).

## Limites connues / compromis

- **Cooldowns et rate limits best-effort** (cohérence éventuelle de KV, voir ci-dessus).
- **Cache de permissions 60 s** : un rôle retiré conserve l'accès panel jusqu'à 60 s.
- **`bot_installed`** est mis à jour en temps réel par le gateway (`guildCreate`/`guildDelete`, M25) ; en secours, il est corrigé au premier appel REST en échec (403/404). Les données d'un serveur quitté sont **conservées** (marquées `bot_installed=0`), jamais supprimées.
- **Limite Discord : 100 commandes/serveur** ; le panel plafonne à 80. Les créations sont limitées à ~200/jour/serveur par Discord.
- **Croissance des tables** : un cron quotidien (`src/cron.ts`) purge les stats et voice logs anciens ; `mod_actions`/`gateway_events` ne sont pas purgées (à prévoir si le volume devient significatif).
- **Warns hors-ligne** : le seuil n'est évalué qu'au moment du `/warn` (pas de rétro-application).

## Service Gateway (Option B) — `packages/gateway`

Petit service Node 22 + discord.js v14 (~256 Mo de RAM) qui apporte ce que les HTTP Interactions ne peuvent pas faire : événements temps réel (arrivées/départs, messages, vocal) et la musique. Il ne touche **jamais** D1 directement :

- lit la config par serveur via `GET /internal/guilds/:id/config` (cache mémoire 60 s — les modifs panel s'appliquent sans redémarrage) et les commandes mot-clé via `GET /internal/guilds/:id/commands?trigger=keyword` ;
- écrit via `POST /internal/guilds/:id/events` et `POST /internal/guilds/:id/mod-actions` (header `Authorization: Bearer INTERNAL_API_TOKEN`) ;
- envoie un **heartbeat** toutes les 60 s (`POST /internal/gateway/heartbeat` → KV `gateway:status`, TTL 3 min) : le panel affiche « Gateway connectée » tant qu'il est frais ;
- expose son propre mini serveur HTTP (Hono, bearer `GATEWAY_HTTP_TOKEN`, jamais de port public : tunnel Cloudflare) que le Worker appellera pour la musique et les contrôles panel.

En local : `cp packages/gateway/.env.example packages/gateway/.env`, remplir, puis `pnpm dev:gateway`.

## Guide VPS pas à pas (déploiement du gateway)

Guide complet pour débutant. Objectif : le gateway tourne 24/7 sur un petit VPS Linux, redémarre tout seul, et n'expose **aucun port** sur Internet.

### 1. Louer le VPS (~5 €/mois)

- Hébergeurs simples : **Hetzner** (CX22, ~4 €), OVH (VPS Starter), Scaleway, Contabo. La plus petite offre suffit (1 vCPU / 2 Go).
- OS : choisissez **Ubuntu 24.04 LTS**.
- À la commande, si l'hébergeur propose d'ajouter une **clé SSH**, faites-le tout de suite (générez-la à l'étape 2 d'abord).

### 2. Clé SSH (depuis votre PC Windows)

```powershell
ssh-keygen -t ed25519            # Entrée à chaque question (ou mettez une passphrase)
type $env:USERPROFILE\.ssh\id_ed25519.pub   # → collez cette ligne chez l'hébergeur
```

Première connexion (l'IP est dans l'email/console de l'hébergeur) :

```powershell
ssh root@IP_DU_VPS
```

### 3. Utilisateur non-root + pare-feu

Sur le VPS, en root :

```bash
adduser bot                       # choisissez un mot de passe, Entrée pour le reste
usermod -aG sudo bot
rsync --archive --chown=bot:bot ~/.ssh /home/bot   # votre clé SSH marche aussi pour "bot"

# Pare-feu : ne laisser entrer QUE SSH (le gateway sort vers Discord/Worker, rien n'entre)
ufw allow OpenSSH
ufw enable                        # répondre y

# Durcir SSH : interdire le login root et les mots de passe
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
exit
```

Reconnectez-vous désormais avec `ssh bot@IP_DU_VPS`.

### 4. Node 22, pnpm, git, ffmpeg

En tant que `bot` :

```bash
# nvm + Node 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22

npm install -g pnpm
sudo apt update && sudo apt install -y git ffmpeg   # ffmpeg servira pour la musique (M14)
```

### 5. Cloner et builder

```bash
cd ~
git clone https://github.com/VOTRE_COMPTE/botdiscord.git
cd botdiscord
pnpm install
pnpm --filter @bot/gateway build
```

### 6. Configuration `.env`

```bash
cp packages/gateway/.env.example packages/gateway/.env
nano packages/gateway/.env
```

- `DISCORD_TOKEN` : le même token bot que le Worker.
- `WORKER_ORIGIN` : `https://<votre-worker>.workers.dev`.
- `INTERNAL_API_TOKEN` : la même valeur que le secret du Worker.
- `GATEWAY_HTTP_TOKEN` : générez-en un : `openssl rand -hex 32`.

Côté Worker (sur votre PC), uploadez les deux nouveaux secrets — **jamais via un pipe PowerShell** (voir plus bas), utilisez `wrangler secret bulk` :

```powershell
# secrets.json : {"GATEWAY_ORIGIN":"https://gateway.<votre-tunnel>","GATEWAY_HTTP_TOKEN":"<le même hex>"}
cd packages/worker
npx wrangler secret bulk secrets.json
del secrets.json
```

(`GATEWAY_ORIGIN` sera l'URL du tunnel de l'étape 8 — vous pouvez uploader ces secrets après l'étape 8.)

Test manuel avant d'automatiser :

```bash
cd ~/botdiscord/packages/gateway
node --env-file=.env dist/index.js
# attendu : "gateway ready as VotreBot#1234 (N guilds)" puis "gateway http listening on :8788"
# Ctrl+C pour arrêter
```

Le badge du panel doit passer à « Gateway connectée » en ~1 min.

### 7. Service systemd (démarrage auto + redémarrage en cas de crash)

```bash
sudo tee /etc/systemd/system/botdiscord-gateway.service > /dev/null <<'EOF'
[Unit]
Description=botdiscord gateway (discord.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bot
WorkingDirectory=/home/bot/botdiscord/packages/gateway
EnvironmentFile=/home/bot/botdiscord/packages/gateway/.env
ExecStart=/home/bot/.nvm/versions/node/v22.*/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

⚠️ Remplacez `v22.*` par la vraie version : `ls ~/.nvm/versions/node/` (ex. `v22.17.0`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now botdiscord-gateway
systemctl status botdiscord-gateway        # doit être "active (running)"
journalctl -u botdiscord-gateway -f        # logs en direct (Ctrl+C pour quitter)
```

### 8. Tunnel Cloudflare (exposer le HTTP du gateway sans ouvrir de port)

Nécessaire pour M14 (le Worker appellera le gateway). Requiert un domaine géré par Cloudflare (sinon, reportez cette étape à M14).

```bash
# Installer cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb && rm cloudflared.deb

cloudflared tunnel login                    # ouvre une URL à valider dans le navigateur
cloudflared tunnel create botdiscord-gw
cloudflared tunnel route dns botdiscord-gw gateway.votre-domaine.tld

mkdir -p ~/.cloudflared
tee ~/.cloudflared/config.yml > /dev/null <<EOF
tunnel: botdiscord-gw
credentials-file: /home/bot/.cloudflared/$(ls ~/.cloudflared/*.json | xargs -n1 basename)
ingress:
  - hostname: gateway.votre-domaine.tld
    service: http://localhost:8788
  - service: http_status:404
EOF

sudo cloudflared service install            # installe le service systemd cloudflared
sudo systemctl enable --now cloudflared
```

Puis mettez `GATEWAY_ORIGIN=https://gateway.votre-domaine.tld` dans les secrets du Worker (étape 6).

### 9. Mises à jour

```bash
cd ~/botdiscord
git pull
pnpm install
pnpm --filter @bot/gateway build
sudo systemctl restart botdiscord-gateway
```

### Sécurité VPS — résumé

- Le token bot vit à **deux** endroits (secrets Worker + `.env` du VPS) : clés SSH obligatoires, pas de login root, pas de mot de passe SSH.
- `ufw` ne laisse entrer que SSH ; le port 8788 n'est **jamais** exposé (tunnel Cloudflare sortant uniquement).
- `chmod 600 packages/gateway/.env` pour limiter la lecture du fichier de secrets.

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` / `pnpm dev:panel` | Worker local (8787) / panel Vite (5173) |
| `pnpm dev:gateway` | Gateway local (lit `packages/gateway/.env`) |
| `pnpm build` | Build du panel (requis avant `wrangler dev`/`deploy`) |
| `pnpm test` | Tests vitest (workerd réel, D1/KV locaux, REST Discord mocké) |
| `pnpm check` | `tsc --noEmit` sur les 3 packages |
| `pnpm register:dev` / `register:global` | Enregistre les slash commands built-in |
| `pnpm migrate:local` / `migrate:remote` | Applique les migrations D1 |
| `pnpm run deploy` | Build panel + `wrangler deploy` (toujours `run` : pnpm 10 a une commande native `deploy`) |
