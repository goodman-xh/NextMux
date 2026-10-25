import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry, WorkspaceToolRuntime } from '@nextmux/agent-runtime';
import { agentRunFileCheckpointIds, finalizeInterruptedAgentCheckpoint } from '../lib/node/nextmux-interrupted-checkpoint.js';

const checkpoint = () => ({ version:1,runId:'run-interrupted-test',nextTurn:3,segment:1,messages:[{role:'user',content:'Fix source'}],seenToolCallIds:[],usage:{inputTokens:30,outputTokens:20},toolCalls:2,repeatedToolBatchTurns:0,createdAt:new Date().toISOString(),verificationPrompted:true,
  verification:{status:'passed',revision:1,changedPaths:['src/a.ts'],checks:[{callId:'check-a',command:'node --test',status:'passed',exitCode:0,revision:1,afterLastChange:true}]}});

test('interruption finalizes first, includes previously unseen changes, and invalidates persisted checks',async()=>{
  const events=[];
  const original=checkpoint();
  const result=await finalizeInterruptedAgentCheckpoint(original,[],{
    async finalizeProcessCheckpoints(){events.push('finalize');},
    getCreatedCheckpointIds(){assert.deepEqual(events,['finalize']);return['late'];},
    async getCheckpointDiff(id){return{checkpointId:id,path:'src/a.ts'};}
  });
  assert.equal(result.verification.status,'unverified');assert.equal(result.verification.revision,2);
  assert.equal(result.verification.checks[0].afterLastChange,false);assert.equal(result.verificationPrompted,false);
  assert.deepEqual(result.recoveredFileCheckpointIds,['late']);
  assert.equal(original.verification.status,'passed');assert.equal(original.verification.revision,1);
});

test('already observed change receipts do not invalidate checks during a retry',async()=>{
  const original=checkpoint();
  original.messages.push({role:'tool',toolCallId:'edit',content:JSON.stringify({ok:true,output:{checkpointIds:['observed-message']}})});
  const result=await finalizeInterruptedAgentCheckpoint(original,[{type:'tool_completed',summary:{checkpointId:'observed-event'}}],{
    async finalizeProcessCheckpoints(){},getCreatedCheckpointIds(){return['observed-message','observed-event'];},async getCheckpointDiff(){throw Error('should not re-read observed changes');}
  });
  assert.equal(result,original);
});

test('real unpolled command edits are captured and recoverable before retry checkpoint save',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'nextmux-interrupted-')));

  const workspace=join(root,'workspace');await mkdir(workspace);await writeFile(join(workspace,'a.txt'),'before');
  const runtime=await WorkspaceToolRuntime.create({workspaceRoot:workspace,checkpointRoot:join(root,'checkpoints'),permissionMode:'full_access'});
  t.after(async()=>{await runtime.dispose();await rm(root,{recursive:true,force:true});});
  const tools=new AgentToolRegistry();runtime.registerTools(tools);
  const started=await tools.execute({id:'start-edit',name:'process.start',arguments:{command:process.execPath,args:['-e','require("node:fs").writeFileSync("a.txt","after"); console.log("EDIT_READY"); setInterval(()=>{},1000)'],tty:false}},'full_access',{runId:'run-interrupted-real'});
  assert.equal(started.ok,true);
  // Wait for a real filesystem change without consuming process.read, which
  // is the specific interruption path this recovery code must cover.
  let ready=false;
  for(let i=0;i<100;i++){if(await readFile(join(workspace,'a.txt'),'utf8')==='after'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(ready,true);
  const original=checkpoint();
  const recovered=await finalizeInterruptedAgentCheckpoint(original,[],runtime);
  assert.equal(recovered.verification.status,'unverified');assert.ok(recovered.verification.changedPaths.includes('a.txt'));
  const ids=runtime.getCreatedCheckpointIds();assert.equal(ids.length,1);
  // Host retry opens a new runtime: it cannot discover the old in-memory list.
  // Only the serialized recovery receipt bridges the UI diff/result path.
  const saved=JSON.parse(JSON.stringify(recovered));
  const retryRuntime=await WorkspaceToolRuntime.create({workspaceRoot:workspace,checkpointRoot:join(root,'checkpoints'),permissionMode:'full_access'});
  t.after(()=>retryRuntime.dispose());
  assert.deepEqual(retryRuntime.getCreatedCheckpointIds(),[]);
  const restoredIds=agentRunFileCheckpointIds(saved.recoveredFileCheckpointIds,retryRuntime.getCreatedCheckpointIds(),[]);
  assert.deepEqual(restoredIds,ids);
  const diff=await retryRuntime.getCheckpointDiff(restoredIds[0]);assert.equal(diff.path,'a.txt');
  await retryRuntime.restoreCheckpointChain([...restoredIds].reverse());
  assert.equal(await readFile(join(workspace,'a.txt'),'utf8'),'before');
});
