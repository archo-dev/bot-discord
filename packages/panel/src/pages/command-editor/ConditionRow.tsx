/* Éditeur de commande — ligne de condition (select de type + variantes rôle/salon/permission/compteur). */

import type { ChannelOption, CommandCondition, RoleOption } from "@bot/shared";
import { PERMISSION_OPTIONS } from "./logic.js";
import { IconButton, Input, Select } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";

export function ConditionRow({
  condition,
  roles,
  channels,
  onChange,
  onRemove,
}: {
  condition: CommandCondition;
  roles: RoleOption[];
  channels: ChannelOption[];
  onChange: (c: CommandCondition) => void;
  onRemove: () => void;
}) {
  return (
    // Rangée dense : selects auto-dimensionnés via `!w-auto`, inputs fixes via `!w-*` — le kit impose `w-full`
    // (émis après `.w-auto`/`.w-<n>`), donc l'override d'une largeur exige `!` (cf. spec 2.2.f).
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <Select
        size="sm"
        className="!w-auto"
        value={condition.type}
        onChange={(e) => {
          const type = e.target.value as CommandCondition["type"];
          if (type === "user_has_role" || type === "user_lacks_role") onChange({ type, roleId: roles[0]?.id ?? "" });
          else if (type === "channel_is") onChange({ type, channelId: channels[0]?.id ?? "" });
          else if (type === "user_has_permission") onChange({ type, permission: "8192" });
          else onChange({ type: "counter_compare", counter: "compteur", op: "gte", value: 1 });
        }}
      >
        <option value="user_has_role">A le rôle</option>
        <option value="user_lacks_role">N'a pas le rôle</option>
        <option value="channel_is">Dans le salon</option>
        <option value="user_has_permission">A la permission</option>
        <option value="counter_compare">Compteur</option>
      </Select>

      {(condition.type === "user_has_role" || condition.type === "user_lacks_role") && (
        <Select size="sm" className="!w-auto" value={condition.roleId} onChange={(e) => onChange({ ...condition, roleId: e.target.value })}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      )}
      {condition.type === "channel_is" && (
        <Select size="sm" className="!w-auto" value={condition.channelId} onChange={(e) => onChange({ ...condition, channelId: e.target.value })}>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </Select>
      )}
      {condition.type === "user_has_permission" && (
        <Select size="sm" className="!w-auto" value={condition.permission} onChange={(e) => onChange({ ...condition, permission: e.target.value })}>
          {PERMISSION_OPTIONS.filter((p) => p.value !== "").map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      )}
      {condition.type === "counter_compare" && (
        <>
          <Input
            size="sm"
            className="!w-28"
            value={condition.counter}
            onChange={(e) => onChange({ ...condition, counter: e.target.value })}
            placeholder="nom"
          />
          <Select size="sm" className="!w-auto" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as typeof condition.op })}>
            <option value="eq">=</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </Select>
          <Input
            size="sm"
            type="number"
            className="!w-20"
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
          />
        </>
      )}

      <IconButton label="Retirer cette condition" danger onClick={onRemove} className="ml-auto">
        <Icon.close />
      </IconButton>
    </div>
  );
}
