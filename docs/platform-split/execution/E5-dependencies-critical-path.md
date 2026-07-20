# E5 — Dépendances & chemin critique

> Voir aussi : [milestones](./E4-milestones.md) · [synthèse décisions](./E1-decision-synthesis.md) · [git](./E6-branching-strategy.md)

## Graphe de dépendances (textuel)

```
M1 Fondations & design system
│
├─▶ M2 Shell public ─▶ M3 Landing ─▶ M4 Pricing
│        │
│        └─▶ M5 Notes de mise à jour (D1: 0032)
│
├─▶ M6 Entitlements (flag, D1) ──┬─▶ M7 Slots & gating (D1)
│                                ├─▶ M8 Espace abonnement client
│                                ├─▶ M9 Billing sandbox (D1, prestataire) ─▶ M10 Webhooks
│                                └─▶ M11 Support (D1)
│
└─▶ M12 Studio minimal (D1, domaine studio) ──┬─▶ M13 Grants & lifetime
    (dépend aussi de M6)                       ├─▶ M14 Audit & sécurité renforcée
                                               └─▶ M15 Déploiement progressif & observabilité

M16 Lancement commercial ◀── M9 + M10 + M15 (+ décisions D1/D3/D12/D17/D18/D20/D21)

M17? (aucun) — pas de milestone au-delà du lancement dans ce périmètre.
```

## Ce qui peut être développé en parallèle

Après **M1** (socle commun), deux à trois pistes avancent **en parallèle** :

- **Piste PUBLIC** : M2 → M3 → M4, et M5 (indépendante après M2). *Aucune dépendance billing/studio.*
- **Piste CŒUR MÉTIER** : M6 → { M7, M8, M11 } ; puis M9 → M10.
- **Piste STUDIO** : M12 (après M6) → { M13, M14, M15 }.

> M8 (espace abonnement) et M11 (support) ne dépendent que de M6 → parallélisables entre eux. M7 (slots) et M9 (billing) ne dépendent que de M6 → parallélisables, mais M9 exige **D3** (prestataire).

## Exigences transverses

| Exige… | Milestones concernés |
|--------|----------------------|
| **D1 (base de données)** | M5, M6, M7, M9, M10, M11, M12, M13, M14 (migrations `0032+`) |
| **Un prestataire de paiement (D3)** | M9, M10, M16 |
| **Le Studio (Worker séparé)** | M12, M13, M14, M15 |
| **Les domaines custom** | `studio.archodev.fr` → M12 ; `archodev.fr` → M16 (dev sur `*.workers.dev` avant) |
| **Rien de tout ça (testable sans prod)** | M1, M2, M3, M4, M8 (sur `*.workers.dev`, sandbox) |

## Ce qui peut être testé sans production

- **Sans prod ni prestataire** : M1, M2, M3, M4, M6 (unitaires purs), M7 (miniflare), M8 — via `pnpm --filter @bot/worker test` (D1/KV réels miniflare) et build panel.
- **Sandbox uniquement** : M9, M10 (webhooks) avec le mode test du prestataire — **jamais** de vraie CB avant M16.
- **Studio en local/preview** : M12–M15 sur un hostname de preview avant la bascule DNS définitive.

## Chemin critique jusqu'au premier lancement public

Deux notions de « lancement » :

### A. Premier lancement **public gratuit** (produit visible, connexion, gestion, limites — *sans paiement*)

```
M1 ─▶ M2 ─▶ M3 ─▶ M4        (vitrine + offres)
M1 ─▶ M6 ─▶ M7 ─▶ M8        (entitlements + slots + espace client)
                → LANCEMENT PUBLIC GRATUIT (MVP client, cf. E3)
```
**Chemin critique** : `M1 → M6 → M7 → M8` (le cœur métier), en parallèle de la piste publique. Décisions requises : **A0, A1, D6, D7, D8, D16, D29**. **Aucune décision de prix/prestataire nécessaire.**

### B. Lancement **commercial payant**

```
M1 ─▶ M6 ─▶ M9 ─▶ M10 ─▶ M16
                 (+ M15 pour le rollout/observabilité)
```
**Chemin critique** : `M1 → M6 → M9 → M10 → M16`. Décisions requises : **D3 (prestataire), D1 (prix), D2, D12, D18, D20, D21, D17**.

## Milestones sans risque à commencer immédiatement

> Ne nécessitent **que A0 + A1** (E1). Aucun prix, prestataire, domaine custom, ni décision structurante.

- **M1** — Fondations & design system.
- **M2** — Shell public & routes publiques.
- **M5** — Notes de mise à jour (nécessite la migration `0032`, mais aucune décision produit).
- **M3/M4** peuvent démarrer en parallèle, avec la réserve **D16** (nom du plan) à verrouiller avant de figer la copie pricing.

## Milestones à NE PAS commencer avant tes décisions

| Milestone | Bloqué par | Pourquoi |
|-----------|-----------|----------|
| M6, M7 | **D6, D8, D29** | Règles de slots/downgrade/mapping = structure des données et de la résolution |
| M9, M10 | **D3** (+ D2) | Impossible d'intégrer un prestataire non choisi |
| M12 | **D11, D17, D22** | Bootstrap dev, domaine studio, packaging |
| M13 | **D10** | Politique lifetime |
| M16 | **D1, D3, D12, D18, D20, D21, D17** | Vente réelle = prix + juridique + fiscal |

## Points de non-retour

Actions difficiles/coûteuses à défaire — à **valider explicitement avant** :

1. **Migrations D1** (M5, M6, M7, …) : additives et réversibles par flag, mais **une migration appliquée en prod ne se « supprime » pas** proprement → `pnpm run migrate:remote` à chaque milestone, jamais destructif.
2. **Choix du prestataire (M9)** : réversible mais **coûteux** (re-souscription des clients si MoR) → le découplage `provider` limite la casse, mais éviter d'en changer après M16.
3. **Bascule DNS des domaines principaux (M12/M16)** : une fois `archodev.fr`/`studio.archodev.fr` publics et indexés, en changer est cher (liens, OAuth callback, Interactions endpoint).
4. **Premier abonné payant (M16)** : engage des obligations (facturation, remboursement, rétention PII) → CGV/TVA doivent être prêtes **avant**.
5. **Grants lifetime (M13)** : engagement long terme → garde-fous obligatoires ; un lifetime accordé par erreur est un coût permanent.

## Où un feature flag est OBLIGATOIRE

- **M6** (entitlements) : flag off = « tout Gratuit » (rétrocompat, rollback instantané).
- **M7** (gating/slots) : flag off = plan effectif forcé `free` sans suspension.
- **M9/M10** (billing/webhooks) : flag coupant le checkout sans toucher les entitlements existants.
- **M16** (lancement) : flag global d'activation du paiement en prod.
- **M2–M5, M8, M11** : flags recommandés (masquage de surface), non strictement obligatoires.

## Résumé décisionnel

- **Commencer maintenant, sans risque** : M1, M2 (+ M5, M3/M4 avec D16).
- **Débloquer le cœur gratuit** : trancher **D6, D8, D29** → M6, M7, M8.
- **Débloquer le payant** : trancher **D3, D2** → M9, M10 ; puis **D1, D12, D18, D20, D21, D17** → M16.
- **Débloquer l'exploitation** : trancher **D11, D17, D22, D10** → M12, M13, M14, M15.
