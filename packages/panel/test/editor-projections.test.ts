import { describe, expect, it } from "vitest";
import type {
  AutomationCatalogDto,
  AutomationWorkflowDto,
  ChannelOption,
  CustomCommandDto,
  RoleOption,
} from "@bot/shared";
import {
  buildCommandSummary,
  buildLogic,
  emptyForm,
  hydrate,
  moveItem,
  validateCommandDraft,
} from "../src/pages/command-editor/logic.js";
import {
  buildAutomationFlowSummary,
  createEmptyAutomationWorkflow,
  moveAutomationItem,
  toAutomationInput,
  validateAutomationDraft,
} from "../src/pages/automation-editor/logic.js";

const roles: RoleOption[] = [
  { id: "444444444444444444", name: "Membre", color: 0, position: 1, managed: false },
  { id: "555555555555555555", name: "Modérateur", color: 0, position: 2, managed: false },
];
const channels: ChannelOption[] = [
  { id: "111111111111111111", name: "général", type: 0, position: 1 },
  { id: "222222222222222222", name: "annonces", type: 0, position: 2 },
];
const validCommand = {
  ...structuredClone(emptyForm),
  name: "annonce",
  description: "Publie une annonce.",
  replyContent: "Annonce envoyée.",
};
const catalog = {
  schemaVersion: 1,
  triggers: [
    { id: "message_create", name: "Message créé", description: "Message.", version: 1, category: "messages", requiredPermissions: [], configFields: [] },
  ],
  conditions: [
    { id: "user_has_role", name: "Possède le rôle", description: "Rôle.", version: 1, category: "members", requiredPermissions: [], configFields: [{ key: "roleId", label: "Rôle", type: "role", required: true }] },
  ],
  actions: [
    { id: "send_message", name: "Envoyer un message", description: "Message.", version: 1, category: "messages", requiredPermissions: ["send_messages"], configFields: [{ key: "content", label: "Message", type: "textarea", required: true }] },
    { id: "wait", name: "Attendre", description: "Pause.", version: 1, category: "flow", requiredPermissions: [], configFields: [{ key: "seconds", label: "Secondes", type: "number", required: true }] },
  ],
  variables: ["user.name"],
} as AutomationCatalogDto;

describe("brouillon de commande personnalisée (Lot 5C)", () => {
  it("valide localement l’identité et la présence d’une action", () => {
    expect(validateCommandDraft(structuredClone(emptyForm))).toMatchObject({
      valid: false,
      fieldErrors: {
        name: "Le nom est obligatoire.",
        description: "La description est obligatoire.",
        response: "Ajoutez une réponse, un embed renseigné ou une action.",
      },
    });
    expect(validateCommandDraft(validCommand).valid).toBe(true);
  });

  it("valide les règles documentées des mots-clés, compteurs et webhooks", () => {
    const invalid = {
      ...validCommand,
      triggerType: "keyword" as const,
      keywords: "",
      conditions: [{ type: "counter_compare" as const, counter: "INVALIDE", op: "gte" as const, value: 1 }],
      extraActions: [{ type: "call_webhook" as const, url: "http://localhost", method: "POST" as const, includeContext: true }],
    };
    const result = validateCommandDraft(invalid);
    expect(result.fieldErrors.keywords).toContain("mot-clé");
    expect(result.conditionErrors[0]).toContain("minuscules");
    expect(result.actionErrors[0]).toContain("HTTPS publique");
    expect(result.warnings).toContain("Le déclencheur par mot-clé nécessite la Gateway.");
  });

  it("préserve exactement l’ordre des conditions et actions dans le payload", () => {
    const form = {
      ...validCommand,
      conditions: [
        { type: "channel_is" as const, channelId: channels[0]!.id },
        { type: "user_has_role" as const, roleId: roles[0]!.id },
      ],
      extraActions: [
        { type: "add_role" as const, roleId: roles[0]!.id },
        { type: "send_message" as const, channelId: channels[1]!.id, content: "Texte" },
      ],
    };
    const movedConditions = moveItem(form.conditions, 1, -1);
    const movedActions = moveItem(form.extraActions, 0, 1);
    const logic = buildLogic({ ...form, conditions: movedConditions, extraActions: movedActions });
    expect(logic.conditions.map((condition) => condition.type)).toEqual(["user_has_role", "channel_is"]);
    expect(logic.actions.map((action) => action.type)).toEqual(["reply", "send_message", "add_role"]);
    expect(form.conditions.map((condition) => condition.type)).toEqual(["channel_is", "user_has_role"]);
  });

  it("hydrate puis reconstruit le contrat historique sans perdre les champs", () => {
    const logic = buildLogic({
      ...validCommand,
      triggerType: "keyword",
      keywords: "bonjour, salut",
      matchMode: "starts_with",
      cooldownSeconds: 30,
      requiredPermissions: "8192",
    });
    const dto = {
      id: 1, guildId: "123456789012345678", name: "annonce", description: "Publie une annonce.",
      triggerType: "keyword", enabled: true, logic, cooldownSeconds: 30, cooldownScope: "user",
      requiredPermissions: "8192", discordCommandId: null, createdBy: "1",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null, gatewayRequired: true,
    } satisfies CustomCommandDto;
    expect(buildLogic(hydrate(dto))).toEqual(logic);
  });

  it("produit un résumé lisible sans modifier le brouillon", () => {
    const form = {
      ...validCommand,
      conditions: [{ type: "user_has_role" as const, roleId: roles[0]!.id }],
      extraActions: [{ type: "send_message" as const, channelId: channels[1]!.id, content: "Texte" }],
    };
    const summary = buildCommandSummary(form, roles, channels);
    expect(summary.sentence).toContain("Quand /annonce est utilisée");
    expect(summary.sentence).toContain("#annonces");
    expect(summary.steps).toEqual(expect.arrayContaining(["Condition : le membre possède @Membre", "Action : envoyer un message dans #annonces"]));
  });
});

describe("brouillon d’automatisation (Lot 5C)", () => {
  it("clone un brouillon vide sans partager les tableaux", () => {
    const first = createEmptyAutomationWorkflow();
    const second = createEmptyAutomationWorkflow();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.actions).not.toBe(second.actions);
  });

  it("associe les erreurs aux champs requis et expose les limites", () => {
    const workflow = createEmptyAutomationWorkflow();
    const validation = validateAutomationDraft(workflow, catalog);
    expect(validation.fieldErrors.name).toBe("Le nom est obligatoire.");
    expect(validation.componentErrors["action.0.content"]).toBe("Message est obligatoire.");
    expect(validation.warnings).toContain("Le brouillon est inactif : il sera enregistré sans être exécuté.");
  });

  it("produit un résumé instantané et les permissions réelles du catalogue", () => {
    const workflow = {
      ...createEmptyAutomationWorkflow(),
      name: "Accueil",
      actions: [{ type: "send_message", config: { content: "Bienvenue" }, continueOnError: false }],
    };
    const summary = buildAutomationFlowSummary(workflow, catalog);
    expect(summary.sentence).toBe("Quand Message créé, alors Envoyer un message.");
    expect(summary.permissions).toEqual(["send_messages"]);
  });

  it("déplace sans mutation et conserve l’ordre envoyé", () => {
    const items = [{ type: "a" }, { type: "b" }, { type: "c" }];
    expect(moveAutomationItem(items, 2, -1).map((item) => item.type)).toEqual(["a", "c", "b"]);
    expect(items.map((item) => item.type)).toEqual(["a", "b", "c"]);
  });

  it("retire les métadonnées DTO de la mutation d’édition", () => {
    const input = {
      ...createEmptyAutomationWorkflow(),
      name: "Accueil",
      actions: [{ type: "send_message", config: { content: "Bienvenue" }, continueOnError: false }],
    };
    const dto = {
      ...input,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      guildId: "123456789012345678",
      revision: 3,
      failureStreak: 0,
      circuitOpenUntil: null,
      createdBy: "1",
      updatedBy: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } satisfies AutomationWorkflowDto;
    expect(toAutomationInput(dto)).toEqual(input);
    expect(toAutomationInput(dto)).not.toHaveProperty("revision");
  });
});
