import type { ChannelOption, RoleOption } from "@bot/shared";
import type { ExtraAction } from "./logic.js";
import { IconButton, Input, Select } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";

export function ActionRow({
  action,
  roles,
  channels,
  index,
  count,
  error,
  onChange,
  onRemove,
  onMove,
}: {
  action: ExtraAction;
  roles: RoleOption[];
  channels: ChannelOption[];
  index: number;
  count: number;
  error?: string | null;
  onChange: (action: ExtraAction) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <article
      id={`command-action-${index}`}
      tabIndex={-1}
      aria-label={`Action supplémentaire ${index + 1}`}
      className={`rounded-xl border bg-zinc-950/55 p-3 ${error ? "border-red-700/70" : "border-zinc-800"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">
          {index + 1}
        </span>
        <Select
          size="sm"
          className="min-w-52 flex-1"
          aria-label={`Type de l’action ${index + 1}`}
          value={action.type}
          onChange={(event) => {
            const type = event.target.value as ExtraAction["type"];
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
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={`Monter l’action ${index + 1}`} onClick={() => onMove(-1)} disabled={index === 0}>
            <span aria-hidden>↑</span>
          </IconButton>
          <IconButton label={`Descendre l’action ${index + 1}`} onClick={() => onMove(1)} disabled={index === count - 1}>
            <span aria-hidden>↓</span>
          </IconButton>
          <IconButton label={`Supprimer l’action ${index + 1}`} danger onClick={onRemove}>
            <Icon.close />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {action.type === "send_message" && (
          <>
            <Select size="sm" className="!w-auto" aria-label={`Salon de l’action ${index + 1}`} value={action.channelId} onChange={(event) => onChange({ ...action, channelId: event.target.value })}>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </Select>
            <Input size="sm" className="min-w-48 flex-1" aria-label={`Message de l’action ${index + 1}`} value={action.content ?? ""} onChange={(event) => onChange({ ...action, content: event.target.value })} placeholder="Message ({user}, {mention}…)" />
          </>
        )}
        {(action.type === "add_role" || action.type === "remove_role") && (
          <Select size="sm" aria-label={`Rôle de l’action ${index + 1}`} value={action.roleId} onChange={(event) => onChange({ ...action, roleId: event.target.value })}>
            {roles.filter((role) => !role.managed).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </Select>
        )}
        {action.type === "increment_counter" && (
          <>
            <Input size="sm" className="!w-36" aria-label={`Nom du compteur de l’action ${index + 1}`} value={action.counter} onChange={(event) => onChange({ ...action, counter: event.target.value })} placeholder="nom du compteur" />
            <Input size="sm" type="number" className="!w-24" aria-label={`Variation du compteur de l’action ${index + 1}`} value={action.amount} onChange={(event) => onChange({ ...action, amount: Number(event.target.value) })} />
          </>
        )}
        {action.type === "call_webhook" && (
          <>
            <Input size="sm" className="min-w-56 flex-1" aria-label={`URL du webhook de l’action ${index + 1}`} value={action.url} onChange={(event) => onChange({ ...action, url: event.target.value })} placeholder="https://…" />
            <Select size="sm" className="!w-auto" aria-label={`Méthode du webhook de l’action ${index + 1}`} value={action.method} onChange={(event) => onChange({ ...action, method: event.target.value as "POST" | "GET" })}>
              <option value="POST">POST</option><option value="GET">GET</option>
            </Select>
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              <input type="checkbox" className="accent-indigo-600" checked={action.includeContext} onChange={(event) => onChange({ ...action, includeContext: event.target.checked })} />
              Inclure le contexte
            </label>
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  );
}
