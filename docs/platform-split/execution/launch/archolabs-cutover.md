# Cutover domaines — archolabs.com / studio.archolabs.com

> Préparé pour le go-live. **Aucune action de production n'a été exécutée.** Ce document accompagne le commit de configuration `chore/archolabs-go-live-config`. Les domaines `archolabs.com` et `studio.archolabs.com` sont déjà routés vers le Worker `botdiscord`.

## 0. Ce qui est fait dans ce commit (config uniquement, non déployé)

- `packages/worker/wrangler.jsonc` :
  - `PANEL_ORIGIN = https://archolabs.com` (était `botdiscord.archodev.workers.dev`).
  - `PANEL_ALLOWED_ORIGINS = https://archolabs.com,https://botdiscord.archodev.workers.dev` (transition : l'ancien origin reste accepté pour ne pas casser les sessions/mutations en vol).
  - `STUDIO_HOST = studio.archolabs.com` (Studio **reste dark** tant que `platform.studio` est off).
  - `APP_VERSION = m16`.
  - **`run_worker_first`** complété : ajout de `/status`, `/webhooks/*`, `/studio-api/*`, `/studio/*`.
    **Correctif critique** : sans ces entrées, ces chemins tombaient dans le *SPA fallback* des assets et renvoyaient `index.html` au lieu d'atteindre le Worker → **webhooks Stripe (M10) et Studio (M12–M15) cassés en prod**.
  - **Flags plateforme et `LAUNCH_*` volontairement absents** ⇒ tout off en prod.

## 1. Actions PROPRIÉTAIRE requises hors dépôt (je ne les fais pas)

### 1.1 Discord Developer Portal (application `1524597895859536074`)
- **OAuth2 → Redirects** : ajouter `https://archolabs.com/auth/callback` **et** `https://studio.archolabs.com/studio/auth/callback` **et** `https://studio.archolabs.com/studio/auth/step-up/callback`. Garder l'ancien `…workers.dev/auth/callback` pendant la transition.
- **Interactions Endpoint URL** : basculer vers `https://archolabs.com/interactions` (la vérif Ed25519 est inchangée ; tester le « Save » Discord qui envoie un PING signé).

### 1.2 Secrets Cloudflare (via `wrangler secret bulk fichier.json` puis supprimer le fichier — jamais `secret put` sous PowerShell : CRLF → 401)
- Déjà en place (à vérifier) : `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`.
- **Nouveaux pour le socle** : `STUDIO_OWNER_IDS` (snowflake(s) propriétaire), **avant** d'activer `platform.studio`.
- **Au lancement commercial uniquement** : `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` **LIVE**.

### 1.3 Studio front-end (⚠️ écart M12 non résolu)
La SPA `@bot/developer-studio` **n'est pas servie** par le Worker `botdiscord` (seuls `/studio-api/*` et `/studio/auth/*` le sont, host-gated). En l'état, `studio.archolabs.com` servirait le **panel client**. Avant d'activer `platform.studio` :
- **Option A** : héberger la SPA studio séparément (Cloudflare Pages / Worker dédié) sur `studio.archolabs.com`, en proxyfiant `/studio-api/*` + `/studio/auth/*` vers le Worker `botdiscord`.
- **Option B** : câbler un second binding d'assets + routage par host dans le Worker (évolution code, hors ce commit).
Tant que ce n'est pas fait, garder `platform.studio` **off** (le Studio reste inaccessible, sans impact client).

### 1.4 Décisions produit/juridique (dossier §1) — bloquantes pour le lancement commercial
D1 (prix → `LAUNCH_*`), D3 (prestataire + clés live), D12/D18/D20 (remboursement/rétention/TVA), **D21 (brouillons juridiques à faire valider par un avocat)**. `platform.launch` **en dernier**.

## 2. Séquence de go-live (commandes documentées — NON exécutées ici)

> Prérequis : ce commit fusionné sur `master`, §1 traité, sauvegarde/rollback validés en preview.

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
# 1) Migrations additives (0032→0039) sur le D1 de prod
pnpm run migrate:remote
# 2) Secrets prod (fichier JSON temporaire hors dépôt, puis suppression)
wrangler secret bulk .\secrets.prod.json ; Remove-Item .\secrets.prod.json -Force
# 3) Déploiement worker + panel (build panel inclus)
pnpm --filter @bot/worker run deploy
```

Puis **activation progressive** (M15, sans redeploy) via le Studio (ou l'API) :
1. `PUT /studio-api/rollout/platform.entitlements` avec 1–3 guildes pilotes → smoke tests.
2. Idem `platform.support`, puis `platform.billing` (sandbox d'abord).
3. `platform.studio` **uniquement** après §1.3 (front-end studio hébergé) + `STUDIO_OWNER_IDS`.
4. Élargir chaque cohorte → global on après validation.
5. `platform.launch` **en dernier**, après prix (D1) + juridique (D21).

## 3. Smoke tests prod (à exécuter après le deploy — voir `12-testing-and-release-strategy.md` §9)

- `GET https://archolabs.com/status` ⇒ `worker up`, `d1 up`, `kv up`, `gateway` selon heartbeat.
- Login client sur `https://archolabs.com` (OAuth callback OK, cookie `session`).
- `GET /api/subscription`, `/api/updates`, `/api/pricing` (⇒ `pricing:null` tant que `LAUNCH_*` absent).
- Discord : commande `/ping` sur le serveur de test (remplit `guilds`), interaction signée OK.
- Webhook Stripe (test) → `paid` idempotent (au lancement billing).
- `https://studio.archolabs.com/studio-api/session` ⇒ 404 tant que `platform.studio` off ; **aucune** route studio sur `archolabs.com`.

## 4. Rollback

| Niveau | Moyen |
|--------|-------|
| Fonctionnel | Flag/cohorte off, `STUDIO_KILL_SWITCH=true`, `platform.launch` off |
| Config | `git revert` de ce commit + re-deploy (revenir à l'ancien `PANEL_ORIGIN`) |
| Déploiement | Re-deploy de la version précédente (Cloudflare garde l'historique) |
| Données | Migrations additives → désactiver l'usage par flag, jamais supprimer |
