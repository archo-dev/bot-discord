# Backlog officiel validé

Ces cinq propositions ont été validées comme futures mises à jour. Elles ne remplacent aucune des dix milestones principales et ne sont pas autorisées au développement par ce document.

## Règles de sélection

Une alternative entre en conception uniquement si :

- les métriques de B4 ou des retours qualifiés confirment le besoin ;
- ses dépendances principales sont déployées ;
- aucune milestone majeure n’est en développement ;
- son coût récurrent est compatible avec l’infrastructure actuelle ;
- une branche, un rollback et des limites d’usage sont définis.

## A. Suggestions et votes communautaires

**Valeur :** canaliser les idées d’une communauté avec proposition, vote, discussion, statut et réponse officielle.

**Moment recommandé :** après B2 Onboarding et B4 Analytics, lorsque le bot compte assez de serveurs communautaires pour prouver l’usage.

**Dépendances :**

- A2 Sécurité : permissions de gestion, anti-spam, rate limits ;
- A3 Modules : activation et quotas ;
- B1 Livraison fiable : événements de vote ;
- B4 Analytics : adoption et taux de traitement.

**Architecture probable :** tables `suggestion_settings`, `suggestions`, éventuellement votes agrégés ; composants Discord ; page panel de modération. La source de vérité reste D1, avec pagination et rétention des événements techniques.

**Risques :** brigading, anonymat mal compris, collisions avec les forums Discord, charge de modération.

**Estimation :** 8–14 jours. **Potentiel :** fondations gratuites ; plusieurs boards, exports ou historique long éventuellement premium.

## B. Tâches planifiées, rappels et giveaways sobres

**Décision :** le **moteur de tâches planifiées est un prérequis du studio d’automatisations**. Il devient la sous-phase C2.0 de la roadmap. Les fonctionnalités rappels et giveaways restent des consommateurs distincts.

### B1. Moteur `scheduled_tasks`

Doit fournir : date d’exécution, type, payload versionné, guilde, statut, tentatives, verrou/lease, clé d’idempotence, erreur résumée, `next_attempt_at`, purge et limite par guilde.

Le cron Worker est déjà présent, mais son rythme quotidien est insuffisant pour des tâches utilisateur. Étudier : cron plus fréquent Cloudflare, réveil borné et traitement par lots, sans Durable Objects tant que la charge ne le justifie pas.

**Moment :** après B4 et avant C1/C2, ou comme milestone autonome si >5–7 jours.

**Dépendances :** A1, A2, A4, B1 et B3.

### B2. Rappels

Premier cas de validation recommandé : création, annulation, liste, exécution tardive acceptable et message d’échec. Il teste le scheduler sans fraude ni tirage.

### B3. Giveaways

À développer seulement après preuve du scheduler. Nécessite règles d’éligibilité, tirage vérifiable, anti-multi-compte raisonnable, reprise, reroll et journal. Ne pas le présenter comme « aléatoire équitable » sans méthode documentée.

**Estimation totale :** moteur 7–12 j ; rappels 3–5 j ; giveaways 5–9 j. **Migration D1 :** oui.

## C. Base de connaissances et réponses FAQ sans IA payante

**Valeur :** réduire les tickets répétitifs avec articles courts, catégories, recherche et commande `/faq`.

**Moment recommandé :** après B2 et C1, si les motifs de tickets montrent une répétition significative. Peut être avancée avant C1 si le support du bot lui-même devient le premier coût opérationnel.

**Dépendances :** A2 pour permissions/contenu, A3 pour module/quota, B3 pour sauvegarde, B4 pour mesurer les consultations.

**Approche gratuite :** recherche D1 par normalisation/tokens simples ; pas de fournisseur IA. Une recherche sémantique locale ne sera étudiée que si elle tient dans l’infrastructure et apporte un gain prouvé.

**Risques :** moteur de recherche médiocre, contenu périmé, confusion entre FAQ publique du bot et FAQ privée d’une guilde.

**Estimation :** 7–13 jours. Articles et recherche de base gratuits ; volumes/import avancé éventuellement premium.

## D. Internationalisation français/anglais

**Valeur :** ouvrir le produit à un marché plus large et préparer la vérification publique.

**Moment recommandé :** après B2, lorsque microcopies et navigation sont stabilisées. Traduire trop tôt doublerait le coût de chaque itération UX.

**Dépendances :** A3 pour locales/capacités, B2 pour le parcours complet, B3 pour versionner les préférences.

**Périmètre initial :** panel, réponses système, commandes et documentation essentielle. Les contenus administrateur restent tels que saisis. Prévoir fallback, interpolation typée, pluriels et locale par guilde/utilisateur.

**Risques :** chaînes dynamiques non extraites, incohérence Worker/Gateway/panel, maintenance documentaire.

**Estimation :** 10–18 jours. Toutes les langues prises en charge doivent rester gratuites ; aucune logique d’entitlement.

## E. Réputation et saisons d’engagement

**Valeur :** donner un signal communautaire complémentaire à l’XP passive : `/rep`, saisons, classements et récompenses.

**Moment recommandé :** après B4, seulement si Niveaux/XP présente une adoption et une rétention suffisantes. Sinon, améliorer le module existant plutôt que multiplier les mécaniques.

**Dépendances :** A2 anti-abus, A3 quotas/modules, B1 événements fiables, B3 snapshots/rollback, B4 mesure, moteur planifié pour fin de saison.

**Risques :** farming, favoritisme, harcèlement par classement, dette de règles, requêtes de classement coûteuses.

**Estimation :** 8–15 jours. Système et saisons de base gratuits ; cosmétiques ou historique long éventuellement premium.

## Prompts d’implémentation

Aucun prompt complet n’est fourni pour le backlog : les besoins doivent être revalidés avec les métriques disponibles au moment de leur promotion. La sous-phase C2.0 recevra son prompt propre lors de la conception de la milestone 10 ou si elle devient une milestone autonome.
