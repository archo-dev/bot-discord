import { describe, expect, it } from "vitest";
import {
  eligibleVoiceXpEarners,
  isActiveHuman,
  isEligibleForVoiceXp,
  selfIneligibility,
  type VoiceMemberState,
  type VoiceXpContext,
} from "../src/voice-xp-eligibility.js";

const CH = "100000000000000200";
const AFK = "100000000000000999";

function member(userId: string, over: Partial<VoiceMemberState> = {}): VoiceMemberState {
  return { userId, isBot: false, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, ...over };
}

function ctx(over: Partial<VoiceXpContext> = {}): VoiceXpContext {
  return {
    levelsEnabled: true,
    levelsConfigured: true,
    afkChannelId: AFK,
    channelId: CH,
    channelMembers: [],
    ...over,
  };
}

/** Convenience: put `target` in a channel with the given others and decide. */
function decide(target: VoiceMemberState, others: VoiceMemberState[], over: Partial<VoiceXpContext> = {}) {
  return isEligibleForVoiceXp(target, ctx({ channelMembers: [target, ...others], ...over }));
}

describe("selfIneligibility / isActiveHuman", () => {
  it("an unmuted human is active", () => {
    expect(selfIneligibility(member("1"))).toBeNull();
    expect(isActiveHuman(member("1"))).toBe(true);
  });
  it("prioritises server over self flags but both block", () => {
    expect(selfIneligibility(member("1", { serverMute: true, selfDeaf: true }))).toBe("SERVER_MUTED");
    expect(selfIneligibility(member("1", { selfMute: true }))).toBe("SELF_MUTED");
    expect(selfIneligibility(member("1", { selfDeaf: true }))).toBe("SELF_DEAFENED");
    expect(selfIneligibility(member("1", { serverDeaf: true }))).toBe("SERVER_DEAFENED");
    expect(selfIneligibility(member("1", { isBot: true }))).toBe("USER_IS_BOT");
  });
  it("a member in an invalid state is not active", () => {
    expect(isActiveHuman(null)).toBe(false);
    expect(isActiveHuman({ userId: "" } as unknown as VoiceMemberState)).toBe(false);
  });
});

describe("isEligibleForVoiceXp — éligible", () => {
  it("two unmuted humans → both eligible", () => {
    const a = member("1");
    const b = member("2");
    expect(decide(a, [b]).reason).toBe("ELIGIBLE");
    expect(decide(b, [a]).eligible).toBe(true);
  });
  it("three active humans → all eligible", () => {
    const a = member("1");
    const r = decide(a, [member("2"), member("3")]);
    expect(r.eligible).toBe(true);
    expect(r.diagnostics.activeHumans).toBe(3);
  });
  it("an extra bot does not change eligibility", () => {
    const a = member("1");
    const r = decide(a, [member("2"), member("3", { isBot: true })]);
    expect(r.eligible).toBe(true);
    expect(r.diagnostics.bots).toBe(1);
  });
});

describe("isEligibleForVoiceXp — non éligible (self)", () => {
  it("alone → ALONE", () => {
    expect(decide(member("1"), []).reason).toBe("ALONE");
  });
  it("only a bot → BOTS_ONLY", () => {
    expect(decide(member("1"), [member("2", { isBot: true })]).reason).toBe("BOTS_ONLY");
  });
  it("selfMute → SELF_MUTED (even with an active partner)", () => {
    expect(decide(member("1", { selfMute: true }), [member("2")]).reason).toBe("SELF_MUTED");
  });
  it("selfDeaf → SELF_DEAFENED", () => {
    expect(decide(member("1", { selfDeaf: true }), [member("2")]).reason).toBe("SELF_DEAFENED");
  });
  it("serverMute → SERVER_MUTED", () => {
    expect(decide(member("1", { serverMute: true }), [member("2")]).reason).toBe("SERVER_MUTED");
  });
  it("serverDeaf → SERVER_DEAFENED", () => {
    expect(decide(member("1", { serverDeaf: true }), [member("2")]).reason).toBe("SERVER_DEAFENED");
  });
  it("in the AFK channel → AFK_CHANNEL", () => {
    expect(decide(member("1"), [member("2")], { channelId: AFK }).reason).toBe("AFK_CHANNEL");
  });
  it("levels module disabled → LEVELS_DISABLED", () => {
    expect(decide(member("1"), [member("2")], { levelsEnabled: false }).reason).toBe("LEVELS_DISABLED");
  });
  it("levels misconfigured → LEVELS_MISCONFIGURED", () => {
    expect(decide(member("1"), [member("2")], { levelsConfigured: false }).reason).toBe("LEVELS_MISCONFIGURED");
  });
  it("target is a bot → USER_IS_BOT", () => {
    expect(decide(member("1", { isBot: true }), [member("2")]).reason).toBe("USER_IS_BOT");
  });
  it("not connected → NOT_IN_VOICE", () => {
    expect(isEligibleForVoiceXp(member("1"), ctx({ channelId: null })).reason).toBe("NOT_IN_VOICE");
  });
  it("missing guild config → MISSING_GUILD", () => {
    expect(isEligibleForVoiceXp(member("1"), null).reason).toBe("MISSING_GUILD");
  });
  it("missing member → MISSING_MEMBER", () => {
    expect(isEligibleForVoiceXp(null, ctx()).reason).toBe("MISSING_MEMBER");
    expect(isEligibleForVoiceXp(undefined, ctx()).reason).toBe("MISSING_MEMBER");
  });
  it("incomplete gateway state → GATEWAY_STATE_INCOMPLETE", () => {
    expect(isEligibleForVoiceXp({ userId: "" } as unknown as VoiceMemberState, ctx()).reason).toBe("GATEWAY_STATE_INCOMPLETE");
  });
});

describe("règle du membre seul (exemple de la consigne)", () => {
  // A non-muté/non-deaf + B selfDeaf → A n'a AUCUN autre humain actif → ALONE.
  it("A actif + B deaf : A n'est pas éligible (seul humain actif)", () => {
    const a = member("A");
    const b = member("B", { selfDeaf: true });
    expect(decide(a, [b]).reason).toBe("ALONE");
    expect(decide(b, [a]).reason).toBe("SELF_DEAFENED");
  });
});

describe("cas défensifs", () => {
  it("un doublon de membre n'est compté qu'une fois (IDs comme clé)", () => {
    const a = member("1");
    const dup = member("2");
    // Deux entrées pour le MÊME id "2" ne doivent pas fabriquer un partenaire.
    const r = isEligibleForVoiceXp(a, ctx({ channelMembers: [a, member("1"), dup, member("2")] }));
    expect(r.eligible).toBe(true);
    expect(r.diagnostics.otherHumans).toBe(1);
  });
  it("un doublon deaf ne crée pas d'éligibilité", () => {
    const a = member("1");
    const r = isEligibleForVoiceXp(a, ctx({ channelMembers: [a, member("2", { selfDeaf: true }), member("2", { selfDeaf: true })] }));
    expect(r.reason).toBe("ALONE");
  });
  it("des membres au state invalide sont ignorés", () => {
    const a = member("1");
    const bad = { userId: "3" } as unknown as VoiceMemberState;
    const r = isEligibleForVoiceXp(a, ctx({ channelMembers: [a, bad] }));
    expect(r.reason).toBe("ALONE");
  });
  it("le target absent de la liste des membres reste évaluable", () => {
    const a = member("1");
    // Le target n'apparaît pas dans channelMembers (cache partiel) : un autre
    // humain actif suffit à le rendre éligible.
    const r = isEligibleForVoiceXp(a, ctx({ channelMembers: [member("2")] }));
    expect(r.eligible).toBe(true);
  });
});

describe("eligibleVoiceXpEarners (règle par salon)", () => {
  it("deux humains actifs → les deux gagnent", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2")]).sort()).toEqual(["1", "2"]);
  });
  it("un actif + un deaf → personne", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2", { selfDeaf: true })])).toEqual([]);
  });
  it("un actif + un bot → personne", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2", { isBot: true })])).toEqual([]);
  });
  it("dédupe par ID (pas de double comptage)", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("1")])).toEqual([]);
  });
  it("trois actifs → les trois gagnent", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2"), member("3")]).length).toBe(3);
  });
  it("cohérent avec isEligibleForVoiceXp", () => {
    const members = [member("1"), member("2"), member("3", { selfMute: true }), member("4", { isBot: true })];
    const earners = new Set(eligibleVoiceXpEarners(members));
    for (const m of members) {
      const r = isEligibleForVoiceXp(m, ctx({ channelMembers: members }));
      expect(r.eligible).toBe(earners.has(m.userId));
    }
  });
});

// Les "transitions" sont sans état : elles se réduisent à ré-évaluer la règle
// pure sur le nouvel instantané. On vérifie que chaque transition bascule bien
// l'éligibilité comme attendu (unmute relance, second humain rejoint/part, etc.).
describe("transitions vocales (ré-évaluation par instantané)", () => {
  it("unmute relance l'éligibilité des deux membres", () => {
    const a = member("1");
    const bMuted = member("2", { selfMute: true });
    expect(eligibleVoiceXpEarners([a, bMuted])).toEqual([]); // avant unmute
    const bLive = member("2");
    expect(eligibleVoiceXpEarners([a, bLive]).sort()).toEqual(["1", "2"]); // après unmute
  });
  it("undeaf relance l'éligibilité", () => {
    const a = member("1");
    expect(eligibleVoiceXpEarners([a, member("2", { selfDeaf: true })])).toEqual([]);
    expect(eligibleVoiceXpEarners([a, member("2")]).length).toBe(2);
  });
  it("le second humain quitte → l'unique restant redevient seul", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2")]).length).toBe(2);
    expect(eligibleVoiceXpEarners([member("1")])).toEqual([]);
  });
  it("le second humain se mute → plus personne", () => {
    expect(eligibleVoiceXpEarners([member("1"), member("2", { selfMute: true })])).toEqual([]);
  });
  it("changement vers le salon AFK → aucune éligibilité", () => {
    expect(decide(member("1"), [member("2")], { channelId: AFK }).eligible).toBe(false);
  });
});
