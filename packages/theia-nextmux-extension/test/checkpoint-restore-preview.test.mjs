import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../../agent-runtime/lib/index.js';
import { conversationCheckpointIdsToRestore, conversationHistoryStateToken } from '../lib/browser/nextmux-conversation-branch.js';
import { conversationText } from '../lib/browser/nextmux-conversation-locale.js';

const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
function extract(sourcePath, className, names, dependencies = {}) {
  const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  const ast = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const methods = names.map(name => cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
  const js = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  return Function(...Object.keys(dependencies), `${js}; return Harness;`)(...Object.values(dependencies));
}
const Harness = extract('../src/browser/nextmux-desktop-widget.tsx', 'NextMuxDesktopWidget', [
  'codingSessionStoredWorkspaceRoots', 'createWorkspaceRestorePlan', 'setTurnEditRestoreWorkspace', 'renderCodingSessionDialogs'
], { React, conversationCheckpointIdsToRestore, conversationHistoryStateToken, conversationText,
  ...require('../lib/browser/nextmux-checkpoint-warning-locale.js'),
  codingSidebarProjects: () => [], localizeDesktopSurface: (_locale, value) => value });
const Service = extract('../src/node/nextmux-platform-service.ts', 'NextMuxPlatformServiceImpl', ['getAgentCheckpointDiff'], { WorkspaceToolRuntime });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nm-widget-restore-preview-')), roots = [], runtimes = [], stores = new Map();
  for (const name of ['a', 'b']) {
    await mkdir(join(directory, name)); const root = await realpath(join(directory, name)); roots.push(root);
    const checkpointRoot = join(directory, `${name}-store`); stores.set(root, checkpointRoot);
    runtimes.push(await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot, permissionMode: 'full_access' }));
  }
  t.after(async () => { await Promise.all(runtimes.map(runtime => runtime.dispose())); await rm(directory, { recursive: true, force: true }); });
  const service = new Service(); service.validateWorkspaceRootInput = value => assert.ok(stores.has(value));
  service.agentCheckpointRoot = root => stores.get(root);
  service.acquireAgentCheckpointRunLeases = async () => ({ assertOwned() {}, async release() {} });
  const calls = [];
  const host = new Harness(), session = { id: randomUUID(), workspacePath: roots[0],
    workspaceBindings: roots.map(path => ({ path, status: 'available' })), turns: [{ id: 'target', changes: [] }] };
  Object.assign(host, { codingSessions: [session], desktopLocale: 'en', workspaceOptions: [], codingHistoryProjects: [],
    pendingTurnEdit: { sessionId: session.id, turnId: 'target' }, turnEditRestorePreview: { status: 'idle' },
    conversationHistoryReady: () => true, update() {}, platformService: {
      getAgentCheckpointDiff: async (...args) => { calls.push(args); return service.getAgentCheckpointDiff(...args); }
    }
  });
  async function edit(index, before, after, path = 'baseline.txt') {
    await writeFile(join(roots[index], path), before);
    const runtime = runtimes[index], registry = new AgentToolRegistry(); runtime.registerTools(registry);
    const state = await runtime.getFileState({ path });
    const result = await registry.execute({ id: randomUUID(), name: 'workspace.write_file', arguments: { path, content: after,
      expectedSha256: state.sha256 } }, 'full_access', { runId: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return runtime.getCheckpointDiff(result.summary.checkpointId);
  }
  return { host, session, roots, runtimes, edit, calls };
}

test('rollback checkbox follows selected-tail edits and receipts, not workspace bindings or permission', async t => {
  const f = await fixture(t), selected = f.session.turns[0];
  selected.permissionMode = 'full_access';
  selected.events = [{ type: 'tool_result', call: { name: 'workspace.read_file' }, result: { ok: true } }];
  assert.doesNotMatch(renderToStaticMarkup(f.host.renderCodingSessionDialogs()), /nmx-turn-edit-restore/);
  f.session.turns.unshift({ id: 'earlier', changes: [{ checkpointId: 'earlier-edit', workspaceRoot: '/earlier' }] });
  selected.workspaceBaselines = [{ checkpointId: 'prompt-baseline', workspaceRoot: '/earlier' }];
  assert.doesNotMatch(renderToStaticMarkup(f.host.renderCodingSessionDialogs()), /nmx-turn-edit-restore/,
    'earlier edits or an inherited baseline alone are outside the edited tail');
  f.session.turns.push({ id: 'later', changes: [{ checkpointId: 'later-edit', workspaceRoot: f.roots[1] }] });
  assert.match(renderToStaticMarkup(f.host.renderCodingSessionDialogs()), /nmx-turn-edit-restore/,
    'edits after the selected read-only turn still need rollback');
  f.session.turns.pop();
  f.session.workspacePath = ''; f.session.workspaceBindings = [];
  selected.permissionMode = 'read_only';
  selected.fileVersionReceipts = [{ checkpointId: 'branch-timeline-receipt', workspaceRoot: '/external/root' }];
  assert.match(renderToStaticMarkup(f.host.renderCodingSessionDialogs()), /nmx-turn-edit-restore/,
    'durable editor or timeline receipts remain restorable without a currently bound project');
  assert.deepEqual(f.calls, [], 'visibility must not read or mutate any checkpoint');
});

test('message rollback renders one final target diff after two timeline restores', async t => {
  const f = await fixture(t), first = await f.edit(0, 'before\n', 'after-one\nafter-two\n');
  f.session.turns[0].changes.push(first);
  f.session.turns[0].fileVersionReceipts = [];
  for (const side of ['before', 'after']) {
    const result = await f.runtimes[0].restoreFileVersion({ checkpointId: first.checkpointId, side,
      expectedSha256: (await f.runtimes[0].getFileState({ checkpointId: first.checkpointId })).sha256,
      conversationId: f.session.id, turnId: 'target' });
    f.session.turns[0].fileVersionReceipts.push({ checkpointId: result.checkpointId, workspaceRoot: f.roots[0], path: 'baseline.txt' });
  }
  await f.host.setTurnEditRestoreWorkspace(true);
  const preview = f.host.turnEditRestorePreview;
  assert.equal(preview.status, 'ready', preview.message);
  assert.equal(preview.checkpointIds.length, 3);
  assert.equal(preview.restorePlan[0].targets.length, 1);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].additions, 1); assert.equal(preview.changes[0].deletions, 2);
  assert.equal(f.calls.filter(call => call[2] === 'before').length, 1);
  const html = renderToStaticMarkup(f.host.renderCodingSessionDialogs());
  assert.equal((html.match(/<code /g) || []).length, 1); assert.match(html, /<b>\+1<\/b><em>−2<\/em>/);
  assert.equal(await readFile(join(f.roots[0], 'baseline.txt'), 'utf8'), 'after-one\nafter-two\n');
});

test('same basenames in separate roots stay separate and unchanged targets disappear', async t => {
  const f = await fixture(t);
  f.session.turns[0].changes = [await f.edit(0, 'a-before\n', 'a-after\n'), await f.edit(1, 'b-before\n', 'b-after\n')];
  await f.host.setTurnEditRestoreWorkspace(true);
  assert.equal(f.host.turnEditRestorePreview.status, 'ready');
  assert.equal(f.host.turnEditRestorePreview.changes.length, 2);
  let html = renderToStaticMarkup(f.host.renderCodingSessionDialogs());
  assert.ok(html.includes(`title="${f.roots[0]}/baseline.txt"`));
  assert.ok(html.includes(`title="${f.roots[1]}/baseline.txt"`));
  await f.runtimes[0].restoreCheckpoint(f.session.turns[0].changes[0].checkpointId);
  await f.host.setTurnEditRestoreWorkspace(true);
  assert.equal(f.host.turnEditRestorePreview.changes.length, 1);
  assert.equal(f.host.turnEditRestorePreview.changes[0].workspaceRoot, f.roots[1]);
  html = renderToStaticMarkup(f.host.renderCodingSessionDialogs());
  assert.equal((html.match(/<code /g) || []).length, 1);
});

test('the preview follows an after-side prompt baseline instead of a later edit checkpoint', async t => {
  const f = await fixture(t);
  const baseline = await f.edit(0, 'old\n', 'prompt-start\n');
  const changed = await f.edit(0, 'prompt-start\n', 'latest\nsecond\nthird\n');
  f.session.turns[0].workspaceBaselines = [baseline];
  f.session.turns[0].changes = [changed];
  await f.host.setTurnEditRestoreWorkspace(true);
  const preview = f.host.turnEditRestorePreview;
  assert.equal(preview.status, 'ready', preview.message);
  assert.deepEqual(preview.restorePlan[0].targets, [{ checkpointId: baseline.checkpointId, side: 'after' }]);
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].additions, 1); assert.equal(preview.changes[0].deletions, 3);
  assert.deepEqual(f.calls.filter(call => call[2] === 'after'), [[f.roots[0], baseline.checkpointId, 'after']]);
});

test('large recorded targets reach the dialog without downloading full checkpoint contents', async t => {
  const f = await fixture(t), before = Buffer.alloc(700_000, 65), after = Buffer.alloc(700_000, 66);
  await writeFile(join(f.roots[0], 'large.txt'), before);
  const current = await f.runtimes[0].getFileState({ path: 'large.txt' });
  const [id] = await f.runtimes[0].applyReviewedChanges([{ path: 'large.txt', beforeSha256: current.sha256, content: after }],
    { runId: randomUUID(), callId: randomUUID() });
  f.session.turns[0].fileVersionReceipts = [{ checkpointId: id, workspaceRoot: f.roots[0], path: 'large.txt' }];
  await f.host.setTurnEditRestoreWorkspace(true);
  const preview = f.host.turnEditRestorePreview;
  assert.equal(preview.status, 'ready', preview.message);
  assert.equal(preview.changes.length, 1); assert.equal(preview.changes[0].truncated, true);
  assert.equal(preview.restorePlan[0].targets.length, 1);
  assert.deepEqual(f.calls.map(call => call[2]), ['summary', 'before']);
  const html = renderToStaticMarkup(f.host.renderCodingSessionDialogs());
  assert.match(html, /large\.txt/); assert.doesNotMatch(html, /<b>\+0|<em>−0/);
  assert.deepEqual(await readFile(join(f.roots[0], 'large.txt')), after);
});
