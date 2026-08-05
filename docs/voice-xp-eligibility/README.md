# XP vocale anti-farm — éligibilité

Empêche un membre de gagner de l'XP vocale lorsqu'il n'y a pas de vraie
conversation autour de lui. La décision « qui gagne » vit désormais dans une
fonction pure et testable, `packages/gateway/src/voice-xp-eligibility.ts`.

## Règle métier

Un membre gagne de l'XP vocale **uniquement** si **toutes** ces conditions sont vraies :

- il est connecté à un salon vocal ;
- il n'est pas un bot ;
- `selfMute === false` et `serverMute === false` ;
- `selfDeaf === false` et `serverDeaf === false` ;
- le salon n'est **pas** le salon AFK du serveur ;
- le module Niveaux est actif **et** l'XP vocale est activée ;
- **au moins un autre humain _actif_** partage le salon (non-bot, non muet, non
  sourdine, état valide).

Un humain muet / en sourdine / au state invalide / un bot **ne compte pas** comme
partenaire de conversation. Conséquence directe (exemple de la consigne) :

> A (non-muet) + B (`selfDeaf`) → A **ne gagne rien** (aucun autre humain actif),
> B non plus (`SELF_DEAFENED`).

Dès qu'un autre humain redevient actif (unmute/undeaf/arrivée), les membres
concernés regagnent de l'XP **au prochain tick** — sans rattrapage rétroactif.

## Raisons bornées (`VoiceXpReason`)

`ELIGIBLE`, `NOT_IN_VOICE`, `USER_IS_BOT`, `SELF_MUTED`, `SELF_DEAFENED`,
`SERVER_MUTED`, `SERVER_DEAFENED`, `ALONE`, `BOTS_ONLY`, `AFK_CHANNEL`,
`LEVELS_DISABLED`, `LEVELS_MISCONFIGURED`, `MISSING_GUILD`, `MISSING_MEMBER`,
`GATEWAY_STATE_INCOMPLETE`.

- `ALONE` : aucun autre humain actif (le(s) autre(s) sont muet/deaf, ou salon vide).
- `BOTS_ONLY` : le salon ne contient que ce membre et des bots.

## API

```ts
// Décision complète par membre (canonique, exhaustivement testée) :
isEligibleForVoiceXp(target, ctx): { eligible, reason, diagnostics }

// Règle par salon utilisée par le tick (efficace, dédupée par ID) :
eligibleVoiceXpEarners(channelMembers): string[]   // ⩾ 2 humains actifs → tous ; sinon []
```

Les deux partagent `selfIneligibility` / `isActiveHuman` : elles s'accordent par
construction (test de cohérence dédié).

## Modèle temporel

Approche **A** (tick court + validation à chaque tick), inchangée : un montant
fixe (`voice_xp_per_min`) est accordé **une fois par minute**, désormais
conditionné à l'éligibilité. La décision est **sans état** et recalculée à chaque
tick sur l'instantané live :

- aucune XP rétroactive pour une minute muet/deaf/seul ;
- aucun double comptage (dédup par ID Discord) ;
- aucune session fantôme, aucun gain après déconnexion ;
- reprise correcte après unmute/undeaf, changement de salon, redémarrage gateway ;
- ordre d'événements indifférent (chaque tick relit l'état courant) ;
- plafonds / multiplicateurs / cooldowns Worker-side préservés (aucun changement worker).

## Périmètre

- **Gateway uniquement.** Le Worker décide toujours des montants ; il n'a pas
  changé. Aucune migration, aucune nouvelle configuration, aucun changement de panel.
- La protection est appliquée comme **règle générale sûre** à tous les serveurs
  (décision recommandée §5 de la consigne : pas de config par serveur, pas de
  migration risquée).

## Fichiers

- `packages/gateway/src/voice-xp-eligibility.ts` — fonction pure (nouveau).
- `packages/gateway/src/voice-xp.ts` — tick réécrit pour l'utiliser + agrégat d'observabilité.
- `packages/gateway/src/observability.ts` — event borné `voice_xp_tick`.
- `packages/gateway/test/voice-xp-eligibility.test.ts` — tests unitaires.
- `packages/gateway/test/voice-xp.test.ts` — tests d'intégration du tick.

Voir [`audit.md`](audit.md), [`test-results.md`](test-results.md),
[`deployment-report.md`](deployment-report.md).
