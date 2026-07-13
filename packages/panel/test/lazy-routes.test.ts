import { describe, expect, it } from "vitest";

/*
 * Filet de sécurité du code-splitting (M04). `React.lazy` mappe l'export nommé
 * de chaque page vers `default` : une faute de frappe dans ce nom NE casse PAS
 * le build (l'import dynamique résout), mais fait planter la route au runtime
 * (« element type is invalid »). Ce test importe chaque page découpée
 * exactement comme App.tsx et vérifie que le composant attendu existe et est
 * bien une fonction — pour les 18 routes lazy, y compris après reload direct.
 */

const lazyRoutes: Array<{ path: string; load: () => Promise<Record<string, unknown>>; name: string }> = [
  { path: "Config", name: "ConfigPage", load: () => import("../src/pages/Config.js") },
  { path: "Commands", name: "CommandsPage", load: () => import("../src/pages/Commands.js") },
  { path: "CommandEditor", name: "CommandEditorPage", load: () => import("../src/pages/CommandEditor.js") },
  { path: "ModLog", name: "ModLogPage", load: () => import("../src/pages/ModLog.js") },
  { path: "VoiceLog", name: "VoiceLogPage", load: () => import("../src/pages/VoiceLog.js") },
  { path: "Stats", name: "StatsPage", load: () => import("../src/pages/Stats.js") },
  { path: "PanelAccess", name: "PanelAccessPage", load: () => import("../src/pages/PanelAccess.js") },
  { path: "Tickets", name: "TicketsPage", load: () => import("../src/pages/Tickets.js") },
  { path: "Roles", name: "RolesPage", load: () => import("../src/pages/Roles.js") },
  { path: "Welcome", name: "WelcomePage", load: () => import("../src/pages/Welcome.js") },
  { path: "Automod", name: "AutomodPage", load: () => import("../src/pages/Automod.js") },
  { path: "Levels", name: "LevelsPage", load: () => import("../src/pages/Levels.js") },
  { path: "Starboard", name: "StarboardPage", load: () => import("../src/pages/Starboard.js") },
  { path: "TempVoice", name: "TempVoicePage", load: () => import("../src/pages/TempVoice.js") },
  { path: "Music", name: "MusicPage", load: () => import("../src/pages/Music.js") },
  { path: "Health", name: "HealthPage", load: () => import("../src/pages/Health.js") },
  { path: "Audit", name: "AuditPage", load: () => import("../src/pages/Audit.js") },
  { path: "Modules", name: "ModulesPage", load: () => import("../src/pages/Modules.js") },
];

describe("lazy route chunks", () => {
  it.each(lazyRoutes)("$path exposes $name as a component", async ({ load, name }) => {
    const mod = await load();
    expect(typeof mod[name]).toBe("function");
  });
});
