import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConversationHistoryMirror,
  mergeConversationHistorySessions,
  portableConversationHistorySessions,
  readConversationHistoryMirror,
  reusableConversationForWorkspace,
  resolveOwnedConversationWorkspacePaths,
  selectConversationWorkspaceForkSource,
} from '../lib/browser/nextmux-conversation-history.js';

const at = '2026-08-31T00:00:00.000Z';

const session = (id, updatedAt, turns, historyRevision) => ({
  id,
  workspacePath: '/workspace',
  title: id,
  updatedAt,
  createdAt: 1,
  turns,
  ...(historyRevision === undefined ? {} : { historyRevision }),
});

const turn = (id, createdAt, response = '') => ({ id, createdAt, prompt: id, response, error: '' });

test('history retains only bounded model diagnostic enums beside the existing attempt identity', () => {
  const diagnostic = { kind: 'object', source: 'sdk_stream_error', streamType: 'response.failed', streamCode: 'server_error', providerErrorType: 'upstream_error' };
  const failure = { code: 'MODEL_CALL_FAILED', reason: '模型调用失败', stage: 'unknown', category: 'unknown',
    retryable: false, retrySafe: false, providerAttemptId: 'attempt-safe', diagnostic: { ...diagnostic, body: 'PRIVATE' } };
  const original = session('failed', 2, [{ ...turn('turn-failed', 1), events: [{ type: 'model_attempt_completed', at, startedAt: at,
    turn: 1, attempt: 1, outcome: 'failed', durationMs: 1, retryScheduled: false, failure }] }]);
  const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([original]))).sessions[0].turns[0];
  assert.deepEqual(restored.events[0].failure.diagnostic, diagnostic);
  assert.equal(restored.events[0].failure.providerAttemptId, 'attempt-safe');
  assert.equal(restored.events[0].failure.category, 'unknown');
  assert.equal(restored.events[0].retryScheduled, false);
  assert.doesNotMatch(JSON.stringify(restored), /PRIVATE/);
  assert.equal(original.turns[0].events[0].failure.diagnostic.body, 'PRIVATE');
});

test('history retains deletion checkpoint ids beyond preview budget and restored receipts', () => {
  const changed = { ...turn('edited', 1), changes: Array.from({ length: 130 }, (_, i) => ({
    checkpointId: `checkpoint-${i}`, path: `file-${i}.ts`, kind: i === 129 ? 'deleted' : 'modified', patch: 'diff', additions: 1, deletions: 1
  })), restoredCheckpointIds: ['checkpoint-129'], checkpointWarnings: ['Coverage limited'], verification: {
    status: 'unverified', revision: 2, changedPaths: ['file-129.ts'], checks: [
      { callId: 'check', command: 'node --test', status: 'passed', exitCode: 0, revision: 1, afterLastChange: false }
    ]
  } };
  const mirrored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([session('one', 2, [changed])])));
  const restored = mirrored.sessions[0].turns[0];
  assert.equal(restored.changes.length, 130);
  assert.equal(restored.changes[129].kind, 'deleted');
  assert.equal(restored.changes[129].patch, '');
  assert.deepEqual(restored.restoredCheckpointIds, ['checkpoint-129']);
  assert.equal(restored.verification.status, 'unverified');
});

test('local conversation mirror is versioned, bounded, and never mutates full history', () => {
  const original = session('one', 20, Array.from({ length: 20 }, (_, index) => turn(`turn-${index}`, index, 'x'.repeat(100))));
  const mirror = createConversationHistoryMirror([original], {
    sessions: 1,
    turnsPerSession: 3,
    promptCharacters: 20,
    responseCharacters: 12,
    errorCharacters: 10,
  });

  assert.equal(mirror.version, 2);
  assert.equal(mirror.complete, false);
  assert.deepEqual(mirror.sessions[0].turns.map(item => item.id), ['turn-17', 'turn-18', 'turn-19']);
  assert.equal(mirror.sessions[0].turns[0].response.length, 12);
  assert.equal(original.turns.length, 20);
  assert.equal(original.turns[0].response.length, 100);
});

test('conversation history preserves reply feedback lineage and migrates a legacy final request ID', () => {
  const current = createConversationHistoryMirror([session('feedback', 20, [{
    ...turn('rated-turn', 1, 'done'),
    relayRequestId: 'managed-request-2',
    relayRequestIds: ['managed-request-1', 'managed-request-2', 'managed-request-1', 'unsafe request'],
    relayFeedback: 'down',
  }])]).sessions[0].turns[0];
  assert.deepEqual(current.relayRequestIds, ['managed-request-1', 'managed-request-2']);
  assert.equal(current.relayRequestId, 'managed-request-2');
  assert.equal(current.relayFeedback, 'down');

  const legacy = readConversationHistoryMirror(JSON.stringify([session('legacy-feedback', 10, [{
    ...turn('legacy-rated-turn', 1, 'done'), relayRequestId: 'legacy-request', relayFeedback: 'up',
  }])])).sessions[0].turns[0];
  assert.deepEqual(legacy.relayRequestIds, ['legacy-request']);
  assert.equal(legacy.relayFeedback, 'up');
});

test('conversation mirrors discard machine-local private workspace paths from new and legacy data', () => {
  const windowsPath = 'C:\\Users\\old-machine\\NextMux\\conversation-workspaces\\one';
  const original = { ...session('owned', 20, []), ownedWorkspace: true, privateWorkspacePath: windowsPath };
  const mirror = createConversationHistoryMirror([original]);
  const legacy = readConversationHistoryMirror(JSON.stringify([original]));

  assert.equal(Object.hasOwn(mirror.sessions[0], 'privateWorkspacePath'), false);
  assert.equal(Object.hasOwn(legacy.sessions[0], 'privateWorkspacePath'), false);
  assert.equal(mirror.sessions[0].ownedWorkspace, true);
  assert.equal(legacy.sessions[0].ownedWorkspace, true);
});

test('portable history snapshots strip only machine-local paths and retain clean record identity', () => {
  const clean = { ...session('project', 10, []), ownedWorkspace: false };
  const local = { ...session('owned', 20, []), ownedWorkspace: true, privateWorkspacePath: '/local/owned' };
  const portable = portableConversationHistorySessions([clean, local]);

  assert.equal(portable[0], clean);
  assert.notEqual(portable[1], local);
  assert.equal(Object.hasOwn(portable[1], 'privateWorkspacePath'), false);
  assert.equal(local.privateWorkspacePath, '/local/owned');
});

test('owned workspace paths are re-derived locally and failures never revive imported paths', async () => {
  const requested = [];
  const bindings = [{ id: 'owned', ownedWorkspace: true, privateWorkspacePath: 'C:\\stale\\owned' },
    { id: 'failed', ownedWorkspace: true, privateWorkspacePath: 'D:\\stale\\failed' },
    { id: 'project', ownedWorkspace: false, privateWorkspacePath: 'E:\\must-not-resolve' }];
  const resolved = await resolveOwnedConversationWorkspacePaths(bindings, async id => {
    requested.push(id);
    if (id === 'failed') throw new Error('local workspace unavailable');
    return `/Users/local/NextMux/conversation-workspaces/${id}`;
  });

  assert.deepEqual(requested, ['owned', 'failed']);
  assert.equal(resolved.get('owned'), '/Users/local/NextMux/conversation-workspaces/owned');
  assert.equal(resolved.has('failed'), false);
  assert.equal([...resolved.values()].some(path => /^[CDE]:\\/i.test(path)), false);
});

test('fork source selection never forwards an unavailable Windows binding on macOS', () => {
  const migrated = { id: 'owned', ownedWorkspace: true, privateWorkspacePath: 'C:\\stale\\owned', workspacePath: 'D:\\project' };
  const missingProject = { id: 'project', ownedWorkspace: false, workspacePath: 'D:\\project' };
  const localProject = { id: 'local', ownedWorkspace: false, workspacePath: '/Users/local/project' };

  assert.deepEqual(selectConversationWorkspaceForkSource(migrated, ''), { kind: 'owned' });
  assert.deepEqual(selectConversationWorkspaceForkSource(missingProject, ''), { kind: 'owned' });
  assert.deepEqual(selectConversationWorkspaceForkSource(localProject, '/Users/local/project'), {
    kind: 'project', workspaceRoot: '/Users/local/project',
  });
});

test('continuing an unavailable project keeps the same conversation identity', () => {
  const unavailable = { id: 'same-conversation-id', workspacePath: 'C:\\Users\\old-machine\\33' };
  const liveOther = { id: 'other-conversation-id', workspacePath: '/Users/local/other' };
  const openWorkspaces = new Set(['/Users/local/current', '/Users/local/other']);
  const isOpen = path => openWorkspaces.has(path);

  assert.equal(reusableConversationForWorkspace(unavailable, '', isOpen)?.id, unavailable.id);
  assert.equal(reusableConversationForWorkspace(unavailable, '/Users/local/current', isOpen), undefined);
  assert.equal(reusableConversationForWorkspace(liveOther, '/Users/local/current', isOpen), undefined);
  assert.equal(reusableConversationForWorkspace({ id: 'no-project', workspacePath: '' }, '/Users/local/current', isOpen), undefined);
});

test('local conversation mirror keeps attachment metadata in order without binary payloads', () => {
  const attachments = [
    {
      id: 'image-a', uri: 'file:///cache/image.png', name: 'image.png', kind: 'image', mimeType: 'image/png',
      workspaceRelativePath: '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      dataBase64: 'binary-image-sentinel', content: 'text-sentinel',
    },
    {
      id: 'file-a', uri: 'data:application/pdf;base64,binary-uri-sentinel', name: 'report.pdf', kind: 'file', mimeType: 'application/pdf',
      workspaceRelativePath: '.nextmux/conversation-attachments/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf',
      dataBase64: 'binary-file-sentinel',
    },
  ];
  const queuedAttachments = [{
    ...attachments[0], size: 123,
  }];
  const original = {
    ...session('attachments', 20, [{ ...turn('turn-with-attachments', 1), attachments }]),
    followUpQueue: [{
      id: 'queued', sessionId: 'attachments', source: 'user', prompt: 'queued', workbench: 'coding',
      routeId: 'route', relayKey: 'relay', modelLabel: 'Model', permissionMode: 'workspace_write',
      attachments: queuedAttachments, createdAt: 2,
    }],
  };

  const mirror = createConversationHistoryMirror([original]);
  const serialized = JSON.stringify(mirror);
  const restored = mirror.sessions[0];

  assert.equal(serialized.includes('binary-image-sentinel'), false);
  assert.equal(serialized.includes('binary-file-sentinel'), false);
  assert.equal(serialized.includes('binary-uri-sentinel'), false);
  assert.equal(serialized.includes('text-sentinel'), false);
  assert.deepEqual(restored.turns[0].attachments.map(item => item.id), ['image-a', 'file-a']);
  assert.deepEqual(restored.turns[0].attachments.map(item => item.uri), ['file:///cache/image.png', '']);
  assert.deepEqual(restored.turns[0].attachments.map(item => item.workspaceRelativePath), [
    '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    '.nextmux/conversation-attachments/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf',
  ]);
  assert.deepEqual(restored.followUpQueue[0].attachments[0], {
    id: 'image-a', uri: 'file:///cache/image.png', size: 123, name: 'image.png', kind: 'image', mimeType: 'image/png',
    workspaceRelativePath: '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
  });
});

test('local conversation mirror whitelists every persisted level while preserving legal event and checkpoint fields', () => {
  const leaked = suffix => ({
    dataBase64: `LEAK_DATA_${suffix}`,
    content: `LEAK_CONTENT_${suffix}`,
    binary: `LEAK_BINARY_${suffix}`,
    extension: {
      dataBase64: `LEAK_NESTED_DATA_${suffix}`,
      content: `LEAK_NESTED_CONTENT_${suffix}`,
      binary: `LEAK_NESTED_BINARY_${suffix}`,
    },
  });
  const original = {
    ...session('safe-session', 20, [{
      ...turn('safe-turn', 2, 'assistant response'),
      userMessageId: 'safe-user-message',
      assistantMessageId: 'safe-assistant-message',
      modelPrompt: 'provider prompt',
      pastedTextReferences: '[[long-text:one]]',
      stage: 'complete',
      completedAt: 3,
      permissionMode: 'full_access',
      routeLabel: 'route',
      executionLabel: 'execution',
      usageLabel: 'usage',
      billingLabel: 'billing',
      failoverCount: 1,
      resumeCheckpointId: 'resume-checkpoint',
      autoResumeAttempts: 2,
      attachments: [{
        id: 'attachment-one',
        uri: 'file:///cache/one.txt',
        name: 'one.txt',
        kind: 'text',
        mimeType: 'text/plain',
        inlineReference: '[[long-text:one]]',
        workspaceRelativePath: '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt',
        ...leaked('ATTACHMENT'),
      }],
      changes: [{
        checkpointId: 'checkpoint-one',
        path: 'src/one.ts',
        kind: 'modified',
        binary: false,
        additions: 2,
        deletions: 1,
        patch: '@@ -1 +1 @@',
        truncated: false,
        createdAt: '2026-08-31T00:00:00.000Z',
        startLine: 1,
        endLine: 2,
        beforeContent: 'before',
        afterContent: 'after',
        extension: leaked('CHANGE_EXTENSION'),
      }],
      events: [{
        type: 'tool_completed',
        callId: 'call-one',
        toolName: 'file.write',
        ok: true,
        summary: {
          title: 'Edited one.ts',
          commandLine: 'node test.mjs',
          details: ['one', 'two'],
          outcome: 'succeeded',
          checkpointId: 'checkpoint-one',
          resource: { kind: 'file', path: 'src/one.ts', action: 'updated', startLine: 1, endLine: 2, ...leaked('RESOURCE') },
          extension: leaked('SUMMARY_EXTENSION'),
        },
        durationMs: 12,
        at: '2026-08-31T00:00:01.000Z',
        extension: leaked('EVENT_EXTENSION'),
      }, {
        type: 'assistant_progress',
        turn: 1,
        content: 'legitimate visible progress',
        origin: 'runtime',
        at: '2026-08-31T00:00:02.000Z',
      }],
      steeringMessages: [{
        id: 'steering-one',
        content: 'legitimate steering message',
        createdAt: '2026-08-31T00:00:03.000Z',
        status: 'applied',
        appliedAt: '2026-08-31T00:00:04.000Z',
        extension: leaked('STEERING_EXTENSION'),
      }],
      failure: {
        code: 'MODEL_TIMEOUT', message: 'timed out', kind: 'model_timeout', retryable: true,
        retrySafe: false, resumable: true, resumeCheckpointId: 'resume-checkpoint', extension: leaked('FAILURE_EXTENSION'),
      },
      ...leaked('TURN'),
    }]),
    pinned: true,
    sourceConversationId: 'source-conversation',
    sourceMessageId: 'source-message',
    routeId: 'route-id',
    relayKey: 'relay-key',
    modelId: 'provider/stable-model',
    reasoningEffort: 'high',
    permissionMode: 'full_access',
    draftPrompt: 'draft',
    draftPastedTextReferences: '[[long-text:draft]]',
    draftAttachments: [{
      id: 'draft-attachment',
      uri: 'file:///workspace/.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt',
      size: 12,
      name: 'draft.txt',
      kind: 'text',
      mimeType: 'text/plain',
      workspaceRelativePath: '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt',
      ...leaked('DRAFT_ATTACHMENT'),
    }],
    viewState: {
      workContextOpen: true,
      workContextMode: 'file',
      activeBrowserId: 'browser-one',
      contextFileUri: 'file:///workspace/one.ts',
      contextFileMaximized: false,
      terminalDrawerOpen: true,
      terminalScope: 'current',
      workContextWidth: 400,
      contextFileListWidth: 220,
      terminalDrawerHeight: 300,
      terminalListWidth: 210,
      threadScrollTop: 50,
      threadWasAtBottom: false,
      threadAnchorTurnId: 'safe-turn',
      threadAnchorOffset: 8,
      ...leaked('VIEW_STATE'),
    },
    browsers: [{
      id: 'browser-one', url: 'https://example.com', title: 'Example', source: 'manual',
      processId: 'process-one', createdAt: 1, updatedAt: 2, ...leaked('BROWSER'),
    }],
    followUpQueue: [{
      id: 'queue-one', sessionId: 'safe-session', prompt: 'queued prompt', source: 'user', workbench: 'coding',
      routeId: 'route-id', relayKey: 'relay-key', modelLabel: 'Model', reasoningEffort: 'medium',
      permissionMode: 'workspace_write', attachments: [], createdAt: 4, error: 'retry later', ...leaked('QUEUE'),
    }],
    ...leaked('SESSION'),
  };

  const mirror = createConversationHistoryMirror([original]);
  const serialized = JSON.stringify(mirror);
  const restored = mirror.sessions[0];

  assert.doesNotMatch(serialized, /LEAK_/);
  assert.deepEqual(Object.keys(restored), [
    'id', 'workspacePath', 'sourceConversationId', 'sourceMessageId', 'title', 'turns', 'browsers', 'pinned', 'routeId', 'relayKey', 'modelId', 'reasoningEffort',
    'permissionMode', 'viewState', 'followUpQueue', 'draftPrompt', 'draftPastedTextReferences', 'draftAttachments', 'createdAt', 'updatedAt',
  ]);
  assert.equal(restored.modelId, 'provider/stable-model');
  assert.equal(restored.sourceConversationId, 'source-conversation');
  assert.equal(restored.sourceMessageId, 'source-message');
  assert.equal(restored.turns[0].userMessageId, 'safe-user-message');
  assert.equal(restored.turns[0].assistantMessageId, 'safe-assistant-message');
  assert.equal(restored.turns[0].resumeCheckpointId, 'resume-checkpoint');
  assert.equal(restored.turns[0].failure.retrySafe, false);
  assert.deepEqual(restored.turns[0].changes.map(change => change.checkpointId), ['checkpoint-one']);
  assert.deepEqual(restored.turns[0].events.map(event => event.type), ['tool_completed', 'assistant_progress']);
  assert.equal(restored.turns[0].events[0].summary.checkpointId, 'checkpoint-one');
  assert.equal(restored.turns[0].events[0].summary.resource.path, 'src/one.ts');
  assert.equal(restored.turns[0].events[1].content, 'legitimate visible progress');
  assert.equal(restored.turns[0].steeringMessages[0].content, 'legitimate steering message');
  assert.deepEqual(restored.turns[0].attachments.map(item => item.id), ['attachment-one']);
  assert.deepEqual(restored.browsers.map(item => item.id), ['browser-one']);
  assert.deepEqual(restored.followUpQueue.map(item => item.id), ['queue-one']);
  assert.deepEqual(restored.draftAttachments.map(item => item.id), ['draft-attachment']);
  assert.equal(restored.draftAttachments[0].workspaceRelativePath, '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt');
});

test('conversation history keeps a safe browser activity target across reload', () => {
  const original = session('browser-resource', 30, [{
    ...turn('browser-turn', 1),
    events: [{
      type: 'tool_completed', callId: 'browser-call', toolName: 'browser.open', ok: true,
      status: 'succeeded', durationMs: 4, at,
      summary: { title: 'opened page', resource: { kind: 'browser', url: 'https://example.test/docs', title: 'Docs' } },
    }],
  }]);
  const restored = createConversationHistoryMirror([original]).sessions[0];
  assert.deepEqual(restored.turns[0].events[0].summary.resource, {
    kind: 'browser', url: 'https://example.test/docs', title: 'Docs',
  });
});

test('conversation history preserves a bounded file drawer scroll position', () => {
  const restored = createConversationHistoryMirror([{
    ...session('file-scroll', 40, []),
    viewState: {
      workContextOpen: true,
      workContextMode: 'file',
      contextFileListScrollTop: 1234,
    },
  }]).sessions[0];
  assert.equal(restored.viewState.contextFileListScrollTop, 1234);

  const bounded = createConversationHistoryMirror([{
    ...session('file-scroll-bounded', 40, []),
    viewState: {
      workContextOpen: true,
      workContextMode: 'file',
      contextFileListScrollTop: Number.MAX_SAFE_INTEGER,
    },
  }]).sessions[0];
  assert.equal(bounded.viewState.contextFileListScrollTop, 50_000_000);
});

test('conversation history preserves per-file editor reading positions without accepting unsafe keys', () => {
  const fileUri = 'file:///workspace/src/app.ts';
  const restored = createConversationHistoryMirror([{
    ...session('editor-scroll', 40, []),
    viewState: {
      workContextOpen: true,
      workContextMode: 'file',
      contextFileUri: fileUri,
      contextFileScrollPositions: {
        [fileUri]: { top: 2345, left: 18 },
        '__proto__': { top: 999 },
        'file:///workspace/unsafe': { top: Number.POSITIVE_INFINITY, left: -20 },
      },
    },
  }]).sessions[0];

  assert.deepEqual(restored.viewState.contextFileScrollPositions, {
    [fileUri]: { top: 2345, left: 18 },
    'file:///workspace/unsafe': { top: 0, left: 0 },
  });
});

test('conversation history keeps observable model phases across reload and drops hidden reasoning', () => {
  const original = {
    ...session('phases', 20, [{
      ...turn('phase-turn', 1),
      events: [
        { type: 'model_phase', turn: 1, phase: 'thinking', attemptId: 'attempt-1', at },
        { type: 'provider_reasoning', turn: 1, visibility: 'visible', content: '  Checking the requested files.  ', status: 'streaming', itemId: 'reason-1', at },
        { type: 'provider_reasoning', turn: 1, visibility: 'hidden', content: 'private chain of thought', status: 'streaming', itemId: 'secret', at },
        { type: 'model_phase', turn: 1, phase: 'responding', at },
        { type: 'model_phase', turn: 1, phase: 'not-a-phase', at },
        { type: 'provider_reasoning', turn: 1, visibility: 'visible', content: '   ', status: 'complete', at },
      ],
    }]),
  };

  const mirror = createConversationHistoryMirror([original]);
  const restored = readConversationHistoryMirror(JSON.stringify(mirror)).sessions[0];
  assert.deepEqual(restored.turns[0].events, [
    { type: 'model_phase', turn: 1, phase: 'thinking', attemptId: 'attempt-1', at },
    { type: 'provider_reasoning', turn: 1, visibility: 'visible', content: 'Checking the requested files.', status: 'streaming', itemId: 'reason-1', at },
    { type: 'model_phase', turn: 1, phase: 'responding', at },
  ]);
});

test('delegated child history is deduplicated and keeps a monotonic event cursor', () => {
  const context = {
    version: 1,
    workspaceRoot: '/workspace',
    conversationId: 'conversation-one',
    goal: 'inspect the project',
    constraints: [],
    relevantPaths: [],
    recentOperations: [],
    parentRunId: 'parent-run',
    rootRunId: 'root-run',
    depth: 1,
    permissionMode: 'workspace_write',
    allowedToolNames: ['workspace.read_file'],
  };
  const child = {
    childRunId: 'child-one', parentRunId: 'parent-run', rootRunId: 'root-run', depth: 1,
    task: 'inspect the project', status: 'completed', firstEventIndex: 8, nextEventIndex: 1,
    startedAt: 10, updatedAt: 20, taskContext: context,
    events: [
      { type: 'assistant_progress', turn: 1, content: 'done', at: '2026-09-01T00:00:00.000Z' },
      { type: 'unknown_event', at: '2026-09-01T00:00:01.000Z' },
    ],
    receipt: {
      outcome: 'completed', retrySafe: true, unknownSideEffect: false,
      summary: 'Child task completed',
    },
    result: {
      runId: 'child-one', status: 'completed', finalText: 'done', usage: {}, turns: 1, toolCalls: 0,
      receipt: {
        outcome: 'completed', retrySafe: true, unknownSideEffect: false,
        summary: 'Child task completed',
      },
    },
  };
  const mirror = createConversationHistoryMirror([session('delegation', 20, [{
    ...turn('turn-with-child', 1),
    childAgents: [child, { ...child, task: 'duplicate must be discarded' }],
  }])]);
  const restoredChild = mirror.sessions[0].turns[0].childAgents[0];
  assert.equal(mirror.sessions[0].turns[0].childAgents.length, 1);
  assert.equal(restoredChild.firstEventIndex, 8);
  assert.equal(restoredChild.nextEventIndex, 9);
  assert.deepEqual(restoredChild.events.map(event => event.type), ['assistant_progress']);
  assert.deepEqual(restoredChild.receipt, {
    outcome: 'completed', retrySafe: true, unknownSideEffect: false,
    summary: 'Child task completed',
  });
  assert.deepEqual(restoredChild.result.receipt, restoredChild.receipt);
});

test('delegated child history preserves the normalized token-budget snapshot after reload', () => {
  const context = {
    version: 1,
    workspaceRoot: '/workspace',
    conversationId: 'conversation-budget',
    goal: 'bounded child task',
    constraints: [],
    relevantPaths: [],
    recentOperations: [],
    parentRunId: 'parent-budget',
    rootRunId: 'root-budget',
    depth: 1,
    permissionMode: 'workspace_write',
    allowedToolNames: ['workspace.read_file'],
    selectedMemory: [{
      id: 'selected-file-001', kind: 'file_ref', ref: 'src/app.ts#L1-L4',
      text: 'Only this explicitly selected excerpt belongs in the child context.',
      sourceRunId: 'root-budget', maxCharacters: 120,
    }],
  };
  const budget = {
    maxInputTokens: 100,
    maxOutputTokens: 32,
    inputTokens: 7,
    outputTokens: 5,
    // Remaining values are intentionally omitted: the mirror must derive them
    // from the ceilings rather than trusting stale persisted counters.
    usageKnown: true,
  };
  const receipt = {
    outcome: 'completed', retrySafe: true, unknownSideEffect: false,
    summary: 'Bounded child task completed', tokenBudget: budget,
  };
  const child = {
    childRunId: 'child-budget', parentRunId: 'parent-budget', rootRunId: 'root-budget', depth: 1,
    task: 'bounded child task', status: 'completed', firstEventIndex: 0, nextEventIndex: 0,
    startedAt: 1, updatedAt: 2, taskContext: context, tokenBudget: budget,
    events: [], receipt,
    result: {
      runId: 'child-budget', status: 'completed', finalText: 'done',
      usage: { inputTokens: 7, outputTokens: 5 }, turns: 1, toolCalls: 0,
      tokenBudget: budget, receipt,
    },
  };

  const restored = createConversationHistoryMirror([session('budget-history', 20, [{
    ...turn('budget-turn', 1), childAgents: [child],
  }])]).sessions[0].turns[0].childAgents[0];
  const expected = {
    maxInputTokens: 100,
    remainingInputTokens: 93,
    maxOutputTokens: 32,
    remainingOutputTokens: 27,
    inputTokens: 7,
    outputTokens: 5,
    usageKnown: true,
  };

  assert.deepEqual(restored.tokenBudget, expected);
  assert.deepEqual(restored.receipt.tokenBudget, expected);
  assert.deepEqual(restored.result.tokenBudget, expected);
  assert.deepEqual(restored.result.receipt.tokenBudget, expected);
  assert.deepEqual(restored.taskContext.selectedMemory, [{
    id: 'selected-file-001', kind: 'file_ref', ref: 'src/app.ts#L1-L4',
    text: 'Only this explicitly selected excerpt belongs in the child context.',
    sourceRunId: 'root-budget', maxCharacters: 120,
  }]);
});

test('mirror reader accepts legacy full arrays and rejects malformed envelopes', () => {
  assert.deepEqual(readConversationHistoryMirror(JSON.stringify([session('legacy', 1, [])])), {
    sessions: [session('legacy', 1, [])],
    legacy: true,
    complete: true,
  });
  assert.deepEqual(readConversationHistoryMirror('{broken'), { sessions: [], legacy: false, complete: false });
  assert.deepEqual(readConversationHistoryMirror(JSON.stringify({ version: 99, complete: false, sessions: [] })), {
    sessions: [], legacy: false, complete: false,
  });
});

test('mirror reader sanitizes current and legacy payloads without losing IDs, order, events, or checkpoints', () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({
    ...turn(`legacy-turn-${index}`, index, `response-${index}`),
    resumeCheckpointId: `resume-${index}`,
    events: [{
      type: 'tool_completed', callId: `call-${index}`, toolName: 'file.write', ok: true,
      summary: { title: `write-${index}`, checkpointId: `checkpoint-${index}`, extension: { content: `LEAK_EVENT_${index}` } },
      durationMs: index, at: `2026-08-31T00:00:0${index}.000Z`, extension: { dataBase64: `LEAK_EVENT_DATA_${index}` },
    }],
    changes: [{
      checkpointId: `checkpoint-${index}`, path: `src/${index}.ts`, kind: 'modified', binary: false,
      additions: 1, deletions: 0, patch: '@@', truncated: false, createdAt: `2026-08-31T00:00:0${index}.000Z`,
    }],
    extension: { content: `LEAK_TURN_${index}`, binary: `LEAK_TURN_BINARY_${index}` },
  }));
  const legacySession = {
    ...session('legacy-safe', 10, turns),
    extension: { dataBase64: 'LEAK_SESSION_DATA', content: 'LEAK_SESSION_CONTENT' },
  };
  const currentSession = {
    ...legacySession,
    id: 'current-safe',
    turns: turns.slice(0, 2),
  };

  const legacy = readConversationHistoryMirror(JSON.stringify([legacySession]));
  const current = readConversationHistoryMirror(JSON.stringify({
    version: 2,
    complete: false,
    sessions: [currentSession],
    extension: { binary: 'LEAK_ENVELOPE_BINARY' },
  }));

  assert.equal(legacy.legacy, true);
  assert.equal(legacy.complete, true);
  assert.deepEqual(legacy.sessions[0].turns.map(item => item.id), turns.map(item => item.id));
  assert.deepEqual(legacy.sessions[0].turns.map(item => item.events[0].callId), turns.map((_, index) => `call-${index}`));
  assert.deepEqual(legacy.sessions[0].turns.map(item => item.changes[0].checkpointId), turns.map((_, index) => `checkpoint-${index}`));
  assert.doesNotMatch(JSON.stringify(legacy), /LEAK_/);

  assert.equal(current.legacy, false);
  assert.equal(current.complete, false);
  assert.deepEqual(current.sessions[0].turns.map(item => item.id), ['legacy-turn-0', 'legacy-turn-1']);
  assert.equal(current.sessions[0].turns[0].events[0].summary.checkpointId, 'checkpoint-0');
  assert.doesNotMatch(JSON.stringify(current), /LEAK_/);
});

test('history mirror removes provider task-plan rows that are raw tool activity', () => {
  const value = session('plan-sanitized', 1, [{
    ...turn('plan-turn', 1, 'done'),
    events: [{
      type: 'task_plan_updated',
      source: 'model',
      steps: [
        { id: 'command', title: 'rg 退出码 0', status: 'completed' },
        { id: 'read', title: '读取 packages/example.ts', status: 'completed' },
        { id: 'real', title: '完成兼容性验证', status: 'in_progress' },
      ],
      at,
    }],
  }]);

  const restored = readConversationHistoryMirror(JSON.stringify({
    version: 2,
    complete: false,
    sessions: [value],
  }));
  const steps = restored.sessions[0].turns[0].events[0].steps;
  assert.deepEqual(steps.map(step => step.title), ['完成兼容性验证']);
});

test('history migration drops retired runtime plans and normalizes old model plans', () => {
  const restored = readConversationHistoryMirror(JSON.stringify([session('legacy-plans', 1, [{
    ...turn('legacy-plan-turn', 1),
    events: [
      {
        type: 'task_plan_updated',
        source: 'runtime',
        steps: [{ id: 'synthetic', title: 'Synthetic runtime plan', status: 'in_progress' }],
        at,
      },
      {
        type: 'task_plan_updated',
        steps: [{ id: 'model', title: 'Model-authored plan', status: 'in_progress' }],
        at,
      },
    ],
  }])]));

  assert.deepEqual(restored.sessions[0].turns[0].events, [{
    type: 'task_plan_updated',
    steps: [{ id: 'model', title: 'Model-authored plan', status: 'in_progress' }],
    source: 'model',
    at,
  }]);
});

test('local conversation mirror only preserves recoverable file attachment URIs', () => {
  const schemes = [
    ['file', 'file:///cache/original.bin'],
    ['https', 'https://example.com/remote.bin'],
    ['data', 'data:application/octet-stream;base64,AAAA'],
    ['blob', 'blob:https://example.com/blob-id'],
    ['browser', 'browser-file:local.bin:4:0'],
  ];
  const original = session('uri-schemes', 20, [{
    ...turn('turn-with-uri-schemes', 1),
    attachments: schemes.map(([id, uri]) => ({ id, uri, name: `${id}.bin`, kind: 'file' })),
  }]);

  const mirror = createConversationHistoryMirror([original]);
  assert.deepEqual(mirror.sessions[0].turns[0].attachments.map(item => item.uri), [
    'file:///cache/original.bin', '', '', '', '',
  ]);
});

test('history revision survives the bounded mirror and malformed revisions are discarded', () => {
  const mirror = createConversationHistoryMirror([
    session('revisioned', 20, [turn('one', 1)], 9),
    { ...session('malformed', 19, [turn('two', 2)]), historyRevision: -1 },
  ]);
  const restored = readConversationHistoryMirror(JSON.stringify(mirror));

  assert.equal(mirror.sessions[0].historyRevision, 9);
  assert.equal(restored.sessions[0].historyRevision, 9);
  assert.equal(Object.hasOwn(restored.sessions[1], 'historyRevision'), false);
});

test('durable merge preserves old turns while applying a newer startup snapshot', () => {
  const durable = session('one', 10, [turn('old', 1, 'durable'), turn('shared', 2, 'old response')], 7);
  const current = session('one', 11, [turn('shared', 2, 'new response'), turn('new', 3, 'new')], 7);

  const result = mergeConversationHistorySessions([current], [durable], {
    mutatedDuringLoad: false,
    initialSessionIds: new Set(['one']),
  });

  assert.deepEqual(result.sessions[0].turns.map(item => item.id), ['old', 'shared', 'new']);
  assert.equal(result.sessions[0].turns[1].response, 'new response');
  assert.equal(result.changedFromDurable, true);
});

test('a newer renderer view state survives a reload before the durable history flush completes', () => {
  const durable = {
    ...session('pane-state', 20, [turn('shared', 1)], 4),
    viewStateUpdatedAt: 100,
    viewState: { workContextWidth: 358, terminalDrawerHeight: 264, terminalListWidth: 218 },
  };
  const current = {
    ...session('pane-state', 20, [turn('shared', 1)], 4),
    viewStateUpdatedAt: 200,
    viewState: { workContextWidth: 422, terminalDrawerHeight: 318, terminalListWidth: 272 },
  };

  const result = mergeConversationHistorySessions([current], [durable], {
    mutatedDuringLoad: false,
    initialSessionIds: new Set(['pane-state']),
  });

  assert.deepEqual(result.sessions[0].viewState, current.viewState);
  assert.equal(result.sessions[0].viewStateUpdatedAt, 200);
  assert.equal(result.sessions[0].updatedAt, 20, 'view-only changes must not reorder conversations');
});

test('a newer destructive history revision never resurrects the deleted durable tail', () => {
  const durableTurns = Array.from({ length: 100 }, (_, index) => turn(`turn-${index + 1}`, index + 1));
  const replacement = turn('turn-60-replacement', 60, 'replacement response');
  const durable = session('rewritten', 100, durableTurns, 12);
  const current = session('rewritten', 101, [...durableTurns.slice(0, 59), replacement], 13);

  const result = mergeConversationHistorySessions([current], [durable], {
    mutatedDuringLoad: true,
    initialSessionIds: new Set(['rewritten']),
  });

  assert.deepEqual(result.sessions[0].turns.map(item => item.id), [
    ...durableTurns.slice(0, 59).map(item => item.id),
    replacement.id,
  ]);
  assert.equal(result.sessions[0].historyRevision, 13);
  assert.equal(result.sessions[0].turns.some(item => item.id === 'turn-100'), false);
  assert.equal(result.changedFromDurable, true);
});

test('the highest history revision wins even when its wall-clock timestamp is older', () => {
  const current = session('clock-skew', 99, [turn('replacement', 1)], 5);
  const durable = session('clock-skew', 100, [turn('deleted-tail', 2)], 4);

  const result = mergeConversationHistorySessions([current], [durable], {
    mutatedDuringLoad: true,
    initialSessionIds: new Set(['clock-skew']),
  });

  assert.deepEqual(result.sessions[0].turns.map(item => item.id), ['replacement']);
  assert.equal(result.sessions[0].historyRevision, 5);
});

test('durable merge does not resurrect a conversation deleted while loading', () => {
  const durable = session('deleted', 10, [turn('old', 1)]);
  const result = mergeConversationHistorySessions([], [durable], {
    mutatedDuringLoad: true,
    initialSessionIds: new Set(['deleted']),
  });
  assert.deepEqual(result.sessions, []);
  assert.equal(result.changedFromDurable, true);
});

test('restart mirror retains multi-root checkpoint ownership and separately preserves prompt baselines and pending editor receipts', () => {
  const before = { ...turn('replacement', 2, 'done'), changes: [{ checkpointId: 'edit', workspaceRoot: '/one', externalTarget: '/outside/a.ts',
    path: '/outside/a.ts', kind: 'modified', patch: '', createdAt: at }],
    workspaceBaselines: [{ checkpointId: 'prepared-restore', workspaceRoot: '/one', path: '/outside/a.ts', externalTarget: '/outside/a.ts' }],
    fileVersionReceipts: [{ checkpointId: 'preview-offline', workspaceRoot: '/two' }] };
  const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([session('one', 3, [before])]))).sessions[0].turns[0];
  assert.equal(restored.changes[0].workspaceRoot, '/one'); assert.equal(restored.changes[0].externalTarget, '/outside/a.ts');
  assert.deepEqual(restored.workspaceBaselines, before.workspaceBaselines);
  assert.deepEqual(restored.fileVersionReceipts, before.fileVersionReceipts);
  const promptOnly = createConversationHistoryMirror([session('branch', 3, [{ ...before, branchUserOnly: true }])]).sessions[0].turns[0];
  assert.equal(promptOnly.workspaceBaselines, undefined); assert.equal(promptOnly.fileVersionReceipts, undefined);
});

test('history keeps readable model metadata for locale changes and provider details after reopening', () => {
  const readableError = { kind: 'rate_limited', detail: 'Rate limit exceeded', code: 'rate_limit_exceeded',
    httpStatus: 429, retryAfterSeconds: 17, source: 'own_api', retryCount: 2 };
  const original = session('readable-error', 3, [{ ...turn('failed', 2), stage: 'error',
    failure: { code: 'MODEL_CALL_FAILED', message: 'localized old message', kind: 'rate_limited', retryable: true, resumable: false, readableError } }]);
  const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([original]))).sessions[0].turns[0];
  assert.equal(restored.failure.readableError.kind, 'rate_limited');
  assert.match(restored.failure.readableError.detail, /Rate limit exceeded/);
  assert.equal(restored.failure.readableError.retryAfterSeconds, 17);
  assert.equal(restored.failure.readableError.source, 'own_api');
  assert.equal(restored.failure.readableError.retryCount, 2);
});

test('history preserves declared reasoning control snapshots while stripping invalid values', () => {
  const settings = { reasoningBudgetTokens: 2048, reasoningEnabled: true, reasoningExclude: false, reasoningMode: 'adaptive' };
  const original = { ...session('reasoning-controls', 2, [{ ...turn('reasoning-turn', 1), reasoningSettings: settings }]),
    reasoningSettings: { ...settings, secret: 'not-a-control' } };
  const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([original]))).sessions[0];
  assert.deepEqual(restored.reasoningSettings, settings);
  assert.deepEqual(restored.turns[0].reasoningSettings, settings);
  assert.equal(original.reasoningSettings.secret, 'not-a-control');
});
