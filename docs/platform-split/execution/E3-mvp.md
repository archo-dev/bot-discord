# E3 — MVP (borne minimale de lancement)

> Voir aussi : [milestones](./E4-milestones.md) · [client](../03-client-platform.md) · [studio](../04-developer-studio.md) · [dépendances](./E5-dependencies-critical-path.md)

Objectif : définir un **MVP strictement borné** qui **n'inclut pas** tout le plan final. Le MVP doit permettre de : **présenter le produit, expliquer les offres, connecter Discord, gérer les serveurs, afficher les limitations, introduire les entitlements, préparer le billing, publier des notes de mise à jour, sécuriser le futur Studio.**

**Principe** : le MVP prouve la **chaîne de valeur complète** (découverte → connexion → gestion → limitation → droit d'accès) **sans** encaisser de paiement réel. Le paiement réel arrive **juste après** (M9/M10/M16), une fois le socle validé.

## Critère de « fini » du MVP

Un visiteur peut comprendre et choisir une offre ; un utilisateur peut connecter Discord, gérer ses serveurs, **voir** ce que débloque un plan supérieur ; l'exploitant peut **accorder** un accès gratuit, le **révoquer**, **voir l'audit** et **publier** une note — le tout **sans** flux de paiement en production.

---

## 1. MVP public (`archodev.fr`, non connecté)

**Inclus :**
- **Landing** `/` : hero orienté résultats, aperçu des 3 offres, 3 dernières mises à jour, CTA « Commencer gratuitement » / « Se connecter » ([doc 03](../03-client-platform.md), [doc 05](../05-plans-and-commercial-strategy.md)).
- **Pricing** `/pricing` : comparatif Gratuit/Premium/Business **sans prix définitif** (placeholder « à venir » / tarif de lancement une fois D1 tranché), FAQ d'objections.
- **Features** `/features` : bénéfices par thème.
- **Updates** `/updates` (+ `/updates/:slug`) : notes publiées (lecture seule).
- **Statut** `/status` : minimal (Worker/Gateway up/down via heartbeat+health).
- **Légal** `/legal/mentions`, `/legal/privacy` (les CGV `/legal/sales` seulement quand le paiement arrive — M16).
- **Login** `/login` → OAuth Discord ; **Invite** `/invite`.
- Couche de **routes publiques** distincte de l'app connectée (remplace la gate implicite `["me"]` — [doc 01](../01-current-state-audit.md)).

**Exclus du MVP public :** docs riches/wiki, blog, témoignages produits, `status.`/`docs.` en sous-domaines (D14/D15), i18n.

---

## 2. MVP client connecté (`/app`)

**Inclus :**
- **Dashboard** `/app` : liste des serveurs gérés, **badge de plan** (Gratuit par défaut), **compteur d'emplacements** (1/1 en Gratuit).
- **Serveurs** `/app/servers` + `/app/servers/:id` : réutilise les pages panel existantes (welcome, automod, levels, tickets, music, roles, etc. — [doc 03](../03-client-platform.md)).
- **Affichage des limitations** : composant `LockedFeature` (aperçu + badge « Premium » + CTA doux) sur les fonctions hors plan ; **verrouillage cosmétique doublé d'une garde backend** ([doc 09](../09-security-model.md)).
- **Abonnement** `/app/subscription` : plan effectif, emplacements utilisés/disponibles, **état** — en MVP, le changement de plan mène à un écran « Bientôt disponible » ou à un **grant** (pas de paiement).
- **Compte** `/app/account` : profil Discord, sessions, déconnexion.
- **Entitlements introduits (backend)** : résolution du plan effectif active **derrière feature flag**, défaut **Gratuit** pour tous (aucune régression).

**Exclus du MVP client :** paiement réel, portail facturation, factures, sélecteur de serveur persistant avancé, support client complet (formulaire de contact simple accepté), réaffectation de slots avec cooldown (peut arriver juste après en M7).

---

## 3. MVP Studio (`studio.archodev.fr`, privé)

**Inclus (strict minimum) :**
- **Auth studio** : Worker séparé, cookie `studio_session`, **allowlist** (propriétaire seul), `requireDeveloper(permission)` ([doc 09](../09-security-model.md)).
- **Voir les abonnements** `/subscriptions` : liste unifiée (payés en lecture — vide au MVP —, accordés) avec plan, origine, état (`subscriptions.read`).
- **Accorder un accès gratuit** `/subscriptions/granted` : formulaire (user, plan, durée, **raison obligatoire**, note interne, affectation) → crée un `entitlement(source='granted')` (`subscriptions.grant`).
- **Révoquer uniquement un accès offert** : bouton « Révoquer » **présent seulement** sur les accès offerts ; **jamais** sur un payé (`subscriptions.revoke_granted`).
- **Voir l'audit** `/audit` : journal immuable des grants/révocations (`audit.read`).
- **Publier une note de mise à jour** `/updates` : brouillon → publier vers `archodev.fr/updates` (`updates.publish`).

**Exclus du MVP Studio :** métriques/erreurs avancées, déploiements déclenchables (consultation seule plus tard — D26), lifetime (M13), workflows de remboursement/annulation payés (arrivent avec le billing), gestion d'équipe multi-opérateurs (propriétaire seul suffit), step-up/MFA renforcés (cible M14).

---

## 4. Hors MVP (explicitement reporté)

| Fonction | Reporté à | Raison |
|----------|-----------|--------|
| Paiement réel (checkout, CB) | M9/M10/M16 | Nécessite D3 (prestataire) + D1 (prix) |
| Portail facturation / factures | M9+ | Dépend du prestataire |
| Webhooks paiement | M10 | Dépend de M9 |
| Essai gratuit automatisé (`trials`) | Post-MVP | D4 ; grants manuels suffisent d'abord |
| Promotions / codes | Post-MVP | D—, non critique au lancement |
| Lifetime | M13 | Garde-fous renforcés (D10) |
| Workflows payés (annuler/rembourser/suspendre) | M9+/M14 | Dépendent du billing |
| Support client complet + priorisation fine | M11 | Formulaire simple accepté au MVP |
| Réaffectation slots + cooldown | M7 | Peut suivre juste après |
| Studio : métriques/erreurs/déploiements | Post-MVP Studio | Observabilité = M15 |
| Gestion d'équipe Studio (multi-opérateurs, rôles) | Post-MVP | Propriétaire seul au lancement |
| Step-up / MFA / double validation | M14 (cible) | Renforcement, non bloquant |
| Domaines `status.` / `docs.` | Après M16 | D14/D15 |
| Renommage `panel`→`client-web` | Optionnel/jamais | D28 |
| i18n | Non planifié | Dette assumée ([doc 01](../01-current-state-audit.md)) |

---

## Ce que le MVP prouve (et ne prouve pas)

- **Prouve** : la marque et les offres se présentent ; Discord se connecte ; les serveurs se gèrent ; les limites sont **visibles et appliquées backend** ; un droit d'accès (entitlement) peut être **accordé, résolu, révoqué, audité** ; une note se publie ; le Studio est **isolé et sécurisé**.
- **Ne prouve pas encore** : l'encaissement réel, la conformité fiscale, le portail client — **volontairement**, car ces briques dépendent de décisions (D1/D3/D12/D20/D21) et se branchent **après** sur un socle déjà validé, **sans réécriture** (modèle billing découplé — [doc 07](../07-billing-provider-analysis.md)).

## Correspondance MVP ↔ milestones

- MVP public → **M1, M2, M3, M4, M5**.
- MVP client → **M6 (flag), M7 (partiel), M8**.
- MVP Studio → **M12 (socle), M13 (grants sans lifetime), audit de M14 (partiel)**.
- Le paiement réel (M9, M10, M16) est **hors MVP** mais **immédiatement enchaînable**.
