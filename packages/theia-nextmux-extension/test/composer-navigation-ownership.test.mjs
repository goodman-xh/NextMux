import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';

// Exercise production navigation, including selectWorkspaceRoot's nested draft
// flush. Only platform I/O and unrelated panels are stubbed; no user files load.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['applyNavigationSnapshot', 'selectWorkspaceRoot', 'setComposerPrompt', 'restoreComposerDraft',
  'flushComposerDraft', 'persistComposerDraft', 'composerDraftAttachmentReferences', 'queuedAttachmentReference',
  'activePastedTextReferences', 'pruneUnpersistedPastedTextReferences', 'addPastedTextReference',
  'restoreCodingSourceSelection', 'codingSessionRelayKey', 'recentCodingSource',
  'startNewCodingTask', 'ensureCodingSession', 'openGoalComposer', 'cancelGoalComposer', 'scheduleComposerDraftPersist',
  'navigationSnapshot', 'navigationSnapshotKey', 'navigationSurfaceKey', 'sameNavigationLocation'];
const methods = names.map(name => {
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
  assert.ok(method, `production method ${name}`); return method.getText(file);
});
const paste = {};
new Function('exports', 'require', ts.transpile(readFileSync(new URL('../src/browser/nextmux-composer-long-paste.ts', import.meta.url), 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}))(paste, requireCopyFallback);
const dependencies = {
  ...paste, ...require('../lib/common/nextmux-price-quote.js'), ...require('../lib/common/nextmux-context-budget.js'), ...require('../lib/common/nextmux-relay-switch.js'),
  ...require('../lib/browser/nextmux-composer-attachments.js'), ...require('../lib/browser/nextmux-domain-error-locale.js'),
  crypto: webcrypto,
  normalizeDesktopSettingsPanel: panel => panel || 'profile', desktopFailureMessage: (_locale, value) => String(value),
  conversationText: (_locale, _key, values) => `Cannot restore ${values?.name || 'attachment'}`,
  MAX_TOTAL_ATTACHMENTS_PER_TASK: 20, EMPTY_LOCAL_DATA_STATE: {},
  requestAnimationFrame() {}, window: { clearTimeout() {}, setTimeout() { return 1; } }
};
const scrollNormalizer = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeAgentChildScrollStates').getText(file);
const historySource = readFileSync(new URL('../src/browser/nextmux-conversation-history.ts', import.meta.url), 'utf8');
const historyFile = ts.createSourceFile('history.ts', historySource, ts.ScriptTarget.Latest, true);
const reuseConversation = historyFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reusableConversationForWorkspace').getText(historyFile).replace(/^export /, '');
const code = ts.transpile(`${scrollNormalizer}\n${reuseConversation}\nclass Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const attachmentReference = id => ({ id, uri: `file:///synthetic-navigation/${id}.txt`, name: `${id}.txt`, size: 3, kind: 'file', mimeType: 'text/plain' });
const attachmentRecord = id => ({ ...attachmentReference(id), attachment: { kind: 'file', name: `${id}.txt`, mimeType: 'text/plain', dataBase64: 'YWJj' } });
const quote = id => `kq1_${id.toLowerCase().repeat(64)}`;

function fixture({ separateWorkspaces = false } = {}) {
  const reads = [], writes = [], persisted = [], events = [], state = new Harness();
  const sessions = ['A', 'B'].map((id, index) => ({
    id, turns: [], title: id, titleOrigin: 'manual', updatedAt: index + 1,
    workspacePath: separateWorkspaces ? `/synthetic/${id}` : '/synthetic/shared',
    draftPrompt: `${id}_SAVED`, routeId: `official:${id}:model`, relayKey: `official:${id}`, modelId: `model-${id}`,
    keyPriceQuoteId: quote(id), reasoningEffort: index ? 'high' : 'low',
    contextWindowTokens: (index + 1) * 100_000, automaticRelaySource: index ? 'off' : 'user', permissionMode: 'read_only'
  }));
  Object.assign(state, {
    activeSection: 'coding', codingPanel: 'thread', activeCodingSessionId: 'A', activeWorkspaceRoot: sessions[0].workspacePath,
    globalCodingDraft: false, draftWorkspaceRoot: '', codingSessionNavigationGeneration: 0,
    goalComposerActive: false, goalComposerSessionId: '', goalDraftsBySession: new Map(),
    codingSessions: sessions, workspaceOptions: [...new Set(sessions.map(session => session.workspacePath))].map(path => ({ path })),
    scheduledTasks: [], expandedCodingProjects: new Set(), contextFileTabs: new Map(), composerApps: new Map(),
    prompt: 'A_SAVED', attachments: [], pastedTextReferences: [], unpersistedPastedTextReferences: new Map(),
    draftAttachmentRestores: new Map(), pastedTextPersistence: new Map(), selectedModelIds: { comic: 'unchanged-comic' },
    platformCatalog: { offerings: [] }, officialModels: { connections: [] },
    node: { querySelector() {} }, desktopLocale: 'en', attachmentError: '', defaultPermissionMode: 'read_only',
    detachContextEditorRecovery: () => true, conversationHasActiveRun: () => false,
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    workspaceRootIsOpen(path) { return this.workspaceOptions.some(option => option.path === path); },
    sessionPermissionMode: session => session.permissionMode, codingSessionWorkspaceRoot: session => session.workspacePath,
    activeModelRoute() {}, reasoningSettingsForRoute: () => ({}), currentCodingSessionViewState: () => ({}),
    navigationSurface: () => ({ kind: 'none' }),
    nextComposerAttachmentOrdinal() { return this.attachments.length + this.pastedTextReferences.length + 1; },
    codingSessionTitle: value => value, bytesToBase64: value => Buffer.from(value).toString('base64'),
    resolveAttachmentReferences(refs, session) { const operation = deferred(); reads.push({ owner: session.id, id: refs[0].id, ...operation }); return operation.promise; },
    platformService: { cacheDesktopAttachment(request) { const operation = deferred(); writes.push({ request, ...operation }); return operation.promise; } },
    persistCodingSessions() { persisted.push(JSON.stringify(this.codingSessions)); },
    persistActiveCodingSessionState() {}, persistDesktopRestoreState() {}, update() {},
    syncActiveTerminal() {}, syncActiveBrowser() {}, restoreCodingViewState() {}, applyNavigationSurface() {}, constrainPaneSizes() {},
    stopVoiceInput() {}, cancelContextFileListScrollRestore() {}, disconnectInactiveConversationTabs() {},
    rememberNavigation() {}, loadContextFiles() {}, loadLocalDataState() {}
  });
  for (const name of ['flushComposerDraft', 'restoreComposerDraft', 'restoreCodingSourceSelection']) {
    const actual = state[name];
    state[name] = function (...args) { events.push({ name, owner: this.activeCodingSessionId, target: args[0]?.id, prompt: this.prompt }); return actual.apply(this, args); };
  }
  state.restoreCodingSourceSelection(sessions[0]); state.reasoningEffort = sessions[0].reasoningEffort; events.length = 0;
  const snapshot = (id, overrides = {}) => ({ section: 'coding', codingPanel: 'thread', codingSessionId: id,
    workspaceRoot: state.codingSessions.find(session => session.id === id)?.workspacePath || state.activeWorkspaceRoot,
    settingsPanel: 'profile', surface: { kind: 'none' }, ...overrides });
  const navigate = (id, overrides) => state.applyNavigationSnapshot(snapshot(id, overrides));
  const saved = id => state.codingSessions.find(session => session.id === id);
  return { state, reads, writes, persisted, events, snapshot, navigate, saved };
}

function assertSource(state, session) {
  assert.equal(state.activeModelRouteId, session.routeId);
  assert.equal(state.activeRelayKey, session.relayKey);
  assert.equal(state.activeKeyPriceQuoteId, session.keyPriceQuoteId);
  assert.equal(state.selectedModelIds.coding, session.modelId);
  assert.equal(state.selectedModelIds.comic, 'unchanged-comic');
  assert.equal(state.contextWindowTokens, session.contextWindowTokens);
  assert.equal(state.reasoningEffort, session.reasoningEffort);
}

test('production navigation saves departing text and restores destination text, route, quote and reasoning', () => {
  const f = fixture(); f.state.prompt = 'A_UNFLUSHED';
  f.navigate('B');
  assert.equal(f.saved('A').draftPrompt, 'A_UNFLUSHED'); assert.equal(f.state.prompt, 'B_SAVED'); assertSource(f.state, f.saved('B'));
  f.state.prompt = 'B_UNFLUSHED'; f.navigate('A');
  assert.equal(f.saved('B').draftPrompt, 'B_UNFLUSHED'); assert.equal(f.state.prompt, 'A_UNFLUSHED'); assertSource(f.state, f.saved('A'));
  f.navigate('B'); assert.equal(f.state.prompt, 'B_UNFLUSHED'); assertSource(f.state, f.saved('B'));
});

test('destination workspace wins over stale snapshot without writing outgoing text into the destination session', () => {
  const f = fixture({ separateWorkspaces: true }); f.state.prompt = 'A_NOT_YET_SAVED';
  f.navigate('B', { workspaceRoot: f.saved('A').workspacePath });
  assert.equal(f.state.activeWorkspaceRoot, f.saved('B').workspacePath);
  assert.equal(f.saved('A').draftPrompt, 'A_NOT_YET_SAVED'); assert.equal(f.saved('B').draftPrompt, 'B_SAVED');
  assert.equal(f.state.prompt, 'B_SAVED'); assertSource(f.state, f.saved('B'));
  assert.ok(f.persisted.every(value => JSON.parse(value).find(session => session.id === 'B').draftPrompt === 'B_SAVED'));
  assert.ok(f.events.filter(event => event.name === 'flushComposerDraft').every(event => event.owner === 'A'));
});

test('same-owner panel navigation does not flush, restore or replace the live draft source', () => {
  const f = fixture(); f.state.prompt = 'A_TYPING'; f.state.activeModelRouteId = 'LIVE_PICKER_CHOICE';
  f.navigate('A', { section: 'settings', settingsPanel: 'profile' });
  f.navigate('A');
  assert.deepEqual(f.events, []); assert.equal(f.state.prompt, 'A_TYPING');
  assert.equal(f.state.activeModelRouteId, 'LIVE_PICKER_CHOICE'); assert.equal(f.saved('A').draftPrompt, 'A_SAVED');
});

test('attachment restore completion after navigation cannot change destination prompt, attachments or error', async () => {
  for (const failed of [false, true]) {
    const f = fixture(); f.saved('A').draftAttachments = [attachmentReference('A-file')];
    f.state.restoreComposerDraft(f.saved('A')); const pending = f.state.draftAttachmentRestores.get('A').promise; await tick();
    f.navigate('B'); f.state.attachments = [attachmentRecord('B-file')]; f.state.persistComposerDraft();
    if (failed) f.reads[0].reject(new Error('SYNTHETIC_A_READ_FAILED')); else f.reads[0].resolve([attachmentRecord('A-file')]);
    await pending;
    assert.equal(f.state.activeCodingSessionId, 'B'); assert.equal(f.state.prompt, 'B_SAVED');
    assert.deepEqual(f.state.attachments.map(item => item.id), ['B-file']); assert.equal(f.state.attachmentError, '');
    assert.deepEqual(f.saved('A').draftAttachments.map(item => item.id), ['A-file']);
    assert.deepEqual(f.saved('B').draftAttachments.map(item => item.id), ['B-file']); assertSource(f.state, f.saved('B'));
  }
});

test('late pasted-text cache result remains with its original draft across real navigation', async () => {
  for (const failed of [false, true]) {
    const f = fixture(); const secret = 'SYNTHETIC_NAVIGATION_RAW_PASTE';
    f.state.addPastedTextReference(secret, { selectionStart: f.state.prompt.length, selectionEnd: f.state.prompt.length });
    const reference = f.state.pastedTextReferences[0], pending = f.state.pastedTextPersistence.get(reference.id);
    f.navigate('B'); f.state.prompt = 'B_NEW_TEXT';
    if (failed) f.writes[0].reject(new Error('SYNTHETIC_A_CACHE_FAILED'));
    else f.writes[0].resolve({ uri: 'file:///synthetic-navigation/A-paste.txt', name: 'A-paste.txt', size: secret.length });
    await pending;
    assert.equal(f.state.prompt, 'B_NEW_TEXT'); assert.deepEqual(f.state.pastedTextReferences, []); assert.equal(f.state.attachmentError, '');
    assert.equal(f.saved('B').draftPastedTextReferences, undefined); assertSource(f.state, f.saved('B'));
    f.navigate('A'); assert.equal(f.state.pastedTextReferences[0].id, reference.id);
    if (failed) assert.equal(f.state.pastedTextReferences[0].content, secret);
    else assert.equal(f.state.pastedTextReferences[0].attachment.uri, 'file:///synthetic-navigation/A-paste.txt');
    assert.ok(f.persisted.every(value => !value.includes(secret)), 'history only saves paste references, never raw content');
  }
});

test('returning from a new global draft clears draft workspace ownership before first input reuses A', () => {
  for (const draftRoot of ['', '/synthetic/B']) {
    const f = fixture({ separateWorkspaces: true });
    const before = f.state.navigationSnapshot();
    f.state.startNewCodingTask(); f.state.draftWorkspaceRoot = draftRoot;
    assert.equal(f.state.globalCodingDraft, true); assert.equal(f.state.activeCodingSessionId, '');
    f.state.applyNavigationSnapshot(before);
    assert.equal(f.state.globalCodingDraft, false); assert.equal(f.state.draftWorkspaceRoot, '');
    assert.equal(f.state.prompt, 'A_SAVED');
    const count = f.state.codingSessions.length;
    const reused = f.state.ensureCodingSession('first resumed character');
    assert.equal(reused.id, 'A'); assert.equal(f.state.activeCodingSessionId, 'A');
    assert.equal(f.state.codingSessions.length, count, 'resuming A must not materialize another draft');
  }
});

test('leaving the goal composer saves goal text separately and restores the ordinary draft before flushing', () => {
  for (const separateWorkspaces of [false, true]) {
    const f = fixture({ separateWorkspaces });
    f.state.prompt = 'A_ORDINARY_UNFLUSHED'; f.state.openGoalComposer();
    f.state.prompt = 'A_GOAL_IN_PROGRESS';
    // A real draft timer may have fired while the goal field was visible.
    f.state.persistComposerDraft();
    f.navigate('B');
    assert.equal(f.state.goalComposerActive, false); assert.equal(f.state.goalComposerSessionId, '');
    assert.equal(f.state.goalDraftsBySession.get('A'), 'A_GOAL_IN_PROGRESS');
    assert.equal(f.saved('A').draftPrompt, 'A_ORDINARY_UNFLUSHED');
    assert.equal(f.state.prompt, 'B_SAVED'); assert.equal(f.saved('B').draftPrompt, 'B_SAVED');
    f.navigate('A'); assert.equal(f.state.prompt, 'A_ORDINARY_UNFLUSHED');
    f.state.openGoalComposer(); assert.equal(f.state.prompt, 'A_GOAL_IN_PROGRESS');
  }
});

test('captured projectless and project-attached drafts remain distinct locations and restore their own workspace choice', () => {
  const f = fixture();
  f.state.startNewCodingTask(); f.state.draftWorkspaceRoot = '';
  const projectless = f.state.navigationSnapshot();
  f.state.draftWorkspaceRoot = '/synthetic/shared';
  const attached = f.state.navigationSnapshot();
  assert.equal(projectless.globalCodingDraft, true); assert.equal(projectless.draftWorkspaceRoot, '');
  assert.equal(attached.globalCodingDraft, true); assert.equal(attached.draftWorkspaceRoot, '/synthetic/shared');
  assert.notEqual(f.state.navigationSnapshotKey(projectless), f.state.navigationSnapshotKey(attached));
  assert.equal(f.state.sameNavigationLocation(projectless, attached), false);
  for (const target of [projectless, attached, projectless, attached]) {
    const eventCount = f.events.length;
    f.state.applyNavigationSnapshot(target);
    assert.equal(f.state.activeCodingSessionId, ''); assert.equal(f.state.globalCodingDraft, true);
    assert.equal(f.state.draftWorkspaceRoot, target.draftWorkspaceRoot);
    assert.ok(f.events.slice(eventCount).some(event => event.name === 'flushComposerDraft'), 'changing an empty draft workspace is an owner transition');
  }
  for (const target of [projectless, attached]) {
    f.navigate('A'); assert.equal(f.state.globalCodingDraft, false);
    f.state.applyNavigationSnapshot(target); assert.equal(f.state.draftWorkspaceRoot, target.draftWorkspaceRoot);
    const next = fixture(); next.state.applyNavigationSnapshot(target);
    const created = next.state.ensureCodingSession('first character');
    assert.equal(created.workspacePath, target.draftWorkspaceRoot);
  }
});

test('returning to a conversation whose project is unmounted does not inherit the departing project or create another session', () => {
  const f = fixture({ separateWorkspaces: true });
  f.navigate('B');
  f.state.workspaceOptions = f.state.workspaceOptions.filter(option => option.path !== f.saved('A').workspacePath);
  f.navigate('A');
  assert.equal(f.state.activeWorkspaceRoot, ''); assert.equal(f.state.prompt, 'A_SAVED');
  assert.equal(f.state.ensureCodingSession('resumed offline-project draft').id, 'A');
  assert.equal(f.state.codingSessions.length, 2);
});

test('legacy no-session snapshots are projectless unless they explicitly retain project draft ownership', () => {
  for (const retained of [false, true]) {
    const f = fixture();
    const old = f.snapshot('', retained ? { globalCodingDraft: false } : {});
    f.state.applyNavigationSnapshot(old);
    assert.equal(f.state.activeCodingSessionId, '');
    assert.equal(f.state.globalCodingDraft, !retained); assert.equal(f.state.draftWorkspaceRoot, '');
    const created = f.state.ensureCodingSession('legacy restored first input');
    assert.equal(created.workspacePath, retained ? '/synthetic/shared' : '');
  }
});

test('same-owner settings roundtrip keeps the actual workspace and live draft when the session project is unmounted', () => {
  const f = fixture({ separateWorkspaces: true });
  f.state.workspaceOptions = f.state.workspaceOptions.filter(option => option.path !== f.saved('A').workspacePath);
  f.state.activeWorkspaceRoot = f.saved('B').workspacePath;
  f.state.prompt = 'A_TYPING_WITH_UNMOUNTED_PROJECT'; f.state.activeModelRouteId = 'LIVE_PICKER_CHOICE';
  const before = f.state.navigationSnapshot();
  f.state.applyNavigationSnapshot({ ...before, section: 'settings', settingsPanel: 'profile' });
  f.state.applyNavigationSnapshot(before);
  assert.deepEqual(f.events, []);
  assert.equal(f.state.activeWorkspaceRoot, f.saved('B').workspacePath);
  assert.equal(f.state.activeCodingSessionId, 'A'); assert.equal(f.state.prompt, 'A_TYPING_WITH_UNMOUNTED_PROJECT');
  assert.equal(f.state.activeModelRouteId, 'LIVE_PICKER_CHOICE'); assert.equal(f.saved('A').draftPrompt, 'A_SAVED');
});
