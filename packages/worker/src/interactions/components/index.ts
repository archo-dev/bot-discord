import type { APIMessageComponentInteraction, APIModalSubmitInteraction } from "discord-api-types/v10";
import type { Env } from "../../env.js";
import { openTicket, promptCloseTicket, submitCloseTicket } from "./tickets.js";
import { toggleButtonRole } from "./button-roles.js";
import type { ModuleId } from "@bot/shared";

/**
 * Message-component (type 3) and modal-submit (type 5) dispatch, keyed by
 * custom_id. Entries ending with ":" are prefixes carrying a parameter
 * (`ticket:closec:<id>`); the rest match exactly.
 */
export interface ComponentContext<I> {
  env: Env;
  interaction: I;
  waitUntil: (p: Promise<unknown>) => void;
}

type ComponentHandler = (ctx: ComponentContext<APIMessageComponentInteraction>) => Promise<Response>;
type ModalHandler = (ctx: ComponentContext<APIModalSubmitInteraction>) => Promise<Response>;

const componentHandlers: Array<{ id: string; handler: ComponentHandler }> = [
  { id: "ticket:open", handler: openTicket },
  { id: "ticket:close", handler: promptCloseTicket },
  { id: "brole:", handler: toggleButtonRole },
];

const modalHandlers: Array<{ id: string; handler: ModalHandler }> = [
  { id: "ticket:closec:", handler: submitCloseTicket },
];

function matches(customId: string, id: string): boolean {
  return id.endsWith(":") ? customId.startsWith(id) : customId === id;
}

export function findComponentHandler(customId: string): ComponentHandler | undefined {
  return componentHandlers.find((h) => matches(customId, h.id))?.handler;
}

export function findModalHandler(customId: string): ModalHandler | undefined {
  return modalHandlers.find((h) => matches(customId, h.id))?.handler;
}

export function moduleForComponent(customId: string): ModuleId | null {
  if (customId.startsWith("ticket:")) return "tickets";
  if (customId.startsWith("brole:")) return "button_roles";
  return null;
}
