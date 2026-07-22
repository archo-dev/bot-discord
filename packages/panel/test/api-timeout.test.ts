import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/lib/api.js";

/*
 * Garde-fou anti « chargement infini » (fix production) : une requête réseau qui
 * ne répond jamais (edge injoignable, connexion suspendue) ne doit PAS laisser
 * une query TanStack en attente perpétuelle. `api()` borne chaque fetch avec un
 * AbortSignal.timeout ⇒ la promesse rejette au lieu de pendre indéfiniment, ce
 * qui fait basculer la query en état d'erreur (écran récupérable, pas un spinner
 * éternel). Ces tests pilotent un fetch simulé pour vérifier le comportement.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api() request timeout", () => {
  it("rejette une requête qui ne répond jamais, au lieu de pendre pour toujours", async () => {
    // fetch simulé : ne résout jamais, mais respecte l'abort du signal fourni.
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    });

    await expect(api("/api/me", { timeoutMs: 10 })).rejects.toBeTruthy();
  });

  it("laisse passer une réponse rapide sans déclencher le timeout", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    await expect(api<{ ok: boolean }>("/api/me", { timeoutMs: 10_000 })).resolves.toEqual({ ok: true });
  });

  it("préserve la sémantique ApiError sur réponse non-ok (le timeout n'interfère pas)", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 })),
    );

    await expect(api("/api/whatever")).rejects.toBeInstanceOf(ApiError);
  });
});
