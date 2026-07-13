import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "../src/ui/error-boundary.js";

/*
 * Détection des échecs de chargement de chunk (M04). Le boundary ne doit
 * recharger automatiquement QUE pour ces erreurs, pas pour une erreur métier.
 */
describe("isChunkLoadError", () => {
  it("recognises the browser dynamic-import failure messages", () => {
    const messages = [
      "Failed to fetch dynamically imported module: https://x/assets/Stats-abc.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "'chunkLoadError' something",
    ];
    for (const m of messages) expect(isChunkLoadError(new Error(m))).toBe(true);
    const named = new Error("boom");
    named.name = "ChunkLoadError";
    expect(isChunkLoadError(named)).toBe(true);
  });

  it("does not treat ordinary errors (or non-errors) as chunk failures", () => {
    expect(isChunkLoadError(new Error("Network response was 500"))).toBe(false);
    expect(isChunkLoadError(new TypeError("cannot read property x of undefined"))).toBe(false);
    expect(isChunkLoadError("some string")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
