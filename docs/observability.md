# Observabilité M01

## Objectif et périmètre

La couche M01 fournit une corrélation Worker/Gateway, des logs JSON à schéma fermé, des agrégats horaires D1 et un diagnostic de santé par serveur. Elle ne remplace pas les logs Cloudflare/VPS et ne collecte aucune analytics produit.

## Données autorisées

- identifiant de diagnostic aléatoire ;
- module et opération parmi les listes fermées de `@bot/shared` ;
- résultat succès/erreur et code stable (`http_4xx`, `timeout`, etc.) ;
- durée bornée ;
- pseudonyme de guilde SHA-256 dépendant du secret de déploiement ;
- runtime Gateway agrégé : version, uptime, mémoire, profondeurs de files, compteur d’erreurs ;
- compteur horaire pondéré et histogramme de latence.

## Données interdites

Contenu ou pièce jointe Discord, texte de transcript, username/global name, ID membre/salon/message, ID guilde brut dans les logs/métriques, IP, URL/path brut, header, cookie, token, secret, corps de requête/réponse et `Error.message`.

Le logger reconstruit chaque ligne depuis une allowlist et ignore les propriétés inconnues. Le middleware d’interaction inspecte seulement `guild_id` sur une copie en mémoire ; le payload n’est jamais journalisé ni persisté.

## Échantillonnage et rétention

- erreurs : 100 %, poids 1 ;
- succès : échantillon 25 %, poids 4 ;
- logs de succès : échantillon 10 % ;
- métriques : agrégats horaires uniquement ;
- latence plafonnée à 60 s et sept buckets ;
- rétention D1 : 30 jours, purge quotidienne par le cron existant.

Les compteurs succès sont donc des estimations. Le panel le signale explicitement. Aucune ligne brute par requête n’est conservée.

## SLO initiaux

| SLO | Cible | Fenêtre | Remarque |
|---|---:|---:|---|
| Disponibilité API panel | ≥99 % | 24 h | estimation échantillonnée |
| Latence API panel | p95 approx. ≤1 000 ms | 24 h | histogramme, pas percentile exact |
| Fraîcheur Gateway | heartbeat ≤180 s | instantané | envoi toutes les 120 s |
| Succès interactions | ≥99 % | 24 h | erreurs toujours comptées |

Ces valeurs sont des cibles de départ, à réviser après une période d’observation. Elles ne déclenchent aucune action automatique.

## Dictionnaire d’états

- `operational` : cible respectée ;
- `degraded` : données présentes mais cible manquée modérément, heartbeat ancien, erreur Gateway ou ping élevé ;
- `unavailable` : fort taux d’échec ou aucune Gateway ;
- `inactive` : aucune donnée dans la fenêtre.

## Diagnostic support

1. Demander uniquement la référence affichée sur la page Santé.
2. Vérifier Gateway, SLO puis module concerné.
3. Rechercher le `requestId` dans les logs Worker/Gateway.
4. Ne jamais demander de token, cookie, `.dev.vars` ou contenu de message.
5. Si les métriques sont absentes après une migration, vérifier d’abord que `0020_observability.sql` est appliquée ; ne jamais lancer `--remote` sans validation.

## Runbooks

### Gateway dégradée

Vérifier âge heartbeat, ping, files et erreurs. Une file non nulle n’est pas une perte. Ne redémarrer le service qu’après lecture des logs corrélés et autorisation opérationnelle.

### Écriture métrique en échec

Le parcours utilisateur continue. Le Worker émet `metrics_write_failed`. Vérifier migration et D1 ; ne pas contourner en journalisant les payloads.

### Cardinalité ou coût anormal

Désactiver la persistance métrique via rollback applicatif, conserver la table, mesurer les dimensions. Ne supprimer aucune donnée en urgence sans sauvegarde/autorisation.

## Rollback

1. Revenir séparément sur le commit panel/API si la page pose problème.
2. Revenir sur le middleware de persistance ; l’absence de table ou une écriture ratée ne casse pas les requêtes métier.
3. L’ancien heartbeat reste accepté car `runtime` est optionnel côté Worker.
4. Conserver `operation_metrics` ; sa suppression éventuelle appartient à une migration ultérieure.
5. Restaurer progressivement Worker puis Gateway, jamais en couplant rollback et suppression D1.

## Avant déploiement

- tests/check/build verts ;
- sauvegarde D1 et validation explicite de la migration distante ;
- déployer Worker compatible ancien Gateway ;
- vérifier `/health`, OAuth et API ;
- déployer Gateway ;
- vérifier deux heartbeats ;
- observer logs/coût D1 avant d’activer le lien Santé largement.
