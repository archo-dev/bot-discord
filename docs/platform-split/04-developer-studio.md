# 04 — Studio développeur (`studio.archodev.fr`)

> Voir aussi : [sécurité](./09-security-model.md) · [abonnements](./06-subscriptions-and-entitlements.md) · [architecture](./02-product-architecture.md)

Console privée d'exploitation, réservée au propriétaire puis à l'équipe. **Jamais** une route masquée du panel client : Worker séparé, domaine distinct, cookie `studio_session`, autorisation développeur serveur, audit immuable de toute mutation ([doc 09](./09-security-model.md)).

Direction UX : **thème sombre professionnel, dense, orienté données et opérations** — tableaux et filtres avancés, recherche globale, raccourcis clavier, environnement production clairement identifiable, confirmations renforcées pour les actions dangereuses ([doc 10](./10-ux-ui-direction.md)).

## Navigation (sitemap Studio)

| Route | Rôle | Permission requise ([doc 09](./09-security-model.md)) |
|-------|------|-------------------------------------------------------|
| `/` | Vue d'ensemble : santé globale, incidents, chiffres clés | (dev authentifié) |
| `/infrastructure` | Worker, Gateway, D1, KV, crons, files | `deployments.read` |
| `/guilds` | Toutes les guildes : recherche, filtres, inspection | `guilds.inspect` |
| `/guilds/:id` | Détail d'une guilde (modules, activité, plan, incidents) | `guilds.inspect` |
| `/users` | Utilisateurs Discord connus, leurs droits/abonnements | `guilds.inspect` |
| `/users/:id` | Détail utilisateur : entitlements, grants, tickets | `subscriptions.read` |
| `/modules` | État/adoption des modules, feature flags | `features.manage` |
| `/subscriptions` | Vue unifiée des abonnements | `subscriptions.read` |
| `/subscriptions/paid` | Abonnements **payés** (consultation, workflows dédiés) | `subscriptions.read` (+ `cancel_paid`/`refund_paid` pour actions) |
| `/subscriptions/granted` | Accès **accordés manuellement** + formulaire d'octroi | `subscriptions.read` (+ `grant`/`grant_lifetime`/`revoke_granted`) |
| `/support` | Tickets tous serveurs, priorisés, assignation | `support.manage` |
| `/updates` | Notes de mise à jour : brouillon → publier | `updates.publish` |
| `/security` | Sessions, révocations, allowlist dev, événements sécurité | (permission sécurité dédiée) |
| `/errors` | Erreurs/exceptions agrégées, tendances | `deployments.read` |
| `/metrics` | Métriques produit & techniques, timelines | `deployments.read` |
| `/deployments` | Historique & déclenchement de déploiements | `deployments.read` / `deployments.manage` |
| `/audit` | Journal d'audit immuable, recherche/filtre | `audit.read` |
| `/settings` | Réglages studio, membres équipe & permissions | (admin studio) |

## Modules du Studio

### Vue d'ensemble (`/`)
KPIs : guildes actives, utilisateurs connectés, abonnements actifs (payés/accordés), tickets ouverts par priorité, incidents en cours, dernier déploiement. Timeline des événements récents. **Bandeau « PRODUCTION »** permanent et non masquable.

### Infrastructure (`/infrastructure`)
- **Worker** : version déployée (Cloudflare), erreurs récentes, latence.
- **Gateway** : statut heartbeat (`gateway:status` en KV), uptime, dernier bundle déployé, reconnections/zombie-watchdog.
- **D1** : dernière migration appliquée (`0031`+), tailles, volumétrie clés.
- **KV** : familles de clés, taux d'expiration.
- **Crons/files** : exécutions `* * * * *` / `23 4 * * *`, files reliable-delivery.
Source : réutilise `operation_metrics`, telemetry (`packages/worker/src/telemetry/`), health (`src/api/health.ts`), heartbeat.

### Guildes (`/guilds`)
Tableau dense filtrable (id, nom, membres, modules actifs, plan effectif, activité, drapeaux d'incident). Inspection **lecture seule** par défaut ; toute action sensible confirmée + auditée. **Aucune donnée personnelle exposée au-delà du nécessaire** (respect `docs/privacy-analytics.md`).

### Utilisateurs (`/users`)
Recherche par ID/nom Discord → entitlements actifs, historique de grants, abonnements payés, tickets. Point d'entrée pour octroyer/révoquer un accès (renvoie vers `/subscriptions/granted`).

### Modules & feature flags (`/modules`)
Adoption par module, activation/désactivation de **feature flags** (déploiement progressif, kill-switch). Édite le gating par plan (mapping features→offres) — impacte [doc 05](./05-plans-and-commercial-strategy.md) et le gating de modules existant.

### Abonnements (`/subscriptions`)
Voir [doc 06](./06-subscriptions-and-entitlements.md). Deux surfaces strictement distinctes :

- **Payés** (`/subscriptions/paid`) : **consultation** (plan, propriétaire, dates, fournisseur, références). Actions uniquement via **workflows dédiés** : « Annuler le renouvellement », « Rembourser » (procédure séparée), « Suspendre pour fraude/sécurité » (audit renforcé). **Jamais de bouton « Révoquer » simple.** Non supprimable par le mécanisme des accès offerts (règle **backend**).
- **Accordés** (`/subscriptions/granted`) : formulaire d'octroi (utilisateur, plan, durée [7j/30j/3m/6m/1an/perso/lifetime], date de début, fin ou lifetime, **raison obligatoire**, note interne, affectation directe à des serveurs ou attribution d'emplacements). **Révocable** depuis le Studio. **Lifetime** exige permission dédiée + confirmation renforcée + saisie explicite `LIFETIME` + audit complet.

### Support (`/support`)
File unifiée tous serveurs, triée par **priorité de plan** (Business > Premium > Gratuit). Chaque ticket porte automatiquement : plan actif, priorité, serveur concerné, date, ancienneté, état, assignation ([doc 06](./06-subscriptions-and-entitlements.md) §support). Gère le cas d'un utilisateur perdant son plan pendant qu'un ticket est ouvert (le ticket garde sa priorité d'ouverture, signalé). Réutilise le moteur tickets existant (`docs/team-tickets.md`, tables `tickets*`), avec vue **cross-guilde** réservée au Studio.

### Notes de mise à jour (`/updates`)
Cycle : **brouillon → prévisualiser → programmer → publier → modifier → archiver**. Champs : version, date, titre, résumé, nouveautés, améliorations, corrections, sécurité, médias, ciblage (tous / certaines offres). Publie vers `archodev.fr/updates` et alimente la home + le panel ([doc 03](./03-client-platform.md)).

### Sécurité (`/security`)
Sessions actives, révocation globale (`SESSION_GLOBAL_VERSION`) / par-user, gestion de l'**allowlist développeur** et des permissions granulaires, événements de sécurité (origines rejetées, quotas, tentatives). Voir [doc 09](./09-security-model.md).

### Erreurs (`/errors`) & Métriques (`/metrics`)
Agrégation des exceptions (Worker/Gateway), tendances, top erreurs. Métriques techniques (latence, quotas) et produit (`product_metrics*`). Timelines lisibles, filtres par période/guilde/module.

### Déploiements (`/deployments`)
Historique (versions Worker Cloudflare, bundles Gateway). `deployments.read` pour consulter ; `deployments.manage` pour déclencher (workflow contrôlé, jamais un simple bouton pour une action irréversible). **[Hypothèse]** : le déclenchement peut rester manuel/CLI au départ et n'être que **consultable** dans le Studio (voir [doc 13](./13-open-decisions.md)).

### Audit (`/audit`)
Journal **immuable** de toutes les mutations sensibles (grants, révocations, remboursements, flags, publications, changements de permissions). Recherche/filtre par acteur, cible, type, période. S'appuie sur le modèle `admin_audit_log`/`_v2` existant, étendu à un `audit_events` studio ([doc 08](./08-data-model.md)).

### Réglages (`/settings`)
Membres de l'équipe, attribution des permissions granulaires, préférences studio.

## Opérations & ergonomie

- **Recherche globale** (palette de commandes, `Ctrl/Cmd+K`) : sauter à une guilde, un utilisateur, un ticket, une note.
- **Raccourcis clavier** pour les actions fréquentes (naviguer, filtrer, confirmer).
- **Tableaux avancés** : tri, filtres multi-critères, pagination, export contrôlé.
- **Confirmations renforcées** : double confirmation + saisie explicite pour lifetime/suppression/remboursement ; réauthentification pour actions sensibles ([doc 09](./09-security-model.md)).
- **Environnement production identifiable** : bandeau permanent, couleur d'accent distincte du client.
- **Séparation lecture/mutation** : par défaut lecture ; les mutations nécessitent une permission explicite et sont auditées.

## Ce que le Studio ne fait jamais

- N'apparaît sur aucune route du domaine client.
- N'expose aucun outil interne dans un abonnement client (« toutes les fonctionnalités » Business = fonctions **utilisateur** seulement).
- Ne propose jamais « Révoquer » sur un abonnement **payé**.
- Ne supprime jamais silencieusement la configuration d'un serveur.

## Décision produit / UX / sécurité / technique (séparation)

- **Produit** : console d'exploitation complète, distincte du produit client.
- **UX** : dense, sombre, orientée données, recherche/raccourcis, confirmations renforcées.
- **Sécurité** : Worker + domaine + cookie séparés, dev-auth serveur, permissions granulaires, audit immuable ([doc 09](./09-security-model.md)).
- **Technique** : réutilise queries/telemetry/tickets existants via un Worker studio dédié ([doc 02](./02-product-architecture.md)).
