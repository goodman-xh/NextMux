import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDelegationRuntime, AgentRunner, AgentToolError, AgentToolRegistry, DelegatedWorkspaceManager,
  durableCheckpointHash, type AgentRunCheckpoint, type AgentDelegateOutput } from '../lib/index.js';

const usage = { inputTokens: 3, outputTokens: 2 };
const binding = { scopeId: `scope-${randomUUID()}`, admissionId: `admit-${randomUUID()}`, operationId: `op-${randomUUID()}`,
  originalToolCallId: 'original-delegation', logicalParentOperationId: 'original-parent-task' };
const ack = (cp: AgentRunCheckpoint) => ({ handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
  admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 });

test('a durable child resumes its original task, route and plan without replaying its paired tool', async () => {
  const tools = new AgentToolRegistry(), childRunId = `child-${randomUUID()}`;
  let effects = 0, saved: AgentRunCheckpoint | undefined;
  tools.register({ name: 'fixture.read', description: 'Observe once', source: 'builtin', requiredPermission: 'read_only', inputSchema: { type: 'object' } }, async () => {
    effects++; return { modelOutput: 'original observation', summary: { title: 'Observed' } };
  });
  let originalCalls = 0;
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'read_only', allowedToolNames: ['fixture.read', 'task.update_plan'],
    logicalParentOperationId: binding.operationId, onDurableCheckpoint: async cp => { saved = structuredClone(cp); return ack(cp); },
    model: { complete: async () => {
      if (++originalCalls === 1) return { toolCalls: [
        { id: 'plan-once', name: 'task.update_plan', arguments: { steps: [{ id: 'verify', title: 'Verify the assigned result', status: 'in_progress' }] } },
        { id: 'observe-once', name: 'fixture.read', arguments: {} },
      ], usage };
      throw new Error('Simulated lost model transport after a safe checkpoint');
    } },
  }).run({ prompt: 'Original specialist task', runId: childRunId }));
  assert.equal(saved?.pendingToolBatch, undefined);
  assert.equal(saved?.taskPlan?.[0].title, 'Verify the assigned result');
  assert.equal(effects, 1);
  let completed: AgentDelegateOutput | undefined, requests = 0;
  const runtime = new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: ['fixture.read', 'task.update_plan'],
    model: { complete: async () => { assert.fail('must use the original specialist model'); } },
    persistCheckpoint: async () => 'resume-11111111-1111-4111-8111-111111111111',
    durable: { admit: async () => ({ childRunId, invocationKey: 'original-assignment', resumeCheckpoint: saved!,
      begin: async () => {}, commitChildCheckpoint: async cp => ack(cp), complete: async output => { completed = output; },
      resolveExecution: async () => ({ modelId: 'original-model', slotId: 'backend', role: 'backend', model: { complete: async request => {
        requests++;
        assert.equal(request.messages[0].content, 'Original specialist task');
        assert.equal(JSON.parse(request.messages.find(message => message.toolCallId === 'observe-once')!.content).output, 'original observation');
        return { content: 'Verified original specialist result', usage };
      } } }),
    }) },
  });
  const output = (await runtime.handler({ task: 'Original specialist task', role: 'backend' },
    { runId: 'restarted-parent-task', durableCall: binding })).modelOutput as AgentDelegateOutput;
  assert.equal(output.runId, childRunId);
  assert.equal(output.invocationKey, 'original-assignment');
  assert.equal(output.modelId, 'original-model');
  assert.equal(output.status, 'completed');
  assert.equal(requests, 1);
  assert.equal(effects, 1);
  assert.equal(completed, output);
});

test('setup failure releases a durable admission without inventing child work', async () => {
  let aborted = 0, released = 0;
  const runtime = new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async () => { assert.fail('setup failed'); } },
    durable: { admit: async () => ({ childRunId: `child-${randomUUID()}`, invocationKey: 'setup-failure',
      begin: async () => {}, resolveExecution: async () => { throw new AgentToolError('MODEL_UNAVAILABLE', 'The configured model is unavailable'); },
      abortBeforeStart: async reason => { assert.equal(reason.code, 'MODEL_UNAVAILABLE'); aborted++; },
      release: async () => { released++; }, complete: async () => { assert.fail('no child result'); }, commitChildCheckpoint: async cp => ack(cp),
    }) },
  });
  await assert.rejects(runtime.handler({ task: 'Bounded task' }, { runId: 'setup-failure-parent', durableCall: binding }), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(aborted, 1);
  assert.equal(released, 1);
});

test('a host result-commit failure during cancellation retains the cancelled child receipt', async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const runtime = new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async () => { ready(); return new Promise(() => {}); } },
    persistCheckpoint: async () => 'resume-11111111-1111-4111-8111-111111111111',
    durable: { admit: async () => ({ childRunId: `child-${randomUUID()}`, invocationKey: 'cancelled-original', begin: async () => {},
      resolveExecution: async () => undefined, commitChildCheckpoint: async cp => ack(cp),
      complete: async () => { throw new AgentToolError('DURABLE_OPERATION_UNKNOWN', 'Host has not committed the cancelled result'); },
    }) },
  });
  const pending = runtime.handler({ task: 'Cancelled durable task' }, { runId: 'durable-cancel-parent', durableCall: binding, signal: controller.signal });
  await started; controller.abort();
  const result = await pending, output = result.modelOutput as AgentDelegateOutput;
  assert.equal(output.status, 'cancelled');
  assert.equal(output.receipt.outcome, 'cancelled');
  assert.equal(result.unsettled, true);
  assert.equal(result.usageKnown, false);
});

test('reopening an owned stopped checkout preserves partial edits and rejects another parent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-resume-child-')), source = join(root, 'source');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(source); await writeFile(join(source, 'file.txt'), 'original');
  const manager = new DelegatedWorkspaceManager({ storageRoot: join(root, 'children'), checkpointRootForWorkspace: () => join(root, 'checkpoints') });
  const input = { childRunId: `child-${randomUUID()}`, parentRunId: 'original-parent', workspaceRoot: source, permissionMode: 'workspace_write' as const };
  const original = await manager.prepare(input);
  await writeFile(join(original.workspaceRoot, 'file.txt'), 'partial work');
  await original.review();
  await assert.rejects(manager.prepare({ ...input, resume: true, parentRunId: 'wrong-parent' }), { code: 'CHILD_WORKSPACE_OWNER_MISMATCH' });
  const resumed = await manager.prepare({ ...input, resume: true });
  try {
    assert.equal(resumed.workspaceRoot, original.workspaceRoot);
    assert.equal(await readFile(join(resumed.workspaceRoot, 'file.txt'), 'utf8'), 'partial work');
    assert.equal(await readFile(join(source, 'file.txt'), 'utf8'), 'original');
    const review = await resumed.review();
    assert.equal(review.changes.length, 1);
    assert.equal(review.changes[0].path, 'file.txt');
  } finally { await resumed.dispose(); }
});
