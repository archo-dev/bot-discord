# Audit d'accessibilité

## Résultat final

Le passage final sur les 36 routes, leurs rechargements et les configurations responsive relève :

- 0 contrôle interactif visible sans nom accessible ;
- 0 identifiant DOM dupliqué ;
- 0 titre principal vide sur les routes normales ;
- une page 404 globale annoncée par `h1` et une page 404 serveur annoncée dans la hiérarchie du shell ;
- 0 overlay hors écran.

## Clavier et focus

Contrôles réussis :

- ouverture du drawer au clavier, focus placé à l'intérieur ;
- fermeture par Échap, restitution du focus au déclencheur ;
- ouverture de la recherche par `Ctrl+K` (`Cmd+K` géré par le même raccourci) ;
- saisie focalisée, résultats groupés, navigation avec Entrée ;
- fermeture de la recherche par Échap et restitution du focus ;
- navigation persistante vers le résultat Rôles ;
- focus visibles définis sur liens, boutons, formulaires et actions compactes ;
- régions de tableaux défilables atteignables au clavier.

## Sémantique et annonces

- Titres structurés ; corrections spécifiques ajoutées aux pages introuvables.
- `aria-current` sur les destinations actives de navigation.
- `aria-expanded`, `aria-controls` et `inert` sur groupes repliables et drawer.
- `aria-live` sur annonces d'éditeur, toasts et changements utiles.
- `fieldset disabled` pour les espaces en lecture seule.
- Champs autonomes de configuration, filtres et contexte JSON nommés explicitement.
- Modales et drawer bornés, titrés, avec gestion du focus.
- Erreurs et états opérationnels utilisent texte, rôle et icône : aucune information critique ne dépend uniquement de la couleur.
- `prefers-reduced-motion: reduce` reconnu par le navigateur.
- Zoom 200 % sans perte ni débordement global.

## Corrections du Lot 8

L'audit initial a détecté des champs sans nom accessible dans Config, Accès panel, Niveaux, Auto-mod, Sanctions, Logs vocaux et l'éditeur d'automatisation. Les primitives Combobox/EntitySelect acceptent maintenant un nom ARIA explicite et chaque appel concerné le fournit.

Un favori Rôles dupliquait l'identifiant `nav-tooltip-roles` de son entrée principale. Le favori utilise désormais un scope d'infobulle distinct. La page 404 globale, auparavant sans heading, dispose maintenant d'un `h1` réservé aux technologies d'assistance.

Des tests statiques de non-régression ont été ajoutés. Après correction : 0 champ sans nom, 0 identifiant dupliqué et heading 404 présent.

## Limite de l'audit

Le dépôt ne fournit pas de commande axe/Pa11y ni de moteur automatique de contraste. Les contrastes ont donc été vérifiés par inspection des tokens et des captures, en complément des états textuels. Un passage manuel avec lecteur d'écran réel reste une bonne vérification pré-déploiement, sans constituer un blocage identifié.

Traces : `browser-route-audit.json`, `browser-responsive-audit.json` et `browser-interaction-audit.json`.
