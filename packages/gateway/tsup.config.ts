import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // @bot/shared ships raw TypeScript (exports ./src/index.ts): it must be
  // bundled into dist, Node cannot resolve it at runtime.
  noExternal: ["@bot/shared"],
});
