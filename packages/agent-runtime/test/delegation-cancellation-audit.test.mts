import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDelegationRuntime, AgentRunner, AgentToolRegistry, WorkspaceToolRuntime,
  applyAgentDelegationLifecycle, createAgentDelegationLedger,
  retryAgentRunCheckpoint,
  type AgentDelegateOutput, type AgentDelegationLifecycle, type AgentModelClient } from '../lib/index.js';

function gate() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
const usage = { inputTokens: 1, outputTokens: 1 };

test('parent abort reaches simultaneous child model requests and grandchildren, with cancelled ledgers', { timeout: 15000 }, async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController(), ready = gate();
  const signals: AbortSignal[] = [], lifecycle: AgentDelegationLifecycle[] = [];
  const model: AgentModelClient = { complete: async request => {
    if (request.messages[0].content === 'spawn grandchild') return { toolCalls: [
      { id: 'grandchild-call', name: 'agent.delegate', arguments: { task: 'grandchild waiting' } },
    ], usage };
    signals.push(request.signal!);
    if (signals.length === 2) ready.resolve();
    return new Promise(() => {}); // Proves the runner settles even a non-cooperative provider.
  } };
  const runtime = new AgentDelegationRuntime({ tools, model, allowedToolNames: [], maxPermissionMode: 'read_only', maxDepth: 3,
    onLifecycle: event => { lifecycle.push(event); } });
  runtime.register();
  const context = { runId: 'cancellation-root', signal: controller.signal };
  const first = runtime.handler({ task: 'spawn grandchild' }, context);
  const second = runtime.handler({ task: 'parallel child waiting' }, context);
  await ready.promise;
  controller.abort('host cancel');
  const results = await Promise.all([first, second]);
  assert.ok(signals.every(signal => signal.aborted));
  results.forEach(result => assert.equal((result.modelOutput as AgentDelegateOutput).receipt.outcome, 'cancelled'));
  let ledger = createAgentDelegationLedger(context.runId);
  for (const event of lifecycle) ledger = applyAgentDelegationLifecycle(ledger, event);
  assert.equal(ledger.children.length, 3);
  assert.ok(ledger.children.every(child => child.status === 'cancelled' && child.receipt?.outcome === 'cancelled'));
});

for (const waiting of ['question', 'tool', 'permission'] as const) test(`parent stop settles a child waiting for ${waiting} and prevents later work`, { timeout: 15000 }, async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController(), ready = gate(), release = gate();
  let laterEffects = 0, modelCalls = 0;
  tools.register({ name: 'fixture.wait', description: 'Wait for a cancellable operation', source: 'builtin',
    requiredPermission: 'read_only', inputSchema: { type: 'object' } }, async (_input, context) => {
    if (waiting === 'permission') {
      await context.requestPermissionApproval!({ toolName: 'fixture.wait', scope: 'external_file', target: '/fixture' }, context.signal);
    } else { ready.resolve(); await release.promise; }
    if (context.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
    laterEffects++;
    return { modelOutput: 'finished', summary: { title: 'finished' } };
  });
  const runtime = new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only',
    allowedToolNames: ['fixture.wait'], model: { complete: async () => {
      modelCalls++;
      return { toolCalls: [{ id: 'child-wait', name: waiting === 'question' ? 'task.request_user_input' : 'fixture.wait',
        arguments: waiting === 'question' ? { prompt: 'Select the next action', options: [{ id: 'continue', label: 'Continue' }] } : {} }], usage };
    } } });
  const resultPromise = runtime.handler({ task: 'Wait for user or tool' }, { runId: 'wait-parent-run', signal: controller.signal,
    allowedToolNames: ['fixture.wait', 'task.request_user_input'],
    requestUserInput: async (_question, signal) => { assert.ok(signal); ready.resolve(); await release.promise; return { status: 'answered' }; },
    requestPermissionApproval: async () => { ready.resolve(); await release.promise; return true; },
  });
  await ready.promise;
  controller.abort();
  const result = (await resultPromise).modelOutput as AgentDelegateOutput;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.receipt.outcome, 'cancelled');
  release.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(laterEffects, 0);
  assert.equal(modelCalls, 1);
});

test('child model failure returns a structured receipt and the lead continues without being aborted', async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController();
  new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: [],
    model: { complete: async () => { throw Object.assign(new Error('provider failed'), { code: 'PROVIDER_FAILED' }); } },
  }).register();
  let calls = 0;
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { complete: async request => {
    calls++;
    if (calls === 1) return { toolCalls: [{ id: 'failed-child', name: 'agent.delegate', arguments: { task: 'Bounded failing task' } }], usage };
    const failure = JSON.parse(request.messages.at(-1)!.content);
    assert.equal(failure.ok, false);
    assert.equal(failure.error.childReceipt.outcome, 'failed');
    assert.equal(controller.signal.aborted, false);
    return { content: 'The specialist failed; I completed the bounded task myself.', usage };
  } } }).run({ prompt: 'Delegate then handle failures', runId: 'failure-lead-run', signal: controller.signal });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 2);
  assert.equal(controller.signal.aborted, false);
});

test('child completion closes its signal while leaving its parent alive', async () => {
  const controller = new AbortController();
  let childSignal: AbortSignal | undefined;
  const runtime = new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    resolveChildExecution: request => { childSignal = request.signal; return {}; },
    model: { complete: async () => ({ content: 'Done', usage }) },
  });
  const result = (await runtime.handler({ task: 'Bounded work' }, { runId: 'successful-child-parent', signal: controller.signal })).modelOutput as AgentDelegateOutput;
  assert.equal(result.status, 'completed');
  assert.equal(childSignal?.aborted, true);
  assert.equal(controller.signal.aborted, false);
});

test('a timed-out specialist returns its failure receipt without aborting the lead', async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController();
  new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only', modelTimeoutMs: 10,
    model: { complete: async () => new Promise(() => {}) },
  }).register();
  const result = await tools.execute({ id: 'timed-out-child', name: 'agent.delegate', arguments: { task: 'Bounded slow task' } },
    'read_only', { runId: 'timeout-parent', signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'MODEL_TIMEOUT');
  assert.equal(result.error?.childReceipt?.outcome, 'failed');
  assert.equal(controller.signal.aborted, false);
});

test('pausing a question does not persist a user rejection that blocks resume', async () => {
  const controller = new AbortController(), ready = gate(), tools = new AgentToolRegistry();
  const run = new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    requestUserInput: async () => { ready.resolve(); return new Promise(() => {}); },
    model: { complete: async () => ({ toolCalls: [{ id: 'question-before-stop', name: 'task.request_user_input',
      arguments: { prompt: 'Choose', options: [{ id: 'one', label: 'One' }] } }], usage }) },
  }).run({ prompt: 'Question task', runId: 'question-cancel-initial', signal: controller.signal });
  await ready.promise; controller.abort();
  const stopped = await run;
  assert.equal(stopped.checkpoint?.userInputStopReason, undefined);
  const result = await new AgentRunner({ tools, permissionMode: 'read_only',
    model: { complete: async () => ({ content: 'Resumed task', usage }) },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(stopped.checkpoint!, 'question-cancel-resume') });
  assert.equal(result.status, 'completed');
});

test('workspace review failure retains completed child output and known usage', async () => {
  const tools = new AgentToolRegistry();
  tools.register({ name: 'fixture.write', description: 'Writable fixture', requiredPermission: 'workspace_write',
    source: 'builtin', inputSchema: { type: 'object' } }, async () => ({ modelOutput: 'written', summary: { title: 'write' } }));
  let disposed = 0;
  const runtime = new AgentDelegationRuntime({ tools, allowedToolNames: ['fixture.write'], maxPermissionMode: 'workspace_write',
    prepareWorkspace: async () => ({ workspaceRoot: '/isolated', tools, dispose: async () => { disposed++; },
      review: async () => { throw new Error('Review store unavailable'); } }),
    model: { complete: async () => ({ content: 'Completed original work', usage }) },
  });
  const result = (await runtime.handler({ task: 'Bounded isolated task' }, { runId: 'review-error-parent', workspaceRoot: '/source' })).modelOutput as AgentDelegateOutput;
  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'Completed original work');
  assert.deepEqual(result.usage, usage);
  assert.ok(result.workspaceReviewError);
  assert.equal(result.receipt.retrySafe, false);
  assert.equal(disposed, 1);
});

test('parent cancellation terminates a real child process tree before its delayed workspace write', { timeout: 20000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'nm-council-stop-')), root = join(base, 'root');
  await mkdir(root);
  const workspace = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access' });
  t.after(async () => { await workspace.dispose(); await rm(base, { recursive: true, force: true }); });
  const tools = new AgentToolRegistry(), controller = new AbortController(), ready = gate();
  workspace.registerTools(tools);
  const childCode = "setTimeout(()=>require('node:fs').writeFileSync('late.txt','unsafe'),2000);setInterval(()=>{},1000)";
  const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});console.log('READY '+c.pid);setInterval(()=>{},1000)`;
  let pid = 0;
  const runtime = new AgentDelegationRuntime({ tools, allowedToolNames: ['process.run'], maxPermissionMode: 'full_access',
    onEvent: ({ event }) => { if (event.type === 'tool_output') { const match = /READY (\d+)/.exec(event.chunk); if (match) { pid = Number(match[1]); ready.resolve(); } } },
    model: { complete: async () => ({ toolCalls: [{ id: 'process-child', name: 'process.run', arguments: { command: process.execPath, args: ['-e', script] } }], usage }) },
  });
  const pending = runtime.handler({ task: 'Start a cancellable command' }, { runId: 'native-stop-parent', signal: controller.signal, workspaceRoot: root });
  await ready.promise;
  controller.abort();
  const result = (await pending).modelOutput as AgentDelegateOutput;
  assert.equal(result.status, 'cancelled');
  await workspace.finalizeProcessCheckpoints();
  await assert.rejects(readFile(join(root, 'late.txt')), { code: 'ENOENT' });
  if (process.platform !== 'win32') assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
