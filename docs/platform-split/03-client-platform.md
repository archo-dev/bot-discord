# 03 — Plateforme client (`archodev.fr`)

> Voir aussi : [stratégie commerciale](./05-plans-and-commercial-strategy.md) · [UX/UI](./10-ux-ui-direction.md) · [abonnements](./06-subscriptions-and-entitlements.md)

Objectif : une **seule expérience** qui vend avant connexion et gère après connexion, sous la marque « Archodev / Nocturne ». Avant login = site premium qui **vend des résultats** ; après login = application de gestion orientée actions.

## Sitemap public (avant connexion)

| Route | Rôle | Notes |
|-------|------|-------|
| `/` | Landing — hero, preuve de valeur, offres, CTA | Évolution de l'actuel `packages/panel/src/pages/Landing.tsx` |
| `/features` | Détail des capacités, orientées bénéfices | Regroupe par thème (protéger, animer, gérer) |
| `/pricing` | Comparatif Gratuit / Premium / Business | Prix **non fixés** ([doc 13](./13-open-decisions.md)) |
| `/updates` | Notes de mise à jour publiques | Alimenté par le Studio ([doc 04](./04-developer-studio.md)) |
| `/updates/:slug` | Détail d'une note | Filtrable par module |
| `/docs` | Documentation légère (démarrage, modules) | Contenu MD léger, pas un wiki lourd |
| `/status` | Statut des services (Worker/Gateway/D1) | Source : heartbeat `gateway:status` + health |
| `/support` | Point d'entrée support / FAQ | Redirige vers `/app/support` si connecté |
| `/login` | Déclenche l'OAuth Discord | Lien vers `/auth/login` |
| `/invite` | Ajout du bot à un serveur | Lien d'invitation Discord |
| `/legal/mentions` | Mentions légales | Statique |
| `/legal/privacy` | Confidentialité | Réutilise l'esprit de `docs/privacy-analytics.md` |
| `/legal/terms` | Conditions d'utilisation | Statique |
| `/legal/sales` | Conditions de vente | Requis si paiement ([doc 07](./07-billing-provider-analysis.md)) |

Sections attendues de la landing (`/`) : hero (promesse + CTA « Ajouter à mon serveur » / « Se connecter »), bandeau de preuve (résultats vendus), grille de modules par bénéfice, aperçu des offres, dernières mises à jour (3 cartes depuis `/updates`), réassurance (confidentialité, statut), FAQ courte, CTA final. Détail des textes commerciaux en [doc 05](./05-plans-and-commercial-strategy.md).

## Sitemap connecté (après connexion)

| Route | Rôle | Réutilisation existante |
|-------|------|------------------------|
| `/app` | Tableau de bord multi-serveurs, état d'abonnement, upsell contextuel | Nouveau (agrège) |
| `/app/servers` | Liste des serveurs gérés + emplacements utilisés/disponibles | Évolue de `pages/GuildList.tsx` |
| `/app/servers/:guildId` | Aperçu d'un serveur | `pages/GuildLayout.tsx` + `Dashboard.tsx` |
| `/app/servers/:guildId/<module>` | Pages modules (welcome, automod, levels, tickets, music, roles, starboard, tempvoice, commands, automations, moderation, voicelog, stats, audit, config…) | Pages existantes sous `packages/panel/src/pages/` |
| `/app/subscription` | Plan actif, emplacements, changement de plan, cumul, downgrade | Nouveau ([doc 06](./06-subscriptions-and-entitlements.md)) |
| `/app/billing` | Factures, moyen de paiement, portail prestataire | Nouveau ([doc 07](./07-billing-provider-analysis.md)) |
| `/app/support` | Mes tickets, priorité selon plan | Nouveau (réutilise le moteur tickets côté serveur) |
| `/app/account` | Profil Discord, sessions, préférences, déconnexion | Étend le footer user de `GuildLayout` |

**Cohérence** : le passage public → connecté ne doit **pas** ressembler à deux sites. Même en-tête de marque, même palette, même typographie, transition douce. La landing reste accessible connecté (via logo) mais le CTA principal devient « Ouvrir le panel ».

## Navigation

- **Public** : barre supérieure légère (logo, Fonctions, Tarifs, Mises à jour, Docs, Statut, [Se connecter]). Footer riche (produit, ressources, légal, statut).
- **Connecté** : conserve le modèle actuel — sélection de serveur puis shell `GuildLayout` avec sidebar `NAV_GROUPS`. Ajouts :
  - un **sélecteur de serveur** persistant (aujourd'hui il faut repasser par la liste) — **[amélioration UX]** ;
  - une entrée **« Abonnement »** au niveau compte (hors sidebar guilde) ;
  - un **badge de plan** (Gratuit/Premium/Business) visible et un indicateur d'emplacements.
- **Navigation courte et cohérente** : profondeur max 3 niveaux (compte → serveur → module).

## Parcours utilisateurs clés

1. **Découverte → essai gratuit**
   `/` → `/pricing` → « Commencer gratuitement » → `/invite` (ajout bot) → `/login` (OAuth) → `/app` → onboarding guidé du 1er serveur.
2. **Configuration d'un serveur**
   `/app/servers` → sélection → `/app/servers/:id` → onboarding presets (réutilise `Onboarding.tsx`/`OnboardingPresets.tsx`) → activation modules.
3. **Montée en gamme (upsell)**
   Tentative d'action verrouillée (module/limite Premium) → tooltip/CTA non bloquant → `/app/subscription` → choix plan → `/app/billing` → paiement → droits appliqués (voir cumul [doc 06](./06-subscriptions-and-entitlements.md)).
4. **Gestion d'emplacements**
   `/app/subscription` → voir emplacements utilisés (ex. 3/3) → réaffecter un emplacement à un autre serveur (avec protection anti-abus) → confirmation.
5. **Support**
   `/app/support` → nouveau ticket → priorité auto selon plan → suivi.
6. **Downgrade**
   `/app/subscription` → passer Business→Premium → écran de **sélection des serveurs à conserver** (3 sur 5) → les 2 autres passent « suspendus » (config conservée).

## Onboarding guidé

- Déclenché au premier serveur connecté et réutilisable par serveur.
- Étapes : bienvenue → choix d'un preset (modération / communauté / complet) → activation des modules essentiels → invitation à explorer → rappel des limites du plan Gratuit + valeur Premium (non frustrant).
- Réutilise `pages/Onboarding.tsx`, `OnboardingPresets.tsx` et le registre `MODULE_REGISTRY` (`@bot/shared`).
- **États de sauvegarde visibles** partout : réutilise `packages/panel/src/ui/savebar.tsx` (idle/pending/success/error, « ✓ Enregistré », garde anti-perte).

## Verrouillage visuel des fonctions Premium (sans dégrader l'UX)

Principe : **montrer la valeur, ne pas frustrer**. Voir aussi [doc 05](./05-plans-and-commercial-strategy.md) et [doc 10](./10-ux-ui-direction.md).

- Fonction verrouillée = **visible** avec un badge « Premium » discret, aperçu lisible mais interactions désactivées, et un CTA doux « Débloquer avec Premium » menant à `/app/subscription`.
- **Jamais** de mur opaque ni d'erreur brutale : l'utilisateur comprend *ce qu'il gagnerait*.
- Le verrouillage est **cosmétique côté client** ; l'application réelle est **backend** (le Worker refuse la mutation si le plan ne le permet pas — défense en profondeur, cf. `enforcePanelMutationPolicy` comme modèle).

## Conversion (points clés)

- CTA cohérents (« Commencer gratuitement », « Passer à Premium », « Débloquer »).
- Upsells **contextuels** (au moment où l'utilisateur rencontre une limite), pas intrusifs.
- Preuve continue : badges de plan, compteurs d'emplacements, « dernières mises à jour » qui montrent un produit vivant.
- Page `/pricing` claire avec comparatif et FAQ d'objections.
- Réassurance : confidentialité, statut des services, support priorisé.

## Mobile / responsive

Le socle est **déjà responsive** (drawer mobile, focus-trap, `prefers-reduced-motion`, grilles adaptatives — cf. [doc 01](./01-current-state-audit.md) §9). À conserver et étendre :

- Pages publiques (pricing, features) pensées mobile-first.
- Panel : navigation drawer conservée ; formulaires denses adaptés au tactile.
- Budget bundle 180 KiB gzip à respecter (les pages marketing lourdes en lazy-load).

## Décision produit / UX / technique (séparation)

- **Produit** : parcours découverte→essai→upsell→gestion→support unifiés.
- **UX** : cohérence marque public↔connecté, upsell non frustrant, onboarding guidé, save-states visibles.
- **Technique** : réutilisation maximale des pages panel existantes ; nouvelles pages compte/abonnement/facturation/support ; verrouillage appliqué **backend**.
