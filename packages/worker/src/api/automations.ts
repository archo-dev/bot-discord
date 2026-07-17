import { Hono } from "hono";
import { z } from "zod";
import {
  AUTOMATION_CATALOG, automationEventContextSchema, automationWorkflowInputSchema,
  type AutomationExportEnvelope,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";
import {
  createAutomationWorkflow, deleteAutomationWorkflow, getAutomationStats, getAutomationWorkflow, insertAdminAudit,
  listAutomationExecutions, listAutomationRevisions, listAutomationWorkflows, updateAutomationWorkflow,
} from "../db/queries.js";
import { simulateAutomationWorkflow } from "../automation/engine.js";

export const automationsRouter = new Hono<AppContext>();
const idSchema=z.string().uuid();
const stateSchema=z.object({enabled:z.boolean()});
const importSchema=z.object({format:z.literal("botdiscord-automation"),version:z.literal(1),workflow:automationWorkflowInputSchema});

function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
async function audit(c:any,method:"POST"|"PUT"|"PATCH"|"DELETE",targetId:string|null,status:number,outcome:"success"|"error"="success"){
  await insertAdminAudit(c.env.DB,{guildId:c.req.param("guildId"),actorId:c.get("session").userId,actorAccess:c.get("guildAccess"),capability:"automations_write",method,targetType:"automation",targetId,outcome,status,requestId:c.get("requestId")});
}

automationsRouter.get("/guilds/:guildId/automations/catalog",(c)=>c.json(AUTOMATION_CATALOG));
automationsRouter.get("/guilds/:guildId/automations",async(c)=>c.json(await listAutomationWorkflows(c.env.DB,c.req.param("guildId"))));
automationsRouter.get("/guilds/:guildId/automations/executions",async(c)=>c.json(await listAutomationExecutions(c.env.DB,c.req.param("guildId"),c.req.query("workflowId")??null)));
automationsRouter.get("/guilds/:guildId/automations/stats",async(c)=>c.json(await getAutomationStats(c.env.DB,c.req.param("guildId"),c.req.query("workflowId")??null)));

automationsRouter.post("/guilds/:guildId/automations/import/validate",rateLimit({name:"automation-import-validate",limit:20}),async(c)=>{
  const parsed=importSchema.safeParse(await c.req.json().catch(()=>null));return parsed.success?c.json({valid:true,workflow:parsed.data.workflow,warnings:parsed.data.workflow.enabled?["L’import conserve l’état actif demandé."]:[]}):c.json({valid:false,error:parsed.error.message},400);
});
automationsRouter.post("/guilds/:guildId/automations/import",rateLimit({name:"automation-import",limit:10}),async(c)=>{
  const parsed=importSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:"invalid_import",details:parsed.error.message},400);
  try{const workflow=await createAutomationWorkflow(c.env.DB,c.req.param("guildId"),c.get("session").userId,parsed.data.workflow,"import");await audit(c,"POST",workflow.id,201);return c.json(workflow,201);}catch(error){await audit(c,"POST",null,409,"error");return c.json({error:errorMessage(error).includes("UNIQUE")?"duplicate_name":"import_failed"},409);}
});

automationsRouter.post("/guilds/:guildId/automations",rateLimit({name:"automation-write",limit:20}),async(c)=>{
  const parsed=automationWorkflowInputSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:"invalid_workflow",details:parsed.error.message},400);
  try{const workflow=await createAutomationWorkflow(c.env.DB,c.req.param("guildId"),c.get("session").userId,parsed.data);await audit(c,"POST",workflow.id,201);return c.json(workflow,201);}catch(error){await audit(c,"POST",null,409,"error");return c.json({error:errorMessage(error).includes("UNIQUE")?"duplicate_name":"create_failed"},409);}
});

automationsRouter.get("/guilds/:guildId/automations/:id",async(c)=>{const id=idSchema.safeParse(c.req.param("id"));if(!id.success)return c.json({error:"invalid_id"},400);const workflow=await getAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data);return workflow?c.json(workflow):c.json({error:"not_found"},404);});
automationsRouter.put("/guilds/:guildId/automations/:id",rateLimit({name:"automation-write",limit:20}),async(c)=>{
  const id=idSchema.safeParse(c.req.param("id")),body=automationWorkflowInputSchema.safeParse(await c.req.json().catch(()=>null));if(!id.success||!body.success)return c.json({error:"invalid_workflow",details:body.success?undefined:body.error.message},400);
  try{const workflow=await updateAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data,c.get("session").userId,body.data);if(!workflow)return c.json({error:"not_found"},404);await audit(c,"PUT",id.data,200);return c.json(workflow);}catch(error){await audit(c,"PUT",id.data,409,"error");return c.json({error:errorMessage(error).includes("UNIQUE")?"duplicate_name":"update_failed"},409);}
});
automationsRouter.patch("/guilds/:guildId/automations/:id/state",rateLimit({name:"automation-state",limit:30}),async(c)=>{
  const id=idSchema.safeParse(c.req.param("id")),state=stateSchema.safeParse(await c.req.json().catch(()=>null));if(!id.success||!state.success)return c.json({error:"invalid_body"},400);const current=await getAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data);if(!current)return c.json({error:"not_found"},404);const workflow=await updateAutomationWorkflow(c.env.DB,current.guildId,current.id,c.get("session").userId,{...current,enabled:state.data.enabled},state.data.enabled?"enable":"disable");await audit(c,"PATCH",id.data,200);return c.json(workflow);
});
automationsRouter.post("/guilds/:guildId/automations/:id/duplicate",rateLimit({name:"automation-write",limit:20}),async(c)=>{
  const id=idSchema.safeParse(c.req.param("id"));if(!id.success)return c.json({error:"invalid_id"},400);const current=await getAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data);if(!current)return c.json({error:"not_found"},404);let suffix=1,name=`${current.name} (copie)`;const names=new Set((await listAutomationWorkflows(c.env.DB,current.guildId)).map(w=>w.name));while(names.has(name))name=`${current.name} (copie ${++suffix})`;const workflow=await createAutomationWorkflow(c.env.DB,current.guildId,c.get("session").userId,{...current,name,enabled:false},"duplicate");await audit(c,"POST",workflow.id,201);return c.json(workflow,201);
});
automationsRouter.delete("/guilds/:guildId/automations/:id",rateLimit({name:"automation-write",limit:20}),async(c)=>{const id=idSchema.safeParse(c.req.param("id"));if(!id.success)return c.json({error:"invalid_id"},400);if(!await deleteAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data,c.get("session").userId))return c.json({error:"not_found"},404);await audit(c,"DELETE",id.data,204);return c.body(null,204);});
automationsRouter.get("/guilds/:guildId/automations/:id/revisions",async(c)=>{const id=idSchema.safeParse(c.req.param("id"));return id.success?c.json(await listAutomationRevisions(c.env.DB,c.req.param("guildId"),id.data)):c.json({error:"invalid_id"},400);});
automationsRouter.get("/guilds/:guildId/automations/:id/export",async(c)=>{const id=idSchema.safeParse(c.req.param("id"));if(!id.success)return c.json({error:"invalid_id"},400);const workflow=await getAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data);if(!workflow)return c.json({error:"not_found"},404);const envelope:AutomationExportEnvelope={format:"botdiscord-automation",version:1,exportedAt:new Date().toISOString(),workflow:automationWorkflowInputSchema.parse(workflow)};return c.json(envelope,200,{"content-disposition":`attachment; filename="automation-${workflow.id}.json"`});});
automationsRouter.post("/guilds/:guildId/automations/:id/simulate",rateLimit({name:"automation-simulate",limit:30}),async(c)=>{const id=idSchema.safeParse(c.req.param("id")),context=automationEventContextSchema.safeParse(await c.req.json().catch(()=>null));if(!id.success||!context.success)return c.json({error:"invalid_simulation",details:context.success?undefined:context.error.message},400);const workflow=await getAutomationWorkflow(c.env.DB,c.req.param("guildId"),id.data);if(!workflow)return c.json({error:"not_found"},404);const result=await simulateAutomationWorkflow(c.env,workflow,context.data);await audit(c,"POST",id.data,200);return c.json(result);});
