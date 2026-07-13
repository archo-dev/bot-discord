# Milestone 2 — Socle de sécurité publique multi-tenant

## 1. Résumé

Transformer les protections existantes en politique de sécurité démontrable avant l’ouverture publique : threat model, permissions minimales, sessions renforcées, quotas cohérents, API interne durcie, audit administratif et tests systématiques d’isolation.

## 2. Problème et preuves

- Les routes guildes ont des guards centralisés et Zod, mais aucune matrice exhaustive route × rôle n’est versionnée.
- Le limiter KV est best effort et non atomique ; il protège les bursts simples, pas un abus distribué.
- Des secrets existent légitimement sur Worker et VPS ; leur rotation et portée doivent être formalisées.
- Les sessions OAuth stockent access/refresh tokens en KV ; cycle de révocation/rotation à auditer.
- Discord impose vérification au-delà de 100 serveurs et renforce les exigences d’accès aux données.

## 3. Valeur utilisateur

- Invitation aux permissions justifiées et minimales.
- Garantie que les données/actions d’un serveur ne traversent pas vers un autre.
- Historique des changements sensibles et sessions révocables.

## 4. Valeur technique

- Réduit risques IDOR, CSRF, abus, secret compromis et escalade admin/modérateur.
- Rend l’audit reproductible et évite les protections ad hoc.
- Prépare vérification Discord, politique de confidentialité et support public.

## 5. Comparaison concurrentielle

Les concurrents mettent surtout en avant simplicité et premium, rarement leurs contrôles. Le bot peut se différencier par permissions explicites, audit gratuit et collecte minimale. Ticket Tool documente finement permissions et confidentialité des transcripts : niveau attendu pour les workflows sensibles.

## 6. Architecture proposée

- Threat model STRIDE léger par frontière : navigateur, OAuth, Worker, D1/KV, Gateway, Discord, tunnel.
- Politique centralisée `capability -> access level -> HTTP methods`.
- Vérification Origin/CSRF pour mutations cookie-authentifiées, stratégie token synchronizer ou double-submit selon Hono/Cloudflare.
- Sessions avec expiration absolue/inactivité, révocation et rotation sûre.
- Rate limits à deux étages : local/burst et quota durable agrégé pour opérations coûteuses.
- Auth interne avec token versionné/rotatable, audience et éventuellement signature horodatée pour anti-rejeu.
- Audit append-only borné des changements administratifs, jamais des contenus Discord.

## 7. Packages, modules et fichiers concernés

- `worker/src/auth/*`, `index.ts`, `ratelimit.ts`, `internal/routes.ts`, routes API.
- `gateway/src/worker-api.ts`, `env.ts`, `http.ts`.
- `shared/src/permissions.ts`, nouveaux types capabilities/audit.
- `panel/src/lib/api.ts`, accès, session et messages de permission.
- Tests `api-guard`, `access-levels`, interactions et nouveaux tests CSRF/quota.

## 8. Routes API concernées

Toutes les routes mutantes `/api/guilds/:guildId/*`, `/auth/*` et `/internal/*` sont auditées. Nouvelles routes possibles : session active/révocation et lecture d’audit administrateur paginée.

## 9. Tables et migrations D1 éventuelles

- `admin_audit_log` : guilde, acteur, action, cible technique, résultat, date, métadonnées allowlistées.
- Éventuelle table de quotas journaliers agrégés.
- Sessions restent KV sauf preuve contraire.
- Rétention explicite, index guilde/date, aucune suppression destructive lors du déploiement initial.

## 10. Modifications Gateway

- Support rotation de credential interne sans coupure si nécessaire.
- Validation stricte des commandes HTTP entrantes du Worker.
- Logs redacted, timeouts, limites de body et allowlist d’actions.

## 11. Modifications Worker

- Middleware Origin/CSRF, quotas et capacités.
- Codes d’erreur stables sans détails sensibles.
- Audit des mutations réussies/échouées pertinentes.
- Durcissement cookies/session et headers de sécurité.

## 12. Modifications panel

- Gestion expiration/session révoquée.
- Affichage permissions demandées et raison d’un contrôle désactivé.
- Page sessions/audit uniquement si bénéfice confirmé ; pas de console sécurité complexe.

## 13. Sécurité et permissions

C’est le cœur de la milestone : moindre privilège, deny-by-default, séparation modérateur/admin, protection actions destructives, validation d’appartenance Discord, tests IDOR, rotation documentée et aucune sécurité réservée au premium.

## 14. Performance et montée en charge

Les contrôles fréquents doivent utiliser contexte/cache existants. Les quotas durables ne doivent pas ajouter une écriture D1 par lecture. Préférer agrégats et limites seulement sur opérations coûteuses.

## 15. Risques

- Bloquer un parcours légitime par CSRF/origin mal configuré.
- Déconnecter toutes les sessions pendant migration.
- Complexifier la rotation Worker/Gateway.
- Journal d’audit contenant trop de métadonnées.

## 16. Dépendances

Dépend de la taxonomie et corrélation de M1. Précède modules, onboarding, backup, analytics, tickets et automation.

## 17. Développement par phases

1. Threat model, inventaire secrets/intents/permissions et matrice routes.
2. Tests d’isolation et permissions avant changement.
3. Sessions, cookies, CSRF/origin et headers.
4. API interne/rotation/anti-rejeu.
5. Quotas et audit administratif.
6. Documentation légale/opérationnelle et préparation Discord.

## 18. Tests

- Table-driven route × rôle × méthode.
- Guild A ne lit/modifie jamais Guild B.
- CSRF, origin absent/faux, session expirée/révoquée.
- Burst/quota, concurrence et panne KV.
- Anti-rejeu interne, rotation ancienne/nouvelle clé.
- Scan des réponses/logs pour secrets.

## 19. Rollback

- Modes report-only pour origin/quota/audit avant enforcement.
- Accepter temporairement ancienne et nouvelle auth interne durant rotation.
- Migration additive ; désactivation des middlewares nouveaux par variable existante ou constante de déploiement validée, sans baisse silencieuse de sécurité.

## 20. Indicateurs de réussite

- 100 % des routes mutantes dans la matrice et les tests.
- Zéro violation d’isolation dans la suite automatisée.
- 100 % des permissions/intents d’installation justifiés et documentés.

## 21. Estimation détaillée

- Audit/conception : 2–3 j.
- Développement : 3–6 j.
- Tests/corrections : 2–3 j.
- Documentation/passation : 1–2 j.
- Total : 8–14 j. Rallonges : changement de stratégie CSRF, rotation prod et exigences Discord à jour.

## 22. Documentation

Threat model, matrice d’autorisation, secrets/rotation, incident response, confidentialité/rétention, permissions OAuth/bot, checklist de vérification Discord.

## 23. Passation à Claude

Claude doit fournir des preuves et tests avant de durcir. Il ne doit jamais afficher les valeurs de `.dev.vars`, lire des messages Discord, modifier les permissions du bot ou appliquer une migration distante sans validation.

## 24. Prompt d’implémentation prêt à copier-coller

```text
Tu implémentes la milestone « Socle de sécurité publique multi-tenant » de botdiscord.

Lis CLAUDE.md, docs/milestone-codex/02-securite-multitenant.md et la documentation de M1 déployée. Depuis master propre, crée milestone/public-security et un point de restauration. Avant de coder, produis un threat model léger, l’inventaire des permissions/intents/secrets sans leurs valeurs, et une matrice route × méthode × rôle. Présente le plan pour validation.

Travaille deny-by-default, préserve l’isolation guildId et le Worker comme seul écrivain D1. Ajoute d’abord les tests IDOR/permissions, puis sessions/CSRF/origin, auth interne rotatable, quotas et audit borné. Ne journalise aucun token, contenu Discord ou payload brut. Toute migration est additive, réversible, testée localement et interdite en remote sans autorisation. Prévois un mode report-only lorsque le blocage pourrait casser OAuth ou le panel.

Commits séparés par phase, tests Worker/Gateway/panel, typecheck et build complets. Documente rotation, incident, permissions, confidentialité et rollback. Ne change pas le Developer Portal, les secrets ou la production et ne déploie pas. Termine par résultats exacts, risques résiduels et fichiers modifiés.
```
