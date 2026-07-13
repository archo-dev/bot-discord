# Audit produit et roadmap publique — phase 1

> Audit réalisé le 13 juillet 2026 sur le commit `6d3e7ae`. Ce document sélectionne des propositions ; il ne constitue ni un plan d’exécution validé ni une autorisation de développement.

## Résumé exécutif

Le bot possède déjà un socle inhabituellement complet pour sa taille : architecture séparant événements temps réel et écritures, typage partagé, isolation par serveur, panel cohérent, modération, engagement, tickets, musique et statistiques. Il peut continuer à servir 10–20 serveurs sans refonte d’infrastructure.

Le principal risque avant une ouverture publique n’est pas le manque de fonctionnalités. C’est l’absence d’un **système d’exploitation produit** autour d’elles : onboarding guidé, modules explicitement activables, observabilité exploitable, limites publiques cohérentes, résilience entre Gateway et Worker, documentation et collecte de retours. Ajouter encore des modules sans ces fondations augmenterait les incidents et le support.

La recommandation est donc : **mesurer d’abord**, **sécuriser ensuite**, puis **ouvrir avec un onboarding guidé**. La grosse différenciation proposée — un studio d’automatisations Discord — doit arriver après ces garde-fous et réutiliser le moteur conditions/actions existant.

Les dix propositions ont été validées le 13 juillet 2026. Les cinq alternatives sont conservées comme backlog officiel. Le classement ci-dessous exprime la valeur intrinsèque ; l’ordre d’implémentation technique validé est défini dans [roadmap.md](./roadmap.md).

## Documentation détaillée

- [Roadmap, dépendances, gates et calendrier](./roadmap.md)
- [Backlog officiel des cinq alternatives](./alternatives.md)
- [Passation complète à Claude](./handoff-claude.md)
- [01 — Observabilité et SLO](./01-observabilite-slo.md)
- [02 — Sécurité multi-tenant](./02-securite-multitenant.md)
- [03 — Gouvernance des modules](./03-gouvernance-modules.md)
- [04 — Performance et coûts](./04-performance-couts.md)
- [05 — Livraison fiable](./05-livraison-fiable.md)
- [06 — Onboarding et centre modules](./06-onboarding-modules.md)
- [07 — Sauvegarde et restauration](./07-sauvegarde-restauration.md)
- [08 — Analytics produit](./08-analytics-produit.md)
- [09 — Tickets d’équipe](./09-tickets-equipe.md)
- [10 — Studio d’automatisations](./10-studio-automatisations.md)

## Classement synthétique

Les estimations supposent un développement assisté par Codex ou Claude, avec conception et validations humaines. `j` signifie jour de travail effectif, pas jour calendaire.

| Rang | Proposition | Catégorie | Note | Bénéfice principal | Difficulté | Durée totale | Risque | Parties concernées | Horizon |
|---:|---|---|---:|---|---|---|---|---|---|
| **1 ★** | Observabilité, SLO et diagnostic par serveur | Fiabilité | **94/100** | Voir les erreurs avant les utilisateurs | Intermédiaire | 8–13 j | Faible–moyen | Worker, Gateway, D1, panel | Court terme |
| **2 ★** | Socle de sécurité publique multi-tenant | Sécurité | **92/100** | Réduire abus, escalades et fuites | Intermédiaire | 8–14 j | Moyen | Worker, Gateway, OAuth, panel | Court terme |
| **3 ★** | Onboarding guidé et centre des modules | Croissance / UX | **91/100** | Passer de l’invitation à un bot utile en minutes | Intermédiaire | 9–15 j | Faible–moyen | Panel, Worker, commandes, documentation | Court terme |
| 4 | Livraison fiable Gateway → Worker | Résilience | **88/100** | Ne plus perdre d’événements lors d’une panne | Élevée | 11–18 j | Moyen–élevé | Gateway, Worker, D1 | Moyen terme |
| 5 | Gouvernance des modules et capacités | Architecture produit | **87/100** | Activer uniquement ce qui est utile | Intermédiaire | 8–14 j | Moyen | Shared, Worker, Gateway, panel, D1 | Moyen terme |
| 6 | Studio d’automatisations Discord | Fonction différenciante | **86/100** | Créer des workflows sans code | Élevée | 18–30 j | Élevé | Shared, Worker, Gateway, panel, D1 | Long terme |
| 7 | Budgets performance et coût | Performance | **84/100** | Garder latence et D1 maîtrisées | Intermédiaire | 7–12 j | Faible–moyen | Worker, Gateway, D1, panel | Court–moyen terme |
| 8 | Sauvegarde, restauration et journal de configuration | Confiance / maintenance | **81/100** | Modifier sans peur et migrer facilement | Intermédiaire | 8–14 j | Moyen | Worker, panel, D1, shared | Moyen terme |
| 9 | Tickets d’équipe : formulaires, assignation et SLA simple | Produit | **79/100** | Rendre le support réellement exploitable | Élevée | 13–22 j | Moyen | Worker, Gateway, panel, D1 | Moyen–long terme |
| 10 | Analytics produit respectueuses de la vie privée | Produit / croissance | **76/100** | Décider avec l’usage réel | Intermédiaire | 6–11 j | Moyen | Worker, D1, panel, documentation | Moyen terme |

★ Les trois propositions à engager en premier.

## Faits confirmés et limites de l’audit

### Faits confirmés dans le dépôt

- Monorepo TypeScript : React/Vite/TanStack Query, Hono/Cloudflare Workers, D1/KV, Node/discord.js et schémas Zod partagés.
- Le Worker est le seul écrivain D1 ; le Gateway utilise `/internal/*`.
- Environ **15 096 lignes** applicatives TypeScript, réparties entre panel (6 349), Worker (6 117), Gateway (1 797) et shared (833).
- **25 fichiers de tests Worker et 175 tests passants** lors de la validation précédente ; aucun test panel ou Gateway dédié n’est déclaré.
- 19 migrations D1, index composés sur les principaux parcours, purge quotidienne des données statistiques anciennes.
- Signatures Ed25519, sessions sécurisées, contrôle d’accès par guilde, séparation admin/modérateur, validation Zod et rate limiting KV sur de nombreuses écritures.
- Cache de configuration Gateway 60 s, lots de logs vocaux, retry Discord unique sur 429.
- Le rate limiter KV est volontairement « best effort » et non atomique ; le buffer vocal abandonne un lot après échec.
- Le bundle panel de production observé localement pèse environ **988 kB JS / 287 kB gzip** et **50 kB CSS / 10 kB gzip**, avec avertissement Vite > 500 kB.
- Le déploiement Worker, panel et Gateway reste coordonné manuellement ; la documentation contient des pièges de production déjà rencontrés.

### Données indisponibles ou non consultées

- Métriques Cloudflare, analytics D1, latences p50/p95/p99, erreurs Worker réelles et taux de cache : accès sûr en lecture seule non disponible dans cette session.
- Logs VPS/Gateway de production, mémoire/CPU, rate limits Discord et YouTube récents : non consultés faute de canal garanti en lecture seule.
- Contenu de messages Discord et données personnelles : non consultés, car inutiles à la sélection.
- Retours utilisateurs structurés, taux d’installation, abandon d’onboarding et adoption des modules : aucune source interne exploitable trouvée.
- Audit dynamique d’accessibilité multi-navigateurs et profilage réseau du panel : non réalisés.

Les objectifs chiffrés ci-dessous sont donc des **cibles à valider après instrumentation**, pas des mesures actuelles.

## Forces actuelles

- Frontières d’architecture nettes et adaptées à l’échelle actuelle.
- Large couverture fonctionnelle sans dépendance SaaS payante obligatoire.
- Isolation `guildId`, permissions panel à plusieurs niveaux et contrats partagés.
- Design system et états UX déjà structurés : skeleton, vide, erreur, toast, SaveBar, responsive.
- Rétention D1 bornée et indexation consciente des lectures fréquentes.
- Moteur conditions/actions et variables : excellente base pour une différenciation future.
- Documentation technique riche et historique Git lisible par jalons.

## Faiblesses et risques avant ouverture publique

- Pas de vue unifiée santé/erreurs/latence par serveur ; les `console.*` ne suffiront pas au support public.
- Onboarding dépend encore de connaissances implicites : invitation, permissions, Gateway, intents, première configuration.
- Les modules existent mais ne forment pas encore un catalogue activable avec prérequis et état de santé explicites.
- Rate limits et cooldowns KV à cohérence éventuelle ; absence de quotas globaux et de politique d’abus documentée.
- Événements Gateway parfois « best effort » : une indisponibilité Worker peut produire une perte silencieuse.
- Couverture de tests concentrée sur le Worker ; peu de garde-fous automatisés sur Gateway, panel et parcours OAuth.
- Bundle panel monolithique ; coût initial inutile pour les administrateurs n’utilisant qu’un module.
- Déploiement multi-composants manuel et sensible à l’ordre.
- Pas de page publique, statut, documentation utilisateur structurée ni canal de feedback intégré.
- Les intents privilégiés et l’accès au contenu des messages deviendront un sujet de conformité à l’approche des seuils publics Discord.

## Lecture concurrentielle et opportunités

Consultation approximative : **13 juillet 2026**, principalement à partir de documentations et sites officiels.

- [Dyno](https://docs.dyno.gg/) met en avant dashboard simple, modules documentés, guides, releases et support ; son automod et ses commandes couvrent les attentes de base. Opportunité : être plus transparent sur la santé et plus guidé lors de la configuration.
- [Carl-bot](https://docs.carl.gg/) confirme que réaction-rôles, logs, automod, tags/triggers, suggestions et starboard sont devenus des standards. Opportunité : proposer une composition plus claire plutôt qu’une liste sans fin.
- [MEE6](https://help.mee6.xyz/support/solutions/articles/101000385394-getting-started-with-mee6) structure le produit en plugins activables et maîtrise très bien le parcours dashboard ; plusieurs capacités avancées sont premium. Opportunité : offrir gratuitement les fondations administratives, sans reproduire la fragmentation commerciale.
- [Ticket Tool](https://docs.tickettool.xyz/) montre la profondeur attendue d’un vrai produit ticket : formulaires, assignation, permissions, transcripts, statistiques, dépannage et dashboard. Opportunité : une version plus sobre, privée et gratuite des workflows essentiels.
- [YAGPDB](https://yagpdb.xyz/) se différencie par la puissance de ses commandes et automatismes, au prix d’une forte complexité. Opportunité : rendre un moteur comparable accessible visuellement et avec garde-fous.
- [ProBot](https://probot.io/) valorise fortement présentation publique, onboarding, accueil visuel, rôles et niveaux. Opportunité : mieux expliquer la valeur du bot avant même la connexion.
- Sapphire reste pertinent comme référence de bot polyvalent, mais les informations officielles indexables étaient insuffisantes pour comparer précisément ses limites gratuites/premium ; aucune conclusion forte n’en est tirée.
- Discord exige la [vérification des applications au-delà de 100 serveurs](https://support-dev.discord.com/hc/en-us/articles/23926564536471-How-Do-I-Get-My-App-Verified) et renforce les exigences autour des données serveur et intents. Ce jalon doit être préparé avant de l’atteindre.

Fonctions désormais indispensables : onboarding, modules activables, automod/logs, rôles, commandes, sauvegarde, documentation et support. Fonctions surestimées à ce stade : IA générative payante, économie complexe, mini-jeux nombreux et personnalisation cosmétique lourde. L’avantage réaliste est une administration fiable et composable, pas une course au catalogue.

## Les 10 propositions principales

### 1. Observabilité, SLO et diagnostic par serveur — 94/100

**Problème.** Les logs sont dispersés entre Worker et Gateway, sans corrélation, métriques métier ni vue de santé. Un incident public serait détecté tard et difficile à attribuer.

**Solution.** Définir un identifiant de corrélation, des événements structurés et anonymisés, quelques compteurs agrégés D1/KV, un endpoint santé interne et une page panel « Santé ». Mesurer commandes, erreurs Discord/Worker, files en attente, heartbeat, latence et versions déployées. Aucun SaaS requis.

- **Utilisateur :** messages de panne clairs et statut par module.
- **Technique :** diagnostic rapide, SLO simples et preuve avant optimisation.
- **Priorité / note :** débloque toutes les décisions suivantes avec un risque contenu ; 94, car valeur transversale très forte.
- **Difficulté :** intermédiaire. **Migration D1 :** probable, petite table d’agrégats/événements bornés.
- **Estimation :** audit/conception 1–2 j ; développement 4–6 j ; tests 2–3 j ; documentation 1–2 j ; **total 8–13 j**.
- **Risques / rallonges :** cardinalité excessive, données personnelles dans les logs, définition imprécise des SLO.
- **Indicateurs :** ≥95 % des erreurs corrélables à un module/guilde ; temps médian de diagnostic <15 min ; tableau santé chargé <1 s hors réseau.
- **Croissance / freemium :** fondation essentielle jusqu’à plusieurs centaines de serveurs. Santé de base gratuite ; historique long éventuellement premium. Prévoir rétention/quota, pas un système de paiement.

### 2. Socle de sécurité publique multi-tenant — 92/100

**Problème.** Le socle est sérieux, mais les limites KV sont best effort, les permissions demandées et chemins sensibles ne sont pas audités comme un produit public, et il manque une politique d’abus/quota explicite.

**Solution.** Threat model documenté ; inventaire des permissions/intents minimaux ; CSRF/origin review ; rotation/révocation de sessions ; quotas par guilde/utilisateur ; protection renforcée des endpoints internes ; journal d’actions panel ; tests d’isolation et scénarios IDOR systématiques ; préparation vérification Discord et pages confidentialité/conditions.

- **Utilisateur :** confiance, permissions compréhensibles et actions traçables.
- **Technique :** défense en profondeur et réduction du risque multi-tenant.
- **Priorité / note :** doit précéder l’invitation publique ; 92, malgré un bénéfice moins visible.
- **Difficulté :** intermédiaire. **Migration D1 :** probable pour audit de sécurité/session, avec rétention courte.
- **Estimation :** audit/conception 2–3 j ; développement 3–6 j ; tests 2–3 j ; documentation 1–2 j ; **total 8–14 j**.
- **Risques / rallonges :** faux positifs de quota, déconnexion d’utilisateurs, exigences Discord évolutives.
- **Indicateurs :** 100 % des routes mutantes couvertes par matrice permission ; aucun échec d’isolation aux tests ; permissions d’installation justifiées une par une.
- **Croissance / freemium :** sécurité et audit minimal toujours gratuits. Rétention longue/export d’audit pourrait devenir premium ; prévoir une politique de rétention, jamais une sécurité à deux vitesses.

### 3. Onboarding guidé et centre des modules — 91/100

**Problème.** Après OAuth, l’administrateur doit comprendre seul quels modules nécessitent Gateway, salons, rôles ou intents. Cela crée des abandons et des configurations partielles.

**Solution.** Page publique sobre, invitation avec permissions minimales expliquées, checklist de première installation, détection automatique des prérequis, presets « communauté », « modération » et « support », puis centre des modules affichant activé/désactivé, santé, dépendances et raccourci de configuration.

- **Utilisateur :** serveur opérationnel en quelques minutes, sans lire l’architecture.
- **Technique :** configurations cohérentes et moins de tickets support.
- **Priorité / note :** condition directe de croissance ; 91 grâce au fort ratio valeur/risque.
- **Difficulté :** intermédiaire. **Migration D1 :** légère pour progression/preset, ou aucune en première itération.
- **Estimation :** audit/conception 1–2 j ; développement 5–8 j ; tests 2–3 j ; documentation 1–2 j ; **total 9–15 j**.
- **Risques / rallonges :** permissions Discord variables, presets trop prescriptifs, cas sans Gateway.
- **Indicateurs :** installation → première configuration réussie ≥70 % ; temps médian <10 min ; baisse des serveurs sans module configuré.
- **Croissance / freemium :** onboarding et modules de base gratuits. Presets avancés éventuellement premium ; stocker des capacités, pas des conditions commerciales dans les pages.

### 4. Livraison fiable Gateway → Worker — 88/100

**Problème.** Certains événements sont tamponnés puis abandonnés après échec. Une coupure Worker ou réseau peut perdre logs vocaux, statistiques ou événements sans possibilité de reprise.

**Solution.** File locale bornée sur le VPS, événements idempotents avec identifiant, retry exponentiel avec jitter, dead-letter minimale, backpressure et métriques. Conserver le Worker comme seul écrivain D1 ; ne pas introduire de broker payant.

- **Utilisateur :** logs et XP cohérents malgré une panne courte.
- **Technique :** découplage, reprise contrôlée et visibilité sur les pertes.
- **Priorité / note :** très forte fiabilité, mais complexité de concurrence ; 88.
- **Difficulté :** élevée. **Migration D1 :** possible pour clés d’idempotence, bornées par TTL/purge.
- **Estimation :** audit/conception 2–3 j ; développement 5–9 j ; tests 3–4 j ; documentation 1–2 j ; **total 11–18 j**.
- **Risques / rallonges :** doublons, ordre des événements, disque VPS plein, reprise après crash.
- **Indicateurs :** aucune perte lors d’une simulation de panne 10 min ; doublons appliqués = 0 ; file revenue à zéro après reprise.
- **Croissance / freemium :** entièrement gratuit et structurel ; les garanties supérieures ne doivent pas devenir premium.

### 5. Gouvernance des modules et capacités — 87/100

**Problème.** Les réglages « enabled » sont dispersés et les prérequis ne forment pas un contrat commun. Ajouter des modules augmentera les branches et incohérences.

**Solution.** Registre partagé des modules : état, dépendances, intents, permissions, santé, commandes, quotas et version de config. Exposer un DTO unique au panel et au Gateway. Prévoir des `capabilities`/entitlements neutres sans facturation.

- **Utilisateur :** sait exactement ce qui fonctionne et pourquoi.
- **Technique :** architecture modulaire et extensible sans `if` commerciaux dispersés.
- **Priorité / note :** prépare croissance et automation ; 87 pour son effet structurant.
- **Difficulté :** intermédiaire. **Migration D1 :** probable pour états/modules et versions.
- **Estimation :** audit/conception 2 j ; développement 4–7 j ; tests 1–3 j ; documentation 1–2 j ; **total 8–14 j**.
- **Risques / rallonges :** migration des états actuels, dépendances circulaires, double source de vérité.
- **Indicateurs :** 100 % des modules décrits par le registre ; aucun module actif avec prérequis manquant non signalé ; ajout d’un module sans modification du shell panel.
- **Croissance / freemium :** capacités essentielles gratuites ; quotas/entitlements futurs possibles. Séparer capacité technique, plan et affichage pour éviter une refonte.

### 6. Studio d’automatisations Discord — 86/100

**Problème.** Le moteur conditions/actions est puissant mais limité aux commandes personnalisées. YAGPDB prouve la valeur de l’automatisation, tout en montrant le coût UX d’un langage complexe.

**Solution.** Étendre progressivement le moteur existant à des déclencheurs sûrs : membre rejoint, rôle ajouté, message signalé, horaire, niveau atteint, ticket créé. Éditeur visuel, templates, simulation, limites strictes, journal d’exécution et coupe-circuit. Première version avec 3–4 déclencheurs et actions existantes.

- **Utilisateur :** adapte le bot à son serveur sans code ni dix bots spécialisés.
- **Technique :** réutilisation du moteur, modèle unifié d’automatisation.
- **Priorité / note :** vraie différenciation, mais seulement après observabilité/sécurité/modules ; 86.
- **Difficulté :** élevée. **Migration D1 :** oui, workflows, révisions, exécutions agrégées et tâches planifiées.
- **Estimation :** audit/conception 3–5 j ; développement 9–15 j ; tests 4–6 j ; documentation 2–4 j ; **total 18–30 j**.
- **Risques / rallonges :** boucles, spam, permissions, langage trop complexe, migrations du moteur actuel.
- **Indicateurs :** ≥30 % des serveurs actifs créent un workflow ; taux d’exécution réussi ≥99 % hors erreurs Discord ; zéro boucle non bornée.
- **Croissance / freemium :** templates et quota généreux gratuits ; volumes/nombre de workflows éventuellement premium. Introduire dès le départ compteurs et limites configurables.

### 7. Budgets performance et coût — 84/100

**Problème.** Le projet possède caches et index, mais pas de budgets mesurés. Le panel charge près de 1 Mo de JS et les rate limits Discord sont coordonnés seulement localement avec un retry unique.

**Solution.** Budgets p95 par route, comptage D1/Discord, revue `EXPLAIN QUERY PLAN`, cache stampede protection, pagination systématique, chargement paresseux des pages/graphiques, séparation Recharts, et coordinateur de rate limit Discord simple entre Worker/Gateway.

- **Utilisateur :** panel et commandes plus rapides, surtout mobile.
- **Technique :** croissance sans surprise sur le free tier.
- **Priorité / note :** gains probables et mesurables après proposition 1 ; 84.
- **Difficulté :** intermédiaire. **Migration D1 :** seulement si de nouveaux index sont prouvés nécessaires.
- **Estimation :** audit/conception/profilage 2–3 j ; développement 3–5 j ; tests 1–2 j ; documentation 1–2 j ; **total 7–12 j**.
- **Risques / rallonges :** optimisation sans données, invalidation de cache, complexité du rate limit global.
- **Indicateurs :** JS initial gzip <180 kB ; p95 des lectures panel <500 ms côté Worker ; baisse mesurée des appels Discord redondants ≥30 %.
- **Croissance / freemium :** entièrement structurel et gratuit ; aucun traitement prioritaire payant à prévoir maintenant.

### 8. Sauvegarde, restauration et journal de configuration — 81/100

**Problème.** Les changements sont validés et révisés pour les commandes, mais une erreur d’administration globale reste difficile à annuler ou transférer.

**Solution.** Snapshots versionnés des réglages, diff lisible, restauration sélective avec aperçu, export JSON signé/validé et import entre serveurs avec remappage explicite des rôles/salons. Commencer par config, automod, accueil et niveaux.

- **Utilisateur :** expérimente sans peur et réplique une configuration.
- **Technique :** support et rollback plus simples.
- **Priorité / note :** avantage concurrentiel tangible, après registre de modules ; 81.
- **Difficulté :** intermédiaire. **Migration D1 :** oui, snapshots bornés et métadonnées.
- **Estimation :** audit/conception 2 j ; développement 4–7 j ; tests 1–3 j ; documentation 1–2 j ; **total 8–14 j**.
- **Risques / rallonges :** IDs Discord non portables, secrets/webhooks, taille des snapshots, restauration partielle.
- **Indicateurs :** restauration réussie sur 100 % des jeux de test ; snapshot <100 kB par guilde ; opération réversible en moins de 2 min.
- **Croissance / freemium :** dernières versions gratuites ; historique long/transfert avancé éventuellement premium. Versionner le schéma d’export dès le début.

### 9. Tickets d’équipe : formulaires, assignation et SLA simple — 79/100

**Problème.** Les tickets actuels couvrent ouverture, fermeture et transcript, mais pas le triage d’équipe attendu d’un serveur public ou support.

**Solution.** Formulaire Discord configurable, catégories de motif, assignation/retrait, états ouvert/en attente/fermé, priorité simple, rappels et statistiques agrégées. Transcripts à rétention explicite, sans stockage externe obligatoire.

- **Utilisateur :** support organisé sans Ticket Tool séparé.
- **Technique :** workflow métier cohérent et mesurable.
- **Priorité / note :** forte valeur pour certains serveurs, moins universelle ; 79.
- **Difficulté :** élevée. **Migration D1 :** oui, champs, formulaires, assignations et événements.
- **Estimation :** audit/conception 2–3 j ; développement 7–12 j ; tests 3–4 j ; documentation 1–3 j ; **total 13–22 j**.
- **Risques / rallonges :** permissions Discord, confidentialité des transcripts, explosion des options, migrations de tickets ouverts.
- **Indicateurs :** temps médian avant assignation mesurable ; ≥95 % des tickets classés ; aucune fuite d’accès dans les tests de permissions.
- **Croissance / freemium :** workflow essentiel gratuit ; plusieurs formulaires, historique/statistiques longs éventuellement premium. Prévoir quotas et politiques de rétention par guilde.

### 10. Analytics produit respectueuses de la vie privée — 76/100

**Problème.** Aucun signal fiable n’indique quels modules créent de la valeur, où l’onboarding échoue ou pourquoi un serveur désinstalle le bot.

**Solution.** Événements agrégés sans contenu : installation, module activé, configuration réussie, commande réussie/échouée, désinstallation et feedback volontaire. Dashboard interne minimal, opt-out et rétention courte. Ajouter un lien de feedback et une enquête de départ facultative.

- **Utilisateur :** améliorations guidées par ses difficultés réelles.
- **Technique :** priorisation fondée sur des faits.
- **Priorité / note :** utile après observabilité et onboarding ; 76 en raison du risque vie privée et de l’échelle actuelle.
- **Difficulté :** intermédiaire. **Migration D1 :** oui, agrégats journaliers sans contenu.
- **Estimation :** audit/conception 1–2 j ; développement 3–5 j ; tests 1–2 j ; documentation 1–2 j ; **total 6–11 j**.
- **Risques / rallonges :** surcollecte, interprétation de petits échantillons, conformité et consentement.
- **Indicateurs :** ≥80 % des parcours d’onboarding mesurables de bout en bout ; 0 contenu de message/PII dans les événements ; feedback exploitable de ≥10 % des désinstallations volontaires.
- **Croissance / freemium :** instrumentation produit gratuite et interne ; statistiques serveur avancées éventuellement premium. Garder analytics produit et données client strictement séparées.

## 5 éléments de backlog validés

### Alternative A — Suggestions et votes communautaires — 78/100

Module de propositions avec statuts, votes, threads et réponse staff. Valeur forte pour communautés, coût estimé 8–14 j, migration D1 probable. À envisager après onboarding et analytics si les serveurs communautaires confirment le besoin.

### Alternative B — Tâches planifiées, rappels et giveaways sobres — 82/100

Construire d’abord la brique `scheduled_tasks`, puis rappels et giveaway vérifiable. Le moteur est intégré comme prérequis C2.0 du studio ; les giveaways restent un élément de backlog distinct.

### Alternative C — Base de connaissances et réponses FAQ sans IA payante — 74/100

FAQ administrée, recherche plein texte simple et réponses par commande/bouton ; option locale de similarité seulement si gratuite. Réduit les tickets sans envoyer de contenu à un tiers. 7–13 j, migration D1 probable, à prioriser selon les motifs de support.

### Alternative D — Internationalisation français/anglais — 73/100

Catalogue de messages partagé, locale par guilde et panel bilingue. Nécessaire pour un vrai public international mais coûteux à maintenir tant que le produit évolue vite : 10–18 j. À engager après stabilisation de l’UX d’onboarding.

### Alternative E — Réputation et saisons d’engagement — 71/100

Compléter l’XP par `/rep`, saisons, classement périodique et récompenses contrôlées. 8–15 j, migration D1 probable. À engager seulement si les analytics confirment l’adoption durable du module Niveaux.

## Dépendances et ordre d’implémentation

```text
A1 Observabilité ─┬─> A4 Performance ─┐
                  ├─> A2 Sécurité ─────┼─> B1 Livraison fiable
                  └────────────────────┘
A2 Sécurité ──> A3 Gouvernance modules ──> B2 Onboarding ──> B3 Sauvegarde
                                            └──────────────> B4 Analytics
B1 + B3 ──> C1 Tickets
A1..A4 + B1 + B3 + B4 ──> C2.0 Scheduler ──> C2 Studio
```

Ordre technique validé : **Observabilité → Sécurité → Gouvernance modules → Performance → Livraison fiable → Onboarding → Sauvegarde → Analytics → Tickets → Studio**. Ce séquencement diffère du classement de valeur afin de respecter les dépendances. Le scheduler est traité comme sous-phase C2.0 du studio, ou comme milestone autonome si son incrément dépasse 5–7 jours.

## Roadmap

### Phase A — Fondations

1. Observabilité/SLO et santé par serveur.
2. Threat model, permissions minimales, quotas et tests multi-tenant.
3. Registre de modules/capacités et états de santé.
4. Premiers budgets de performance et lazy-loading du panel.

### Phase B — Fiabilité et croissance

1. Livraison fiable Gateway → Worker.
2. Onboarding guidé, invitation, centre modules et première configuration.
3. Sauvegarde/restauration des configurations.
4. Analytics produit minimales et consenties.

### Phase C — Fonctionnalités avancées

1. Tickets d’équipe avancés.
2. C2.0 socle de tâches planifiées, puis studio d’automatisations limité et sûr.

## Recommandation finale

### Première priorité : observabilité, SLO et diagnostic par serveur

Elle doit passer avant les autres parce que le projet ne possède pas encore les mesures permettant de distinguer une optimisation utile, une régression, un problème Discord ou une panne Gateway. Elle débloque la sécurité opérationnelle, la résilience, les budgets de performance et des décisions produit crédibles.

- **Risque :** faible à moyen, surtout confidentialité et cardinalité.
- **Coût :** 8–13 jours assistés, validations humaines incluses.
- **Prérequis :** définir les données interdites, la rétention et cinq SLO maximum.
- **Fiche prête :** [01-observabilite-slo.md](./01-observabilite-slo.md), avec prompt spécifique, migrations réversibles, tests et rollback.

### Deuxième priorité : socle de sécurité publique multi-tenant

Elle réduit le risque le plus coûteux avant d’autoriser des administrateurs inconnus à utiliser le panel et les routes mutantes.

### Troisième priorité technique : gouvernance des modules et capacités

Elle fournit le contrat stable dont dépendront le centre des modules, les quotas, la sauvegarde et le studio. L’onboarding reste la troisième priorité produit visible, mais vient après ce socle dans l’ordre de développement.

## Statut de validation

Phase 2 documentée. Aucune milestone n’est autorisée à l’implémentation par cette validation globale : chaque démarrage exige sa propre branche, son plan, ses validations, son déploiement séparé et une observation avant la suivante.
