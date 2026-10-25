import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Execute current widget methods and real history/branch helpers. Only UI,
// filesystem, scheduler and model/service ports are isolated; no stale lib.
const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
function sourceModule(filename) {
    const { outputFiles } = desktopRequire('esbuild').buildSync({
        entryPoints: [fileURLToPath(new URL(`../src/browser/${filename}`, import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
    });
    const module = { exports: {} };
    Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}
const history = sourceModule('nextmux-conversation-history.ts');
const persistence = sourceModule('nextmux-conversation-persistence.ts');
const branch = sourceModule('nextmux-conversation-branch.ts');
const paste = sourceModule('nextmux-composer-long-paste.ts');
const queue = sourceModule('nextmux-agent-task-queue.ts');
const childDrafts = sourceModule('../common/nextmux-agent-child-drafts.ts');
const readinessLocale = sourceModule('nextmux-history-readiness-locale.ts');
const conversationLocale = sourceModule('nextmux-conversation-domain-locale.ts');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widgetClass);
const methods = ['loadNextCodingSessionsPage', 'mergeIndexedCodingSessions', 'loadNextCodingHistoryProjects', 'loadCodingSessions', 'restoreDurableCodingSessions', 'loadDurableCodingSessions',
    'conversationHistoryReady', 'discardInitialConversationMirror', 'applyPrivacySettings', 'persistPrivacyMirror', 'persistCodingSessions',
    'changedStartupChildDraftCount', 'setAgentChildDraft', 'childDraft', 'findAgentChild',
    'writeConversationHistoryMirror', 'refreshConversationHistoryPersistDirty', 'flushConversationHistory',
    'beginTurnEdit', 'requestTurnEditConfirmation', 'resetTurnEditRestore', 'confirmTurnEdit',
    'createCodingTurn', 'createCodingSessionBranch', 'branchCodingSession', 'submitPrompt',
    'recordCommittedRestores', 'refreshRestoredContextFiles', 'recordContextFileVersion', 'prepareConversationBranchWorkspace',
    'codingSessionStoredWorkspaceRoots', 'codingSessionWorkspaceRoot', 'createWorkspaceRestorePlan',
    'drainFollowUpQueue', 'answerAgentQuestion', 'submitRunningMessage', 'directSendQueuedFollowUpTask',
    'applyQueuedFollowUpAsDirection', 'scheduleAutomaticResume', 'resumePausedTurn', 'updateFollowUpQueue', 'editQueuedFollowUpTask',
    'continueAgentChild'];
const methodSource = methods.map(name => {
    const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, `actual widget ${name}`); return method.getText(file);
}).join('\n');
const fieldSource = widgetClass.members.filter(node => ts.isPropertyDeclaration(node)
    && /^(codingSessionPage|codingSessionHydrations$|removedCodingSessionIds$|codingHistoryProjects|expandedCodingProjects$)/.test(node.name.getText(file)))
    .map(node => node.getText(file)).join('\n');
const storage = new Map();
const bindings = { ...sourceModule('nextmux-model-errors.ts'), ...sourceModule('nextmux-domain-error-locale.ts'), ...history, ...persistence, ...branch, ...paste, ...queue, ...childDrafts, ...readinessLocale,
  ...sourceModule('nextmux-history-load.ts'),
  ...sourceModule('../common/nextmux-relay-switch.ts'),
  ...require('../lib/common/nextmux-price-quote.js'),
  ...require('../lib/common/nextmux-context-budget.js'),
    crypto: { randomUUID }, ConversationAttachmentRecoveryError: class extends Error {},
    conversationText: (_locale, key) => key, runningTaskText: (_locale, key) => key,
    workbenchText: (_locale, key) => key, agentChildText: (_locale, key) => key, agentChildDraftText: (_locale, key) => key,
    window: { localStorage: { getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } }
};
const Widget = new Function(...Object.keys(bindings), ts.transpile(`class Harness { ${fieldSource}\n${methodSource} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(bindings));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };

function fixture(withChildren = false) {
    const sourceSession = {
        id: '1be6f14d-e7ec-4c62-a2e0-f9bdf59d8bdb', title: 'Synthetic hydrated history',
        workspacePath: '/synthetic/project', ownedWorkspace: false,
        routeId: 'synthetic-route', modelId: 'synthetic-model', permissionMode: 'read_only',
        historyRevision: 0, createdAt: 1, updatedAt: 10,
        turns: Array.from({ length: 6 }, (_, index) => ({
            id: `turn-${index}`, userMessageId: `user-${index}`, assistantMessageId: `assistant-${index}`,
            prompt: `prompt-${index}`, response: index === 2 ? 'LONG_BODY_'.repeat(1000) : `answer-${index}`,
            error: '', stage: 'complete', permissionMode: 'read_only', createdAt: index + 1,
            attachments: [], events: [], changes: []
        }))
    };
    if (withChildren) {
        sourceSession.permissionMode = 'full_access';
        sourceSession.turns[5].childAgents = ['changed', 'unchanged', 'cleared', 'new'].map(childRunId => ({
            childRunId, parentRunId: 'root', rootRunId: 'root', task: 'synthetic', status: 'completed',
            taskContext: { version: 1, depth: 1, workspaceRoot: '/synthetic/project', goal: 'synthetic', permissionMode: 'full_access' }
        }));
        sourceSession.agentChildDrafts = ['changed', 'unchanged', 'cleared'].map(childRunId => ({
            turnId: 'turn-5', childRunId, rootRunId: 'root', text: `old ${childRunId}`
        }));
    }
    // Use production DEFAULT_MIRROR_LIMITS: 4 latest turns / 4,000 response chars.
    storage.set('nextmux.desktop.codingSessions.v1', JSON.stringify(history.createConversationHistoryMirror([sourceSession])));
    const load = deferred(), widget = new Widget(), patches = [], submissions = [], schedules = [], notices = [];
    let durable = [structuredClone(sourceSession)];
    const route = { id: 'synthetic-route', kind: 'official_connection',
        connection: { modelFamily: 'synthetic', providerName: 'offline' } };
    Object.assign(widget, {
        conversationWindows: [],
        publishConversationWindowChanges: async () => undefined,
        privacySettings: { saveConversationHistory: true }, conversationHistoryRevision: 0,
        conversationHistoryLoadGeneration: 0, conversationHistoryLoadFailed: false, isDisposed: false,
        conversationHistoryPersistenceReady: false, conversationHistoryPersistDirty: false,
        conversationHistoryPersistedSessions: persistence.createConversationPersistenceBaseline([]),
        conversationHistoryMirrorLegacy: false, codingSessions: [], activeCodingSessionId: sourceSession.id,
        // Keep the harness aligned with the production widget's pagination
        // and async hydration state. These collections are part of the
        // persistence contract, not UI conveniences.
        codingSessionOrder: [], codingSessionPageCursors: new Map(), codingSessionPageTotals: new Map(),
        codingSessionPagesLoaded: new Set(), codingSessionPagesLoading: new Set(),
        removedCodingSessionIds: new Set(), codingSessionHydrations: new Map(), codingSessionNavigationGeneration: 0,
        codingSearchMatches: new Map(), codingSearchRequestToken: 0, codingSearchResultQuery: '',
        desktopLocale: 'en', turnEditSubmitting: false, editingTurnId: '', editingTurnValue: '',
        defaultPermissionMode: 'read_only', liveAgentChildren: [],
        conversationHasActiveRun(id) { return this.activeAgentSessionId === id && Boolean(this.activeAgentRunId || this.agentStage === 'running'); },
        activeWorkspaceRoot: '/synthetic/project', codingSessionTitle: prompt => prompt.slice(0, 60),
        applicationExitPreparing: false, pendingAgentSubmissions: new Set(), scheduledAgentRuns: new Map(),
        scheduledTasks: [], runningScheduledTaskIds: new Set(),
        hasPendingAttachmentImports: () => false, hasUnresolvedDraftAttachments: () => false,
        turnAttachmentPayloads: new Map(), turnEditError: '',
        // Reader has already validated the fixture; normalization is not a merge or a write.
        normalizeCodingSessions: records => structuredClone(records),
        platformService: {
            loadConversationHistory: () => load.promise,
            async clearConversationHistory() { durable = []; },
            async patchConversationHistory(patch) {
                patches.push(structuredClone(patch));
                durable = durable.filter(item => !patch.removedSessionIds.includes(item.id));
                for (const item of patch.upserts) durable = [...durable.filter(old => old.id !== item.id), structuredClone(item)];
            }
        },
        scheduleConversationHistoryPersist(delay) { if (this.conversationHistoryPersistenceReady) schedules.push(delay); },
        update() {}, focusTurnEditor() {}, flushComposerDraft() {}, hydrateDelegationLedgersForSession() {},
        activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
        modelRoutes: () => [route], activeModelRoute: () => route, modelKeyForRoute: () => 'synthetic-model',
        codingSessionRelayKey: () => 'synthetic-api', routesForRelay: key => key === 'synthetic-api' ? [route] : [],
        reasoningEffortLevels: () => [], conversationMutations: { tryAcquire: () => () => {} },
        resolveTurnAttachments: async () => [], routeSupportsAttachment: () => true,
        discardSessionFollowUpQueue() {}, workspaceRootIsOpen: path => Boolean(path),
        cloneInMemoryTurnAttachmentsForBranch() {},
        openCodingSession(id) { this.activeCodingSessionId = id; },
        async executePromptSubmission(...args) { submissions.push(args); return true; },
        addNotification(...args) { notices.push(args); }
    });
    widget.loadCodingSessions();
    assert.equal(widget.codingSessions[0].turns.length, 4);
    assert.equal(widget.codingSessions[0].turns[0].response.length, 4000);
    assert.equal(widget.conversationHistoryInitialSnapshot.complete, false);
    const restoring = widget.restoreDurableCodingSessions();
    return { widget, sourceSession, patches, submissions, schedules, notices, load, restoring,
        get durable() { return durable; },
        async hydrate() { load.resolve({ status: 'ok', sessions: structuredClone(durable) }); await restoring;
            assert.deepEqual(notices, []); assert.equal(widget.conversationHistoryPersistenceReady, true,
                JSON.stringify({ failed: widget.conversationHistoryLoadFailed, notices, sessions: widget.codingSessions.length })); }
    };
}

async function editLast(f) {
    const { widget, sourceSession } = f;
    widget.beginTurnEdit(sourceSession.id, 'turn-5');
    widget.editingTurnValue = 'Explicit synthetic edit';
    widget.requestTurnEditConfirmation(sourceSession.id, 'turn-5');
    await widget.confirmTurnEdit('replace');
    assert.equal(widget.turnEditError, '');
}

test('history loading blocks opening an editor seeded with a truncated visible message', async () => {
    const f = fixture();
    f.widget.beginTurnEdit(f.sourceSession.id, 'turn-2');
    try { assert.equal(f.widget.editingTurnId, '', 'Do not edit the incomplete renderer snapshot before durable hydration'); }
    finally { await f.hydrate(); }
});

test('direct, queued, resumed and prepared submissions stop before dispatch and do not consume composer payload', async () => {
    const f = fixture(), widget = f.widget;
    widget.prompt = 'New synthetic input'; widget.attachments = [{ id: 'fixture-attachment' }];
    widget.pastedTextReferences = [{ id: 'fixture-paste' }];
    const before = JSON.stringify([widget.prompt, widget.attachments, widget.pastedTextReferences]);
    // Queued and resumed executions always carry their owning session (notifications are filed under it).
    for (const args of [[], [{ task: {}, session: f.sourceSession }], [undefined, { turn: {}, session: f.sourceSession }], [undefined, undefined, { prompt: 'edited' }]]) {
        assert.equal(await widget.submitPrompt('coding', ...args), false);
    }
    assert.equal(f.submissions.length, 0); assert.equal(widget.pendingAgentSubmissions.size, 0);
    assert.equal(JSON.stringify([widget.prompt, widget.attachments, widget.pastedTextReferences]), before);
    await f.hydrate(); assert.equal(await widget.submitPrompt('coding'), true);
});

test('queue, direction, question and automatic-resume entry points do nothing until history is ready', async () => {
    const f = fixture(), widget = f.widget;
    // Deliberately no question broker/queue resolver: any call past the gate fails.
    const before = JSON.stringify(widget.codingSessions);
    await widget.drainFollowUpQueue(f.sourceSession.id);
    await widget.directSendQueuedFollowUpTask(f.sourceSession.id, 'synthetic-task');
    await widget.applyQueuedFollowUpAsDirection(f.sourceSession.id, 'synthetic-task');
    await widget.editQueuedFollowUpTask(f.sourceSession.id, 'synthetic-task');
    assert.equal(widget.updateFollowUpQueue(f.sourceSession.id, []), false);
    await widget.answerAgentQuestion({ questionId: 'synthetic-question' });
    await widget.resumePausedTurn(f.sourceSession.id, 'turn-5');
    await widget.continueAgentChild('synthetic-child');
    widget.scheduleAutomaticResume(f.sourceSession.id, 'turn-5');
    assert.equal(await widget.submitRunningMessage('coding'), false);
    assert.equal(JSON.stringify(widget.codingSessions), before); assert.equal(f.submissions.length, 0);
    await f.hydrate();
});

test('failed load can be retried single-flight, and failure text never enters the visible state', async () => {
    const f = fixture(); f.load.reject(new Error('SYNTHETIC_PRIVATE_FAILURE'));
    await f.restoring; assert.equal(f.widget.conversationHistoryLoadFailed, true);
    assert.equal(f.widget.conversationHistoryReady(), false); assert.deepEqual(f.notices, []);
    const retry = deferred(); let calls = 0;
    f.widget.platformService.loadConversationHistory = () => { calls++; return retry.promise; };
    const a = f.widget.restoreDurableCodingSessions(), b = f.widget.restoreDurableCodingSessions();
    assert.equal(calls, 1); assert.equal(f.widget.conversationHistoryLoadFailed, false);
    retry.resolve({ status: 'ok', sessions: [f.sourceSession] }); await Promise.all([a, b]);
    assert.equal(f.widget.conversationHistoryReady(), true); assert.equal(f.widget.conversationHistoryLoadPromise, undefined);
});

test('a legacy history-off setting cannot discard startup history or the current unsent draft', async () => {
    const f = fixture(), widget = f.widget;
    const original = widget.codingSessions[0];
    widget.codingSessions = [{ ...original, draftPrompt: 'Typed during startup', updatedAt: 11 },
        { ...original, id: 'new-session', turns: [], draftPrompt: 'New session draft' }];
    widget.persistCodingSessions();
    widget.applyPrivacySettings({ saveConversationHistory: false });
    assert.equal(widget.privacySettings.saveConversationHistory, true);
    assert.equal(widget.codingSessions[0].turns.length, 4);
    assert.equal(widget.codingSessions[0].draftPrompt, 'Typed during startup');
    const pending = widget.restoreDurableCodingSessions();
    assert.equal(widget.conversationHistoryReady(), false);
    f.load.resolve({ status: 'ok', sessions: [f.sourceSession] }); await Promise.all([f.restoring, pending]);
    assert.equal(widget.codingSessions.length, 2);
    assert.equal(widget.codingSessions.find(item => item.id === original.id).turns.length, 6);
    assert.equal(widget.codingSessions.find(item => item.id === original.id).draftPrompt, 'Typed during startup');
    assert.equal(widget.codingSessions.find(item => item.id === 'new-session').draftPrompt, 'New session draft');
    assert.equal(widget.conversationHistoryReady(), true);
});

test('legacy false then true settings keep the original single-flight load until it finishes', async () => {
    const f = fixture(), widget = f.widget, pending = widget.conversationHistoryLoadPromise;
    const generation = widget.conversationHistoryLoadGeneration;
    widget.applyPrivacySettings({ saveConversationHistory: false });
    widget.applyPrivacySettings({ saveConversationHistory: true });
    assert.equal(widget.conversationHistoryLoadPromise, pending);
    assert.equal(widget.conversationHistoryLoadGeneration, generation);
    assert.equal(widget.conversationHistoryReady(), false); assert.equal(widget.codingSessions.length, 1);
    f.load.resolve({ status: 'ok', sessions: [f.sourceSession] }); await f.restoring;
    assert.equal(widget.conversationHistoryReady(), true); assert.equal(widget.codingSessions[0].turns.length, 6);
});

test('a legacy false setting cannot hide a failed history load or bypass a safe retry', async () => {
    const f = fixture(), widget = f.widget;
    widget.applyPrivacySettings({ saveConversationHistory: false });
    f.load.reject(new Error('SYNTHETIC_LOAD_FAILURE')); await f.restoring;
    assert.equal(widget.conversationHistoryLoadFailed, true); assert.equal(widget.conversationHistoryReady(), false);
    const next = deferred(); widget.platformService.loadConversationHistory = () => next.promise;
    const pending = widget.restoreDurableCodingSessions();
    next.resolve({ status: 'ok', sessions: [f.sourceSession] }); await pending;
    assert.equal(widget.conversationHistoryReady(), true); assert.deepEqual(f.notices, []);
});

test('an old edit attachment response cannot commit after history loading was restarted', async () => {
    const f = fixture(), widget = f.widget; await f.hydrate();
    const attachment = deferred(); widget.resolveTurnAttachments = () => attachment.promise;
    widget.beginTurnEdit(f.sourceSession.id, 'turn-5'); widget.editingTurnValue = 'Keep this pending edit';
    widget.requestTurnEditConfirmation(f.sourceSession.id, 'turn-5'); const editing = widget.confirmTurnEdit('replace');
    const loading = deferred(); widget.platformService.loadConversationHistory = () => loading.promise;
    const reload = widget.restoreDurableCodingSessions();
    loading.resolve({ status: 'ok', sessions: [f.sourceSession] }); await reload;
    attachment.resolve([]); await editing;
    assert.equal(widget.codingSessions[0].turns.at(-1).prompt, 'prompt-5'); assert.equal(f.submissions.length, 0);
    assert.equal(widget.editingTurnValue, 'Keep this pending edit'); assert.match(widget.turnEditError, /restoreFailed/);
});

test('an old owned workspace fork is discarded, not attached as a partial branch after reload', async () => {
    const f = fixture(), widget = f.widget; await f.hydrate();
    // The fork is intentionally a workspace-bearing branch.  Pure chat
    // branches no longer copy a private cwd, so this regression must include
    // a real checkpoint to exercise the delayed fork/reload race.
    widget.codingSessions = widget.codingSessions.map(session => ({ ...session, ownedWorkspace: true,
        turns: session.turns.map((turn, index) => index === session.turns.length - 1
            ? { ...turn, changes: [{ checkpointId: 'checkpoint-old', path: 'src/app.ts', kind: 'modified' }] }
            : turn) }));
    const fork = deferred(), enteredFork = deferred(), discarded = [];
    widget.platformService.getConversationWorkspaceBindings = async () => ({ workspaceRoot: '/synthetic/owned',
        workspaces: [{ workspaceRoot: '/synthetic/owned' }] });
    widget.platformService.getAgentCheckpointDiff = async (root, checkpointId) => {
        assert.equal(root, '/synthetic/owned'); assert.equal(checkpointId, 'checkpoint-old');
        return { checkpointId, path: 'src/app.ts', kind: 'modified' };
    };
    widget.platformService.forkConversationWorkspaces = request => {
        assert.equal(request.sourceConversationId, f.sourceSession.id);
        assert.equal(request.primaryWorkspaceRoot, '/synthetic/owned');
        assert.deepEqual(request.groups, [{ workspaceRoot: '/synthetic/owned', inheritedCheckpointIds: ['checkpoint-old'], checkpointIds: [] }]);
        enteredFork.resolve(request.targetConversationId); return fork.promise;
    };
    widget.platformService.discardConversationWorkspace = async id => { discarded.push(id); };
    widget.rebaseProjectlessConversationAttachments = async value => value;
    const branching = widget.branchCodingSession(f.sourceSession.id);
    const branchId = await enteredFork.promise;
    const loading = deferred(); widget.platformService.loadConversationHistory = () => loading.promise;
    const reload = widget.restoreDurableCodingSessions();
    loading.resolve({ status: 'ok', sessions: [f.sourceSession] }); await reload;
    fork.resolve({ workspaceRoot: '/synthetic/new-owned',
        workspaces: [{ sourceWorkspaceRoot: '/synthetic/owned', workspaceRoot: '/synthetic/new-owned' }], resourceMappings: [] }); await branching;
    assert.equal(widget.codingSessions.length, 1); assert.equal(discarded.length, 1); assert.equal(f.submissions.length, 0);
    assert.deepEqual(discarded, [branchId]);
});

test('a legacy history-off setting preserves in-flight startup child drafts in their original conversation', async () => {
    const f = fixture(true), widget = f.widget;
    const owner = childRunId => ({ sessionId: f.sourceSession.id, turnId: 'turn-5', rootRunId: 'root', childRunId });
    widget.setAgentChildDraft(owner('changed'), 'new changed text');
    widget.setAgentChildDraft(owner('new'), 'new child input');
    widget.setAgentChildDraft(owner('cleared'), '');
    widget.codingSessions = widget.codingSessions.map(session => ({ ...session, draftPrompt: 'new ordinary input', updatedAt: Date.now(),
        draftAttachments: [{ id: 'new-attachment', name: 'synthetic.txt', uri: 'file:///synthetic/local-cache', kind: 'text', size: 10 }] }));
    widget.persistCodingSessions();
    widget.applyPrivacySettings({ saveConversationHistory: false });
    assert.equal(widget.codingSessions.length, 1); assert.equal(widget.conversationHistoryReady(), false);
    f.load.resolve({ status: 'ok', sessions: [f.sourceSession] }); await f.restoring;
    assert.equal(widget.codingSessions.length, 1); assert.equal(widget.codingSessions[0].id, f.sourceSession.id);
    assert.equal(widget.codingSessions[0].turns.length, 6); assert.equal(widget.codingSessions[0].permissionMode, 'full_access');
    assert.equal(widget.codingSessions[0].draftPrompt, 'new ordinary input'); assert.equal(widget.codingSessions[0].draftAttachments.length, 1);
    assert.equal(widget.childDraft('changed', owner('changed')), 'new changed text');
    assert.equal(widget.childDraft('new', owner('new')), 'new child input');
    assert.equal(widget.childDraft('cleared', owner('cleared')), '');
    assert.equal(f.submissions.length, 0);
});

test('startup child admission shares the existing 32-change bound across sessions and clearing releases capacity', async () => {
    const f = fixture(true), widget = f.widget;
    // A second already-present session supplies the other 32 locally edited owners.
    const second = { ...widget.codingSessions[0], id: 'second', agentChildDrafts: Array.from({ length: 32 }, (_, n) => ({
        turnId: 'turn-5', rootRunId: 'root', childRunId: `other-${n}`, text: `new ${n}`
    })) };
    widget.codingSessions = [...widget.codingSessions, second];
    widget.conversationHistoryInitialSnapshot = { ...widget.conversationHistoryInitialSnapshot,
        sessions: [...widget.conversationHistoryInitialSnapshot.sessions, { ...second, agentChildDrafts: [] }] };
    const owner = { sessionId: f.sourceSession.id, turnId: 'turn-5', rootRunId: 'root', childRunId: 'new' };
    widget.setAgentChildDraft(owner, 'cannot fit yet');
    assert.equal(widget.childDraft('new', owner), ''); assert.equal(f.notices.at(-1)[2], 'limit');
    widget.codingSessions = widget.codingSessions.map(session => session.id === 'second'
        ? { ...session, agentChildDrafts: session.agentChildDrafts.slice(1) } : session);
    widget.setAgentChildDraft(owner, 'fits now'); assert.equal(widget.childDraft('new', owner), 'fits now');
    assert.equal(widget.changedStartupChildDraftCount(f.sourceSession.id, widget.codingSessions[0].agentChildDrafts), 32);
    f.notices.length = 0; await f.hydrate();
});

test('the four readiness messages exist in all twelve locales and the notice does not freeze the composer', () => {
    const { historyReadinessText } = sourceModule('nextmux-history-readiness-locale.ts');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const key of ['loading', 'failed', 'retry', 'recoveredDraft']) assert.ok(historyReadinessText(locale, key));
    }
    assert.match(source, /className='nmx-history-readiness'/);
    assert.match(source, /data-message-action='edit' disabled=\{!this\.conversationHistoryReady\(\) \|\| this\.turnEditSubmitting\}/);
  assert.doesNotMatch(source, /<textarea[^>]*disabled=\{!this\.conversationHistoryReady\(\)/);
});

test('a failed mirror write never deletes the last recovery snapshot', () => {
  const start = source.indexOf('protected writeConversationHistoryMirror()');
  const end = source.indexOf('protected refreshConversationHistoryPersistDirty()', start);
  const mirrorWriter = source.slice(start, end);
  assert.doesNotMatch(mirrorWriter, /localStorage\.removeItem\(['"]nextmux\.desktop\.codingSessions\.v1/,
    'quota or storage errors must leave the last known-good recovery mirror intact');
  assert.match(mirrorWriter, /已保留上一次可用快照|last known-good mirror/);
});

test('actual edit-confirm-persist-load-flush must not replace full durable history with the bounded mirror', async t => {
    const f = fixture(); await editLast(f);
    assert.equal(f.patches.length, 0, 'backend persistence is correctly deferred until readiness');
    const submittedBeforeLoad = f.submissions.length;
    await f.hydrate(); await f.widget.flushConversationHistory();
    const result = f.durable.find(item => item.id === f.sourceSession.id);
    t.diagnostic(JSON.stringify({ submittedBeforeLoad, patchedSessions: f.patches.flatMap(item => item.upserts).length,
        sourceTurns: f.sourceSession.turns.length, persistedTurns: result.turns.length,
        longBodyCharacters: result.turns.find(item => item.id === 'turn-2')?.response.length,
        historyRevision: result.historyRevision }));
    assert.equal(result.turns.length, 6, 'An edit before loading must not lose the two durable-only earlier turns');
    assert.equal(result.turns.find(item => item.id === 'turn-2')?.response, f.sourceSession.turns[2].response);
    assert.equal(submittedBeforeLoad, 0, 'An incomplete-history edit must not launch a model');
});

test('actual branch action before hydration must not persist a permanently partial new conversation', async t => {
    const f = fixture(); await f.widget.branchCodingSession(f.sourceSession.id, 'turn-5', 'assistant');
    const createdBeforeLoad = f.widget.codingSessions.filter(item => item.id !== f.sourceSession.id).length;
    await f.hydrate(); await f.widget.flushConversationHistory();
    const copies = f.durable.filter(item => item.id !== f.sourceSession.id);
    t.diagnostic(JSON.stringify({ createdBeforeLoad, persistedCopies: copies.length,
        copyTurns: copies[0]?.turns.length, copyBodyCharacters: copies[0]?.turns[0]?.response.length }));
    assert.equal(createdBeforeLoad, 0, 'Branch must wait for full source history');
    assert.equal(copies.length, 0);
});

test('the same actual edit and branch preserve complete history after hydration', async () => {
    const f = fixture(); await f.hydrate(); await editLast(f); await f.widget.flushConversationHistory();
    const edited = f.durable.find(item => item.id === f.sourceSession.id);
    assert.equal(edited.turns.length, 6);
    assert.equal(edited.turns[2].response, f.sourceSession.turns[2].response);
    assert.equal(f.submissions.length, 1);
    // Model boundary is intentionally not executed by this offline fixture.
    f.widget.codingSessions = f.widget.codingSessions.map(item => ({ ...item,
        turns: item.turns.map(turn => ({ ...turn, stage: 'complete' })) }));
    await f.widget.branchCodingSession(f.sourceSession.id);
    await f.widget.flushConversationHistory();
    const copy = f.durable.find(item => item.id !== f.sourceSession.id);
    assert.equal(copy.turns.length, 6); assert.equal(copy.turns[2].response, f.sourceSession.turns[2].response);
});
