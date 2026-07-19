# 08 — Modèle de données (conceptuel)

> Voir aussi : [abonnements](./06-subscriptions-and-entitlements.md) · [paiement](./07-billing-provider-analysis.md) · [sécurité](./09-security-model.md)

> ⚠️ **Aucune migration n'est créée.** Ce document est **conceptuel**. Les migrations existantes vont jusqu'à `packages/worker/migrations/0031_automation_studio.sql` → la **prochaine serait `0032`**. Toutes les tables ci-dessous seraient ajoutées côté **D1** (Worker = seul écrivain), SQL brut dans `packages/worker/src/db/queries/` (pas d'ORM), DTO dans `packages/shared/src/api-types/`.

## Principes transverses

- **Séparer accès (entitlements) et paiement (billing)** ([doc 06](./06-subscriptions-and-entitlements.md)).
- **La révocabilité dérive de l'origine** (`entitlements.source`), **jamais** d'un champ `revocable` stocké comme source de vérité. Si un `revocable` est matérialisé, c'est un **cache dérivé** recalculable.
- **Source de vérité** explicite par table (colonne « Source de vérité » ci-dessous).
- **Audit & événements** immuables pour toute mutation sensible.
- Identifiants Discord = **snowflakes** stockés en `TEXT` (comme l'existant, ex. `guilds`, `panel_access`).
- `guild_id` partout où pertinent → cohérent avec le scoping existant.

## Vue d'ensemble (relations)

```
plans ──< plan_features
  │   └──< plan_limits
  │
  └──< entitlements >── (user Discord)
            │  ├──< entitlement_guild_assignments >── guilds (existant)
            │  └──1 origine (selon entitlements.source) :
            │        source=paid      →1 billing_subscriptions
            │        source=granted   →1 developer_grants
            │        source=partner   →1 partners
            │        source=trial     →1 trials
            │        source=promotion →1 promotion_redemptions >── promotions
            │
billing_customers ──< billing_subscriptions ──< subscription_events
            │
support_tickets ──< support_messages
release_notes
audit_events                (journal immuable, réf. acteur/cible)
studio_operators ──< studio_operator_permissions   (dev-auth, voir doc 09)
```

## Catalogue d'offres (référentiel, peu volatil)

### `plans`
- **Objectif** : définir les 3 offres (`free`, `premium`, `business`).
- **Champs essentiels** : `id` (`free|premium|business`), `rank` (1/2/3), `display_name`, `slots` (1/3/5), `is_public`, `created_at`, `updated_at`.
- **Contraintes** : `id` PK ; `rank` unique.
- **Index** : PK suffisant (table minuscule).
- **Source de vérité** : configuration produit (ce dépôt / Studio `features.manage`).
- **Sensibilité / rétention** : non sensible ; permanent.

### `plan_features`
- **Objectif** : mapping feature → plan (quelle capacité dans quel plan). C'est le **pont** vers le gating de modules existant.
- **Champs** : `plan_id` (FK `plans`), `feature_key` (ex. `automod.advanced`, `music.advanced`, `stats.detailed`), `enabled`, `limit_value` (nullable, pour quotas).
- **Contraintes** : PK (`plan_id`, `feature_key`) ; FK `plan_id`.
- **Index** : `(feature_key)` pour requêtes inverses.
- **Source de vérité** : produit/Studio. **[Décision ouverte doc 13]** : liste exacte des `feature_key` par plan.
- **Relation** : consommé par l'évaluation de gating (branché sur `guild_modules` / `CapabilityEntitlement` via une `source` de plan — [doc 01](./01-current-state-audit.md) §7).

### `plan_limits`
- **Objectif** : limites quantitatives par plan (au-delà des slots).
- **Champs** : `plan_id`, `limit_key` (ex. `automations.max`, `logs.retention_days`), `limit_value`.
- **Contraintes** : PK (`plan_id`, `limit_key`).
- **Source de vérité** : produit/Studio. **[Décision ouverte doc 13]**.

## Paiement (billing — découplé du prestataire)

### `billing_customers`
- **Objectif** : lier un utilisateur Discord à un client chez le prestataire.
- **Champs** : `id` (interne), `user_id` (snowflake), `provider` (`stripe|lemonsqueezy|paddle`), `provider_customer_id`, `email` (fournie par le prestataire), `created_at`.
- **Contraintes** : unique (`provider`, `provider_customer_id`) ; index `(user_id)`.
- **Source de vérité** : **prestataire** (miroir local).
- **Sensibilité** : `email` = donnée personnelle → accès restreint, non exposée au client d'autres users, masquée dans le Studio sauf permission. **Rétention** : tant que la relation client existe + obligations comptables **[à préciser doc 13]**.

### `billing_subscriptions`
- **Objectif** : miroir d'un abonnement chez le prestataire ; adosse un entitlement `paid`.
- **Champs** : `id`, `customer_id` (FK `billing_customers`), `provider`, `provider_subscription_id`, `plan_id` (FK `plans`), `status` (`active|past_due|cancelled|expired`), `interval` (`month|year`), `current_period_end`, `cancel_at_period_end`, `entitlement_id` (FK `entitlements`, nullable au tout début), `created_at`, `updated_at`.
- **Contraintes** : unique (`provider`, `provider_subscription_id`) ; FK `customer_id`, `plan_id`, `entitlement_id`.
- **Index** : `(entitlement_id)`, `(status)`, `(current_period_end)`.
- **Source de vérité** : **prestataire** (via webhooks signés & idempotents).
- **Règle d'intégrité** : un `billing_subscriptions` **actif** ⇒ existence d'un `entitlements.source = paid` correspondant. La création d'un `paid` **sans** subscription confirmée est interdite (contrainte applicative).
- **Rétention** : conservé pour historique/compta après expiration.

## Droits d'accès (cœur métier)

### `entitlements`
- **Objectif** : un droit d'accès actif d'un utilisateur à un plan, avec origine et fenêtre.
- **Champs** : `id`, `user_id` (snowflake), `plan_id` (FK `plans`), `source` (`paid|granted|trial|promotion|partner`), `status` (`active|expired|revoked|cancelled|suspended|past_due`), `start_at`, `end_at` (nullable), `is_lifetime` (bool), `origin_ref` (FK logique : `billing_subscriptions.id` si `paid`, `developer_grants.id` sinon), `created_at`, `updated_at`.
- **Contraintes** :
  - `source` détermine la révocabilité (règle **applicative**, appliquée dans les queries — pas un flag libre).
  - `is_lifetime = 1` ⇒ `end_at IS NULL` ; sinon `end_at` requis.
  - Un `entitlements.source='paid'` **ne peut pas** passer à `revoked` (garde applicative).
- **Index** : `(user_id, status)`, `(status, end_at)` (balayage d'expiration par cron), `(plan_id)`.
- **Source de vérité** : **cette table** pour le *droit* ; l'*existence/état d'un `paid`* dérive de `billing_subscriptions`.
- **Règle d'intégrité** : la **révocabilité n'est jamais stockée** ; elle se calcule `revocable = source != 'paid'`.
- **Rétention** : les entitlements expirés/révoqués sont **conservés** (historique, réactivation, audit), jamais purgés silencieusement.

### `entitlement_guild_assignments`
- **Objectif** : affecter un serveur bénéficiaire à un entitlement (consomme un emplacement).
- **Champs** : `id`, `entitlement_id` (FK `entitlements`), `guild_id` (snowflake), `assigned_at`, `assigned_by` (user), `state` (`active|suspended`), `last_reassigned_at` (anti-abus), `released_at` (nullable).
- **Contraintes** : un `guild_id` **actif** ne peut être affecté qu'à un entitlement à la fois **[Hypothèse : pas de cumul — doc 13]** ; nombre d'assignments `active` par entitlement ≤ `plans.slots`.
- **Index** : `(entitlement_id, state)`, unique partiel `(guild_id) WHERE state='active'`.
- **Source de vérité** : cette table (choix utilisateur).
- **Règle d'intégrité** : un downgrade met les assignments excédentaires en `state='suspended'` **sans supprimer** la config de la guilde ([doc 06](./06-subscriptions-and-entitlements.md)).
- **Rétention** : historisé (permet réactivation).

### `developer_grants`
- **Objectif** : métadonnées d'un accès accordé manuellement (origine des entitlements `source='granted'`). Les autres accès offerts ont leur propre table d'origine (`trials`, `promotions`/`promotion_redemptions`, `partners` ci-dessous).
- **Champs** : `id`, `entitlement_id` (FK), `granted_by` (operator), `reason` (**obligatoire**), `internal_note`, `duration_kind` (`7d|30d|3m|6m|1y|custom|lifetime`), `created_at`, `revoked_by` (nullable), `revoked_at`, `revoke_reason`.
- **Contraintes** : `reason` NOT NULL ; `duration_kind='lifetime'` ⇒ audit + permission `grant_lifetime` (vérifié en amont, [doc 09](./09-security-model.md)).
- **Index** : `(entitlement_id)`, `(granted_by)`.
- **Source de vérité** : Studio.
- **Sensibilité** : `internal_note` = interne, **jamais** exposée au client. **Rétention** : permanent (audit).

> **Note sur `origin_ref`** : le champ `entitlements.origin_ref` pointe vers la **table d'origine correspondant à `source`** (`billing_subscriptions` pour `paid`, `developer_grants` pour `granted`, `partners` pour `partner`, `trials` pour `trial`, `promotion_redemptions` pour `promotion`). C'est un FK **logique** discriminé par `source` (D1/SQLite ne contraint pas les FK polymorphes ; la cohérence est **applicative**, [doc 09](./09-security-model.md)).

### `trials`
- **Objectif** : métadonnées d'un essai gratuit (origine des entitlements `source='trial'`). Un essai est un accès **court, non payant, auto-expirant**, distinct d'un grant (pas d'action opérateur nécessaire).
- **Champs** : `id`, `entitlement_id` (FK `entitlements`), `user_id` (snowflake), `plan_id` (FK `plans`), `trigger` (`signup|manual|campaign`), `started_at`, `ends_at`, `converted` (bool : a débouché sur un `paid`), `converted_at` (nullable).
- **Contraintes** : **un seul essai par utilisateur et par plan** (anti-abus : évite le ré-essai en boucle) → unique (`user_id`, `plan_id`). `ends_at` requis (jamais lifetime). `entitlements.is_lifetime=0`.
- **Index** : `(user_id)`, `(ends_at)` (balayage d'expiration par cron).
- **Source de vérité** : **système** (création automatique) ou Studio (essai manuel = `trigger='manual'`).
- **Révocabilité** : accès offert → révocable (n'est **jamais** un `paid`).
- **Sensibilité / rétention** : non sensible ; conservé (mesure de conversion, anti-abus).
- **Événements métier** : `trial.started`, `trial.expired`, `trial.converted` (émis en `subscription_events`).

### `promotions`
- **Objectif** : définition d'une **campagne promotionnelle** (le référentiel de la promo, pas l'octroi individuel).
- **Champs** : `id`, `code` (nullable si promo sans code), `plan_id` (FK `plans`), `duration_kind` (`7d|30d|3m|6m|1y|custom`), `duration_days` (si `custom`), `max_redemptions` (nullable = illimité), `redeemed_count`, `starts_at`, `ends_at`, `status` (`active|paused|expired`), `created_by` (operator), `created_at`.
- **Contraintes** : `code` unique si non nul ; `redeemed_count ≤ max_redemptions` (si borné) ; pas de lifetime via promo.
- **Index** : `(code)`, `(status, ends_at)`.
- **Source de vérité** : **Studio** (`features.manage` / permission promo — [doc 13](./13-open-decisions.md)).
- **Sensibilité / rétention** : non sensible ; conservé (bilan de campagne).
- **Événements métier** : `promotion.created`, `promotion.redeemed`, `promotion.exhausted`, `promotion.expired`.

### `promotion_redemptions`
- **Objectif** : trace de l'**utilisation individuelle** d'une promotion (origine des entitlements `source='promotion'`).
- **Champs** : `id`, `promotion_id` (FK `promotions`), `entitlement_id` (FK `entitlements`), `user_id` (snowflake), `redeemed_at`.
- **Contraintes** : **une redemption par utilisateur et par promotion** → unique (`promotion_id`, `user_id`) (anti-abus).
- **Index** : `(promotion_id)`, `(user_id)`.
- **Source de vérité** : cette table (dérivée de l'application d'un code / d'une campagne).
- **Révocabilité** : accès offert → révocable.

### `partners`
- **Objectif** : accords de **partenariat** accordant un plan (origine des entitlements `source='partner'`). Métadonnées relationnelles distinctes d'un grant ponctuel.
- **Champs** : `id`, `entitlement_id` (FK `entitlements`, nullable tant que l'accord n'a pas produit d'accès), `user_id` (snowflake du bénéficiaire), `partner_name`, `plan_id` (FK `plans`), `terms` (résumé des conditions), `contact` (nullable, **PII → restreint**), `granted_by` (operator), `status` (`active|ended`), `starts_at`, `ends_at` (nullable si accord ouvert), `internal_note`, `created_at`.
- **Contraintes** : `granted_by` requis ; un partenariat peut être lifetime-like via `ends_at IS NULL` **mais** reste **révocable** (contrairement au `paid`) ; création via Studio uniquement.
- **Index** : `(user_id)`, `(status, ends_at)`.
- **Source de vérité** : **Studio** (`subscriptions.grant` / permission partenariat).
- **Sensibilité** : `contact`, `internal_note` = internes/PII → **jamais** exposés au client. **Rétention** : permanent (traçabilité relationnelle).
- **Révocabilité** : accès offert → révocable (jamais un `paid`).

> **Cohérence trials / promotions / partners** : ces trois origines partagent la même règle que `granted` — ce sont des **accès offerts**, donc **révocables**, jamais des `paid`. Elles se distinguent par leur *cycle de création* (système pour `trial`, campagne pour `promotion`, accord relationnel pour `partner`, geste opérateur pour `granted`) et leurs *garde-fous* (unicité anti-abus pour `trial`/`promotion`). Le **plan effectif** et les **emplacements** se résolvent de façon identique quelle que soit l'origine ([doc 06](./06-subscriptions-and-entitlements.md) §résolution).

### `subscription_events`
- **Objectif** : journal des transitions d'entitlement/subscription (création, renouvellement, échec, annulation, expiration, révocation, suspension).
- **Champs** : `id`, `entitlement_id` (nullable), `billing_subscription_id` (nullable), `type`, `from_status`, `to_status`, `actor` (`system|webhook|operator:<id>`), `payload_json` (contexte, **secrets masqués**), `created_at`.
- **Contraintes** : append-only (pas d'UPDATE/DELETE applicatif).
- **Index** : `(entitlement_id, created_at)`, `(type, created_at)`.
- **Source de vérité** : cette table (dérivée des transitions).
- **Rétention** : long terme (analyse, litiges).

## Support

### `support_tickets`
- **Objectif** : tickets clients priorisés par plan.
- **Champs** : `id`, `user_id`, `guild_id` (nullable), `plan_at_open` (`free|premium|business`), `priority` (dérivée du plan à l'ouverture), `subject`, `status` (`open|pending|resolved|closed`), `assignee` (operator, nullable), `created_at`, `updated_at`, `plan_changed_since_open` (bool).
- **Contraintes** : `priority` figée à l'ouverture (ne rétrograde pas si le plan est perdu — [doc 06](./06-subscriptions-and-entitlements.md)).
- **Index** : `(status, priority, created_at)` (file d'attente), `(user_id)`, `(assignee, status)`.
- **Source de vérité** : cette table. Réutilise l'esprit du moteur tickets existant (`docs/team-tickets.md`), avec vue cross-guilde **réservée au Studio**.
- **Sensibilité** : contenu utilisateur → accès `support.manage`. **Rétention** : selon politique (**[doc 13]**).

### `support_messages`
- **Objectif** : messages d'un ticket.
- **Champs** : `id`, `ticket_id` (FK), `author` (`user|operator:<id>`), `body`, `created_at`, `internal` (bool : note interne non visible du client).
- **Contraintes** : FK `ticket_id`.
- **Index** : `(ticket_id, created_at)`.
- **Sensibilité** : `internal=1` **jamais** renvoyé au client.

## Communication

### `release_notes`
- **Objectif** : notes de mise à jour (brouillon → publiées), page publique `archodev.fr/updates`.
- **Champs** : `id`, `version`, `title`, `summary`, `body_md`, `sections_json` (nouveautés/améliorations/corrections/sécurité), `media_json`, `module_tags_json`, `audience` (`all|plan:<id>`), `status` (`draft|scheduled|published|archived`), `publish_at`, `published_at`, `author` (operator), `created_at`, `updated_at`.
- **Contraintes** : `status='scheduled'` ⇒ `publish_at` requis.
- **Index** : `(status, publish_at)`, `(published_at)`.
- **Source de vérité** : Studio (`updates.publish`).
- **Rétention** : permanent (historique produit).

## Sécurité / opérations

### `audit_events`
- **Objectif** : journal **immuable** de toute mutation sensible (grants, révocations, remboursements, suspensions, flags, publications, changements de permissions, actions studio).
- **Champs** : `id`, `actor` (`operator:<id>` ou `system`), `action` (ex. `subscriptions.grant_lifetime`), `target_type`, `target_id`, `metadata_json` (**secrets/PII masqués**), `ip_hash`, `created_at`.
- **Contraintes** : **append-only** ; aucune route d'UPDATE/DELETE.
- **Index** : `(actor, created_at)`, `(action, created_at)`, `(target_type, target_id)`.
- **Source de vérité** : cette table. Étend le modèle `admin_audit_log`/`admin_audit_log_v2` existant vers un audit **studio** dédié.
- **Rétention** : longue durée (conformité). Voir [doc 09](./09-security-model.md).

### `studio_operators` & `studio_operator_permissions` (dev-auth)
- **Objectif** : allowlist des développeurs et leurs permissions granulaires ([doc 09](./09-security-model.md)).
- **`studio_operators`** : `user_id` (snowflake, PK), `display_name`, `status` (`active|disabled`), `added_by`, `created_at`.
- **`studio_operator_permissions`** : `user_id` (FK), `permission` (`subscriptions.read|grant|grant_lifetime|revoke_granted|cancel_paid|refund_paid|support.manage|guilds.inspect|features.manage|updates.publish|deployments.read|deployments.manage|audit.read`), `granted_by`, `created_at`. PK (`user_id`, `permission`).
- **Contraintes** : seul un opérateur `active` peut agir ; permissions vérifiées **serveur**.
- **Source de vérité** : cette table (gérée depuis `/settings` studio par un admin studio).
- **Sensibilité** : critique. **Rétention** : permanent + audité.

## Intégrité globale & cohérence inter-tables

- **Invariant 1** : `entitlements.source='paid'` ⇔ un `billing_subscriptions` non-expiré le référence ; aucune création `paid` hors webhook.
- **Invariant 2** : `revocable = (source != 'paid')` — calculé, jamais stocké comme vérité.
- **Invariant 3** : Σ assignments `active` d'un entitlement ≤ `plans.slots` du plan effectif.
- **Invariant 4** : un downgrade → assignments excédentaires `suspended`, **jamais** de suppression de config guilde.
- **Invariant 5** : toute transition sensible ⇒ 1 `subscription_events` **et** (si opérateur) 1 `audit_events`.
- **Invariant 6** : lifetime ⇒ `developer_grants.duration_kind='lifetime'` + permission + saisie `LIFETIME` + audit. **Seul `granted` peut être lifetime** ; `trial`/`promotion` ont toujours un `end_at`.
- **Invariant 7** : `entitlements.origin_ref` référence la table d'origine cohérente avec `source` (`paid→billing_subscriptions`, `granted→developer_grants`, `partner→partners`, `trial→trials`, `promotion→promotion_redemptions`) ; incohérence = rejet applicatif.
- **Invariant 8** : anti-abus d'unicité — au plus **un `trial` par (user, plan)** et **une redemption par (promotion, user)**.
- **Invariant 9** : la **priorité entre entitlements actifs** est purement dérivée (rang de plan, lifetime, portée, priorité d'origine, ancienneté — [doc 06](./06-subscriptions-and-entitlements.md)) ; aucune colonne « priorité » n'est stockée comme vérité.

## Données sensibles & rétention (synthèse)

| Donnée | Sensibilité | Rétention |
|--------|-------------|-----------|
| `billing_customers.email` | PII | Relation active + obligations compta **[doc 13]** |
| `developer_grants.internal_note`, `support_messages.internal` | Interne (jamais client) | Permanent |
| `audit_events`, `subscription_events` | Traçabilité | Longue durée |
| `entitlements` expirés/révoqués | Historique | Conservés (pas de purge) |
| `support_tickets`/`messages` | Contenu utilisateur | Politique support **[doc 13]** |

> Les purges éventuelles s'appuieraient sur le cron de rétention existant (`23 4 * * *`, `packages/worker/src/cron.ts`), **jamais** sur une suppression manuelle non auditée.
