import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { discordJson, DiscordAPIError } from "../../discord/rest.js";
import { deferred, editOriginal, ephemeral } from "../respond.js";
import { getButtonRole } from "../../db/queries.js";
import type { ComponentContext } from "./index.js";

/** brole:<id> — toggles the configured role on the clicking member. */
export async function toggleButtonRole(ctx: ComponentContext<APIMessageComponentInteraction>): Promise<Response> {
  const { env, interaction } = ctx;
  const id = Number(interaction.data.custom_id.split(":")[1]);
  const row = Number.isInteger(id) ? await getButtonRole(env.DB, id) : null;
  if (!row || row.guild_id !== interaction.guild_id) {
    return ephemeral("Ce bouton de rôle n'est plus configuré.");
  }

  const member = interaction.member!;
  const hasRole = member.roles.includes(row.role_id);
  const path = `/guilds/${row.guild_id}/members/${member.user.id}/roles/${row.role_id}`;

  ctx.waitUntil(
    (async () => {
      try {
        await discordJson(env, hasRole ? "DELETE" : "PUT", path, undefined, { auditLogReason: "Rôle par bouton" });
        await editOriginal(env, interaction, {
          content: hasRole ? `➖ Rôle <@&${row.role_id}> retiré.` : `➕ Rôle <@&${row.role_id}> ajouté.`,
        });
      } catch (err) {
        console.error(`toggleButtonRole(${id}) failed:`, err);
        const detail =
          err instanceof DiscordAPIError && err.status === 403
            ? "Le bot ne peut pas gérer ce rôle (hiérarchie des rôles ou permission Gérer les rôles manquante)."
            : "Une erreur est survenue.";
        await editOriginal(env, interaction, { content: `⚠️ ${detail}` });
      }
    })(),
  );

  return deferred({ ephemeral: true });
}
