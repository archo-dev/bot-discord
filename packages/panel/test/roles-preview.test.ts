import { describe, expect, it } from "vitest";
import type { RoleOption } from "@bot/shared";
import {
  addRoleButton,
  buildRolesPreview,
  createRolesDraft,
  draftAfterPublish,
  isRolesDraftPublishable,
  removeRoleButton,
  rolesDraftErrors,
  toButtonRoleCreate,
  updateRoleButton,
} from "../src/lib/roles-preview.js";

const roles: RoleOption[] = [
  { id: "111111111111111111", name: "Développeur", color: 0x5865f2, position: 3, managed: false },
  { id: "222222222222222222", name: "Designer", color: 0x57f287, position: 2, managed: false },
  { id: "333333333333333333", name: "Bot géré", color: 0, position: 4, managed: true },
];

describe("brouillon et aperçu des rôles", () => {
  it("conserve les valeurs par défaut historiques", () => {
    expect(createRolesDraft()).toEqual({
      channelId: "",
      title: "Choisissez vos rôles",
      description: "Cliquez sur un bouton pour recevoir (ou retirer) le rôle.",
      buttons: [],
    });
  });

  it("ajoute, modifie puis supprime un rôle sans muter le brouillon précédent", () => {
    const initial = createRolesDraft();
    const added = addRoleButton(initial, roles);
    expect(initial.buttons).toHaveLength(0);
    expect(added.buttons[0]).toMatchObject({ roleId: roles[0]!.id, label: "Développeur", style: 2 });

    const modified = updateRoleButton(added, 0, { label: "Dev & code", emoji: "💻", style: 1 });
    expect(modified.buttons[0]).toMatchObject({ label: "Dev & code", emoji: "💻", style: 1 });
    expect(added.buttons[0]!.label).toBe("Développeur");

    expect(removeRoleButton(modified, 0).buttons).toHaveLength(0);
  });

  it("ignore les rôles gérés et les rôles déjà sélectionnés", () => {
    const first = addRoleButton(createRolesDraft(), roles);
    const second = addRoleButton(first, roles);
    const unchanged = addRoleButton(second, roles);
    expect(second.buttons.map((button) => button.roleId)).toEqual([roles[0]!.id, roles[1]!.id]);
    expect(unchanged).toBe(second);
  });

  it("synchronise immédiatement titre, description, caractères spéciaux et réponse indicative", () => {
    const draft = updateRoleButton(
      addRoleButton({
        ...createRolesDraft(),
        title: "Rôles « création » & entraide ✨",
        description: "Ligne 1\n<mentions> {variables} — aucun HTML interprété.",
      }, roles),
      0,
      { emoji: "🧩", label: "Coder & créer" },
    );
    const preview = buildRolesPreview(draft, roles);
    expect(preview.title).toBe(draft.title);
    expect(preview.description).toBe(draft.description);
    expect(preview.buttons[0]).toMatchObject({ roleName: "Développeur", emoji: "🧩", label: "Coder & créer" });
    expect(preview.response).toContain("@Développeur ajouté");
  });

  it("préserve un contenu très long dans la donnée d’aperçu", () => {
    const description = "Très long — émoji 🛰️\n".repeat(80).slice(0, 2000);
    const preview = buildRolesPreview({ ...createRolesDraft(), description }, roles);
    expect(preview.description).toBe(description);
    expect(preview.description.length).toBeLessThanOrEqual(2000);
  });

  it("rend un véritable état vide quand aucun contenu n’est configuré", () => {
    expect(buildRolesPreview({ channelId: "", title: " ", description: "", buttons: [] }, roles)).toMatchObject({
      empty: true,
      response: null,
    });
  });

  it("valide salon, titre, boutons et libellés avant publication", () => {
    const invalid = { channelId: "", title: " ", description: "", buttons: [] };
    expect(isRolesDraftPublishable(invalid)).toBe(false);
    expect(rolesDraftErrors(invalid)).toMatchObject({
      channelId: "Sélectionnez le salon de publication.",
      title: "Le titre est obligatoire.",
      buttons: "Ajoutez au moins un bouton de rôle.",
    });

    const withButton = addRoleButton({ ...createRolesDraft(), channelId: "999999999999999999" }, roles);
    const emptyLabel = updateRoleButton(withButton, 0, { label: " " });
    expect(rolesDraftErrors(emptyLabel).buttonLabels[0]).toContain("obligatoire");
    expect(isRolesDraftPublishable(withButton)).toBe(true);
  });

  it("produit exactement le contrat POST existant, sans champ inventé", () => {
    const draft = updateRoleButton(
      addRoleButton({ ...createRolesDraft(), channelId: "999999999999999999" }, roles),
      0,
      { emoji: "", style: 3 },
    );
    expect(toButtonRoleCreate(draft)).toEqual({
      channelId: "999999999999999999",
      title: draft.title,
      description: draft.description,
      buttons: [{ roleId: roles[0]!.id, label: "Développeur", emoji: null, style: 3 }],
    });
  });

  it("remet le dirty state à zéro après publication tout en conservant le contexte historique", () => {
    const draft = addRoleButton({ ...createRolesDraft(), channelId: "999999999999999999" }, roles);
    expect(draftAfterPublish(draft)).toEqual({ ...draft, buttons: [] });
    expect(draftAfterPublish(draft)).not.toBe(draft);
  });
});
