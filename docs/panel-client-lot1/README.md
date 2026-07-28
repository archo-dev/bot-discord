# Lot 1 — accueil public condensé

Captures locales de validation, sans déploiement :

- `01-avant-desktop-1440.png` — landing avant le Lot 1 ;
- `02-apres-desktop-1440.png` — landing condensée complète à 1440 px ;
- `03-apres-tablette-1024.png` — premier écran à 1024 px ;
- `04-apres-mobile-390.png` — premier écran à 390 px ;
- `05-apercu-panel.png` — destination du CTA « Voir la démo » ;
- `06-header-mobile.png` — navigation mobile ouverte.

Les captures utilisent le serveur Vite local avec `platform.publicSite` actif. L'aperçu du panel est illustratif et ne contient aucune donnée de serveur réelle.

Contrôles navigateur effectués :

- `scrollWidth === clientWidth` à 1440, 1024 et 390 px ;
- CTA Discord vers `/auth/login` ;
- CTA « Voir la démo » vers `#apercu-panel` ;
- routes du header inchangées : `/features`, `/pricing`, `/updates`, `/status` ;
- menu mobile accessible au clavier, fermeture avec `Échap` et restitution du focus ;
- aucun chiffre social rendu.
