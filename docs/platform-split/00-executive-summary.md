# 00 — Résumé exécutif

> Voir aussi : [README](./README.md) · [audit](./01-current-state-audit.md) · [architecture](./02-product-architecture.md) · [décisions ouvertes](./13-open-decisions.md)

## Vision

Transformer **Archodev** — aujourd'hui un bot Discord gratuit, mono-produit, sans monétisation — en une **plateforme SaaS professionnelle et commercialisable**, structurée en deux espaces à domaines distincts :

1. **Plateforme client** (`archodev.fr`) : une seule expérience continue qui **vend le produit avant connexion** (vitrine, offres, mises à jour, docs, statut, support) et **devient une application de gestion complète après connexion** (panel serveurs, abonnements, facturation, compte), sous une marque et un design system uniques.
2. **Studio développeur** (`studio.archodev.fr`) : une console privée d'exploitation pour le propriétaire (puis l'équipe) — infrastructure, guildes, modules, erreurs, métriques, déploiements, feature flags, sécurité, support, abonnements payés/accordés, audit — **strictement séparée** du produit client (domaine, cookie, autorisation serveur, audit renforcé).

Phrase directrice commerciale : **« Gratuit vous aide à démarrer. Premium vous fait gagner du temps. Business vous donne le contrôle total. »**

## Objectifs

- **Commercial** : introduire trois offres — **Gratuit** (1 serveur), **Premium** (3 serveurs), **Business** (5 serveurs) — vendues sur les **résultats** (gagner du temps, protéger, professionnaliser) et non sur une liste technique.
- **Produit** : une plateforme premium, rassurante, responsive, avec onboarding guidé, états de sauvegarde visibles et fonctions Premium visibles mais non frustrantes.
- **Opérationnel** : un studio dense, orienté données et opérations, pour superviser et exploiter la plateforme sans exposer d'outils internes aux clients.
- **Technique** : ajouter une couche **abonnements/droits d'accès (entitlements)** propre, réutilisant les seams existants (gating de modules, DTO partagés, API panel auditée) **sans réécriture**.
- **Sécurité** : isoler totalement le Studio et n'accorder les capacités développeur qu'après **autorisation serveur explicite**, avec audit immuable de toute mutation sensible.

## Bénéfices attendus

- **Pour les clients** : démarrage gratuit crédible, montée en gamme fluide, valeur perçue claire, support priorisé selon le plan.
- **Pour l'exploitant** : revenu récurrent, capacité à accorder des accès (partenaires, essais, promotions) de façon traçable, supervision centralisée, réduction des erreurs humaines via un studio dédié.
- **Pour la marque** : passage d'un « dashboard technique » à un produit SaaS moderne comparable aux meilleurs standards du marché.

## Périmètre

**Dans le périmètre de ce dossier (conception uniquement)** : architecture cible, sitemaps, stratégie commerciale, modèle d'abonnements/entitlements, analyse des prestataires de paiement, modèle de données conceptuel, modèle de sécurité, direction UX/UI, roadmap par phases, stratégie de tests, décisions ouvertes.

**Hors périmètre de ce dossier** : tout code, migration, dépendance, lockfile, déploiement, push, ou modification de production. Aucune valeur n'est écrite en base ; aucune infrastructure n'est provisionnée.

## Décisions majeures (déjà cadrées)

| Décision | Choix retenu | Conséquence principale |
|----------|--------------|------------------------|
| Langue de la doc | Français | Cohérence avec `roadmap.md`, `docs/`, panel |
| Structure packages | Incrémentale (`panel` reste client, `developer-studio` neuf, `@bot/ui` extrait progressivement) | Faible churn, pas de big-bang |
| Hébergement Studio | Worker Cloudflare **séparé** sur domaine distinct | Isolation forte, cookie & secrets propres |
| Domaines cibles | `archodev.fr` / `studio.archodev.fr` | **[Hypothèse]** à confirmer — voir doc 13 |

## Décisions majeures encore ouvertes

Détaillées en [13-open-decisions.md](./13-open-decisions.md). Les plus urgentes :

- **Prix** des trois plans (aucun prix inventé ici).
- **Prestataire de paiement** (Stripe / Lemon Squeezy / Paddle) — recommandation conditionnelle en [doc 07](./07-billing-provider-analysis.md), pas de choix définitif.
- **Périmètre exact** des fonctionnalités par plan (mapping features → offres).
- **Domaines définitifs** et calendrier de bascule DNS.

## Risques principaux

| Risque | Impact | Atténuation (détail en [doc 11](./11-migration-roadmap.md) / [doc 12](./12-testing-and-release-strategy.md)) |
|--------|--------|-----------------------------------------------------------------------------------------------------------------|
| Régression sur l'auth/session existante | Élevé | Réutiliser `session.ts`/`guard.ts` sans les modifier ; nouveau cookie studio séparé |
| Fuite d'outils internes vers le client | Critique | Worker Studio séparé, dev-auth serveur, aucun endpoint studio sur le domaine client |
| Complexité du modèle d'entitlements (cumul, downgrade, lifetime) | Élevé | Règles **backend** dérivées de l'origine ; machine d'états explicite ([doc 06](./06-subscriptions-and-entitlements.md)) |
| Suppression involontaire de config lors d'un downgrade | Élevé | État « suspendu » sans suppression ; l'utilisateur choisit les serveurs conservés |
| Dépendance/lock-in prestataire de paiement | Moyen | Modèle billing découplé (voir [doc 07](./07-billing-provider-analysis.md) et [doc 08](./08-data-model.md)) |
| Dérive du budget bundle panel (180 KiB gzip) | Moyen | `@bot/ui` extrait progressivement, code-splitting conservé |
| Charge de rédaction/traduction (i18n futur) | Faible/Moyen | Copie FR d'abord ; i18n traité comme dette identifiée ([doc 01](./01-current-state-audit.md)) |

## Prochaine étape

Après validation de ce dossier, exécuter la roadmap phase par phase ([doc 11](./11-migration-roadmap.md)), en commençant par les fondations (P0) et le backend des droits d'accès (P1) — **avant** toute UI de paiement.
