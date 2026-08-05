# Rapport de déploiement — XP vocale anti-farm

**Date** : 2026-08-05 · **Périmètre** : Gateway uniquement (VPS OVH).

## Décision de sécurité (candidat isolé)

`master` contient ~943 lignes de code gateway/shared **enforcement** (capability-policy,
plan-capabilities, enforcement.ts…) **délibérément non déployées en production**
(prod gateway = branche « correctif-seul » `hotfix/gateway-config-cache-prod` @ `8d87638`).

Un `git pull master` aurait donc embarqué du backend non validé → interdit (§13/§18).
Candidat construit en **worktree isolé** à partir du commit exact de prod :

```
git worktree add -b deploy/voice-xp-antifarm ... 8d87638
git cherry-pick f91dc10        # uniquement le chantier
git diff 8d87638 HEAD          # → exactement 8 fichiers du chantier, ZÉRO enforcement
```

Candidat : `43e22718f`. Diff vs prod = README/audit/test-results + `voice-xp.ts`,
`voice-xp-eligibility.ts`, `observability.ts`, 2 tests. Rien d'autre.

## Validation du candidat (worktree isolé)

- `pnpm --filter @bot/gateway check` → OK
- `pnpm --filter @bot/gateway build` → **249.97 KB** (vs 257 KB sur master : l'écart
  confirme l'absence d'enforcement)
- `pnpm --filter @bot/gateway test` → **287 tests verts** (31 fichiers), dont les 47 du chantier

## Déploiement

```
git bundle create botdiscord-voicexp.bundle deploy/voice-xp-antifarm
scp → VPS ; git fetch <bundle> deploy/voice-xp-antifarm ; git merge --ff-only
pnpm install --filter @bot/gateway --filter @bot/shared
pnpm --filter @bot/gateway build ; sudo systemctl restart botdiscord-gateway
```

- **BEFORE** `8d87638` → **AFTER** `43e22718f` (fast-forward, aucun merge commit).
- Build VPS : `dist/index.js 249.97 KB` — Build success.
- `systemctl is-active` → **active**.

## Contrôles post-déploiement

| Cible | État |
|---|---|
| Gateway service | `active` |
| Log de démarrage | `gateway ready as Archodev#1241 (2 guilds)` |
| Réconciliation | `guild cache reconciliation complete (2 synced, 0 failed)` |
| tempvoice | `0 salon(s) rechargé(s)` (OK) |
| Erreurs post-restart | aucune |
| Musique | `music_voice_transition` sains (ready) |
| Logs vocaux | `voice_log_sent` OK |
| Worker `/` | HTTP 200 |
| Worker `/interactions` | HTTP 401 (Ed25519 rejette non signé = endpoint vivant) |
| D1 / KV / OAuth | servis par le worker (inchangé, up) |
| Enforcement | **inchangé** — toujours absent de la prod gateway |

## Rollback

Prod avant déploiement = build de `8d87638`. En cas de problème :

```
ssh ubuntu@164.132.98.139 "cd ~/botdiscord && git reset --hard 8d87638 \
  && pnpm --filter @bot/gateway build && sudo systemctl restart botdiscord-gateway"
```

(Composant unique concerné : la gateway. Worker/D1/KV/Studio/billing non touchés.)

## Limites connues

- La décision est ré-évaluée par tick de 60 s : une fenêtre d'inéligibilité en
  cours de minute n'accorde rien pour cette minute (pas de proratisation
  intra-minute — conforme au modèle historique à montant fixe).
- La règle est générale (pas de réglage par serveur) : décision produit assumée (§5).
