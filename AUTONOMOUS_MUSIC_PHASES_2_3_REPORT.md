# Rapport autonome — phases musique 2 et 3

## Point de départ

- Répertoire : `C:\VS_project\botdiscord`
- HEAD initial : `3a7c1f5b284e0ef396510ad29cebebc3e6dac783`
- Commit initial : `chore(music): add structured playback instrumentation`
- Début de la Phase 2 : 2026-07-19, avant 10:39 CEST (08:39 UTC)
- Passage à la consigne autonome Phases 2–3 : 2026-07-19T11:04:56+02:00
- État Git initial constaté avant le travail Phase 2 : propre
- Patch installé : `@distube/yt-dlp@2.0.1`, patch hash
  `3e1505f52fad02305f42aedffd1aa1a6d679e67498d4beda613c9697bd253822`

La consigne autonome Phases 2–3 a été fournie alors que la Phase 2, demandée
précédemment dans la même session, était déjà en cours. Le HEAD et l'arbre
propre avaient été contrôlés avant ce travail. Il n'existe donc pas de seconde
capture de tests sur le code initial non modifié ; les validations complètes
ci-dessous ont été exécutées sur l'état final de chaque phase.

## Phase 2 — Lazy Queue

### Audit

L'ancien `/playlist load` parcourait les pistes sauvegardées et appelait
`playWithTimeout()`, donc `distube.play()`, séquentiellement pour chaque URL.
Une playlist de 200 pistes entraînait ainsi 200 résolutions de métadonnées
yt-dlp avant que l'opération soit terminée.

DisTube 5.2.3 accepte directement une `Playlist` ESM et ajoute son tableau de
`Song` en une opération ordonnée. Une `Song` construite avec le plugin
`PLAYABLE_EXTRACTOR`, son URL publique et `playFromSource: true` n'appelle
`getStreamURL()` que lorsqu'elle atteint la tête de queue. La normalisation
ESM/CommonJS existante des playlists SoundCloud `/sets/` est restée inchangée.

### Architecture retenue

- `PlaylistLoader` local, synchrone et borné à 200 entrées.
- Validation piste par piste, conservation de l'ordre relatif et construction
  de `Song`/`Playlist` ESM sans réseau.
- Un seul `distube.play()` avec la Playlist logique.
- Session et `AbortSignal` par guilde ; annulation sur stop, déconnexion,
  remplacement, erreur ou disparition de queue.
- Résumé structuré unique : détecté, validé, ajouté, ignoré, erreur, tronqué,
  durée, queue avant/après et motif d'annulation.
- Aucune promesse par piste, aucun timer et aucun listener dans le loader.

### Mesures avant/après (200 pistes)

| Mesure | Avant | Après |
|---|---:|---:|
| `distube.play()` | 200 | 1 |
| `getStreamURL()` pendant construction | jusqu'à une résolution par lecture séquentielle | 0 pour la construction ; uniquement la tête si la queue est vide |
| Streams distants créés pendant ajout à une lecture active | potentiellement déclenchés par le chemin séquentiel | 0 |
| Promesses simultanées par piste | 1 séquentielle | 0 |
| Taille finale | 200 pistes ajoutées une à une | 200 pistes ordonnées |

Construction locale mesurée sur 25 passages : minimum 0,147 ms, médiane
0,190 ms, maximum 0,898 ms ; 200 Songs, 0 `getStreamURL`, 0 stream,
0 promesse concurrente et 0 session restante.

### Validations Phase 2

- Tests ciblés Lazy Queue/playlist/player : 34/34.
- Tests instrumentation/routage/recherche/timeout : 50/50.
- Tests Gateway complets : 19 fichiers, 147/147.
- Typecheck Gateway : exit 0.
- Build Gateway : exit 0 (`dist/index.js`, 201,28 KB).
- `git diff --check` : exit 0.
- Format/lint : aucun script ni binaire formatter/linter disponible ; contrôle manuel du diff effectué.
- Cache, prébuffer et optimisation de latence : absents de ce commit.

### Commit Phase 2

- Hash : `3f6e2b7fff667f1b9baa0a01583482d5e8d15416`
- Message : `feat(music): support large playlists with lazy queue loading`
- Diffstat : 8 fichiers, 1 099 insertions, 51 suppressions.

Fichiers :

- `packages/gateway/src/music/controller.ts`
- `packages/gateway/src/music/instrumentation.ts`
- `packages/gateway/src/music/playlist-loader.ts`
- `packages/gateway/src/worker-api.ts`
- `packages/gateway/test/music-lazy-queue-controller.test.ts`
- `packages/gateway/test/music-player-state.test.ts`
- `packages/gateway/test/music-playlist-loader.test.ts`
- `packages/gateway/test/music-soundcloud-playlist.test.ts`

## Phase 3 — Performances et réduction de latence

### Audit et mesures avant optimisation

Le chemin `soundcloudSearch` exécutait directement un unique `scsearch5:` par
commande, sans coalescence et sans cache. Deux recherches textuelles identiques
simultanées lançaient donc deux processus de recherche. Les URL directes et
`/sets/` n'empruntaient pas ce chemin.

Mesure contrôlée avec une résolution simulée à 25 ms :

- deux recherches identiques simultanées : 2 appels réels, 33,263 ms ;
- répétition immédiate : troisième appel réel, 30,883 ms.

L'instrumentation existante ne regroupait pas encore les jalons recherche,
queue, stream, ffmpeg, Buffering et Playing dans un résumé de latence.

### Optimisations retenues

- Coalescence des recherches textuelles SoundCloud identiques simultanées.
- Cache LRU court : 64 entrées, TTL 30 secondes, éviction déterministe.
- Clés SHA-256 des requêtes normalisées : aucune requête ou donnée sensible
  n'est conservée comme clé.
- Valeurs limitées à 512 caractères et uniquement URL de page publique
  `https://soundcloud.com/...` sans query string, fragment ou `/sets/`.
- Concurrence réelle limitée à 4 et attente limitée à 64 opérations.
- Aucun timer : expiration paresseuse à chaque accès/snapshot.
- `clear()` vide le cache, annule les travaux en attente et invalide toute
  insertion tardive d'un résultat déjà actif.
- Jalons scalaires et logs structurés pour recherche, queue, stream/ffmpeg,
  Buffering, Playing, total, appels `scsearch5`, hit/miss/join et occupation.

### Optimisations rejetées

Le préchargement de la prochaine piste n'a pas été retenu. Dans DisTube 5.2.3,
le mécanisme disponible appelle `getStreamURL()` puis conserve l'URL signée
dans `song.stream.url`. Cela violerait l'interdiction de cacher une URL de flux
signée et ouvrirait une ressource sans mesure de production démontrant un gain.
La valeur retenue est donc zéro préchargement spéculatif ; les tests vérifient
que stop, skip, déconnexion et une Lazy Queue de 200 pistes ne déclenchent pas
de résolution distante anticipée.

Aucun cache durable, cache de métadonnées DisTube, cache d'URL de stream,
prébuffer ffmpeg ou dépendance n'a été ajouté.

### Mesures après optimisation

Même scénario contrôlé à 25 ms :

- deux recherches identiques simultanées : 1 appel réel, 1 miss + 1 join,
  31,012 ms ;
- répétition immédiate : 1 hit, aucun nouvel appel, 0,051 ms ;
- appels `scsearch5` cumulés : 3 avant, 1 après ;
- concurrence maximale observée pour ce scénario : 1 ; limite testée : 4 ;
- cache après scénario : 1/64 entrée ; TTL 30 s ;
- ratio des trois accès : 1 hit, 1 join, 1 miss ; deux accès sur trois n'ont
  déclenché aucune nouvelle recherche réelle ;
- contenu texte maximal théorique : 73 728 octets (clés et valeurs UTF-16),
  hors surcoût borné des objets `Map`.

La latence simultanée de la première paire reste dominée par l'appel réel et
n'est pas présentée comme significativement réduite. Le gain démontré porte
sur le nombre d'appels dupliqués et sur les hits chauds. Les résolutions
DisTube nécessaires après obtention de l'URL publique restent inchangées.

Les nouveaux événements `music_soundcloud_search_performance` et
`music_playback_performance` permettront de mesurer en production, après un
futur déploiement explicitement autorisé, les segments commande→recherche,
recherche→queue, queue→stream, stream→ffmpeg, ffmpeg→Buffering,
Buffering→Playing et durée totale. Aucun test de production n'a été lancé ici.

### Validations Phase 3

- Tests ciblés cache/performance/instrumentation/player : 41/41.
- Suite élargie musique/Lazy Queue/SoundCloud/timeout : 77/77.
- Tests Gateway complets : 21 fichiers, 162/162.
- Typecheck Gateway : exit 0.
- Build Gateway : exit 0 (`dist/index.js`, 211,69 KB).
- `git diff --check` : exit 0 avant staging final.
- Format/lint : aucun script ni binaire formatter/linter disponible ; contrôle manuel du diff effectué.
- Recherche de secrets/URL signées : aucune valeur sensible ajoutée aux logs ou au cache ; les chaînes sensibles présentes sont uniquement des fixtures de non-régression.

### Commit Phase 3

- Hash : commit contenant ce rapport ; le hash complet auto-référentiel ne peut
  pas être inscrit dans son propre contenu sans modifier ce même hash. La
  valeur autoritative figure dans le rapport final de l'agent et dans Git.
- Message : `perf(music): reduce queue and playback startup latency`
- Diffstat : 8 fichiers, 1 109 insertions, 19 suppressions.

Fichiers prévus dans le commit :

- `AUTONOMOUS_MUSIC_PHASES_2_3_REPORT.md`
- `packages/gateway/src/music/controller.ts`
- `packages/gateway/src/music/instrumentation.ts`
- `packages/gateway/src/music/search-cache.ts`
- `packages/gateway/test/music-instrumentation.test.ts`
- `packages/gateway/test/music-player-state.test.ts`
- `packages/gateway/test/music-search-cache.test.ts`
- `packages/gateway/test/music-search-performance.test.ts`

## Risques restants

- Un résultat public SoundCloud peut disparaître pendant le TTL de 30 secondes ;
  DisTube signalera alors son erreur normale et le cache expirera rapidement.
- Le cache supprime l'appel `scsearch5` dupliqué, mais ne supprime pas les
  résolutions DisTube nécessaires pour ajouter/lire chaque commande.
- Les mesures détaillées stream/ffmpeg nécessitent des commandes réelles après
  un déploiement futur ; cette exécution ne touche pas la production.
- Le préchargement reste volontairement désactivé jusqu'à l'existence d'une API
  sûre ne conservant pas d'URL signée et à une preuve de gain mesurée.

## État final attendu et garanties

Quatre derniers commits à l'issue de Phase 3 :

1. `SELF` — `perf(music): reduce queue and playback startup latency`
2. `3f6e2b7fff667f1b9baa0a01583482d5e8d15416` — `feat(music): support large playlists with lazy queue loading`
3. `3a7c1f5b284e0ef396510ad29cebebc3e6dac783` — `chore(music): add structured playback instrumentation`
4. `e5036f329e8d00a8d51a35eb3da8d18a691dafc9` — `fix(music): reconcile paused player state before playback`

Sortie finale attendue de `git status --short` : vide.

Confirmations :

- aucun déploiement ;
- aucun redémarrage de service ;
- aucune connexion au VPS ;
- aucun push ;
- aucune migration ou modification D1 ;
- aucune modification Worker, panel ou shared ;
- aucune modification Cloudflare, systemd, secret ou variable de production ;
- aucune dépendance modifiée ;
- aucun lockfile modifié ;
- patch yt-dlp inchangé.
