# E7 — File de décisions à soumettre (ordonnée)

> Voir aussi : [synthèse A/B/C](./E1-decision-synthesis.md) · [fiches détaillées](./E2-decision-fiches.md) · [milestones](./E4-milestones.md)

Décisions à valider **dans l'ordre**, chacune simple (2–3 options), avec recommandation et justification. L'ordre suit les **murs de décision** ([E1](./E1-decision-synthesis.md)) : d'abord démarrer, puis le cœur gratuit, puis le payant, puis l'exploitation, puis le lancement. Chaque décision renvoie à sa fiche ([E2](./E2-decision-fiches.md)) et au milestone qu'elle débloque.

**Comment répondre** : indique le numéro d'option retenu (ou « Autre » + précision). Les décisions marquées 🔒 sont des **points de non-retour** ([E5](./E5-dependencies-critical-path.md)).

---

## Bloc 0 — Pour démarrer (avant M1)

```text
Décision 1 — Valider la roadmap d'exécution (A0)

1. Oui, démarrer sur cette base (M1 → M16)
2. Oui, avec ajustements (préciser)
3. Non, revoir d'abord

Recommandation : 1
Pourquoi : le découpage est incrémental, backend-first, réversible par flag ; rien n'engage le paiement.
Débloque : tout. Réf : E4.
```

```text
Décision 2 — Où démarre le développement ? (A1 / D17 timing)

1. Sur *.workers.dev, brancher les domaines custom plus tard (M12/M16)
2. Attendre les domaines custom avant de coder

Recommandation : 1
Pourquoi : les fondations n'ont pas besoin du DNS ; la bascule est additive (workers.dev reste valide).
Débloque : M1–M8. Réf : E2 §8.
```

---

## Bloc 1 — Cœur gratuit (avant M4/M6/M7)

```text
Décision 3 — Nom du plan intermédiaire (D16)

1. Premium
2. Pro

Recommandation : 1 (Premium)
Pourquoi : familier au public Discord (MEE6/Dyno « Premium ») ; n'impacte que display_name (clés free|premium|business stables).
Débloque : copie M3/M4. Réf : E2 §1.2. À décider avant M4.
```

```text
Décision 4 — Plan mis en avant sur /pricing (D5)

1. Premium (★ recommandé)
2. Business
3. Aucun (neutre)

Recommandation : 1
Pourquoi : meilleure ancre de conversion valeur/prix perçu.
Débloque : M4. Réf : E2 §1.3.
```

```text
Décision 5 — Cumul des emplacements (slots) (D6)

1. Pas de cumul : slots = meilleur plan actif
2. Cumul : slots additionnés entre entitlements

Recommandation : 1
Pourquoi : plus simple, anti-abus ; la résolution reste déterministe.
Débloque : M6/M7. Réf : E2 §4. 🔒 (structure des données)
```

```text
Décision 6 — Downgrade sans choix utilisateur (D8)

1. Suspendre tout jusqu'au choix (aucune suppression)
2. Règle auto : garder les N serveurs les plus récemment actifs

Recommandation : 1
Pourquoi : zéro perte, aucun choix arbitraire imposé ; config toujours conservée.
Débloque : M7. Réf : E2 §1.7.
```

```text
Décision 7 — Cooldown de réaffectation d'un slot (D7)

1. 48 h (défaut proposé, paramétrable)
2. 24 h
3. 72 h

Recommandation : 1 (48 h)
Pourquoi : freine le partage tournant sans punir un déménagement légitime.
Débloque : M7. Réf : E2 §4.
```

```text
Décision 8 — Mapping features → offres (D29)

1. Valider une première liste feature_key par plan (à fournir en annexe M6/M7)
2. Reporter (Gratuit = tout, gating ajouté ensuite)

Recommandation : 1
Pourquoi : le gating par plan a besoin d'un mapping explicite dès M7 ; il reste ajustable par flag.
Débloque : M7. Réf : doc 05 + doc 08. 🔒 (partiel)
```

---

## Bloc 2 — Payant (avant M9/M10)

```text
Décision 9 — Prestataire de paiement (D3)

1. MoR — Lemon Squeezy (TVA/factures/chargebacks gérés, time-to-market)
2. Stripe (coût/contrôle/portabilité, TVA à votre charge)

Recommandation : 1 (conditionnelle)
Pourquoi : petite structure → conformité fiscale quasi nulle ; modèle découplé permet migrer Stripe plus tard.
Débloque : M9/M10/M16. Réf : E2 §3, doc 07. 🔒 (coûteux à changer)
```

```text
Décision 10 — Périodicité et remise (D2)

1. Mensuel + annuel, remise annuelle ~2 mois offerts
2. Mensuel seul au lancement
3. Annuel seul

Recommandation : 1
Pourquoi : rétention + trésorerie ; interval déjà prévu dans le modèle.
Débloque : M9. Réf : E2 §1.4.
```

```text
Décision 11 — Essai gratuit (D4)

1. Essai 7 j sans CB, un seul par (user, plan)
2. Essai 14 j sans CB, un seul par (user, plan)
3. Pas d'essai au lancement (grants manuels suffisent)

Recommandation : 1 ou 3 (selon appétence risque d'abus)
Pourquoi : 7 j sans CB lève la friction ; 3 si l'on préfère prouver la conversion Free→Premium d'abord.
Débloque : M6 (si activé). Réf : E2 §1.5.
```

---

## Bloc 3 — Tarification (méthode avant M4, valeurs avant M16)

```text
Décision 12 — Méthode de tarification (D1 — méthode)

1. Valider méthode + fourchettes de travail (Premium ~4–8 €, Business ~10–18 € — INDICATIF)
2. Fournir d'autres fourchettes
3. Reporter toute discussion prix

Recommandation : 1
Pourquoi : permet de structurer /pricing sans figer les valeurs ; aucun montant en dur dans le code.
Débloque : structure M4. Réf : E2 §2. (Valeurs finales = Décision 20)
```

```text
Décision 13 — Prix de lancement & grandfathering (D1 — stratégie)

1. Tarif de lancement réduit + grandfathering (early adopters gardent leur prix)
2. Prix plein dès le départ

Recommandation : 1
Pourquoi : amorce l'acquisition et fidélise les premiers ; hausses futures pour nouveaux abonnés seulement.
Débloque : M16. Réf : E2 §2.3.
```

---

## Bloc 4 — Exploitation & Studio (avant M12/M13)

```text
Décision 14 — Bootstrap du premier opérateur Studio (D11)

1. Migration/secret contrôlé (propriétaire), jamais de route publique
2. Variable d'environnement dédiée

Recommandation : 1
Pourquoi : pas d'auto-inscription ; surface d'attaque minimale.
Débloque : M12. Réf : E2 §7. 🔒 (sécurité)
```

```text
Décision 15 — Domaines à confirmer (D17)

1. archodev.fr + studio.archodev.fr (status./docs. plus tard en sous-chemins)
2. Tout sous archodev.fr + studio. seulement
3. Autres domaines

Recommandation : 1
Pourquoi : deux domaines principaux figés tôt (isolation studio) ; status/docs différables.
Débloque : M12/M16. Réf : E2 §8. 🔒 (coûteux une fois public)
```

```text
Décision 16 — Politique lifetime (D10)

1. Réservé exceptionnel (partenaires/gestes), jamais en promo, garde-fous stricts
2. Autorisé plus largement
3. Interdit totalement

Recommandation : 1
Pourquoi : engagement long terme maîtrisé ; garde-fous (permission dédiée + saisie LIFETIME + step-up + audit).
Débloque : M13. Réf : E2 §6. 🔒 (coût permanent)
```

```text
Décision 17 — Auto-attribution de grants par un opérateur (D11)

1. Interdite au lancement (un opérateur ne s'octroie pas à lui-même)
2. Autorisée avec audit renforcé

Recommandation : 1
Pourquoi : réduit le risque d'abus interne ; réouvrable plus tard si justifié.
Débloque : M13. Réf : E2 §6.
```

---

## Bloc 5 — Support & lancement (avant M11/M16)

```text
Décision 18 — Politique de support (D9)

1. Priorité relative non contractuelle (Business > Premium > Gratuit), pas de SLA
2. SLA chiffrés par plan

Recommandation : 1
Pourquoi : tenable pour une petite équipe ; promet une priorité, pas un délai garanti.
Débloque : M11. Réf : E2 §5.
```

```text
Décision 19 — Remboursement / garantie (D12)

1. Droit de rétractation UE + garantie 7–14 j
2. Droit légal minimal seulement
3. Au cas par cas

Recommandation : 1
Pourquoi : rassure, réduit les chargebacks ; exécution simplifiée par un MoR.
Débloque : M16. Réf : E2 §1.6.
```

```text
Décision 20 — Prix définitifs (D1 — valeurs) 🔒

1. Fixer les valeurs finales (après analyse concurrentielle) — À FAIRE AVANT M16
2. Pas encore prêt

Recommandation : préparer via Décision 12, trancher juste avant M16
Pourquoi : aucun prix ne doit être inventé sans validation ; le code les recevra hors-code.
Débloque : M16. Réf : E2 §2.
```

```text
Décision 21 — Conformité (TVA, CGV, rétention) (D18/D20/D21)

1. MoR gère TVA/factures + CGV validées juridiquement + rétention minimale RGPD
2. Stripe + Stripe Tax + obligations déclaratives propres + CGV + rétention

Recommandation : 1 si Décision 9 = MoR ; 2 si Stripe
Pourquoi : cohérence avec le prestataire ; obligations prêtes avant le premier payant.
Débloque : M16. Réf : E2 §3, doc 07/08/09.
```

---

## Bloc 6 — Différables (défauts appliqués si non tranché)

Ces décisions ont un **défaut sûr** ([E1](./E1-decision-synthesis.md) groupe C) ; à confirmer au fil de l'eau, pas bloquantes :

| # | Décision | Défaut appliqué | Réf. |
|---|----------|------------------|------|
| 22 | Packaging worker-studio (D22) | (a) package dédié | doc 02 |
| 23 | TTL session studio (D23) | 8 h absolu / 30 min idle | doc 09 |
| 24 | Step-up (D24) | Confirmation + saisie explicite d'abord | doc 09 |
| 25 | Lancement bêta (D19) | Bêta fermée (guildes pilotes) | doc 11 |
| 26 | Outillage E2E/charge/a11y (D25) | Décidé avant M15 | doc 12 |
| 27 | Déploiements Studio (D26) | Consultation seule | doc 04 |
| 28 | Page statut / docs séparées (D14/D15) | Sous-chemins d'abord | doc 03 |
| 29 | Renommage panel→client-web (D28) | Ne pas faire | doc 02 |

---

## Ordre de traitement recommandé

1. **Aujourd'hui** : Décisions **1, 2** (démarrer), puis **3** (nom, avant M4).
2. **Avant M6/M7** : Décisions **5, 6, 7, 8** (+ 4).
3. **Avant M9/M10** : Décisions **9, 10, 11** (+ 12/13 pour la méthode prix).
4. **Avant M12/M13** : Décisions **14, 15, 16, 17**.
5. **Avant M11/M16** : Décisions **18, 19, 20, 21**.
6. **Au fil de l'eau** : Décisions **22–29** (défauts sûrs).

> Aucune de ces décisions n'a été prise à ta place : les documents sont conçus pour **recevoir** tes réponses (prix hors code, prestataire découplé, plans par clés techniques stables, tout derrière feature flag).
