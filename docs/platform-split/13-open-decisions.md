# 13 — Décisions ouvertes (arbitrages requis)

> Voir aussi : [offres](./05-plans-and-commercial-strategy.md) · [paiement](./07-billing-provider-analysis.md) · [abonnements](./06-subscriptions-and-entitlements.md) · [roadmap](./11-migration-roadmap.md)

Ce document rassemble **uniquement** les décisions qui nécessitent ton accord. Elles ne sont **pas tranchées** ailleurs dans le dossier : partout où une hypothèse apparaît (`[Hypothèse]`, `[doc 13]`), elle **pointe ici**. Pour chaque décision : **question · options · recommandation · conséquences · urgence**.

**Échelle d'urgence** : 🔴 Bloquant (nécessaire avant de coder la brique) · 🟠 Élevée (avant lancement) · 🟡 Moyenne (avant la phase concernée) · 🟢 Faible (ajustable après).

> ⚠️ **Aucun prix n'est proposé comme définitif ici.** Les recommandations de prix sont des **méthodes**, pas des montants. **Aucun prestataire n'est choisi sans justification** (analyse en [doc 07](./07-billing-provider-analysis.md)).

---

## D1 — Prix des trois plans  · 🔴 Bloquant (lancement)

- **Question** : quels montants pour Premium et Business (Gratuit = 0) ?
- **Options** : positionnement bas / médian / haut face au marché ([doc 05](./05-plans-and-commercial-strategy.md) : DraftBot, MEE6, Dyno Premium).
- **Recommandation** : **ne pas inventer de prix** ; mener une analyse concurrentielle + coût/valeur, puis fixer. Le code est conçu pour recevoir les prix **hors code** (pas de montant en dur — [doc 11](./11-migration-roadmap.md) étape 4/19).
- **Conséquences** : impacte page `/pricing`, marges, positionnement, TVA.
- **Urgence** : 🔴 avant le lancement commercial (étape 19).

## D2 — Périodicité : mensuel et/ou annuel  · 🟠 Élevée

- **Question** : proposer mensuel, annuel, ou les deux (avec remise annuelle) ?
- **Options** : mensuel seul · annuel seul · **les deux** (remise annuelle incitative).
- **Recommandation** : **les deux**, avec remise annuelle (standard SaaS, améliore la rétention et le cash-flow). Le champ `billing_subscriptions.interval` (`month|year`) est déjà prévu ([doc 08](./08-data-model.md)).
- **Conséquences** : UI pricing (bascule mensuel/annuel), calcul proraté, communication.
- **Urgence** : 🟠 avant intégration paiement (étape 8).

## D3 — Prestataire de paiement (Stripe / Lemon Squeezy / Paddle)  · 🔴 Bloquant (paiement)

- **Question** : quel prestataire pour le checkout, la facturation et les webhooks ?
- **Options** : **Stripe** (non-MoR, coût/contrôle) · **Lemon Squeezy** (MoR, simplicité fiscale) · **Paddle** (MoR, orienté logiciel).
- **Recommandation (conditionnelle, justifiée — [doc 07](./07-billing-provider-analysis.md))** : pour un lancement rapide avec petite structure, un **MoR (Lemon Squeezy)** minimise le risque fiscal (TVA gérée, chargebacks absorbés) ; **Stripe** devient préférable au-delà d'un certain volume si une compta TVA est en place. Le modèle de données étant **découplé** (`provider`, `billing_*` séparés des `entitlements`), **commencer MoR puis migrer Stripe** reste possible.
- **Conséquences** : frais, charge fiscale/juridique, effort d'intégration, lock-in.
- **Urgence** : 🔴 avant les étapes 8–9.

## D4 — Durée de l'essai gratuit  · 🟡 Moyenne

- **Question** : proposer un essai (trial) et de quelle durée ?
- **Options** : pas d'essai · 7 j · 14 j · 30 j ; déclenchement `signup|manual|campaign`.
- **Recommandation** : essai **optionnel**, court (**7–14 j [méthode, pas figé]**), **un seul par (user, plan)** (anti-abus, déjà contraint — [doc 08](./08-data-model.md) `trials`).
- **Conséquences** : conversion, mécanique `trials`, mesure `converted`.
- **Urgence** : 🟡 avant étape 6/8 si essais activés.

## D5 — Plan mis en avant  · 🟡 Moyenne

- **Question** : quel plan mettre en avant sur `/pricing` (« recommandé ») ?
- **Options** : Gratuit (acquisition) · **Premium** (conversion) · Business (ARPU).
- **Recommandation** : **Premium** comme plan « ★ recommandé » (meilleur ratio valeur/prix perçu), Business comme montée en gamme. Décision **produit/marketing**.
- **Conséquences** : hiérarchie visuelle pricing ([doc 10](./10-ux-ui-direction.md)), messages d'upsell.
- **Urgence** : 🟡 avant étape 4.

## D6 — Règles de changement d'emplacements (slots)  · 🟠 Élevée

- **Question** : les emplacements se **cumulent-ils** entre entitlements de même niveau ? Règle de réaffectation ?
- **Options** : slots = **meilleur plan** (pas d'addition) · slots additionnés · hybride.
- **Recommandation** : **pas d'addition** — les slots dérivent du **meilleur** plan (modèle simple, anti-abus — [doc 06](./06-subscriptions-and-entitlements.md) §résolution). Réaffectation autorisée mais soumise à cooldown (**D7**).
- **Conséquences** : contrainte `entitlement_guild_assignments` (unicité par guilde active), UX emplacements.
- **Urgence** : 🟠 avant étape 7.

## D7 — Cooldown anti-abus de réaffectation  · 🟡 Moyenne

- **Question** : quel délai minimal entre deux réaffectations d'un même slot ?
- **Options** : aucun · 24 h · 48 h · 72 h.
- **Recommandation** : un cooldown **non nul** (**ordre de grandeur 24–72 h [à calibrer]**) pour empêcher le partage tournant d'un abonnement entre de nombreux serveurs ([doc 06](./06-subscriptions-and-entitlements.md), [doc 09](./09-security-model.md)).
- **Conséquences** : champ `last_reassigned_at`, message UX, support.
- **Urgence** : 🟡 avant étape 7.

## D8 — Règle par défaut au downgrade sans choix utilisateur  · 🟡 Moyenne

- **Question** : si l'utilisateur ne choisit pas les serveurs à conserver (ex. 3/5) dans un délai, que fait le système ?
- **Options** : **bloquer** (tout suspendu jusqu'au choix) · règle déterministe (garder les N plus récemment actifs) · dernier affecté.
- **Recommandation** : par défaut **bloquer l'application des nouvelles limites** en gardant tout suspendu (aucune suppression, aucun choix arbitraire imposé — [doc 06](./06-subscriptions-and-entitlements.md)) ; une règle déterministe optionnelle reste à valider.
- **Conséquences** : machine d'états d'affectation, UX de rappel.
- **Urgence** : 🟡 avant étape 7.

## D9 — Engagements de support (priorités)  · 🟡 Moyenne

- **Question** : quels engagements par plan (sans promettre de SLA contractuel) ?
- **Options** : ordre d'arrivée pour tous · priorité relative (Business>Premium>Gratuit, **non-SLA**) · SLA chiffrés.
- **Recommandation** : **priorité relative non contractuelle** (déjà décrit — [doc 06](./06-subscriptions-and-entitlements.md)) ; éviter tout SLA chiffré tant que l'équipe est petite.
- **Conséquences** : file `support_tickets`, communication commerciale.
- **Urgence** : 🟡 avant étape 10.

## D10 — Politique lifetime  · 🟠 Élevée

- **Question** : autorise-t-on des accès **lifetime**, et pour quels cas (partenaires, early adopters) ?
- **Options** : jamais · réservé partenaires/exceptionnel · offert en campagne.
- **Recommandation** : **réservé aux cas exceptionnels** (partenariats, gestes commerciaux), jamais en promotion ; garde-fous déjà spécifiés (permission dédiée `grant_lifetime` + saisie `LIFETIME` + step-up + audit — [doc 06](./06-subscriptions-and-entitlements.md), [doc 09](./09-security-model.md)).
- **Conséquences** : coût long terme, risque d'abus, `developer_grants.duration_kind='lifetime'`.
- **Urgence** : 🟠 avant étape 13.

## D11 — Permissions développeur : granularité & bootstrap  · 🟠 Élevée

- **Question** : la matrice de 13 permissions ([doc 09](./09-security-model.md)) est-elle validée ? Comment provisionner le **premier opérateur** ?
- **Options bootstrap** : secret d'amorçage · migration contrôlée · variable d'environnement — **jamais** une route publique.
- **Recommandation** : valider la matrice telle quelle ; bootstrap du **propriétaire** via **migration/secret contrôlé** (pas d'auto-inscription). Rôle « admin studio » distinct, lui-même audité.
- **Conséquences** : `studio_operators`/`studio_operator_permissions`, sécurité initiale.
- **Urgence** : 🟠 avant étape 11.

## D12 — Politique de remboursement  · 🟠 Élevée

- **Question** : conditions/fenêtre de remboursement ?
- **Options** : aucun (hors obligation légale) · fenêtre X jours · au cas par cas.
- **Recommandation** : politique **écrite** alignée sur le droit applicable (droit de rétractation UE) et sur le prestataire (un **MoR** simplifie fortement — [doc 07](./07-billing-provider-analysis.md)). Action `refund_paid` **irréversible** + step-up + audit ([doc 09](./09-security-model.md)).
- **Conséquences** : CGV, workflow Studio, comptabilité.
- **Urgence** : 🟠 avant lancement (étape 19).

## D13 — Suspension pour fraude/sécurité  · 🟡 Moyenne

- **Question** : critères et procédure de suspension d'un abonnement payé pour fraude/sécurité ?
- **Options** : manuel opérateur · règles automatiques · mixte.
- **Recommandation** : **manuel + audit renforcé** au départ (jamais un simple « Révoquer » — [doc 04](./04-developer-studio.md)) ; automatisation seulement après données. État `suspended` **réversible**, config conservée.
- **Conséquences** : machine d'états entitlement, litiges, audit.
- **Urgence** : 🟡 avant étape 15.

## D14 — Page statut publique  · 🟢 Faible

- **Question** : `/status` public complet ou minimal ?
- **Options** : minimal (up/down) · détaillé (composants, incidents, historique).
- **Recommandation** : commencer **minimal** (Worker/Gateway/D1/KV via heartbeat+health), enrichir ensuite. Ne jamais exposer de détail sensible ([doc 09](./09-security-model.md)).
- **Conséquences** : réassurance, charge de maintenance.
- **Urgence** : 🟢 après étape 3.

## D15 — Documentation séparée  · 🟢 Faible

- **Question** : `/docs` léger intégré au client, ou site docs séparé ?
- **Options** : `/docs` MD léger (intégré) · sous-domaine docs dédié.
- **Recommandation** : **intégré et léger** au départ ([doc 03](./03-client-platform.md)), externaliser seulement si le volume l'exige.
- **Conséquences** : IA du site, effort rédactionnel.
- **Urgence** : 🟢 après étape 3.

## D16 — Nom final du plan intermédiaire (`Premium` vs `Pro`)  · 🟡 Moyenne

- **Question** : garder « Premium » ou renommer « Pro » (et « Business » vs « Team/Enterprise ») ?
- **Options** : Premium/Business (actuel) · Pro/Business · autre.
- **Recommandation** : trancher **avant** de figer la copie et les identifiants **d'affichage**. Les **identifiants techniques** restent stables (`free|premium|business` en base — [doc 08](./08-data-model.md)) ; seul le `display_name` change (découplage déjà prévu).
- **Conséquences** : copie marketing, `plans.display_name` (pas les clés techniques).
- **Urgence** : 🟡 avant étape 4.

## D17 — Domaines définitifs  · 🟠 Élevée

- **Question** : confirmer `archodev.fr` (client) et `studio.archodev.fr` (studio) ?
- **Options** : domaines proposés · autres · sous-domaine studio alternatif.
- **Recommandation** : **confirmer** les domaines (`[Hypothèse]` actuelle — [doc 02](./02-product-architecture.md)) ; prévoir la bascule DNS sans coupure (`*.workers.dev` reste valide). Le callback OAuth et l'endpoint Interactions Discord devront pointer vers le domaine custom.
- **Conséquences** : routes Cloudflare, cookies (scope), OAuth, Interactions.
- **Urgence** : 🟠 avant étape 1 (prérequis fondations).

## D18 — Politique de conservation (rétention)  · 🟠 Élevée

- **Question** : durées de conservation pour billing/PII, tickets support, audit, entitlements expirés ?
- **Options** : minimales (RGPD) · alignées obligations comptables · maximales.
- **Recommandation** : conservation **minimale nécessaire** + obligations légales/comptables ; audit et `subscription_events` **longue durée** ; entitlements expirés **conservés** (historique/réactivation) ; purges via le cron existant (`23 4 * * *`), **jamais** manuelles non auditées ([doc 08](./08-data-model.md)).
- **Conséquences** : conformité RGPD, taille D1, politique de confidentialité.
- **Urgence** : 🟠 avant lancement (traitement de PII billing).

## D19 — Lancement bêta  · 🟡 Moyenne

- **Question** : phase bêta (invités/cohortes) avant l'ouverture générale ?
- **Options** : pas de bêta · bêta fermée (guildes pilotes) · bêta ouverte.
- **Recommandation** : **bêta fermée** via feature flags (guildes pilotes → général — [doc 11](./11-migration-roadmap.md) étape 17), Studio d'abord réservé au propriétaire.
- **Conséquences** : rollout, feedback, risque maîtrisé.
- **Urgence** : 🟡 avant étape 17.

## D20 — TVA & obligations fiscales  · 🟠 Élevée

- **Question** : qui porte la TVA (auto-liquidation, seuils UE) ?
- **Options** : **MoR** (prestataire = vendeur, TVA gérée) · **Stripe** + Stripe Tax + obligations déclaratives propres.
- **Recommandation** : dépend de **D3**. Un **MoR** simplifie fortement (TVA/facturation UE gérées — [doc 07](./07-billing-provider-analysis.md)) ; avec Stripe, prévoir Stripe Tax **et** la charge déclarative.
- **Conséquences** : conformité, comptabilité, mentions fiscales.
- **Urgence** : 🟠 avant lancement (étape 19), couplée à D3.

## D21 — CGV / mentions légales  · 🟠 Élevée

- **Question** : rédaction des CGV (`/legal/sales`), mentions légales, confidentialité, conditions ?
- **Options** : rédaction interne · accompagnement juridique.
- **Recommandation** : **CGV requises** dès qu'il y a paiement ([doc 03](./03-client-platform.md), [doc 07](./07-billing-provider-analysis.md)) ; un **MoR** fournit une partie du cadre, mais faire **valider juridiquement** (droit de rétractation, remboursement, données).
- **Conséquences** : conformité, confiance, prérequis paiement.
- **Urgence** : 🟠 avant lancement (étape 19).

---

## Décisions techniques mineures (regroupées)  · 🟢/🟡

| # | Question | Recommandation | Réf. | Urgence |
|---|----------|----------------|------|---------|
| D22 | Packaging Worker studio : `packages/worker-studio` (a) ou 2ᵉ entry dans `worker` (b) | **(a)** frontière de code nette | [doc 02](./02-product-architecture.md) | 🟡 étape 11 |
| D23 | TTL de session studio | Plus court que le client (**ordre 8 h absolu / 30 min idle** à calibrer) | [doc 09](./09-security-model.md) | 🟡 étape 11 |
| D24 | Step-up : ré-consentement OAuth ou re-saisie | À formaliser (au moins sur financier/lifetime) | [doc 09](./09-security-model.md) | 🟡 étape 15 |
| D25 | Outillage E2E / charge / a11y (Playwright / k6 / axe) | À confirmer ; réutiliser vitest pour l'unitaire/intégration | [doc 12](./12-testing-and-release-strategy.md) | 🟢 avant E2E |
| D26 | Déclenchement des déploiements dans le Studio | **Consultation seule** au départ, déclenchement CLI | [doc 04](./04-developer-studio.md) | 🟢 étape 18 |
| D27 | Séparation environnements prod/dev (bindings/secrets) | Formaliser des environnements séparés | [doc 09](./09-security-model.md) | 🟡 avant lancement |
| D28 | Renommage `packages/panel` → `client-web` | Différé/optionnel, en une fois (diff lisible) | [doc 02](./02-product-architecture.md) | 🟢 quand utile |
| D29 | Mapping exact `feature_key` → plan | **Décision produit** à figer (granularité gating) | [doc 05](./05-plans-and-commercial-strategy.md), [doc 08](./08-data-model.md) | 🟠 avant étape 7 |

---

## Récapitulatif par urgence

- 🔴 **Bloquant** : D1 (prix), D3 (prestataire).
- 🟠 **Élevée** : D2, D6, D10, D11, D12, D16*, D17, D18, D20, D21, D29. *(D16 : 🟡→🟠 si la copie est figée tôt.)*
- 🟡 **Moyenne** : D4, D5, D7, D8, D9, D13, D19, D22, D23, D24, D27.
- 🟢 **Faible** : D14, D15, D25, D26, D28.

> Rien dans ce dossier ne présuppose ces arbitrages : le code cible est conçu pour **recevoir** ces décisions (prix hors code, prestataire découplé, plans par identifiants techniques stables, flags de rollout). Aucune n'a été tranchée à ta place.
