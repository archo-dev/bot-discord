# Roadmap — reprise de session

_Dernière mise à jour : 2026-07-18. Bot Discord « Archodev#1241 » (monorepo Worker + Gateway VPS + Panel React)._

## ✅ Fait dans la session du 2026-07-12 (tout déployé)

- **M20 — Cartes membre sur mentions** (opt-in) — commit `4dc2185`, migration `0016`.
- **M21 — Refonte densité panel** — conteneur `max-w-[1600px]`, masonry 2 colonnes sur les formulaires, Aperçu 3 colonnes (modération + mini-stats + salons actifs), tables de logs bornées. Commits `470b7a7`, `9d14ab6`, `e96c455`.
- **M22 — XP vocal** (opt-in) — commit `0f6757d`, migration `0017`.
- **M23 — Starboard** (opt-in) — commit `18a008d`, migration `0018`.

**État prod (2026-07-18)** : worker+panel **`6e2dab0` (M39 — Design System 2.2.f)** déployé, version Cloudflare `b0eff607`. Migrations D1 remote **appliquées jusqu'à `0031`** (vérifié : `wrangler d1 migrations list --remote` → « No migrations to apply »). Gateway hors de cette livraison (2.2.f = panel uniquement) ; dernier bundle connu `18a008d`, à revérifier au prochain déploiement gateway.

### Actions manuelles utilisateur en attente (pour profiter des features livrées)
- **XP vocal** : Panel → Niveaux → activer + régler l'XP/min.
- **Starboard** : Panel → Starboard → activer, choisir salon + seuil + emoji ; vérifier que le bot a `Envoyer des messages` + `Intégrer des liens` dans le salon starboard.
- (Rappel M19) Presence intent déjà activé le 2026-07-11.

## ✅ Déployé depuis (M24 → M39, tout en prod)

Tout ce qui figurait en « session en cours » a été livré, migré et déployé. D1 remote à jour **jusqu'à `0031`** (« No migrations to apply »).

- **M24** commandes sociales (`/kiss /hug …`), **M25** cycle de vie des guildes (fin du piège « panel vide »), **M26** salons vocaux temporaires (migration `0019`).
- **M27** centre de sanctions panel + diagnostics de commandes.
- **M28–M35** Design System « Keystone / Nocturne » — identité, fondations, primitives polymorphes (`Card`/`Button`/`SegmentedControl`), adoption dans les pages, `Field`/titres/champs canoniques.
- **M36–M39** Design System **2.2.f — éditeurs denses** : variante compacte `size="sm"` (`Input`/`Select`), puis CommandEditor, `ActionRow`/`ConditionRow`, builder de boutons de Roles, `MessageEditor` de Welcome. **Déployé le 2026-07-18** (voir release notes ci-dessous).
- Migrations `0020`–`0031` (observabilité, sécurité publique, gouvernance de modules, livraison fiable, onboarding, snapshots de config, analytics/privacy, sanctions panel, owner-target, team tickets, automation studio) appliquées.

_(TODO obsolète archivé : l'ancien « à faire au déploiement — migrate 0019 / register » est caduc, tout est en prod.)_

### 📝 Release notes — Design System 2.2.f (M29 → M39, 2026-07-18)

Refonte visuelle sans changement fonctionnel (panel uniquement, aucune migration).
- **Nouveau** : variante compacte `size="sm"` (32 px) pour les champs `Input`/`Select` ; rendu `md` (défaut) inchangé.
- **Éditeurs denses migrés** vers le Design System : commandes personnalisées (formulaire + conditions/actions + `SegmentedControl` Simple/Avancé), builder de boutons de rôles, éditeur de messages de bienvenue/départ.
- **Fondations** : primitives polymorphes, tokens canoniques, nettoyage des styles ad hoc (`inputCls`/`selectCls` supprimés).
- Densité, hauteurs, validations et `aria-invalid` **préservés à l'identique** ; contrôles natifs (couleur, pills de variables) conservés.
- Livraison : `master` poussé, tag `backup/pre-2.2f-deploy-20260718`, worker+panel déployés (version `b0eff607`). Rollback : `wrangler rollback`.

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
