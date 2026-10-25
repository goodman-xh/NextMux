import { modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import assert from 'node:assert/strict';
import { bindPriceQuote } from '../lib/common/nextmux-price-quote.js';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { agentPauseBlocksAutomaticDispatch, automaticResumeOwnsLatestTurn, followUpTaskBelongsToSession, removeFollowUpTask,
  restoreFollowUpTask } from '../lib/browser/nextmux-agent-task-queue.js';
import { autoResumeDecision, autoResumeDelayMs, appendAgentActivityEvents,
  userQueuedPrompts } from '../lib/browser/nextmux-agent-activity.js';
import { composerContentToken } from '../lib/browser/nextmux-composer-long-paste.js';
import { questionPausePreservesQueue } from '../lib/browser/nextmux-agent-question.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['requestFollowUpQueueDrain', 'drainFollowUpQueue', 'scheduleAutomaticResume',
  'conversationHistoryReady',
  'submitPrompt', 'continueAgentChild', 'beginApplicationExit', 'cancelApplicationExit', 'shutdownForApplicationExit'];
const methods = new Map();
const visit = node => {
  if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(file), node.getText(file));
  ts.forEachChild(node, visit);
};
visit(file);
const code = ts.transpile(`class NextMuxDesktopWidget { static AUTO_RESUME_LIMIT = 3;
  ${names.map(name => { assert.ok(methods.has(name)); return methods.get(name); }).join('\n')} }`,
{ target: ts.ScriptTarget.ES2022 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const timers = [], events = [], document = { body: { inert: false } };
  const dependencies = { modelFailureText, document, window: { setTimeout(fn) { timers.push(fn); } },
    bindPriceQuote, composerContentToken,
    agentPauseBlocksAutomaticDispatch, automaticResumeOwnsLatestTurn, followUpTaskBelongsToSession, removeFollowUpTask, restoreFollowUpTask,
    autoResumeDecision, autoResumeDelayMs, appendAgentActivityEvents, userQueuedPrompts, questionPausePreservesQueue,
    conversationAgentRunActive: run => Boolean(run?.activeAgentRunId || run?.agentStage === 'running' || run?.submitting),
    closePersistenceText: (_locale, key) => key, runningTaskText: (_locale, key) => key };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return NextMuxDesktopWidget;`)(...Object.values(dependencies));
  const state = new Harness();
  const task = { id: 'task-a', sessionId: 'session-a', source: 'user', workbench: 'coding', prompt: 'queued',
    relayKey: 'synthetic', routeId: 'synthetic', attachments: [] };
  Object.assign(state, {
    node: { inert: false, isConnected: true }, applicationExitGeneration: 0, applicationExitPreparing: false,
    conversationHistoryPersistenceReady: true, conversationHistoryLoadGeneration: 0,
    activeCodingSessionId: 'session-a', activeSection: 'coding', codingSessions: [{ id: 'session-a', turns: [], followUpQueue: [task] }],
    conversationWindows: [],
    followUpDrainReadySessionIds: new Set(), directFollowUpDrainTaskIds: new Map(), followUpQueueDraining: false,
    pendingAgentSubmissions: new Set(), automaticResumeTurnIds: new Set(), queuedAttachmentPayloads: new Map(),
    agentChildContinuationStates: new Map(), scheduledTasks: [], runningScheduledTaskIds: new Set(), scheduledAgentRuns: new Map(), scheduledTasksPersistence: Promise.resolve(),
    prompt: '', attachments: [], pastedTextReferences: [], editedTurnAttachmentOrder: [],
    pendingAttachmentImports: new Map(), hasPendingAttachmentImports() { return false; },
    pendingDraftAttachmentRestores() { return []; }, hasUnresolvedDraftAttachments() { return false; },
    activeAgentRunId: '', agentStage: 'idle', pastedTextPersistence: new Map(), pendingContextFileWrites: new Set(),
    // Queue/submission fixtures contain no file editor; capture is a verified no-op.
    captureContextEditorRecovery() { assert.equal(this.contextFilePreview, undefined); return true; },
    terminalRecords: [{ id: 'terminal-a' }], conversationHistoryPersistDirty: false,
    routesForRelay: () => [{ id: 'synthetic' }], async resolveQueuedAttachments() { return []; },
    updateFollowUpQueue(id, queue) { this.codingSessions = this.codingSessions.map(s => s.id === id ? { ...s, followUpQueue: queue } : s); return true; },
    async executePromptSubmission() { events.push('dispatch'); return true; },
    activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); },
    async resumePausedTurn() { events.push('resume'); }, updateCodingTurn() { events.push('update-turn'); },
    flushComposerDraft() { events.push('draft'); }, async flushConversationHistory() { events.push('history'); this.conversationHistoryPersistDirty = false; },
    workspaceConfigurationSaver: { async flush() { events.push('workspace'); } },
    assertApplicationExitSaved(generation) { if (generation !== this.applicationExitGeneration) throw new Error('APPLICATION_EXIT_CANCELLED'); events.push('confirmed'); },
    persistTerminalRecords() { events.push('terminals-snapshot'); }, async terminateAndDisposeConversationTerminal() { events.push('terminate'); },
    platformService: { async cancelAgentRun() { events.push('cancel'); } }, addNotification() { events.push('notice'); }, update() {},
  });
  state.conversationAgentRuns = new Map([['session-a', state]]);
  state.conversationHasActiveRun = id => id === state.activeCodingSessionId && Boolean(state.activeAgentRunId || state.agentStage === 'running');
  return { state, timers, events, document, task };
}

test('close freezes armed queue dispatch without consuming messages, then cancellation resumes it', async () => {
  const { state, events, timers, task } = fixture(); state.beginApplicationExit();
  state.requestFollowUpQueueDrain('session-a');
  await state.drainFollowUpQueue('session-a');
  assert.equal(timers.length, 0); assert.ok(state.followUpDrainReadySessionIds.has('session-a'));
  assert.deepEqual(state.codingSessions[0].followUpQueue, [task]); assert.deepEqual(events, []);
  assert.equal(await state.submitPrompt('coding'), false);
  state.cancelApplicationExit('failed'); assert.equal(timers.length, 1);
  timers.shift()(); await tick();
  assert.equal(events.filter(e => e === 'dispatch').length, 1);
  assert.deepEqual(state.codingSessions[0].followUpQueue, []);
});

test('closing during attachment preparation preserves FIFO and only retries after cancellation', async () => {
  const { state, events, timers, task } = fixture(), waiting = deferred();
  state.followUpDrainReadySessionIds.add('session-a'); state.resolveQueuedAttachments = () => waiting.promise;
  const draining = state.drainFollowUpQueue('session-a'); state.beginApplicationExit();
  waiting.resolve([]); await draining;
  assert.deepEqual(state.codingSessions[0].followUpQueue, [task]); assert.equal(events.includes('dispatch'), false);
  assert.equal(timers.length, 0); state.cancelApplicationExit('timeout');
  timers.shift()(); await tick(); assert.equal(events.filter(e => e === 'dispatch').length, 1);
});

test('a late preparation from an already-cancelled close cannot bypass a fresh dispatch', async () => {
  const { state, events, timers } = fixture(), waiting = deferred();
  state.followUpDrainReadySessionIds.add('session-a'); state.resolveQueuedAttachments = () => waiting.promise;
  const draining = state.drainFollowUpQueue('session-a'); state.beginApplicationExit(); state.cancelApplicationExit('timeout');
  timers.shift()(); await tick(); // The older drain still owns the preparation lock.
  waiting.resolve([]); await draining; assert.equal(events.includes('dispatch'), false);
  assert.equal(timers.length, 1); timers.shift()(); await tick();
  assert.equal(events.filter(e => e === 'dispatch').length, 1);
});

test('already scheduled automatic continuation cannot start or spend a retry while closing', () => {
  const { state, events, timers } = fixture();
  state.codingSessions[0] = { id: 'session-a', turns: [{ id: 'turn-a', stage: 'paused', resumeCheckpointId: 'checkpoint-a' }], followUpQueue: [] };
  state.scheduleAutomaticResume('session-a', 'turn-a'); assert.equal(timers.length, 1);
  state.beginApplicationExit(); timers.shift()();
  assert.equal(events.includes('resume'), false); assert.equal(events.includes('update-turn'), false);
  state.cancelApplicationExit('failed'); assert.equal(timers.length, 1);
  timers.shift()(); assert.equal(events.filter(e => e === 'resume').length, 1);
});

test('the real submission wrapper tracks fulfillment and rejection without swallowing either result', async () => {
  for (const fails of [false, true]) {
    const { state } = fixture(), waiting = deferred(); state.executePromptSubmission = () => waiting.promise;
    const running = state.submitPrompt('coding'); assert.equal(state.pendingAgentSubmissions.size, 1);
    if (fails) { waiting.reject(new Error('synthetic-failure')); await assert.rejects(running, /synthetic-failure/); }
    else { waiting.resolve(true); assert.equal(await running, true); }
    assert.equal(state.pendingAgentSubmissions.size, 0);
  }
});

test('shutdown joins an active submission and flushes its late checkpoint before terminal disposal', async () => {
  const { state, events } = fixture(), waiting = deferred();
  state.executePromptSubmission = async () => { await waiting.promise; state.conversationHistoryPersistDirty = true; events.push('checkpoint'); return true; };
  const running = state.submitPrompt('coding'); state.activeAgentRunId = 'run-a';
  state.agentStartController = new AbortController(); state.beginApplicationExit();
  const closing = state.shutdownForApplicationExit(); await tick();
  assert.equal(state.agentStartController.signal.aborted, true); assert.ok(events.includes('cancel'));
  assert.equal(events.includes('terminate'), false);
  waiting.resolve(); await Promise.all([running, closing]);
  const checkpoint = events.indexOf('checkpoint'), history = events.indexOf('history', checkpoint);
  assert.ok(checkpoint >= 0 && history > checkpoint && events.indexOf('terminate') > history);
});

test('a timed-out close cannot dispose terminals when its joined submission eventually settles', async () => {
  const { state, events, document } = fixture(), waiting = deferred();
  state.executePromptSubmission = () => waiting.promise;
  const running = state.submitPrompt('coding'); state.beginApplicationExit();
  const closing = state.shutdownForApplicationExit(); await tick(); state.cancelApplicationExit('timeout');
  waiting.resolve(true); await running; await assert.rejects(closing, /APPLICATION_EXIT_CANCELLED/);
  assert.equal(events.includes('terminate'), false); assert.equal(document.body.inert, false);
});

test('independent child continuations use the same close join and cancel their own backend identity', async () => {
  const { state, events } = fixture(), waiting = deferred(), controller = new AbortController();
  state.executeAgentChildContinuation = async () => { await waiting.promise; events.push('child-checkpoint'); };
  const running = state.continueAgentChild('child-a'); assert.equal(state.pendingAgentSubmissions.size, 1);
  state.agentChildContinuationStates.set('child-a', { controller, runId: 'child-job-a' });
  state.platformService.cancelAgentRun = async id => { events.push(`cancel:${id}`); };
  state.beginApplicationExit(); const closing = state.shutdownForApplicationExit(); await tick();
  assert.equal(controller.signal.aborted, true); assert.ok(events.includes('cancel:child-job-a'));
  assert.equal(events.includes('terminate'), false);
  waiting.resolve(); await Promise.all([running, closing]);
  assert.ok(events.indexOf('terminate') > events.indexOf('child-checkpoint'));
  await state.continueAgentChild('child-b'); assert.equal(state.pendingAgentSubmissions.size, 0);
});

test('actual post-await dispatch guards include the close generation and cancel a late accepted backend job', () => {
  const execute = methods.get('executePromptSubmission');
  assert.match(execute, /const composerStillMatches[\s\S]*?!this\.applicationExitPreparing[\s\S]*?dispatchGeneration === this\.applicationExitGeneration/);
  assert.match(execute, /await this\.ensureCodingSessionWorkspace\(codingSession\)[\s\S]*?if \(!composerStillMatches\(\)\) return false/);
  assert.match(execute, /const settleCancelledBeforeStart[\s\S]*?!this\.applicationExitPreparing && dispatchGeneration === this\.applicationExitGeneration/);
  assert.match(execute, /await this\.prepareAgentSkills[\s\S]*?if \(settleCancelledBeforeStart\(\)\) return true/);
  assert.match(execute, /if \(startController\.signal\.aborted \|\| run\.agentCancelRequested \|\| this\.applicationExitPreparing[\s\S]*?cancelAgentRun\(started\.runId\)/);
});


test('shutdown cancels scheduled jobs and joins their late result before disposal', async () => {
  const { state, events } = fixture(), waiting = deferred();
  const running = waiting.promise.then(() => { events.push('scheduled-result'); return true; });
  state.pendingAgentSubmissions.add(running);
  state.scheduledAgentRuns.set('scheduled-session', { runId: 'scheduled-run' });
  state.platformService.cancelAgentRun = async id => events.push(`cancel:${id}`);
  state.beginApplicationExit(); const closing = state.shutdownForApplicationExit(); await tick();
  assert.ok(events.includes('cancel:scheduled-run')); assert.equal(events.includes('terminate'), false);
  waiting.resolve(); await closing;
  assert.ok(events.indexOf('terminate') > events.indexOf('scheduled-result'));
});
