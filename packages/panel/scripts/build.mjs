// Orchestrateur de build FRONTEND sûr et reproductible (Phase 1 — persistance des flags).
//
//   node scripts/build.mjs <production|staging>
//
// Injecte EXACTEMENT les flags de platform-flags.json[mode] dans le bundle
// (via process.env.VITE_*, que Vite expose au build), lance `vite build --mode
// <mode>`, vérifie le budget, puis relit le bundle produit pour prouver que les
// flags bakés correspondent (verify-flags.mjs). Un déploiement passant par
// `deploy:production` / `deploy:staging` ne peut donc pas embarquer des flags
// frontend incohérents. Cross-plateforme (aucun `VAR=x cmd` shell).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build as viteBuild } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");

const mode = process.argv[2];
if (mode !== "production" && mode !== "staging") {
  console.error(`✗ Usage: node scripts/build.mjs <production|staging> (reçu: ${mode ?? "rien"})`);
  process.exit(2);
}

const flags = JSON.parse(readFileSync(join(pkgRoot, "platform-flags.json"), "utf8"))[mode];

// Mapping canonique flag → variable Vite. Les deux états sont injectés
// explicitement pour que les fichiers .env locaux (ignorés par Git) ne puissent
// pas contredire platform-flags.json. Le panel n'active qu'une valeur === "true".
const VITE_KEYS = {
  publicSite: "VITE_PLATFORM_PUBLIC_SITE",
  entitlements: "VITE_PLATFORM_ENTITLEMENTS",
  support: "VITE_PLATFORM_SUPPORT",
  launch: "VITE_PLATFORM_LAUNCH",
  billing: "VITE_PLATFORM_BILLING",
};

const previousEnv = new Map();
const summary = [];
for (const [flag, viteKey] of Object.entries(VITE_KEYS)) {
  previousEnv.set(viteKey, process.env[viteKey]);
  process.env[viteKey] = flags[flag] === true ? "true" : "false";
  summary.push(`${flag}=${flags[flag] === true ? "ON" : "off"}`);
}

console.log(`▶ build panel [${mode}] — flags frontend : ${summary.join("  ")}`);

try {
  await viteBuild({
    root: pkgRoot,
    mode,
  });
} finally {
  for (const [viteKey, previousValue] of previousEnv) {
    if (previousValue === undefined) delete process.env[viteKey];
    else process.env[viteKey] = previousValue;
  }
}

await import("./check-bundle-budget.mjs");
await import("./verify-flags.mjs");
