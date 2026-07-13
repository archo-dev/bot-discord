# Milestone 7 — Sauvegarde, restauration et journal de configuration

## 1. Résumé

Permettre aux administrateurs de visualiser, sauvegarder, comparer, restaurer et transférer des configurations de modules sans copier de secrets ni d’identifiants Discord invalides.

## 2. Problème et preuves

- Les commandes ont des révisions, mais les autres réglages n’ont pas de rollback global.
- SaveBar protège les changements non enregistrés, pas les erreurs déjà persistées.
- Rôles/salons rendent un export non portable entre serveurs.
- Ticket Tool propose backup/restore, signe que la confiance opérationnelle est une attente réelle.

## 3. Valeur utilisateur

Expérimenter sans peur, récupérer d’une mauvaise configuration et dupliquer un setup entre serveurs.

## 4. Valeur technique

Support simplifié, migrations de config versionnées, audit lisible et rollback des futures milestones.

## 5. Comparaison concurrentielle

Ticket Tool offre transfert de configurations ; YAGPDB/Carl-bot offrent puissance mais rendent la reproductibilité complexe. L’opportunité est un export transparent, validé et sans clé opaque dangereuse.

## 6. Architecture proposée

- Snapshot canonique par module : `schemaVersion`, module/version, valeurs allowlistées, références Discord symboliques.
- Création automatique avant mutation sensible et manuelle limitée.
- Diff sémantique côté Worker, rendu panel.
- Restauration sélective avec transaction et nouveau snapshot de l’état remplacé.
- Export JSON signé/checksummé, sans secrets/webhooks/tokens.
- Import en deux temps : validation puis remappage rôles/salons avec aperçu.

## 7. Packages, modules et fichiers concernés

Shared schemas/versioning ; Worker queries/routes modules ; panel pages configuration, modale diff et assistant mapping ; migrations D1 ; tests de chaque module sérialisé.

## 8. Routes API concernées

- `GET/POST /api/guilds/:id/config-snapshots`.
- `GET /.../:snapshotId/diff`.
- `POST /.../:snapshotId/restore`.
- `POST /api/guilds/:id/config-import/validate` puis `/apply`.
- Toutes admin-only, rate-limitées et auditées.

## 9. Tables et migrations D1 éventuelles

`config_snapshots(id, guild_id, actor_id, reason, schema_version, payload_json, created_at)` avec index guilde/date, taille max, rétention/nombre max. Éventuelle table import temporaire évitée ; utiliser token KV court si nécessaire.

## 10. Modifications Gateway

Aucune écriture. Invalidation/rafraîchissement de cache après restauration ; supporter anciennes/nouvelles versions de config.

## 11. Modifications Worker

Sérialiseurs allowlistés, validateurs, diff, transaction, mapping et audit. Jamais de snapshot brut de tables ou secrets.

## 12. Modifications panel

Historique, comparaison, restauration, export/import et mapping accessible. Avertir des entités absentes et conséquences ; conserver navigation guard.

## 13. Sécurité et permissions

Admin seulement, revalidation récente de session pour export/restauration si nécessaire, audit M2, limites de taille, JSON non exécutable, aucune URL webhook/token. Un export ne donne pas accès au serveur source.

## 14. Performance et montée en charge

Snapshots peu fréquents, compressibles si support natif mais taille plafonnée. Pagination et rétention. Diff calculé à la demande sur payload borné.

## 15. Risques

Schémas incompatibles, payload trop gros, IDs non portables, restauration partielle, secrets accidentels et faux sentiment de sauvegarde des données métier.

## 16. Dépendances

Requiert M2/M3 et s’intègre à M6. Précède tickets avancés et studio pour rollback/revisions.

## 17. Développement par phases

1. Contrat snapshot et inventaire champs interdits.
2. Snapshots Config/Automod et tests round-trip.
3. Diff/restauration transactionnelle.
4. Panel historique.
5. Export/import et mapping.
6. Étendre modules et rétention.

## 18. Tests

Round-trip par version, restauration atomique avec panne, entités manquantes, payload hostile/gros, permissions, isolation, export sans secret, ancien snapshot sur nouveau code et invalidation Gateway.

## 19. Rollback

Chaque restauration crée un snapshot précédent. Feature désactivable sans perte de config. Migration additive ; snapshots conservés. Import jamais appliqué sans deuxième confirmation.

## 20. Indicateurs de réussite

- 100 % des snapshots de test restaurables.
- Aucune donnée interdite dans exports.
- Restauration complète des modules ciblés <2 min.

## 21. Estimation détaillée

Conception 2 j ; développement 4–7 j ; tests 1–3 j ; docs 1–2 j ; total 8–14 j. Rallonges : mapping inter-serveurs et compatibilité de versions.

## 22. Documentation

Ce qui est/ne sera pas sauvegardé, schéma export, versions, mapping, rétention, sécurité, restauration d’urgence et compatibilité.

## 23. Passation à Claude

Claude doit commencer avec deux modules, prouver absence de secrets et round-trip avant généralisation. Ne pas appeler cela backup complet : les tickets/logs/XP ne sont pas couverts.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Implémente « Sauvegarde, restauration et journal de configuration » depuis docs/milestone-codex/07-sauvegarde-restauration.md. Confirme M2/M3/M6, crée milestone/config-backup depuis master propre et un point de restauration.

Avant code, inventorie chaque champ de configuration, version, référence Discord et donnée interdite. Propose un schéma canonique versionné et démarre seulement avec Config + Automod. Commits : sérialisation/snapshots, diff/restauration transactionnelle, panel, export/import validation, extension modules.

Admin-only, audit M2, taille/rétention bornées, aucun secret/webhook/token. Toute restauration crée d’abord un snapshot et est atomique. Import en validate/preview/apply avec remappage explicite. Migration additive locale et réversible, aucune remote sans accord. Tests round-trip, versions, panne, hostile, isolation et scan anti-secret ; check/tests/build et docs. Aucun déploiement.
```
