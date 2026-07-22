// Garde-fou anti-déploiement incohérent (Phase 1). Relit le bundle FRONTEND
// réellement produit et prouve que les flags de plateforme bakés correspondent
// EXACTEMENT à platform-flags.json[mode]. Échoue (exit 1) sinon — appelé par
// scripts/build.mjs avant tout déploiement.
//
//   node scripts/verify-flags.mjs <production|staging>
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");

const mode = process.argv[2];
if (mode !== "production" && mode !== "staging") {
  console.error(`✗ verify-flags: mode invalide (${mode ?? "rien"})`);
  process.exit(2);
}

const expected = JSON.parse(readFileSync(join(pkgRoot, "platform-flags.json"), "utf8"))[mode];
const VITE_KEYS = {
  publicSite: "VITE_PLATFORM_PUBLIC_SITE",
  entitlements: "VITE_PLATFORM_ENTITLEMENTS",
  support: "VITE_PLATFORM_SUPPORT",
  launch: "VITE_PLATFORM_LAUNCH",
  billing: "VITE_PLATFORM_BILLING",
};

const assetsDir = join(pkgRoot, "dist", "assets");
const entry = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
if (!entry) {
  console.error("✗ verify-flags: bundle d'entrée dist/assets/index-*.js introuvable (build manquant ?)");
  process.exit(1);
}
const js = readFileSync(join(assetsDir, entry), "utf8");

// Vite inline import.meta.env en objet littéral : seule la valeur bakée "true"
// active un flag ; "false" (ou une clé absente) reste off.
const bakedOn = (viteKey) => new RegExp(`${viteKey}:"true"`).test(js);

const problems = [];
for (const [flag, viteKey] of Object.entries(VITE_KEYS)) {
  const want = expected[flag] === true;
  const got = bakedOn(viteKey);
  if (want !== got) problems.push(`${flag} (${viteKey}) attendu=${want ? "ON" : "off"} bundle=${got ? "ON" : "off"}`);
}

if (problems.length) {
  console.error(`✗ verify-flags [${mode}] — bundle ${entry} INCOHÉRENT :`);
  for (const p of problems) console.error(`    • ${p}`);
  console.error("  Déploiement refusé. Rebuild via `pnpm --filter @bot/panel build" + (mode === "staging" ? ":staging" : "") + "`.");
  process.exit(1);
}

const on = Object.entries(VITE_KEYS)
  .filter(([f]) => expected[f] === true)
  .map(([f]) => f)
  .join(", ");
console.log(`✓ verify-flags [${mode}] — bundle ${entry} cohérent (ON: ${on || "aucun"}).`);
