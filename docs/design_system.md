# Design System — Panel Admin & Monitoring Discord

> Système de design sombre « Discord-native », inspiré du dashboard *Aperçu* (image 3).
> Toutes les couleurs ci-dessous ont été échantillonnées directement sur la maquette de référence.
> Nom de code : **Nocturne**.

---

## 1. Principes directeurs

1. **Fond profond, surfaces flottantes.** Le canvas est un bleu-nuit quasi noir. Les cartes ne se distinguent pas par une ombre lourde mais par une surface légèrement plus claire + une bordure fine à 1 px. En UI sombre, **la bordure remplace l'ombre**.
2. **Un seul accent, le blurple.** Le violet-indigo est réservé aux actions primaires, à l'état actif et à la donnée « héros » (courbe, barre de progression). Il ne décore jamais, il signale.
3. **La couleur = catégorie.** Chaque famille de la data-viz (membres / messages / en ligne / boosts, segments du donut, actions de modération) a une teinte fixe. On ne réutilise pas ces teintes pour du décor.
4. **Chiffres tabulaires.** Les KPI et toutes les valeurs numériques utilisent des chiffres à chasse fixe (`tnum`) pour que les colonnes s'alignent — c'est la signature « dashboard » du système.
5. **Hiérarchie par le texte, pas par le trait.** Trois niveaux de gris de texte suffisent à structurer l'info sans multiplier les séparateurs.

---

## 2. Couleurs

### 2.1 Fonds & surfaces

| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#0A0B12` | Canvas global de l'application (zone la plus sombre) |
| `--bg-base` | `#0D0E1A` | Fond de page derrière les cartes |
| `--sidebar` | `#101320` | Barre latérale de navigation |
| `--surface-1` | `#141824` | Cartes, panneaux, blocs de section |
| `--surface-2` | `#1A1F2E` | Hover de surface, champs de saisie, selects |
| `--surface-3` | `#20263A` | Ligne active, item sélectionné, hover de liste |
| `--overlay` | `rgba(6, 7, 14, 0.72)` | Fond de modale / backdrop |

### 2.2 Bordures

| Token | Hex / rgba | Usage |
|---|---|---|
| `--border` | `#232838` | Bordure standard des cartes & inputs |
| `--border-subtle` | `rgba(255,255,255,0.05)` | Séparateurs internes très discrets |
| `--border-strong` | `#2E3548` | Hover d'input, éléments interactifs |
| `--border-focus` | `var(--primary)` | Anneau de focus |

### 2.3 Marque — Blurple (accent primaire)

| Token | Hex | Usage |
|---|---|---|
| `--primary` | `#5D57F2` | Bouton primaire, état actif, courbe héros |
| `--primary-hover` | `#6E68F5` | Survol du bouton primaire |
| `--primary-active` | `#4A43E8` | Bouton pressé |
| `--primary-subtle` | `rgba(93, 87, 242, 0.16)` | Fond des chips sélectionnées, badges « Événement » |
| `--primary-border` | `rgba(93, 87, 242, 0.55)` | Bordure des chips sélectionnées |
| `--primary-ring` | `rgba(93, 87, 242, 0.38)` | Anneau de focus clavier |
| `--on-primary` | `#FFFFFF` | Texte sur fond primaire |

### 2.4 Data-viz (catégoriel)

Teintes fixes, une par famille de donnée. Reprises telles quelles sur les icônes de KPI, les segments du donut et les légendes.

| Token | Hex | Assigné à |
|---|---|---|
| `--viz-violet` | `#7C4DEE` | Membres |
| `--viz-blue` | `#3E7AFC` | Messages |
| `--viz-green` | `#1FC069` | En ligne / positif |
| `--viz-amber` | `#F0B114` | Boosts |
| `--viz-red` | `#ED4B4B` | Ne pas déranger / alerte |
| `--viz-gray` | `#4B5163` | Hors ligne / inactif |

### 2.5 Sémantique (statut & feedback)

| Rôle | Solide | Fond « subtle » | Texte sur subtle |
|---|---|---|---|
| Succès / online | `#1FC069` | `rgba(31,192,105,0.14)` | `#52D18C` |
| Avertissement | `#F0B114` | `rgba(240,177,20,0.14)` | `#F2C044` |
| Danger / ban | `#ED4245` | `rgba(237,66,69,0.14)` | `#F1706F` |
| Info | `#3E7AFC` | `rgba(62,122,252,0.14)` | `#7AA6FD` |
| Neutre / fermé | `#4B5163` | `var(--surface-2)` | `var(--text-muted)` |

### 2.6 Texte

| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#F3F4F8` | Titres, valeurs KPI, contenu principal |
| `--text-secondary` | `#9BA1B0` | Sous-titres, labels, corps secondaire |
| `--text-muted` | `#6B7180` | Métadonnées, timestamps, placeholder |
| `--text-disabled` | `#4A4F5E` | Éléments désactivés |

### 2.7 Dégradé de la courbe (area chart)

```css
--chart-stroke: #6C63F2;
--chart-fill: linear-gradient(180deg,
  rgba(108, 99, 242, 0.45) 0%,
  rgba(108, 99, 242, 0.04) 100%);
```

---

## 3. Typographie

**Famille UI :** `Inter` (proche de la « gg sans » de Discord, excellent rendu en petit sur fond sombre).
**Chiffres :** activer `font-feature-settings: "tnum" 1;` sur tous les nombres.
Fallback : `-apple-system, "Segoe UI", Roboto, system-ui, sans-serif`.

```css
--font-ui: "Inter", -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
--font-num: "Inter", system-ui, sans-serif; /* + tnum activé */
```

### Échelle typographique

| Rôle | Taille | Line-height | Poids | Interlettrage | Exemple |
|---|---|---|---|---|---|
| KPI / Display | 28px | 32px | 700 | -0.02em | « 1287 » |
| Titre de page (h1) | 22px | 28px | 700 | -0.01em | « Aperçu » |
| Titre de carte (h2) | 15px | 20px | 600 | 0 | « Activité du serveur » |
| Corps | 14px | 20px | 400 | 0 | Texte courant |
| Corps fort | 14px | 20px | 600 | 0 | Nom d'utilisateur |
| Label / éyebrow | 12px | 16px | 600 | 0.04em, UPPERCASE | « SEUIL DE WARNS » |
| Métadonnée | 12px | 16px | 500 | 0 | « Il y a 2h » |
| Micro | 11px | 14px | 600 | 0.03em | Badges |

---

## 4. Espacement, rayons, élévation

### Espacement (base 4 px)

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64
```

- Padding interne des cartes : **20–24 px**
- Gouttière entre cartes : **16–20 px**
- Padding vertical des lignes de liste : **12–14 px**

### Rayons de bordure

| Token | Valeur | Usage |
|---|---|---|
| `--radius-sm` | `6px` | Inputs, petits éléments |
| `--radius-md` | `10px` | Boutons |
| `--radius-lg` | `14px` | Cartes, panneaux |
| `--radius-xl` | `20px` | Grands conteneurs, modales |
| `--radius-full` | `9999px` | Chips, badges, toggles, avatars, barres de progression |

### Élévation

En UI sombre, on privilégie la bordure + une ombre très douce.

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.40);
--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.45);
--shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.55);
--focus-ring: 0 0 0 3px var(--primary-ring);
```

---

## 5. Composants

### 5.1 Carte / Panneau de section

La brique de base (blocs « Système de tickets », « Activité du serveur »…).

- Fond `--surface-1`, bordure `--border`, rayon `--radius-lg`, padding `24px`.
- **En-tête** : titre h2 (`--text-primary`) + description optionnelle sur la ligne suivante (`--text-secondary`, 13px).
- Lien d'action aligné à droite de l'en-tête (« Voir tout ») en `--primary`, 13px.

```css
.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}
.card__title { font: 600 15px/20px var(--font-ui); color: var(--text-primary); }
.card__desc  { font: 400 13px/18px var(--font-ui); color: var(--text-secondary); margin-top: 4px; }
```

### 5.2 Carte KPI (stat)

Icône ronde colorée à gauche, grande valeur, label, delta.

- Icône : cercle `44px`, fond = teinte data-viz à 100 %, glyphe blanc.
- Valeur : Display 28px `700`, chiffres tabulaires.
- Label : corps 14px `--text-secondary`.
- Delta : `--viz-green` si positif (`+42 ce mois`), `--viz-red` si négatif ; 12px `600`.

```
┌──────────────────────────────┐
│  (◐)  1287                    │
│       Membres                 │
│       +42 ce mois   ← vert    │
└──────────────────────────────┘
```

### 5.3 Boutons

| Variante | Fond | Texte | Bordure | Usage |
|---|---|---|---|---|
| **Primary** | `--primary` → hover `--primary-hover` | `#FFF` | — | « Enregistrer », « Exporter » |
| **Secondary** | `--surface-2` → hover `--surface-3` | `--text-primary` | `--border` | Actions neutres |
| **Ghost** | transparent → hover `--surface-2` | `--text-secondary` | — | Icônes, actions discrètes |
| **Danger** | `--danger` | `#FFF` | — | Ban, suppression |
| **Disabled** | `rgba(93,87,242,0.4)` | `rgba(255,255,255,0.6)` | — | « Publier le panneau » inactif |

- Hauteurs : `sm 32px` · `md 40px` (défaut) · `lg 46px`.
- Padding horizontal : `16px` (md).
- Rayon : `--radius-md`. Transition `background .15s ease`.
- Focus : `box-shadow: var(--focus-ring)`.

```css
.btn-primary {
  height: 40px; padding: 0 16px;
  background: var(--primary); color: var(--on-primary);
  border-radius: var(--radius-md); font: 600 14px/1 var(--font-ui);
  transition: background .15s ease;
}
.btn-primary:hover  { background: var(--primary-hover); }
.btn-primary:active { background: var(--primary-active); }
.btn-primary:disabled { background: rgba(93,87,242,.4); color: rgba(255,255,255,.6); cursor: not-allowed; }
```

### 5.4 Chip / Tag de rôle (multi-sélection)

Les pilules « Batard Originel », « Femme », « Gold »… Deux états structurants.

| État | Fond | Texte | Bordure |
|---|---|---|---|
| Défaut | transparent | `--text-secondary` | `--border-strong` |
| Hover | `--surface-2` | `--text-primary` | `--border-strong` |
| **Sélectionné** | `--primary-subtle` | `#C9C5FA` | `--primary-border` |
| Désactivé | transparent | `--text-disabled` | `--border` |

```css
.chip {
  display: inline-flex; align-items: center; height: 34px; padding: 0 16px;
  border-radius: var(--radius-full); border: 1px solid var(--border-strong);
  background: transparent; color: var(--text-secondary);
  font: 500 13px/1 var(--font-ui); cursor: pointer; transition: all .12s ease;
}
.chip:hover { background: var(--surface-2); color: var(--text-primary); }
.chip[aria-pressed="true"] {
  background: var(--primary-subtle); border-color: var(--primary-border); color: #C9C5FA;
}
```

### 5.5 Badge / Pastille de statut

Petite pilule 11px `600`. Fond « subtle », texte de la même famille.

| Exemple | Fond | Texte |
|---|---|---|
| Événement | `--primary-subtle` | `#B7A6F5` |
| Annonce | `success-subtle` | `#52D18C` |
| Fermé | `--surface-2` | `--text-muted` |
| Ban | `danger-subtle` | `#F1706F` |

```css
.badge {
  display: inline-flex; align-items: center; padding: 3px 8px;
  border-radius: var(--radius-full); font: 600 11px/1.2 var(--font-ui);
  letter-spacing: .02em;
}
```

### 5.6 Toggle (interrupteur)

Le switch « Système de tickets ».

- Piste : `40 × 22px`, rayon full. Off = `--surface-3`. On = `--primary`.
- Pastille : `18px`, blanche, `--shadow-sm`, translation `18px` à l'activation.
- Transition `.2s ease`. Focus : anneau primaire.

### 5.7 Select / Dropdown

- Fond `--surface-2`, bordure `--border`, rayon `--radius-sm`, hauteur `44px`, padding `0 14px`.
- Chevron `--text-muted` à droite. Hover : bordure `--border-strong`.
- Focus : bordure `--primary` + `--focus-ring`.
- Menu ouvert : fond `--surface-1`, bordure `--border`, `--shadow-md` ; item survolé `--surface-3`.

### 5.8 Champ texte & zone de texte

Mêmes tokens que le select. Placeholder `--text-muted`. La zone de texte (« Description ») : `min-height: 120px`, `resize: vertical`, `line-height: 1.5`.

```css
.input, .textarea, .select {
  width: 100%; background: var(--surface-2); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 0 14px; height: 44px; font: 400 14px/1 var(--font-ui);
}
.input:focus { border-color: var(--primary); box-shadow: var(--focus-ring); outline: none; }
.input::placeholder { color: var(--text-muted); }
```

### 5.9 Ligne de liste (ticket / action de mod / événement)

Structure commune à trois usages : tickets fermés, actions de modération, événements à venir.

- Ligne : `padding: 12px 0`, séparateur `--border-subtle` entre items (pas après le dernier).
- **Zone gauche** : badge de statut ou icône ronde colorée + titre `600` + méta `--text-muted`.
- **Zone droite** : action (« Transcript » en `--primary`) ou timestamp `--text-muted`.
- Hover (si cliquable) : fond `--surface-2`, marge négative pour un padding cliquide.

```
[Fermé]  #0002  par 2325…  · 10/07/2026 01:03      Transcript →
(◐) Warn   Utilisateur#1234                          Il y a 2h
```

### 5.10 Avatar + pastille de présence

- Avatar rond, tailles `24 / 32 / 40px`, `--radius-full`.
- Pastille de présence : cercle `10px` en bas-droite, bordure `2px` couleur `--surface-1` pour le détacher.
  - En ligne `--viz-green` · Absent `--viz-amber` · Ne pas déranger `--viz-red` · Hors ligne `--viz-gray`.

### 5.11 Barre de progression (activité des salons)

- Piste : hauteur `6px`, `--surface-3`, rayon full.
- Remplissage : `--primary` (ou `--viz-blue` pour les salons vocaux), rayon full, largeur = `%`.
- Valeur `%` alignée à droite en `--text-secondary` 12px tabulaire.

### 5.12 Graphiques

**Courbe (area) :** trait `--chart-stroke` `2px`, remplissage `--chart-fill`, points au survol `4px` blancs cerclés `--primary`. Grille horizontale `--border-subtle` uniquement, pas de grille verticale. Axes en `--text-muted` 11px.

**Donut :** épaisseur d'anneau `~16%` du rayon, un segment par teinte data-viz, `2px` de gap entre segments (couleur `--bg-base`). Total centré en Display + label `--text-muted`. Légende : pastille `8px` + libellé `--text-secondary` + valeur tabulaire.

---

## 6. Navigation

### 6.1 Onglets horizontaux (barre du haut du panel)

Onglets « Vue d'ensemble · Configuration · Tickets… ».

- Item : `--text-secondary` 15px `500`, padding `16px 4px`, gap `32px`.
- **Actif** : `--text-primary` `600` + soulignement `2px` `--primary` collé au bas.
- Hover : `--text-primary`. Ligne de séparation globale sous la barre : `--border`.

### 6.2 Item de barre latérale (dashboard Aperçu)

- Item : icône + libellé, `--text-secondary`, padding `10px 12px`, rayon `--radius-md`.
- **Actif** : fond `--primary-subtle` (ou `--surface-3`), texte `--text-primary`, icône `--primary`.
- Hover : fond `--surface-2`.

---

## 7. Accessibilité & mouvement

- **Contraste** : `--text-primary` et `--text-secondary` respectent AA (≥ 4.5:1) sur les fonds sombres. `--text-muted` réservé aux éléments non essentiels (méta), jamais à du contenu critique.
- **Focus visible** : toujours `--focus-ring` sur les éléments interactifs, jamais `outline: none` sans remplacement.
- **Cibles tactiles** : minimum `40px` de hauteur cliquable (chips à `34px` → prévoir une zone cliquable élargie sur mobile).
- **Mouvement** : transitions courtes (`120–200 ms`, `ease`). Respecter `@media (prefers-reduced-motion: reduce)` en coupant les animations non essentielles.
- **La couleur n'est jamais seule porteuse de sens** : un statut = couleur **+** libellé/icône (ex. « Fermé » écrit, pas juste gris).

---

## 8. Bloc prêt à l'emploi — variables CSS

```css
:root {
  /* Fonds & surfaces */
  --bg-app: #0A0B12;
  --bg-base: #0D0E1A;
  --sidebar: #101320;
  --surface-1: #141824;
  --surface-2: #1A1F2E;
  --surface-3: #20263A;
  --overlay: rgba(6, 7, 14, 0.72);

  /* Bordures */
  --border: #232838;
  --border-subtle: rgba(255, 255, 255, 0.05);
  --border-strong: #2E3548;

  /* Primaire */
  --primary: #5D57F2;
  --primary-hover: #6E68F5;
  --primary-active: #4A43E8;
  --primary-subtle: rgba(93, 87, 242, 0.16);
  --primary-border: rgba(93, 87, 242, 0.55);
  --primary-ring: rgba(93, 87, 242, 0.38);
  --on-primary: #FFFFFF;

  /* Data-viz */
  --viz-violet: #7C4DEE;
  --viz-blue: #3E7AFC;
  --viz-green: #1FC069;
  --viz-amber: #F0B114;
  --viz-red: #ED4B4B;
  --viz-gray: #4B5163;

  /* Sémantique */
  --success: #1FC069;
  --warning: #F0B114;
  --danger:  #ED4245;
  --info:    #3E7AFC;

  /* Texte */
  --text-primary: #F3F4F8;
  --text-secondary: #9BA1B0;
  --text-muted: #6B7180;
  --text-disabled: #4A4F5E;

  /* Rayons */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* Élévation */
  --shadow-sm: 0 1px 2px rgba(0,0,0,.40);
  --shadow-md: 0 8px 24px rgba(0,0,0,.45);
  --shadow-lg: 0 16px 48px rgba(0,0,0,.55);
  --focus-ring: 0 0 0 3px var(--primary-ring);

  /* Type */
  --font-ui: "Inter", -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
}

body { background: var(--bg-app); color: var(--text-primary); font-family: var(--font-ui); }
.num { font-feature-settings: "tnum" 1; } /* à poser sur tout nombre */
```

---

## 9. Mapping Tailwind (extension `theme`)

À coller dans `tailwind.config.js` si le panel utilise Tailwind.

```js
module.exports = {
  theme: {
    extend: {
      colors: {
        app: '#0A0B12',
        base: '#0D0E1A',
        sidebar: '#101320',
        surface: { 1: '#141824', 2: '#1A1F2E', 3: '#20263A' },
        border: { DEFAULT: '#232838', strong: '#2E3548' },
        primary: {
          DEFAULT: '#5D57F2', hover: '#6E68F5', active: '#4A43E8',
        },
        viz: {
          violet: '#7C4DEE', blue: '#3E7AFC', green: '#1FC069',
          amber: '#F0B114', red: '#ED4B4B', gray: '#4B5163',
        },
        success: '#1FC069', warning: '#F0B114', danger: '#ED4245', info: '#3E7AFC',
        content: { DEFAULT: '#F3F4F8', muted: '#9BA1B0', subtle: '#6B7180', disabled: '#4A4F5E' },
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px' },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,.40)',
        md: '0 8px 24px rgba(0,0,0,.45)',
        lg: '0 16px 48px rgba(0,0,0,.55)',
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
```

---

## 10. Do / Don't

**À faire**
- Utiliser le blurple uniquement pour l'action primaire, l'actif et la donnée héros.
- Aligner tous les nombres avec `tnum`.
- Distinguer les cartes par surface + bordure, pas par une ombre lourde.
- Toujours doubler la couleur d'un statut par un libellé.

**À éviter**
- Deux boutons primaires dans le même bloc (une seule action « héros » par carte).
- Réutiliser les teintes data-viz comme couleurs décoratives.
- Du texte `--text-muted` pour du contenu qu'il faut vraiment lire.
- Des rayons incohérents : cartes `14px`, boutons `10px`, chips `full` — s'y tenir.
