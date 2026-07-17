# Analytics produit respectueuses de la vie privée (M08)

## Finalité et questions

La collecte répond uniquement à cinq questions : installations, abandon de la prise en main, adoption des modules, succès/échec fonctionnel et désinstallations/feedback. Elle ne sert jamais à profiler ou sanctionner un membre.

## Taxonomie fermée

Événements : `guild_installed`, `onboarding_step`, `onboarding_completed`, `module_activation_changed`, `feature_result`, `guild_uninstalled`.

Dimensions : module issu du registre M03, étape M06 allowlistée, résultat parmi `success`, `failure`, `enabled`, `disabled`, `completed`, `dismissed`, jour UTC, version applicative bornée et cohorte 0–3. `productMetricSchema` est strict : toute propriété libre est refusée.

## Données exclues

Aucun identifiant utilisateur, pseudo, message, contenu Discord, salon, rôle, commande libre ou adresse IP n'entre dans les tables métriques. Aucun tracker tiers ou cookie marketing n'est chargé. Le feedback volontaire est une table distincte et ne rejoint jamais les métriques.

## Pseudonymisation, affichage et rétention

La guilde devient une empreinte HMAC-SHA-256 dépendante du jour. Une empreinte n'est donc pas corrélable d'un jour à l'autre. Les contributions sont agrégées après 7 jours puis supprimées ; les agrégats sont conservés 180 jours. Le feedback est supprimé après 60 jours. Le cron quotidien exécute ces purges dans une transaction D1 batch.

La vue `GET /internal/product-metrics?days=30` utilise l'authentification interne signée existante et ne renvoie que les buckets représentant au moins trois guildes. Elle n'expose pas le feedback.

## Opt-out

`GET/PATCH /api/guilds/:guildId/privacy` est admin-only. La désactivation bloque les nouvelles écritures et supprime les contributions des huit jours encore rattachables en recalculant leurs empreintes journalières. Les agrégats déjà anonymes ne permettent plus d'isoler une guilde. Le réglage est disponible dans la page **Confidentialité**.

## Feedback

`POST /api/guilds/:guildId/feedback` est volontaire, admin-only, limité à trois envois par heure et à 1 000 caractères. L'interface demande explicitement de ne pas inclure de token, identifiant ou contenu privé.

## Séparation de M01

Les métriques produit vivent dans `product_metric_*`, le réglage dans `guild_privacy` et le texte volontaire dans `product_feedback`. Elles ne lisent ni n'enrichissent les journaux, traces ou SLO techniques de M01.

## Rollback et exploitation

Définir `PRODUCT_ANALYTICS_ENABLED=false` coupe globalement la collecte sans affecter le panel. La migration `0026_privacy_analytics.sql` est additive. Pour une purge complète locale/contrôlée : supprimer `product_metric_contributions`, `product_metrics` et `product_feedback`, sans toucher aux tables métier. Ne jamais lancer cette purge ni une migration distante sans validation explicite.
