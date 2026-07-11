# Design System v2 — « Nocturne 2 »

> Évolution du design system Nocturne (v1, `docs/design_system.md`). La v2 **conserve l'identité visuelle** (fond bleu-nuit, blurple unique, bordures fines, chiffres tabulaires) et **complète le système** là où la v1 s'arrêtait : états système, overlays, feedback, formulaires longs, identité Discord.
> Spécification pure — **rien n'est implémenté**. Voir `docs/ux_improvement_plan.md` pour le phasage.
> La v1 reste la référence pour tout ce qui n'est pas redéfini ici.

---

## 0. Ce qui change par rapport à la v1 (résumé)

| Domaine | v1 | v2 |
|---|---|---|
| Couleurs, typo, rayons, espacement | ✅ Spécifiés | **Inchangés** (repris tels quels) + tokens `--info-*` complets |
| Police | Inter via Google Fonts | Inter **self-hostée** (woff2 variable, `font-display: swap`) |
| Mouvement | « transitions 120–200 ms » | Tokens de motion + patterns d'entrée/sortie |
| Overlays | Non spécifiés | **Modal, Drawer, Toast, Tooltip** + échelle z-index |
| États système | Non spécifiés | **Skeleton, EmptyState, matrice de feedback** |
| Formulaires | Champs unitaires | **SaveBar (dirty state), erreurs par champ, Combobox** |
| Identité Discord | IDs bruts tolérés | **UserCell / EntityCell** obligatoires |
| Dashboard | StatCard unique | **StatCard (numérique) + InfoTile (état)** distincts |
| Navigation | Liste plate | **Sidebar groupée** + sous-titres de page |
| Thème | `class="dark"` ambigu | **Dark-only assumé** (décision de marque) |

---

## 1. Principes directeurs (v2)

Les 5 principes v1 restent (fond profond / un seul accent / couleur = catégorie / chiffres tabulaires / hiérarchie par le texte). La v2 en ajoute trois :

6. **Chaque attente a une forme.** Aucun « Chargement… » : toute donnée en cours de route est représentée par un squelette de sa forme finale. Le layout n'a jamais le droit de sauter.
7. **Chaque action a un écho.** Toute mutation (enregistrer, publier, supprimer, révoquer) produit un feedback visible — succès comme échec. Le silence est un bug.
8. **Un humain, jamais un snowflake.** Un utilisateur Discord s'affiche avatar + pseudo ; l'ID n'apparaît qu'en secondaire, copiable. Idem salons (`#nom`) et rôles (pastille de couleur + nom).

---

## 2. Tokens additionnels

Tous les tokens v1 (§2–4 et §8 du fichier v1) restent valides. Ajouts :

### 2.1 Sémantique « info » (complète la grille succès/warning/danger)

```css
--info:        #3E7AFC;
--info-subtle: rgba(62, 122, 252, 0.14);
--info-text:   #7AA6FD;
```

### 2.2 State layers (survol/pression sur surfaces)

Pour unifier les hovers ad hoc (`hover:bg-zinc-800`, `hover:bg-zinc-700`…) :

```css
--state-hover:    rgba(255, 255, 255, 0.04);  /* posé par-dessus la surface */
--state-pressed:  rgba(255, 255, 255, 0.07);
--state-selected: var(--primary-subtle);
```

Règle : un élément interactif posé sur `--surface-N` prend `--surface-N+1` **ou** le state layer, jamais une teinte inventée.

### 2.3 Motion

```css
--motion-fast:   120ms;  /* hover, pressed, toggle */
--motion-base:   180ms;  /* apparition tooltip, accordéons, fondu de page */
--motion-slow:   240ms;  /* modales, drawers, toasts */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);
```

Patterns :
- **Entrée d'overlay** : fade + translation 8 px (`--motion-slow`, `--ease-standard`).
- **Sortie** : fade seul, plus court (`--motion-fast`, `--ease-exit`).
- **Changement de page** : fade-in 150 ms du conteneur `<Outlet>`, pas de translation.
- `prefers-reduced-motion: reduce` ⇒ tout à 0.01 ms (déjà en place, conserver).

### 2.4 Échelle z-index

```css
--z-sticky:  10;   /* SaveBar, en-têtes collants */
--z-drawer:  30;   /* sidebar mobile + son backdrop */
--z-modal:   40;   /* modales + backdrop */
--z-toast:   50;   /* toujours au-dessus de tout */
--z-tooltip: 60;
```

### 2.5 Typographie — chargement

- Inter **self-hostée** : `Inter-Variable.woff2` (poids 400–700) servie par le Worker avec les assets du panel, `font-display: swap`, preload dans `index.html`. Supprime la dépendance Google Fonts.
- Le reste de l'échelle typo v1 (§3) est inchangé.

---

## 3. Composants v1 — amendements

| Composant | Amendement v2 |
|---|---|
| `Button` | Nouvel état **loading** : spinner 16 px remplaçant l'icône, label conservé (« Enregistrement… » interdit — le label ne change plus, c'est le spinner qui parle). `disabled` pendant le pending. |
| `Field` | Nouvelle prop **`error`** : bordure `--danger`, message 12 px `--danger-text` sous le champ, `aria-invalid` + `aria-describedby`. |
| `Chip` | Hauteur visuelle 32 px conservée, mais **zone cliquable ≥ 40 px** (pseudo-padding invisible) pour le tactile. |
| `Tabs` | Sémantique ARIA complète : `role="tablist"` / `tab` / `tabpanel`, navigation aux flèches ←/→, `aria-selected`. Visuel inchangé. |
| `StatCard` | **Réservée aux valeurs numériques** (+ delta optionnel : `--viz-green` si positif, `--viz-red` si négatif, 12 px 600). Les états/configs migrent vers `InfoTile` (§4.10). |
| `Badge`, `Card`, `Toggle`, `Select`, `Input`, `Textarea`, `TableWrap`, `InfoCard` | Inchangés. |

---

## 4. Nouveaux composants

### 4.1 Modal (boîte de dialogue)

L'unique mécanisme de confirmation — les `confirm()`/`alert()` natifs sont interdits.

**Anatomie** : backdrop `--overlay` (flou léger optionnel) · panneau `--surface-1`, bordure `--border`, rayon `--radius-xl` (20 px), `--shadow-lg`, largeur `max-w-md` (confirmation) ou `max-w-2xl` (contenu) · titre h2 15 px 600 · corps 14 px `--text-secondary` · pied : actions alignées à droite, l'action engageante en dernier.

**Variante confirmation destructive** :
- Icône ronde 40 px `--danger-subtle` / glyphe `--danger` en tête.
- Le **nom de l'objet** supprimé apparaît en `--text-primary` 600 dans le corps (« Supprimer **/bienvenue** ? »).
- Les conséquences irréversibles sont listées explicitement (« Le message Discord sera aussi supprimé. »).
- Boutons : `Ghost` « Annuler » + `Danger` « Supprimer ».

**Comportement & a11y** : `role="dialog"` + `aria-modal="true"` + `aria-labelledby` · **focus trap** ; à l'ouverture le focus va sur l'action la moins destructive · Échap et clic backdrop ferment (sauf pendant un pending) · à la fermeture, le focus revient à l'élément déclencheur · scroll de la page verrouillé · entrée/sortie selon §2.3.

### 4.2 Drawer (tiroir latéral)

Même contrat que Modal (backdrop, focus trap, Échap) mais ancré au bord. Usages : sidebar mobile (mise à niveau de l'existant qui n'a ni trap ni Échap), détail d'un transcript de ticket, aperçu d'une commande. Largeur 264 px (nav) / `max-w-lg` (contenu). Translation horizontale `--motion-slow`.

### 4.3 Toast (notification éphémère)

**Le canal de feedback par défaut de toutes les mutations** (brancher un handler global sur le `MutationCache` de TanStack Query : succès discret, erreur systématique).

**Anatomie** : conteneur en bas à droite (`--z-toast`), pile max 3 (les plus vieux se compactent) · toast : `--surface-2`, bordure `--border`, rayon `--radius-md`, `--shadow-md`, padding 12–14 px, largeur 320–380 px · icône de statut (✓ `--success`, ✕ `--danger`, i `--info`) · message 14 px, une ligne d'action optionnelle.

**Règles** :
- Succès : auto-dismiss **4 s**. Erreur : **8 s** + bouton fermer. Le survol suspend le timer.
- Action optionnelle « **Annuler** » (undo) pour les suppressions réversibles — l'undo a 5 s avant que l'appel définitif parte.
- Message = résultat concret, pas un statut technique : « Panneau publié dans #support », « Échec de l'enregistrement — réessayez ».
- A11y : conteneur `aria-live="polite"` (succès) / `role="alert"` (erreur). Jamais d'information *uniquement* dans un toast si elle engage la suite (une erreur de formulaire se double d'un état sur le champ).

### 4.4 Skeleton (squelette de chargement)

Remplace tous les « Chargement… ».

- Bloc : `--surface-2`, rayon `--radius-sm` (texte) ou celui du composant imité, animation *shimmer* subtile 1.6 s (dégradé `--surface-3` translaté) — ou opacité pulsée si reduced-motion.
- **Règle d'or : le skeleton reproduit la géométrie de l'état final** (même grille de KPI, même nombre de lignes de liste ≈ 5, mêmes hauteurs de cartes). Zéro layout shift à l'hydratation.
- Seuil : n'apparaît que si l'attente dépasse ~150 ms (éviter le flash sur cache chaud) ; une fois affiché, reste ≥ 300 ms.
- A11y : conteneur `aria-busy="true"`, contenu skeleton `aria-hidden`.

### 4.5 EmptyState (état vide)

- Centré dans la carte : icône 40 px dans un cercle `--surface-2` (glyphe `--text-muted`) · titre 14 px 600 `--text-primary` · description 13 px `--text-secondary` (max 2 lignes) · **CTA optionnel** (bouton secondary, ou primary si c'est l'action d'onboarding évidente).
- Trois registres :
  1. *Rien encore* → expliquer comment la donnée apparaît (« Les actions de modération apparaîtront ici dès le premier /warn. »).
  2. *Filtre sans résultat* → proposer d'effacer le filtre.
  3. *Fonction non configurée* → CTA vers la configuration.
- Le texte est en `--text-secondary`, jamais `--text-muted` (règle de contraste §6).

### 4.6 IconButton

- Carré 36 px (zone cliquable 40 px min), rayon `--radius-md`, glyphe 18–20 px `--text-secondary`.
- Hover : `--state-hover` + `--text-primary`. Variante danger au survol pour logout/supprimer.
- **`aria-label` obligatoire** (prop requise, pas optionnelle) + Tooltip au survol/focus.

### 4.7 Tooltip

- `--surface-3`, texte 12 px `--text-primary`, padding 6×10 px, rayon `--radius-sm`, `--shadow-md`, flèche optionnelle, `--z-tooltip`.
- Délai d'apparition 400 ms (0 ms si un tooltip est déjà ouvert), disparition immédiate. Apparaît aussi au **focus clavier**.
- Usages canoniques : libellé des IconButtons, raison de mod tronquée, date absolue derrière une date relative, explication du badge Gateway.
- Jamais de contenu interactif dedans (sinon → Popover/Modal).

### 4.8 Pagination

- Bloc : « **{n} résultats** · page {p}/{t} » en `--text-secondary` 13 px tabulaire + IconButtons ‹ › (`aria-label` « Page précédente/suivante », `disabled` aux bornes).
- Placement : pied de carte, aligné à droite. Composant unique — plus d'implémentation inline.

### 4.9 SaveBar (barre de sauvegarde collante)

**Le pattern central des pages de réglages** (Config, Automod, Levels, Welcome, Tickets, PanelAccess).

- Invisible tant que le formulaire est propre. Dès qu'un champ diverge de l'état serveur : barre collante en bas (`--z-sticky`), `--surface-2` + bordure haute `--border` + `--shadow-md`, slide-up `--motion-base`.
- Contenu : « **Modifications non enregistrées** » (14 px 600) + `Ghost` « Réinitialiser » + `Primary` « Enregistrer » (état loading §3).
- Succès : la barre affiche ✓ « Enregistré » 1,5 s puis disparaît. Échec : la barre reste, message d'erreur `--danger-text`, + toast.
- **Garde de navigation** : dirty + tentative de départ ⇒ Modal « Quitter sans enregistrer ? » (Rester / Quitter sans enregistrer).
- Remplace `SaveFeedback` et les boutons « Enregistrer » en bas de page.

### 4.10 InfoTile (tuile d'état — pendant de StatCard)

Pour ce que le Dashboard affiche aujourd'hui à tort dans des StatCards (« #logs », « En ligne », « — ») :

- Même gabarit que StatCard (icône ronde 44 px colorée) mais **valeur 15 px 600** (pas 28 px), avec pastille de statut ou badge à droite.
- Exemples : Salon de logs → `#logs` + badge « À configurer » si absent · Statut du bot → pastille verte + « Gateway connectée ».
- Cliquable en entier quand elle mène à sa page de configuration (hover `--state-hover`).

### 4.11 UserCell / EntityCell (identité Discord)

- **UserCell** : avatar 24/32 px rond + pseudo (`--text-primary` 600) + discriminant/ID en méta `--text-muted` 12 px. Clic sur l'ID = copie + toast « ID copié ». Fallbacks en cascade : avatar → initiales sur `--surface-3` ; pseudo non résolu → `Utilisateur 2325…89` (ID abrégé, complet dans le tooltip). Cas spécial `system` : icône robot + « Système ».
- **ChannelCell** : `#nom` (ou 🔊 pour le vocal) en `--text-secondary` ; jamais l'ID seul.
- **RoleCell** : pastille 8 px de la couleur du rôle + nom.
- S'utilise dans ModLog, Dashboard, Tickets, Warnings, et dans toutes les listes futures. *(Dépendance : endpoint de résolution — le composant dégrade proprement vers l'ID abrégé si absent.)*

### 4.12 Combobox (select avec recherche)

Pour les listes longues (salons, rôles, membres) — le `Select` natif reste pour ≤ ~10 options statiques.

- Fermé : identique au Select v1. Ouvert : panneau `--surface-1` + `--shadow-md`, champ de filtre en tête, liste virtualisable, item survolé `--surface-3`, item choisi coche `--primary`.
- Chaque item utilise ChannelCell/RoleCell/UserCell (icône de type, couleur de rôle, avatar).
- A11y : pattern ARIA combobox (`aria-expanded`, `aria-activedescendant`, navigation flèches, Entrée sélectionne, Échap ferme).
- La recherche de membres interroge l'API avec debounce 250 ms *(dépendance back, même endpoint que UserCell)*.

### 4.13 Sidebar groupée

- Groupes avec éyebrow 11 px 600 uppercase `--text-muted`, marge haute 16 px :
  - **Serveur** : Aperçu · Configuration · Accès panel
  - **Engagement** : Bienvenue · Rôles · Niveaux
  - **Modération** : Auto-mod · Mod-log · Tickets
  - **Outils** : Commandes · Musique
- Item : inchangé v1 §6.2 (actif = `--primary-subtle` + icône `--primary`).
- **Carte serveur unifiée** en tête (remplace l'en-tête + la bannière dupliqués) : icône du serveur 40 px, nom (une seule fois), compteur de membres avec pastille, action « Changer de serveur » en IconButton.
- Chaque entrée de nav porte un **sous-titre** affiché sous le h1 de la page (une phrase d'orientation par page, obligatoire).

---

## 5. Patterns d'états de page

Contrat que **chaque page** doit respecter — c'est la principale nouveauté de la v2.

| État | Représentation | Interdit |
|---|---|---|
| **Chargement initial** | Skeleton de la forme finale (§4.4) | Texte « Chargement… », spinner plein écran |
| **Rechargement** (données en cache) | Contenu affiché tel quel ; indicateur discret si > 1 s | Re-skeleton, clignotement |
| **Vide** | EmptyState avec registre adapté (§4.5) | Ligne grise seule |
| **Erreur de lecture** | Carte d'erreur : icône `--danger-subtle`, message clair, bouton « Réessayer » (refetch) | Page blanche, message technique brut |
| **Erreur de mutation** | Toast erreur **+** état local (SaveBar en erreur, champ en erreur) | Silence, label de bouton qui revient sans explication |
| **Succès de mutation** | Toast succès (action ponctuelle) ou SaveBar ✓ (formulaire) | Aucun feedback |
| **Action destructive** | Modal de confirmation (§4.1) puis toast (avec undo si réversible) | `confirm()` natif |
| **Pending d'action** | Bouton en état loading (spinner, label stable) | Label muté en « …ant… », double-clic possible |

**Matrice de feedback (résumé)** : lecture → skeleton/vide/erreur-carte · écriture ponctuelle (publier, supprimer, révoquer) → toast · écriture de formulaire → SaveBar · destruction → Modal + toast.

---

## 6. Accessibilité (durcissement v2)

Reprend v1 §7 et ajoute :

1. **Nom accessible obligatoire** sur tout contrôle sans texte visible (`aria-label` requis par l'API des composants IconButton, Pagination, Toggle nu).
2. **Contraste par rôle de texte** : contenu à lire ⇒ `--text-secondary` minimum (4.5:1). `--text-muted` (≈3:1) réservé aux métadonnées redondantes. Les messages d'état vide/erreur ne sont jamais en muted.
3. **Focus management des overlays** : trap + restitution (Modal, Drawer, Combobox ouverts) ; ordre de tabulation = ordre visuel.
4. **Clavier complet** : Tabs aux flèches, Combobox pattern ARIA, Échap ferme tout overlay, Entrée soumet les formulaires simples.
5. **Cibles tactiles ≥ 40 px** partout (chips et IconButtons via zone étendue).
6. **Annonces** : `aria-live` sur le conteneur de toasts et la SaveBar ; `aria-busy` pendant les skeletons.
7. **Dates** : toute date relative expose la date absolue (`title` + tooltip).

---

## 7. Microcopy (français)

- **Boutons** : verbe d'action à l'infinitif, objet si ambigu — « Publier le panneau », « Révoquer », jamais « OK »/« Valider ».
- **Confirmation destructive** : question directe avec l'objet en gras + conséquences en clair. Le bouton répète le verbe (« Supprimer »), jamais « Oui ».
- **Toasts** : résultat concret ≤ 8 mots (« Panneau publié dans #support »). Erreur = quoi + issue (« Échec de l'enregistrement — réessayez »), sans jargon HTTP.
- **États vides** : jamais « Aucune donnée ». Dire comment la donnée apparaît ou proposer l'action.
- **Étiquettes** : sentence case (« Seuil d'avertissements ») ; l'uppercase est réservé au style éyebrow.
- **Ton** : outil pro, tutoiement proscrit, vouvoiement sobre, pas de point d'exclamation hors succès notable.

---

## 8. Décisions actées

1. **Dark-only** : pas de thème clair. Retirer l'ambiguïté (`class="dark"` décoratif) de la doc — c'est un choix de marque, le panel vit à côté de Discord.
2. **Pas de librairie UI externe** : les primitives (Modal, Toast, Combobox…) sont écrites à la main dans `ui/`, dans l'esprit du kit actuel. Réévaluer seulement si le coût du focus-trap/combobox dépasse ~2 j.
3. **Le kit v2 remplace le kit v1 in place** (mêmes exports quand possible) — pas de période à deux styles.
4. **Dégradation propre des dépendances back** : tout composant dépendant d'un nouvel endpoint (UserCell, Combobox membres, deltas) a un fallback spécifié et shippable sans le back.

---

## 9. Checklist de conformité (à cocher par page lors de la migration)

- [ ] Skeleton au chargement, zéro layout shift
- [ ] EmptyState sur chaque liste potentiellement vide
- [ ] Erreur de lecture avec « Réessayer »
- [ ] Toutes les mutations → toast et/ou SaveBar (succès + échec)
- [ ] Aucune confirmation native ; Modal pour le destructif
- [ ] Aucun ID Discord affiché comme identité principale
- [ ] Sous-titre de page présent
- [ ] Parcours clavier complet, focus visible, `aria-label` sur les contrôles muets
- [ ] Dates relatives doublées d'une date absolue
- [ ] Aucun texte de contenu en `--text-muted`
