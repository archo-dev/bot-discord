# Kit Nocturne / Keystone — tokens canoniques

> Référence pour toute contribution au panel. Établie en **Phase 2.1 (Fondations)**.
> Règle d'or : **on ne code plus une valeur ad hoc quand un token existe.**
> Les valeurs (hex, familles de police, tailles) sont **gelées** (identité Keystone) —
> ce document dit *quel token utiliser*, pas *quelle valeur inventer*.

## Typographie — taille

| Rôle | Classe canonique | Taille | Quand l'utiliser |
|---|---|---|---|
| Surtitre / éyebrow / badge | `text-eyebrow` | 11px | libellés capitales, badges, éyebrows (souvent avec `font-display uppercase tracking-[0.16em]`) |
| Métadonnée / légende | `text-xs` (Tailwind) | 12px | horodatages, compteurs, notes secondaires |
| **Corps (défaut du panel)** | **`text-body`** | 13px | libellés de champ, descriptions de carte, lignes de liste, la plupart du texte dense |
| Texte courant | `text-sm` (Tailwind) | 14px | paragraphes un peu plus aérés, contenus de lecture |
| Titre de carte | `text-title` | 15px | `Card`/`InfoTile` (déjà appliqué dans le kit) |
| Titre de page (H1) | `font-display` + taille display | 22–26px | fourni par `GuildLayout`/`PageHeader` |

- **Interdit** : `text-[13px]`, `text-[15px]`, `text-[11px]` en dur → utiliser les classes ci-dessus.
- `text-eyebrow` / `text-body` / `text-title` sont générés en **`font-size` seul** (`@utility` dans `index.css`) : le `line-height` reste **hérité**, exactement comme les anciens `text-[Npx]`. Pour régler l'interligne, ajouter `leading-*` explicitement.
- Tokens sources : `--text-eyebrow` / `--text-body` / `--text-title` (dans `:root`, `index.css`).

### Titre de carte fait main (Phase 2.2.c-1)

- Un titre de carte codé à la main hérite sinon **16px** (base `body`, sans `font-size`). Classe canonique = celle du composant `Card` : **`text-title font-semibold text-zinc-100`** (→ 15px).
- **Couleur** : `text-zinc-100` résout `--color-zinc-100 = #f4f2f8`, soit **exactement** `--text-primary` (neutre chaud Keystone, gelé). Poser `text-zinc-100` est donc sans effet visuel — on l'ajoute pour aligner sur la classe canonique de `Card`, sans régresser l'identité. (Si un jour la rampe `zinc` divergeait du neutre Keystone, préférer `text-title` seul et laisser la couleur héritée.)
- Non converti en prop `Card.title` : la plupart des cartes ont une description `<p class="text-sm">` bespoke (14px) qui régresserait à 12px via `Card.description`, et l'en-tête `Card` (`mb-3`/`items-start`) décalerait le rythme. `text-title` en classe = risque nul, diff minimal. Adoption `Card.title` réévaluée seulement si une carte est refactorée par ailleurs.

## Bordures neutres

| Token | Classe | Valeur | Usage |
|---|---|---|---|
| `--border` | `border-(--border)` | `#272433` | séparateurs et contours **pleins** (cartes, onglets, listes) — **canonique** |
| `--border-strong` | `border-(--border-strong)` | `#34303f` | contours d'éléments interactifs : champs, boutons secondaires, pagination |

- **Canonique** : préférer `border-(--border)` / `border-(--border-strong)` à `border-zinc-800` / `border-zinc-700` (mêmes valeurs, mais intention explicite).
- **Variantes à alpha existantes** (`border-zinc-800/90`, `/80`, `/70`) : **laissées telles quelles pour l'instant** — leur résolution (unifier vers le token plein = changement imperceptible mais réel) est une décision de micro-passe ultérieure. Ne pas les convertir sans validation.

## Chevron / caret

- Un **seul** chevron dans tout le kit : `Icon.chevron` (SVG). Le glyphe unicode `⌄` est **proscrit** (utiliser `<Icon.chevron />` contraint via `[&_svg]:h-4 [&_svg]:w-4`).
- `Select` natif : la classe `field-caret` réinjecte la flèche (le même chevron, teinte `--text-muted`) après `appearance-none`. Tout `<select>` stylé doit la porter — ou mieux, passer par le composant `Select` du kit.

## Primitives polymorphes & contrôles (Phase 2.2.a)

Règle de création : **une abstraction n'est créée que si ≥ 2 contextes réels l'utilisent.**
Sinon → étendre une primitive existante, ou garder le code local.

| Primitive | Rendu | Quand l'utiliser | Contextes justifiant (≥2) |
|---|---|---|---|
| `Card` (`to` / `href`) | `<Link>` / `<a>` cliquable, sinon `<section>` | carte **entièrement cliquable** — passe le survol canonique (élévation + bord iris). Ne pas recoder une carte-lien à la main | tuiles serveur (`GuildList`), bandeau onboarding (`Dashboard`) |
| `Button` (`to` / `href`) | `<Link>` / `<a>`, sinon `<button>` | action de navigation stylée en bouton — **une seule** API pour variantes/tailles/états | CTA `Landing`, `Commands`, `Automations` |
| `SegmentedControl` | `role="radiogroup"` + flèches | choix unique parmi 2–5 options courtes (plages, bascule) | `Stats` (plage jours ×2 + messages/vocal) |

- **Canonique** : ne plus recoder de carte-lien, de lien stylé en bouton, ni de groupe de boutons segmentés à la main → utiliser ces primitives.
- Non cliquable = `<Card>` sans `to`/`href` (comportement `<section>` **inchangé**).

### Adoption dans les pages (Phase 2.2.b — fait)

Les contextes justifiant ci-dessus consomment désormais les primitives :
- `Card (to)` : tuiles serveur (`GuildList`), bandeau onboarding (`Dashboard` — teinte indigo du conteneur abandonnée au profit de la surface canonique, décision de design).
- `Button (to)` : CTA `+ Nouvelle commande` (`Commands`), `+ Nouvelle automatisation` (`Automations`).
- `Button (href)` : CTA secondaires `Landing` (« Ouvrir le panel » `size=sm`, « Se connecter avec Discord » `size=lg`).
- `SegmentedControl` : `Stats` (plages jours ×2, bascule messages/vocal).

### Exceptions assumées (décisions de design, pas de la dette)

- **Hero `Landing` — « Ajouter à mon serveur »** : reste un `<a>` sur mesure. Taille hors barème (h-11/px-6), icône Discord et état désactivé tant que l'invite ne charge pas (`aria-disabled` sur `<a>`, non exprimable par `<Button>`). Mise en avant marketing volontaire.

## Ce qui reste hors de ce lot (à venir)
- Couleurs de texte (usage `text-secondary` vs `text-muted`) — Phase 2.5.
- Anneaux de focus unifiés, survols (`--state-hover`) — Phase 2.3.
