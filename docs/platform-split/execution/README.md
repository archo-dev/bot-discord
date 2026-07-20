# Execution — Décisions produit & roadmap exécutable

Ce sous-dossier transforme le **plan de conception** (`docs/platform-split/00`→`13`, commit `cbb42f07`) en **décisions produit concrètes** et en **roadmap d'implémentation prête à développer**.

> ⚠️ **Statut : planification, pas exécution.** Toujours **aucun code produit, aucune migration D1, aucune dépendance, aucun lockfile, aucun déploiement, aucun push, aucun renommage de package, aucun nouveau Worker/domaine créé.** Aucun prix n'est fixé définitivement ; aucun prestataire n'est choisi de façon irréversible. Ces documents **préparent** ces arbitrages — ils ne les tranchent pas à ta place.

## Ordre de lecture

| # | Document | Rôle |
|---|----------|------|
| E1 | [E1-decision-synthesis.md](./E1-decision-synthesis.md) | Décisions ouvertes classées **A / B / C** (bloquantes avant dev / avant billing / différables) |
| E2 | [E2-decision-fiches.md](./E2-decision-fiches.md) | Fiches de recommandation (offres, tarification, prestataire, slots, support, grants, sécurité, domaines) |
| E3 | [E3-mvp.md](./E3-mvp.md) | MVP strictement borné (public / client / studio / hors MVP) |
| E4 | [E4-milestones.md](./E4-milestones.md) | 16 milestones exécutables, champs complets |
| E5 | [E5-dependencies-critical-path.md](./E5-dependencies-critical-path.md) | Graphe de dépendances, parallélisme, chemin critique |
| E6 | [E6-branching-strategy.md](./E6-branching-strategy.md) | Stratégie de branches, commits, tests, merge, rollback |
| E7 | [E7-decision-queue.md](./E7-decision-queue.md) | File **ordonnée** de décisions à soumettre (2-3 options chacune) |

## Briefs d'exécution (par milestone)

Briefs détaillés préparés au fil de l'avancement, prêts à ouvrir une branche (`briefs/`) :

| Milestone | Brief | Statut |
|-----------|-------|--------|
| M1 — Fondations & design system | [briefs/M1-brief.md](./briefs/M1-brief.md) | **Terminé** — fusionné (`b4dfef4`), rapport [reports/M1-report.md](./reports/M1-report.md) |
| M2 — Shell public & routes publiques | [briefs/M2-brief.md](./briefs/M2-brief.md) | **Terminé** — fusionné, rapport [reports/M2-report.md](./reports/M2-report.md) |
| M3 — Landing commerciale | [briefs/M3-brief.md](./briefs/M3-brief.md) | **Terminé** — fusionné, rapport [reports/M3-report.md](./reports/M3-report.md) |
| M4 — Pricing & comparatif | [briefs/M4-brief.md](./briefs/M4-brief.md) | **Terminé** — fusionné, rapport [reports/M4-report.md](./reports/M4-report.md) |
| M5 — Notes de mise à jour publiques | [briefs/M5-brief.md](./briefs/M5-brief.md) | **Terminé** — fusionné, rapport [reports/M5-report.md](./reports/M5-report.md) |

## Rappel des décisions déjà cadrées (non rouvertes ici)

Issues du [README parent](../README.md) et confirmées :

1. **Langue** : français.
2. **Structure packages** : incrémentale — `packages/panel` reste le client, `packages/developer-studio` neuf, `@bot/ui` extrait progressivement. **Pas de renommage** de `panel` maintenant.
3. **Hébergement Studio** : Worker Cloudflare **séparé** sur domaine distinct, cookie/secrets propres.
4. **Identifiants techniques de plan stables** : `free | premium | business` (le nom d'affichage seul peut changer — décision E2/E7).
5. **Backend est la vérité** ; **séparation accès (entitlement) / paiement (billing)** ; **rétrocompat plan Gratuit par défaut**.

## Comment utiliser ce dossier

- **Toi (décideur)** : lis E7 (file de décisions) → E2 (fiches détaillées) → valide dans l'ordre.
- **Ingénierie** : E3 (MVP) → E4 (milestones) → E5 (dépendances) → E6 (git).
- Chaque affirmation renvoie aux docs de conception (`[doc NN]` = `../NN-*.md`) et aux identifiants de décision **D1–D29** de [../13-open-decisions.md](../13-open-decisions.md).
