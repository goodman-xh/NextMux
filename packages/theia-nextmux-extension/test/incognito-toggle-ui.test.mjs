import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['renderIncognitoBadge', 'incognitoModeIsBusy', 'renderIncognitoToggle', 'requestIncognitoMode', 'dismissIncognitoMode', 'confirmIncognitoMode', 'applyIncognitoMode', 'resetDraftWorkspaceView', 'restoreCodingViewState', 'refreshIncognitoModeCaches', 'readComputerPermissionResumes', 'writeComputerPermissionResume', 'renderIncognitoModeConfirmation', 'createCodingSessionBranch', 'requestNewCodingConversation', 'openNewCodingConversation', 'emptyCodingDraftCandidate', 'unstartedCodingDraft', 'createIncognitoCodingSession', 'allocateIncognitoCodingSession', 'draftWorkspaceCanChange', 'bindCodingDraftWorkspace', 'useDraftWorkspaceFolder', 'removeDraftWorkspace', 'codingSessionWorkspaceRoot', 'ensureCodingSessionWorkspace'];
const methods = names.map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name);
    return method.getText(file);
}).join('\n');
const code = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const copy = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/browser/nextmux-incognito-text.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText)(copy);
const { incognitoText, INCOGNITO_TEXT_LOCALES } = copy;
const settle = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const elements = value => React.isValidElement(value) ? [value, ...React.Children.toArray(value.props.children).flatMap(elements)] : [];

function fixture() {
    const calls = [], bridge = [];
    const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
    const window = { localStorage: storage(), sessionStorage: storage(), nextmuxDesktop: { async setIncognitoConversationMode(value) { bridge.push(value); return true; }, async registerIncognitoConversation() { return true; }, async finishIncognitoConversations() { return true; } } };
    const Harness = new Function('React', 'incognitoText', 'conversationText', 'window', 'requestAnimationFrame', 'NextMuxDesktopWidget', 'DESKTOP_RESTORE_STATE_KEY', 'localizeDesktopSurface', 'desktopDomainErrorText', 'browserConversationKey', 'filePreviewRequestIsCurrent', 'normalizeContextFileScrollPositions', 'normalizeAgentChildScrollStates', 'workbenchText', 'DesktopDomainError', 'codingProjectPathKey', 'normalizeContextWindowTokens', `${code}; return Harness;`)(
        React, incognitoText, (_locale, key) => key, window, callback => callback(), { COMPUTER_PERMISSION_RESUME_KEY: 'permissions' }, 'restore', (_locale, key) => key, (_locale, error) => String(error), id => `session:${id}`, (live, expected, owner, previous) => live === expected && owner === previous, value => value || {}, value => value || {}, (_locale, key) => key, Error, require('../lib/browser/nextmux-sidebar-projects.js').codingProjectPathKey,
        require('../lib/common/nextmux-context-budget.js').normalizeContextWindowTokens);
    const state = new Harness();
    Object.assign(state, {
        desktopLocale: 'zh-CN', activeCodingSessionId: 'alpha', applicationExitPreparing: false,
        incognitoModeError: '', incognitoModeOperation: undefined, ready: true, busy: false,
        conversationHistoryPersistDirty: false, agentChildContinuationStates: new Map(),
        codingSessions: [{ id: 'alpha', workspacePath: '', incognito: true, incognitoOrigin: true, incognitoRevision: 0, privateWorkspacePath: '/owned/alpha/workspace',
            title: 'Original', turns: [{ id: 'turn', prompt: 'existing content' }], draftPrompt: 'unsent', updatedAt: 1 }, { id: 'beta', title: 'Other', turns: [] }],
        notifications: [{ id: 'a', incognitoSessionId: 'alpha' }, { id: 'b', conversationId: 'beta' }],
        conversationTabs: { tabs: {}, active: {} }, codingSessionOrder: ['alpha', 'beta'], removedCodingSessionIds: new Set(),
        conversationHistoryPersistedSessions: new Map(), conversationAgentRuns: new Map(), codingSearchMatches: new Map(), projectBrowsers: new Map(),
        contextFileChildren: new Map(), expandedContextDirectories: new Set(), contextFileTabs: new Map(),
        codingViewRestoreToken: 0, contextFilePreviewRequestToken: 0, contextFileHistoryRequestToken: 0, contextFileHistorySelectionToken: 0,
        cancelContextFileListScrollRestore() {}, boundedContextFileListScrollTop(value) { return value; }, syncActiveTerminal() {}, syncActiveBrowser() {}, scheduleContextFileListScrollRestore() {},
        codingSessionNavigationGeneration: 0, tiledCodingSessionIds: new Set(), navigationBackStack: [], navigationForwardStack: [],
        workspaceOptions: [], expandedCodingProjects: new Set(), setProjectVisible(path) { calls.push(['visible-project', path]); },
        fileService: { async resolve() { return { isDirectory: true }; } }, workspaceConfigurationSaver: { runWorkspaceMutation: callback => callback() },
        workspaceService: { async addRoot() {} }, async refreshWorkspaceRoots() {},
        activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
        workspaceRootIsOpen() { return true; }, async verifyCodingProjectPath() { return true; },
        activeWorkspaceRoot: '', goalDraftsBySession: new Map(), composerApps: new Map(), terminalRecords: [], prompt: '', attachments: [], pastedTextReferences: [],
        pendingAttachmentImports: new Map(), draftAttachmentRestores: new Map(), pastedTextPersistence: new Map(), unpersistedPastedTextReferences: new Map(),
        hasPendingAttachmentImports() { return false; }, hasPendingDraftAttachments() { return false; }, detachContextEditorRecovery() { calls.push(['capture-project-view', this.activeCodingSessionId]); return true; },
        hasUnresolvedDraftAttachments() { return false; }, restoreComposerDraft(session) { calls.push('restore-draft'); this.prompt = session.draftPrompt || ''; this.attachments = session.draftAttachments || []; },
        activeModelRoute() { return undefined; }, reasoningSettingsForRoute() { return {}; },
        startNewCodingTask() { calls.push('new-normal'); this.activeCodingSessionId = ''; this.prompt = ''; },
        async openCodingSession(id) { calls.push(['open', id]); this.activeCodingSessionId = id; },
        addNotification(...args) { calls.push(['notification', ...args]); },
        conversationHasActiveRun() { return this.busy; }, conversationHistoryReady() { return this.ready; },
        async hydrateCodingSession(id) { return this.codingSessions.find(item => item.id === id); },
        flushComposerDraft() { calls.push('draft'); }, async flushConversationHistory() { calls.push('flush'); },
        persistCodingSessions() { calls.push('persist'); }, persistDesktopRestoreState() { calls.push('restore'); },
        persistNotifications() { calls.push('notifications'); }, persistManagedPriceNotices() { calls.push('prices'); },
        persistProjectBrowsers() { calls.push('browsers'); }, setConversationTabs(next) { calls.push('tabs'); this.conversationTabs = next; },
        update() {}, trapDialogFocus() {}, leaveCouncilRoleSubConversationToConversation() {}, node: { querySelector() { return { focus() { calls.push('focus'); } }; } },
        platformService: { async canReuseEmptyConversation(id) { calls.push(['empty-check', id]); return true; },
          async createIncognitoConversation() { calls.push('allocate-private'); return { id: `private-created-${calls.filter(item => item === 'allocate-private').length}`, workspaceRoot: '/owned/private-created/workspace' }; },
          async closeIncognitoConversations(ids) { calls.push(['close-private', ids]); },
          async getConversationWorkspace(id) { return `/owned/${id}/workspace`; },
          async bindConversationDraftWorkspace(request) {
            calls.push(['bind', request]);
            const current = state.codingSessions.find(item => item.id === request.id);
            return { session: { ...current, workspacePath: request.workspacePath, ownedWorkspace: !request.workspacePath,
                privateWorkspacePath: undefined, workspaceBindings: undefined, updatedAt: current.updatedAt + 1 }, workspaceRoot: request.workspacePath || `/owned/${request.id}/workspace` };
          },
          async setConversationIncognito(request) {
            calls.push(request);
            assert.equal(request.incognito, false);
            const current = state.codingSessions.find(item => item.id === request.id);
            return { session: { ...current, incognito: false, incognitoOrigin: true, incognitoRevision: (current.incognitoRevision ?? 0) + 1 },
                workspaceRoot: `/owned/${current.id}/workspace` };
        } }
    });
    return { state, calls, bridge, window };
}

for (const locale of INCOGNITO_TEXT_LOCALES) test(`${locale}: one-way conversion status and confirmation are translated`, () => {
    assert.equal(INCOGNITO_TEXT_LOCALES.length, 12);
    for (const key of ['onHint', 'disableTitle', 'disableBody', 'disableAction', 'switching', 'busy', 'failed']) {
        const value = incognitoText(locale, key);
        assert.equal(typeof value, 'string'); assert.ok(value.trim());
        if (locale !== 'en') assert.notEqual(value, incognitoText('en', key));
    }
});

test('rapid incognito clicks create once, then repeated clicks reuse the verified empty conversation', async () => {
    const { state, calls } = fixture(); state.codingSessions = []; state.activeCodingSessionId = '';
    const first = state.createIncognitoCodingSession(), second = state.createIncognitoCodingSession();
    assert.equal(first, second); await Promise.all([first, second]);
    assert.equal(calls.filter(item => item === 'allocate-private').length, 1); assert.equal(state.codingSessions.length, 1);
    await state.createIncognitoCodingSession();
    assert.equal(calls.filter(item => item === 'allocate-private').length, 1); assert.equal(state.codingSessions.length, 1);
    assert.ok(calls.some(item => Array.isArray(item) && item[0] === 'open' && item[1] === 'private-created-1'));
});

test('empty-looking records with real workspace files are not reused or deleted', async () => {
    const { state, calls } = fixture();
    const owned = { id: 'private-files', workspacePath: '', titleOrigin: 'default', turns: [], incognito: true, incognitoOrigin: true, updatedAt: 1 };
    state.codingSessions = [owned]; state.activeCodingSessionId = '';
    state.platformService.canReuseEmptyConversation = async () => false;
    await state.createIncognitoCodingSession();
    assert.equal(state.codingSessions.length, 2); assert.ok(state.codingSessions.includes(owned));
    assert.equal(calls.some(item => Array.isArray(item) && item[0] === 'close-private'), false);
});

test('typed text, attachments, hidden drafts, tasks and tabs each prevent empty-draft reuse', () => {
    const { state } = fixture();
    const blank = { id: 'private-empty', workspacePath: '', titleOrigin: 'default', turns: [], incognito: true, incognitoOrigin: true, updatedAt: 1 };
    assert.equal(state.emptyCodingDraftCandidate(blank, true, ''), true);
    for (const change of [{ draftPrompt: ' ' }, { draftAttachments: [{}] }, { draftPastedTextReferences: '[{}]' }, { agentChildDrafts: [{}] }, { goal: {} },
        { followUpQueue: [{}] }, { historyLoaded: false }, { turnCount: 1 }, { turns: [{}] }, { sourceConversationId: 'source' }, { pinned: true }, { browsers: [{}] }]) {
        assert.equal(state.emptyCodingDraftCandidate({ ...blank, ...change }, true, ''), false, JSON.stringify(change));
    }
    for (const collection of [state.goalDraftsBySession, state.composerApps]) {
        collection.set(blank.id, 'hidden'); assert.equal(state.emptyCodingDraftCandidate(blank, true, ''), false); collection.clear();
    }
    state.conversationTabs.tabs[blank.id] = [{}]; assert.equal(state.emptyCodingDraftCandidate(blank, true, ''), false); delete state.conversationTabs.tabs[blank.id];
    state.busy = true; assert.equal(state.emptyCodingDraftCandidate(blank, true, ''), false);
});

test('a draft being edited in another window is not borrowed by the primary new entry', async () => {
    const { state, calls } = fixture(); state.codingSessions = [{ ...state.codingSessions[0], turns: [], titleOrigin: 'default' }];
    state.tiledCodingSessionIds.add('alpha');
    await state.createIncognitoCodingSession();
    assert.equal(calls.filter(item => item === 'allocate-private').length, 1);
    assert.equal(state.codingSessions.length, 2); assert.ok(state.codingSessions.some(item => item.id === 'alpha'));
});

test('top entry keeps the same unsent draft, including text and attachments, in its current mode', async () => {
    const { state, calls } = fixture();
    state.codingSessions[0] = { ...state.codingSessions[0], turns: [], incognito: false, incognitoOrigin: undefined, draftPrompt: 'keep this text', draftAttachments: [{ id: 'file', uri: 'file:///fixture/image.png' }] };
    const original = state.codingSessions[0]; state.prompt = original.draftPrompt;
    await Promise.all([state.requestNewCodingConversation(false), state.requestNewCodingConversation(false)]);
    assert.equal(state.codingSessions[0], original); assert.equal(state.prompt, original.draftPrompt);
    assert.equal(calls.includes('new-normal'), false); assert.equal(calls.includes('allocate-private'), false);
});

test('started or running conversations are kept when a new-mode entry is requested', async () => {
    for (const running of [false, true]) {
        const { state, calls } = fixture(); state.busy = running;
        const previous = state.codingSessions[0]; await state.createIncognitoCodingSession();
        assert.equal(calls.filter(item => item === 'allocate-private').length, 1);
        assert.ok(state.codingSessions.includes(previous)); assert.equal(previous.turns[0].prompt, 'existing content');
    }
});

test('a saved goal or queued task is not treated as an unsent composer draft', () => {
    const { state } = fixture(); const draft = { id: 'draft', turns: [], historyLoaded: true };
    assert.equal(state.unstartedCodingDraft(draft), true);
    for (const change of [{ goal: { prompt: 'saved task' } }, { followUpQueue: [{}] }, { agentChildDrafts: [{}] }]) assert.equal(state.unstartedCodingDraft({ ...draft, ...change }), false);
});

test('quitting during creation cleans only the still-unused new private container', async () => {
    const { state, calls } = fixture(), gate = defer(); state.codingSessions = []; state.activeCodingSessionId = '';
    state.platformService.createIncognitoConversation = async () => { await gate.promise; return { id: 'unopened', workspaceRoot: '/owned/unopened' }; };
    const pending = state.createIncognitoCodingSession(); await settle(); state.applicationExitPreparing = true;
    gate.resolve(); await pending;
    assert.deepEqual(calls.find(item => Array.isArray(item) && item[0] === 'close-private'), ['close-private', ['unopened']]);
    assert.equal(state.codingSessions.length, 0);
});

test('branches of retained normal conversations do not acquire incognito-origin privileges', () => {
    const { state } = fixture();
    for (const incognito of [true, false]) {
        const original = { ...state.codingSessions[0], incognito, incognitoRevision: 4 };
        const branch = state.createCodingSessionBranch(original, original.turns, undefined, 20);
        assert.notEqual(branch.id, original.id);
        assert.equal(branch.incognito, incognito ? true : undefined);
        assert.equal(branch.incognitoOrigin, incognito ? true : undefined);
        assert.equal(branch.incognitoRevision, incognito ? 0 : undefined);
        assert.equal(Boolean(state.renderIncognitoToggle(branch)), incognito);
    }
});

test('running roots or child tasks block changing mode without stopping them', () => {
    const { state, calls } = fixture(); state.busy = true;
    assert.equal(state.renderIncognitoToggle(state.codingSessions[0]).props.disabled, true);
    assert.match(state.renderIncognitoToggle(state.codingSessions[0]).props.title, /^当前已开启：无痕对话\n/);
    state.requestIncognitoMode('alpha'); assert.equal(state.pendingIncognitoMode, undefined);
    state.busy = false; state.agentChildContinuationStates.set('child', { sessionId: 'alpha' });
    state.requestIncognitoMode('alpha'); assert.equal(state.pendingIncognitoMode, undefined); assert.deepEqual(calls, []);
});

test('confirmation has both consequences, trapped focus, pressed state and safe cancellation', () => {
    const { state, calls } = fixture();
    state.requestIncognitoMode('alpha');
    const tree = elements(state.renderIncognitoModeConfirmation());
    const dialog = tree.find(node => node.props.role === 'alertdialog');
    assert.equal(dialog.props['aria-modal'], 'true');
    const paragraph = tree.find(node => node.props.id === 'nmx-incognito-mode-description');
    assert.match(paragraph.props.children, /不会自动删除/);
    const safe = tree.find(node => node.type === 'button' && node.props.autoFocus);
    assert.equal(safe.props.children, 'cancel'); safe.props.onClick();
    assert.equal(state.pendingIncognitoMode, undefined); assert.deepEqual(calls, ['focus']);
    state.codingSessions[0] = { ...state.codingSessions[0], incognito: false };
    state.requestIncognitoMode('alpha');
    assert.equal(state.pendingIncognitoMode, undefined);
    assert.equal(state.renderIncognitoToggle(state.codingSessions[0]), undefined);
});

test('a pending save never repaints mode early and a duplicate click cannot duplicate the RPC', async () => {
    const { state, calls } = fixture(), gate = defer();
    const original = state.platformService.setConversationIncognito;
    state.platformService.setConversationIncognito = async request => { await gate.promise; return original(request); };
    state.requestIncognitoMode('alpha'); const first = state.confirmIncognitoMode(); await settle();
    assert.equal(state.codingSessions[0].incognito, true); assert.ok(state.incognitoModeOperation);
    await state.confirmIncognitoMode(); state.dismissIncognitoMode(); assert.ok(state.pendingIncognitoMode);
    gate.resolve(); await first;
    assert.equal(state.codingSessions[0].incognito, false); assert.equal(calls.filter(item => typeof item === 'object').length, 1);
});

test('backend refusal and an unsaved draft leave the original mode and content intact', async () => {
    for (const scenario of ['backend', 'dirty', 'became-running']) {
        const { state, calls, bridge } = fixture(); const original = state.codingSessions[0];
        if (scenario === 'backend') state.platformService.setConversationIncognito = async () => { throw new Error('INCOGNITO_MODE_SAVE_FAILED'); };
        else state.flushConversationHistory = async () => { if (scenario === 'dirty') state.conversationHistoryPersistDirty = true; else state.busy = true; };
        state.requestIncognitoMode('alpha'); await state.confirmIncognitoMode();
        assert.equal(state.codingSessions[0], original); assert.ok(state.incognitoModeError); assert.ok(state.pendingIncognitoMode);
        assert.equal(bridge.length, 0); assert.equal(calls.includes('persist'), false);
    }
});

test('switching another window/selection does not apply the result to the new foreground conversation', async () => {
    const { state } = fixture(); state.requestIncognitoMode('alpha'); state.activeCodingSessionId = 'beta';
    await state.confirmIncognitoMode(); assert.equal(state.codingSessions[0].incognito, false);
    assert.equal(state.codingSessions[1].incognito, undefined); assert.equal(state.activeCodingSessionId, 'beta');
});

test('lost native ACK cannot undo an already committed backend mode', async () => {
    const { state, window } = fixture(); window.nextmuxDesktop.setIncognitoConversationMode = async () => { throw new Error('native reply lost'); };
    state.requestIncognitoMode('alpha'); await state.confirmIncognitoMode();
    assert.equal(state.codingSessions[0].incognito, false); assert.equal(state.incognitoModeError, ''); assert.equal(state.pendingIncognitoMode, undefined);
});

test('turning on purges only this owner from shared history, order, permissions and reload hints', () => {
    const { state, window } = fixture(), store = window.localStorage;
    const permission = { turnId: 't', requestId: 'r', at: Date.now() };
    store.setItem('permissions', JSON.stringify({ alpha: permission, beta: permission }));
    store.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({ version: 3, complete: false, sessions: [{ id: 'alpha', draftPrompt: 'private' }, { id: 'beta', draftPrompt: 'keep' }] }));
    store.setItem('nextmux.desktop.codingSessionOrder.v1', JSON.stringify(['alpha', 'beta']));
    store.setItem('restore', JSON.stringify({ activeCodingSessionId: 'alpha', workspace: '/owned/alpha', section: 'coding' }));
    window.sessionStorage.setItem('nextmux.desktop.reloadState.v1', JSON.stringify({ codingSessionId: 'alpha', prompt: 'private' }));
    state.refreshIncognitoModeCaches(state.codingSessions[0]);
    assert.deepEqual(JSON.parse(store.getItem('permissions')), { beta: permission });
    assert.deepEqual(JSON.parse(store.getItem('nextmux.desktop.codingSessions.v1')).sessions, [{ id: 'beta', draftPrompt: 'keep' }]);
    assert.deepEqual(JSON.parse(store.getItem('nextmux.desktop.codingSessionOrder.v1')), ['beta']);
    assert.equal(JSON.parse(store.getItem('restore')).activeCodingSessionId, '');
    assert.equal(window.sessionStorage.getItem('nextmux.desktop.reloadState.v1'), null);
});

test('the only mode action converts private to normal; retained origins cannot re-enable it', async () => {
    const { state, calls } = fixture();
    state.requestIncognitoMode('alpha'); await state.confirmIncognitoMode();
    const retained = state.codingSessions[0];
    assert.equal(retained.incognito, false); assert.equal(retained.incognitoOrigin, true);
    assert.equal(state.renderIncognitoToggle(retained), undefined);
    assert.equal(state.conversationHistoryPersistedSessions.get('alpha'), retained);
    state.requestIncognitoMode('alpha'); await state.confirmIncognitoMode({ sessionId: 'alpha', enabled: true });
    assert.equal(state.codingSessions[0], retained); assert.equal(state.pendingIncognitoMode, undefined);
    assert.equal(calls.filter(value => value?.id === 'alpha').length, 1);
});

test('top incognito starts a separate private draft and preserves an ordinary draft with its input and attachments', async () => {
    for (const incognitoOrigin of [false, true]) {
        const { state, calls } = fixture();
        const previous = { ...state.codingSessions[0], incognito: false, incognitoOrigin, turns: [], draftPrompt: 'keep text', draftAttachments: [{ id: 'file', uri: 'file:///existing.txt' }] };
        state.codingSessions = [previous]; state.prompt = previous.draftPrompt; state.attachments = previous.draftAttachments;
        await state.createIncognitoCodingSession();
        assert.ok(state.codingSessions.includes(previous)); assert.equal(previous.draftAttachments[0].uri, 'file:///existing.txt');
        assert.notEqual(state.activeCodingSessionId, previous.id); assert.equal(state.activeCodingSession().incognito, true);
        assert.equal(calls.filter(value => value?.id === previous.id).length, 0);
    }
});

test('top normal directly retains an entirely empty private draft and confirms a draft with content or owned files', async () => {
    for (const occupied of ['empty', 'text', 'attachment', 'file']) {
        const { state } = fixture();
        state.codingSessions = [{ ...state.codingSessions[0], turns: [], titleOrigin: 'default', draftPrompt: occupied === 'text' ? 'keep' : '', draftAttachments: occupied === 'attachment' ? [{ id: 'file' }] : [] }];
        state.platformService.canReuseEmptyConversation = async () => occupied !== 'file';
        await state.requestNewCodingConversation(false);
        assert.equal(state.codingSessions[0].incognito, occupied !== 'empty');
        assert.equal(Boolean(state.pendingIncognitoMode), occupied !== 'empty');
        assert.equal(state.codingSessions.length, 1);
    }
});

test('alternating empty top entries reuses one normal and one private draft without deleting either', async () => {
    const { state, calls } = fixture();
    state.codingSessions = [{ ...state.codingSessions[0], turns: [], titleOrigin: 'default', draftPrompt: '' }];
    for (let iteration = 0; iteration < 8; iteration++) {
        await state.requestNewCodingConversation(false);
        assert.equal(state.activeCodingSession().incognito, false);
        await state.requestNewCodingConversation(true);
        assert.equal(state.activeCodingSession().incognito, true);
    }
    assert.equal(state.codingSessions.length, 2);
    assert.equal(calls.filter(value => value === 'allocate-private').length, 1);
    assert.equal(calls.some(value => value?.[0] === 'close-private'), false);
});

test('normal retained origins and ordinary persisted drafts expose project selection; private and started ones do not', () => {
    const { state } = fixture();
    for (const incognitoOrigin of [false, true]) {
        const normal = { ...state.codingSessions[0], incognito: false, incognitoOrigin, turns: [] };
        assert.equal(state.draftWorkspaceCanChange(normal), true);
        assert.equal(state.draftWorkspaceCanChange({ ...normal, turns: [{}] }), false);
    }
    assert.equal(state.draftWorkspaceCanChange({ ...state.codingSessions[0], turns: [] }), false);
    assert.match(source, /showDraftWorkspace = [^;]*this\.draftWorkspaceCanChange\(codingSession\)/);
});

test('folder binding keeps the draft ID and attachments, commits its baseline, and selects the actual project', async () => {
    for (const incognitoOrigin of [false, true]) {
        const { state, calls } = fixture();
        const original = { ...state.codingSessions[0], incognito: false, incognitoOrigin, turns: [], incognitoRevision: 1,
            draftPrompt: 'pending text', draftAttachments: [{ id: 'attachment', uri: 'file:///original/attachment' }] };
        state.codingSessions = [original]; state.prompt = original.draftPrompt;
        assert.equal(await state.useDraftWorkspaceFolder({ path: { fsPath: () => '/user/project' } }), true);
        const next = state.codingSessions[0];
        assert.equal(next.id, original.id); assert.equal(state.activeCodingSessionId, original.id);
        assert.equal(next.workspacePath, '/user/project'); assert.equal(next.privateWorkspacePath, undefined);
        assert.equal(next.ownedWorkspace, false); assert.equal(state.activeWorkspaceRoot, '/user/project');
        assert.equal(state.prompt, original.draftPrompt); assert.equal(state.attachments[0].uri, original.draftAttachments[0].uri);
        assert.equal(state.conversationHistoryPersistedSessions.get(next.id), next);
        assert.ok(state.expandedCodingProjects.has('/user/project'));
        const request = calls.find(value => value?.[0] === 'bind')[1];
        assert.equal(request.expectedUpdatedAt, original.updatedAt); assert.equal(request.expectedRevision, incognitoOrigin ? 1 : undefined);
        await state.removeDraftWorkspace();
        assert.equal(state.activeCodingSessionId, original.id); assert.equal(state.codingSessions[0].workspacePath, '');
        assert.equal(state.codingSessions[0].ownedWorkspace, true); assert.equal(state.codingSessions[0].privateWorkspacePath, '/owned/alpha/workspace');
        assert.equal(state.prompt, original.draftPrompt);
    }
});

test('failed project binding preserves the original draft, root and acknowledgement', async () => {
    const { state } = fixture();
    const original = { ...state.codingSessions[0], incognito: false, turns: [], draftPrompt: 'keep' };
    state.codingSessions = [original]; state.conversationHistoryPersistedSessions.set(original.id, original);
    state.platformService.bindConversationDraftWorkspace = async () => { throw new Error('CAS failed'); };
    assert.equal(await state.bindCodingDraftWorkspace(original.id, '/user/project'), false);
    assert.equal(state.codingSessions[0], original); assert.equal(state.conversationHistoryPersistedSessions.get(original.id), original);
    assert.equal(state.activeCodingSessionId, original.id); assert.match(state.attachmentError, /CAS failed/);
});

test('project binding waits for captured-owner uploads and does not repaint another foreground conversation', async () => {
    const { state, calls } = fixture(), gate = defer();
    state.codingSessions[0] = { ...state.codingSessions[0], incognito: false, turns: [] };
    state.pendingAttachmentImports.set(gate.promise, { sessionId: 'alpha' });
    const pending = state.bindCodingDraftWorkspace('alpha', '/project'); await settle();
    assert.equal(calls.some(value => value?.[0] === 'bind'), false);
    state.activeCodingSessionId = 'beta'; state.prompt = 'other editor'; state.activeWorkspaceRoot = '/other';
    gate.resolve(); assert.equal(await pending, true);
    assert.equal(state.prompt, 'other editor'); assert.equal(state.activeWorkspaceRoot, '/other'); assert.equal(state.activeCodingSessionId, 'beta');
    assert.equal(state.codingSessions.find(session => session.id === 'alpha').workspacePath, '/project');
});

test('normal-origin explicit projects win over stale private paths while native registration uses only its controlled container', async () => {
    const { state, window } = fixture(), registrations = [];
    const current = { ...state.codingSessions[0], incognito: false, workspacePath: '/project', ownedWorkspace: false,
        privateWorkspacePath: '/stale/private', workspaceBindings: [{ kind: 'private', path: '/stale/private' }] };
    window.nextmuxDesktop.registerIncognitoConversation = async request => { registrations.push(request); return true; };
    assert.equal(state.codingSessionWorkspaceRoot(current), '/project');
    assert.equal(await state.ensureCodingSessionWorkspace(current), current);
    assert.deepEqual(registrations, [{ id: 'alpha', workspaceRoot: '/owned/alpha/workspace' }]);
});

test('one-way badge stays beside add-content and has the permission foreground color', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(source, /title='添加内容'[\s\S]{0,250}this\.renderIncognitoToggle\(codingSession\)/);
    assert.match(css, /\.nmx-permission-button > i,\s*\.nmx-incognito-toggle\[aria-pressed='true'\] > i\s*\{/);
    assert.match(incognitoText('en', 'disableBody'), /cannot be made incognito again/);
});
