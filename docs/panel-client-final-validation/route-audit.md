# Audit des routes

## Résultat

- 36 routes déclarées.
- 72 passages sur ces routes : accès direct puis rechargement.
- 3 contrôles additionnels : redirection historique, 404 globale et 404 serveur.
- Total : **75 contrôles**, tous réussis.
- 0 chemin final inattendu, 0 débordement global, 0 boundary inattendue, 0 contrôle sans nom accessible, 0 identifiant dupliqué.
- L'ancienne route `/guilds/:guildId/modlog` redirige vers `/guilds/:guildId/sanctions`.
- Aucune occurrence visible de « Engagement ».

Les routes Onboarding et Modules sont volontairement des destinations secondaires recherchables, mais ne sont pas des entrées primaires de sidebar : elles n'exposent donc pas `aria-current` dans la navigation principale. Leur chemin, leur titre et leur contenu sont corrects.

## Routes vérifiées

`G` représente `/guilds/:guildId`.

| Zone | Route | Résultat |
|---|---|---|
| Public | `/` | OK |
| Public | `/features` | OK |
| Public | `/pricing` | OK |
| Public | `/updates` | OK |
| Public | `/updates/panel-client-v2` | OK |
| Public | `/status` | OK |
| Public | `/legal/mentions` | OK |
| Client | `/app/account` | OK |
| Client | `/app/subscription` | OK |
| Client, flag actif | `/app/billing` | OK |
| Client, flag actif | `/app/support` | OK |
| Serveur | `G` | OK |
| Serveur | `G/onboarding` | OK |
| Serveur | `G/modules` | OK |
| Serveur | `G/health` | OK |
| Serveur | `G/stats` | OK |
| Serveur | `G/audit` | OK |
| Serveur | `G/config` | OK |
| Serveur | `G/access` | OK |
| Serveur | `G/privacy` | OK |
| Serveur | `G/backup` | OK |
| Serveur | `G/welcome` | OK |
| Serveur | `G/roles` | OK |
| Serveur | `G/levels` | OK |
| Serveur | `G/starboard` | OK |
| Serveur | `G/tempvoice` | OK |
| Serveur | `G/automod` | OK |
| Serveur | `G/sanctions` | OK |
| Serveur | `G/apply` | OK |
| Serveur | `G/voicelog` | OK |
| Serveur | `G/tickets` | OK |
| Serveur | `G/commands` | OK |
| Serveur | `G/commands/1` | OK |
| Serveur | `G/automations` | OK |
| Serveur | `G/automations/:automationId` | OK |
| Serveur | `G/music` | OK |

La route légale paramétrée a été exercée avec `mentions`, et la route de mise à jour paramétrée avec un slug publié. Les tests unitaires `public-routes.test.ts`, `public-lazy-routes.test.ts` et `lazy-routes.test.ts` couvrent en complément le routage et l'exposition des chunks différés.

## Profils et feature flags

Douze profils navigateur ont été contrôlés sans débordement ni boundary :

- déconnecté ;
- connecté sans serveur ;
- administrateur ;
- modérateur lecture seule ;
- permission Discord insuffisante ;
- accès serveur refusé ;
- accès administrateur requis ;
- module désactivé ;
- Gateway indisponible ;
- quota de commandes atteint ;
- données vides ;
- erreur de lecture partielle.

Les mutations interdites sont neutralisées par `fieldset`, contrôles désactivés, absence d'action ou état opérationnel. Les flags billing/support ont été exercés actifs dans le smoke navigateur ; leur désactivation et l'absence des routes correspondantes sont couvertes par `flags-panel.test.ts` et `flags.test.ts`.

Traces : `browser-route-audit.json` et `browser-profile-audit.json`.
