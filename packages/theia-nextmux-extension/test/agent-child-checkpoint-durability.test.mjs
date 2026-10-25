import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {loadCurrentSource} from './helpers/current-source-loader.mjs';
const ledgerUrl=new URL('../../agent-runtime/src/delegation-ledger.ts',import.meta.url),contextUrl=new URL('../../agent-runtime/src/task-context.ts',import.meta.url),storeUrl=new URL('../src/node/nextmux-agent-run-state-store.ts',import.meta.url);
const runtime={...loadCurrentSource(ledgerUrl),...loadCurrentSource(contextUrl)};
const {AgentRunStateStore,AgentRunStateStoreError}=loadCurrentSource(storeUrl,{'@nextmux/agent-runtime':runtime});
const source=readFileSync(new URL('../src/node/nextmux-platform-service.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true),methods={};
function visit(n){if(ts.isMethodDeclaration(n))methods[n.name.getText(ast)]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
const emitted=ts.transpileModule('class Host {'+['queueAgentDelegationCommit','persistAgentChildCheckpoint','scheduleAgentDelegationLedgerSave'].map(n=>methods[n]).join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function host(Store=AgentRunStateStore){const Host=new Function('AgentRunStateStore','AgentRunStateStoreError','validateAgentTaskContext','sameAgentWorkspace','createAgentDelegationLedger','recordAgentDelegationCheckpoint',emitted+';return Host;')(Store,AgentRunStateStoreError,runtime.validateAgentTaskContext,(a,b)=>resolve(a)===resolve(b),runtime.createAgentDelegationLedger,runtime.recordAgentDelegationCheckpoint);return Object.assign(new Host(),{agentJobs:new Map(),agentDelegationCommitQueues:new Map(),agentCheckpointRoot:workspace=>join(workspace,'.state')});}
async function fixture(t){const root=await fs.mkdtemp(join(tmpdir(),'nextmux-child-durability-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const parent=join(root,'parent'),child=join(root,'child'),rootId='root-child-checkpoint-test',parentId='parent-checkpoint-test',childId='child-checkpoint-test',conversation='checkpoint-test-conversation';const context=runtime.createAgentTaskContext({workspaceRoot:child,conversationId:conversation,goal:'fixture child',parentRunId:parentId,rootRunId:rootId,depth:1,permissionMode:'read_only',allowedToolNames:[]});return{root,parent,child,owner:{workspaceRoot:parent,conversationId:conversation,rootRunId:rootId,depth:0},metadata:{parentRunId:parentId,rootRunId:rootId,childRunId:childId,depth:1,status:'running',taskContext:context},checkpoint:{version:1,runId:childId,nextTurn:1,segment:1,messages:[{role:'user',content:'fixture'}],seenToolCallIds:[],usage:{inputTokens:0,outputTokens:0},usageKnown:true,toolCalls:0,repeatedToolBatchTurns:0,createdAt:'2026-10-16T00:00:00.000Z',taskContext:context}};}
test('actual host save links each child checkpoint to its owned root and a fresh process can discover it',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();const first=await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const later={...f.checkpoint,nextTurn:2,usage:{inputTokens:19,outputTokens:7}};const second=await h.persistAgentChildCheckpoint(later,f.metadata,rootStore,f.owner);assert.notEqual(first,second);
 const stored=await rootStore.loadDelegationLedger(f.metadata.rootRunId,{expectedOwner:{...f.owner,scope:'root'}});assert.equal(stored.ledger.children[0].resumeCheckpointId,second);assert.equal(stored.ledger.children[0].status,'running');assert.equal(stored.ledger.children[0].eventCount,0);
 const program=`import {loadCurrentSource} from ${JSON.stringify(new URL('./helpers/current-source-loader.mjs',import.meta.url).href)};const runtime=loadCurrentSource(new URL(${JSON.stringify(ledgerUrl.href)}));const {AgentRunStateStore}=loadCurrentSource(new URL(${JSON.stringify(storeUrl.href)}),{'@nextmux/agent-runtime':runtime});const rootStore=new AgentRunStateStore(${JSON.stringify(join(f.parent,'.state'))});const record=await rootStore.loadDelegationLedger(${JSON.stringify(f.metadata.rootRunId)},{expectedOwner:${JSON.stringify({...f.owner,scope:'root'})}});const child=record.ledger.children[0];const saved=await new AgentRunStateStore(child.taskContext.workspaceRoot+'/.state').loadRecord(child.resumeCheckpointId,{expectedOwner:{workspaceRoot:child.taskContext.workspaceRoot,conversationId:child.taskContext.conversationId,scope:'child',parentRunId:child.parentRunId,rootRunId:child.rootRunId,depth:child.depth}});if(saved.checkpoint.runId!==child.childRunId)throw Error('wrong child');process.stdout.write(JSON.stringify({id:saved.id,childRunId:saved.checkpoint.runId,usage:saved.checkpoint.usage}));`;
 const loaded=await new Promise((yes,no)=>{const proc=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);proc.on('error',no);proc.on('exit',code=>code===0?yes(JSON.parse(out)):no(new Error(err)));});assert.deepEqual(loaded,{id:second,childRunId:f.checkpoint.runId,usage:{inputTokens:19,outputTokens:7}});
});
test('index failure never acknowledges a new handle and preserves the previous reference and both files',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();const first=await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const failing={loadDelegationLedger:(...a)=>rootStore.loadDelegationLedger(...a),saveDelegationLedger:async()=>{throw new AgentRunStateStoreError('DELEGATION_LEDGER_UNAVAILABLE','injected rename failure');}};
 await assert.rejects(h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,failing,f.owner),e=>e.code==='DELEGATION_LEDGER_UNAVAILABLE');const record=await rootStore.loadDelegationLedger(f.metadata.rootRunId);assert.equal(record.ledger.children[0].resumeCheckpointId,first);assert.equal((await fs.readdir(join(f.child,'.state/run-state'))).filter(n=>n.endsWith('.json')).length,2);
});
test('mismatched child/root ownership is refused before any new state file is created',async t=>{
 const f=await fixture(t),h=host(),rootStore=new AgentRunStateStore(join(f.parent,'.state'));
 for(const [checkpoint,owner] of [[{...f.checkpoint,runId:'wrong-child'},f.owner],[f.checkpoint,{...f.owner,conversationId:'other-conversation'}],[f.checkpoint,{...f.owner,rootRunId:'other-root'}]])await assert.rejects(h.persistAgentChildCheckpoint(checkpoint,f.metadata,rootStore,owner),e=>e.code==='CHILD_CHECKPOINT_OWNER_MISMATCH');await assert.rejects(fs.stat(join(f.child,'.state')),e=>e.code==='ENOENT');
});
test('a corrupt root index is not silently replaced and cannot admit child work',async t=>{
 const f=await fixture(t),h=host(),rootStore=new AgentRunStateStore(join(f.parent,'.state'));await rootStore.saveDelegationLedger(runtime.createAgentDelegationLedger(f.metadata.rootRunId),f.owner);const directory=join(f.parent,'.state/run-state'),name=(await fs.readdir(directory)).find(n=>n.endsWith('.json'));await fs.writeFile(join(directory,name),'{corrupt fixture');await assert.rejects(h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner));assert.equal(await fs.readFile(join(directory,name),'utf8'),'{corrupt fixture');await assert.rejects(fs.stat(join(f.child,'.state')),e=>e.code==='ENOENT');
});
test('required checkpoint commit waits for older diagnostics and propagates a blocked writer',async t=>{
 const f=await fixture(t),h=host(),rootStore=new AgentRunStateStore(join(f.parent,'.state'));let release;const pending=new Promise(r=>release=r),job={delegationLedgerWrite:pending,children:new Map([[f.metadata.childRunId,{}]])};h.agentJobs.set('job',job);void h.queueAgentDelegationCommit(f.owner,()=>pending);const saved=h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner,'job');await new Promise(r=>setImmediate(r));await assert.rejects(fs.stat(join(f.child,'.state')),e=>e.code==='ENOENT');release();const id=await saved;assert.equal(job.children.get(f.metadata.childRunId).resumeCheckpointId,id);assert.equal(job.delegationLedger.children[0].resumeCheckpointId,id);
 job.delegationLedgerPersistenceBlocked=true;await assert.rejects(h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner,'job'),e=>e.code==='DELEGATION_LEDGER_UNAVAILABLE');
});
test('Desktop explicitly requires the owned checkpoint path, and snapshots retain recovery and usage confidence',()=>{
 assert.match(source,/checkpointPolicy: 'required',\s+persistCheckpoint:[\s\S]{0,250}this\.persistAgentChildCheckpoint\(checkpoint, metadata, runStateStore, delegationLedgerOwner, execution\.runId\)/);
 assert.match(methods.applyAgentDelegationLifecycle,/usageKnown: lifecycle\.result\.usageKnown/);assert.match(methods.applyAgentDelegationLifecycle,/recoveryStatus: lifecycle\.result\.recoveryStatus/);assert.match(methods.agentChildSnapshots,/resumeCheckpointId: child\.resumeCheckpointId/);
});

test('two required commits and a lifecycle update share the root queue without losing a handle or event',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state'));let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let saves=0;
 class SlowChildStore extends AgentRunStateStore{async save(...args){saves++;if(saves===1){entered();await gate;}return super.save(...args);}}
 const h=host(SlowChildStore);let initial=runtime.createAgentDelegationLedger(f.metadata.rootRunId);
 initial=runtime.applyAgentDelegationLifecycle(initial,{type:'started',...f.metadata,task:'fixture child'});
 const job={delegationLedger:initial,delegationLedgerStore:rootStore,delegationLedgerOwner:f.owner,children:new Map([[f.metadata.childRunId,{}]])};h.agentJobs.set('job',job);
 const first=h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner,'job');await started;
 const secondContext={...f.metadata.taskContext,workspaceRoot:join(f.root,'child2')},secondMeta={...f.metadata,childRunId:'child-checkpoint-other',taskContext:secondContext};
 const second=h.persistAgentChildCheckpoint({...f.checkpoint,runId:secondMeta.childRunId,taskContext:secondContext},secondMeta,rootStore,f.owner,'job');
 job.delegationLedger=runtime.applyAgentDelegationLifecycle(job.delegationLedger,{type:'event',...f.metadata,event:{type:'model_started',turn:1,at:new Date().toISOString()}});h.scheduleAgentDelegationLedgerSave(job);
 await new Promise(r=>setImmediate(r));assert.equal(saves,1);release();const [a,b]=await Promise.all([first,second]);await job.delegationLedgerWrite;
 const disk=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;
 assert.equal(disk.children.find(c=>c.childRunId===f.metadata.childRunId).resumeCheckpointId,a);assert.equal(disk.children.find(c=>c.childRunId===secondMeta.childRunId).resumeCheckpointId,b);assert.equal(disk.children.find(c=>c.childRunId===f.metadata.childRunId).eventCount,1);assert.equal(job.delegationLedger.children.find(c=>c.childRunId===f.metadata.childRunId).eventCount,1);
});

test('required commits advance legacy revision zero and survive clock rollback plus late diagnostics',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),childStore=new AgentRunStateStore(join(f.child,'.state')),h=host();
 const legacyHandle=await childStore.save(f.checkpoint,{workspaceRoot:f.child,conversationId:f.owner.conversationId,parentRunId:f.metadata.parentRunId,rootRunId:f.metadata.rootRunId,depth:1});
 const legacy=runtime.recordAgentDelegationCheckpoint(runtime.createAgentDelegationLedger(f.metadata.rootRunId),f.metadata,legacyHandle,'2099-01-01T00:00:00.000Z');
 await rootStore.saveDelegationLedger(legacy,f.owner);
 const first=await h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,rootStore,f.owner);
 const committed=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(committed.children[0].resumeCheckpointId,first);assert.equal(committed.children[0].checkpointRevision,1);
 const newerDiagnostics={...legacy,updatedAt:'2100-01-01T00:00:00.000Z',children:legacy.children.map(c=>({...c,updatedAt:'2100-01-01T00:00:00.000Z',eventCount:2}))};await rootStore.saveDelegationLedger(newerDiagnostics,f.owner);
 let disk=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(disk.children[0].resumeCheckpointId,first);assert.equal(disk.children[0].checkpointRevision,1);assert.equal(disk.children[0].eventCount,2);
 const second=await h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:3},f.metadata,rootStore,f.owner);disk=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(disk.children[0].resumeCheckpointId,second);assert.equal(disk.children[0].checkpointRevision,2);
});

test('equal revision conflicts, unsafe revisions and exhausted revisions fail closed',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();const first=await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const ledger=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;
 const otherHandle='resume-22222222-2222-4222-8222-222222222222';
 await assert.rejects(rootStore.saveDelegationLedger({...ledger,children:ledger.children.map(c=>({...c,resumeCheckpointId:otherHandle,updatedAt:'2100-01-01T00:00:00.000Z'}))},f.owner),e=>e.code==='CHILD_CHECKPOINT_CONFLICT');
 for(const revision of [-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(rootStore.saveDelegationLedger({...ledger,children:ledger.children.map(c=>({...c,checkpointRevision:revision}))},f.owner),e=>e.code==='DELEGATION_LEDGER_CORRUPT');
 const max={...ledger,children:ledger.children.map(c=>({...c,checkpointRevision:Number.MAX_SAFE_INTEGER}))};await rootStore.saveDelegationLedger(max,f.owner);
 await assert.rejects(h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,rootStore,f.owner),e=>e.code==='CHILD_CHECKPOINT_REVISION_EXHAUSTED');assert.equal((await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger.children[0].resumeCheckpointId,first);
});

test('independent hosts racing the same previous boundary acknowledge one commit and retain uncertain files',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state'));const first=await host().persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);let arrivals=0,release;const gate=new Promise(r=>release=r);
 class RacingChildStore extends AgentRunStateStore{async save(...args){const id=await super.save(...args);if(++arrivals===2)release();await gate;return id;}}
 const results=await Promise.allSettled([host(RacingChildStore).persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,rootStore,f.owner),host(RacingChildStore).persistAgentChildCheckpoint({...f.checkpoint,nextTurn:3},f.metadata,rootStore,f.owner)]);
 const fulfilled=results.filter(r=>r.status==='fulfilled'),rejected=results.filter(r=>r.status==='rejected');assert.equal(fulfilled.length,1);assert.equal(rejected.length,1);assert.equal(rejected[0].reason.code,'CHILD_CHECKPOINT_CONFLICT');
 const disk=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(disk.children[0].resumeCheckpointId,fulfilled[0].value);assert.equal(disk.children[0].checkpointRevision,2);assert.notEqual(disk.children[0].resumeCheckpointId,first);assert.equal((await fs.readdir(join(f.child,'.state/run-state'))).filter(n=>n.endsWith('.json')).length,3);
});

test('host refuses a success response without its exact reference and CAS checks child ownership',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();const first=await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const ledger=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;
 const misleading={loadDelegationLedger:(...a)=>rootStore.loadDelegationLedger(...a),saveDelegationLedger:async()=>ledger};await assert.rejects(h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,misleading,f.owner),e=>e.code==='CHILD_CHECKPOINT_UNCONFIRMED');
 const proposed=runtime.recordAgentDelegationCheckpoint(ledger,f.metadata,'resume-33333333-3333-4333-8333-333333333333');const changed={...proposed,children:proposed.children.map(c=>({...c,parentRunId:'different-parent'}))};
 await assert.rejects(rootStore.saveDelegationLedger(changed,f.owner,{childRunId:f.metadata.childRunId,resumeCheckpointId:proposed.children[0].resumeCheckpointId,expectedPreviousCheckpointId:first,expectedCheckpointRevision:1}),e=>e.code==='CHILD_CHECKPOINT_OWNER_MISMATCH');assert.equal((await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger.children[0].resumeCheckpointId,first);
});

test('late successful diagnostics cannot hide an uncertain boundary at the same checkpoint revision',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const ledger=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;
 await rootStore.saveDelegationLedger({...ledger,children:ledger.children.map(c=>({...c,recoveryStatus:'unknown',checkpointError:{code:'FIXTURE_WRITE_FAILURE',message:'fixture'},updatedAt:'2020-01-01T00:00:00.000Z'}))},f.owner);
 await rootStore.saveDelegationLedger({...ledger,children:ledger.children.map(c=>({...c,updatedAt:'2100-01-01T00:00:00.000Z'}))},f.owner);const uncertain=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(uncertain.children[0].recoveryStatus,'unknown');assert.equal(uncertain.children[0].checkpointError.code,'FIXTURE_WRITE_FAILURE');
 await h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},f.metadata,rootStore,f.owner);const next=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;assert.equal(next.children[0].checkpointRevision,2);assert.equal(next.children[0].recoveryStatus,'durable');assert.equal(next.children[0].checkpointError,undefined);
});

test('a confirmed completed boundary is not hidden by a future running diagnostic timestamp',async t=>{
 const f=await fixture(t),rootStore=new AgentRunStateStore(join(f.parent,'.state')),h=host();await h.persistAgentChildCheckpoint(f.checkpoint,f.metadata,rootStore,f.owner);const before=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;
 const future={...before,updatedAt:'2099-01-01T00:00:00.000Z',children:before.children.map(c=>({...c,updatedAt:'2099-01-01T00:00:00.000Z'}))};await rootStore.saveDelegationLedger(future,f.owner);
 const completedMeta={...f.metadata,status:'completed',stopReason:'completed'};const id=await h.persistAgentChildCheckpoint({...f.checkpoint,nextTurn:2},completedMeta,rootStore,f.owner);
 let child=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger.children[0];assert.equal(child.resumeCheckpointId,id);assert.equal(child.checkpointRevision,2);assert.equal(child.status,'completed');assert.equal(child.stopReason,'completed');assert.ok(child.finishedAt);
 await rootStore.saveDelegationLedger(future,f.owner);child=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger.children[0];assert.equal(child.status,'completed');assert.equal(child.stopReason,'completed');assert.equal(child.resumeCheckpointId,id);
 const completedLedger=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger;const observed=runtime.applyAgentDelegationLifecycle(completedLedger,{type:'completed',...f.metadata,task:'fixture child',result:{status:'completed',stopReason:'completed',usage:{inputTokens:7,outputTokens:2},usageKnown:true,receipt:{outcome:'completed',retrySafe:false,unknownSideEffect:false,summary:'fixture'},resumeCheckpointId:id,recoveryStatus:'durable'}},'2026-10-16T00:00:00.000Z');await rootStore.saveDelegationLedger(observed,f.owner);child=(await rootStore.loadDelegationLedger(f.metadata.rootRunId)).ledger.children[0];assert.equal(child.receipt.outcome,'completed');assert.equal(child.receipt.retrySafe,false);assert.equal(child.usage.inputTokens,7);
});
