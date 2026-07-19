# 09 — Modèle de sécurité

> Voir aussi : [architecture](./02-product-architecture.md) · [studio](./04-developer-studio.md) · [modèle de données](./08-data-model.md)

Objectif : garantir l'**isolation stricte** du Studio développeur et la **sûreté des mutations sensibles** (grants, révocations, remboursements, feature flags), en réutilisant les mécanismes de sécurité déjà éprouvés du dépôt.

## Socle existant réutilisé (audit — [doc 01](./01-current-state-audit.md))

| Mécanisme | Fichier | Réutilisation SaaS |
|-----------|---------|--------------------|
| Sessions KV + cookie opaque | `packages/worker/src/auth/session.ts` | Modèle répliqué pour le Studio (cookie/secret distincts) |
| OAuth Discord | `src/auth/oauth.ts` | Base pour la connexion des deux espaces |
| Re-vérification perms à chaque requête | `src/auth/guard.ts` (`requireGuildAccess`) | Jamais confiance au client ; principe étendu au dev-auth |
| Politique de mutation (lecture seule modérateur) | `enforcePanelMutationPolicy` | Modèle pour séparation lecture/mutation studio |
| Origin/CSRF sur mutations | `browserMutationOrigin` (index.ts) | Appliqué aux mutations client & studio |
| Signature HMAC + anti-rejeu nonce | `src/security/internal-auth.ts`, table `internal_request_nonces` | Modèle pour webhooks paiement idempotents |
| Révocation globale / par-user | `SESSION_GLOBAL_VERSION`, `security:session-generation:<userId>` | Kill-switch studio & client |
| Audit des actions panel | `adminAudit`, `admin_audit_log(_v2)` | Étendu en `audit_events` studio ([doc 08](./08-data-model.md)) |
| Quotas | `durablePanelQuota`, `security_quota_usage` | Rate-limits studio |

## 1. Séparation des domaines & Workers

- **Deux Workers, deux domaines** : client (`archodev.fr`) et **Studio (`studio.archodev.fr`) = binaire séparé** ([doc 02](./02-product-architecture.md)).
- Le Worker studio n'expose **aucun** endpoint sur le domaine client ; le Worker client n'a **aucune** route studio.
- **Aucune information interne** (logs, erreurs, métriques globales, données d'autres tenants) n'est jamais servie au domaine client.

## 2. Sessions & cookies

- **Cookie client** : `session` (existant) — `httpOnly`, `secure`, `sameSite=Lax`, `path=/`, domaine `archodev.fr`.
- **Cookie studio** : **distinct** (ex. `studio_session`), `httpOnly`, `secure`, **`sameSite=Strict`**, `path=/`, **scopé au domaine `studio.archodev.fr`** (jamais `Domain=.archodev.fr` — pas de partage). Clés KV préfixées `studio:sess:<id>`.
- **Secret de session studio distinct** du client (`STUDIO_SESSION_SECRET`), rotation indépendante.
- **Sessions courtes/renforcées** pour le Studio : TTL absolu plus court que le client **[Hypothèse : ex. 8 h absolu / 30 min idle — à valider doc 13]**, refresh fréquent.
- Révocation : kill-switch global studio (`STUDIO_SESSION_GLOBAL_VERSION`) + par-opérateur.

## 3. Autorisation développeur (dev-auth) — côté serveur

Aujourd'hui **aucun** concept dev/superadmin ([doc 01](./01-current-state-audit.md) §4). À créer :

- **Allowlist explicite** : tables `studio_operators` + `studio_operator_permissions` ([doc 08](./08-data-model.md)). Un utilisateur Discord n'accède au Studio **que** s'il est opérateur `active`.
- **Permissions granulaires** (vérifiées **serveur**, jamais depuis le client) :
  `subscriptions.read`, `subscriptions.grant`, `subscriptions.grant_lifetime`, `subscriptions.revoke_granted`, `subscriptions.cancel_paid`, `subscriptions.refund_paid`, `support.manage`, `guilds.inspect`, `features.manage`, `updates.publish`, `deployments.read`, `deployments.manage`, `audit.read`.
- **Middleware `requireDeveloper(permission)`** : équivalent studio de `requireGuildAccess` — vérifie session studio valide + opérateur actif + permission requise. Toute route `/studio-api/*` en est protégée.
- **Bootstrap** : l'allowlist initiale (premier opérateur = propriétaire) est **[Décision ouverte doc 13]** — provisionnée via secret/migration contrôlée, pas via une route publique.

### Matrice de permissions développeur

Chaque permission = un droit **serveur** vérifié par `requireDeveloper(permission)`. Colonnes : **Type** (lecture / mutation), **Step-up** (réauthentification / confirmation renforcée exigée avant l'action), **Saisie explicite** (frappe d'un mot-clé anti-erreur), **Audit** (entrée `audit_events` obligatoire), **Réversible** (l'effet peut-il être annulé).

| Permission | Type | Step-up | Saisie explicite | Audit | Réversible | Notes |
|------------|------|:-------:|:----------------:|:-----:|:----------:|-------|
| `subscriptions.read` | Lecture | — | — | — | n/a | Consultation abonnements/entitlements (PII masquée sauf droit dédié) |
| `subscriptions.grant` | Mutation | Oui | — | Oui | Oui (révocable) | Octroi d'un accès offert (`granted`/`partner`/`promotion` manuelle) ; **raison obligatoire** |
| `subscriptions.grant_lifetime` | Mutation | **Oui (renforcé)** | **`LIFETIME`** | Oui | Oui (révocable) | Permission **distincte** de `grant` ; jamais implicite |
| `subscriptions.revoke_granted` | Mutation | Oui | — | Oui | — (effet = retrait d'accès offert) | **N'affecte jamais** un `paid` ([doc 06](./06-subscriptions-and-entitlements.md)) |
| `subscriptions.cancel_paid` | Mutation | Oui | — | Oui | Oui (jusqu'à `end_at`) | Annule le **renouvellement** ; accès conservé jusqu'à fin de période |
| `subscriptions.refund_paid` | Mutation | **Oui (renforcé)** | Montant/ref | Oui | **Non** (financier) | Remboursement via prestataire ; procédure séparée |
| `support.manage` | Mutation | — | — | Oui (actions) | Oui | Gérer/assigner/répondre aux tickets ; voit le contenu utilisateur |
| `guilds.inspect` | Lecture | — | — | — | n/a | Inspection guildes **lecture seule** ; données personnelles minimisées |
| `features.manage` | Mutation | Oui | — | Oui | Oui | Feature flags & mapping features→offres ; kill-switch = effet large |
| `updates.publish` | Mutation | — | — | Oui | Oui (archivable) | Publier/programmer une note de mise à jour |
| `deployments.read` | Lecture | — | — | — | n/a | Historique/état infra & déploiements |
| `deployments.manage` | Mutation | **Oui (renforcé)** | — | Oui | Selon action | Déclencher un déploiement ; **[Hypothèse]** consultation seule au départ ([doc 04](./04-developer-studio.md)) |
| `audit.read` | Lecture | — | — | — | n/a | Lire le journal immuable ; **jamais** de mutation possible sur l'audit |

Principes de la matrice :
- **Aucune** permission n'autorise la révocation « simple » d'un `paid` : il n'existe pas de droit `subscriptions.revoke_paid` (par conception).
- **Aucune** permission n'autorise UPDATE/DELETE sur `audit_events` : l'audit est **append-only**, même pour un admin studio.
- Les droits sont **cumulables mais indépendants** : `grant_lifetime` n'est **jamais** impliqué par `grant` ; `refund_paid` n'est **jamais** impliqué par `cancel_paid`.
- Le rôle « admin studio » (gestion `studio_operators`/`studio_operator_permissions` depuis `/settings`) est **au-dessus** de cette matrice et lui-même audité.

## 4. Séparation lecture / mutation

- Par défaut, les routes studio sont en **lecture**. Toute **mutation** exige une permission explicite **et** est **auditée**.
- Les actions **destructrices ou financières** (lifetime, remboursement, suspension d'un payé, changement de permissions) exigent :
  - **réauthentification / step-up** (re-saisie ou re-consentement récent) **[Hypothèse à valider]** ;
  - **confirmation renforcée** (double confirmation) ;
  - une **saisie explicite** pour les cas extrêmes (`LIFETIME`, nom de la cible…) ;
  - une entrée `audit_events` complète.

## 5. CSRF / Origin / méthodes

- Réutiliser `browserMutationOrigin` : toute mutation studio vérifie l'`Origin`/`Referer` contre une allowlist stricte (`studio.archodev.fr` uniquement).
- `sameSite=Strict` sur le cookie studio réduit encore la surface CSRF.
- Séparer verbes : lectures en `GET` idempotents, mutations en `POST`/`PATCH`/`DELETE` avec vérif origin.

## 6. Rate limits & anti-abus

- Rate-limits par opérateur et par action sensible (réutiliser `durablePanelQuota` / `security_quota_usage`).
- Limites spécifiques sur les endpoints d'octroi (`grant`, `grant_lifetime`) pour éviter les abus.
- Côté client : anti-abus des **réaffectations d'emplacements** (cooldown, [doc 06](./06-subscriptions-and-entitlements.md)).

## 7. Webhooks de paiement

- Route `/webhooks/<provider>` sur le Worker **client** (source des `paid`), **hors session**, **vérifiée par signature** (HMAC/clé prestataire via Web Crypto — même famille que l'HMAC interne existant).
- **Idempotence** : table d'événements traités (réutiliser le pattern `internal_request_nonces` / `processed_events`) → un webhook rejoué n'a aucun effet.
- Le Worker ne crée **jamais** un entitlement `paid` sans webhook confirmé ([doc 06](./06-subscriptions-and-entitlements.md), [doc 07](./07-billing-provider-analysis.md)).

## 8. Audit immuable

- `audit_events` **append-only** (aucune route UPDATE/DELETE) — [doc 08](./08-data-model.md).
- Enregistre acteur, action, cible, métadonnées (**secrets/PII masqués**), horodatage, hash d'IP.
- Consultable via `/audit` (`audit.read`) ; **jamais** exposé au client.
- Couvre : grants (dont lifetime), révocations, annulations/remboursements payés, suspensions, feature flags, publications de notes, changements de permissions et d'allowlist.

## 9. Masquage des secrets & données sensibles

- Secrets via `wrangler secret bulk fichier.json` puis suppression du fichier — **jamais** `Write-Output "x" | wrangler secret put` (piège CRLF/401 connu du projet, cf. `CLAUDE.md`).
- Secrets distincts par espace : `SESSION_SECRET` (client) vs `STUDIO_SESSION_SECRET`, `INTERNAL_API_TOKEN` (existant) vs éventuel token studio, clé API + secret webhook prestataire.
- **PII masquée** dans logs/audit/UI studio (emails billing, notes internes) ; affichage complet seulement sous permission.
- Le domaine client ne reçoit **jamais** de secret ni de donnée d'un autre tenant.

## 10. Séparation production / développement

- **Environnement production clairement identifiable** dans le Studio (bandeau permanent, accent distinct).
- Environnements séparés (prod vs dev) avec bindings/secrets propres **[Hypothèse : à formaliser — doc 13]**.
- Les déploiements sensibles (`deployments.manage`) passent par un workflow contrôlé et audité (au départ possiblement **consultation seule** dans le Studio, déclenchement CLI — [doc 04](./04-developer-studio.md)).

## Modèle de menaces (principales)

| Menace | Vecteur | Contre-mesure |
|--------|---------|---------------|
| Escalade client → studio | Réutilisation de cookie/session | Cookie & secret séparés, domaine distinct, dev-auth serveur, `sameSite=Strict` |
| Accès studio non autorisé | Utilisateur non-opérateur | Allowlist `studio_operators` vérifiée serveur ; 100 % des routes `/studio-api/*` gardées |
| CSRF sur mutation sensible | Requête cross-site | Vérif Origin (`browserMutationOrigin`) + `sameSite=Strict` |
| Révocation abusive d'un payé | Bug/abus opérateur | Contrainte backend `paid` non révocable ; workflows dédiés audités |
| Grant lifetime accidentel/malveillant | Erreur/abus | Permission dédiée + `LIFETIME` + step-up + audit |
| Rejeu de webhook paiement | Webhook dupliqué | Signature + idempotence (nonce/événements traités) |
| Fuite de PII/secret vers client | Réponse mal filtrée | Masquage systématique, séparation stricte des surfaces |
| Vol de session | Fixation/exfiltration | TTL courts studio, `httpOnly`+`secure`, révocation globale/par-opérateur |
| Falsification de perms côté client | UI modifiée | **Aucune confiance** au client : tout est vérifié serveur (permissions, plan, révocabilité) |
| Suppression silencieuse de config (downgrade) | Logique erronée | Suspension sans suppression ([doc 06](./06-subscriptions-and-entitlements.md)), audité |
| **Compromis d'un compte développeur** | Vol de session studio / OAuth | TTL courts studio, `sameSite=Strict`, step-up sur actions sensibles, kill-switch par-opérateur, audit → détection a posteriori, permissions minimales par opérateur |
| **Escalade de privilèges intra-Studio** | Opérateur s'auto-octroyant des droits | Gestion de l'allowlist/permissions réservée à l'**admin studio**, elle-même auditée ; `grant_lifetime`/`refund_paid` en permissions **distinctes** non impliquées |
| **Fuite inter-guilde (cross-tenant)** | Réponse mal scopée | Scoping `guildId` systématique (existant) ; vue cross-guilde **uniquement** côté Studio sous `guilds.inspect`, jamais exposée au client |
| **Abus interne** (grants/remboursements indus) | Opérateur malveillant/négligent | Raison obligatoire, step-up, saisie explicite, audit **immuable** append-only, rate-limits sur `grant`/`grant_lifetime`, revue a posteriori |

## Principe cardinal

**Aucune confiance dans les informations envoyées par le client.** Permissions, plan effectif, révocabilité, emplacements : tout est **recalculé et vérifié côté serveur**. L'UI (verrouillage Premium, boutons masqués) n'est jamais l'unique barrière — elle double une garde backend.

## Séparation décision sécurité / technique / produit

- **Sécurité** : isolation domaines/cookies, dev-auth, step-up, audit immuable, masquage.
- **Technique** : réutilisation `guard`/`session`/`internal-auth`, webhooks idempotents, secrets séparés.
- **Produit** : niveaux d'opérateurs, allowlist initiale, politiques de rétention (**[doc 13]**).
