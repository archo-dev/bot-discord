/* Éditeur de commande — ligne d'action supplémentaire (send_message / rôles / compteur / webhook). */

import type { ChannelOption, RoleOption } from "@bot/shared";
import type { ExtraAction } from "./logic.js";
import { IconButton, Input, Select } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";

export function ActionRow({
  action,
  roles,
  channels,
  onChange,
  onRemove,
}: {
  action: ExtraAction;
  roles: RoleOption[];
  channels: ChannelOption[];
  onChange: (a: ExtraAction) => void;
  onRemove: () => void;
}) {
  return (
    // Rangée dense : selects auto-dimensionnés via `!w-auto`, inputs fixes via `!w-*` — le kit impose `w-full`
    // (émis après `.w-auto`/`.w-<n>` dans le CSS), donc l'override d'une largeur exige `!` (cf. spec 2.2.f).
    // `min-w-* flex-1` fonctionnent sans `!` (propriétés distinctes). `size="sm"` = 32 px = hauteur historique.
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <Select
        size="sm"
        className="!w-auto"
        value={action.type}
        onChange={(e) => {
          const type = e.target.value as ExtraAction["type"];
          if (type === "send_message") onChange({ type, channelId: channels[0]?.id ?? "", content: "" });
          else if (type === "add_role" || type === "remove_role") onChange({ type, roleId: roles[0]?.id ?? "" });
          else if (type === "increment_counter") onChange({ type, counter: "compteur", amount: 1 });
          else onChange({ type: "call_webhook", url: "https://", method: "POST", includeContext: true });
        }}
      >
        <option value="send_message">Envoyer un message dans un salon</option>
        <option value="add_role">Ajouter un rôle</option>
        <option value="remove_role">Retirer un rôle</option>
        <option value="increment_counter">Incrémenter un compteur</option>
        <option value="call_webhook">Appeler un webhook externe</option>
      </Select>

      {action.type === "send_message" && (
        <>
          <Select size="sm" className="!w-auto" value={action.channelId} onChange={(e) => onChange({ ...action, channelId: e.target.value })}>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                #{ch.name}
              </option>
            ))}
          </Select>
          <Input
            size="sm"
            className="min-w-48 flex-1"
            value={action.content ?? ""}
            onChange={(e) => onChange({ ...action, content: e.target.value })}
            placeholder="Message ({user}, {mention}…)"
          />
        </>
      )}
      {(action.type === "add_role" || action.type === "remove_role") && (
        <Select size="sm" className="!w-auto" value={action.roleId} onChange={(e) => onChange({ ...action, roleId: e.target.value })}>
          {roles
            .filter((r) => !r.managed)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
      )}
      {action.type === "increment_counter" && (
        <>
          <Input
            size="sm"
            className="!w-32"
            value={action.counter}
            onChange={(e) => onChange({ ...action, counter: e.target.value })}
            placeholder="nom du compteur"
          />
          <Input
            size="sm"
            type="number"
            className="!w-20"
            value={action.amount}
            onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })}
          />
        </>
      )}
      {action.type === "call_webhook" && (
        <>
          <Input
            size="sm"
            className="min-w-64 flex-1"
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://…"
          />
          <Select size="sm" className="!w-auto" value={action.method} onChange={(e) => onChange({ ...action, method: e.target.value as "POST" | "GET" })}>
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input
              type="checkbox"
              className="accent-indigo-600"
              checked={action.includeContext}
              onChange={(e) => onChange({ ...action, includeContext: e.target.checked })}
            />
            contexte
          </label>
        </>
      )}

      <IconButton label="Retirer cette action" danger onClick={onRemove} className="ml-auto">
        <Icon.close />
      </IconButton>
    </div>
  );
}
