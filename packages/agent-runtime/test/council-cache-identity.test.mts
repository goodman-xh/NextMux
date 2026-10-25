import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDelegationRuntime, AgentToolRegistry, computeChildInvocationKey,
  type AgentDelegateOutput, type AgentDelegationChildExecutionRequest, type AgentDelegationLifecycle } from '../lib/index.js';

test('cache identity keeps code whitespace, acceptance criteria, inherited versus empty tools and memory distinct', () => {
  const base = { parentRunId: 'parent', task: 'return "a  b";', tools: undefined, memoryIds: undefined };
  const original = computeChildInvocationKey(base);
  for (const change of [
    { task: 'return "a b";' }, { task: `\n${base.task}\n` }, { acceptanceCriteria: ['Keep both spaces'] },
    { tools: [] }, { memoryIds: [] }, { maxTurns: 2 }, { tokenBudget: { maxOutputTokens: 50 } }, { executionId: 'later-model-batch' }
  ]) assert.notEqual(computeChildInvocationKey({ ...base, ...change }), original);
  assert.equal(computeChildInvocationKey({ ...base, tools: ['workspace.write_file', 'workspace.read_file'] }),
    computeChildInvocationKey({ ...base, tools: ['workspace.read_file', 'workspace.write_file'] }), 'tool order alone does not change permission');
});

function fixture() {
  const tools = new AgentToolRegistry();
  tools.register({ name: 'workspace.write_file', description: 'Write fixture', requiredPermission: 'workspace_write',
    source: 'builtin', inputSchema: { type: 'object' } }, async () => ({ modelOutput: {}, summary: { title: 'Unused fixture tool' } }));
  const cached = new Map<string, AgentDelegateOutput>(), events: AgentDelegationLifecycle[] = [], requests: AgentDelegationChildExecutionRequest[] = [];
  let prepared = 0, disposed = 0, modelCalls = 0;
  const runtime = new AgentDelegationRuntime({ tools, maxPermissionMode: 'workspace_write', allowedToolNames: ['workspace.write_file'],
    model: { async complete() { modelCalls++; return { content: 'Verified completed fixture', usage: { inputTokens: 3, outputTokens: 4 } }; } },
    prepareWorkspace: async ({ childRunId, workspaceRoot }) => {
      prepared++;
      return { workspaceRoot: `/isolated/${childRunId}`, tools,
        review: async () => ({ childRunId, workspaceRoot: `/isolated/${childRunId}`, sourceWorkspaceRoot: workspaceRoot,
          kind: 'snapshot', reviewId: `review-${childRunId}`, changes: [], conflicts: [], excludedPaths: [], requiresMerge: false }),
        dispose: async () => { disposed++; } };
    },
    persistCheckpoint: async () => 'resume-original',
    onLifecycle: event => { events.push(event); if (event.type === 'completed' && event.invocationKey) cached.set(event.invocationKey, event.result); },
    resolveChildExecution: request => {
      requests.push(request);
      const invocationKey = computeChildInvocationKey({ parentRunId: request.parentRunId, task: request.input.task,
        acceptanceCriteria: request.input.acceptanceCriteria, tools: request.input.tools, taskContext: request.taskContext,
        memoryIds: request.input.memoryIds, maxTurns: request.maxTurns, tokenBudget: request.tokenBudget, executionId: request.executionId });
      return { invocationKey, cachedResult: cached.get(invocationKey) };
    }
  });
  const context = { runId: 'parent-run', rootRunId: 'root-run-1', workspaceRoot: '/source', permissionMode: 'workspace_write' as const };
  const input = { task: '\nWrite "a  b" exactly.\n', acceptanceCriteria: ['Preserve both spaces'], tools: ['workspace.write_file'] };
  return { runtime, context, input, cached, events, requests, stats: () => ({ prepared, disposed, modelCalls }) };
}

test('completed reuse keeps original child, receipt and review without allocating or recording another child', async () => {
  const f = fixture();
  const first = await f.runtime.handler(f.input, f.context), output = first.modelOutput as AgentDelegateOutput;
  const eventCount = f.events.length;
  const second = await f.runtime.handler(f.input, f.context);
  assert.deepEqual(f.stats(), { prepared: 1, disposed: 1, modelCalls: 1 });
  assert.strictEqual(second.modelOutput, output);
  assert.equal(output.workspaceReview?.childRunId, output.runId);
  assert.equal(output.resumeCheckpointId, 'resume-original');
  assert.deepEqual(output.usage, { inputTokens: 3, outputTokens: 4 });
  assert.deepEqual(second.usage, { inputTokens: 0, outputTokens: 0 }, 'reuse consumes no new provider request');
  assert.equal(f.events.length, eventCount, 'existing child lifecycle and ledger are not duplicated');
  assert.ok(f.requests.every(request => request.taskContext.workspaceRoot === '/source'), 'lookup precedes isolated workspace allocation');
  // The child goal is the task trimmed at its ends (HEAD behaviour, audit DK-A1); inner spacing is kept byte for byte,
  // and the cache identity is built from this same parsed task, so surrounding whitespace never splits a reuse.
  assert.equal(f.requests[0].input.task, 'Write "a  b" exactly.', 'input parsing keeps inner whitespace and trims only the ends');
});

test('changed acceptance criteria and explicit no-tools requests each start their own bounded child', async () => {
  const f = fixture();
  await f.runtime.handler(f.input, f.context);
  await f.runtime.handler({ ...f.input, acceptanceCriteria: ['Add and verify a second file'] }, f.context);
  await f.runtime.handler({ ...f.input, tools: [] }, f.context);
  assert.deepEqual(f.stats(), { prepared: 2, disposed: 2, modelCalls: 3 });
  assert.equal(f.events.filter(event => event.type === 'started').length, 3);
});

test('a mismatched cached workspace receipt fails before new work instead of rewriting its run identity', async () => {
  const f = fixture();
  const output = (await f.runtime.handler(f.input, f.context)).modelOutput as AgentDelegateOutput;
  const invalid = { ...output, workspaceReview: { ...output.workspaceReview!, childRunId: 'other-child' } };
  f.cached.set(output.invocationKey!, invalid);
  await assert.rejects(f.runtime.handler(f.input, f.context), { code: 'INVALID_DELEGATION_CACHE' });
  assert.deepEqual(f.stats(), { prepared: 1, disposed: 1, modelCalls: 1 });
  assert.equal(invalid.workspaceReview.childRunId, 'other-child', 'diagnostic evidence is never rewritten');
});
