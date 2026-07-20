import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import type { ReleaseNoteDetail, ReleaseNotesListResponse } from "@bot/shared";
import app from "../src/index.js";
import { insertReleaseNote } from "../src/db/queries.js";

// D1/KV roll back between tests (vitest-pool-workers) → every test seeds its own
// data. No fetchMock here: these are pure D1 + HTTP reads.

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

async function get(path: string): Promise<Response> {
  return app.request(path, { method: "GET" }, env, createExecutionContext());
}

async function published(slug: string, extra: Record<string, unknown> = {}): Promise<void> {
  await insertReleaseNote(env.DB, {
    slug,
    title: `Title ${slug}`,
    status: "published",
    publishedAt: PAST,
    ...extra,
  });
}

describe("M5 public release notes API", () => {
  it("serves a published note in list and detail with derived fields", async () => {
    await published("v1-0-0", {
      version: "1.0.0",
      summary: "First release",
      bodyMd: "# Hello",
      moduleTags: ["music", "automod"],
      sections: [
        { type: "new", items: ["Music player"] },
        { type: "fixed", items: ["Crash on join"] },
      ],
    });

    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.slug).toBe("v1-0-0");
    expect(list.items[0]!.version).toBe("1.0.0");
    expect(list.items[0]!.moduleTags).toEqual(["music", "automod"]);
    // Canonical order: new before fixed.
    expect(list.items[0]!.changeTypes).toEqual(["new", "fixed"]);
    expect(list.modules).toEqual(["automod", "music"]);

    const detailRes = await get("/api/updates/v1-0-0");
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as ReleaseNoteDetail;
    expect(detail.bodyMd).toBe("# Hello");
    expect(detail.sections).toHaveLength(2);
  });

  it("never exposes internal columns", async () => {
    await published("clean", { author: "operator:123", version: "2.0" });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    const summary = list.items[0]!;
    expect(Object.keys(summary).sort()).toEqual(
      ["changeTypes", "moduleTags", "publishedAt", "slug", "summary", "title", "version"].sort(),
    );
    const detail = (await (await get("/api/updates/clean")).json()) as Record<string, unknown>;
    for (const forbidden of ["author", "status", "publish_at", "publishAt", "audience", "created_at", "id"]) {
      expect(detail).not.toHaveProperty(forbidden);
    }
  });

  it("hides drafts (absent from list, 404 on slug)", async () => {
    await insertReleaseNote(env.DB, { slug: "draft-note", title: "Draft", status: "draft" });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(0);
    expect((await get("/api/updates/draft-note")).status).toBe(404);
  });

  it("hides scheduled notes", async () => {
    await insertReleaseNote(env.DB, {
      slug: "sched", title: "Scheduled", status: "scheduled", publishAt: FUTURE,
    });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(0);
    expect((await get("/api/updates/sched")).status).toBe(404);
  });

  it("hides notes published in the future", async () => {
    await published("future", { publishedAt: FUTURE });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(0);
    expect((await get("/api/updates/future")).status).toBe(404);
  });

  it("hides archived notes", async () => {
    await insertReleaseNote(env.DB, {
      slug: "old", title: "Archived", status: "archived", publishedAt: PAST,
    });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(0);
    expect((await get("/api/updates/old")).status).toBe(404);
  });

  it("hides plan-targeted notes from the public surface", async () => {
    await published("premium-only", { audience: "plan:premium" });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.total).toBe(0);
    expect((await get("/api/updates/premium-only")).status).toBe(404);
  });

  it("returns 404 for an unknown slug", async () => {
    expect((await get("/api/updates/does-not-exist")).status).toBe(404);
  });

  it("paginates with an exact total and bounded page size", async () => {
    for (let i = 0; i < 3; i++) {
      await published(`note-${i}`, { publishedAt: `2021-0${i + 1}-01T00:00:00.000Z` });
    }
    const page1 = (await (await get("/api/updates?pageSize=2&page=1")).json()) as ReleaseNotesListResponse;
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    // Newest first: note-2 (March) precedes note-1 (Feb).
    expect(page1.items[0]!.slug).toBe("note-2");
    const page2 = (await (await get("/api/updates?pageSize=2&page=2")).json()) as ReleaseNotesListResponse;
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.slug).toBe("note-0");
  });

  it("rejects a malformed module filter but allows unknown valid ones", async () => {
    await published("tagged", { moduleTags: ["music"] });
    // Uppercase / spaces / punctuation → invalid form.
    expect((await get("/api/updates?module=Music!")).status).toBe(400);
    expect((await get("/api/updates?pageSize=999")).status).toBe(400);
    // Well-formed but not present → empty, never 500.
    const unknown = (await (await get("/api/updates?module=nonexistent")).json()) as ReleaseNotesListResponse;
    expect(unknown.total).toBe(0);
    // Present tag filters correctly and avoids substring collisions.
    const hit = (await (await get("/api/updates?module=music")).json()) as ReleaseNotesListResponse;
    expect(hit.total).toBe(1);
  });

  it("filters by module without substring collisions", async () => {
    await published("a", { moduleTags: ["mod"] });
    await published("b", { moduleTags: ["moderation"] });
    const mod = (await (await get("/api/updates?module=mod")).json()) as ReleaseNotesListResponse;
    expect(mod.total).toBe(1);
    expect(mod.items[0]!.slug).toBe("a");
  });

  it("aggregates distinct module tags of published notes only", async () => {
    await published("p1", { moduleTags: ["music", "xp"] });
    await published("p2", { moduleTags: ["music", "tickets"] });
    await insertReleaseNote(env.DB, {
      slug: "d1", title: "Draft", status: "draft", moduleTags: ["secret-module"],
    });
    const list = (await (await get("/api/updates")).json()) as ReleaseNotesListResponse;
    expect(list.modules).toEqual(["music", "tickets", "xp"]);
  });
});
