import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDelegationRuntime, AgentRunner, AgentToolRegistry, normalizeRuntimeFinalMessage, toolCallArguments, type AgentModelRequest } from '../lib/index.js';

test('a truncated reply retains exact text and provider state for continuation', async () => {
  const requests: AgentModelRequest[] = [];
  const state = { kind: 'thinking', reasoning_content: 'private state' };
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: 'read_only', captureCheckpoint: true,
    model: { async complete(request) {
      requests.push(structuredClone({ ...request, signal: undefined, onTextDelta: undefined, onProviderEvent: undefined }));
      return requests.length === 1 ? { content: 'Part one\n  ', finishReason: 'length', providerState: state,
        usage: { inputTokens: 2, outputTokens: 3 } } : { content: 'Part two', finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 5 } };
    } },
  }).run({ prompt: 'Give a long answer', runId: 'run-output-continuation' });
  assert.equal(result.status, 'completed');
  assert.equal(result.turns, 2);
  // The continuation is joined in place: the turn reports the whole reply, the transcript keeps one message for it.
  assert.equal(result.finalText, 'Part one\n  Part two');
  assert.deepEqual(requests[1].messages.at(-2), { role: 'assistant', content: 'Part one\n  ', providerState: state });
  assert.match(requests[1].messages.at(-1)!.content, /cut off by the output limit; continue exactly where you stopped, or make the tool call/);
  assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 8 });
  assert.deepEqual(result.checkpoint?.messages.slice(-2).map(message => [message.role, message.content]),
    [['user', 'Give a long answer'], ['assistant', 'Part one\n  Part two']]);
});

test('terminal provider events can supply the truncation verdict', async () => {
  let turns = 0;
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    model: { async complete(request) {
      await request.onProviderEvent?.({ type: 'response.completed', finishReason: ++turns === 1 ? 'length' : 'stop' });
      return { content: `part ${turns}` };
    } },
  }).run({ prompt: 'Continue from provider verdict', runId: 'run-event-truncation' });
  assert.equal(result.turns, 2);
  assert.equal(result.status, 'completed');
});

test('three empty truncated turns pause with a recoverable reason', async () => {
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    model: { async complete(request) {
      assert.equal(request.messages.some(message => message.role === 'assistant' && !message.content && message.providerState === undefined), false);
      return { content: '', finishReason: 'length' };
    } },
  }).run({ prompt: 'Do the task', runId: 'run-empty-truncation' });
  assert.equal(result.turns, 3);
  assert.equal(result.status, 'paused');
  assert.equal(result.stopReason, 'output_truncated');
  assert.match(result.finalText, /output limit without making progress/);
  assert.equal(result.checkpoint?.nextTurn, 4);
  assert.deepEqual(normalizeRuntimeFinalMessage(result.finalMessage), { origin: 'runtime', stopReason: 'output_truncated' });
});

test('new partial content may continue through arbitrarily many output ceilings', async () => {
  let turns = 0;
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    model: { async complete() { return { content: `new section ${++turns}`, finishReason: turns <= 12 ? 'length' : 'stop' }; } },
  }).run({ prompt: 'Write many sections', runId: 'run-progress-truncation' });
  assert.equal(result.status, 'completed');
  assert.equal(result.turns, 13);
});

test('repeated partial content pauses only after three turns without new progress', async () => {
  let turns = 0;
  const chunks = ['first', 'first', 'first', 'new', 'new', 'new', 'new'];
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    model: { async complete() { return { content: chunks[turns++], finishReason: 'length' }; } },
  }).run({ prompt: 'Continue output', runId: 'run-repeat-truncation' });
  assert.equal(result.stopReason, 'output_truncated');
  assert.equal(result.turns, 7, 'new output resets the no-progress streak');
  // Each continuation joins the one reply instead of adding another assistant message.
  assert.deepEqual(result.checkpoint?.messages.filter(message => message.role === 'assistant').map(message => message.content), ['firstfirstfirstnewnewnewnew']);
});

test('complete tool calls on a length turn execute and reset truncation protection', async () => {
  let turns = 0, executed = 0;
  const tools = new AgentToolRegistry();
  tools.register({ name: 'test.read', description: 'Read fixture', inputSchema: { type: 'object' }, requiredPermission: 'read_only', source: 'builtin' },
    async () => ({ modelOutput: ++executed, summary: { title: 'Read fixture' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    if (++turns === 3) return { finishReason: 'length', toolCalls: [{ id: 'complete-read', name: 'test.read', arguments: {} }] };
    return turns === 6 ? { content: 'Done', finishReason: 'stop' } : { content: '', finishReason: 'length' };
  } } }).run({ prompt: 'Read and answer', runId: 'run-tool-truncation' });
  assert.equal(result.status, 'completed');
  assert.equal(executed, 1);
  assert.equal(result.turns, 6);
});

test('an explicit token budget still pauses before another truncation continuation', async () => {
  let calls = 0;
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    tokenBudget: { maxOutputTokens: 3 }, model: { async complete() {
      calls++;
      return { content: 'Partial', finishReason: 'length', usage: { inputTokens: 2, outputTokens: 3 } };
    } },
  }).run({ prompt: 'Respect my token budget', runId: 'run-budget-truncation' });
  assert.equal(result.stopReason, 'output_token_limit_reached');
  assert.equal(calls, 1);
  assert.equal(result.checkpoint?.messages.at(-1)?.content, 'Partial');
});

test('unfinished tool arguments do not count as progress or execute on length turns', async () => {
  let turns = 0, executed = 0;
  const tools = new AgentToolRegistry();
  tools.register({ name: 'test.read', description: 'Read fixture', inputSchema: { type: 'object' }, requiredPermission: 'read_only', source: 'builtin' },
    async () => ({ modelOutput: ++executed, summary: { title: 'Read fixture' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    return { finishReason: 'length', toolCalls: [{ id: `unfinished-${++turns}`, name: 'test.read', arguments: toolCallArguments('{"path":') }] };
  } } }).run({ prompt: 'Read a file', runId: 'run-incomplete-truncation' });
  assert.equal(result.stopReason, 'output_truncated');
  assert.equal(result.turns, 3);
  assert.equal(executed, 0);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.checkpoint?.messages.some(message => message.toolCalls?.length), false);
});

test('new usable thinking state counts as progress while request metadata does not', async () => {
  let turns = 0;
  const progressing = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', model: { async complete() {
    return ++turns === 7 ? { content: 'Done', finishReason: 'stop' } : {
      finishReason: 'length', providerState: { kind: 'openai-chat-reasoning-v1', content: { reasoning: `new thought ${turns}` } },
    };
  } } }).run({ prompt: 'Think through the task', runId: 'run-thinking-truncation' });
  assert.equal(progressing.status, 'completed');
  assert.equal(progressing.turns, 7);
  const stalled = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', model: { async complete() {
    return { finishReason: 'length', providerState: { requestId: `new-id-${++turns}` } };
  } } }).run({ prompt: 'Do the task', runId: 'run-metadata-truncation' });
  assert.equal(stalled.stopReason, 'output_truncated');
  assert.equal(stalled.turns, 3);
});

test('own Ollama and structured OpenRouter thinking can progress without visible text', async () => {
  for (const state of [
    (turn: number) => ({ kind: 'ollama_provider_state', thinking: `new thought ${turn}` }),
    (turn: number) => ({ kind: 'ai_sdk_provider_state', openRouterReasoningDetails: [{ type: 'reasoning.summary', summary: `new thought ${turn}` }] }),
  ]) {
    let turns = 0;
    const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', model: { async complete() {
      return ++turns === 6 ? { content: 'Done', finishReason: 'stop' } : { finishReason: 'length', providerState: state(turns) };
    } } }).run({ prompt: 'Keep reasoning', runId: 'run-own-thinking-progress' });
    assert.equal(result.status, 'completed');
    assert.equal(result.turns, 6);
  }
});

test('ordered partial outputs keep runtime pause notices separate from provider-authored parts', async () => {
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', acceptOrderedOutput: true,
    model: { async complete() { return { finishReason: 'length', outputParts: [] }; } },
  }).run({ prompt: 'Generate the answer', runId: 'run-ordered-truncation' });
  assert.equal(result.stopReason, 'output_truncated');
  assert.deepEqual(result.outputParts, []);
  assert.equal(result.finalText, '');
  assert.equal(result.finalMessage, undefined);
  assert.ok(result.events.some(event => event.type === 'assistant_progress' && event.origin === 'runtime'
    && /output limit without making progress/.test(event.content)));
});

test('retry backoff has bounded jitter and honors a larger Retry-After', async t => {
  for (const [random, retryAfterMs, expected] of [[0, 0, 1000], [0.999, 0, 1249], [0.5, 5000, 5000]]) {
    await t.test(`random=${random} retryAfterMs=${retryAfterMs}`, async sub => {
      sub.mock.method(Math, 'random', () => random);
      const controller = new AbortController();
      let scheduled = 0;
      const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
        onEvent: event => { if (event.type === 'model_retry_scheduled') { scheduled = event.delayMs; controller.abort(); } },
        model: { async complete() { throw Object.assign(new Error('busy'), { code: 'UPSTREAM_UNAVAILABLE', retrySafe: true, retryable: true, retryAfterMs }); } },
      }).run({ prompt: 'Retry a rejected request', runId: 'run-jitter-fixture', signal: controller.signal });
      assert.equal(scheduled, expected);
      assert.equal(result.status, 'cancelled');
    });
  }
});

test('an opted-in request target grows after length while retaining the real model maximum', async () => {
  const limits: (number | undefined)[] = [];
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    initialOutputTokenLimit: 4096, modelOutputTokenLimit: 943718,
    model: { async complete(request) {
      limits.push(request.maxOutputTokens);
      return { content: `part ${limits.length}`, finishReason: limits.length < 5 ? 'length' : 'stop' };
    } },
  }).run({ prompt: 'Continue bounded output', runId: 'run-adaptive-output' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(limits, [4096, 16384, 65536, 262144, 943718]);
});

test('adaptive requests still fit the context and remaining cumulative output', async () => {
  const limits: (number | undefined)[] = [];
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    initialOutputTokenLimit: 4096, modelOutputTokenLimit: 32768, contextWindowTokens: 10240,
    tokenBudget: { maxOutputTokens: 10000 }, model: {
      estimateInputTokens: () => 2000,
      async complete(request) {
        limits.push(request.maxOutputTokens);
        return limits.length === 1 ? { content: 'Partial', finishReason: 'length', usage: { inputTokens: 2, outputTokens: 3000 } }
          : { content: 'Done', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 } };
      },
    },
  }).run({ prompt: 'Respect hard budgets', runId: 'run-adaptive-budgets' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(limits, [4096, 7000]);
});

test('adaptive growth cannot exceed an unknown-route fallback and cannot bypass no-progress protection', async () => {
  const limits: (number | undefined)[] = [];
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    initialOutputTokenLimit: 4096, modelOutputTokenLimit: 4096,
    model: { async complete(request) { limits.push(request.maxOutputTokens); return { content: '', finishReason: 'length' }; } },
  }).run({ prompt: 'Respect unknown-route safety', runId: 'run-adaptive-unknown' });
  assert.deepEqual(limits, [4096, 4096, 4096]);
  assert.equal(result.stopReason, 'output_truncated');
  assert.equal(result.turns, 3);
});

test('callers without the initial target preserve their existing request limit behavior', async () => {
  for (const modelOutputTokenLimit of [32768, undefined]) {
    const limits: (number | undefined)[] = [];
    const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', modelOutputTokenLimit,
      model: { async complete(request) { limits.push(request.maxOutputTokens); return { content: `part ${limits.length}`, finishReason: limits.length === 1 ? 'length' : 'stop' }; } },
    }).run({ prompt: 'Retain caller behavior', runId: 'run-unmodified-output' });
    assert.equal(result.status, 'completed');
    assert.deepEqual(limits, [modelOutputTokenLimit, modelOutputTokenLimit]);
  }
});

test('a completed tool call resets the next request target', async () => {
  const limits: (number | undefined)[] = [], tools = new AgentToolRegistry();
  tools.register({ name: 'test.read', description: 'Read fixture', inputSchema: { type: 'object' }, requiredPermission: 'read_only', source: 'builtin' },
    async () => ({ modelOutput: 'read', summary: { title: 'Read fixture' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', initialOutputTokenLimit: 4096, modelOutputTokenLimit: 32768,
    model: { async complete(request) {
      limits.push(request.maxOutputTokens);
      if (limits.length === 1) return { content: 'Partial', finishReason: 'length' };
      if (limits.length === 2) return { finishReason: 'length', toolCalls: [{ id: 'adaptive-read', name: 'test.read', arguments: {} }] };
      return { content: 'Done', finishReason: 'stop' };
    } },
  }).run({ prompt: 'Read and finish', runId: 'run-adaptive-tool-reset' });
  assert.equal(result.status, 'completed');
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(limits, [4096, 16384, 4096]);
});

test('simultaneous runners sharing a model keep independent request targets', async () => {
  const limits = new Map<string, (number | undefined)[]>();
  let releaseA!: () => void;
  const waitForB = new Promise<void>(resolve => { releaseA = resolve; });
  const model = { async complete(request: AgentModelRequest) {
    const name = request.messages[0].content, rows = limits.get(name) ?? [];
    rows.push(request.maxOutputTokens); limits.set(name, rows);
    if (name === 'A' && rows.length === 2) await waitForB;
    if (name === 'B') { releaseA(); return { content: 'Done', finishReason: 'stop' as const }; }
    return { content: `part ${rows.length}`, finishReason: rows.length < 3 ? 'length' as const : 'stop' as const };
  } };
  const options = { model, tools: new AgentToolRegistry(), permissionMode: 'read_only' as const, initialOutputTokenLimit: 4096, modelOutputTokenLimit: 32768 };
  const results = await Promise.all([new AgentRunner(options).run({ prompt: 'A', runId: 'run-target-A' }), new AgentRunner(options).run({ prompt: 'B', runId: 'run-target-B' })]);
  assert.ok(results.every(result => result.status === 'completed'));
  assert.deepEqual(limits.get('A'), [4096, 16384, 32768]);
  assert.deepEqual(limits.get('B'), [4096]);
});

test('delegated runners inherit the initial request target and retain the hard ceiling', async () => {
  const limits: (number | undefined)[] = [], tools = new AgentToolRegistry();
  new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only',
    initialOutputTokenLimit: 4096, modelOutputTokenLimit: 32768,
    model: { async complete(request) { limits.push(request.maxOutputTokens); return { content: `part ${limits.length}`, finishReason: limits.length === 1 ? 'length' : 'stop' }; } },
  }).register();
  const result = await tools.execute({ id: 'adaptive-child', name: 'agent.delegate', arguments: { task: 'Summarize the supplied sentence', tools: [] } }, 'read_only', { runId: 'adaptive-parent' });
  assert.equal(result.ok, true);
  assert.deepEqual(limits, [4096, 16384]);
});
