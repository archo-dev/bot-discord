import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("listes Commandes et Automatisations (Lot 5C)", () => {
  const commands = readSource("../src/pages/Commands.tsx");
  const automations = readSource("../src/pages/Automations.tsx");

  it("rend recherche, filtres, tableau desktop et cartes mobiles", () => {
    for (const source of [commands, automations]) {
      expect(source).toContain("<Input");
      expect(source).toContain("<table");
      expect(source).toContain("md:hidden");
      expect(source).toContain("hidden overflow-hidden");
      expect(source).toContain("filtered");
      expect(source).toContain("<EmptyState");
      expect(source).toContain("<ErrorCard");
    }
  });

  it("préserve les seules mutations réelles de la liste Commandes", () => {
    expect(commands.match(/method:\s*"PATCH"/g)).toHaveLength(1);
    expect(commands.match(/method:\s*"DELETE"/g)).toHaveLength(1);
    expect(commands).not.toMatch(/method:\s*"(POST|PUT)"/);
    expect(commands).toContain("COMMAND_LIMIT = 80");
    expect(commands).toContain("gatewayRequired");
    expect(commands).not.toContain("Dupliquer");
  });

  it("préserve activation, duplication, import, export et suppression des Automatisations", () => {
    for (const fragment of ["/state", "/duplicate", "/import", "/import/validate", "/export"]) {
      expect(automations).toContain(fragment);
    }
    expect(automations.match(/method:\s*"PATCH"/g)).toHaveLength(1);
    expect(automations.match(/method:\s*"DELETE"/g)).toHaveLength(1);
    expect(automations).toContain("Dupliquer");
    expect(automations).toContain("Exporter");
  });

  it("affiche lecture seule, permission, Gateway, module et quotas sans enforcement frontend inventé", () => {
    for (const source of [commands, automations]) {
      expect(source).toContain("Lecture seule");
      expect(source).toContain("Permission insuffisante");
      expect(source).toContain("Gateway indisponible");
      expect(source).toContain("Module désactivé");
    }
    expect(automations).toContain("le serveur reste autoritaire");
  });
});

describe("éditeurs client protégés (Lot 5C)", () => {
  const command = readSource("../src/pages/CommandEditor.tsx");
  const automation = readSource("../src/pages/AutomationEditor.tsx");
  const condition = readSource("../src/pages/command-editor/ConditionRow.tsx");
  const action = readSource("../src/pages/command-editor/ActionRow.tsx");
  const commandPreview = readSource("../src/components/previews/CommandPreview.tsx");
  const workspace = readSource("../src/components/editors/EditorWorkspace.tsx");

  it("utilise une baseline, useDirty, SaveBar et la garde de navigation commune", () => {
    for (const source of [command, automation]) {
      expect(source).toContain("baseline");
      expect(source).toContain("useDirty");
      expect(source).toContain("<SaveBar");
      expect(source).toContain("Le brouillon est conservé");
      expect(source).toContain("showWhenClean");
      expect(source).not.toContain("toast.success");
    }
  });

  it("préserve les contrats POST/PUT des deux éditeurs", () => {
    expect(command.match(/method:\s*isEditing \? "PUT" : "POST"/g)).toHaveLength(1);
    expect(automation.match(/method:\s*isEditing \? "PUT" : "POST"/g)).toHaveLength(1);
    expect(command).not.toMatch(/method:\s*"(PATCH|DELETE)"/);
    expect(automation).not.toMatch(/method:\s*"(PATCH|DELETE)"/);
  });

  it("compose un éditeur responsive et un résumé local sans réseau", () => {
    for (const source of [command, automation]) {
      expect(source).toContain("<EditorWorkspace");
      expect(source).toContain("<FlowSummary");
    }
    expect(workspace).toContain("lg:grid-cols-12");
    expect(commandPreview).not.toMatch(/\b(api|fetch|useQuery|useMutation)\b/);
    expect(commandPreview).toContain("Démonstration locale");
    expect(commandPreview).not.toContain("dangerouslySetInnerHTML");
  });

  it("nomme les déplacements, annonce l’ordre et conserve les limites historiques", () => {
    expect(condition).toContain("Monter la condition");
    expect(condition).toContain("Descendre la condition");
    expect(action).toContain("Monter l’action");
    expect(action).toContain("Descendre l’action");
    expect(command).toContain('aria-live="polite"');
    expect(automation).toContain('aria-live="polite"');
    expect(command).toContain("/10");
    expect(command).toContain("/4");
    expect(automation).toContain("/20");
    expect(automation).toContain("/5");
  });

  it("lie validation locale, résumé global et erreurs serveur françaises", () => {
    for (const source of [command, automation]) {
      expect(source).toContain("validation-summary");
      expect(source).toContain('role="alert"');
      expect(source).toContain("blockingErrors");
      expect(source).toContain("Permission insuffisante");
    }
  });

  it("ne contient ni drag-and-drop ni référence au Developer Studio", () => {
    for (const source of [command, automation, condition, action]) {
      expect(source).not.toMatch(/dnd|dragAndDrop|draggable/i);
      expect(source).not.toContain("Developer Studio");
    }
  });
});
