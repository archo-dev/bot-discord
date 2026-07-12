/* Éditeur de commande — ligne de condition (select de type + variantes rôle/salon/permission/compteur). */

import type { ChannelOption, CommandCondition, RoleOption } from "@bot/shared";
import { PERMISSION_OPTIONS, selectCls } from "./logic.js";

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
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <select
        className={selectCls}
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
      </select>

      {(condition.type === "user_has_role" || condition.type === "user_lacks_role") && (
        <select className={selectCls} value={condition.roleId} onChange={(e) => onChange({ ...condition, roleId: e.target.value })}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {condition.type === "channel_is" && (
        <select className={selectCls} value={condition.channelId} onChange={(e) => onChange({ ...condition, channelId: e.target.value })}>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
      )}
      {condition.type === "user_has_permission" && (
        <select className={selectCls} value={condition.permission} onChange={(e) => onChange({ ...condition, permission: e.target.value })}>
          {PERMISSION_OPTIONS.filter((p) => p.value !== "").map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {condition.type === "counter_compare" && (
        <>
          <input
            className={`${selectCls} w-28`}
            value={condition.counter}
            onChange={(e) => onChange({ ...condition, counter: e.target.value })}
            placeholder="nom"
          />
          <select className={selectCls} value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as typeof condition.op })}>
            <option value="eq">=</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </select>
          <input
            type="number"
            className={`${selectCls} w-20`}
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
          />
        </>
      )}

      <button onClick={onRemove} className="ml-auto text-zinc-500 hover:text-red-400" title="Retirer">
        ✕
      </button>
    </div>
  );
}
