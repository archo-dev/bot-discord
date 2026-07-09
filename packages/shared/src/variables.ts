/**
 * Whitelisted template variables for custom command content.
 * Substitution is plain string replacement over this registry — no expression
 * evaluation, no template engine. `{counter:name}` is the only parameterized form.
 */
export const VARIABLES = [
  { name: "{user}", description: "Username of the invoking user" },
  { name: "{mention}", description: "Mention of the invoking user" },
  { name: "{user.id}", description: "ID of the invoking user" },
  { name: "{server}", description: "Server name" },
  { name: "{membercount}", description: "Approximate member count" },
  { name: "{channel}", description: "Mention of the current channel" },
  { name: "{counter:name}", description: "Current value of a counter" },
] as const;

export interface VariableContext {
  userName: string;
  userId: string;
  serverName: string;
  memberCount: number | null;
  channelId: string;
  /** Resolved counter values, keyed by counter name. */
  counters?: Record<string, number>;
}

const COUNTER_RE = /\{counter:([a-z0-9_-]{1,32})\}/g;

/** Extract counter names referenced by `{counter:name}` in a template string. */
export function referencedCounters(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(COUNTER_RE)) names.add(m[1]!);
  return [...names];
}

/** Substitute whitelisted variables in a template string. */
export function substituteVariables(template: string, ctx: VariableContext): string {
  return template
    .replaceAll("{user}", ctx.userName)
    .replaceAll("{mention}", `<@${ctx.userId}>`)
    .replaceAll("{user.id}", ctx.userId)
    .replaceAll("{server}", ctx.serverName)
    .replaceAll("{membercount}", ctx.memberCount === null ? "?" : String(ctx.memberCount))
    .replaceAll("{channel}", `<#${ctx.channelId}>`)
    .replaceAll(COUNTER_RE, (_, name: string) => String(ctx.counters?.[name] ?? 0));
}
