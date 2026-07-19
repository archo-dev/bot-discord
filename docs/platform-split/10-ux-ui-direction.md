# 10 — Direction UX / UI

> Voir aussi : [plateforme client](./03-client-platform.md) · [studio](./04-developer-studio.md) · [offres](./05-plans-and-commercial-strategy.md) · [architecture](./02-product-architecture.md)

Objectif : une direction **ambitieuse mais réaliste**, fondée sur le design system « Nocturne » existant (`docs/design_system.md`, `docs/design_system_v2.md`, `packages/panel/src/ui/kit/DESIGN_TOKENS.md`). Un **système unique**, **deux calibrages** : la plateforme client (premium, rassurante, orientée conversion) et le Studio (dense, sombre, orienté opérations). Les deux consomment `@bot/ui` (extraction progressive — [doc 02](./02-product-architecture.md)).

## Principes directeurs

1. **Un système, deux thèmes** : mêmes primitives (`@bot/ui`), mêmes tokens sémantiques, deux calibrages de densité et d'accent. On ne maintient jamais deux design systems.
2. **Vendre des résultats, pas des écrans** (client) ; **exposer l'état, pas décorer** (studio).
3. **La marque avant/après connexion est continue** : même logo, même typo, même palette — la transition public→panel ne doit pas ressembler à deux sites ([doc 03](./03-client-platform.md)).
4. **Backend est la vérité** : tout verrouillage/masquage visuel double une garde serveur ([doc 09](./09-security-model.md)) ; l'UI n'est jamais l'unique barrière.
5. **Sobriété du mouvement** : `prefers-reduced-motion` respecté partout (déjà en place — [doc 01](./01-current-state-audit.md) §9), animations utilitaires (feedback), jamais décoratives-bloquantes.
6. **Budget tenu** : 180 KiB gzip sur le JS initial (`scripts/check-bundle-budget.mjs`) ; pages marketing riches et Recharts en **lazy-load**.

## Design tokens (fondation partagée `@bot/ui`)

Extraits de `packages/panel/src/index.css` (Tailwind v4 CSS-first, `@theme`/`:root`, pas de `tailwind.config.js`) vers un fichier thème partagé. **Rappel piège projet** : en Tailwind v4 écrire `bg-(--var)`, **jamais** `bg-[--var]` (silencieusement ignoré — `CLAUDE.md`).

| Famille | Tokens (sémantiques) | Client | Studio |
|---------|----------------------|--------|--------|
| Couleur de marque | `--brand` (« Aurora Iris » `#6b4ef2`) | Accent premium, CTA | Réservé, accent secondaire |
| Accent d'environnement | `--env-accent` | — (neutre) | **Distinct** (signale « PRODUCTION ») |
| Surfaces | `--bg`, `--surface`, `--surface-raised`, `--border` | Profond/aéré | Plus sombre, contrastes serrés |
| Texte | `--fg`, `--fg-muted`, `--fg-subtle` | Confort de lecture | Densité, hiérarchie fine |
| États | `--success`, `--warning`, `--danger`, `--info` | Idem | Idem (rouge = actions dangereuses) |
| Rayons | `--radius-sm/md/lg` | Généreux | Réduits (compacité) |
| Typographie | échelle `--text-*`, familles | Plus grande (marketing) | Plus petite (tableaux) |
| Élévation | `--shadow-*` | Douce | Discrète |
| Espacement | échelle `--space-*` | Aéré | Compact |
| Densité | `--density` (multiplicateur) | `comfortable` | `compact` |
| Motion | `--motion-fast/med`, easing | Idem, réduit si demandé | Idem |

- **Thème** : `@bot/ui` expose les tokens en variables CSS ; chaque app applique son calibrage (client « Nocturne clair/premium », studio « sombre dense »). Support clair/sombre côté client via `prefers-color-scheme` + override `data-theme`.
- **Accessibilité des couleurs** : contrastes visés **WCAG AA** (texte normal 4.5:1, large 3:1) ; ne jamais coder une information par la seule couleur (icône + libellé en complément).

## Composants partagés (`@bot/ui`)

Réutilise/extrait le kit existant (`packages/panel/src/ui/` : `buttons`, `forms`, `surfaces`, `feedback`, `navigation`, `layout`, `segmented`, `toast`, `overlay`, `savebar`, `skeleton`, `charts`, `combobox`, `icons`, `brand`, `error-boundary`).

- **Vont dans `@bot/ui`** : boutons, champs de formulaire, modales/confirm, badges, toasts, tableaux, tabs/segmented, skeletons, empty states, tooltips, primitives accessibles, icônes, layouts, tokens.
- **Restent applicatifs** (couplés domaine/router) : `entity-select`/`members` (Discord), `savebar` couplé `react-router` (à découpler d'abord), microcopie FR — [doc 02](./02-product-architecture.md).
- **Nouveaux composants transverses** à prévoir :
  - `PlanBadge` (Gratuit/Premium/Business), `SlotMeter` (emplacements utilisés/disponibles) — client.
  - `LockedFeature` (aperçu + badge + CTA doux « Débloquer ») — client.
  - `DangerConfirm` (double confirmation + saisie explicite `LIFETIME`/nom) — studio ([doc 09](./09-security-model.md)).
  - `DataTable` (tri, filtres multi-critères, pagination, export contrôlé) — studio.
  - `CommandPalette` (`Ctrl/Cmd+K`, recherche globale) — studio.
  - `Timeline` (événements/audit) — studio.
  - `ProductionBanner` (bandeau permanent non masquable) — studio.

## Accessibilité (transverse)

- Navigation clavier complète, ordre de focus logique, **focus-trap** sur modales/drawer (déjà en place).
- Rôles/ARIA sur composants interactifs ; libellés explicites ; `aria-live` pour toasts et états de sauvegarde.
- Cibles tactiles ≥ 44 px côté client ; raccourcis clavier côté studio (avec équivalents pointeur).
- `prefers-reduced-motion` : désactive animations non essentielles.
- Contraste AA minimum ; états d'erreur lisibles sans couleur seule.

## Responsive

- **Client mobile-first** : pages publiques (pricing, features) pensées mobile d'abord ; panel conserve le **drawer** mobile avec focus-trap ; formulaires denses adaptés au tactile.
- **Studio desktop-first** : outil d'opérations → optimisé grand écran (tableaux larges, multi-colonnes) ; en mobile, dégradation gracieuse (lecture prioritaire, actions dangereuses restreintes ou confirmées).
- Grilles responsives et `max-width` sur médias (existant) ; tables larges en conteneur `overflow-x` dédié.

## États : loading, empty, erreurs, sauvegarde, confirmations

- **Loading** : `skeleton` (jamais un spinner plein écran) ; `staleTime 30 s` + placeholders (TanStack Query) évitent les clignotements.
- **Empty states** : chaque liste vide explique *quoi faire* + CTA (ex. « Aucun serveur — Ajouter le bot »). Jamais une page blanche.
- **Erreurs** : `error-boundary` + toasts traduits FR (réutilise la traduction des erreurs zod de `src/lib/api.ts`) ; message actionnable, jamais un code brut. `401/403/404` → **pas de retry** (existant).
- **États de sauvegarde** : `savebar` (idle / pending / success « ✓ Enregistré » / error) + garde anti-perte (`beforeunload` + blocker router). Visible partout où l'utilisateur édite ([doc 03](./03-client-platform.md)).
- **Confirmations** : `overlay`/`Confirm` pour actions réversibles ; `DangerConfirm` (double + saisie explicite + step-up) pour lifetime/remboursement/suspension ([doc 09](./09-security-model.md)).

## Animations & micro-interactions

- Transitions douces (150–250 ms) sur hover, ouverture de modale, apparition de toast, changement d'onglet.
- Feedback immédiat sur action (bouton pending, save-state). Pas de « skeleton qui saute ».
- Studio : mouvement **minimal** (l'opérateur veut de la vitesse, pas des effets).

## Principes de conversion (client)

- **CTA cohérents et hiérarchisés** : « Commencer gratuitement » (primaire public), « Passer à Premium » / « Débloquer » (upsell) — [doc 05](./05-plans-and-commercial-strategy.md).
- **Upsell contextuel non frustrant** : la fonction verrouillée reste **visible** (`LockedFeature`), aperçu lisible, CTA doux ; jamais de mur opaque ni d'erreur brutale ([doc 03](./03-client-platform.md) §verrouillage).
- **Preuve continue** : `PlanBadge`, `SlotMeter`, « dernières mises à jour » (produit vivant), page statut (réassurance).
- **Réduction de friction** : onboarding guidé, presets, save-states visibles, comparatif `/pricing` clair + FAQ d'objections.
- **Instrumentation** des points de conversion (`product_metrics*`, respect `docs/privacy-analytics.md`) — [doc 05](./05-plans-and-commercial-strategy.md).

## Exemples textuels de pages

> Maquettes **textuelles** (aucun asset produit) illustrant la hiérarchie visuelle attendue.

### Client — `/pricing`

```
┌──────────────────────────────────────────────────────────────┐
│  [Logo Archodev]      Fonctions  Tarifs  Mises à jour  Docs   │
│                                              [Se connecter]    │
├──────────────────────────────────────────────────────────────┤
│           Des offres claires. Aucune surprise.                │
│      « Gratuit démarre. Premium fait gagner du temps.         │
│                 Business donne le contrôle. »                 │
│                                                                │
│  ┌─ Gratuit ─────┐  ┌─ Premium ★──────┐  ┌─ Business ──────┐  │
│  │ 1 serveur     │  │ 3 serveurs      │  │ 5 serveurs      │  │
│  │ Essentiel     │  │ Avancé          │  │ Tout inclus     │  │
│  │ [à définir]   │  │ [à définir]     │  │ [à définir]     │  │
│  │ Commencer     │  │ Passer à Premium│  │ Choisir Business│  │
│  └───────────────┘  └─────────────────┘  └─────────────────┘  │
│        ↑ le plan mis en avant = décision ouverte (doc 13)     │
│                                                                │
│  Comparatif détaillé (tableau) ▸    FAQ d'objections ▸        │
└──────────────────────────────────────────────────────────────┘
```

### Client — carte de fonction verrouillée (dans le panel)

```
┌── Auto-mod avancé ───────────────────  [Premium] ──┐
│  Aperçu lisible mais désactivé (règles, seuils…)    │
│  « Débloquez la modération avancée et gagnez du     │
│    temps. »                    [Débloquer avec Premium]│
└─────────────────────────────────────────────────────┘
   (le Worker refuse toute mutation hors plan — doc 09)
```

### Studio — `/subscriptions/granted`

```
■ PRODUCTION ─────────────────────────────────  [dev@…]  ⌘K
┌─ Accès accordés ──────────────────  [+ Octroyer un accès]─┐
│ Filtre: plan ▾  origine ▾  état ▾   🔍 rechercher…         │
├──────────────────────────────────────────────────────────┤
│ Utilisateur    Plan     Origine   Fin        État   Actions│
│ user#1234      Business granted   30j        actif  Révoq. │
│ user#5678      Premium  partner   lifetime*  actif  Révoq. │
│ user#9012      Premium  trial     7j         actif   —     │
└──────────────────────────────────────────────────────────┘
  Octroyer → formulaire (user, plan, durée [.. | lifetime],
  raison OBLIGATOIRE, note interne, affectation).
  Lifetime ⇒ saisir « LIFETIME » + step-up + audit (doc 09).
```

### Studio — `DangerConfirm` (remboursement)

```
┌─ Rembourser un abonnement payé ───────────────────────┐
│ Action FINANCIÈRE et IRRÉVERSIBLE.                     │
│ Cible : subscription #… (user#1234, Premium)           │
│ Montant / référence : [_________]                      │
│ Raison (auditée) : [________________________]          │
│ Réauthentification requise ▸                           │
│                         [Annuler]   [Confirmer (audit)]│
└────────────────────────────────────────────────────────┘
```

## Séparation décision produit / UX / technique

- **Produit** : mise en avant d'un plan, hiérarchie des CTA, périmètre des composants premium (**[doc 13]**).
- **UX** : un système/deux thèmes, densité client vs studio, états (loading/empty/erreur/save/confirm), accessibilité AA, conversion non frustrante.
- **Technique** : extraction progressive `@bot/ui`, tokens CSS partagés, lazy-load marketing/Recharts, budget 180 KiB, `bg-(--var)` (piège Tailwind v4).
