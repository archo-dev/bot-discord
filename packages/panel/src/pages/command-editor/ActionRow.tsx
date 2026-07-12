/* Éditeur de commande — ligne d'action supplémentaire (send_message / rôles / compteur / webhook). */

import type { ChannelOption, RoleOption } from "@bot/shared";
import { selectCls, type ExtraAction } from "./logic.js";

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
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <select
        className={selectCls}
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
      </select>

      {action.type === "send_message" && (
        <>
          <select className={selectCls} value={action.channelId} onChange={(e) => onChange({ ...action, channelId: e.target.value })}>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                #{ch.name}
              </option>
            ))}
          </select>
          <input
            className={`${selectCls} min-w-48 flex-1`}
            value={action.content ?? ""}
            onChange={(e) => onChange({ ...action, content: e.target.value })}
            placeholder="Message ({user}, {mention}…)"
          />
        </>
      )}
      {(action.type === "add_role" || action.type === "remove_role") && (
        <select className={selectCls} value={action.roleId} onChange={(e) => onChange({ ...action, roleId: e.target.value })}>
          {roles
            .filter((r) => !r.managed)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
      )}
      {action.type === "increment_counter" && (
        <>
          <input
            className={`${selectCls} w-32`}
            value={action.counter}
            onChange={(e) => onChange({ ...action, counter: e.target.value })}
            placeholder="nom du compteur"
          />
          <input
            type="number"
            className={`${selectCls} w-20`}
            value={action.amount}
            onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })}
          />
        </>
      )}
      {action.type === "call_webhook" && (
        <>
          <input
            className={`${selectCls} min-w-64 flex-1`}
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://…"
          />
          <select className={selectCls} value={action.method} onChange={(e) => onChange({ ...action, method: e.target.value as "POST" | "GET" })}>
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
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

      <button onClick={onRemove} className="ml-auto text-zinc-500 hover:text-red-400" title="Retirer">
        ✕
      </button>
    </div>
  );
}
