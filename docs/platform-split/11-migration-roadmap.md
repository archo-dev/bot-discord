# 11 — Roadmap de migration

> Voir aussi : [architecture](./02-product-architecture.md) · [abonnements](./06-subscriptions-and-entitlements.md) · [tests & release](./12-testing-and-release-strategy.md) · [décisions ouvertes](./13-open-decisions.md)

Roadmap **incrémentale** : **aucun big-bang rewrite**. Chaque phase est indépendamment livrable, testable et **réversible** (rollback documenté). Principe d'ordre : **backend d'abord, UI ensuite** ; rétrocompatibilité par défaut (**toute guilde/utilisateur sans abonnement = plan Gratuit**, aucune régression). Chaque brique SaaS est activable par **feature flag** ([doc 09](./09-security-model.md) `features.manage`) pour un déploiement progressif ([doc 12](./12-testing-and-release-strategy.md)).

> ⚠️ **Rappel process projet** (`CLAUDE.md`) : 1 feature = 1 commit `Mxx: …` sur `master` ; ordre d'implémentation migration → shared DTO → worker (queries → api → internal → config) → gateway → panel → tests worker ; `pnpm run migrate:remote` à **chaque** déploiement de milestone. Les migrations D1 partent de `0032` (dernière = `0031_automation_studio.sql`).

## Regroupement en phases

Les 19 étapes ci-dessous se regroupent dans les phases du [README](./README.md) : **P0** fondations (1) · **P1** droits d'accès backend (6–8 partiel) · **P2** gating offres (4, 7) · **P3** client public (2, 3, 5) · **P4** paiement (8, 9) · **P5** studio (11–15) · **P6** support & audit (10, 14) · finalisation (16–19).

## Légende

- **Taille** : S (≤1 j) · M (quelques jours) · L (1–2 sem.) · XL (≥3 sem. / plusieurs milestones).
- **Migrations futures** : numéros D1 **conceptuels** à partir de `0032` (aucune migration créée dans ce dossier — [doc 08](./08-data-model.md)).

---

## Étape 1 — Fondations docs & design system  · Taille S/M

- **Objectif** : préparer le terrain sans risque produit.
- **Périmètre** : ce dossier de conception ; amorce de `@bot/ui` (tokens + primitives sans dépendance) ; feature flags (mécanisme) ; **[prérequis] domaines custom** `archodev.fr` / `studio.archodev.fr` (DNS + routes Cloudflare).
- **Packages** : `docs/`, `packages/ui` (neuf, amorce), `packages/panel` (consomme `@bot/ui` sans régression).
- **Migrations futures** : aucune.
- **Dépendances** : aucune.
- **Risques** : casser les tokens du panel pendant l'extraction (tokens couplés à `index.css` — [doc 01](./01-current-state-audit.md)).
- **Tests** : build panel inchangé, typecheck `pnpm -r check`, budget 180 KiB tenu.
- **Critères d'acceptation** : panel identique visuellement ; `@bot/ui` importé par le panel pour ≥1 primitive ; flags activables.
- **Rollback** : revert de l'extraction (le panel garde ses tokens locaux).

## Étape 2 — Séparation progressive du client web  · Taille M

- **Objectif** : préparer un vrai *layer* de routes publiques (aujourd'hui gate implicite via `["me"]`).
- **Périmètre** : router public distinct de l'app connectée ; **[différé/optionnel]** renommage `packages/panel` → `client-web` (mécanique, en une fois — [doc 02](./02-product-architecture.md)).
- **Packages** : `panel`.
- **Migrations futures** : aucune.
- **Dépendances** : étape 1.
- **Risques** : régression de la gate d'auth ; SEO/routing.
- **Tests** : navigation public↔connecté, 401 → landing, non-régression accès.
- **Critères d'acceptation** : routes publiques servies sans session ; app connectée intacte.
- **Rollback** : conserver l'ancienne gate (flag).

## Étape 3 — Landing publique  · Taille L

- **Objectif** : vitrine premium orientée résultats ([doc 03](./03-client-platform.md), [doc 05](./05-plans-and-commercial-strategy.md), [doc 10](./10-ux-ui-direction.md)).
- **Périmètre** : `/`, `/features`, `/docs`, `/status`, `/support`, `/legal/*` ; header/footer marketing.
- **Packages** : `panel` (pages), `worker` (service statique + `/status` via health/heartbeat).
- **Migrations futures** : aucune.
- **Dépendances** : étape 2.
- **Risques** : budget bundle (pages riches) → lazy-load discipliné.
- **Tests** : responsive mobile-first, a11y AA, budget 180 KiB, `/status` reflète l'état réel.
- **Critères d'acceptation** : parcours découverte fonctionnel sans compte.
- **Rollback** : masquer les routes publiques derrière flag.

## Étape 4 — Pricing & offres  · Taille M

- **Objectif** : page `/pricing` + comparatif, **sans prix codés en dur** ([doc 05](./05-plans-and-commercial-strategy.md), [doc 13](./13-open-decisions.md)).
- **Périmètre** : `/pricing`, comparatif, FAQ d'objections ; `PlanBadge` ; textes commerciaux (FR).
- **Packages** : `panel`, `shared` (constantes de plans `free/premium/business`, rangs, slots 1/3/5).
- **Migrations futures** : aucune (les prix restent hors code).
- **Dépendances** : étape 3.
- **Risques** : inventer un prix (interdit) ; mapping features non figé.
- **Tests** : rendu comparatif, cohérence plans/slots avec `shared`.
- **Critères d'acceptation** : page pricing sans montant définitif, structurée pour recevoir les prix arbitrés.
- **Rollback** : retirer la route.

## Étape 5 — Release notes (notes de mise à jour)  · Taille M

- **Objectif** : `archodev.fr/updates` alimenté par un back-office (le Studio viendra en étape 11 ; au départ, seed/CLI).
- **Périmètre** : lecture publique `/updates`, `/updates/:slug` ; table `release_notes` ([doc 08](./08-data-model.md)).
- **Packages** : migration `0032` (`release_notes`), `worker` (queries + `/api` lecture publique), `shared` (DTO), `panel` (pages).
- **Migrations futures** : `0032`.
- **Dépendances** : étapes 3–4.
- **Risques** : exposer un brouillon → filtrer `status='published'`.
- **Tests** : seuls les `published` visibles ; ciblage `audience` respecté ; idempotence de publication.
- **Critères d'acceptation** : note publiée visible en public + panel ; brouillon invisible.
- **Rollback** : flag masquant `/updates`.

## Étape 6 — Moteur d'entitlements (backend)  · Taille L

- **Objectif** : cœur métier des droits d'accès **avant toute UI de paiement** ([doc 06](./06-subscriptions-and-entitlements.md)).
- **Périmètre** : tables `plans`, `plan_features`, `plan_limits`, `entitlements`, `entitlement_guild_assignments`, `subscription_events`, `trials`, `promotions`/`promotion_redemptions`, `partners` ; **résolution du meilleur entitlement actif** (pure, déterministe) ; machine d'états.
- **Packages** : migrations `0033+`, `worker` (queries `entitlements.ts`, api `/api/subscription` lecture), `shared` (DTO `entitlement.ts`/`subscription.ts`).
- **Migrations futures** : `0033`, `0034` (assignations/événements/origines).
- **Dépendances** : étape 1 ; indépendante de l'UI.
- **Risques** : complexité cumul/priorité/lifetime → tests unitaires exhaustifs ([doc 12](./12-testing-and-release-strategy.md)).
- **Tests** : résolution (cumul paid+granted, downgrade auto, lifetime, tie-breakers), invariants [doc 08](./08-data-model.md) (dont `paid` non révocable).
- **Critères d'acceptation** : `resolveEffectiveEntitlement` couvert ; défaut `free` implicite ; aucune UI requise.
- **Rollback** : flag désactivant l'usage de la résolution (retour « tout Gratuit »).

## Étape 7 — Emplacements de serveurs & gating des offres  · Taille L

- **Objectif** : appliquer limites/slots aux guildes via le *seam* de gating existant ([doc 01](./01-current-state-audit.md) §7).
- **Périmètre** : affectation/réaffectation/retrait de slots (cooldown anti-abus **[doc 13]**) ; downgrade 5→3→1 (suspension **sans suppression**) ; enrichissement `GuildGatewayConfig` (flags de plan) consommé par la gateway.
- **Packages** : `worker` (api `/api/subscription/assignments`, config par-guilde, gating via nouvelle `source` de plan), `gateway` (consommation config), `panel` (écran emplacements + sélection au downgrade), `shared`.
- **Migrations futures** : indices/colonnes d'assignation si nécessaires.
- **Dépendances** : étape 6.
- **Risques** : suppression involontaire de config → invariant « suspension sans suppression » ([doc 08](./08-data-model.md) Inv. 4).
- **Tests** : downgrade multi-serveurs, réactivation post-upgrade, cooldown, gating gateway.
- **Critères d'acceptation** : dépassement → serveurs `suspended`, config intacte ; réactivation ok.
- **Rollback** : flag → plan effectif forcé `free` sans suspension.

## Étape 8 — Prestataire de paiement (intégration)  · Taille L

- **Objectif** : brancher le prestataire retenu ([doc 07](./07-billing-provider-analysis.md), **choix [doc 13]**) ; checkout **hosted** (PCI minimal).
- **Périmètre** : tables `billing_customers`, `billing_subscriptions` ; `/api/billing` (lecture + lien portail hosted) ; secrets prestataire.
- **Packages** : migration billing, `worker` (queries `billing.ts`), `shared` (`billing.ts`), `panel` (`/app/billing`).
- **Migrations futures** : `00xx_billing`.
- **Dépendances** : étape 6 (entitlements) ; décision prestataire.
- **Risques** : lock-in → adaptateur découplé + champ `provider` ([doc 07](./07-billing-provider-analysis.md)).
- **Tests** : mapping customer/subscription↔entitlement `paid`, jamais de `paid` sans confirmation.
- **Critères d'acceptation** : achat de test crée un entitlement `paid` **via webhook** (étape 9), pas autrement.
- **Rollback** : flag coupant le checkout (les entitlements existants persistent).

## Étape 9 — Webhooks paiement (idempotents)  · Taille M

- **Objectif** : source de vérité `paid` = webhook signé ([doc 06](./06-subscriptions-and-entitlements.md), [doc 09](./09-security-model.md)).
- **Périmètre** : `/webhooks/<provider>` (hors session, **signature** Web Crypto, **idempotence** via nonces/événements traités — pattern `internal_request_nonces`/`processed_events`).
- **Packages** : `worker` (route webhook, queries billing/entitlements, `subscription_events`).
- **Migrations futures** : table d'idempotence si distincte.
- **Dépendances** : étape 8.
- **Risques** : rejeu/duplication → idempotence testée ; création `paid` hors webhook interdite.
- **Tests** : replay (aucun effet), signature invalide rejetée, transitions `active/past_due/cancelled/expired`.
- **Critères d'acceptation** : cycle de vie payé piloté uniquement par webhooks vérifiés.
- **Rollback** : file d'attente + désactivation du traitement (webhooks re-jouables côté prestataire).

## Étape 10 — Support (tickets priorisés)  · Taille L

- **Objectif** : support priorisé par plan, vue cross-guilde côté Studio ([doc 04](./04-developer-studio.md), [doc 06](./06-subscriptions-and-entitlements.md)).
- **Périmètre** : tables `support_tickets`, `support_messages` ; `/app/support` (client) ; priorité figée à l'ouverture (perte de plan signalée, non déprioritisée).
- **Packages** : migration support, `worker` (queries + `/api/support`), `shared`, `panel`.
- **Migrations futures** : `00xx_support`.
- **Dépendances** : étape 6 (plan effectif à l'ouverture).
- **Risques** : fuite `internal=1` au client → filtrage strict ([doc 08](./08-data-model.md)).
- **Tests** : priorité figée, notes internes jamais renvoyées, file triée.
- **Critères d'acceptation** : ticket porte plan/priorité d'ouverture ; note interne invisible client.
- **Rollback** : flag masquant le support.

## Étape 11 — Developer Studio (socle)  · Taille XL

- **Objectif** : Worker studio + SPA `developer-studio` isolés ([doc 02](./02-product-architecture.md), [doc 04](./04-developer-studio.md)).
- **Périmètre** : `packages/developer-studio` (neuf) ; Worker studio (`studio.archodev.fr`, cookie `studio_session`, secrets distincts) ; `requireDeveloper` ; tables `studio_operators`/`studio_operator_permissions` ; pages socle (vue d'ensemble, infra, guildes lecture).
- **Packages** : `developer-studio` (neuf), `worker-studio` (ou entry — **[doc 13]**), `worker`/`shared` (queries réutilisées).
- **Migrations futures** : `00xx_studio_operators`.
- **Dépendances** : étape 1 (`@bot/ui`) ; dev-auth ([doc 09](./09-security-model.md)).
- **Risques** : escalade client→studio → isolation stricte, tests de séparation ([doc 12](./12-testing-and-release-strategy.md)).
- **Tests** : aucune route studio sur domaine client, dev-auth serveur, `sameSite=Strict`.
- **Critères d'acceptation** : Studio accessible **seulement** aux opérateurs `active` ; zéro endpoint studio côté client.
- **Rollback** : ne pas router `studio.archodev.fr` (aucun impact client).

## Étape 12 — Grants manuels (accès accordés)  · Taille M

- **Objectif** : octroi/révocation d'accès offerts ([doc 04](./04-developer-studio.md) `/subscriptions/granted`).
- **Périmètre** : formulaire d'octroi (durées 7j…1an/perso, raison obligatoire, note interne, affectation) ; `developer_grants` ; `subscriptions.grant` / `revoke_granted`.
- **Packages** : `worker-studio` (api), `shared`, `developer-studio` (UI).
- **Migrations futures** : `00xx_developer_grants` (si non couvert étape 6).
- **Dépendances** : étapes 6, 11.
- **Risques** : révocation touchant un `paid` → interdit par conception ([doc 06](./06-subscriptions-and-entitlements.md)).
- **Tests** : grant→entitlement révocable ; révocation n'affecte pas le `paid` sous-jacent ; audit émis.
- **Critères d'acceptation** : accès offert créé/révoqué, audité ; `paid` intouché.
- **Rollback** : retirer la permission `grant`.

## Étape 13 — Lifetime  · Taille S/M

- **Objectif** : accès à vie sécurisé ([doc 06](./06-subscriptions-and-entitlements.md), [doc 09](./09-security-model.md)).
- **Périmètre** : `subscriptions.grant_lifetime` (permission distincte) + confirmation renforcée + saisie `LIFETIME` + step-up + audit complet.
- **Packages** : `worker-studio`, `developer-studio` (`DangerConfirm`).
- **Migrations futures** : aucune (couvert par `developer_grants.duration_kind='lifetime'`).
- **Dépendances** : étape 12.
- **Risques** : lifetime accidentel → garde-fous multiples.
- **Tests** : lifetime impossible sans permission dédiée + saisie exacte ; `end_at IS NULL` ; audit présent.
- **Critères d'acceptation** : chemin lifetime traçable et non déclenchable par erreur.
- **Rollback** : retirer `grant_lifetime`.

## Étape 14 — Audit immuable  · Taille M

- **Objectif** : journal append-only de toute mutation sensible ([doc 08](./08-data-model.md), [doc 09](./09-security-model.md)).
- **Périmètre** : `audit_events` (étend `admin_audit_log(_v2)`) ; `/audit` (`audit.read`) ; masquage secrets/PII.
- **Packages** : migration audit, `worker`/`worker-studio` (écriture centralisée), `developer-studio` (consultation).
- **Migrations futures** : `00xx_audit_events`.
- **Dépendances** : étapes 11–13 (émettent des événements).
- **Risques** : route UPDATE/DELETE accidentelle → **aucune** exposée.
- **Tests** : append-only (pas de mutation possible), PII masquée, couverture des actions sensibles.
- **Critères d'acceptation** : chaque action sensible ⇒ 1 entrée immuable.
- **Rollback** : sans objet (l'audit ne se « désactive » pas ; on peut masquer l'UI).

## Étape 15 — Sécurité renforcée  · Taille M

- **Objectif** : durcir l'ensemble ([doc 09](./09-security-model.md)).
- **Périmètre** : step-up/réauth sur actions financières/lifetime ; rate-limits par opérateur/action ; kill-switch studio ; revue de la matrice de permissions ; masquage PII systématique.
- **Packages** : `worker-studio` (middlewares), `shared`.
- **Migrations futures** : éventuels compteurs de quota.
- **Dépendances** : étapes 11–14.
- **Risques** : friction opérateur excessive → calibrage step-up.
- **Tests** : mutations sans permission rejetées, rate-limits, origin/CSRF, replay.
- **Critères d'acceptation** : matrice appliquée serveur ; aucune mutation non auditée.
- **Rollback** : ajuster les seuils par flag (sans retirer l'audit).

## Étape 16 — Migration des pages existantes  · Taille L

- **Objectif** : intégrer les ~22 pages modules du panel dans la nouvelle IA (compte→serveur→module) sans les réécrire ([doc 03](./03-client-platform.md)).
- **Périmètre** : `/app/servers/:id/<module>` ; sélecteur de serveur persistant ; `PlanBadge`/`SlotMeter` ; `LockedFeature` sur fonctions hors plan.
- **Packages** : `panel`.
- **Migrations futures** : aucune.
- **Dépendances** : étapes 4, 7.
- **Risques** : régression des pages existantes → migration page par page.
- **Tests** : non-régression des modules, verrouillage cosmétique + garde backend.
- **Critères d'acceptation** : pages existantes fonctionnelles dans la nouvelle navigation.
- **Rollback** : conserver l'ancienne navigation derrière flag.

## Étape 17 — Déploiement progressif  · Taille M

- **Objectif** : activer les briques par cohortes via flags ([doc 12](./12-testing-and-release-strategy.md)).
- **Périmètre** : rollout graduel (guildes pilotes → général) ; `pnpm run migrate:remote` à chaque milestone ; bascule DNS sans coupure (`*.workers.dev` reste valide).
- **Packages** : tous (flags), infra.
- **Migrations futures** : appliquées au fil de l'eau.
- **Dépendances** : étapes concernées livrées.
- **Risques** : migration oubliée (déjà cassé la prod — `CLAUDE.md`) → checklist migrate:remote.
- **Tests** : smoke tests prod, `/status`, rollback flag.
- **Critères d'acceptation** : activation/désactivation par flag sans redeploy.
- **Rollback** : désactiver le flag concerné.

## Étape 18 — Observabilité  · Taille M

- **Objectif** : voir ce qui se passe (technique + produit) — `/errors`, `/metrics`, `/status`.
- **Périmètre** : agrégation erreurs Worker/Gateway, métriques (`operation_metrics`, `product_metrics*`, telemetry), timelines, alerting minimal.
- **Packages** : `worker`/`gateway` (telemetry), `developer-studio` (dashboards).
- **Migrations futures** : éventuelles tables de métriques.
- **Dépendances** : étape 11.
- **Risques** : exposer de la PII dans les métriques → respect `docs/privacy-analytics.md`.
- **Tests** : métriques justes, pas de PII, `/status` fiable.
- **Critères d'acceptation** : incidents visibles avant les clients.
- **Rollback** : masquer les dashboards (données conservées).

## Étape 19 — Lancement commercial  · Taille M

- **Objectif** : activer le paiement en production, prix arbitrés ([doc 13](./13-open-decisions.md)).
- **Périmètre** : prix réels injectés, CGV/`/legal/sales` publiées, TVA/facturation opérationnelles (selon MoR/Stripe — [doc 07](./07-billing-provider-analysis.md)), communication de lancement.
- **Packages** : `panel` (prix), `worker` (billing en prod), légal.
- **Migrations futures** : aucune (config).
- **Dépendances** : étapes 8, 9, 17, 18 + **décisions [doc 13]**.
- **Risques** : conformité fiscale/juridique → traitée par le choix prestataire.
- **Tests** : paiement réel de bout en bout, factures, remboursement, smoke prod.
- **Critères d'acceptation** : premier achat payant réel réussi, entitlement `paid` correct, support opérationnel.
- **Rollback** : flag coupant le checkout ; les entitlements/config restent intacts.

---

## Ordre recommandé & dépendances (synthèse)

```
1 ─▶ 2 ─▶ 3 ─▶ 4 ─▶ 5
1 ─▶ 6 ─▶ 7 ─▶ (16)
     6 ─▶ 8 ─▶ 9 ─▶ (19)
     6 ─▶ 10
1 ─▶ 11 ─▶ 12 ─▶ 13
          11 ─▶ 14 ─▶ 15
          11 ─▶ 18
17 (transverse) ── flags sur toutes les briques
19 (final) ── dépend de 8,9,17,18 + décisions doc 13
```

- **Chemin critique commercial** : 1 → 6 → 8 → 9 → 17 → 19.
- **Chemin critique opérationnel** : 1 → 11 → (12/14/18).
- **Backend avant UI** : 6/7 (droits) précèdent 8/9 (paiement) et 16 (pages).
- **Rien n'est irréversible** : chaque étape derrière un flag, migrations additives, suspension jamais suppression.

## Séparation décision produit / technique / gestion de projet

- **Produit** : ordre de valeur (public d'abord ou paiement d'abord), plan mis en avant (**[doc 13]**).
- **Technique** : backend-first, migrations additives `0032+`, flags, isolation studio.
- **Gestion de projet** : phases livrables/testables/réversibles, tailles S–XL, checklist `migrate:remote` par milestone.
