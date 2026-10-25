import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import {
  GOAL_MAX_AUTOMATIC_ATTEMPTS,
  goalRequestPrompt,
  goalRetryableFailure,
  goalTurnDecision,
  goalUpdateReminder
} from '../lib/browser/nextmux-goal-continuation.js';
import { goalTurnPresentation } from '../lib/browser/nextmux-goal-presentation.js';
import { agentPauseBlocksAutomaticDispatch, appendFollowUpTask } from '../lib/browser/nextmux-agent-task-queue.js';
import { autoResumeDelayMs } from '../lib/browser/nextmux-agent-activity.js';
import { normalizeGoalTiming, pauseGoalTiming, resumeGoalTiming } from '../lib/browser/nextmux-goal-elapsed.js';
import { goalEditorText } from '../lib/browser/nextmux-goal-schedule-locale.js';
import { goalFileBody } from '../lib/browser/nextmux-goal-file-format.js';

const blocks = reason =>
  ['cancel_requested', 'pause_requested', 'user_input_requested'].includes(reason)
  || agentPauseBlocksAutomaticDispatch(reason);

test('tolerant final-line markers and footer stripping support markdown emphasis while rejecting fences and quotes', () => {
  const prompt = goalRequestPrompt('Ship release v2', 'start');
  for (const [marker, expectedKind] of [
    ['**[GOAL_COMPLETE]**', 'complete'],
    ['`[GOAL_COMPLETE]`', 'complete'],
    ['- [GOAL_COMPLETE].', 'complete'],
    ['* [GOAL_BLOCKED]!', 'pause'],
    ['__[GOAL_BLOCKED]__', 'pause']
  ]) {
    const turn = {
      prompt,
      goalPresentationOrigin: 'automatic-v1',
      stage: 'complete',
      response: `All verification checks finished.\n${marker}\n`
    };
    const decision = goalTurnDecision([turn], blocks);
    assert.equal(decision.kind, expectedKind, marker);
    const shown = goalTurnPresentation(turn);
    assert.equal(shown.response, 'All verification checks finished.', `footer stripped for ${marker}`);
  }

  for (const invalidResponse of [
    'Example:\n```txt\n[GOAL_COMPLETE]\n```',
    'Indented:\n    [GOAL_COMPLETE]',
    'Quoted:\n> [GOAL_COMPLETE]'
  ]) {
    const turn = {
      prompt,
      goalPresentationOrigin: 'automatic-v1',
      stage: 'complete',
      response: invalidResponse
    };
    assert.deepEqual(goalTurnDecision([turn], blocks), { kind: 'continue', retry: false }, invalidResponse);
    assert.equal(goalTurnPresentation(turn).response, invalidResponse);
  }
});

test('dual-channel task.update_goal tool events settle or continue goals even without final-line text markers', () => {
  const completedTurn = {
    stage: 'complete',
    response: 'All tasks are complete and verified.',
    events: [
      {
        type: 'tool_completed',
        toolName: 'task.update_goal',
        summary: { kind: 'goal_status', title: 'completed', detail: 'Done' }
      }
    ]
  };
  assert.deepEqual(goalTurnDecision([completedTurn], blocks), { kind: 'complete' });

  const blockedTurn = {
    stage: 'complete',
    response: 'Waiting on production database credentials.',
    events: [
      {
        type: 'tool_completed',
        toolName: 'task.update_goal',
        summary: { kind: 'goal_status', title: 'blocked', detail: 'Missing DB credentials' }
      }
    ]
  };
  assert.deepEqual(goalTurnDecision([blockedTurn], blocks), { kind: 'pause', reason: 'blocked' });
});

test('live goal edit race ignores completion/blocked markers from turns started before goalUpdatedAt unless steered', () => {
  const staleCompleteTurn = {
    id: 'turn-old',
    createdAt: 1_000,
    completedAt: 2_000,
    stage: 'complete',
    response: 'Done with old goal.\n[GOAL_COMPLETE]',
    events: [
      {
        type: 'tool_completed',
        toolName: 'task.update_goal',
        summary: { kind: 'goal_status', title: 'completed' }
      }
    ]
  };
  // Goal was edited at t=1500 without steering acceptance on turn-old: must continue for the new objective.
  assert.deepEqual(goalTurnDecision([staleCompleteTurn], blocks, 1_500), { kind: 'continue', retry: false });

  // If the turn accepted the goal_update steering at or after goalUpdatedAt, its completion marker is honored.
  const steeredCompleteTurn = {
    ...staleCompleteTurn,
    steeringMessages: [
      {
        id: 'steer-1',
        kind: 'goal_update',
        content: 'New objective',
        createdAt: new Date(1_600).toISOString(),
        status: 'accepted'
      }
    ]
  };
  assert.deepEqual(goalTurnDecision([steeredCompleteTurn], blocks, 1_500), { kind: 'complete' });

  // Fallback direction reminder also counts as applying the goal update.
  const reminderSteeredTurn = {
    ...staleCompleteTurn,
    steeringMessages: [
      {
        id: 'steer-2',
        kind: 'direction',
        content: goalUpdateReminder('New objective'),
        createdAt: new Date(1_600).toISOString(),
        status: 'accepted'
      }
    ]
  };
  assert.deepEqual(goalTurnDecision([reminderSteeredTurn], blocks, 1_500), { kind: 'complete' });
});

test('output_truncated and non-checkpoint limit stops continue automatically while checkpointed or user pauses wait', () => {
  for (const stopReason of [
    'output_truncated',
    'turn_limit_reached',
    'tool_call_limit_reached',
    'segment_limit_reached'
  ]) {
    assert.deepEqual(
      goalTurnDecision([{ stage: 'complete', stopReason, response: 'Partial work' }], blocks),
      { kind: 'continue', retry: false },
      `complete+${stopReason}`
    );
    assert.deepEqual(
      goalTurnDecision([{ stage: 'paused', stopReason, response: 'Partial work' }], blocks),
      { kind: 'continue', retry: false },
      `paused+${stopReason} without checkpoint`
    );
  }

  assert.deepEqual(
    goalTurnDecision(
      [{ stage: 'paused', stopReason: 'turn_limit_reached', resumeCheckpointId: 'cp-1', response: 'Paused' }],
      blocks
    ),
    { kind: 'wait' },
    'checkpointed pause must defer to checkpoint resume scheduler'
  );
});

test('non-tool progress (changes, childAgents, commandExecutions, substantive output) resets trailingIdleGoalTurns', () => {
  const idle = {
    stage: 'complete',
    goalPresentationOrigin: 'automatic-v1',
    response: 'Still thinking.',
    events: [{ type: 'assistant_delta' }]
  };
  for (const worked of [
    { ...idle, changes: [{ path: 'src/index.ts' }] },
    { ...idle, fileChanges: [{ path: 'README.md' }] },
    { ...idle, childAgents: [{ childRunId: 'sub-1', task: 'Audit module' }] },
    { ...idle, commandExecutions: [{ command: 'pnpm test' }] },
    { ...idle, response: '```ts\nexport const x = 1;\n```' },
    { ...idle, response: 'A'.repeat(620) }
  ]) {
    assert.deepEqual(
      goalTurnDecision([idle, idle, worked], blocks),
      { kind: 'continue', retry: false }
    );
    assert.deepEqual(
      goalTurnDecision([worked, idle, idle], blocks),
      { kind: 'continue', retry: false }
    );
  }
  assert.deepEqual(
    goalTurnDecision([idle, idle, idle], blocks),
    { kind: 'pause', reason: 'idle' }
  );
});

test('max automatic attempts cap pauses the goal with max_attempts reason', () => {
  const worked = {
    stage: 'complete',
    goalPresentationOrigin: 'automatic-v1',
    response: 'Progress step.',
    events: [{ type: 'tool_completed' }]
  };
  assert.deepEqual(
    goalTurnDecision([worked], blocks, undefined, GOAL_MAX_AUTOMATIC_ATTEMPTS - 1),
    { kind: 'continue', retry: false }
  );
  assert.deepEqual(
    goalTurnDecision([worked], blocks, undefined, GOAL_MAX_AUTOMATIC_ATTEMPTS),
    { kind: 'pause', reason: 'max_attempts' }
  );
});

test('widget integration: preserve composer draft on goal commit, user prompt preemption, pause authority, and completed goal replacement', async () => {
  const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const widgetFile = ts.createSourceFile('nextmux-desktop-widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widgetClass = widgetFile.statements.find(
    node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget'
  );
  const methodNames = [
    'openGoalComposer',
    'cancelGoalComposer',
    'submitPrompt',
    'saveGoal',
    'toggleCodingGoal',
    'scheduleGoalContinuation',
    'setCodingGoalStatus',
    'enqueueFollowUpTask',
    'dropUnsubmittedGoalTasks'
  ];
  const methodsCode = methodNames
    .map(name => {
      const m = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetFile) === name);
      assert.ok(m, `missing ${name}`);
      return m.getText(widgetFile);
    })
    .join('\n');

  const clearedTimers = [];
  const callbacks = new Map();
  let nextTimerId = 1;
  const bindings = {
    crypto: webcrypto,
    window: {
      setTimeout(fn, delayMs) {
        const id = nextTimerId++;
        callbacks.set(id, Object.assign(fn, { delayMs }));
        return id;
      },
      clearTimeout(id) {
        clearedTimers.push(id);
        callbacks.delete(id);
      }
    },
    URI: {
      fromFilePath: v => ({
        resolve: p => bindings.URI.fromFilePath(`${v}/${p}`),
        toString: () => v
      })
    },
    BinaryBuffer: { fromString: text => text },
    NextMuxDesktopWidget: { FOLLOW_UP_QUEUE_LIMIT: 20 },
    runningTaskText: (_l, k) => k,
    goalEditorText,
    goalRequestPrompt,
    goalRetryableFailure,
    goalTurnDecision,
    agentPauseBlocksAutomaticDispatch,
    autoResumeDelayMs,
    appendFollowUpTask,
    normalizeGoalTiming,
    pauseGoalTiming,
    resumeGoalTiming,
    goalFileBody,
    bindPriceQuote: route => route,
    activeRunBelongsToSession: (a, b) => a === b,
    requestAnimationFrame: () => 0
  };

  const Harness = new Function(
    ...Object.keys(bindings),
    ts.transpile(`class Harness { ${methodsCode} }; return Harness;`, { target: ts.ScriptTarget.ES2022 })
  )(...Object.values(bindings));

  const route = { id: 'route-1', kind: 'official_connection', connection: { id: 'relay-1', model: 'model-1' } };
  const deletedFiles = [];
  const writtenFiles = [];
  const stoppedSessions = [];
  const notifications = [];

  const session = {
    id: 'session-1',
    turns: [],
    routeId: 'route-1',
    relayKey: 'relay-1',
    modelId: 'model-1',
    reasoningEffort: 'high',
    permissionMode: 'full_access',
    followUpQueue: [],
    goal: {
      id: 'completed-goal-1',
      prompt: 'Old completed goal',
      status: 'completed',
      createdAt: 10,
      updatedAt: 20,
      attempts: 4
    }
  };

  const h = Object.assign(new Harness(), {
    applicationExitPreparing: false,
    isDisposed: false,
    desktopLocale: 'zh-CN',
    activeCodingSessionId: 'session-1',
    activeModelRouteId: 'route-1',
    activeRelayKey: 'relay-1',
    activeAgentRunId: '',
    activeAgentSessionId: '',
    agentStage: 'idle',
    prompt: 'My extra user draft that must be preserved',
    goalDraft: '',
    goalComposerActive: false,
    goalComposerSessionId: '',
    goalEditingSessionId: '',
    goalComposerPreviousPrompt: '',
    codingSessions: [session],
    goalDraftsBySession: new Map(),
    goalEditorDrafts: new Map(),
    goalContinuationTimers: new Set(),
    goalContinuationTimerHandles: new Map(),
    directFollowUpDrainTaskIds: new Map(),
    followUpDrainReadySessionIds: new Set(),
    queuedAttachmentPayloads: new Map(),
    node: { querySelector: () => null },
    activeCodingSession() {
      return this.codingSessions.find(s => s.id === this.activeCodingSessionId);
    },
    ensureCodingSession() {
      return this.activeCodingSession();
    },
    activeModelRoute: () => route,
    codingSessionRelayKey: s => s.relayKey,
    routesForRelay: () => [route],
    modelRoutes: () => [route],
    modelKeyForRoute: r => r.connection.model,
    modelDisplayName: m => m,
    reasoningEffortLevels: () => ['low', 'high'],
    reasoningEffortForRoute: () => 'high',
    reasoningSettingsForRoute: () => ({}),
    codingSessionWorkspaceRoot: () => '/workspace',
    setComposerPrompt(v) {
      this.prompt = v;
    },
    scheduleComposerDraftPersist() {},
    persistCodingSessions() {},
    async persistCodingGoalFile() {},
    submitSavedCodingGoal() {},
    requestFollowUpQueueDrain(id) {
      this.followUpDrainReadySessionIds.add(id);
    },
    updateFollowUpQueue(id, queue) {
      this.codingSessions = this.codingSessions.map(s => (s.id === id ? { ...s, followUpQueue: queue } : s));
      return true;
    },
    conversationHasActiveRun: id => h.activeAgentRunId !== '' && h.activeAgentSessionId === id,
    stopConversationAgentRun: async id => {
      stoppedSessions.push(id);
    },
    addNotification(kind, title, body, convId) {
      notifications.push({ kind, title, body, convId });
    },
    fileService: {
      async delete(uri) {
        deletedFiles.push(uri.toString());
      },
      async writeFile(uri, content) {
        writtenFiles.push({ uri: uri.toString(), content });
      }
    },
    update() {}
  });

  // 1. Completed goal allows openGoalComposer and submitPrompt restores goalComposerPreviousPrompt while replacing old goal file
  h.openGoalComposer();
  assert.equal(h.goalComposerActive, true);
  assert.equal(h.goalComposerPreviousPrompt, 'My extra user draft that must be preserved');
  h.prompt = 'Brand new persistent objective';
  assert.equal(await h.submitPrompt('coding'), true);
  assert.equal(h.prompt, 'My extra user draft that must be preserved', 'ordinary composer prompt must be restored after committing goal draft');
  assert.equal(h.codingSessions[0].goal.prompt, 'Brand new persistent objective');
  assert.equal(h.codingSessions[0].goal.status, 'active');
  assert.deepEqual(deletedFiles, ['/workspace/.nextmux/goals/completed-goal-1.md']);
  assert.equal(writtenFiles[0]?.uri, '/workspace/.nextmux/goals/completed-goal-1.deleted');

  // 2. Schedule continuation, then user enqueues an extra prompt: pending timer & unsubmitted automaticGoal tasks are preempted
  const turn1 = { id: 'turn-1', stage: 'complete', response: 'Working on step 1.' };
  h.codingSessions[0] = { ...h.codingSessions[0], turns: [turn1] };
  h.scheduleGoalContinuation('session-1', turn1);
  assert.equal(h.goalContinuationTimers.has('session-1'), true);
  assert.equal(h.goalContinuationTimerHandles.has('session-1'), true);

  assert.equal(h.enqueueFollowUpTask('session-1', 'coding', 'User extra instruction first', [], {}), true);
  assert.equal(h.goalContinuationTimers.has('session-1'), false, 'user task must cancel pending goal continuation timer');
  assert.equal(clearedTimers.length, 1);
  assert.deepEqual(
    h.codingSessions[0].followUpQueue.map(t => ({ prompt: t.prompt, auto: Boolean(t.automaticGoal) })),
    [{ prompt: 'User extra instruction first', auto: false }]
  );

  // 3. When user task is already queued at turn completion, scheduleGoalContinuation drains user task instead of queuing automaticGoal
  h.followUpDrainReadySessionIds.clear();
  h.scheduleGoalContinuation('session-1', turn1);
  assert.equal(h.goalContinuationTimers.has('session-1'), false);
  assert.equal(h.followUpDrainReadySessionIds.has('session-1'), true);

  // 4. Clicking Pause stops active run, clears timers/automatic queue, and user pause authority is never overwritten
  h.codingSessions[0] = { ...h.codingSessions[0], followUpQueue: [] };
  h.scheduleGoalContinuation('session-1', turn1);
  h.activeAgentRunId = 'run-live-1';
  h.activeAgentSessionId = 'session-1';
  h.toggleCodingGoal();
  assert.equal(h.codingSessions[0].goal.status, 'paused');
  assert.deepEqual(stoppedSessions, ['session-1'], 'pausing goal must stop active conversation run');
  assert.equal(h.goalContinuationTimers.has('session-1'), false);

  // Settling turn cannot overwrite user-paused goal
  const completeTurn = { id: 'turn-2', stage: 'complete', response: 'Finished.\n[GOAL_COMPLETE]' };
  h.codingSessions[0] = { ...h.codingSessions[0], turns: [completeTurn] };
  h.scheduleGoalContinuation('session-1', completeTurn);
  assert.equal(h.codingSessions[0].goal.status, 'paused', 'user-paused goal must never be overwritten by settling turn');

  // 5. Resuming resets attempts to 0; reaching GOAL_MAX_AUTOMATIC_ATTEMPTS pauses and notifies
  h.activeAgentRunId = '';
  h.codingSessions[0] = {
    ...h.codingSessions[0],
    goal: { ...h.codingSessions[0].goal, attempts: GOAL_MAX_AUTOMATIC_ATTEMPTS }
  };
  h.toggleCodingGoal();
  assert.equal(h.codingSessions[0].goal.status, 'active');
  assert.equal(h.codingSessions[0].goal.attempts, 0, 'resuming goal must reset attempts to 0');

  const maxAttemptTurn = {
    id: 'turn-max',
    stage: 'complete',
    response: 'Still working.',
    events: [{ type: 'tool_completed' }]
  };
  h.codingSessions[0] = {
    ...h.codingSessions[0],
    followUpQueue: [],
    turns: [maxAttemptTurn],
    goal: { ...h.codingSessions[0].goal, attempts: GOAL_MAX_AUTOMATIC_ATTEMPTS }
  };
  h.scheduleGoalContinuation('session-1', maxAttemptTurn);
  assert.equal(h.codingSessions[0].goal.status, 'paused');
  assert.equal(notifications.at(-1)?.title, '达到自动推进轮次上限，目标已暂停');
});
