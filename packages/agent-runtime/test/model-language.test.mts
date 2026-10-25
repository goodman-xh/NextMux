import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentBackendRouter, AgentDelegationRuntime, AgentRunner, AgentToolError, AgentToolRegistry, AGENT_DELEGATE_TOOL_NAME,
  agentTaskContextInstruction, canonicalRuntimeFinal, canonicalToolSummary, createAgentTaskContext,
  recordAgentTaskOperation, normalizeAgentDelegationLedger, createToolRegistryAcpHost, legacyRuntimeFinalMessage, normalizeRuntimeFinalMessage,
  type AgentModelRequest, type AgentRunEvent, type AgentRunStopReason,
} from '../lib/index.js';

const ascii = (value: unknown) => assert.doesNotMatch(JSON.stringify(value), /[\u3400-\u9fff]/);
const descriptor = (name: string) => ({ name, description: 'Inspect an existing resource.', inputSchema: { type: 'object' },
  source: 'builtin' as const, requiredPermission: 'read_only' as const });

test('canonical activity snapshots never read display titles, including unknown kinds', () => {
  const snapshots = [
    ['workspace.list_files', { count: 3 }, 'Listed 3 workspace entries'],
    ['workspace.search_text', { count: 2, incomplete: true }, 'Found 2 matches; search coverage is incomplete'],
    ['workspace.project_map', { count: 5 }, 'Project map: 5 files'],
    ['process.read', { running: true, count: 2, sequence: 9 }, 'Read latest process output'],
    ['process.write', {}, 'Wrote process input'],
    ['workspace.list_bindings', { count: 2 }, 'Listed 2 workspace bindings'],
    ['tool.search', { count: 4 }, 'Searched available tools: 4 matches'],
    ['tool.error', { code: 'NOT_A_FILE' }, 'Tool failed (NOT_A_FILE)'],
    ['agent.delegate', { status: 'paused' }, 'Child task paused'],
    ['project_memory.search', { count: 2 }, 'Searched project memory (2)'],
    ['comic.update_scene', { revision: 4 }, 'Updated scene'],
    ['browser.action', { action: 'click' }, 'Browser action completed: click'],
    ['plugins.status', {}, 'Read plugin status'],
    ['mcp.call', { serverName: 'files', toolName: 'list' }, 'Called MCP tool: files/list'],
    ['external.custom', {}, 'Tool completed: test.inspect'],
  ] as const;
  for (const [kind, params, expected] of snapshots) {
    assert.equal(canonicalToolSummary({ title: '不能进入模型的显示标题', details: ['显示细节'], kind, params }, 'test.inspect'), expected);
  }
  // A user-owned filename is a registered exception and must retain its exact spelling.
  assert.equal(canonicalToolSummary({ title: 'display', kind: 'workspace.read_file', params: { path: '用户文档.md' } }), 'Read 用户文档.md');
});

test('model requests and runtime narration use semantic English while external content and model answers retain their language', async () => {
  const tools = new AgentToolRegistry();
  tools.configureDeferredGroups({ test: 'Inspect resources' });
  tools.register(descriptor('test.inspect'), async () => ({ modelOutput: { text: '原始文件内容' },
    summary: { kind: 'workspace.search_text', params: { count: 2 }, title: '找到两处匹配', details: ['显示细节'] } }));
  tools.register(descriptor('test.fail'), async () => { throw new AgentToolError('NOT_A_FILE', 'Read target is not a file', { params: { path: 'notes' } }); });
  const requests: AgentModelRequest[] = [];
  const events: AgentRunEvent[] = [];
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    taskContext: createAgentTaskContext({ workspaceRoot: '/tmp/project', goal: 'Inspect files', locale: 'ja',
      recentOperations: ['succeeded: 旧版活动标题'] }),
    onEvent: event => { events.push(event); },
    model: { async complete(request) {
      requests.push(request);
      return requests.length === 1 ? { toolCalls: [
        { id: 'inspect-language', name: 'test.inspect', arguments: {} },
        { id: 'fail-language', name: 'test.fail', arguments: {} },
      ] } : { content: '保留模型回答。' };
    } },
  }).run({ prompt: '用户原始请求', runId: 'language-channel-001' });
  for (const request of requests) { ascii(request.instructions); ascii(request.tools); }
  assert.match(requests[1].instructions ?? "", /succeeded: Found 2 matches/);
  assert.match(requests[1].instructions ?? "", /failed: Tool failed \(NOT_A_FILE\)/);
  assert.doesNotMatch(requests[1].instructions ?? "", /旧版|找到两处|显示细节/);
  const outputs = requests[1].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  assert.equal(outputs[0].output.text, '原始文件内容');
  assert.deepEqual(outputs[1], { ok: false, error: { code: 'NOT_A_FILE', message: 'Read target is not a file', params: { path: 'notes' } } });
  ascii(events.filter(event => event.type === 'assistant_progress' && event.origin === 'runtime'));
  const completed = events.find(event => event.type === 'tool_completed' && event.toolName === 'test.inspect');
  assert.equal(completed?.type === 'tool_completed' && completed.summary.kind, 'workspace.search_text');
  assert.equal(result.finalText, '保留模型回答。');
  assert.equal(result.finalMessage, undefined);
  assert.equal(result.checkpoint?.taskContext?.recentOperationsCanonical, true);
});

test('legacy operation strings remain stored but are excluded from model instructions', () => {
  const legacy = createAgentTaskContext({ goal: 'Inspect', recentOperations: ['succeeded: 已读取文件'] });
  assert.deepEqual(legacy.recentOperations, ['succeeded: 已读取文件']);
  ascii(agentTaskContextInstruction(legacy));
  const next = recordAgentTaskOperation(legacy, 'succeeded: Read 用户文档.md');
  assert.deepEqual(next.recentOperations, ['succeeded: Read 用户文档.md']);
  assert.match(agentTaskContextInstruction(next), /Read 用户文档.md/);
});

test('runtime stop snapshots are English and marked independently of model prose', async () => {
  const reasons: (AgentRunStopReason | 'empty_response')[] = ['pause_requested', 'cancel_requested', 'context_window_exceeded',
    'media_context_compaction_required', 'token_usage_unknown', 'input_token_limit_reached', 'output_token_limit_reached',
    'user_input_expired', 'user_input_cancelled', 'repeated_tool_calls', 'tool_call_limit_reached', 'turn_limit_reached', 'empty_response'];
  assert.deepEqual(reasons.map(stopReason => canonicalRuntimeFinal({ origin: 'runtime', stopReason })), [
    'Task paused; resume from its checkpoint.', 'Task cancelled.',
    "The task exceeds this model's context capacity; state is preserved. Select a model with a larger context window to continue.",
    // Raised only when the newest user media alone exceeds the model's input: the note says what to change.
    "The newest user media alone exceeds this model's input capacity. State is preserved. Reduce image resolution, shorten or split the audio/file attachments, or select a model with a larger context window, then resume.",
    'Usage could not be verified; paused to preserve the token budget.',
    'Input-token budget reached; no further model request was sent.', 'Output-token budget reached; no further model request was sent.',
    'The question expired; the task is paused until you continue.', 'The question was cancelled; the task is paused.',
    'Repeated tool calls detected; the task is paused.', 'Tool-call limit reached.', 'Model-turn limit reached.', 'The model returned no text.',
  ]);
  const tools = new AgentToolRegistry();
  const budget = await new AgentRunner({ tools, permissionMode: 'read_only', tokenBudget: { maxInputTokens: 1 },
    model: { async complete() { throw new Error('No budget remained for this call'); } } }).run({ prompt: 'Inspect the project' });
  assert.equal(budget.finalMessage?.origin, 'runtime');
  assert.equal(budget.finalMessage?.stopReason, 'input_token_limit_reached');
  ascii(budget.finalText);
  const empty = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() { return {}; } } }).run({ prompt: 'Inspect' });
  assert.deepEqual(empty.finalMessage, { origin: 'runtime', stopReason: 'empty_response' });
  const modelText = await new AgentRunner({ tools, permissionMode: 'read_only', tokenBudget: { maxInputTokens: 10000 },
    model: { async complete() { return { content: '预算状态下仍保留模型正文。' }; } } }).run({ prompt: 'Inspect' });
  assert.equal(modelText.stopReason, 'token_usage_unknown');
  assert.equal(modelText.finalText, '预算状态下仍保留模型正文。');
  assert.equal(modelText.finalMessage, undefined);
});

test('delegated runtime endings and failures carry English parent-model receipts', async () => {
  const tools = new AgentToolRegistry();
  tools.register(descriptor('test.inspect'), async () => ({ modelOutput: { complete: true }, summary: { title: '已读取' } }));
  new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: ['test.inspect'], maxTurns: 1,
    model: { async complete() { return { toolCalls: [{ id: 'child-inspect', name: 'test.inspect', arguments: {} }] }; } },
  }).register();
  const result = await tools.execute({ id: 'delegate-language', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Inspect files', maxTurns: 1 } },
    'read_only', { runId: 'parent-language-001' });
  assert.equal(result.ok, true);
  const output = result.output as { finalText: string; finalMessage: { stopReason: string }; receipt: unknown };
  assert.equal(output.finalText, 'Model-turn limit reached.');
  assert.equal(output.finalMessage.stopReason, 'turn_limit_reached');
  ascii(output.receipt);
  ascii(output.finalText);

  const failing = new AgentToolRegistry();
  new AgentDelegationRuntime({ tools: failing, maxPermissionMode: 'read_only', allowedToolNames: [],
    model: { async complete() { throw Object.assign(new Error('官方模型请求超时，秘密令牌 sk-secret-value-123456789'), { code: 'MODEL_TIMEOUT' }); } },
  }).register();
  const failure = await failing.execute({ id: 'delegate-failure', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Inspect files' } },
    'read_only', { runId: 'parent-language-002' });
  assert.equal(failure.error?.code, 'MODEL_TIMEOUT');
  assert.equal(failure.error?.message, 'The child model request failed (MODEL_TIMEOUT)');
  ascii(failure.error);
  assert.doesNotMatch(JSON.stringify(failure.error), /sk-secret/);
});

test('historical child receipt summaries and failure diagnostics project from stable outcome and code', () => {
  const ledger = normalizeAgentDelegationLedger({ schemaVersion: 1, rootRunId: 'root-language-legacy', createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z', children: [{ childRunId: 'child-language-legacy', parentRunId: 'parent-language-legacy',
      rootRunId: 'root-language-legacy', depth: 1, task: 'Inspect files', status: 'failed', startedAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z', eventCount: 0, events: [],
      error: { code: 'MODEL_TIMEOUT', message: '模型请求超时' },
      receipt: { outcome: 'failed', retrySafe: false, unknownSideEffect: false, summary: '子任务失败',
        failure: { code: 'MODEL_TIMEOUT', message: '模型请求超时' } },
    }] });
  assert.equal(ledger?.children[0]?.receipt?.summary, 'Child task failed');
  assert.equal(ledger?.children[0]?.receipt?.failure?.message, 'Child operation failed (MODEL_TIMEOUT)');
  assert.equal(ledger?.children[0]?.error?.message, 'Child operation failed (MODEL_TIMEOUT)');
});

test('ACP tool failures never use a localized display title as the model error fallback', async () => {
  class FailedRegistry extends AgentToolRegistry {
    override async execute() { return { ok: false, summary: { title: '读取失败的显示标题' } }; }
  }
  const host = createToolRegistryAcpHost({ tools: new FailedRegistry() });
  try {
    await assert.rejects(host.readTextFile!({ sessionId: 'session-language', path: '/tmp/project/file.txt' },
      { runId: 'acp-language', workspaceRoot: '/tmp/project', permissionMode: 'read_only' }), { message: 'ACP host tool failed' });
  } finally { await host.dispose(); }
});

test('shared final-message migration validates provenance and only recognizes exact legacy fallbacks', () => {
  assert.deepEqual(normalizeRuntimeFinalMessage({ origin: 'runtime', stopReason: 'pause_requested', params: {
    count: 2, invalid: Infinity, nested: { display: 'not metadata' },
  } }), { origin: 'runtime', stopReason: 'pause_requested', params: { count: 2 } });
  assert.equal(normalizeRuntimeFinalMessage({ origin: 'model', stopReason: 'pause_requested' }), undefined);
  assert.equal(normalizeRuntimeFinalMessage({ origin: 'runtime', stopReason: 'unknown' }), undefined);
  assert.deepEqual(legacyRuntimeFinalMessage('任务已暂停。', 'pause_requested'), { origin: 'runtime', stopReason: 'pause_requested' });
  assert.deepEqual(legacyRuntimeFinalMessage('模型没有返回正文。', 'completed'), { origin: 'runtime', stopReason: 'empty_response' });
  assert.deepEqual(legacyRuntimeFinalMessage('Task completed.', 'completed'), { origin: 'runtime', stopReason: 'completed' });
  assert.equal(legacyRuntimeFinalMessage('Task paused while I debug the parser.', 'pause_requested'), undefined);
  assert.equal(legacyRuntimeFinalMessage('模型自己的回答。', 'context_window_exceeded'), undefined);
  assert.equal(legacyRuntimeFinalMessage('Task paused.', 'unknown'), undefined);
});

test('delegation inherits canonical operations while legacy display history stays out of child instructions', async () => {
  for (const canonical of [false, true]) {
    const tools = new AgentToolRegistry();
    let instructions = '';
    new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: [],
      model: { async complete(request) { instructions = request.instructions || ''; return { content: 'Done' }; } },
    }).register();
    const taskContext = createAgentTaskContext({ goal: 'Inspect files', recentOperations: canonical
      ? ['succeeded: Read notes.md'] : ['succeeded: 读取旧标题'], ...(canonical ? { recentOperationsCanonical: true } : {}) });
    const result = await tools.execute({ id: `delegate-context-${canonical}`, name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Check notes' } },
      'read_only', { runId: `parent-context-${canonical}`, taskContext });
    assert.equal(result.ok, true);
    assert.doesNotMatch(instructions, /读取旧标题/);
    assert.equal(instructions.includes('succeeded: Read notes.md'), canonical);
  }
});

test('router cancellation excludes runtime narration and marks only generated endings', async () => {
  for (const authored of ['', '保留模型已写的内容。']) {
    const controller = new AbortController();
    const router = new AgentBackendRouter({ candidates: [{ backend: {
      id: 'language-router', capabilities: { streaming: true, cancellation: true, sessionResume: false, permissions: true,
        filesystem: false, terminal: false, mcp: false },
      async run(request) {
        await request.onEvent?.({ type: 'assistant_progress', origin: 'runtime', content: 'Preparing a tool call.', turn: 1, at: new Date().toISOString() });
        if (authored) await request.onEvent?.({ type: 'assistant_progress', origin: 'model', content: authored, turn: 1, at: new Date().toISOString() });
        controller.abort();
        throw new Error('Cancelled');
      },
    } }] });
    const result = await router.run({ prompt: 'Inspect', workspaceRoot: process.cwd(), permissionMode: 'read_only', signal: controller.signal });
    assert.equal(result.finalText, authored || 'Task cancelled.');
    assert.deepEqual(result.finalMessage, authored ? undefined : { origin: 'runtime', stopReason: 'cancel_requested' });
  }
});
