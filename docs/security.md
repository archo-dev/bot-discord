# Sécurité publique multi-tenant — M02

## Threat model

| Frontière | Menaces | Contrôles existants | Écarts M02 |
|---|---|---|---|
| Navigateur → Worker | CSRF, vol de session, clickjacking, corps excessif | cookie HttpOnly/SameSite, guards | Origin, CSP, expiration/inactivité, body limits |
| OAuth Discord | login CSRF, token divulgué ou expiré | state à usage unique | liaison au navigateur, minimisation et redaction |
| API panel → D1/Discord | IDOR, escalade modérateur | session, guild guard, Zod, rate limit | matrice deny-by-default, audit et quota durable |
| Gateway → Worker | secret volé, rejeu, corps modifié | bearer TLS | signature versionnée, rotation, nonce atomique |
| Worker → Gateway | secret volé, rejeu, action non prévue | bearer + tunnel | signature directionnelle, allowlist, body limit |
| D1/KV | fuite inter-guilde, croissance, concurrence KV | SQL scopé, TTL/purge | contraintes, rétentions et opérations atomiques D1 |
| Discord | permissions/intents excessifs | permissions métier vérifiées | inventaire et justification publique |
| Logs | secret, contenu ou identifiant inutile | télémétrie M01 allowlistée | suppression des erreurs/payloads bruts restants |

## Matrice panel

La source exécutable et versionnée est `PANEL_MUTATION_POLICIES` dans `@bot/shared`. Elle recense les 20 mutations actuelles. Une mutation de guilde absente de ce registre reçoit `403 security_policy_missing`.

- `manage_guild` : toutes les mutations ;
- `panel_admin` : toutes sauf `panel_access_manage` ;
- `panel_moderator` : aucune mutation ;
- utilisateur sans accès : aucune lecture ni mutation de la guilde ;
- Santé et audit : administrateurs complets uniquement.

## Surfaces non-panel

- `/interactions` : POST Discord signé Ed25519 uniquement.
- `/auth/login`, `/auth/callback`, `/auth/logout` : OAuth et cycle de session.
- `/internal/*` : Gateway vers Worker uniquement.
- Gateway `/health` et `/music` : Worker vers Gateway uniquement via tunnel.

## Secrets — noms et fonctions

Aucune valeur ne doit être journalisée, documentée ou commitée.

- `DISCORD_TOKEN` : bot REST et connexion Gateway ;
- `DISCORD_PUBLIC_KEY` : vérification Ed25519 des interactions ;
- `DISCORD_CLIENT_SECRET` : échange OAuth serveur ;
- `SESSION_SECRET` : dérivations HMAC de pseudonymes ;
- `INTERNAL_API_TOKEN` : secret maître Gateway → Worker ;
- `GATEWAY_HTTP_TOKEN` : secret maître Worker → Gateway ;
- variantes `*_PREVIOUS` : fenêtre transitoire de rotation uniquement ;
- credentials Cloudflare/SSH/tunnel : hors application et hors dépôt.

## Intents Discord

- `Guilds` : cycle de vie et configuration de base ;
- `GuildMembers` (privilégié) : accueil, auto-rôles, recherche membre ;
- `GuildMessages` : événements de messages ;
- `MessageContent` (privilégié) : automod, XP et commandes mot-clé ;
- `GuildVoiceStates` : musique, logs et XP vocal ;
- `GuildMessageReactions` : starboard ;
- `GuildPresences` (privilégié, opt-in env) : statistiques de présence.

## Permissions d’installation actuellement demandées

L’URL documentée demande : expulser, bannir, voir les salons, gérer les messages, joindre des fichiers, lire l’historique, utiliser les commandes et modérer les membres. Les modules rôles, tickets et salons temporaires peuvent nécessiter des permissions additionnelles explicites (`Gérer les rôles`, `Gérer les salons`, `Déplacer des membres`, `Envoyer des messages`, `Intégrer des liens`) ; elles ne doivent pas être ajoutées silencieusement au Developer Portal.
