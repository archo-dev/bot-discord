# E2 — Fiches de recommandation

> Voir aussi : [synthèse A/B/C](./E1-decision-synthesis.md) · [offres](../05-plans-and-commercial-strategy.md) · [paiement](../07-billing-provider-analysis.md) · [décisions ouvertes](../13-open-decisions.md) · [file de décisions](./E7-decision-queue.md)

Format de fiche : **question · options · recommandation · alternative · avantages · risques · impact technique · impact commercial · coût de changement ultérieur · urgence · décision attendue**.

> ⚠️ **Aucun prix définitif** n'est fixé ici : la section Tarification donne une **méthode** et des **fourchettes indicatives [Hypothèse]** à valider. **Aucun prestataire** n'est choisi de façon irréversible : recommandation **conditionnelle**.

---

# 1. Positionnement des offres

## Fiche 1.1 — Structure Gratuit / Premium / Business  (D—, cadré)

- **Question** : garder 3 niveaux 1/3/5 serveurs ?
- **Options** : (a) 3 niveaux 1/3/5 · (b) 2 niveaux · (c) 4 niveaux.
- **Recommandation** : **(a) conserver 1/3/5** ([doc 05](../05-plans-and-commercial-strategy.md)) — lisible, aligné « démarrer / développer / contrôler ».
- **Alternative** : ajouter plus tard un palier « Enterprise » sur devis (hors slots) sans casser le modèle.
- **Avantages** : simplicité, upsell naturel par nombre de serveurs.
- **Risques** : le nombre de serveurs seul ne capture pas toute la valeur → compléter par le périmètre de features (D29).
- **Impact technique** : `plans.rank` 1/2/3, `plans.slots` 1/3/5 ([doc 08](../08-data-model.md)).
- **Impact commercial** : socle de la page pricing.
- **Coût de changement** : faible (référentiel `plans`).
- **Urgence** : cadré — confirmer.
- **Décision attendue** : ✅ confirmer 1/3/5.

## Fiche 1.2 — Nom du plan intermédiaire : `Premium` vs `Pro`  (D16)

- **Question** : « Premium » ou « Pro » (et « Business » vs « Team ») ?
- **Options** : (1) **Premium/Business** · (2) Pro/Business.
- **Recommandation** : **Premium/Business**. « Premium » signale la valeur/qualité au grand public Discord (cohérent avec MEE6/Dyno « Premium ») ; « Pro » évoque un usage métier plus étroit.
- **Alternative** : « Pro » si la cible se professionnalise (créateurs, agences).
- **Avantages** : familiarité, moins d'explication.
- **Risques** : « Premium » est banalisé — se différencier par la promesse, pas le nom.
- **Impact technique** : **`plans.display_name` uniquement** ; clés `free|premium|business` **inchangées**.
- **Impact commercial** : copie, CTA, comparatif.
- **Coût de changement** : **faible** (nom d'affichage), mais **churn de copie** si tardif → **décider avant M4**.
- **Urgence** : 🟡 (décider tôt).
- **Décision attendue** : choisir 1 ou 2.

## Fiche 1.3 — Plan mis en avant  (D5)

- **Question** : quel plan « recommandé » sur `/pricing` ?
- **Options** : Gratuit · **Premium** · Business.
- **Recommandation** : **Premium ★** (ancre de conversion, meilleur ratio valeur/prix perçu).
- **Alternative** : mettre Business en avant si la cible principale est les réseaux multi-serveurs.
- **Avantages** : oriente le regard, augmente l'ARPU moyen.
- **Risques** : sur-vendre Premium peut cannibaliser Business — équilibrer le comparatif.
- **Impact technique** : flag d'affichage sur la carte pricing.
- **Impact commercial** : fort sur le taux de conversion.
- **Coût de changement** : nul (config UI).
- **Urgence** : 🟡 (M4).
- **Décision attendue** : plan à mettre en avant.

## Fiche 1.4 — Offre annuelle & remise annuelle  (D2)

- **Question** : proposer l'annuel ? quelle remise ?
- **Options** : mensuel seul · **mensuel + annuel** · annuel seul.
- **Recommandation** : **mensuel + annuel**, remise annuelle **≈ 2 mois offerts (~15–17 %) [Hypothèse]**.
- **Alternative** : lancer mensuel seul, ajouter l'annuel après validation du prix.
- **Avantages** : rétention, trésorerie, réduction du churn.
- **Risques** : engagement long → politique de remboursement claire (D12).
- **Impact technique** : `billing_subscriptions.interval` (`month|year`) déjà prévu ([doc 08](../08-data-model.md)) ; proraté au changement.
- **Impact commercial** : bascule mensuel/annuel sur pricing.
- **Coût de changement** : moyen (proraté, communication).
- **Urgence** : 🟠 (M9).
- **Décision attendue** : annuel oui/non + niveau de remise.

## Fiche 1.5 — Essai gratuit  (D4)

- **Question** : proposer un essai payant-gratuit (trial) ?
- **Options** : pas d'essai · **7–14 j sans CB** · essai avec CB requise.
- **Recommandation** : **essai court sans CB (7 ou 14 j)**, **un seul par (user, plan)** (anti-abus déjà contraint — [doc 08](../08-data-model.md) `trials`).
- **Alternative** : pas d'essai au lancement, l'ajouter si la conversion Free→Premium est faible.
- **Avantages** : lève la friction, montre la valeur.
- **Risques** : abus (multi-comptes) → unicité + éventuel plafond.
- **Impact technique** : table `trials`, événements `trial.*`.
- **Impact commercial** : conversion vs coût d'usage.
- **Coût de changement** : faible (activable par flag).
- **Urgence** : 🟡.
- **Décision attendue** : essai oui/non + durée.

## Fiche 1.6 — Garantie / remboursement  (D12)

- **Question** : offrir une garantie « satisfait ou remboursé » ?
- **Options** : aucune (hors droit légal) · **remboursement X jours** · au cas par cas.
- **Recommandation** : respecter le **droit de rétractation UE** + éventuelle garantie **7–14 j** au lancement (rassure, réduit la friction). Un **MoR** simplifie l'exécution ([doc 07](../07-billing-provider-analysis.md)).
- **Alternative** : au cas par cas si volume faible.
- **Avantages** : confiance, moins de chargebacks.
- **Risques** : abus → limiter (1 remboursement/plan), audit ([doc 09](../09-security-model.md)).
- **Impact technique** : `refund_paid` (irréversible, step-up, audit).
- **Impact commercial** : argument de vente.
- **Coût de changement** : faible (policy + CGV).
- **Urgence** : 🟠 (M16).
- **Décision attendue** : garantie oui/non + fenêtre.

## Fiche 1.7 — Modalités de downgrade  (D8)

- **Question** : que se passe-t-il au passage Business→Premium→Gratuit (5→3→1) ?
- **Options** : suspension sans suppression + **choix utilisateur** · règle auto déterministe · blocage.
- **Recommandation** : **suspension sans suppression** ; l'utilisateur **choisit les serveurs conservés** ; à défaut de choix, **tout suspendu** jusqu'à décision (aucune suppression, aucun choix arbitraire — [doc 06](../06-subscriptions-and-entitlements.md)).
- **Alternative** : règle par défaut « garder les N plus récemment actifs » (optionnelle, à valider).
- **Avantages** : zéro perte de config, réversible.
- **Risques** : utilisateur bloqué en indécision → rappels UX clairs.
- **Impact technique** : `entitlement_guild_assignments.state='suspended'`, invariant 4 ([doc 08](../08-data-model.md)).
- **Impact commercial** : réduit la peur du downgrade → facilite l'upsell.
- **Coût de changement** : moyen (machine d'états).
- **Urgence** : 🟡 (M7).
- **Décision attendue** : valider « suspension + choix, sinon tout suspendu ».

---

# 2. Tarification (méthode, pas de prix figé)

> ⚠️ **Aucun montant n'est décidé.** Ci-dessous une **méthode**, des **fourchettes indicatives [Hypothèse]** et une **stratégie**. Les valeurs finales sont **D1** (à valider en [E7](./E7-decision-queue.md)).

## Fiche 2.1 — Méthode de calcul du prix

1. **Ancrage marché (qualitatif)** : les bots Discord premium grand public se situent en **ordre de grandeur** de quelques € à ~15 €/mois par palier (MEE6, Dyno, DraftBot — **valeurs à vérifier au moment de la décision**, [doc 05](../05-plans-and-commercial-strategy.md)). Ne pas copier : se positionner par la **valeur** (temps gagné, incidents évités).
2. **Valeur perçue** : chiffrer le bénéfice (heures de modération économisées, professionnalisation) ; le prix doit rester **très inférieur** à la valeur perçue.
3. **Coût de service** : coûts d'infra (Workers, VPS gateway, D1/KV) + support ; marge cible ; le Gratuit doit rester **soutenable** (limites calibrées).
4. **Cohérence des paliers** : Business ≈ **2–3×** Premium (pas plus, sinon Business paraît punitif), justifié par 5 serveurs + périmètre complet.
5. **Psychologie** : prix en `X,99` **[Hypothèse]**, remise annuelle affichée en « 2 mois offerts ».

## Fiche 2.2 — Fourchettes indicatives [Hypothèse — à valider D1]

| Palier | Fourchette mensuelle indicative | Annuel (≈ −2 mois) | Base du raisonnement |
|--------|-------------------------------|--------------------|----------------------|
| Gratuit | 0 € | 0 € | Acquisition, soutenable |
| Premium (3 serveurs) | **~4–8 €/mois [Hyp.]** | ~40–80 €/an | Palier de conversion grand public |
| Business (5 serveurs) | **~10–18 €/mois [Hyp.]** | ~100–180 €/an | ~2–3× Premium, périmètre complet |

> Ces fourchettes sont des **repères de travail**, pas des prix. Le code ne contient **aucun montant en dur** ([doc 11](../11-migration-roadmap.md) étape 4/19) — les valeurs seront injectées hors code.

## Fiche 2.3 — Prix de lancement, early adopters, grandfathering

- **Prix de lancement** : proposer un **tarif de lancement réduit** (ex. −20 à −30 % **[Hyp.]**) pendant la bêta/les premières semaines pour amorcer.
- **Early adopters / grandfathering** : les premiers abonnés **conservent leur tarif** lors des hausses futures (`billing_subscriptions` porte le prix souscrit ; le prix n'est pas recalculé rétroactivement). Fort levier de fidélité.
- **Révision des prix** : n'augmenter que pour les **nouveaux** abonnés ; communiquer à l'avance ; jamais de hausse silencieuse.
- **Promotions** : codes/campagnes via `promotions`/`promotion_redemptions` ([doc 08](../08-data-model.md)), **jamais de lifetime en promo** ([doc 06](../06-subscriptions-and-entitlements.md)).
- **Bêta** : **gratuite ou fortement remisée**, avec grants offerts traçables ([doc 04](../04-developer-studio.md)) plutôt que du code jetable.

## Fiche 2.4 — Comparaison qualitative marché

- **Différenciateurs** ([doc 05](../05-plans-and-commercial-strategy.md)) : cohérence marque public↔panel, transparence (statut, mises à jour), support priorisé, automatisations, design premium.
- **À ne pas faire** : promettre « toutes les fonctionnalités » en incluant des outils **Studio** (les capacités développeur ne font **jamais** partie d'un plan client).
- **Urgence tarification** : méthode utile dès M4 ; **valeurs = 🔴 D1 avant M16**.
- **Décision attendue** : valider la **méthode** + les **fourchettes de travail** (pas les valeurs finales).

---

# 3. Prestataire de paiement  (D3)

> Comparaison détaillée en [doc 07](../07-billing-provider-analysis.md). Ci-dessous : recommandation **conditionnelle**, non irréversible.

## Fiche 3.1 — Stripe vs Lemon Squeezy vs Paddle

| Critère | Stripe (non-MoR) | Lemon Squeezy (MoR) | Paddle (MoR) |
|---------|------------------|---------------------|--------------|
| Fiscalité / TVA | **À votre charge** (Stripe Tax en option) | **Gérée (MoR)** | **Gérée (MoR)** |
| Factures conformes UE | Via Invoicing/Tax | Incluses | Incluses |
| Remboursements | API complète | Via MoR | Via MoR |
| Chargebacks | À votre charge | **Absorbés** | **Absorbés** |
| Webhooks | Très riches | Oui | Oui |
| Portail client | Hosted | Oui | Oui |
| Compat Cloudflare Workers | **Excellente** (REST + webhooks HTTP) | Bonne | Bonne |
| Coûts | **Les plus bas** (~1,5 % EU + fixe) + Tax | ~5 % tout compris | ~5 % tout compris |
| Dépendance / lock-in | Faible (standard) | Moyenne (sortie = re-souscription) | Moyenne |
| Migration future | La plus aisée | Friction MoR | Friction MoR |
| Difficulté d'intégration | Faible (SDK/doc partout) | Faible (indie) | Moyenne |
| Expérience client | Très bonne | Bonne | Bonne |

> Pourcentages = **ordres de grandeur** à vérifier ([doc 07](../07-billing-provider-analysis.md)).

## Fiche 3.2 — Recommandation conditionnelle

- **Recommandation principale** : pour un lancement rapide en **petite structure**, un **MoR — Lemon Squeezy** — minimise le risque fiscal (TVA/facturation UE gérées, chargebacks absorbés) et le time-to-market.
- **Alternative** : **Stripe** si la priorité est **coût/contrôle/portabilité** et que vous acceptez d'assumer la TVA (Stripe Tax + obligations déclaratives), notamment à volume élevé.
- **Avantages MoR** : conformité quasi nulle à gérer, lancement plus sûr juridiquement.
- **Risques MoR** : frais plus élevés, lock-in modéré (migration = re-souscription des clients).
- **Impact technique** : `/webhooks/<provider>` signé + idempotent, `billing_customers`/`billing_subscriptions` avec champ **`provider`** → **découplage anti-lock-in** ([doc 07](../07-billing-provider-analysis.md), [doc 08](../08-data-model.md)). Le modèle permet **commencer MoR puis migrer Stripe**.
- **Impact commercial** : le MoR gère factures/TVA côté client → expérience conforme sans effort.
- **Coût de changement** : **moyen** grâce au découplage (réécrire l'adaptateur webhook + remapper `billing_*`, sans toucher la logique d'entitlements).
- **Urgence** : 🔴 avant M9/M10.
- **Décision attendue** : **choix conditionnel** MoR (Lemon Squeezy) **vs** Stripe — *validable au moment de M9, pas avant*.

---

# 4. Slots serveurs  (D6, D7, D8)

## Fiche 4.1 — Règles précises des emplacements

| Situation | Règle recommandée | Réf. |
|-----------|-------------------|------|
| **Attribution** | L'utilisateur affecte un serveur qu'il administre à un slot libre → consomme 1 slot, applique le plan effectif à la guilde | [doc 06](../06-subscriptions-and-entitlements.md) |
| **Retrait** | Libère le slot ; **config conservée** ; la guilde repasse `free` (fonctions hors-plan **désactivées, pas effacées**) | [doc 06](../06-subscriptions-and-entitlements.md) |
| **Changement (réaffectation)** | Libérer un slot et l'affecter ailleurs, soumis à **cooldown** | D7 |
| **Cooldown anti-abus** | **Mécanisme paramétrable**, défaut **48 h [Hyp.]** par slot (empêche le partage tournant) | D7 |
| **Downgrade / dépassement** | Serveurs excédentaires → `suspended` ; **choix utilisateur** des conservés ; sinon tout suspendu | D8 |
| **Suspension** | `suspended` = bot présent, config préservée, fonctions hors-plan off, bandeau explicatif | [doc 06](../06-subscriptions-and-entitlements.md) |
| **Réactivation** | Re-upgrade → serveurs suspendus **réactivables**, config intacte | [doc 06](../06-subscriptions-and-entitlements.md) |
| **Cumul de slots** | **Pas d'addition** : slots = ceux du **meilleur** plan actif (anti-abus, simple) | D6 |
| **Serveur quitté / supprimé** | Le bot n'est plus présent → slot **libéré automatiquement** ; config marquée orpheline, conservée un temps puis purgeable par le cron de rétention (D18) | [doc 08](../08-data-model.md) |
| **Transfert d'un slot** | = réaffectation (retrait + attribution), soumise au cooldown ; **pas** de transfert entre utilisateurs (l'entitlement appartient au user) | [doc 06](../06-subscriptions-and-entitlements.md) |

- **Recommandation** : adopter le tableau tel quel ; **pas de cumul de slots** (D6), cooldown paramétrable **48 h** par défaut (D7).
- **Impact technique** : `entitlement_guild_assignments` (`state`, `last_reassigned_at`, `released_at`), unicité `(guild_id) WHERE state='active'`.
- **Impact commercial** : anti-abus sans punir l'usage légitime.
- **Coût de changement** : moyen (règles backend testées unitairement).
- **Urgence** : 🟠 (M7).
- **Décision attendue** : valider « pas de cumul » + cooldown 48 h (ou autre valeur).

---

# 5. Support  (D9)

## Fiche 5.1 — Politique commerciale sans SLA contractuel

- **Question** : quels engagements par plan pour une **petite équipe** ?
- **Recommandation** : **priorité relative, non contractuelle** (aucun SLA chiffré promis) :
  - **Gratuit** : traité selon l'ordre d'arrivée et les disponibilités.
  - **Premium** : passe **avant** les demandes Gratuit.
  - **Business** : **priorité maximale**.
- **File d'attente** : tri par **(priorité de plan, ancienneté, urgence signalée)** — `support_tickets (status, priority, created_at)` ([doc 08](../08-data-model.md)).
- **Ancienneté** : à priorité égale, le plus ancien passe d'abord (évite la famine).
- **Urgence** : champ « urgence » déclaré par l'utilisateur, modéré par l'équipe (anti-abus : marquer tout « urgent » n'aide pas).
- **Abus** : plafond de tickets ouverts simultanés par utilisateur **[Hyp.]** ; détection de spam.
- **Ticket ouvert avant downgrade** : **conserve sa priorité d'ouverture** (signalé « plan modifié depuis »), jamais fermé/déprioritisé automatiquement ([doc 06](../06-subscriptions-and-entitlements.md)).
- **Capacité réaliste** : sans SLA, promettre seulement une **priorité relative** ; afficher les délais **observés**, pas garantis.
- **Impact technique** : `support_tickets`/`support_messages`, vue cross-guilde **Studio** ([doc 04](../04-developer-studio.md)).
- **Impact commercial** : argument « support prioritaire » crédible car non sur-promis.
- **Coût de changement** : faible (politique + copie).
- **Urgence** : 🟡 (M11).
- **Décision attendue** : valider la priorité relative non-SLA.

---

# 6. Grants développeur  (D10, D11)

## Fiche 6.1 — Politique d'octroi

| Aspect | Règle recommandée |
|--------|-------------------|
| **Qui peut accorder** | Uniquement un **opérateur Studio `active`** avec `subscriptions.grant` ; lifetime exige `subscriptions.grant_lifetime` (distincte) |
| **Durées** | 7 j · 30 j · 3 mois · 6 mois · 1 an · date perso · **lifetime** (garde-fous) |
| **Lifetime** | Réservé **exceptionnel** (partenaires, gestes) ; **jamais en promo** ; permission dédiée + saisie `LIFETIME` + step-up + audit |
| **Raison obligatoire** | Oui, **NOT NULL** (`developer_grants.reason`) |
| **Note interne** | Oui, **jamais** exposée au client |
| **Révocation** | Accès offert **révocable** (`revoke_granted`) ; **n'affecte jamais** un `paid` |
| **Audit** | Toute action (octroi/révocation/lifetime) → `audit_events` immuable |
| **Limites / anti-abus** | Rate-limits sur `grant`/`grant_lifetime` ([doc 09](../09-security-model.md)) |
| **Auto-attribution** | **Interdite par défaut** au lancement (un opérateur ne s'octroie pas à lui-même) ; à rouvrir seulement si justifié + audit renforcé |
| **Double validation** | **Cible** (pas MVP) : sur lifetime/actions financières, exiger un **second opérateur** ; au lancement : step-up + saisie explicite suffisent |
| **Permissions requises** | `grant`, `grant_lifetime`, `revoke_granted` ([doc 09](../09-security-model.md) matrice) |

- **Recommandation** : politique ci-dessus ; **auto-attribution interdite**, **double validation = cible** (pas bloquant MVP).
- **Impact technique** : `developer_grants`, `entitlements(source='granted')`, audit.
- **Impact commercial** : permet bêta/partenariats/gestes traçables.
- **Coût de changement** : faible (permissions + workflow).
- **Urgence** : 🟠 (M13 ; lecture/grant simple dès M12).
- **Décision attendue** : valider auto-attribution interdite + double validation en cible.

---

# 7. Sécurité Studio  (D11, D23, D24, D27)

## Fiche 7.1 — Politique minimale de lancement → cible renforcée

| Contrôle | **Minimum de lancement (MVP Studio)** | **Cible renforcée** |
|----------|----------------------------------------|----------------------|
| Allowlist | `studio_operators` (propriétaire seul au départ) | Équipe, gérée depuis `/settings` |
| Rôles / permissions | Matrice 13 permissions vérifiée **serveur** | Rôles préconfigurés + moindre privilège par opérateur |
| Sessions | Cookie `studio_session` distinct, `sameSite=Strict`, TTL court (8 h/30 min) | TTL calibrés, rotation secret |
| Réauthentification | Confirmation renforcée + saisie explicite sur actions sensibles | **Step-up** (re-consentement OAuth récent) sur financier/lifetime |
| MFA | Hérité de Discord (OAuth) ; pas de MFA propre au MVP | Envisager MFA/app dédiée si équipe grandit |
| Séparation domaines | Worker studio séparé, aucune route studio côté client | Idem + WAF/règles Cloudflare |
| Confirmations | Double confirmation + `LIFETIME`/nom cible | + double validation opérateur |
| Audit | `audit_events` **append-only**, PII masquée | + revue périodique, alerting |
| Lifetime | Permission dédiée + saisie + audit | + second opérateur |
| Remboursement | `refund_paid` step-up + audit | + plafond + revue |
| Suspension fraude | Manuel + audit renforcé | Règles semi-automatiques |
| Env prod/dev | Bandeau PRODUCTION, bindings prod | Environnements séparés formalisés (D27) |

- **Recommandation** : livrer le **minimum de lancement** en M12, viser la **cible** en M14 ; **jamais** de route publique de bootstrap ([doc 09](../09-security-model.md)).
- **Impact technique** : `requireDeveloper(permission)`, `studio_operators(_permissions)`, secrets distincts.
- **Impact commercial** : protège le cœur (grants/remboursements) = protège le revenu.
- **Coût de changement** : moyen (durcissement progressif, non bloquant).
- **Urgence** : 🟠 (M12) puis renforcement M14.
- **Décision attendue** : valider bootstrap propriétaire via migration/secret contrôlé (D11).

---

# 8. Domaines  (D17)

## Fiche 8.1 — Quels domaines, quand

| Domaine | Rôle | Nécessaire à quel moment | Recommandation |
|---------|------|--------------------------|----------------|
| `archodev.fr` | Plateforme client (public + panel) | **Avant lancement public** (M16) ; dev sur `*.workers.dev` avant | **Confirmer** ; brancher à M3/M16 |
| `studio.archodev.fr` | Studio développeur (Worker séparé) | **À M12** (Studio) | **Confirmer** ; requis pour l'isolation |
| `status.archodev.fr` | Page statut publique | **Optionnel** ; `/status` sur `archodev.fr` suffit au début | **Différer** (D14) — sous-domaine plus tard |
| `docs.archodev.fr` | Documentation | **Optionnel** ; `/docs` intégré suffit | **Différer** (D15) — externaliser si volume |

- **Recommandation** : **confirmer `archodev.fr` + `studio.archodev.fr`** (prérequis Studio/lancement) ; **`status.` et `docs.` = différables** (sous-chemins d'abord). Le callback OAuth et l'endpoint Interactions Discord devront pointer vers le domaine custom au moment de la bascule (additive, `*.workers.dev` reste valide).
- **Alternative** : tout servir sous `archodev.fr` avec sous-chemins et ne créer que `studio.` en second domaine.
- **Avantages** : moins de DNS/certs à gérer au début.
- **Risques** : changer un domaine après indexation/liens = coûteux → figer tôt les 2 principaux.
- **Impact technique** : routes Cloudflare, scope cookies, OAuth, Interactions.
- **Impact commercial** : image de marque (`.fr` crédible).
- **Coût de changement** : **élevé** pour les domaines principaux une fois publics → décider avant M12/M16.
- **Urgence** : 🟠.
- **Décision attendue** : confirmer les 2 principaux ; acter `status.`/`docs.` comme différés.
