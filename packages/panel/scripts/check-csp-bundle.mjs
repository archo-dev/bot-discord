import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "dist", "assets");
const violations = [];
for (const file of readdirSync(assets).filter((name) => name.endsWith(".js"))) {
  const source = readFileSync(join(assets, file), "utf8");
  if (/(?:^|[^\w$.])eval\s*\(/.test(source)) violations.push(`${file}: eval()`);
  if (/new\s+Function\s*\(/.test(source)) violations.push(`${file}: new Function()`);
}
if (violations.length > 0) {
  console.error(`CSP bundle check failed:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("✓ CSP bundle: no eval() or new Function()");
