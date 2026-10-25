import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, durableCheckpointHash, retryAgentRunCheckpoint,
  type AgentDurableCheckpointAck, type AgentModelMessage, type AgentRunCheckpoint } from '../lib/index.js';

// Once the working window is compacted, checkpoints keep the raw history so a resume (perhaps on a larger model) can
// fit it afresh, while the model is sent the compacted window. The raw copy stays within what a host can persist.

const history = (count: number, text: (index: number) => string): AgentModelMessage[] =>
  Array.from({ length: count }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `history-${index} ${text(index)}` }));

test('checkpoints keep the raw history while the model receives the compacted window', async () => {
  const sent: (readonly AgentModelMessage[])[] = [];
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 8000, captureCheckpoint: true,
    model: { async complete(request) { sent.push(request.messages); return { content: 'Continue exact goal' }; } } })
    .run({ prompt: 'EXACT_CURRENT_GOAL', history: history(24, () => 'context '.repeat(500)), runId: 'run-raw-checkpoint-001' });
  assert.equal(result.status, 'completed');
  assert.ok(result.events.some(event => event.type === 'context_compaction_completed'));
  assert.match(sent[0][0].content, /^NEXTMUX_CONTINUITY_V1\n/, 'the model gets the compacted window');
  assert.ok(sent[0].length < 24);
  const checkpointed = result.checkpoint!.messages;
  assert.deepEqual(checkpointed.slice(0, 24).map(message => message.content.split(' ')[0]), Array.from({ length: 24 }, (_, index) => `history-${index}`));
  assert.equal(checkpointed[24].content, 'EXACT_CURRENT_GOAL');
  assert.equal(checkpointed.at(-1)?.content, 'Continue exact goal');
  assert.equal(checkpointed.length, 26);
});

test('raw history too large to persist is not kept: the checkpoint holds the compacted window', async () => {
  // 24 messages of 64,000 CJK characters are about 4.6 MB of UTF-8, above the 4 MB the raw copy may take.
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', captureCheckpoint: true,
    getContextLimits: () => ({ messageTransportLimits: { maxMessages: 10, maxMessageCharacters: 600_000, maxContextCharacters: 10_000_000 } }),
    model: { async complete(request) { assert.ok(request.messages.length <= 10); return { content: 'Answered' }; } } })
    .run({ prompt: 'Summarize the thread', history: history(24, () => '汉'.repeat(64_000)), runId: 'run-raw-checkpoint-002' });
  assert.equal(result.status, 'completed');
  assert.ok(result.events.some(event => event.type === 'context_compaction_completed'));
  const checkpointed = result.checkpoint!.messages;
  assert.ok(checkpointed.length <= 11, `window checkpointed, not the ${checkpointed.length}-message raw history`);
  assert.equal(checkpointed.at(-1)?.content, 'Answered');
  assert.ok(Buffer.byteLength(JSON.stringify(checkpointed), 'utf8') < 4 * 1024 * 1024);
});

test('raw history switches to the window between tool batches, never inside one, so every checkpoint stays restorable', async () => {
  const tools = new AgentToolRegistry();
  // Not concurrency-safe: the calls of one batch run in turn, with a checkpoint between them.
  tools.register({ name: 'fixture.effect', description: 'Synthetic in-memory effect', source: 'builtin',
    requiredPermission: 'read_only', inputSchema: { type: 'object' } }, async () => ({ modelOutput: 'effect done', summary: { title: 'Synthetic effect' } }));
  let revision = 0;
  const saved: AgentRunCheckpoint[] = [];
  const writer = async (checkpoint: AgentRunCheckpoint): Promise<AgentDurableCheckpointAck> => {
    saved.push(structuredClone(checkpoint));
    return { handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: checkpoint.executionScopeId!,
      admissionId: checkpoint.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(checkpoint), revision: ++revision };
  };
  const first = await new AgentRunner({ tools, permissionMode: 'read_only', allowedToolNames: ['fixture.effect'], maxTurns: 1, maxTotalTurns: 1,
    onDurableCheckpoint: writer, model: { complete: async () => ({ toolCalls: [{ id: 'first-call', name: 'fixture.effect', arguments: {} }] }) } })
    .run({ prompt: 'Long task', runId: 'raw-threshold-first-fixture' });
  assert.ok(first.checkpoint);
  // 4,093 messages: the next batch ends exactly at the 4,096-message limit, the one after crosses it mid-batch.
  const earlier: AgentModelMessage[] = Array.from({ length: 4090 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `earlier ${index}` }));
  const padded = { ...first.checkpoint, messages: [...earlier, ...first.checkpoint.messages] };
  assert.equal(padded.messages.length, 4093);
  saved.length = 0;
  let turns = 0;
  const resumed = await new AgentRunner({ tools, permissionMode: 'read_only', allowedToolNames: ['fixture.effect'], maxTurns: 50, maxTotalTurns: 50,
    contextWindowTokens: 16_000, onDurableCheckpoint: writer,
    model: { complete: async () => {
      turns += 1;
      return turns > 3 ? { content: 'done' }
        : { toolCalls: [1, 2].map(index => ({ id: `resume-${turns}-${index}`, name: 'fixture.effect', arguments: { index } })) };
    } } })
    .run({ prompt: 'Long task', runId: 'raw-threshold-resume-fixture', checkpoint: retryAgentRunCheckpoint(padded, 'raw-threshold-resume-fixture') });
  assert.equal(resumed.status, 'completed');
  assert.ok(resumed.events.some(event => event.type === 'context_compaction_completed'));
  for (const checkpoint of saved) {
    assert.doesNotThrow(() => retryAgentRunCheckpoint(checkpoint, 'raw-threshold-probe-fixture'),
      `restorable: ${checkpoint.messages.length} messages, batch index ${checkpoint.pendingToolBatch?.messageIndex}`);
  }
  const lengths = saved.map(checkpoint => checkpoint.messages.length);
  assert.equal(Math.max(...lengths), 4096, 'raw history is kept up to the message limit');
  assert.ok(saved.some(checkpoint => checkpoint.pendingToolBatch?.messageIndex === 4096 && checkpoint.messages.length === 4096),
    'the batch that crosses the limit keeps the raw copy it began with');
  assert.ok(lengths.at(-1)! < 100, 'after that batch the compacted window is checkpointed');
});
