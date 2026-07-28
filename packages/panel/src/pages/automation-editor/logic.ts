import type {
  AutomationCatalogDto,
  AutomationComponentDefinition,
  AutomationWorkflowDto,
  AutomationWorkflowInput,
} from "@bot/shared";

type CatalogItem = AutomationComponentDefinition<string>;

export const emptyAutomationWorkflow: AutomationWorkflowInput = {
  schemaVersion: 1,
  name: "",
  description: "",
  enabled: false,
  trigger: { type: "message_create", config: { ignoreBots: true } },
  conditions: [],
  conditionMode: "all",
  actions: [{ type: "send_message", config: { content: "" }, continueOnError: false }],
  cooldownSeconds: 0,
  cooldownScope: "user",
  maxRunsPerMinute: 10,
};

export const createEmptyAutomationWorkflow = (): AutomationWorkflowInput =>
  structuredClone(emptyAutomationWorkflow);

export function toAutomationInput(workflow: AutomationWorkflowDto | AutomationWorkflowInput): AutomationWorkflowInput {
  return {
    schemaVersion: 1,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    trigger: structuredClone(workflow.trigger),
    conditions: structuredClone(workflow.conditions),
    conditionMode: workflow.conditionMode,
    actions: structuredClone(workflow.actions),
    cooldownSeconds: workflow.cooldownSeconds,
    cooldownScope: workflow.cooldownScope,
    maxRunsPerMinute: workflow.maxRunsPerMinute,
  };
}

export function moveAutomationItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

const definitionName = (catalog: readonly CatalogItem[], type: string) =>
  catalog.find((definition) => definition.id === type)?.name ?? type;

export function buildAutomationFlowSummary(
  workflow: AutomationWorkflowInput,
  catalog: AutomationCatalogDto,
): { sentence: string; steps: string[]; permissions: string[] } {
  const trigger = definitionName(catalog.triggers, workflow.trigger.type);
  const conditions = workflow.conditions.map((condition) => definitionName(catalog.conditions, condition.type));
  const actions = workflow.actions.map((action) => definitionName(catalog.actions, action.type));
  const conditionText = conditions.length
    ? `, si ${workflow.conditionMode === "all" ? "toutes" : "au moins une"} des conditions ${conditions.join(", ")} sont validées`
    : "";
  const permissions = workflow.actions.flatMap((action) =>
    catalog.actions.find((definition) => definition.id === action.type)?.requiredPermissions ?? []);
  return {
    sentence: `Quand ${trigger}${conditionText}, alors ${actions.join(", puis ") || "aucune action"}.`,
    steps: [
      `Déclencheur : ${trigger}`,
      ...conditions.map((condition) => `Condition : ${condition}`),
      ...actions.map((action) => `Action : ${action}`),
    ],
    permissions: [...new Set(permissions)],
  };
}

export interface AutomationDraftValidation {
  readonly valid: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly componentErrors: Readonly<Record<string, string>>;
  readonly blockingErrors: readonly string[];
  readonly warnings: readonly string[];
}

const emptyRequiredValue = (value: unknown) =>
  value == null || (typeof value === "string" && value.trim() === "");

export function validateAutomationDraft(
  workflow: AutomationWorkflowInput,
  catalog: AutomationCatalogDto,
): AutomationDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const componentErrors: Record<string, string> = {};
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  if (!workflow.name.trim()) fieldErrors.name = "Le nom est obligatoire.";
  else if (workflow.name.length > 80) fieldErrors.name = "Le nom est limité à 80 caractères.";
  if (workflow.description.length > 500) fieldErrors.description = "La description est limitée à 500 caractères.";
  if (!Number.isInteger(workflow.cooldownSeconds) || workflow.cooldownSeconds < 0 || workflow.cooldownSeconds > 86_400) {
    fieldErrors.cooldownSeconds = "Le cooldown doit être un entier entre 0 et 86 400.";
  }
  if (!Number.isInteger(workflow.maxRunsPerMinute) || workflow.maxRunsPerMinute < 1 || workflow.maxRunsPerMinute > 60) {
    fieldErrors.maxRunsPerMinute = "La limite doit être un entier entre 1 et 60.";
  }
  if (workflow.conditions.length > 20) blockingErrors.push("Vingt conditions maximum sont autorisées.");
  if (workflow.actions.length === 0) blockingErrors.push("Ajoutez au moins une action.");
  if (workflow.actions.length > 20) blockingErrors.push("Vingt actions maximum sont autorisées.");
  if (workflow.actions.filter((action) => action.type === "wait").length > 5) {
    blockingErrors.push("Cinq actions Attendre maximum sont autorisées.");
  }

  const validateComponent = (
    kind: "trigger" | "condition" | "action",
    index: number,
    component: { type: string; config: Record<string, unknown> },
    definitions: readonly CatalogItem[],
  ) => {
    const definition = definitions.find((candidate) => candidate.id === component.type);
    if (!definition) {
      componentErrors[`${kind}.${index}`] = "Le type sélectionné n’existe plus dans le catalogue.";
      return;
    }
    for (const field of definition.configFields) {
      const value = component.config[field.key];
      if (field.required && emptyRequiredValue(value)) {
        componentErrors[`${kind}.${index}.${field.key}`] = `${field.label} est obligatoire.`;
      }
      if (field.type === "json" && typeof value === "string") {
        try { JSON.parse(value); } catch { componentErrors[`${kind}.${index}.${field.key}`] = `${field.label} doit contenir un JSON valide.`; }
      }
    }
  };
  validateComponent("trigger", 0, workflow.trigger, catalog.triggers);
  workflow.conditions.forEach((condition, index) => validateComponent("condition", index, condition, catalog.conditions));
  workflow.actions.forEach((action, index) => validateComponent("action", index, action, catalog.actions));
  if (workflow.conditions.length === 0) warnings.push("Aucune condition : chaque événement correspondant déclenchera les actions.");
  if (!workflow.enabled) warnings.push("Le brouillon est inactif : il sera enregistré sans être exécuté.");
  for (const error of Object.values(fieldErrors)) blockingErrors.push(error);
  if (Object.keys(componentErrors).length) blockingErrors.push("Un ou plusieurs composants sont incomplets.");

  return {
    valid: blockingErrors.length === 0,
    fieldErrors,
    componentErrors,
    blockingErrors: [...new Set(blockingErrors)],
    warnings,
  };
}
