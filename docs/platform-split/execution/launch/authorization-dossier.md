# Dossier d'autorisation de lancement — Plateforme SaaS Archodev

> Produit en M16. **Aucune action de production n'a été exécutée.** Ce dossier réunit l'état de préparation, les décisions propriétaire encore requises et la séquence exacte de go-live (commandes **documentées, non exécutées**).

---

## ÉTAT

```
READY FOR GO-LIVE — AWAITING EXPLICIT OWNER APPROVAL
```

Tout le code, la configuration (par placeholders) et les brouillons sont prêts et **réversibles**. Le go-live est **bloqué** en attente : (a) des décisions propriétaire ci-dessous, (b) de la validation juridique des brouillons, (c) d'une **autorisation explicite** de lancer.

---

## 1. Décisions propriétaire requises AVANT go-live (à cocher)

| # | Décision | Requis pour | Statut |
|---|----------|-------------|:------:|
| D1 | **Prix** Premium & Business (montants finaux, hors code) | Afficher les prix, checkout | ☐ |
| D3 | **Prestataire** de paiement (MoR Lemon Squeezy **ou** Stripe) | Billing prod, TVA | ☐ |
| D12 | **Politique de remboursement** (fenêtre, conditions) | CGV, workflow `refund_paid` | ☐ |
| D18 | **Rétention** (billing/PII, tickets, audit, entitlements) | Confidentialité, conformité | ☐ |
| D20 | **TVA / obligations fiscales** (dépend de D3) | Facturation conforme | ☐ |
| D21 | **CGV / mentions / confidentialité** **validées par un avocat** | Vente légale | ☐ |
| D17 | **Domaines** confirmés (`archodev.fr`, `studio.archodev.fr`) | DNS, OAuth, cookies | ☐ |

> Tant qu'une case reste vide, **ne pas** lancer. Les brouillons juridiques (`legal/*.draft.md`) sont **non validés**.

## 2. Préparation technique (faite en M1–M16, non déployée)

- ✅ Entitlements (M6), slots/gating (M7), espace client (M8).
- ✅ Billing sandbox découplé (M9), webhooks signés idempotents — **`paid` uniquement via webhook** (M10).
- ✅ Support priorisé (M11).
- ✅ Studio isolé + dev-auth + grants/lifetime + audit immuable + step-up + rate-limits + kill-switch (M12–M14).
- ✅ Observabilité + rollout par cohortes (M15).
- ✅ Flag `platform.launch` + prix hors code (`/api/pricing`) + brouillons juridiques (M16).
- ⏳ **Migrations distantes `0032`→`0039` NON appliquées** (`migrate:remote` en attente).
- ⏳ **Aucun déploiement**, **aucun secret prod**, **aucune clé live**, **tous les flags off en prod**.

## 3. Pré-requis avant d'exécuter le go-live

1. Décisions §1 tranchées ; brouillons juridiques **validés** et intégrés.
2. Prestataire (D3) configuré en **mode live** hors dépôt (clés via `wrangler secret bulk`).
3. Prix (D1) fixés → variables `LAUNCH_PRICE_*` + `LAUNCH_CURRENCY`.
4. Domaines (D17) prêts (DNS, callback OAuth, endpoint Interactions).
5. Sauvegarde/mesure de rollback validée (revert flag testé en preview).

## 4. Séquence de go-live (voir `go-live-runbook.md` — NE PAS exécuter ici)

Résumé ordonné, chaque étape réversible :
1. `pnpm run migrate:remote` (additif `0032`→`0039`).
2. Secrets prod via `wrangler secret bulk fichier.json` puis suppression du fichier.
3. `pnpm --filter @bot/worker run deploy` (worker + panel).
4. (Studio) déploiement séparé + `STUDIO_HOST`/`STUDIO_OWNER_IDS`.
5. Activation **par cohortes** (M15) : guildes pilotes → général, flag par flag.
6. Smoke tests prod (`12-testing-and-release-strategy.md` §9).
7. `platform.launch` on quand prix + juridique prêts.

## 5. Critères de succès / rollback

- **Succès** : `/status` vert, login client + Studio OK (cookies séparés), `/api/subscription` correct, webhook test → `paid` (idempotent), `/api/pricing` affiche les prix, premier achat sandbox→live vérifié.
- **Rollback** : bascule de flag off (instantané) ; re-deploy version précédente ; migrations additives (pas de destructif) ; `STUDIO_KILL_SWITCH` pour couper le Studio.

## 6. Barrière de sécurité respectée en M16

Aucune de ces actions n'a été exécutée : `migrate:remote`, déploiement Worker/Gateway, systemd, cron, secrets Cloudflare, DNS, domaine custom, clé/prix Stripe live, paiement réel, activation de flag prod, publication juridique validée.

---

**Signature d'autorisation (propriétaire)** : ______________________  Date : __________

Tant que cette ligne n'est pas signée et les cases §1 cochées, l'état reste `AWAITING EXPLICIT OWNER APPROVAL`.
