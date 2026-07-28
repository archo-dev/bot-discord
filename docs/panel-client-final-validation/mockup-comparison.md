# Comparaison maquette / résultat

| Écran | Statut | Constat |
|---|---|---|
| Accueil public | Conforme | Header compact, hero, CTA, aperçu, trois bénéfices et tarifs condensés ; scroll réduit |
| Shell | Conforme | Navigation groupée sans « Engagement », favoris, sidebar compacte et drawer |
| Dashboard | Volontairement différent sur les données indisponibles | Densité et hiérarchie conformes ; les chiffres non soutenus par l'API sont remplacés par « non disponible » ou omis |
| Recherche | Conforme | Palette groupée, raccourci, clavier, Entrée, Échap et focus |
| Graphiques | Conforme | Activité, barres, donut, légendes, périodes et résumés accessibles |
| Rôles | Conforme | Espace trois colonnes, configuration, aperçu et historique de publication |
| Mobile | Conforme | Drawer, cartes, editors empilés, actions et SaveBar utilisables de 320 à 390 px |

## Écarts assumés

- Aucun chiffre de preuve sociale n'est affiché sans source vérifiée.
- Messages 24 h, alertes persistantes, activité récente unifiée et événements métier agrégés ne sont pas recomposés à partir de sous-totaux incomplets.
- Les aperçus de configuration utilisent une projection locale explicitement identifiée ; ils ne prétendent pas refléter un message réellement publié.
- Les états erreur, lecture seule, Gateway indisponible et quota ont priorité sur la similitude avec un écran idéal de maquette.
- Un favori Rôles apparaît dans certaines captures après le contrôle de persistance : il démontre le comportement validé du shell.

Les 23 captures ont été inspectées visuellement. Aucun écart bloquant n'est constaté.
