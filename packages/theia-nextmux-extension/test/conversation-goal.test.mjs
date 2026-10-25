import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  agentPauseBlocksAutomaticDispatch,
  agentCompletionAllowsAutomaticDispatch,
  appendFollowUpTask,
  followUpTaskBelongsToSession,
  removeFollowUpTask,
  restoreFollowUpTask
} from '../lib/browser/nextmux-agent-task-queue.js';
import { autoResumeDelayMs, userQueuedPrompts } from '../lib/browser/nextmux-agent-activity.js';
import { goalRequestPrompt, goalRetryableFailure, goalTurnDecision } from '../lib/browser/nextmux-goal-runner.js';
import { goalFileBody, goalFileObjective } from '../lib/browser/nextmux-goal-file-format.js';

import { normalizeGoalTiming, pauseGoalTiming, resumeGoalTiming } from '../lib/browser/nextmux-goal-elapsed.js';
import { goalEditorText } from '../lib/browser/nextmux-goal-schedule-locale.js';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');

// Extract the production async drain method into a dependency-injected
// harness. This tests the real pause/delete race at the method boundary,
// rather than relying only on source-string assertions.
const widgetFile = ts.createSourceFile('nextmux-desktop-widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const drainMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'drainFollowUpQueue');
assert.ok(drainMethod, 'the production drain method must remain available for the race harness');
const removeMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'removeCodingGoal');
assert.ok(removeMethod, 'the production goal removal method must remain available for the race harness');
const openGoalComposerMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'openGoalComposer');
assert.ok(openGoalComposerMethod, 'goal creation must use the normal composer');
const cancelGoalComposerMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'cancelGoalComposer');
assert.ok(cancelGoalComposerMethod, 'goal composer cancellation must remain available');
const submitPromptMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'submitPrompt');
assert.ok(submitPromptMethod, 'submitPrompt must intercept goal composer submissions');
const drainBindings = { userQueuedPrompts, followUpTaskBelongsToSession, removeFollowUpTask, restoreFollowUpTask,
  bindPriceQuote: route => route, runningTaskText: () => 'dispatch failed' };
const DrainHarness = new Function(...Object.keys(drainBindings), ts.transpile(`class Harness { ${drainMethod.getText(widgetFile)} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))(...Object.values(drainBindings));
const RemoveHarness = new Function(ts.transpile(`class Harness { ${removeMethod.getText(widgetFile)} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))();
const GoalComposerHarness = new Function(ts.transpile(`class Harness { ${openGoalComposerMethod.getText(widgetFile)} ${cancelGoalComposerMethod.getText(widgetFile)} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))();
const GoalSubmitHarness = new Function('runningTaskText', ts.transpile(`class Harness { ${submitPromptMethod.getText(widgetFile)} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))((_locale, key) => key);
const persistGoalMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'persistCodingGoalFile');
const parseGoalFunction = widgetFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parsePersistedCodingGoalFile');
assert.ok(persistGoalMethod, 'the regression must execute the actual goal-file serializer');
assert.ok(parseGoalFunction, 'the regression must execute the actual goal-file parser');
const parsePersistedGoal = new Function('goalFileObjective', 'normalizeGoalTiming', ts.transpile(`${parseGoalFunction.getText(widgetFile)}; return parsePersistedCodingGoalFile;`, {
  target: ts.ScriptTarget.ES2022
}))(goalFileObjective, normalizeGoalTiming);
const goalUri = value => ({ resolve: part => goalUri(`${value}/${part}`), toString: () => value });
const GoalFileHarness = new Function('URI', 'BinaryBuffer', 'goalFileBody', ts.transpile(`class Harness { ${persistGoalMethod.getText(widgetFile)} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))({ fromFilePath: goalUri }, { fromString: text => text }, goalFileBody);
const scheduleGoalMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'scheduleGoalContinuation');
assert.ok(scheduleGoalMethod, 'the regression must execute the actual continuation scheduler');
const setGoalStatusMethod = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === 'setCodingGoalStatus');
assert.ok(setGoalStatusMethod, 'goal completion and pause share one production status writer');
const schedulerHarness = session => {
  const callbacks = [];
  const Harness = new Function('window', 'activeRunBelongsToSession', 'agentPauseBlocksAutomaticDispatch', 'autoResumeDelayMs', 'goalTurnDecision', 'goalRequestPrompt', 'pauseGoalTiming',
    ts.transpile(`class Harness { ${scheduleGoalMethod.getText(widgetFile)} ${setGoalStatusMethod.getText(widgetFile)} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022
  }))({ setTimeout: (callback, delayMs) => { callbacks.push(Object.assign(callback, { delayMs })); } },
    (owner, id) => owner === id, agentPauseBlocksAutomaticDispatch, autoResumeDelayMs, goalTurnDecision, goalRequestPrompt, pauseGoalTiming);
  const enqueued = [];
  const widget = Object.assign(new Harness(), {
    codingSessions: [session], goalContinuationTimers: new Set(), followUpDrainReadySessionIds: new Set(), activeAgentRunId: '', activeAgentSessionId: '',
    persistCodingSessions() {}, async persistCodingGoalFile() {}, update() {}, requestFollowUpQueueDrain() {},
    updateFollowUpQueue(sessionId, queue) {
      this.codingSessions = this.codingSessions.map(item => item.id === sessionId ? { ...item, followUpQueue: queue } : item);
      return true;
    },
    enqueueFollowUpTask(sessionId, _workbench, prompt) {
      enqueued.push(prompt);
      this.codingSessions = this.codingSessions.map(item => item.id === sessionId
        ? { ...item, followUpQueue: [{ id: 'queued-goal', automaticGoal: true }] } : item);
      return true;
    }
  });
  return { widget, callbacks, enqueued };
};

test('completion schedules one continuation from the current turn rather than its stale dispatch snapshot', () => {
  const dispatched = { id: 'turn-goal', stage: 'running' };
  const session = { id: 'session-goal', goal: { id: 'goal', prompt: 'Complete the release', status: 'active', attempts: 0 },
    turns: [{ ...dispatched, stage: 'complete', response: 'The tests pass; deployment remains.' }] };
  const { widget, callbacks, enqueued } = schedulerHarness(session);
  widget.scheduleGoalContinuation(session.id, dispatched);
  widget.scheduleGoalContinuation(session.id, dispatched);
  assert.equal(callbacks.length, 1, 'completion callbacks must use the updated terminal turn and coalesce');
  callbacks[0]();
  assert.equal(enqueued.length, 1);
  assert.ok(enqueued[0].includes(session.goal.prompt), 'the resumed request retains the original goal');
  widget.scheduleGoalContinuation(session.id, dispatched);
  assert.equal(callbacks.length, 1, 'a persisted continuation prevents replay of the same callback');
});

test('a restored unsafe failure does not start a fresh billable goal request', () => {
  for (const failure of [
    { code: 'BILLING_OUTCOME_UNKNOWN', kind: 'waiting_user', retryable: false, retrySafe: false },
    { code: 'INVALID_API_KEY', kind: 'model_auth', retryable: false },
    { code: 'MODEL_CALL_FAILED', kind: 'failed', retryable: false, retrySafe: false }
  ]) {
    const turn = { id: 'turn-failure', stage: 'error', failure };
    const session = { id: 'session-failure', goal: { id: 'goal', prompt: 'Complete the release', status: 'active', attempts: 0 }, turns: [turn] };
    const { widget, callbacks } = schedulerHarness(session);
    widget.scheduleGoalContinuation(session.id, turn);
    assert.equal(callbacks.length, 0, `${failure.code} must retain the goal without replaying an unsafe request`);
  }
});

test('a delayed goal callback cannot dispatch after a newer turn, pause, edit or deletion', () => {
  const changes = [
    session => ({ ...session, turns: [...session.turns, { id: 'newer-turn', stage: 'running' }] }),
    session => ({ ...session, goal: { ...session.goal, status: 'paused' } }),
    session => ({ ...session, goal: { ...session.goal, prompt: 'Different target', updatedAt: 2000 } }),
    session => ({ ...session, goal: { ...session.goal, id: 'replacement-goal' } }),
    session => ({ ...session, goal: undefined }),
    session => ({ ...session, turns: [{ ...session.turns[0], stage: 'error', failure: { code: 'BILLING_OUTCOME_UNKNOWN', retrySafe: false } }] })
  ];
  for (const change of changes) {
    const turn = { id: 'old-turn', stage: 'complete', response: 'More work remains.' };
    const session = { id: 'session-race', goal: { id: 'goal', prompt: 'Original target', status: 'active', updatedAt: 1000, attempts: 0 }, turns: [turn] };
    const { widget, callbacks, enqueued } = schedulerHarness(session);
    widget.scheduleGoalContinuation(session.id, turn);
    assert.equal(callbacks.length, 1);
    widget.codingSessions = [change(session)];
    callbacks[0]();
    assert.equal(enqueued.length, 0, 'a stale callback must not start another model request');
    assert.equal(widget.goalContinuationTimers.size, 0, 'the old timer must release its guard');
  }
});

test('goal recovery leaves resumable checkpoints to their scheduler and honors rate-limit backoff', () => {
  const goal = { id: 'goal', prompt: 'Original target', status: 'active', attempts: 0 };
  for (const stage of ['error', 'paused']) {
    const turn = { id: 'checkpoint-turn', stage, resumeCheckpointId: 'existing-checkpoint',
      failure: { code: 'RATE_LIMITED', retryable: true, retrySafe: true } };
    const session = { id: 'session-checkpoint', goal, turns: [turn] };
    const { widget, callbacks } = schedulerHarness(session);
    widget.scheduleGoalContinuation(session.id, turn);
    assert.equal(callbacks.length, 0, 'goal recovery must not duplicate a checkpoint continuation');
  }
  const turn = { id: 'rate-limited-turn', stage: 'error',
    failure: { code: 'RATE_LIMITED', kind: 'rate_limited', retryable: true, retrySafe: true, httpStatus: 429, retryAfterMs: 90_000 } };
  const session = { id: 'session-rate-limit', goal, turns: [turn] };
  const { widget, callbacks } = schedulerHarness(session);
  widget.scheduleGoalContinuation(session.id, turn);
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].delayMs, 90_000, 'safe retries honor provider Retry-After instead of spinning every 750 ms');
});

test('a quoted completion token does not complete a goal; a terminal final-line token does', () => {
  const goal = { id: 'goal', prompt: 'Original target', status: 'active', attempts: 0 };
  for (const response of ['Use [GOAL_COMPLETE] when done. Work remains.', 'Example:\n[GOAL_COMPLETE]\nThis is not done yet.']) {
    const turn = { id: 'turn-marker', stage: 'complete', response };
    const session = { id: 'session-marker', goal, turns: [turn] };
    const { widget, callbacks } = schedulerHarness(session);
    widget.scheduleGoalContinuation(session.id, turn);
    assert.equal(widget.codingSessions[0].goal.status, 'active');
    assert.equal(callbacks.length, 1);
  }
  const turn = { id: 'turn-done', stage: 'complete', response: 'Validated all results.\n[GOAL_COMPLETE]\n' };
  const session = { id: 'session-done', goal, turns: [turn] };
  const { widget, callbacks } = schedulerHarness(session);
  widget.scheduleGoalContinuation(session.id, { ...turn, stage: 'running', response: '' });
  assert.equal(widget.codingSessions[0].goal.status, 'completed');
  assert.equal(callbacks.length, 0);
});

test('the actual persisted goal file recovers the original target including Markdown headings', async () => {
  const writes = new Map();
  const session = { id: 'goal-restart-session' };
  const goal = {
    id: 'goal-restart', status: 'active', createdAt: 1234, updatedAt: 5678, attempts: 2, lastRunAt: 4567,
    prompt: 'Complete the release.\n\n## Validation\nRun the complete test suite.\n\n## Deploy\nPublish after verification.'
  };
  const widget = Object.assign(new GoalFileHarness(), {
    codingSessionWorkspaceRoot: () => '/workspace',
    goalFileOperations: new Map(),
    platformService: {
      getAgentFileState: async () => ({ exists: false, sha256: null }),
      saveCodingGoalFile: async request => { writes.set(`/workspace/${request.path}`, request.content); }
    },
    fileService: {
      createFolder: async () => undefined,
      writeFile: async (uri, body) => { writes.set(uri.toString(), body); }
    }
  });
  await widget.persistCodingGoalFile(session, goal);
  const body = writes.get('/workspace/.nextmux/goals/goal-restart.md');
  assert.equal(typeof body, 'string');
  const restored = parsePersistedGoal(body);
  assert.ok(restored, 'the parser must accept the file generated by the production serializer');
  assert.deepEqual(restored, { conversationId: session.id, goalId: goal.id, prompt: goal.prompt,
    status: goal.status, createdAt: goal.createdAt, updatedAt: goal.updatedAt,
    attempts: goal.attempts, lastRunAt: goal.lastRunAt, pausedAt: undefined, activeTimePauses: [] });
  assert.deepEqual(parsePersistedGoal(body.replace(/\n/g, '\r\n')), restored,
    'Windows line endings must recover the same target');
});

test('continuous goals are persisted, editable and rendered above the composer', () => {
  assert.match(source, /interface CodingGoalRecord/);
  assert.match(source, /resolve\('\.nextmux'\)\.resolve\('goals'\)/);
  assert.match(source, /scheduleGoalContinuation/);
  assert.match(source, /nmx-goal-composer-mode' aria-label=\{goalScheduleText\(this\.desktopLocale, 'goal'\)\}/);
  assert.match(source, /goalRequestPrompt\(/, 'goal requests use the shared completion protocol');
  assert.match(readFileSync(new URL('../src/browser/nextmux-goal-runner.ts', import.meta.url), 'utf8'), /GOAL_COMPLETE/);
  assert.match(source, /codingGoalLabel.*'completedGoal'.*'pausedGoal'.*'activeGoal'/);
  // The status label is a localized word (no hard-coded full-width colon in Latin scripts).
  assert.match(source, /<span className='nmx-coding-goal-label'>\{goalScheduleText\(this\.desktopLocale, 'goal'\)\}<\/span>/);
  assert.doesNotMatch(source, /\$\{codingGoalLabel\}：/);
  assert.match(css, /\.nmx-coding-goal/);
});

test('a goal can be opened from an empty composer before the first prompt', () => {
  assert.match(source, /this\.activeCodingSession\(\) \|\| this\.ensureCodingSession\('\'\)/);
  assert.match(source, /protected openGoalComposer\(\)/);
  assert.doesNotMatch(source, /renderGoalDialog/);
  assert.doesNotMatch(source, /goalDialogOpen/);
  assert.match(source, /renderAttachmentPopoverPortal\(\)/);
  assert.match(source, /onClick=\{\(\) => this\.openGoalComposer\(\)\}/);
  assert.match(source, /ReactDOM\.createPortal\(/);
  assert.match(source, /goalScheduleText\(this\.desktopLocale, 'cancelGoal'\)/);
  assert.match(css, /\.nmx-coding-stage\s*\{[\s\S]*?overflow: visible;/);
  assert.match(css, /\.nmx-desktop-widget:has\(\.nmx-composer-popover\)/);
  assert.match(css, /\.nmx-attachment-popover\s*\{[\s\S]*?bottom: auto;/);
});


test('goal creation uses the normal composer and cancel preserves both drafts', () => {
  globalThis.requestAnimationFrame ||= (() => 0);
  const session = { id: 'goal-composer-session', goal: undefined };
  const otherSession = { id: 'goal-composer-other-session', goal: undefined };
  let activeSession = session;
  let persisted = 0;
  const widget = Object.assign(new GoalComposerHarness(), {
    activeCodingSession: () => activeSession,
    ensureCodingSession: () => activeSession,
    prompt: 'ordinary draft',
    goalDraft: '',
    goalDraftsBySession: new Map(), goalEditorDrafts: new Map(),
    codingPopover: 'attachments',
    modelPickerRelayOpen: true,
    setComposerPrompt(value) { this.prompt = value; },
    scheduleComposerDraftPersist() { persisted += 1; },
    update() {},
    node: { querySelector: () => undefined }
  });
  widget.openGoalComposer();
  assert.equal(widget.goalComposerActive, true);
  assert.equal(widget.goalComposerSessionId, session.id);
  assert.equal(widget.prompt, '', 'the normal composer is cleared for the goal draft');
  widget.prompt = 'finish the release checklist';
  widget.cancelGoalComposer();
  assert.equal(widget.goalComposerActive, false);
  assert.equal(widget.prompt, 'ordinary draft', 'cancel restores the ordinary draft');
  assert.equal(widget.goalDraft, 'finish the release checklist', 'cancel keeps the unsubmitted target for reopening');
  assert.ok(persisted >= 2);
  activeSession = otherSession;
  widget.prompt = 'other ordinary draft';
  widget.openGoalComposer();
  assert.equal(widget.goalDraft, '', 'another conversation does not inherit the first target draft');
  widget.prompt = 'other target';
  widget.cancelGoalComposer();
  activeSession = session;
  widget.prompt = 'ordinary draft';
  widget.openGoalComposer();
  assert.equal(widget.goalDraft, 'finish the release checklist', 'reopening the first conversation restores its own target draft');
});

test('the normal send path commits a goal draft through saveGoal', async () => {
  const widget = Object.assign(new GoalSubmitHarness(), {
    applicationExitPreparing: false,
    goalComposerActive: true,
    goalComposerSessionId: 'goal-submit-session',
    activeCodingSessionId: 'goal-submit-session',
    prompt: 'run the full test suite',
    goalDraft: '',
    setComposerPrompt(value) { this.prompt = value; },
    scheduleComposerDraftPersist() {},
    saveGoalCalled: 0,
    async saveGoal() { this.saveGoalCalled += 1; },
    activeModelRoute: () => ({ id: 'route' })
  });
  const submitted = await widget.submitPrompt('coding');
  assert.equal(submitted, true);
  assert.equal(widget.saveGoalCalled, 1);
  assert.equal(widget.goalComposerActive, false);
  assert.equal(widget.goalComposerSessionId, '');
  assert.equal(widget.goalDraft, 'run the full test suite');
});

test('a goal is not saved as active without a usable model: the text and goal mode stay, the model picker opens', async () => {
  const widget = Object.assign(new GoalSubmitHarness(), {
    applicationExitPreparing: false, goalComposerActive: true, goalComposerSessionId: 's', activeCodingSessionId: 's',
    prompt: 'create c.txt', goalDraft: '', desktopLocale: 'en', codingPopover: '', attachmentError: '',
    setComposerPrompt(value) { this.prompt = value; }, scheduleComposerDraftPersist() {}, update() {},
    saveGoalCalled: 0, async saveGoal() { this.saveGoalCalled += 1; }, activeModelRoute: () => undefined
  });
  assert.equal(await widget.submitPrompt('coding'), false);
  assert.equal(widget.saveGoalCalled, 0);
  assert.equal(widget.goalComposerActive, true);
  assert.equal(widget.prompt, 'create c.txt');
  assert.equal(widget.codingPopover, 'routes');
  assert.ok(widget.attachmentError);
});

test('active goals are resumed after restoring a session and duplicate callbacks stay idempotent', () => {
  // A restart restores the selected session asynchronously.  The restore
  // callback must use the same continuation scheduler as an in-process turn
  // completion, while the scheduler itself must refuse a second automatic
  // queue entry when both callbacks race.
  assert.match(source, /restored\?\.goal\?\.status === 'active' && latest && latest\.stage !== 'running'/);
  assert.match(source, /restored\?\.goal\?\.status === 'active' && restoredLatest && restoredLatest\.stage !== 'running'/);
  assert.match(source, /session\.followUpQueue\?\.find\(task => task\.automaticGoal\)/);
  assert.match(source, /goalContinuationTimers = new Set/);
  assert.match(source, /if \(this\.goalContinuationTimers\.has\(sessionId\)\) return/);
  assert.match(source, /current\.followUpQueue\?\.some\(task => task\.automaticGoal\)/);
  assert.match(source, /goalContinuationTimers\.delete\(sessionId\)/);
  assert.match(source, /const ownRunActive = this\.conversationHasActiveRun\?\.\(sessionId\)/);
});

test('deleting a goal removes the project-local markdown recovery record', () => {
    assert.match(source, /const removedGoal = session\.goal/);
    assert.match(source, /const retainedQueue = \(session\.followUpQueue \|\| \[\]\)\.filter\(task => !task\.automaticGoal\)/);
    assert.match(source, /goal: undefined, followUpQueue: retainedQueue/);
    assert.match(source, /this\.goalContinuationTimers\.delete\(session\.id\)/);
    assert.match(source, /const directory = URI\.fromFilePath\(workspaceRoot\)\.resolve\('\.nextmux'\)\.resolve\('goals'\)/);
  assert.match(source, /const file = directory\.resolve\(`\$\{removedGoal\.id\}\.md`\)/);
  assert.match(source, /this\.fileService\.delete\(file\)/);
  assert.match(source, /const tombstone = directory\.resolve\(`\$\{removedGoal\.id\}\.deleted`\)/);
  assert.match(source, /deletedAt: \$\{Date\.now\(\)\}/);
    assert.match(source, /deleted\.has\(child\.name\.slice\(0, -'\.md'\.length\)\)/);
});

test('a paused or deleted goal cannot dispatch a raced automatic continuation', () => {
    assert.match(source, /if \(task\.automaticGoal && current\.goal\?\.status !== 'active'\)/);
    assert.match(source, /removeFollowUpTask\(current\.followUpQueue \|\| \[\], task\.id\)/);
    assert.match(source, /this\.followUpDrainReadySessionIds\.delete\(session\.id\)/);
});

test('the production queue drain drops a raced automatic goal after async attachments resolve', async () => {
    const session = {
        id: 'session-race',
        goal: { id: 'goal-race', status: 'active' },
        followUpQueue: [
            { id: 'automatic-goal', sessionId: 'session-race', source: 'user', automaticGoal: true, prompt: 'continue goal', workbench: 'coding', routeId: 'route-race', relayKey: 'relay-race' },
            { id: 'manual-user', sessionId: 'session-race', source: 'user', prompt: 'keep this user task', workbench: 'coding', routeId: 'route-race', relayKey: 'relay-race' }
        ]
    };
    let releaseAttachments;
    let attachmentsStarted = false;
    let dispatched = 0;
    const attachmentsReady = new Promise(resolve => { releaseAttachments = resolve; });
    const route = { id: 'route-race', kind: 'managed_gateway', relayKey: 'relay-race' };
    const widget = Object.assign(new DrainHarness(), {
        conversationWindows: [], conversationWindowId: 'main', detachedConversationId: '', activeCodingSessionId: session.id,
        conversationHistoryReady: () => true, applicationExitPreparing: false, followUpDrainReadySessionIds: new Set([session.id]),
        followUpQueueDraining: false, activeAgentRunId: '', agentStage: 'idle', applicationExitGeneration: 1,
        codingSessions: [session], directFollowUpDrainTaskIds: new Map(), routesForRelay: () => [route],
        queuedAttachmentPayloads: new Map(), desktopLocale: 'zh-CN',
        resolveQueuedAttachments: async () => { attachmentsStarted = true; return attachmentsReady; },
        updateFollowUpQueue: (_sessionId, queue) => { session.followUpQueue = queue; return true; },
        setQueuedFollowUpTaskError: () => undefined,
        submitPrompt: async () => { dispatched += 1; },
        requestFollowUpQueueDrain: () => undefined,
        update: () => undefined
    });
    const draining = widget.drainFollowUpQueue(session.id);
    // Let the production method reach its awaited attachment preparation.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attachmentsStarted, true);
    // A user pause/delete can happen while attachments are being prepared.
    session.goal = { ...session.goal, status: 'paused' };
    releaseAttachments([]);
    await draining;
    assert.equal(dispatched, 0, 'a stale automatic goal must never start another model request');
    assert.deepEqual(session.followUpQueue.map(task => task.id), ['manual-user'], 'ordinary user work remains queued');
});

test('the production goal removal method clears queued automatic work while retaining user work', () => {
    const automatic = { id: 'automatic-goal', automaticGoal: true };
    const manual = { id: 'manual-user', source: 'user', prompt: 'keep this user task' };
    const session = { id: 'session-delete', goal: { id: 'goal-delete', status: 'active' }, followUpQueue: [automatic, manual] };
    const payloads = new Map([[automatic.id, ['attachment']]]);
    const widget = Object.assign(new RemoveHarness(), {
        activeCodingSession: () => session,
        codingSessions: [session],
        queuedAttachmentPayloads: payloads,
        directFollowUpDrainTaskIds: new Map([[session.id, automatic.id]]),
        followUpDrainReadySessionIds: new Set([session.id]),
        goalContinuationTimers: new Set([session.id]),
        goalDraftsBySession: new Map(), goalEditorDrafts: new Map(),
        persistCodingSessions: () => undefined,
        codingSessionWorkspaceRoot: () => '',
        update: () => undefined
    });
    widget.removeCodingGoal();
    assert.equal(widget.codingSessions[0].goal, undefined);
    assert.deepEqual(widget.codingSessions[0].followUpQueue, [manual]);
    assert.equal(payloads.has(automatic.id), false);
    assert.equal(widget.directFollowUpDrainTaskIds.has(session.id), false);
    assert.equal(widget.followUpDrainReadySessionIds.has(session.id), false);
    assert.equal(widget.goalContinuationTimers.has(session.id), false);
});

test('goal markdown records identify their owning conversation and recover after mirror reset', () => {
  assert.match(source, /conversationId: \$\{session\.id\}/);
  assert.match(source, /parsePersistedCodingGoalFile/);
  assert.match(source, /restoreProjectGoalFiles/);
  assert.match(source, /fileService\.resolve\(URI\.fromFilePath\(root\)\.resolve\('\.nextmux'\)\.resolve\('goals'\)\)/);
  assert.match(source, /session\.goal\.updatedAt >= record\.updatedAt/);
  assert.match(source, /restoreProjectGoalFiles\(\[workspacePath\]\)/);
  assert.match(source, /protected async restoreProjectGoalFiles\(workspaceRoots\?: readonly string\[\]\)/);
});

test('goal file writes and deletes are serialized to prevent stale resurrection', () => {
  assert.match(source, /goalFileOperations = new Map/);
  assert.match(source, /previous\.catch\(\(\) => undefined\)\.then/);
  assert.match(source, /operationKey = file\.toString\(\)/);
});

function savedGoalHarness() {
  const names = ['saveGoal', 'dropUnsubmittedGoalTasks', 'applySavedCodingGoalFile', 'submitSavedCodingGoal', 'enqueueFollowUpTask',
    'updateFollowUpQueue', 'requestFollowUpQueueDrain', 'drainFollowUpQueue'];
  const methods = names.map(name => {
    const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === name);
    assert.ok(method, `production ${name} must exist`);
    return method.getText(widgetFile);
  }).join('\n');
  const callbacks = [];
  const bindings = { goalEditorText, resumeGoalTiming, activeRunBelongsToSession: (a,b) => a === b, parsePersistedCodingGoalFile: parsePersistedGoal, appendFollowUpTask, userQueuedPrompts, goalRequestPrompt, goalRetryableFailure,
    followUpTaskBelongsToSession, removeFollowUpTask, restoreFollowUpTask, agentCompletionAllowsAutomaticDispatch,
    bindPriceQuote: route => route, runningTaskText: (_locale, key) => key,
    NextMuxDesktopWidget: { FOLLOW_UP_QUEUE_LIMIT: 20 }, window: { setTimeout: fn => callbacks.push(fn) } };
  const Harness = new Function(...Object.keys(bindings), ts.transpile(`class Harness { ${methods} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022
  }))(...Object.values(bindings));
  const routes = ['A', 'B'].map(owner => ({ id: `route-${owner}`, kind: 'official_connection',
    connection: { id: `api-${owner}`, model: `model-${owner}` } }));
  const sessions = ['A', 'B'].map(id => ({ id, turns: [], routeId: `route-${id}`, modelId: `model-${id}`,
    relayKey: `api-${id}`, reasoningEffort: id === 'A' ? 'high' : 'low', automaticRelaySource: 'off',
    permissionMode: id === 'A' ? 'read_only' : 'full_access', followUpQueue: [] }));
  const submissions = [];
  const widget = Object.assign(new Harness(), {
    codingSessions: sessions, activeCodingSessionId: 'A', activeModelRouteId: 'route-A', activeRelayKey: 'api-A',
    goalEditingSessionId: 'A', goalDraft: 'Finish A only', goalDraftsBySession: new Map(), goalEditorDrafts: new Map(),
    directFollowUpDrainTaskIds: new Map(), followUpDrainReadySessionIds: new Set(), queuedAttachmentPayloads: new Map(),
    conversationWindows: [], conversationWindowId: 'window', conversationMutations: { tryAcquire: () => () => {} },
    prompt: '', permissionMode: 'full_access', agentStage: 'idle', activeAgentRunId: '',
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    conversationAgentRun: () => ({ activeAgentRunId: '' }), codingSessionRelayKey: session => session.relayKey,
    routesForRelay: relay => routes.filter(route => route.connection.id === relay),
    modelRoutes() { return this.routesForRelay(this.activeRelayKey); },
    modelKeyForRoute: route => route.connection.model, modelDisplayName: model => model,
    reasoningEffortLevels: () => ['low', 'high'], reasoningEffortForRoute: () => 'low', reasoningSettingsForRoute: () => ({}),
    persistCodingSessions() {}, async persistCodingGoalFile() {}, conversationHistoryReady: () => true,
    isCodingGoalFileUri: (uri, session) => uri === `goal://${session.id}`,
    update() {}, setComposerPrompt(value) { this.prompt = value; },
    async resolveQueuedAttachments() { return []; },
    async submitPrompt(_workbench, queued) {
      assert.ok(queued, 'goal must dispatch through its owned queue, never the active composer');
      submissions.push(queued);
      return true;
    },
    addNotification() { assert.fail('unexpected goal parse notification'); }
  });
  return { widget, submissions, callbacks, routes };
}

test('saving a goal while switching conversations dispatches only its owner and preserves the visible draft and route', async () => {
  const { widget, submissions } = savedGoalHarness();
  let release;
  widget.persistCodingGoalFile = () => new Promise(resolve => { release = resolve; });
  const saving = widget.saveGoal();
  widget.activeCodingSessionId = 'B';
  widget.activeModelRouteId = 'route-B';
  widget.activeRelayKey = 'api-B';
  widget.prompt = 'unfinished B draft';
  release();
  await saving;
  const task = widget.codingSessions.find(session => session.id === 'A').followUpQueue[0];
  assert.equal(task.sessionId, 'A');
  assert.equal(task.routeId, 'route-A');
  assert.equal(task.relayKey, 'api-A');
  assert.equal(task.reasoningEffort, 'high');
  assert.equal(task.permissionMode, 'read_only');
  await widget.drainFollowUpQueue('A');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].session.id, 'A');
  assert.equal(submissions[0].route.id, 'route-A');
  assert.equal(widget.activeCodingSessionId, 'B');
  assert.equal(widget.prompt, 'unfinished B draft');
  assert.equal(widget.activeModelRouteId, 'route-B');
  assert.deepEqual(widget.codingSessions.find(session => session.id === 'B').followUpQueue, []);
});

test('saving legacy goal Markdown from an inactive editor preserves pause and ordinary user work', async () => {
  const { widget, submissions } = savedGoalHarness();
  const goal = { id: 'goal-A', prompt: 'old target', status: 'paused', createdAt: 1, updatedAt: 2, attempts: 0 };
  widget.codingSessions[0] = { ...widget.codingSessions[0], goal, followUpQueue: [
    { id: 'old-automatic', sessionId: 'A', prompt: 'old target', automaticGoal: true },
    { id: 'user-message', sessionId: 'A', prompt: 'keep this ordinary message' }
  ] };
  widget.activeCodingSessionId = 'B';
  widget.prompt = 'B draft stays';
  await widget.applySavedCodingGoalFile('A', 'goal://A', `---\nconversationId: A\ngoalId: goal-A\nstatus: paused\ncreatedAt: 1\nupdatedAt: 2\nattempts: 0\n---\n# 持续目标\n## 提示词\nNew edited target`);
  const owner = widget.codingSessions[0];
  assert.equal(owner.goal.status, 'paused');
  assert.equal(owner.goal.prompt, 'New edited target');
  assert.deepEqual(owner.followUpQueue.map(task => task.id), ['user-message']);
  assert.equal(widget.directFollowUpDrainTaskIds.has('A'), false, 'edited goals do not bypass older user messages');
  assert.equal(widget.followUpDrainReadySessionIds.has('A'), false);
  assert.equal(widget.prompt, 'B draft stays');
  assert.equal(submissions.length, 0);
});

test('pausing, deleting or superseding a goal during its disk save prevents stale submission', async () => {
  for (const change of ['pause', 'delete', 'edit']) {
    const { widget, submissions } = savedGoalHarness();
    let release;
    widget.persistCodingGoalFile = () => new Promise(resolve => { release = resolve; });
    const saving = widget.saveGoal();
    const session = widget.codingSessions[0];
    widget.codingSessions[0] = { ...session, goal: change === 'delete' ? undefined : {
      ...session.goal, ...(change === 'pause' ? { status: 'paused' } : { prompt: 'newer target' })
    } };
    release();
    await saving;
    assert.deepEqual(widget.codingSessions[0].followUpQueue, [], change);
    assert.equal(submissions.length, 0, change);
  }
});

test('automatic goal continuation never inherits the foreground route when its own route is unavailable', () => {
  const { widget, routes } = savedGoalHarness();
  widget.activeCodingSessionId = 'B';
  widget.activeModelRouteId = 'route-B';
  widget.activeRelayKey = 'api-B';
  routes.splice(0, 1);
  assert.equal(widget.enqueueFollowUpTask('A', 'coding', 'continue target', [], { automaticGoal: true }), false);
  assert.deepEqual(widget.codingSessions[0].followUpQueue, []);
});

// ---- Goal policy (Codex goal extension behaviour) and main-conversation wiring ----

test('goal decisions: completion, blocked audit, idle-turn guard, failures and waits', () => {
  const blocks = reason => ['cancel_requested', 'pause_requested', 'user_input_requested'].includes(reason) || agentPauseBlocksAutomaticDispatch(reason);
  const idle = { stage: 'complete', response: 'Still working on it.', goalPresentationOrigin: 'automatic-v1', events: [{ type: 'assistant_delta' }] };
  const worked = { ...idle, events: [{ type: 'tool_completed' }] };
  assert.deepEqual(goalTurnDecision([{ stage: 'complete', response: 'Checked.\n[GOAL_COMPLETE]' }], blocks), { kind: 'complete' });
  assert.deepEqual(goalTurnDecision([{ stage: 'complete', response: 'Blocked on credentials.\n[GOAL_BLOCKED]' }], blocks), { kind: 'pause', reason: 'blocked' });
  assert.deepEqual(goalTurnDecision([worked, idle, idle], blocks), { kind: 'continue', retry: false }, 'two idle turns still continue');
  assert.deepEqual(goalTurnDecision([idle, idle, idle], blocks), { kind: 'pause', reason: 'idle' }, 'three automatic turns without work stop the loop');
  assert.deepEqual(goalTurnDecision([idle, idle, worked], blocks), { kind: 'continue', retry: false }, 'tool work resets the guard');
  assert.deepEqual(goalTurnDecision([idle, { ...idle, goalPresentationOrigin: 'user' }, idle, idle], blocks), { kind: 'continue', retry: false },
    'a user message resets the guard');
  assert.deepEqual(goalTurnDecision([{ stage: 'error', failure: { retryable: true, retrySafe: true, kind: 'rate_limited' } }], blocks), { kind: 'continue', retry: true });
  assert.deepEqual(goalTurnDecision([{ stage: 'error', failure: { retryable: false, kind: 'failed' } }], blocks), { kind: 'pause', reason: 'failed' });
  for (const turn of [{ stage: 'running' }, { stage: 'cancelled', stopReason: 'cancel_requested' }, { stage: 'paused', stopReason: 'pause_requested' },
    { stage: 'paused', stopReason: 'user_input_requested' }, { stage: 'error', resumeCheckpointId: 'cp', failure: { retryable: true, retrySafe: true } }]) {
    assert.deepEqual(goalTurnDecision([turn], blocks), { kind: 'wait' }, JSON.stringify(turn));
  }
});

test('a reported impasse or a non-retryable failure pauses the goal instead of looping', () => {
  for (const turn of [{ id: 't', stage: 'complete', response: 'Needs the API key from you.\n[GOAL_BLOCKED]' },
    { id: 't', stage: 'error', failure: { code: 'MODEL_CALL_FAILED', kind: 'failed', retryable: false } }]) {
    const session = { id: 'session', goal: { id: 'goal', prompt: 'Ship it', status: 'active', attempts: 1 }, turns: [turn],
      followUpQueue: [{ id: 'stale', automaticGoal: true, dispatch: undefined }] };
    const { widget, callbacks } = schedulerHarness({ ...session, followUpQueue: [] });
    widget.scheduleGoalContinuation(session.id, turn);
    assert.equal(widget.codingSessions[0].goal.status, 'paused', turn.stage);
    assert.equal(callbacks.length, 0, turn.stage);
  }
});

test('goal requests carry the objective with Codex-style audits; the conversation shows only the objective', async () => {
  const { goalTurnPresentation } = await import('../lib/browser/nextmux-goal-presentation.js');
  for (const kind of ['start', 'continue']) {
    const prompt = goalRequestPrompt('把发布检查清单做完', kind);
    assert.match(prompt, /<objective>\n把发布检查清单做完\n<\/objective>/);
    assert.match(prompt, /Completion audit[\s\S]*\[GOAL_COMPLETE\][\s\S]*Blocked audit[\s\S]*\[GOAL_BLOCKED\]/);
    assert.match(prompt, /Reply in the language the objective is written in/);
    const shown = goalTurnPresentation({ prompt, goalPresentationOrigin: 'automatic-v1', response: 'Waiting on credentials.\n[GOAL_BLOCKED]' });
    assert.equal(shown.prompt, '把发布检查清单做完', kind);
    assert.equal(shown.response, 'Waiting on credentials.', 'the protocol footer is not shown');
    assert.equal(goalTurnPresentation({ prompt, goalPresentationOrigin: 'user', response: '' }).prompt, prompt, 'user text is never rewritten');
  }
});

test('a goal continuation is dispatched in its own conversation with that conversation\'s route, effort, permission and history owner', async () => {
  const { widget, submissions } = savedGoalHarness();
  // Legacy conversation record without a stored permission: inherit its last turn, never a silent read-only downgrade.
  widget.codingSessions = widget.codingSessions.map(session => session.id === 'B'
    ? { ...session, permissionMode: undefined, turns: [{ id: 'b1', stage: 'complete', stopReason: 'completed', permissionMode: 'workspace_write' }],
      goal: { id: 'goal-B', prompt: 'Finish B', status: 'active', createdAt: 1, updatedAt: 1, attempts: 0 } }
    : session);
  widget.activeCodingSessionId = 'A';
  widget.defaultPermissionMode = 'full_access';
  assert.equal(widget.enqueueFollowUpTask('B', 'coding', goalRequestPrompt('Finish B', 'continue'), [], { automaticGoal: true }), true);
  const task = widget.codingSessions.find(session => session.id === 'B').followUpQueue[0];
  assert.deepEqual([task.sessionId, task.routeId, task.relayKey, task.reasoningEffort, task.permissionMode, task.automaticGoal],
    ['B', 'route-B', 'api-B', 'low', 'workspace_write', true]);
  widget.followUpDrainReadySessionIds.add('B');
  await widget.drainFollowUpQueue('B');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].session.id, 'B', 'the continuation runs in the goal\'s conversation (its history and agent session)');
  assert.equal(submissions[0].route.id, 'route-B');
  assert.equal(submissions[0].task.id, task.id);
});

test('after a safe-to-retry failure only the goal continuation is released, never a queued user message', async () => {
  for (const automaticGoal of [true, false]) {
    const { widget, submissions } = savedGoalHarness();
    widget.codingSessions = widget.codingSessions.map(session => session.id === 'A' ? { ...session,
      turns: [{ id: 'a1', stage: 'error', failure: { code: 'RATE_LIMITED', kind: 'rate_limited', retryable: true, retrySafe: true } }],
      goal: { id: 'goal-A', prompt: 'Finish A', status: 'active', createdAt: 1, updatedAt: 1, attempts: 0 } } : session);
    widget.enqueueFollowUpTask('A', 'coding', automaticGoal ? goalRequestPrompt('Finish A', 'continue') : 'ordinary message', [], automaticGoal ? { automaticGoal } : {});
    widget.followUpDrainReadySessionIds.add('A');
    await widget.drainFollowUpQueue('A');
    assert.equal(submissions.length, automaticGoal ? 1 : 0, `automaticGoal=${automaticGoal}`);
  }
});
