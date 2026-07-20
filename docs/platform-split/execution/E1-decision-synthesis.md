# E1 — Synthèse des décisions ouvertes (A / B / C)

> Voir aussi : [décisions ouvertes détaillées](../13-open-decisions.md) · [fiches](./E2-decision-fiches.md) · [milestones](./E4-milestones.md)

Objectif : dire **honnêtement** ce qui bloque vraiment, et ce qui n'est qu'apparemment urgent. La règle du projet est **backend d'abord, rétrocompat plan Gratuit par défaut** : de ce fait, **presque rien ne bloque le démarrage des fondations**. La majorité des arbitrages tombent au moment du **billing** ou du **lancement**.

**Ne pas surclasser** : une décision n'est « bloquante avant tout développement » que si **aucun** milestone utile ne peut démarrer sans elle.

## Vue d'ensemble

| Groupe | Sens | Nombre | Effet si non tranché |
|--------|------|:------:|----------------------|
| **A** | Bloque le **démarrage** (avant M1) | **2** | Aucun code ne devrait commencer |
| **B** | Bloque **entitlements → billing → lancement** (peut attendre pendant les fondations M1–M5) | **13** | Les fondations avancent ; le cœur payant est bloqué |
| **C** | **Différable** sans dette majeure | **14** | Décidable au fil de l'eau |

---

## A. Bloquantes avant tout développement

> Le minimum vital pour lancer M1 sans risque de rework structurel.

| ID | Décision | Pourquoi c'est bloquant maintenant | Coût si tranché tard |
|----|----------|-------------------------------------|----------------------|
| **A0** | **Valider cette roadmap d'exécution** (go/no-go, ordre des milestones) | Sans accord sur le découpage, tout milestone est spéculatif | — |
| **A1 = D17 (timing)** | **Confirmer que le dev démarre sur `*.workers.dev`**, domaines custom traités plus tard | Décide si M1–M5 attendent le DNS. Recommandé : **ne pas attendre** — développer sur `botdiscord.archodev.workers.dev`, brancher les domaines au moment du Studio/lancement | Faible : bascule DNS additive |

> **Volontairement court.** Les fondations (design system, `@bot/ui`, couche de routes publiques, landing) n'exigent ni prix, ni prestataire, ni domaine custom, ni nom de plan définitif. Tout le reste est **B** ou **C**.

**Cas limite (à verrouiller tôt, pas bloquant) :** **D16** (nom `Premium` vs `Pro`) influence la **copie** dès M3–M4 mais n'impacte que `plans.display_name` (clés techniques stables). À décider **avant M4**, pas avant M1 → classé **B** avec drapeau « décider tôt ».

---

## B. Bloquantes avant billing ou lancement commercial

> Peuvent attendre pendant les fondations (M1–M5), **doivent** être tranchées avant les milestones concernés (indiqués).

| ID | Décision | Bloque à partir de | Urgence source ([doc 13](../13-open-decisions.md)) |
|----|----------|--------------------|--------|
| **D6** | Règle des slots (cumul ou non) | **M6/M7** (entitlements/slots) | 🟠 |
| **D8** | Règle par défaut au downgrade sans choix | **M7** | 🟡 |
| **D29** | Mapping exact `feature_key` → plan | **M7** (gating) | 🟠 |
| **D16** | Nom du plan intermédiaire (`Premium`/`Pro`) | **M4** (copie pricing) — *décider tôt* | 🟡 |
| **D1** | Prix des plans (méthode + fourchettes, pas de valeur figée) | **M16** (lancement) ; méthode utile dès M4 | 🔴 |
| **D2** | Périodicité mensuel/annuel + remise | **M9** (billing) | 🟠 |
| **D3** | Prestataire de paiement | **M9/M10** (billing/webhooks) | 🔴 |
| **D4** | Essai gratuit (oui/non, durée) | **M6** si trials activés, sinon M16 | 🟡 |
| **D10** | Politique lifetime | **M13** (grants lifetime) | 🟠 |
| **D11** | Matrice permissions dev + bootstrap | **M12** (studio) | 🟠 |
| **D12** | Politique de remboursement | **M16** (lancement) | 🟠 |
| **D17** | Domaines définitifs (valeurs) | **M12** (studio = domaine séparé) puis M16 | 🟠 |
| **D18/D20/D21** | Rétention · TVA · CGV | **M16** (traitement PII billing + vente) | 🟠 |

> **D7 (cooldown réaffectation)** est techniquement requis à M7 mais sa **valeur** est calibrable ; on peut coder le mécanisme avec une valeur par défaut paramétrable et trancher le chiffre plus tard → frontière B/C, traité en **C**.

---

## C. Décisions différables

> Décidables plus tard sans créer de dette majeure ; un défaut raisonnable est proposé en [E2](./E2-decision-fiches.md).

| ID | Décision | Défaut proposé en attendant | Urgence source |
|----|----------|------------------------------|--------|
| **D5** | Plan mis en avant | **Premium « ★ recommandé »** | 🟡 |
| **D7** | Cooldown réaffectation (valeur) | Mécanisme paramétrable, défaut **48 h** | 🟡 |
| **D9** | Engagements support (niveaux) | Priorité relative **non-SLA** | 🟡 |
| **D13** | Suspension fraude (procédure) | **Manuel + audit renforcé** | 🟡 |
| **D14** | Page statut publique | **Minimale** (up/down) d'abord | 🟢 |
| **D15** | Docs séparées | **`/docs` intégré léger** | 🟢 |
| **D19** | Lancement bêta | **Bêta fermée** (guildes pilotes) | 🟡 |
| **D22** | Packaging worker-studio (a)/(b) | **(a)** package dédié | 🟡 |
| **D23** | TTL session studio | **8 h absolu / 30 min idle** (calibrable) | 🟡 |
| **D24** | Step-up (ré-consentement/re-saisie) | Confirmation renforcée + saisie explicite d'abord | 🟡 |
| **D25** | Outillage E2E/charge/a11y | Décidé avant M15 ; vitest suffit avant | 🟢 |
| **D26** | Déclenchement déploiements studio | **Consultation seule** au départ | 🟢 |
| **D27** | Séparation env prod/dev | À formaliser avant M16 | 🟡 |
| **D28** | Renommage `panel`→`client-web` | **Ne pas faire** (différé/optionnel) | 🟢 |

---

## Conclusion opérationnelle

- **On peut commencer immédiatement** M1→M5 (fondations, shell public, landing, pricing sans prix, release notes) en ne décidant que **A0 + A1** et en verrouillant **D16 avant M4**.
- Le **premier vrai mur de décisions** est **M6/M7** (D6, D8, D29) — le moteur d'entitlements et le gating.
- Le **second mur** est **M9/M10** (D2, D3) — le billing.
- Le **troisième mur** est **M16** (D1 valeurs, D12, D18, D20, D21) — le lancement commercial.
- Tout le reste (groupe C) se décide au fil de l'eau avec des défauts sûrs.
