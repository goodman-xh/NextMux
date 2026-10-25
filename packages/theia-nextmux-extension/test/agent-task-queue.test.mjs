import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { AgentRunner, AgentToolRegistry } from '@nextmux/agent-runtime';

import {
  activeRunBelongsToSession,
  agentManualResumeStrategy,
  agentPauseBlocksAutomaticDispatch,
  appendFollowUpTask,
  automaticResumeOwnsLatestTurn,
  followUpDrainSessionIds,
  followUpTaskBelongsToSession,
  hasLegacyToolActivityQueueRecords,
  isLowLevelTaskPlanTitle,
  isLikelyLegacyToolActivityPrompt,
  latestSemanticTaskPlanSteps,
  projectAgentTaskQueue,
  removeFollowUpTask,
  replaceFollowUpTask,
  resolveAgentDispatchPermission,
  resolveAgentDispatchRoute,
  restoreFollowUpTask
} from '../lib/browser/nextmux-agent-task-queue.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { appendAgentActivityEvents, autoResumeDecision, autoResumeDelayMs, userQueuedPrompts } from '../lib/browser/nextmux-agent-activity.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';

const first = { id: 'task-1', prompt: 'first', source: 'user' };
const second = { id: 'task-2', prompt: 'second', source: 'user' };

test('queued dispatch snapshots the current permission ceiling after attachment preparation', async () => {
  const queued = { permissionMode: 'full_access' };
  let conversation = { permissionMode: 'full_access' };

  await Promise.resolve().then(() => {
    conversation = { permissionMode: 'read_only' };
  });

  const request = {
    permissionMode: resolveAgentDispatchPermission({
      queued: queued.permissionMode,
      currentConversation: conversation.permissionMode,
      selected: 'full_access',
    }),
  };
  assert.deepEqual(request, { permissionMode: 'read_only' });
  assert.equal(resolveAgentDispatchPermission({
    queued: 'read_only',
    currentConversation: 'full_access',
    selected: 'full_access',
  }), 'read_only');
  assert.equal(resolveAgentDispatchPermission({
    resumed: 'full_access',
    currentConversation: 'read_only',
    selected: 'full_access',
  }), 'read_only');
  assert.equal(resolveAgentDispatchPermission({
    historical: 'full_access',
    currentConversation: 'read_only',
    selected: 'full_access',
  }), 'read_only');
  assert.equal(resolveAgentDispatchPermission({
    currentConversation: 'read_only',
    selected: 'full_access',
  }), 'full_access', 'a new send uses the actively selected permission');
});

test('model selection is captured per dispatch and a stopped checkpoint resumes only by explicit action', () => {
  const firstModel = { id: 'model-a' };
  const nextModel = { id: 'model-b' };
  let selected = firstModel;
  const currentRun = resolveAgentDispatchRoute({ selected });
  selected = nextModel;

  assert.equal(currentRun, firstModel, 'changing the selection must not hot-swap an active run');
  assert.equal(resolveAgentDispatchRoute({ selected }), nextModel, 'the next normal turn uses the new model');
  assert.equal(resolveAgentDispatchRoute({ queued: firstModel, selected }), firstModel,
    'an already queued turn keeps its immutable route snapshot');
  assert.equal(resolveAgentDispatchRoute({ resumed: firstModel }), firstModel,
    'an automatic continuation stays on the route captured by its turn');
  assert.equal(resolveAgentDispatchRoute({ selected, resumed: firstModel }), nextModel,
    'a manual continuation uses the currently selected model');

  assert.equal(agentManualResumeStrategy({ stage: 'cancelled' }), undefined);
  assert.equal(agentPauseBlocksAutomaticDispatch('context_window_exceeded'), true);
  assert.equal(agentManualResumeStrategy({ stage: 'paused', stopReason: 'context_window_exceeded', resumeCheckpointId: 'context-resume' }), 'continue');
  assert.equal(agentManualResumeStrategy({ stage: 'cancelled', resumeCheckpointId: 'resume-1' }), 'continue');
  assert.equal(agentManualResumeStrategy({
    stage: 'error',
    resumeCheckpointId: 'resume-2',
    failure: { resumable: true, retrySafe: false }
  }), 'retry', 'an unsafe failure is available to the user but never implied to be automatic');
  assert.equal(agentManualResumeStrategy({
    stage: 'error',
    resumeCheckpointId: 'resume-3',
    failure: { resumable: false }
  }), undefined);
});

const budgetStopReasons = ['input_token_limit_reached', 'output_token_limit_reached', 'token_usage_unknown'];

function automaticResumeSeam(turn) {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const methods = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'scheduleAutomaticResume') methods.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(methods.length, 1, 'execute the production scheduler instead of a copied eligibility rule');
  const callbacks = [], resumes = [];
  const factory = new Function('agentPauseBlocksAutomaticDispatch', 'automaticResumeOwnsLatestTurn', 'autoResumeDecision',
    'autoResumeDelayMs', 'userQueuedPrompts', 'appendAgentActivityEvents', 'NextMuxDesktopWidget', 'window',
    ts.transpile(`return class ScheduleSeam { ${methods[0].getText(file)} };`, { target: ts.ScriptTarget.ES2022 }));
  const Seam = factory(agentPauseBlocksAutomaticDispatch, automaticResumeOwnsLatestTurn, autoResumeDecision,
    autoResumeDelayMs, userQueuedPrompts, appendAgentActivityEvents, { AUTO_RESUME_LIMIT: 3 },
    { setTimeout: callback => callbacks.push(callback) });
  const session = { id: 'budget-session', turns: [turn], followUpQueue: [] };
  const widget = Object.assign(new Seam(), {
    conversationWindows: [], applicationExitPreparing: false, node: { isConnected: true },
    conversationHistoryReady: () => true, automaticResumeTurnIds: new Set(), codingSessions: [session],
    conversationHasActiveRun: () => false, relayFeedbackSubmittingVotes: new Set(),
    activeCodingSessionId: session.id, activeThreadTurnId: turn.id, liveAgentEvents: [],
    updateCodingTurn: (_sessionId, _turnId, values) => { session.turns[0] = { ...session.turns[0], ...values }; },
    resumePausedTurn: (...args) => { resumes.push(args); }
  });
  return { widget, session, callbacks, resumes };
}

for (const stopReason of budgetStopReasons) {
  test(`budget pause ${stopReason} cannot schedule a fresh automatic segment`, async () => {
    const registry = new AgentToolRegistry();
    let modelCalls = 0, toolCalls = 0;
    registry.register({ name: 'test.budget_guard', description: 'Fixture read', inputSchema: { type: 'object' },
      requiredPermission: 'read_only', source: 'builtin' }, async () => { toolCalls++; return { modelOutput: {} }; });
    const result = await new AgentRunner({ tools: registry, permissionMode: 'read_only',
      tokenBudget: { maxInputTokens: 100_000, maxOutputTokens: 1 }, model: { async complete() {
        modelCalls++;
        return { content: '', toolCalls: [{ id: 'budget-call', name: 'test.budget_guard', arguments: {} }],
          ...(stopReason === 'token_usage_unknown' ? {} : { usage: {
            inputTokens: stopReason === 'input_token_limit_reached' ? 100_000 : 1,
            outputTokens: stopReason === 'output_token_limit_reached' ? 1 : 0
          } }) };
      } } }).run({ prompt: 'Read the fixture once.', runId: 'run-budget-guard-fixture' });
    assert.equal(modelCalls, 1, 'a completed model call reaches the normal result path');
    assert.equal(toolCalls, 0, 'no tool may run after the budget stop');
    assert.equal(result.status, 'limit_reached');
    assert.equal(result.stopReason, stopReason);
    assert.ok(result.checkpoint);
    const turn = { id: 'budget-turn', stage: 'paused', stopReason: result.stopReason,
      resumeCheckpointId: 'budget-checkpoint', autoResumeAttempts: 0, events: result.events };
    const { widget, callbacks, resumes } = automaticResumeSeam(turn);
    widget.scheduleAutomaticResume('budget-session', turn.id);
    assert.equal(callbacks.length, 0, 'a token budget pause must wait for explicit user action');
    assert.equal(resumes.length, 0);
    assert.equal(turn.autoResumeAttempts, 0);
    assert.equal(agentManualResumeStrategy(turn), 'continue', 'manual continuation remains available');
  });

  test(`pending automatic continuation rechecks a newer ${stopReason} stop`, () => {
    const turn = { id: 'budget-turn', stage: 'paused', stopReason: 'turn_limit_reached',
      resumeCheckpointId: 'budget-checkpoint', autoResumeAttempts: 0, events: [] };
    const { widget, session, callbacks, resumes } = automaticResumeSeam(turn);
    widget.scheduleAutomaticResume('budget-session', turn.id);
    assert.equal(callbacks.length, 1);
    session.turns[0] = { ...turn, stopReason };
    callbacks[0]();
    assert.equal(resumes.length, 0, 'a timer armed before the budget stop cannot rebase it');
    assert.equal(session.turns[0].autoResumeAttempts, 0);
  });
}

test('a normal resumable turn limit still uses the production automatic scheduler', () => {
  const turn = { id: 'budget-turn', stage: 'paused', stopReason: 'turn_limit_reached',
    resumeCheckpointId: 'budget-checkpoint', autoResumeAttempts: 0, events: [] };
  const { widget, session, callbacks, resumes } = automaticResumeSeam(turn);
  widget.scheduleAutomaticResume('budget-session', turn.id);
  assert.equal(callbacks.length, 1);
  callbacks[0]();
  assert.deepEqual(resumes, [['budget-session', 'budget-turn', false]]);
  assert.equal(session.turns[0].autoResumeAttempts, 1);
});

function computerPermissionResumeSeam(turn) {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const methods = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'resumeAfterComputerPermission') methods.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(methods.length, 1, 'execute the production permission recovery entry point');
  const callbacks = [], resumes = [];
  const session = { id: 'budget-session', turns: [turn] };
  const record = { turnId: turn.id, requestId: 'timed-out-permission-request', at: Date.now() };
  const factory = new Function('agentPauseBlocksAutomaticDispatch', 'agentManualResumeStrategy', 'NextMuxDesktopWidget', 'window',
    ts.transpile(`return class PermissionSeam { ${methods[0].getText(file)} };`, { target: ts.ScriptTarget.ES2022 }));
  const Seam = factory(agentPauseBlocksAutomaticDispatch, agentManualResumeStrategy,
    { COMPUTER_PERMISSION_RESUME_KEY: 'fixture-permission-key' }, {
      localStorage: { removeItem() {} },
      nextmuxDesktop: { async getComputerCapability() { return { available: true }; } },
      setTimeout: callback => callbacks.push(callback)
    });
  const widget = Object.assign(new Seam(), { codingSessions: [session],
    readComputerPermissionResumes: () => ({ [session.id]: record }),
    resumePausedTurn: (...args) => { resumes.push(args); } });
  return { widget, session, callbacks, resumes };
}

for (const stopReason of budgetStopReasons) {
  test(`computer permission recovery cannot automatically resume ${stopReason}`, async () => {
    const turn = { id: 'budget-turn', stage: 'paused', stopReason, resumeCheckpointId: 'budget-checkpoint' };
    const { widget, callbacks, resumes } = computerPermissionResumeSeam(turn);
    widget.resumeAfterComputerPermission();
    await Promise.resolve();
    assert.equal(callbacks.length, 0, 'granting OS permission does not authorize a new token-budget segment');
    assert.equal(resumes.length, 0);
    assert.equal(agentManualResumeStrategy(turn), 'continue');
  });

  test(`computer permission recovery timer rechecks a newer ${stopReason}`, async () => {
    const turn = { id: 'budget-turn', stage: 'paused', stopReason: 'turn_limit_reached', resumeCheckpointId: 'budget-checkpoint' };
    const { widget, session, callbacks, resumes } = computerPermissionResumeSeam(turn);
    widget.resumeAfterComputerPermission();
    await Promise.resolve();
    assert.equal(callbacks.length, 1);
    session.turns[0] = { ...turn, stopReason };
    callbacks[0]();
    assert.equal(resumes.length, 0, 'permission recovery must re-read the current turn after its timer');
  });
}

test('normal computer permission recovery still resumes its checkpoint automatically', async () => {
  for (const turn of [
    { id: 'budget-turn', stage: 'paused', stopReason: 'turn_limit_reached', resumeCheckpointId: 'budget-checkpoint' },
    { id: 'budget-turn', stage: 'error', resumeCheckpointId: 'budget-checkpoint', failure: { resumable: true } }
  ]) {
    const { widget, callbacks, resumes } = computerPermissionResumeSeam(turn);
    widget.resumeAfterComputerPermission();
    await Promise.resolve();
    assert.equal(callbacks.length, 1);
    callbacks[0]();
    assert.deepEqual(resumes, [['budget-session', 'budget-turn', false]]);
    assert.equal(agentManualResumeStrategy(turn), turn.stage === 'paused' ? 'continue' : 'retry');
  }
});

test('queued dispatch refreshes its owning conversation after attachments resolve', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const attachmentsPrepared = source.indexOf('const attachments = await this.resolveQueuedAttachments(task)');
  const currentSessionRead = source.indexOf('const current = this.codingSessions.find', attachmentsPrepared);
  const dispatch = source.indexOf('await this.submitPrompt(task.workbench', currentSessionRead);
  assert.ok(attachmentsPrepared >= 0 && attachmentsPrepared < currentSessionRead && currentSessionRead < dispatch);
});

test('follow-up tasks stay immutable and execute in FIFO order', () => {
  const original = [first];
  const appended = appendFollowUpTask(original, second, 2);
  assert.deepEqual(original, [first]);
  assert.deepEqual(appended.map(task => task.id), ['task-1', 'task-2']);
  assert.deepEqual(removeFollowUpTask(appended, 'task-1').map(task => task.id), ['task-2']);
  assert.equal(replaceFollowUpTask(appended, { ...second, prompt: 'updated' })[1].prompt, 'updated');
  assert.throws(() => appendFollowUpTask(appended, { id: 'task-3', prompt: 'third', source: 'user' }, 2), /full/i);
  assert.throws(() => appendFollowUpTask(appended, second, 12), /duplicated/i);

  const fullQueue = Array.from({ length: 20 }, (_, index) => ({
    id: `capacity-${index + 1}`,
    prompt: `message-${index + 1}`,
    source: 'user',
  })).reduce((queue, task) => appendFollowUpTask(queue, task), []);
  assert.equal(fullQueue.length, 20);
  assert.throws(() => appendFollowUpTask(fullQueue, { id: 'capacity-21', prompt: 'message-21', source: 'user' }, 100), /full/i);
});

test('failed dispatch restores a queued task exactly once without reordering newer tasks', () => {
  const newer = { id: 'newer', prompt: 'newer task', source: 'user' };
  const failed = { id: 'failed', prompt: 'failed task', source: 'user' };
  const queue = [newer];
  const restored = restoreFollowUpTask(queue, failed, 0);
  assert.deepEqual(restored.map(task => task.id), ['failed', 'newer']);
  assert.equal(restoreFollowUpTask(restored, failed, 0), restored);
  assert.deepEqual(restoreFollowUpTask(restored, { ...failed, prompt: 'updated' }, 0).map(task => task.prompt), ['failed task', 'newer task']);
});

test('task queue projects only the latest explicit plan and queued user messages, never tool execution records', () => {
  const longPlanTitle = `Preserve the complete semantic title ${'without truncation '.repeat(20)}`.trim();
  const events = [
    { type: 'assistant_progress', turn: 1, content: '正在搜索和读取文件。', origin: 'model', at: '2026-08-31T00:00:00.000Z' },
    { type: 'tool_started', callId: 'rg', toolName: 'workspace.search', source: 'builtin', summary: { title: 'rg task.update_plan' }, at: '2026-08-31T00:00:01.000Z' },
    { type: 'tool_completed', callId: 'rg', toolName: 'workspace.search', source: 'builtin', ok: true, summary: { title: 'rg found 12 matches' }, at: '2026-08-31T00:00:02.000Z' },
    { type: 'tool_started', callId: 'read', toolName: 'workspace.read_file', source: 'builtin', summary: { title: 'read_file queue.ts' }, at: '2026-08-31T00:00:03.000Z' },
    { type: 'tool_completed', callId: 'read', toolName: 'workspace.read_file', source: 'builtin', ok: true, summary: { title: 'read_file completed' }, at: '2026-08-31T00:00:04.000Z' },
    { type: 'tool_started', callId: 'list', toolName: 'workspace.list_files', source: 'builtin', summary: { title: 'list_files packages' }, at: '2026-08-31T00:00:05.000Z' },
    { type: 'task_plan_updated', steps: [
      { id: 'baseline', title: 'Run baseline', status: 'in_progress' },
      { id: 'verify', title: 'Verify behavior', status: 'pending' },
    ], at: '2026-08-31T00:00:06.000Z' },
    { type: 'tool_completed', callId: 'list', toolName: 'workspace.list_files', source: 'builtin', ok: true, summary: { title: 'list_files completed' }, at: '2026-08-31T00:00:07.000Z' },
    { type: 'task_plan_updated', steps: [
      { id: 'baseline', title: 'Run baseline', status: 'completed' },
      { id: 'verify', title: `Verify\n  behavior`, status: 'in_progress' },
      { id: 'report', title: longPlanTitle, status: 'pending' },
    ], at: '2026-08-31T00:00:08.000Z' },
  ];
  const queued = [
    { id: 'message-1', source: 'user', prompt: 'first\n queued message' },
    { id: 'tool-record', source: 'tool', prompt: 'tool activity must not become a task' },
    { id: 'message-2', prompt: 'legacy queued message' },
  ];

  const items = projectAgentTaskQueue(events, queued);

  assert.deepEqual(items.map(item => [item.kind, item.id, item.status, item.title]), [
    ['plan_step', 'plan:baseline', 'completed', 'Run baseline'],
    ['plan_step', 'plan:verify', 'in_progress', 'Verify behavior'],
    ['plan_step', 'plan:report', 'pending', longPlanTitle],
    ['queued_message', 'message:message-1', 'queued', 'first queued message'],
    ['queued_message', 'message:message-2', 'queued', 'legacy queued message'],
  ]);
  assert.equal(items.some(item => /rg|read_file|list_files|tool activity/i.test(item.title)), false);
  assert.equal(items[2].title.length, longPlanTitle.length);

  assert.deepEqual(latestSemanticTaskPlanSteps(events).map(step => [step.id, step.status]), [
    ['baseline', 'completed'],
    ['verify', 'in_progress'],
    ['report', 'pending'],
  ]);

  const capped = projectAgentTaskQueue([], Array.from({ length: 25 }, (_, index) => ({
    id: `queued-${index + 1}`,
    source: 'user',
    prompt: `queued message ${index + 1}`,
  })));
  assert.equal(capped.length, 20);
  assert.deepEqual(capped.map(item => item.id), Array.from({ length: 20 }, (_, index) => `message:queued-${index + 1}`));
});

test('task queue rejects raw tool transcripts even when a provider labels them as plan steps', () => {
  const noisy = [
    'rg 退出码 0',
    '读取 packages/theia-nextmux-extension/src/browser/nextmux-desktop-widget.tsx',
    '找到 57 处匹配',
    '工具执行失败',
    '列出 500 个工作区条目',
  ];
  for (const title of noisy) assert.equal(isLowLevelTaskPlanTitle(title), true, title);
  const items = projectAgentTaskQueue([
    { type: 'task_plan_updated', steps: noisy.map((title, index) => ({ id: `noise-${index}`, title, status: 'completed' })) },
  ], []);
  assert.deepEqual(items, []);
});

test('task queue keeps stable user order and filters legacy non-user sources before applying the cap', () => {
  const events = [
    { type: 'assistant_progress', content: 'narration must stay out' },
    { type: 'task_plan_updated', steps: [
      { id: 'step-a', title: 'first plan step', status: 'pending' },
      { id: 'step-b', title: 'second plan step', status: 'in_progress' },
    ] },
    { type: 'tool_output', chunk: 'rg/read output must stay out' },
  ];
  const queued = [
    { id: 'old-builtin', source: 'builtin', prompt: 'old rg result' },
    { id: 'old-acp', source: 'acp', prompt: 'old tool output' },
    { id: 'message-a', source: 'user', prompt: 'first user message' },
    { id: 'legacy-message', prompt: 'legacy user message' },
    ...Array.from({ length: 19 }, (_, index) => ({
      id: `message-${index + 1}`,
      source: 'user',
      prompt: `user message ${index + 1}`,
    })),
  ];

  const projected = projectAgentTaskQueue(events, queued);

  assert.deepEqual(projected.map(item => item.id), [
    'plan:step-a',
    'plan:step-b',
    'message:message-a',
    'message:legacy-message',
    ...Array.from({ length: 16 }, (_, index) => `message:message-${index + 1}`),
  ]);
  assert.equal(projected.length, 20);
  assert.equal(projected.some(item => /rg|read|tool output|builtin|acp/i.test(item.title)), false);
  assert.equal(events[1].steps[0].title, 'first plan step');
  assert.equal(queued[2].prompt, 'first user message');
});

test('legacy untagged tool summaries are migrated out without deleting ordinary legacy user prompts', () => {
  const stale = [
    'rg 退出码 0',
    '读取 packages/theia-nextmux-extension/src/browser/nextmux.css',
    '找到 57 处匹配',
    '找到 57 个匹配',
    '发现 2 项匹配',
    '列出 500 个工作区条目',
    '列出 500 项',
    '显示 12 个条目',
    '工具执行失败',
    'pnpm 退出码 1',
    'Read file artifacts/report.txt',
    'Found 2 matches',
    'Tool execution failed',
    '正在读取 packages/theia-nextmux-extension/src/browser/nextmux-desktop-widget.tsx >',
    '正在搜索 packages/theia-nextmux-extension/src >',
    '正在执行 node server.js >',
  ];
  for (const prompt of stale) assert.equal(isLikelyLegacyToolActivityPrompt(prompt), true, prompt);
  for (const prompt of ['读取一下这个问题并修复', '请运行测试并解释结果', 'legacy queued message']) {
    assert.equal(isLikelyLegacyToolActivityPrompt(prompt), false, prompt);
  }
  assert.deepEqual(userQueuedPrompts([
    ...stale.map((prompt, index) => ({ id: `legacy-tool-${index}`, prompt })),
    { id: 'legacy-user', prompt: '请运行测试并解释结果' },
  ]).map(item => item.id), ['legacy-user']);
  assert.equal(hasLegacyToolActivityQueueRecords([{ followUpQueue: [
    { source: 'tool', prompt: 'tool output' },
    { prompt: '正在读取 packages/a.ts >' }
  ] }]), true);
  assert.equal(hasLegacyToolActivityQueueRecords([{ followUpQueue: [
    { source: 'user', prompt: '正在读取需求并修复' },
    { prompt: '普通的历史用户消息' }
  ] }]), false);
});

test('the queue excludes tool activity while preserving legacy user-authored messages', () => {
  const mixed = [
    { id: 'user-a', sessionId: 'session-a', source: 'user', prompt: 'first' },
    { id: 'tool-a', sessionId: 'session-a', source: 'tool', prompt: 'tool output' },
    { id: 'legacy-a', sessionId: 'session-a', prompt: 'legacy untagged record' },
    { id: 'user-b', sessionId: 'session-b', source: 'user', prompt: 'other conversation' },
  ];

  assert.deepEqual(userQueuedPrompts(mixed).map(task => task.id), ['user-a', 'legacy-a', 'user-b']);
});

test('the queue removes tool summaries that an older build mislabeled as user messages', () => {
  const mislabeled = [
    { id: 'mislabeled-search', source: 'user', prompt: '找到 57 处匹配' },
    { id: 'mislabeled-command', source: 'user', prompt: 'pnpm 退出码 1' },
    { id: 'mislabeled-read', source: 'user', prompt: '读取 packages/a.ts' },
    { id: 'real-user', source: 'user', prompt: '请修复这个问题' },
  ];
  // Exact count/exit-code labels are removed; "读取 packages/a.ts" is kept because a user can type exactly that as an
  // instruction, and losing a real instruction silently is worse than showing one stale label (audit C35-05).
  assert.deepEqual(userQueuedPrompts(mislabeled).map(task => task.id), ['mislabeled-read', 'real-user']);
  assert.deepEqual(projectAgentTaskQueue([], mislabeled).map(item => item.id), ['message:mislabeled-read', 'message:real-user']);
  const instructions = ['Read file artifacts/report.txt and explain the failure', 'Read the README and fix the build', 'Reading list: update docs'];
  assert.deepEqual(userQueuedPrompts(instructions.map((prompt, index) => ({ id: `i${index}`, source: 'user', prompt }))).map(task => task.prompt), instructions);
});

test('the persisted queue filters tools and preserves all previously accepted user messages after restart', () => {
  const followUpQueue = Array.from({ length: 21 }, (_, index) => ({
    id: `user-${index + 1}`,
    sessionId: 'session-a',
    source: 'user',
    prompt: `message-${index + 1}`,
  }));
  const session = {
    id: 'session-a',
    updatedAt: 1,
    turns: [],
    followUpQueue: [
      followUpQueue[0],
      { id: 'tool', sessionId: 'session-a', source: 'tool', prompt: 'activity must not persist as a queue item' },
      { id: 'legacy', sessionId: 'session-a', prompt: 'legacy user message must survive an upgrade' },
      ...followUpQueue.slice(1),
    ],
  };

  const mirror = createConversationHistoryMirror([session]);
  const restored = readConversationHistoryMirror(JSON.stringify(mirror));
  const restoredQueue = restored.sessions[0].followUpQueue;

  assert.deepEqual(restoredQueue.map(task => task.id), [
    'user-1',
    'legacy',
    ...followUpQueue.slice(1).map(task => task.id),
  ]);
});

test('follow-up tasks and automatic drains remain scoped to their owning conversation', () => {
  assert.equal(activeRunBelongsToSession('session-a', 'session-a'), true);
  assert.equal(activeRunBelongsToSession('session-a', 'session-b'), false);
  assert.equal(activeRunBelongsToSession('', 'session-a'), false);
  assert.equal(followUpTaskBelongsToSession({ id: 'owned', prompt: 'next', sessionId: 'session-a' }, 'session-a'), true);
  assert.equal(followUpTaskBelongsToSession({ id: 'owned', prompt: 'next', sessionId: 'session-a' }, 'session-b'), false);
  assert.deepEqual(followUpDrainSessionIds({
    finishedSessionId: 'session-a',
    finished: true,
    directSessionIds: []
  }), ['session-a']);
  assert.deepEqual(followUpDrainSessionIds({
    finishedSessionId: 'session-a',
    finished: false,
    directSessionIds: ['session-b']
  }), ['session-b']);
  assert.deepEqual(followUpDrainSessionIds({
    finishedSessionId: 'session-a',
    finished: true,
    directSessionIds: ['session-a']
  }), ['session-a']);
  assert.deepEqual(followUpDrainSessionIds({
    finishedSessionId: 'session-error',
    finished: true,
    directSessionIds: []
  }), ['session-error']);
  assert.deepEqual(followUpDrainSessionIds({
    finishedSessionId: 'session-a',
    finished: true,
    directSessionIds: ['session-b', 'session-c', 'session-b', '']
  }), ['session-a', 'session-b', 'session-c']);
});

test('automatic checkpoint continuation cannot revive an older task after a new user task exists', () => {
  assert.equal(automaticResumeOwnsLatestTurn({
    turnId: 'turn-latest',
    latestTurnId: 'turn-latest',
    queuedUserPromptCount: 0
  }), true);
  assert.equal(automaticResumeOwnsLatestTurn({
    turnId: 'turn-old',
    latestTurnId: 'turn-new',
    queuedUserPromptCount: 0
  }), false);
  assert.equal(automaticResumeOwnsLatestTurn({
    turnId: 'turn-latest',
    latestTurnId: 'turn-latest',
    queuedUserPromptCount: 1
  }), false);
});

test('running-task controls are translated for every desktop language', () => {
  const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  for (const locale of locales) {
    for (const key of ['adjustCurrent', 'queueNext', 'sendDirection', 'addToQueue', 'directionAccepted', 'directionApplied', 'followUpQueue', 'removeQueuedTask', 'sendFailed', 'toolRunning', 'attachmentOnly', 'modelResponseReady', 'waitingForModel', 'more', 'editQueuedTask', 'sendNow', 'unsupportedModels', 'modelGenerationUnverified', 'modelGenerationUnsupported', 'modelToolsUnverified', 'modelToolsUnsupported', 'followUpPlaceholder', 'reasoningEffort']) {
      assert.ok(runningTaskText(locale, key).trim(), `${locale}.${key}`);
    }
  }
  assert.equal(runningTaskText('zh-CN', 'followUpQueue'), '消息队列');
  assert.equal(runningTaskText('en', 'followUpQueue'), 'Message queue');
});

test('desktop running composer remains editable and exposes exactly one contextual final action', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /textarea disabled=\{this\.agentStage === 'running'\}/);
  assert.doesNotMatch(source, /className='nmx-running-message-mode'/);
  assert.match(source, /className='nmx-follow-up-queue'/);
  assert.match(source, /agentRunning && !composerHasPayload/);
  assert.match(source, /className='nmx-send-button is-stop'/);
  assert.match(source, /className='nmx-stop-glyph'/);
  assert.match(source, /disabled=\{!this\.conversationHistoryReady\(\) \|\| !composerHasPayload \|\| !route(?: \|\| this\.composerComposing)? \|\| attachmentImporting \|\| attachmentsUnresolved \|\| this\.runningMessageSubmitting \|\| this\.unsupportedAttachments\(route\)\.length > 0(?: \|\| this\.agentStopping \|\| this\.agentCancelRequested)?\}/);
  assert.match(style, /\.nmx-stop-glyph\s*\{[\s\S]*?background: currentColor/);
});

test('running-message send immediately persists one queue item without an extra mode confirmation', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const submitStart = source.indexOf('protected async executePromptSubmission(');
  const runningBranchStart = source.indexOf("if (run.agentStage === 'running' || run.activeAgentRunId) {", submitStart);
  const runningBranchEnd = source.indexOf('if (historicalExecution)', runningBranchStart);
  assert.match(source.slice(runningBranchStart, runningBranchEnd), /return this\.submitRunningMessage\(workbench\)/);
  assert.doesNotMatch(source, /runningMessageChoiceOpen|renderRunningMessageChoice/);
  const runningSubmitStart = source.indexOf('protected async submitRunningMessage(');
  const runningSubmitEnd = source.indexOf('protected async drainFollowUpQueue(', runningSubmitStart);
  const runningSubmit = source.slice(runningSubmitStart, runningSubmitEnd);
  assert.ok(runningSubmit.indexOf('this.enqueueFollowUpTask(') < runningSubmit.indexOf("this.setComposerPrompt('')"));
  assert.doesNotMatch(runningSubmit, /stopAgentRun|applyQueuedFollowUpAsDirection/);
  assert.match(source, /className='nmx-follow-up-direction'/);
  assert.match(source, /className='nmx-follow-up-more'/);
});

test('running messages use one bounded FIFO queue with steering, editing and direct-send controls', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
  assert.match(source, /static readonly FOLLOW_UP_QUEUE_LIMIT = 20/);
  assert.match(source, /const existingQueue = \(session\.followUpQueue \|\| \[\]\)\.filter\(item => options\.automaticGoal \|\| !item\.automaticGoal \|\| Boolean\(item\.dispatch\)\);\s*const queue = appendFollowUpTask\(existingQueue, task, NextMuxDesktopWidget\.FOLLOW_UP_QUEUE_LIMIT\)/);
  assert.doesNotMatch(source, /slice\(0, NextMuxDesktopWidget\.FOLLOW_UP_QUEUE_LIMIT\)\.map\(task =>/);
  assert.match(source, /applyQueuedFollowUpAsDirection/);
  assert.match(source, /editQueuedFollowUpTask/);
  assert.match(source, /directSendQueuedFollowUpTask/);
  assert.match(source, /runningTaskText\(this\.desktopLocale, 'editQueuedTask'\)/);
  assert.match(source, /runningTaskText\(this\.desktopLocale, task\.dispatch \? 'checkDelivery' : 'sendNow'\)/);
  assert.match(source, /sessionId: session\.id/);
  assert.match(source, /followUpDrainReadySessionIds/);
  assert.match(source, /followUpDrainSessionIds\(\{/);
  assert.match(source, /if \(!existing\) return;/, 'a later UI failure must not resurrect an accepted queue item');
  assert.match(source, /const accepted = await this\.submitPrompt\(task\.workbench/);
  assert.match(source, /if \(!accepted\) \{[\s\S]*?restoreDispatchTask/);
  const acceptedIndex = source.indexOf('const accepted = await this.submitPrompt(task.workbench');
  assert.ok(acceptedIndex >= 0 && source.indexOf('this.queuedAttachmentPayloads.delete(task.id)', acceptedIndex) > acceptedIndex);
  assert.match(source, /finished:\s*generation === run\.agentPollGeneration\s*&& run\.agentStage !== 'running'\s*&& run\.agentResult\?\.stopReason === 'completed'/);
  assert.doesNotMatch(source, /if \(visibleSessionId && visibleSessionId !== finishedSessionId\) void this\.drainFollowUpQueue/);
  assert.match(source, /codingSession\?\.turns\.length \? codingSession\.turns : !codingSession && submittedPrompt \? \[\{/);
  assert.match(source, /followUpQueue: \[\]/);
  assert.doesNotMatch(source, /在侧边聊天中打开/);
  assert.match(style, /\.nmx-follow-up-queue > article > div\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?-webkit-mask-image:\s*linear-gradient\(to right,/);
  assert.match(style, /\.nmx-follow-up-queue > article strong\s*\{[\s\S]*?display:\s*block;[\s\S]*?text-overflow:\s*clip;/);
});

test('user steering messages not applied before completion remain queued instead of being lost', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  assert.match(source, /if \(codingSession && snapshot\.pendingMessages\.length\)/);
  assert.match(source, /snapshot\.pendingMessages[\s\S]{0,500}restoreFollowUpTask/);
});

test('model picker lists cached models from the explicit source while gating unavailable routes and exposing reasoning effort', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
  assert.match(source, /const modelOptions = this\.activeRelayKey[\s\S]*?partitionModelPickerCandidates\(modelOptions\.map\(model => \(\{/);
  assert.match(source, /const supportedModelOptions = pickerPartition\.selectable\.map/);
  assert.match(source, /const visibleModelOptions = modelOptions\.filter\(model => this\.isModelVisible\(model\.id\)\);/);
  assert.match(source, /if \(!isVerifiedModelRoute\(virtual\.capabilityEvidence, true\)\) return \[\]/);
  assert.match(source, /modelRouteCapabilityGate\(virtual\.capabilityEvidence, true\)/);
  assert.match(source, /interfaceSupport: catalogEntry\?\.interfaceSupport/);
  assert.match(source, /data-capability-gate=/);
  assert.match(source, /for \(const model of officialDiscoveredModelIds\(connection\)\)/);
  assert.match(source, /new Map\(officialDiscoveredModelIds\(connection\)/);
  assert.match(source, /protocolSupportsReasoningEffort\(route\.connection\.protocol\)/);
  assert.match(source, /const contract = this\.modelReasoningContract\(route\);\s*const declared = declaredReasoningEfforts\(contract\);/);
  // Ticked models first, then everything else the API can run, so the list is searchable (2026-09-29).
  assert.match(source, /const pickerSearchable = Boolean\(pickerQuery\) \|\| visibleModelOptions\.length \+ moreModelOptions\.length > 12;/);
  assert.match(source, /className='nmx-model-picker-search'[\s\S]{0,200}<ImeInput/);
  // Visible models, with one row per price when a relay sells a model on several APIs at different prices.
  assert.match(source, /const pickerRows: readonly CodingModelOption\[\] = withPriceVariants\((?:partitionModelPickerCandidates\(\s*)?\[\.\.\.visibleModelOptions, \.\.\.moreModelOptions\]\.filter\(matchesPickerQuery\)/,
    'every model the API runs is in one list, ticked or not');
  assert.match(source, /<Virtuoso[\s\S]*?className='nmx-model-picker-list'[\s\S]*?data=\{pickerRows\}/);
  assert.match(source, /renderModelPickerOption\(model, modelRouteById\.has\(model\.variantOf \?\? model\.id\)\)/);
  assert.match(source, /<button aria-disabled=\{!supported\} onClick=\{event => \{\s*if \(!supported\) return;/);
  assert.doesNotMatch(source, /unsupportedModelOptions|renderModelPickerOption\(model, false\)/);
  assert.match(source, /className=\{`nmx-model-effort-menu nmx-model-evidence-menu is-\$\{placement\.side\}`\}/);
  assert.match(source, /setModelOptionReasoningEffort/);
  const modelPickerStyle = [...style.matchAll(/\.nmx-model-picker-popover\s*\{[\s\S]*?\n\}/g)]
    .map(match => match[0]).find(block => block.includes('position: fixed')) ?? '';
  assert.match(modelPickerStyle, /position:\s*fixed;[\s\S]*?inset:\s*auto;[\s\S]*?overflow:\s*hidden;/);
  assert.doesNotMatch(modelPickerStyle, /position-anchor|anchor\(top\)|anchor\(right\)/);
  assert.match(style, /\.nmx-model-effort-menu\s*\{/);
  assert.match(source, /placeAnchoredFloatingPanel\(anchor, viewport, panelWidth, panelHeight,[\s\S]*?safeTop:/);
  assert.match(source, /ReactDOM\.createPortal\(/);
  assert.match(style, /\.nmx-model-effort-portal\s*\{[\s\S]*?display: contents/);
  assert.match(style, /\.nmx-model-effort-menu\s*\{[\s\S]*?position: fixed/);
  assert.doesNotMatch(style, /position-anchor:\s*--nmx-model-effort-anchor/);
  assert.match(style, /\.nmx-model-only-popover\s*\{[\s\S]*?width:\s*min\(264px/);
});

test('normal turns hide internal accounting cards and copy actions provide acknowledgement', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  assert.match(source, /showCopiedIndicator\(indicatorKey\)/);
  assert.match(source, /copiedIndicatorKey === `user:\$\{conversationMessageId\(turn, 'user'\)\}:content` \? 'check' : 'copy'/);
  assert.match(source, /copiedIndicatorKey === key\(action\) \? 'check' : fallback/);
  assert.doesNotMatch(source, /<strong>执行<\/strong><span>\{turn\.executionLabel\}<\/span>/);
  assert.doesNotMatch(source, /<strong>用量<\/strong><span>\{turn\.usageLabel\}<\/span>/);
  assert.doesNotMatch(source, /<strong>计费<\/strong><span>\{turn\.billingLabel\}<\/span>/);
});

test('workspace and history navigation cannot reset an active agent run', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  for (const method of ['selectWorkspaceRoot', 'createCodingSessionForWorkspace', 'openCodingSession', 'applyNavigationSnapshot', 'startNewCodingTask']) {
    const start = source.search(new RegExp(`protected (?:async )?${method}\\(`));
    assert.notEqual(start, -1, `${method} exists`);
    const nextMethod = source.indexOf('\n    protected ', start + 20);
    const body = source.slice(start, nextMethod > start ? nextMethod : start + 4_000);
    assert.match(body, /const agentTaskActive = (?:this\.agentStage === 'running' \|\| Boolean\(this\.activeAgentRunId\)|this\.conversationHasActiveRun\?\.\((?:sessionId|snapshot\.codingSessionId)\) \|\| false)/, `${method} protects the active run`);
  }
});

test('direct-send and steering never cancel or mutate another conversation run', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  assert.match(source, /activeRunBelongsToSession\(run\.activeAgentSessionId, session\.id\)/);
  assert.match(source, /const ownsActiveRun = Boolean\(\(run\.agentStage === 'running'[\s\S]*?activeRunBelongsToSession/);
  assert.match(source, /directFollowUpDrainTaskIds\.set\(session\.id, task\.id\)/);
  assert.match(source, /directFollowUpDrainTaskIds\.has\(codingSession\.id\)[\s\S]*?await this\.stopConversationAgentRun\(codingSession\.id\)/);
  assert.match(source, /directSessionIds: \[\.\.\.this\.directFollowUpDrainTaskIds\.keys\(\)\]/);
  assert.doesNotMatch(source, /if \(this\.activeAgentRunId && this\.agentStage === 'running'\) \{\s*this\.directFollowUpDrainSessionId = session\.id;\s*await this\.stopConversationAgentRun\(codingSession\.id\);/);
});


test('restoring a pending direction into a full queue is lossless and idempotent', () => {
  const queue = Array.from({ length: 20 }, (_, index) => ({ id: `q-${index}`, prompt: `task ${index}`, sessionId: 'a' }));
  const direction = { id: 'accepted-direction', prompt: 'already accepted', sessionId: 'a' };
  const recovered = restoreFollowUpTask(queue, direction, queue.length);
  assert.equal(recovered.length, 21);
  assert.equal(recovered[20], direction);
  assert.equal(restoreFollowUpTask(recovered, direction), recovered);
  assert.throws(() => appendFollowUpTask(recovered, { id: 'new', prompt: 'new task' }));
});
