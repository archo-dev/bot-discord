import type { ButtonRoleMessageCreate, RoleOption } from "@bot/shared";

export interface RoleButtonDraft {
  readonly roleId: string;
  readonly label: string;
  readonly emoji: string;
  readonly style: number;
}

export interface RolesDraft {
  readonly channelId: string;
  readonly title: string;
  readonly description: string;
  readonly buttons: readonly RoleButtonDraft[];
}

export interface RoleButtonPreview extends RoleButtonDraft {
  readonly roleName: string;
}

export interface RolesPreview {
  readonly empty: boolean;
  readonly title: string;
  readonly description: string;
  readonly buttons: readonly RoleButtonPreview[];
  readonly response: string | null;
}

export const DEFAULT_ROLES_DRAFT: RolesDraft = {
  channelId: "",
  title: "Choisissez vos rôles",
  description: "Cliquez sur un bouton pour recevoir (ou retirer) le rôle.",
  buttons: [],
};

export function createRolesDraft(): RolesDraft {
  return { ...DEFAULT_ROLES_DRAFT, buttons: [] };
}

export function addRoleButton(
  draft: RolesDraft,
  roles: readonly RoleOption[],
): RolesDraft {
  const firstFree = roles.find((role) => !role.managed && !draft.buttons.some((button) => button.roleId === role.id));
  if (!firstFree || draft.buttons.length >= 25) return draft;
  return {
    ...draft,
    buttons: [...draft.buttons, { roleId: firstFree.id, label: firstFree.name, emoji: "", style: 2 }],
  };
}

export function updateRoleButton(
  draft: RolesDraft,
  index: number,
  patch: Partial<RoleButtonDraft>,
): RolesDraft {
  return {
    ...draft,
    buttons: draft.buttons.map((button, buttonIndex) =>
      buttonIndex === index ? { ...button, ...patch } : button),
  };
}

export function removeRoleButton(draft: RolesDraft, index: number): RolesDraft {
  return { ...draft, buttons: draft.buttons.filter((_, buttonIndex) => buttonIndex !== index) };
}

export function buildRolesPreview(
  draft: RolesDraft,
  roles: readonly RoleOption[],
): RolesPreview {
  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const buttons = draft.buttons.map((button) => ({
    ...button,
    roleName: roleNames.get(button.roleId) ?? "Rôle non disponible",
  }));
  const empty = !draft.title.trim() && !draft.description.trim() && buttons.length === 0;
  const first = buttons[0];
  return {
    empty,
    title: draft.title,
    description: draft.description,
    buttons,
    response: first
      ? `➕ Rôle @${first.roleName} ajouté — ou retiré au clic suivant.`
      : null,
  };
}

export function rolesDraftErrors(draft: RolesDraft): {
  channelId?: string;
  title?: string;
  buttons?: string;
  buttonLabels: Record<number, string>;
} {
  const buttonLabels: Record<number, string> = {};
  draft.buttons.forEach((button, index) => {
    if (!button.roleId) buttonLabels[index] = "Sélectionnez un rôle.";
    else if (!button.label.trim()) buttonLabels[index] = "Le libellé du bouton est obligatoire.";
  });
  return {
    channelId: draft.channelId ? undefined : "Sélectionnez le salon de publication.",
    title: draft.title.trim() ? undefined : "Le titre est obligatoire.",
    buttons: draft.buttons.length > 0 ? undefined : "Ajoutez au moins un bouton de rôle.",
    buttonLabels,
  };
}

export function isRolesDraftPublishable(draft: RolesDraft): boolean {
  const errors = rolesDraftErrors(draft);
  return !errors.channelId && !errors.title && !errors.buttons && Object.keys(errors.buttonLabels).length === 0;
}

export function toButtonRoleCreate(draft: RolesDraft): ButtonRoleMessageCreate {
  return {
    channelId: draft.channelId,
    title: draft.title,
    description: draft.description || null,
    buttons: draft.buttons.map((button) => ({
      roleId: button.roleId,
      label: button.label,
      emoji: button.emoji || null,
      style: button.style,
    })),
  };
}

export function draftAfterPublish(draft: RolesDraft): RolesDraft {
  return { ...draft, buttons: [] };
}
