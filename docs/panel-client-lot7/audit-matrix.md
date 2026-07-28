# Lot 7 — matrice responsive

Date de validation locale : 28 juillet 2026.

Chaque cellule « OK » signifie que la route a été chargée, que
`document.scrollWidth <= document.clientWidth`, qu’aucun élément visible ne
franchit le viewport et que le contenu principal reste utilisable. Le contrôle
à 200 % utilise un viewport de 1440 px avec un facteur d’échelle 2, soit une
largeur CSS utile de 720 px.

| Route | 1440 | 1280 | 1024 | 768 | 390 | 320 | Zoom 200 % | Problème avant | Correction / état après |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Accueil (`/`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Inchangé, liens et cibles tactiles vérifiés |
| Fonctionnalités (`/features`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Route publique préservée |
| Tarifs (`/pricing`) | OK | OK | OK | OK | OK | OK | OK | Liens secondaires compacts | Cibles tactiles agrandies |
| Mises à jour (`/updates`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Route publique préservée |
| Statut (`/status`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Route publique préservée |
| Compte (`/app/account`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Empilement et textes longs vérifiés |
| Abonnement (`/app/subscription`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Cartes et actions vérifiées |
| Facturation (`/app/billing`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Route conditionnelle auditée avec le flag actif |
| Support (`/app/support`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Route conditionnelle auditée avec le flag actif |
| Vue d’ensemble (`/guilds/:id`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Sidebar, topbar et graphiques validés |
| Onboarding (`/guilds/:id/onboarding`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Toolbar et progression vérifiées |
| Modules (`/guilds/:id/modules`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Grille responsive vérifiée |
| Santé (`/guilds/:id/health`) | OK | OK | OK | OK | OK | OK | OK | Aucun | États Gateway vérifiés |
| Observabilité (`/guilds/:id/stats`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Graphiques, filtres et légendes validés |
| Audit (`/guilds/:id/audit`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Tableau conservé dans un conteneur borné |
| Configuration (`/guilds/:id/config`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Champs, SaveBar et textes longs vérifiés |
| Accès (`/guilds/:id/access`) | OK | OK | OK | OK | OK | OK | OK | Lignes et identifiants trop rigides | Lignes empilables, identifiants cassables, actions tactiles |
| Confidentialité (`/guilds/:id/privacy`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Formulaire et SaveBar vérifiés |
| Sauvegardes (`/guilds/:id/backup`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Liste et actions vérifiées |
| Bienvenue (`/guilds/:id/welcome`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace 3/2/1 colonnes validé |
| Rôles (`/guilds/:id/roles`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace 3/2/1 colonnes et aperçu validés |
| Niveaux (`/guilds/:id/levels`) | OK | OK | OK | OK | OK | OK | OK | Débordement global à 390 et 320 px (533 px) | Classement converti en cartes sous 768 px ; récompenses empilables |
| Starboard (`/guilds/:id/starboard`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace 3/2/1 colonnes validé |
| Vocaux temporaires (`/guilds/:id/tempvoice`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Contrôles et textes longs vérifiés |
| Auto-mod (`/guilds/:id/automod`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Formulaire et actions vérifiés |
| Modération (`/guilds/:id/sanctions`) | OK | OK | OK | OK | OK | OK | OK | Tableau dense sur mobile | Historique converti en cartes sous 768 px |
| Sanctions (`/guilds/:id/apply`) | OK | OK | OK | OK | OK | OK | OK | Tableaux d’avertissements et d’exemptions denses | Cartes membre/rôle sous 768 px |
| Logs vocaux (`/guilds/:id/voicelog`) | OK | OK | OK | OK | OK | OK | OK | Tableau dense sur mobile | Événements convertis en cartes sous 768 px |
| Tickets (`/guilds/:id/tickets`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace et listes mobiles validés |
| Commandes (`/guilds/:id/commands`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace et actions mobiles validés |
| Éditeur de commande (`/guilds/:id/commands/:commandId`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Conditions/actions, déplacements et SaveBar validés |
| Automatisations (`/guilds/:id/automations`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Workspace et listes mobiles validés |
| Éditeur d’automatisation (`/guilds/:id/automations/:automationId`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Blocs, actions et SaveBar validés |
| Musique (`/guilds/:id/music`) | OK | OK | OK | OK | OK | OK | OK | Aucun | Lecteur, file, recherche et contexte Gateway validés |

## Synthèse avant / après

- Avant : 238 combinaisons route/configuration contrôlées ; 2 débordements
  globaux, tous deux sur Niveaux (390 et 320 px).
- Après : aucun débordement global sur les 238 combinaisons. Une mesure
  géométrique de Niveaux à 320 px a été instable pendant la longue passe ;
  la vérification fraîche dédiée confirme `scrollWidth = clientWidth = 320`
  et aucun franchissement de bord.
- Largeurs maximales finales :
  1440/1440, 1280/1280, 1024/1024, 768/768, 390/390, 320/320 et
  720/720 à 200 %.

Les données détaillées sont conservées dans
`browser-audit-before.json`, `browser-audit-after.json`,
`browser-audit-verify.json` et `browser-audit-interactions.json`.
