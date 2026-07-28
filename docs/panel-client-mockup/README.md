# Maquette locale — panel client Archodev

Maquette autonome de Phase 2. Elle ne charge aucune ressource externe, ne fait
aucun appel réseau et ne dépend pas du code de `packages/panel`.

## Ouvrir la maquette

Ouvrir directement `index.html` dans un navigateur moderne. Les paramètres
locaux suivants permettent d'ouvrir une vue précise :

- `?view=landing`
- `?view=dashboard`
- `?view=roles`
- `?view=dashboard&search=1`
- `?view=dashboard&drawer=1`
- `?view=roles&dirty=1`
- `?view=roles&gateway=error`
- `?view=charts`

## Interactions

- navigation et groupes repliables de la sidebar ;
- sidebar compacte à 1024 px et drawer à 390 px ;
- recherche globale au clic ou avec `Ctrl/Cmd + K` ;
- navigation des résultats avec les flèches et Entrée ;
- fermeture avec Échap et restitution du focus ;
- changement de période 7/30/90 jours ;
- tooltips au survol des points du graphique ;
- édition en direct du message de rôles ;
- état non enregistré, réinitialisation et sauvegarde simulée ;
- publication simulée et panne Gateway simulée ;
- toasts locaux sans mutation ni appel API.

Toutes les métriques et activités présentées sont des données de démonstration.
