import { describe, expect, it, vi } from "vitest";
import { reconcileInstalledGuilds } from "../src/guild-lifecycle.js";

describe("Gateway guild cache reconciliation", () => {
  it("persists guilds already present when READY is received", async () => {
    const postGuildInstalled = vi.fn(async () => undefined);
    const result = await reconcileInstalledGuilds([
      { id: "100000000000000001", name: "Staging one", icon: null },
      { id: "100000000000000002", name: "Staging two", icon: "icon-hash" },
    ], { postGuildInstalled });

    expect(postGuildInstalled).toHaveBeenCalledTimes(2);
    expect(postGuildInstalled).toHaveBeenCalledWith("100000000000000001", { name: "Staging one", icon: null });
    expect(result).toEqual({ synced: 2, failed: 0 });
  });

  it("continues reconciling when one guild write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const postGuildInstalled = vi.fn(async (id: string) => {
      if (id.endsWith("1")) throw new Error("worker unavailable");
    });

    await expect(reconcileInstalledGuilds([
      { id: "100000000000000001", name: "Failed", icon: null },
      { id: "100000000000000002", name: "Synced", icon: null },
    ], { postGuildInstalled })).resolves.toEqual({ synced: 1, failed: 1 });
    expect(postGuildInstalled).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
