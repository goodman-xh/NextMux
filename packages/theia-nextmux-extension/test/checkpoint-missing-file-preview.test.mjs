import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { WorkspaceToolRuntime } from '@nextmux/agent-runtime';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const branchModule = { exports: {} };
const branchBundle = desktopRequire('esbuild').buildSync({ entryPoints: [new URL('../src/browser/nextmux-conversation-branch.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
Function('require', 'module', 'exports', branchBundle.outputFiles[0].text)(require, branchModule, branchModule.exports);
const branchHelpers = branchModule.exports;
const URI = require('@theia/core/lib/common/uri').default;
const { FileUri } = require('@theia/core/lib/common/file-uri');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['beginContextFileOpen', 'finishContextFileOpen', 'openCheckpointDiffById', 'selectContextFileHistory', 'recordContextFileVersion', 'createWorkspaceRestorePlan'].map(name => widget.members
  .find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
const js = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const bindings = { ...branchHelpers, ...require('../lib/browser/nextmux-conversation-file-target.js'), filePreviewErrorText: (_locale, key) => key, URI, FileUri,
  FILE_DRAWER_TEXT_MAX_BYTES: require('../lib/browser/nextmux-file-preview.js').FILE_DRAWER_TEXT_MAX_BYTES,
  editorRecoveryText: (_locale, key) => key, fileDrawerText: (_locale, key) => key,
  conversationText: (_locale, key) => key, normalizeAgentRunVerification: value => value };
const Harness = Function(...Object.keys(bindings), `${js}; return Harness;`)(...Object.values(bindings));

async function waitForRpcStart(started) {
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Expected checkpoint RPC did not start within 5 seconds')), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t, removeWorkingCopy = true) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-history-preview-')));
  const root = join(base, 'project'), checkpoints = join(base, 'checkpoints'), file = join(root, 'source.txt');
  await mkdir(root); await writeFile(file, 'original');
  const conversationId = randomUUID();
  let runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: checkpoints, permissionMode: 'full_access' });
  const initial = await runtime.getFileState({ path: 'source.txt' });
  const saved = await runtime.saveFileVersion({ path: 'source.txt', expectedSha256: initial.sha256, content: 'saved historical version', conversationId });
  await runtime.dispose();
  if (removeWorkingCopy) { await rm(root, { recursive: true }); await mkdir(root); }
  runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: checkpoints, permissionMode: 'full_access' });
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  const host = new Harness(), restores = [], records = [];
  const session = { id: conversationId, workspacePath: root, turns: [] };
  Object.assign(host, {
    activeCodingSessionId: conversationId, activeWorkspaceRoot: root, desktopLocale: 'en', codingSessions: [session],
    activeCodingSession: () => session, codingSessionWorkspaceRoot: () => root, codingSessionStoredWorkspaceRoots: () => [root],
    rememberNavigation() {}, update() {}, async loadContextFiles() {}, rememberContextFileTab() {}, persistActiveCodingSessionState() {},
    contextFilePreviewRequestToken: 0, detachContextEditorRecovery: () => true, markCheckpointRestored() {}, unmarkCheckpointRestored() {},
    contextFileHistoryOpen: false, contextFileHistorySelectionToken: 0, contextFileHistorySelecting: false,
    contextFileDrafts: {}, contextFileDirty: false, contextFileSaveStatus: 'idle', contextFileSavingUris: new Set(), contextFileTabs: new Map(),
    async loadContextFileHistory() { this.history = await runtime.listFileVersions({ checkpointId: saved.checkpointId }); },
    async recordContextFileVersion(...args) { records.push(args); },
    async previewContextFile(node) {
      this.contextFileOpening = undefined; this.contextFilePreviewLoading = false;
      this.contextFilePreview = { ...node, content: '', error: '', revision: 0 };
      this.contextFileDrafts = {};
      try { this.contextFilePreview.content = await readFile(file, 'utf8'); }
      catch (error) { this.contextFilePreview.error = error.message; }
    },
    fileService: { async read(uri) {
      const path = FileUri.fsPath(uri), value = await readFile(path, 'utf8'), info = await stat(path);
      return { value, mtime: info.mtimeMs, etag: String(info.mtimeMs) };
    } },
    platformService: {
      getAgentCheckpointDiff: (_root, id) => runtime.getCheckpointDiff(id, true),
      getAgentFileState: request => runtime.getFileState(request),
      restoreAgentFileVersion: async request => { restores.push(request); return runtime.restoreFileVersion(request); }
    }
  });
  const entry = { id: 'historical-after', uri: URI.fromFilePath(file).toString(), workspaceRoot: root,
    conversationId, checkpointId: saved.checkpointId, side: 'after' };
  return { host, file, root, runtime, checkpointId: saved.checkpointId, entry, restores, records, conversationId, session };
}

function retainActualVersionReceipts(f) {
  f.host.codingSessions = [f.session];
  f.host.recordContextFileVersion = Harness.prototype.recordContextFileVersion;
  f.host.updateCodingTurn = (sessionId, turnId, patch) => {
    assert.equal(sessionId, f.conversationId);
    const turn = f.session.turns.find(turn => turn.id === turnId);
    assert.ok(turn, 'a committed version must stay on its captured owner'); Object.assign(turn, patch);
  };
}

test('actual timeline backwards and forwards append owned receipts without changing messages or prompt-start baselines', async t => {
  const f = await fixture(t, false);
  const earlier = { id: 'earlier', prompt: 'first', response: 'first answer', changes: [await f.runtime.getCheckpointDiff(f.checkpointId)] };
  const current = { id: 'current', prompt: 'chat without any code edit', response: 'answer', changes: [], workspaceBaselines: [] };
  f.session.turns = [earlier, current]; retainActualVersionReceipts(f);
  const transcript = f.session.turns.map(({ id, prompt, response }) => ({ id, prompt, response }));
  await f.host.openCheckpointDiffById(f.checkpointId);
  await f.host.selectContextFileHistory({ ...f.entry, side: 'before' });
  assert.equal(await readFile(f.file, 'utf8'), 'original');
  assert.equal(current.fileVersionReceipts?.length, 1, 'a timeline-only modified file must participate in later message rollback');
  assert.equal(f.restores[0].turnId, current.id);
  await f.host.selectContextFileHistory(f.entry);
  assert.equal(await readFile(f.file, 'utf8'), 'saved historical version', 'latest explicitly selected version wins');
  assert.equal(current.fileVersionReceipts.length, 2);
  assert.deepEqual(current.changes, [], 'timeline audit is not an executed AI edit');
  assert.deepEqual(current.workspaceBaselines, [], 'timeline audit is not a prompt-start baseline');
  assert.deepEqual(f.session.turns.map(({ id, prompt, response }) => ({ id, prompt, response })), transcript);
  const ids = branchHelpers.conversationCheckpointIdsToRestore(f.session.turns, current.id);
  const plan = await f.host.createWorkspaceRestorePlan(f.session, ids, current.id);
  assert.deepEqual(plan[0].targets, [{ checkpointId: current.fileVersionReceipts[0].checkpointId, side: 'before' }]);
  await WorkspaceToolRuntime.restoreCheckpointGroups(plan.map(group => ({ ...group, runtime: f.runtime })), { recordVersions: true });
  assert.equal(await readFile(f.file, 'utf8'), 'saved historical version');
});

test('a timeline RPC finishing after a new turn appears keeps its audit on the original turn', async t => {
  const f = await fixture(t, false), original = { id: 'original', changes: [] };
  f.session.turns = [original]; retainActualVersionReceipts(f);
  await f.host.openCheckpointDiffById(f.checkpointId);
  assert.equal(f.host.checkpointDiffError, '', 'the real file URI dependency must allow the preview to open');
  assert.equal(f.host.contextFilePreview?.error, '');
  let finish, reached;
  const began = new Promise(resolve => { reached = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  f.host.platformService.restoreAgentFileVersion = async request => {
    f.restores.push(request); const result = await f.runtime.restoreFileVersion(request);
    reached(); await pending; return result;
  };
  const selecting = f.host.selectContextFileHistory({ ...f.entry, side: 'before' });
  await waitForRpcStart(began);
  const next = { id: 'next', changes: [] }; f.session.turns.push(next);
  finish(); await selecting;
  assert.equal(original.fileVersionReceipts?.length, 1);
  assert.equal(next.fileVersionReceipts, undefined);
  assert.equal(f.restores[0].turnId, original.id);
  assert.equal(f.session.turns.length, 2);
});

test('missing file shows historical target versus absent current bytes without writing; explicit timeline restore then creates the file', async t => {
  const f = await fixture(t);
  await f.host.openCheckpointDiffById(f.checkpointId);
  assert.equal(f.host.contextFilePreview.error, '');
  assert.equal(f.host.contextFilePreview.historicalMissing, true);
  assert.equal(f.host.contextFilePreview.beforeContent, 'saved historical version');
  assert.equal(f.host.contextFilePreview.content, '');
  assert.equal(f.host.contextFilePreview.baselineSha256, null);
  assert.equal(f.host.contextFileDirty, false);
  assert.equal(f.host.contextFileHistoryOpen, true);
  assert.ok(f.host.history.versions.some(version => version.checkpointId === f.checkpointId));
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.deepEqual(f.restores, []);
  await f.host.selectContextFileHistory(f.entry);
  assert.equal(f.restores.length, 1);
  assert.equal(f.restores[0].expectedSha256, null);
  assert.equal(await readFile(f.file, 'utf8'), 'saved historical version');
  assert.equal(f.host.contextFilePreview.historicalMissing, undefined);
  assert.equal(f.records.length, 1);
});

test('a file recreated after the missing-file preview is not overwritten by a stale selection', async t => {
  const f = await fixture(t);
  await f.host.openCheckpointDiffById(f.checkpointId);
  await writeFile(f.file, 'external new file');
  await f.host.selectContextFileHistory(f.entry);
  assert.equal(f.host.contextFileHistoryError, 'conflict');
  assert.deepEqual(f.restores, []);
  assert.equal(await readFile(f.file, 'utf8'), 'external new file');
});

test('read permissions and I/O errors are not represented as an empty current file', async t => {
  const f = await fixture(t);
  f.host.platformService.getAgentFileState = async () => { throw Object.assign(new Error('EACCES: project/source.txt'), { code: 'EACCES' }); };
  await f.host.openCheckpointDiffById(f.checkpointId);
  assert.match(f.host.checkpointDiffError, /EACCES/);
  assert.equal(f.host.contextFilePreview.historicalMissing, undefined);
  assert.notEqual(f.host.contextFilePreview.error, '');
  assert.equal(f.host.contextFileHistoryOpen, false);
  assert.deepEqual(f.restores, []);
});

test('existing files keep the usual before/current comparison', async t => {
  const f = await fixture(t, false);
  await f.host.openCheckpointDiffById(f.checkpointId);
  assert.equal(f.host.contextFilePreview.content, 'saved historical version');
  assert.equal(f.host.contextFilePreview.beforeContent, 'original');
  assert.equal(f.host.contextFilePreview.historicalMissing, undefined);
  assert.equal(f.host.contextFileHistoryOpen, false);
});

test('switching conversations while checking a missing file does not attach the old historical preview', async t => {
  const f = await fixture(t);
  let finish, began;
  const waiting = new Promise(resolve => { began = resolve; });
  f.host.platformService.getAgentFileState = () => { began(); return new Promise(resolve => { finish = resolve; }); };
  const opening = f.host.openCheckpointDiffById(f.checkpointId);
  await waitForRpcStart(waiting);
  assert.equal(f.host.checkpointDiffError, '');
  assert.ok(f.host.contextFilePreview, 'the missing working copy preview must exist before its state RPC');
  f.host.activeCodingSessionId = randomUUID();
  const newPreview = { uri: 'file:///other/file.txt', content: 'other conversation', error: '' };
  f.host.contextFilePreview = newPreview;
  finish({ exists: false, sha256: null, size: 0 });
  await opening;
  assert.equal(f.host.contextFilePreview, newPreview);
  assert.equal(f.host.contextFileHistoryOpen, false);
  assert.deepEqual(f.restores, []);
});
