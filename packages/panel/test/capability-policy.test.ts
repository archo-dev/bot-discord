import { describe, expect, it } from "vitest";
import {
  ADVANCED_MUSIC_COMMANDS,
  capabilityDenialMessageFr,
  capabilityForMusicCommand,
  capabilityForSlashCommand,
  evaluateCapability,
  moduleForCommand,
  parseEnforcementMode,
  PLAN_CAPABILITY_POLICY,
  type CapabilityEnforcementMode,
} from "@bot/shared";

/* Cible @bot/shared : policy d'enforcement des plans — évaluation PURE et
 * déterministe (aucune D1, aucune confiance dans le client). */

function evalCap(args: {
  capability: Parameters<typeof evaluateCapability>[0]["capability"];
  effectivePlan: "free" | "premium" | "business";
  mode?: CapabilityEnforcementMode;
  usage?: number | null;
}) {
  return evaluateCapability({ mode: "shadow", ...args });
}

describe("policy — valeurs produit validées (D-A/D-B/D-C/D-D)", () => {
  it("slots 1/3/5", () => {
    expect(PLAN_CAPABILITY_POLICY["slots.assign"].quota).toEqual({ free: 1, premium: 3, business: 5 });
  });
  it("automatisations 2/10/50", () => {
    expect(PLAN_CAPABILITY_POLICY["automations.active"].quota).toEqual({ free: 2, premium: 10, business: 50 });
  });
  it("commandes personnalisées 5/25/100", () => {
    expect(PLAN_CAPABILITY_POLICY["custom_commands.create"].quota).toEqual({ free: 5, premium: 25, business: 100 });
  });
  it("délégués panel 1/3/10", () => {
    expect(PLAN_CAPABILITY_POLICY["panel_access.delegate"].quota).toEqual({ free: 1, premium: 3, business: 10 });
  });
  it("rétentions logs/stats/audit", () => {
    expect(PLAN_CAPABILITY_POLICY["voice_logs.retention"].quota).toEqual({ free: 7, premium: 30, business: 180 });
    expect(PLAN_CAPABILITY_POLICY["stats.retention"].quota).toEqual({ free: 7, premium: 30, business: 180 });
    expect(PLAN_CAPABILITY_POLICY["audit.retention"].quota).toEqual({ free: 30, premium: 90, business: 365 });
  });
  it("plans requis : musique avancée=Premium, automod IA=Business", () => {
    expect(PLAN_CAPABILITY_POLICY["music.advanced"].requiredPlan).toBe("premium");
    expect(PLAN_CAPABILITY_POLICY["automod.ai"].requiredPlan).toBe("business");
  });
});

describe("évaluation par plan", () => {
  it("11 — capability Free autorisée à tous", () => {
    for (const plan of ["free", "premium", "business"] as const) {
      const d = evalCap({ capability: "moderation.use", effectivePlan: plan });
      expect(d.wouldBlock).toBe(false);
      expect(d.reason).toBe("allowed_by_plan");
    }
  });
  it("12 — capability Premium refusée à Free (would_block)", () => {
    const d = evalCap({ capability: "music.advanced", effectivePlan: "free" });
    expect(d.wouldBlock).toBe(true);
    expect(d.requiredPlan).toBe("premium");
    expect(d.reason).toBe("plan_required");
  });
  it("13 — capability Business refusée à Premium", () => {
    const d = evalCap({ capability: "automod.ai", effectivePlan: "premium" });
    expect(d.wouldBlock).toBe(true);
    expect(d.requiredPlan).toBe("business");
  });
  it("Premium autorise music.advanced", () => {
    expect(evalCap({ capability: "music.advanced", effectivePlan: "premium" }).wouldBlock).toBe(false);
  });
});

describe("modes off / shadow / enforce", () => {
  it("14 — off autorise sans would_block ni raison de refus", () => {
    const d = evaluateCapability({ capability: "music.advanced", effectivePlan: "free", mode: "off" });
    expect(d.allowed).toBe(true);
    expect(d.wouldBlock).toBe(false);
    expect(d.reason).toBe("allowed_by_plan");
  });
  it("15 — shadow autorise MAIS calcule would_block", () => {
    const d = evaluateCapability({ capability: "music.advanced", effectivePlan: "free", mode: "shadow" });
    expect(d.allowed).toBe(true);
    expect(d.wouldBlock).toBe(true);
  });
  it("16 — enforce refuse réellement", () => {
    const d = evaluateCapability({ capability: "music.advanced", effectivePlan: "free", mode: "enforce" });
    expect(d.allowed).toBe(false);
    expect(d.wouldBlock).toBe(true);
  });
  it("enforce autorise quand le plan suffit", () => {
    const d = evaluateCapability({ capability: "music.advanced", effectivePlan: "premium", mode: "enforce" });
    expect(d.allowed).toBe(true);
  });
});

describe("quotas (usage vs plafond)", () => {
  it("17 — sous la limite → autorisé", () => {
    const d = evalCap({ capability: "custom_commands.create", effectivePlan: "free", usage: 4 });
    expect(d.quota).toBe(5);
    expect(d.wouldBlock).toBe(false);
  });
  it("18 — exactement à la limite → bloqué (création du 6e refusée)", () => {
    const d = evalCap({ capability: "custom_commands.create", effectivePlan: "free", usage: 5 });
    expect(d.wouldBlock).toBe(true);
    expect(d.reason).toBe("quota_exceeded");
  });
  it("19 — au-delà de la limite → bloqué", () => {
    const d = evalCap({ capability: "custom_commands.create", effectivePlan: "free", usage: 6 });
    expect(d.wouldBlock).toBe(true);
  });
  it("20/21/23 — plafonds par plan appliqués (slots/automations/délégués)", () => {
    expect(evalCap({ capability: "slots.assign", effectivePlan: "premium", usage: 3 }).wouldBlock).toBe(true);
    expect(evalCap({ capability: "slots.assign", effectivePlan: "business", usage: 4 }).wouldBlock).toBe(false);
    expect(evalCap({ capability: "automations.active", effectivePlan: "premium", usage: 10 }).wouldBlock).toBe(true);
    expect(evalCap({ capability: "automations.active", effectivePlan: "business", usage: 49 }).wouldBlock).toBe(false);
    expect(evalCap({ capability: "panel_access.delegate", effectivePlan: "free", usage: 1 }).wouldBlock).toBe(true);
    expect(evalCap({ capability: "panel_access.delegate", effectivePlan: "business", usage: 9 }).wouldBlock).toBe(false);
  });
});

describe("mapping musique (D-C)", () => {
  it("24 — base Free : play/pause/resume/skip/stop/queue/nowplaying", () => {
    for (const cmd of ["play", "pause", "resume", "skip", "stop", "queue", "nowplaying"] as const) {
      expect(capabilityForMusicCommand(cmd)).toBe("music.use");
    }
  });
  it("25 — avancé Premium : playlists/seek/loop/volume/shuffle/remove", () => {
    for (const cmd of ["playlist_save", "playlist_load", "seek", "loop", "volume", "shuffle", "remove"] as const) {
      expect(ADVANCED_MUSIC_COMMANDS.has(cmd)).toBe(true);
      expect(capabilityForMusicCommand(cmd)).toBe("music.advanced");
    }
  });
  it("slash : play=music.use, seek/playlist=music.advanced ; non-musique via module", () => {
    expect(capabilityForSlashCommand("play", moduleForCommand)).toBe("music.use");
    expect(capabilityForSlashCommand("seek", moduleForCommand)).toBe("music.advanced");
    expect(capabilityForSlashCommand("playlist", moduleForCommand)).toBe("music.advanced");
    expect(capabilityForSlashCommand("ban", moduleForCommand)).toBe("moderation.use");
    expect(capabilityForSlashCommand("rank", moduleForCommand)).toBe("levels.use");
  });
});

describe("déterminisme & robustesse", () => {
  it("26 — même entrée → même décision (parité Worker/Gateway)", () => {
    const a = evaluateCapability({ capability: "automations.active", effectivePlan: "free", mode: "enforce", usage: 2 });
    const b = evaluateCapability({ capability: "automations.active", effectivePlan: "free", mode: "enforce", usage: 2 });
    expect(a).toEqual(b);
  });
  it("27 — mode absent/invalide → off (fail-safe, aucun plan depuis le client)", () => {
    expect(parseEnforcementMode(undefined)).toBe("off");
    expect(parseEnforcementMode("ENFORCE")).toBe("off");
    expect(parseEnforcementMode("true")).toBe("off");
    expect(parseEnforcementMode("shadow")).toBe("shadow");
    expect(parseEnforcementMode("enforce")).toBe("enforce");
  });
});

describe("messages de refus (UX, billing OFF)", () => {
  it("plan requis", () => {
    const d = evaluateCapability({ capability: "music.advanced", effectivePlan: "free", mode: "enforce" });
    expect(capabilityDenialMessageFr(d)).toContain("Premium");
    expect(capabilityDenialMessageFr(d)).toContain("Free");
  });
  it("quota atteint", () => {
    const d = evaluateCapability({ capability: "custom_commands.create", effectivePlan: "free", mode: "enforce", usage: 5 });
    expect(capabilityDenialMessageFr(d)).toContain("5/5");
    expect(capabilityDenialMessageFr(d)).toContain("commandes personnalisées");
  });
});
