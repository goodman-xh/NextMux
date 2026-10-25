import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { codingProjectPathKey, codingSidebarProjects } from '../lib/browser/nextmux-sidebar-projects.js';
import { conversationText } from '../lib/browser/nextmux-conversation-locale.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widget);
const members = new Map(widget.members.filter(node => node.name).map(node => [node.name.getText(ast), node.getText(ast)]));
const names = ['codingSessionDeletionBlocked', 'codingSessionDeleteButtonProps', 'requestCodingSessionDeletion', 'deleteCodingSession',
    'undoExternalConversationImport', 'confirmProjectRemoval', 'confirmLocalDataModal', 'clearDesktopDataCategory', 'sameCodingSessionDragBucket', 'reorderCodingSession',
    'handleCodingSessionDragOver', 'codingSessionRunStartedAt', 'codingSessionActivityAt', 'orderedCodingSessions', 'reorderCodingProject', 'orderedCodingProjects',
    'workspaceRootIsOpen', 'openWorkspace', 'useDraftWorkspaceFolder', 'canDropFolderAsProject', 'handleComposerDrop', 'composerFilesFromTransfer',
    'computeTitlebarLayout', 'constrainPaneSizes', 'openCodeHostingServices', 'closeCouncilConfigModal', 'stopConversationAgentRun', 'clearConversationWakeup',
    'CONTEXT_PANEL_AUTO_COLLAPSE_WIDTH', 'CONTEXT_PANEL_AUTO_EXPAND_WIDTH', 'CONTEXT_PANEL_MIN_WIDTH', 'WORK_CONTEXT_MIN_WIDTH',
    'TERMINAL_LIST_MAX_WIDTH', 'FILE_LIST_MIN_WIDTH', 'TERMINAL_MIN_HEIGHT'];
const emitted = ts.transpileModule(`class NextMuxDesktopWidget { ${names.map(name => { assert.ok(members.has(name), name); return members.get(name); }).join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(overrides = {}, windows = false) {
    const frame = fn => fn();
    const browser = { nextmuxDesktop: {}, setTimeout, clearTimeout, localStorage: { setItem() {} } };
    const document = { body: { classList: { contains: name => name === 'windows' && windows } }, getElementById() { return null; } };
    const globals = { window: browser, document, requestAnimationFrame: frame, conversationText, codingProjectPathKey,
        activeRunBelongsToSession: (a, b) => a === b, incognitoText: () => '', desktopDomainErrorText: (_, e) => String(e),
        DesktopDomainError: Error, droppedApplicationPath: () => false, Element: class {}, navigator: { platform: 'MacIntel' } };
    const C = new Function(...Object.keys(globals), `${emitted}; return NextMuxDesktopWidget;`)(...Object.values(globals));
    const state = Object.assign(new C(), {
        desktopLocale: 'zh-CN', codingSessions: [{ id: 'a', workspacePath: '/p', turns: [], createdAt: 1, updatedAt: 1 }],
        conversationAgentRuns: new Map(), conversationWindows: [], conversationHasActiveRun: () => false, conversationWakeupTimers: new Map(),
        scheduledAgentRuns: new Map(), agentChildContinuationStates: new Map(), conversationMutations: { tryAcquire: () => () => {} },
        codingSessionOrder: [], codingProjectOrder: [], removedCodingSessionIds: new Set(), codingSearchMatches: new Map(),
        terminalRecords: [], siteConversationOwners: new Map(), activeCodingSessionId: 'other', agentStage: 'idle',
        node: { querySelector() {} }, codingSessionNavigationGeneration: 0, activeSection: 'coding', codingPanel: 'thread',
        workspaceOptions: [{ path: '/p' }], expandedCodingProjects: new Set(),
        rememberNavigation() {}, update() {}, persistCodingSessions() { this.persisted = true; }, completeNavigationSurface() {},
        persistDesktopRestoreState() {}, setProjectVisible() {}, flushComposerDraft() {}, leaveCouncilRoleSubConversationToConversation() {},
        fileService: { resolve: async () => ({ isDirectory: true }) },
        workspaceConfigurationSaver: { runWorkspaceMutation: fn => fn() }, workspaceService: { addRoot() { throw new Error('unexpected duplicate root'); } },
        refreshWorkspaceRoots() {}, draftWorkspaceCanChange: session => Boolean(session && !session.turns.length),
        activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
        platformService: {}, conversationHistoryReady: () => true, localDataStage: 'idle',
        paneShellWidth: () => 1200, cachedPrimaryNavWidth: 248, cachedPrimaryNavIconWidth: 108, cachedWorkspaceControlsWidth: 136,
        contextPanelCollapsed: true, contextPanelWidth: 220, activeSection: 'coding', workContextOpen: false,
        effectiveWorkContextWidth() { return this.workContextWidth || 400; }, workContextIsOverlay: () => false,
        ...overrides
    });
    return { state, browser, globals };
}

for (const reason of ['active', 'turn', 'header', 'dispatch', 'draining', 'scheduled', 'child', 'detached']) {
    test(`running deletion is blocked at menu and confirmation: ${reason}`, async () => {
        const { state } = fixture();
        const session = state.codingSessions[0];
        if (reason === 'active') state.conversationHasActiveRun = () => true;
        if (reason === 'turn') session.turns = [{ stage: 'running' }];
        if (reason === 'header') { session.historyLoaded = false; session.latestTurn = { stage: 'running' }; }
        if (reason === 'dispatch') session.followUpQueue = [{ dispatch: { state: 'sent' } }];
        if (reason === 'draining') state.conversationAgentRuns.set('a', { followUpQueueDraining: true });
        if (reason === 'scheduled') state.scheduledAgentRuns.set('a', {});
        if (reason === 'child') state.agentChildContinuationStates.set('c', { sessionId: 'a' });
        if (reason === 'detached') state.conversationWindows.push({ sessionId: 'a', running: true });
        state.requestCodingSessionDeletion('a');
        assert.equal(state.codingSessionDeleteId, undefined);
        const props = state.codingSessionDeleteButtonProps('a');
        assert.equal(props['aria-disabled'], true);
        assert.equal(props.disabled, undefined);
        assert.equal(props.title, '请先停止当前对话');
        assert.equal(props['data-nmx-tip'], props.title);
        assert.match(props.className, /is-blocked/);
        await state.deleteCodingSession('a');
        assert.equal(state.codingSessions.length, 1);
        state.localDataModalKind = 'conversations';
        await state.confirmLocalDataModal();
        await state.clearDesktopDataCategory('conversation_history');
        assert.equal(state.localDataModalKind, 'conversations');
    });
}

test('idle deletion directly removes history; a stale private confirmation rechecks after await', async () => {
    const { state, browser } = fixture();
    let releases = 0;
    state.conversationMutations.tryAcquire = () => () => releases++;
    state.requestCodingSessionDeletion('a');
    assert.equal(state.codingSessionDeleteId, 'a');
    await state.deleteCodingSession('a');
    assert.equal(state.codingSessions.length, 0);
    assert.ok(state.removedCodingSessionIds.has('a'));
    assert.equal(state.persisted, true);
    state.codingSessions = [{ id: 'a', incognitoOrigin: true, turns: [] }];
    browser.nextmuxDesktop.finishIncognitoConversations = async () => { state.codingSessions[0].turns.push({ stage: 'running' }); return true; };
    await state.deleteCodingSession('a');
    assert.equal(state.codingSessions.length, 1);
    assert.equal(releases, 2);
});

test('project deletion rechecks a run that starts while history flush is pending', async () => {
    const { state } = fixture({ projectDeletePath: '/p', projectDeleteConversations: true, scheduledTasks: [] });
    let deleted = false, released = false;
    state.conversationMutations.tryAcquire = () => () => { released = true; };
    state.flushConversationHistory = async () => { state.codingSessions[0].followUpQueue = [{ dispatch: {} }]; };
    state.platformService.deleteProjectConversationHistory = async () => { deleted = true; };
    await state.confirmProjectRemoval();
    assert.equal(deleted, false);
    assert.equal(released, true);
    assert.equal(state.projectDeleteBusy, false);
});

test('normalized roots deduplicate Windows paths and preserve POSIX case', () => {
    assert.equal(codingProjectPathKey('C:\\Work\\one\\..\\Project\\'), 'c:/work/project');
    assert.notEqual(codingProjectPathKey('/work/A'), codingProjectPathKey('/work/a'));
    assert.notEqual(codingProjectPathKey('C:/'), codingProjectPathKey('C:'));
    const { state } = fixture({ workspaceOptions: [{ path: 'C:/Work/Project' }] });
    assert.equal(state.workspaceRootIsOpen('c:/WORK/./Project/'), true);
    assert.equal(state.workspaceRootIsOpen('c:/Work/Project/../other'), false);
    const roots = codingSidebarProjects([{ path: 'C:\\Work\\Project', label: 'first' }, { path: 'c:/work/project/', label: 'second' }], [{ workspacePath: 'C:/WORK/./Project' }]);
    assert.equal(roots.length, 1); assert.equal(roots[0].label, 'first');
});

test('pinned and ordinary conversations reject cross-project drag with no indicator', () => {
    for (const pinned of [true, false]) {
        const { state } = fixture({ codingSessionDragPinned: pinned, codingSessionDragId: 'a', codingSessionDragOver: { id: 'b' },
            projectDragContainsFolders: () => false, codingSessions: [{ id: 'a', workspacePath: '/p' }, { id: 'b', workspacePath: '/q' }] });
        const event = { preventDefault() { throw new Error('invalid drop accepted'); }, dataTransfer: {} };
        state.handleCodingSessionDragOver(event, 'b', pinned);
        state.reorderCodingSession('a', 'b', pinned);
        assert.equal(state.codingSessionDragOver, undefined); assert.deepEqual(state.codingSessionOrder, []);
    }
});

test('valid drag persists ordering while recent running turns float above it', () => {
    const sessions = [1, 2, 3].map(n => ({ id: String(n), workspacePath: '/p', createdAt: n, updatedAt: n, turns: [] }));
    const { state } = fixture({ codingSessions: sessions, codingSessionDragPinned: false, codingSessionOrder: ['1', '2', '3'] });
    state.reorderCodingSession('3', '1');
    assert.deepEqual(state.codingSessionOrder, ['3', '1', '2']); assert.equal(state.persisted, true);
    sessions[0].turns = [{ stage: 'running', createdAt: 10 }];
    sessions[1].turns = [{ stage: 'running', createdAt: 20 }];
    assert.deepEqual(state.orderedCodingSessions(sessions).map(s => s.id), ['2', '1', '3']);
    state.reorderCodingProject('/p', '/q', [{ path: '/p' }, { path: '/q' }]);
    assert.deepEqual(state.codingProjectOrder, ['/q', '/p']);
});

test('opening an existing normalized project focuses its unstarted draft without rebinding', async () => {
    let focused = 0;
    const { state } = fixture({ activeCodingSessionId: 'a', activeSection: 'settings', workspaceOptions: [{ path: 'C:/Work/Project' }],
        codingSessions: [{ id: 'a', workspacePath: 'c:/work/project/', turns: [] }], node: { querySelector: () => ({ focus() { focused++; } }) } });
    state.bindCodingDraftWorkspace = () => { throw new Error('unchanged draft rebound'); };
    assert.equal(await state.useDraftWorkspaceFolder({ path: { fsPath: () => 'C:\\WORK\\Project' } }), true);
    assert.equal(state.activeSection, 'coding'); assert.equal(state.codingPanel, 'thread'); assert.equal(focused, 1);
});

test('opening a project from a started conversation creates/reuses a project conversation', async () => {
    const { state } = fixture({ activeCodingSessionId: 'a', codingSessions: [{ id: 'a', workspacePath: '/p', turns: [{ stage: 'complete' }] }] });
    let created;
    state.createCodingSessionForWorkspace = path => (created = { workspacePath: path });
    assert.equal(await state.useDraftWorkspaceFolder({ path: { fsPath: () => '/p/.' } }), true);
    assert.equal(created.workspacePath, '/p');
});

test('folder body drop binds only an unstarted draft; composer/started drops attach', () => {
    for (const [mode, started, expected] of [['thread', false, true], ['composer', false, false], ['thread', true, false]]) {
        const { state } = fixture({ activeCodingSessionId: 'a', composerDropMode: mode, appControlAvailable: () => false,
            codingSessions: [{ id: 'a', turns: started ? [{ stage: 'complete' }] : [] }], update() {} });
        let actual;
        state.addComposerFolders = (_folders, _offset, options) => { actual = options.asProject; };
        state.handleComposerDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { files: [], items: [{ kind: 'file', getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: true, name: 'project' }) }] } });
        clearTimeout(state.composerDropPulseTimer);
        assert.equal(actual, expected);
    }
});

for (const windows of [false, true]) {
    test(`${windows ? 'Windows' : 'macOS'} titlebar preserves labels, then icons, then only drawer close`, () => {
        const { state } = fixture({}, windows);
        const cases = windows ? [[1000, false, false], [800, true, false], [650, false, true]] : [[800, false, false], [600, true, false], [400, false, true]];
        for (const [width, compact, crowded] of cases) assert.deepEqual(state.computeTitlebarLayout(width), { compact, crowded, contextCloseOnly: false });
        state.workContextOpen = true;
        assert.equal(state.computeTitlebarLayout(1400).crowded, false);
        assert.deepEqual(state.computeTitlebarLayout(windows ? 700 : 600), { compact: false, crowded: true, contextCloseOnly: false });
        assert.deepEqual(state.computeTitlebarLayout(300), { compact: false, crowded: true, contextCloseOnly: true });
        state.workContextIsOverlay = () => true;
        state.workContextWidth = windows ? 464 : 326;
        const before = state.computeTitlebarLayout(windows ? 900 : 600);
        state.workContextWidth++;
        assert.deepEqual(state.computeTitlebarLayout(windows ? 900 : 600), before, 'widening the drawer by 1px must not hide navigation');
    });
}

test('manual sidebar collapse survives widening; only automatic collapse is undone', () => {
    let width = 600;
    const { state } = fixture({ paneShellWidth: () => width, contextPanelCollapsed: false, contextPanelAutoCollapsed: false,
        clampPaneSize: v => v, contextPanelMaximumWidth: () => 500, workContextMaximumWidth: () => 500,
        terminalListMinimumWidth: () => 100, contextFileListMaximumWidth: () => 300, terminalMaximumHeight: () => 600,
        syncPaneCssVariables() {} });
    state.constrainPaneSizes(); assert.equal(state.contextPanelAutoCollapsed, true);
    width = 1500; state.constrainPaneSizes(); assert.equal(state.contextPanelCollapsed, false);
    state.contextPanelCollapsed = true; state.contextPanelAutoCollapsed = false;
    width = 600; state.constrainPaneSizes(); width = 1500; state.constrainPaneSizes();
    assert.equal(state.contextPanelCollapsed, true);
});

test('PR setup targets MCP settings with a fresh one-shot github query', () => {
    const { state } = fixture({ mcpSearchRequest: 0, openSettingsPanel(panel) { this.settingsPanel = panel; } });
    state.openCodeHostingServices();
    assert.equal(state.settingsPanel, 'mcp'); assert.equal(state.mcpInitialQuery, 'github'); assert.equal(state.mcpSearchRequest, 1);
    assert.match(members.get('renderGitWorkspacePanel'), /openCodeHostingServices/);
});

test('Council config remains mounted for 160ms while closing', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { state } = fixture({ councilConfigModalOpen: true });
    state.closeCouncilConfigModal(); assert.equal(state.councilConfigModalClosing, true);
    t.mock.timers.tick(159); assert.equal(state.councilConfigModalOpen, true);
    t.mock.timers.tick(1); assert.equal(state.councilConfigModalOpen, false);
});

test('stopping an already completed lead still stops only its own child continuations', async () => {
    const { state } = fixture({ agentChildContinuationStates: new Map([['one', { sessionId: 'a' }], ['two', { sessionId: 'b' }]]) });
    const stopped = [];
    state.stopAgentChild = async id => stopped.push(id);
    await state.stopConversationAgentRun('a');
    assert.deepEqual(stopped, ['one']);
});


test('bulk imported conversation removal blocks pending dispatch and rechecks after saving', async () => {
    const { state } = fixture();
    state.codingSessions[0].followUpQueue = [{ dispatch: {} }];
    assert.equal(await state.undoExternalConversationImport(['a']), 0);
    state.codingSessions[0].followUpQueue = [];
    let released = false;
    state.conversationMutations.tryAcquire = () => () => { released = true; };
    state.flushConversationHistory = async () => { state.codingSessions[0].turns = [{ stage: 'running' }]; };
    assert.equal(await state.undoExternalConversationImport(['a']), 0);
    assert.equal(state.codingSessions.length, 1); assert.equal(released, true);
});


test('native Open Project reuses a case-normalized Windows draft and only focuses it', async () => {
    let focused = 0;
    const { state } = fixture({ activeCodingSessionId: 'a', activeSection: 'settings', verifiedCodingProjectPaths: new Set(),
        workspaceOptions: [{ path: 'C:/Project' }], codingSessions: [{ id: 'a', workspacePath: 'c:/project/', turns: [] }],
        fileDialogService: { showOpenDialog: async () => ({ path: { fsPath: () => 'C:/PROJECT/.' } }) },
        node: { querySelector: () => ({ focus() { focused++; } }) } });
    state.createCodingSessionForWorkspace = () => { throw new Error('duplicate draft'); };
    state.openWorkspace();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(focused, 1); assert.equal(state.activeCodingSessionId, 'a'); assert.equal(state.activeSection, 'coding');
});


test('a hydrated completed turn overrides a stale running index header', () => {
    const { state } = fixture({ codingSessions: [{ id: 'a', historyLoaded: true, latestTurn: { stage: 'running' }, turns: [{ stage: 'complete' }] }] });
    assert.equal(state.codingSessionDeletionBlocked('a'), false);
});


test('titlebar does not reserve absent coding controls in Model Center or Settings', () => {
    const { state } = fixture({}, true);
    assert.equal(state.computeTitlebarLayout(700).compact, true);
    for (const section of ['models', 'settings', 'comic']) {
        state.activeSection = section;
        assert.deepEqual(state.computeTitlebarLayout(700), { compact: false, crowded: false, contextCloseOnly: false });
    }
});
