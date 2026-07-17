import {
  AUTOMATION_ACTIONS,
  AUTOMATION_CONDITIONS,
  AUTOMATION_TRIGGERS,
  renderAutomationTemplate,
  type AutomationAction,
  type AutomationActionId,
  type AutomationCondition,
  type AutomationConditionId,
  type AutomationEventContext,
  type AutomationTrigger,
  type AutomationTriggerId,
} from "@bot/shared";
import type { Env } from "../env.js";
import { DiscordAPIError, discordJson, discordRequest } from "../discord/rest.js";
import {
  cancelTicketReservation, clearAutomationEventSuppression, closeTicket, compensateFailedTicketClose, finalizeTicketChannel, getOpenTicketForUser,
  getTicketByChannel, getTicketById, getTicketSettings, insertAutomationLog, insertModAction, insertWarning, reserveTicket,
  suppressAutomationEvent,
} from "../db/queries.js";

export interface AutomationRuntimeContext {
  env: Env;
  workflowId: string;
  executionId: string;
  guildId: string;
  event: AutomationEventContext;
  dryRun: boolean;
}
export type AutomationActionOutcome = { kind: "continue"; preview: string } | { kind: "stop"; preview: string } | { kind: "defer"; seconds: number; preview: string };

type TriggerMatcher = (config: Record<string, unknown>, event: AutomationEventContext) => boolean;
type ConditionEvaluator = (config: Record<string, unknown>, event: AutomationEventContext, runtime: AutomationRuntimeContext) => boolean | Promise<boolean>;
type ActionExecutor = (config: Record<string, unknown>, runtime: AutomationRuntimeContext) => Promise<AutomationActionOutcome>;

const triggerRegistry = new Map<AutomationTriggerId, TriggerMatcher>();
const conditionRegistry = new Map<AutomationConditionId, ConditionEvaluator>();
const actionRegistry = new Map<AutomationActionId, ActionExecutor>();

export function registerAutomationTrigger(id:AutomationTriggerId,matcher:TriggerMatcher):void{if(triggerRegistry.has(id))throw new Error(`duplicate trigger ${id}`);triggerRegistry.set(id,matcher);}
export function registerAutomationCondition(id:AutomationConditionId,evaluator:ConditionEvaluator):void{if(conditionRegistry.has(id))throw new Error(`duplicate condition ${id}`);conditionRegistry.set(id,evaluator);}
export function registerAutomationAction(id:AutomationActionId,executor:ActionExecutor):void{if(actionRegistry.has(id))throw new Error(`duplicate action ${id}`);actionRegistry.set(id,executor);}

const sameOptional=(configured:unknown,actual:unknown)=>configured===undefined||configured===""||configured===actual;
for(const definition of AUTOMATION_TRIGGERS) registerAutomationTrigger(definition.id,(config,event)=>{
  if(event.event.type!==definition.id)return false;
  switch(definition.id){
    case"message_create":return sameOptional(config["channelId"],event.channel?.id)&&(!(config["ignoreBots"]??true)||event.user?.bot!==true);
    case"reaction_add":return sameOptional(config["emoji"],event.reaction?.emoji);
    case"role_added":case"role_removed":return sameOptional(config["roleId"],event.role?.id);
    case"button_pressed":case"select_menu":return sameOptional(config["customId"],event.component?.customId);
    case"slash_command_executed":return sameOptional(config["command"],event.command);
    default:return true;
  }
});

function readPath(value:unknown,path:string):unknown{return path.split(".").reduce<unknown>((v,k)=>v&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,value);}
function compare(actual:unknown,operator:string,expected:unknown):boolean{
  if(operator==="exists")return actual!==undefined&&actual!==null;
  if(operator==="eq")return String(actual)===String(expected);
  if(operator==="neq")return String(actual)!==String(expected);
  if(operator==="contains")return String(actual??"").includes(String(expected??""));
  const a=Number(actual),b=Number(expected);if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  return operator==="gt"?a>b:operator==="gte"?a>=b:operator==="lt"?a<b:operator==="lte"?a<=b:false;
}
function safeRegex(pattern:string):RegExp|null{if(pattern.length>200||/(\([^)]*[+*][^)]*\))[+*{]/.test(pattern))return null;try{return new RegExp(pattern,"i");}catch{return null;}}
function parseLiteral(raw:string):unknown{const v=raw.trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))return v.slice(1,-1);if(v==="true")return true;if(v==="false")return false;if(v==="null")return null;const n=Number(v);return Number.isFinite(n)?n:v;}
function booleanExpression(expression:string,event:AutomationEventContext):boolean{
  const clause=(raw:string)=>{const m=raw.trim().replace(/^\(+|\)+$/g,"").match(/^([a-zA-Z][\w.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);if(!m)return false;const op:Record<string,string>={"==":"eq","!=":"neq",">":"gt",">=":"gte","<":"lt","<=":"lte"};return compare(readPath(event,m[1]!),op[m[2]!]!,parseLiteral(m[3]!));};
  return expression.split("||").some((group)=>group.split("&&").every(clause));
}

registerAutomationCondition("user_has_role",(c,e)=>e.user?.roleIds?.includes(String(c["roleId"]))??false);
registerAutomationCondition("user_lacks_role",(c,e)=>!(e.user?.roleIds?.includes(String(c["roleId"]))??false));
registerAutomationCondition("channel_is",(c,e)=>e.channel?.id===c["channelId"]);
registerAutomationCondition("category_is",(c,e)=>e.channel?.categoryId===c["categoryId"]);
registerAutomationCondition("channel_name",(c,e)=>{const a=e.channel?.name??"",b=String(c["value"]);return c["operator"]==="contains"?a.includes(b):c["operator"]==="starts_with"?a.startsWith(b):a===b;});
registerAutomationCondition("message_contains",(c,e)=>{let a=e.message?.content??"",b=String(c["value"]);if(!c["caseSensitive"]){a=a.toLowerCase();b=b.toLowerCase();}return a.includes(b);});
registerAutomationCondition("message_starts_with",(c,e)=>{let a=e.message?.content??"",b=String(c["value"]);if(!c["caseSensitive"]){a=a.toLowerCase();b=b.toLowerCase();}return a.startsWith(b);});
registerAutomationCondition("regex",(c,e)=>safeRegex(String(c["pattern"]))?.test(e.message?.content??"")??false);
registerAutomationCondition("warn_count",async(c,e,r)=>{const count=e.warnCount??(e.user?((await r.env.DB.prepare(`SELECT COUNT(*) n FROM warnings WHERE guild_id=?1 AND user_id=?2 AND revoked_at IS NULL`).bind(r.guildId,e.user.id).first<{n:number}>())?.n??0):0);return compare(count,String(c["operator"]),c["value"]);});
registerAutomationCondition("account_age",(c,e)=>e.user?.accountCreatedAt?Date.now()-Date.parse(e.user.accountCreatedAt)>=Number(c["minimumDays"])*86400_000:false);
registerAutomationCondition("member_age",(c,e)=>e.user?.joinedAt?Date.now()-Date.parse(e.user.joinedAt)>=Number(c["minimumDays"])*86400_000:false);
registerAutomationCondition("is_bot",(c,e)=>(e.user?.bot??false)===c["value"]);
registerAutomationCondition("is_webhook",(c,e)=>(e.message?.webhook??false)===c["value"]);
registerAutomationCondition("hour",(c)=>{const h=new Date().getUTCHours(),from=Number(c["from"]),to=Number(c["to"]);return from<=to?h>=from&&h<=to:h>=from||h<=to;});
registerAutomationCondition("day",(c)=>Array.isArray(c["days"])&&(c["days"] as unknown[]).includes(new Date().getUTCDay()));
registerAutomationCondition("variable",(c,e)=>compare(readPath(e,String(c["path"])),String(c["operator"]),c["value"]));
registerAutomationCondition("boolean_expression",(c,e)=>booleanExpression(String(c["expression"]),e));

function rendered(config:Record<string,unknown>,event:AutomationEventContext):Record<string,unknown>{
  const walk=(v:unknown):unknown=>typeof v==="string"?renderAutomationTemplate(v,event as unknown as Record<string,unknown>):Array.isArray(v)?v.map(walk):v&&typeof v==="object"?Object.fromEntries(Object.entries(v as Record<string,unknown>).map(([k,x])=>[k,walk(x)])):v;
  return walk(config) as Record<string,unknown>;
}
function requiredId(event:AutomationEventContext,key:"user"|"channel"|"message"):string{const id=event[key]?.id;if(!id)throw new Error(`missing_${key}`);return id;}
async function okDiscord(env:Env,method:string,path:string,body?:unknown,reason?:string):Promise<void>{const res=await discordRequest(env,method,path,body,{auditLogReason:reason});if(!res.ok)throw new DiscordAPIError(res.status,await res.text(),path);}

interface DiscordRole{id:string;position:number;managed:boolean}
interface DiscordMember{roles:string[]}
async function assertBotHierarchy(runtime:AutomationRuntimeContext,userId:string,roleId?:string):Promise<void>{
  const guild=await discordJson<{owner_id:string}>(runtime.env,"GET",`/guilds/${runtime.guildId}`);if(userId===guild.owner_id)throw new Error("owner_protected");
  const [roles,bot,target]=await Promise.all([
    discordJson<DiscordRole[]>(runtime.env,"GET",`/guilds/${runtime.guildId}/roles`),
    discordJson<DiscordMember>(runtime.env,"GET",`/guilds/${runtime.guildId}/members/${runtime.env.DISCORD_CLIENT_ID}`),
    discordJson<DiscordMember>(runtime.env,"GET",`/guilds/${runtime.guildId}/members/${userId}`),
  ]);
  const positions=new Map(roles.map(r=>[r.id,r.position]));const top=(ids:string[])=>Math.max(0,...ids.map(id=>positions.get(id)??0));
  if(top(bot.roles)<=top(target.roles))throw new Error("bot_hierarchy_insufficient");
  if(roleId){const role=roles.find(r=>r.id===roleId);if(!role||role.managed||top(bot.roles)<=role.position)throw new Error("role_hierarchy_insufficient");}
}

function register(id:AutomationActionId,executor:ActionExecutor){registerAutomationAction(id,async(config,runtime)=>{const c=rendered(config,runtime.event);if(runtime.dryRun)return{kind:id==="stop_workflow"?"stop":id==="wait"?"defer":"continue",seconds:id==="wait"?Number(c["seconds"]):undefined,preview:`${id}: ${JSON.stringify(c).slice(0,300)}`} as AutomationActionOutcome;return executor(c,runtime);});}
register("send_message",async(c,r)=>{const channel=String(c["channelId"]??requiredId(r.event,"channel"));await okDiscord(r.env,"POST",`/channels/${channel}/messages`,{content:c["content"],allowed_mentions:{parse:[]}});return{kind:"continue",preview:`Message → ${channel}`};});
register("send_embed",async(c,r)=>{const channel=String(c["channelId"]??requiredId(r.event,"channel"));await okDiscord(r.env,"POST",`/channels/${channel}/messages`,{embeds:[{title:c["title"],description:c["description"],color:c["color"]}],allowed_mentions:{parse:[]}});return{kind:"continue",preview:`Embed → ${channel}`};});
register("send_dm",async(c,r)=>{const user=requiredId(r.event,"user");const dm=await discordJson<{id:string}>(r.env,"POST","/users/@me/channels",{recipient_id:user});await okDiscord(r.env,"POST",`/channels/${dm.id}/messages`,{content:c["content"],allowed_mentions:{parse:[]}});return{kind:"continue",preview:`DM → ${user}`};});
register("delete_message",async(_c,r)=>{await okDiscord(r.env,"DELETE",`/channels/${requiredId(r.event,"channel")}/messages/${requiredId(r.event,"message")}`);return{kind:"continue",preview:"Message supprimé"};});
register("add_role",async(c,r)=>{const user=requiredId(r.event,"user"),role=String(c["roleId"]),scope=`${user}:${role}`;await assertBotHierarchy(r,user,role);await suppressAutomationEvent(r.env.DB,r.guildId,"role_added",scope);try{await okDiscord(r.env,"PUT",`/guilds/${r.guildId}/members/${user}/roles/${role}`);}catch(error){await clearAutomationEventSuppression(r.env.DB,r.guildId,"role_added",scope);throw error;}return{kind:"continue",preview:`Rôle ${role} ajouté`};});
register("remove_role",async(c,r)=>{const user=requiredId(r.event,"user"),role=String(c["roleId"]),scope=`${user}:${role}`;await assertBotHierarchy(r,user,role);await suppressAutomationEvent(r.env.DB,r.guildId,"role_removed",scope);try{await okDiscord(r.env,"DELETE",`/guilds/${r.guildId}/members/${user}/roles/${role}`);}catch(error){await clearAutomationEventSuppression(r.env.DB,r.guildId,"role_removed",scope);throw error;}return{kind:"continue",preview:`Rôle ${role} retiré`};});
register("warn",async(c,r)=>{const user=requiredId(r.event,"user");const reason=String(c["reason"]);const warningId=await insertWarning(r.env.DB,r.guildId,user,"automation",reason);await insertModAction(r.env.DB,{guildId:r.guildId,action:"warn",targetId:user,moderatorId:"automation",reason,metadata:{warningId,workflowId:r.workflowId},source:"gateway"});return{kind:"continue",preview:`Warn ${warningId}`};});
register("timeout",async(c,r)=>{const user=requiredId(r.event,"user");await assertBotHierarchy(r,user);await okDiscord(r.env,"PATCH",`/guilds/${r.guildId}/members/${user}`,{communication_disabled_until:new Date(Date.now()+Number(c["seconds"])*1000).toISOString()},String(c["reason"]));await insertModAction(r.env.DB,{guildId:r.guildId,action:"timeout",targetId:user,moderatorId:"automation",reason:String(c["reason"]),source:"gateway",expiresAt:new Date(Date.now()+Number(c["seconds"])*1000).toISOString(),metadata:{workflowId:r.workflowId}});return{kind:"continue",preview:`Timeout ${c["seconds"]} s`};});
register("kick",async(c,r)=>{const user=requiredId(r.event,"user");await assertBotHierarchy(r,user);await okDiscord(r.env,"DELETE",`/guilds/${r.guildId}/members/${user}`,undefined,String(c["reason"]));await insertModAction(r.env.DB,{guildId:r.guildId,action:"kick",targetId:user,moderatorId:"automation",reason:String(c["reason"]),source:"gateway",metadata:{workflowId:r.workflowId}});return{kind:"continue",preview:"Membre expulsé"};});
register("ban",async(c,r)=>{const user=requiredId(r.event,"user");await assertBotHierarchy(r,user);await okDiscord(r.env,"PUT",`/guilds/${r.guildId}/bans/${user}`,{delete_message_seconds:c["deleteMessageSeconds"]},String(c["reason"]));await insertModAction(r.env.DB,{guildId:r.guildId,action:"ban",targetId:user,moderatorId:"automation",reason:String(c["reason"]),source:"gateway",metadata:{workflowId:r.workflowId}});return{kind:"continue",preview:"Membre banni"};});
register("create_ticket",async(c,r)=>{const user=requiredId(r.event,"user"),settings=await getTicketSettings(r.env.DB,r.guildId);if(!settings||settings.enabled!==1)throw new Error("tickets_disabled");const reservation=await reserveTicket(r.env.DB,{guildId:r.guildId,userId:user,categoryKey:"automation",formResponse:{subject:String(c["reason"]),details:`Workflow ${r.workflowId}`}});if(!reservation)throw new Error("ticket_already_open");let channel:string|undefined;try{const allow="3072",overwrites=[{id:r.guildId,type:0,deny:"1024"},{id:user,type:1,allow},...JSON.parse(settings.staff_role_ids).map((id:string)=>({id,type:0,allow})),{id:r.env.DISCORD_CLIENT_ID,type:1,allow:"117824"}];const created=await discordJson<{id:string}>(r.env,"POST",`/guilds/${r.guildId}/channels`,{name:`ticket-${reservation.number}`,type:0,parent_id:settings.category_id,permission_overwrites:overwrites});channel=created.id;if(!await finalizeTicketChannel(r.env.DB,r.guildId,reservation.id,reservation.placeholderChannelId,channel))throw new Error("ticket_finalize_failed");return{kind:"continue",preview:`Ticket ${reservation.id}`};}catch(error){if(channel)await discordRequest(r.env,"DELETE",`/channels/${channel}`).catch(()=>undefined);await cancelTicketReservation(r.env.DB,reservation.id,r.guildId,user);throw error;}});
register("close_ticket",async(c,r)=>{const ticket=r.event.ticket?.id?await getTicketById(r.env.DB,r.guildId,r.event.ticket.id):r.event.channel?.id?await getTicketByChannel(r.env.DB,r.guildId,r.event.channel.id):r.event.user?await getOpenTicketForUser(r.env.DB,r.guildId,r.event.user.id):null;if(!ticket)throw new Error("ticket_not_found");if(!await closeTicket(r.env.DB,r.guildId,ticket.id,"automation",String(c["reason"]),"Fermé par une automatisation."))throw new Error("ticket_already_closed");try{await okDiscord(r.env,"DELETE",`/channels/${ticket.channel_id}`);}catch(error){await compensateFailedTicketClose(r.env.DB,ticket);throw error;}return{kind:"continue",preview:`Ticket ${ticket.id} fermé`};});
register("create_log",async(c,r)=>{await insertAutomationLog(r.env.DB,r.guildId,r.executionId,String(c["message"]));return{kind:"continue",preview:"Log créé"};});
register("add_reaction",async(c,r)=>{await okDiscord(r.env,"PUT",`/channels/${requiredId(r.event,"channel")}/messages/${requiredId(r.event,"message")}/reactions/${encodeURIComponent(String(c["emoji"]))}/@me`);return{kind:"continue",preview:`Réaction ${c["emoji"]}`};});
register("modify_nickname",async(c,r)=>{const user=requiredId(r.event,"user");await assertBotHierarchy(r,user);await okDiscord(r.env,"PATCH",`/guilds/${r.guildId}/members/${user}`,{nick:c["nickname"]});return{kind:"continue",preview:"Pseudo modifié"};});
register("modify_slowmode",async(c,r)=>{const channel=requiredId(r.event,"channel");await okDiscord(r.env,"PATCH",`/channels/${channel}`,{rate_limit_per_user:c["seconds"]});return{kind:"continue",preview:`Slowmode ${c["seconds"]} s`};});
register("create_thread",async(c,r)=>{const channel=requiredId(r.event,"channel");await okDiscord(r.env,"POST",`/channels/${channel}/threads`,{name:c["name"],auto_archive_duration:c["autoArchiveMinutes"],type:11});return{kind:"continue",preview:`Thread ${c["name"]}`};});
register("call_webhook",async(c)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const res=await fetch(String(c["url"]),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(c["body"]),redirect:"error",signal:controller.signal});if(!res.ok)throw new Error(`webhook_http_${res.status}`);}finally{clearTimeout(timer);}return{kind:"continue",preview:"Webhook appelé"};});
register("wait",async(c)=>({kind:"defer",seconds:Number(c["seconds"]),preview:`Attente ${c["seconds"]} s`}));
register("stop_workflow",async()=>({kind:"stop",preview:"Workflow arrêté"}));

export function matchesAutomationTrigger(trigger:AutomationTrigger,event:AutomationEventContext):boolean{const matcher=triggerRegistry.get(trigger.type);if(!matcher)throw new Error(`trigger_not_registered:${trigger.type}`);return matcher(trigger.config,event);}
export async function evaluateAutomationCondition(condition:AutomationCondition,runtime:AutomationRuntimeContext):Promise<boolean>{const evaluator=conditionRegistry.get(condition.type);if(!evaluator)throw new Error(`condition_not_registered:${condition.type}`);const result=await evaluator(condition.config,runtime.event,runtime);return condition.negate?!result:result;}
export async function executeAutomationAction(action:AutomationAction,runtime:AutomationRuntimeContext):Promise<AutomationActionOutcome>{const executor=actionRegistry.get(action.type);if(!executor)throw new Error(`action_not_registered:${action.type}`);return executor(action.config,runtime);}
export function assertAutomationRegistryComplete():void{for(const d of AUTOMATION_TRIGGERS)if(!triggerRegistry.has(d.id))throw new Error(`missing trigger ${d.id}`);for(const d of AUTOMATION_CONDITIONS)if(!conditionRegistry.has(d.id))throw new Error(`missing condition ${d.id}`);for(const d of AUTOMATION_ACTIONS)if(!actionRegistry.has(d.id))throw new Error(`missing action ${d.id}`);}
