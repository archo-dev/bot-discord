// Garde-fou des flags BACKEND (Phase 1). Vérifie que wrangler.jsonc déclare
// durablement les bons flags plateforme AVANT un déploiement — de sorte qu'un
// `wrangler deploy` nu (sans --var) reproduise toujours l'état voulu.
//
//   node scripts/verify-worker-flags.mjs <production|staging>
//
// Production (top-level `vars`) : PLATFORM_ENTITLEMENTS/SUPPORT/LAUNCH = "true",
//   PLATFORM_BILLING et PLATFORM_STUDIO ABSENTS (off).
// Staging (env.staging.vars) : PLATFORM_ENTITLEMENTS/SUPPORT/BILLING/STUDIO =
//   "true", PLATFORM_LAUNCH absent.
// Aucune valeur secrète n'est lue ici (uniquement des booléens non secrets).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wranglerPath = join(__dirname, "..", "packages", "worker", "wrangler.jsonc");

const mode = process.argv[2];
if (mode !== "production" && mode !== "staging") {
  console.error(`✗ verify-worker-flags: mode invalide (${mode ?? "rien"})`);
  process.exit(2);
}

const raw = readFileSync(wranglerPath, "utf8");

// Découpe grossière mais sûre : le bloc top-level = tout ce qui précède la clé
// `"env"`. Le bloc staging = l'objet `"staging": { ... }`. On travaille sur le
// texte (présence/absence d'une déclaration de var), robuste aux commentaires.
const envIdx = raw.indexOf('"env"');
const topLevel = envIdx === -1 ? raw : raw.slice(0, envIdx);
const stagingMatch = raw.match(/"staging"\s*:\s*\{/);
const stagingBlock = stagingMatch ? raw.slice(stagingMatch.index) : "";

const isTrue = (block, key) => new RegExp(`"${key}"\\s*:\\s*"true"`).test(block);
const isPresent = (block, key) => new RegExp(`"${key}"\\s*:`).test(block);

const specs = {
  production: {
    block: topLevel,
    label: "top-level (production)",
    on: ["PLATFORM_ENTITLEMENTS", "PLATFORM_SUPPORT", "PLATFORM_LAUNCH"],
    off: ["PLATFORM_BILLING", "PLATFORM_STUDIO"],
  },
  staging: {
    block: stagingBlock,
    label: "env.staging",
    on: ["PLATFORM_ENTITLEMENTS", "PLATFORM_SUPPORT", "PLATFORM_BILLING", "PLATFORM_STUDIO"],
    off: ["PLATFORM_LAUNCH"],
  },
};

const spec = specs[mode];
if (!spec.block) {
  console.error(`✗ verify-worker-flags: bloc ${spec.label} introuvable dans wrangler.jsonc`);
  process.exit(1);
}

const problems = [];
for (const key of spec.on) {
  if (!isTrue(spec.block, key)) problems.push(`${key} doit valoir "true" dans ${spec.label}`);
}
for (const key of spec.off) {
  if (isPresent(spec.block, key)) problems.push(`${key} doit être ABSENT de ${spec.label} (off), mais il est déclaré`);
}

if (problems.length) {
  console.error(`✗ verify-worker-flags [${mode}] — wrangler.jsonc INCOHÉRENT :`);
  for (const p of problems) console.error(`    • ${p}`);
  console.error("  Déploiement refusé.");
  process.exit(1);
}

console.log(
  `✓ verify-worker-flags [${mode}] — ${spec.label}: ON {${spec.on.join(", ")}}, off {${spec.off.join(", ")}}.`,
);
