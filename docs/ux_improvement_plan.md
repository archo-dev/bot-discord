# Plan d'amélioration UX/UI — Panel botdiscord

> Audit expert du panel actuel (design system « Nocturne » v1, implémenté) et plan d'action priorisé.
> Livrable jumeau : `docs/design_system_v2.md` (Nocturne 2) qui spécifie tous les composants cités ici.
> **Aucune modification de code dans ce livrable** — uniquement le diagnostic et le plan.
> Date : 2026-07-10.

---

## 1. Synthèse exécutive

Le panel a une base visuelle **solide et cohérente** : tokens Nocturne bien câblés dans Tailwind v4 (`index.css`), kit de composants centralisé (`ui/kit.tsx`), identité sombre « Discord-native » réussie, responsive géré (drawer mobile, tables scrollables).

Les faiblesses ne sont **pas cosmétiques mais systémiques** : le panel gère mal les *moments* de l'expérience — attendre, réussir, échouer, confirmer, ne rien avoir à afficher. C'est là que se joue la différence entre « joli » et « professionnel » (référence concurrentielle : Draftbot, MEE6, Dyno).

**Top 5 des irritants (impact utilisateur décroissant) :**

| # | Irritant | Preuve dans le code |
|---|---|---|
| 1 | Feedback de sauvegarde incohérent : 2 pages sur 7 affichent « ✓ Enregistré », les autres rien | `SaveFeedback` utilisé dans `Config.tsx:141`, `Tickets.tsx:130` seulement ; absent d'`Automod`, `Levels`, `Welcome`, `PanelAccess`, `Roles` |
| 2 | Confirmations destructives via `confirm()` natif du navigateur (rupture visuelle totale) | `Commands.tsx:87`, `Roles.tsx:217` |
| 3 | IDs Discord bruts affichés comme identité (`<code>2325…</code>`) au lieu de pseudo + avatar | `ModLog.tsx:81-84`, `Dashboard.tsx:80` |
| 4 | Chargements en texte brut « Chargement… » → écran vide + layout shift | 9 occurrences (`Dashboard.tsx:25`, `Automod.tsx:74`, `Welcome.tsx:149`, etc.) |
| 5 | Aucune protection contre la perte de saisie (pas d'état « modifications non enregistrées ») | Toutes les pages de réglages (bouton Enregistrer passif en bas de page) |

---

## 2. Audit détaillé

### 2.1 Ce qui fonctionne bien (à préserver)

- **Tokens & cohérence chromatique** : un seul accent (blurple), sémantique succès/danger/warning propre, chiffres tabulaires (`tnum`) — la signature dashboard est là.
- **Architecture du kit** : `Card`, `Button`, `Field`, `Toggle`, `Chip`, `Badge`, `StatCard`, `Tabs`, `TableWrap`, `InfoCard` — tout passe par `kit.tsx`, ce qui rend la migration v2 peu coûteuse.
- **Responsive** : drawer mobile avec overlay, tabs scrollables (`no-scrollbar`), tables en scroll horizontal, grilles adaptatives.
- **Bases d'accessibilité** : `role="switch"` + `aria-checked` sur le Toggle, `aria-pressed` sur les chips, `focus-visible:ring` généralisé, `prefers-reduced-motion` respecté.
- **Gestion d'erreurs de niveau page** : `GuildLayout` distingue 403/404/erreur générique avec messages clairs.

### 2.2 Constats par thème

#### A. Feedback & états système (le chantier n°1)

- **A1 — Sauvegarde muette.** Sur `Automod`, `Levels`, `Welcome`, `PanelAccess`, le seul signal de succès est le label du bouton qui repasse de « Enregistrement… » à « Enregistrer ». Une erreur réseau est **totalement silencieuse** sur ces pages. → Système de **toasts** global + `SaveFeedback` partout, ou mieux : **SaveBar** collante (voir D.S. v2 §6.7).
- **A2 — Chargement = page blanche.** « Chargement… » en `text-zinc-400` remplace toute la page : perte de repères, saut de layout à l'arrivée des données. → **Skeletons** calqués sur la structure finale (KPI, listes, formulaires).
- **A3 — États vides pauvres.** « Aucune action de modération enregistrée pour le moment. » en une ligne grise. Un état vide est une opportunité d'onboarding (icône + explication + action). → Composant **EmptyState**.
- **A4 — Erreurs de mutation non affichées** hors Config/Tickets. Un revoke de warning qui échoue (`ModLog.tsx:181`) ne dit rien. → Toast d'erreur systématique via un handler global TanStack Query (`MutationCache.onError`).

#### B. Actions destructives & confirmations

- **B1 — `confirm()` natif** : boîte système grise en pleine UI sombre, non stylable, non accessible au même niveau. → **Modal** de confirmation avec bouton danger, nom de l'objet supprimé en évidence, et conséquences explicites (« le message Discord sera aussi supprimé »).
- **B2 — Suppression sans undo.** La suppression d'une commande custom ou d'un message de rôles est immédiate et définitive. → Toast avec **« Annuler »** (undo 5 s) quand c'est réversible côté API, sinon confirmation renforcée.

#### C. Lisibilité des données Discord

- **C1 — IDs bruts partout.** `ModLog` affiche `targetId` et `moderatorId` en `<code>`. Illisible et non actionnable. → Composant **UserCell** (avatar + pseudo résolu + ID copiable au clic) ; nécessite un endpoint de résolution ou l'enrichissement des DTOs côté Worker (noter la dépendance back).
- **C2 — Raison tronquée sans recours** (`max-w-[16rem] truncate`) : pas de tooltip, pas de détail. → **Tooltip** au survol + ligne extensible.
- **C3 — Dates relatives seules** (« Il y a 2h ») sans date absolue accessible. → `title` avec date complète + format absolu au-delà de 7 jours.

#### D. Navigation & architecture de l'information

- **D1 — Sidebar plate à 11 items** sans regroupement : la charge visuelle croît à chaque milestone. → Groupes avec libellés éyebrow : *Serveur* (Aperçu, Configuration, Accès panel) · *Engagement* (Bienvenue, Rôles, Niveaux) · *Modération* (Auto-mod, Mod-log, Tickets) · *Outils* (Commandes, Musique).
- **D2 — Nom du serveur affiché deux fois** dans la sidebar (en-tête ligne 67 + bannière ligne 81 de `GuildLayout.tsx`). → Fusionner : une seule carte serveur (icône + nom + membres + switch de serveur).
- **D3 — Sous-titres de page absents** : seul « Aperçu » a un `subtitle`. → Un sous-titre par page (une phrase d'orientation), défini dans la nav.
- **D4 — Pas de breadcrumb dans les sous-pages** (`CommandEditor`) : le retour se fait au navigateur. → Fil d'ariane léger `Commandes / Éditer /xyz`.

#### E. Formulaires & saisie

- **E1 — Pas de dirty state.** Sur `Automod` (251 lignes de réglages), on peut tout modifier, naviguer ailleurs, et tout perdre sans avertissement. → **SaveBar** collante qui apparaît dès qu'un champ diverge de la valeur serveur + garde de navigation (blocker react-router).
- **E2 — Bouton Enregistrer en bas de page longue** : invisible pendant l'édition du haut de page. → La SaveBar résout aussi ce point.
- **E3 — Selects natifs stylés à la main** : suffisant pour les listes courtes, mais le choix d'un salon parmi 50+ mérite une recherche. → **Combobox** (filtrage + icône # ou 🔊 selon le type de salon).
- **E4 — Filtre par « ID utilisateur »** (`ModLog.tsx:146`) : demander un snowflake à un humain est un anti-pattern. → Combobox de recherche de membre (dépend du même endpoint que C1).
- **E5 — Validation silencieuse** : les erreurs zod côté API ne sont pas mappées champ par champ. → Convention d'affichage d'erreur sous le champ (`Field` v2 avec prop `error`).

#### F. Dashboard & data-viz

- **F1 — StatCard détournée** : « #logs », « En ligne », « — » sont des textes dans un composant conçu pour des KPI numériques (`Dashboard.tsx:38-55`). La grille perd son pouvoir de scan. → Scinder : **StatCard** (nombres + delta) vs **InfoTile** (état/config avec pastille de statut).
- **F2 — Zéro visualisation temporelle** alors que le D.S. v1 spécifie courbe + donut (§5.12) et que les données existent (mod-actions datées, XP). → Sparkline 14 jours des actions de mod, top salons XP en barres. (Dépend d'agrégats côté Worker — à noter comme dépendance.)
- **F3 — KPI sans delta** : « 1287 membres » sans tendance. Nécessite un snapshot périodique côté gateway (dépendance back, non bloquante).

#### G. Accessibilité (au-delà de l'existant)

- **G1 — Boutons icône sans nom accessible** : logout (`GuildLayout.tsx:122`, `title` seul ne suffit pas), pagination « ← / → » (`ModLog.tsx:96-112`). → `aria-label` systématique, composant **IconButton**.
- **G2 — Tabs sans sémantique ARIA** : pas de `role="tablist"`, pas de navigation aux flèches. → Pattern ARIA Tabs complet dans le composant v2.
- **G3 — Cibles tactiles** : chips à 32 px (`h-8` dans `kit.tsx:154`) sous le minimum de 40 px déjà noté dans le D.S. v1 §7. → Zone cliquable étendue sur mobile (padding invisible).
- **G4 — `--text-muted` (#6B7180) ≈ 3:1 sur surface-1** : conforme pour la méta, mais utilisé pour du contenu à lire (messages « Aucun… », `Commands.tsx:47`). → Règle : contenu lisible = `--text-secondary` minimum.
- **G5 — Modale drawer sans focus trap** ni `aria-modal` (`GuildLayout.tsx:136-149`). → Le composant Modal/Drawer v2 intègre focus trap + Échap + restitution du focus.

#### H. Détails de finition (polish)

- **H1 — Police Inter chargée via Google Fonts** : dépendance externe (latence, RGPD) alors que le Worker sert déjà les assets. → Self-host (woff2 variable, `font-display: swap`).
- **H2 — Pas de transitions de page** : les changements d'onglet claquent. → Fade/slide 150 ms discret (respecte `prefers-reduced-motion`).
- **H3 — Pagination non composant** : dupliquée inline. → Composant **Pagination** (compteur « 12 résultats · page 1/3 »).
- **H4 — Favicon/title génériques** (« Bot Admin Panel »). → Titre par page (`Aperçu — {serveur}`), favicon.
- **H5 — `<html class="dark">` posé mais aucun thème clair** : assumer le dark-only (c'est un choix de marque valide) et le documenter, plutôt que laisser un demi-mécanisme.

---

## 3. Plan d'action priorisé

Effort : **S** < ½ j · **M** ½–1 j · **L** 1–3 j. Les dépendances back (Worker/gateway) sont signalées — tout le reste est front pur.

### Phase 0 — Fondations du D.S. v2 (prérequis, ~1 j)

| Action | Constats couverts | Effort |
|---|---|---|
| Étendre les tokens (`index.css`) : motion, z-index, state-layers, surfaces (D.S. v2 §2–4) | — | S |
| Self-host Inter + `font-display: swap` | H1 | S |
| Composants primitifs : `Modal`, `Toast` (+ provider), `Skeleton`, `EmptyState`, `IconButton`, `Tooltip`, `Pagination` | A2, A3, B1, G1, H3 | L |

### Phase 1 — Fiabilité perçue (le plus gros ROI, ~2 j)

| Action | Constats couverts | Effort |
|---|---|---|
| Toasts globaux succès/erreur sur **toutes** les mutations (handler `MutationCache`) | A1, A4 | M |
| Remplacer les `confirm()` par la Modal de confirmation danger | B1, B2 | S |
| Skeletons sur Dashboard, ModLog, listes ; suppression des « Chargement… » | A2 | M |
| EmptyState sur toutes les listes vides (avec CTA quand pertinent) | A3 | M |
| SaveBar collante + dirty state + garde de navigation sur les 6 pages de réglages | E1, E2, A1 | L |

### Phase 2 — Lisibilité & navigation (~2 j)

| Action | Constats couverts | Effort | Dépendance back |
|---|---|---|---|
| Sidebar groupée + carte serveur unifiée + sous-titres de page | D1, D2, D3 | M | — |
| `UserCell` (avatar + pseudo + ID copiable) dans ModLog, Dashboard, Tickets | C1 | M | **Oui** : résolution d'utilisateurs (`/api/guilds/:id/members/resolve` ou enrichissement des DTOs) |
| Tooltip sur raisons tronquées + dates absolues au survol | C2, C3 | S | — |
| Split StatCard / InfoTile sur le Dashboard | F1 | S | — |
| ARIA Tabs + `aria-label` des boutons icône + cibles 40 px | G1, G2, G3 | S | — |
| Combobox salons/rôles/membres (remplace les selects longs et le filtre par ID) | E3, E4 | L | Membres : même endpoint que UserCell |

### Phase 3 — Différenciation (~2–3 j, optionnel)

| Action | Constats couverts | Effort | Dépendance back |
|---|---|---|---|
| Sparkline activité de modération 14 j sur le Dashboard | F2 | M | **Oui** : endpoint d'agrégats |
| Deltas KPI (membres, actions/semaine) | F3 | M | **Oui** : snapshots périodiques (gateway) |
| Transitions de page + micro-interactions (D.S. v2 §4) | H2 | S | — |
| Titres de document par page, favicon | H4 | S | — |
| Erreurs de validation champ par champ (`Field` avec `error`) | E5 | M | Mapping des erreurs zod dans les réponses API |

### Hors périmètre assumé

- **Thème clair** : non prioritaire pour un outil d'admin Discord (audience habituée au dark). Documenté comme choix de marque (H5).
- **Refonte data-viz complète** (donut de présence, courbes temps réel) : attendre que le gateway remonte des séries.

---

## 4. Critères de succès (vérifiables sans métrique d'usage)

1. **Zéro** `confirm()`/`alert()` natif dans `packages/panel/src`.
2. **Zéro** texte « Chargement… » : toute attente > 200 ms a un skeleton.
3. **100 %** des mutations produisent un feedback visible (toast ou SaveBar), succès **et** échec.
4. Impossible de quitter une page de réglages avec des modifications non enregistrées sans avertissement.
5. Plus aucun snowflake Discord affiché comme identité principale (toujours pseudo + avatar, ID en secondaire copiable).
6. Audit clavier : parcours complet de chaque page au clavier seul, focus toujours visible, modales piégeant le focus.
7. `pnpm --filter '@bot/panel' build` et typecheck verts à chaque phase (chaque phase est shippable indépendamment).

---

## 5. Risques & garde-fous

- **Dérive de périmètre back** : UserCell, deltas et sparklines dépendent du Worker/gateway. Chaque item est conçu pour dégrader proprement (fallback = affichage actuel de l'ID) afin de ne jamais bloquer une phase front.
- **Cohérence pendant la transition** : migrer page par page mais **composant par composant d'abord** (le kit v2 remplace le kit v1 in place, mêmes noms d'exports quand possible) pour éviter deux styles simultanés.
- **Poids du bundle** : pas de librairie UI externe (Radix, etc.) sans décision explicite — les primitives v2 sont spécifiées pour être écrites à la main (~600 lignes estimées), dans l'esprit actuel du projet.
