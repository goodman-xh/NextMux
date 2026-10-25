import { classifyModelError } from '@nextmux/model-runtime/errors';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withDesktopPowerSaveBlocker } from '../lib/node/nextmux-power-save.js';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

// Exercise current source without a UI, provider request, or user profile.
const src = fileURLToPath(new URL('../src/', import.meta.url)), cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const require = createRequire(path);
  const localRequire = name => {
    if (name.startsWith('.')) {
      const base = resolve(dirname(path), name), candidate = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (candidate?.endsWith('.ts') || candidate?.endsWith('.tsx')) return load(candidate);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
  }).outputText)(localRequire, module, module.exports);
  return module.exports;
}
const queue = load(join(src, 'browser/nextmux-agent-task-queue.ts'));
const { QueuedSubmissionStore, queuedModelRequestWasRejected, queuedRunHasNoAcceptedWork } = load(join(src, 'node/nextmux-queued-submission-store.ts'));
const history = load(join(src, 'browser/nextmux-conversation-history.ts'));
const { normalizeDesktopSettingsPanel } = load(join(src, 'browser/nextmux-desktop-restore-state.ts'));
const { runningTaskText } = load(join(src, 'browser/nextmux-running-task-locale.ts'));
const { domainMessageFromError } = load(join(src, 'common/nextmux-domain-errors.ts'));
const { scheduleDomainMessage } = load(join(src, 'common/nextmux-schedule-domain.ts'));
const { mediaMessageText } = load(join(src, 'common/nextmux-media-messages.ts'));
const widgetSource = readFileSync(join(src, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map();
const visit = node => { if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
visit(ast);
const methodNames = ['capturePromptSubmission', 'submissionComposerMatches', 'submissionPastedReferences', 'clearSubmittedComposer', 'submitPrompt', 'pollAgentRun', 'stopConversationAgentRun', 'recordSteeringEvents', 'executePromptSubmission', 'persistAcceptedAgentHost', 'sessionPermissionMode', 'drainFollowUpQueue', 'updateFollowUpQueue', 'setQueuedFollowUpTaskError',
  'applyNavigationSnapshot', 'toggleSettingsPanel', 'openSettingsPanel', 'navigationSnapshot',
  'persistActiveCodingSessionState', 'setDesktopTheme',
  'savedFixedOfferingKey', 'savedFixedOfferingsForMerchant', 'loadSavedFixedOffering', 'waitForCatalogRoute', 'managedOfferings', 'managedModelRoutes', 'retainedManagedRouteForDispatch'];
const code = ts.transpile(`class Harness { ${methodNames.map(name => methods.get(name)).join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const route = { id: 'route', kind: 'official_connection', connection: { id: 'connection', model: 'model', modelFamily: 'model', providerName: 'provider' } };
const task = id => ({ id, sessionId: 'session', prompt: `Please complete ${id}`, source: 'user', workbench: 'coding', routeId: route.id,
  relayKey: 'official', modelLabel: 'model', permissionMode: 'workspace_write', attachments: [], createdAt: 1 });
const completed = (status = 'completed', stopReason = 'completed') => ({ runId: 'run-accepted', status, pendingMessages: [], children: [],
  result: { status, stopReason, events: [], changes: [], finalText: 'done', route: { kind: 'official_connection', model: 'model' },
    usage: { inputTokens: 2, outputTokens: 1 }, billing: { kind: 'provider_direct' }, failoverCount: 0 } });
function fixture() {
  const timers = [], persisted = [], requests = [], drains = [];
  const dependencies = { ...load(join(src, '../../model-runtime/src/reasoning-evidence.ts')), ...load(join(src, 'browser/nextmux-composer-long-paste.ts')), ...load(join(src, 'browser/nextmux-agent-event-poll.ts')), ...load(join(src, 'browser/nextmux-model-errors.ts')), ...load(join(src, 'common/nextmux-model-controls.ts')), ...queue, ...load(join(src, 'browser/nextmux-conversation-branch.ts')), runningTaskText,
    normalizeDesktopSettingsPanel, normalizeAgentChildScrollStates: value => value || {},
    automaticRelaySource: () => 'off', normalizeContextWindowTokens: value => value,
    effectiveContextWindowTokens: load(join(src, 'common/nextmux-context-budget.ts')).effectiveContextWindowTokens,
    bindPriceQuote: value => value, userQueuedPrompts: value => value,
    MAX_TOTAL_ATTACHMENTS_PER_TASK: 100, composerContentToken: (owner = '', value = '', attachments = [], references = [], order = []) => load(join(src, 'browser/nextmux-composer-long-paste.ts')).composerContentToken(owner, value, attachments, references, order),
    isInsufficientBalanceFailure: error => error?.code === 'INSUFFICIENT_BALANCE',
    normalizeDesktopFailure: (_locale, error) => ({ code: error?.code || 'FAILED', message: error?.message || String(error), kind: 'failed', retryable: false, resumable: false }),
    desktopFailureMessage: (_locale, error) => error?.message || String(error),
    normalizeRelayFeedbackRequestIds: () => [], normalizeModelCitations: value => value,
    appendAgentActivityEvents: (before, after) => [...before, ...after],
    window: { setTimeout(fn) { timers.push(fn); return timers.length; } }
  };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  const state = new Harness();
  Object.assign(state, {
    capturePromptSubmission: undefined,
    codingSessions: [{ id: 'session', workspacePath: '/synthetic', createdAt: 1, updatedAt: 1, permissionMode: 'workspace_write',
      turns: [{ id: 'previous', stage: 'complete', stopReason: 'completed' }], followUpQueue: [task('first'), task('second')] }],
    activeCodingSessionId: 'session', activeAgentRunId: '', agentStage: 'complete', agentPollGeneration: 0,
    // The answer-style field (正常 sends none); without it every dispatch threw before startAgentRun and the waits spun forever.
    creativityRunField: () => ({}),
    agentQuestions: { sync() {} },
    applicationExitGeneration: 0, conversationHistoryLoadGeneration: 0, applicationExitPreparing: false,
    desktopLocale: 'en', permissionMode: 'workspace_write', contextWindowTokens: undefined,
    conversationWindows: [], followUpDrainReadySessionIds: new Set(['session']), directFollowUpDrainTaskIds: new Map(),
    queuedAttachmentPayloads: new Map(), conversationHistoryPersistDirty: false, privacySettings: { saveConversationHistory: true },
    skillService: { ready: Promise.resolve() }, conversationMutations: { tryAcquire: () => () => {} },
    conversationHistoryReady: () => true, update() {}, persistCodingSessions() {}, notifyThreadContentChanged() {}, persistActiveCodingSessionState() {},
    // These conversations have no Council configuration, so no Council validation message applies.
    invalidCouncilConfigMessage: () => '', migrateDraftCouncilConfigToSession() {}, promotePendingCouncilConfig() {}, navigationBackStack: [], navigationForwardStack: [],
    async flushConversationHistory() { persisted.push(structuredClone(this.codingSessions)); },
    routesForRelay: () => [route], routeSupportsAttachment: () => true, modelRoutes: () => [route],
    resolveQueuedAttachments: async () => [], async prepareAgentSkills() { return []; },
    codingSessionWorkspaceRoot: () => '/synthetic', async ensureCodingSessionWorkspace(session) { return session; }, codingConversationHistory: () => [],
    appendCodingTurn(session, prompt) { const turn = { id: `turn-${session.turns.length}`, prompt, stage: 'running' };
      this.codingSessions = this.codingSessions.map(s => s.id === session.id ? { ...s, turns: [...s.turns, turn] } : s); return turn; },
    updateCodingTurn(sessionId, turnId, patch) { this.codingSessions = this.codingSessions.map(s => s.id === sessionId
      ? { ...s, turns: s.turns.map(t => t.id === turnId ? { ...t, ...patch } : t) } : s); },
    recentToolNames: () => [], activeModelRoute: () => route, reasoningEffortForRoute() {}, modelReasoningContract() {}, reasoningSettingsForRoute: () => ({}), managedModelRoute() {}, selectedTerminalProfile() {}, scheduleThreadBottomFollow() {},
    ensureAgentFinalSummary: result => result.finalText, agentBillingLabel: () => '', notifySystemTask() {}, codingSessionTitle: text => text, captureAgentBrowsers() {},
    scheduleAutomaticResume() {}, scheduleGoalContinuation() {}, requestFollowUpQueueDrain: id => drains.push(id),
    platformService: {
      async startAgentRun(request) { requests.push(request); return { runId: 'run-accepted' }; },
      async getQueuedAgentSubmission() { return { state: 'unknown' }; }, async cancelAgentRun() {}
    },
    async pollAgentRun() { return completed(); },
    submitPrompt(...args) { return this.executePromptSubmission(...args); }
  });
  return { state, timers, persisted, requests, drains, window: dependencies.window, queue: () => state.codingSessions[0].followUpQueue,
    async dispatch() { await state.drainFollowUpQueue('session'); },
    flushTimers() { for (const fn of timers.splice(0)) fn(); } };
}

test('only normal successful completion releases queued followups', () => {
  for (const stage of ['running', 'thinking', 'tool_wait', 'compacting', 'retrying', 'paused', 'cancelled', 'error', 'waiting_user']) {
    assert.equal(queue.agentCompletionAllowsAutomaticDispatch(stage, 'completed'), false, stage);
  }
  for (const reason of [undefined, 'cancel_requested', 'pause_requested', 'user_input_cancelled', 'context_window_exceeded', 'turn_limit_reached']) {
    assert.equal(queue.agentCompletionAllowsAutomaticDispatch('complete', reason), false, String(reason));
  }
  assert.equal(queue.agentPauseBlocksAutomaticDispatch('cancel_requested'), true);
  assert.equal(queue.agentCompletionAllowsAutomaticDispatch('complete', 'completed'), true);
});

for (const finishInSettings of [false, true]) test(`readonly unmounted conversation survives Settings/theme roundtrip and run completion ${finishInSettings ? 'before' : 'after'} return`, async () => {
  const f = fixture(), result = deferred(), polling = deferred(), writes = [];
  const state = f.state;
  state.codingSessions[0].permissionMode = 'read_only';
  state.codingSessions[0].turns[0].permissionMode = 'read_only';
  state.codingSessions[0].followUpQueue = state.codingSessions[0].followUpQueue.map(task => ({ ...task, permissionMode: 'read_only' }));
  Object.assign(state, {
    defaultPermissionMode: 'full_access', permissionMode: 'read_only', lastRunPermissionMode: 'read_only',
    activeSection: 'coding', codingPanel: 'thread', activeWorkspaceRoot: '/synthetic',
    // Scheduled folders need not be registered as a Theia root.
    workspaceOptions: [{ path: '/unrelated-root' }], scheduledTasks: [], expandedCodingProjects: new Set(),
    themePreference: 'dark', composerPrompt: 'unfinished readonly followup',
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    currentCodingSessionViewState: () => ({}), navigationSurface: () => ({ kind: 'none' }),
    rememberNavigation() {}, clearNavigationSurfaces() {}, stopVoiceInput() {}, enforceDesktopTheme() {},
    detachContextEditorRecovery: () => true, syncActiveTerminal() {}, syncActiveBrowser() {},
    restoreCodingViewState: async () => {}, applyNavigationSurface() {}, constrainPaneSizes() {}, persistDesktopRestoreState() {},
    setComposerPrompt(value) { this.composerPrompt = value; },
    selectWorkspaceRoot() { assert.fail('an unregistered conversation must not switch to an unrelated workspace'); },
    persistCodingSessions() { writes.push(structuredClone(this.codingSessions)); },
    async pollAgentRun() { polling.resolve(); return result.promise; }
  });
  delete state.persistActiveCodingSessionState; // Use the real completion-time persistence method.
  const pending = f.dispatch();
  await polling.promise;
  assert.equal(f.requests[0].permissionMode, 'read_only');
  state.toggleSettingsPanel('appearance');
  assert.equal(state.activeSection, 'settings');
  state.setDesktopTheme('light');
  assert.equal(state.themePreference, 'light');
  if (finishInSettings) { result.resolve(completed()); await pending; }
  state.toggleSettingsPanel();
  assert.equal(state.activeSection, 'coding');
  assert.equal(state.permissionMode, 'read_only');
  assert.equal(state.lastRunPermissionMode, 'read_only');
  assert.equal(state.activeCodingSessionId, 'session');
  assert.equal(state.activeWorkspaceRoot, '/synthetic');
  assert.equal(state.activeThreadTurnId, state.codingSessions[0].turns.at(-1).id);
  assert.equal(state.composerPrompt, 'unfinished readonly followup');
  if (!finishInSettings) { result.resolve(completed()); await pending; }
  assert.equal(state.agentStage, 'complete', state.agentError);
  assert.equal(state.codingSessions[0].permissionMode, 'read_only');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(sessions => sessions[0].permissionMode === 'read_only'));
  const restored = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror(state.codingSessions))).sessions;
  assert.equal(restored[0].permissionMode, 'read_only', 'restart data must not contain an implicit permission upgrade');
  state.followUpDrainReadySessionIds.add('session');
  state.directFollowUpDrainTaskIds.set('session', 'second');
  await f.dispatch();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].permissionMode, 'read_only', 'the next request keeps the selected conversation permission');
});

test('queued item stays FIFO while start is pending; request identity is durable before dispatch', async () => {
  const f = fixture(), accepted = deferred();
  f.state.platformService.startAgentRun = async request => { f.requests.push(request); return accepted.promise; };
  const pending = f.dispatch();
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.queue().map(t => t.id), ['first', 'second']);
  const checkpoint = f.persisted.at(-1)[0];
  assert.equal(checkpoint.followUpQueue[0].dispatch.requestId, f.requests[0].queuedRequestId);
  assert.equal(checkpoint.followUpQueue[0].dispatch.turnId, checkpoint.turns.at(-1).id);
  accepted.resolve({ runId: 'run-accepted' }); await pending;
  assert.deepEqual(f.queue().map(t => t.id), ['second']);
  const commit = f.persisted.at(-1)[0];
  assert.equal(commit.turns.at(-1).agentRootRunId, 'run-accepted');
  assert.deepEqual(commit.followUpQueue.map(t => t.id), ['second']);
  assert.equal(f.state.agentStage, 'complete', f.state.agentError);
  f.flushTimers(); assert.deepEqual(f.drains, ['session']);
});

test('a conversation whose queue became ready while another conversation ran drains when that run finishes', async () => {
  // e.g. a persistent goal continuation in a background conversation
  const f = fixture();
  f.state.followUpDrainReadySessionIds.add('goal-owner');
  await f.dispatch(); f.flushTimers();
  assert.deepEqual(f.drains, ['session', 'goal-owner']);
});

test('explicit start rejection and preflight cancellation retain the original FIFO without replay', async () => {
  for (const reason of ['credential invalid', 'model invalid', 'INSUFFICIENT_BALANCE']) {
    const f = fixture(); f.state.platformService.startAgentRun = async request => { f.requests.push(request); throw new Error(reason); };
    f.state.platformService.getQueuedAgentSubmission = async () => ({ state: 'rejected' });
    await f.dispatch(); f.flushTimers();
    assert.deepEqual(f.queue().map(t => t.id), ['first', 'second']);
    assert.equal(f.queue()[0].dispatch, undefined); assert.ok(f.queue()[0].error);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.drains, []);
  }
  const cancelled = fixture(); cancelled.state.prepareAgentSkills = async () => { cancelled.state.agentCancelRequested = true; return []; };
  await cancelled.dispatch(); cancelled.flushTimers();
  assert.equal(cancelled.requests.length, 0); assert.deepEqual(cancelled.queue().map(t => t.id), ['first', 'second']);
  assert.deepEqual(cancelled.drains, []);
});

test('persistence failure stops before the paid request and keeps the message', async () => {
  const f = fixture(); f.state.flushConversationHistory = async () => { f.state.conversationHistoryPersistDirty = true; };
  await f.dispatch(); f.flushTimers();
  assert.equal(f.requests.length, 0); assert.deepEqual(f.queue().map(t => t.id), ['first', 'second']);
  assert.equal(f.queue()[0].dispatch, undefined); assert.deepEqual(f.drains, []);
});

test('lost start ACK reconciles accepted identity and polls once without posting again', async () => {
  const f = fixture(); f.state.platformService.startAgentRun = async request => { f.requests.push(request); throw new Error('RPC lost'); };
  f.state.platformService.getQueuedAgentSubmission = async (_session, requestId) => {
    assert.equal(requestId, f.requests[0].queuedRequestId); return { state: 'accepted', runId: 'run-accepted' };
  };
  await f.dispatch(); assert.equal(f.requests.length, 1); assert.deepEqual(f.queue().map(t => t.id), ['second']);
});

test('unknown ACK remains durable and a later user check never starts another run', async () => {
  const f = fixture(); f.state.platformService.startAgentRun = async request => { f.requests.push(request); throw new Error('RPC lost'); };
  await f.dispatch(); f.flushTimers();
  assert.deepEqual(f.queue().map(t => t.id), ['first', 'second']);
  assert.equal(f.queue()[0].dispatch.state, 'unknown'); assert.deepEqual(f.drains, []);
  const requestId = f.queue()[0].dispatch.requestId;
  const restored = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror(f.state.codingSessions))).sessions;
  assert.equal(restored[0].followUpQueue[0].dispatch.requestId, requestId);
  f.state.directFollowUpDrainTaskIds.set('session', 'first'); f.state.followUpDrainReadySessionIds.add('session');
  f.state.platformService.getQueuedAgentSubmission = async () => ({ state: 'accepted', runId: 'run-accepted' });
  await f.dispatch(); assert.equal(f.requests.length, 1); assert.deepEqual(f.queue().map(t => t.id), ['second']);
  assert.equal(f.state.codingSessions[0].turns.length, 2, 'reconcile reuses the existing turn');
});

test('cancel, pause, failed polling and unproven errors do not release or replay accepted tasks', async () => {
  for (const [status, stopReason] of [['cancelled', 'cancel_requested'], ['paused', 'pause_requested'], ['limit_reached', 'turn_limit_reached']]) {
    const f = fixture(); f.state.pollAgentRun = async () => completed(status, stopReason);
    await f.dispatch(); f.flushTimers(); assert.deepEqual(f.queue().map(t => t.id), ['second']); assert.deepEqual(f.drains, []);
  }
  for (const code of ['MODEL_AUTH', 'MODEL_UNAVAILABLE', 'INSUFFICIENT_BALANCE', 'BILLING_TRANSPORT_UNKNOWN']) {
    const f = fixture(); f.state.pollAgentRun = async () => ({ runId: 'run-accepted', status: 'error', pendingMessages: [], error: { code, message: code } });
    await f.dispatch(); f.flushTimers(); assert.deepEqual(f.queue().map(t => t.id), ['second']); assert.deepEqual(f.drains, []);
  }
  const f = fixture(); f.state.pollAgentRun = async () => { throw new Error('poll offline'); };
  await f.dispatch(); f.flushTimers(); assert.equal(f.requests.length, 1); assert.deepEqual(f.queue().map(t => t.id), ['second']); assert.deepEqual(f.drains, []);
});

test('a proven unbilled rejection restores the original FIFO and only explicit retry gets a new request identity', async () => {
  for (const code of ['MODEL_AUTH', 'MODEL_UNAVAILABLE', 'INSUFFICIENT_BALANCE']) {
    const f = fixture(); f.state.pollAgentRun = async () => ({ runId: 'run-accepted', status: 'error', pendingMessages: [],
      error: { code, message: code, queuedSubmissionRejected: true } });
    await f.dispatch(); f.flushTimers();
    assert.deepEqual(f.queue().map(t => t.id), ['first', 'second'], code);
    assert.equal(f.queue()[0].dispatch, undefined); assert.deepEqual(f.drains, []);
    const originalRequestId = f.requests[0].queuedRequestId;
    f.state.followUpDrainReadySessionIds.add('session'); await f.dispatch();
    assert.equal(f.requests.length, 1, 'a rejected queue item never automatically replays');
    f.state.directFollowUpDrainTaskIds.set('session', 'first'); f.state.followUpDrainReadySessionIds.add('session');
    f.state.pollAgentRun = async () => completed(); await f.dispatch();
    assert.equal(f.requests.length, 2); assert.notEqual(f.requests[1].queuedRequestId, originalRequestId);
    assert.deepEqual(f.queue().map(t => t.id), ['second']);
  }
});

test('zero-charge proof rejects accepted streams, unknown accounting, later turns and incomplete history', () => {
  for (const error of [
    { code: 'WALLET_BALANCE_INSUFFICIENT', status: 402 }, { code: 'INSUFFICIENT_BALANCE', status: 402 },
    { code: 'AUTH_FAILED', httpStatus: 401, stage: 'response', retrySafe: false },
    { code: 'MODEL_NOT_FOUND', httpStatus: 404, stage: 'response', retrySafe: false }, { code: 'API_KEY_MISSING' },
    { code: 'UPSTREAM_CREDENTIAL_INVALID', status: 502 }, { code: 'UPSTREAM_MODEL_UNSUPPORTED', status: 502 },
    { code: 'UPSTREAM_BALANCE_UNAVAILABLE', status: 503 }
  ]) assert.equal(queuedModelRequestWasRejected(error), true, error.code);
  for (const details of [{ retrySafe: false }, { providerAccepted: true }, { usageKnown: true }, { usageKnown: false },
    { partial: true }, { acceptanceUnknown: true }, { recoveryMode: 'billing_review' }, { stage: 'stream' }]) {
    assert.equal(queuedModelRequestWasRejected({ code: 'WALLET_BALANCE_INSUFFICIENT', status: 402, ...details }), false);
  }
  assert.equal(queuedModelRequestWasRejected({ code: 'BILLING_TRANSPORT_UNKNOWN', status: 402 }), false);
  assert.equal(queuedModelRequestWasRejected({ code: 'MODEL_UNAVAILABLE', status: 503 }), false);
  const events = [{ type: 'backend_selected', backendId: 'builtin', attempt: 1 }, { type: 'model_started', turn: 1 },
    { type: 'model_phase', turn: 1, phase: 'failed' }, { type: 'model_attempt_completed', turn: 1, attempt: 1, outcome: 'failed' }];
  assert.equal(queuedRunHasNoAcceptedWork({ firstEventIndex: 0, events }), true);
  assert.equal(queuedRunHasNoAcceptedWork({ firstEventIndex: 1, events }), false);
  for (const event of [{ type: 'model_phase', turn: 1, phase: 'thinking' }, { type: 'model_completed', turn: 1 },
    { type: 'assistant_delta', turn: 1, delta: 'paid output' }, { type: 'tool_started', turn: 1 },
    { type: 'model_started', turn: 2 }, { type: 'backend_selected', backendId: 'acp:test', attempt: 1 }]) {
    assert.equal(queuedRunHasNoAcceptedWork({ firstEventIndex: 0, events: [...events, event] }), false);
  }
});

test('actual managed callback distinguishes upfront balance refusal from already accepted or metered failure', async () => {
  const source = readFileSync(join(src, 'node/nextmux-platform-service.ts'), 'utf8');
  const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true), candidates = [];
  const visit = node => { if (ts.isArrowFunction(node) && node.getText(file).includes('const attemptId = `managed-${randomUUID()}`')) candidates.push(node); ts.forEachChild(node, visit); };
  visit(file); assert.equal(candidates.length, 1);
  const errorClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PlatformRequestError');
  assert.ok(errorClass);
  const PlatformRequestError = new Function('classifyModelError', 'domainMessageFromError', 'mediaMessageText', 'managedPricingWaitEvidence',
    ts.transpile(`${errorClass.getText(file)}; return PlatformRequestError;`, { target: ts.ScriptTarget.ES2022 }))(
      classifyModelError, domainMessageFromError, mediaMessageText, load(join(src, 'node/nextmux-managed-pricing-wait.ts')).managedPricingWaitEvidence);
  const factory = new Function('PlatformRequestError', 'queuedModelRequestWasRejected', 'randomUUID', 'normalizeModelSwitchPolicyForDispatch',
    'estimateManagedGatewayInputTokens', 'messagesWithToolImages', 'wasPreviouslyCalled', 'localManagedOutputMessages', ts.transpile(`
    const rejections = [], execution = { onQueuedRequestRejected: value => rejections.push(value) };
    const request = { workbench: 'coding' }, managedRoute = {}, initialSwitchPolicy = {}, conversationId = 'synthetic';
    const stateConversationId = 'synthetic', backendRunId = 'synthetic-run';
    let modelCalled = wasPreviouslyCalled;
    let pendingManagedReceipt;
    const complete = ${candidates[0].getText(file)}; return { complete, rejections };
  `, { target: ts.ScriptTarget.ES2022 }));
  for (const [accepted, metered, previous] of [[false, false, false], [true, false, false], [false, true, false], [false, false, true]]) {
    const seam = factory.call({ contextLimitsForRequest: () => ({}), nextmuxDataRoot: () => '/synthetic', localConversationDataRoot: () => '/synthetic',
      async completeManagedGatewayWithEvents(_route, _payload, _id, _signal, handlers) {
        if (accepted) await handlers.onProviderEvent({ type: 'response.started' });
        throw new PlatformRequestError('wallet_balance_insufficient', 'not funded', 402, undefined,
          metered ? { providerAccepted: true, usageKnown: true } : {});
      }
    }, PlatformRequestError, queuedModelRequestWasRejected, randomUUID, () => ({}), () => 1,
    messages => messages.map(message => ({ message })), previous, async (_root, _owner, messages) => messages);
    await assert.rejects(seam.complete({ messages: [], tools: [], instructions: '' }), /not funded/);
    assert.deepEqual(seam.rejections, [false, !(accepted || metered || previous)]);
  }
});

test('durable receipts prevent duplicate execution across concurrent requests and restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-queue-receipt-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new QueuedSubmissionStore(root), accepted = deferred(); let starts = 0;
  const request = { prompt: 'synthetic private prompt', secret: 'synthetic-key' };
  const pending = store.dispatch('session', 'request-0001', request, async accept => {
    starts++; await accepted.promise; await accept({ runId: 'run-receipt' }); return { runId: 'run-receipt' };
  });
  while (!starts) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(store.dispatch('session', 'request-0001', request, async () => { starts++; }), /PENDING/);
  assert.deepEqual(await store.lookup('session', 'request-0001'), { state: 'pending' });
  accepted.resolve(); assert.deepEqual(await pending, { runId: 'run-receipt' });
  const reopened = new QueuedSubmissionStore(root);
  assert.deepEqual(await reopened.dispatch('session', 'request-0001', request, async () => { starts++; }), { runId: 'run-receipt' });
  assert.equal(starts, 1);
  assert.deepEqual(await reopened.lookup('other-session', 'request-0001'), { state: 'unknown' });
  await assert.rejects(reopened.dispatch('session', 'request-0001', { prompt: 'changed' }, async () => {}), /CONFLICT/);
  const bytes = await readFile(join(root, (await readdir(root))[0]), 'utf8');
  assert.doesNotMatch(bytes, /synthetic private prompt|synthetic-key/);
});

test('receipt lookup distinguishes definite rejection from unknown and never runs a model', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-queue-reject-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new QueuedSubmissionStore(root);
  assert.deepEqual(await store.lookup('session', 'request-missing'), { state: 'unknown' });
  await assert.rejects(store.dispatch('session', 'request-reject', {}, async () => { throw new Error('invalid route'); }), /invalid route/);
  assert.deepEqual(await store.lookup('session', 'request-reject'), { state: 'rejected' });
  await assert.rejects(store.dispatch('session', 'request-reject', {}, async () => { assert.fail('cannot replay a rejection'); }), /REJECTED/);
  await assert.rejects(store.dispatch('session', 'request-after-accept', {}, async accept => {
    await accept({ runId: 'run-accepted' }); throw new Error('ACK channel closed');
  }), /ACK channel closed/);
  assert.deepEqual(await store.lookup('session', 'request-after-accept'), { state: 'accepted', runId: 'run-accepted' });
});

test('actual backend start commits acceptance before executing and duplicate RPCs share the run', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-queue-service-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = readFileSync(join(src, 'node/nextmux-platform-service.ts'), 'utf8');
  const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true), found = [];
  const visit = node => { if (ts.isMethodDeclaration(node) && ['startAgentRun', 'startAgentRunForProject', 'getQueuedAgentSubmission'].includes(node.name.getText(ast))) found.push(node.getText(ast)); ts.forEachChild(node, visit); };
  visit(ast); assert.equal(found.length, 3);
  const dependencies = { QueuedSubmissionStore, queuedModelRequestWasRejected, queuedRunHasNoAcceptedWork, withDesktopPowerSaveBlocker, join, randomUUID, stat, scheduleDomainMessage,
    AgentUserInputBroker: class {}, AgentEventBuffer: load(join(src, 'node/nextmux-agent-event-buffer.ts')).AgentEventBuffer,
    AgentRunJournalError: class extends Error {}, PlatformRequestError: class extends Error {
      constructor(code, message, _status, _retryAfterMs, details = {}) { super(message); this.code = code; this.data = details; }
    },
    AGENT_JOB_MAX_ENTRIES: 96, AGENT_JOB_MAX_EVENTS: 100, AGENT_JOB_MAX_EVENT_CHARACTERS: 1000 };
  const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${found.join('\n')} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022
  }))(...Object.values(dependencies));
  const service = new Harness(), checkpoints = []; let starts = 0;
  Object.assign(service, { agentJobs: new Map(), nextmuxDataRoot: () => root, localConversationDataRoot: () => root,
    incognitoSessions: () => ({ holdRunPreparation: () => () => {}, bindRun() {} }), holdProjectRun: () => () => {},
    assertConversationNotDeleted: async () => {}, pruneAgentJobs() {},
    async acquireAgentCheckpointRunLeases() { return { assertOwned() {}, async release() {} }; },
    agentRunJournalStore: () => ({ async save(record) { checkpoints.push(record); } }),
    async executeAgentRun(request, execution) {
      const receipt = await this.getQueuedAgentSubmission(request.conversationId, request.queuedRequestId);
      assert.deepEqual(receipt, { state: 'accepted', runId: execution.runId });
      starts++;
      return new Promise(() => {}); // No external work, intentionally live for the duplicate probe.
    }
  });
  const request = { queuedRequestId: 'request-service', conversationId: 'session', workspaceRoot: root,
    workbench: 'coding', route: { kind: 'official_connection' }, prompt: 'synthetic', permissionMode: 'workspace_write' };
  const file = join(root, 'not-directory'); await writeFile(file, 'test');
  for (const workspaceRoot of [join(root, 'missing-project'), file]) {
    const queuedRequestId = workspaceRoot === file ? 'request-file-root' : 'request-missing-root';
    await assert.rejects(service.startAgentRun({ ...request, queuedRequestId, workspaceRoot }), error => {
      assert.equal(error.code, 'WORKSPACE_UNAVAILABLE');
      assert.equal(error.data?.domainError?.code, 'SCHEDULE_WORKSPACE_UNAVAILABLE');
      return true;
    });
    assert.deepEqual(await service.getQueuedAgentSubmission('session', queuedRequestId), { state: 'rejected' });
  }
  assert.equal(checkpoints.length, 0); assert.equal(starts, 0); assert.equal(service.agentJobs.size, 0);
  const first = await service.startAgentRun(request);
  const second = await service.startAgentRun(request);
  while (!starts) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(first, second); assert.equal(starts, 1); assert.equal(checkpoints.length, 1);
  service.agentRunJournalStore = () => ({ async save() { throw new Error('disk unavailable'); } });
  await assert.rejects(service.startAgentRun({ ...request, queuedRequestId: 'request-store-failed' }), /disk unavailable/);
  assert.deepEqual(await service.getQueuedAgentSubmission('session', 'request-store-failed'), { state: 'rejected' });
  assert.equal(starts, 1);
  Object.assign(service, {
    agentRunJournalStore: () => ({ async save() {} }),
    stableAgentRunError: error => ({ code: error.code, message: error.message, kind: 'failed', retryable: false, resumable: false }),
    terminalAgentStatus: () => 'error', flushAgentDelegationLedger: async () => {}, clearAgentJobRecovery: async () => {}, wakeAgentJob() {},
    appendAgentJobEvent: (job, event) => job.events.append(event)
  });
  for (const accepted of [false, true]) {
    service.executeAgentRun = async (_request, execution) => {
      execution.onQueuedRequestRejected(true);
      if (accepted) execution.onEvent({ type: 'model_phase', phase: 'thinking', turn: 1 });
      throw Object.assign(new Error('unfunded'), { code: 'WALLET_BALANCE_INSUFFICIENT' });
    };
    const queuedRequestId = `request-balance-${accepted}`;
    const result = await service.startAgentRun({ ...request, queuedRequestId });
    const job = service.agentJobs.get(result.runId); await job.completion;
    assert.equal(job.error.queuedSubmissionRejected, accepted ? undefined : true);
    assert.deepEqual(await service.getQueuedAgentSubmission('session', queuedRequestId), { state: 'accepted', runId: result.runId },
      'the original local acceptance receipt never becomes permission to rerun the same request');
  }
});

test('active work, questions, approvals, compaction and retry never dequeue a message', async () => {
  for (const stage of ['running', 'paused', 'cancelled', 'error']) {
    const f = fixture(); f.state.agentStage = stage;
    f.state.codingSessions[0].turns[0] = { id: 'previous', stage, stopReason: stage === 'cancelled' ? 'cancel_requested' : undefined };
    await f.dispatch(); assert.equal(f.requests.length, 0, stage); assert.equal(f.queue().length, 2);
  }
  for (const phase of ['thinking', 'tool_wait', 'awaitquestion', 'approval', 'compaction', 'retry']) {
    const f = fixture(); f.state.activeAgentRunId = 'run-current'; f.state.agentStage = 'running';
    f.state.liveAgentEvents = [{ type: phase }]; await f.dispatch();
    assert.equal(f.requests.length, 0, phase); assert.equal(f.queue().length, 2);
  }
});


test('queued reasoning controls keep one immutable snapshot through dispatch, history and returned messages', async () => {
  const f = fixture();
  const settings = { reasoningBudgetTokens: 2048, reasoningEnabled: false };
  f.state.recordSteeringMessage = () => {};
  f.state.modelKeyForRoute = () => 'fixture/model';
  f.state.modelDisplayName = value => value;
  f.queue()[0].reasoningSettings = settings;
  f.state.modelReasoningContract = () => ({ reasoningControls: [
    { type: 'budget', parameter: 'thinking.budget_tokens', min: 1024, max: 4096, support: 'supported', source: 'provider_metadata', scope: 'route' },
    { type: 'on-off', parameter: 'enable_thinking', values: [true, false], support: 'supported', source: 'provider_metadata', scope: 'route' }
  ] });
  f.state.prepareAgentSkills = async () => { settings.reasoningBudgetTokens = 4096; settings.reasoningEnabled = true; return []; };
  f.state.pollAgentRun = async () => ({ ...completed(), pendingMessages: [{ id: 'steer-settings', content: 'Continue with the same controls', createdAt: new Date(1).toISOString() }] });
  await f.dispatch();
  assert.equal(f.requests.length, 1, f.state.agentError);
  assert.equal(f.requests[0].reasoningBudgetTokens, 2048); assert.equal(f.requests[0].reasoningEnabled, false);
  const expected = { reasoningBudgetTokens: 2048, reasoningEnabled: false };
  assert.deepEqual(f.state.codingSessions[0].turns.at(-1).reasoningSettings, expected);
  const restored = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror(f.state.codingSessions))).sessions;
  assert.deepEqual(restored[0].turns.at(-1).reasoningSettings, expected);
  assert.equal(f.state.agentStage, 'complete', f.state.agentError);
  assert.deepEqual(f.queue().find(task => task.id === 'steer-settings').reasoningSettings, expected);
});


function concurrentFixture() {
  const f = fixture(), state = f.state;
  const { createConversationAgentRun, conversationAgentRunActive } = load(join(src, 'browser/nextmux-conversation-agent-run.ts'));
  const runs = new Map(), pending = new Map(), cancellations = [];
  state.conversationAgentRuns = runs;
  state.conversationAgentRun = function(id = this.activeCodingSessionId || '') {
    if (!runs.has(id)) runs.set(id, createConversationAgentRun(id));
    return runs.get(id);
  };
  state.conversationHasActiveRun = id => conversationAgentRunActive(runs.get(id));
  for (const name of Object.keys(createConversationAgentRun(''))) {
    if (['submitting', 'completion'].includes(name)) continue;
    delete state[name];
    Object.defineProperty(state, name, { configurable: true,
      get() { return this.conversationAgentRun()[name]; }, set(value) { this.conversationAgentRun()[name] = value; } });
  }
  delete state.submitPrompt; delete state.pollAgentRun; delete state.capturePromptSubmission;
  Object.assign(state, {
    scheduledAgentRuns: new Map(), scheduledTasks: [], runningScheduledTaskIds: new Set(), pendingAgentSubmissions: new Set(),
    prompt: '', attachments: [], pastedTextReferences: [], editedTurnAttachmentOrder: [],
    activeModelRouteId: route.id, activeRelayKey: 'official', composerApps: new Map(), unpersistedPastedTextReferences: new Map(),
    setComposerPrompt(value) { this.prompt = value; },
    persistComposerDraft() { this.codingSessions = this.codingSessions.map(owner => owner.id === this.activeCodingSessionId ? { ...owner, draftPrompt: this.prompt, draftAttachments: this.attachments.map(item => ({ id: item.id })), draftPastedTextReferences: '[]' } : owner); },
    hasPendingAttachmentImports: () => false, hasUnresolvedDraftAttachments: () => false,
    codingSessionWorkspaceRoot: session => session?.workspacePath || '/synthetic',
    recordSteeringMessage() {}, activePastedTextReferences: () => [], composerApp() {},
    recordLocalReasoningEvidence() {}, addNotification() {},
  });
  state.platformService.startAgentRun = async request => {
    f.requests.push(request); const id = `agent-${request.conversationId}-${f.requests.length}`;
    pending.set(id, deferred()); return { runId: id };
  };
  state.platformService.getAgentRunSnapshot = async runId => pending.get(runId).promise;
  state.platformService.cancelAgentRun = async runId => { cancellations.push(runId); finish(runId, 'cancelled'); };
  const finish = (id, status = 'completed') => {
    const snapshot = completed(status, status === 'cancelled' ? 'cancel_requested' : 'completed');
    snapshot.runId = id; snapshot.firstEventIndex = 0; snapshot.nextEventIndex = 1; snapshot.updatedAt = Date.now();
    snapshot.events = [{ type: 'assistant_progress', turn: 1, content: id, at: new Date().toISOString() }];
    snapshot.result.finalText = `response:${id}`; pending.get(id).resolve(snapshot);
  };
  return { ...f, runs, pending, finish, cancellations };
}
const nextTick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await nextTick(); } assert.fail('expected asynchronous boundary was not reached'); }

for (const sameDirectory of [true, false]) test(`real widget submission/polling runs two conversations independently (${sameDirectory ? 'same' : 'different'} directory)`, async () => {
  const f = concurrentFixture(), s = f.state;
  const a = s.codingSessions[0];
  const b = { ...structuredClone(a), id: 'session-b', workspacePath: sameDirectory ? a.workspacePath : '/other', followUpQueue: [] };
  s.codingSessions.push(b);
  const taskA = a.followUpQueue[0], taskB = { ...task('b-first'), sessionId: b.id };
  s.codingSessions[1].followUpQueue = [taskB];
  const runA = s.submitPrompt('coding', { task: taskA, session: a, route, attachments: [] });
  await until(() => f.requests.length === 1);
  s.activeCodingSessionId = b.id;
  const runB = s.submitPrompt('coding', { task: taskB, session: b, route, attachments: [] });
  await until(() => f.requests.length === 2);
  const aState = f.runs.get(a.id), bState = f.runs.get(b.id);
  assert.equal(aState.agentStage, 'running'); assert.equal(bState.agentStage, 'running');
  assert.notEqual(aState.activeAgentRunId, bState.activeAgentRunId);
  assert.equal(f.requests[0].workspaceRoot, a.workspacePath); assert.equal(f.requests[1].workspaceRoot, b.workspacePath);
  const aId = aState.activeAgentRunId, bId = bState.activeAgentRunId;
  await s.stopConversationAgentRun(a.id, true);
  await runA;
  assert.deepEqual(f.cancellations, [aId]);
  assert.equal(bState.activeAgentRunId, bId); assert.equal(bState.agentStage, 'running');
  assert.equal(s.agentStage, 'running', 'background completion must not reset the selected running tab');
  f.finish(bId); await runB;
  const aTurn = s.codingSessions[0].turns.at(-1), bTurn = s.codingSessions[1].turns.at(-1);
  assert.equal(aTurn.stage, 'cancelled'); assert.equal(bTurn.stage, 'complete');
  assert.equal(bTurn.response, `response:${bId}`);
  assert.ok(bTurn.events.every(event => !event.content?.includes(aId)), 'event journals must never cross conversations');
  assert.equal(s.pendingAgentSubmissions.size, 0);
});

test('a conversation drains its next queued task while another conversation remains running', async () => {
  const f = concurrentFixture(), s = f.state, a = s.codingSessions[0];
  const b = { ...structuredClone(a), id: 'session-b', followUpQueue: [] };
  const bTask = { ...task('b'), sessionId: b.id }; b.followUpQueue = [bTask]; s.codingSessions.push(b);
  const first = s.drainFollowUpQueue(a.id); await until(() => f.requests.length === 1);
  s.activeCodingSessionId = b.id;
  const other = s.submitPrompt('coding', { task: bTask, session: b, route, attachments: [] });
  await until(() => f.requests.length === 2);
  f.finish(f.runs.get(a.id).activeAgentRunId); await first;
  s.followUpDrainReadySessionIds.add(a.id);
  const second = s.drainFollowUpQueue(a.id); await until(() => f.requests.length === 3);
  assert.deepEqual(f.requests.map(request => request.conversationId), [a.id, b.id, a.id]);
  assert.equal(f.runs.get(b.id).agentStage, 'running');
  f.finish(f.runs.get(a.id).activeAgentRunId); f.finish(f.runs.get(b.id).activeAgentRunId);
  await Promise.all([second, other]);
});

test('stop-and-join covers the preflight claim without dispatching a late model request', async () => {
  const f = concurrentFixture(), s = f.state, gate = deferred();
  // The real submission wrapper owns a completion before execute/preparation yields.
  s.executePromptSubmission = async () => { await gate.promise; assert.equal(s.conversationAgentRun('session').agentCancelRequested, true); return false; };
  const pending = s.submitPrompt('coding', { task: task('first'), session: s.codingSessions[0], route, attachments: [] });
  let joined = false;
  const stopping = s.stopConversationAgentRun('session', true).then(() => { joined = true; });
  await nextTick(); assert.equal(joined, false);
  gate.resolve(); await Promise.all([pending, stopping]);
  assert.equal(joined, true); assert.equal(f.requests.length, 0);
});


for (const boundary of ['claim', 'skills', 'catalog']) test(`clicked request keeps owner, API, permissions and attachments through ${boundary} preparation while another chat starts`, async () => {
  const f = concurrentFixture(), s = f.state, gate = deferred();
  const routeA = { ...route, id: boundary === 'catalog' ? 'managed:a-catalog' : 'route-a', connection: { ...route.connection, id: 'api-a', model: 'model-a' } };
  const routeB = { ...route, id: 'route-b', connection: { ...route.connection, id: 'api-b', model: 'model-b' } };
  const a = s.codingSessions[0]; a.followUpQueue = []; a.permissionMode = 'read_only';
  const b = { ...structuredClone(a), id: 'session-b', workspacePath: '/other', permissionMode: 'workspace_write', followUpQueue: [] };
  s.codingSessions.push(b);
  s.modelRoutes = () => boundary === 'catalog' && !s.catalogReady ? [routeB] : [routeA, routeB];
  s.routesForRelay = () => [routeA, routeB];
  s.reasoningEffortForRoute = selected => selected?.id === routeB.id ? 'high' : 'low';
  s.reasoningSettingsForRoute = selected => ({ reasoningEnabled: selected?.id === routeB.id });
  s.selectedTerminalProfile = () => ({ id: s.activeCodingSessionId === a.id ? 'terminal-a' : 'terminal-b' });
  if (boundary === 'claim') {
    s.conversationWindowReady = true;
    f.window.nextmuxDesktop = { claimConversationRun: async (id, release) => release || id !== a.id ? true : gate.promise };
  }
  if (boundary === 'skills') s.skillService.ready = gate.promise;
  if (boundary === 'catalog') s.waitForCatalogRoute = async (_workbench, id, _timeout, relayKey) => {
    assert.equal(id, routeA.id); assert.equal(relayKey, 'official:a'); await gate.promise; s.catalogReady = true;
  };
  s.prompt = 'PROMPT_A'; s.activeModelRouteId = routeA.id; s.activeRelayKey = 'official:a'; s.permissionMode = 'read_only';
  s.attachments = [{ id: 'attachment-a', size: 1, attachment: { kind: 'text', name: 'a.txt', content: 'ATTACHMENT_A' } }];
  const first = s.submitPrompt('coding');
  await nextTick(); assert.equal(f.requests.length, 0, 'A is held at the chosen preflight boundary');
  s.activeCodingSessionId = b.id; s.prompt = 'PROMPT_B'; s.activeModelRouteId = routeB.id; s.activeRelayKey = 'official:b'; s.permissionMode = 'workspace_write';
  s.attachments = [{ id: 'attachment-b', size: 1, attachment: { kind: 'text', name: 'b.txt', content: 'ATTACHMENT_B' } }];
  s.skillService.ready = Promise.resolve();
  const second = s.submitPrompt('coding');
  await until(() => f.requests.length === 1);
  assert.equal(f.requests[0].conversationId, b.id);
  s.prompt = 'KEEP_NEW_B_DRAFT'; s.attachments = []; s.persistComposerDraft();
  gate.resolve(true);
  await until(() => f.requests.length === 2);
  const reqA = f.requests.find(request => request.conversationId === a.id), reqB = f.requests.find(request => request.conversationId === b.id);
  assert.equal(reqA.prompt, 'PROMPT_A'); assert.equal(reqB.prompt, 'PROMPT_B');
  assert.equal(reqA.route.connectionId, 'api-a'); assert.equal(reqB.route.connectionId, 'api-b');
  assert.equal(reqA.permissionMode, 'read_only'); assert.equal(reqB.permissionMode, 'workspace_write');
  assert.equal(reqA.reasoningEffort, 'low'); assert.equal(reqB.reasoningEffort, 'high');
  assert.equal(reqA.terminalProfileId, 'terminal-a'); assert.equal(reqB.terminalProfileId, 'terminal-b');
  assert.deepEqual(reqA.attachments.map(item => item.content), ['ATTACHMENT_A']);
  assert.deepEqual(reqB.attachments.map(item => item.content), ['ATTACHMENT_B']);
  assert.equal(s.prompt, 'KEEP_NEW_B_DRAFT', 'finishing A preparation must not erase the visible B draft');
  assert.equal(s.codingSessions.find(owner => owner.id === a.id).draftPrompt, undefined);
  for (const run of f.runs.values()) if (run.activeAgentRunId) f.finish(run.activeAgentRunId);
  await Promise.all([first, second]);
});

test('editing the owner draft during preflight keeps the new text and never submits its stale payload', async () => {
  const f = concurrentFixture(), s = f.state, gate = deferred();
  s.prompt = 'ORIGINAL'; s.skillService.ready = gate.promise;
  const pending = s.submitPrompt('coding'); await nextTick();
  s.prompt = 'CHANGED_DRAFT'; s.persistComposerDraft(); gate.resolve();
  assert.equal(await pending, false); assert.equal(f.requests.length, 0); assert.equal(s.prompt, 'CHANGED_DRAFT');
});

test('attachment-only submission never borrows another conversation text during claim', async () => {
  const f = concurrentFixture(), s = f.state, gate = deferred();
  const owner = s.codingSessions[0]; owner.followUpQueue = [];
  s.prompt = ''; s.attachments = [{ id: 'attachment-only', size: 1, attachment: { kind: 'text', name: 'a.txt', content: 'ONLY_A' } }];
  s.conversationWindowReady = true;
  f.window.nextmuxDesktop = { claimConversationRun: async (_id, release) => release ? true : gate.promise };
  const first = s.submitPrompt('coding'); await nextTick();
  s.codingSessions.push({ ...structuredClone(owner), id: 'session-b', workspacePath: '/other', turns: [], followUpQueue: [] });
  s.activeCodingSessionId = 'session-b'; s.prompt = 'UNSENT_B'; s.attachments = []; s.persistComposerDraft();
  gate.resolve(true); await until(() => f.requests.length === 1);
  assert.equal(f.requests[0].prompt, ''); assert.equal(f.requests[0].conversationId, owner.id);
  assert.deepEqual(f.requests[0].attachments.map(item => item.content), ['ONLY_A']);
  assert.equal(s.prompt, 'UNSENT_B');
  f.finish(f.runs.get(owner.id).activeAgentRunId); await first;
});


for (const switchConversation of [false, true]) test(`cold fixed merchant route reaches actual submit/start without opening picker (switch=${switchConversation})`, async () => {
  const f = concurrentFixture(), s = f.state, gate = deferred(), calls = [];
  const a = s.codingSessions[0]; a.followUpQueue = []; a.permissionMode = 'read_only';
  a.routeId = 'managed:fixed:saved-a'; a.reasoningEffort = 'high'; a.reasoningSettings = { reasoningBudgetTokens: 8192, reasoningExclude: true };
  Object.assign(s, {
    savedFixedOfferings: new Map(), savedFixedOfferingRequests: new Map(), savedFixedOfferingRevision: 0,
    platformSession: { user: { id: 'owner' }, linked: true }, catalogSnapshotRevision: 1, catalogRemovedMerchants: new Set(), merchantPickerSnapshots: new Map(),
    activeModelRouteId: 'managed:fixed:saved-a', activeRelayKey: 'managed:merchant-a', prompt: 'COLD_A', permissionMode: 'read_only',
    offeringMerchantId: offering => offering.merchantId, offeringMeetsPrivacy: () => true,
    modelReasoningContract: () => ({ reasoningControls: [{ type: 'budget', parameter: 'thinking.budget_tokens', support: 'supported', min: 1024, max: 20000 }] }),
    routesForRelay(relay) { return relay === 'managed:merchant-a' ? this.managedModelRoutes('coding', false, 'merchant-a') : [route]; },
    modelRoutes() { return this.routesForRelay(this.activeRelayKey); },
    activeModelRoute() { return this.modelRoutes().find(candidate => candidate.id === this.activeModelRouteId); }
  });
  s.platformService.getCatalogOffering = id => { calls.push(id); return gate.promise; };
  f.window.setTimeout = fn => { setImmediate(fn); return 1; };
  // Restore prefetch and send are the same single offering request.
  const prefetch = s.loadSavedFixedOffering(s.activeRelayKey, s.activeModelRouteId);
  const first = s.submitPrompt('coding'); await nextTick(); assert.equal(f.requests.length, 0);
  let second;
  if (switchConversation) {
    s.codingSessions.push({ ...structuredClone(a), id: 'B', workspacePath: '/other', turns: [], followUpQueue: [], permissionMode: 'workspace_write' });
    s.activeCodingSessionId = 'B'; s.activeRelayKey = 'official:b'; s.activeModelRouteId = route.id; s.prompt = 'B_PROMPT'; s.permissionMode = 'workspace_write';
    second = s.submitPrompt('coding'); await until(() => f.requests.length === 1);
    assert.equal(f.requests[0].conversationId, 'B'); s.prompt = 'KEEP_B'; s.persistComposerDraft();
  }
  gate.resolve({ id: 'saved-a', merchantId: 'merchant-a', status: 'active', workbenches: ['coding'], input: ['text'], output: ['text'], capabilities: ['coding', 'tools'] });
  await prefetch; await until(() => f.requests.length === (switchConversation ? 2 : 1));
  const reqA = f.requests.find(request => request.conversationId === a.id);
  assert.equal(reqA.reasoningEffort, 'high'); assert.equal(reqA.reasoningBudgetTokens, 8192);
  assert.equal(reqA.reasoningExclude, undefined, 'stored unsupported settings are still filtered by actual route contract');
  assert.equal(reqA.prompt, 'COLD_A'); assert.equal(reqA.permissionMode, 'read_only'); assert.equal(reqA.route.kind, 'managed_gateway');
  assert.deepEqual(calls, ['saved-a']); assert.equal(s.merchantPickerSnapshots.size, 0);
  if (switchConversation) { assert.equal(s.prompt, 'KEEP_B'); assert.equal(s.activeRelayKey, 'official:b'); }
  for (const run of f.runs.values()) if (run.activeAgentRunId) f.finish(run.activeAgentRunId);
  await Promise.all([first, second]);
});


test('missing route captures saved reasoning only for the exact owner and route, with an immutable settings copy', () => {
  const { state: s } = concurrentFixture();
  s.codingSessions[0].routeId = 'managed:fixed:saved'; s.codingSessions[0].reasoningEffort = 'high';
  s.codingSessions[0].reasoningSettings = { reasoningBudgetTokens: 8192 };
  s.modelRoutes = () => []; s.activeModelRouteId = 'managed:fixed:saved';
  const captured = s.capturePromptSubmission('session', 'coding');
  s.codingSessions[0].reasoningSettings.reasoningBudgetTokens = 2048;
  assert.equal(captured.reasoningEffort, 'high'); assert.equal(captured.reasoningSettings.reasoningBudgetTokens, 8192);
  assert.equal(s.capturePromptSubmission('other', 'coding').reasoningEffort, undefined);
  s.activeModelRouteId = 'managed:fixed:other';
  assert.equal(s.capturePromptSubmission('session', 'coding').reasoningEffort, undefined);
  assert.deepEqual(s.capturePromptSubmission('session', 'coding').reasoningSettings, {});
});
