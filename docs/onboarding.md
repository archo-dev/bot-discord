# Onboarding guidé et centre des modules (M06)

Parcours public de la découverte à la première valeur : vitrine → invitation → panel →
checklist → presets → centre des modules. Tout l'état de la checklist est **dérivé** du
registre de modules M03 (`docs/modules.md`) ; M06 n'ajoute aucune logique de prérequis
propre, seulement la progression que l'on ne peut pas dériver.

## 1. Parcours d'installation

1. **Vitrine** — `GET /` (non authentifié) affiche la landing : proposition de valeur,
   modules, note de confidentialité et bouton d'invitation.
2. **Invitation** — construite côté serveur (`GET /api/invite`, publique). Scopes
   `bot applications.commands`, permissions **minimales** (voir §2), jamais Administrateur.
3. **Connexion panel** — `GET /auth/login` (OAuth `identify guilds`).
4. **Prise en main** — page `/(guilds)/:id/onboarding` : barre de progression, presets,
   checklist à liens profonds, carte de ré-invitation.
5. **Centre des modules** — page `/(guilds)/:id/modules` (M03) : activation à la carte,
   états et diagnostics.

La table `guilds` se remplit à la première interaction du bot (ex. `/ping`) ; un serveur
invité mais jamais sollicité n'apparaît pas encore dans le panel (cf. `CLAUDE.md` piège 5).

## 2. Permissions demandées

L'invitation demande l'**union des permissions requises par tous les modules**, pour ne
jamais avoir à ré-inviter en activant un module plus tard. Chaque permission est justifiée
par les modules qui en dépendent (`invitePermissionUsage`, exposée dans
`OnboardingResponse.invite.usage`). Le bitfield est calculé depuis
`MODULE_DEFINITIONS[].requiredPermissions` via `invitePermissionBitfield()` — aucune
permission n'est codée en dur, et le bit Administrateur n'est **jamais** demandé.

Si un module signale « Permission absente », l'admin ré-invite via la carte de la page de
prise en main (invite ciblée `guild_id`), sans réinstaller.

## 3. Prérequis Gateway / intents

- Les modules temps réel (`gateway: "required"` : accueil, auto-mod, niveaux, starboard,
  vocaux temporaires, logs vocaux, stats) restent **configurables** hors ligne mais ne
  s'activent qu'avec la Gateway connectée.
- Les intents privilégiés (`GuildMembers`, `MessageContent`, `Presence`) doivent être
  activés dans le Dev Portal (cf. `CLAUDE.md` piège 7). L'état runtime réel (intents +
  permissions manquantes) est remonté par la Gateway (`GatewayModuleRuntimeResponse`) et
  reflété dans la checklist ; hors ligne, l'activation est prudente et bloquée.

## 4. Presets de démarrage

Trois presets (`packages/shared/src/onboarding.ts`) **activent uniquement** un ensemble de
modules — ils n'écrivent aucun salon/rôle et ne désactivent jamais rien :

| Preset | Modules activés |
|---|---|
| **Communauté** | welcome, levels, starboard, temp_voice, button_roles |
| **Modération** | automod, tickets, voice_logs |
| **Support** | tickets, welcome, custom_commands |

Application : `POST /api/guilds/:id/onboarding/preset`.

- `{ preset, dryRun: true }` → **aperçu** (`OnboardingPresetPreview`) : chaque module est
  classé `enable` / `already_enabled` / `blocked` (avec la raison). Aucune écriture.
- `{ preset }` → **application transactionnelle** : un seul `DB.batch` bascule les modules
  activables + enregistre le preset et la complétion. Les modules dont les prérequis
  échouent sont **ignorés** et listés dans `skipped`, jamais forcés. Rien hors du preset
  n'est modifié.

Admin uniquement (matrice M02 `guild_config_write`), audité, rate-limité, réversible depuis
le centre des modules.

## 5. Checklist et progression

`GET /api/guilds/:id/onboarding` renvoie des étapes dérivées :

- `log_channel`, `gateway`, `permissions` (étapes cœur, non masquables) ;
- une étape par module de démarrage (welcome, automod, levels, tickets, starboard,
  temp_voice) dont le statut vient de l'état M03 (`done` / `todo` / `attention`).

`POST /api/guilds/:id/onboarding/dismiss` masque une étape optionnelle (`{ step }`) ou
marque la configuration terminée (`{ step: "__complete__" }`). Progression persistée dans
les colonnes additives `guilds.onboarding_completed_at / onboarding_preset /
onboarding_dismissed_steps` (migration `0024_onboarding.sql`).

## 6. Dépannage

- **« Serveur absent du panel »** — le bot n'a pas encore été sollicité : lancer `/ping`.
  Ou l'utilisateur n'a pas « Gérer le serveur » et aucune délégation d'accès panel.
- **« Le bot n'est pas installé »** (404) — invitez le bot via la landing puis relancez.
- **« Permission absente » sur un module** — ré-invitez avec la carte permissions.
- **Modules temps réel bloqués** — vérifiez que la Gateway est connectée (page Santé) et
  que les intents privilégiés sont activés dans le Dev Portal.

## 7. Confidentialité

Chaque serveur est isolé par `guildId`. Le bot ne lit pas le contenu des messages hors des
modules activés, ne les stocke pas et ne les transmet à aucun service tiers payant. Aucun
tracking produit n'est ajouté ici (l'instrumentation du funnel relève de M8/B4). La
désactivation d'un module conserve sa configuration et ses données.

## 8. Rollback

- Landing et wizard sont derrière des routes indépendantes ; le dashboard actuel reste
  accessible et fonctionnel sans eux.
- Les presets sont transactionnels et n'écrasent aucune configuration non ciblée.
- La migration `0024` est purement additive : les colonnes peuvent être ignorées sans
  effet sur le reste du schéma.
- Retirer M06 = retirer les routes `onboarding` / `public` et la page panel ; aucune
  donnée module n'est perdue.
