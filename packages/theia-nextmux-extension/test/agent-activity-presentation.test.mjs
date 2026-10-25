import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAgentActivityEvents, projectAgentActivityEvents } from '../lib/browser/nextmux-agent-activity.js';

import { agentActivityEventKey, agentStreamTailPresentation, agentTaskPlanSteps, agentThinkingPresentation, browserToolActivity, commandActivityCommand, commandActivityPresentation, commandActivityTitle, commandExitStatus, isRedundantProcessControlCompletion, isVisibleAssistantProgress, latestLiveModelPhaseIndex, modelAttemptPresentation, shouldShowAgentTaskProgress, summarizeAgentTaskProgress, toolActivityCompletionState, toolCompletionTitle } from '../lib/browser/nextmux-agent-activity.js';

const at = '2026-08-30T00:00:00.000Z';

test('known MCP browser tools share semantic action titles without guessing from arbitrary prose', () => {
  for (const [builtin, mcp] of [['snapshot', 'snapshot'], ['click', 'click'], ['fill', 'type'], ['select', 'select_option'], ['upload', 'file_upload'], ['wait', 'wait_for']]) {
    const builtIn = browserToolActivity('zh-CN', `browser.${builtin}`, 'completed');
    const external = browserToolActivity('zh-CN', `mcp.my-browser.browser_${mcp}`, 'completed');
    assert.equal(external.title, builtIn.title);
    assert.equal(external.service, 'my-browser');
    assert.ok(external.title.startsWith('已'));
    assert.doesNotMatch(external.title, /browser_|MCP[:：]/);
  }
  assert.equal(browserToolActivity('zh-CN', 'mcp.playwright.browser_snapshot_1234abcd').title, '已读取页面');
  assert.equal(browserToolActivity('en', 'mcp.playwright.browser_snapshot', 'running').title, 'Reading the page');
  // Failed and stopped steps use the imperative phrase; the row adds a short state chip.
  assert.equal(browserToolActivity('zh-CN', 'mcp.playwright.browser_click', 'failed').title, '点击页面元素');
  assert.equal(browserToolActivity('zh-CN', 'mcp.playwright.browser_click', 'stopped').title, '点击页面元素');
  // Steps are phrased with their human target (Cline BrowserSessionRow style), never the raw action.
  assert.equal(browserToolActivity('en', 'browser.click', 'completed', 'Sign in').title, 'Clicked “Sign in”');
  assert.equal(browserToolActivity('en', 'browser.fill', 'completed', 'Email').title, 'Typed into Email');
  assert.equal(browserToolActivity('en', 'browser.navigate', 'running', 'example.com').title, 'Opening example.com');
  assert.equal(browserToolActivity('zh-CN', 'browser.fill', 'completed', 'Email').title, '已填写 Email');
  assert.equal(browserToolActivity('zh-CN', 'browser.click', 'completed', '登录').title, '已点击“登录”');
  assert.equal(browserToolActivity('ja', 'browser.click', 'completed', 'サインイン').title, '「サインイン」をクリックしました');
  assert.equal(browserToolActivity('de', 'browser.open', 'completed').title, 'Die Seite geöffnet');
  for (const name of ['my.browser_snapshot', 'mcp.playwright.browser_click_and_delete', 'mcp.playwright.custom', 'browser_snapshot']) {
    assert.equal(browserToolActivity('zh-CN', name), undefined, name);
  }
  const event = { type: 'tool_completed', callId: 'mcp-one', toolName: 'mcp.playwright.browser_snapshot', ok: true, at,
    summary: { title: 'MCP：playwright / browser_snapshot', details: ['返回 1 个内容块'] } };
  assert.equal(toolCompletionTitle('zh-CN', event), '已读取页面');
  assert.equal(toolCompletionTitle('zh-CN', { ...event, ok: false }), '读取页面');
  assert.equal(toolCompletionTitle('zh-CN', { ...event, status: 'cancelled' }), '读取页面');
  assert.equal(toolCompletionTitle('zh-CN', { ...event, toolName: 'mcp.custom.search' }), event.summary.title,
    'legacy title text alone cannot make an unrelated tool a browser action');
});

test('operation completion updates its first position without moving prose or mutating the journal', () => {
  const start = { type: 'tool_started', callId: 'a', toolName: 'workspace.read_file', at };
  const text = { type: 'assistant_delta', turn: 1, delta: 'After reading', at };
  const done = { type: 'tool_completed', callId: 'a', toolName: 'workspace.read_file', ok: true, at };
  const events = [start, text, done];
  const before = projectAgentActivityEvents(events.slice(0, 2));
  const after = projectAgentActivityEvents(events);
  assert.deepEqual(after.map(row => row.event), [done, text]);
  assert.equal(agentActivityEventKey(before[0].event, before[0].sourceIndex), agentActivityEventKey(after[0].event, after[0].sourceIndex));
  assert.equal(events[0], start);
  assert.equal(events.length, 3);
});

test('activity projection reuses an immutable snapshot without reading its events again', () => {
  let reads = 0;
  const events = new Proxy(Object.freeze([
    { type: 'assistant_delta', turn: 1, delta: 'Cached history', at },
    { type: 'tool_started', callId: 'cached', toolName: 'workspace.read_file', at },
  ]), {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const projected = projectAgentActivityEvents(events);
  assert.ok(reads > 0);
  reads = 0;
  assert.equal(projectAgentActivityEvents(events), projected);
  assert.equal(reads, 0, 'a cache hit must not even inspect the event array');
  assert.notEqual(projectAgentActivityEvents([...events]), projected, 'a new snapshot gets its own projection');
});

test('event identities serialize each immutable object once across snapshots and duplicate batches', () => {
  let serializations = 0;
  const event = Object.freeze({
    type: 'assistant_delta', turn: 1, delta: 'Only serialize once', at,
    toJSON() {
      serializations += 1;
      return { type: this.type, turn: this.turn, delta: this.delta, at: this.at };
    },
  });
  const first = appendAgentActivityEvents([], [event, event]);
  assert.deepEqual(first, [event]);
  assert.equal(appendAgentActivityEvents(first, [event]), first);
  assert.deepEqual(appendAgentActivityEvents([], [event]), [event]);
  assert.equal(serializations, 1);
});

test('identical incoming snapshots return before reading the journal or serializing identities', () => {
  const events = new Proxy([{ type: 'assistant_delta', turn: 1, delta: 'Same snapshot', at }], {
    get() { throw new Error('the identical snapshot must not be inspected'); },
  });
  assert.equal(appendAgentActivityEvents(events, events), events);
  assert.equal(appendAgentActivityEvents(events, []), events);
});

test('seen identities are reused and snapshot prefix matching only inspects new events', () => {
  const events = ['first', 'middle', 'last'].map(delta => ({ type: 'assistant_delta', turn: 1, delta, at }));
  let scans = 0;
  const current = new Proxy(events, {
    get(target, property, receiver) {
      if (property === 'map') scans += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(appendAgentActivityEvents(current, [events[0]]), current);
  assert.equal(appendAgentActivityEvents(current, [events[1]]), current);
  assert.equal(scans, 1, 'repeated duplicate batches reuse the seen identity set');
  const added = { type: 'assistant_delta', turn: 1, delta: 'new tail', at };
  const snapshot = new Proxy([...events, added, added, events[1]], {
    get(target, property, receiver) {
      assert.notEqual(property, '1', 'matching snapshots must not rescan their shared prefix');
      return Reflect.get(target, property, receiver);
    },
  });
  assert.deepEqual(appendAgentActivityEvents(current, snapshot), [...events, added]);
  assert.equal(scans, 1);
});

test('appending to historical snapshots never inherits identities from newer branches', () => {
  const [first, second, third] = ['first', 'second', 'third'].map(delta => ({ type: 'assistant_delta', turn: 1, delta, at }));
  const original = Object.freeze([first]);
  const intermediate = appendAgentActivityEvents(original, [second]);
  const latest = appendAgentActivityEvents(intermediate, [third]);
  const branch = appendAgentActivityEvents(original, [third, second, third]);
  assert.deepEqual(latest, [first, second, third]);
  assert.deepEqual(branch, [first, third, second]);
  assert.deepEqual(appendAgentActivityEvents(intermediate, [third]), latest);
  assert.deepEqual(original, [first]);
  assert.deepEqual(intermediate, [first, second]);
});

test('background process launch stays pending until its exit, and reused call ids remain distinct', () => {
  const start = { type: 'tool_started', callId: 'a', toolName: 'process.start', at };
  const ack = { type: 'tool_completed', callId: 'a', toolName: 'process.start', ok: true, at };
  const exit = { type: 'tool_process_exited', callId: 'a', toolName: 'process.start', exitCode: 0, at };
  assert.equal(projectAgentActivityEvents([start, ack])[0].event.type, 'tool_started');
  const rows = projectAgentActivityEvents([start, ack, exit, start, ack]);
  assert.deepEqual(rows.map(row => row.event.type), ['tool_process_exited', 'tool_started']);
  assert.notEqual(agentActivityEventKey(rows[0].event, rows[0].sourceIndex), agentActivityEventKey(rows[1].event, rows[1].sourceIndex));
});

test('compaction and visible reasoning replace only matching items within the current run', () => {
  const compact = { type: 'context_compaction_started', turn: 1, segment: 1, at };
  const compacted = { ...compact, type: 'context_compaction_completed' };
  const thought = { type: 'provider_reasoning', turn: 1, itemId: 'r', visibility: 'visible', status: 'streaming', content: 'a', at };
  const rows = projectAgentActivityEvents([compact, compacted, thought, { ...thought, content: 'ab' }, { type: 'backend_selected', at }, compact, thought]);
  assert.deepEqual(rows.map(row => row.sourceIndex), [0, 2, 4, 5, 6]);
  assert.equal(rows[1].event.content, 'ab');
  assert.equal(rows[4].event.content, 'a');

  // Providers omitting itemId still coalesce incremental reasoning snapshots in the same turn/tool phase.
  const withoutId1 = { type: 'provider_reasoning', turn: 1, visibility: 'visible', status: 'streaming', content: 'step 1', at };
  const withoutId2 = { type: 'provider_reasoning', turn: 1, visibility: 'visible', status: 'complete', content: 'step 1 + step 2', at };
  const coalesced = projectAgentActivityEvents([withoutId1, withoutId2]);
  assert.equal(coalesced.length, 1);
  assert.equal(coalesced[0].event.content, 'step 1 + step 2');
});

test('activity keys stay unique when a provider reuses a tool call id or the runtime records multiple lifecycle events', () => {
  const started = { type: 'tool_started', callId: 'same-call', toolName: 'process.start', source: 'builtin', summary: { title: 'start' }, at };
  const completed = { type: 'tool_completed', callId: 'same-call', toolName: 'process.start', ok: false, summary: { title: 'failed' }, durationMs: 1, at };
  const exited = { type: 'tool_process_exited', callId: 'same-call', toolName: 'process.start', processId: 'proc-1', exitCode: 1, signal: null, at };
  const keys = [
    agentActivityEventKey(started, 4),
    agentActivityEventKey(completed, 5),
    agentActivityEventKey(exited, 6),
    agentActivityEventKey(completed, 7),
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(agentActivityEventKey(started, 4), agentActivityEventKey(started, 4));
});

test('intentional terminal cleanup is presented as stopped instead of failed in every locale', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    const stopped = commandActivityTitle(locale, 'stopped', 'pwsh.exe -NoLogo');
    const failed = commandActivityTitle(locale, 'failed', 'pwsh.exe -NoLogo');
    assert.ok(stopped.trim(), locale);
    assert.notEqual(stopped, failed, locale);
  }
});

test('a cancelled process completion is stopped even when its command exit outcome is failed', () => {
  assert.equal(toolActivityCompletionState({
    ok: true,
    status: 'cancelled',
    outcome: 'failed',
    terminationReason: 'cancelled',
  }), 'stopped');
  assert.equal(toolActivityCompletionState({
    ok: true,
    status: 'failed',
    outcome: 'failed',
  }), 'failed');
  assert.equal(toolActivityCompletionState({
    ok: true,
    status: 'succeeded',
    outcome: 'succeeded',
  }), 'completed');
  assert.match(commandActivityPresentation('zh-CN', 'stopped', { commandLine: 'node -e "setTimeout(() => {}, 30000)"' }).title, /^已终止 node/);
});

test('successful process termination acknowledgement is hidden when the process exit row is authoritative', () => {
  const successful = {
    type: 'tool_completed', callId: 'terminate-call', toolName: 'process.terminate', ok: true,
    summary: { title: '已终止进程', outcome: 'succeeded' }, durationMs: 1, at,
  };
  const failed = {
    ...successful, ok: false, summary: { title: '无法终止进程', outcome: 'failed' },
  };
  const ordinary = {
    ...successful, toolName: 'process.write', summary: { title: '已写入进程', outcome: 'succeeded' },
  };
  assert.equal(isRedundantProcessControlCompletion(successful), true);
  assert.equal(isRedundantProcessControlCompletion(failed), false);
  assert.equal(isRedundantProcessControlCompletion(ordinary), false);
});

test('legacy successful process titles keep the concrete command and drop exit-code noise', () => {
  const command = commandActivityCommand('rg 退出码 0');
  assert.equal(command, 'rg');
  assert.equal(commandActivityTitle('zh-CN', 'running', command), '正在运行 rg');
  assert.equal(commandActivityTitle('zh-CN', 'completed', command), '执行了 rg');
});

test('command presentation trusts structured command data and never promotes test output into the command', () => {
  const commandLine = `node -e "console.log('first')"\n--trace-warnings`;
  const presentation = commandActivityPresentation('zh-CN', 'completed', {
    commandLine,
    legacyTitle: 'node 退出码 0 · ✔ command summary test passed · 另 5 项',
  });

  assert.equal(presentation.command, commandLine);
  assert.equal(presentation.expandedCommand, commandLine);
  assert.equal(presentation.title.includes('\n'), false);
  assert.match(presentation.title, /^执行了 node -e/);
  assert.doesNotMatch(presentation.title, /test passed|另 5 项/);

  assert.equal(commandActivityPresentation('zh-CN', 'completed', {
    legacyTitle: 'node 退出码 0 · ✔ command summary test passed · 另 5 项',
  }), undefined);
  assert.equal(commandActivityPresentation('zh-CN', 'running', {
    legacyTitle: '运行 pnpm test --filter agent-runtime',
  })?.expandedCommand, 'pnpm test --filter agent-runtime');
});

test('expanded command terminals retain a localized exit code without putting it in the collapsed label', () => {
  assert.equal(commandExitStatus('zh-CN', 7, null), '进程退出码 7');
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    assert.match(commandExitStatus(locale, 7, null), /7/, locale);
    assert.match(commandExitStatus(locale, null, 'SIGTERM'), /SIGTERM/, locale);
  }
});

test('thinking is presented only from explicit provider-visible reasoning content', () => {
  assert.deepEqual(agentThinkingPresentation({
    type: 'provider_reasoning', visibility: 'visible', content: '  Comparing both implementations.  ', status: 'streaming', at,
  }), {
    content: 'Comparing both implementations.',
    streaming: true,
  });
  assert.deepEqual(agentThinkingPresentation({
    type: 'provider_reasoning', visibility: 'visible', content: 'Decision reached.', status: 'complete', at,
  }), {
    content: 'Decision reached.',
    streaming: false,
  });

  assert.equal(agentThinkingPresentation({ type: 'model_started', turn: 1, at }), undefined);
  assert.equal(agentThinkingPresentation({ type: 'assistant_progress', turn: 1, content: '正在读取文件。', origin: 'model', at }), undefined);
  assert.equal(agentThinkingPresentation({ type: 'provider_reasoning', visibility: 'hidden', content: 'private chain', status: 'streaming', at }), undefined);
  assert.equal(agentThinkingPresentation({ type: 'provider_reasoning', visibility: 'visible', content: '   ', status: 'streaming', at }), undefined);
});

test('stream tail cursor is visible only while running and terminal state wins over stale activity', () => {
  assert.deepEqual(agentStreamTailPresentation({ running: true }), {
    state: 'running',
    showCursor: true,
  });
  assert.deepEqual(agentStreamTailPresentation({ running: false, terminalState: 'complete' }), {
    state: 'complete',
    showCursor: false,
  });
  assert.deepEqual(agentStreamTailPresentation({ running: false, terminalState: 'stopped' }), {
    state: 'stopped',
    showCursor: false,
  });
  assert.deepEqual(agentStreamTailPresentation({ running: true, terminalState: 'stopped' }), {
    state: 'stopped',
    showCursor: false,
  });
});

test('model lifecycle noise is transient: only the latest phase is visible while live and none remains after settlement', () => {
  const events = [
    { type: 'model_phase', turn: 1, phase: 'thinking', at },
    { type: 'assistant_progress', turn: 1, content: '正在检查项目。', origin: 'model', at },
    { type: 'model_phase', turn: 1, phase: 'tool_calling', at },
    { type: 'tool_started', callId: 'read', toolName: 'workspace.read_file', source: 'builtin', summary: { title: '读取文件' }, at },
    { type: 'model_phase', turn: 2, phase: 'responding', at },
  ];
  assert.equal(latestLiveModelPhaseIndex(events, true), 4);
  assert.equal(latestLiveModelPhaseIndex(events, false), -1);
  assert.equal(latestLiveModelPhaseIndex(events.filter(event => event.type !== 'model_phase'), true), -1);
  // Suppress redundant thinking phase when visible provider_reasoning or tool/prose output already follows it.
  assert.equal(latestLiveModelPhaseIndex([
    { type: 'model_phase', turn: 1, phase: 'thinking', at },
    { type: 'provider_reasoning', turn: 1, visibility: 'visible', status: 'streaming', content: '分析依赖关系', at },
  ], true), -1);
  assert.equal(latestLiveModelPhaseIndex([
    { type: 'model_phase', turn: 1, phase: 'thinking', at },
    { type: 'assistant_delta', turn: 1, delta: 'Hello', at },
  ], true), -1);
});

test('workspace inspection uses the selected interface language instead of a runtime-authored title', () => {
  const event = { type: 'tool_completed', callId: 'list', toolName: 'workspace.list_files', ok: true,
    summary: { title: '列出 1 个工作区条目' }, durationMs: 2, at };
  assert.equal(toolCompletionTitle('en', event), 'Workspace inspected');
  assert.equal(toolCompletionTitle('zh-CN', event), '工作区检查完成');
  assert.equal(toolCompletionTitle('en', { ...event, toolName: 'custom.tool' }), '列出 1 个工作区条目');
  assert.equal(toolCompletionTitle('en', {
    ...event,
    toolName: 'mcp.private_lookup',
    summary: { title: 'mcp.private_lookup' }
  }), '');
});

test('legacy tool summaries never reappear as assistant narration while genuine legacy prose is preserved', () => {
  assert.equal(isVisibleAssistantProgress({ content: '正在检查队列与历史记录。', origin: 'model' }), true);
  assert.equal(isVisibleAssistantProgress({ content: '旧版模型自然语言，没有来源字段。' }), true);
  assert.equal(isVisibleAssistantProgress({ content: '运行时生成的自然语言。', origin: 'runtime' }), true);
  // Fixed runtime narration of tool calls is redundant with the localized status rows (Codex/OpenCode show none).
  assert.equal(isVisibleAssistantProgress({ content: '已读取 src/app.ts，正在根据文件内容继续处理。', origin: 'runtime' }), false);
  assert.equal(isVisibleAssistantProgress({ content: '接下来将修改 a.txt、修改 b.txt。', origin: 'runtime' }), false);
  assert.equal(isVisibleAssistantProgress({ content: '正在整理结果。', origin: 'runtime' }), false);
  assert.equal(isVisibleAssistantProgress({ content: '接下来将修改 a.txt。', origin: 'model' }), true);
  // The runner's English canonical narration (seen live in a Chinese conversation, round 31).
  for (const content of ['Next operations: Started workspace.list_files; Started process.run.', 'Preparing the results.',
    'The operation failed; reviewing the error before the next step.', 'Process exited: 1. Continuing from the result.']) {
    assert.equal(isVisibleAssistantProgress({ content, origin: 'runtime' }), false, content);
  }
  assert.equal(isVisibleAssistantProgress({
    content: '已读取 src/app.ts，正在根据文件内容继续处理。',
    origin: 'runtime',
    previousEventType: 'tool_completed',
  }), false);
  for (const content of [
    '列出 500 个工作区条目',
    '找到 57 处匹配',
    '读取 package.json',
    'rg 退出码 0',
    '工具执行失败',
  ]) {
    assert.equal(isVisibleAssistantProgress({ content }), false, content);
    assert.equal(isVisibleAssistantProgress({ content, origin: 'runtime' }), false, `legacy runtime label: ${content}`);
    assert.equal(isVisibleAssistantProgress({ content, origin: 'model' }), true, `explicit model prose: ${content}`);
  }
});

test('task progress renders only the latest structured plan update', () => {
  const events = [
    { type: 'model_started', turn: 1, at },
    { type: 'assistant_progress', turn: 1, content: '正在检查任务队列与执行记录。', origin: 'model', at },
    { type: 'task_plan_updated', steps: [
      { id: 'baseline', title: '建立干净基线', status: 'completed' },
      { id: 'delegate', title: '通过 NM 分派聚焦修复', status: 'in_progress' },
      { id: 'validate', title: '验收并接管阻断项', status: 'pending' },
      { id: 'desktop', title: '统一修复桌面高优先级问题', status: 'pending' },
      { id: 'e2e', title: '构建重启并执行真实 E2E', status: 'pending' },
      { id: 'platform', title: '继续网页与平台积压', status: 'pending' },
    ], at },
    { type: 'model_completed', turn: 1, toolCallCount: 3, at },
    { type: 'tool_started', callId: 'read', toolName: 'workspace.read_file', source: 'builtin', summary: { title: '读取 src/app.ts', resource: { kind: 'file', path: 'src/app.ts', action: 'read' } }, at },
    { type: 'tool_completed', callId: 'read', toolName: 'workspace.read_file', ok: true, summary: { title: '读取 src/app.ts', resource: { kind: 'file', path: 'src/app.ts', action: 'read' } }, durationMs: 8, at },
    { type: 'assistant_progress', turn: 1, content: '已读取 src/app.ts', origin: 'runtime', at },
    { type: 'assistant_progress', turn: 2, content: '正在修复进度投影并补充测试。', origin: 'model', at },
    { type: 'tool_started', callId: 'edit', toolName: 'workspace.apply_patch', source: 'builtin', summary: { title: '修改 src/app.ts', resource: { kind: 'file', path: 'src/app.ts', action: 'updated' } }, at },
  ];

  const progress = summarizeAgentTaskProgress(events, [{ path: 'src/app.ts', additions: 12, deletions: 4 }], true);

  assert.deepEqual({
    currentStep: progress.currentStep,
    totalSteps: progress.totalSteps,
    completedSteps: progress.completedSteps,
    changedFileCount: progress.changedFileCount,
    additions: progress.additions,
    deletions: progress.deletions,
  }, {
    currentStep: 2,
    totalSteps: 6,
    completedSteps: 1,
    changedFileCount: 1,
    additions: 12,
    deletions: 4,
  });
  assert.deepEqual(progress.steps.map(step => [step.id, step.title, step.status]), [
    ['baseline', '建立干净基线', 'completed'],
    ['delegate', '通过 NM 分派聚焦修复', 'running'],
    ['validate', '验收并接管阻断项', 'pending'],
    ['desktop', '统一修复桌面高优先级问题', 'pending'],
    ['e2e', '构建重启并执行真实 E2E', 'pending'],
    ['platform', '继续网页与平台积压', 'pending'],
  ]);
});

test('narration, tool activity, searches, reads, commands, and failures never become task-plan steps', () => {
  const waiting = summarizeAgentTaskProgress([{ type: 'model_started', turn: 1, at }], [], true);
  assert.equal(waiting.totalSteps, 0);
  assert.equal(waiting.currentStep, 0);

  const events = [
    ...Array.from({ length: 100 }, (_, index) => ({ type: 'assistant_delta', turn: index + 1, delta: `输出 ${index + 1}`, at })),
    { type: 'assistant_progress', turn: 101, content: '正在读取文件并运行测试。', origin: 'model', at },
    { type: 'model_completed', turn: 1, toolCallCount: 4, at },
    { type: 'tool_started', callId: 'list', toolName: 'workspace.list', source: 'builtin', summary: { title: '列出 500 个工作区条目' }, at },
    { type: 'tool_completed', callId: 'list', toolName: 'workspace.list', ok: true, summary: { title: '列出 500 个工作区条目' }, durationMs: 30, at },
    { type: 'tool_started', callId: 'search', toolName: 'workspace.search', source: 'builtin', summary: { title: '找到 57 处匹配' }, at },
    { type: 'tool_completed', callId: 'search', toolName: 'workspace.search', ok: false, summary: { title: '工具执行失败', outcome: 'failed' }, durationMs: 30, at },
    { type: 'tool_started', callId: 'read', toolName: 'workspace.read_file', source: 'builtin', summary: { title: '读取 package.json' }, at },
  ];
  const progress = summarizeAgentTaskProgress(events, [], true);
  assert.equal(progress.totalSteps, 0);
  assert.equal(progress.currentStep, 0);
  assert.deepEqual(progress.steps, []);
  assert.equal(shouldShowAgentTaskProgress(progress), false);
});

test('task queue visibility requires a real multi-step plan or observable file progress', () => {
  const oneStep = summarizeAgentTaskProgress([
    { type: 'task_plan_updated', steps: [{ id: 'one', title: 'Answer the question', status: 'in_progress' }], at },
  ], [], true);
  assert.equal(shouldShowAgentTaskProgress(oneStep), false);

  const multiStep = summarizeAgentTaskProgress([
    { type: 'task_plan_updated', steps: [
      { id: 'one', title: 'Inspect', status: 'completed' },
      { id: 'two', title: 'Verify', status: 'in_progress' },
    ], at },
  ], [], true);
  assert.equal(shouldShowAgentTaskProgress(multiStep), true);

  const fileProgress = summarizeAgentTaskProgress([], [{ path: 'src/app.ts', additions: 1 }], true);
  assert.equal(shouldShowAgentTaskProgress(fileProgress), true);
});

test('plan projection exposes only the latest explicit plan with bounded single-line titles', () => {
  const noisyTitle = `  Verify\n    streamed behavior ${'x'.repeat(220)}  `;
  const steps = agentTaskPlanSteps([
    { type: 'task_plan_updated', steps: [{ id: 'old', title: 'Old plan', status: 'in_progress' }], at },
    { type: 'assistant_progress', turn: 1, content: '读取 package.json', origin: 'runtime', at },
    { type: 'tool_started', callId: 'rg', toolName: 'workspace.search', source: 'builtin', summary: { title: '找到 57 处匹配' }, at },
    { type: 'task_plan_updated', steps: [
      { id: 'baseline', title: 'Build baseline', status: 'completed' },
      { id: 'verify', title: noisyTitle, status: 'in_progress' },
      { id: 'report', title: 'Report results', status: 'pending' },
    ], at },
    { type: 'tool_completed', callId: 'rg', toolName: 'workspace.search', source: 'builtin', ok: false, status: 'failed', summary: { title: '工具执行失败' }, durationMs: 5, at },
  ]);

  assert.deepEqual(steps.map(step => [step.id, step.status]), [
    ['baseline', 'completed'],
    ['verify', 'running'],
    ['report', 'pending'],
  ]);
  assert.equal(steps[1].title.includes('\n'), false);
  assert.equal(steps[1].title.length, 180);
  assert.equal(steps.some(step => /读取|匹配|失败/.test(step.title)), false);
});

test('plan presentation hides a provider task list made entirely from tool-result labels', () => {
  const steps = agentTaskPlanSteps([{
    type: 'task_plan_updated',
    steps: [
      { id: 'rg', title: 'rg 退出码 0', status: 'completed' },
      { id: 'read', title: '读取 packages/theia-nextmux-extension/src/browser/nextmux.css', status: 'completed' },
      { id: 'matches', title: '找到 57 处匹配', status: 'completed' },
      { id: 'failed', title: '工具执行失败', status: 'completed' },
    ],
    at,
  }]);
  assert.deepEqual(steps, []);
});

test('a newer structured plan replaces the older plan instead of appending duplicate rows', () => {
  const progress = summarizeAgentTaskProgress([
    { type: 'task_plan_updated', steps: [
      { id: 'one', title: '建立基线', status: 'in_progress' },
      { id: 'two', title: '执行测试', status: 'pending' },
    ], at },
    { type: 'assistant_progress', turn: 3, content: '这是时间线叙述，不是计划。', origin: 'model', at },
    { type: 'task_plan_updated', steps: [
      { id: 'one', title: '建立基线', status: 'completed' },
      { id: 'two', title: '执行测试', status: 'in_progress' },
    ], at },
  ], [], true);
  assert.equal(progress.totalSteps, 2);
  assert.equal(progress.currentStep, 2);
  assert.equal(progress.completedSteps, 1);
  assert.deepEqual(progress.steps.map(step => [step.id, step.status]), [['one', 'completed'], ['two', 'running']]);
});

test('failed model attempts remain human-readable and localized without exposing provider bodies', () => {
  const event = {
    type: 'model_attempt_completed', turn: 2, attempt: 1, outcome: 'failed',
    startedAt: at, at, durationMs: 1200, retryScheduled: true,
    failure: { code: 'UPSTREAM_UNAVAILABLE', stage: 'response', category: 'upstream', reason: 'safe', retryable: true, retrySafe: true, requestId: 'req-safe' },
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    const presentation = modelAttemptPresentation(locale, event);
    assert.ok(presentation.title.trim(), locale);
    assert.match(presentation.detail, new RegExp(String(event.attempt)));
    assert.doesNotMatch(presentation.detail, /UPSTREAM_UNAVAILABLE|req-safe/);
    assert.equal(event.failure.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(event.failure.requestId, 'req-safe');
    assert.equal(presentation.tone, 'warning');
    assert.doesNotMatch(JSON.stringify(presentation), /response body|authorization|bearer/i);
  }
});
