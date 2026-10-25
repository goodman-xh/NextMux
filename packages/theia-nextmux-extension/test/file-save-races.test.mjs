import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the production method, not a second implementation of its state machine.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = []; let dirtyHandler;
function visit(node) {
  if (ts.isMethodDeclaration(node) && ['normalizeModelEol', 'writeContextFile', 'writeVersionedContextFile', 'recordContextFileVersion', 'requestContextFileSave', 'acceptSavedRevision', 'rememberContextFileTab', 'activateContextFileTab', 'closeContextFileTab', 'assertApplicationExitSaved'].includes(node.name.getText(file))) methods.push(node.getText(file));
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'componentDidUpdate' && node.getText(file).includes('this.acceptSavedRevision()')) methods.push(node.getText(file));
  if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onDirty' && node.initializer?.expression?.getText(file).includes('this.contextFileDirty')) dirtyHandler = node.initializer.expression.getText(file);
  ts.forEachChild(node, visit);
}
visit(file); assert.equal(methods.length, 11); assert.ok(dirtyHandler);
const code = ts.transpile(`class Harness { ${methods.join('\n')} onDirty = ${dirtyHandler}; }`, { target: ts.ScriptTarget.ES2022 });
class Conflict extends Error { fileOperationResult = 3; }
const diffEditor = (original, modified) => ({
  updateOptions() {},
  getOriginalEditor: () => ({ updateOptions() {} }),
  getModifiedEditor: () => ({ updateOptions() {} }),
  getModel: () => ({ original, modified })
});

function fixture() {
  const timers = [], writes = [], recoveries = [], history = []; let resolve, reject, savedStat;
  const deferred = new Promise((yes, no) => { resolve = yes; reject = no; });
  let state;
  const Harness = new Function('URI', 'FileOperationError', 'FileOperationResult', 'window', 'isCurrentEditor', 'fileDrawerText', 'workbenchText', 'desktopFailureMessage', 'requireDurablePastedTextReferences', `${code}; return Harness;`)(
    class { constructor(value) { this.value = value; } }, Conflict, { FILE_MODIFIED_SINCE: 3 },
    { setTimeout(callback) { timers.push(callback); }, localStorage: { getItem() { return '1'; } } },
    () => state.editorCallbackCurrent !== false, (_locale, key) => key, (_locale, key) => key, (_locale, error) => error.message, () => {});
  state = new Harness();
  Object.assign(state, {
    contextFilePreview: { uri: 'file:///synthetic/first.txt', content: 'original', baselineSha256: 'original-hash', revision: 1, mtime: 1, etag: 'v1', recoveryKey: 'first-open' },
    pendingFileSave: { uri: 'file:///synthetic/first.txt', side: 'current', content: 'submitted' },
    contextFileDrafts: { current: 'submitted' }, contextFileDirty: true, contextFileSaveStatus: 'idle',
    pendingContextFileWrites: new Set(), contextFileTabs: new Map(),
    preserveContextFileTabRecovery() { return true; },
    contextFileSavingUris: new Set(),
    captureContextEditorRecovery(refresh) { recoveries.push({ refresh, preview: this.contextFilePreview, drafts: { ...this.contextFileDrafts } }); return true; },
    contextFilePreviewRequestToken: 1, activeCodingSessionId: 'first', contextFileActiveSide: 'current',
    codingSessions: [],
    // Root/path ownership is tested in workspace-edit-branch-stop; these tests
    // execute the real save and post-save UI methods against the current CAS RPC.
    contextFileVersionTarget(preview, sessionId) { return { workspaceRoot: '/synthetic', path: preview.uri.split('/').at(-1), conversationId: sessionId }; },
    platformService: {
      getAgentFileState: async () => ({ sha256: 'original-hash' }),
      async saveAgentFileVersion(request) {
        if (state.prepareSave) await state.prepareSave(request);
        writes.push({ uri: `file://${request.workspaceRoot}/${request.path}`, content: request.content, expectedSha256: request.expectedSha256 });
        await deferred;
        // A committed immutable checkpoint contains both sides. UI history
        // enrichment may fail later without losing this durable version.
        history.push({ sourceUri: writes.at(-1).uri, before: 'original', after: request.content });
        return { checkpointId: 'saved-checkpoint', sha256: 'saved-hash' };
      }
    },
    addNotification() {},
    lineNumbersMinChars() { return 1; },
    update() {}, fileService: { resolve: async () => savedStat }
  });
  return { state, timers, writes, recoveries, history, resolve(stat) { savedStat = stat; resolve(stat); }, reject };
}

test('checkpoint capacity failures preserve unsaved bytes and never bypass versioned saving', async () => {
  for (const code of ['FILE_HISTORY_TOO_LARGE', 'FILE_HISTORY_QUOTA_EXCEEDED']) {
    const f = fixture(), notices = [];
    f.state.platformService.saveAgentFileVersion = async () => { throw new Error(code); };
    f.state.addNotification = (...args) => notices.push(args);
    const pending = f.state.writeContextFile(false);
    f.resolve({ mtime: 2, etag: 'v2' }); await pending;
    assert.equal(f.writes.length, 0);
    assert.equal(f.state.contextFilePreview.content, 'original');
    assert.deepEqual(f.state.contextFileDrafts, { current: 'submitted' });
    assert.equal(f.state.contextFileDirty, true);
    assert.equal(f.state.contextFileSaveStatus, 'error');
    assert.ok(notices.some(item => item.includes(code)));
  }
});

test('a rejected save, undo and tab close do not leave a false exit blocker while another clean tab stays open', async () => {
  const f = fixture(), original = f.state.contextFilePreview, second = secondTab(f.state);
  f.state.contextFileTabs.set(second.uri, { preview: second, drafts: { current: second.content }, dirty: false, activeSide: 'current' });
  Object.assign(f.state, { applicationExitGeneration: 1, pendingAttachmentImports: new Set(),
    pendingDraftAttachmentRestores: () => [], pruneUnpersistedPastedTextReferences() {}, prompt: '', pastedTextReferences: [],
    unpersistedPastedTextReferences: new Set(), privacySettings: { saveConversationHistory: false },
    workspaceConfigurationSaver: { hasPendingChanges: false }, persistActiveCodingSessionState() {} });
  const saving = f.state.writeContextFile(false);
  f.reject(Object.assign(new Error('The disk file changed'), { code: 'ROLLBACK_CONFLICT' }));
  await saving;
  assert.equal(f.state.pendingContextFileWrites.size, 0);
  assert.equal(f.state.contextFileSavingUris.size, 0);
  assert.equal(f.state.pendingFileSave, undefined, 'a failed completed attempt must not remain pending');
  assert.equal(f.state.contextFileDirty, true);
  assert.deepEqual(f.state.contextFileDrafts, { current: 'submitted' });
  assert.throws(() => f.state.assertApplicationExitSaved(1), /APPLICATION_EXIT_FILE_NOT_SAVED/,
    'an unconfirmed dirty draft still prevents closing');
  // Model the editor undo notification; execute the production close/activate/exit methods.
  f.state.contextFileDrafts = { current: original.content };
  f.state.contextFileDirty = false;
  f.state.closeContextFileTab(original.uri);
  assert.equal(f.state.contextFilePreview, second);
  assert.equal(f.state.contextFileDirty, false);
  assert.equal(f.state.contextFileSaveStatus, 'idle');
  assert.equal(f.state.pendingFileSave, undefined);
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(1));
  assert.deepEqual(f.history, [], 'the rejected save never writes a new version');
});

test('late save success, error and conflict cannot restore a previous file or overwrite the new file', async () => {
  for (const outcome of ['success', 'error', 'conflict']) {
    const f = fixture(), operation = f.state.writeContextFile(false);
    await Promise.resolve();
    assert.equal(f.state.pendingContextFileWrites.size, 1);
    const current = { uri: 'file:///synthetic/second.txt', content: 'second' };
    Object.assign(f.state, { contextFilePreview: current, contextFilePreviewRequestToken: 2, pendingFileSave: undefined,
      contextFileSaveStatus: 'idle', contextFileDrafts: { current: 'new draft' }, activeCodingSessionId: 'second' });
    if (outcome === 'success') f.resolve({ mtime: 2, etag: 'v2' }); else f.reject(outcome === 'conflict' ? new Conflict() : new Error('synthetic'));
    await operation;
    assert.equal(f.state.pendingContextFileWrites.size, 0);
    assert.equal(f.state.contextFilePreview, current); assert.equal(f.state.contextFileSaveStatus, 'idle');
    assert.deepEqual(f.state.contextFileDrafts, { current: 'new draft' }); assert.equal(f.writes.length, 1); assert.equal(f.timers.length, 0);
  }
});

test('same URI reopened under a new recovery key, changed session and changed baseline reject stale save completion', async () => {
  for (const field of ['reopen', 'session', 'revision']) {
    const f = fixture(), operation = f.state.writeContextFile(false), preview = f.state.contextFilePreview;
    await Promise.resolve();
    if (field === 'reopen') f.state.contextFilePreview = { ...preview, recoveryKey: 'new-open' };
    if (field === 'session') f.state.activeCodingSessionId = 'other';
    if (field === 'revision') f.state.contextFilePreview = { ...preview, revision: 2 };
    const current = f.state.contextFilePreview;
    f.resolve({ mtime: 2, etag: 'v2' }); await operation;
    assert.equal(f.state.contextFilePreview, current); assert.equal(f.state.contextFileDirty, true);
  }
});

test('typing in either diff pane during save preserves drafts and stays dirty against the saved disk version', async () => {
  for (const side of ['current', 'before']) {
    const f = fixture(); f.state.contextFilePreview.beforeContent = 'checkpoint';
    f.state.contextFileDrafts.before = 'checkpoint';
    const operation = f.state.writeContextFile(false);
    f.state.contextFileDrafts = { ...f.state.contextFileDrafts, [side]: 'typed during save' };
    f.resolve({ mtime: 2, etag: 'v2' }); await operation;
    assert.equal(f.state.contextFileDrafts[side], 'typed during save'); assert.equal(f.state.contextFileDirty, true);
    assert.equal(f.state.contextFilePreview.content, 'submitted'); assert.equal(f.state.contextFilePreview.beforeContent, 'checkpoint');
    assert.equal(f.state.contextFilePreview.etag, 'v2'); assert.equal(f.state.contextFileSaveStatus, 'idle');
  }
});

test('duplicate submission writes once and a saved-status timer cannot alter a newer view', async () => {
  const f = fixture(), operation = f.state.writeContextFile(false);
  await Promise.resolve();
  await f.state.writeContextFile(true); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedSha256, 'original-hash');
  f.resolve({ mtime: 2, etag: 'v2' }); await operation;
  assert.equal(f.state.contextFileDirty, false); assert.equal(f.state.contextFileSaveStatus, 'saved');
  f.state.contextFilePreview = { ...f.state.contextFilePreview };
  f.timers[0](); assert.equal(f.state.contextFileSaveStatus, 'saved');
});

test('confirming an older pending save cannot discard a draft edited before confirmation', async () => {
  const f = fixture(); f.state.contextFileDrafts = { current: 'newer than pending confirmation' };
  const operation = f.state.writeContextFile(true);
  f.resolve({ mtime: 2, etag: 'v2' }); await operation;
  assert.equal(f.writes[0].content, 'submitted');
  assert.equal(f.state.contextFileDrafts.current, 'newer than pending confirmation');
  assert.equal(f.state.contextFileDirty, true); assert.equal(f.state.contextFileSaveStatus, 'idle');
});

test('real editor dirty callback cannot release the save lock after undo and continued typing', async () => {
  const f = fixture(), operation = f.state.writeContextFile(false);
  await Promise.resolve();
  f.state.onDirty(false);
  f.state.contextFileDrafts = { current: 'typed after undo' };
  f.state.onDirty(true);
  assert.equal(f.state.contextFileSaveStatus, 'saving');
  f.state.requestContextFileSave('current', 'typed after undo');
  assert.equal(f.writes.length, 1);
  f.resolve({ mtime: 2, etag: 'v2' }); await operation;
  assert.equal(f.state.contextFileDrafts.current, 'typed after undo'); assert.equal(f.state.contextFileDirty, true);
});

test('a stale editor dirty callback cannot change the newer preview save state', () => {
  const f = fixture(); f.state.editorCallbackCurrent = false;
  f.state.contextFileDirty = false; f.state.contextFileSaveStatus = 'saved';
  f.state.onDirty(true);
  assert.equal(f.state.contextFileDirty, false); assert.equal(f.state.contextFileSaveStatus, 'saved');
});

test('actual diff component revision keeps the modified draft when saving the before pane', async () => {
  const f = fixture(), original = { getValue: () => 'saved before', pushStackElement() {} },
    modified = { getValue: () => 'new modified draft', pushStackElement() {} };
  f.state.editor = diffEditor(original, modified);
  f.state.models = [original, modified]; f.state.baselineBySide = new Map(); f.state.dirtyBySide = new Map([['before', true], ['current', true]]);
  let currentDraft, dirty;
  f.state.props = { uri: 'file:///synthetic/first.txt', content: 'saved before', beforeContent: 'checkpoint', revision: 2, theme: 'dark',
    onContentChange(side, value) { if (side === 'current') currentDraft = value; }, onDirty(value) { dirty = value; } };
  f.state.componentDidUpdate({ ...f.state.props, revision: 1 });
  assert.equal(currentDraft, 'new modified draft'); assert.equal(dirty, true);
  assert.equal(f.state.dirtyBySide.get('before'), false); assert.equal(f.state.dirtyBySide.get('current'), true);
  assert.equal(f.state.baselineBySide.get('current'), 'saved before');
});

test('both panes already dirty before Save preserve the other pane, including an intentional empty draft', async () => {
  for (const side of ['before', 'current']) for (const otherText of ['other unsaved text', '']) {
    const f = fixture(), other = side === 'before' ? 'current' : 'before';
    f.state.contextFilePreview.beforeContent = 'checkpoint'; f.state.contextFilePreview.checkpointId = 'checkpoint-id';
    f.state.contextFileDrafts = { before: 'save before', current: 'save current', [other]: otherText };
    const submitted = f.state.contextFileDrafts[side];
    f.state.pendingFileSave = { uri: f.state.contextFilePreview.uri, side, content: submitted };
    const pending = f.state.writeContextFile(false); f.resolve({ mtime: 2, etag: 'v2' }); await pending;
    assert.equal(f.writes[0].content, submitted); assert.equal(f.state.contextFileDrafts[other], otherText);
    assert.equal(f.state.contextFileDirty, true); assert.equal(f.state.contextFileSaveStatus, 'idle');
    assert.equal(f.state.contextFilePreview.checkpointId, 'checkpoint-id');
    assert.equal(f.state.contextFilePreview.beforeContent, side === 'before' ? submitted : 'checkpoint');
    assert.equal(f.recoveries.length, 1); assert.equal(f.recoveries[0].refresh, true);
    assert.equal(f.recoveries[0].drafts[other], otherText);
    assert.equal(f.recoveries[0].preview.content, submitted);
  }
});

test('write plus actual component revision advances the saved before baseline without discarding either model or undoing new input', async () => {
  const f = fixture(); f.state.contextFilePreview.beforeContent = 'old checkpoint';
  f.state.contextFileDrafts = { before: 'submitted before', current: 'other dirty current' };
  f.state.pendingFileSave = { uri: f.state.contextFilePreview.uri, side: 'before', content: 'submitted before' };
  const previous = { ...f.state.contextFilePreview, theme: 'dark' }, pending = f.state.writeContextFile(false);
  f.state.contextFileDrafts.before = 'typed while saving before';
  f.resolve({ mtime: 2, etag: 'v2' }); await pending;
  const original = { getValue: () => f.state.contextFileDrafts.before, pushStackElement() {} };
  const modified = { getValue: () => f.state.contextFileDrafts.current, pushStackElement() {} };
  f.state.editor = diffEditor(original, modified);
  f.state.models = [original, modified]; f.state.baselineBySide = new Map(); f.state.dirtyBySide = new Map();
  f.state.props = { ...f.state.contextFilePreview, theme: 'dark',
    onContentChange(side, value) { f.state.contextFileDrafts[side] = value; }, onDirty(value) { f.state.contextFileDirty = value; } };
  f.state.componentDidUpdate(previous);
  assert.equal(f.state.baselineBySide.get('before'), 'submitted before');
  assert.equal(f.state.baselineBySide.get('current'), 'submitted before');
  assert.equal(f.state.dirtyBySide.get('before'), true); assert.equal(f.state.dirtyBySide.get('current'), true);
  assert.deepEqual(f.state.contextFileDrafts, { before: 'typed while saving before', current: 'other dirty current' });
  // Returning to the old checkpoint is still different from the bytes actually saved.
  f.state.contextFileDrafts.before = 'old checkpoint'; f.state.acceptSavedRevision();
  assert.equal(f.state.dirtyBySide.get('before'), true);
  f.state.contextFileDrafts.before = 'submitted before'; f.state.acceptSavedRevision();
  assert.equal(f.state.dirtyBySide.get('before'), false); assert.equal(f.state.dirtyBySide.get('current'), true);
});

test('byte-identical panes may collapse only after those exact bytes are written', async () => {
  for (const side of ['before', 'current']) {
    const f = fixture(); f.state.contextFilePreview.beforeContent = 'checkpoint';
    f.state.contextFileDrafts = { before: 'same explicit draft', current: 'same explicit draft' };
    f.state.pendingFileSave = { uri: f.state.contextFilePreview.uri, side, content: 'same explicit draft' };
    const pending = f.state.writeContextFile(false); f.resolve({ mtime: 2, etag: 'v2' }); await pending;
    assert.equal(f.state.contextFileDirty, false); assert.equal(f.state.contextFilePreview.beforeContent, undefined);
    assert.deepEqual(f.state.contextFileDrafts, { current: 'same explicit draft' });
    assert.equal(f.recoveries.length, 1); assert.equal(f.recoveries[0].preview.content, 'same explicit draft');
  }
});

test('read-only recovered sources never write or refresh a saved recovery baseline; stale/failed writes also cannot acknowledge recovery', async () => {
  const readonly = fixture(); readonly.state.contextFilePreview.readOnly = true;
  await readonly.state.writeContextFile(true); assert.equal(readonly.writes.length, 0); assert.equal(readonly.recoveries.length, 0);
  for (const mode of ['stale', 'failure']) {
    const f = fixture(), pending = f.state.writeContextFile(false);
    if (mode === 'stale') { f.state.contextFilePreview = { ...f.state.contextFilePreview, recoveryKey: 'new-open' }; f.resolve({ mtime: 2, etag: 'v2' }); }
    else f.reject(new Error('synthetic write failure'));
    await pending; assert.equal(f.recoveries.length, 0);
  }
});

test('checkpoint failure prevents overwrite, but post-commit preview failure reports the saved file accurately', async () => {
  const blocked = fixture();
  blocked.state.platformService.saveAgentFileVersion = async () => { throw new Error('history disk full'); };
  await blocked.state.writeContextFile(false);
  assert.equal(blocked.writes.length, 0); assert.equal(blocked.state.contextFileDirty, true);
  assert.equal(blocked.state.contextFileSaveStatus, 'error');
  const saved = fixture(), notices = [];
  saved.state.recordContextFileVersion = async () => { throw new Error('history preview unavailable'); };
  saved.state.addNotification = (...notice) => notices.push(notice);
  const writing = saved.state.writeContextFile(false); saved.resolve({ mtime: 2, etag: 'v2' }); await writing;
  assert.equal(saved.writes.length, 1); assert.equal(saved.state.contextFileSaveStatus, 'saved');
  assert.equal(saved.state.contextFilePreview.content, 'submitted'); assert.equal(saved.state.contextFileDirty, false);
  assert.deepEqual(saved.history, [{ sourceUri: 'file:///synthetic/first.txt', before: 'original', after: 'submitted' }]);
  assert.deepEqual(notices, [['warning', 'history', 'historyPartial', 'first']]);
});

test('a save finishing after tab navigation updates only the inactive tab and retains its newer draft', async () => {
  const f = fixture(), original = f.state.contextFilePreview;
  f.state.contextFileTabs = new Map([[original.uri, { preview: original, drafts: { current: 'newer than saved' }, dirty: true, activeSide: 'current' }]]);
  f.state.preserveContextFileTabRecovery = () => undefined;
  const writing = f.state.writeContextFile(false); await Promise.resolve();
  f.state.contextFilePreview = { uri: 'file:///synthetic/second.txt', content: 'second', revision: 1 };
  f.state.contextFileDrafts = { current: 'second draft' }; f.state.contextFileSaveStatus = 'idle';
  f.state.contextFilePreviewRequestToken++;
  f.resolve({ mtime: 2, etag: 'v2' }); await writing;
  const saved = f.state.contextFileTabs.get(original.uri);
  assert.equal(saved.preview.content, 'submitted'); assert.equal(saved.preview.etag, 'v2');
  assert.deepEqual(saved.drafts, { current: 'newer than saved' }); assert.equal(saved.dirty, true);
  assert.equal(f.state.contextFilePreview.uri, 'file:///synthetic/second.txt');
  assert.deepEqual(f.state.contextFileDrafts, { current: 'second draft' }); assert.equal(f.state.contextFileSavingUris.size, 0);
});


function secondTab(state) {
  const preview = { uri: 'file:///synthetic/second.txt', content: 'second', recoveryKey: 'second-open', revision: 1 };
  state.contextFileTabs.set(preview.uri, { preview, drafts: { current: 'second draft' }, dirty: true, activeSide: 'current' });
  return preview;
}

test('switching tabs while checkpoint preparation is pending still saves the captured file and records both versions', async () => {
  const f = fixture(), original = f.state.contextFilePreview, second = secondTab(f.state);
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  f.state.prepareSave = () => historyGate;
  const writing = f.state.writeContextFile(false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.state.activateContextFileTab(second.uri), true);
  f.state.pendingFileSave = { uri: second.uri, side: 'current', content: 'second pending save' };
  const secondPending = f.state.pendingFileSave;
  releaseHistory(); f.resolve({ mtime: 2, etag: 'v2' }); await writing;
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].uri, original.uri);
  assert.equal(f.writes[0].content, 'submitted');
  assert.deepEqual(f.history, [{ sourceUri: original.uri, before: 'original', after: 'submitted' }]);
  const saved = f.state.contextFileTabs.get(original.uri);
  assert.equal(saved.preview.content, 'submitted'); assert.equal(saved.preview.etag, 'v2'); assert.equal(saved.dirty, false);
  assert.equal(f.state.contextFilePreview, second); assert.equal(f.state.pendingFileSave, secondPending);
  assert.deepEqual(f.state.contextFileDrafts, { current: 'second draft' });
});

test('a save completing after A to B to A navigation updates the active baseline and retains newer typing', async () => {
  for (const newer of [undefined, 'typed after returning', '']) {
    const f = fixture(), original = f.state.contextFilePreview, second = secondTab(f.state);
    const writing = f.state.writeContextFile(false); await Promise.resolve();
    assert.equal(f.state.activateContextFileTab(second.uri), true);
    assert.equal(f.state.activateContextFileTab(original.uri), true);
    f.state.pendingFileSave = undefined;
    if (newer !== undefined) f.state.contextFileDrafts.current = newer;
    // Switching tabs captures the outgoing tab; the settled save must add exactly one more.
    const capturesBeforeSave = f.recoveries.length;
    f.resolve({ mtime: 2, etag: 'v2' }); await writing;
    assert.equal(f.state.contextFilePreview.uri, original.uri); assert.equal(f.state.contextFilePreview.content, 'submitted');
    assert.equal(f.state.contextFilePreview.etag, 'v2'); assert.equal(f.state.contextFilePreview.revision, 2);
    assert.equal(f.state.contextFileDrafts.current, newer ?? 'submitted');
    assert.equal(f.state.contextFileDirty, newer !== undefined);
    assert.equal(f.state.contextFileSaveStatus, newer === undefined ? 'saved' : 'idle');
    assert.equal(f.state.contextFileTabs.get(original.uri).preview, f.state.contextFilePreview);
    assert.equal(f.recoveries.length, capturesBeforeSave + 1); assert.equal(f.state.contextFileSavingUris.size, 0);
  }
});

test('an inactive file CAS conflict never silently overwrites and preserves both file drafts and the active pending save', async () => {
  const f = fixture(), original = f.state.contextFilePreview, second = secondTab(f.state), writes = [];
  let rejectFirst;
  f.state.platformService.saveAgentFileVersion = async request => {
    writes.push(request);
    if (writes.length === 1) await new Promise((resolve, reject) => { rejectFirst = reject; });
    throw new Error('unexpected retry bypassed CAS');
  };
  const writing = f.state.writeContextFile(false); await Promise.resolve();
  f.state.activateContextFileTab(second.uri);
  f.state.pendingFileSave = { uri: second.uri, side: 'before', content: 'second submitted' };
  const secondPending = f.state.pendingFileSave;
  rejectFirst(Object.assign(new Error('CHECKPOINT_CONFLICT'), { code: 'CHECKPOINT_CONFLICT' })); await writing;
  assert.deepEqual(writes, [
    { workspaceRoot: '/synthetic', path: 'first.txt', conversationId: 'first', content: 'submitted', expectedSha256: 'original-hash' }
  ]);
  assert.equal(f.state.contextFileTabs.get(original.uri).preview.etag, 'v1');
  assert.equal(f.state.contextFileTabs.get(original.uri).dirty, true);
  assert.deepEqual(f.state.contextFileTabs.get(original.uri).drafts, { current: 'submitted' });
  assert.equal(f.state.contextFilePreview, second); assert.equal(f.state.pendingFileSave, secondPending);
  assert.equal(f.state.contextFileSaveStatus, 'idle'); assert.equal(f.state.contextFileSavingUris.size, 0);
});

test('closing and reopening the same URI during a save cannot apply its old baseline to the replacement tab', async () => {
  const f = fixture(), original = f.state.contextFilePreview, second = secondTab(f.state);
  const writing = f.state.writeContextFile(false); await Promise.resolve();
  f.state.activateContextFileTab(second.uri);
  f.state.contextFileTabs.delete(original.uri);
  const reopened = { ...original, recoveryKey: 'reopened-first', content: 'reopened disk', etag: 'reopened' };
  f.state.contextFileTabs.set(original.uri, { preview: reopened, drafts: { current: 'reopened draft' }, dirty: true, activeSide: 'current' });
  f.state.activateContextFileTab(original.uri);
  // Switching tabs captures each outgoing tab; the stale save must add none.
  const capturesBeforeSave = f.recoveries.length;
  f.resolve({ mtime: 2, etag: 'v2' }); await writing;
  assert.equal(f.state.contextFilePreview, reopened); assert.equal(f.state.contextFileTabs.get(original.uri).preview, reopened);
  assert.deepEqual(f.state.contextFileDrafts, { current: 'reopened draft' });
  assert.equal(f.state.contextFileDirty, true); assert.equal(f.recoveries.length, capturesBeforeSave);
});
