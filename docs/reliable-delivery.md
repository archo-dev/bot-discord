# Livraison fiable Gateway → Worker — M05

> Empêcher la perte silencieuse d'événements Gateway → Worker lors d'une panne
> temporaire (Worker, Cloudflare, réseau, VPS, processus Gateway, déploiement),
> sans broker payant ni second écrivain D1. Le Worker reste l'unique écrivain D1 ;
> le Gateway n'accède jamais à D1.

## 1. Décision de stockage local (VPS)

**Choix : `node:sqlite` (`DatabaseSync`), intégré à Node.**

Comparaison réelle :

| Critère | node:sqlite (retenu) | better-sqlite3 | Journal append-only maison | Fichiers atomiques |
|---|---|---|---|---|
| Résistance au crash | WAL + fsync | WAL + fsync | à réimplémenter | fragile (fsync/rename) |
| Transactions | oui (ACID) | oui | à écrire | non |
| Déduplication | `UNIQUE` natif | `UNIQUE` | à écrire | à écrire |
| Concurrence | sérialisée (mono-writer) | sérialisée | à gérer | à gérer |
| Dépendance | **aucune (built-in Node)** | **native à compiler** | aucune | aucune |
| Compile/ABI VPS | aucun risque | risque prebuild/ABI | — | — |
| systemd | inchangé | inchangé | inchangé | inchangé |
| Portabilité Win/Linux | oui (built-in) | prebuilds | oui | oui |
| Rollback | supprimer le module | désinstaller natif | — | — |

Décisif : **zéro dépendance externe, zéro compilation native, zéro changement
systemd**. Vérifié : `require('node:sqlite')` fonctionne sur le VPS (Node 22.23.1),
en local (24.18) et sur le runner CI Ubuntu (Node 22) — un simple
`ExperimentalWarning` cosmétique au démarrage, documenté. Un journal maison
n'apporte que du risque de correction (crash-safety, transactions, dédup à
réécrire) pour aucun gain. Aucun Kafka/Redis/broker/SaaS/service payant.

Fichier outbox : `GATEWAY_OUTBOX_PATH` (défaut `~/.botdiscord/outbox.db`),
permissions `0600`, WAL. Ne contient aucun secret ni token.

## 2. Inventaire des flux Gateway → Worker

Endpoints appelés par `packages/gateway/src/worker-api.ts` (`call()` signé M02).

| Flux | Endpoint | Méthode | Fréquence | Payload max | Écrit D1 | Idempotent (effet actuel) | Doublon dangereux | Perte au restart (avant M05) | Classe |
|---|---|---|---|---|---|---|---|---|---|
| **voice_log** | `/internal/guilds/:id/voice-logs` | POST | par event vocal (rafales) | ≤50 entrées | INSERT `voice_logs` | non (INSERT) | doublon d'historique (modéré) | **oui (buffer 5 s abandonné)** | **3→fiable** |
| **channel_activity** | `.../channel-activity` | POST | flush 60 s | ≤200 | UPSERT +count | non (incrément) | **double comptage** | oui (buffer mémoire) | **4→fiable** |
| **member_snapshot** | `.../member-snapshots` | POST | horaire | 1 | UPSERT bucket | **oui (REPLACE)** | non | recalculé au tick suivant | **2→fiable (low)** |
| **gateway_event** | `.../events` | POST | member join/leave, automod, keyword | 1 | INSERT `gateway_events` | non (INSERT) | doublon de stats | oui | **3→fiable** |
| xp | `.../xp` | POST | par message éligible | 1 | grant XP + **REST** (rôle/annonce) | **non** | **double XP** | oui | 4 + effet externe → **direct (différé)** |
| voice_xp | `.../voice-xp` | POST | tick 60 s | ≤100 | grant XP + REST | **non** | **double XP** | oui | 4 + effet externe → **direct (différé)** |
| automod_sanction | `.../automod-sanctions` | POST | infraction | 1 | warning+mod_action + **REST timeout** | **non** | **double sanction** | oui | 4 + effet externe → **direct (différé)** |
| starboard | `.../starboard` | POST | réaction ⭐ | 1 | upsert + **REST** (post/edit) | partiel | message dupliqué | oui | effet externe → **direct (différé)** |
| temp_voice register/unregister | `.../temp-voice/channels` | POST/DELETE | création/suppression salon | 1 | INSERT/DELETE | quasi (état) | faible | reconciliation au boot | **direct** |
| guild installed/uninstalled | `.../installed|uninstalled` | POST | guildCreate/Delete | 1 | upsert `guilds` | oui | non | rare | **direct** |
| music-state | `.../music-state` | POST | changement lecture | 1 | KV (TTL 60 s) | oui (REPLACE) | non | éphémère | **direct (éphémère)** |
| heartbeat | `/internal/gateway/heartbeat` | POST | 120 s | 1 | KV (TTL 300 s) | oui | non | éphémère | **direct (éphémère)** |
| config (read) | `.../config` | GET | cache 60 s | — | lecture | — | — | — | lecture |
| playlists / temp-voice list (read) | divers | GET | à la demande | — | lecture | — | — | — | lecture |

### Classification synthétique

1. **Éphémères / perdables** : heartbeat, music-state, lectures (config, playlists). → inchangés.
2. **Importants mais reconstructibles** : member_snapshot (recalculé), channel_activity (agrégat). → fiabilisés en priorité basse.
3. **At-least-once nécessaire** : voice_log, gateway_event. → fiabilisés (dédup obligatoire car INSERT).
4. **At-least-once + déduplication** : channel_activity (double comptage), et à terme xp/voice_xp/automod.
5. **Ordre par partition** : partition = **guilde** pour tous les flux fiabilisés (aucun ordre inter-guilde requis ; l'ordre intra-guilde évite les incohérences d'agrégat).

### Portée M05 (fiabilisée maintenant)

**Flux à effet purement D1, sans effet Discord** — parfaits pour une dédup
atomique côté Worker : **`voice_log`, `channel_activity`, `member_snapshot`,
`gateway_event`**. Chaque type est activable indépendamment par flag
(`GATEWAY_RELIABLE_TYPES`), **défaut vide = comportement direct historique
inchangé** (compatibilité progressive, déploiement sans risque).

### Volontairement différés (restent en envoi direct, avec la politique retry M04)

**xp, voice_xp, automod_sanction, starboard** : leur effet mêle une écriture D1
**et** un effet Discord externe (attribution de rôle, annonce, timeout, message
starboard) qui n'est pas rejouable atomiquement avec la dédup D1. Les fiabiliser
correctement exige de séparer la partie D1 idempotente de l'effet externe
at-most-once — travail progressif ultérieur. Conforme à la fiche M05
(« commence par un seul flux non critique », « migrer types critiques
progressivement »). Ils conservent la livraison directe + retry M04.

## 3. Enveloppe d'événement (versionnée)

Définie dans `@bot/shared` (`reliable-delivery.ts`). Champs **strictement
nécessaires** :

```
schemaVersion : 1
eventId       : UUID stable (clé de déduplication métier — jamais le nonce M02)
type          : 'voice_log' | 'channel_activity' | 'member_snapshot' | 'gateway_event'
guildId       : identifiant guilde (nécessaire au scoping ; jamais pseudonymisé côté livraison)
partitionKey  : 'g:<guildId>' (ordre intra-guilde)
priority      : 0 (normal) | 1 (bas)
occurredAt    : epoch ms
payload       : validé et borné par un schéma zod par type
```

**Jamais persisté ni transmis** : token, secret, cookie, header d'auth, IP,
erreur brute, pièce jointe, transcript, corps HTTP brut, contenu de message.
`voice_log` ne porte que `userId/userTag/action/channelId` (déjà le contrat
existant, aucune donnée nouvelle). Aucun contenu de message n'est mis en file.

## 4. Idempotence Worker

Migration additive **`0023_reliable_delivery.sql`** :
`processed_events(event_id TEXT PRIMARY KEY, event_type TEXT, processed_at INTEGER)`
+ index `processed_at` pour la purge. Aucun payload conservé. Rétention courte
(48 h, > fenêtre de retry max) via le cron quotidien existant.

Endpoint **`POST /internal/events/batch`** (signé M02, ≤100 événements) :
pour chaque événement, dédup + application **atomiques** :

1. `SELECT` de `event_id` dans `processed_events` → présent ⇒ `duplicate` (ACK, pas de ré-application).
2. sinon `db.batch([...statements d'effet, INSERT processed_events])` — atomique :
   soit tout s'applique (`accepted`), soit rien (rollback) et on renvoie `retry`.

Un doublon (retry après ACK perdu) est donc détecté par le `SELECT` et jamais
réappliqué. Une course rare est absorbée par l'atomicité du batch. ACK par
événement : `accepted | duplicate | skipped(module) | invalid | retry`.

## 5. Outbox locale (Gateway)

`node:sqlite`, table `outbox(event_id UNIQUE, type, partition_key, priority,
payload, created_at, available_at, attempts, status)`. Insertion **durable avant
envoi** ; suppression **uniquement après ACK** `accepted`/`duplicate`.

- **Capacité** : `GATEWAY_OUTBOX_MAX_EVENTS` (défaut 20 000) et
  `GATEWAY_OUTBOX_MAX_BYTES` (défaut 64 MiB). À saturation : on refuse les
  nouveaux événements de priorité basse (drop mesuré) ; les événements critiques
  évincent le plus ancien best-effort. Disque quasi plein : arrêt des insertions,
  métrique + log, la livraison continue à drainer.
- **Rétention/âge max** : `GATEWAY_OUTBOX_MAX_AGE_MS` (défaut 24 h) → dead-letter.
- **Tentatives max** : `GATEWAY_OUTBOX_MAX_ATTEMPTS` (défaut 12) → dead-letter (`status='dead'`).
- **Backoff** : exponentiel `min(base*2^attempts, max)` + jitter, `base` 1 s,
  `max` 5 min ; respecte `Retry-After` renvoyé par le Worker.
- **Concurrence** : `GATEWAY_OUTBOX_CONCURRENCY` (défaut 2) requêtes Worker en vol,
  **une seule par partition** (ordre intra-guilde), parallélisme entre guildes.
- **Débit de rattrapage** : lots ≤100, tick adaptatif (≈1 s sous charge, jusqu'à
  15 s à vide) — jamais de boucle serrée, jamais de tempête après longue panne.
- **Dead-letter** : `status='dead'`, conservé et compté, non re-livré
  automatiquement ; replay manuel documenté (runbook).
- **Arrêt gracieux** : SIGTERM stoppe le tick, ferme la base ; les événements
  persistés reprennent au démarrage suivant. Les heartbeats ne sont jamais bloqués.

## 6. Sécurité et confidentialité

- Livraison signée M02 inchangée (HMAC, audience, timestamp, nonce, anti-rejeu,
  body hash, mode `signed`). Un retry produit une requête signée **avec un
  nouveau nonce**, même `eventId` métier. La dédup métier utilise `eventId`,
  **jamais** le nonce.
- Fichier outbox `0600`, hors Git, aucun token/secret/contenu Discord.
- Payload allowlisté et borné par zod (Gateway à l'enqueue, Worker à la réception).
- Body limits M02 respectées (interne 512 KiB ; lot ≤100 largement en dessous).

## 7. Gouvernance des modules (M03)

À la réception, un événement dont le module est désactivé est **ACK `skipped`**
(retiré de l'outbox) — cohérent avec `requireInternalModule` actuel. Politique
par type documentée : les flux fiabilisés M05 (stats/historique) sont
best-effort vis-à-vis d'une désactivation ; aucun événement critique n'est
supprimé silencieusement pour une autre raison qu'un `eventId` déjà traité.

## 8. Observabilité (M01)

Métriques bornées ajoutées au runtime heartbeat : profondeur totale / par type /
par priorité, âge du plus ancien, ajoutés / livrés / retries / dead-letters /
drops, taille disque outbox, état dispatcher, taux de doublons Worker. **Jamais
de payload**, cardinalité bornée (types et priorités finis).

## 9. Compatibilité progressive et rollback

- Worker : nouvel endpoint additif ; anciens endpoints **inchangés** (l'ancien
  Gateway continue de fonctionner).
- Gateway : outbox présente mais **flags par type vides par défaut** → aucun
  changement de comportement au déploiement. Activation type par type ensuite.
- Rollback : vider `GATEWAY_RELIABLE_TYPES` (retour envoi direct) ; restaurer
  Gateway/Worker précédents ; **conserver** `processed_events` et le fichier
  outbox (aucune suppression, aucune down-migration destructive).

## 10. Exploitation (runbooks)

### Variables d'environnement Gateway

| Variable | Défaut | Rôle |
|---|---|---|
| `GATEWAY_RELIABLE_TYPES` | *(vide)* | types routés via l'outbox (`voice_log,channel_activity,member_snapshot,gateway_event`) ; vide = direct |
| `GATEWAY_OUTBOX_PATH` | `~/.botdiscord/outbox.db` | fichier SQLite (perms 0600) |
| `GATEWAY_OUTBOX_MAX_EVENTS` | 20 000 | capacité (backpressure au-delà) |
| `GATEWAY_OUTBOX_MAX_BYTES` | 64 MiB | taille disque max |
| `GATEWAY_OUTBOX_MAX_AGE_MS` | 24 h | âge max avant dead-letter |
| `GATEWAY_OUTBOX_MAX_ATTEMPTS` | 12 | tentatives avant dead-letter |
| `GATEWAY_OUTBOX_MAX_DEAD` | 5 000 | dead-letter bornée (purge des plus anciennes) |
| `GATEWAY_OUTBOX_CONCURRENCY` | 2 | requêtes Worker en vol (1 par partition) |

### Activer un type (rollout)

1. Déployer Worker (endpoint batch + `processed_events`) puis Gateway (flags vides).
2. Vérifier heartbeat + `/internal/events/batch` (page Santé : bloc « Livraison fiable » absent = désactivé).
3. Ajouter le type à `GATEWAY_RELIABLE_TYPES` (ex. `voice_log`), redémarrer la Gateway.
4. Observer sur la page Santé : `pending` doit rester bas, `dead`/`dropped` à 0, `delivered` croître.

### File pleine / disque presque plein

Backpressure : les événements de priorité basse sont abandonnés (métrique
`dropped`), les critiques évincent le plus ancien best-effort. Si `pending`
monte durablement → Worker probablement en panne : vérifier heartbeats et
erreurs 5xx/429. La livraison reprend seule au rétablissement.

### Dead-letter et replay

Un événement passe en `status='dead'` après `MAX_ATTEMPTS` ou `MAX_AGE`. La
dead-letter est bornée (`MAX_DEAD`). **Pas de replay automatique.** Replay manuel
(après diagnostic) sur le VPS :

```sh
sqlite3 ~/.botdiscord/outbox.db \
  "UPDATE outbox SET status='pending', attempts=0, available_at=strftime('%s','now')*1000 WHERE status='dead';"
```

Ne jamais supprimer une ligne `pending` non livrée. Inspecter sans extraire de
payload sensible (la file n'en contient pas : seuls des ids/actions bornés).

### Incident / rollback

1. Vider `GATEWAY_RELIABLE_TYPES` et redémarrer la Gateway → retour livraison directe immédiat.
2. Si besoin, restaurer le commit Gateway/Worker précédent (ordre : Gateway puis Worker).
3. Conserver `processed_events` (D1) et le fichier outbox pour analyse.
4. Vérifier API `/api/me`/`/api/guilds`, connexion Discord, heartbeats signés.

### Sauvegarde locale de la file

Le fichier outbox est local au VPS et reconstruit au besoin. Pour l'analyse d'un
incident, copier `outbox.db*` (db, -wal, -shm) hors ligne avant tout redémarrage.
Ne pas committer ce fichier.

### Ajouter un nouveau type d'événement fiable

1. Ajouter le type à `RELIABLE_EVENT_TYPES` + son schéma de payload borné dans `packages/shared/src/reliable-delivery.ts` (jamais de contenu de message).
2. Déclarer `RELIABLE_EVENT_MODULE` (gate M03) et `RELIABLE_EVENT_PRIORITY`.
3. Ajouter les statements d'effet **purs D1** dans `packages/worker/src/db/queries/reliable-delivery.ts` (`effectStatements`).
4. Router le flux dans `worker-api.ts` (enqueue si `outbox.isReliable(type)`).
5. Tester : accepted/duplicate/skipped/invalid côté Worker, reprise/retry/DLQ côté Gateway.
6. Ne fiabiliser un flux à **effet Discord externe** (xp/automod/starboard) qu'après avoir séparé la partie D1 idempotente de l'effet at-most-once.
