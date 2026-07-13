import { defineConfig } from "tsup";
import { execFileSync } from "node:child_process";

const buildVersion = process.env.GATEWAY_VERSION?.trim() || execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
  encoding: "utf8",
}).trim();

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  define: {
    "process.env.GATEWAY_BUILD_VERSION": JSON.stringify(buildVersion),
  },
  // @bot/shared ships raw TypeScript (exports ./src/index.ts): it must be
  // bundled into dist, Node cannot resolve it at runtime.
  noExternal: ["@bot/shared"],
});
