import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as goalPresentation from '../lib/browser/nextmux-goal-presentation.js';

// Execute production widget methods and their real persistence helpers. The
// filesystem RPC and UI are ports; no copied pagination/navigation algorithm.
const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
function sourceModule(name) {
    const { outputFiles } = desktopRequire('esbuild').buildSync({
        entryPoints: [fileURLToPath(new URL(`../src/browser/${name}.ts`, import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
    });
    const module = { exports: {} };
    Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}
const persistence = sourceModule('nextmux-conversation-persistence');
const history = sourceModule('nextmux-conversation-history');
const windows = sourceModule('../common/nextmux-conversation-window');
const readiness = sourceModule('nextmux-history-readiness-locale');
const domainLocale = sourceModule('nextmux-domain-error-locale');
const { NEXTMUX_DESKTOP_LOCALES } = sourceModule('nextmux-locale');
const pastedText = sourceModule('nextmux-composer-long-paste');
const composerScope = sourceModule('nextmux-composer-input-scope');
// Deletion, ordering and drag now consult the real per-conversation run state, mutation lock and project keys.
const agentRun = sourceModule('nextmux-conversation-agent-run');
const { ConversationMutationLock } = sourceModule('nextmux-conversation-branch');
const { activeRunBelongsToSession } = sourceModule('nextmux-agent-task-queue');
const { codingProjectPathKey } = sourceModule('nextmux-sidebar-projects');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widgetClass);
const methods = ['ownsComposerInput', 'composerInputKey', 'composerInputOwner', 'initializeConversationWindows', 'sessionPermissionMode', 'recordConversationSyncDiagnostic', 'receiveConversationWindowEvent', 'writeConversationHistoryMirror',
    'persistComposerDraft', 'scheduleComposerDraftPersist', 'flushComposerDraft', 'activePastedTextReferences', 'pruneUnpersistedPastedTextReferences', 'codingSessionTitle',
    'codingSessionActivityAt', 'codingSessionRunStartedAt', 'orderedCodingSessions', 'reorderCodingSession', 'sameCodingSessionDragBucket', 'tileProjectConversations', 'openConversationWindows', 'publishConversationWindowChanges', 'codingSessionListHasMore', 'loadNextCodingSessionsPage', 'mergeIndexedCodingSessions', 'hydrateCodingSession',
    'codingSessionDeletionBlocked', 'conversationHasActiveRun', 'deleteCodingSession', 'toggleCodingSessionPin', 'confirmCodingSessionRename', 'openCodingSession',
    'scheduleGlobalConversationSearch', 'globalConversationSearchMatch', 'persistCodingSessions',
    'refreshConversationHistoryPersistDirty', 'flushConversationHistory'];
const methodSource = methods.map(name => {
    const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, `actual widget method ${name}`);
    return method.getText(file);
}).join('\n');
// Read these initializers from the real class so a newly added generation,
// tombstone or in-flight map is not silently absent from the test harness.
const fields = widgetClass.members.filter(node => ts.isPropertyDeclaration(node)
    && /^(codingSessions$|codingSessionOrder$|codingSessionDragId$|codingSessionPage|codingSessionHydrations$|codingSessionNavigationGeneration$|removedCodingSessionIds$|conversationHistory|conversationWindow|codingSearch|tilingProjectKeys$|composerInputScope$)/.test(node.name.getText(file)))
    .map(node => node.getText(file)).join('\n');
let composerInput;
const findComposerInput = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onInput'
        && node.initializer?.expression?.getText(file).includes('this.scheduleComposerDraftPersist()')) {
        composerInput = node.initializer.expression.getText(file);
    }
    ts.forEachChild(node, findComposerInput);
};
findComposerInput(file);
assert.ok(composerInput, 'actual composer native input handler');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { resolve, reject, promise };
};
const idle = () => new Promise(setImmediate);
const full = (id, extra = {}) => ({ id, title: `Title ${id}`, workspacePath: '/synthetic/project',
    pinned: false, historyLoaded: true, createdAt: 1, updatedAt: 10, permissionMode: 'full_access',
    draftPrompt: '', turns: [{ id: `${id}-turn`, userMessageId: `${id}-user`, assistantMessageId: `${id}-assistant`,
        prompt: 'needle in complete body', response: 'PRESERVED_RESPONSE_'.repeat(100), error: '', stage: 'complete', createdAt: 1 }], ...extra });
const header = record => ({ ...record, historyLoaded: false, turns: [] });

function fixture(records = []) {
    const timers = new Map(), frames = [], patches = [], reads = [], scrolls = [], notices = [], storage = new Map();
    let timerId = 0;
    const window = {
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    };
    const bindings = { ...persistence, ...history, ...windows, ...readiness, ...domainLocale, NEXTMUX_DESKTOP_LOCALES, ...pastedText, ...composerScope,
        conversationAgentRunActive: agentRun.conversationAgentRunActive, activeRunBelongsToSession, codingProjectPathKey, goalRequestObjective: goalPresentation.goalRequestObjective, goalTurnPresentation: goalPresentation.goalTurnPresentation, isGoalEnvelopeTitle: goalPresentation.isGoalEnvelopeTitle, window, requestAnimationFrame: callback => frames.push(callback),
        conversationMessageId: (turn, role) => role === 'user' ? turn.userMessageId : turn.assistantMessageId,
        desktopFailureMessage: (_locale, failure) => String(failure) };
    const Widget = Function(...Object.keys(bindings), ts.transpile(`class Harness { ${fields}\n${methodSource}\n handleNativeComposerInput = ${composerInput}; }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    }))(...Object.values(bindings));
    const durable = new Map(records.map(record => [record.id, structuredClone(record)]));
    const widget = Object.assign(new Widget(), {
        isDisposed: false, desktopLocale: 'en', privacySettings: { saveConversationHistory: true }, conversationHistoryPersistenceReady: true,
        activeCodingSessionId: '', detachedConversationId: '', codingSessionOrder: [], terminalRecords: [], siteConversationOwners: new Map(),
        tiledCodingSessionIds: new Set(), expandedCodingProjects: new Set(), workspaceOptions: [],
        conversationAgentRuns: new Map(), scheduledAgentRuns: new Map(), agentChildContinuationStates: new Map(),
        conversationMutations: new ConversationMutationLock(), codingSessionDragPinned: false, disconnectInactiveConversationTabs() {},
        activeSection: 'coding', codingPanel: 'thread', agentStage: 'idle', activeAgentRunId: '', defaultPermissionMode: 'full_access',
        // These tests start at the indexed-record boundary; schema validation
        // is covered by conversation-history tests, not duplicated here.
        normalizeCodingSessions: rows => rows.map(record => ({ ...record })),
        update() {}, addNotification(...args) { notices.push(args); }, completeNavigationSurface() {},
        activeCodingSession() { return this.codingSessions.find(record => record.id === this.activeCodingSessionId); },
        prompt: '', pastedTextReferences: [], attachments: [], unpersistedPastedTextReferences: new Map(),
        composerTextareaRef: { current: undefined },
        composerDraftAttachmentReferences: () => [], scheduleComposerUiUpdate() {}, setComposerPrompt(value) { this.prompt = value; },
        publishConversationWindowChanges: async () => {}, writeConversationHistoryMirror() {}, scheduleConversationHistoryPersist() {},
        detachContextEditorRecovery: () => true, captureContextEditorRecovery: () => true, stopVoiceInput() {}, flushComposerDraft() {}, persistActiveCodingSessionState() {},
        cancelContextFileListScrollRestore() {}, rememberNavigation() {}, restoreComposerDraft() {}, restoreCodingSourceSelection() {},
        persistDesktopRestoreState() {}, syncActiveRelay() {}, syncModelRoute() {}, syncActiveTerminal() {}, loadContextFiles() {},
        restoreCodingSessionState: async () => {}, restoreProjectGoalFiles: async () => {}, drainFollowUpQueue: async () => {}, scheduleAutomaticResume() {},
        restoreThreadScroll(viewState) { scrolls.push(viewState); }, scrollThreadTurn(turnId) { scrolls.push(turnId); },
        startNewCodingTask() { this.activeCodingSessionId = ''; this.codingSessionNavigationGeneration++; },
        platformService: {
            async listConversationHistory() { return { sessions: [...durable.values()].map(header), total: durable.size }; },
            async readConversationHistorySession(id) { reads.push(id); return structuredClone(durable.get(id)); },
            async patchConversationHistory(patch) {
                patches.push(structuredClone(patch));
                for (const id of patch.removedSessionIds) durable.delete(id);
                for (const record of patch.upserts) {
                    assert.notEqual(record.historyLoaded, false, 'a header must never overwrite the complete durable body');
                    durable.set(record.id, structuredClone(record));
                }
            },
            async discardConversationWorkspace() {}
        }
    });
    return { window, widget, durable, patches, reads, scrolls, notices,
        input(value) {
            // Mount an owned native textarea port; all ownership and key decisions
            // below execute the production methods and ComposerInputScope class.
            const currentTarget = { value, isConnected: true,
                dataset: { composerInputScope: widget.composerInputKey() } };
            widget.composerTextareaRef.current = currentTarget;
            widget.handleNativeComposerInput({ currentTarget });
            return currentTarget;
        },
        changes: () => persistence.conversationPersistenceChanges(widget.codingSessions, widget.conversationHistoryPersistedSessions),
        async timers() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); await idle(); },
        frames() { while (frames.length) frames.shift()(); },
        async index() { await widget.loadNextCodingSessionsPage('/synthetic/project'); },
        async flush() { widget.refreshConversationHistoryPersistDirty(); await widget.flushConversationHistory(); }
    };
}

test('deleting a newly paged header persists a tombstone without reading its body', async () => {
    const f = fixture([full('A')]); await f.index();
    assert.deepEqual(f.changes(), { upserts: [], removedSessionIds: [] });
    f.widget.deleteCodingSession('A'); await f.flush();
    assert.deepEqual(f.patches, [{ upserts: [], removedSessionIds: ['A'] }]);
    assert.equal(f.durable.has('A'), false); assert.deepEqual(f.reads, []);
});

test('read-only hydration stays clean and does not schedule a complete body rewrite', async () => {
    const original = full('A'), f = fixture([original]); await f.index();
    const hydrated = await f.widget.hydrateCodingSession('A'); await f.flush();
    assert.deepEqual(hydrated.turns, original.turns);
    assert.equal(f.widget.conversationHistoryPersistedSessions.get('A'), hydrated);
    assert.deepEqual(f.patches, []); assert.deepEqual(f.changes(), { upserts: [], removedSessionIds: [] });
});

test('a peer initializes and publishes after actual empty-session deltas round trip through native state', async () => {
    const records = [full('empty', { turns: [], draftPrompt: 'empty draft' }), full('complete', { modelId: 'Terra' })];
    const nativeSessions = new Map();
    // Match the actual renderer publisher and main state store. In particular,
    // do not construct live records with a handwritten `turns: []` default.
    for (const session of history.portableConversationHistorySessions(records)) {
        const delta = windows.conversationWindowDelta(undefined, session);
        assert.ok(delta);
        if (session.id === 'empty') assert.equal(delta.turns, undefined, 'an empty session has no turn edits');
        nativeSessions.set(session.id, windows.applyConversationWindowDelta(undefined, delta));
    }
    const f = fixture(records), sent = [];
    let stateReads = 0;
    f.window.nextmuxDesktop = {
        getConversationWindowState: async () => {
            stateReads++;
            return structuredClone({ windowId: 2, primaryWindowId: 1, sessionId: '', windows: [], sessions: [...nativeSessions.values()] });
        },
        onConversationWindowEvent: () => () => {}, onConversationWindowHighlight: () => () => {},
        publishConversationWindows: async changes => {
            for (const delta of changes) nativeSessions.set(delta.id, windows.applyConversationWindowDelta(nativeSessions.get(delta.id), delta));
            sent.push(...changes); return true;
        },
        flushConversationWindows: async () => true
    };
    Object.assign(f.widget, { codingSessions: records, activeCodingSessionId: 'empty', prompt: records[0].draftPrompt,
        toDispose: { push() {} }, initializeConversationHistory: async () => {},
        conversationHistoryPersistedSessions: persistence.createConversationPersistenceBaseline(records),
        publishConversationWindowChanges: Object.getPrototypeOf(f.widget).publishConversationWindowChanges });
    await f.widget.initializeConversationWindows();
    assert.equal(stateReads, 2);
    assert.equal(f.widget.conversationWindowReady, true);
    assert.equal(f.widget.conversationWindowPrimary, false);
    assert.deepEqual(f.widget.activeCodingSession().turns, []);
    assert.deepEqual(f.widget.codingSessions.find(session => session.id === 'complete').turns, records[1].turns);
    const ownedInput = f.input('QA2');
    f.widget.handleNativeComposerInput({ currentTarget: { ...ownedInput, value: 'foreign textarea must be ignored' } });
    assert.equal(f.widget.prompt, 'QA2', 'a different native textarea cannot change this conversation');
    await f.timers(); await f.flush();
    assert.equal(nativeSessions.get('empty').draftPrompt, 'QA2');
    assert.ok(sent.some(delta => delta.set.draftPrompt === 'QA2'));
    assert.equal(f.widget.conversationHistoryPersistDirty, false, 'the peer can obtain its primary receipt');
    assert.deepEqual(f.patches, [], 'the peer does not write a second durable copy');
});

test('delta application keeps partial history markers and complete turns while normalizing empty turn lists', () => {
    const empty = full('empty', { turns: [] });
    const appliedEmpty = windows.applyConversationWindowDelta(undefined, windows.conversationWindowDelta(undefined, empty));
    assert.deepEqual(appliedEmpty.turns, []);
    const complete = full('complete');
    const appliedComplete = windows.applyConversationWindowDelta(complete, windows.conversationWindowDelta(complete, { ...complete, draftPrompt: 'edited' }));
    assert.equal(appliedComplete.turns, complete.turns, 'an unrelated field delta preserves the existing complete turn array');
    const partial = { ...header(complete), turnCount: complete.turns.length, latestTurn: complete.turns.at(-1) };
    const appliedPartial = windows.applyConversationWindowDelta(partial, windows.conversationWindowDelta(partial, { ...partial, pinned: true }));
    assert.equal(appliedPartial.historyLoaded, false);
    assert.equal(appliedPartial.turnCount, partial.turnCount);
    assert.deepEqual(appliedPartial.turns, []);
    assert.deepEqual(appliedPartial.latestTurn, partial.latestTurn);
    const merged = history.mergeConversationHistorySessions([partial], [appliedComplete, appliedEmpty], {
        mutatedDuringLoad: false, initialSessionIds: new Set(['complete'])
    });
    assert.deepEqual(merged.sessions.find(session => session.id === 'complete').turns, complete.turns);
    assert.equal(merged.sessions.find(session => session.id === 'complete').historyLoaded, true);
    assert.deepEqual(merged.sessions.find(session => session.id === 'empty').turns, []);
});

test('a normal workspace peer joins complete live history and live-only sessions after its disk read', async () => {
    const old = full('A', { turns: [], title: 'old draft', modelId: 'Sol', updatedAt: 1 });
    const complete = full('A', { title: 'completed task', modelId: 'Terra', updatedAt: 30,
        turns: [1, 2, 3].map(index => ({ id: `turn-${index}`, prompt: 'synthetic', response: 'saved',
            stage: index === 3 ? 'cancelled' : 'complete', createdAt: index,
            ...(index === 3 ? { resumeCheckpointId: 'resume-synthetic' } : {}) })) });
    const liveOnly = full('B', { updatedAt: 40 }), deleted = full('deleted');
    const f = fixture([old, deleted]), disk = deferred(), sent = [];
    const state = sessions => ({ windowId: 2, primaryWindowId: 1, sessionId: '', windows: [], sessions });
    let calls = 0;
    f.window.nextmuxDesktop = {
        getConversationWindowState: async () => ++calls === 1 ? state([old]) : state([complete, liveOnly]),
        onConversationWindowEvent: () => () => {}, onConversationWindowHighlight: () => () => {},
        publishConversationWindows: async changes => { sent.push(...changes); return true; }
    };
    Object.assign(f.widget, { codingSessions: [old, deleted], toDispose: { push() {} },
        initializeConversationHistory: async () => {
            await disk.promise;
            f.widget.codingSessions = [old, deleted];
            f.widget.conversationHistoryPersistedSessions = persistence.createConversationPersistenceBaseline([old, deleted]);
        },
        publishConversationWindowChanges: Object.getPrototypeOf(f.widget).publishConversationWindowChanges
    });
    const opening = f.widget.initializeConversationWindows();
    await idle();
    f.widget.receiveConversationWindowEvent({ type: 'delta', removed: ['deleted'] });
    disk.resolve(); await opening;
    assert.equal(f.widget.conversationWindowPrimary, false);
    assert.deepEqual(f.widget.codingSessions.map(record => record.id).sort(), ['A', 'B']);
    const restored = f.widget.codingSessions.find(record => record.id === 'A');
    assert.equal(restored.modelId, 'Terra'); assert.equal(restored.turns.length, 3);
    assert.equal(restored.turns.at(-1).resumeCheckpointId, 'resume-synthetic');
    assert.equal(sent.some(change => change.set.modelId === 'Sol'), false, 'old disk fields are not republished over live state');
    assert.deepEqual(f.patches, [], 'the peer never becomes a second disk writer during initialization');
});

test('a live peer delta refreshes an already-loaded empty draft before sidebar navigation', async () => {
    const old = full('A', { turns: [], modelId: 'Sol', updatedAt: 1 });
    const complete = full('A', { modelId: 'Terra', updatedAt: 30,
        turns: [1, 2, 3].map(index => ({ id: `turn-${index}`, prompt: 'synthetic', response: 'saved',
            stage: index === 3 ? 'cancelled' : 'complete', createdAt: index,
            ...(index === 3 ? { resumeCheckpointId: 'resume-synthetic' } : {}) })) });
    const f = fixture([complete]);
    f.widget.codingSessions = [old];
    f.widget.conversationWindowBaseline = new Map([['A', old]]);
    f.widget.receiveConversationWindowEvent({ type: 'delta', delta: windows.conversationWindowDelta(old, complete) });
    await f.widget.openCodingSession('A');
    assert.equal(f.widget.activeCodingSession().turns.length, 3);
    assert.equal(f.widget.activeCodingSession().modelId, 'Terra');
    assert.equal(f.widget.activeThreadTurnId, 'turn-3'); assert.equal(f.widget.agentStage, 'cancelled');
    assert.deepEqual(f.reads, [], 'the live update repairs the loaded cache without guessing that disk hydration is needed');
});

test('actual peer composer input debounces into a delta and only the primary writes its new draft', async () => {
    const original = full('A', { draftPrompt: 'NM_WINDOW_SYNC_PRIMARY', modelId: 'Terra' });
    const primary = fixture([original]), peer = fixture([original]);
    const diagnostics = [];
    for (const [owner, id] of [[primary, 1], [peer, 2]]) {
        Object.assign(owner.widget, { codingSessions: [original], activeCodingSessionId: 'A', prompt: original.draftPrompt,
            conversationWindowDiagnostic: true,
            conversationWindowId: id, conversationWindowPrimary: id === 1, conversationWindowReady: true,
            conversationWindowBaseline: new Map([['A', original]]), conversationWindowSourceRefs: new Map([['A', original]]),
            conversationHistoryPersistedSessions: persistence.createConversationPersistenceBaseline([original]),
            publishConversationWindowChanges: Object.getPrototypeOf(owner.widget).publishConversationWindowChanges });
    }
    primary.window.nextmuxDesktop = { publishConversationWindows: async (changes, removed) => {
        for (const delta of changes) peer.widget.receiveConversationWindowEvent({ type: 'delta', delta: structuredClone(delta) });
        if (removed.length) peer.widget.receiveConversationWindowEvent({ type: 'delta', removed });
        return true;
    } };
    peer.window.nextmuxDesktop = {
        publishConversationWindows: async (changes, removed) => {
            for (const delta of changes) primary.widget.receiveConversationWindowEvent({ type: 'delta', delta: structuredClone(delta) });
            if (removed.length) primary.widget.receiveConversationWindowEvent({ type: 'delta', removed });
            return true;
        },
        flushConversationWindows: async () => { await primary.flush(); return !primary.widget.conversationHistoryPersistDirty; }
    };
    for (const owner of [primary, peer]) owner.window.nextmuxDesktop.reportConversationSyncDiagnostic = async payload => { diagnostics.push(payload); return true; };
    const ownedInput = peer.input('NM_WINDOW_SYNC_PEER');
    ownedInput.isConnected = false;
    ownedInput.value = 'detached textarea must be ignored';
    peer.widget.handleNativeComposerInput({ currentTarget: ownedInput });
    ownedInput.isConnected = true;
    ownedInput.value = 'NM_WINDOW_SYNC_PEER';
    assert.equal(peer.widget.prompt, 'NM_WINDOW_SYNC_PEER');
    assert.equal(primary.widget.prompt, 'NM_WINDOW_SYNC_PRIMARY', 'publishing waits for the normal draft debounce');
    await peer.timers();
    assert.equal(primary.widget.prompt, 'NM_WINDOW_SYNC_PEER');
    assert.equal(primary.widget.activeCodingSession().draftPrompt, 'NM_WINDOW_SYNC_PEER');
    await peer.flush();
    assert.equal(primary.durable.get('A').draftPrompt, 'NM_WINDOW_SYNC_PEER');
    assert.ok(primary.durable.get('A').updatedAt > original.updatedAt);
    assert.equal(primary.patches.length, 1); assert.deepEqual(peer.patches, []);
    for (const event of ['input', 'draft_scheduled', 'draft_timer', 'draft_persisted', 'publish_attempt', 'publish_result', 'receive_delta', 'flush_start', 'flush_end']) {
        assert.ok(diagnostics.some(record => record.event === event), `the diagnostic locates ${event}`);
    }
    assert.equal(diagnostics.find(record => record.event === 'input').draftLength, 'NM_WINDOW_SYNC_PEER'.length);
    assert.equal(JSON.stringify(diagnostics).includes('NM_WINDOW_SYNC_'), false, 'never report draft text');
    assert.equal(JSON.stringify(diagnostics).includes('PRESERVED_RESPONSE_'), false, 'never report history text');
    assert.ok(diagnostics.every(record => !Object.hasOwn(record, 'id') && !Object.hasOwn(record, 'sessionId')));
});

test('conversation sync diagnostics stay off by default and have a bounded optional reporter', async () => {
    const f = fixture(); const diagnostics = [];
    f.window.nextmuxDesktop = { reportConversationSyncDiagnostic: async payload => { diagnostics.push(payload); return true; } };
    f.widget.recordConversationSyncDiagnostic('input');
    assert.deepEqual(diagnostics, []);
    assert.equal(f.widget.conversationWindowDiagnosticCount, 0);
    f.widget.conversationWindowDiagnostic = true;
    for (let count = 0; count < 105; count++) f.widget.recordConversationSyncDiagnostic('input');
    assert.equal(diagnostics.length, 100);
    assert.equal(f.widget.conversationWindowDiagnosticCount, 100);
    const rejected = fixture(); rejected.widget.conversationWindowDiagnostic = true;
    rejected.window.nextmuxDesktop = { reportConversationSyncDiagnostic: async () => { throw new Error('synthetic diagnostic failure'); } };
    assert.doesNotThrow(() => rejected.widget.recordConversationSyncDiagnostic('input'));
    await idle();
    rejected.window.nextmuxDesktop.reportConversationSyncDiagnostic = () => { throw new Error('synthetic synchronous reporter failure'); };
    assert.doesNotThrow(() => rejected.widget.recordConversationSyncDiagnostic('input'));
});

test('ordinary peer flush confirms only the published snapshot and retains edits arriving while waiting', async () => {
    const original = full('A'), changed = { ...original, draftPrompt: 'first local edit', updatedAt: 20 };
    const f = fixture([original]), receipt = deferred();
    f.widget.codingSessions = [changed];
    f.widget.conversationHistoryPersistedSessions = persistence.createConversationPersistenceBaseline([original]);
    f.widget.conversationWindowPrimary = false; f.widget.conversationWindowReady = true;
    f.window.nextmuxDesktop = { flushConversationWindows: () => receipt.promise };
    const flushing = f.flush(); await idle();
    const latest = { ...changed, draftPrompt: 'second edit during flush', updatedAt: 30 };
    f.widget.codingSessions = [latest]; receipt.resolve(true); await flushing;
    assert.deepEqual(f.patches, []);
    assert.equal(f.widget.conversationHistoryPersistedSessions.get('A'), changed);
    assert.equal(f.widget.conversationHistoryPersistDirty, true);
    f.window.nextmuxDesktop.flushConversationWindows = async () => true;
    await f.flush();
    assert.equal(f.widget.conversationHistoryPersistedSessions.get('A'), latest);
    assert.equal(f.widget.conversationHistoryPersistDirty, false);
});

test('an ordinary peer never writes the shared startup mirror and a failed receipt keeps it dirty', async () => {
    const original = full('A'), f = fixture([original]);
    f.widget.codingSessions = [{ ...original, draftPrompt: 'keep unsaved edit', updatedAt: 20 }];
    f.widget.conversationHistoryPersistedSessions = persistence.createConversationPersistenceBaseline([original]);
    f.widget.conversationWindowPrimary = false; f.widget.conversationWindowReady = true;
    f.window.localStorage.setItem('nextmux.desktop.codingSessions.v1', 'PRIMARY_MIRROR');
    Object.getPrototypeOf(f.widget).writeConversationHistoryMirror.call(f.widget);
    assert.equal(f.window.localStorage.getItem('nextmux.desktop.codingSessions.v1'), 'PRIMARY_MIRROR');
    f.window.nextmuxDesktop = { flushConversationWindows: async () => false };
    await assert.rejects(f.flush(), /对话尚未安全保存/);
    assert.equal(f.widget.conversationHistoryPersistDirty, true);
    assert.equal(f.widget.conversationHistoryPersistedSessions.get('A'), original);
    assert.deepEqual(f.patches, []);
});

test('a peer elected writer during flush switches to a local durable save instead of requesting itself', async () => {
    const original = full('A'), f = fixture([original]);
    f.widget.codingSessions = [{ ...original, draftPrompt: 'pending at takeover', updatedAt: 20 }];
    f.widget.conversationHistoryPersistedSessions = persistence.createConversationPersistenceBaseline([original]);
    f.widget.conversationWindowPrimary = false; f.widget.conversationWindowReady = true;
    let requests = 0;
    f.window.nextmuxDesktop = { flushConversationWindows: async () => { requests++; return 'primary'; } };
    await f.flush();
    assert.equal(requests, 1); assert.equal(f.widget.conversationWindowPrimary, true);
    assert.equal(f.patches.length, 1); assert.equal(f.widget.conversationHistoryPersistDirty, false);
});

test('hydration preserves metadata and drafts changed while the read is pending', async () => {
    const original = full('A'), f = fixture([original]), pending = deferred(); await f.index();
    f.widget.platformService.readConversationHistorySession = () => pending.promise;
    const operation = f.widget.hydrateCodingSession('A');
    f.widget.codingSessions = f.widget.codingSessions.map(record => ({ ...record, title: 'Local rename', pinned: true, draftPrompt: 'Unsent local text' }));
    pending.resolve(original); const hydrated = await operation;
    assert.equal(hydrated.title, 'Local rename'); assert.equal(hydrated.pinned, true); assert.equal(hydrated.draftPrompt, 'Unsent local text');
    assert.deepEqual(hydrated.turns, original.turns);
    assert.equal(f.widget.conversationHistoryPersistedSessions.get('A').title, original.title);
    await f.flush(); assert.equal(f.durable.get('A').title, 'Local rename'); assert.deepEqual(f.durable.get('A').turns, original.turns);
});

test('a page response cannot resurrect a row deleted during the request', async () => {
    const original = full('A'), f = fixture([original]), pending = deferred(); await f.index();
    f.widget.platformService.listConversationHistory = () => pending.promise;
    const page = f.widget.loadNextCodingSessionsPage('another-project');
    f.widget.deleteCodingSession('A'); pending.resolve({ sessions: [header(original)], total: 1 }); await page; await f.flush();
    assert.deepEqual(f.widget.codingSessions, []); assert.equal(f.durable.has('A'), false);
});

test('deleting during hydration discards the late body and leaves the deletion durable', async () => {
    const original = full('A'), f = fixture([original]), pending = deferred(); await f.index();
    f.widget.platformService.readConversationHistorySession = () => pending.promise;
    const hydration = f.widget.hydrateCodingSession('A'); f.widget.deleteCodingSession('A');
    pending.resolve(original); assert.equal(await hydration, undefined); await f.flush();
    assert.deepEqual(f.widget.codingSessions, []); assert.equal(f.widget.codingSessionHydrations.size, 0); assert.equal(f.durable.has('A'), false);
});

test('opening A then B keeps B active when A hydrates last', async () => {
    const f = fixture([full('A'), full('B')]), pendingA = deferred(), pendingB = deferred(); await f.index();
    f.widget.platformService.readConversationHistorySession = id => id === 'A' ? pendingA.promise : pendingB.promise;
    const a = f.widget.openCodingSession('A'), b = f.widget.openCodingSession('B');
    pendingB.resolve(full('B')); await b; pendingA.resolve(full('A')); await a;
    assert.equal(f.widget.activeCodingSessionId, 'B'); assert.equal(f.widget.activeThreadTurnId, 'B-turn');
});

test('late A view restoration cannot scroll B after the user navigates away', async () => {
    const f = fixture([full('A'), full('B')]), pendingA = deferred(); await f.index();
    f.widget.restoreCodingSessionState = session => session.id === 'A' ? pendingA.promise : Promise.resolve();
    await f.widget.openCodingSession('A', 'A-turn'); await f.widget.openCodingSession('B', 'B-turn');
    pendingA.resolve(); await idle(); f.frames();
    assert.deepEqual(f.scrolls, ['B-turn']);
});

test('pin and rename share the pending hydration and persist the complete original body', async () => {
    const original = full('A'), f = fixture([original]), pending = deferred(); await f.index();
    f.widget.platformService.readConversationHistorySession = id => { f.reads.push(id); return pending.promise; };
    f.widget.codingSessionRenameId = 'A'; f.widget.codingSessionRenameValue = 'Renamed';
    const rename = f.widget.confirmCodingSessionRename(), pin = f.widget.toggleCodingSessionPin('A');
    await idle(); assert.deepEqual(f.reads, ['A']); assert.deepEqual(f.patches, []);
    assert.equal(f.widget.codingSessions[0].title, original.title); assert.equal(f.widget.codingSessions[0].pinned, false);
    pending.resolve(original); await Promise.all([rename, pin]); await f.flush();
    const saved = f.durable.get('A'); assert.equal(saved.title, 'Renamed'); assert.equal(saved.pinned, true);
    assert.equal(saved.updatedAt, original.updatedAt, 'metadata actions must not masquerade as a new conversation message');
    assert.deepEqual(saved.turns, original.turns); assert.equal(f.widget.codingSessionHydrations.size, 0);
});

test('a changed rename dialog cannot apply an older pending title', async () => {
    const original = full('A'), f = fixture([original]), pending = deferred(); await f.index();
    f.widget.platformService.readConversationHistorySession = () => pending.promise;
    f.widget.codingSessionRenameId = 'A'; f.widget.codingSessionRenameValue = 'Old pending title';
    const rename = f.widget.confirmCodingSessionRename(); f.widget.codingSessionRenameValue = 'New unconfirmed title';
    pending.resolve(original); await rename; await f.flush();
    assert.equal(f.widget.codingSessions[0].title, original.title); assert.deepEqual(f.patches, []);
});

test('repeated body search preserves index-only matches without hydrating or dirtying placeholders', async () => {
    const f = fixture([full('remote-only')]);
    f.widget.platformService.searchConversationHistory = async () => ({ matches: [{ conversationId: 'remote-only',
        title: 'Historic title', workspacePath: '/synthetic/project', kind: 'content', snippet: 'needle only in body' }] });
    f.widget.codingSearchQuery = 'needle';
    for (let attempt = 0; attempt < 2; attempt++) {
        f.widget.scheduleGlobalConversationSearch(); await f.timers();
        assert.deepEqual([...f.widget.codingSearchMatches.keys()], ['remote-only']);
        assert.deepEqual(f.changes(), { upserts: [], removedSessionIds: [] });
    }
    await f.flush(); assert.deepEqual(f.patches, []); assert.deepEqual(f.reads, []);
});

test('deleted conversations cannot return through an in-flight search result', async () => {
    const f = fixture([full('A')]), pending = deferred(); await f.index();
    f.widget.platformService.searchConversationHistory = () => pending.promise;
    f.widget.codingSearchQuery = 'needle'; f.widget.scheduleGlobalConversationSearch(); await f.timers();
    f.widget.deleteCodingSession('A'); pending.resolve({ matches: [{ conversationId: 'A', title: 'Title A', kind: 'content', snippet: 'needle' }] });
    await idle(); assert.equal(f.widget.codingSearchMatches.has('A'), false); assert.deepEqual(f.widget.codingSessions, []);
});

test('outdated page and hydration generations cannot merge into reloaded history', async () => {
    const original = full('A'), f = fixture([original]), page = deferred(), body = deferred(); await f.index();
    f.widget.platformService.listConversationHistory = () => page.promise;
    f.widget.platformService.readConversationHistorySession = () => body.promise;
    const p = f.widget.loadNextCodingSessionsPage('another-project'), h = f.widget.hydrateCodingSession('A');
    f.widget.conversationHistoryLoadGeneration++; f.widget.codingSessions = [];
    page.resolve({ sessions: [header(original)], total: 1 }); body.resolve(original); await Promise.all([p, h]);
    assert.deepEqual(f.widget.codingSessions, []); assert.equal(f.widget.codingSessionHydrations.size, 0);
});


test('concurrent expansion joins the same page request without duplicate reads', async () => {
    const f = fixture([full('A')]), pending = deferred(); let calls = 0;
    f.widget.platformService.listConversationHistory = () => { calls++; return pending.promise; };
    const first = f.widget.loadNextCodingSessionsPage('/project');
    const second = f.widget.loadNextCodingSessionsPage('/project');
    assert.equal(calls, 1);
    pending.resolve({ sessions: [header(full('A'))], total: 1 });
    await Promise.all([first, second]);
    assert.equal(f.widget.codingSessions.length, 1);
    assert.equal(f.widget.codingSessionPageRequests.size, 0);
    assert.equal(f.widget.codingSessionPagesLoading.size, 0);
});

test('a complete startup index has no more project rows even before a project-specific query', () => {
    const { widget } = fixture([full('A')]);
    widget.codingSessionPagesLoaded.add('__global__');
    assert.equal(widget.codingSessionListHasMore('/synthetic/project'), false);
    assert.equal(widget.codingSessionListHasMore('/empty-project'), false);
});

test('an incomplete global index must not hide an unqueried project page', () => {
    const { widget } = fixture();
    widget.codingSessionPagesLoaded.add('__global__');
    widget.codingSessionPageCursors.set('__global__', 'more-global-rows');
    assert.equal(widget.codingSessionListHasMore('/synthetic/project'), true);
});

test('a project pagination result takes precedence over the older global snapshot', async () => {
    const f = fixture();
    f.widget.codingSessionPagesLoaded.add('__global__');
    f.widget.platformService.listConversationHistory = async request => request.cursor
        ? { sessions: [header(full('B'))], total: 2 }
        : { sessions: [header(full('A'))], total: 2, nextCursor: 'next-page' };
    await f.index();
    assert.equal(f.widget.codingSessionListHasMore('/synthetic/project'), true);
    await f.index();
    assert.equal(f.widget.codingSessionListHasMore('/synthetic/project'), false);
    assert.deepEqual(f.widget.codingSessions.map(row => row.id), ['A', 'B']);
});

test('an empty completed project has no load-more action while other projects remain paginated', async () => {
    const f = fixture();
    f.widget.codingSessionPagesLoaded.add('__global__');
    f.widget.codingSessionPageCursors.set('__global__', 'more-global-rows');
    await f.index();
    assert.equal(f.widget.codingSessionListHasMore('/synthetic/project'), false);
    assert.equal(f.widget.codingSessionListHasMore('/another-project'), true);
});

test('tile all resolves every project page before opening its windows', async () => {
    const f = fixture([full('A'), full('B')]), opened = [];
    f.widget.conversationWindowPointerOrigin = () => ({ x: 12, y: 34 });
    f.widget.orderedCodingSessions = rows => rows;
    f.widget.openConversationWindows = async (ids, origin) => opened.push({ ids, origin });
    f.widget.platformService.listConversationHistory = async request => request.cursor
        ? { sessions: [header(full('B'))], total: 2 }
        : { sessions: [header(full('A'))], total: 2, nextCursor: 'next-page' };
    await f.widget.tileProjectConversations('/synthetic/project');
    assert.deepEqual(opened, [{ ids: ['A', 'B'], origin: { x: 12, y: 34 } }]);
});

test('window synchronization never publishes a header as an empty conversation', async () => {
    const f = fixture([full('A'), full('B')]); await f.index();
    await f.widget.hydrateCodingSession('A');
    const published = [];
    f.widget.conversationWindowReady = true;
    f.widget.conversationWindowSourceRefs = new Map();
    f.widget.conversationWindowBaseline = new Map();
    f.widget.conversationWindowPublisher = { publish(changes, removed) { published.push({ changes, removed }); return Promise.resolve(); } };
    delete f.widget.publishConversationWindowChanges;
    await f.widget.publishConversationWindowChanges();
    assert.equal(published.length, 1);
    assert.deepEqual(published[0].changes.map(change => change.id), ['A']);
    assert.deepEqual(published[0].removed, []);
    await f.widget.hydrateCodingSession('B');
    await f.widget.publishConversationWindowChanges();
    assert.deepEqual(published[1].changes.map(change => change.id), ['B']);
});

test('hydrating a page summary preserves activity order and running conversations stay first', () => {
    const oldProject = full('old', { createdAt: 1, turns: [{ createdAt: 1, completedAt: 900, stage: 'complete' }] });
    const recentProject = full('recent', { createdAt: 500, turns: [{ createdAt: 500, completedAt: 501, stage: 'complete' }] });
    const f = fixture();
    const summarized = { ...header(oldProject), latestTurn: oldProject.turns.at(-1) };
    assert.deepEqual(f.widget.orderedCodingSessions([recentProject, summarized]).map(s => s.id), ['old', 'recent']);
    assert.deepEqual(f.widget.orderedCodingSessions([recentProject, oldProject]).map(s => s.id), ['old', 'recent']);
    f.widget.codingSessionOrder = ['recent', 'old', 'running'];
    const running = { ...header(full('running')), latestTurn: { createdAt: 1, stage: 'running' } };
    assert.deepEqual(f.widget.orderedCodingSessions([oldProject, recentProject, running]).map(s => s.id), ['running', 'recent', 'old']);
});

test('dragging loaded conversations retains the order of unloaded projects and drops known tombstones', () => {
    const f = fixture();
    f.widget.codingSessions = [full('A'), full('B')];
    f.widget.codingSessionOrder = ['unloaded-project-1', 'A', 'deleted', 'B', 'unloaded-project-2'];
    f.widget.removedCodingSessionIds.add('deleted');
    let writes = 0; f.widget.persistCodingSessions = () => { writes++; };
    f.widget.reorderCodingSession('B', 'A');
    assert.deepEqual(f.widget.codingSessionOrder, ['unloaded-project-1', 'B', 'A', 'unloaded-project-2']);
    assert.equal(writes, 1);
    f.widget.reorderCodingSession('unloaded-project-1', 'A');
    assert.equal(writes, 1, 'An unloaded drag source is not actionable');
});

test('after a manual drag, newer activity still floats a conversation to the top and drops land where aimed', () => {
    const f = fixture();
    const at = (id, time) => full(id, { createdAt: time, turns: [{ id: `${id}-turn`, createdAt: time, completedAt: time, stage: 'complete' }] });
    f.widget.codingSessions = [at('A', 30), at('B', 20), at('C', 10)];
    f.widget.persistCodingSessions = () => {};
    f.widget.reorderCodingSession('C', 'A');
    assert.ok(f.widget.codingSessionOrderUpdatedAt > 0, 'the drag time is remembered');
    const draggedAt = f.widget.codingSessionOrderUpdatedAt = 100;
    assert.deepEqual(f.widget.orderedCodingSessions(f.widget.codingSessions).map(s => s.id), ['C', 'A', 'B']);
    // B receives a new message and a brand-new conversation D starts after the drag.
    f.widget.codingSessions = [at('A', 30), at('B', draggedAt + 5), at('C', 10), at('D', draggedAt + 1)];
    assert.deepEqual(f.widget.orderedCodingSessions(f.widget.codingSessions).map(s => s.id), ['B', 'D', 'C', 'A'],
        'newest activity first, then the dragged order; a new conversation never sinks to the bottom');
    f.widget.reorderCodingSession('A', 'D');
    assert.deepEqual(f.widget.orderedCodingSessions(f.widget.codingSessions).map(s => s.id), ['B', 'A', 'D', 'C'],
        'dropping onto a floated row inserts at the row the user saw');
});

test('50,000 loaded summaries can be reordered without losing IDs or the running group', t => {
    const f = fixture();
    f.widget.codingSessions = Array.from({ length: 50_000 }, (_, i) => ({ id: `row-${i}`, turns: [], historyLoaded: false, createdAt: i, updatedAt: i, latestTurn: { createdAt: i, stage: i < 2 ? 'running' : 'complete' } }));
    f.widget.persistCodingSessions = () => {};
    const start = performance.now();
    f.widget.reorderCodingSession('row-25000', 'row-49999');
    const ordered = f.widget.orderedCodingSessions(f.widget.codingSessions).map(s => s.id);
    assert.equal(new Set(ordered).size, 50_000);
    assert.deepEqual(ordered.slice(0, 4), ['row-1', 'row-0', 'row-25000', 'row-49999']);
    t.diagnostic(`50,000 summary reorder: ${Math.round(performance.now() - start)} ms`);
});

test('saving a metadata edit hydrates only dirty indexed rows and preserves full history', async () => {
    const originals = [full('A'), full('B')], f = fixture(originals); await f.index();
    f.widget.codingSessions = f.widget.codingSessions.map(row => row.id === 'A' ? { ...row, automaticRelaySource: 'user' } : row);
    await f.flush();
    assert.deepEqual(f.reads, ['A']); assert.deepEqual(f.notices, []);
    assert.deepEqual(f.durable.get('A').turns, originals[0].turns);
    assert.equal(f.durable.get('A').automaticRelaySource, 'user');
    assert.equal(f.widget.conversationHistoryPersistDirty, false);
});

test('a failed header read keeps its original and dirty edit while healthy conversations save', async () => {
    const a = full('A'), b = full('B'), f = fixture([a, b]); await f.index();
    await f.widget.hydrateCodingSession('B');
    f.widget.platformService.readConversationHistorySession = async id => { f.reads.push(id); throw new Error('synthetic unavailable disk'); };
    f.widget.codingSessions = f.widget.codingSessions.map(row => ({ ...row, title: `Edited ${row.id}` }));
    await f.flush();
    assert.deepEqual(f.durable.get('A'), a); assert.equal(f.durable.get('B').title, 'Edited B');
    assert.equal(f.widget.conversationHistoryPersistDirty, true);
    assert.equal(f.changes().upserts.length, 1); assert.equal(f.changes().upserts[0].id, 'A');
    assert.equal(f.reads.filter(id => id === 'A').length, 1, 'do not spin on a failed read');
    f.widget.platformService.readConversationHistorySession = async () => structuredClone(a);
    await f.flush(); assert.equal(f.durable.get('A').title, 'Edited A'); assert.equal(f.widget.conversationHistoryPersistDirty, false);
});

test('hydrating a legacy header with a new in-memory turn preserves both the original and new result', async () => {
    const original = full('A'), f = fixture([original]); await f.index();
    const newTurn = { ...original.turns[0], id: 'new-turn', prompt: 'new request', response: 'real result', createdAt: 20 };
    f.widget.codingSessions = f.widget.codingSessions.map(row => ({ ...row, turns: [newTurn], updatedAt: 20 }));
    await f.flush();
    assert.deepEqual(f.durable.get('A').turns, [...original.turns, newTurn]);
    assert.equal(f.durable.get('A').historyLoaded, true); assert.deepEqual(f.notices, []);
});

test('dirty indexed hydration has bounded concurrency and retains edits arriving during the read', async () => {
    const originals = Array.from({ length: 20 }, (_, i) => full(`S${i}`)), f = fixture(originals); await f.index();
    f.widget.codingSessions = f.widget.codingSessions.map(row => ({ ...row, pinned: true }));
    let active = 0, peak = 0;
    f.widget.platformService.readConversationHistorySession = async id => {
        peak = Math.max(peak, ++active); await idle(); active--;
        f.widget.codingSessions = f.widget.codingSessions.map(row => row.id === id ? { ...row, draftPrompt: `new ${id}` } : row);
        return structuredClone(f.durable.get(id));
    };
    await f.flush(); assert.equal(peak, 8); assert.equal(f.widget.conversationHistoryPersistDirty, false);
    for (const original of originals) { assert.deepEqual(f.durable.get(original.id).turns, original.turns); assert.equal(f.durable.get(original.id).draftPrompt, `new ${original.id}`); }
});
