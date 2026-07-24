import { describe, expect, it } from "vitest";
import { SessionWatchdog, type WatchdogConfig } from "../src/session-watchdog.js";

// Compact deterministic config (ms) for readable timelines.
const CONFIG: WatchdogConfig = {
  readyGraceMs: 1_000,
  applicativeSilenceMs: 5_000,
  resumeWindowMs: 60_000,
  resumeLoopThreshold: 2,
  heartbeatStaleMs: 3_000,
};

describe("SessionWatchdog — détection zombie RESUME", () => {
  it("détecte une boucle de RESUME sans dispatch applicatif (transport frais)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(2_000);
    w.onResume(4_000);
    w.onHeartbeat(9_000); // transport frais
    const d = w.evaluate(9_000);
    expect(d.kind).toBe("zombie");
    if (d.kind === "zombie") {
      expect(d.reason).toBe("resume_loop");
      expect(d.resumesInWindow).toBe(2);
      expect(d.applicativeSilenceMs).toBe(9_000);
    }
  });

  it("ignore READY et RESUMED comme activité métier (régression incident 07-23)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(2_000);
    w.onResume(4_000);
    w.onDispatch("RESUMED", 5_000); // ne doit PAS réarmer le silence
    w.onDispatch("READY", 6_000); // idem
    w.onHeartbeat(9_000);
    expect(w.evaluate(9_000).kind).toBe("zombie");
  });

  it("reste sain quand un RESUME est suivi de vrais événements", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(2_000);
    w.onResume(4_000);
    w.onDispatch("MESSAGE_CREATE", 5_000); // purge les RESUME, réarme l'activité
    w.onHeartbeat(9_000);
    expect(w.evaluate(9_000).kind).toBe("healthy");
  });

  it("ne redémarre pas un serveur simplement calme (silence sans boucle de RESUME)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onHeartbeat(9_000);
    // Silence > seuil mais aucun RESUME → inactivité légitime.
    expect(w.evaluate(9_000).kind).toBe("quiet");
  });

  it("un seul RESUME ne suffit pas (sous le seuil de boucle)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(3_000);
    w.onHeartbeat(9_000);
    expect(w.evaluate(9_000).kind).toBe("quiet");
  });

  it("applique un délai de grâce après READY (démarrage récent)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(100);
    w.onResume(200);
    w.onHeartbeat(500);
    expect(w.evaluate(500).kind).toBe("starting"); // 500 < readyGraceMs
  });

  it("laisse discord.js gérer un transport réellement mort (heartbeat périmé)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(2_000);
    w.onResume(4_000);
    w.onHeartbeat(1_000); // dernier heartbeat ancien
    // 9000 - 1000 = 8000 > heartbeatStaleMs → on n'auto-restart pas (évite de
    // lutter contre une vraie panne Discord globale).
    expect(w.evaluate(9_000).kind).toBe("transport_down");
  });

  it("ne demande le restart qu'une fois, puis se réarme sur une session fraîche (anti-boucle)", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(2_000);
    w.onResume(4_000);
    w.onHeartbeat(9_000);
    expect(w.evaluate(9_000).kind).toBe("zombie");
    // Verrouillé : plus de nouvelle demande dans le même process.
    w.onHeartbeat(9_100);
    expect(w.evaluate(9_100).kind).toBe("healthy");
    // Après un restart systemd → READY frais → grâce à nouveau, pas de rafale.
    w.onReady(20_000);
    w.onHeartbeat(20_000);
    expect(w.evaluate(20_500).kind).toBe("starting");
  });

  it("purge les RESUME hors fenêtre glissante", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onResume(1_000); // hors fenêtre au moment de l'évaluation
    w.onResume(2_000);
    w.onHeartbeat(70_000);
    // 70_000 - resumeWindowMs(60_000) = 10_000 : seuls les RESUME > 10_000 comptent → 0.
    expect(w.evaluate(70_000).kind).toBe("quiet");
    expect(w.snapshot(70_000).resumesInWindow).toBe(0);
  });

  it("suit séparément le dernier messageCreate et le dernier voiceStateUpdate", () => {
    const w = new SessionWatchdog(CONFIG);
    w.onReady(0);
    w.onDispatch("MESSAGE_CREATE", 1_000);
    w.onDispatch("VOICE_STATE_UPDATE", 2_000);
    const s = w.snapshot(3_000);
    expect(s.sinceLastMessageMs).toBe(2_000);
    expect(s.sinceLastVoiceMs).toBe(1_000);
    expect(s.transportFresh).toBe(false); // aucun heartbeat émis
  });
});
