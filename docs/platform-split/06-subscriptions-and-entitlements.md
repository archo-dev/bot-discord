# 06 — Abonnements & droits d'accès (entitlements)

> Voir aussi : [modèle de données](./08-data-model.md) · [offres](./05-plans-and-commercial-strategy.md) · [paiement](./07-billing-provider-analysis.md) · [studio](./04-developer-studio.md)

Ce document définit la **logique métier** des droits d'accès. Principe fondateur : **séparer strictement l'accès au produit (entitlement) et le paiement (billing)**. Toutes les règles sont appliquées **côté backend** (Worker), jamais seulement dans l'UI.

## Concepts

- **Plan** : niveau d'offre (`free`, `premium`, `business`) avec ses limites et son nombre d'emplacements (1/3/5).
- **Entitlement** : un **droit d'accès** actif d'un utilisateur à un plan, avec une **origine** et une fenêtre de validité. Un utilisateur peut cumuler plusieurs entitlements.
- **Origine** (`source`) : `paid` · `granted` · `trial` · `promotion` · `partner`. **L'origine détermine la révocabilité** (voir §Révocation).
- **Abonnement de paiement (billing subscription)** : objet côté prestataire (Stripe/…), lié à un entitlement d'origine `paid`. Créé **uniquement** après confirmation du prestataire.
- **Emplacement de serveur (slot)** : capacité d'affecter un serveur bénéficiaire. Le nombre de slots dérive du **meilleur plan actif**.
- **Affectation (assignment)** : lien entitlement ↔ guilde qui consomme un emplacement.

> ⚠️ **Ne pas confondre** avec `CapabilityEntitlement` de `packages/shared/src/modules.ts` (RBAC de gouvernance de modules). Ici, « entitlement » = droit d'**abonnement**. Concept distinct, table distincte ([doc 08](./08-data-model.md)).

## Propriété & rattachement

- L'abonnement/entitlement **appartient à un utilisateur Discord** (pas à une guilde).
- L'utilisateur **choisit les serveurs bénéficiaires** dans la limite de ses emplacements.
- Le plan **effectif d'une guilde** = plan de l'entitlement qui lui est affecté (ou `free` si aucune affectation).

## Types d'entitlements (origines)

| Origine | Créé par | Révocable via Studio ? | Notes |
|---------|----------|------------------------|-------|
| `paid` | Confirmation prestataire de paiement (webhook) | **Non** (pas de « Révoquer » simple) — workflows dédiés uniquement | Annulation de renouvellement, remboursement, suspension fraude → procédures séparées auditées |
| `granted` | Développeur via Studio | **Oui** (`subscriptions.revoke_granted`) | Raison obligatoire, note interne, durée paramétrable, lifetime possible |
| `trial` | Système (essai) ou grant | Oui (accès offert) | Fenêtre courte, non payant |
| `promotion` | Campagne/code | Oui (accès offert) | Conditions de campagne |
| `partner` | Développeur via Studio | Oui (accès offert) | Partenariats |

**Règle backend impérative** : un entitlement d'origine `paid` **ne peut pas** être supprimé/révoqué par le mécanisme des accès offerts. La révocabilité **dérive de l'origine**, jamais d'un champ `revocable` libre (cf. [doc 08](./08-data-model.md)). Un champ `revocable` stocké ne serait qu'un cache dérivé, **jamais** la source de vérité.

## Abonnement payé — règles

- Créé **uniquement** après confirmation du prestataire (webhook signé, [doc 07](./07-billing-provider-analysis.md)).
- Le Studio peut : le **consulter** (plan, propriétaire, dates, fournisseur, références) ; **annuler le renouvellement** (workflow dédié → `cancel_paid`) ; lancer un **remboursement** (procédure séparée → `refund_paid`) ; **suspendre exceptionnellement** pour fraude/sécurité (audit renforcé).
- Le Studio ne propose **jamais** un simple bouton « Révoquer » pour un abonnement payé ([doc 04](./04-developer-studio.md)).
- Cycle de vie piloté par les webhooks du prestataire (création, renouvellement, échec de paiement → `past_due`, annulation → `cancelled`, fin → `expired`).

## Abonnement accordé manuellement — règles

Formulaire Studio (`/subscriptions/granted`) :
- **utilisateur Discord** (obligatoire) ;
- **plan** (`premium` / `business`) ;
- **durée** : 7 jours · 30 jours · 3 mois · 6 mois · 1 an · **date personnalisée** · **lifetime** ;
- **date de début** ;
- **date de fin** (ou lifetime) ;
- **raison obligatoire** ;
- **note interne** ;
- **affectation** : soit directe à des serveurs, soit attribution d'emplacements à l'utilisateur (il choisit ensuite).

Un accès accordé est **révocable** (`subscriptions.revoke_granted`). Révoquer un accès offert **ne supprime jamais** l'accès payé sous-jacent (cf. §Cumul).

### Lifetime — garde-fous

Un accès lifetime exige :
- une **permission développeur distincte** (`subscriptions.grant_lifetime`) ;
- une **confirmation renforcée** ;
- une **raison obligatoire** ;
- une **saisie explicite** `LIFETIME` (anti-erreur) ;
- une **trace d'audit complète**.

## Cumul des accès (plusieurs droits actifs simultanément)

Un utilisateur peut avoir plusieurs entitlements actifs (ex. **Premium payé** + **Business offert 30 jours**). Règles :

- Le **plan effectif** de l'utilisateur = le **meilleur** entitlement actif (Business > Premium > Free).
- Pendant la fenêtre de l'accès offert Business, l'utilisateur bénéficie de Business (plus d'emplacements, plus de fonctions).
- À **expiration/révocation** du Business offert, l'utilisateur **revient automatiquement** à son Premium payé (sans action manuelle, sans re-paiement).
- **Révoquer l'accès offert ne supprime jamais l'accès payé sous-jacent.**

### Algorithme de résolution du meilleur entitlement actif

```
resolveEffectiveEntitlement(userId, now):
  actifs = entitlements(userId) filtrés par:
      status == active
      AND start_at <= now
      AND (lifetime OR end_at > now)
      AND not suspended
  si actifs vide -> retourner PLAN_FREE (implicite, aucun stockage requis)

  # Classement: rang de plan d'abord, puis critères de départage stables
  meilleur = argmax(actifs) selon la clé de tri:
      (rank(plan),               # business=3, premium=2, free=1
       lifetime ? 1 : 0,         # lifetime prioritaire à plan égal
       end_at ?? +inf,           # sinon la plus longue portée
       source_priority(source),  # départage déterministe: paid > granted > partner > promotion > trial
       created_at)               # dernier recours: le plus récent
  retourner meilleur
```

- **Emplacements effectifs** = `slots(meilleur.plan)` (1/3/5).
- **[Hypothèse à trancher — doc 13]** : les emplacements se **cumulent-ils** entre entitlements de même niveau ? Recommandation par défaut : **non** — les emplacements dérivent du **meilleur** plan, ils ne s'additionnent pas (modèle plus simple, anti-abus). À valider.
- La résolution est **pure et déterministe** (mêmes entrées → même sortie), testable unitairement ([doc 12](./12-testing-and-release-strategy.md)).
- Le résultat est **recalculé côté backend** à chaque requête sensible ; un éventuel cache (KV) est invalidé sur tout événement d'entitlement (création/expiration/révocation/webhook).

## Emplacements de serveurs

### Affectation d'un emplacement
- L'utilisateur affecte un serveur (qu'il administre) à un emplacement libre → l'affectation consomme un slot et applique le plan effectif à la guilde.

### Changement de serveur (réaffectation)
- L'utilisateur peut libérer un slot et l'affecter à un autre serveur.
- **Protection anti-abus** : cooldown de réaffectation par slot **[Hypothèse : ex. 24–72 h — à trancher doc 13]** pour éviter le partage tournant d'un abonnement entre de nombreux serveurs.

### Retrait d'un serveur
- Retirer un serveur libère son emplacement. La **configuration du serveur n'est jamais supprimée** ; le serveur repasse au plan `free` (les fonctions hors-plan sont **désactivées**, pas effacées).

### Dépassement après downgrade (Business → Premium, 5 → 3)
1. Le système détecte plus de serveurs affectés (5) que d'emplacements du nouveau plan (3).
2. L'utilisateur doit **choisir les serveurs à conserver** (3).
3. Les serveurs excédentaires passent en état **`suspended`** (config **conservée**, fonctions hors-plan désactivées).
4. **Aucune suppression silencieuse** de configuration.
5. Si l'utilisateur re-upgrade plus tard, les serveurs suspendus peuvent être **réactivés** (config intacte).
6. **[Hypothèse — doc 13]** : si l'utilisateur ne choisit pas dans un délai, appliquer une règle par défaut déterministe (ex. conserver les N plus récemment actifs) — à valider ; par défaut on **bloque** l'application des nouvelles limites jusqu'au choix, en gardant tout suspendu.

### État suspendu (serveur)
- `suspended` = le serveur dépasse la capacité du plan : bot présent, config préservée, fonctions hors-plan `free` désactivées, bandeau explicatif dans le panel avec CTA « Réactiver via Premium/Business ou libérer un emplacement ».

## Machine d'états d'un entitlement

États : `active` · `expired` · `revoked` · `cancelled` · `suspended` · `past_due`.

```
                 (création: paid via webhook / granted via studio)
                                   │
                                   ▼
        ┌───────────────────────► active ───────────────────────┐
        │                       │  │  │  │                        │
   (renouvellement OK)          │  │  │  └─(fin de période / end_at atteint)─► expired
        │                       │  │  └────(échec paiement)──────► past_due
        │                       │  └───────(annulation renouvel.)─► cancelled ─(fin période)─► expired
   past_due ──(paiement OK)─────┘  └───────(suspension fraude/sécurité, ou serveur excédentaire)─► suspended
        │                                                          │
   (échec définitif)                                    (levée de suspension) ─► active
        ▼
     expired

   granted/trial/promotion/partner ──(revoke_granted)──► revoked   (paid: JAMAIS via ce chemin)
```

Notes :
- `past_due` : entitlement `paid` dont le paiement a échoué ; grâce temporaire selon prestataire, puis `expired` si non résolu.
- `cancelled` : renouvellement annulé mais accès conservé jusqu'à `end_at`, puis `expired`.
- `suspended` : fraude/sécurité (au niveau entitlement) **ou** serveur excédentaire (au niveau affectation). Les deux sont réversibles.
- `revoked` : uniquement pour accès offerts ; **interdit pour `paid`** (contrainte backend).
- Toute transition sensible émet un **`subscription_event`** et une **entrée d'audit** ([doc 08](./08-data-model.md)).

## Support & perte de plan

Chaque ticket capture à l'ouverture : plan actif, priorité (Business > Premium > Gratuit), serveur concerné, date, ancienneté, état, assignation ([doc 04](./04-developer-studio.md)). Si l'utilisateur **perd son plan pendant qu'un ticket est ouvert** : le ticket **conserve sa priorité d'ouverture** (signalé « plan modifié depuis »), il n'est ni fermé ni déprioritisé automatiquement. Engagements commerciaux (non contractuels, pas de SLA promis) :
- Gratuit : traité selon l'ordre d'arrivée et les disponibilités ;
- Premium : passe avant les demandes Gratuit ;
- Business : priorité maximale.

## Règles métier — récapitulatif (toutes appliquées backend)

1. La **révocabilité dérive de l'origine** ; `paid` n'est jamais révocable par l'action « accès offert ».
2. Le **plan effectif** = meilleur entitlement actif (résolution déterministe).
3. Les **emplacements** dérivent du meilleur plan ; ne s'additionnent pas par défaut ([Hypothèse doc 13]).
4. Le **downgrade** suspend les serveurs excédentaires **sans supprimer** leur config.
5. **Lifetime** exige permission dédiée + `LIFETIME` + audit.
6. Un abonnement **payé** ne passe jamais par le chemin `revoked`.
7. Toute mutation d'entitlement est **auditée** et émet un **événement**.

## Séparation décision produit / technique / sécurité

- **Produit** : origines, durées, périmètre des emplacements, engagements support.
- **Technique** : algorithme de résolution, machine d'états, invalidation de cache, dérivation backend.
- **Sécurité** : contrainte `paid` non révocable, gardes lifetime, audit ([doc 09](./09-security-model.md)).
