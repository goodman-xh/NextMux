import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Run the real widget/editor methods against a deterministic file service.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['loadContextFileHistory', 'selectContextFileHistory', 'saveAllContextFiles', 'rememberContextFileTab', 'activateContextFileTab', 'closeContextFileTab', 'closeAllContextFileTabs', 'previewContextFile', 'applyHistoryContent', 'beginContextFileOpen', 'finishContextFileOpen'];
const methods = [];
function visit(node) {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
class Conflict extends Error { fileOperationResult = 3; }
const Harness = new Function('URI', 'FileOperationError', 'FileOperationResult', 'fileDrawerText', 'workbenchText',
  'editorRecoveryText', 'filePreviewRequestIsCurrent', 'NextMuxDesktopWidget', 'FileSystemProviderCapabilities', 'crypto', 'filePreviewErrorText',
  'toFileOperationResult', 'FILE_DRAWER_TEXT_MAX_BYTES', 'IMAGE_PREVIEW_MAX_BYTES', `${code}; return Harness;`)(
  class { constructor(value) { this.value = value; } }, Conflict, { FILE_MODIFIED_SINCE: 3, FILE_TOO_LARGE: 7, FILE_EXCEEDS_MEMORY_LIMIT: 9 }, (_locale, key) => key, (_locale, key) => key,
  (_locale, key) => key, (actualToken, expectedToken, actualSession, expectedSession) => actualToken === expectedToken && actualSession === expectedSession,
  { LARGE_TEXT_FILE_CHARACTERS: 1_000_000, FILE_LIST_MIN_WIDTH: 100 }, { Readonly: 1 }, { randomUUID }, (_locale, key) => key,
  error => error?.fileOperationResult ?? 0, 64 * 1024 * 1024, 32 * 1024 * 1024);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const state = new Harness(), writes = [], records = [], applied = [], notices = [];
  Object.assign(state, {
    activeCodingSessionId: 'session', activeWorkspaceRoot: '/work', desktopLocale: 'en', contextFilePreviewRequestToken: 1,
    contextFileHistoryRequestToken: 0, contextFileHistorySelectionToken: 0, contextFileHistorySelecting: false,
    contextFileHistoryOpen: true, contextFileHistoryLoading: false, contextFileHistoryError: '', contextFileHistory: [],
    contextFileSaveStatus: 'idle', contextFileSaveAllActive: false, pendingContextFileWrites: new Set(),
    contextFileSavingUris: new Set(),
    contextFilePreview: { uri: 'file:///work/main.ts', path: '/work/main.ts', name: 'main.ts', content: 'current', mtime: 3, etag: 'v3', revision: 1, recoveryKey: 'recovery' },
    contextFileDrafts: { current: 'current' }, contextFileDirty: false, contextFileActiveSide: 'current', contextFileTabs: new Map(),
    session: { id: 'session', workspacePath: '/work', turns: [] }, activeCodingSession() { return this.session; }, codingSessionWorkspaceRoot() { return '/work'; },
    contextFileHistorySources: [], contextFileHistoryLegacy: [],
    codingSessionStoredWorkspaceRoots(session) { return session?.workspaceBindings?.map(item => item.path) || [session?.workspacePath || '/work']; },
    contextFileVersionTarget(preview, sessionId = this.activeCodingSessionId) { return preview.path.startsWith('/work/') ? { workspaceRoot: '/work', conversationId: sessionId, path: preview.path.slice(6) } : undefined; },
    async recordContextFileVersion(sessionId, root, checkpointId) { records.push({ sessionId, root, checkpointId }); },
    async writeVersionedContextFile(preview, content) {
      const saved = await this.fileService.write(preview.uri, content);
      records.push({ kind: 'original', content: preview.content }, { kind: 'saved', content });
      return { ...saved, baselineSha256: 'saved-hash' };
    },
    update() {}, captureContextEditorRecovery() { return true; }, addNotification(...args) { notices.push(args); },
    markCheckpointRestored() {}, unmarkCheckpointRestored() {},
    preserveContextFileTabRecovery() { return true; },
    detachContextEditorRecovery() { return true; },
    persistActiveCodingSessionState() {},
    contextFileEditorRef: { current: { applyHistoryContent(content) { applied.push(content); } } },
    requestContextFileSave(side, content, kind) { writes.push({ side, content, kind }); this.contextFilePreview = { ...this.contextFilePreview, content }; },
    platformService: {
      listAgentFileVersions: async () => ({ versions: [] }),
      getAgentFileState: async () => ({ path: '/work/main.ts', sha256: 'disk-hash', size: 10, exists: true, mode: 420 }),
      saveAgentFileVersion: async request => { writes.push(request); return { checkpointId: `restored-${writes.length}`, path: '/work/main.ts', sha256: 'saved-hash' }; },
      restoreAgentFileVersion: async request => { writes.push(request); return { restored: true, checkpointId: `restored-${writes.length}`, path: '/work/main.ts', sha256: 'saved-hash' }; },
      listFileHistory: async () => [], readFileHistory: async () => { throw new Error('missing'); },
      recordFileHistory: async entry => { records.push(entry); },
      getAgentCheckpointDiff: async () => { throw new Error('missing'); }
    },
    fileService: { write: async (_uri, content) => { writes.push(content); return { mtime: 4, etag: 'v4' }; } }
  });
  state.codingSessions = [state.session];
  state.rememberContextFileTab();
  return { state, writes, records, applied, notices };
}

test('Save All preserves unsaved content if the versioned write cannot be secured', async () => {
  const { state, writes, notices } = fixture();
  state.contextFileDrafts = { current: 'edited large file' }; state.contextFileDirty = true;
  state.writeVersionedContextFile = async () => { throw new Error('checkpoint unavailable'); };
  await state.saveAllContextFiles();
  assert.deepEqual(writes, []);
  assert.equal(state.contextFilePreview.content, 'current');
  assert.equal(state.contextFileDirty, true);
  assert.ok(notices.length);
});

const version = (checkpointId, createdAt, workspaceRoot = '/work', path = '/work/main.ts', operation) => ({
  checkpointId, createdAt, workspaceRoot, path, beforeSha256: 'same-bytes', afterSha256: 'same-bytes', beforeMode: 420, afterMode: 420, operation
});
test('timeline preserves equal-content and restored events and pages metadata without loading binary content', async () => {
  const { state } = fixture(); let reads = 0;
  state.contextFilePreview.error = 'binary preview unavailable';
  state.platformService.listFileHistory = async () => [{ id: 'manual', kind: 'restored', createdAt: '2026-09-11T02:00:00Z' }];
  state.platformService.listAgentFileVersions = async request => {
    reads++;
    assert.equal(request.limit, 50);
    return request.cursor ? { versions: [version('old', '2026-09-11T00:00:00Z')] }
      : { versions: [version('new', '2026-09-11T03:00:00Z', '/work', '/work/main.ts', 'timeline_restore')], nextCursor: 'next-page' };
  };
  await state.loadContextFileHistory();
  assert.deepEqual(state.contextFileHistory.map(item => item.id), ['current', 'checkpoint:/work:new:after', 'checkpoint:/work:new:before', 'local:manual']);
  assert.equal(state.contextFileHistory[1].kind, 'restored');
  assert.equal(reads, 1);
  await state.loadContextFileHistory(true);
  assert.equal(state.contextFileHistory.length, 6);
  assert.equal(state.contextFileHistorySources[0].done, true);
  assert.equal(state.contextFileHistoryError, '');
  assert.ok(state.contextFileHistory.every(item => item.content === undefined));
});

test('a later timeline reload wins when a previous read completes last', async () => {
  const { state } = fixture(), older = deferred(); let reads = 0;
  state.platformService.listFileHistory = () => ++reads === 1 ? older.promise : Promise.resolve([{ id: 'new', kind: 'saved', createdAt: '2026-09-11T02:00:00Z' }]);
  const first = state.loadContextFileHistory();
  await state.loadContextFileHistory();
  older.resolve([{ id: 'old', kind: 'saved', createdAt: '2026-09-11T01:00:00Z' }]); await first;
  assert.deepEqual(state.contextFileHistory.map(item => item.id), ['current', 'local:new']);
});

test('timeline merges nested roots and explicitly recorded outside-root edits', async () => {
  const { state } = fixture(), reads = [];
  state.session.workspaceBindings = [{ path: '/work' }, { path: '/work/nested' }, { path: '/different' }];
  state.contextFilePreview.path = '/work/nested/main.ts';
  state.session.turns = [{ changes: [{ workspaceRoot: '/different', externalTarget: '/work/nested/main.ts', checkpointId: 'external' }] }];
  state.platformService.listAgentFileVersions = async request => { reads.push(request); return { versions: [version(request.workspaceRoot, '2026-09-11T00:00:00Z', request.workspaceRoot, '/work/nested/main.ts')] }; };
  await state.loadContextFileHistory();
  assert.deepEqual(reads.map(item => item.workspaceRoot), ['/work', '/work/nested', '/different']);
  assert.equal(reads[2].checkpointId, 'external');
  assert.equal(reads[2].path, undefined);
  assert.equal(state.contextFileHistory.length, 7);
});

test('restoring history uses disk CAS, appends an event, and never truncates messages', async () => {
  const { state, writes, records } = fixture();
  state.session.turns = [{ id: 't1', user: 'keep first' }, { id: 't2', user: 'keep second' }];
  const before = JSON.stringify(state.session.turns);
  const preview = state.contextFilePreview;
  state.previewContextFile = async () => { state.contextFilePreview = { ...preview, baselineSha256: 'disk-hash' }; };
  const entry = { id: 'history', uri: preview.uri, checkpointId: 'old', workspaceRoot: '/work', conversationId: 'session', side: 'before', kind: 'before' };
  await state.selectContextFileHistory(entry);
  await state.selectContextFileHistory(entry);
  assert.equal(writes.length, 2, 'repeated restoration remains available');
  assert.deepEqual(writes.map(item => item.expectedSha256), ['disk-hash', 'disk-hash']);
  assert.deepEqual(records.map(item => item.checkpointId), ['restored-1', 'restored-2']);
  assert.equal(JSON.stringify(state.session.turns), before);
  assert.equal(state.contextFileDirty, false);
});

test('switching tabs keeps the timeline open, keeps unmodified files empty, and reloads history for modified files', async () => {
  const { state } = fixture(), requested = [];
  const first = state.contextFilePreview;
  const second = { preview: { ...first, uri: 'file:///work/second.ts', name: 'second.ts', content: 'second' },
    drafts: { current: 'second' }, dirty: false, activeSide: 'current' };
  state.contextFileTabs.set(second.preview.uri, second);
  state.platformService.listFileHistory = async uri => { requested.push(uri); return []; };
  state.contextFileHistory = [{ id: 'old', uri: first.uri }];
  assert.equal(state.activateContextFileTab(second.preview.uri), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.contextFileHistoryOpen, true);
  assert.deepEqual(requested, [second.preview.uri]);
  assert.deepEqual(state.contextFileHistory, [], 'unmodified file does not synthesize a history version');
  state.platformService.listFileHistory = async uri => [{ id: 'saved-2', uri, kind: 'saved', createdAt: '2026-09-11T02:00:00Z' }];
  await state.loadContextFileHistory();
  assert.deepEqual(state.contextFileHistory.map(item => item.uri), [second.preview.uri, second.preview.uri]);
});

test('saving and stale-file history clicks cannot alter the draft; a slow read cannot replace newer input', async () => {
  const { state, applied, writes } = fixture();
  const entry = { id: 'history', uri: state.contextFilePreview.uri, historyId: 'history' };
  state.contextFileSaveStatus = 'saving';
  await state.selectContextFileHistory({ ...entry, content: 'historic' });
  state.contextFileSaveStatus = 'idle';
  await state.selectContextFileHistory({ ...entry, uri: 'file:///other.ts', content: 'historic' });
  const read = deferred(); state.platformService.readFileHistory = () => read.promise;
  const choosing = state.selectContextFileHistory(entry);
  state.contextFileDrafts = { current: 'typed while reading' };
  read.resolve({ content: 'historic' }); await choosing;
  assert.deepEqual(state.contextFileDrafts, { current: 'typed while reading' });
  assert.equal(state.contextFileHistorySelecting, false);
  assert.deepEqual(applied, []); assert.deepEqual(writes, []);
});

test('history replacement applies a real Monaco edit with undo boundaries', () => {
  const state = new Harness(), operations = []; let value = 'present';
  const model = { getValue: () => value, getFullModelRange: () => 'full-range', pushStackElement() { operations.push('boundary'); } };
  const editor = { getModel: () => model, executeEdits(source, edits) { operations.push({ source, edits }); value = edits[0].text; }, focus() {} };
  state.props = {}; state.editor = { getModifiedEditor: () => editor };
  state.applyHistoryContent('historic');
  assert.equal(value, 'historic'); assert.equal(operations.length, 3);
  assert.equal(operations[1].source, 'nextmux-file-history');
  state.applyHistoryContent('historic'); assert.equal(operations.length, 3);
});

test('Save all advances the active baseline without reintroducing its stale tab and records both versions', async () => {
  const { state, records } = fixture();
  state.contextFileDrafts = { current: 'saved text' }; state.contextFileDirty = true; state.contextFileHistoryOpen = false;
  await state.saveAllContextFiles();
  assert.equal(state.contextFilePreview.content, 'saved text');
  assert.equal(state.contextFileTabs.get(state.contextFilePreview.uri).preview.content, 'saved text');
  assert.equal(state.contextFileDirty, false); assert.equal(state.contextFileSaveAllActive, false);
  assert.deepEqual(records.map(item => [item.kind, item.content]), [['original', 'current'], ['saved', 'saved text']]);
});

test('Save all preserves newer typing and an independently edited before pane', async () => {
  const { state } = fixture(), disk = deferred();
  state.contextFilePreview.beforeContent = 'old before'; state.contextFileHistoryOpen = false;
  state.contextFileDrafts = { current: 'submitted', before: 'independent before edit' }; state.contextFileDirty = true;
  state.fileService.write = () => disk.promise;
  const saving = state.saveAllContextFiles(); await Promise.resolve();
  state.contextFileDrafts = { ...state.contextFileDrafts, current: 'new typing' }; state.rememberContextFileTab();
  disk.resolve({ mtime: 5, etag: 'v5' }); await saving;
  assert.equal(state.contextFilePreview.content, 'submitted');
  assert.deepEqual(state.contextFileDrafts, { current: 'new typing', before: 'independent before edit' });
  assert.equal(state.contextFileDirty, true); assert.equal(state.contextFilePreview.beforeContent, 'old before');
});

test('Save all reports a failed write while retaining dirty content', async () => {
  const { state, notices } = fixture(); state.contextFileDrafts = { current: 'unsaved' }; state.contextFileDirty = true;
  state.fileService.write = async () => { throw new Error('disk full'); };
  await state.saveAllContextFiles();
  assert.equal(state.contextFileDirty, true); assert.equal(state.contextFilePreview.content, 'current');
  assert.equal(state.contextFileSaveStatus, 'error'); assert.equal(notices.length, 1);
});

test('clicking the active file tab cannot release its in-flight save lock', () => {
  const { state } = fixture(); state.contextFileSaveStatus = 'saving';
  assert.equal(state.activateContextFileTab(state.contextFilePreview.uri), true);
  assert.equal(state.contextFileSaveStatus, 'saving');
});

test('closing the active tab switches once without resurrecting it; closing an inactive tab preserves selection', () => {
  const { state } = fixture(), original = state.contextFilePreview;
  const second = { preview: { ...original, uri: 'file:///work/second.ts', name: 'second.ts' }, drafts: { current: 'second draft' }, dirty: true, activeSide: 'current' };
  const third = { preview: { ...original, uri: 'file:///work/third.ts', name: 'third.ts' }, drafts: {}, dirty: false, activeSide: 'current' };
  state.contextFileTabs.set(second.preview.uri, second); state.contextFileTabs.set(third.preview.uri, third);
  state.closeContextFileTab(second.preview.uri);
  assert.equal(state.contextFilePreview, original); assert.equal(state.contextFileTabs.has(second.preview.uri), false);
  state.closeContextFileTab(original.uri);
  assert.equal(state.contextFilePreview, third.preview); assert.equal(state.contextFileTabs.has(original.uri), false);
  assert.equal(state.contextFileTabs.size, 1);
});

test('closing the last tab clears the timeline and invalidates in-flight history selection', () => {
  const { state } = fixture();
  state.contextFileHistory = [{ id: 'old' }]; state.contextFileHistoryLoading = true; state.contextFileHistorySelecting = true;
  state.closeContextFileTab(state.contextFilePreview.uri);
  assert.equal(state.contextFileTabs.size, 0); assert.equal(state.contextFilePreview, undefined);
  assert.deepEqual(state.contextFileHistory, []); assert.equal(state.contextFileHistoryOpen, false);
  assert.equal(state.contextFileHistoryLoading, false); assert.equal(state.contextFileHistorySelecting, false);
  assert.equal(state.contextFileHistorySelectionToken, 1);
});

test('closing a dirty tab retains its draft and selection when recovery admission rejects it', () => {
  const { state, notices } = fixture(), preview = state.contextFilePreview;
  state.contextFileDrafts = { current: 'unsaved text exceeding recovery capacity' };
  state.contextFileDirty = true;
  const admissions = [];
  state.preserveContextFileTabRecovery = tab => { admissions.push(tab); return false; };
  state.closeContextFileTab(preview.uri);
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0].drafts.current, 'unsaved text exceeding recovery capacity');
  assert.equal(state.contextFilePreview, preview);
  assert.equal(state.contextFileDirty, true);
  assert.equal(state.contextFileTabs.size, 1);
  assert.equal(state.contextFileTabs.get(preview.uri).drafts.current, 'unsaved text exceeding recovery capacity');
  assert.equal(notices.length, 1);
});

test('Close All retains every tab if any dirty recovery is rejected', () => {
  const { state, notices } = fixture(), preview = state.contextFilePreview;
  state.contextFileDrafts = { current: 'active unsaved draft' }; state.contextFileDirty = true;
  const second = { preview: { ...preview, uri: 'file:///work/second.ts', name: 'second.ts', recoveryKey: 'second-recovery' },
    drafts: { current: 'inactive unsaved draft' }, dirty: true, activeSide: 'current' };
  state.contextFileTabs.set(second.preview.uri, second);
  const admissions = []; let detached = 0, closed = 0;
  state.preserveContextFileTabRecovery = tab => { admissions.push(tab.preview.uri); return tab.preview.uri !== second.preview.uri; };
  state.detachContextEditorRecovery = () => { detached++; return true; };
  state.closeContextFilePreview = () => { closed++; };
  state.closeAllContextFileTabs();
  assert.deepEqual(admissions, [preview.uri, second.preview.uri]);
  assert.equal(state.contextFileTabs.size, 2);
  assert.equal(state.contextFileTabs.get(preview.uri).drafts.current, 'active unsaved draft');
  assert.equal(state.contextFileTabs.get(second.preview.uri).drafts.current, 'inactive unsaved draft');
  assert.equal(state.contextFilePreview, preview);
  assert.equal(detached, 0); assert.equal(closed, 0); assert.equal(notices.length, 1);
});

function loadingFixture(read) {
  const fixtureState = fixture(), { state } = fixtureState;
  state.session = { id: state.activeCodingSessionId, workspacePath: '/work', turns: [] };
  Object.assign(state, {
    codingSessions: [state.session], codingViewRestoreToken: 0, contextFilePreviewLoading: false,
    workContextMode: 'file', workContextOpen: true, workContextWidth: 720, contextFileListWidth: 200,
    workContextMaximumWidth: () => 1000, contextFileListWidth: 218, contextFileListMaximumWidth: () => 400,
    clampPaneSize: (value, min, max) => Math.min(Math.max(value, min), max), constrainPaneSizes() {}, attachmentExtension: () => 'ts',
    editorRecoveryController: () => ({ refresh: async () => undefined, find: () => undefined, state: { entries: [] } })
  });
  Object.assign(state.fileService, { read, resolve: async () => ({ isReadonly: false }), hasCapability: () => false });
  return fixtureState;
}

test('a delayed file read cannot reactivate a closed loading tab or adopt another tab recovery key', async () => {
  const read = deferred(), started = deferred();
  const { state } = loadingFixture(() => { started.resolve(); return read.promise; });
  const preview = state.contextFilePreview;
  state.contextFileDrafts = { current: 'keep dirty A' }; state.contextFileDirty = true; state.rememberContextFileTab();
  const node = { uri: 'file:///work/second.ts', path: '/work/second.ts', name: 'second.ts', directory: false };
  const loading = state.previewContextFile(node); await started.promise;
  assert.equal(state.contextFilePreview.uri, node.uri);
  assert.equal(state.contextFilePreviewLoading, true);
  const requestToken = state.contextFilePreviewRequestToken;
  assert.equal(state.activateContextFileTab(preview.uri), true);
  assert.ok(state.contextFilePreviewRequestToken > requestToken);
  state.closeContextFileTab(node.uri);
  read.resolve({ value: 'late B content', mtime: 5, etag: 'v5' }); await loading;
  assert.equal(state.contextFilePreview, preview);
  assert.equal(state.contextFilePreview.recoveryKey, 'recovery');
  assert.deepEqual([...state.contextFileTabs.keys()], [preview.uri]);
  assert.deepEqual(state.contextFileDrafts, { current: 'keep dirty A' });
  assert.equal(state.contextFileDirty, true);
});

test('switching away from a loading file then reopening it starts a fresh read instead of activating a blank tab', async () => {
  const reads = [deferred(), deferred()], started = [deferred(), deferred()]; let readCount = 0;
  const { state } = loadingFixture(() => { const index = readCount++; started[index].resolve(); return reads[index].promise; });
  const firstPreview = state.contextFilePreview;
  const node = { uri: 'file:///work/second.ts', path: '/work/second.ts', name: 'second.ts', directory: false };
  const first = state.previewContextFile(node); await started[0].promise;
  const firstRecoveryKey = state.contextFilePreview.recoveryKey;
  state.activateContextFileTab(firstPreview.uri);
  assert.equal(state.contextFileTabs.has(node.uri), false);
  const second = state.previewContextFile(node); await started[1].promise;
  const freshRecoveryKey = state.contextFilePreview.recoveryKey;
  assert.notEqual(freshRecoveryKey, firstRecoveryKey);
  assert.notEqual(freshRecoveryKey, firstPreview.recoveryKey);
  reads[0].resolve({ value: 'stale first read', mtime: 5, etag: 'v5' }); await first;
  assert.equal(state.contextFilePreviewLoading, true);
  assert.equal(state.contextFilePreview.content, '');
  assert.equal(state.contextFilePreview.recoveryKey, freshRecoveryKey);
  reads[1].resolve({ value: 'fresh second read', mtime: 6, etag: 'v6' }); await second;
  assert.equal(readCount, 2);
  assert.equal(state.contextFilePreviewLoading, false);
  assert.equal(state.contextFilePreview.content, 'fresh second read');
  assert.equal(state.contextFilePreview.recoveryKey, freshRecoveryKey);
  assert.equal(state.contextFileTabs.get(node.uri).preview.content, 'fresh second read');
  assert.equal(state.contextFileTabs.get(firstPreview.uri).preview.recoveryKey, firstPreview.recoveryKey);
});


test('dirty drafts and changes made outside NextMux block restoration without losing content', async () => {
  for (const dirty of [true, false]) {
    const { state, writes } = fixture();
    state.contextFileDirty = dirty;
    state.contextFileDrafts = { current: dirty ? 'unsaved local edit' : 'current' };
    state.contextFilePreview.baselineSha256 = 'old-disk-hash';
    const before = JSON.stringify(state.contextFileDrafts);
    await state.selectContextFileHistory({ uri: state.contextFilePreview.uri, checkpointId: 'old', workspaceRoot: '/work', side: 'before' });
    assert.deepEqual(writes, []);
    assert.equal(JSON.stringify(state.contextFileDrafts), before);
    assert.equal(state.contextFileHistoryError, dirty ? 'historyDirty' : 'conflict');
  }
});

test('large binary versions restore through metadata and never load their content into the renderer', async () => {
  const { state, writes, records } = fixture();
  state.contextFilePreview.error = 'binary file cannot be previewed';
  state.platformService.getAgentFileState = async () => ({ path: '/work/main.ts', sha256: 'disk-hash', size: 257 * 1024 * 1024, exists: true, mode: 420 });
  state.previewContextFile = async () => { throw new Error('large file must not be eagerly read'); };
  await state.selectContextFileHistory({ uri: state.contextFilePreview.uri, checkpointId: 'binary-version', workspaceRoot: '/work', side: 'after' });
  assert.equal(writes.length, 1);
  assert.equal(records[0].checkpointId, 'restored-1');
  assert.equal(state.contextFilePreview.content, '');
  assert.equal(state.contextFilePreview.error, 'historyRestoredNoPreview');
  assert.equal(state.contextFilePreview.baselineSha256, 'disk-hash');
});

test('failed CAS leaves the editor and conversation untouched', async () => {
  const { state, records } = fixture();
  const preview = state.contextFilePreview;
  const drafts = state.contextFileDrafts;
  state.platformService.restoreAgentFileVersion = async () => { throw new Error('FILE_CHANGED'); };
  await state.selectContextFileHistory({ uri: preview.uri, checkpointId: 'old', workspaceRoot: '/work', side: 'before' });
  assert.equal(state.contextFilePreview, preview);
  assert.equal(state.contextFileDrafts, drafts);
  assert.deepEqual(records, []);
  assert.equal(state.contextFileHistoryError, 'FILE_CHANGED');
});

test('a completed restore never replaces newer input or reopens a different selected file', async () => {
  const { state, records } = fixture(), pending = deferred();
  state.platformService.restoreAgentFileVersion = () => pending.promise;
  const choosing = state.selectContextFileHistory({ uri: state.contextFilePreview.uri, checkpointId: 'old', workspaceRoot: '/work', side: 'before' });
  await Promise.resolve();
  state.contextFileDrafts = { current: 'newer input' };
  state.contextFileDirty = true;
  pending.resolve({ checkpointId: 'completed', path: '/work/main.ts', sha256: 'new-disk' });
  await choosing;
  assert.deepEqual(state.contextFileDrafts, { current: 'newer input' });
  assert.equal(state.contextFileDirty, true);
  assert.equal(records[0].checkpointId, 'completed');
});

test('message restoration events and symlink-normalized paths remain visible in the same history', async () => {
  const { state } = fixture();
  state.platformService.listAgentFileVersions = async () => ({ versions: [version('message-restore', '2026-09-11T03:00:00Z', '/work', '/canonical/main.ts', 'message_restore')] });
  await state.loadContextFileHistory();
  assert.equal(state.contextFileHistory[1].kind, 'restored');
  assert.equal(state.contextFileHistory[1].checkpointId, 'message-restore');
});


test('legacy text history is migrated through the same CAS service as a restoration event', async () => {
  const { state, writes } = fixture();
  const original = state.contextFilePreview;
  state.previewContextFile = async () => { state.contextFilePreview = { ...original }; };
  state.platformService.readFileHistory = async () => ({ content: 'legacy text' });
  await state.selectContextFileHistory({ uri: original.uri, historyId: 'legacy', kind: 'restored' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedSha256, 'disk-hash');
  assert.equal(writes[0].content, 'legacy text');
  assert.equal(writes[0].operation, 'timeline_restore');
});
