# Sauvegarde, restauration et journal de configuration (M07)

Snapshots canoniques versionnés de la configuration des modules, avec diff, restauration
transactionnelle et export/import inter-serveurs. Panel : page **Sauvegarde** (`/guilds/:id/backup`).

> **Ce n'est PAS une sauvegarde complète.** Seule la **configuration** de deux modules est
> couverte pour l'instant : **Configuration générale** (`general`) et **Auto-modération**
> (`automod`). Les données métier — tickets, logs, XP, messages — ne sont **pas** sauvegardées.

## 1. Ce qui est / n'est pas sauvegardé

| Module | Sauvegardé | Références Discord |
|---|---|---|
| `general` | salon de logs, seuil/timeout d'avertissements, cartes de mention, pseudo du bot, réglages `log_settings` (salon + toggles member/message/voice) | `logChannelId`, `logSettings.channelId` (salons) |
| `automod` | anti-spam/invite/lien, whitelist domaines, mots bannis, exemptions, action, timeout | `exemptRoleIds` (rôles), `exemptChannelIds` (salons) |

**Jamais** sauvegardé : token, secret, URL de webhook, session, ni aucun contenu de message.
Les sérialiseurs sont **allowlistés** (`packages/worker/src/config-backup/serialize.ts`) — jamais
un dump brut de table. Un test dédié échoue si un mot interdit apparaît dans un payload.

## 2. Schéma d'export

Fichier JSON (`format: "archodev.config-backup"`) :

```jsonc
{
  "format": "archodev.config-backup",
  "schemaVersion": 1,
  "checksum": "<sha256 hex du payload canonique>",
  "exportedAt": "<ISO>",
  "sourceGuildId": "<snowflake>",
  "reason": "manual",
  "payload": { "schemaVersion": 1, "modules": { "general": { "version": 1, "values": … }, "automod": { … } } }
}
```

Le `checksum` = SHA-256 du JSON **canonique** (clés triées) du `payload`. À l'import, le Worker
le recalcule et refuse le fichier s'il ne correspond pas (détection d'altération). Pas de HMAC :
un export ne donne aucun accès au serveur source et doit rester vérifiable entre serveurs.

## 3. Versions

`CONFIG_BACKUP_SCHEMA_VERSION` (global) + `version` par module (aligné sur le registre M03).
Un import d'une version de schéma inconnue est signalé et bloqué. Les futures évolutions de champ
incrémentent la version du module et ajoutent une migration de payload.

## 4. Restauration

- **Sélective** : on choisit les modules à restaurer.
- **Réversible** : l'état remplacé est d'abord capturé (`reason: pre_restore`) avant réécriture.
- **Atomique** : les écritures passent par un unique `DB.batch`.
- La restauration écrit en base ; le pseudo du bot n'est pas repoussé vers Discord (réappliqué au
  prochain enregistrement). Le cache config de la Gateway (60 s) se rafraîchit ensuite tout seul.

## 5. Import inter-serveurs et mapping

Deux temps :
1. **validate** — parse, vérifie le checksum/version, liste les références Discord (salons/rôles) à
   associer et si l'export vient du même serveur.
2. **apply** — chaque référence des modules importés doit être **explicitement** mappée (vers une
   entité locale ou « ignorer »). Le Worker re-vérifie le checksum, remappe, snapshoote l'état
   remplacé (`reason: pre_import`) et applique en transaction. Une référence non mappée est refusée.

## 6. Rétention et limites

- 25 snapshots max par serveur (les plus anciens sont purgés à la création).
- Payload plafonné (64 Ko ; deux modules pèsent < 2 Ko).
- Admin uniquement (matrice M02 `guild_config_write`), audité, rate-limité. JSON non exécutable.

## 7. Restauration d'urgence

1. Page **Sauvegarde** → repérer une sauvegarde antérieure fiable (comparer via **Comparer**).
2. **Restaurer** → cocher les modules → confirmer. L'état courant est sauvegardé automatiquement.
3. En cas d'erreur, restaurer le snapshot `pre_restore` créé juste avant.

## 8. Compatibilité et rollback

Migration `0025_config_snapshots.sql` additive et isolée : supprimer la feature n'affecte aucune
config. Les snapshots sont conservés. Un ancien snapshot reste restaurable tant que sa version de
schéma est supportée. Aucun déploiement/migration distante sans validation explicite.

## 9. Routes (toutes admin-only)

- `GET/POST /api/guilds/:id/config-snapshots` — liste / création manuelle
- `GET /api/guilds/:id/config-snapshots/:sid` — détail
- `GET /api/guilds/:id/config-snapshots/:sid/diff` — diff vs config actuelle
- `POST /api/guilds/:id/config-snapshots/:sid/restore` — restauration sélective atomique
- `GET /api/guilds/:id/config-snapshots/:sid/export` — export checksummé
- `POST /api/guilds/:id/config-import/validate` puis `/apply` — import en deux temps
