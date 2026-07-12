# botdiscord — bot Discord « Archodev » + panel web

Monorepo pnpm, TypeScript strict partout, SQL brut (pas d'ORM).
Prod : `https://botdiscord.archodev.workers.dev` · App Discord `1524597895859536074` · serveur de test `1406188083380092989`.

## Architecture (choix actés, ne pas remettre en cause)

- `packages/worker` (`@bot/worker`) — Hono sur Cloudflare Workers : `/interactions` (HTTP Interactions, vérif Ed25519, **pas de discord.js**), `/auth`, `/api` (panel), `/internal/*` (bearer `INTERNAL_API_TOKEN`, réservé au gateway). **Seul écrivain D1** ; tout le SQL vit dans `src/db/queries/`.
- `packages/gateway` (`@bot/gateway`) — Node 22 + discord.js v14 sur VPS OVH (`ssh ubuntu@164.132.98.139`, systemd `botdiscord-gateway`). Événements temps réel, vocal, musique (DisTube). Ne touche jamais D1 : lit/écrit exclusivement via `/internal/*`.
- `packages/panel` (`@bot/panel`) — React 19 + Vite + Tailwind 4 + TanStack Query 5, SPA servie par le worker. Design system « Nocturne » (`docs/design_system*.md`), kit UI dans `src/ui/`.
- `packages/shared` (`@bot/shared`) — schémas zod (= frontière de sécurité), DTOs `api-types`, variables, XP. **TS brut** (`exports: ./src/index.ts`) : tout consommateur Node runtime doit le bundler (`noExternal: ["@bot/shared"]` dans tsup).
- Frontière : WebSocket / vocal / événements → gateway ; interactions HTTP, API panel, écriture D1 → worker. Tout est scopé par `guildId`, jamais global.

## Commandes (Windows : préfixer le PATH d'abord)

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
pnpm -r check                         # typecheck tous les packages
pnpm --filter @bot/worker test        # tests worker (vitest-pool-workers, D1/KV réels)
pnpm --filter @bot/panel build        # build panel
pnpm run migrate:remote               # migrations D1 remote (auto-confirme en non-interactif)
pnpm --filter @bot/worker run deploy  # deploy worker+panel — TOUJOURS `run` (pnpm 10 : deploy = commande native)
pnpm register:dev                     # (ré)enregistre les slash commands sur le serveur de test
```

Déploiement gateway : `git bundle` + scp vers le VPS (pas de GitHub) — recette exacte dans `roadmap.md` § Cheat-sheet.

## Conventions

- 1 feature = 1 commit `Mxx: ...` sur `master`. Ordre d'implémentation : migration → shared DTO → worker (queries → api → internal → config) → gateway (worker-api → module → register `index.ts`) → panel (page → route `App.tsx` → sidebar `GuildLayout.tsx`) → tests worker.
- Toggles d'écriture panel = admin only (le middleware M15 bloque les modérateurs).
- Envois REST worker qui mentionnent des users : passer par `withMemberCards`.
- Config gateway exposée via `GET /internal/guilds/:id/config` + type `GuildGatewayConfig` (`packages/gateway/src/worker-api.ts`).

## Pièges (chacun a déjà coûté un debug — ne pas « corriger »)

1. **Jamais** `Write-Output "x" | wrangler secret put NAME` sous PowerShell : le CRLF corrompt le secret (401 Ed25519 en prod). Toujours `wrangler secret bulk fichier.json`, puis supprimer le fichier.
2. vitest-pool-workers **rollback D1/KV entre chaque test** ; seuls les seeds de `beforeAll` persistent — chaque test doit être auto-suffisant.
3. Tailwind v4 : écrire `bg-(--var)` ; `bg-[--var]` est **silencieusement ignoré** (pas d'erreur de build).
4. Appliquer `pnpm run migrate:remote` à **chaque** déploiement de milestone (une migration oubliée a déjà cassé la prod).
5. Panel vide après install : la table `guilds` se remplit à la première interaction — lancer `/ping` sur le serveur.
6. Selects de salons texte : filtrer `ch.type !== 4` (l'endpoint channels renvoie aussi les catégories).
7. Intents privilégiés (GuildMembers, MessageContent, Presence) : activés dans le Dev Portal ; sinon « Used disallowed intents » au login gateway.
8. Modals discord-api-types : `"components" in row ? row.components : "component" in row ? [row.component] : []`.

## Où chercher / quoi ne pas lire

- État courant, backlog, recette de déploiement : `roadmap.md`. Historique détaillé (milestones, contexte, plans UX) : `docs/archive/`.
- Ne pas lire (aucune valeur, gros volumes) : `pnpm-lock.yaml`, `docs/*.png`, `capture/`, `packages/panel/public/fonts/`.
