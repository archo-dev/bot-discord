# Runbook go-live — Plateforme SaaS Archodev

> ⚠️ **Procédure documentée — NON exécutée en M16.** À dérouler uniquement après signature du [dossier d'autorisation](./authorization-dossier.md). Chaque étape est **additive et réversible**. Respecter les pièges `CLAUDE.md`.

## Pré-vol

- [ ] Décisions D1/D3/D12/D18/D20/D21/D17 tranchées ; brouillons juridiques **validés**.
- [ ] `master == origin/master`, working tree propre, `pnpm -r check` + tests verts.
- [ ] Preview locale validée (rollout, kill-switch, revert flag).

## Étape 1 — Migrations D1 (additif)

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:APPDATA\npm;$env:Path"
pnpm run migrate:remote   # applique 0032 → 0039 (jamais destructif)
```
Rollback : migrations additives → aucune suppression ; en cas de souci, ne pas « dé-migrer » (désactiver l'usage par flag).

## Étape 2 — Secrets prod (jamais en clair, jamais via `secret put` sous PowerShell)

```powershell
# Rédiger un fichier JSON temporaire (hors dépôt) puis :
wrangler secret bulk .\secrets.prod.json
Remove-Item .\secrets.prod.json -Force   # supprimer immédiatement
```
Secrets : `SESSION_SECRET`, `INTERNAL_API_TOKEN`, `DISCORD_*`, `STRIPE_SECRET_KEY` (**live**), `STRIPE_WEBHOOK_SECRET` (**live**), `STUDIO_SESSION_GLOBAL_VERSION`, `STUDIO_OWNER_IDS`. **Piège CRLF** : jamais `Write-Output "x" | wrangler secret put` (→ 401 Ed25519).

## Étape 3 — Variables de config (non secrètes)

`LAUNCH_CURRENCY`, `LAUNCH_PRICE_PREMIUM_MONTH/_YEAR`, `LAUNCH_PRICE_BUSINESS_MONTH/_YEAR`, `BILLING_PROVIDER`, `BILLING_PRICE_*`, `STUDIO_HOST`, `PANEL_ORIGIN`. Voir [config-templates.md](./config-templates.md).

## Étape 4 — Déploiement Worker + panel

```powershell
pnpm --filter @bot/worker run deploy   # TOUJOURS `run` (pnpm 10)
```
Rollback : re-deploy de la version précédente (Cloudflare garde l'historique).

## Étape 5 — Studio (déploiement séparé, domaine distinct)

- Router `studio.archodev.fr` vers le Worker studio ; définir `STUDIO_HOST`, `STUDIO_OWNER_IDS`.
- Rollback : ne pas router `studio.archodev.fr` → Studio injoignable, zéro impact client. `STUDIO_KILL_SWITCH=true` en coupe-circuit.

## Étape 6 — Gateway (si mise à jour requise)

`git bundle` + scp vers le VPS OVH + `systemctl restart botdiscord-gateway` (recette `roadmap.md`). Aucun secret Discord modifié sans nécessité.

## Étape 7 — Activation progressive (M15 rollout par cohortes)

Pour chaque flag (`platform.entitlements`, puis `platform.billing`, `platform.support`, `platform.studio`, enfin `platform.launch`) :
1. `PUT /studio-api/rollout/<flag>` avec 1–3 **guildes pilotes** (sans redeploy).
2. Smoke tests sur les pilotes.
3. Élargir la cohorte → général (flag global on) uniquement après validation.
Rollback : retirer la cohorte / flag global off (instantané).

## Étape 8 — Smoke tests prod (voir `12-testing-and-release-strategy.md` §9)

- `/status` vert ; login client + Studio (cookies séparés) ; `/api/subscription` ; `/updates` ; webhook test → `paid` idempotent ; `/api/pricing` affiche les prix ; **aucune** route studio sur le domaine client.

## Étape 9 — Lancement commercial

- `platform.launch` on **seulement** après prix (D1) + juridique validés.
- Vérifier un premier achat de bout en bout (d'abord sandbox, puis 1 achat live contrôlé).

## Rollback global

| Niveau | Moyen |
|--------|-------|
| Fonctionnel | Bascule de flag off / retrait de cohorte / `STUDIO_KILL_SWITCH` |
| Code | `git revert` du merge de milestone |
| Déploiement | Re-deploy version précédente |
| Données | Migrations additives → désactiver l'usage, jamais supprimer |
