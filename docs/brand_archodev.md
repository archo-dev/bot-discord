# Identité de marque — Archodev « Keystone »

> Direction artistique du panel. Complète (ne remplace pas) `design_system.md` / `design_system_v2.md` :
> la v1/v2 restent la référence pour les composants et les patterns d'état ; ce document
> définit **la couche d'identité** posée par-dessus. Dark-only assumé.

## 1. Concept

**Archodev = la clef de voûte de la communauté.** « Archo » évoque l'arche, l'archonte
(celui qui tient), et la *clef de voûte* : la pierre centrale sans laquelle l'arche
s'effondre. C'est le rôle du bot pour un serveur — la pièce qui tient l'ensemble.

Trois traductions visuelles concrètes :
1. **Monogramme clef de voûte** — un « A » dont l'apex est une pierre de faîte (`ui/brand.tsx`).
2. **Lumière de voûte** — la lumière tombe du haut : un filet clair en tête de chaque
   surface surélevée (`--shadow-vault`). C'est le **geste signature répété**.
3. **Aurore** — un dégradé propriétaire iris → périwinkle → cyan (`--aurora`), réservé
   aux moments de marque (logo, mot-clé du hero, barre de nav active, focus).

## 2. Couleur

### Accent propriétaire « Aurora Iris »
On **quitte le blurple de Discord** (`#5865F2`) — qui faisait lire le panel comme une
extension de Discord — pour un iris plus violet et lumineux, à nous.

| Rôle | Valeur |
|---|---|
| `--primary` (iris) | `#6B4EF2` |
| `--primary-hover` | `#8168F6` |
| accent texte (`indigo-300`) | `#B7A8FB` |
| `--aurora` | `linear-gradient(120deg, #6B4EF2, #8A6BFF 46%, #6FC7FF)` |

Discipline inchangée : **un seul accent**. L'aurore n'est pas un deuxième accent, c'est
la version « signature » du même iris — usage parcimonieux.

### Neutres « nuit chaude »
Les gris passent d'un bleu-SaaS clinique à une **nuit à sous-ton violet**. Ordre de
luminance strictement préservé (aucun composant ne casse) — seule la température change.
`bg-app #0C0A11` · `surface-1 #16141F` · `surface-2 #1D1A28` · `border #272433` ·
`text-secondary #A49DAD` · `text-primary #F4F2F8`.

## 3. Typographie

- **Corps : Inter** (self-hostée, inchangée — sa lisibilité est parfaite).
- **Affichage : Space Grotesk Variable** (self-hostée, SIL OFL) — titres de page,
  éyebrows, logotype. Utilitaire `.font-display`, crénage `-0.01em`.
- Le contraste *display grotesk / Inter* + un saut de taille net (H1 22–26 px vs titres
  de carte 15 px Inter) creuse la hiérarchie qui manquait.
- Chiffres tabulaires (`tnum`) conservés partout, y compris en display.

## 4. Surfaces & profondeur

- **Carte** = nuit chaude en léger dégradé (150°) + `--shadow-card` (= `--shadow-vault`
  + élévation). Le filet de voûte en haut est présent sur **chaque** carte : c'est ce
  qu'on reconnaît.
- **Grain** : voile de bruit fixe très discret (opacité ~0.028) sur le canvas → matière
  et profondeur, fin de l'aplat parfait. Coupé si `prefers-reduced-motion`.

## 5. Composants — principes d'identité

- **Bouton primaire** : silhouette conservée + filet de lumière supérieur (verre de
  voûte) → paraît ciselé, cohérent avec la lumière du système.
- **Nav active** : fond iris subtil + **barre aurore** à gauche (au lieu d'un simple trait
  plein) → l'état actif est un moment de marque.
- **Badges / chips** : héritent automatiquement de l'iris via le remap des utilitaires
  `indigo-*` (aucune couleur inventée).

## 6. Ce qui n'a PAS changé (volontairement)

Motion, a11y (focus-trap, `aria`, reduced-motion), contrat d'états (skeleton/empty/error/
toast/savebar), architecture des composants, logique métier. L'identité **signe**
l'existant excellent — elle ne le réécrit pas.
