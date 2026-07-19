# 07 — Analyse des prestataires de paiement

> Voir aussi : [abonnements](./06-subscriptions-and-entitlements.md) · [modèle de données](./08-data-model.md) · [décisions ouvertes](./13-open-decisions.md)

> ⚠️ **Aucun prestataire n'est choisi définitivement ici.** Ce document compare Stripe, Lemon Squeezy et Paddle et donne une **recommandation conditionnelle**. Le choix final est une décision ouverte ([doc 13](./13-open-decisions.md)).

## Critère structurant : le « Merchant of Record » (MoR)

La distinction la plus importante pour un éditeur solo/petite équipe vendant à l'international :

- **MoR (Paddle, Lemon Squeezy)** : le prestataire est le **vendeur officiel**. Il gère la **TVA/taxes mondiales**, la facturation conforme, la fraude et les litiges. Simplicité fiscale maximale, au prix de frais plus élevés et de moins de contrôle.
- **Non-MoR (Stripe)** : **vous** êtes le vendeur. Stripe fournit l'infrastructure (dont Stripe Tax en option), mais la **responsabilité fiscale/déclarative reste la vôtre**. Contrôle et coûts plus bas, charge de conformité plus élevée.

Pour un produit vendu potentiellement dans toute l'UE et au-delà, ce critère pèse plus que quelques dixièmes de pourcent de frais.

## Tableau comparatif

| Critère | **Stripe** | **Lemon Squeezy** | **Paddle** |
|---------|-----------|-------------------|-----------|
| Modèle | Infrastructure (non-MoR) | **MoR** | **MoR** |
| Abonnements mensuel/annuel | Excellent | Oui | Oui |
| TVA / taxes | À votre charge (Stripe Tax en option) | **Gérée (MoR)** | **Gérée (MoR)** |
| Facturation conforme UE | Via Stripe Invoicing/Tax | Incluse | Incluse |
| Webhooks | Très riches, matures | Oui | Oui |
| Portail client | Customer Portal (hosted) | Oui | Oui |
| Remboursements | API complète | Oui (via MoR) | Oui (via MoR) |
| Chargebacks | À votre charge (outils Radar) | **Absorbés par le MoR** | **Absorbés par le MoR** |
| Coûts | ~1,5 % EU + fixe (le plus bas) ; Tax en sus | ~5 % + fixe (tout compris) | ~5 % + fixe (tout compris) |
| Intégration | La plus documentée, SDK partout | Simple, orientée indie/SaaS | Solide, orientée SaaS/logiciel |
| Compat Cloudflare Workers | **Excellente** (API REST + webhooks HTTP, pas de dépendance Node lourde) | Bonne (REST + webhooks) | Bonne (REST + webhooks) |
| Dépendance / lock-in | Faible (standard de facto, portable) | Moyenne (MoR : migration = re-souscription) | Moyenne (MoR : idem) |
| Sécurité | Signature webhooks (HMAC), PCI géré | Signature webhooks | Signature webhooks |
| Migration future | La plus aisée (écosystème large) | Sortie MoR = friction | Sortie MoR = friction |

> Les pourcentages sont des **ordres de grandeur indicatifs** ([Hypothèse]) ; les grilles évoluent et dépendent du pays/volume. À **vérifier au moment de la décision** ([doc 13](./13-open-decisions.md)).

## Compatibilité avec l'architecture actuelle (Cloudflare Workers)

Points clés au vu de l'audit ([doc 01](./01-current-state-audit.md)) :

- Le Worker est **HTTP-first** (Hono) et gère déjà des **webhooks signés** (`/interactions` en Ed25519, `/internal/*` en HMAC avec anti-rejeu par nonce D1). Ajouter un webhook `/webhooks/<provider>` avec **vérification de signature** est un pattern **déjà maîtrisé** dans le dépôt.
- Aucun des trois prestataires n'impose de SDK Node incompatible Workers : tous exposent une **API REST** et des **webhooks HTTP**. On appelle l'API via `fetch` et on vérifie les signatures avec Web Crypto (déjà utilisé pour l'HMAC interne).
- **Recommandation d'intégration** (indépendante du prestataire) :
  1. Le **checkout** est **hosted** (page du prestataire) → aucune donnée carte ne transite par le Worker (PCI minimal).
  2. Le **webhook** signé crée/actualise l'entitlement `paid` **côté backend uniquement** (source de vérité = prestataire ; le Worker ne crée jamais un `paid` sans webhook confirmé — cf. [doc 06](./06-subscriptions-and-entitlements.md)).
  3. Le **portail client** (gestion CB, factures, annulation) est **hosted** et lié depuis `/app/billing`.
  4. **Idempotence** des webhooks via une table de nonces/événements (réutiliser le pattern `internal_request_nonces` / `processed_events`).

## Découplage / anti-lock-in

Pour limiter la dépendance, le modèle de données isole le prestataire ([doc 08](./08-data-model.md)) :

- `billing_customers` (map user Discord ↔ id client prestataire) et `billing_subscriptions` (référence prestataire, plan, dates, statut) sont **séparés** des `entitlements`.
- L'**entitlement** (droit d'accès) est l'abstraction stable : changer de prestataire = réécrire l'adaptateur webhook + remapper `billing_*`, **sans toucher** à la logique d'entitlements/emplacements.
- Un champ `provider` (`stripe|lemonsqueezy|paddle`) permet même une **cohabitation** transitoire lors d'une migration.

## Recommandation conditionnelle

- **Si la priorité est la simplicité fiscale (TVA/facturation UE gérée, chargebacks absorbés) et le time-to-market** → un **MoR** : **Lemon Squeezy** (le plus simple pour un SaaS indie) ou **Paddle** (plus orienté logiciel/entreprise). Frais plus élevés, mais **charge de conformité quasi nulle**.
- **Si la priorité est le coût, le contrôle et la portabilité long terme**, et que vous acceptez d'assumer la TVA (via Stripe Tax + obligations déclaratives) → **Stripe**. Meilleure compat Workers, écosystème le plus large, lock-in le plus faible.

**Orientation par défaut [Hypothèse, à valider en doc 13]** : pour un lancement rapide avec une petite structure, un **MoR (Lemon Squeezy)** réduit fortement le risque fiscal et opérationnel ; **Stripe** devient préférable si le volume grandit et qu'une comptabilité TVA est mise en place. Le modèle de données étant découplé, **commencer MoR puis migrer vers Stripe** reste possible.

## Conséquences techniques (quel que soit le choix)

- Nouvelle route `/webhooks/<provider>` (vérif signature, idempotence, jamais de session).
- Nouvelles queries `src/db/queries/billing.ts` (Worker = seul écrivain D1).
- Nouveaux DTO `@bot/shared/api-types/billing.ts`.
- Pages client `/app/billing` (+ lien portail hosted) et `/app/subscription` ([doc 03](./03-client-platform.md)).
- Surface Studio `/subscriptions/paid` en **consultation + workflows dédiés** (annulation/remboursement/suspension) ([doc 04](./04-developer-studio.md)).
- Secrets Worker : clé API prestataire + secret de signature webhook (via `wrangler secret bulk`, jamais `Write-Output | wrangler secret put` — piège CRLF connu du projet).
- CGV (`/legal/sales`) et mentions fiscales requises ([doc 03](./03-client-platform.md)).

## Séparation décision produit / technique / juridique

- **Produit/décision** : choix du prestataire, mensuel vs annuel, essais.
- **Technique** : webhook signé idempotent, adaptateur découplé, secrets.
- **Juridique** : TVA, CGV, facturation — fortement simplifié par un MoR.
