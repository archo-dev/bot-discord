import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression tests for the persistent pnpm patch on @distube/yt-dlp@2.0.1.
 *
 * The unpatched plugin merged yt-dlp's stderr into the stdout buffer and then
 * `JSON.parse`d it inside the child's `close` handler. Any stderr line — e.g.
 * the "--no-call-home is deprecated" notice — threw an uncaught SyntaxError,
 * which crashed the gateway (systemd restart). The patch:
 *   1. keeps stdout and stderr in separate buffers,
 *   2. wraps JSON.parse in try/catch and rejects (never throws) on bad JSON,
 *   3. rejects with stderr-first detail on a non-zero exit,
 *   4. drops the deprecated noCallHome flag.
 *
 * We exercise the REAL patched `json()` end to end: YTDLP_PATH is pointed at
 * Node's own binary and the fake-ytdlp fixture is passed as the "url", so a
 * genuine child process streams controlled stdout/stderr and exits with a
 * chosen code. No real yt-dlp, no YouTube, no network.
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-ytdlp.mjs", import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let json: (url: string, flags?: any, options?: any) => Promise<any>;

beforeAll(async () => {
  // Read at module-load time by the plugin, so set before importing it.
  process.env.YTDLP_DIR = path.dirname(process.execPath);
  process.env.YTDLP_FILENAME = path.basename(process.execPath);
  const mod: any = await import("@distube/yt-dlp");
  json = mod.json ?? mod.default?.json;
  expect(typeof json).toBe("function");
});

/** Runs the real json() against the fake binary with steered output. */
function run(opts: { stdout?: string; stderr?: string; exit?: number }) {
  return json(
    FIXTURE,
    {},
    {
      env: {
        ...process.env,
        FAKE_STDOUT: opts.stdout ?? "",
        FAKE_STDERR: opts.stderr ?? "",
        FAKE_EXIT: String(opts.exit ?? 0),
      },
    },
  );
}

const DEPRECATION_NOTICE =
  "Deprecated Feature: The following options have been deprecated: --no-call-home\n";

describe("@distube/yt-dlp json() — patched stream handling", () => {
  it("valid JSON on stdout + empty stderr → resolves with the parsed object", async () => {
    await expect(run({ stdout: '{"id":"abc","title":"ok"}' })).resolves.toEqual({
      id: "abc",
      title: "ok",
    });
  });

  it("valid JSON on stdout + deprecation notice on stderr → resolves (no crash)", async () => {
    // The exact scenario that crashed the gateway before the patch.
    await expect(
      run({ stdout: '{"id":"abc","title":"ok"}', stderr: DEPRECATION_NOTICE }),
    ).resolves.toEqual({ id: "abc", title: "ok" });
  });

  it("invalid stdout + exit 0 → rejects (promise rejection, not a throw)", async () => {
    const p = run({ stdout: "Deprecated Feature: not json at all", exit: 0 });
    await expect(p).rejects.toThrow(/not valid JSON/i);
  });

  it("non-zero exit → rejects with stderr prioritised over stdout", async () => {
    const p = run({ stdout: "partial stdout", stderr: "ERROR: video unavailable", exit: 1 });
    await expect(p).rejects.toThrow(/exited 1/i);
    await expect(p).rejects.toThrow(/video unavailable/i);
    // stderr is preserved on the error for the plugin's `${e.stderr || e}` path.
    await p.catch((e: any) => expect(e.stderr).toContain("video unavailable"));
  });

  it("error message is clipped/cleaned and does not dump the whole output", async () => {
    const huge = "x".repeat(5000);
    const p = run({ stdout: huge, exit: 0 });
    await p.catch((e: Error) => {
      expect(e.message).toMatch(/truncated/);
      expect(e.message.length).toBeLessThan(700);
    });
    await expect(p).rejects.toBeInstanceOf(Error);
  });
});

describe("@distube/yt-dlp json() — no process-level escape", () => {
  const onUncaught = vi.fn();
  const onUnhandled = vi.fn();

  beforeAll(() => {
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);
  });
  afterAll(() => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    onUncaught.mockClear();
    onUnhandled.mockClear();
  });

  it("stderr notice + valid JSON never triggers uncaughtException/unhandledRejection", async () => {
    await run({ stdout: '{"ok":true}', stderr: DEPRECATION_NOTICE });
    // Let any stray microtask/rejection surface.
    await new Promise((r) => setTimeout(r, 20));
    expect(onUncaught).not.toHaveBeenCalled();
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it("bad JSON is a handled rejection, not an uncaughtException", async () => {
    await run({ stdout: "totally not json" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(onUncaught).not.toHaveBeenCalled();
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});
