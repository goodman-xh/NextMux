import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentRunInterruptedError, AgentToolRegistry, ToolExecutionLedger, durableCheckpointHash, retryAgentRunCheckpoint,
  type AgentRunCheckpoint, type AgentDurableCheckpointAck, type AgentModelClient } from '../lib/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const copy = (cp: AgentRunCheckpoint): AgentRunCheckpoint => structuredClone(cp);
const call = { id: 'original-stable-call', name: 'fixture.effect', arguments: { value: 'original' } };
function harness(loseAt?: 'admission' | 'completed' | 'paired') {
  let saved: AgentRunCheckpoint | undefined, revision = 0, effects = 0, lost = false;
  const tools = new AgentToolRegistry();
  tools.register({ name: 'fixture.effect', description: 'Synthetic in-memory effect', source: 'builtin',
    requiredPermission: 'read_only', inputSchema: { type: 'object' } }, async () => {
      effects++;
      return { modelOutput: 'Original effect result', usage: { inputTokens: 17, outputTokens: 4 }, usageKnown: false,
        summary: { title: 'Synthetic effect' } };
    });
  const writer = async (cp: AgentRunCheckpoint): Promise<AgentDurableCheckpointAck> => {
    saved = copy(cp);
    const match = loseAt === 'admission' ? cp.pendingToolBatch?.calls[0]?.state === 'prepared'
      : loseAt === 'completed' ? cp.pendingToolBatch?.calls[0]?.state === 'completed'
      : loseAt === 'paired' ? !cp.pendingToolBatch && cp.accountedOperationIds?.length === 1 : false;
    if (match && !lost) { lost = true; throw new Error('Synthetic lost durable ACK'); }
    return { handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
      admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: ++revision };
  };
  const runner = (model: AgentModelClient) => new AgentRunner({ model, tools, permissionMode: 'read_only',
    allowedToolNames: [call.name], maxTurns: 5, maxTotalTurns: 5, captureCheckpoint: true, onDurableCheckpoint: writer });
  return { tools, writer, runner, saved: () => saved!, effects: () => effects };
}

test('durable admission requires an actual ACK before a tool effect', async () => {
  const f = harness();
  const runner = new AgentRunner({ tools: f.tools, permissionMode: 'read_only', allowedToolNames: [call.name],
    onDurableCheckpoint: async cp => cp.pendingToolBatch ? undefined as never : f.writer(cp),
    model: { complete: async () => ({ toolCalls: [call], usage: { inputTokens: 9, outputTokens: 2 }, usageKnown: true }) } });
  await assert.rejects(runner.run({ prompt: 'Synthetic original task', runId: 'ack-before-effect-fixture' }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    assert.equal(error.checkpoint.pendingToolBatch?.originalAssistantMessage.toolCalls?.[0]?.id, call.id);
    assert.deepEqual(error.checkpoint.usage, { inputTokens: 9, outputTokens: 2 });
    return true;
  });
  assert.equal(f.effects(), 0);
});

for (const loseAt of ['completed', 'paired'] as const) test(`${loseAt} ACK loss reuses original effect and accounts its usage once`, async () => {
  const f = harness(loseAt);
  await assert.rejects(f.runner({ complete: async () => ({ toolCalls: [call], usage: { inputTokens: 9, outputTokens: 2 }, usageKnown: true }) })
    .run({ prompt: 'Synthetic original task', runId: 'first-durable-fixture' }), AgentRunInterruptedError);
  assert.equal(f.effects(), 1);
  let modelCalls = 0;
  const result = await f.runner({ complete: async () => { modelCalls++; return { content: 'done', usage: { inputTokens: 3, outputTokens: 1 }, usageKnown: true }; } })
    .run({ prompt: 'Synthetic original task', runId: 'resumed-durable-fixture', checkpoint: retryAgentRunCheckpoint(f.saved(), 'resumed-durable-fixture') });
  assert.equal(f.effects(), 1);
  assert.equal(modelCalls, 1);
  assert.deepEqual(result.usage, { inputTokens: 29, outputTokens: 7 });
  assert.equal(result.usageKnown, false);
  assert.equal(result.checkpoint?.accountedOperationIds?.length, 1);
  assert.equal(result.checkpoint?.pendingToolBatch, undefined);
  assert.equal(result.checkpoint?.messages.find(m => m.toolCallId === call.id)?.role, 'tool');
});

test('recovered admission retains stable call IDs and refuses a repeated ID', async () => {
  const f = harness('admission');
  await assert.rejects(f.runner({ complete: async () => ({ toolCalls: [call], usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: true }) })
    .run({ prompt: 'Synthetic original task', runId: 'stable-first-fixture' }), AgentRunInterruptedError);
  assert.equal(f.effects(), 0);
  let models = 0;
  await assert.rejects(f.runner({ complete: async () => { models++; return {
    toolCalls: [call], usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: true }; } })
    .run({ prompt: 'Synthetic original task', runId: 'stable-resumed-fixture', checkpoint: retryAgentRunCheckpoint(f.saved(), 'stable-resumed-fixture') }), error => {
      assert.ok(error instanceof AgentRunInterruptedError);
      assert.equal(error.code, 'DUPLICATE_TOOL_CALL');
      assert.equal(error.checkpoint.accountedOperationIds?.length, 1);
      assert.deepEqual(error.checkpoint.usage, { inputTokens: 17, outputTokens: 4 });
      assert.equal(error.checkpoint.usageKnown, false);
      return true;
    });
  assert.equal(f.effects(), 1);
  assert.equal(models, 1);
});

test('crash after an effect ledger commit but before the result checkpoint hydrates its result without execution', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-durable-commit-gap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = await ToolExecutionLedger.open({ journalPath: join(root, 'effects.jsonl') });
  const tools = new AgentToolRegistry({ executionLedger: ledger });
  let saved: AgentRunCheckpoint | undefined, effects = 0, crash = true;
  const media = [{ kind: 'image' as const, name: 'result.png', mimeType: 'image/png' as const, dataBase64: 'YQ==' }];
  tools.register({ name: call.name, description: 'durable effect', requiredPermission: 'workspace_write', executionKind: 'side_effect',
    source: 'builtin', inputSchema: { type: 'object' } }, async () => {
    effects++;
    return { modelOutput: { original: 'durable result' }, attachments: media,
      usage: { inputTokens: 4, outputTokens: 2 }, usageKnown: true, summary: { title: 'effect committed' } };
  });
  const writer = async (cp: AgentRunCheckpoint) => {
    if (crash && cp.pendingToolBatch?.calls[0].state === 'completed') throw new Error('crash before result save');
    saved = copy(cp);
    return { handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
      admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 };
  };
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'workspace_write', onDurableCheckpoint: writer,
    model: { complete: async () => ({ toolCalls: [call], usage: { inputTokens: 2, outputTokens: 1 } }) },
  }).run({ prompt: 'Retain original task', runId: 'durable-gap-first' }), AgentRunInterruptedError);
  assert.equal(saved!.pendingToolBatch?.calls[0].state, 'running');
  assert.equal(effects, 1);
  crash = false;
  const recovered = await new AgentRunner({ tools, permissionMode: 'workspace_write', captureCheckpoint: true, onDurableCheckpoint: writer,
    model: { complete: async request => {
      const result = request.messages.find(message => message.toolCallId === call.id)!;
      assert.equal(JSON.parse(result.content).output.original, 'durable result');
      assert.deepEqual(result.attachments, media);
      return { content: 'done', usage: { inputTokens: 3, outputTokens: 1 } };
    } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(saved!, 'durable-gap-resume') });
  assert.equal(recovered.status, 'completed');
  assert.equal(effects, 1);
  assert.deepEqual(recovered.usage, { inputTokens: 9, outputTokens: 4 });
  assert.equal(recovered.checkpoint?.taskAnchor?.content, 'Retain original task');
});

test('a crash during an effect with no committed result stays unknown and never reexecutes', async () => {
  const f = harness();
  let saved: AgentRunCheckpoint | undefined;
  const runner = new AgentRunner({ tools: f.tools, permissionMode: 'read_only', allowedToolNames: [call.name], onDurableCheckpoint: async cp => {
    if (cp.pendingToolBatch?.calls[0].state === 'running') { saved = copy(cp); throw new Error('crash at start'); }
    return f.writer(cp);
  }, model: { complete: async () => ({ toolCalls: [call], usage: { inputTokens: 0, outputTokens: 0 } }) } });
  await assert.rejects(runner.run({ prompt: 'Crash fixture', runId: 'durable-unknown-first' }), AgentRunInterruptedError);
  await assert.rejects(f.runner({ complete: async () => { assert.fail('unknown effect cannot advance the model'); } })
    .run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(saved!, 'durable-unknown-resume') }), { code: 'DURABLE_TOOL_UNKNOWN' });
  assert.equal(f.effects(), 0);
});

test('a new v3 batch after resume executes a newly requested effect instead of replaying an older batch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-durable-new-batch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = new AgentToolRegistry({ executionLedger: await ToolExecutionLedger.open({ journalPath: join(root, 'effects.jsonl') }) });
  let effects = 0, saved: AgentRunCheckpoint | undefined;
  tools.register({ name: call.name, description: 'Effect with the same input in two logical batches', requiredPermission: 'workspace_write',
    executionKind: 'side_effect', source: 'builtin', inputSchema: { type: 'object' } }, async () => ({
    modelOutput: ++effects, summary: { title: 'Effect' },
  }));
  const ack = (cp: AgentRunCheckpoint) => ({ handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
    admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 });
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'workspace_write', onDurableCheckpoint: async cp => {
    saved = copy(cp);
    if (cp.accountedOperationIds?.length && !cp.pendingToolBatch) throw new Error('crash after paired result');
    return ack(cp);
  }, model: { complete: async () => ({ toolCalls: [call], usage: { inputTokens: 1, outputTokens: 1 } }) },
  }).run({ prompt: 'Execute distinct requested operations', runId: 'new-batch-initial' }), AgentRunInterruptedError);
  let requests = 0;
  const result = await new AgentRunner({ tools, permissionMode: 'workspace_write', onDurableCheckpoint: async cp => ack(cp),
    model: { complete: async request => {
      if (++requests === 1) return { toolCalls: [{ ...call, id: 'second-original-call' }], usage: { inputTokens: 1, outputTokens: 1 } };
      assert.equal(JSON.parse(request.messages.at(-1)!.content).output, 2);
      return { content: 'Both operations complete', usage: { inputTokens: 1, outputTokens: 1 } };
    } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(saved!, 'new-batch-resumed') });
  assert.equal(result.status, 'completed');
  assert.equal(effects, 2);
});

test('an unacknowledged cancellation retains a running durable call and never authorizes replay', async () => {
  const tools = new AgentToolRegistry(), controller = new AbortController();
  let effects = 0, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  tools.register({ name: call.name, description: 'Uncooperative in-flight effect', requiredPermission: 'workspace_write',
    executionKind: 'side_effect', source: 'builtin', inputSchema: { type: 'object' } }, async () => {
    effects++; ready(); return new Promise(() => {});
  });
  const writer = async (cp: AgentRunCheckpoint) => ({ handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
    admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 });
  const run = new AgentRunner({ tools, permissionMode: 'workspace_write', onDurableCheckpoint: writer,
    model: { complete: async () => ({ toolCalls: [call], usage: { inputTokens: 1, outputTokens: 1 } }) },
  }).run({ prompt: 'Stop an effect', runId: 'unsettled-effect-run', signal: controller.signal });
  await started; controller.abort();
  const stopped = await run;
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.usageKnown, false);
  assert.equal(stopped.checkpoint?.pendingToolBatch?.calls[0].state, 'running');
  const event = stopped.events.find(event => event.type === 'tool_completed');
  assert.ok(event?.type === 'tool_completed' && event.unknownSideEffect && event.status === 'cancelled');
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'workspace_write', onDurableCheckpoint: writer,
    model: { complete: async () => { assert.fail('unverified effects cannot advance'); } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(stopped.checkpoint!, 'unsettled-effect-resume') }), { code: 'DURABLE_TOOL_UNKNOWN' });
  assert.equal(effects, 1);
});
