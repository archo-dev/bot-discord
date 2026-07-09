import { z } from "zod";

/**
 * Versioned JSON logic format for custom commands.
 *
 * SECURITY BOUNDARY: this schema is the single whitelist of everything a
 * custom command can do. It is validated on write (panel API) AND re-validated
 * on read (executor), so nothing outside this shape ever executes. There is no
 * arbitrary code execution path by construction.
 */

export const COMMAND_NAME_RE = /^[a-z0-9_-]{1,32}$/;

/** Built-in command names that custom commands may not shadow. */
export const RESERVED_COMMAND_NAMES = [
  "ping",
  "ban",
  "unban",
  "kick",
  "mute",
  "warn",
  "warnings",
  "clear",
] as const;

const snowflake = z.string().regex(/^\d{5,20}$/, "must be a Discord ID");
const counterName = z.string().regex(/^[a-z0-9_-]{1,32}$/, "lowercase letters, digits, - and _ only");
const permissionBitfield = z.string().regex(/^\d{1,20}$/);

/**
 * Webhook URL guard, applied at validation AND execution time:
 * https only, no IP literals, no localhost/private-looking hostnames.
 * DNS rebinding remains a residual risk (documented in README).
 */
export function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return false;
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // IPv6 literal (URL keeps brackets in hostname per WHATWG; be lenient and check both)
  if (host.includes(":") || host.startsWith("[")) return false;
  if (!host.includes(".")) return false;
  return true;
}

const webhookUrl = z.string().max(500).refine(isAllowedWebhookUrl, {
  message: "webhook URL must be public https (no IPs, localhost or internal hosts)",
});

const embedSchema = z
  .object({
    title: z.string().max(256).optional(),
    description: z.string().max(4096).optional(),
    color: z.number().int().min(0).max(0xffffff).optional(),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(256),
          value: z.string().min(1).max(1024),
          inline: z.boolean().optional(),
        }),
      )
      .max(10)
      .optional(),
    footer: z.object({ text: z.string().min(1).max(2048) }).optional(),
    thumbnail: z.object({ url: webhookUrl }).optional(),
  })
  .refine((e) => e.title || e.description || (e.fields && e.fields.length > 0), {
    message: "embed needs a title, description or at least one field",
  });

export type CommandEmbed = z.infer<typeof embedSchema>;

// ---------------------------------------------------------------------------
// Actions — the exhaustive whitelist. Adding an action type means adding it
// here AND implementing its executor; nothing else runs.
// ---------------------------------------------------------------------------

const replyAction = z
  .object({
    type: z.literal("reply"),
    content: z.string().min(1).max(2000).optional(),
    embed: embedSchema.optional(),
    ephemeral: z.boolean().optional(),
  })
  .refine((a) => a.content !== undefined || a.embed !== undefined, {
    message: "reply needs content or an embed",
  });

const sendMessageAction = z
  .object({
    type: z.literal("send_message"),
    channelId: snowflake,
    content: z.string().min(1).max(2000).optional(),
    embed: embedSchema.optional(),
  })
  .refine((a) => a.content !== undefined || a.embed !== undefined, {
    message: "send_message needs content or an embed",
  });

const addRoleAction = z.object({ type: z.literal("add_role"), roleId: snowflake });
const removeRoleAction = z.object({ type: z.literal("remove_role"), roleId: snowflake });

const incrementCounterAction = z.object({
  type: z.literal("increment_counter"),
  counter: counterName,
  amount: z.number().int().min(-1000).max(1000),
});

const callWebhookAction = z.object({
  type: z.literal("call_webhook"),
  url: webhookUrl,
  method: z.enum(["POST", "GET"]),
  includeContext: z.boolean(),
});

const actionSchema = z.discriminatedUnion("type", [
  replyAction,
  sendMessageAction,
  addRoleAction,
  removeRoleAction,
  incrementCounterAction,
  callWebhookAction,
]);

export type CommandAction = z.infer<typeof actionSchema>;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_has_role"), roleId: snowflake }),
  z.object({ type: z.literal("user_lacks_role"), roleId: snowflake }),
  z.object({ type: z.literal("channel_is"), channelId: snowflake }),
  z.object({ type: z.literal("user_has_permission"), permission: permissionBitfield }),
  z.object({
    type: z.literal("counter_compare"),
    counter: counterName,
    op: z.enum(["eq", "gt", "gte", "lt", "lte"]),
    value: z.number().int(),
  }),
]);

export type CommandCondition = z.infer<typeof conditionSchema>;

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

const slashName = z
  .string()
  .regex(COMMAND_NAME_RE, "1–32 chars: lowercase letters, digits, - and _")
  .refine((n) => !(RESERVED_COMMAND_NAMES as readonly string[]).includes(n), {
    message: "this name is reserved by a built-in command",
  });

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("slash"), name: slashName }),
  // Stored but never executed by the Worker — requires the (future) gateway service.
  z.object({
    type: z.literal("keyword"),
    name: slashName,
    keywords: z.array(z.string().min(1).max(100)).min(1).max(10),
    matchMode: z.enum(["contains", "exact", "starts_with"]),
  }),
]);

export type CommandTrigger = z.infer<typeof triggerSchema>;

// ---------------------------------------------------------------------------
// Top-level logic document (v1)
// ---------------------------------------------------------------------------

export const commandLogicV1Schema = z
  .object({
    version: z.literal(1),
    trigger: triggerSchema,
    conditions: z.array(conditionSchema).max(10).default([]),
    conditionMode: z.enum(["all", "any"]).default("all"),
    actions: z.array(actionSchema).min(1).max(5),
    /** Executed when conditions fail. Only `reply` is allowed here. */
    elseActions: z.array(replyAction).max(1).default([]),
    cooldown: z
      .object({
        seconds: z.number().int().min(0).max(86400),
        scope: z.enum(["user", "guild"]),
      })
      .default({ seconds: 0, scope: "user" }),
    requiredPermissions: permissionBitfield.nullable().default(null),
  })
  .refine((logic) => logic.actions.filter((a) => a.type === "reply").length <= 1, {
    message: "at most one reply action per command",
  });

export type CommandLogic = z.infer<typeof commandLogicV1Schema>;

/**
 * Parse and validate untrusted logic JSON. Used by the panel API on write and
 * by the executor on read (defense in depth against manual DB edits).
 */
export function parseCommandLogic(raw: unknown): CommandLogic {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return commandLogicV1Schema.parse(value);
}

export function safeParseCommandLogic(raw: unknown):
  | { success: true; data: CommandLogic }
  | { success: false; error: string } {
  try {
    return { success: true, data: parseCommandLogic(raw) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
