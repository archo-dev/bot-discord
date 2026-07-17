# Centre de sanctions et commandes Discord

## Port\u00e9e

Le centre de sanctions du panel g\u00e8re les avertissements, timeout, kick et
ban, avec historique filtrable, r\u00e9vocation lorsque Discord le permet, et
exemptions par r\u00f4le et par type de sanction. Le Worker reste le seul
\u00e9crivain D1 et le seul composant qui appelle l'API REST Discord ; le gateway
n'acc\u00e8de jamais directement \u00e0 D1.

La migration additive `0027_panel_sanctions.sql` ajoute les m\u00e9tadonn\u00e9es de
cycle de vie des sanctions, les exemptions et les cl\u00e9s d'idempotence. Une
demande de panel est d'abord r\u00e9serv\u00e9e dans D1 : rejouer la m\u00eame cl\u00e9 ne
rejoue donc pas un appel Discord destructif. Les demandes sont purg\u00e9es apr\u00e8s
30 jours.

## Contr\u00f4les de s\u00e9curit\u00e9

Chaque mutation v\u00e9rifie les permissions du mod\u00e9rateur, le propri\u00e9taire du
serveur, la hi\u00e9rarchie des r\u00f4les, les permissions du bot et les exemptions
avant l'appel Discord. Les routes de mutation sont journalis\u00e9es par l'audit
du Worker. Ne pas tester kick ou ban sur un compte r\u00e9el en production.

## Commandes : diagnostic et nettoyage

`pnpm commands:validate` est un contr\u00f4le hors r\u00e9seau utilis\u00e9 en CI : il
refuse les d\u00e9finitions top-level dupliqu\u00e9es et v\u00e9rifie que `/voice kick`
existe. `pnpm commands:diff` compare les commandes globales et celles de la
guilde de test. Le nettoyage est toujours d'abord simul\u00e9 :

```powershell
pnpm commands:cleanup:guild
pnpm commands:cleanup:guild --apply
pnpm commands:diff
```

Seules les commandes de guilde int\u00e9gr\u00e9es, aussi pr\u00e9sentes au niveau global,
sont supprim\u00e9es. La commande `/voice` est exclue volontairement afin de ne
jamais supprimer `/voice kick`; les commandes d'autres int\u00e9grations ne sont
pas candidates.

## D\u00e9ploiement et retour arri\u00e8re

Avant une migration distante, sauvegarder D1 hors Git, relever taille et SHA-256,
puis ex\u00e9cuter `wrangler d1 migrations list <base> --remote`. N'appliquer que
les migrations r\u00e9ellement en attente. Apr\u00e8s le d\u00e9ploiement du Worker et du
panel, contr\u00f4ler en lecture seule le panel, les r\u00f4les, l'historique et les
commandes. La migration est additive : le retour arri\u00e8re consiste \u00e0 red\u00e9ployer
le commit ant\u00e9rieur et \u00e0 conserver les nouvelles colonnes/tables inutilis\u00e9es,
sans restauration D1 destructive.
