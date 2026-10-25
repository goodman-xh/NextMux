import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDelegationRuntime, AgentToolRegistry, createAgentTaskContext, createAgentDelegationLedger,
  recordAgentDelegationCheckpoint, normalizeAgentDelegationLedger } from '../lib/index.js';
import type { AgentDelegateOutput, AgentDelegationRuntimeOptions } from '../lib/index.js';
function fixture(options: Partial<AgentDelegationRuntimeOptions> = {}) {
 const tools = new AgentToolRegistry();let calls=0,toolCalls=0;
 tools.register({name:'test.read',description:'read fixture',requiredPermission:'read_only',source:'builtin',inputSchema:{type:'object'}},async()=>{toolCalls++;return {modelOutput:'read',summary:{title:'read'}};});
 new AgentDelegationRuntime({tools,allowedToolNames:['test.read'],maxPermissionMode:'read_only',maxTurns:3,checkpointPolicy:'required',
  model:{async complete(){calls++;return {content:'Finished fixture.',usage:{inputTokens:13,outputTokens:4},usageKnown:true};}},...options}).register();
 const taskContext=createAgentTaskContext({workspaceRoot:'/fixture/parent',conversationId:'fixture-conversation',goal:'parent task',rootRunId:'fixture-root-001',depth:0,permissionMode:'read_only',allowedToolNames:['test.read']});
 return {tools,stats:()=>({calls,toolCalls}),async run(){return tools.execute({id:'delegate-fixture',name:'agent.delegate',arguments:{task:'read supplied fixture'}},'read_only',{runId:'fixture-parent-001',workspaceRoot:'/fixture/parent',taskContext});}};
}
test('required initial save failure sends zero model/tool calls and retains zero usage',async()=>{
 const f=fixture({persistCheckpoint:async()=>{throw Object.assign(new Error('injected disk full'),{code:'ENOSPC'});}}),result=await f.run(),out=result.output as AgentDelegateOutput;
 assert.equal(result.ok,true);assert.equal(out.status,'paused');assert.equal(out.stopReason,'checkpoint_persistence_failed');assert.equal(out.recoveryStatus,'unknown');assert.equal(out.receipt.retrySafe,false);assert.equal(out.resumeCheckpointId,undefined);assert.deepEqual(f.stats(),{calls:0,toolCalls:0});assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0});
});
test('missing persistence or unsafe handle is refused before billing',async()=>{
 for(const persistCheckpoint of [undefined,async()=>undefined,async()=>'/tmp/unsafe']){const f=fixture({persistCheckpoint}),r=await f.run(),out=r.output as AgentDelegateOutput;assert.equal(out.recoveryStatus,'unavailable');assert.equal(out.status,'paused');assert.equal(out.receipt.retrySafe,false);assert.equal(f.stats().calls,0);}
});
test('safe boundaries are awaited and lifecycle failures cannot replace the durability commit',async()=>{
 const order:string[]=[],metadata:any[]=[];const f=fixture({model:{async complete(){order.push('model');return{content:'Finished fixture.',usage:{inputTokens:13,outputTokens:4},usageKnown:true};}},onLifecycle:()=>{throw new Error('telemetry unavailable');},persistCheckpoint:async(cp,meta)=>{await Promise.resolve();order.push(meta.status);metadata.push({cp,meta});return 'resume-confirmed-'+metadata.length;}});const r=await f.run(),out=r.output as AgentDelegateOutput;
 assert.deepEqual(order,['running','model','completed']);assert.equal(out.recoveryStatus,'durable');assert.equal(out.resumeCheckpointId,'resume-confirmed-2');assert.deepEqual(out.usage,{inputTokens:13,outputTokens:4});for(const item of metadata){assert.equal(item.cp.runId,item.meta.childRunId);assert.equal(item.meta.rootRunId,'fixture-root-001');assert.equal(item.meta.parentRunId,'fixture-parent-001');assert.equal(item.meta.taskContext.conversationId,'fixture-conversation');}
});
test('a later boundary failure preserves real usage and prior confirmed handle without another request',async()=>{
 let modelCalls=0;const f=fixture({model:{async complete(){modelCalls++;return{toolCalls:[{id:'read-once',name:'test.read',arguments:{}}],usage:{inputTokens:21,outputTokens:5},usageKnown:true};}},persistCheckpoint:async(cp,meta)=>{assert.equal(meta.status,'running');if(cp.nextTurn>1)throw new Error('injected index commit failure');return 'resume-prior-confirmed';}});const r=await f.run(),out=r.output as AgentDelegateOutput;
 assert.equal(modelCalls,1);assert.equal(f.stats().toolCalls,1);assert.equal(out.status,'paused');assert.equal(out.recoveryStatus,'unknown');assert.equal(out.resumeCheckpointId,'resume-prior-confirmed');assert.equal(out.receipt.retrySafe,false);assert.deepEqual(out.usage,{inputTokens:21,outputTokens:5});assert.deepEqual(r.usage,out.usage);assert.equal(r.usageKnown,true);
});
test('terminal commit failure keeps the actual completed result and billed usage',async()=>{
 const f=fixture({persistCheckpoint:async(_cp,meta)=>{if(meta.status==='completed')throw new Error('injected terminal flush failure');return 'resume-before-model';}});const r=await f.run(),out=r.output as AgentDelegateOutput;
 assert.equal(f.stats().calls,1);assert.equal(out.status,'completed');assert.equal(out.finalText,'Finished fixture.');assert.equal(out.recoveryStatus,'unknown');assert.equal(out.resumeCheckpointId,'resume-before-model');assert.equal(out.receipt.outcome,'completed');assert.equal(out.receipt.retrySafe,false);assert.deepEqual(out.usage,{inputTokens:13,outputTokens:4});assert.deepEqual(r.usage,out.usage);assert.equal(r.usageKnown,true);
});
test('embedding callers retain terminal-only best-effort persistence unless required is selected',async()=>{
 const statuses:string[]=[];const f=fixture({checkpointPolicy:'best_effort',persistCheckpoint:async(_cp,meta)=>{statuses.push(meta.status);throw new Error('old optional store');}});const r=await f.run();assert.equal((r.output as AgentDelegateOutput).status,'completed');assert.equal(f.stats().calls,1);assert.deepEqual(statuses,['completed']);
});
test('owned checkpoint index retains real child identity and refuses a mismatched owner',()=>{
 const taskContext=createAgentTaskContext({workspaceRoot:'/fixture/child',conversationId:'fixture-conversation',goal:'child task',parentRunId:'fixture-parent-001',rootRunId:'fixture-root-001',depth:1,permissionMode:'read_only',allowedToolNames:[]});
 const metadata={childRunId:'fixture-child-001',parentRunId:'fixture-parent-001',rootRunId:'fixture-root-001',depth:1,status:'running' as const,taskContext};
 const ledger=recordAgentDelegationCheckpoint(createAgentDelegationLedger(metadata.rootRunId),metadata,'resume-child-confirmed');const normalized=normalizeAgentDelegationLedger(ledger)!;
 assert.equal(normalized.children[0].childRunId,metadata.childRunId);assert.equal(normalized.children[0].resumeCheckpointId,'resume-child-confirmed');assert.equal(normalized.children[0].recoveryStatus,'durable');assert.equal(normalized.children[0].status,'running');assert.equal(normalized.children[0].eventCount,0);
 assert.throws(()=>recordAgentDelegationCheckpoint(ledger,{...metadata,parentRunId:'another-parent'},'resume-invalid'),/ownership/);
 assert.throws(()=>recordAgentDelegationCheckpoint(ledger,{...metadata,taskContext:{...taskContext,workspaceRoot:'/other/child'}},'resume-invalid'),/owner changed/);
});

test('an interrupted child preserves known accrued usage and reports failed recovery without false resumability',async()=>{
 let calls=0;const events:any[]=[];const f=fixture({model:{async complete(request){calls++;if(calls===1){await request.onTextDelta?.('Investigated fixture config before failure.');return{toolCalls:[{id:'read-before-interruption',name:'test.read',arguments:{}}],usage:{inputTokens:9,outputTokens:3},usageKnown:true};}throw Object.assign(new Error('fixture provider failure'),{code:'UPSTREAM_FAILED'});}},onLifecycle:e=>{events.push(e);},persistCheckpoint:async(cp,meta)=>{if(meta.status==='failed')throw new Error('injected failed-state index error');return 'resume-confirmed-'+cp.nextTurn;}});
 const r=await f.run();assert.equal(r.ok,false);assert.equal(calls,2);assert.deepEqual(r.usage,{inputTokens:9,outputTokens:3});assert.equal(r.usageKnown,false);assert.equal(r.error?.childReceipt?.retrySafe,false);assert.equal(r.error?.params?.recoveryStatus,'unknown');assert.match(r.error?.message??'',/Partial progress:.*test\.read.*Investigated fixture config/);assert.match(r.error?.childReceipt?.summary??'',/Partial progress:.*test\.read.*Investigated fixture config/);const failure=events.at(-1);assert.equal(failure.type,'failed');assert.equal(failure.recoveryStatus,'unknown');assert.equal(failure.resumeCheckpointId,'resume-confirmed-2');assert.deepEqual(failure.usage,r.usage);assert.equal(failure.receipt.retrySafe,false);
});
