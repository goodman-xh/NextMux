import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['setComposerPrompt', 'hasPendingAttachmentImports', 'appendOwnedAttachment', 'runOwnedAttachmentImport', 'addBrowserFiles',
  'selectAttachments', 'attachContextImage', 'removeAttachment', 'queuedAttachmentReference', 'activePastedTextReferences',
  'pruneUnpersistedPastedTextReferences', 'persistComposerDraft', 'flushComposerDraft', 'restoreComposerDraft',
  'startNewCodingTask', 'restoreCodingSourceSelection', 'recentCodingSource', 'codingSessionRelayKey', 'assertApplicationExitSaved',
  'shutdownForApplicationExit', 'composerDraftAttachmentReferences', 'pendingDraftAttachmentRestores',
  'completeNavigationSurface', 'dismissTopSurface', 'hasDismissibleSurface', 'requestTurnEditConfirmation',
  'dismissTurnEditConfirmation', 'resetTurnEditRestore'];
const methods = [];
function visit(node) {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file); assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const paste = {};
new Function('exports', 'require', ts.transpile(readFileSync(new URL('../src/browser/nextmux-composer-long-paste.ts', import.meta.url), 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}))(paste, requireCopyFallback);
const routeHelpers = {};
new Function('exports', 'require', ts.transpile(readFileSync(new URL('../src/browser/nextmux-model-route-selection.ts', import.meta.url), 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}))(routeHelpers, createRequire(new URL('../lib/browser/nextmux-model-route-selection.js', import.meta.url)));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const dependencies = { ...paste, ...routeHelpers, ...createRequire(import.meta.url)('../lib/browser/nextmux-conversation-agent-run.js'), MAX_TOTAL_ATTACHMENTS_PER_TASK: 20, MAX_FILE_ATTACHMENTS_PER_TASK: 8, MAX_ATTACHMENT_TOTAL_BYTES: 32 * 1024 * 1024,
    ...createRequire(import.meta.url)('../lib/common/nextmux-price-quote.js'),
    ...createRequire(import.meta.url)('../lib/common/nextmux-context-budget.js'),
    conversationCheckpointIdsToRestore: createRequire(import.meta.url)('../lib/browser/nextmux-conversation-branch.js').conversationCheckpointIdsToRestore,
    URI: class { constructor(value) { this.value = value; } }, requestAnimationFrame() {}, window: { clearTimeout() {} } };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  const state = new Harness(), writes = [], notices = [], snapshots = [], fileReads = [], picker = deferred();
  Object.assign(state, {
    conversationAgentRuns: new Map(),
    // Per-conversation tab connections have their own tests.
    disconnectInactiveConversationTabs() {},
    prompt: '', activeCodingSessionId: 'A', codingSessions: [{ id: 'A', turns: [] }], attachments: [], pastedTextReferences: [],
    activeRelayKey: '', activeModelRouteId: '', selectedModelIds: { coding: '', comic: '' },
    platformCatalog: { offerings: [] }, officialModels: { connections: [] },
    unpersistedPastedTextReferences: new Map(), pendingAttachmentImports: new Map(), editedTurnAttachmentOrder: [],
    draftAttachmentRestores: new Map(),
    desktopLocale: 'en', attachmentError: '', applicationExitPreparing: false, applicationExitGeneration: 0,
    contextFileDirty: false, contextFileSaveStatus: 'idle', pendingContextFileWrites: new Set(),
    // This attachment fixture has no text editor; its optional preview is an image only.
    captureContextEditorRecovery() { assert.ok(!this.contextFilePreview || this.contextFilePreview.kind === 'image'); return true; },
    detachContextEditorRecovery() { return this.captureContextEditorRecovery(); },
    privacySettings: { saveConversationHistory: true }, conversationHistoryPersistenceReady: true,
    workspaceConfigurationSaver: { hasPendingChanges: false, async flush() {} }, node: { querySelector() {} },
    pastedTextPersistence: new Map(), pendingAgentSubmissions: new Set(), terminalRecords: [{ id: 'terminal' }],
    async flushConversationHistory() {}, persistTerminalRecords() {}, async terminateAndDisposeConversationTerminal() {},
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    ensureCodingSession() { throw new Error('fixture already owns a session'); }, codingSessionWorkspaceRoot() { return ''; },
    nextComposerAttachmentOrdinal() { return this.attachments.length + 1; }, codingSessionTitle() { return 'synthetic'; },
    attachmentMimeType(_name, declared) { return declared || 'application/octet-stream'; },
    classifyAttachment(_name, declared) { return { kind: declared?.startsWith('image/') ? 'image' : 'file' }; },
    bytesToBase64(bytes) { return Buffer.from(bytes).toString('base64'); },
    attachmentRecordFromBytes(name, uri, bytes, mimeType) {
      if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('too large');
      return { id: name, uri, size: bytes.byteLength, attachment: { kind: 'file', name, mimeType, dataBase64: Buffer.from(bytes).toString('base64') } };
    },
    platformService: { cacheDesktopAttachment(request) { const operation = deferred(); writes.push({ request, ...operation }); return operation.promise; } },
    fileDialogService: { showOpenDialog() { return picker.promise; } },
    fileService: { readFile(resource, options) { fileReads.push({ resource, options }); return Promise.resolve({ value: { buffer: new Uint8Array([1, 2, 3]) } }); } },
    resolveAttachmentReferences: async () => [],
    persistCodingSessions() { snapshots.push(JSON.stringify(this.codingSessions)); },
    persistActiveCodingSessionState() {}, rememberNavigation() {}, persistDesktopRestoreState() {}, update() {},
    scheduleComposerDraftPersist() { this.persistComposerDraft(); }, navigationBackStack: [], navigationForwardStack: [],
    navigationSnapshot: () => ({}), navigationSnapshotKey: () => '', conversationHistoryReady: () => true,
    focusTurnEditor() {}, closeModelEffortPickerImmediately() {},
    addNotification(...args) { notices.push(args); }
  });
  state.conversationHistoryPersistedSessions = new Map(state.codingSessions.map(session => [session.id, session]));
  const browserFile = (name = 'synthetic.bin', reading = Promise.resolve(new Uint8Array([1, 2, 3]).buffer), size = 3, type = '') => ({
    name, type, size, arrayBuffer() { return reading; }
  });
  const cached = (name = 'synthetic.bin', size = 3) => ({ uri: `file:///synthetic-owned/${name}`, size });
  const switchTo = id => {
    state.startNewCodingTask();
    assert.equal(state.activeRelayKey, ''); assert.equal(state.activeModelRouteId, ''); assert.equal(state.selectedModelIds.coding, '');
    if (!state.codingSessions.some(session => session.id === id)) state.codingSessions.push({ id, turns: [] });
    state.activeCodingSessionId = id; state.restoreComposerDraft(state.activeCodingSession());
  };
  return { state, writes, notices, snapshots, fileReads, picker, browserFile, cached, switchTo };
}

test('a first project attachment waits for durable owner identity before cache authorization without waiting on its own producer', async () => {
  const f = fixture(), saving = deferred();
  f.state.codingSessions[0] = { id: 'A', workspacePath: '/user/project', turns: [] }; f.state.conversationHistoryPersistedSessions.clear();
  f.state.codingSessionWorkspaceRoot = owner => owner.workspacePath || '';
  let flushCalls = 0;
  f.state.flushConversationHistory = async () => {
    flushCalls++; assert.equal(f.state.pendingAttachmentImports.size, 0, 'flush starts before this producer is registered');
    await saving.promise;
    f.state.conversationHistoryPersistedSessions.set('A', f.state.codingSessions.find(item => item.id === 'A'));
  };
  const importing = f.state.addBrowserFiles([f.browserFile()]);
  assert.equal(f.state.hasPendingAttachmentImports('A'), true); await tick(); assert.equal(f.writes.length, 0);
  saving.resolve(); await tick(); assert.equal(flushCalls, 1);
  assert.equal(f.writes[0].request.conversationId, 'A'); assert.equal(f.writes[0].request.workspaceRoot, '/user/project');
  f.writes[0].resolve(f.cached()); await importing; assert.equal(f.state.attachments.length, 1);
});

test('normal quit waits for the first identity save and its attachment without a producer/flush cycle', async () => {
  const f = fixture(), saving = deferred(); f.state.conversationHistoryPersistedSessions.clear();
  f.state.flushConversationHistory = async () => {
    await saving.promise;
    for (const owner of f.state.codingSessions) f.state.conversationHistoryPersistedSessions.set(owner.id, owner);
  };
  const importing = f.state.addBrowserFiles([f.browserFile()]);
  f.state.applicationExitPreparing = true; f.state.applicationExitGeneration = 1;
  const closing = f.state.shutdownForApplicationExit(); await tick();
  assert.equal(f.state.terminalRecords.length, 1); assert.equal(f.writes.length, 0);
  saving.resolve(); await tick(); f.writes[0].resolve(f.cached());
  await Promise.all([importing, closing]);
  assert.equal(f.state.terminalRecords.length, 0); assert.equal(f.state.codingSessions[0].draftAttachments.length, 1);
});

test('missing owner-save ACK and rejected saves never cache or show a successful imported attachment', async () => {
  for (const rejects of [false, true]) {
    const f = fixture(); f.state.conversationHistoryPersistedSessions.clear();
    f.state.flushConversationHistory = async () => { if (rejects) throw new Error('PRIVATE_SAVE_DETAIL'); };
    await f.state.addBrowserFiles([f.browserFile()]);
    assert.equal(f.writes.length, 0); assert.equal(f.state.attachments.length, 0); assert.ok(f.state.attachmentError);
    assert.doesNotMatch(f.state.attachmentError, /PRIVATE_SAVE_DETAIL/); assert.equal(f.state.pendingAttachmentImports.size, 0);
  }
});

test('an existing saved conversation can import while another owner waits for its first save', async () => {
  const f = fixture(), saving = deferred();
  f.state.codingSessions.push({ id: 'B', turns: [] });
  f.state.conversationHistoryPersistedSessions = new Map([['B', f.state.codingSessions[1]]]);
  f.state.flushConversationHistory = async () => { await saving.promise; f.state.conversationHistoryPersistedSessions.set('A', f.state.codingSessions[0]); };
  const a = f.state.addBrowserFiles([f.browserFile('A.bin')]);
  f.state.activeCodingSessionId = 'B';
  const b = f.state.addBrowserFiles([f.browserFile('B.bin')]); await tick();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].request.conversationId, 'B');
  f.writes[0].resolve(f.cached('B.bin')); await b;
  saving.resolve(); await tick(); assert.equal(f.writes[1].request.conversationId, 'A');
  f.writes[1].resolve(f.cached('A.bin')); await a;
  assert.equal(f.state.attachments[0].attachment.name, 'B.bin');
  assert.equal(f.state.codingSessions.find(item => item.id === 'A').draftAttachments[0].name, 'A.bin');
});

test('deleting an owner during its first save prevents all later attachment reads and cache writes', async () => {
  const f = fixture(), saving = deferred(); f.state.conversationHistoryPersistedSessions.clear();
  f.state.flushConversationHistory = () => saving.promise;
  const importing = f.state.addBrowserFiles([f.browserFile()]); f.state.codingSessions = [];
  saving.resolve(); await importing;
  assert.equal(f.writes.length, 0); assert.equal(f.fileReads.length, 0); assert.equal(f.state.pendingAttachmentImports.size, 0);
});

test('actual browser producer cache failure never adds browser-file fallback or leaks a backend error', async () => {
  const f = fixture(), importing = f.state.addBrowserFiles([f.browserFile()]);
  assert.equal(f.state.hasPendingAttachmentImports('A'), true); await tick();
  const tracked = [...f.state.pendingAttachmentImports.keys()];
  f.writes[0].reject(new Error('SYNTHETIC_PRIVATE_BACKEND_FAILURE'));
  const results = await Promise.allSettled(tracked); await importing;
  assert.equal(results[0].status, 'rejected'); assert.match(results[0].reason.message, /^ATTACHMENT_IMPORT_FAILED$/);
  assert.equal(f.state.pendingAttachmentImports.size, 0); assert.deepEqual(f.state.attachments, []);
  assert.ok(f.state.attachmentError); assert.doesNotMatch(f.state.attachmentError, /PRIVATE_BACKEND|browser-file/);
  assert.ok(f.snapshots.every(value => !value.includes('dataBase64') && !value.includes('browser-file:')));
});

test('browser read and cache completion append only to the captured inactive owner', async () => {
  const f = fixture(), reading = deferred(), importing = f.state.addBrowserFiles([f.browserFile('A.bin', reading.promise)]);
  f.switchTo('B'); f.state.prompt = 'B unchanged'; f.state.flushComposerDraft();
  reading.resolve(new Uint8Array([1, 2, 3]).buffer); await tick();
  assert.equal(f.writes[0].request.conversationId, 'A'); f.writes[0].resolve(f.cached('A.bin')); await importing;
  assert.deepEqual(f.state.attachments, []); assert.equal(f.state.prompt, 'B unchanged');
  const a = f.state.codingSessions.find(session => session.id === 'A');
  assert.equal(a.draftAttachments[0].uri, f.cached('A.bin').uri);
  assert.equal('dataBase64' in a.draftAttachments[0], false);
});

test('actual shutdown awaits the tracked producer and saves only successful durable imports before closing', async () => {
  for (const failed of [false, true]) {
    const f = fixture(), importing = f.state.addBrowserFiles([f.browserFile()]); await tick();
    f.state.applicationExitPreparing = true; f.state.applicationExitGeneration = 1;
    const closing = f.state.shutdownForApplicationExit(); await tick();
    assert.equal(f.state.terminalRecords.length, 1);
    if (failed) f.writes[0].reject(new Error('synthetic-cache-error')); else f.writes[0].resolve(f.cached());
    await importing;
    if (failed) {
      await assert.rejects(closing, /APPLICATION_EXIT_ATTACHMENT_NOT_SAVED/);
      assert.equal(f.state.terminalRecords.length, 1); assert.deepEqual(f.state.attachments, []);
    } else {
      await closing;
      assert.equal(f.state.codingSessions[0].draftAttachments[0].uri, f.cached().uri);
      assert.deepEqual(f.state.terminalRecords, []);
    }
  }
});

test('native picker and image preview capture the owner before their first await', async () => {
  for (const kind of ['picker', 'preview']) {
    const f = fixture(); f.state.contextFilePreview = { uri: 'file:///synthetic-source/a.png', name: 'A.png', kind: 'image', mimeType: 'image/png' };
    const importing = kind === 'picker' ? f.state.selectAttachments('file') : f.state.attachContextImage();
    f.switchTo('B'); if (kind === 'picker') f.picker.resolve({ path: { base: 'A.bin' } });
    await tick(); assert.equal(f.writes[0].request.conversationId, 'A');
    f.writes[0].resolve(f.cached('A.bin')); await importing;
    assert.deepEqual(f.state.attachments, []);
    assert.equal(f.state.codingSessions.find(session => session.id === 'A').draftAttachments.length, 1);
    assert.equal(f.fileReads.length, 1); assert.ok(f.fileReads[0].options.limits.size <= 24 * 1024 * 1024);
  }
});

test('close waits for an existing import; cancelling close preserves it and only owner deletion discards it', async () => {
  for (const action of ['close', 'cancel', 'delete']) {
    const f = fixture(), importing = f.state.addBrowserFiles([f.browserFile()]); await tick();
    f.state.applicationExitPreparing = true; f.state.applicationExitGeneration = 1;
    if (action === 'cancel') { f.state.applicationExitPreparing = false; f.state.applicationExitGeneration = 2; }
    if (action === 'delete') f.state.codingSessions = [];
    f.writes[0].resolve(f.cached()); await importing;
    assert.equal(f.state.attachments.length, action === 'delete' ? 0 : 1);
    assert.equal(f.state.pendingAttachmentImports.size, 0);
    assert.doesNotThrow(() => f.state.assertApplicationExitSaved(f.state.applicationExitGeneration));
  }
});

test('a deleted owner invalidates an old native selection before any file read or cache write', async () => {
  const f = fixture(), importing = f.state.selectAttachments('file');
  f.state.codingSessions = []; f.picker.resolve({ path: { base: 'A.bin' } }); await importing;
  assert.equal(f.fileReads.length, 0); assert.equal(f.writes.length, 0); assert.deepEqual(f.state.attachments, []);
});

test('delayed browser and native imports preserve a later edit confirmation using the real surface dismissal methods', async () => {
  for (const producer of ['browser', 'picker']) {
    const f = fixture();
    f.state.codingPopover = 'attachments'; f.state.workContextOpen = true; f.state.workContextMode = 'agent';
    f.state.codingSessions[0].turns = [{ id: 'turn', stage: 'complete', prompt: 'original' }];
    f.state.editingTurnValue = 'later edit';
    const importing = producer === 'browser' ? f.state.addBrowserFiles([f.browserFile()]) : f.state.selectAttachments('file');
    if (producer === 'picker') f.picker.resolve({ path: { base: 'synthetic.bin' } });
    await tick();
    f.state.requestTurnEditConfirmation('A', 'turn'); const confirmation = f.state.pendingTurnEdit;
    assert.ok(confirmation); f.writes[0].resolve(f.cached()); await importing;
    assert.equal(f.state.pendingTurnEdit, confirmation); assert.equal(f.state.workContextMode, 'agent');
    assert.equal(f.state.attachments.length, 1);
    f.state.dismissTurnEditConfirmation(); assert.equal(f.state.pendingTurnEdit, undefined, 'intentional dismissal still works');
  }
});

test('an import completes only its original attachment popover and never closes an unrelated drawer', async () => {
  for (const producer of ['browser', 'picker']) for (const originalPopover of ['', 'attachments']) {
    const f = fixture(); f.state.codingPopover = originalPopover; f.state.workContextOpen = true; f.state.workContextMode = 'file';
    const importing = producer === 'browser' ? f.state.addBrowserFiles([f.browserFile()]) : f.state.selectAttachments('file');
    if (producer === 'picker') f.picker.resolve({ path: { base: 'synthetic.bin' } });
    await tick(); f.writes[0].resolve(f.cached()); await importing;
    assert.equal(f.state.codingPopover, ''); assert.equal(f.state.workContextOpen, true);
    assert.equal(f.state.attachments.length, 1);
  }
});

test('deleting a different attachment does not cancel pending imports or resurrect the removed item', async () => {
  const f = fixture(); f.state.attachments = [{ id: 'old', uri: 'file:///old.bin', size: 1, attachment: { kind: 'file', name: 'old.bin' } }];
  const importing = f.state.addBrowserFiles([f.browserFile('new.bin')]); await tick();
  f.state.removeAttachment('old'); f.writes[0].resolve(f.cached('new.bin')); await importing;
  assert.deepEqual(f.state.attachments.map(item => item.id), ['new.bin']);
});

test('concurrent append uses latest owner counts and cannot exceed eight files or revive removed content', async () => {
  const f = fixture(); f.state.attachments = Array.from({ length: 7 }, (_, i) => ({ id: `old-${i}`, uri: `file:///old-${i}`, size: 1, attachment: { kind: 'file', name: `old-${i}` } }));
  const a = f.state.addBrowserFiles([f.browserFile('A.bin')]), b = f.state.addBrowserFiles([f.browserFile('B.bin')]); await tick();
  f.writes[1].resolve(f.cached('B.bin')); await b; f.writes[0].resolve(f.cached('A.bin')); await a;
  assert.equal(f.state.attachments.length, 8); assert.equal(f.state.attachments.at(-1).id, 'B.bin');
  assert.ok(f.state.attachmentError);
});

test('oversized file metadata and batches are rejected before arrayBuffer, base64 or cache', async () => {
  for (const files of [[{ size: 1024 ** 3, type: '' }], [{ size: 51 * 1024 ** 2, type: 'image/png' }],
    [{ size: 17 * 1024 ** 2 }, { size: 17 * 1024 ** 2 }], Array.from({ length: 9 }, () => ({ size: 1 }))]) {
    const f = fixture(); let reads = 0;
    await f.state.addBrowserFiles(files.map((value, i) => ({ ...f.browserFile(`${i}.bin`), ...value, arrayBuffer() { reads++; throw new Error('must not read'); } })));
    assert.equal(reads, 0); assert.equal(f.writes.length, 0); assert.ok(f.state.attachmentError);
  }
});

test('final append enforces total slots, aggregate bytes and duplicate URI for both owners', () => {
  for (const active of [true, false]) {
    const f = fixture(), record = { id: 'new', uri: 'file:///new', size: 3, attachment: { kind: 'file', name: 'new' } };
    if (!active) f.switchTo('B');
    const a = () => f.state.codingSessions.find(session => session.id === 'A');
    const existing = { id: 'large', uri: 'file:///large', size: 32 * 1024 ** 2, name: 'large', kind: 'file' };
    if (active) f.state.attachments = [{ ...existing, attachment: { kind: 'file', name: 'large' } }]; else a().draftAttachments = [existing];
    assert.throws(() => f.state.appendOwnedAttachment('A', record), /32 MB/);
    if (active) f.state.attachments = []; else a().draftAttachments = [];
    for (let i = 0; i < 20; i++) f.state.unpersistedPastedTextReferences.set(`${i}`, { sessionId: 'A', reference: { id: `${i}` } });
    assert.throws(() => f.state.appendOwnedAttachment('A', record), /20/);
    f.state.unpersistedPastedTextReferences.clear(); f.state.appendOwnedAttachment('A', record); f.state.appendOwnedAttachment('A', record);
    assert.equal(active ? f.state.attachments.length : a().draftAttachments.length, 1);
  }
});
