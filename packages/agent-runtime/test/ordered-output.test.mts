import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRunner, AgentToolRegistry, AgentRunInterruptedError, AgentBackendRouter,
  AgentBackendUnavailableError, UnsafeBackendFailoverError, retryAgentRunCheckpoint,
  rebaseAgentRunCheckpoint, AcpAgentBackend, AgentBackendCapabilityError, BuiltinAgentBackend, AgentDelegationRuntime,
  type AgentModelMessage, type AgentRunCheckpoint, type AgentDelegationLifecycle,
} from '../lib/index.js';

const image = { type: 'image' as const, asset: { sha256: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 } };
const parts = [{ type: 'text' as const, text: 'before' }, image, { type: 'text' as const, text: 'after' }, image];
const prompt = { prompt: 'bounded synthetic task', runId: 'run-output-fixture-001' };
const usage = { inputTokens: 1, outputTokens: 2 };
const call = { id: 'read-one', name: 'test.read', arguments: {} };
function tools(counter: { calls: number }) {
  const registry = new AgentToolRegistry();
  registry.register({ name: 'test.read', description: 'Synthetic read', inputSchema: { type: 'object' }, requiredPermission: 'read_only', source: 'builtin' },
    async () => { counter.calls++; return { modelOutput: 'synthetic result', summary: { title: 'Synthetic read complete' } }; });
  return registry;
}

test('pure media requires host opt-in and never fabricates an empty-text answer', async () => {
  const runner = new AgentRunner({ model: { async complete() { return { content: '', outputParts: [image], usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true, captureCheckpoint: true });
  const result = await runner.run(prompt);
  assert.equal(result.finalText, ''); assert.deepEqual(result.outputParts, [image]);
  assert.equal(result.checkpoint?.version, 2);
  assert.deepEqual(result.checkpoint?.messages.at(-1)?.outputParts, [image]);
});

test('old host refuses output refs after exactly one accepted model call and retains usage', async () => {
  let calls = 0;
  const runner = new AgentRunner({ model: { async complete() { calls++; return { content: '', outputParts: [image], usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only' });
  await assert.rejects(runner.run(prompt), (error: unknown) => {
    assert.ok(error instanceof AgentRunInterruptedError); assert.equal(error.code, 'OUTPUT_PARTS_UNSUPPORTED');
    assert.deepEqual(error.checkpoint.usage, usage); assert.equal(error.failure.retrySafe, false); return true;
  });
  assert.equal(calls, 1);
});

test('tool round preserves each output position, private state and paired result on next model call', async () => {
  let requests = 0; const counter = { calls: 0 }; let next: readonly AgentModelMessage[] = [];
  const runner = new AgentRunner({ model: { async complete(request) {
    if (++requests === 1) return { content: 'beforeafter', outputParts: parts, providerState: { privateFixture: true }, toolCalls: [call], usage };
    next = request.messages; return { content: 'done', usage };
  } }, tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true, captureCheckpoint: true });
  const result = await runner.run(prompt), assistant = next.find(message => message.role === 'assistant');
  assert.deepEqual(assistant?.outputParts, parts); assert.deepEqual(assistant?.providerState, { privateFixture: true });
  assert.equal(next.at(-1)?.toolCallId, call.id); assert.equal(counter.calls, 1); assert.equal(requests, 2);
  assert.equal(result.outputParts, undefined, 'earlier tool-turn media must not become the final answer');
  assert.deepEqual(result.events.find(event => event.type === 'model_completed')?.outputParts, parts);
});

for (const known of [true, false]) {
  test(`accepted media plus blocked tools is checkpointed before ${known ? 'exhausted' : 'unknown'} budget pause`, async () => {
    const counter = { calls: 0 }; let models = 0;
    const runner = new AgentRunner({ model: { async complete() { models++; return { content: '', outputParts: [image],
      toolCalls: [call], usage: { inputTokens: 1, outputTokens: 5 }, usageKnown: known }; } }, tools: tools(counter), permissionMode: 'read_only',
      acceptOrderedOutput: true, tokenBudget: { maxOutputTokens: 5 } });
    const result = await runner.run(prompt), checkpoint = result.checkpoint!;
    assert.equal(result.status, 'limit_reached'); assert.equal(checkpoint.version, 2);
    assert.equal(result.finalText, '', 'runtime budget explanation is not model output');
    assert.deepEqual(result.outputParts, [image]); assert.deepEqual(checkpoint.messages.at(-2)?.outputParts, [image]);
    assert.equal(checkpoint.messages.at(-1)?.toolCallId, call.id);
    assert.match(checkpoint.messages.at(-1)?.content || '', /TOOL_NOT_EXECUTED_BUDGET/);
    assert.equal(checkpoint.nextTurn, 2); assert.deepEqual(checkpoint.usage, { inputTokens: 1, outputTokens: 5 });
    assert.equal(checkpoint.seenToolCallIds.includes(call.id), true);
    const retried = retryAgentRunCheckpoint(checkpoint, 'run-output-retry-001');
    assert.deepEqual(retried.messages, checkpoint.messages);
    assert.equal(counter.calls, 0); assert.equal(models, 1);
  });
}

test('v1 cannot smuggle output refs and v2 cannot run without host acceptance', async () => {
  let calls = 0;
  const checkpoint = { version: 1, runId: prompt.runId, nextTurn: 2, segment: 1,
    messages: [{ role: 'user', content: prompt.prompt }, { role: 'assistant', content: '', outputParts: [image] }],
    seenToolCallIds: [], usage, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() } as AgentRunCheckpoint;
  const runner = new AgentRunner({ model: { async complete() { calls++; return { content: 'wrong', usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only' });
  await assert.rejects(runner.run({ ...prompt, checkpoint }), /checkpoint/i);
  await assert.rejects(runner.run({ ...prompt, checkpoint: { ...checkpoint, version: 2 } }), /output/i);
  assert.equal(calls, 0);
});

test('media group in older turns is safely summarized during compaction so the run continues without pausing', async () => {
  let calls = 0;
  let seenMessages: readonly AgentModelMessage[] = [];
  const messages = [{ role: 'user', content: prompt.prompt }, { role: 'assistant', content: '', outputParts: [image] },
    ...Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `older-${index}` }))] as AgentModelMessage[];
  const checkpoint = { version: 2, runId: prompt.runId, nextTurn: 3, segment: 2, messages,
    seenToolCallIds: [], usage, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() } as AgentRunCheckpoint;
  const runner = new AgentRunner({ model: { async complete(req) { calls++; seenMessages = req.messages; return { content: 'continued after media compaction', usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true, maxTurns: 2 });
  const result = await runner.run({ ...prompt, checkpoint });
  assert.equal(result.status, 'completed'); assert.equal(result.stopReason, 'completed');
  assert.equal(calls, 1);
  assert.ok(seenMessages.some(message => message.content.includes('outputAsset(image)')));
});

test('accepted response blocks backend failover even before a media event or visible text', async () => {
  let fallback = 0;
  const capabilities = { streaming: true, cancellation: true, sessionResume: true, permissions: true, filesystem: false, terminal: false, mcp: false };
  const router = new AgentBackendRouter({ candidates: [
    { backend: { id: 'paid', capabilities, async run(request) {
      await request.onEvent?.({ type: 'model_attempt_completed', turn: 1, attempt: 1, outcome: 'succeeded', startedAt: '', at: '', durationMs: 1, retryScheduled: false });
      throw new AgentBackendUnavailableError('local output publication failed');
    } } },
    { backend: { id: 'fallback', capabilities, async run(request) { fallback++; return { runId: request.runId!, status: 'completed', stopReason: 'completed',
      finalText: 'must not happen', events: [], usage, turns: 1, toolCalls: 0 }; } } },
  ] });
  await assert.rejects(router.run({ prompt: prompt.prompt, workspaceRoot: '/synthetic-no-files', permissionMode: 'read_only' }), UnsafeBackendFailoverError);
  assert.equal(fallback, 0);
});

test('ordered text projection is exact even when the content field disagrees', async () => {
  const ordered = [{ type: 'text' as const, text: '  before\n' }, image, { type: 'text' as const, text: '\tafter  ' }];
  const runner = new AgentRunner({ model: { async complete() { return { content: 'conflicting text', outputParts: ordered, usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true, captureCheckpoint: true });
  const result = await runner.run(prompt);
  assert.equal(result.finalText, '  before\n\tafter  ');
  assert.equal(result.checkpoint?.messages.at(-1)?.content, result.finalText);
});

for (const stage of ['model_attempt_completed', 'model_completed', 'assistant_progress'] as const) {
  test(`accepted output survives ${stage} observer failure without reverse completion or repeated usage`, async () => {
    let calls = 0; const counter = { calls: 0 };
    const runner = new AgentRunner({ model: { async complete() { calls++; return { content: '', outputParts: [image], toolCalls: [call], usage }; } },
      tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true,
      onEvent(event) { if (event.type === stage) throw new Error('private observer sentinel'); } });
    await assert.rejects(runner.run(prompt), (error: unknown) => {
      assert.ok(error instanceof AgentRunInterruptedError);
      assert.equal(error.code, 'OUTPUT_EVENT_DELIVERY_FAILED'); assert.doesNotMatch(error.message, /sentinel/);
      assert.deepEqual(error.checkpoint.usage, usage); assert.deepEqual(error.checkpoint.messages.at(-2)?.outputParts, [image]);
      assert.equal(error.checkpoint.messages.at(-1)?.toolCallId, call.id); assert.equal(error.checkpoint.nextTurn, 2);
      assert.equal(error.events.filter(event => event.type === 'model_attempt_completed' && event.outcome === 'failed').length, 0);
      assert.equal(error.failure.retrySafe, false); return true;
    });
    assert.equal(calls, 1); assert.equal(counter.calls, 0);
  });
}

for (const abort of [false, true]) {
  test(`paid Node rejection retains known usage exactly once${abort ? ' even if its observer cancels' : ''}`, async () => {
    let calls = 0; const controller = new AbortController();
    const runner = new AgentRunner({ model: { async complete() { calls++; throw Object.assign(new Error('unsupported output'),
      { code: 'UNSUPPORTED_OUTPUT', usage, usageKnown: true, providerAccepted: true, retrySafe: false, retryable: false }); } },
      tools: new AgentToolRegistry(), permissionMode: 'read_only', tokenBudget: { maxOutputTokens: 30 },
      onEvent(event) { if (abort && event.type === 'model_attempt_completed') controller.abort(); } });
    if (abort) {
      const result = await runner.run({ ...prompt, signal: controller.signal });
      assert.equal(result.status, 'cancelled'); assert.deepEqual(result.usage, usage); assert.equal(result.usageKnown, true);
    } else await assert.rejects(runner.run(prompt), (error: unknown) => {
      assert.ok(error instanceof AgentRunInterruptedError); assert.deepEqual(error.checkpoint.usage, usage);
      assert.equal(error.checkpoint.usageKnown, true); assert.equal(error.checkpoint.tokenBudget?.remainingOutputTokens, 28); return true;
    });
    assert.equal(calls, 1);
  });
}

test('router cannot override a paid Node failure with a permissive fallback classifier', async () => {
  let fallback = 0;
  const paid = new BuiltinAgentBackend({ model: { async complete() { throw Object.assign(new Error('paid output unsupported'),
    { code: 'UNSUPPORTED_OUTPUT', usage, usageKnown: true, retrySafe: false, retryable: false }); } }, tools: new AgentToolRegistry() });
  const router = new AgentBackendRouter({ candidates: [{ backend: paid, isRetryableError: () => true },
    { backend: { id: 'never', capabilities: paid.capabilities, async run() { fallback++; throw new Error('wrong'); } } }] });
  await assert.rejects(router.run({ ...prompt, workspaceRoot: '/synthetic', permissionMode: 'read_only' }), (error: unknown) => {
    assert.ok(error instanceof AgentRunInterruptedError); assert.deepEqual(error.checkpoint.usage, usage); return true;
  });
  assert.equal(fallback, 0);
});

test('legacy backend result and media event cannot silently feed an unopted host', async () => {
  const capabilities = { streaming: true, cancellation: true, sessionResume: true, permissions: true, filesystem: false, terminal: false, mcp: false };
  for (const event of [false, true]) {
    let next = 0;
    const router = new AgentBackendRouter({ candidates: [{ backend: { id: 'legacy', capabilities, async run(request) {
      if (event) await request.onEvent?.({ type: 'model_completed', turn: 1, toolCallCount: 0, outputParts: [image], at: '' });
      return { runId: request.runId!, status: 'completed', stopReason: 'completed', finalText: 'wrong', outputParts: [image], events: [], usage, turns: 1, toolCalls: 0 };
    } }, isRetryableError: () => true }, { backend: { id: 'next', capabilities, async run() { next++; throw new Error('wrong'); } } }] });
    await assert.rejects(router.run({ ...prompt, workspaceRoot: '/synthetic', permissionMode: 'read_only' }), /host does not accept/i);
    assert.equal(next, 0);
  }
});

test('ACP and router reject refs before process spawn or unsupported backend dispatch', async () => {
  const backend = new AcpAgentBackend({ id: 'no-spawn', command: '/synthetic/this-command-must-never-start' });
  for (const accept of [true, undefined] as const) {
    await assert.rejects(backend.run({ ...prompt, workspaceRoot: '/synthetic', permissionMode: 'read_only',
      acceptOrderedOutput: accept, history: [{ role: 'assistant', content: '', outputParts: [image] }] }), AgentBackendCapabilityError);
  }
  const router = new AgentBackendRouter({ candidates: [{ backend }] });
  await assert.rejects(router.run({ ...prompt, workspaceRoot: '/synthetic', permissionMode: 'read_only', acceptOrderedOutput: true }), /capabilities/i);
});

test('history and retry checkpoint use the same ordered text projection without granting asset access', async () => {
  let received: readonly AgentModelMessage[] = [];
  const runner = new AgentRunner({ model: { async complete(request) { received = request.messages; return { content: 'done', usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true, captureCheckpoint: true });
  const result = await runner.run({ ...prompt, history: [{ role: 'assistant', content: 'not canonical', outputParts: parts }] });
  assert.equal(received[0].content, 'beforeafter'); assert.deepEqual(received[0].outputParts, parts);
  const retried = retryAgentRunCheckpoint(result.checkpoint!, 'ordered-history-retry');
  assert.equal(retried.version, 2); assert.deepEqual(retried.messages[0].outputParts, parts);
  assert.notEqual(retried.messages[0].outputParts, result.checkpoint!.messages[0].outputParts);
});

test('manual rebase that removes older media summarizes it into continuity memory without mutating original checkpoint', () => {
  const checkpoint: AgentRunCheckpoint = { version: 2, runId: prompt.runId, nextTurn: 3, segment: 2,
    messages: [{ role: 'user', content: prompt.prompt }, { role: 'assistant', content: '', outputParts: [image] },
      ...Array.from({ length: 20 }, (_, index): AgentModelMessage => ({ role: index % 2 ? 'assistant' : 'user', content: `turn-${index}` }))],
    seenToolCallIds: [], usage, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() };
  const before = JSON.stringify(checkpoint);
  const rebased = rebaseAgentRunCheckpoint(checkpoint, { runId: 'ordered-rebase-fixture', direction: 'continue' });
  assert.equal(rebased.runId, 'ordered-rebase-fixture');
  assert.match(rebased.messages[1].content, /outputAsset\(image\):.*mimeType=image\/png/i);
  assert.equal(JSON.stringify(checkpoint), before);
});

test('cancellation after ordered completion pairs planned tools and retains the media once', async () => {
  const controller = new AbortController(); const counter = { calls: 0 };
  const runner = new AgentRunner({ model: { async complete() { return { content: '', outputParts: [image], toolCalls: [call], usage }; } },
    tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true,
    onEvent(event) { if (event.type === 'model_completed') controller.abort(); } });
  const result = await runner.run({ ...prompt, signal: controller.signal });
  assert.equal(result.status, 'cancelled'); assert.deepEqual(result.outputParts, [image]); assert.deepEqual(result.usage, usage);
  assert.equal(result.finalText, '');
  assert.equal(result.checkpoint?.nextTurn, 2); assert.equal(result.checkpoint?.messages.at(-1)?.toolCallId, call.id);
  assert.match(result.checkpoint?.messages.at(-1)?.content || '', /TOOL_NOT_EXECUTED_CANCELLED/); assert.equal(counter.calls, 0);
});

test('child ordered result remains child-owned and is not promoted into the parent final answer', async () => {
  const registry = new AgentToolRegistry(); const lifecycle: AgentDelegationLifecycle[] = []; let count = 0;
  const child = new AgentDelegationRuntime({ model: { async complete() { return { content: '', outputParts: [image], usage }; } },
    tools: registry, maxPermissionMode: 'read_only', allowedToolNames: [], acceptOrderedOutput: true,
    onLifecycle(event) { lifecycle.push(event); } });
  child.register();
  const runner = new AgentRunner({ model: { async complete() { return ++count === 1
    ? { content: 'delegating', toolCalls: [{ id: 'delegate-one', name: 'agent.delegate', arguments: { task: 'child task' } }], usage }
    : { content: 'parent result', usage }; } }, tools: registry, permissionMode: 'read_only', captureCheckpoint: true });
  const result = await runner.run(prompt); const completed = lifecycle.find(event => event.type === 'completed');
  assert.ok(completed?.type === 'completed'); assert.deepEqual(completed.result.outputParts, [image]);
  assert.equal(completed.checkpoint?.version, 2); assert.equal(completed.parentRunId, result.runId);
  assert.notEqual(completed.childRunId, result.runId); assert.equal(completed.checkpoint?.runId, completed.childRunId);
  assert.equal(result.outputParts, undefined); assert.equal(result.checkpoint?.version, 1);
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 6 });
});

test('v2 requires complete tool pairs and cannot use the legacy missing-tail repair', () => {
  const checkpoint: AgentRunCheckpoint = { version: 2, runId: prompt.runId, nextTurn: 2, segment: 1,
    messages: [{ role: 'user', content: prompt.prompt }, { role: 'assistant', content: '', outputParts: [image], toolCalls: [call] }],
    seenToolCallIds: [], usage, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() };
  assert.throws(() => retryAgentRunCheckpoint(checkpoint, 'ordered-broken-retry'), /not paired|missing a tool/i);
  const sparse = [...checkpoint.messages]; delete sparse[0];
  assert.throws(() => retryAgentRunCheckpoint({ ...checkpoint, messages: sparse }, 'ordered-sparse-retry'), /checkpoint/i);
});

test('compaction can retain recent media without falsely pausing or dropping positions', async () => {
  let received: readonly AgentModelMessage[] = [];
  const checkpoint: AgentRunCheckpoint = { version: 2, runId: prompt.runId, nextTurn: 3, segment: 2,
    messages: [{ role: 'user', content: prompt.prompt }, ...Array.from({ length: 20 }, (_, index): AgentModelMessage =>
      ({ role: index % 2 ? 'assistant' : 'user', content: `older-${index}` })), { role: 'assistant', content: '', outputParts: [image, image] }],
    seenToolCallIds: [], usage, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() };
  const runner = new AgentRunner({ model: { async complete(request) { received = request.messages; return { content: 'done', usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true, maxTurns: 2, captureCheckpoint: true });
  const result = await runner.run({ ...prompt, checkpoint });
  assert.equal(result.status, 'completed'); assert.equal(result.events.some(event => event.type === 'context_compaction_completed'), true);
  assert.deepEqual(received.at(-1)?.outputParts, [image, image]); assert.equal(result.checkpoint?.version, 2);
});

test('tool-call ceiling retains media with executed and skipped tools paired in order', async () => {
  const counter = { calls: 0 }; const second = { ...call, id: 'read-two' };
  const runner = new AgentRunner({ model: { async complete() { return { content: '', outputParts: [image], toolCalls: [call, second], usage }; } },
    tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true, maxToolCalls: 1 });
  const result = await runner.run(prompt);
  assert.equal(result.stopReason, 'tool_call_limit_reached'); assert.deepEqual(result.outputParts, [image]);
  assert.equal(result.finalText, '');
  assert.deepEqual(result.checkpoint?.messages.slice(-2).map(message => message.toolCallId), [call.id, second.id]);
  assert.equal(counter.calls, 1); assert.deepEqual(result.usage, usage); assert.equal(result.checkpoint?.nextTurn, 2);
});

test('queued steering keeps ordered media on its own assistant message and not the next result', async () => {
  let calls = 0; let queued = true; let received: readonly AgentModelMessage[] = [];
  const runner = new AgentRunner({ model: { async complete(request) { received = request.messages; return ++calls === 1
    ? { content: '', outputParts: [image], usage } : { content: 'followed direction', usage }; } }, tools: new AgentToolRegistry(),
    permissionMode: 'read_only', acceptOrderedOutput: true, takeSteeringMessages() {
      if (!queued) return []; queued = false; return [{ id: 'direction-fixture', content: 'additional task', createdAt: new Date(0).toISOString() }];
    } });
  const result = await runner.run(prompt);
  assert.equal(calls, 2); assert.deepEqual(received.at(-2)?.outputParts, [image]);
  assert.equal(received.at(-1)?.content, 'additional task'); assert.equal(result.outputParts, undefined);
});

test('paid error evidence overrides contradictory retry flags without a second model attempt', async () => {
  let calls = 0;
  const runner = new AgentRunner({ model: { async complete() { calls++; throw Object.assign(new Error('badly classified accepted output'),
    { code: 'UPSTREAM_UNAVAILABLE', usage, usageKnown: true, providerAccepted: true, retrySafe: true, retryable: true }); } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only' });
  await assert.rejects(runner.run(prompt), (error: unknown) => {
    assert.ok(error instanceof AgentRunInterruptedError); assert.equal(error.failure.retrySafe, false);
    assert.deepEqual(error.checkpoint.usage, usage); return true;
  });
  assert.equal(calls, 1);
});

test('an invalid accepted tool batch preserves paid usage and ordered refs without executing or becoming retryable', async () => {
  const counter = { calls: 0 };
  const runner = new AgentRunner({ model: { async complete() { return { content: '', outputParts: [image], toolCalls: [call, call], usage }; } },
    tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true });
  await assert.rejects(runner.run(prompt), (error: unknown) => {
    assert.ok(error instanceof AgentRunInterruptedError); assert.equal(error.code, 'DUPLICATE_TOOL_CALL');
    assert.deepEqual(error.checkpoint.usage, usage); assert.deepEqual(error.checkpoint.messages.at(-1)?.outputParts, [image]);
    assert.equal(error.checkpoint.messages.at(-1)?.toolCalls, undefined); assert.equal(error.failure.retrySafe, false); return true;
  });
  assert.equal(counter.calls, 0);
});

test('empty ordered output without tools is not a fabricated successful media answer', async () => {
  const runner = new AgentRunner({ model: { async complete() { return { content: 'conflicting visible text', outputParts: [], usage }; } },
    tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true });
  await assert.rejects(runner.run(prompt), (error: unknown) => {
    assert.ok(error instanceof AgentRunInterruptedError); assert.equal(error.code, 'INVALID_MODEL_RESPONSE');
    assert.deepEqual(error.checkpoint.usage, usage); assert.equal(error.failure.retrySafe, false); return true;
  });
});

test('an empty ordered list with blocked tools still preserves every planned pair', async () => {
  const counter = { calls: 0 };
  const runner = new AgentRunner({ model: { async complete() { return { content: '', outputParts: [], toolCalls: [call], usage, usageKnown: false }; } },
    tools: tools(counter), permissionMode: 'read_only', acceptOrderedOutput: true, tokenBudget: { maxOutputTokens: 10 } });
  const result = await runner.run(prompt);
  assert.equal(result.stopReason, 'token_usage_unknown'); assert.equal(result.finalText, ''); assert.deepEqual(result.outputParts, []);
  assert.equal(result.checkpoint?.version, 2); assert.equal(result.checkpoint?.nextTurn, 2);
  assert.equal(result.checkpoint?.messages.at(-1)?.toolCallId, call.id); assert.equal(counter.calls, 0);
});
