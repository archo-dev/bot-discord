import {
  AUTOMATION_EVENT_TTL_MS,
  automationEventContextSchema,
  automationWorkflowInputSchema,
  type AutomationEventContext,
  type AutomationExecutionDto,
  type AutomationRevisionDto,
  type AutomationStatsDto,
  type AutomationTriggerId,
  type AutomationWorkflowDto,
  type AutomationWorkflowInput,
} from "@bot/shared";

interface WorkflowRow {
  id: string; guild_id: string; name: string; description: string; enabled: number;
  trigger_type: AutomationTriggerId; trigger_config: string; conditions: string; condition_mode: "all" | "any";
  actions: string; cooldown_seconds: number; cooldown_scope: "user" | "guild" | "channel"; max_runs_per_minute: number;
  revision: number; failure_streak: number; circuit_open_until: string | null; created_by: string; updated_by: string;
  created_at: string; updated_at: string;
}

function snapshot(row: WorkflowRow): AutomationWorkflowInput {
  return automationWorkflowInputSchema.parse({
    schemaVersion: 1, name: row.name, description: row.description, enabled: row.enabled === 1,
    trigger: { type: row.trigger_type, config: JSON.parse(row.trigger_config) },
    conditions: JSON.parse(row.conditions), conditionMode: row.condition_mode, actions: JSON.parse(row.actions),
    cooldownSeconds: row.cooldown_seconds, cooldownScope: row.cooldown_scope, maxRunsPerMinute: row.max_runs_per_minute,
  });
}

export function automationWorkflowDto(row: WorkflowRow): AutomationWorkflowDto {
  return {
    ...snapshot(row), id: row.id, guildId: row.guild_id, revision: row.revision, failureStreak: row.failure_streak,
    circuitOpenUntil: row.circuit_open_until, createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listAutomationWorkflows(db: D1Database, guildId: string): Promise<AutomationWorkflowDto[]> {
  const rows = await db.prepare(`SELECT * FROM automation_workflows WHERE guild_id = ?1 ORDER BY updated_at DESC, name`).bind(guildId).all<WorkflowRow>();
  return rows.results.map(automationWorkflowDto);
}

export async function listEnabledAutomationWorkflows(db: D1Database, guildId: string, triggerType: AutomationTriggerId): Promise<AutomationWorkflowDto[]> {
  const rows = await db.prepare(
    `SELECT w.* FROM automation_workflows w
       JOIN guild_module_extensions m ON m.guild_id=w.guild_id AND m.module_id='automations' AND m.enabled=1
     WHERE w.guild_id = ?1 AND w.trigger_type = ?2 AND w.enabled = 1
       AND (w.circuit_open_until IS NULL OR w.circuit_open_until <= datetime('now')) ORDER BY w.id`,
  ).bind(guildId, triggerType).all<WorkflowRow>();
  return rows.results.map(automationWorkflowDto);
}

export async function listCronAutomationWorkflows(db:D1Database):Promise<AutomationWorkflowDto[]>{
  const rows=await db.prepare(`SELECT w.* FROM automation_workflows w JOIN guild_module_extensions m ON m.guild_id=w.guild_id AND m.module_id='automations' AND m.enabled=1 WHERE w.enabled=1 AND w.trigger_type='cron' AND (w.circuit_open_until IS NULL OR w.circuit_open_until<=datetime('now')) ORDER BY w.guild_id,w.id`).all<WorkflowRow>();
  return rows.results.map(automationWorkflowDto);
}

export async function listEnabledAutomationTriggerTypes(db:D1Database,guildId:string):Promise<AutomationTriggerId[]>{
  const rows=await db.prepare(`SELECT DISTINCT trigger_type FROM automation_workflows WHERE guild_id=?1 AND enabled=1`).bind(guildId).all<{trigger_type:AutomationTriggerId}>();return rows.results.map(r=>r.trigger_type);
}

export async function getAutomationWorkflow(db: D1Database, guildId: string, id: string): Promise<AutomationWorkflowDto | null> {
  const row = await db.prepare(`SELECT * FROM automation_workflows WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).first<WorkflowRow>();
  return row ? automationWorkflowDto(row) : null;
}

function values(input: AutomationWorkflowInput) {
  return [input.name, input.description, input.enabled ? 1 : 0, input.trigger.type, JSON.stringify(input.trigger.config), JSON.stringify(input.conditions), input.conditionMode, JSON.stringify(input.actions), input.cooldownSeconds, input.cooldownScope, input.maxRunsPerMinute] as const;
}

function revisionStatement(db: D1Database, workflowId: string, guildId: string, revision: number, data: AutomationWorkflowInput, changeType: string, actorId: string) {
  return db.prepare(
    `INSERT INTO automation_workflow_revisions (workflow_id, guild_id, revision, snapshot, change_type, changed_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(workflowId, guildId, revision, JSON.stringify(data), changeType, actorId);
}

export async function createAutomationWorkflow(db: D1Database, guildId: string, actorId: string, raw: AutomationWorkflowInput, changeType: "create" | "duplicate" | "import" = "create"): Promise<AutomationWorkflowDto> {
  const input = automationWorkflowInputSchema.parse(raw);
  const id = crypto.randomUUID();
  const v = values(input);
  await db.batch([
    db.prepare(
      `INSERT INTO automation_workflows
       (id, guild_id, name, description, enabled, trigger_type, trigger_config, conditions, condition_mode, actions,
        cooldown_seconds, cooldown_scope, max_runs_per_minute, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
    ).bind(id, guildId, ...v, actorId),
    revisionStatement(db, id, guildId, 1, input, changeType, actorId),
  ]);
  return (await getAutomationWorkflow(db, guildId, id))!;
}

export async function updateAutomationWorkflow(db: D1Database, guildId: string, id: string, actorId: string, raw: AutomationWorkflowInput, changeType: "update" | "enable" | "disable" = "update"): Promise<AutomationWorkflowDto | null> {
  const input = automationWorkflowInputSchema.parse(raw);
  const current = await getAutomationWorkflow(db, guildId, id);
  if (!current) return null;
  const nextRevision = current.revision + 1;
  const v = values(input);
  await db.batch([
    db.prepare(
      `UPDATE automation_workflows SET name=?3, description=?4, enabled=?5, trigger_type=?6, trigger_config=?7,
       conditions=?8, condition_mode=?9, actions=?10, cooldown_seconds=?11, cooldown_scope=?12,
       max_runs_per_minute=?13, revision=?14, updated_by=?15, updated_at=datetime('now'),
       failure_streak=CASE WHEN enabled=0 AND ?5=1 THEN 0 ELSE failure_streak END,
       circuit_open_until=CASE WHEN enabled=0 AND ?5=1 THEN NULL ELSE circuit_open_until END
       WHERE guild_id=?1 AND id=?2`,
    ).bind(guildId, id, ...v, nextRevision, actorId),
    revisionStatement(db, id, guildId, nextRevision, input, changeType, actorId),
  ]);
  return getAutomationWorkflow(db, guildId, id);
}

export async function deleteAutomationWorkflow(db: D1Database, guildId: string, id: string, actorId: string): Promise<boolean> {
  const current = await getAutomationWorkflow(db, guildId, id);
  if (!current) return false;
  await db.batch([
    revisionStatement(db, id, guildId, current.revision + 1, current, "delete", actorId),
    db.prepare(`DELETE FROM automation_scheduled_tasks WHERE guild_id=?1 AND workflow_id=?2 AND status IN ('pending','running')`).bind(guildId, id),
    db.prepare(`DELETE FROM automation_workflows WHERE guild_id=?1 AND id=?2`).bind(guildId, id),
  ]);
  return true;
}

export async function listAutomationRevisions(db: D1Database, guildId: string, workflowId: string): Promise<AutomationRevisionDto[]> {
  const rows = await db.prepare(
    `SELECT id, workflow_id, revision, snapshot, change_type, changed_by, created_at
     FROM automation_workflow_revisions WHERE guild_id=?1 AND workflow_id=?2 ORDER BY revision DESC LIMIT 50`,
  ).bind(guildId, workflowId).all<{id:number;workflow_id:string;revision:number;snapshot:string;change_type:string;changed_by:string;created_at:string}>();
  return rows.results.map((r) => ({ id:r.id, workflowId:r.workflow_id, revision:r.revision, snapshot:automationWorkflowInputSchema.parse(JSON.parse(r.snapshot)), changeType:r.change_type, changedBy:r.changed_by, createdAt:r.created_at }));
}

export interface AutomationQueueRow { id:string;guild_id:string;trigger_type:AutomationTriggerId;context:string;correlation_id:string;root_event_id:string;depth:number;expires_at:number;attempts:number; }

/**
 * Builds the durable queue write used beside a domain mutation in D1Database.batch().
 * The INSERT remains a no-op unless the module and a matching workflow are active,
 * so regular moderation and ticket writes keep constant cost while automation is off.
 */
export function subscribedAutomationEventStatement(db: D1Database, input: {
  id: string;
  guildId: string;
  triggerType: AutomationTriggerId;
  context: AutomationEventContext;
  enabled?: boolean;
  requirePreviousChange?: boolean;
}): D1PreparedStatement {
  const now = Date.now();
  const context = automationEventContextSchema.parse(input.context);
  const depth = context.event.depth ?? 0;
  const correlationId = crypto.randomUUID();
  return db.prepare(
    `INSERT OR IGNORE INTO automation_event_queue
       (id,guild_id,trigger_type,context,correlation_id,root_event_id,depth,expires_at,status,attempts,available_at,created_at,updated_at)
     SELECT ?1,?2,?3,?4,?5,?1,?6,?7,'queued',0,?8,?8,?8
     WHERE ?9=1 AND (?10=0 OR changes()=1)
       AND EXISTS (SELECT 1 FROM guild_module_extensions
         WHERE guild_id=?2 AND module_id='automations' AND enabled=1)
       AND EXISTS (SELECT 1 FROM automation_workflows
         WHERE guild_id=?2 AND trigger_type=?3 AND enabled=1)`,
  ).bind(
    input.id,
    input.guildId,
    input.triggerType,
    JSON.stringify(context),
    correlationId,
    depth,
    now + AUTOMATION_EVENT_TTL_MS,
    now,
    input.enabled === false ? 0 : 1,
    input.requirePreviousChange === true ? 1 : 0,
  );
}

export async function enqueueAutomationEvent(db: D1Database, input: { id?:string; guildId:string; triggerType:AutomationTriggerId; context:AutomationEventContext; correlationId?:string; rootEventId?:string; depth?:number; availableAt?:number }): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const now = Date.now();
  const context = automationEventContextSchema.parse(input.context);
  const depth = input.depth ?? context.event.depth ?? 0;
  await db.prepare(
    `INSERT OR IGNORE INTO automation_event_queue
     (id,guild_id,trigger_type,context,correlation_id,root_event_id,depth,expires_at,status,attempts,available_at,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'queued',0,?9,?10,?10)`,
  ).bind(id,input.guildId,input.triggerType,JSON.stringify(context),input.correlationId??crypto.randomUUID(),input.rootEventId??id,depth,now+AUTOMATION_EVENT_TTL_MS,input.availableAt??now,now).run();
  return id;
}

export async function claimAutomationEvents(db:D1Database, limit=10, now=Date.now()):Promise<AutomationQueueRow[]> {
  const rows=await db.prepare(
    `UPDATE automation_event_queue SET status='running',attempts=attempts+1,lease_until=?1,updated_at=?2
     WHERE id IN (SELECT id FROM automation_event_queue WHERE expires_at>?2 AND available_at<=?2
       AND (status='queued' OR (status='running' AND lease_until<?2)) ORDER BY available_at,id LIMIT ?3)
     RETURNING id,guild_id,trigger_type,context,correlation_id,root_event_id,depth,expires_at,attempts`,
  ).bind(now+30_000,now,limit).all<AutomationQueueRow>();
  return rows.results;
}

export async function finishAutomationEvent(db:D1Database,id:string,status:"succeeded"|"dead",errorCode:string|null=null):Promise<void>{
  await db.prepare(`UPDATE automation_event_queue SET status=?2,last_error_code=?3,lease_until=NULL,updated_at=?4 WHERE id=?1`).bind(id,status,errorCode,Date.now()).run();
}

export async function suppressAutomationEvent(db:D1Database,guildId:string,triggerType:"role_added"|"role_removed",scopeKey:string,ttlMs=120_000):Promise<void>{
  await db.prepare(`INSERT INTO automation_event_suppressions(guild_id,trigger_type,scope_key,expires_at) VALUES(?1,?2,?3,?4)
    ON CONFLICT(guild_id,trigger_type,scope_key) DO UPDATE SET expires_at=excluded.expires_at`).bind(guildId,triggerType,scopeKey,Date.now()+ttlMs).run();
}
export async function clearAutomationEventSuppression(db:D1Database,guildId:string,triggerType:"role_added"|"role_removed",scopeKey:string):Promise<void>{
  await db.prepare(`DELETE FROM automation_event_suppressions WHERE guild_id=?1 AND trigger_type=?2 AND scope_key=?3`).bind(guildId,triggerType,scopeKey).run();
}
export async function consumeAutomationEventSuppression(db:D1Database,guildId:string,triggerType:AutomationTriggerId,context:AutomationEventContext):Promise<boolean>{
  if((triggerType!=="role_added"&&triggerType!=="role_removed")||!context.user?.id||!context.role?.id)return false;
  const row=await db.prepare(`DELETE FROM automation_event_suppressions WHERE guild_id=?1 AND trigger_type=?2 AND scope_key=?3 AND expires_at>?4 RETURNING scope_key`)
    .bind(guildId,triggerType,`${context.user.id}:${context.role.id}`,Date.now()).first<{scope_key:string}>();
  return row!==null;
}
export async function retryAutomationEvent(db:D1Database,row:AutomationQueueRow,errorCode:string):Promise<void>{
  const dead=row.attempts>=5||row.expires_at<=Date.now();
  await db.prepare(`UPDATE automation_event_queue SET status=?2,last_error_code=?3,lease_until=NULL,available_at=?4,updated_at=?5 WHERE id=?1`)
    .bind(row.id,dead?"dead":"queued",errorCode,Date.now()+Math.min(60_000,1000*2**row.attempts),Date.now()).run();
}

export async function claimAutomationExecution(db:D1Database,input:{workflowId:string;guildId:string;eventId:string;correlationId:string;triggerType:AutomationTriggerId;scopeKey:string;actionsTotal:number}):Promise<string|null>{
  const id=crypto.randomUUID();
  const res=await db.prepare(
    `INSERT OR IGNORE INTO automation_executions
     (id,workflow_id,guild_id,event_id,correlation_id,scope_key,trigger_type,status,actions_total)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'running',?8)`,
  ).bind(id,input.workflowId,input.guildId,input.eventId,input.correlationId,input.scopeKey,input.triggerType,input.actionsTotal).run();
  return (res.meta.changes??0)===1?id:null;
}

export async function consumeAutomationLimit(db:D1Database,workflow:AutomationWorkflowDto,scopeKey:string,now=Date.now()):Promise<boolean>{
  const bucket=Math.floor(now/60_000);
  const rate=await db.prepare(
    `INSERT INTO automation_rate_limits(workflow_id,scope_key,bucket,count,last_run_at) VALUES(?1,'__workflow__',?2,1,?3)
     ON CONFLICT(workflow_id,scope_key,bucket) DO UPDATE SET count=count+1,last_run_at=?3 WHERE count<?4 RETURNING count`,
  ).bind(workflow.id,bucket,now,workflow.maxRunsPerMinute).first<{count:number}>();
  if(!rate)return false;
  if(workflow.cooldownSeconds===0)return true;
  const cooldown=await db.prepare(
    `INSERT INTO automation_rate_limits(workflow_id,scope_key,bucket,count,last_run_at) VALUES(?1,?2,0,1,?3)
     ON CONFLICT(workflow_id,scope_key,bucket) DO UPDATE SET count=count+1,last_run_at=?3
       WHERE last_run_at<=?4 RETURNING count`,
  ).bind(workflow.id,scopeKey,now,now-workflow.cooldownSeconds*1000).first<{count:number}>();
  return cooldown!==null;
}

export async function getAutomationActionStatus(db:D1Database,executionId:string,position:number):Promise<string|null>{
  const row=await db.prepare(`SELECT status FROM automation_action_runs WHERE execution_id=?1 AND position=?2`).bind(executionId,position).first<{status:string}>();
  return row?.status??null;
}
export async function startAutomationAction(db:D1Database,executionId:string,position:number,type:string):Promise<void>{
  await db.prepare(`INSERT INTO automation_action_runs(execution_id,position,action_type,status,attempts) VALUES(?1,?2,?3,'running',1)
    ON CONFLICT(execution_id,position) DO UPDATE SET status='running',attempts=attempts+1,started_at=datetime('now'),finished_at=NULL,error_code=NULL WHERE status='failed'`).bind(executionId,position,type).run();
}
export async function finishAutomationAction(db:D1Database,executionId:string,position:number,status:"succeeded"|"failed"|"skipped",durationMs:number,errorCode:string|null=null):Promise<void>{
  await db.prepare(`UPDATE automation_action_runs SET status=?3,duration_ms=?4,error_code=?5,finished_at=datetime('now') WHERE execution_id=?1 AND position=?2`).bind(executionId,position,status,durationMs,errorCode).run();
}

export async function finishAutomationExecution(db:D1Database,input:{executionId:string;workflowId:string;guildId:string;status:"succeeded"|"failed"|"skipped"|"simulated";actionsSucceeded:number;durationMs:number;errorCode?:string|null}):Promise<void>{
  await db.batch([
    db.prepare(`UPDATE automation_executions SET status=?2,actions_succeeded=?3,duration_ms=?4,error_code=?5,finished_at=datetime('now') WHERE id=?1`).bind(input.executionId,input.status,input.actionsSucceeded,input.durationMs,input.errorCode??null),
    db.prepare(
      `INSERT INTO automation_stats_daily(guild_id,workflow_id,day,executions,successes,failures,skipped,duration_ms_total)
       VALUES(?1,?2,date('now'),1,?3,?4,?5,?6)
       ON CONFLICT(guild_id,workflow_id,day) DO UPDATE SET executions=executions+1,successes=successes+excluded.successes,
       failures=failures+excluded.failures,skipped=skipped+excluded.skipped,duration_ms_total=duration_ms_total+excluded.duration_ms_total`,
    ).bind(input.guildId,input.workflowId,input.status==="succeeded"?1:0,input.status==="failed"?1:0,input.status==="skipped"?1:0,input.durationMs),
    db.prepare(
      `UPDATE automation_workflows SET failure_streak=CASE WHEN ?3='failed' THEN failure_streak+1 ELSE 0 END,
       circuit_open_until=CASE WHEN ?3='failed' AND failure_streak+1>=5 THEN datetime('now','+15 minutes') WHEN ?3='succeeded' THEN NULL ELSE circuit_open_until END
       WHERE guild_id=?1 AND id=?2`,
    ).bind(input.guildId,input.workflowId,input.status),
  ]);
}

export async function listAutomationExecutions(db:D1Database,guildId:string,workflowId:string|null=null):Promise<AutomationExecutionDto[]>{
  const rows=await db.prepare(
    `SELECT e.id,e.workflow_id,w.name AS workflow_name,e.correlation_id,e.trigger_type,e.status,e.actions_total,e.actions_succeeded,e.duration_ms,e.error_code,e.started_at,e.finished_at
     FROM automation_executions e LEFT JOIN automation_workflows w ON w.id=e.workflow_id
     WHERE e.guild_id=?1 AND (?2 IS NULL OR e.workflow_id=?2) ORDER BY e.started_at DESC,e.id DESC LIMIT 100`,
  ).bind(guildId,workflowId).all<Record<string,unknown>>();
  return rows.results.map((r:any)=>({id:r.id,workflowId:r.workflow_id,workflowName:r.workflow_name??"Workflow supprimé",correlationId:r.correlation_id,triggerType:r.trigger_type,status:r.status,actionsTotal:r.actions_total,actionsSucceeded:r.actions_succeeded,durationMs:r.duration_ms,errorCode:r.error_code,startedAt:r.started_at,finishedAt:r.finished_at}));
}

export async function getAutomationStats(db:D1Database,guildId:string,workflowId:string|null=null):Promise<AutomationStatsDto>{
  const r=await db.prepare(
    `SELECT COALESCE(SUM(executions),0) executions,COALESCE(SUM(successes),0) successes,COALESCE(SUM(failures),0) failures,
     COALESCE(SUM(skipped),0) skipped,COALESCE(SUM(duration_ms_total),0) duration_total
     FROM automation_stats_daily WHERE guild_id=?1 AND day>=date('now','-30 days') AND (?2 IS NULL OR workflow_id=?2)`,
  ).bind(guildId,workflowId).first<any>();
  return {executions:r?.executions??0,successes:r?.successes??0,failures:r?.failures??0,skipped:r?.skipped??0,averageDurationMs:(r?.executions??0)>0?Math.round(r.duration_total/r.executions):null};
}

export async function createAutomationTask(db:D1Database,input:{id:string;workflowId:string;guildId:string;runAt:number;payload:unknown}):Promise<void>{
  const now=Date.now();await db.prepare(`INSERT OR IGNORE INTO automation_scheduled_tasks(id,workflow_id,guild_id,run_at,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)`).bind(input.id,input.workflowId,input.guildId,input.runAt,JSON.stringify(input.payload),now).run();
}
export interface AutomationTaskRow{id:string;workflow_id:string;guild_id:string;run_at:number;attempts:number;payload:string;}
export async function claimAutomationTasks(db:D1Database,limit=20,now=Date.now()):Promise<AutomationTaskRow[]>{
  const r=await db.prepare(`UPDATE automation_scheduled_tasks SET status='running',attempts=attempts+1,lease_until=?1,updated_at=?2 WHERE id IN
  (SELECT id FROM automation_scheduled_tasks WHERE run_at<=?2 AND (status='pending' OR (status='running' AND lease_until<?2)) ORDER BY run_at LIMIT ?3)
  RETURNING id,workflow_id,guild_id,run_at,attempts,payload`).bind(now+30_000,now,limit).all<AutomationTaskRow>();return r.results;
}
export async function finishAutomationTask(db:D1Database,row:AutomationTaskRow,ok:boolean,errorCode:string|null=null):Promise<void>{
  const dead=!ok&&row.attempts>=5;await db.prepare(`UPDATE automation_scheduled_tasks SET status=?2,lease_until=NULL,last_error_code=?3,run_at=?4,updated_at=?5 WHERE id=?1`).bind(row.id,ok?"done":dead?"dead":"pending",errorCode,ok?row.run_at:Date.now()+Math.min(60_000,1000*2**row.attempts),Date.now()).run();
}

export async function insertAutomationLog(db:D1Database,guildId:string,executionId:string,message:string):Promise<void>{
  await db.prepare(`INSERT INTO gateway_events(guild_id,event_type,payload) VALUES(?1,'automation_log',?2)`).bind(guildId,JSON.stringify({executionId,message:message.slice(0,1000)})).run();
}

export async function purgeAutomationData(db:D1Database):Promise<{events:number;executions:number;stats:number;tasks:number}>{
  const r=await db.batch([
    db.prepare(`DELETE FROM automation_event_queue WHERE updated_at<?1`).bind(Date.now()-7*86400_000),
    db.prepare(`DELETE FROM automation_executions WHERE started_at<datetime('now','-90 days')`),
    db.prepare(`DELETE FROM automation_stats_daily WHERE day<date('now','-400 days')`),
    db.prepare(`DELETE FROM automation_scheduled_tasks WHERE status IN('done','dead') AND updated_at<?1`).bind(Date.now()-7*86400_000),
    db.prepare(`DELETE FROM automation_rate_limits WHERE last_run_at<?1`).bind(Date.now()-2*86400_000),
    db.prepare(`DELETE FROM automation_event_suppressions WHERE expires_at<?1`).bind(Date.now()),
  ]);return{events:r[0]!.meta.changes??0,executions:r[1]!.meta.changes??0,stats:r[2]!.meta.changes??0,tasks:r[3]!.meta.changes??0};
}
