import type { TicketFormConfig, TicketSettingsUpdate } from "@bot/shared";

export interface TicketPanelPreviewModel {
  title: string;
  description: string;
  emptyTitle: boolean;
  emptyDescription: boolean;
  opener: {
    kind: "button" | "select";
    label: string;
    categories: Array<{ id: string; label: string; description: string; emoji: string | null }>;
  };
  questions: Array<{ id: string; label: string; required: boolean; style: "short" | "paragraph" }>;
}

export function buildTicketPanelPreview(
  title: string,
  description: string,
  formEnabled: boolean,
  form: TicketFormConfig,
): TicketPanelPreviewModel {
  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  const categories = form.categories.map((category) => ({
    id: category.id,
    label: category.label.trim() || "Catégorie sans nom",
    description: category.description.trim(),
    emoji: category.emoji,
  }));
  const opener = formEnabled && categories.length > 1
    ? { kind: "select" as const, label: "Choisir une catégorie…", categories }
    : {
        kind: "button" as const,
        label: "Ouvrir un ticket",
        categories: formEnabled ? categories.slice(0, 1) : [],
      };
  return {
    title: normalizedTitle || "Titre non renseigné",
    description: normalizedDescription || "Description non renseignée",
    emptyTitle: normalizedTitle.length === 0,
    emptyDescription: normalizedDescription.length === 0,
    opener,
    questions: formEnabled
      ? form.fields.map((field) => ({
          id: field.id,
          label: field.label.trim() || "Question sans intitulé",
          required: field.required,
          style: field.style,
        }))
      : [],
  };
}

export interface TicketDraftValidation {
  errors: Record<string, string>;
  messages: string[];
}

export function validateTicketSettingsDraft(draft: TicketSettingsUpdate): TicketDraftValidation {
  const errors: Record<string, string> = {};
  const messages: string[] = [];
  if (draft.staffRoleIds.length > 10) {
    errors.staffRoleIds = "Sélectionnez au maximum 10 rôles support.";
    messages.push(errors.staffRoleIds);
  }
  if (draft.form.categories.length === 0) {
    errors.categories = "Ajoutez au moins une catégorie.";
    messages.push(errors.categories);
  }
  draft.form.categories.forEach((category, index) => {
    if (!category.label.trim()) {
      errors[`category-${index}-label`] = "Le nom de la catégorie est obligatoire.";
      messages.push(`Catégorie ${index + 1} : le nom est obligatoire.`);
    }
  });
  draft.form.fields.forEach((field, index) => {
    if (!field.label.trim()) {
      errors[`field-${index}-label`] = "La question est obligatoire.";
      messages.push(`Question ${index + 1} : l’intitulé est obligatoire.`);
    }
  });
  return { errors, messages };
}
