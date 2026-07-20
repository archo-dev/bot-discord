# Platform Split — Plateforme client & Studio développeur

Dossier de conception (documentation uniquement) pour la transformation d'**Archodev** en plateforme SaaS professionnelle, séparée en deux espaces à domaines distincts :

- **Plateforme client** — `archodev.fr` (vitrine + panel de gestion + abonnements, une seule expérience cohérente).
- **Studio développeur** — `studio.archodev.fr` (supervision, opérations, abonnements internes, audit — privé).

> ⚠️ **Statut : plan, pas exécution.** Ce dossier ne contient **aucun code produit, aucune migration, aucune dépendance, aucun déploiement**. Il sert de référence de conception avant toute implémentation. Les prix, le prestataire de paiement et les domaines définitifs **ne sont pas décidés** ici : voir [13-open-decisions.md](./13-open-decisions.md).

## Ordre de lecture

| # | Document | Pour qui |
|---|----------|----------|
| — | [README.md](./README.md) | Tout le monde (index) |
| 00 | [00-executive-summary.md](./00-executive-summary.md) | Décideur — vision, périmètre, risques |
| 01 | [01-current-state-audit.md](./01-current-state-audit.md) | Technique — état réel du dépôt |
| 02 | [02-product-architecture.md](./02-product-architecture.md) | Technique — architecture cible & migration |
| 03 | [03-client-platform.md](./03-client-platform.md) | Produit/UX — plateforme client |
| 04 | [04-developer-studio.md](./04-developer-studio.md) | Produit/Ops — studio développeur |
| 05 | [05-plans-and-commercial-strategy.md](./05-plans-and-commercial-strategy.md) | Produit/Marketing — offres |
| 06 | [06-subscriptions-and-entitlements.md](./06-subscriptions-and-entitlements.md) | Technique/Produit — droits d'accès |
| 07 | [07-billing-provider-analysis.md](./07-billing-provider-analysis.md) | Décideur/Technique — paiement |
| 08 | [08-data-model.md](./08-data-model.md) | Technique — modèle de données |
| 09 | [09-security-model.md](./09-security-model.md) | Sécurité — auth, sessions, permissions |
| 10 | [10-ux-ui-direction.md](./10-ux-ui-direction.md) | Design — direction UX/UI |
| 11 | [11-migration-roadmap.md](./11-migration-roadmap.md) | Gestion de projet — phases |
| 12 | [12-testing-and-release-strategy.md](./12-testing-and-release-strategy.md) | Qualité — tests & release |
| 13 | [13-open-decisions.md](./13-open-decisions.md) | Décideur — **arbitrages requis** |
| E | [execution/](./execution/README.md) | **Suite — décisions produit concrètes & roadmap exécutable** (MVP, 16 milestones, file de décisions) |

**Parcours conseillés :**
- *Direction / décision* : 00 → 05 → 07 → 13 → [execution/E7](./execution/E7-decision-queue.md).
- *Ingénierie* : 01 → 02 → 06 → 08 → 09 → 11 → 12 → [execution/E4](./execution/E4-milestones.md).
- *Produit / design* : 03 → 04 → 05 → 10.

> **Étape suivante (planification d'exécution)** : le sous-dossier [`execution/`](./execution/README.md) transforme ce plan de conception en décisions concrètes, MVP borné, milestones et file de décisions à valider. Toujours **documentation uniquement**.

## Décisions déjà cadrées

Trois arbitrages structurants ont été validés avant la rédaction (les autres restent ouverts en doc 13) :

1. **Langue de la documentation** : français.
2. **Structure des packages** : approche **incrémentale**. `packages/panel` reste l'application client (le renommage en `client-web` est différé et optionnel) ; `packages/developer-studio` est un **nouveau** package ; `@bot/ui` est **extrait progressivement** depuis `packages/panel/src/ui/`.
3. **Hébergement du Studio** : **Worker Cloudflare séparé** sur `studio.archodev.fr`, avec cookie de session et secrets distincts, code partagé via `@bot/shared`. Le Studio n'est **jamais** une route masquée du panel client.

## Résumé de la roadmap

La migration est découpée en phases (détail en [11-migration-roadmap.md](./11-migration-roadmap.md)) :

- **P0 — Fondations** : domaines custom (`archodev.fr`, `studio.archodev.fr`), amorce du package `@bot/ui`, feature flags. *(S/M)*
- **P1 — Droits d'accès (backend)** : modèle de données abonnements/entitlements, résolution du « meilleur droit actif », grants développeur. Sans UI de paiement. *(L)*
- **P2 — Gating des offres** : application des limites Gratuit/Premium/Business sur le gating de modules existant + emplacements de serveurs. *(M/L)*
- **P3 — Plateforme client publique** : `client-web` (pricing, features, updates, docs, status, support) unifié avec le panel. *(L/XL)*
- **P4 — Paiement** : intégration du prestataire retenu, webhooks, portail client, facturation. *(L)*
- **P5 — Studio développeur** : Worker dédié, dev-auth, supervision, gestion des abonnements payés/accordés, feature flags, déploiements. *(XL)*
- **P6 — Support & audit** : tickets priorisés par plan, page statut, audit immuable, notes de mise à jour. *(L)*

Chaque phase est indépendamment livrable, testable et réversible (rollback documenté).

## Conventions de ce dossier

- **[Hypothèse]** signale une supposition à valider ; les vraies décisions ouvertes vivent uniquement en [13-open-decisions.md](./13-open-decisions.md).
- Les recommandations importantes **citent les fichiers réels** du dépôt (`packages/...`) et séparent explicitement décision **produit / UX / sécurité / technique**.
- Aucun prix n'est présenté comme définitif ; aucun prestataire de paiement n'est choisi sans justification.
