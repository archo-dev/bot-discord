import { describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import app from "../src/index.js";
import { browserFamily } from "../src/telemetry/frontend.js";

const LOCAL = { ...env, PANEL_ORIGIN: "http://localhost:5173", SECURITY_ORIGIN_MODE: "enforce" as const };

describe("frontend resilience endpoint", () => {
  it("accepts only a bounded same-origin event and logs no extra data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await app.request("/telemetry/frontend", {
      method: "POST",
      headers: { origin: LOCAL.PANEL_ORIGIN, "content-type": "application/json", "user-agent": "Mozilla Chrome/130" },
      body: JSON.stringify({
        event: "chunk_load_failed",
        diagnosticId: "diagnostic_123",
        category: "chunk",
        buildVersion: "abc123",
        route: "/guilds/:guildId/modules",
        zone: "modules",
      }),
    }, LOCAL, createExecutionContext());
    expect(response.status).toBe(204);
    const line = String(warn.mock.calls.find(([value]) => String(value).includes("chunk_load_failed"))?.[0]);
    expect(line).toContain('"browser":"chrome"');
    expect(line).not.toContain("cookie");
    warn.mockRestore();
  });

  it("rejects foreign origins, unknown fields and oversized payloads", async () => {
    const valid = { event: "app_boot_failed", diagnosticId: "diagnostic_123", category: "boot", buildVersion: "abc", route: "/" };
    expect((await app.request("/telemetry/frontend", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify(valid) }, LOCAL, createExecutionContext())).status).toBe(403);
    expect((await app.request("/telemetry/frontend", { method: "POST", headers: { origin: LOCAL.PANEL_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ ...valid, secret: "forbidden" }) }, LOCAL, createExecutionContext())).status).toBe(400);
    expect((await app.request("/telemetry/frontend", { method: "POST", headers: { origin: LOCAL.PANEL_ORIGIN, "content-type": "application/json" }, body: "x".repeat(5 * 1024) }, LOCAL, createExecutionContext())).status).toBe(413);
  });

  it("reduces user agents to a finite browser family", () => {
    expect(browserFamily("Mozilla Edg/130 Chrome/130")).toBe("edge");
    expect(browserFamily("Mozilla Firefox/130")).toBe("firefox");
    expect(browserFamily("private custom agent")).toBe("other");
  });
});

describe("SPA deployment recovery", () => {
  const assetEnv = {
    ...LOCAL,
    ASSETS: {
      fetch: async (request: Request) => {
        const pathname = new URL(request.url).pathname;
        return new Response(pathname === "/index.html" ? "<!doctype html><div id=root></div>" : "<!doctype html>fallback", {
          headers: { "content-type": "text/html" },
        });
      },
    } as Fetcher,
  };

  it("serves deep panel routes and browser /status as non-cacheable HTML", async () => {
    for (const path of ["/app/subscription", "/guilds/123456789012345678/modules", "/status"]) {
      const response = await app.request(path, { headers: { accept: "text/html" } }, assetEnv, createExecutionContext());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("keeps /status JSON for monitors and never serves HTML for a deleted chunk", async () => {
    const status = await app.request("/status", { headers: { accept: "application/json" } }, assetEnv, createExecutionContext());
    expect(status.headers.get("content-type")).toContain("application/json");
    const missing = await app.request("/assets/deleted-hash.js", {}, assetEnv, createExecutionContext());
    expect(missing.status).toBe(404);
  });
});
