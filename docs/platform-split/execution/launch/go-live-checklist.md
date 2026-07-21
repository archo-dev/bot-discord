# Checklist go-live — Plateforme SaaS Archodev

> À cocher intégralement avant `platform.launch` on. Rien de ceci n'est exécuté en M16.

## Technique

- [ ] `master == origin/master`, tree propre, `pnpm -r check` vert.
- [ ] `pnpm --filter @bot/worker test` vert (suites par lots — piège loopback Windows).
- [ ] Build panel **≤ 180 KiB gzip** ; build `@bot/developer-studio` OK.
- [ ] `wrangler deploy --dry-run` OK.
- [ ] Migrations `0032`→`0039` appliquées en remote (`migrate:remote`).
- [ ] Secrets prod posés via `wrangler secret bulk` (fichier supprimé après).
- [ ] `/status` vert (Worker/Gateway/D1/KV).
- [ ] Rollout par cohortes testé (pilotes → général) + rollback flag vérifié.
- [ ] `STUDIO_HOST` + `STUDIO_OWNER_IDS` définis ; Studio 404 sur domaine client.

## Commercial

- [ ] Prix (D1) fixés et injectés (`LAUNCH_*`) ; `/api/pricing` affiche les montants.
- [ ] Plan mis en avant (Premium) validé sur `/pricing`.
- [ ] Périodicité (D2) mensuel/annuel cohérente avec la config prestataire.
- [ ] Prestataire (D3) en mode **live** (clés live hors dépôt).

## Juridique / conformité

- [ ] CGV (`/legal/sales`), mentions légales, confidentialité **validées par un avocat** (D21).
- [ ] Politique de remboursement (D12) écrite et intégrée aux CGV.
- [ ] TVA / facturation (D20) opérationnelles selon D3.
- [ ] Rétention (D18) documentée ; purge via cron `23 4 * * *` (jamais manuelle non auditée).

## Sécurité

- [ ] `paid` non révocable par le workflow grants (garde backend vérifiée).
- [ ] Lifetime : permission + saisie `LIFETIME` + step-up + audit.
- [ ] Audit `audit_events` append-only ; PII masquée ; `ip_hash`.
- [ ] Origin/CSRF + `sameSite=Strict` studio ; rate-limits actifs.
- [ ] Revue de sécurité ciblée (escalade client→studio, intra-studio, replay, fuite inter-guilde).

## Go / No-Go

- [ ] Dossier d'autorisation **signé** par le propriétaire.
- [ ] `platform.launch` on **en dernier**, après tout ce qui précède.
