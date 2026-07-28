import type { ChannelOption, CommandCondition, RoleOption } from "@bot/shared";
import { PERMISSION_OPTIONS } from "./logic.js";
import { IconButton, Input, Select } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";

export function ConditionRow({
  condition,
  roles,
  channels,
  index,
  count,
  error,
  onChange,
  onRemove,
  onMove,
}: {
  condition: CommandCondition;
  roles: RoleOption[];
  channels: ChannelOption[];
  index: number;
  count: number;
  error?: string | null;
  onChange: (condition: CommandCondition) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <article
      id={`command-condition-${index}`}
      tabIndex={-1}
      aria-label={`Condition ${index + 1}`}
      className={`rounded-xl border bg-zinc-950/55 p-3 ${error ? "border-red-700/70" : "border-zinc-800"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">
          {index + 1}
        </span>
        <Select
          size="sm"
          className="min-w-44 flex-1"
          aria-label={`Type de la condition ${index + 1}`}
          value={condition.type}
          onChange={(event) => {
            const type = event.target.value as CommandCondition["type"];
            if (type === "user_has_role" || type === "user_lacks_role") onChange({ type, roleId: roles[0]?.id ?? "" });
            else if (type === "channel_is") onChange({ type, channelId: channels[0]?.id ?? "" });
            else if (type === "user_has_permission") onChange({ type, permission: "8192" });
            else onChange({ type: "counter_compare", counter: "compteur", op: "gte", value: 1 });
          }}
        >
          <option value="user_has_role">A le rôle</option>
          <option value="user_lacks_role">N’a pas le rôle</option>
          <option value="channel_is">Dans le salon</option>
          <option value="user_has_permission">A la permission</option>
          <option value="counter_compare">Compteur</option>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={`Monter la condition ${index + 1}`} onClick={() => onMove(-1)} disabled={index === 0}>
            <span aria-hidden>↑</span>
          </IconButton>
          <IconButton label={`Descendre la condition ${index + 1}`} onClick={() => onMove(1)} disabled={index === count - 1}>
            <span aria-hidden>↓</span>
          </IconButton>
          <IconButton label={`Supprimer la condition ${index + 1}`} danger onClick={onRemove}>
            <Icon.close />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(condition.type === "user_has_role" || condition.type === "user_lacks_role") && (
          <Select size="sm" aria-label={`Rôle de la condition ${index + 1}`} value={condition.roleId} onChange={(event) => onChange({ ...condition, roleId: event.target.value })}>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </Select>
        )}
        {condition.type === "channel_is" && (
          <Select size="sm" aria-label={`Salon de la condition ${index + 1}`} value={condition.channelId} onChange={(event) => onChange({ ...condition, channelId: event.target.value })}>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </Select>
        )}
        {condition.type === "user_has_permission" && (
          <Select size="sm" aria-label={`Permission de la condition ${index + 1}`} value={condition.permission} onChange={(event) => onChange({ ...condition, permission: event.target.value })}>
            {PERMISSION_OPTIONS.filter((permission) => permission.value !== "").map((permission) => (
              <option key={permission.value} value={permission.value}>{permission.label}</option>
            ))}
          </Select>
        )}
        {condition.type === "counter_compare" && (
          <>
            <Input size="sm" className="!w-32" aria-label={`Nom du compteur de la condition ${index + 1}`} value={condition.counter} onChange={(event) => onChange({ ...condition, counter: event.target.value })} placeholder="nom" />
            <Select size="sm" className="!w-auto" aria-label={`Opérateur de la condition ${index + 1}`} value={condition.op} onChange={(event) => onChange({ ...condition, op: event.target.value as typeof condition.op })}>
              <option value="eq">=</option><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option>
            </Select>
            <Input size="sm" type="number" className="!w-24" aria-label={`Valeur de la condition ${index + 1}`} value={condition.value} onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })} />
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  );
}
