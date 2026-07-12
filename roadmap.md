# Roadmap — reprise de session

_Dernière mise à jour : 2026-07-12. Bot Discord « Archodev#1241 » (monorepo Worker + Gateway VPS + Panel React)._

## ✅ Fait dans la session du 2026-07-12 (tout déployé)

- **M20 — Cartes membre sur mentions** (opt-in) — commit `4dc2185`, migration `0016`.
- **M21 — Refonte densité panel** — conteneur `max-w-[1600px]`, masonry 2 colonnes sur les formulaires, Aperçu 3 colonnes (modération + mini-stats + salons actifs), tables de logs bornées. Commits `470b7a7`, `9d14ab6`, `e96c455`.
- **M22 — XP vocal** (opt-in) — commit `0f6757d`, migration `0017`.
- **M23 — Starboard** (opt-in) — commit `18a008d`, migration `0018`.

**État prod** : worker+panel `e794b93b`, gateway bundle `18a008d`, migrations appliquées jusqu'à `0018` (remote). Dernière migration locale = `0018_starboard.sql`.

### Actions manuelles utilisateur en attente (pour profiter des features livrées)
- **XP vocal** : Panel → Niveaux → activer + régler l'XP/min.
- **Starboard** : Panel → Starboard → activer, choisir salon + seuil + emoji ; vérifier que le bot a `Envoyer des messages` + `Intégrer des liens` dans le salon starboard.
- (Rappel M19) Presence intent déjà activé le 2026-07-11.

## 🚧 Session en cours — commité sur `master`, PAS encore déployé

- **M24 — Commandes sociales** `/kiss /hug /pat /slap /poke /cuddle` — commit `530cc6b`. Module data-driven `builtins/social-data.ts` (GIFs locaux, sans API externe). Worker uniquement, pas de migration.
- **M25 — Cycle de vie des guildes** — `guildCreate`/`guildDelete` côté gateway (`guild-lifecycle.ts`) + endpoints internes `POST /internal/guilds/:id/installed|uninstalled`. Upsert immédiat de la guilde (fin du piège « panel vide avant le premier /ping ») + message de bienvenue. Pas de migration.
- **M26 — Salons vocaux temporaires** (« join to create ») — en cours ; migration `0019`, `/tempvoice` + `/voice`, module gateway `temp-voice.ts`, page panel.

**À faire au déploiement** : `pnpm run migrate:remote` (M26/0019), `pnpm --filter @bot/worker run deploy`, redéployer le gateway (git bundle + scp), puis `pnpm register:global` (ou `register:dev` pour le serveur de test). Intents inchangés (aucune action portail).

---

## 🎯 Reste à faire — top priorités (idées inspirées d'autres bots)

### 1. Brique « tâches planifiées » ⭐ (débloque 4 features)
Table `scheduled_tasks(id, guild_id, type, run_at, payload JSON, created_at)` + exécuteur.
- **Exécuteur** : cron Cloudflare **toutes les minutes** (`wrangler.jsonc` triggers, déjà un cron quotidien en place) OU boucle gateway. Le cron worker traite les tâches `run_at <= now` par type.
- **Premières applis** : `tempban`/`tempmute` (unban/unmute auto), puis `/remindme`, **giveaways** (tirage auto), **annonces programmées**.
- Attention : le cron worker minute = plus d'invocations ; vérifier le quota du plan.

### 2. Suivi d'invitations ⚡ (⚡ = plomberie déjà là)
« Invité par X », classement des inviteurs.
- **Gateway** : cache des invites par guilde (`guild.invites.fetch()` au ready + sur `InviteCreate`/`InviteDelete`) ; au `GuildMemberAdd`, diff des `uses` pour trouver l'inviteur (intent `GuildInvites`, non privilégié).
- **Worker** : table `invites(guild_id, joiner_id, inviter_id, code, created_at)` + agrégations.
- **Panel** : classement inviteurs + colonne « invité par » ; peut nourrir la page Stats.

### 3. Différenciateurs IA (on est sur l'infra Claude)
- **Auto-mod IA** contextuelle (toxicité/arnaque) — appel API Claude depuis le Worker.
- **`/summarize`** — résume les N derniers messages d'un salon.
- **Triage IA des tickets** — suggestion de réponse au staff.
- Modèle recommandé : `claude-sonnet-5` (ou `claude-haiku-4-5` pour le coût). Cadrer coût + rate-limit. Lire la skill `claude-api` avant.

---

## 📋 Autres idées (backlog, par catégorie)

- **Engagement** : salons vocaux temporaires (« join to create », ⚡ voice events déjà écoutés) · rôles par **menu déroulant** (extension des button-roles) · anniversaires · classement XP public hebdo/mensuel · réputation/+rep.
- **Modération/sécurité** : vérification (bouton verify) + anti-raid (pic de joins → quarantaine/lockdown) · notes de modération privées · **expiration des warns** (decay) · purge filtrée (`/clear` par user/contains).
- **Utilitaire** : suggestions (upvote/downvote) · sondages timés · sticky messages · tags/FAQ.
- **Musique** (déjà présent) : DJ role · filtres/effets · lyrics · autoplay.
- **Économie** (gros morceau) : monnaie, daily, shop, jeux.

---

## 🛠️ Cheat-sheet — construire une feature (pattern éprouvé cette session)

Ordre : **migration → shared DTO → worker (queries → api → internal route → config) → gateway (worker-api → module → register index.ts) → panel (page → route App.tsx → sidebar GuildLayout.tsx) → tests worker → déploiement**.

Conventions clés :
- Détection côté **gateway** (discord.js), logique métier + REST + D1 côté **worker** (`/internal/...`, bearer `INTERNAL_API_TOKEN`).
- Config gateway exposée via `GET /internal/guilds/:id/config` (ajouter le bloc) + type `GuildGatewayConfig` (`packages/gateway/src/worker-api.ts`).
- Envois REST worker qui mentionnent des users : passer par `withMemberCards` (M20).
- Toggles écriture = admin only (le middleware M15 bloque déjà les modérateurs).
- Chaque feature = 1 commit `Mxx: ...` sur `master`, tests `pnpm --filter @bot/worker test`.

### Commandes (Windows — préfixer le PATH)
```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
pnpm -r check                              # typecheck tous les packages
pnpm --filter @bot/worker test             # tests worker (vitest-pool-workers)
pnpm run migrate:remote                    # applique les migrations en remote (auto-confirme)
pnpm --filter @bot/panel build             # build le panel
pnpm --filter @bot/worker run deploy       # deploy worker+panel (TOUJOURS `run`, cf. pnpm 10)
```
### Déploiement gateway (VPS, via git bundle — pas de GitHub)
```bash
git bundle create ~/botdiscord.bundle master
scp ~/botdiscord.bundle ubuntu@164.132.98.139:~/botdiscord.bundle
ssh ubuntu@164.132.98.139 "bash -lc 'cd ~/botdiscord && git pull ~/botdiscord.bundle master && pnpm install --filter @bot/gateway --filter @bot/shared && pnpm --filter @bot/gateway build && sudo systemctl restart botdiscord-gateway'"
```
Vérif : `systemctl is-active botdiscord-gateway` + `journalctl -u botdiscord-gateway -n 5` doit montrer `gateway ready as Archodev#1241`.

_Voir aussi la mémoire projet (`botdiscord-*`) et `milestone.md` / `context.md` pour l'historique détaillé._
