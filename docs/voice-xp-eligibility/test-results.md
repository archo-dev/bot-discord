# Résultats des tests

## Commandes exécutées

```
pnpm -r check                      # typecheck 6 packages → tous OK
pnpm --filter @bot/gateway test    # 32 fichiers, 290 tests → tous verts
pnpm --filter @bot/gateway build   # tsup → Build success (257 KB)
git diff --check                   # propre (aucun conflit/espace)
```

Tests ciblés du chantier :

```
pnpm --filter @bot/gateway exec vitest run voice-xp
→ Test Files 2 passed (2) — Tests 47 passed (47)
   • test/voice-xp-eligibility.test.ts (fonction pure)
   • test/voice-xp.test.ts (tick, timers simulés)
```

## Couverture — `voice-xp-eligibility.test.ts`

**Éligible** : 2 humains actifs · 3 humains actifs · bot supplémentaire sans impact.

**Non éligible** : seul (`ALONE`) · uniquement un bot (`BOTS_ONLY`) · `selfMute` ·
`selfDeaf` · `serverMute` · `serverDeaf` · salon AFK · module désactivé
(`LEVELS_DISABLED`) · mal configuré (`LEVELS_MISCONFIGURED`) · bot
(`USER_IS_BOT`) · non connecté (`NOT_IN_VOICE`) · guild absente
(`MISSING_GUILD`) · membre absent (`MISSING_MEMBER`) · état incomplet
(`GATEWAY_STATE_INCOMPLETE`).

**Exemple de la consigne** : A actif + B deaf → A = `ALONE`, B = `SELF_DEAFENED`.

**Transitions** (ré-évaluation par instantané) : unmute relance · undeaf relance ·
second humain rejoint/quitte · second humain se mute/deaf · passage AFK.

**Cas défensifs** : doublon de membre (compté une fois, clé = ID) · doublon deaf
sans effet · membre au state invalide ignoré · target absent de la liste des
membres · cohérence `eligibleVoiceXpEarners` ↔ `isEligibleForVoiceXp`.

## Couverture — `voice-xp.test.ts` (parcours réel §9)

Membre seul → 0 XP · deux actifs → les deux · membre + bot → 0 · A + B deaf → 0 ·
un membre se mute → les autres seuls exclus · trois humains dont un serverMute →
les deux actifs · salon AFK → 0 · module désactivé → 0 · voice XP désactivé → 0 ·
config absente → 0 sans crash · serverDeaf exclut le membre concerné.

## Non-régression

L'intégralité de la suite gateway (290 tests, dont logs vocaux, musique, session
watchdog, enforcement) reste verte. Aucun test existant modifié, supprimé ou ignoré.
