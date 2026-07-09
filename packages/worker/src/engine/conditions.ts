import type { CommandCondition } from "@bot/shared";
import { hasPermission } from "@bot/shared";

export interface ConditionContext {
  memberRoles: string[];
  /** Decimal permission bitfield from the interaction payload. */
  memberPermissions: string;
  channelId: string;
  /** Resolved values for every counter referenced by the conditions. */
  counters: Record<string, number>;
}

function evaluateOne(condition: CommandCondition, ctx: ConditionContext): boolean {
  switch (condition.type) {
    case "user_has_role":
      return ctx.memberRoles.includes(condition.roleId);
    case "user_lacks_role":
      return !ctx.memberRoles.includes(condition.roleId);
    case "channel_is":
      return ctx.channelId === condition.channelId;
    case "user_has_permission":
      return hasPermission(ctx.memberPermissions, BigInt(condition.permission));
    case "counter_compare": {
      const value = ctx.counters[condition.counter] ?? 0;
      switch (condition.op) {
        case "eq":
          return value === condition.value;
        case "gt":
          return value > condition.value;
        case "gte":
          return value >= condition.value;
        case "lt":
          return value < condition.value;
        case "lte":
          return value <= condition.value;
      }
    }
  }
}

export function evaluateConditions(
  conditions: CommandCondition[],
  mode: "all" | "any",
  ctx: ConditionContext,
): boolean {
  if (conditions.length === 0) return true;
  return mode === "all" ? conditions.every((c) => evaluateOne(c, ctx)) : conditions.some((c) => evaluateOne(c, ctx));
}

/** Counter names referenced by counter_compare conditions. */
export function conditionCounters(conditions: CommandCondition[]): string[] {
  const names = new Set<string>();
  for (const c of conditions) if (c.type === "counter_compare") names.add(c.counter);
  return [...names];
}
