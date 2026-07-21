# Templates de configuration — go-live

> ⚠️ **Placeholders uniquement — aucune valeur réelle, aucun secret.** Ne jamais committer de vraie clé/valeur. Les secrets se posent via `wrangler secret bulk` (piège CRLF : jamais `secret put` sous PowerShell).

## Variables de configuration Worker (non secrètes — `wrangler.jsonc` `vars` ou `--var`)

```
PANEL_ORIGIN=https://archodev.fr
PLATFORM_ENTITLEMENTS=            # "true" pour activer (défaut off)
PLATFORM_BILLING=                 # "true" pour activer le checkout (défaut off)
PLATFORM_SUPPORT=                 # "true" (défaut off)
PLATFORM_STUDIO=                  # "true" (défaut off)
PLATFORM_LAUNCH=                  # "true" en dernier, prix + juridique prêts (défaut off)

# Studio (M12+)
STUDIO_HOST=studio.archodev.fr
STUDIO_SESSION_GLOBAL_VERSION=1
STUDIO_KILL_SWITCH=               # "true" = coupe-circuit immédiat

# Prix de lancement (M16) — ENTIERS en plus petite unité (centimes). Décision D1.
LAUNCH_CURRENCY=EUR
LAUNCH_PRICE_PREMIUM_MONTH=       # ex. 599  (= 5,99 €) — À FIXER (D1)
LAUNCH_PRICE_PREMIUM_YEAR=        # À FIXER (D1)
LAUNCH_PRICE_BUSINESS_MONTH=      # À FIXER (D1)
LAUNCH_PRICE_BUSINESS_YEAR=       # À FIXER (D1)

# Billing (M9) — IDs de prix prestataire (config, pas secret)
BILLING_PROVIDER=stripe           # ou le MoR retenu (D3)
BILLING_SUCCESS_URL=https://archodev.fr/app/billing?status=success
BILLING_CANCEL_URL=https://archodev.fr/app/billing?status=cancel
BILLING_PRICE_PREMIUM_MONTH=price_xxx
BILLING_PRICE_PREMIUM_YEAR=price_xxx
BILLING_PRICE_BUSINESS_MONTH=price_xxx
BILLING_PRICE_BUSINESS_YEAR=price_xxx
```

## Secrets (via `wrangler secret bulk fichier.json` puis suppression du fichier)

```
SESSION_SECRET=<random 32+ bytes>
INTERNAL_API_TOKEN=<random>
DISCORD_TOKEN=<bot token>
DISCORD_PUBLIC_KEY=<ed25519 public key>
DISCORD_CLIENT_SECRET=<oauth secret>
STRIPE_SECRET_KEY=<LIVE sk_live_...>        # JAMAIS committé, jamais en test ici
STRIPE_WEBHOOK_SECRET=<LIVE whsec_...>
STUDIO_OWNER_IDS=<snowflake[,snowflake]>    # propriétaire(s) opérateur(s)
```

## Panel (build-time, Vite)

```
VITE_PLATFORM_PUBLIC_SITE=true    # site public
VITE_PLATFORM_ENTITLEMENTS=true   # espace client
VITE_PLATFORM_BILLING=true        # page facturation
VITE_PLATFORM_SUPPORT=true        # support
VITE_PLATFORM_LAUNCH=true         # affichage prix (en dernier)
```

## Rappels

- **Aucun montant en dur dans le code** : les prix ne vivent que dans `LAUNCH_*`.
- Activer les flags **par cohortes** (M15) avant le global.
- `platform.launch` **en dernier**, après validation prix (D1) + juridique (D21).
