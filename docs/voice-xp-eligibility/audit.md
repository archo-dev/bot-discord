# Audit — XP vocale

## Contexte technique

- **Framework** : discord.js `^14.16.3`, Node 22, package `@bot/gateway` sur VPS OVH
  (systemd `botdiscord-gateway`). La gateway lit/écrit exclusivement via `/internal/*`.
- **Emplacement du système de niveaux** :
  - Décision d'éligibilité + tick : `packages/gateway/src/voice-xp.ts`.
  - Attribution (montant/curve/rôles/annonce) : `packages/worker/src/internal/xp.ts`
    (`POST /internal/guilds/:id/voice-xp`), SQL dans `packages/worker/src/db/queries/xp.ts`.
- **Fréquence des ticks** : `setInterval` toutes les **60 s** (`TICK_MS = 60_000`).
- **Écouteurs `voiceStateUpdate`** : `packages/gateway/src/voice.ts` (logs vocaux, M17)
  — **indépendant** de l'XP ; l'XP est purement basée sur un balayage périodique du cache.
- **Stockage de session vocale** : **aucun**. Le tick est sans état ; il lit
  `client.guilds.cache` / `channel.members` à chaque passage.
- **Bots** : filtrés via `member.user.bot`.
- **Salon AFK** : exclu via `channel.id === guild.afkChannelId`.
- **Config module** : `cfg.xp.voiceEnabled` + `isGatewayModuleEnabled(cfg, "levels")`,
  exposés par `GET /internal/guilds/:id/config`.
- **API/DTO** : `WorkerApi.postVoiceXp` (`packages/gateway/src/worker-api.ts`),
  schéma zod `voiceXpSchema` côté worker.
- **Page panel Niveaux** : `packages/panel/src/pages/Levels.tsx` (toggle « XP vocale »,
  `voice_xp_per_min`). Pas de réglage fin d'éligibilité aujourd'hui.
- **Tests existants** : `voice.test.ts`, `voice-observability.test.ts` (logs vocaux),
  `xp.test.ts` (worker). Aucun test dédié au tick d'XP vocale avant ce chantier.

## Ancienne logique (`voice-xp.ts`, avant)

```ts
const humans = channel.members.filter((m) => !m.user.bot);
if (humans.size < 2) continue;                 // « au moins deux personnes »
for (const member of humans.values()) {
  if (member.voice.mute || member.voice.deaf) continue;  // muet/deaf exclus
  entries.push({ userId: member.id, ... });
}
```

Couvrait déjà : bots exclus, salon AFK exclu, muet/deaf (self+serveur) exclus,
module désactivé.

## Bug / farm identifié

Le seuil « ≥ 2 humains » comptait **tous** les humains non-bot, **quel que soit**
leur état muet/sourdine. Donc :

> **A** (actif) + **B** (`selfDeaf`) → `humans.size === 2` ⇒ seuil franchi.
> B est ignoré (deaf), mais **A est crédité** alors qu'aucun autre humain ne
> participe réellement. C'est exactement le cas que la consigne interdit
> (« seul humain éligible dans le salon »).

Vecteur de farm : rester actif en vocal avec un ou plusieurs comparses
muets/en sourdine (ou AFK-non-officiel) suffisait à toucher de l'XP en continu,
sans conversation réelle.

## Nouvelle logique

Le seuil porte désormais sur les **humains _actifs_** (non-bot, non muet, non
sourdine, état valide). Un membre gagne si, et seulement si, lui-même est actif
**et** au moins un autre humain actif partage le salon. Formellement :
`eligibleVoiceXpEarners = { humains actifs dédupés }` si leur nombre ≥ 2, sinon ∅.

Cas de l'exemple : A actif + B deaf ⇒ humains actifs = {A} ⇒ &lt; 2 ⇒ personne. ✅

La logique est extraite dans une fonction pure
`packages/gateway/src/voice-xp-eligibility.ts` avec raisons bornées, permettant
un test exhaustif indépendant de discord.js.

## Décisions

- **Aucune migration** : le comportement est une correction de règle générale ;
  aucune donnée D1, aucun schéma, aucun réglage par serveur n'est nécessaire.
- **Aucun changement Worker/panel** : l'attribution ne change pas ; seule la
  décision d'éligibilité (gateway) est corrigée.
- **Périmètre déploiement** : gateway seule.
