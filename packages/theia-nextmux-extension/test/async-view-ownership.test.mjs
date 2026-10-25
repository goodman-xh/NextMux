import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['toggleCodingSessionPin', 'sessionPermissionMode', 'requestTurnEditConfirmation', 'dismissTurnEditConfirmation', 'resetTurnEditRestore',
  'completeNavigationSurface', 'dismissTopSurface', 'hasDismissibleSurface', 'rememberNavigation',
  'restoreCodingSessionState', 'restoreCodingViewState', 'toggleWorkContext', 'showBrowserWorkContext',
  'showFileWorkContext', 'showAgentWorkContext', 'openAgentChildContext', 'openCodingSession', 'selectSection', 'clearComicLibrarySurfaces',
  'saveScheduledTask', 'closeNavigationSurface', 'hasTransientNavigationSurface', 'sameNavigationLocation', 'createComicProject', 'comicWorkspaceRequestCurrent',
  'openComicCreateSheet', 'navigateBack', 'applyNavigationSnapshot', 'applyNavigationSurface', 'clearNavigationSurfaces', 'noteBrowserDrawerDismissed'];
const methods = names.map(name => {
  const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
  assert.ok(member, name); return member.getText(file);
});
const dependencies = {
  ...createRequire(import.meta.url)('../lib/common/nextmux-price-quote.js'),
  ...createRequire(import.meta.url)('../lib/common/nextmux-schedule.js'),
  ...createRequire(import.meta.url)('../lib/common/nextmux-model-controls.js'),
  ...createRequire(import.meta.url)('../lib/common/nextmux-context-budget.js'),
  conversationCheckpointIdsToRestore: createRequire(import.meta.url)('../lib/browser/nextmux-conversation-branch.js').conversationCheckpointIdsToRestore,
  URI: { fromFilePath: path => ({ scheme: 'file', path }) }, FileType: { Directory: 2 },
  normalizeDesktopSettingsPanel: value => value, window: { setTimeout() {}, clearTimeout() {} },
  normalizeContextFileScrollPositions: value => value || {}, normalizeAgentChildScrollStates: value => value || {},
  filePreviewRequestIsCurrent: (currentToken, token, currentId, id) => currentToken === token && currentId === id,
  NextMuxDesktopWidget: {}, requestAnimationFrame() {}
};
const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { modelReasoningContract() { return undefined; } ${methods.join('\n')} }; return Harness;`, {
  target: ts.ScriptTarget.ES2022
}))(...Object.values(dependencies));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const hydration = deferred(), workspace = deferred(), state = new Harness();
  const child = { childRunId: 'saved-child' }, newerChild = { childRunId: 'new-child' };
  const session = { id: 'current', workspacePath: '/pending-root', permissionMode: 'workspace_write',
    turns: [{ id: 'turn', stage: 'complete', prompt: 'original', childAgents: [child, newerChild] }],
    viewState: { workContextOpen: true, workContextMode: 'agent', activeAgentChildId: child.childRunId } };
  const other = { id: 'other', pinned: false, updatedAt: 1, turns: [] };
  Object.assign(state, {
    activeCodingSessionId: session.id, codingSessions: [session, other], activeSection: 'coding', codingPanel: 'thread',
    codingViewRestoreToken: 0, codingSessionNavigationGeneration: 0, contextFilePreviewRequestToken: 0,
    navigationBackStack: [], navigationForwardStack: [], codingSessionMenuId: 'other', codingPopover: '',
    workContextMode: 'file', workContextOpen: true, contextFileTabs: new Map(), contextFileChildren: new Map(),
    activeAgentChildId: '', liveAgentChildren: [], permissionMode: 'read_only', defaultPermissionMode: 'read_only',
    editingTurnValue: 'later edit', isDisposed: false, persisted: 0, focused: 0,
    activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
    hydrateCodingSession: () => hydration.promise, ensureCodingSessionWorkspace: () => workspace.promise,
    codingSessionWorkspaceRoot: () => '', loadContextFiles: async () => {},
    conversationHistoryReady: () => true, flushComposerDraft() {},
    focusTurnEditor() { this.focused++; }, persistCodingSessions() { this.persisted++; },
    navigationSnapshot() { return { menu: this.codingSessionMenuId, mode: this.workContextMode,
      section: this.activeSection, codingPanel: this.codingPanel, codingSessionId: this.activeCodingSessionId,
      workspaceRoot: '', surface: { kind: 'none' } }; },
    navigationSnapshotKey: value => JSON.stringify(value),
    restoreCodingSourceSelection() {}, hydrateDelegationLedgersForSession() {}, reconcileInterruptedAgentRun: async () => {},
    // DOM reading anchors and per-conversation tab connections have their own tests.
    captureThreadReadingAnchor() {}, disconnectInactiveConversationTabs() {},
    comicCreateExistingChildren: new Map(),
    detachContextEditorRecovery: () => true, captureContextEditorRecovery: () => true, cancelContextFileListScrollRestore() {}, boundedContextFileListScrollTop: value => value,
    clampPaneSize: value => value, syncPaneCssVariables() {}, schedulePaneResizeUpdate() {},
    syncActiveTerminal() {}, syncActiveBrowser() {}, currentAgentChildren: () => [child, newerChild],
    scheduleContextFileListScrollRestore() {}, constrainPaneSizes() {}, persistActiveCodingSessionState() {},
    currentCodingBrowsers: () => [{ id: 'browser' }], loadSiteState: async () => {}, update() {},
    tiledCodingSessionIds: new Set(), removedCodingSessionIds: new Set(), expandedCodingProjects: new Set(),
    workspaceOptions: [], scheduledTasks: [], agentStage: 'idle',
    stopVoiceInput() {}, restoreComposerDraft() {}, persistDesktopRestoreState() {}, syncActiveRelay() {}, syncModelRoute() {},
    workspaceRootIsOpen: () => false, addNotification() {}, resetWalletTopupSurface() {}, clearOfficialProviderSurface() {},
    closeModelEffortPickerImmediately() {}, syncComicSelection() {}, comicCanvasFor: () => ({ width: 1920, height: 1080 })
  });
  return { state, session, hydration, workspace };
}

test('delayed pin hydration preserves a later confirmation while persisting the requested pin', async () => {
  const f = fixture(), operation = f.state.toggleCodingSessionPin('other');
  f.state.workContextMode = 'agent';
  f.state.requestTurnEditConfirmation('current', 'turn'); const confirmation = f.state.pendingTurnEdit;
  assert.ok(confirmation); f.hydration.resolve(true); await operation;
  assert.equal(f.state.pendingTurnEdit, confirmation); assert.equal(f.state.workContextMode, 'agent');
  assert.equal(f.state.codingSessions.find(session => session.id === 'other').pinned, true);
  assert.equal(f.state.persisted, 1);
  f.state.dismissTurnEditConfirmation(); assert.equal(f.state.pendingTurnEdit, undefined); assert.equal(f.state.focused, 1);
});

test('delayed pin completion cannot close a later menu or a replaced navigation surface', async () => {
  for (const changed of ['menu', 'navigation']) {
    const f = fixture(), operation = f.state.toggleCodingSessionPin('other');
    if (changed === 'menu') f.state.codingSessionMenuId = 'current';
    else f.state.rememberNavigation();
    f.hydration.resolve(true); await operation;
    assert.equal(f.state.codingSessionMenuId, changed === 'menu' ? 'current' : 'other');
  }
});

test('pin completion still dismisses its unchanged original menu through the production method', async () => {
  const f = fixture(), operation = f.state.toggleCodingSessionPin('other');
  f.hydration.resolve(true); await operation;
  assert.equal(f.state.codingSessionMenuId, ''); assert.equal(f.state.workContextOpen, true);
});

test('delayed session hydration cannot overwrite a later explicit drawer selection', async () => {
  for (const action of ['showFileWorkContext', 'showBrowserWorkContext', 'showAgentWorkContext', 'openAgentChildContext', 'toggleWorkContext']) {
    const f = fixture(), operation = f.state.restoreCodingSessionState(f.session);
    f.state[action]('new-child');
    const expected = { mode: f.state.workContextMode, open: f.state.workContextOpen, child: f.state.activeAgentChildId };
    f.workspace.resolve(f.session); await operation;
    assert.deepEqual({ mode: f.state.workContextMode, open: f.state.workContextOpen, child: f.state.activeAgentChildId }, expected, action);
    assert.equal(f.state.permissionMode, 'workspace_write', 'current session permissions initialize even when its saved view is superseded');
  }
});

test('delayed session hydration preserves a later edit confirmation and settings navigation', async () => {
  for (const action of ['confirmation', 'section', 'panel', 'session', 'generation', 'disposed']) {
    const f = fixture(), operation = f.state.restoreCodingSessionState(f.session);
    if (action === 'confirmation') f.state.requestTurnEditConfirmation('current', 'turn');
    if (action === 'section') f.state.activeSection = 'settings';
    if (action === 'panel') f.state.codingPanel = 'sessions';
    if (action === 'session') f.state.activeCodingSessionId = 'other';
    if (action === 'generation') f.state.codingSessionNavigationGeneration++;
    if (action === 'disposed') f.state.isDisposed = true;
    const pending = f.state.pendingTurnEdit;
    f.workspace.resolve(f.session); await operation;
    assert.equal(f.state.workContextMode, 'file', action); assert.equal(f.state.pendingTurnEdit, pending);
  }
});

test('a failed stale workspace resolution cannot overwrite the newer view error', async () => {
  const f = fixture(), operation = f.state.restoreCodingSessionState(f.session);
  f.state.showFileWorkContext(); f.state.contextFilesError = 'newer file error';
  f.workspace.reject(new Error('old workspace error')); await operation;
  assert.equal(f.state.contextFilesError, 'newer file error'); assert.equal(f.state.workContextMode, 'file');
});

test('a current session hydration still restores the saved view and session preferences', async () => {
  const f = fixture(), operation = f.state.restoreCodingSessionState(f.session);
  f.workspace.resolve(f.session); await operation;
  assert.equal(f.state.workContextMode, 'agent'); assert.equal(f.state.workContextOpen, true);
  assert.equal(f.state.activeAgentChildId, 'saved-child'); assert.equal(f.state.permissionMode, 'workspace_write');
});

test('a deferred conversation open cannot clear a newer modal, leave settings, or overwrite the selected drawer', async () => {
  for (const boundary of ['history', 'workspace']) for (const action of ['modal', 'settings', 'file']) {
    const f = fixture(), target = { id: 'other', workspacePath: boundary === 'workspace' ? '/project' : '',
      historyLoaded: boundary !== 'history', turns: [], viewState: { workContextOpen: true, workContextMode: 'agent' } };
    f.state.codingSessions[1] = target;
    const operation = f.state.openCodingSession('other');
    if (action === 'modal') f.state.requestTurnEditConfirmation('current', 'turn');
    if (action === 'settings') f.state.selectSection('settings');
    if (action === 'file') f.state.showFileWorkContext();
    const expected = { section: f.state.activeSection, session: f.state.activeCodingSessionId,
      mode: f.state.workContextMode, pending: f.state.pendingTurnEdit };
    (boundary === 'history' ? f.hydration : f.workspace).resolve({ ...target, historyLoaded: true });
    await operation;
    assert.deepEqual({ section: f.state.activeSection, session: f.state.activeCodingSessionId,
      mode: f.state.workContextMode, pending: f.state.pendingTurnEdit }, expected, `${boundary}: ${action}`);
  }
});

test('an unchanged deferred conversation open still selects the requested session and its saved view', async () => {
  const f = fixture(), target = { id: 'other', workspacePath: '', historyLoaded: false, turns: [],
    viewState: { workContextOpen: true, workContextMode: 'agent' } };
  f.state.codingSessions[1] = target;
  const operation = f.state.openCodingSession('other');
  f.hydration.resolve({ ...target, historyLoaded: true }); await operation;
  assert.equal(f.state.activeCodingSessionId, 'other'); assert.equal(f.state.workContextMode, 'agent');
});

function scheduleFixture() {
  const f = fixture(), saving = deferred();
  Object.assign(f.state, { workContextOpen: false, codingSessionMenuId: '', scheduleDialogOpen: true,
    scheduleDraft: { id: 'scheduled', title: 'Plan', prompt: 'Work', workspacePath: '/project',
      cadence: 'daily', runAt: '09:00', routeId: 'route', relayKey: 'relay' },
    scheduledTasksReady: true, scheduledTasksPersistence: Promise.resolve(), scheduledTasksPersisted: new Map(),
    selectedScheduleModelRoute: () => undefined, setProjectVisible() {},
    fileService: { activateProvider: async () => ({ stat: async () => ({ type: 2 }) }) },
    platformService: { upsertDesktopScheduledTask: () => saving.promise }
  });
  f.state.scheduledTasks = [{ ...f.state.scheduleDraft, modelRoute: { kind: 'official_connection', connectionId: 'id', model: 'm' } }];
  return { ...f, saving };
}

test('a cancelled schedule save retains its saved result without dismissing the later confirmation', async () => {
  const f = scheduleFixture(), operation = f.state.saveScheduledTask();
  await new Promise(setImmediate); f.state.closeNavigationSurface(); f.state.requestTurnEditConfirmation('current', 'turn');
  const confirmation = f.state.pendingTurnEdit, saved = { ...f.state.scheduleDraft, definitionRevision: 2 };
  f.saving.resolve(saved); await operation;
  assert.equal(f.state.pendingTurnEdit, confirmation); assert.equal(f.state.scheduledTasks[0], saved);
  assert.equal(f.state.scheduledTasksPersisted.get(saved.id), JSON.stringify(saved)); assert.equal(f.state.scheduleSaving, false);
});

test('a replaced schedule draft survives the previous save result or error', async () => {
  for (const failed of [false, true]) {
    const f = scheduleFixture(), operation = f.state.saveScheduledTask(), saved = { ...f.state.scheduleDraft };
    await new Promise(setImmediate);
    f.state.closeNavigationSurface(); f.state.scheduleDraft = { ...saved, title: 'New unsaved draft' };
    f.state.scheduleDialogOpen = true; f.state.scheduleDraftError = 'new draft error';
    if (failed) f.saving.reject(new Error('old save error')); else f.saving.resolve(saved);
    await operation;
    assert.equal(f.state.scheduleDialogOpen, true); assert.equal(f.state.scheduleDraft.title, 'New unsaved draft');
    assert.equal(f.state.scheduleDraftError, 'new draft error');
  }
});

test('an unchanged schedule save still closes its original dialog', async () => {
  const f = scheduleFixture(), operation = f.state.saveScheduledTask();
  await new Promise(setImmediate); f.saving.resolve({ ...f.state.scheduleDraft }); await operation;
  assert.equal(f.state.scheduleDialogOpen, false); assert.equal(f.state.scheduledTasks.length, 1);
});

test('titlebar back during comic creation cannot let its completion dismiss a later edit confirmation', async () => {
  const f = fixture(), creating = deferred();
  Object.assign(f.state, { workContextOpen: false, codingSessionMenuId: '', activeSection: 'comic',
    activeComicWorkspaceRoot: '/comic', comicWorkspaceRoot: '/comic', mediaWorkspaceRoot: '/comic', comicLoadSequence: 0,
    comicStage: 'idle', comicState: { exists: false }, activeComicWorkspace: () => ({ label: 'Project' }),
    platformService: { createComicProject: () => creating.promise },
    loadComicLibrary: async () => {}, loadComicProject: async () => {}, comicProject: () => undefined, comicChatUi: () => ({ surface: 'studio' }), setComicView() {}, ct: key => key, comicTextRoute: () => undefined, startComicAdaptation: async () => {} });
  f.state.openComicCreateSheet(); f.state.comicCreateDraft = { ...f.state.comicCreateDraft, target: 'workspace', title: 'Pilot' }; const operation = f.state.createComicProject();
  f.state.navigateBack(); f.state.selectSection('coding'); f.state.requestTurnEditConfirmation('current', 'turn');
  const confirmation = f.state.pendingTurnEdit, saved = { exists: true, project: { id: 'created' } };
  assert.ok(confirmation); creating.resolve(saved); await operation;
  assert.equal(f.state.pendingTurnEdit, confirmation); assert.equal(f.state.comicState, saved);
  assert.equal(f.state.comicStage, 'idle');
});

test('unchanged comic creation still retains the project and closes its original sheet', async () => {
  const f = fixture(), creating = deferred();
  Object.assign(f.state, { workContextOpen: false, codingSessionMenuId: '', activeSection: 'comic',
    activeComicWorkspaceRoot: '/comic', comicWorkspaceRoot: '/comic', mediaWorkspaceRoot: '/comic', comicLoadSequence: 0,
    comicStage: 'idle', comicState: { exists: false }, activeComicWorkspace: () => ({ label: 'Project' }),
    platformService: { createComicProject: () => creating.promise },
    loadComicLibrary: async () => {}, loadComicProject: async () => {}, comicProject: () => undefined, comicChatUi: () => ({ surface: 'studio' }), setComicView() {}, ct: key => key, comicTextRoute: () => undefined, startComicAdaptation: async () => {} });
  f.state.openComicCreateSheet(); f.state.comicCreateDraft = { ...f.state.comicCreateDraft, target: 'workspace', title: 'Pilot' }; const operation = f.state.createComicProject(), saved = { exists: true, project: { id: 'created' } };
  creating.resolve(saved); await operation;
  assert.equal(f.state.comicCreateSheetOpen, false); assert.equal(f.state.comicState, saved); assert.equal(f.state.comicStage, 'idle');
});
