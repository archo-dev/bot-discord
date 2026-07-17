import type { AutomationEventContext } from "@bot/shared";
import type { Env } from "../env.js";
import { isGuildModuleEnabled, listEnabledAutomationTriggerTypes } from "../db/queries.js";
import { dispatchAutomationEvent, processAutomationRuntime } from "./engine.js";

/** Worker-side producer for HTTP interactions. Domain mutations (tickets/warns)
 * enqueue transactionally in their existing D1 helpers; this covers slash/components. */
export async function emitWorkerAutomationEvent(env:Env,guildId:string,context:AutomationEventContext):Promise<void>{
  if(!await isGuildModuleEnabled(env.DB,guildId,"automations"))return;
  if(!(await listEnabledAutomationTriggerTypes(env.DB,guildId)).includes(context.event.type))return;
  await dispatchAutomationEvent(env,{guildId,context});
  await processAutomationRuntime(env);
}
