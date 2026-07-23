import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, abortPendingApiRequests, api } from "../src/lib/api.js";
import { checkStartupHealth, createSingleFlightGate } from "../src/lib/bootstrap.js";
import { queryClient, shouldRetryQuery } from "../src/lib/queryClient.js";
import {
  consumeReturnRoute,
  normalizePanelRoute,
  normalizeTelemetryRoute,
  readStoredValue,
  rememberReturnRoute,
  writeStoredValue,
  type StorageLike,
} from "../src/lib/resilience.js";
import { claimRecoveryReload, isChunkLoadError, PanelErrorBoundary } from "../src/ui/error-boundary.js";
import { isValidGuildId } from "../src/pages/GuildLayout.js";
import { claimClientEvent, classifyClientErrorType } from "../src/lib/telemetry.js";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => vi.unstubAllGlobals());

describe("versioned browser state", () => {
  it("keeps valid data and deletes only a corrupt or expired key", () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated", "keep");
    expect(writeStoredValue(storage, "valid", ["modules"], 200)).toBe(true);
    expect(readStoredValue(storage, "valid", (v): v is string[] => Array.isArray(v), 100)).toEqual(["modules"]);
    storage.setItem("broken", "not-json");
    expect(readStoredValue(storage, "broken", (v): v is string => typeof v === "string", 100)).toBeNull();
    expect(storage.getItem("broken")).toBeNull();
    expect(readStoredValue(storage, "valid", (v): v is string[] => Array.isArray(v), 201)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("preserves and consumes only same-origin panel return routes", () => {
    const storage = new MemoryStorage();
    expect(normalizePanelRoute("https://evil.example/app")).toBeNull();
    expect(normalizePanelRoute("/auth/login")).toBeNull();
    expect(rememberReturnRoute("/guilds/12345/modules?tab=x", storage, 100)).toBe(true);
    expect(consumeReturnRoute(storage, 101)).toBe("/guilds/12345/modules?tab=x");
    expect(consumeReturnRoute(storage, 102)).toBeNull();
  });

  it("normalizes identifiers out of telemetry routes", () => {
    expect(normalizeTelemetryRoute("/guilds/123456789012345678/modules")).toBe("/guilds/:guildId/modules");
  });
});

describe("bounded recovery", () => {
  it("claims at most one chunk reload during the guard window", () => {
    const storage = new MemoryStorage();
    expect(claimRecoveryReload(storage, 100_000)).toBe(true);
    expect(claimRecoveryReload(storage, 100_001)).toBe(false);
    expect(claimRecoveryReload(storage, 160_001)).toBe(true);
  });

  it("separates chunk failures from ordinary React failures", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("render exploded"))).toBe(false);
  });

  it("turns startup and page render exceptions into a diagnostic fallback state", () => {
    const startup = PanelErrorBoundary.getDerivedStateFromError(new Error("startup"));
    const page = PanelErrorBoundary.getDerivedStateFromError(new Error("page"));
    expect(startup).toMatchObject({ failed: true, chunk: false });
    expect(page.diagnosticId).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe("bounded frontend telemetry", () => {
  it("uses finite error types and suppresses rapid duplicate events", () => {
    expect(classifyClientErrorType(new TypeError("private detail"))).toBe("type_error");
    expect(classifyClientErrorType("private detail")).toBe("unknown");
    expect(claimClientEvent("chunk_load_failed", 100_000)).toBe(true);
    expect(claimClientEvent("chunk_load_failed", 100_001)).toBe(false);
    expect(claimClientEvent("chunk_load_failed", 105_001)).toBe(true);
  });
});

describe("route guards", () => {
  it("rejects malformed guild IDs before an API request can remain pending", () => {
    expect(isValidGuildId("123456789012345678")).toBe(true);
    expect(isValidGuildId("unknown")).toBe(false);
    expect(isValidGuildId(undefined)).toBe(false);
  });
});

describe("API resilience", () => {
  it("combines caller cancellation with the timeout", async () => {
    vi.stubGlobal("fetch", (_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    const caller = new AbortController();
    const pending = api("/api/guilds", { signal: caller.signal, timeoutMs: 10_000 });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("turns malformed successful JSON into a correlated safe error", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html>", { status: 200, headers: { "x-request-id": "request_123" } })));
    await expect(api("/api/me")).rejects.toMatchObject({ code: "invalid_json_response", requestId: "request_123", category: "invalid_response" });
  });

  it("classifies offline failures and cancels every active request on logout", async () => {
    vi.stubGlobal("fetch", (_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    const first = api("/api/me", { timeoutMs: 10_000 });
    const second = api("/api/guilds", { timeoutMs: 10_000 });
    abortPendingApiRequests();
    await expect(first).rejects.toMatchObject({ code: "network_error" });
    await expect(second).rejects.toMatchObject({ code: "network_error" });
  });

  it("uses an explicit offline code when the browser reports no connection", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("failed")));
    await expect(api("/api/me")).rejects.toMatchObject({ code: "offline", category: "network" });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "internal_error"],
  ])("normalizes HTTP %i responses", async (status, code) => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ error: code }), { status, headers: { "x-request-id": "request_http" } })));
    await expect(api("/api/me")).rejects.toMatchObject({ status, code, requestId: "request_http" });
  });

  it("retries only bounded transient reads, never auth, 429 or unknown failures", () => {
    expect(shouldRetryQuery(0, new ApiError(0, "network_error", undefined, undefined, "r", "network"))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, "unavailable"))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError(503, "unavailable"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(429, "rate_limited", undefined, 5))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(401, "session_expired"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("unknown"))).toBe(false);
  });

  it("signals an expired /api/me session but not a first unauthenticated visit", async () => {
    const dispatched: string[] = [];
    vi.stubGlobal("window", { location: { pathname: "/app" }, dispatchEvent: (event: Event) => dispatched.push(event.type) });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"error":"session_expired"}', { status: 401 })));
    await expect(api("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(dispatched).toEqual(["panel:session-expired"]);
    dispatched.length = 0;
    vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"error":"unauthenticated"}', { status: 401 })));
    await expect(api("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(dispatched).toEqual([]);
  });
});

describe("single-flight actions and retained query state", () => {
  it("accepts only the first login navigation", () => {
    const claim = createSingleFlightGate();
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
  });

  it("never retries mutations and retains cached data across a failed refetch", async () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
    queryClient.setQueryData(["retained"], { value: "old" });
    await expect(queryClient.fetchQuery({ queryKey: ["retained"], staleTime: 0, queryFn: async () => { throw new ApiError(500, "failed"); } })).rejects.toBeInstanceOf(ApiError);
    expect(queryClient.getQueryData(["retained"])).toEqual({ value: "old" });
    queryClient.removeQueries({ queryKey: ["retained"] });
  });
});

describe("startup health", () => {
  it("is non-throwing for success, malformed JSON and network failure", async () => {
    await expect(checkStartupHealth(async () => new Response('{"ok":true,"panelOrigin":"https://staging.example"}') as never, 5_000, "https://staging.example")).resolves.toBe(true);
    await expect(checkStartupHealth(async () => new Response('{"ok":true,"panelOrigin":"https://wrong.example"}') as never, 5_000, "https://staging.example")).resolves.toBe(false);
    await expect(checkStartupHealth(async () => new Response("bad") as never)).resolves.toBe(false);
    await expect(checkStartupHealth(async () => { throw new TypeError("offline"); })).resolves.toBe(false);
  });
});
