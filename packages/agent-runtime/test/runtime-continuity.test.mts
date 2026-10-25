import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, agentReplyReserveTokens, AgentToolRegistry, AgentVerificationTracker, normalizeAgentRunVerification, isVerificationCommand,
  type AgentModelMessage, type AgentToolCall, type ToolExecutionResult } from '../lib/index.js';
import { buildAgentContinuityMemory } from '../lib/context-memory.js';

const output = (value: unknown, extras: Partial<ToolExecutionResult['summary']> = {}): ToolExecutionResult => ({ ok: true, output: value, summary: { title: 'test', ...extras } });
const edit = (id = 'edit'): AgentToolCall => ({ id, name: 'workspace.write_file', arguments: { path: 'src/a.ts' } });
const check = (id = 'test'): AgentToolCall => ({ id, name: 'process.run', arguments: { command: 'node', args: ['--test', 'test/a.test.mjs'] } });
const changed = () => output({ path: 'src/a.ts' }, { resource: { kind: 'file', path: 'src/a.ts', action: 'updated' } });

test('verification tracks actual check outcomes after the latest edit, and successful reruns clear only their failure', () => {
  const tracker = new AgentVerificationTracker();
  assert.equal(tracker.snapshot().status, 'not_required');
  tracker.observe(edit(), changed());
  assert.equal(tracker.snapshot().status, 'unverified');
  tracker.observe(check(), output({ exitCode: 1 }, { commandLine: 'node --test test/a.test.mjs' }));
  assert.equal(tracker.snapshot().status, 'failed');
  tracker.observe(check('retry'), output({ exitCode: 0 }, { commandLine: 'node --test test/a.test.mjs' }));
  assert.equal(tracker.snapshot().status, 'passed');
  tracker.observe(edit('edit-later'), changed());
  assert.equal(tracker.snapshot().status, 'unverified');
  assert.equal(tracker.snapshot().checks[0].afterLastChange, false);
  const restored = normalizeAgentRunVerification(JSON.parse(JSON.stringify(tracker.snapshot())))!;
  assert.deepEqual(restored, tracker.snapshot());
});

test('arbitrary output and echo test do not count as verification', () => {
  const tracker = new AgentVerificationTracker();
  tracker.observe(edit(), changed());
  for (const args of [{command:'echo',args:['test passed']},{command:'npm',args:['exec','echo','test']},{command:'node',args:['-e','console.log("--test")']}]) {
    assert.equal(isVerificationCommand(args), false);
    tracker.observe({id:'pretend',name:'process.run',arguments:args}, output({exitCode:0,stdout:'all tests pass'}));
  }
  assert.equal(tracker.snapshot().status, 'unverified');
  assert.equal(isVerificationCommand({command:'pnpm',args:['--dir','packages/core','run','typecheck']}), true);
});

test('async checks survive pause persistence but are invalidated by intervening writes', () => {
  let tracker = new AgentVerificationTracker();
  tracker.observe(edit(), changed());
  tracker.observe({...check(),name:'process.start'},output({running:true,processId:'proc-test'},{commandLine:'node --test test/a.test.mjs'}));
  assert.equal(tracker.snapshot().status, 'unverified');
  tracker = new AgentVerificationTracker(JSON.parse(JSON.stringify(tracker.snapshot())));
  tracker.observe(edit('later'),changed());
  tracker.observe({id:'poll',name:'process.read',arguments:{processId:'proc-test'}},output({running:false,processId:'proc-test',exitCode:0}));
  assert.equal(tracker.snapshot().status, 'unverified');
  assert.equal(tracker.snapshot().checks[0].status,'passed');
  assert.equal(tracker.snapshot().checks[0].afterLastChange,false);
});

test('a running process may return unchanged snapshots more than three times', async () => {
  const tools = new AgentToolRegistry();
  let reads = 0;
  tools.register({name:'process.read',description:'wait',inputSchema:{type:'object'},requiredPermission:'read_only',source:'builtin'},async () => {
    reads++;
    return {modelOutput:{processId:'proc-quiet',running:reads<6,nextSequence:0,chunks:[],...(reads>=6?{exitCode:0}:{})},summary:{title:'read'}};
  });
  let calls = 0;
  const result = await new AgentRunner({tools,permissionMode:'read_only',model:{async complete(){
    calls++;
    return calls<=6 ? {toolCalls:[{id:`poll-${calls}`,name:'process.read',arguments:{processId:'proc-quiet',afterSequence:0,waitMs:1000}}]}:{content:'complete'};
  }}}).run({prompt:'Wait for the existing build',runId:'run-normal-wait-001'});
  assert.equal(result.status,'completed');
  assert.equal(reads,6);
});

test('failed process polls still stop identical retries', async () => {
  const tools = new AgentToolRegistry();
  tools.register({name:'process.read',description:'wait',inputSchema:{type:'object'},requiredPermission:'read_only',source:'builtin'},async () => ({modelOutput:{processId:'proc-gone',running:false,exitCode:1},summary:{title:'failed'}}));
  let calls = 0;
  const result = await new AgentRunner({tools,permissionMode:'read_only',model:{async complete(){return {toolCalls:[{id:`poll-${++calls}`,name:'process.read',arguments:{processId:'proc-gone'}}]};}}}).run({prompt:'wait',runId:'run-failed-wait-001'});
  assert.equal(result.stopReason,'repeated_tool_calls');
  assert.equal(calls,8);
});

test('completion after an edit does not start an unrequested verification round or treat prose as passed', async () => {
  const tools = new AgentToolRegistry();
  let checks=0;
  tools.register({name:'workspace.write_file',description:'edit',inputSchema:{type:'object'},requiredPermission:'workspace_write',source:'builtin'},async()=>({modelOutput:{path:'src/a.ts'},summary:changed().summary}));
  tools.register({name:'process.run',description:'check',inputSchema:{type:'object'},requiredPermission:'full_access',source:'builtin'},async()=>{checks++;return {modelOutput:{exitCode:0},summary:{title:'check'}};});
  let count=0;
  const result = await new AgentRunner({tools,permissionMode:'full_access',model:{async complete(){
    count++;
    if(count===1)return {toolCalls:[edit()]};
    assert.equal(count,2,'final response must not cause another paid request');
    return {content:'It is done and all tests passed.'};
  }}}).run({prompt:'Fix a.ts',runId:'run-check-before-final-001'});
  assert.equal(count,2); assert.equal(checks,0);
  assert.equal(result.verification?.status,'unverified');
  assert.equal(result.finalText,'It is done and all tests passed.');
});

test('unavailable checks leave an honest unverified completion without an extra model turn', async () => {
  const tools = new AgentToolRegistry();
  tools.register({name:'workspace.write_file',description:'edit',inputSchema:{type:'object'},requiredPermission:'workspace_write',source:'builtin'},async()=>({modelOutput:{path:'src/a.ts'},summary:changed().summary}));
  let count=0;
  const result=await new AgentRunner({tools,permissionMode:'workspace_write',model:{async complete(){return ++count===1?{toolCalls:[edit()]}:{content:'No test command is available in this workspace.'};}}}).run({prompt:'Fix a.ts',runId:'run-no-check-available-001'});
  assert.equal(count,2);
  assert.equal(result.verification?.status,'unverified');
});

test('continuity memory retains current conclusions, file hashes, failing tests and pending work through re-compaction',()=>{
  const messages: AgentModelMessage[]=[
    {role:'user',content:'Keep the existing authentication flow'},
    {role:'assistant',content:'Found the callback path mismatch',toolCalls:[{id:'read',name:'workspace.read_file',arguments:{path:'src/auth.ts'}}]},
    {role:'tool',toolCallId:'read',content:JSON.stringify({ok:true,output:{path:'src/auth.ts',sha256:'abc123',content:'export const callback="/oauth/callback";'}})},
    {role:'assistant',content:'Run the relevant check',toolCalls:[check()]},
    {role:'tool',toolCallId:'test',content:JSON.stringify({ok:true,output:{exitCode:1,stdout:'noise\n'.repeat(2000)+'FAIL auth callback expected /oauth/callback',stderr:'AssertionError auth route'}})},
  ];
  const plan=[{id:'fix',title:'Fix callback routing',status:'in_progress' as const}];
  const summary=buildAgentContinuityMemory(messages,plan);
  const second=buildAgentContinuityMemory([summary,{role:'assistant',content:'Continue the callback fix'}],plan);
  for(const content of [summary.content,second.content]){
    assert.match(content,/authentication flow/);assert.match(content,/callback path mismatch/);assert.match(content,/src\/auth.ts/);assert.match(content,/abc123/);assert.match(content,/exitCode=1/);assert.match(content,/FAIL auth callback/);assert.match(content,/Fix callback routing/);
  }
  assert.equal(messages[4].content.includes('noise\nnoise'),false); // JSON-escaped original remains intact
  assert.ok(messages[4].content.length>12000);
});

// The kept request stays the newest message, sent once; the continuity memory leads (seamless-continuation pins the same).
test('context size can trigger compaction before a turn-count boundary',async()=>{
  const history: AgentModelMessage[]=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:`history-${i} ${'context '.repeat(500)}`}));
  let seen=0;
  const result=await new AgentRunner({tools:new AgentToolRegistry(),permissionMode:'read_only',contextWindowTokens:8000,model:{async complete(request){seen++;assert.ok(JSON.stringify(request.messages).length<50000);assert.match(request.messages[0].content,/^NEXTMUX_CONTINUITY_V1\n/);assert.equal(request.messages.at(-1)?.content,'EXACT_CURRENT_GOAL');assert.equal(JSON.stringify(request.messages).split('EXACT_CURRENT_GOAL').length-1,1);return{content:'Continue exact goal'};}}}).run({prompt:'EXACT_CURRENT_GOAL',history,runId:'run-budget-compaction-001'});
  assert.equal(seen,1);assert.ok(result.events.some(event=>event.type==='context_compaction_completed'));
  assert.equal(history.length,24);
});

test('current instructions that cannot fit are preserved and never sent as silently truncated text', async () => {
  const prompt='EXACT_TASK '+ '请保留全部任务要求。'.repeat(500);
  let calls=0;
  const result=await new AgentRunner({tools:new AgentToolRegistry(),permissionMode:'read_only',contextWindowTokens:1024,model:{async complete(){calls++;return{content:'should not run'};}}}).run({prompt,runId:'run-small-context-001'});
  assert.equal(result.stopReason,'context_window_exceeded');
  assert.equal(calls,0);
  assert.equal(result.checkpoint?.messages.at(-1)?.content,prompt);
});

test('large tool observations keep failure evidence and continuation fields in a paired message', async () => {
  const tools=new AgentToolRegistry();
  tools.register({name:'process.read',description:'read',inputSchema:{type:'object'},requiredPermission:'read_only',source:'builtin'},async()=>({modelOutput:{running:false,processId:'proc-large',nextSequence:500,exitCode:1,stdout:'noise\n'.repeat(12000)+'FAIL expected current auth callback'},summary:{title:'output'}}));
  let count=0;
  const result=await new AgentRunner({tools,permissionMode:'read_only',contextWindowTokens:8000,model:{async complete(request){
    if(++count===1)return{toolCalls:[{id:'large-read',name:'process.read',arguments:{processId:'proc-large'}}]};
    const tool=request.messages.find(message=>message.toolCallId==='large-read')!;
    const data=JSON.parse(tool.content);
    assert.equal(data.output.nextSequence,500);assert.equal(data.output.exitCode,1);assert.match(data.output.evidence,/FAIL expected current auth callback/);
    return{content:'The callback check failed.'};
  }}}).run({prompt:'Read the check result',runId:'run-large-context-001'});
  assert.equal(result.status,'completed');assert.equal(count,2);
});

test('zero-wait busy polling remains protected against repeated unchanged requests', async () => {
  const tools=new AgentToolRegistry();
  tools.register({name:'process.read',description:'read',inputSchema:{type:'object'},requiredPermission:'read_only',source:'builtin'},async()=>({modelOutput:{running:true,processId:'proc-busy',nextSequence:0,chunks:[]},summary:{title:'read'}}));
  let calls=0;
  const result=await new AgentRunner({tools,permissionMode:'read_only',model:{async complete(){return{toolCalls:[{id:`busy-${++calls}`,name:'process.read',arguments:{processId:'proc-busy',waitMs:0}}]};}}}).run({prompt:'Wait for build',runId:'run-busy-polling-001'});
  assert.equal(result.stopReason,'repeated_tool_calls');assert.equal(calls,8);
});

test('file recovery receipt IDs survive checkpoint retry, rebase, and the next safe checkpoint',async()=>{
  const {rebaseAgentRunCheckpoint,retryAgentRunCheckpoint}=await import('../lib/index.js');
  const source={version:1 as const,runId:'run-recovery-source',nextTurn:1,segment:1,messages:[{role:'user' as const,content:'Keep file recovery receipts'}],seenToolCallIds:[],usage:{inputTokens:0,outputTokens:0},toolCalls:0,repeatedToolBatchTurns:0,createdAt:new Date().toISOString(),recoveredFileCheckpointIds:['run-recovery-file-00000001']};
  const retry=retryAgentRunCheckpoint(source,'run-recovery-retry');
  const rebased=rebaseAgentRunCheckpoint(retry,{runId:'run-recovery-rebased',direction:'Continue'});
  const saved: import('../lib/index.js').AgentRunCheckpoint[] = [];
  const result=await new AgentRunner({tools:new AgentToolRegistry(),permissionMode:'read_only',captureCheckpoint:true,onCheckpoint:checkpoint=>{saved.push(checkpoint);},model:{async complete(){return{content:'done'};}}}).run({prompt:'Continue',checkpoint:rebased,runId:rebased.runId});
  assert.deepEqual(saved.at(-1)?.recoveredFileCheckpointIds,source.recoveredFileCheckpointIds);
  assert.deepEqual(result.checkpoint?.recoveredFileCheckpointIds,source.recoveredFileCheckpointIds);
  assert.throws(()=>retryAgentRunCheckpoint({...source,recoveredFileCheckpointIds:['../../outside']},'run-invalid-retry'),/checkpoint is invalid/);
});

test('runner completion events preserve bounded multiple-file receipts and reject invalid display paths',async()=>{
  const tools=new AgentToolRegistry();
  tools.register({name:'process.run',description:'command',inputSchema:{type:'object'},requiredPermission:'full_access',source:'builtin'},async()=>({
    modelOutput:{exitCode:0,checkpointIds:['run-file-receipt-001','run-file-receipt-002'],changedPaths:['src/a.ts','src/b.ts']},
    summary:{title:'command completed',checkpointIds:['run-file-receipt-001','run-file-receipt-002','run-file-receipt-001','../../bad'],changedPaths:['src/a.ts','src/b.ts','src/a.ts','../outside','/outside','C:\\outside','bad\npath']}
  }));
  let calls=0;
  const result=await new AgentRunner({tools,permissionMode:'full_access',model:{async complete(){return ++calls===1?{toolCalls:[{id:'command-write',name:'process.run',arguments:{command:'node',args:['script.mjs']}}]}:{content:'Files changed; verification unavailable.'};}}}).run({prompt:'Change two source files',runId:'run-multi-change-event'});
  const event=result.events.find(event=>event.type==='tool_completed');
  assert.deepEqual(event?.summary.checkpointIds,['run-file-receipt-001','run-file-receipt-002']);
  assert.deepEqual(event?.summary.changedPaths,['src/a.ts','src/b.ts']);
});

test('a new task whose fixed parts pass 75% of a small window is sent as it is, without a compaction notice (round 33)', async () => {
  // Instructions and tool schemas take about 80% of a 32k window: nothing can be compacted, and it still fits.
  let calls = 0, maxOutput: number | undefined;
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 32768,
    model: { estimateInputTokens: () => 26000, async complete(request) { calls++; maxOutput = request.maxOutputTokens; return { content: 'Done' }; } } })
    .run({ prompt: 'Fix calc.js', runId: 'run-small-window-new-task-001' });
  assert.equal(result.status, 'completed'); assert.equal(calls, 1);
  assert.equal(result.events.some(event => event.type === 'context_compaction_started'), false);
  assert.ok(maxOutput !== undefined && maxOutput >= 4096, `room for a reply: ${maxOutput}`);
});

test('switching a long conversation to a small model compacts it and sends, instead of pausing (round 33)', async () => {
  const history: AgentModelMessage[] = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn-${i} ${'detail '.repeat(900)}` }));
  // Fixed parts (instructions and tools) take 20k of the 32k window; the history is about 75k more.
  const estimate = ({ messages }: { readonly messages: readonly AgentModelMessage[] }) => 20000 + Math.ceil(JSON.stringify(messages).length / 3);
  let calls = 0, sent = 0;
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 32768,
    model: { estimateInputTokens: estimate, async complete(request) { calls++; sent = estimate(request); return { content: 'Continued' }; } } })
    .run({ prompt: 'Continue with the smaller model', history, runId: 'run-small-window-switch-001' });
  assert.equal(result.status, 'completed'); assert.equal(calls, 1);
  assert.ok(result.events.some(event => event.type === 'context_compaction_completed'));
  assert.ok(sent <= 32768 - 4096, `sent ${sent} tokens`);
});

test('only a single message larger than the whole window still pauses, with the task kept', async () => {
  let calls = 0;
  const prompt = 'PASTED '.repeat(2800).trim();
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 8000,
    model: { estimateInputTokens: ({ messages }) => 3000 + Math.ceil(JSON.stringify(messages).length / 3), async complete() { calls++; return { content: 'x' }; } } })
    .run({ prompt, runId: 'run-small-window-huge-001' });
  assert.equal(result.stopReason, 'context_window_exceeded'); assert.equal(calls, 0);
  assert.equal(result.checkpoint?.messages.at(-1)?.content, prompt);
});

test('agentReplyReserveTokens keeps 4096 tokens for a reply, a quarter of a very small window', () => {
  assert.equal(agentReplyReserveTokens(32768), 4096);
  assert.equal(agentReplyReserveTokens(200000, 64000), 4096);
  assert.equal(agentReplyReserveTokens(8000), 2000);
  assert.equal(agentReplyReserveTokens(32768, 1000), 1000);
});

test('a continuation keeps exactly the newest 16 call/result groups word for word and folds the rest into one memory', async () => {
  const { rebaseAgentRunCheckpoint } = await import('../lib/index.js');
  const messages: AgentModelMessage[] = [{ role: 'user', content: 'Audit every module' }];
  for (let index = 1; index <= 20; index++) {
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id: `call-${index}`, name: 'workspace.read_file', arguments: { path: `src/m${index}.ts` } }] });
    messages.push({ role: 'tool', toolCallId: `call-${index}`, content: JSON.stringify({ ok: true, output: { path: `src/m${index}.ts`, text: `module ${index}` } }) });
  }
  const resumed = rebaseAgentRunCheckpoint({ version: 1, runId: 'run-continuation-groups-001', executionScopeId: 'scope-continuation-groups-001', nextTurn: 21, segment: 1,
    messages, seenToolCallIds: messages.flatMap(message => message.toolCalls?.map(call => call.id) ?? []), usage: { inputTokens: 1, outputTokens: 1 },
    toolCalls: 20, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString() } as any, { runId: 'run-continuation-groups-002', direction: 'Continue with the rest' });
  const kept = resumed.messages.filter(message => message.role === 'assistant' && message.toolCalls?.length).map(message => message.toolCalls![0].id);
  // 16 groups: the direction and the 15 newest calls, in order; the 5 older calls live only in the memory.
  assert.deepEqual(kept, Array.from({ length: 15 }, (_, index) => `call-${index + 6}`));
  assert.equal(resumed.messages.at(-1)!.content, 'Continue with the rest');
  const memory = resumed.messages.filter(message => message.content.startsWith('NEXTMUX_CONTINUITY_V1\n'));
  assert.equal(memory.length, 1);
  assert.ok(buildAgentContinuityMemory([...memory, { role: 'user', content: 'next' }], undefined).content.startsWith('NEXTMUX_CONTINUITY_V1\n'), 'the memory folds again later');
});
