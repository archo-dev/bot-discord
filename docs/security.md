# Sécurité publique multi-tenant — M02

## Modèle de menace et frontières

| Frontière | Menaces principales | Contrôles M02 |
|---|---|---|
| Navigateur → Worker | CSRF, vol/fixation de session, clickjacking, corps excessif | Origin exacte, état OAuth lié au navigateur et à usage unique, cookies HttpOnly/SameSite, expirations, CSP, limites par famille |
| API panel → D1/Discord | IDOR, escalade modérateur, abus coûteux | contrôle de guilde à chaque requête, matrice deny-by-default, quotas atomiques, audit minimal |
| Gateway → Worker | secret volé, rejeu, corps/route modifiés | HMAC directionnel versionné, allowlist, horodatage, nonce D1 atomique, hash du corps |
| Worker → Gateway | appel non prévu, rejeu | HMAC directionnel distinct, allowlist, cache de nonces borné, limite 32 Kio |
| D1/KV et logs | fuite inter-guilde, croissance, données privées | scoping, pseudonymes HMAC, dimensions finies, rétention et purge quotidienne |

## Autorisation panel

`PANEL_MUTATION_POLICIES` dans `@bot/shared` est la source exécutable des 20 mutations. Toute nouvelle mutation de guilde absente reçoit `403 security_policy_missing`.

- `manage_guild` : accès complet, gestion des accès incluse ;
- `panel_admin` : accès complet hors gestion des accès ;
- `panel_moderator` : lecture seule ;
- sans accès : aucune lecture ni écriture de la guilde ;
- santé détaillée et audit : administrateurs complets seulement.

Les contrôles frontend sont ergonomiques uniquement : le Worker revalide la session, l’installation du bot, les permissions Discord et les grants pour chaque requête.

## Sessions et OAuth

- état OAuth aléatoire, lié à un cookie HttpOnly, consommé une seule fois dans KV ;
- cookie `Secure` sur HTTPS et non `Secure` sur le localhost HTTP ;
- session absolue : 24 h ; inactivité maximale : 2 h ; écriture du touch limitée à une fois par 15 min ;
- révocation globale par utilisateur via `POST /auth/revoke-all` et révocation de toutes les sessions via `SESSION_GLOBAL_VERSION` ;
- le refresh token Discord n’est jamais persisté ;
- l’access token est conservé uniquement pendant la session car `/users/@me/guilds` est nécessaire pour revalider `MANAGE_GUILD` ;
- les corps d’erreur OAuth Discord ne sont ni renvoyés ni journalisés.

## Sécurité navigateur

`PANEL_ORIGIN` est l’origine canonique. `PANEL_ALLOWED_ORIGINS`, lorsqu’elle est définie, est une liste explicite supplémentaire ; aucune wildcard ni comparaison partielle n’est acceptée. Une mutation dont l’en-tête `Origin` ne correspond pas reçoit `403 csrf_rejected` en mode `enforce`.

Les réponses posent `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, une politique de frame et HSTS sur HTTPS. La CSP est initialement en `report` (`SECURITY_CSP_MODE=report`) afin d’observer les incompatibilités ; `style-src 'unsafe-inline'` reste temporairement requis par React/Recharts et doit être réévalué avant `enforce`. `prefers-reduced-motion` demeure géré par le panel.

Limites de corps : auth 8 Kio, API panel 64 Kio, interactions Discord 256 Kio, interne Worker 512 Kio et endpoint musique Gateway 32 Kio.

## Protocole interne signé

La chaîne canonique couvre : version, identifiant de clé, direction/audience, méthode, chemin et query normalisés, timestamp, nonce, SHA-256 du corps. Les clés HMAC-SHA-256 sont dérivées par HKDF avec contexte de direction ; une clé Gateway→Worker ne valide donc pas Worker→Gateway. La vérification utilise `crypto.subtle.verify`, une fenêtre de 120 secondes et une allowlist exacte de routes.

Gateway→Worker garantit l’anti-rejeu par la contrainte primaire D1 `(direction, nonce_hash)` : l’insertion atomique n’accepte qu’un concurrent. Les nonces sont hashés et expirent après 5 minutes. Worker→Gateway utilise un cache mémoire borné à 10 000 nonces, adapté à cette destination Node unique.

### Rotation sans interruption

1. Générer une nouvelle valeur hors dépôt et un nouvel identifiant de clé.
2. Installer l’ancienne valeur dans `*_PREVIOUS` sur le vérificateur, la nouvelle dans la valeur courante, conserver `dual`.
3. Déployer d’abord les vérificateurs, puis les émetteurs avec le nouvel identifiant.
4. Vérifier heartbeats, musique, taux de 401/409 et absence de `unknown_key` pendant au moins une fenêtre de trafic.
5. Passer les deux côtés en `signed`, puis retirer les valeurs précédentes après la période de rollback.

Un HMAC invalide ne retombe jamais sur Bearer. `legacy` ne sert qu’au rollback contrôlé ; `dual` est transitoire ; la cible est `signed`.

## Audit, quotas et rétention

`admin_audit_log` conserve 90 jours : guilde, auteur, niveau d’accès, capacité finie, méthode, cible technique bornée, succès/échec, statut, request ID et date. L’identifiant brut de l’auteur est la seule donnée personnelle nécessaire à l’imputabilité ; il est visible uniquement aux administrateurs de la guilde. Aucun corps, contenu Discord, message, salon, token, IP, URL ou erreur brute n’est stocké.

`security_quota_usage` conserve 7 jours et utilise des pseudonymes HMAC séparés par contexte et guilde. Quotas journaliers : identité du bot 10/utilisateur et 50/guilde ; publications rôles/tickets 10/utilisateur et 100/guilde ; musique 300/utilisateur et 2 000/guilde. L’upsert multi-ligne D1 accepte simultanément les scopes utilisateur et guilde ou refuse l’action avec `429 quota_exceeded`.

La purge quotidienne supprime nonces expirés, quotas de plus de 7 jours et audit de plus de 90 jours. Les métriques M01 restent agrégées, pseudonymisées et conservées 30 jours.

## Secrets et Discord

Ne jamais journaliser, afficher ou committer les valeurs de `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`, `GATEWAY_HTTP_TOKEN` ni leurs variantes `*_PREVIOUS`.

Intents justifiés : Guilds ; GuildMembers (accueil/auto-rôles/recherche) ; GuildMessages et MessageContent (automod/XP/commandes) ; GuildVoiceStates (musique/logs/XP vocal) ; GuildMessageReactions (starboard) ; GuildPresences uniquement si l’option de statistiques est activée. Avant ouverture publique, vérifier dans le Developer Portal les intents privilégiés et les permissions d’installation réellement nécessaires à chaque module.

## Incident et rollback

En cas de CSRF/session : incrémenter `SESSION_GLOBAL_VERSION`, révoquer l’utilisateur si ciblé, vérifier les origines, puis inspecter les request IDs sans extraire de payload. En cas de clé interne compromise : rotation immédiate, déploiement vérificateur puis émetteur, surveillance des 401/409, retrait de l’ancienne clé.

Rollback applicatif : revenir au commit précédent sans supprimer les trois tables additives. Pour un incident de signature pendant le rolling deploy, repasser temporairement en `dual`, jamais désactiver l’allowlist ou l’anti-rejeu. Pour les headers, garder CSP en `report` le temps de corriger. Une migration D1 distante et tout déploiement nécessitent une autorisation explicite ; aucune commande de suppression de table ne fait partie du rollback.

## Gate avant production

1. sauvegarde D1 et revue de `0021_public_security.sql` ;
2. appliquer la migration distante explicitement autorisée avant le nouveau Worker ;
3. provisionner les secrets et identifiants de clé sans les afficher ;
4. déployer selon la séquence de rotation ci-dessus en `dual` ;
5. vérifier OAuth, origins production, audit admin/modérateur, quotas, heartbeats et musique ;
6. observer CSP report-only et télémétrie ;
7. passer à `signed`, puis retirer les clés précédentes lors d’un déploiement séparé.
