import { describe, expect, it, vi } from "vitest";
import { withHardTimeout } from "../src/worker-api.js";

/*
 * Borne dure transport (07-26). Garantit qu'aucun appel interne ne peut pendre
 * indéfiniment même si l'AbortSignal d'undici n'abort pas un socket mort : la
 * course rejette au plus tard à l'échéance, l'erreur est visible et bornée, et le
 * fetch abandonné ne produit pas d'unhandledRejection.
 */
describe("withHardTimeout — borne dure transport", () => {
  it("passe la valeur quand la promesse se règle à temps", async () => {
    await expect(withHardTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("propage un rejet normal (ex. 500/erreur réseau) sans le masquer", async () => {
    await expect(withHardTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("rejette avec une erreur bornée quand la promesse pend au-delà de l'échéance", async () => {
    const never = new Promise<never>(() => {}); // ne se règle jamais (socket mort)
    await expect(withHardTimeout(never, 20)).rejects.toThrow(/hard timeout/);
  });

  it("n'émet pas d'unhandledRejection quand le fetch abandonné rejette tard", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      let rejectLate!: (e: unknown) => void;
      const late = new Promise<never>((_, reject) => { rejectLate = reject; });
      await expect(withHardTimeout(late, 20)).rejects.toThrow(/hard timeout/);
      rejectLate(new Error("late socket death")); // arrive après l'abandon
      await new Promise((r) => setTimeout(r, 30));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
