import {
  AUTOMATION_MAX_DEPTH,
  automationEventContextSchema,
  type AutomationEventContext,
  type AutomationSimulationResult,
  type AutomationWorkflowDto,
} from "@bot/shared";
import type { Env } from "../env.js";
import {
  claimAutomationEvents, claimAutomationExecution, claimAutomationTasks, consumeAutomationEventSuppression, consumeAutomationLimit, createAutomationTask,
  enqueueAutomationEvent, finishAutomationAction, finishAutomationEvent, finishAutomationExecution, finishAutomationTask,
  getAutomationActionStatus, getAutomationWorkflow, listCronAutomationWorkflows, listEnabledAutomationWorkflows, retryAutomationEvent, startAutomationAction,
  type AutomationQueueRow, type AutomationTaskRow,
} from "../db/queries.js";
import { assertAutomationRegistryComplete, evaluateAutomationCondition, executeAutomationAction, matchesAutomationTrigger, type AutomationRuntimeContext } from "./registry.js";

assertAutomationRegistryComplete();

function errorCode(error:unknown):string{return(error instanceof Error?error.message:"internal_error").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,100);}
function scopeKey(workflow:AutomationWorkflowDto,event:AutomationEventContext):string{
  if(workflow.cooldownScope==="guild")return`guild:${workflow.guildId}`;
  if(workflow.cooldownScope==="channel")return`channel:${event.channel?.id??"none"}`;
  return`user:${event.user?.id??"none"}`;
}

interface ResumePayload {kind:"resume";executionId:string;eventId:string;correlationId:string;context:AutomationEventContext;nextIndex:number;startedAt:number;actionsSucceeded:number;}

async function runActions(env:Env,workflow:AutomationWorkflowDto,eventId:string,correlationId:string,context:AutomationEventContext,executionId:string,startIndex:number,startedAt:number,initialSucceeded:number,dryRun=false,finalizeFailure=true):Promise<{deferred:boolean;previews:string[]}>{
  let succeeded=initialSucceeded;const previews:string[]=[];
  const runtime:AutomationRuntimeContext={env,workflowId:workflow.id,executionId,guildId:workflow.guildId,event:context,dryRun};
  for(let i=startIndex;i<workflow.actions.length;i++){
    const action=workflow.actions[i]!,began=Date.now();
    if(!dryRun&&await getAutomationActionStatus(env.DB,executionId,i)==="succeeded"){succeeded++;continue;}
    if(!dryRun)await startAutomationAction(env.DB,executionId,i,action.type);
    try{
      const outcome=await executeAutomationAction(action,runtime);previews.push(outcome.preview);succeeded++;
      if(!dryRun)await finishAutomationAction(env.DB,executionId,i,"succeeded",Date.now()-began);
      if(outcome.kind==="stop")break;
      if(outcome.kind==="defer"){
        if(dryRun)continue;
        const payload:ResumePayload={kind:"resume",executionId,eventId,correlationId,context,nextIndex:i+1,startedAt,actionsSucceeded:succeeded};
        await createAutomationTask(env.DB,{id:`${executionId}:${i}`,workflowId:workflow.id,guildId:workflow.guildId,runAt:Date.now()+outcome.seconds*1000,payload});
        return{deferred:true,previews};
      }
    }catch(error){
      const code=errorCode(error);if(!dryRun)await finishAutomationAction(env.DB,executionId,i,"failed",Date.now()-began,code);
      if(action.continueOnError)continue;
      if(!dryRun&&finalizeFailure)await finishAutomationExecution(env.DB,{executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"failed",actionsSucceeded:succeeded,durationMs:Date.now()-startedAt,errorCode:code});
      throw error;
    }
  }
  if(!dryRun)await finishAutomationExecution(env.DB,{executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"succeeded",actionsSucceeded:succeeded,durationMs:Date.now()-startedAt});
  return{deferred:false,previews};
}

async function executeWorkflow(env:Env,workflow:AutomationWorkflowDto,row:AutomationQueueRow,context:AutomationEventContext):Promise<void>{
  if(!matchesAutomationTrigger(workflow.trigger,context))return;
  const startedAt=Date.now(),scope=scopeKey(workflow,context);
  const executionId=await claimAutomationExecution(env.DB,{workflowId:workflow.id,guildId:workflow.guildId,eventId:row.id,correlationId:row.correlation_id,triggerType:row.trigger_type,scopeKey:scope,actionsTotal:workflow.actions.length});
  if(!executionId)return;
  const runtime:AutomationRuntimeContext={env,workflowId:workflow.id,executionId,guildId:workflow.guildId,event:context,dryRun:false};
  try{
    const results=await Promise.all(workflow.conditions.map(c=>evaluateAutomationCondition(c,runtime)));
    const matched=results.length===0||(workflow.conditionMode==="all"?results.every(Boolean):results.some(Boolean));
    if(!matched){await finishAutomationExecution(env.DB,{executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"skipped",actionsSucceeded:0,durationMs:Date.now()-startedAt,errorCode:"conditions_not_met"});return;}
    if(!await consumeAutomationLimit(env.DB,workflow,scope)){await finishAutomationExecution(env.DB,{executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"skipped",actionsSucceeded:0,durationMs:Date.now()-startedAt,errorCode:"rate_limited"});return;}
    await runActions(env,workflow,row.id,row.correlation_id,context,executionId,0,startedAt,0);
  }catch(error){
    const existing=await env.DB.prepare(`SELECT status FROM automation_executions WHERE id=?1`).bind(executionId).first<{status:string}>();
    if(existing?.status==="running")await finishAutomationExecution(env.DB,{executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"failed",actionsSucceeded:0,durationMs:Date.now()-startedAt,errorCode:errorCode(error)});
  }
}

async function processEvent(env:Env,row:AutomationQueueRow):Promise<void>{
  if(row.depth>AUTOMATION_MAX_DEPTH){await finishAutomationEvent(env.DB,row.id,"dead","max_depth");return;}
  const context=automationEventContextSchema.parse(JSON.parse(row.context));
  if(await consumeAutomationEventSuppression(env.DB,row.guild_id,row.trigger_type,context)){await finishAutomationEvent(env.DB,row.id,"succeeded","loop_suppressed");return;}
  const workflows=await listEnabledAutomationWorkflows(env.DB,row.guild_id,row.trigger_type);
  for(const workflow of workflows)await executeWorkflow(env,workflow,row,context);
  await finishAutomationEvent(env.DB,row.id,"succeeded");
}

async function resumeTask(env:Env,row:AutomationTaskRow,payload:ResumePayload):Promise<void>{
  const workflow=await getAutomationWorkflow(env.DB,row.guild_id,row.workflow_id);if(!workflow||!workflow.enabled){await finishAutomationTask(env.DB,row,true,"workflow_disabled");return;}
  try{await runActions(env,workflow,payload.eventId,payload.correlationId,automationEventContextSchema.parse(payload.context),payload.executionId,payload.nextIndex,payload.startedAt,payload.actionsSucceeded,false,false);await finishAutomationTask(env.DB,row,true);}catch(error){
    const code=errorCode(error);
    if(row.attempts>=5)await finishAutomationExecution(env.DB,{executionId:payload.executionId,workflowId:workflow.id,guildId:workflow.guildId,status:"failed",actionsSucceeded:payload.actionsSucceeded,durationMs:Date.now()-payload.startedAt,errorCode:code});
    await finishAutomationTask(env.DB,row,false,code);
  }
}

function cronPart(part:string,value:number,min:number,max:number):boolean{
  return part.split(",").some(token=>{const[base,stepRaw]=token.split("/"),step=stepRaw?Number(stepRaw):1;if(!Number.isInteger(step)||step<1)return false;let from=min,to=max;if(base!=="*"){if(base?.includes("-")){const[a,b]=base.split("-").map(Number);from=a!;to=b!;}else from=to=Number(base);}return value>=from&&value<=to&&(value-from)%step===0;});
}
export function cronMatches(expression:string,date:Date):boolean{const p=expression.trim().split(/\s+/);return p.length===5&&cronPart(p[0]!,date.getUTCMinutes(),0,59)&&cronPart(p[1]!,date.getUTCHours(),0,23)&&cronPart(p[2]!,date.getUTCDate(),1,31)&&cronPart(p[3]!,date.getUTCMonth()+1,1,12)&&cronPart(p[4]!,date.getUTCDay(),0,6);}

export async function enqueueDueCronAutomations(env:Env,now=new Date()):Promise<number>{
  const minute=Math.floor(now.getTime()/60_000)*60_000;let count=0;
  for(const workflow of await listCronAutomationWorkflows(env.DB)){const expression=String(workflow.trigger.config["cron"]);if(!cronMatches(expression,now))continue;const id=`cron:${workflow.id}:${minute}`;await enqueueAutomationEvent(env.DB,{id,guildId:workflow.guildId,triggerType:"cron",context:{event:{type:"cron",id,depth:0},guild:{id:workflow.guildId}},correlationId:crypto.randomUUID(),rootEventId:id,availableAt:minute});count++;}
  return count;
}

export async function processAutomationRuntime(env:Env):Promise<void>{
  const tasks=await claimAutomationTasks(env.DB);for(const task of tasks){try{const payload=JSON.parse(task.payload) as ResumePayload;if(payload.kind!=="resume")throw new Error("invalid_task_payload");await resumeTask(env,task,payload);}catch(error){await finishAutomationTask(env.DB,task,false,errorCode(error));}}
  for(let batch=0;batch<3;batch++){const rows=await claimAutomationEvents(env.DB);if(rows.length===0)break;for(const row of rows){try{await processEvent(env,row);}catch(error){await retryAutomationEvent(env.DB,row,errorCode(error));}}}
}

export async function dispatchAutomationEvent(env:Env,input:{guildId:string;context:AutomationEventContext;id?:string;correlationId?:string;rootEventId?:string;depth?:number}):Promise<string>{
  return enqueueAutomationEvent(env.DB,{id:input.id,guildId:input.guildId,triggerType:input.context.event.type,context:input.context,correlationId:input.correlationId,rootEventId:input.rootEventId,depth:input.depth});
}

export async function simulateAutomationWorkflow(env:Env,workflow:AutomationWorkflowDto,rawContext:AutomationEventContext):Promise<AutomationSimulationResult>{
  const context=automationEventContextSchema.parse(rawContext),runtime:AutomationRuntimeContext={env,workflowId:workflow.id,executionId:"simulation",guildId:workflow.guildId,event:context,dryRun:true};
  const conditionResults=[] as AutomationSimulationResult["conditionResults"];
  for(const condition of workflow.conditions)conditionResults.push({type:condition.type,matched:await evaluateAutomationCondition(condition,runtime)});
  const matched=matchesAutomationTrigger(workflow.trigger,context)&&(conditionResults.length===0||(workflow.conditionMode==="all"?conditionResults.every(r=>r.matched):conditionResults.some(r=>r.matched)));
  const actions=[] as AutomationSimulationResult["actions"];
  if(matched){for(const action of workflow.actions){const outcome=await executeAutomationAction(action,runtime);actions.push({type:action.type,preview:outcome.preview});if(outcome.kind==="stop")break;}}
  return{matched,conditionResults,actions,warnings:["Simulation sans effet Discord ni écriture métier.",...(context.event.depth>=AUTOMATION_MAX_DEPTH?["Profondeur maximale atteinte."]:[])]};
}
