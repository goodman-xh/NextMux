import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { AgentToolRegistry, WorkspaceToolRuntime } from '@nextmux/agent-runtime';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const bundled = desktopRequire('esbuild').buildSync({ entryPoints: [new URL('../src/browser/nextmux-conversation-branch.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const mod = { exports: {} };
Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, mod, mod.exports);
const URI = require('@theia/core/lib/common/uri').default;
const { FileUri } = require('@theia/core/lib/common/file-uri');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['restoreCheckpoint', 'restoreAllChanges', 'recordCommittedRestores', 'recordContextFileVersion',
  'refreshRestoredContextFiles', 'rememberContextFileTab', 'createWorkspaceRestorePlan', 'selectContextFileHistory'].map(name => widget.members
  .find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const code = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const locale = (_locale, key) => key;
const bindings = { ...mod.exports, URI, changeFileGroupKey: require('../lib/browser/nextmux-change-grouping.js').changeFileGroupKey,
  FILE_DRAWER_TEXT_MAX_BYTES: require('../lib/browser/nextmux-file-preview.js').FILE_DRAWER_TEXT_MAX_BYTES,
  desktopFailureMessage: (_locale, error) => error.message,
  localizeDesktopSurface: locale, fileDrawerText: locale, filePreviewErrorText: locale, editorRecoveryText: locale,
  normalizeAgentRunVerification: value => value };
const Harness = Function(...Object.keys(bindings), `${code}; return Harness;`)(...Object.values(bindings));

async function fixture(t, count = 1) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-restored-editor-')));
  const conversationId = randomUUID(), roots = [], runtimes = new Map(), changes = [];
  for (let index = 0; index < count; index++) {
    const root = join(base, `root-${index}`), file = join(root, 'baseline.txt');
    await mkdir(root); await writeFile(file, 'before'); roots.push(root);
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, `versions-${index}`), permissionMode: 'full_access' });
    runtimes.set(root, runtime);
    const state = await runtime.getFileState({ path: 'baseline.txt' });
    const saved = await runtime.saveFileVersion({ path: 'baseline.txt', content: 'branch-two', expectedSha256: state.sha256, conversationId });
    changes.push({ ...await runtime.getCheckpointDiff(saved.checkpointId), workspaceRoot: root });
  }
  t.after(async () => { await Promise.all([...runtimes.values()].map(runtime => runtime.dispose())); await rm(base, { recursive: true, force: true }); });
  const host = new Harness(), notices = [], recoveries = [], history = [];
  const session = { id: conversationId, workspacePath: roots[0], turns: [{ id: 'turn', prompt: 'edit', response: 'done', stage: 'complete', changes }] };
  Object.assign(host, { activeCodingSessionId: conversationId, activeWorkspaceRoot: roots[0], codingSessions: [session], desktopLocale: 'en',
    activeCodingSession: () => host.codingSessions.find(session => session.id === host.activeCodingSessionId),
    codingSessionWorkspaceRoot: () => roots[0], codingSessionStoredWorkspaceRoots: () => roots,
    conversationMutations: { tryAcquire: () => () => {} }, contextFileTabs: new Map(), contextFileSavingUris: new Set(),
    contextFileDirty: false, contextFileDrafts: {}, contextFileSaveStatus: 'idle', contextFileActiveSide: 'current',
    contextFileHistoryOpen: true, contextFileHistorySelectionToken: 0, contextFileHistorySelecting: false,
    update() {}, persistActiveCodingSessionState() {}, async loadContextFiles() {}, markCheckpointRestored() {}, unmarkCheckpointRestored() {},
    captureContextEditorRecovery(refresh) { recoveries.push([host.contextFilePreview.uri, refresh]); },
    preserveContextFileTabRecovery(tab, refresh) { recoveries.push([tab.preview.uri, refresh]); return true; },
    addNotification(...args) { notices.push(args); },
    updateCodingTurn(_sessionId, turnId, patch) { Object.assign(session.turns.find(turn => turn.id === turnId), patch); },
    async loadContextFileHistory() { history.push(host.contextFilePreview?.uri); },
    fileService: { async read(uri) {
      const path = FileUri.fsPath(uri), value = await readFile(path, 'utf8'), info = await stat(path);
      return { value, mtime: info.mtimeMs, etag: String(info.mtimeMs) };
    } },
    platformService: {
      getAgentCheckpointDiff: (root, id) => runtimes.get(root).getCheckpointDiff(id),
      getAgentFileState: request => runtimes.get(request.workspaceRoot).getFileState(request),
      restoreAgentCheckpointGroups: async groups => {
        const summaries = await WorkspaceToolRuntime.restoreCheckpointGroups(groups.map(group => ({ ...group, runtime: runtimes.get(group.workspaceRoot) })), { recordVersions: true, conversationId });
        return { restored: true, checkpointIds: summaries.map(item => item.checkpointId), versions: summaries.map(item => item.restoration).filter(Boolean) };
      },
      restoreAgentFileVersion: request => runtimes.get(request.workspaceRoot).restoreFileVersion(request)
    }
  });
  const open = async (index, active = true) => {
    const path = join(roots[index], 'baseline.txt'), uri = URI.fromFilePath(path).toString();
    const disk = await runtimes.get(roots[index]).getFileState({ path: 'baseline.txt' });
    const preview = { uri, path, name: 'baseline.txt', content: await readFile(path, 'utf8'), baselineSha256: disk.sha256,
      kind: 'text', error: '', truncated: false, revision: 1 };
    const tab = { preview, drafts: { current: preview.content }, dirty: false, activeSide: 'current' };
    host.contextFileTabs.set(uri, tab);
    if (active) { host.contextFilePreview = preview; host.contextFileDrafts = tab.drafts; }
    return tab;
  };
  // The actual timeline method reopens the file after committing. Only the
  // unrelated editor loader is adapted to the same real temporary filesystem.
  host.previewContextFile = async node => { await open(roots.findIndex(root => node.path.startsWith(`${root}/`))); };
  return { host, session, roots, runtimes, changes, open, notices, recoveries, history };
}

test('real tool restore refreshes the clean editor, then timeline forward and backward retain CAS and messages', async t => {
  const f = await fixture(t), tab = await f.open(0), originalHash = tab.preview.baselineSha256;
  const transcript = f.session.turns.map(({ id, prompt, response }) => ({ id, prompt, response }));
  await f.host.restoreCheckpoint(f.changes[0].checkpointId);
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'before');
  assert.equal(f.host.contextFilePreview.content, 'before');
  assert.equal(f.host.contextFilePreview.sourceRevision, 1, 'the editor must receive an explicit disk refresh, not a save acknowledgement');
  assert.notEqual(f.host.contextFilePreview.baselineSha256, originalHash);
  assert.deepEqual(f.host.contextFileDrafts, { current: 'before' });
  assert.equal(f.host.contextFileTabs.get(tab.preview.uri).preview, f.host.contextFilePreview);
  assert.equal(f.history.length, 1);
  const entry = { uri: tab.preview.uri, checkpointId: f.changes[0].checkpointId, workspaceRoot: f.roots[0], conversationId: f.session.id };
  await f.host.selectContextFileHistory({ ...entry, side: 'after' });
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'branch-two');
  await f.host.selectContextFileHistory({ ...entry, side: 'before' });
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'before');
  assert.equal(f.host.contextFileHistoryError, '');
  assert.deepEqual(f.session.turns.map(({ id, prompt, response }) => ({ id, prompt, response })), transcript);
  assert.deepEqual(f.notices, []);
});

test('a multi-edit file toggles original and final bytes while retaining all immutable history versions', async t => {
  const f = await fixture(t), runtime = f.runtimes.get(f.roots[0]);
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  const ids = [];
  for (const content of ['edit one\n', 'edit two\n']) {
    const before = await runtime.getFileState({ path: 'baseline.txt' });
    const result = await registry.execute({ id: randomUUID(), name: 'workspace.write_file',
      arguments: { path: 'baseline.txt', content, expectedSha256: before.sha256 } }, 'full_access', { runId: randomUUID() });
    assert.equal(result.ok, true);
    ids.push(result.summary.checkpointId);
  }
  f.session.turns[0].changes = await Promise.all(ids.map(async id => ({ ...await runtime.getCheckpointDiff(id), workspaceRoot: f.roots[0] })));
  const originalChanges = JSON.stringify(f.session.turns[0].changes);
  const tab = await f.open(0), marks = new Set();
  f.host.markCheckpointRestored = id => marks.add(id);
  f.host.unmarkCheckpointRestored = id => marks.delete(id);
  await f.host.restoreCheckpoint(ids[0]);
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'branch-two');
  assert.equal(f.host.contextFilePreview.content, 'branch-two');
  assert.equal(marks.has(ids[0]), true);
  await f.host.restoreCheckpoint(ids[0], true);
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'edit two\n');
  assert.equal(f.host.contextFilePreview.content, 'edit two\n');
  assert.equal(marks.size, 0);
  assert.equal(JSON.stringify(f.session.turns[0].changes), originalChanges, 'restore receipts never become new edits in the review chain');
  assert.ok(f.session.turns[0].fileVersionReceipts.length >= 3);
  for (const id of ids) assert.equal((await runtime.getCheckpointDiff(id)).checkpointId, id);
  assert.deepEqual(f.notices, []);
});

test('group restore refreshes only affected clean tabs across roots without changing the selected tab', async t => {
  const f = await fixture(t, 2), a = await f.open(0), b = await f.open(1, false);
  const unrelated = { preview: { ...a.preview, uri: 'file:///unrelated.txt', path: '/unrelated.txt', content: 'keep' }, drafts: { current: 'keep' }, dirty: false };
  f.host.contextFileTabs.set(unrelated.preview.uri, unrelated);
  await f.host.restoreAllChanges(f.changes);
  assert.equal(f.host.contextFilePreview.uri, a.preview.uri);
  for (const tab of [a, b]) {
    assert.equal(f.host.contextFileTabs.get(tab.preview.uri).preview.content, 'before');
    assert.equal(await readFile(tab.preview.path, 'utf8'), 'before');
  }
  assert.equal(f.host.contextFileTabs.get(unrelated.preview.uri), unrelated);
  assert.equal(f.recoveries.length, 2);
  assert.deepEqual(f.notices, []);
});

test('dirty drafts and pending saves retain their original baselines after a real restore', async t => {
  for (const pending of [false, true]) {
    const f = await fixture(t), tab = await f.open(0);
    if (pending) f.host.pendingFileSave = { uri: tab.preview.uri, content: 'pending' };
    else { f.host.contextFileDirty = true; f.host.contextFileDrafts = { current: 'user draft' }; }
    await f.host.restoreCheckpoint(f.changes[0].checkpointId);
    assert.equal(await readFile(tab.preview.path, 'utf8'), 'before');
    assert.equal(f.host.contextFilePreview, tab.preview);
    assert.equal(f.host.contextFilePreview.baselineSha256, tab.preview.baselineSha256);
    assert.equal(f.host.contextFileDrafts.current, pending ? 'branch-two' : 'user draft');
    assert.deepEqual(f.recoveries, []);
  }
});

test('navigation or new typing during a refresh cannot replace another view or a fresh draft', async t => {
  for (const navigate of [false, true]) {
    const f = await fixture(t), tab = await f.open(0), read = f.host.fileService.read;
    f.host.fileService.read = async uri => {
      const value = await read(uri);
      if (navigate) { f.host.activeCodingSessionId = 'other'; f.host.contextFilePreview = { uri: 'file:///other.txt', content: 'other' }; }
      else { f.host.contextFileDirty = true; f.host.contextFileDrafts = { current: 'fresh draft' }; }
      return value;
    };
    await f.host.restoreCheckpoint(f.changes[0].checkpointId);
    assert.equal(f.host.contextFilePreview.content, navigate ? 'other' : 'branch-two');
    if (!navigate) assert.equal(f.host.contextFileDrafts.current, 'fresh draft');
    assert.equal(f.host.contextFileTabs.get(tab.preview.uri).preview, tab.preview);
    assert.deepEqual(f.recoveries, []);
  }
});

test('an external write during refresh never blesses stale editor bytes with the new disk hash', async t => {
  const f = await fixture(t), tab = await f.open(0), read = f.host.fileService.read;
  f.host.fileService.read = async uri => {
    const value = await read(uri); await writeFile(uri.path.fsPath(), 'external'); return value;
  };
  await f.host.restoreCheckpoint(f.changes[0].checkpointId);
  assert.equal(f.host.contextFilePreview, tab.preview);
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'external');
  assert.equal(f.notices.length, 1);
  await f.host.selectContextFileHistory({ uri: tab.preview.uri, checkpointId: f.changes[0].checkpointId, workspaceRoot: f.roots[0], side: 'after' });
  assert.equal(f.host.contextFileHistoryError, 'conflict');
  assert.equal(await readFile(tab.preview.path, 'utf8'), 'external');
});

test('POSIX literal backslashes do not refresh a different nested path', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), runtime = f.runtimes.get(f.roots[0]);
  const literal = join(f.roots[0], 'a\\b.txt'), nested = join(f.roots[0], 'a', 'b.txt');
  await mkdir(join(f.roots[0], 'a')); await writeFile(literal, 'literal before'); await writeFile(nested, 'nested keep');
  const initial = await runtime.getFileState({ path: 'a\\b.txt' });
  const edited = await runtime.saveFileVersion({ path: 'a\\b.txt', content: 'literal after', expectedSha256: initial.sha256, conversationId: f.session.id });
  const change = { ...await runtime.getCheckpointDiff(edited.checkpointId), workspaceRoot: f.roots[0] };
  f.session.turns[0].changes.push(change);
  const tabs = [];
  for (const path of [literal, nested]) {
    const disk = await runtime.getFileState({ path: path === literal ? 'a\\b.txt' : 'a/b.txt' });
    const preview = { path, uri: FileUri.create(path).toString(), name: 'b.txt', content: await readFile(path, 'utf8'), baselineSha256: disk.sha256, revision: 1 };
    const tab = { preview, drafts: { current: preview.content }, dirty: false, activeSide: 'current' };
    f.host.contextFileTabs.set(preview.uri, tab); tabs.push(tab);
  }
  f.host.contextFilePreview = tabs[0].preview; f.host.contextFileDrafts = tabs[0].drafts;
  await f.host.restoreCheckpoint(edited.checkpointId);
  assert.equal(await readFile(literal, 'utf8'), 'literal before');
  assert.equal(f.host.contextFilePreview.content, 'literal before');
  assert.equal(f.host.contextFileTabs.get(tabs[1].preview.uri), tabs[1]);
  assert.equal(await readFile(nested, 'utf8'), 'nested keep');
  assert.deepEqual(f.notices, []);
});

test('a clean historical comparison keeps its immutable side and selection during restore refresh', async t => {
  const f = await fixture(t), tab = await f.open(0);
  const preview = { ...tab.preview, beforeContent: 'immutable historical text', checkpointId: f.changes[0].checkpointId, readOnly: true };
  f.host.contextFilePreview = preview;
  f.host.contextFileDrafts = { current: preview.content, before: preview.beforeContent };
  f.host.contextFileActiveSide = 'before';
  await f.host.restoreCheckpoint(f.changes[0].checkpointId);
  assert.equal(f.host.contextFilePreview.content, 'before');
  assert.equal(f.host.contextFilePreview.beforeContent, 'immutable historical text');
  assert.equal(f.host.contextFilePreview.checkpointId, f.changes[0].checkpointId);
  assert.equal(f.host.contextFilePreview.readOnly, true);
  assert.equal(f.host.contextFileActiveSide, 'before');
  assert.equal(f.host.contextFileDrafts.before, 'immutable historical text');
});

test('automatic restore refresh does not read an oversized file into the editor', async t => {
  const f = await fixture(t), runtime = f.runtimes.get(f.roots[0]), path = join(f.roots[0], 'baseline.txt');
  const initial = await runtime.getFileState({ path: 'baseline.txt' });
  const large = await runtime.saveFileVersion({ path: 'baseline.txt', content: 'x'.repeat(8 * 1024 * 1024 + 1), expectedSha256: initial.sha256, conversationId: f.session.id });
  const largeState = await runtime.getFileState({ path: 'baseline.txt' });
  const small = await runtime.saveFileVersion({ path: 'baseline.txt', content: 'small', expectedSha256: largeState.sha256, conversationId: f.session.id });
  f.session.turns[0].changes.push({ ...await runtime.getCheckpointDiff(large.checkpointId), workspaceRoot: f.roots[0] },
    { ...await runtime.getCheckpointDiff(small.checkpointId), workspaceRoot: f.roots[0] });
  await f.open(0);
  f.host.fileService.read = async () => { assert.fail('automatic refresh must not read the large content'); };
  await f.host.restoreCheckpoint(small.checkpointId);
  assert.equal((await stat(path)).size, 8 * 1024 * 1024 + 1);
  assert.equal(f.host.contextFilePreview.content, '');
  assert.equal(f.host.contextFilePreview.error, 'historyRestoredNoPreview');
  assert.equal(f.host.contextFilePreview.baselineSha256, largeState.sha256);
  assert.deepEqual(f.notices, []);
});
