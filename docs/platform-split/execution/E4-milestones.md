# E4 — Milestones exécutables

> Voir aussi : [roadmap conceptuelle](../11-migration-roadmap.md) · [MVP](./E3-mvp.md) · [dépendances](./E5-dependencies-critical-path.md) · [git](./E6-branching-strategy.md)

16 milestones concrets, dérivés de la roadmap conceptuelle ([doc 11](../11-migration-roadmap.md), 19 étapes) consolidée. **Backend d'abord, chaque brique derrière feature flag, rétrocompat plan Gratuit par défaut.** Migrations D1 **conceptuelles** à partir de `0032` (aucune créée ici). Tailles : S (≤1 j) · M (jours) · L (1–2 sem.) · XL (≥3 sem.).

> Rappel process (`CLAUDE.md`) : ordre d'implémentation par milestone = **migration → shared DTO → worker (queries → api → internal → config) → gateway → panel → tests worker** ; `pnpm run migrate:remote` à chaque déploiement de milestone.

## Tableau récapitulatif

| ID | Nom | Taille | Dépend de | D1 ? | Paiement ? | Studio ? | Flag oblig. |
|----|-----|:------:|-----------|:----:|:----------:|:--------:|:-----------:|
| M1 | Fondations & design system | M | — | Non | Non | Non | — |
| M2 | Shell public & routes publiques | M | M1 | Non | Non | Non | Oui |
| M3 | Landing commerciale | L | M2 | Non | Non | Non | Oui |
| M4 | Pricing & comparatif | M | M3 | Non | Non | Non | Oui |
| M5 | Notes de mise à jour publiques | M | M2 | **Oui** | Non | Non | Oui |
| M6 | Modèle d'entitlements (flag) | L | M1 | **Oui** | Non | Non | **Oui** |
| M7 | Slots serveurs & gating | L | M6 | **Oui** | Non | Non | **Oui** |
| M8 | Espace abonnement client | M | M6 | Non | Non | Non | Oui |
| M9 | Billing sandbox | L | M6 | **Oui** | **Oui** | Non | **Oui** |
| M10 | Webhooks idempotents | M | M9 | **Oui** | **Oui** | Non | **Oui** |
| M11 | Support client | L | M6 | **Oui** | Non | Non | Oui |
| M12 | Studio minimal | XL | M1, M6 | **Oui** | Non | **Oui** | Oui |
| M13 | Grants manuels & lifetime | M | M12 | **Oui** | Non | **Oui** | Oui |
| M14 | Audit & sécurité renforcée | M | M12 | **Oui** | Non | **Oui** | Oui |
| M15 | Déploiement progressif & observabilité | M | M12 | Non | Non | **Oui** | — |
| M16 | Lancement commercial | M | M9, M10, M15 | Non | **Oui** | Non | **Oui** |

---

## M1 — Fondations & design system

- **Objectif** : préparer le terrain sans risque produit ; amorcer `@bot/ui` et le mécanisme de feature flags.
- **Valeur utilisateur** : aucune visible (socle) ; garantit la cohérence future.
- **Périmètre** : extraction des tokens + 1–2 primitives vers `@bot/ui` ; mécanisme de flags (lecture config) ; **pas** de renommage de package.
- **Packages** : `packages/ui` (amorce, neuf), `packages/panel` (consomme sans régression), `packages/shared` (constantes plans si utile).
- **Prérequis** : décisions **A0, A1** ([E1](./E1-decision-synthesis.md)).
- **Dépendances** : aucune.
- **Changements D1 futurs** : aucun.
- **Routes/API** : aucune.
- **UI** : panel visuellement identique.
- **Sécurité** : néant (pas de surface nouvelle).
- **Tests** : `pnpm -r check`, build panel inchangé, **budget 180 KiB** tenu.
- **Observabilité** : néant.
- **Critères d'acceptation** : panel identique ; `@bot/ui` importé pour ≥1 primitive ; un flag activable/désactivable.
- **Rollback** : revert de l'extraction (panel garde ses tokens locaux).
- **Taille** : M · **Ordre** : 1 · **Blocages** : aucun.
- **Livrables** : `@bot/ui` amorcé, doc courte d'usage des flags.

## M2 — Shell public & couche de routes publiques

- **Objectif** : vrai *layer* de routes publiques distinct de l'app connectée (remplace la gate implicite `["me"]`).
- **Valeur utilisateur** : accès au site sans compte.
- **Périmètre** : router public, header/footer marketing, page d'accueil minimale, `/status` minimal.
- **Packages** : `panel`, `worker` (service statique + `/status`).
- **Prérequis** : M1.
- **Dépendances** : M1.
- **Changements D1 futurs** : aucun.
- **Routes/API** : `/status` (lecture health/heartbeat) ; routing public sans session.
- **UI** : shell public responsive mobile-first.
- **Sécurité** : routes publiques **sans** données sensibles ; app connectée intacte.
- **Tests** : 401 → landing, navigation public↔connecté, non-régression accès.
- **Observabilité** : `/status` reflète l'état réel.
- **Critères d'acceptation** : pages publiques servies sans session ; app connectée inchangée.
- **Rollback** : flag masquant les routes publiques (retour gate `["me"]`).
- **Taille** : M · **Ordre** : 2 · **Blocages** : aucun.
- **Livrables** : couche publique + `/status`.

## M3 — Landing commerciale

- **Objectif** : vitrine premium orientée résultats ([doc 03](../03-client-platform.md), [doc 05](../05-plans-and-commercial-strategy.md), [doc 10](../10-ux-ui-direction.md)).
- **Valeur utilisateur** : comprend la promesse, choisit d'essayer.
- **Périmètre** : `/`, `/features`, `/legal/mentions`, `/legal/privacy` ; sections hero → preuve → offres → updates → FAQ → CTA.
- **Packages** : `panel`, `worker` (assets).
- **Prérequis** : M2 ; **D16** (nom du plan) recommandé tranché.
- **Dépendances** : M2.
- **Changements D1 futurs** : aucun.
- **Routes/API** : lecture publique uniquement.
- **UI** : landing complète, `PlanBadge` d'aperçu, lazy-load des sections lourdes.
- **Sécurité** : néant.
- **Tests** : responsive, a11y AA, **budget 180 KiB**.
- **Observabilité** : instrumentation points de conversion (`product_metrics*`, respect `docs/privacy-analytics.md`).
- **Critères d'acceptation** : parcours découverte fonctionnel sans compte.
- **Rollback** : flag masquant les routes marketing.
- **Taille** : L · **Ordre** : 3 · **Blocages** : D16 (copie).
- **Livrables** : landing + features + légal de base.

## M4 — Pricing & comparatif des offres

- **Objectif** : `/pricing` clair, **sans prix codés en dur** ([doc 05](../05-plans-and-commercial-strategy.md), D1).
- **Valeur utilisateur** : compare les offres, comprend la montée en gamme.
- **Périmètre** : `/pricing`, comparatif, FAQ d'objections, `PlanBadge`, bascule mensuel/annuel (affichage, valeurs = placeholders).
- **Packages** : `panel`, `shared` (constantes plans/rangs/slots).
- **Prérequis** : M3 ; **D16** ; méthode **D1** (valeurs peuvent rester placeholders).
- **Dépendances** : M3.
- **Changements D1 futurs** : aucun (prix hors code).
- **Routes/API** : lecture.
- **UI** : comparatif responsive, plan mis en avant (**D5**).
- **Sécurité** : néant.
- **Tests** : rendu comparatif, cohérence plans/slots avec `shared`, **aucun montant définitif en dur**.
- **Observabilité** : vues pricing, clics CTA.
- **Critères d'acceptation** : page pricing structurée pour recevoir les prix, sans valeur définitive.
- **Rollback** : retirer la route (flag).
- **Taille** : M · **Ordre** : 4 · **Blocages** : D16 ; D1 (valeurs finales, non bloquant pour la structure).
- **Livrables** : page pricing + comparatif.

## M5 — Notes de mise à jour publiques

- **Objectif** : `archodev.fr/updates` alimenté par un back-office minimal (seed/CLI avant le Studio M12).
- **Valeur utilisateur** : voit un produit vivant ; réassurance.
- **Périmètre** : lecture publique `/updates`, `/updates/:slug` ; table `release_notes`.
- **Packages** : **migration `0032`** (`release_notes`), `worker` (queries + `/api` lecture publique), `shared` (DTO), `panel`.
- **Prérequis** : M2.
- **Dépendances** : M2 (publication éditoriale complète = M12).
- **Changements D1 futurs** : **`0032_release_notes`**.
- **Routes/API** : `GET /api/updates`, `GET /api/updates/:slug` (public, `status='published'` only).
- **UI** : liste + détail, filtrage par module.
- **Sécurité** : **seuls les `published` visibles** ; brouillons invisibles ; ciblage `audience`.
- **Tests** : brouillon jamais exposé, ciblage respecté, publication idempotente (auto-suffisants — piège vitest-pool-workers).
- **Observabilité** : vues updates.
- **Critères d'acceptation** : note publiée visible public + panel ; brouillon invisible.
- **Rollback** : flag masquant `/updates`.
- **Taille** : M · **Ordre** : 5 · **Blocages** : aucun.
- **Livrables** : `release_notes` + pages publiques.

## M6 — Modèle d'entitlements (derrière feature flag)

- **Objectif** : cœur métier des droits d'accès **avant toute UI de paiement** ([doc 06](../06-subscriptions-and-entitlements.md)).
- **Valeur utilisateur** : invisible au début ; socle de tout le payant.
- **Périmètre** : tables `plans`, `plan_features`, `plan_limits`, `entitlements`, `entitlement_guild_assignments`, `subscription_events`, `trials`, `promotions`/`promotion_redemptions`, `partners` ; **résolution du meilleur entitlement actif** (pure, déterministe) ; machine d'états.
- **Packages** : **migrations `0033+`**, `worker` (queries `entitlements.ts`, `/api/subscription` lecture), `shared` (`entitlement.ts`/`subscription.ts`).
- **Prérequis** : M1 ; **D6** (slots), **D29** (mapping features).
- **Dépendances** : M1 (indépendant de l'UI).
- **Changements D1 futurs** : **`0033`+** (entitlements, assignations, événements, origines).
- **Routes/API** : `GET /api/subscription` (plan effectif, lecture).
- **UI** : néant (backend) ; le panel lit le plan effectif (défaut Gratuit).
- **Sécurité** : **`paid` non révocable** (garde), invariants [doc 08](../08-data-model.md) ; **flag obligatoire** (défaut « tout Gratuit »).
- **Tests** : **unitaires exhaustifs** de la résolution (cumul, downgrade auto, lifetime, tie-breakers) + invariants ([doc 12](../12-testing-and-release-strategy.md)).
- **Observabilité** : compteur d'entitlements actifs (interne).
- **Critères d'acceptation** : `resolveEffectiveEntitlement` couvert ; défaut `free` implicite ; aucune régression.
- **Rollback** : flag off → résolution ignorée (tout Gratuit).
- **Taille** : L · **Ordre** : 6 · **Blocages** : D6, D29.
- **Livrables** : moteur d'entitlements testé + DTO.

## M7 — Slots serveurs & gating des offres

- **Objectif** : appliquer limites/slots aux guildes via le *seam* de gating existant ([doc 01](../01-current-state-audit.md) §7).
- **Valeur utilisateur** : voit et gère ses emplacements ; comprend les limites.
- **Périmètre** : affectation/réaffectation/retrait (cooldown **D7**) ; downgrade 5→3→1 (suspension **sans suppression**) ; enrichissement `GuildGatewayConfig` (flags de plan) consommé par la gateway.
- **Packages** : `worker` (`/api/subscription/assignments`, config par-guilde, gating via `source` de plan), `gateway` (consommation), `panel` (écran emplacements + sélection downgrade), `shared`.
- **Prérequis** : M6 ; **D7**, **D8**.
- **Dépendances** : M6.
- **Changements D1 futurs** : colonnes/index d'assignation (`last_reassigned_at`, `state`, `released_at`) si non couverts en M6.
- **Routes/API** : `POST/DELETE /api/subscription/assignments`, gating dans `GET /internal/guilds/:id/config`.
- **UI** : emplacements utilisés/disponibles, `SlotMeter`, `LockedFeature`, écran de sélection au downgrade.
- **Sécurité** : cooldown anti-abus ; **suspension jamais suppression** (invariant 4).
- **Tests** : downgrade multi-serveurs, réactivation post-upgrade, cooldown, gating gateway.
- **Observabilité** : slots utilisés, downgrades.
- **Critères d'acceptation** : dépassement → serveurs `suspended`, config intacte ; réactivation OK.
- **Rollback** : flag → plan effectif forcé `free` sans suspension.
- **Taille** : L · **Ordre** : 7 · **Blocages** : D7, D8.
- **Livrables** : gestion de slots + gating.

## M8 — Espace abonnement client

- **Objectif** : surface `/app/subscription` + `/app/account` (sans paiement).
- **Valeur utilisateur** : voit son plan, ses emplacements, gère son compte.
- **Périmètre** : `/app/subscription` (plan effectif, emplacements, état ; changement → « bientôt » ou grant), `/app/account` (profil, sessions).
- **Packages** : `panel`, `worker` (`/api/account`).
- **Prérequis** : M6.
- **Dépendances** : M6 (M7 pour l'affichage slots).
- **Changements D1 futurs** : aucun.
- **Routes/API** : `GET /api/subscription`, `GET /api/account`.
- **UI** : `PlanBadge`, `SlotMeter`, historique d'accès.
- **Sécurité** : `requireSession` ; niveau user (hors guilde).
- **Tests** : affichage plan effectif correct, pas d'action de paiement.
- **Observabilité** : vues abonnement.
- **Critères d'acceptation** : l'utilisateur voit son plan/emplacements ; aucune fuite d'autres users.
- **Rollback** : flag masquant la page.
- **Taille** : M · **Ordre** : 8 · **Blocages** : aucun.
- **Livrables** : espace abonnement/compte (lecture).

## M9 — Billing sandbox

- **Objectif** : brancher le prestataire retenu en **sandbox**, checkout **hosted** (PCI minimal) ([doc 07](../07-billing-provider-analysis.md)).
- **Valeur utilisateur** : (sandbox) parcours d'achat de test.
- **Périmètre** : tables `billing_customers`, `billing_subscriptions` ; `/api/billing` (lecture + lien portail hosted) ; secrets prestataire (sandbox).
- **Packages** : **migration billing**, `worker` (queries `billing.ts`), `shared` (`billing.ts`), `panel` (`/app/billing`).
- **Prérequis** : M6 ; **D3** (prestataire), **D2** (périodicité).
- **Dépendances** : M6.
- **Changements D1 futurs** : **`00xx_billing`** (`billing_customers`, `billing_subscriptions`).
- **Routes/API** : `GET /api/billing`, création de session checkout (hosted).
- **UI** : `/app/billing` (lien portail), bouton « Passer à Premium » (sandbox).
- **Sécurité** : **jamais de `paid` sans webhook** (M10) ; secrets via `wrangler secret bulk` (piège CRLF).
- **Tests** : mapping customer/subscription↔entitlement `paid`, adaptateur découplé (`provider`).
- **Observabilité** : tentatives de checkout.
- **Critères d'acceptation** : achat sandbox crée un entitlement `paid` **uniquement via webhook** (M10).
- **Rollback** : flag coupant le checkout ; entitlements existants persistent.
- **Taille** : L · **Ordre** : 9 · **Blocages** : **D3**, D2.
- **Livrables** : adaptateur billing découplé (sandbox).

## M10 — Webhooks paiement idempotents

- **Objectif** : source de vérité `paid` = webhook signé ([doc 06](../06-subscriptions-and-entitlements.md), [doc 09](../09-security-model.md)).
- **Valeur utilisateur** : droits appliqués fiablement après paiement.
- **Périmètre** : `/webhooks/<provider>` (hors session, **signature** Web Crypto, **idempotence** via nonces/événements — pattern `internal_request_nonces`/`processed_events`).
- **Packages** : `worker` (route webhook, queries billing/entitlements, `subscription_events`).
- **Prérequis** : M9.
- **Dépendances** : M9.
- **Changements D1 futurs** : table d'idempotence si distincte.
- **Routes/API** : `POST /webhooks/<provider>`.
- **UI** : néant.
- **Sécurité** : signature obligatoire, rejeu sans effet, création `paid` hors webhook interdite.
- **Tests** : **replay (aucun effet)**, signature invalide rejetée, transitions `active/past_due/cancelled/expired`, ordre désordonné.
- **Observabilité** : échecs/latence webhook, alerting.
- **Critères d'acceptation** : cycle de vie payé piloté **uniquement** par webhooks vérifiés.
- **Rollback** : file d'attente + désactivation du traitement (webhooks re-jouables côté prestataire).
- **Taille** : M · **Ordre** : 10 · **Blocages** : D3.
- **Livrables** : webhook signé idempotent.

## M11 — Support client

- **Objectif** : support priorisé par plan, vue cross-guilde côté Studio ([doc 04](../04-developer-studio.md), [doc 06](../06-subscriptions-and-entitlements.md)).
- **Valeur utilisateur** : obtient de l'aide, priorité selon plan.
- **Périmètre** : tables `support_tickets`, `support_messages` ; `/app/support` ; priorité figée à l'ouverture (perte de plan signalée, non déprioritisée).
- **Packages** : **migration support**, `worker` (queries + `/api/support`), `shared`, `panel`.
- **Prérequis** : M6 (plan effectif) ; **D9** (politique).
- **Dépendances** : M6 (vue Studio = M12).
- **Changements D1 futurs** : **`00xx_support`**.
- **Routes/API** : `/api/support` (CRUD tickets côté user).
- **UI** : `/app/support` (mes tickets, priorité).
- **Sécurité** : `internal=1` **jamais** renvoyé au client ; priorité figée.
- **Tests** : priorité figée, notes internes invisibles, file triée (priorité, ancienneté).
- **Observabilité** : tickets ouverts par priorité.
- **Critères d'acceptation** : ticket porte plan/priorité d'ouverture ; note interne invisible client.
- **Rollback** : flag masquant le support (formulaire de contact simple en repli).
- **Taille** : L · **Ordre** : 11 · **Blocages** : D9.
- **Livrables** : moteur support priorisé.

## M12 — Studio minimal

- **Objectif** : Worker studio + SPA `developer-studio` isolés ([doc 02](../02-product-architecture.md), [doc 04](../04-developer-studio.md), [doc 09](../09-security-model.md)).
- **Valeur utilisateur** : (exploitant) supervise et accorde des accès.
- **Périmètre** : `packages/developer-studio` (neuf) ; Worker studio (`studio.archodev.fr`, cookie `studio_session`, secrets distincts) ; `requireDeveloper` ; tables `studio_operators`/`studio_operator_permissions` ; pages socle (vue d'ensemble, guildes lecture, abonnements lecture, updates publication).
- **Packages** : `developer-studio` (neuf), `worker-studio` **ou** entry (**D22**), `worker`/`shared` (queries réutilisées).
- **Prérequis** : M1 (`@bot/ui`), M6 (entitlements) ; **D11** (bootstrap), **D17** (domaine studio), **D22/D23**.
- **Dépendances** : M1, M6.
- **Changements D1 futurs** : **`00xx_studio_operators`**.
- **Routes/API** : `/studio-api/*` sous `requireDeveloper(permission)` ; `/studio/auth/*`.
- **UI** : shell studio sombre dense, `ProductionBanner`, `DataTable`, `CommandPalette` (min), publication `release_notes`.
- **Sécurité** : **isolation stricte** (domaine/cookie/secret séparés, `sameSite=Strict`), allowlist propriétaire, aucune route studio côté client.
- **Tests** : **aucune route studio sur domaine client**, dev-auth serveur, permissions vérifiées serveur.
- **Observabilité** : accès studio, actions.
- **Critères d'acceptation** : Studio accessible **seulement** aux opérateurs `active` ; zéro endpoint studio côté client.
- **Rollback** : ne pas router `studio.archodev.fr` (aucun impact client).
- **Taille** : XL · **Ordre** : 12 · **Blocages** : D11, D17, D22.
- **Livrables** : Studio isolé + dev-auth + publication updates.

## M13 — Grants manuels & lifetime

- **Objectif** : octroi/révocation d'accès offerts + lifetime sécurisé ([doc 04](../04-developer-studio.md), [doc 06](../06-subscriptions-and-entitlements.md)).
- **Valeur utilisateur** : (exploitant) accorde bêta/partenariats/gestes traçables.
- **Périmètre** : formulaire d'octroi (durées, raison obligatoire, note interne, affectation) ; `developer_grants` ; `subscriptions.grant`/`revoke_granted` ; **lifetime** (`grant_lifetime` + saisie `LIFETIME` + step-up + audit).
- **Packages** : `worker-studio` (api), `shared`, `developer-studio` (UI, `DangerConfirm`).
- **Prérequis** : M12 ; **D10** (lifetime).
- **Dépendances** : M6, M12.
- **Changements D1 futurs** : `developer_grants` (si non couvert M6).
- **Routes/API** : `/studio-api/subscriptions/grant`, `/revoke`, `/grant-lifetime`.
- **UI** : formulaire d'octroi + révocation (offerts uniquement) + confirmation renforcée lifetime.
- **Sécurité** : **révocation n'affecte jamais un `paid`** ; auto-attribution interdite (E2 Fiche 6.1) ; lifetime garde-fous.
- **Tests** : grant→entitlement révocable ; révocation n'affecte pas le `paid` ; lifetime impossible sans permission+saisie ; audit émis.
- **Observabilité** : grants/révocations/lifetime.
- **Critères d'acceptation** : accès offert créé/révoqué/audité ; `paid` intouché ; lifetime non déclenchable par erreur.
- **Rollback** : retirer les permissions `grant`/`grant_lifetime`.
- **Taille** : M · **Ordre** : 13 · **Blocages** : D10.
- **Livrables** : grants + lifetime sécurisé.

## M14 — Audit immuable & sécurité renforcée

- **Objectif** : journal append-only + durcissement ([doc 08](../08-data-model.md), [doc 09](../09-security-model.md)).
- **Valeur utilisateur** : (exploitant) traçabilité et sûreté.
- **Périmètre** : `audit_events` (étend `admin_audit_log(_v2)`) ; `/audit` (`audit.read`) ; step-up sur financier/lifetime, rate-limits par opérateur/action, kill-switch studio, masquage PII systématique.
- **Packages** : **migration audit**, `worker`/`worker-studio` (écriture centralisée, middlewares), `developer-studio` (consultation).
- **Prérequis** : M12–M13 ; **D24** (step-up), **D27** (env).
- **Dépendances** : M12, M13.
- **Changements D1 futurs** : **`00xx_audit_events`**.
- **Routes/API** : `GET /studio-api/audit`.
- **UI** : `/audit` (recherche/filtre acteur/cible/type/période).
- **Sécurité** : **append-only** (aucune route UPDATE/DELETE), PII masquée, step-up, rate-limits.
- **Tests** : append-only vérifié, PII masquée, chaque action sensible → 1 entrée ; mutations sans permission rejetées ; replay/origin/CSRF.
- **Observabilité** : événements sécurité (origines rejetées, quotas).
- **Critères d'acceptation** : chaque action sensible ⇒ 1 entrée immuable ; matrice appliquée serveur.
- **Rollback** : ajuster les seuils (flag) sans retirer l'audit.
- **Taille** : M · **Ordre** : 14 · **Blocages** : D24.
- **Livrables** : audit + durcissement.

## M15 — Déploiement progressif & observabilité

- **Objectif** : activer par cohortes via flags ; voir ce qui se passe ([doc 11](../11-migration-roadmap.md) étapes 17–18, [doc 12](../12-testing-and-release-strategy.md)).
- **Valeur utilisateur** : fiabilité (incidents vus avant les clients).
- **Périmètre** : rollout graduel (guildes pilotes → général) ; `/errors`, `/metrics`, `/status` enrichi ; smoke tests prod ; bascule DNS sans coupure.
- **Packages** : `worker`/`gateway` (telemetry), `developer-studio` (dashboards), infra.
- **Prérequis** : M12 ; **D19** (bêta), **D25** (outillage), **D27**.
- **Dépendances** : M12.
- **Changements D1 futurs** : éventuelles tables de métriques.
- **Routes/API** : `/studio-api/errors`, `/metrics`.
- **UI** : dashboards erreurs/métriques, timelines.
- **Sécurité** : pas de PII dans les métriques (`docs/privacy-analytics.md`).
- **Tests** : métriques justes, `/status` fiable, rollback flag testé, smoke prod.
- **Observabilité** : c'est l'objet du milestone.
- **Critères d'acceptation** : activation/désactivation par flag sans redeploy ; incidents visibles.
- **Rollback** : masquer les dashboards (données conservées).
- **Taille** : M · **Ordre** : 15 · **Blocages** : D19.
- **Livrables** : observabilité + rollout par flags.

## M16 — Lancement commercial

- **Objectif** : activer le paiement en production, prix arbitrés ([doc 13](../13-open-decisions.md)).
- **Valeur utilisateur** : peut acheter réellement.
- **Périmètre** : prix réels injectés (hors code), CGV/`/legal/sales` publiées, TVA/facturation opérationnelles (MoR/Stripe), communication de lancement, tarif de lancement/early adopters (E2 §2.3).
- **Packages** : `panel` (prix), `worker` (billing prod), légal.
- **Prérequis** : M9, M10, M15 ; **D1** (valeurs), **D12** (remboursement), **D18** (rétention), **D20** (TVA), **D21** (CGV), **D17** (domaine client).
- **Dépendances** : M9, M10, M15.
- **Changements D1 futurs** : aucun (config).
- **Routes/API** : billing en mode production.
- **UI** : prix réels, bandeau tarif de lancement.
- **Sécurité** : env prod formalisé, secrets prod.
- **Tests** : paiement réel de bout en bout, factures, remboursement, smoke prod.
- **Observabilité** : conversions, revenus, échecs paiement.
- **Critères d'acceptation** : premier achat payant réel réussi, entitlement `paid` correct, support opérationnel.
- **Rollback** : flag coupant le checkout ; entitlements/config intacts.
- **Taille** : M · **Ordre** : 16 · **Blocages** : **D1, D3, D12, D18, D20, D21, D17**.
- **Livrables** : produit commercialisé.

---

## Écarts vs roadmap conceptuelle ([doc 11](../11-migration-roadmap.md))

- **Fusions** : étapes 1+2 → **M1** ; 14+15 → **M14** ; 17+18 → **M15**.
- **Découpage** : l'espace abonnement client (**M8**) est isolé pour livrer une surface utilisateur avant le paiement.
- **Ordre préservé** : backend (M6/M7) avant paiement (M9/M10) avant lancement (M16) ; Studio (M12) parallélisable après M6.
- **Total** : **16 milestones** (dans la cible 10–16).
