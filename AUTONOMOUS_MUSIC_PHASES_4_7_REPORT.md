# Exécution autonome — Roadmap musique Phases 4 à 7

- Début : 2026-07-19 (Europe/Paris)
- HEAD initial : `e7fad963ea5a1b077537767bd068a0e910594230`
- Arbre initial : propre
- Déploiement/push : interdits et non effectués

## Baseline initiale

- Gateway : 171 tests réussis, typecheck et build réussis (bundle 219,32 kB).
- Worker : suite complète réussie, typecheck réussi, build Wrangler `--dry-run` réussi.
- Panel : suite complète réussie, typecheck et build réussis ; bundle initial gzip 148,2 kB / budget 180 kB.
- Shared : aucun script de test/build dédié ; typecheck réussi.
- Aucun fichier, lockfile, dépendance, patch, schéma ou migration modifié pendant la baseline.

## Phase 4 — Synchronisation quasi temps réel

### Audit

- Le Gateway publiait un DTO minimal dans KV, sans statut explicite ni séquence.
- Le Worker exposait directement le JSON KV et acceptait les écrasements anciens.
- Le panel interrogeait KV toutes les 4 secondes et affichait `connected && !paused` comme « playing ».
- La progression ne bougeait qu’à chaque réponse réseau.
- SSE demanderait un relais durable/push absent de l’architecture actuelle ; WebSocket ajouterait davantage d’infrastructure.

### Architecture retenue

- Polling adaptatif : 1 s pendant Buffering, 2 s pendant Playing, 3 s pendant Paused, 12 s à l’arrêt.
- Backoff borné jusqu’à 12 s lors d’une perte réseau et reprise via React Query.
- Interpolation locale à 250 ms sans écriture ni requête réseau par tick.
- Séquence monotone timestampée produite par le Gateway, rejet des réponses/écritures anciennes côté Worker et panel.
- DTO rétrocompatible : normalisation des snapshots antérieurs pendant un déploiement progressif.
- `Idle` transitoire conserve le snapshot ; `Buffering` publie la piste connue sans prétendre qu’elle joue.

### Sécurité et limites

- Routes panel toujours protégées par session et autorisation de guilde centrales.
- KV reste le fallback et la source de synchronisation ; aucune URL de stream n’est transportée.
- Aucun SSE, WebSocket, timer serveur, cache non borné, migration ou dépendance ajouté.

### Tests ajoutés/renforcés

- Statuts Idle/Buffering/Playing/Paused/Stopped/Error.
- Séquences monotones et rejet des snapshots obsolètes.
- Interpolation, resynchronisation après dérive, perte/reprise réseau logique et deux onglets indépendants.
- Transition piste 1 → piste 2 sans état vide, fin réelle, erreur, stop, déconnexion et isolation de guildes.
- Preview exposée sans URL signée et marquée non seekable.

### Fichiers de la phase

- `packages/shared/src/api-types/music.ts`
- `packages/gateway/src/music/controller.ts`
- `packages/gateway/src/music/format.ts`
- `packages/gateway/src/music/instrumentation.ts`
- `packages/gateway/test/music-player-state.test.ts`
- `packages/worker/src/api/music.ts`
- `packages/worker/src/internal/music.ts`
- `packages/worker/test/music.test.ts`
- `packages/panel/src/lib/music-state.ts`
- `packages/panel/src/pages/Music.tsx`
- `packages/panel/test/music-state.test.ts`

### Validations

- Tests ciblés Gateway : 69/69 réussis (6 fichiers).
- Tests Gateway complets : 171/171 réussis.
- Tests Worker ciblés : 6/6 réussis ; suite Worker complète réussie.
- Tests panel ciblés : 3/3 réussis ; suite panel complète réussie.
- Typecheck monorepo (`pnpm -r check`) : réussi pour Gateway, Worker, panel et shared.
- Build Gateway : réussi, bundle 222,26 kB.
- Build Worker : `wrangler deploy --dry-run` réussi, sans déploiement.
- Build panel : réussi, gzip initial 148,5 kB / budget 180 kB.
- `git diff --check` : réussi.
- Lockfile, migrations, dépendances et patch yt-dlp : inchangés.
- Audit du diff : 12 fichiers, moins de 2 000 lignes nettes, aucune donnée sensible ou URL de flux signée ajoutée.

Commit : `31798c951f497374295c920748d1c56d74f26ee7` — `feat(panel): synchronize music state in near real time`.

## Phase 5 — Contrôles communs Discord/panel

### Audit

- Discord et le panel atteignaient déjà le même `MusicController`, mais les mutations étaient directement codées dans son `switch` et seules pause/reprise/skip/stop étaient exposées au panel.
- DisTube 5.2.3 expose publiquement `pause`, `resume`, `skip`, `stop`, `setVolume`, `setRepeatMode` et `shuffle`. Son `shuffle` conserve explicitement la piste courante.
- DisTube ne fournit aucune API publique de réorganisation arbitraire de la queue. L’action `reorder` est donc volontairement absente et rejetée par validation stricte.
- Les middlewares Worker existants couvrent session, appartenance et accès guilde, présence du bot, niveau administrateur, inventaire de mutations, Origin/CSRF, rate limit, quota durable et audit.

### Architecture retenue

- `MusicControlService` est la couche métier unique pour Discord et panel.
- Sa serrure FIFO par guilde est aussi utilisée par `/play`, `/playlist load` et le chemin seek existant ; aucune serrure globale.
- Les contrôles vérifient côté Gateway que l’utilisateur se trouve dans le salon vocal de la queue.
- Le Worker valide un union discriminé shared strict, traduit uniquement vers le protocole interne existant puis relaie au Gateway.
- Le panel expose pause/reprise, skip, stop, shuffle, volume, repeat et suppression d’une piste non courante.

### Tests et auto-audit

- Parité Discord/panel des huit contrôles, queue absente, suppression invalide, publication d’état, nettoyage stop/skip et conservation de la piste active.
- Sérialisation de deux actions dans une guilde et parallélisme de deux guildes.
- Refus hors salon vocal pour les sources panel et Discord.
- Validation stricte Worker de toutes les actions et rejet de `reorder`, des valeurs hors bornes et des champs inattendus.
- Test Lazy Queue 200 pistes renforcé avec le contexte vocal réel ; l’isolation de guildes reste valide.
- Tests ciblés : Gateway 45/45 puis régression Lazy Queue 41/41 ; Worker 6/6 ; panel 3/3.
- Suites complètes Gateway, Worker et panel : réussies après correction du faux membre incomplet du harness Lazy Queue.
- Typechecks Gateway, Worker, panel et shared : réussis.
- Builds Gateway et panel, et build Worker `wrangler --dry-run` : réussis, sans déploiement.
- Lockfile, dépendances, migrations, patch yt-dlp et configuration : inchangés.

### Fichiers de la phase

- `packages/shared/src/api-types/music.ts`
- `packages/gateway/src/music/control-service.ts`
- `packages/gateway/src/music/controller.ts`
- `packages/gateway/test/music-control-service.test.ts`
- `packages/gateway/test/music-player-state.test.ts`
- `packages/gateway/test/music-lazy-queue-controller.test.ts`
- `packages/worker/src/api/music.ts`
- `packages/worker/test/music.test.ts`
- `packages/panel/src/pages/Music.tsx`

Commit : `a89b07092cb228b7599732b97f2d274c7d0a3d18` — `feat(music): expose shared panel and Discord controls`.

## Phase 6 — Barre de progression interactive

### Audit

- DisTube 5.2.3 expose publiquement `Queue.seek(time: number): Promise<Queue>` ; son implémentation relance la ressource avec l'offset demandé sans émettre artificiellement `PLAY_SONG`.
- Le chemin public conserve l'état pause : une queue pausée prépare la nouvelle ressource, puis ne la démarre qu'à la reprise explicite.
- Les snapshots Phase 4 exposent déjà durée, position, statut réel et `seekable`, sans URL de stream.

### Architecture retenue

- L'action `seek` rejoint l'union discriminée shared et transite par le Worker comme les autres contrôles, avec les mêmes protections de session, guilde, permissions, Origin/CSRF et rate limit.
- Le Gateway l'exécute dans la couche métier Phase 5 et dans la même serrure FIFO par guilde que `/play`, `/playlist load` et les contrôles.
- Une seule opération seek peut être active par guilde ; le marqueur est supprimé dans un `finally` et n'empêche pas les guildes différentes de progresser en parallèle.
- Le seek est refusé avant DisTube pour une durée inconnue, un live, une preview SoundCloud, une valeur négative/non finie ou une position après la durée connue. Les positions 0 et fin exacte sont autorisées.
- Un changement de queue ou de piste pendant l'appel empêche toute confirmation mensongère. Les échecs DisTube sont propagés et l'état final n'est publié qu'après succès.
- Le panel utilise un range natif accessible au clavier, un état optimiste borné et un rollback vers le dernier snapshot autoritatif. Les mises à jour serveur ne déplacent pas le curseur pendant un drag ou une mutation en cours.

### Tests et auto-audit

- Seek en lecture et en pause, positions 0/fin, conservation de pause et publication après succès.
- Refus durée inconnue, live, preview et hors bornes avant `Queue.seek()`.
- Rejet d'un second seek concurrent, sérialisation d'un stop suivant, propagation d'erreur DisTube et détection d'un changement de piste.
- Contrôleur réel : attente de la promesse DisTube, position dashboard à 90 s et statut `paused` conservé.
- Panel : bornage click/clavier, stabilité pendant drag et rollback optimiste.
- Tests ciblés Gateway : 49/49 ; panel : 28/28 ; Worker musique : 6/6.
- Suites complètes : Gateway 193/193, panel 37/37, Worker réussie (avertissements de nettoyage Miniflare `EBUSY` non bloquants sous Windows).
- Typechecks Gateway, Worker, panel et shared : réussis.
- Builds Gateway et panel réussis ; build Worker `wrangler deploy --dry-run` réussi, sans déploiement.
- `git diff --check` réussi ; lockfile, dépendances, migrations, patch yt-dlp et configuration inchangés.

### Fichiers de la phase

- `packages/shared/src/api-types/music.ts`
- `packages/gateway/src/music/control-service.ts`
- `packages/gateway/src/music/controller.ts`
- `packages/gateway/test/music-control-service.test.ts`
- `packages/gateway/test/music-player-state.test.ts`
- `packages/worker/src/api/music.ts`
- `packages/worker/test/music.test.ts`
- `packages/panel/src/components/MusicSeekBar.tsx`
- `packages/panel/src/lib/music-seek.ts`
- `packages/panel/src/pages/Music.tsx`
- `packages/panel/test/music-seek.test.ts`

Commit prévu : `feat(panel): add interactive music seeking`.

## Phases suivantes

- Phase 6 : validée, commit en cours.
- Phase 7 : en attente.

## Garanties globales

- Aucun déploiement, push, accès VPS ou redémarrage de service.
- Aucune migration D1 ni modification de schéma.
- Aucune dépendance, lockfile ou patch yt-dlp modifié.
- Aucun secret ou paramètre de production modifié.
