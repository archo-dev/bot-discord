# Audit responsive

## Matrice

Sept routes représentatives ont été testées sur huit configurations, soit **56 contrôles** :

- accueil public ;
- dashboard ;
- observabilité/graphiques ;
- Rôles ;
- éditeur de commande ;
- Tickets ;
- Musique.

| Configuration | Résultat |
|---|---|
| 1440 px | OK |
| 1280 px | OK |
| 1024 px | OK |
| 768 px | OK |
| 390 px | OK |
| 320 px | OK |
| zoom 200 % — viewport CSS équivalent 720 px | OK |
| paysage mobile 844 × 390 | OK |

## Constats

- 0 scroll horizontal global sur les 56 combinaisons.
- Sidebar complète desktop, compacte tablette et drawer mobile utilisables.
- Overlays contenus dans le viewport dynamique ; ouverture, Échap, verrouillage du body et restitution du focus validés.
- SaveBar empilée sur petit écran et non bloquante.
- Tableaux denses convertis en cartes mobiles ou contenus dans une région défilable au clavier.
- Graphiques redimensionnables et résumés accessibles conservés.
- Cibles partagées adaptées au tactile.
- Noms longs de serveur, salon et rôle tronqués ou renvoyés à la ligne sans élargir la page.
- Aucun écran d'erreur inattendu.

Les 23 captures finales complètent la matrice, notamment le dashboard tablette/mobile, Rôles mobile, SaveBar mobile et zoom 200 %.

Trace : `browser-responsive-audit.json`.
