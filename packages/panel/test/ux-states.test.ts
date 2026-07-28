import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api.js";
import { mutationErrorMessage } from "../src/lib/queryClient.js";
import { AsyncState, safeErrorReference } from "../src/ui/async-state.js";
import { EmptyState, ErrorCard, OperationalState } from "../src/ui/kit.js";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const common = {
  loading: createElement("div", { "data-test": "loading" }),
  children: createElement("div", { "data-test": "content" }),
  errorMessage: "Impossible de charger les rôles.",
  emptyIcon: createElement("span"),
  emptyTitle: "Aucun rôle",
  emptyDescription: "Cette liste est normalement vide tant qu’aucun rôle n’est configuré.",
};

describe("état asynchrone visible", () => {
  it("priorise chargement, erreur, vide puis contenu sans masquer une erreur", () => {
    expect(AsyncState({ ...common, pending: true, error: null, empty: false })).toBe(common.loading);

    const failed = AsyncState({
      ...common,
      pending: false,
      error: new ApiError(503, "unavailable", undefined, undefined, "req-safe"),
      empty: true,
      onRetry: () => undefined,
    });
    expect(isValidElement(failed) && failed.type).toBe(ErrorCard);

    const empty = AsyncState({ ...common, pending: false, error: null, empty: true });
    expect(isValidElement(empty) && empty.type).toBe(EmptyState);

    expect(AsyncState({ ...common, pending: false, error: null, empty: false })).toBe(common.children);
  });

  it("n’expose que la référence de diagnostic sûre", () => {
    expect(safeErrorReference(new ApiError(500, "sql_private_detail", undefined, undefined, "req-42")))
      .toBe("Référence de diagnostic : req-42");
    expect(safeErrorReference(new Error("token=secret"))).toBeUndefined();
  });
});

describe("distinctions opérationnelles", () => {
  it.each(["readonly", "permission", "admin", "gateway", "quota", "module"] as const)(
    "marque explicitement l’état %s",
    (kind) => {
      const state = OperationalState({ kind, title: kind, description: "Description utile" });
      expect(isValidElement(state)).toBe(true);
      expect(state.props["data-ux-state"]).toBe(kind);
      expect(state.props.role).toBe(kind === "permission" || kind === "admin" || kind === "quota" ? "alert" : "status");
    },
  );

  it("distingue réseau, permission et quota dans les mutations globales", () => {
    expect(mutationErrorMessage(new ApiError(0, "network_error", undefined, undefined, "r", "network"))).toContain("Connexion");
    expect(mutationErrorMessage(new ApiError(403, "forbidden"))).toContain("permissions");
    expect(mutationErrorMessage(new ApiError(429, "quota_exceeded"))).toContain("Quota");
  });
});

describe("contrats UX du Lot 6", () => {
  it("garde le brouillon, bloque la navigation et affiche l’erreur dans la SaveBar", () => {
    const savebar = read("../src/ui/savebar.tsx");
    expect(savebar).toContain('window.addEventListener("beforeunload"');
    expect(savebar).toContain("useBlocker");
    expect(savebar).toContain('role={status === "error" ? "alert" : undefined}');
    expect(savebar).toContain('aria-live="polite"');
    expect(savebar).toContain("errorMessage");
    expect(savebar).toContain('status === "pending"');
  });

  it("déduplique les toasts et suspend leur durée au survol comme au focus", () => {
    const toast = read("../src/ui/toast.tsx");
    expect(toast).toContain("const duplicate = items.find");
    expect(toast).toContain("onMouseEnter");
    expect(toast).toContain("onFocus");
    expect(toast).toContain('aria-label="Fermer la notification"');
    expect(toast).not.toContain('aria-live="polite"');
  });

  it("respecte reduced-motion pour les skeletons et les transitions", () => {
    const css = read("../src/index.css");
    expect(css.match(/prefers-reduced-motion:\s*reduce/g)?.length).toBeGreaterThanOrEqual(2);
    expect(css).toContain(".skeleton");
    expect(css).toContain("animation: none");
  });

  it("corrige les lectures silencieuses des pages historiques", () => {
    for (const page of ["Automod", "Levels", "TempVoice", "PanelAccess"]) {
      const source = read(`../src/pages/${page}.tsx`);
      expect(source, page).toContain("<ErrorCard");
      expect(source, page).toContain("refetch()");
    }
  });

  it("neutralise les mutations en lecture seule ou sans prérequis", () => {
    const automod = read("../src/pages/Automod.tsx");
    const levels = read("../src/pages/Levels.tsx");
    const tempVoice = read("../src/pages/TempVoice.tsx");
    const command = read("../src/pages/CommandEditor.tsx");
    expect(automod).toContain("disabled={!canWrite}");
    expect(levels).toContain("disabled={!canWrite}");
    expect(tempVoice).toContain("disabled={!canWrite}");
    expect(command).toContain("disabled={!editorEnabled || quotaReached}");
    expect(command).toContain('kind="permission"');
    expect(command).toContain('kind="quota"');
  });

  it("rend persistantes les erreurs d’import, de preset et de confidentialité", () => {
    for (const page of ["BackupImport", "OnboardingPresets", "Privacy"]) {
      const source = read(`../src/pages/${page}.tsx`);
      expect(source, page).toContain("silentError: true");
      expect(source, page).toContain("<ErrorCard");
    }
  });

  it("préserve les boundaries racine, route, chunk et widget", () => {
    const main = read("../src/main.tsx");
    const app = read("../src/App.tsx");
    const guild = read("../src/pages/GuildLayout.tsx");
    const dashboard = read("../src/pages/Dashboard.tsx");
    expect(main).toContain('zone="root"');
    expect(app).toContain("PanelErrorBoundary");
    expect(guild).toContain("ChunkErrorBoundary");
    expect(dashboard).toContain('zone="widget"');
  });
});
