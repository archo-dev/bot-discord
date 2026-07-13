// Budget de bundle (M04). Empêche le JS INITIAL du panel de dépasser la cible.
// « Initial » = le script d'entrée de index.html + ses imports statiques
// (<link rel="modulepreload">) ; les chunks chargés en lazy à la navigation
// ne comptent pas. Échoue (exit 1) au-delà du budget → bloque build et deploy.
//
// Usage : node scripts/check-bundle-budget.mjs  (après `vite build`)
// Override : BUNDLE_BUDGET_GZIP_BYTES=200000 node scripts/check-bundle-budget.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = Number(process.env.BUNDLE_BUDGET_GZIP_BYTES ?? 184_320); // 180 KiB
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const indexPath = join(distDir, "index.html");

if (!existsSync(indexPath)) {
  console.error(`✗ ${indexPath} introuvable — lancez d'abord \`vite build\`.`);
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");

// Script d'entrée + éventuels modulepreload (imports statiques du bundle initial).
const initialJs = new Set();
for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/g)) initialJs.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) initialJs.add(m[1]);

if (initialJs.size === 0) {
  console.error("✗ Aucun script d'entrée trouvé dans index.html — format inattendu.");
  process.exit(1);
}

let totalGzip = 0;
const rows = [];
for (const url of initialJs) {
  const file = join(distDir, url.replace(/^\//, ""));
  if (!existsSync(file)) {
    console.error(`✗ Asset référencé manquant : ${file}`);
    process.exit(1);
  }
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 }).length;
  totalGzip += gz;
  rows.push({ url, raw: raw.length, gzip: gz });
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log("Budget bundle — JS initial (entrée + imports statiques)");
for (const r of rows.sort((a, b) => b.gzip - a.gzip)) {
  console.log(`  ${r.url}  brut ${kb(r.raw)}  gzip ${kb(r.gzip)}`);
}
console.log(`  ─────`);
console.log(`  total gzip ${kb(totalGzip)}  /  budget ${kb(BUDGET)}`);

if (totalGzip > BUDGET) {
  console.error(`\n✗ Budget dépassé : ${kb(totalGzip)} > ${kb(BUDGET)}. Découpez davantage (React.lazy) avant de déployer.`);
  process.exit(1);
}
console.log(`\n✓ Sous le budget (marge ${kb(BUDGET - totalGzip)}).`);
