# 02 — Architecture produit & cible technique

> Voir aussi : [audit](./01-current-state-audit.md) · [sécurité](./09-security-model.md) · [roadmap](./11-migration-roadmap.md)

## Principe directeur

Deux **produits distincts** partageant un **socle commun** :

- **Plateforme client** (`archodev.fr`) — public + panel connecté, une seule marque, une seule expérience.
- **Studio développeur** (`studio.archodev.fr`) — console privée d'exploitation, **isolée** (domaine, cookie, secrets, autorisation serveur).

Le socle commun reste : **Worker seul écrivain D1**, **Gateway** temps réel, **`@bot/shared`** comme frontière de types/sécurité. La couche SaaS s'ajoute **sans réécriture** (décision cadrée : migration incrémentale).

## Packages cibles

```
packages/
├── panel/            # (existant) application CLIENT — reste en place ; renommage → client-web différé
├── developer-studio/ # (NEUF) SPA du Studio, servie par le Worker studio
├── ui/               # (NEUF, extraction progressive) @bot/ui — tokens + primitives partagées
├── worker/           # (existant) Worker CLIENT : /interactions, /auth, /api, /internal, sert le panel
├── worker-studio/    # (NEUF) Worker STUDIO : /studio-api, dev-auth, sert developer-studio  [voir note]
├── gateway/          # (existant) discord.js — inchangé sur la frontière
└── shared/           # (existant) @bot/shared — DTO/zod, + nouveaux api-types billing/subscription/entitlement
```

> **Note packaging du Worker studio** : deux options d'organisation, sans impact sur la décision « Worker séparé » déjà actée (le Studio EST un Worker Cloudflare distinct, déployé sur son propre domaine) :
> - **(a)** un package dédié `packages/worker-studio` (frontière de code nette) — **[recommandé]** ;
> - **(b)** un second `wrangler` **entry** dans `packages/worker` (partage direct des queries `src/db/queries/`, moins de duplication mais frontière de code plus floue).
> Le choix (a)/(b) est un détail d'implémentation à trancher en P5 ; il figure en [doc 13](./13-open-decisions.md). Dans les deux cas, **binaire, domaine, cookie et secrets sont séparés**.

### Nommage & renommage `panel` → `client-web`

- **Décision cadrée : différé et optionnel.** `packages/panel` (`@bot/panel`) reste tel quel pour démarrer.
- **Conséquences d'un renommage** (à planifier plus tard, [doc 11](./11-migration-roadmap.md) / [doc 13](./13-open-decisions.md)) : mise à jour de `pnpm-workspace` (implicite), des scripts racine (`dev:panel`, `build`), du champ `wrangler.jsonc` `assets.directory` (`../panel/dist` → `../client-web/dist`), des imports `@bot/panel` (rares), et de la doc. C'est un renommage mécanique **à faire en une fois, hors de tout autre changement**, pour un diff lisible.

## Rôle du package `@bot/ui`

`@bot/ui` contient **uniquement les fondations réellement partagées** entre `panel/client-web` et `developer-studio` :

- **design tokens** (couleurs, radii, typographie, élévation, motion) — extraits de `packages/panel/src/index.css` vers un fichier thème partagé ;
- primitives : **boutons, formulaires, modales, tableaux, badges, notifications (toasts), primitives accessibles, icônes, layouts communs** ;
- helpers UI non couplés au domaine.

**Ne vont PAS dans `@bot/ui`** (restent applicatifs) : `entity-select`/`members` (spécifiques Discord), `savebar` couplé à `react-router`/accès (à découpler d'abord), microcopie FR. L'extraction est **progressive** (voir [doc 11](./11-migration-roadmap.md), P0) : d'abord les tokens + primitives sans dépendance, ensuite les composants découplés.

**Thématisation** : `@bot/ui` expose les tokens sous forme de variables CSS ; la **plateforme client** applique le thème « Nocturne » clair/premium, le **Studio** applique un thème sombre dense (même système, deux calibrages) — voir [doc 10](./10-ux-ui-direction.md).

## Domaines & routage

| Domaine | Worker | Contenu | Cookie | Auth |
|---------|--------|---------|--------|------|
| `archodev.fr` | Worker client (existant) | Public (vitrine, pricing, updates, docs, status, support) + panel connecté + abonnement/facturation | `session` | OAuth Discord + accès par-guilde |
| `studio.archodev.fr` | **Worker studio (neuf)** | Console d'exploitation privée | `studio_session` (distinct) | OAuth Discord **+ autorisation développeur serveur** |
| `botdiscord.archodev.workers.dev` | Worker client | Origine technique actuelle (fallback / interactions) | — | — |

**[Hypothèse]** domaines `archodev.fr` / `studio.archodev.fr` (à confirmer, [doc 13](./13-open-decisions.md)). L'endpoint Discord Interactions et le callback OAuth devront pointer vers le domaine custom une fois la bascule faite.

### Schéma de flux

```
Navigateur client ──HTTPS──> archodev.fr
                                  │  (Worker client)
                                  ├── / , /features, /pricing, /updates, /docs, /status, /support   (public)
                                  ├── /auth/*            OAuth Discord → cookie `session`
                                  ├── /api/*             panel connecté (requireSession + accès guilde)
                                  ├── /interactions      Discord (Ed25519)
                                  └── /internal/*        Gateway → Worker (HMAC signé)   ◄─── Gateway (VPS)

Navigateur DEV ──HTTPS──> studio.archodev.fr
                                  │  (Worker STUDIO, binaire séparé)
                                  ├── /              SPA developer-studio
                                  ├── /studio/auth/* OAuth Discord → cookie `studio_session`
                                  └── /studio-api/*  requireDeveloper (allowlist + permissions granulaires)

Worker client ─┐
Worker studio ─┴──> D1 `DB` (partagé)   +   KV `KV` (clés préfixées: sess: / studio:sess:)
```

- **Écriture D1** : le Worker studio écrit aussi en D1 (mutations sensibles : grants, révocations, flags), mais uniquement via des queries dédiées `src/db/queries/*` réutilisées, et **toujours audité** ([doc 09](./09-security-model.md)). Le principe « Worker seul écrivain D1 » devient « **les Workers** (client + studio) sont les seuls écrivains D1 » ; le Gateway reste exclu.
- **Isolation** : le Worker studio n'expose **aucun** endpoint sur `archodev.fr` ; le Worker client n'expose **aucune** route studio. Pas de partage de cookie.

## Worker / Gateway / shared

- **Worker client** : inchangé sur l'existant ; ajoute (P1+) des routes `/api/subscription`, `/api/billing`, `/api/account` (niveau user, `requireSession`), un webhook billing `/webhooks/<provider>` (non authentifié par session mais **vérifié par signature**), et enrichit `GuildGatewayConfig` avec le gating par plan.
- **Worker studio** : nouveau ; `/studio-api/*` sous `requireDeveloper` ; réutilise `src/db/queries/*` et `@bot/shared`.
- **Gateway** : **inchangé sur la frontière** ; consomme le gating par plan via la config par-guilde existante (`GET /internal/guilds/:id/config`). Aucune logique de facturation côté Gateway.
- **shared** : nouveaux DTO `api-types/billing.ts`, `subscription.ts`, `entitlement.ts` + schémas zod ; **ne pas surcharger** `CapabilityEntitlement` (RBAC de modules) — concept distinct ([doc 06](./06-subscriptions-and-entitlements.md)).

## Stratégie de migration (incrémentale — pas de réécriture)

Principes :

1. **Backend d'abord, UI ensuite** : le modèle d'entitlements et sa résolution sont livrés et testés **avant** toute UI de paiement.
2. **Feature flags** : chaque brique SaaS est activable par flag (voir [doc 09](./09-security-model.md) — `features.manage` côté Studio) pour un déploiement progressif et un rollback simple.
3. **Rétrocompatibilité** : par défaut, toute guilde/utilisateur sans abonnement = **plan Gratuit** (aucune régression pour l'existant).
4. **Extraction `@bot/ui` non bloquante** : le panel continue de fonctionner pendant l'extraction ; on migre composant par composant.
5. **Domaine custom sans coupure** : `*.workers.dev` reste valide pendant la bascule DNS.

Séquencement détaillé en [doc 11](./11-migration-roadmap.md). Ordre de dépendances : `@bot/ui` (amorce) → data model/entitlements → gating offres → client-web public → paiement → studio → support/audit.

## Décision produit / UX / sécurité / technique (séparation explicite)

- **Produit** : deux espaces, trois offres, une marque unique côté client.
- **UX** : même design system, deux calibrages (client premium / studio dense) via `@bot/ui`.
- **Sécurité** : Worker studio séparé, cookie/secret distincts, dev-auth serveur, audit immuable ([doc 09](./09-security-model.md)).
- **Technique** : migration incrémentale, backend-first, feature flags, rétrocompat plan Gratuit par défaut.
