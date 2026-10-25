import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { readCodingGoalFile, writeCodingGoalFile } from '../lib/node/nextmux-goal-file.js';
import { goalFileBody, goalFileObjective } from '../lib/browser/nextmux-goal-file-format.js';
import { goalEditorText, goalScheduleText } from '../lib/browser/nextmux-goal-schedule-locale.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

import { normalizeGoalTiming, resumeGoalTiming } from '../lib/browser/nextmux-goal-elapsed.js';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
  const node = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
  assert.ok(node, name);
  return node.getText(file);
};
const parse = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parsePersistedCodingGoalFile').getText(file);
class URI {
  constructor(path) { this.path = path; }
  static fromFilePath(path) { return new URI(path); }
  resolve(part) { return new URI(join(this.path, part)); }
  toString() { return this.path; }
}
const names = ['persistCodingGoalFile', 'openGoalDialog', 'codingGoalFileUri', 'isCodingGoalFileUri',
  'applySavedCodingGoalFile', 'writeVersionedContextFile', 'writeContextFile'];
const bindings = { URI, fileDrawerText: (_locale,key) => key, conversationText: (_locale,key) => key,
  window: { setTimeout() {} }, workbenchText: (_locale,key) => key, desktopFailureMessage: (_locale,error) => error.message,
  goalFileBody, goalFileObjective, goalScheduleText, goalEditorText, normalizeGoalTiming, resumeGoalTiming,
  activeRunBelongsToSession: (a,b) => a === b, document: { activeElement: undefined }, HTMLElement: class {}, requestAnimationFrame() {} };
const Harness = new Function(...Object.keys(bindings), ts.transpile(`${parse}\nclass Harness { ${names.map(method).join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-goal-cas-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = { id: randomUUID(), goal: { id: randomUUID(), prompt: 'Original target', status: 'active', createdAt: 1, updatedAt: 2, attempts: 0 } };
  const request = { workspaceRoot: root, conversationId: session.id, path: `.nextmux/goals/${session.goal.id}.md` };
  const path = join(root, request.path);
  const service = new NextMuxPlatformServiceImpl();
  service.nextmuxDataRoot = () => join(root, 'application-state');
  service.conversationStore = () => ({ async readSession(id) { return id === session.id ? { id, workspacePath: root, turns: [] } : undefined; } });
  t.after(() => service.disposeConnectionResources());
  const submits = [], notices = [], opens = [];
  const widget = Object.assign(new Harness(), {
    desktopLocale: 'zh-CN', activeCodingSessionId: session.id, codingSessions: [session], goalFileOperations: new Map(), goalDraftsBySession: new Map(), goalEditorDrafts: new Map(),
    conversationAgentRun: () => ({ activeAgentRunId: '' }), dropUnsubmittedGoalTasks() {},
    contextFileTabs: new Map(), contextFileSavingUris: new Set(), pendingContextFileWrites: new Set(),
    activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
    codingSessionWorkspaceRoot: () => root,
    contextFileVersionTarget: () => request,
    platformService: { getAgentFileState: service.getAgentFileState.bind(service), saveCodingGoalFile: service.saveCodingGoalFile.bind(service),
      saveAgentFileVersion() { throw new Error('Internal goal must not enter model-tool file writes'); } },
    fileService: {
      readFile: async uri => ({ value: { buffer: new Uint8Array(await readFile(uri.toString())) } }),
      resolve: async () => ({})
    },
    showFileWorkContext() {}, async openContextFile(uri) { opens.push(await readFile(uri, 'utf8')); },
    submitSavedCodingGoal(id, goal) { submits.push({ id, prompt: goal.prompt }); },
    persistCodingSessions() {}, update() {}, addNotification(...args) { notices.push(args); },
    preserveContextFileTabRecovery() {}, captureContextEditorRecovery() {}
  });
  await widget.persistCodingGoalFile(session, session.goal);
  return { root, path, request, widget, session, submits, notices, opens, service };
}

test('opening a goal uses its dedicated editor without rewriting an externally modified recovery file', async t => {
  const f = await fixture(t);
  const external = (await readFile(f.path, 'utf8')).replace('Original target', 'External target\n\n## Validation\nKeep this note.');
  await writeFile(f.path, external);
  await f.widget.openGoalDialog();
  assert.equal(await readFile(f.path, 'utf8'), external);
  assert.deepEqual(f.opens, []);
  assert.equal(f.widget.goalDrawer.draft, 'Original target');
  assert.deepEqual(f.submits, []);
  assert.equal(f.widget.codingSessions[0].goal.prompt, 'Original target');
  await assert.rejects(f.widget.persistCodingGoalFile(f.session, { ...f.session.goal, updatedAt: 3 }), /其他位置修改/);
  assert.equal(await readFile(f.path, 'utf8'), external, 'background metadata cannot erase an external prompt');
});

test('opening the goal editor does not create a missing recovery file', async t => {
  const f = await fixture(t); await rm(f.path); await f.widget.openGoalDialog();
  assert.equal(f.widget.goalDrawer.draft, 'Original target');
  await assert.rejects(readFile(f.path), { code: 'ENOENT' });
});

test('goal editor rejects same-length external changes and retains the external file', async t => {
  const f = await fixture(t);
  const state = await readCodingGoalFile(f.request);
  const original = await readFile(f.path, 'utf8');
  const external = original.replace('Original target', 'External target');
  assert.equal(external.length, original.length);
  await writeFile(f.path, external);
  const preview = { uri: f.path, path: f.path, baselineSha256: state.sha256 };
  await assert.rejects(f.widget.writeVersionedContextFile(preview, original.replace('Original target', 'My editor draft'), f.session.id),
    error => error.code === 'ROLLBACK_CONFLICT');
  assert.equal(await readFile(f.path, 'utf8'), external);
  assert.deepEqual(f.submits, []);
});

test('consecutive editor saves keep their exact SHA baseline after applying and submitting a goal', async t => {
  const f = await fixture(t);
  const state = await readCodingGoalFile(f.request);
  const preview = { uri: f.path, path: f.path, baselineSha256: state.sha256 };
  const first = (await readFile(f.path, 'utf8')).replace('Original target', 'First edited target');
  const saved = await f.widget.writeVersionedContextFile(preview, first, f.session.id);
  await f.widget.applySavedCodingGoalFile(f.session.id, f.path, first);
  assert.equal(await readFile(f.path, 'utf8'), first, 'applying a save must not write metadata over the committed text');
  assert.equal((await readCodingGoalFile(f.request)).sha256, saved.baselineSha256);
  const second = first.replace('First edited target', 'Second edited target');
  const secondSave = await f.widget.writeVersionedContextFile({ ...preview, baselineSha256: saved.baselineSha256 }, second, f.session.id);
  await f.widget.applySavedCodingGoalFile(f.session.id, f.path, second);
  assert.equal((await readCodingGoalFile(f.request)).sha256, secondSave.baselineSha256);
  assert.deepEqual(f.submits.map(item => item.prompt), ['First edited target', 'Second edited target']);
});

test('goal save finishes for its owner when the user switches conversations while disk write is pending', async t => {
  const f = await fixture(t);
  const content = (await readFile(f.path, 'utf8')).replace('Original target', 'Saved in background');
  const state = await readCodingGoalFile(f.request);
  f.widget.contextFilePreview = { uri: f.path, path: f.path, content, revision: 1, baselineSha256: state.sha256 };
  f.widget.pendingFileSave = { uri: f.path, content, side: 'current' };
  f.widget.contextFileDrafts = { current: content };
  let release, ready;
  const started = new Promise(resolve => { ready = resolve; });
  f.widget.platformService.saveCodingGoalFile = async request => { ready(); await new Promise(resolve => { release = resolve; }); return writeCodingGoalFile(request); };
  const saving = f.widget.writeContextFile(false);
  await started;
  f.widget.activeCodingSessionId = 'other-session';
  f.widget.contextFilePreview = undefined;
  f.widget.prompt = 'Other draft';
  release();
  await saving;
  assert.equal(await readFile(f.path, 'utf8'), content);
  assert.deepEqual(f.submits, [{ id: f.session.id, prompt: 'Saved in background' }]);
  assert.equal(f.widget.activeCodingSessionId, 'other-session');
  assert.equal(f.widget.prompt, 'Other draft');
});

test('two CAS saves of one baseline cannot both succeed', async t => {
  const f = await fixture(t);
  const state = await readCodingGoalFile(f.request), original = await readFile(f.path, 'utf8');
  const results = await Promise.allSettled(['First writer', 'Second writer'].map(prompt => writeCodingGoalFile({ ...f.request,
    content: original.replace('Original target', prompt), expectedSha256: state.sha256 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ROLLBACK_CONFLICT');
});

test('goal access rejects foreign metadata, arbitrary internal paths and symbolic-link directories', async t => {
  const f = await fixture(t), original = await readFile(f.path, 'utf8'), state = await readCodingGoalFile(f.request);
  await assert.rejects(writeCodingGoalFile({ ...f.request, content: original.replace(f.session.id, randomUUID()), expectedSha256: state.sha256 }),
    error => error.code === 'INVALID_GOAL_FILE');
  await assert.rejects(readCodingGoalFile({ ...f.request, path: '.nextmux/other.json' }), error => error.code === 'INVALID_GOAL_FILE');
  await rm(join(f.root, '.nextmux'), { recursive: true });
  const external = join(f.root, 'elsewhere');
  await mkdir(external);
  await symlink(external, join(f.root, '.nextmux'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readCodingGoalFile(f.request), error => error.code === 'INVALID_GOAL_FILE');
});
