# 01 — Audit de l'état actuel

> Voir aussi : [architecture cible](./02-product-architecture.md) · [modèle de données](./08-data-model.md) · [sécurité](./09-security-model.md)

Audit fondé sur une lecture directe du dépôt `C:\VS_project\botdiscord` (branche `master`). Objectif : établir ce qui est **réutilisable**, ce qui doit être **extrait / renommé / migré**, et les **risques de régression**. Tous les chemins sont réels.

## 1. Monorepo & packages

pnpm workspace (`pnpm-workspace.yaml` = `packages/*`), packages `@bot/*`, `pnpm@10.13.1`, `"type": "module"`. `tsconfig.base.json` strict (ES2022/ESNext, `moduleResolution: bundler`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noEmit`).

| Package | Nom | Rôle | Runtime |
|---------|-----|------|---------|
| `packages/worker` | `@bot/worker` | Hono sur Cloudflare Workers : `/interactions`, `/auth`, `/api` (panel), `/internal/*`. **Seul écrivain D1.** Sert aussi le SPA panel. | Cloudflare Workers |
| `packages/gateway` | `@bot/gateway` | discord.js v14 : événements temps réel, vocal, musique (DisTube). Lit/écrit **uniquement** via `/internal/*`. | Node 22 (VPS OVH) |
| `packages/panel` | `@bot/panel` | SPA React 19 + Vite + Tailwind 4 + TanStack Query 5, design system « Nocturne ». | Navigateur (servi par worker) |
| `packages/shared` | `@bot/shared` | zod (frontière de sécurité), DTO `api-types`, XP, variables, modules, sécurité. TS brut. | Bundlé par chaque consommateur |

**Constat clé** : ajouter `packages/developer-studio` et `packages/ui` est mécaniquement quasi sans friction (glob `packages/*`, `workspace:*`, tsconfig hérité). Le point d'effort est l'**extraction** de `@bot/ui` depuis le panel, pas la création de packages.

## 2. Frontière Worker / Gateway (choix acté — à préserver)

- Le **Worker est le seul écrivain D1** ; tout le SQL vit dans `packages/worker/src/db/queries/`.
- Le **Gateway ne touche jamais D1** : il lit/écrit via `/internal/*` (`packages/gateway/src/worker-api.ts`), avec signature HMAC.
- Tout est scopé par `guildId`, jamais global.

➡️ Le SaaS **ne remet pas en cause** cette frontière : la couche abonnements/entitlements s'ajoute côté Worker (source de vérité D1) et le Gateway lira son gating via la config par-guilde existante.

## 3. Authentification & sessions

Fichiers : `packages/worker/src/auth/oauth.ts`, `src/auth/session.ts`, `src/auth/guard.ts`.

- **OAuth Discord** (`oauth.ts`) : flow authorization-code, scopes `identify guilds`. `/auth/login` pose un cookie CSRF `oauth_state` + KV `oauthstate:<state>` (TTL 300 s). `/auth/callback` échange le code, récupère `/users/@me`, crée la session. `/auth/logout`, `/auth/revoke-all`.
- **Sessions en KV, pas en cookie** (`session.ts`) : le cookie `session` ne contient qu'un id opaque (64 hex). Clé KV `sess:<id>` → `SessionData` (userId, username, avatar, accessToken, tokenExpiresAt, absoluteExpiresAt, userGeneration, globalVersion). **Le refresh token Discord est volontairement jeté.**
- **Cookie** : `httpOnly`, `secure` (si HTTPS), `sameSite=Lax`, `path=/`, `maxAge=86400`.
- **TTL** : absolu 24 h (borné par l'expiration du token Discord), idle 2 h, refresh toutes les 15 min.
- **Révocation** : kill-switch global via var `SESSION_GLOBAL_VERSION` ; par-user via KV `security:session-generation:<userId>`.

➡️ **Réutilisable tel quel** pour la plateforme client. Pour le Studio, on **réplique le modèle avec un cookie et un secret distincts** (voir [doc 09](./09-security-model.md)) — pas de partage de session client↔studio.

## 4. Autorisation (par-guilde, admin vs modérateur)

Fichier : `packages/worker/src/auth/guard.ts`.

- `requireGuildAccess` **re-vérifie les vraies permissions Discord à chaque requête** (ne fait jamais confiance au client). Type `GuildAccess = "manage_guild" | "panel_admin" | "panel_moderator"`.
  1. `users/@me/guilds` (cache KV 60 s) → owner ou `MANAGE_GUILD`/`ADMINISTRATOR` → `manage_guild`.
  2. Sinon grants explicites `panel_access` (par user ou par rôle) → admin/modérateur.
  3. Sinon 403 ; guilde sans bot → 404.
- **Admin vs modérateur (« M15 »)** : les grants modérateur sont **lecture seule** — `enforcePanelMutationPolicy` rejette tout verbe d'écriture. `requireManageGuild` réserve la gestion des accès au niveau `manage_guild`.
- Helpers de bits : `packages/shared/src/permissions.ts` (`canManageGuild`, `hasPermission`).

➡️ **Il n'existe AUCUN concept développeur / superadmin / allowlist d'IDs Discord.** L'autorisation est 100 % par-guilde. Le Studio nécessite une **couche d'autorisation développeur entièrement nouvelle** (voir [doc 09](./09-security-model.md)).

## 5. API panel (`/api`) & API interne (`/internal/*`)

- **`/api`** : sous-app Hono montée dans `packages/worker/src/index.ts`. Tout chemin `/api/guilds/:guildId/...` est **centralement** protégé : `requireSession` → `requireGuildAccess` → `enforcePanelMutationPolicy` → `adminAudit` → `durablePanelQuota`. `guildId` validé `^\d{5,20}$`. ~22 routeurs ressources (commands, moderation, tickets, welcome, automod, xp, starboard, temp-voice, music, members, stats, health, audit, modules, onboarding, config-backup, privacy, automations, guilds…).
  ➡️ **Insertion propre** : toute nouvelle route `/api/guilds/:guildId/*` hérite automatiquement de l'auth, du scoping et de l'audit. Les routes **utilisateur** (non guilde) — abonnement, facturation, compte — devront s'ajouter à un niveau `/api/*` sous `requireSession` seul.
- **`/internal/*`** : `src/internal/routes.ts` + `src/security/internal-auth.ts`. Auth HMAC signée (mode prod `signed`), fenêtre 120 s, **anti-rejeu par nonce D1** (`internal_request_nonces`), allowlist stricte de routes. Fallback bearer `INTERNAL_API_TOKEN` en mode legacy/dual.

## 6. Base de données D1

- Binding `DB` (database `botdiscord`). Migrations `packages/worker/migrations/`, **dernière = `0031_automation_studio.sql`** → **prochaine = `0032`**. Queries `src/db/queries/` (26 fichiers).
- ~60 tables : `guilds`, `warnings`, `mod_actions`, `custom_commands`, `panel_access`, `auto_roles`, `tickets`(+events), `button_role_messages`, `welcome_settings`, `log_settings`, `automod_settings`, `xp_settings`/`xp_members`, `playlists`, `voice_logs`, `member_snapshots`, `starboard_*`, `temp_voice_*`, `operation_metrics`, `internal_request_nonces`, `security_quota_usage`, `admin_audit_log`(+`_v2`), `guild_modules`, `processed_events`, `guild_privacy`, `product_metrics*`, `config_snapshots`, `sanction_*`, `owner_target_*`, `automation_*`.
- **Aucune table premium / subscription / entitlement / billing / plan / tier.** La monétisation est **greenfield**.

## 7. Gating de modules existant (le *seam* le plus important)

Fichiers : table `guild_modules`, `packages/shared/src/modules.ts`, `packages/worker/src/api/modules.ts`, `packages/gateway/src/module-config.ts` + `module-runtime.ts`.

- Le type `CapabilityEntitlement` modélise déjà des grants de capacité (`read/configure/execute/toggle`) avec un champ **`source: "platform" | "guild_configuration" | "runtime"`** et des reason codes ; `evaluateModuleState` calcule l'état effectif d'un module par guilde.
- ⚠️ **Attention terminologique** : ce « entitlement » est un mécanisme **RBAC / gouvernance de modules**, **pas** un droit d'abonnement payant. Il ne faut **pas le surcharger**. L'entitlement d'**abonnement** est un concept distinct ([doc 06](./06-subscriptions-and-entitlements.md)).

➡️ **Réutilisable comme point d'accroche** : ajouter une nouvelle `source` (ex. `"subscription"`/`"plan"`) et des `reason` de gating par plan permet de brancher les limites d'offre sur un mécanisme éprouvé, sans réinventer l'évaluation d'état de module.

## 8. KV

Namespace unique `KV`. Familles de clés : `sess:<id>`, `security:session-generation:<userId>`, `oauthstate:<state>`, caches guildes/membres (`guilds:<userId>`, `member:v2:<g>:<u>`), `music:<guildId>` (snapshot lecture musique), `gateway:status` (heartbeat), compteurs de rate-limit.

➡️ Réutilisable pour caches et sessions studio (clés préfixées distinctement, ex. `studio:sess:<id>`).

## 9. Panel (frontend) & design system « Nocturne »

- **Routing** : `packages/panel/src/App.tsx` — gate **implicite** via query `["me"]` sur `/api/me` : 401 → `pages/Landing.tsx` (seule surface publique), sinon arbre authentifié. Pas de `<PrivateRoute>`. Login = simple lien `/auth/login`.
- **Shell** : `pages/GuildLayout.tsx`, sidebar data-driven `NAV_GROUPS` (Serveur / Engagement / Modération / Outils), favoris en `localStorage`, badge « Lecture seule » pour modérateur, `AccessContext` (`canWrite`).
- **UI kit** : `packages/panel/src/ui/` (barrel `kit.tsx` + familles `buttons`/`forms`/`surfaces`/`feedback`/`navigation`/`layout`/`segmented`), plus `toast`, `overlay` (Modal/Confirm), `savebar`, `skeleton`, `charts`, `combobox`, `entity-select`, `icons`, `brand`, `error-boundary`.
- **Tokens** : CSS custom properties dans `packages/panel/src/index.css` (`@theme`/`:root`, Tailwind v4 CSS-first, pas de `tailwind.config.js`). Primaire « Aurora Iris » `#6b4ef2`. Specs : `docs/design_system.md`, `docs/design_system_v2.md`, `packages/panel/src/ui/kit/DESIGN_TOKENS.md`, `docs/brand_archodev.md`.
- **Data-fetching** : `src/lib/queryClient.ts` (staleTime 30 s, jamais de retry sur 401/403/404, toasts auto via `meta`), `src/lib/api.ts` (wrapper `fetch` typé, `ApiError`, traduction FR des erreurs zod), `src/ui/savebar.tsx` (`useDirty` + garde `beforeunload` + blocker react-router).
- **Budget** : `scripts/check-bundle-budget.mjs` impose **180 KiB gzip** sur le JS initial (le build échoue au-delà). Recharts isolé en chunk lazy `Stats`.
- **Responsive** : déjà solide (drawer mobile avec focus-trap, `prefers-reduced-motion`, grilles responsives).

**Réutilisable / à extraire :**
- ✅ Réutilisable : `queryClient`, `api`, `savebar`, `toast`, `overlay`, primitives kit, gestion d'accès — base saine pour le panel client.
- 🔧 À extraire vers `@bot/ui` (progressivement) : tokens (sortir de `index.css` vers un package thème partagé) + primitives découplées du router / de l'accès / du domaine Discord + i18n.
- ❌ Absent : **aucune surface marketing/pricing/premium** (une seule page `Landing`). Tout le commercial est greenfield.

## 10. Gateway (modules & config)

- Entrée `packages/gateway/src/index.ts` ; heartbeat 120 s ; serveur HTTP interne (port 8788) ; watchdogs → `process.exit` (systemd relance).
- Modules `register*` : `events`, `voice`, `voice-xp`, `xp`, `automod`, `starboard`, `stats`, `temp-voice`, `guild-lifecycle`, `automations`, `music` (sous-système `src/music/` + DisTube v5 + `@discordjs/voice` 0.19.2 pinné).
- Config par-guilde : `GET /internal/guilds/:id/config` → type `GuildGatewayConfig` (`worker-api.ts`), cache 60 s (`config-cache.ts`). **Aucune notion de premium / feature gating** aujourd'hui.

➡️ Le gating par plan devra enrichir `GuildGatewayConfig` (ex. flags de capacités musique avancée), consommé par les modules gateway.

## 11. Déploiement & infra

- **Worker** : `packages/worker/wrangler.jsonc` — 1 Worker `botdiscord`, D1 `DB`, KV `KV`, ASSETS (`../panel/dist`), crons `* * * * *` + `23 4 * * *`. Vars : `PANEL_ORIGIN`, `INTERNAL_AUTH_MODE=signed`, etc. Secrets : `DISCORD_*`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`. **Domaine `*.archodev.workers.dev` uniquement — pas de domaine custom.**
- **Gateway** : déploiement par **git bundle + scp** vers VPS OVH `164.132.98.139`, `systemctl restart botdiscord-gateway` (recette dans `roadmap.md`).

➡️ Un **domaine custom est prérequis** pour le SaaS (client + studio). Le Studio implique un **second Worker** + routing par hostname (voir [doc 02](./02-product-architecture.md)).

## 12. Tests

- **41 fichiers** `packages/worker/test/*.test.ts` via `@cloudflare/vitest-pool-workers` (D1/KV réels miniflare). Setup `test/apply-migrations.ts`. ⚠️ **Rollback D1/KV entre chaque test** : seuls les seeds `beforeAll` persistent → chaque test auto-suffisant.
- Panel : suites vitest + build/typecheck. Shared : typecheck.

➡️ Socle de test solide côté worker → à étendre pour billing/entitlements/webhooks ([doc 12](./12-testing-and-release-strategy.md)).

## Synthèse : réutiliser / extraire / renommer / migrer

| Catégorie | Éléments |
|-----------|----------|
| **Réutiliser tel quel** | Auth/session (`session.ts`, `guard.ts`), OAuth, API panel auditée `/api/guilds/:guildId/*`, `/internal/*` signé, D1 single-writer, gating de modules, `queryClient`/`api`/`savebar`, responsive, socle de tests worker |
| **Extraire (progressif)** | `@bot/ui` depuis `packages/panel/src/ui/` (tokens + primitives découplées) |
| **Renommer (différé/optionnel)** | `packages/panel` → `client-web` (voir conséquences en [doc 02](./02-product-architecture.md)) ; **non requis** pour démarrer |
| **Migrer / ajouter** | Nouveau `packages/developer-studio` + Worker studio ; tables billing/entitlements (migration `0032+`) ; DTO `@bot/shared/api-types/{billing,subscription,entitlement}` ; couche dev-auth ; domaines custom |

## Dette technique & risques de régression identifiés

- **i18n absent** : toute la copie est en français inline → dette à assumer si internationalisation future.
- **Tokens couplés à l'app** : les classes Tailwind (zinc/indigo) sont remappées via `index.css` ; extraire `@bot/ui` exige de déplacer les tokens sans casser le panel.
- **Gate d'auth implicite** (query `["me"]`) : l'ajout de vraies routes publiques (pricing, docs) impose un vrai *layer* de routes publiques distinct de l'app connectée.
- **Budget bundle 180 KiB** : l'ajout de pages marketing riches peut le menacer → discipline de code-splitting.
- **Confusion « entitlement »** : le RBAC de modules et l'entitlement d'abonnement partagent un mot — risque de couplage accidentel ; les garder **distincts**.
- **Aucun superadmin** : tout ce qui touche au Studio est nouveau → surface de sécurité nouvelle à traiter avec rigueur ([doc 09](./09-security-model.md)).
