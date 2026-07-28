# Lot 6 — matrice d’audit des états UX

Cette matrice a été établie avant modification à partir des branches TanStack Query, des mutations, des contrôles d’accès et des composants réellement présents. Elle sert de garde-fou : `—` signifie que l’état ne s’applique pas à la page, et non qu’une fonctionnalité manque.

Légende : `OK` = explicite et persistant ; `P` = partiel ou source secondaire silencieuse ; `T` = toast seul ; `S` = silencieux ; `—` = sans objet.

## Avant Lot 6

| Page / zone | Chargement | Vide | Lecture | Mutation | Permission | Gateway | Quota | Dirty state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | OK | P | OK | — | OK | OK | — | — |
| Configuration | OK | — | OK | OK | P | P | — | OK |
| Commandes | OK | OK | OK | OK | P (module) | OK | OK | — |
| Éditeur Commande | OK | P | P (sources) | OK | OK | OK | OK | OK |
| Automatisations | OK | OK | P (stats/module) | OK | P (module) | OK | — | — |
| Éditeur Automatisation | OK | P | P (sources/révisions) | T (simulation) | OK | OK | — | OK |
| Rôles | OK | OK | OK | OK | OK | OK | — | OK |
| Bienvenue | OK | P | P (salons/module) | OK | OK | OK | — | OK |
| Starboard | OK | P | P (salons/module) | OK | OK | OK | — | OK |
| Tickets | OK | OK | P (module/session) | OK | OK | OK | P | OK |
| Musique | OK | OK | P (module/salons) | T | OK | OK | P | — |
| Auto-modération | OK | — | S | OK | P | P | — | OK |
| Niveaux | OK | OK | S (réglages/classement/rôles) | OK | P | P | — | OK |
| Vocaux temporaires | OK | — | S | OK | P | P | P | OK |
| Modules | OK | OK | OK | OK | OK | P | — | — |
| Sauvegardes / import | OK | OK | P (références) | T | P | — | — | choix local |
| Accès panel | OK | — | P (403 seul) | OK | P (admin) | — | — | OK |
| Confidentialité | OK | — | OK | T | P | — | — | message local |
| Sanctions / historique | OK | OK | OK | T | OK | — | OK | local |
| Logs vocaux | OK | OK | P (salons) | — | — | implicite | — | — |
| Santé / Stats / Audit | OK | OK | OK | — | OK | OK | — | — |
| Espace client | OK | OK | OK | OK | — | — | OK | local |
| Pages publiques | OK | OK | OK | — | — | — | — | — |

Les écarts prioritaires étaient donc les lectures silencieuses des quatre pages historiques, les sources secondaires des éditeurs/workspaces, les capacités de module inconnues traitées comme autorisées, les erreurs critiques d’import/preset/confidentialité affichées uniquement en toast et les doublons toast local + toast global.

## Après Lot 6

| Page / zone | Chargement | Vide | Lecture | Mutation | Permission | Gateway | Quota | Dirty state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | OK | OK | OK, blocs isolés | — | OK | OK | — | — |
| Configuration | OK | — | OK | OK, local | OK | explicite si utile | — | OK |
| Commandes | OK | OK, action réaliste | OK, capacités locales | OK | OK, fail-safe | OK | OK, usage/limite | — |
| Éditeur Commande | OK | OK | OK + retry par source | OK, brouillon conservé | lecture/Discord distincts | impact + diagnostic | limite technique distincte | OK |
| Automatisations | OK | OK | OK, stats/module locales | OK | OK, fail-safe | OK | — | — |
| Éditeur Automatisation | OK | OK | OK + retry par source | OK, simulation brève | lecture/Discord distincts | impact + diagnostic | — | OK |
| Rôles | OK | OK | OK | OK, SaveBar | OK | non requise | — | OK |
| Bienvenue | OK | OK | OK, salons/module locaux | OK, SaveBar | OK, fail-safe | sauvegarde autorisée | — | OK |
| Starboard | OK | OK | OK, salons/module locaux | OK, SaveBar | OK, fail-safe | sauvegarde autorisée | — | OK |
| Tickets | OK | OK | OK, module/session locaux | OK, SaveBar + temps réel | OK, fail-safe | non requise | limite décrite sans usage inventé | OK |
| Musique | OK | OK | OK, dernier état conservé | toast bref, sans doublon | lecture seule distincte | actions bloquées + diagnostic | limite décrite sans usage inventé | — |
| Auto-modération | OK | — | OK + retry | OK, brouillon conservé | lecture seule explicite | impact séparé, sauvegarde autorisée | — | OK |
| Niveaux | OK | OK, cause/action | OK + retry par bloc | OK, brouillon conservé | lecture seule explicite | collecte interrompue, sauvegarde autorisée | — | OK |
| Vocaux temporaires | OK | — | OK + retry | OK, brouillon conservé | lecture seule explicite | impact séparé, sauvegarde autorisée | limite technique du formulaire | OK |
| Modules | OK | OK | OK | OK, double clic borné | prérequis détaillés | impact + diagnostic | raison registre | — |
| Sauvegardes / import | OK | OK, action selon accès | OK + retry | erreur persistante, choix conservés | lecture seule explicite | — | rétention réelle | choix local conservé |
| Accès panel | OK | — | OK + retry | OK, SaveBar | administrateur requis distinct | — | — | OK |
| Confidentialité | OK | — | OK + retry | erreur persistante, message conservé | lecture seule explicite | — | — | message local conservé |
| Sanctions / historique | OK | OK | OK | toast bref pour action temps réel | OK | — | quota serveur explicite | local |
| Logs vocaux | OK | OK, cause/action | OK + retry local | — | — | dépendance expliquée | — | — |
| Santé / Stats / Audit | OK | OK, cause/action | OK + retry | — | admin distinct | états détaillés | — | — |
| Espace client | OK | OK | OK + retry | erreur persistante selon criticité | — | — | plan distinct | local conservé |
| Pages publiques | OK | OK | OK + retry | — | — | — | — | — |

## Règles finales

- Une erreur de lecture reste dans la zone concernée, avec un message français, un retry et uniquement une référence de diagnostic non sensible quand elle existe.
- Une capacité de module inconnue n’est jamais assimilée à une autorisation d’écriture.
- La lecture seule vient du rôle panel ; la permission insuffisante vient d’un prérequis Discord ou du registre ; l’accès administrateur requis est présenté séparément.
- Une Gateway hors ligne décrit l’impact temps réel sans bloquer une sauvegarde de configuration qui ne dépend pas d’elle.
- Un quota indique sa nature, l’usage et la limite uniquement lorsqu’ils sont disponibles ; aucun prix ou usage n’est inventé.
- La SaveBar est réservée aux brouillons persistants. Les actions temps réel utilisent un retour bref et ne créent jamais de dirty state.
- Les toasts ne portent plus seuls une erreur de sauvegarde, d’import, de permission, de quota ou de perte potentielle de données.
