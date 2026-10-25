import assert from 'node:assert/strict';
import { isReasoningOptionRejection, reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AgentRunner, AgentToolRegistry, WorkspaceToolRuntime } from '../../agent-runtime/lib/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { declaredReasoningSettings } from '../lib/common/nextmux-model-controls.js';

// Run current source methods, without a desktop process, provider, or user profile.
const src = fileURLToPath(new URL('../src/', import.meta.url)), modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} }; modules.set(path, module);
  const nativeRequire = createRequire(path);
  const localRequire = name => {
    if (name.startsWith('.')) {
      const base = resolve(dirname(path), name), file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (file?.endsWith('.ts') || file?.endsWith('.tsx')) return load(file);
    }
    return nativeRequire(name);
  };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
  }).outputText)(localRequire, module, module.exports);
  return module.exports;
}
const branchHelpers = load(join(src, 'browser/nextmux-conversation-branch.ts'));
const paste = load(join(src, 'browser/nextmux-composer-long-paste.ts'));
const { AgentQuestionController } = load(join(src, 'browser/nextmux-agent-question.ts'));
// Branching and restoring carry a conversation's chosen context window tier.
const contextBudget = load(join(src, 'common/nextmux-context-budget.ts'));
const source = readFileSync(join(src, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function harness(className, names, dependencies = {}) {
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
  const methods = names.map(name => {
    const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(method, name); return method.getText(ast);
  });
  const js = ts.transpile(`class Harness { conversationAgentRuns = new Map(); ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
  const bindings = { ...contextBudget, ...dependencies };
  return new Function(...Object.keys(bindings), `${js}; return Harness;`)(...Object.values(bindings));
}
class URI {
  constructor(value) { this.value = value; }
  get path() { return { fsPath: () => fileURLToPath(this.value) }; }
  static fromFilePath(value) { return new URI(pathToFileURL(value).href); }
  resolve(value) { return URI.fromFilePath(join(fileURLToPath(this.value), value)); }
  toString() { return this.value; }
}
const locale = (_locale, key) => key;
const queueHelpers = load(join(src, 'browser/nextmux-agent-task-queue.ts'));
const dependencies = {
  ...load(join(src, 'browser/nextmux-conversation-agent-run.ts')),
  ...load(join(src, 'common/nextmux-domain-errors.ts')),
  ...load(join(src, 'common/nextmux-desktop-status.ts')),
  ...load(join(src, 'browser/nextmux-domain-error-locale.ts')),
  ...load(join(src, 'browser/nextmux-agent-outcome-locale.ts')),
  ...queueHelpers, ...branchHelpers, ...paste, URI, FileUri: { fsPath: uri => fileURLToPath(uri.toString()) }, crypto: { randomUUID }, AgentQuestionController,
  conversationText: locale, runningTaskText: locale, fileDrawerText: locale, workbenchText: locale,
  desktopFailureMessage: (_locale, error) => error.message, localizeDesktopSurface: locale, normalizeAgentRunVerification: value => value,
  bindPriceQuote: value => value, automaticRelaySource: () => 'off', normalizeModelCitations: value => value || [],
  ConversationAttachmentRecoveryError: class extends Error {}, scheduledTaskNeedsAttention: () => false,
  priceAuthorizationErrorCode: () => undefined, window: { setTimeout() {} },
  MAX_TOTAL_ATTACHMENTS_PER_TASK: 100, composerContentToken: () => '',
  isInsufficientBalanceFailure: error => error?.code === 'INSUFFICIENT_BALANCE',
  normalizeDesktopFailure: (_locale, error) => ({ code: error?.code || 'FAILED', message: error?.message || String(error), kind: 'failed', retryable: false, resumable: false }),
  normalizeRelayFeedbackRequestIds: () => [], appendAgentActivityEvents: (before, after) => [...before, ...after],
  mergeAgentEventPollSnapshot: (events, cursor, snapshot) => ({ events: snapshot.events || events, cursor: snapshot.cursor || cursor }),
  declaredReasoningSettings, isReasoningOptionRejection, reasoningOptionKey
};
const Harness = harness('NextMuxDesktopWidget', [
  'contextFileVersionTarget', 'writeVersionedContextFile', 'recordContextFileVersion', 'recordCommittedRestores', 'refreshRestoredContextFiles', 'createCodingSessionBranch',
  'codingSessionStoredWorkspaceRoots', 'codingSessionWorkspaceRoot', 'codingSessionRelayKey', 'createWorkspaceRestorePlan',
  'prepareConversationBranchWorkspace', 'cloneInMemoryTurnAttachmentsForBranch', 'turnAttachmentPayloadKey',
  'rebaseProjectlessAttachmentRecords', 'rebaseProjectlessConversationAttachments', 'setTurnEditRestoreWorkspace', 'confirmTurnEdit',
  'stopAgentRun', 'stopConversationAgentRun', 'conversationHasActiveRun', 'executeScheduledTask', 'pollScheduledAgentRun', 'executePromptSubmission', 'modelReasoningContract',
  'recordLocalReasoningEvidence', 'readLocalReasoningEvidence', 'persistAcceptedAgentHost'
], dependencies);
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('history restore locks both Monaco diff panes and fallback editors, then unlocks both', () => {
  const Editor = harness('NextMuxFileEditor', ['componentDidUpdate']);
  const editor = new Editor(), options = [], areas = [{ readOnly: false }, { readOnly: false }];
  // The diff editor also lays out its inline/side-by-side panes on every update; only the lock calls matter here.
  const pane = () => ({ updateOptions() {} });
  editor.editor = { updateOptions: value => options.push(value), getOriginalEditor: pane, getModifiedEditor: pane };
  editor.host = { querySelectorAll: () => areas, classList: { toggle() {} } };
  editor.lineNumbersMinChars = () => 3;
  const locks = () => options.filter(value => 'readOnly' in value || 'originalEditable' in value);
  const props = { uri: 'file:///work/a.ts', recoveryKey: 'key', beforeContent: 'before', revision: 1, theme: 'dark', readOnly: false };
  editor.props = { ...props, readOnly: true }; editor.componentDidUpdate(props);
  assert.deepEqual(locks(), [{ readOnly: true }, { originalEditable: false }]);
  assert.ok(areas.every(area => area.readOnly));
  options.length = 0; editor.props = props; editor.componentDidUpdate({ ...props, readOnly: true });
  assert.deepEqual(locks(), [{ readOnly: false }, { originalEditable: true }]);
  assert.ok(areas.every(area => !area.readOnly));
});

function saveFixture() {
  const state = new Harness(), writes = [], records = [], notices = [];
  const session = { id: 'session', workspacePath: '/work', turns: [{ id: 'turn' }] };
  Object.assign(state, { codingSessions: [session], activeCodingSessionId: session.id, activeWorkspaceRoot: '/work', desktopLocale: 'en',
    recordContextFileVersion: async (...args) => records.push(args), addNotification: (...args) => notices.push(args),
    fileService: { resolve: async () => ({ mtime: 1, etag: 'v2' }) },
    platformService: {
      getAgentFileState: async () => ({ sha256: 'fresh-disk' }),
      saveAgentFileVersion: async request => { writes.push(request); return { checkpointId: 'saved', sha256: 'new-hash' }; }
    }
  });
  const preview = { path: '/work/a.ts', uri: 'file:///work/a.ts', baselineSha256: 'old-hash' };
  return { state, preview, writes, records, notices };
}
test('editor save with no baseline or no recorded root cannot write any bytes', async () => {
  const { state, preview, writes } = saveFixture();
  await assert.rejects(state.writeVersionedContextFile({ ...preview, baselineSha256: undefined }, 'edited', 'session'), /historySaveFailed/);
  await assert.rejects(state.writeVersionedContextFile({ ...preview, path: '/other/a.ts' }, 'edited', 'session'), /restoreWorkspaceMissing/);
  assert.deepEqual(writes, []);
});
test('editor save preserves the baseline CAS and propagates a conflict before recording a version', async () => {
  const { state, preview, records } = saveFixture(); let attempts = 0;
  state.platformService.saveAgentFileVersion = async request => {
    attempts++; assert.equal(request.expectedSha256, 'old-hash'); throw new Error('CHECKPOINT_CONFLICT');
  };
  await assert.rejects(state.writeVersionedContextFile(preview, 'edited', 'session'), /CHECKPOINT_CONFLICT/);
  assert.equal(attempts, 1); assert.deepEqual(records, []); assert.equal(preview.baselineSha256, 'old-hash');
});
test('confirmed overwrite obtains a fresh CAS; null means an absent file and is not an unknown baseline', async () => {
  const { state, preview, writes } = saveFixture();
  await state.writeVersionedContextFile(preview, 'edited', 'session', true);
  await state.writeVersionedContextFile({ ...preview, baselineSha256: null }, 'new file', 'session');
  assert.deepEqual(writes.map(value => value.expectedSha256), ['fresh-disk', null]);
});
test('durable save still succeeds if recording the UI event and refreshing the file stat both fail', async () => {
  const { state, preview, writes, notices } = saveFixture();
  state.recordContextFileVersion = async () => { throw new Error('refresh RPC disconnected'); };
  state.fileService.resolve = async () => { throw new Error('file stat unavailable'); };
  const saved = await state.writeVersionedContextFile(preview, 'edited', 'session');
  assert.equal(writes.length, 1); assert.equal(saved.baselineSha256, 'new-hash'); assert.equal(saved.etag, undefined);
  // Filed under the conversation that saved the file.
  assert.deepEqual(notices, [['warning', 'history', 'historyPartial', 'session']]);
});
test('version target uses the deepest persisted root and recorded ownership for an outside-root file', () => {
  const { state, preview } = saveFixture();
  state.codingSessions[0].workspaceBindings = [{ path: '/work' }, { path: '/work/nested' }];
  state.codingSessions[0].turns[0].changes = [{ checkpointId: 'external', workspaceRoot: '/work', externalTarget: '/outside/config.json' }];
  assert.deepEqual(state.contextFileVersionTarget({ ...preview, path: '/work/nested/a.ts' }),
    { workspaceRoot: '/work/nested', conversationId: 'session', path: 'a.ts', turnId: 'turn' });
  assert.deepEqual(state.contextFileVersionTarget({ ...preview, path: '/outside/config.json' }),
    { workspaceRoot: '/work', conversationId: 'session', checkpointId: 'external', turnId: 'turn' });
});
test('UNC file saves and external version ownership are case-insensitive like Windows drive paths', async () => {
  const { state, preview, writes } = saveFixture();
  state.activeWorkspaceRoot = ''; state.codingSessions[0].workspacePath = '\\\\Server\\Share\\Project';
  const unc = { ...preview, path: '\\\\server\\SHARE\\project\\File.ts', uri: 'file://server/SHARE/project/File.ts' };
  await state.writeVersionedContextFile(unc, 'edited', 'session');
  assert.equal(writes[0].workspaceRoot, '//Server/Share/Project'); assert.equal(writes[0].path, 'File.ts');
  state.codingSessions[0].turns[0].changes = [{ checkpointId: 'unc-external', workspaceRoot: '//Server/Share/Project', externalTarget: '\\\\Server\\Outside\\config.json' }];
  assert.deepEqual(state.contextFileVersionTarget({ ...preview, path: '\\\\server\\OUTSIDE\\CONFIG.json' }),
    { workspaceRoot: '//Server/Share/Project', conversationId: 'session', checkpointId: 'unc-external', turnId: 'turn' });
});

function branchFixture() {
  const state = new Harness(), forks = [], discarded = [], cached = [];
  const source = { id: 'source', title: 'project', workspacePath: '/one', workspaceBindings: [{ path: '/one' }, { path: '/two' }],
    routeId: 'route', relayKey: 'source-api', modelId: 'model', permissionMode: 'workspace_write', turns: [
      { id: 't1', prompt: 'first', response: 'done', stage: 'complete', changes: [
        { checkpointId: 'a', workspaceRoot: '/one', path: 'a.ts' },
        { checkpointId: 'b', workspaceRoot: '/two', path: 'b.ts', externalTarget: '/outside/b.ts' }
      ] }, { id: 't2', prompt: 'second', response: 'done', stage: 'complete', changes: [] }
    ] };
  Object.assign(state, {
    desktopLocale: 'en', turnAttachmentPayloads: new Map(), workspaceRootIsOpen: () => true,
    routesForRelay(key, workbench) { assert.equal(key, 'source-api'); return this.modelRoutes(workbench); },
    resolveTurnAttachments: async () => [], attachmentDataBase64: record => Buffer.from(record.attachment.content).toString('base64'),
    platformService: {
      getAgentCheckpointDiff: async (root, id) => {
        if ((id === 'a' && (root === '/one' || root.endsWith('/one'))) || (id === 'b' && (root === '/two' || root.endsWith('/two')))) return { checkpointId: id, workspaceRoot: root };
        throw new Error('wrong root');
      },
      forkConversationWorkspaces: async request => {
        forks.push(request); const base = `/private/${request.targetConversationId}`;
        return { workspaceRoot: `${base}/one`, workspaces: request.groups.map((group, index) =>
          ({ sourceWorkspaceRoot: group.workspaceRoot, workspaceRoot: `${base}/${index ? 'two' : 'one'}` })),
          resourceMappings: [{ sourcePath: '/outside/b.ts', targetPath: `${base}/external/b.ts` }] };
      },
      getConversationWorkspaceBindings: async id => ({ workspaceRoot: `/private/${id}/one`, workspaces: [{ workspaceRoot: `/private/${id}/one` }, { workspaceRoot: `/private/${id}/two` }] }),
      discardConversationWorkspace: async id => discarded.push(id),
      cacheDesktopAttachment: async request => {
        cached.push(request); const relative = `.nextmux/conversation-attachments/${'a'.repeat(64)}-${randomUUID()}.txt`;
        return { uri: URI.fromFilePath(join(request.workspaceRoot, relative)).toString(), workspaceRelativePath: relative };
      }
    }
  });
  return { state, source, forks, discarded, cached };
}
test('a branch with inherited edits isolates every root even when rollback was not requested', async () => {
  const { state, source, forks } = branchFixture(), unchanged = structuredClone(source);
  const branch = state.createCodingSessionBranch(source, branchHelpers.inheritConversationTurnsBefore(source.turns, 't2'), 't2:user', 10);
  const result = await state.prepareConversationBranchWorkspace(source, branch);
  assert.equal(forks.length, 1); assert.deepEqual(forks[0].groups.map(group => group.checkpointIds), [[], []]);
  assert.deepEqual(forks[0].groups.map(group => group.inheritedCheckpointIds), [['a'], ['b']]);
  assert.equal(result.ownedWorkspace, true); assert.notEqual(result.id, source.id);
  assert.deepEqual(result.workspaceBindings.map(root => root.path), [`/private/${result.id}/one`, `/private/${result.id}/two`]);
  assert.equal(result.turns[0].changes[1].externalTarget, `/private/${result.id}/external/b.ts`);
  assert.deepEqual(source, unchanged); assert.equal(result.modelId, source.modelId); assert.equal(result.routeId, source.routeId);
});
test('a private branch reopens the copied editor file and scroll positions without moving source drafts', async () => {
  const { state, source } = branchFixture();
  source.viewState = { workContextOpen: true, workContextMode: 'file', contextFileUri: 'file:///one/baseline.txt',
    contextFileMaximized: true, contextFileScrollPositions: {
      'file:///one/baseline.txt': { top: 24, left: 3 }, 'file:///two/b.ts': { top: 40, left: 1 },
      'file:///outside/b.ts': { top: 12, left: 2 }, 'file:///unrelated/notes.txt': { top: 9, left: 0 }
    } };
  state.contextFilePreview = { uri: source.viewState.contextFileUri, recoverySessionId: source.id, recoveryKey: 'source-draft' };
  state.contextFileDrafts = { current: 'unsaved source draft' }; state.contextFileDirty = true;
  const unchanged = structuredClone(source), drafts = structuredClone(state.contextFileDrafts);
  const branch = state.createCodingSessionBranch(source, structuredClone(source.turns), 't2:user', 1);
  const result = await state.prepareConversationBranchWorkspace(source, branch);
  assert.equal(result.viewState.contextFileUri, `file:///private/${result.id}/one/baseline.txt`);
  assert.deepEqual(result.viewState.contextFileScrollPositions, {
    [`file:///private/${result.id}/one/baseline.txt`]: { top: 24, left: 3 },
    [`file:///private/${result.id}/two/b.ts`]: { top: 40, left: 1 },
    [`file:///private/${result.id}/external/b.ts`]: { top: 12, left: 2 }
  });
  assert.equal(result.viewState.contextFileMaximized, true);
  assert.deepEqual(source, unchanged); assert.deepEqual(state.contextFileDrafts, drafts);
  assert.equal(state.contextFilePreview.recoverySessionId, source.id); assert.equal(state.contextFileDirty, true);
  const grandchild = await state.prepareConversationBranchWorkspace(result,
    state.createCodingSessionBranch(result, structuredClone(result.turns), 't2:user', 2));
  assert.equal(grandchild.viewState.contextFileUri, `file:///private/${grandchild.id}/one/baseline.txt`);
  assert.equal(result.viewState.contextFileUri, `file:///private/${result.id}/one/baseline.txt`);
});
test('absolute file read activities follow copied resources across successive private branches', async () => {
  const { state, source } = branchFixture();
  source.turns[0].events = ['/one/a.ts', '/two/b.ts', '/outside/b.ts', 'relative.ts', '/unrelated/notes.txt'].map((path, index) => ({
    type: 'tool_completed', callId: `read-${index}`, toolName: 'workspace.read_file', ok: true, status: 'succeeded', durationMs: 1,
    summary: { title: 'Read', resource: { kind: 'file', path, action: 'read', startLine: 5, endLine: 8 } }, at: new Date().toISOString()
  }));
  const original = structuredClone(source.turns[0].events);
  const branch = await state.prepareConversationBranchWorkspace(source,
    state.createCodingSessionBranch(source, structuredClone(source.turns), 't2:user', 1));
  assert.deepEqual(branch.turns[0].events.map(event => event.summary.resource.path), [
    `/private/${branch.id}/one/a.ts`, `/private/${branch.id}/two/b.ts`, `/private/${branch.id}/external/b.ts`, 'relative.ts', '/unrelated/notes.txt'
  ]);
  // The parent layout owns an external resource directory too.
  state.platformService.getConversationWorkspaceBindings = async id => ({ workspaceRoot: `/private/${id}/one`, workspaces: [
    { workspaceRoot: `/private/${id}/one` }, { workspaceRoot: `/private/${id}/two` }, { workspaceRoot: `/private/${id}/external` }
  ] });
  state.platformService.forkConversationWorkspaces = async request => ({ workspaceRoot: `/private/${request.targetConversationId}/one`,
    workspaces: request.groups.map(group => ({ sourceWorkspaceRoot: group.workspaceRoot,
      workspaceRoot: `/private/${request.targetConversationId}/${group.workspaceRoot.split('/').at(-1)}` })), resourceMappings: [] });
  const grandchild = await state.prepareConversationBranchWorkspace(branch,
    state.createCodingSessionBranch(branch, structuredClone(branch.turns), 't2:user', 2));
  assert.equal(grandchild.turns[0].events[0].summary.resource.path, `/private/${grandchild.id}/one/a.ts`);
  assert.equal(grandchild.turns[0].events[1].summary.resource.path, `/private/${grandchild.id}/two/b.ts`);
  assert.equal(grandchild.turns[0].events[2].summary.resource.path, `/private/${grandchild.id}/external/b.ts`);
  assert.equal(grandchild.turns[0].events[0].summary.resource.startLine, 5);
  assert.deepEqual(source.turns[0].events, original);
  assert.equal(branch.turns[0].events[0].summary.resource.path, `/private/${branch.id}/one/a.ts`);
});
test('successive branches preserve distinct POSIX backslash and slash read targets', { skip: process.platform === 'win32' }, async () => {
  const { state, source } = branchFixture();
  source.turns[0].events = ['/one/a\\b.txt', '/one/a/b.txt'].map((path, index) => ({
    type: 'tool_completed', callId: `read-${index}`, toolName: 'workspace.read_file', ok: true, status: 'succeeded', durationMs: 1,
    summary: { title: 'Read', resource: { kind: 'file', path, action: 'read' } }, at: new Date().toISOString()
  }));
  const original = structuredClone(source.turns[0].events);
  const branch = await state.prepareConversationBranchWorkspace(source,
    state.createCodingSessionBranch(source, structuredClone(source.turns), 't2:user', 1));
  const targets = session => session.turns[0].events.map(event => event.summary.resource.path);
  assert.deepEqual(targets(branch), [`/private/${branch.id}/one/a\\b.txt`, `/private/${branch.id}/one/a/b.txt`]);
  const grandchild = await state.prepareConversationBranchWorkspace(branch,
    state.createCodingSessionBranch(branch, structuredClone(branch.turns), 't2:user', 2));
  assert.deepEqual(targets(grandchild), [`/private/${grandchild.id}/one/a\\b.txt`, `/private/${grandchild.id}/one/a/b.txt`]);
  assert.deepEqual(targets(branch), [`/private/${branch.id}/one/a\\b.txt`, `/private/${branch.id}/one/a/b.txt`]);
  assert.deepEqual(source.turns[0].events, original);
});
test('branch file views prefer exact external and deepest root mappings, with Windows and encoded paths', () => {
  const rebase = (uri, mappings) => branchHelpers.rebaseConversationBranchFileView({ contextFileUri: uri,
    contextFileMaximized: true, contextFileScrollPositions: { [uri]: { top: 8, left: 1 } } }, mappings);
  const mappings = [
    { sourceUri: 'file:///project', targetUri: 'file:///copy/root', directory: true },
    { sourceUri: 'file:///project/nested', targetUri: 'file:///copy/nested', directory: true },
    { sourceUri: 'file:///project/nested/external.txt', targetUri: 'file:///copy/external.txt' }
  ];
  assert.equal(rebase('file:///project/nested/external.txt', mappings).contextFileUri, 'file:///copy/external.txt');
  assert.equal(rebase('file:///project/nested/a%20%23%25%E4%B8%AD.txt', mappings).contextFileUri, 'file:///copy/nested/a%20%23%25%E4%B8%AD.txt');
  assert.equal(rebase('file:///PROJECT/a.txt', mappings).contextFileUri, undefined, 'POSIX paths retain case semantics');
  assert.equal(rebase('file:///project-other/a.txt', mappings).contextFileUri, undefined, 'root matches require a directory boundary');
  const missing = rebase('file:///outside/a.txt', mappings);
  assert.equal(missing.contextFileUri, undefined); assert.equal(missing.contextFileMaximized, false);
  assert.equal(missing.contextFileScrollPositions, undefined);
  assert.equal(rebase('file:///c:/WORK/Nested/File.txt', [
    { sourceUri: 'file:///C:/work', targetUri: 'file:///D:/branch', directory: true }
  ]).contextFileUri, 'file:///D:/branch/Nested/File.txt');
  assert.equal(rebase('file://server/share/Project/File.txt', [
    { sourceUri: 'file://SERVER/SHARE/project', targetUri: 'file:///copy/unc', directory: true }
  ]).contextFileUri, 'file:///copy/unc/File.txt');
});
test('rollback targets go only to the newly isolated copy, including a branch of a branch', async () => {
  const { state, source, forks } = branchFixture();
  const first = await state.prepareConversationBranchWorkspace(source, state.createCodingSessionBranch(source, structuredClone(source.turns), 't2:user', 1),
    [{ workspaceRoot: '/two', checkpointIds: ['b'], changes: [] }]);
  assert.deepEqual(forks[0].groups.map(group => group.checkpointIds), [[], ['b']]);
  const firstUnchanged = structuredClone(first);
  const second = await state.prepareConversationBranchWorkspace(first, state.createCodingSessionBranch(first, structuredClone(first.turns), 't2:user', 2));
  assert.equal(forks[1].sourceConversationId, first.id); assert.equal(forks[1].targetConversationId, second.id);
  assert.ok(forks[1].groups.every(group => group.workspaceRoot.startsWith(`/private/${first.id}/`)));
  assert.ok(second.workspaceBindings.every(root => root.path.startsWith(`/private/${second.id}/`)));
  assert.deepEqual(first, firstUnchanged); assert.notEqual(first.id, second.id);
});
test('chat-only histories do not clone an unrelated directory; owned attachment-only chats allocate an empty private root', async () => {
  const { state, source, forks, cached } = branchFixture(); source.turns = [];
  await state.prepareConversationBranchWorkspace(source, state.createCodingSessionBranch(source, [], undefined, 1));
  source.ownedWorkspace = true; source.privateWorkspacePath = '/private/source/one';
  const result = await state.prepareConversationBranchWorkspace(source, state.createCodingSessionBranch(source, [], undefined, 2));
  assert.deepEqual(forks, []); assert.deepEqual(cached, []); assert.equal(result.ownedWorkspace, true);
  assert.notEqual(result.privateWorkspacePath, source.privateWorkspacePath);
});
test('attachment migration failure discards the new branch workspace and preserves source history', async () => {
  const { state, source, discarded } = branchFixture(), unchanged = structuredClone(source);
  const branch = state.createCodingSessionBranch(source, structuredClone(source.turns), undefined, 1);
  state.resolveTurnAttachments = async () => { throw new Error('attachment unavailable'); };
  await assert.rejects(state.prepareConversationBranchWorkspace(source, branch), /attachment unavailable/);
  assert.deepEqual(discarded, [branch.id]); assert.deepEqual(source, unchanged);
});
test('editing a historical prompt submits copied composer attachments and paste references in the new branch', async () => {
  const { state, source, cached } = branchFixture(); const submitted = [];
  const ref = paste.createPastedTextReference({ id: 'paste', content: 'a long prompt', ordinal: 1, createdAt: new Date(0) });
  const relative = `.nextmux/conversation-attachments/${'b'.repeat(64)}.txt`;
  const record = { id: ref.id, size: 13, uri: `file:///one/${relative}`, workspaceRelativePath: relative,
    attachment: { kind: 'text', name: 'paste.txt', content: 'a long prompt' } };
  const reference = { ...ref, attachment: { uri: record.uri, workspaceRelativePath: record.workspaceRelativePath, size: record.size } };
  const prompt = reference.marker;
  source.turns[1].attachments = [{ id: record.id, name: 'paste.txt', uri: record.uri }];
  const before = structuredClone(source);
  const route = { id: 'route', kind: 'official_connection', connection: { modelFamily: 'model', providerName: 'provider' } };
  Object.assign(state, {
    activeCodingSessionId: source.id, codingSessions: [source], conversationHistoryLoadGeneration: 1,
    pendingTurnEdit: { sessionId: source.id, turnId: 't2', prompt, pastedTextReferences: paste.serializePastedTextReferences([reference]) },
    turnEditRestoreWorkspace: false, turnEditRestorePreview: { status: 'idle' }, turnEditSubmitting: false,
    conversationHistoryReady: () => true, modelRoutes: () => [route], modelKeyForRoute: () => 'model',
    reasoningEffortLevels: () => [], conversationMutations: new branchHelpers.ConversationMutationLock(),
    routeSupportsAttachment: () => true, resolveTurnAttachments: async (_source, turnId) => turnId === 't2' ? [record] : [],
    createCodingTurn: (_id, value, _permission, _route, _summary, attachments) => ({ id: randomUUID(), prompt: value, attachments, createdAt: 1, stage: 'running' }),
    resetTurnEditRestore() {}, persistCodingSessions() {}, update() {}, openCodingSession(id) { this.activeCodingSessionId = id; },
    submitPrompt: async (...args) => submitted.push(args[3])
  });
  await state.confirmTurnEdit('branch');
  assert.equal(state.turnEditError, ''); assert.equal(submitted.length, 1);
  const execution = submitted[0], copied = execution.attachments[0];
  assert.notEqual(copied.uri, record.uri); assert.ok(copied.uri.includes(`/private/${execution.sessionId}/`));
  assert.equal(execution.pastedTextReferences[0].attachment.uri, copied.uri);
  assert.equal(execution.pastedTextReferences[0].attachment.workspaceRelativePath, copied.workspaceRelativePath);
  assert.equal(cached.length, 1); assert.equal(cached[0].conversationId, execution.sessionId); assert.equal(cached[0].unique, true);
  assert.deepEqual(source, before);
});

function replacementFixture() {
  const { state, source } = branchFixture(), submitted = [], persisted = [], restores = [], notices = [];
  const route = { id: 'route', kind: 'official_connection', connection: { modelFamily: 'model', providerName: 'provider' } };
  source.turns.push({ id: 't3', prompt: 'obsolete tail', response: 'old response', stage: 'complete', changes: [{ checkpointId: 'later', workspaceRoot: '/two' }] });
  Object.assign(state, {
    activeCodingSessionId: source.id, codingSessions: [source], conversationHistoryLoadGeneration: 1,
    pendingTurnEdit: { sessionId: source.id, turnId: 't2', prompt: 'replacement', pastedTextReferences: '' },
    turnEditRestoreWorkspace: true, turnEditRestorePreview: { status: 'ready', sourceState: branchHelpers.conversationHistoryStateToken(source),
      checkpointIds: ['later'], restorePlan: [{ workspaceRoot: '/two', checkpointIds: ['later'], changes: [] }] }, turnEditSubmitting: false,
    conversationHistoryReady: () => true, modelRoutes: () => [route], modelKeyForRoute: () => 'model', reasoningEffortLevels: () => [],
    conversationMutations: new branchHelpers.ConversationMutationLock(), routeSupportsAttachment: () => true,
    createCodingTurn: (_id, prompt) => ({ id: randomUUID(), prompt, response: '', stage: 'running', changes: [], createdAt: 1 }),
    updateCodingTurn(sessionId, turnId, patch) {
      this.codingSessions = this.codingSessions.map(session => session.id === sessionId
        ? { ...session, turns: session.turns.map(turn => turn.id === turnId ? { ...turn, ...patch } : turn) } : session);
    },
    discardSessionFollowUpQueue() {}, markCheckpointRestored() {}, resetTurnEditRestore() {}, update() {},
    persistCodingSessions() { persisted.push(structuredClone(this.codingSessions)); },
    openCodingSession(id) { this.activeCodingSessionId = id; }, addNotification: (...args) => notices.push(args),
    submitPrompt: async (...args) => submitted.push(args[3])
  });
  state.platformService.restoreAgentCheckpointGroups = async groups => {
    restores.push(groups); return { checkpointIds: ['later'], versions: [{ workspaceRoot: '/two', checkpointId: 'restored-event', path: '/two/file.ts' }] };
  };
  state.platformService.getAgentCheckpointDiff = async (root, checkpointId) => {
    assert.equal(root, '/two'); assert.equal(checkpointId, 'restored-event');
    assert.equal(state.codingSessions[0].turns.at(-1).prompt, 'replacement', 'the history rewrite must commit before attaching its restoration event');
    return { checkpointId, workspaceRoot: root, path: 'file.ts', operation: 'message_restore' };
  };
  return { state, source, submitted, persisted, restores, notices };
}

function routeInheritanceFixture() {
  const fixture = replacementFixture(), { state, source } = fixture;
  const route = { id: 'route', kind: 'official_connection', connection: {
    id: 'source-api', model: 'model', modelFamily: 'model', providerId: 'custom_openai',
    providerName: 'Source API', protocol: 'openai_chat_completions', baseUrl: 'https://source.example/v1'
  } };
  const other = { ...route, id: 'other-route', connection: { ...route.connection, id: 'other-api',
    providerName: 'Other API', baseUrl: 'https://other.example/v1' } };
  source.turns = source.turns.map(turn => ({ ...turn, changes: [] }));
  state.turnEditRestoreWorkspace = false;
  state.activeRelayKey = 'other-api';
  state.activeCodingSessionId = 'other-session';
  state.modelRoutes = () => [other];
  state.activeModelRoute = () => other;
  state.routesForRelay = key => key === source.relayKey ? [route] : [other];
  state.modelKeyForRoute = candidate => candidate.connection.model;
  return { ...fixture, route, other };
}
for (const mode of ['replace', 'branch']) {
  test(`a forced empty rollback remains a no-op when confirming a read-only ${mode}`, async () => {
    const { state, source, submitted, persisted } = replacementFixture();
    source.permissionMode = 'read_only';
    source.turns = source.turns.map(turn => ({ ...turn, permissionMode: 'read_only', changes: [],
      workspaceBaselines: [], fileVersionReceipts: [], events: [{ type: 'tool_result', call: { name: 'workspace.read_file' }, result: { ok: true } }] }));
    const before = structuredClone(source), rpcCalls = [];
    state.platformService = new Proxy({}, { get: (_target, name) => async () => {
      rpcCalls.push(name); throw new Error('No workspace or snapshot RPC is needed');
    } });
    await state.setTurnEditRestoreWorkspace(true);
    assert.equal(state.turnEditRestorePreview.status, 'ready');
    assert.deepEqual(state.turnEditRestorePreview.checkpointIds, []);
    assert.deepEqual(state.turnEditRestorePreview.restorePlan, []);
    await state.confirmTurnEdit(mode);
    assert.equal(state.turnEditError, '');
    assert.equal(submitted.length, 1); assert.equal(persisted.length, 1);
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(source, before, 'source records must never be mutated in place');
    assert.equal(state.codingSessions[0].turns.at(-1).prompt, 'replacement');
    if (mode === 'branch') assert.equal(state.codingSessions.find(session => session.id === source.id), source);
  });
}
for (const mode of ['replace', 'branch']) {
  test(`historical ${mode} retains the source API when another conversation selects the same model`, async () => {
    const { state, source, route, submitted } = routeInheritanceFixture();
    const before = structuredClone(source);
    await state.confirmTurnEdit(mode);
    assert.equal(state.turnEditError, ''); assert.equal(submitted.length, 1);
    assert.strictEqual(submitted[0].route, route);
    assert.equal(submitted[0].route.connection.baseUrl, 'https://source.example/v1');
    assert.equal(submitted[0].route.connection.protocol, 'openai_chat_completions');
    assert.equal(state.codingSessions[0].routeId, route.id);
    assert.equal(state.codingSessions[0].relayKey, 'source-api');
    assert.deepEqual(source, before);
  });
  test(`historical ${mode} with a missing source route preserves the edit without launching or restoring`, async () => {
    const { state, source, submitted, restores, persisted } = routeInheritanceFixture();
    const before = structuredClone(source), pending = state.pendingTurnEdit;
    state.routesForRelay = () => [];
    await state.confirmTurnEdit(mode);
    assert.match(state.turnEditError, /routeUnavailable/);
    assert.strictEqual(state.pendingTurnEdit, pending);
    assert.deepEqual(state.codingSessions, [before]);
    assert.deepEqual(submitted, []); assert.deepEqual(restores, []); assert.deepEqual(persisted, []);
  });
}
test('historical resend inherits an explicit new model selection on the source conversation', async () => {
  const { state, source, route, submitted } = routeInheritanceFixture();
  source.routeId = 'new-route'; source.modelId = 'new-model';
  route.id = 'new-route'; route.connection.model = 'new-model';
  source.turns[1].routeId = 'old-model-route';
  await state.confirmTurnEdit('branch');
  assert.equal(state.turnEditError, ''); assert.strictEqual(submitted[0].route, route);
  assert.equal(state.codingSessions[0].modelId, 'new-model');
});
test('a reused connection route ID cannot silently replace the saved model with its new default', async () => {
  const { state, source, route, submitted, restores } = routeInheritanceFixture();
  route.connection.model = 'different-default-model';
  const before = structuredClone(source);
  await state.confirmTurnEdit('branch');
  assert.match(state.turnEditError, /routeUnavailable/);
  assert.deepEqual(source, before); assert.deepEqual(submitted, []); assert.deepEqual(restores, []);
});
test('editing in place associates committed restoration versions with the replacement turn after truncation', async () => {
  const { state, source, submitted, persisted, restores } = replacementFixture(), before = structuredClone(source);
  await state.confirmTurnEdit('replace');
  assert.equal(state.turnEditError, ''); assert.equal(restores.length, 1); assert.equal(submitted.length, 1);
  const replacement = state.codingSessions[0].turns.at(-1);
  assert.equal(state.codingSessions[0].turns.length, 2); assert.equal(replacement.prompt, 'replacement');
  assert.notEqual(replacement.id, 't2'); assert.deepEqual(replacement.changes, []); assert.deepEqual(replacement.workspaceBaselines.map(change => change.checkpointId), ['restored-event']);
  assert.equal(persisted.at(-1)[0].turns.at(-1).workspaceBaselines[0].checkpointId, 'restored-event');
  assert.equal(submitted[0].preparedTurnId, replacement.id); assert.deepEqual(source, before);
});
test('history lookup failure after a committed message restore warns and still submits the replacement once', async () => {
  const { state, restores, submitted, notices } = replacementFixture();
  state.platformService.getAgentCheckpointDiff = async () => { throw new Error('history refresh disconnected'); };
  await state.confirmTurnEdit('replace');
  assert.equal(state.turnEditError, ''); assert.equal(restores.length, 1); assert.equal(submitted.length, 1);
  assert.equal(state.codingSessions[0].turns.at(-1).prompt, 'replacement');
  assert.deepEqual(notices, [['warning', 'history', 'historyPartial', 'source']]);
});
test('history changed during attachment recovery fails CAS before any file restore or message rewrite', async () => {
  const { state, source, restores, submitted } = replacementFixture(), waiting = deferred();
  state.resolveTurnAttachments = () => waiting.promise;
  const editing = state.confirmTurnEdit('replace');
  const newer = { ...source, historyRevision: 1, turns: [...source.turns, { id: 'newer', prompt: 'concurrent message', stage: 'complete' }] };
  state.codingSessions = [newer]; waiting.resolve([]); await editing;
  assert.deepEqual(restores, []); assert.deepEqual(submitted, []); assert.strictEqual(state.codingSessions[0], newer);
  assert.match(state.turnEditError, /restoreFailed/); assert.equal(state.turnEditSubmitting, false);
  const released = state.conversationMutations.tryAcquire(source.id); assert.equal(typeof released, 'function'); released();
});

function stopFixture() {
  const state = new Harness(), cancelled = [], notices = [];
  const session = { id: 'session', workspacePath: '/work', turns: [{ id: 'turn', stage: 'running' }] };
  Object.assign(state, { session, codingSessions: [session], activeCodingSessionId: session.id, scheduledAgentRuns: new Map(), agentStopping: false,
    agentStage: 'running', liveAgentEvents: [], liveAgentChildren: [], agentStartController: new AbortController(),
    activeCodingSession: () => session, update() {},
    updateCodingTurn(_sessionId, turnId, patch) { Object.assign(session.turns.find(turn => turn.id === turnId), patch); },
    addNotification: (...args) => notices.push(args), notifySystemTask() {}, codingSessionTitle: text => text, desktopLocale: 'en',
    platformService: { cancelAgentRun: async id => cancelled.push(id) }
  });
  return { state, session, cancelled, notices };
}
test('stopping before the run ID exists immediately aborts preparation and marks the durable turn cancelled', async () => {
  const { state, session, cancelled } = stopFixture();
  await state.stopAgentRun();
  assert.equal(state.agentStartController.signal.aborted, true); assert.equal(state.agentStage, 'cancelled');
  assert.equal(state.agentCancelRequested, true); assert.equal(session.turns[0].stopReason, 'cancel_requested');
  assert.equal(session.turns[0].stage, 'cancelled'); assert.equal(state.agentStopping, false); assert.deepEqual(cancelled, []);
});
test('scheduled stop before the run ID exists retains the shared cancellation flag', async () => {
  const { state, cancelled } = stopFixture(); const shared = { runId: '', questions: new AgentQuestionController() };
  state.scheduledAgentRuns.set('session', shared);
  await state.stopAgentRun();
  assert.equal(shared.cancelRequested, true); assert.strictEqual(state.scheduledAgentRuns.get('session'), shared);
  assert.deepEqual(cancelled, []); assert.equal(state.agentStopping, false);
});
test('a scheduled cancellation transport failure is reported without an unhandled rejection and retried while polling', async () => {
  const { state, notices } = stopFixture(); let attempts = 0, polls = 0;
  const shared = { runId: 'run', questions: new AgentQuestionController() }; state.scheduledAgentRuns.set('session', shared);
  state.platformService.cancelAgentRun = async () => { if (++attempts === 1) throw new Error('IPC disconnected'); };
  await state.stopAgentRun();
  assert.equal(shared.cancelRequested, true); assert.ok(notices.length);
  state.platformService.getAgentRunSnapshot = async () => ++polls === 1 ? { status: 'running', children: [] }
    : { status: 'cancelled', result: { status: 'cancelled' } };
  const result = await state.pollScheduledAgentRun('run', 'session', 'turn');
  assert.equal(result.status, 'cancelled'); assert.ok(attempts >= 2);
  assert.strictEqual(state.scheduledAgentRuns.get('session'), shared);
});

function scheduleFixture() {
  const { state, session, cancelled, notices } = stopFixture(); const starts = [], removed = [];
  session.turns = [];
  const task = { id: 'schedule', title: 'scheduled', workspacePath: '/work', routeId: 'route', prompt: 'do work', cadence: 'daily', enabled: true };
  const route = { id: 'route', kind: 'official_connection', connection: { id: 'connection', model: 'model' } };
  Object.assign(state, { scheduledTasksReady: true, runningScheduledTaskIds: new Set(), scheduledTasks: [task],
    scheduledTaskDueAt: () => 1, conversationHistoryReady: () => true, allModelRoutes: () => [route],
    updateScheduledTask(_id, patch) { Object.assign(task, patch); }, scheduledTaskSession: () => session,
    codingConversationHistory: () => [], defaultPermissionMode: 'workspace_write',
    reasoningSettingsForRoute: () => ({}),
    appendCodingTurn() { const turn = { id: 'turn', stage: 'running' }; session.turns.push(turn); return turn; },
    flushConversationHistory: async () => {}, prepareAgentSkills: async () => [], agentBillingLabel: () => '',
    platformService: { ...state.platformService,
      claimDesktopScheduledTaskRun: async () => ({ claimed: true }),
      startAgentRun: async request => { starts.push(request); return { runId: 'scheduled-run' }; },
      removeDesktopScheduledTask: async id => removed.push(id)
    }
  });
  return { state, session, task, starts, removed, cancelled, notices };
}
test('scheduled stop during skill preparation prevents any model submission', async () => {
  const { state, task, starts, session } = scheduleFixture(), waiting = deferred(), reached = deferred();
  state.prepareAgentSkills = async () => { reached.resolve(); return waiting.promise; };
  const run = state.executeScheduledTask(task); await reached.promise;
  await state.stopAgentRun(); waiting.resolve([]); await run;
  assert.deepEqual(starts, []); assert.equal(task.enabled, false); assert.equal(session.turns[0].stage, 'cancelled');
  assert.equal(state.runningScheduledTaskIds.size, 0); assert.equal(state.scheduledAgentRuns.size, 0);
});
test('scheduled stop during start RPC cancels the eventual run ID and does not report a completed response as success', { timeout: 20_000 }, async () => {
  const { state, task, cancelled, session } = scheduleFixture(), waiting = deferred(), reached = deferred();
  let shared;
  state.platformService.startAgentRun = async () => { reached.resolve(); return waiting.promise; };
  state.platformService.getAgentRunSnapshot = async () => {
    assert.strictEqual(state.scheduledAgentRuns.get('session'), shared);
    return { status: 'completed', result: { status: 'completed', finalText: 'finished during cancel', route: {},
      usage: { inputTokens: 1, outputTokens: 1 }, billing: { kind: 'provider_direct' }, events: [], changes: [] } };
  };
  const run = state.executeScheduledTask(task); await reached.promise;
  shared = state.scheduledAgentRuns.get('session'); await state.stopAgentRun();
  waiting.resolve({ runId: 'late-run' }); await run;
  assert.deepEqual(cancelled, ['late-run']); assert.equal(task.enabled, false); assert.notEqual(task.lastStatus, 'complete');
  assert.equal(session.turns[0].stage, 'cancelled'); assert.equal(session.turns[0].stopReason, 'cancel_requested');
  assert.equal(state.runningScheduledTaskIds.size, 0); assert.equal(state.scheduledAgentRuns.size, 0);
});

for (const finish of ['completed', 'cancelled']) test(`real runner ${finish} preserves restore audit and second edit restores the prompt baseline`, async t => {
  const base = await mkdtemp(join(tmpdir(), 'nm-message-version-e2e-'));
  const root = join(base, 'work'); await mkdir(root); const canonical = await realpath(root);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'versions'), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  const hash = text => createHash('sha256').update(text).digest('hex');
  const write = async (before, after) => {
    const result = await tools.execute({ id: randomUUID(), name: 'workspace.write_file', arguments: { path: 'a.txt', content: after, expectedSha256: hash(before) } },
      'full_access', { runId: randomUUID() });
    assert.equal(result.ok, true, JSON.stringify(result.error)); return runtime.getCheckpointDiff(result.summary.checkpointId);
  };
  await writeFile(join(root, 'a.txt'), 'a0'); const first = await write('a0', 'a1'), second = await write('a1', 'a2');
  const { state } = replacementFixture();
  state.codingSessions = [{ id: 'session', workspacePath: canonical, routeId: 'route', relayKey: 'source-api', modelId: 'model', permissionMode: 'workspace_write', turns: [
    { id: 't1', prompt: 'first', response: 'one', stage: 'complete', changes: [first] },
    { id: 't2', prompt: 'second', response: 'two', stage: 'complete', changes: [second] }
  ] }];
  state.platformService.getAgentCheckpointDiff = (_root, id) => runtime.getCheckpointDiff(id);
  state.platformService.restoreAgentCheckpointGroups = async (groups, owner) => {
    const summaries = await WorkspaceToolRuntime.restoreCheckpointGroups(groups.map(group => ({ ...group, runtime })), { recordVersions: true, ...owner });
    return { restored: true, checkpointIds: summaries.map(item => item.checkpointId), versions: summaries.map(item => item.restoration).filter(Boolean) };
  };
  let started = 0, pending, submission;
  Object.assign(state, {
    activeCodingSessionId: 'session', permissionMode: 'workspace_write', agentStage: 'complete', activeAgentRunId: '', agentPollGeneration: 0,
    activeModelRoute: () => state.modelRoutes()[0],
    applicationExitGeneration: 0, applicationExitPreparing: false, agentQuestions: { sync() {} },
    followUpDrainReadySessionIds: new Set(), directFollowUpDrainTaskIds: new Map(), skillService: { ready: Promise.resolve() },
    async prepareAgentSkills() { return []; }, async ensureCodingSessionWorkspace(session) { return session; }, codingConversationHistory: () => [],
    reasoningEffortForRoute() {}, managedModelRoute() {}, selectedTerminalProfile() {}, scheduleThreadBottomFollow() {},
    reasoningSettingsForRoute() { return {}; },
    recentToolNames() { return []; }, invalidCouncilConfigMessage: () => '',
    // Scheduled-wakeup timers are not part of the restore audit.
    clearConversationWakeup() {}, scheduleTurnWakeupFromEvents() {}, scheduleAutomaticResume() {}, scheduleGoalContinuation() {}, requestFollowUpQueueDrain() {},
    async flushConversationHistory() {},
    // Council setup, sticky-note delivery and learned context caps are outside the restore audit as well.
    migrateDraftCouncilConfigToSession() {}, promotePendingCouncilConfig() {}, syncCouncilLeadSlotWithRoute() {},
    pendingCouncilConfigsBySession: new Map(), lastDeliveredNoteBySession: new Map(), recordLearnedRouteContextCap() {}, contextWindowForRoute: () => undefined,
    ensureAgentFinalSummary: result => result.finalText, agentBillingLabel: () => '', captureAgentBrowsers() {},
    persistActiveCodingSessionState() {}, notifyThreadContentChanged() {}, notifySystemTask() {}, codingSessionTitle: text => text,
    submitPrompt(...args) { return submission = this.executePromptSubmission(...args); },
    async pollAgentRun() { return pending; }
  });
  state.platformService.startAgentRun = async request => {
    started++; const controller = new AbortController(); let calls = 0;
    const runner = new AgentRunner({ tools, permissionMode: 'workspace_write',
      onEvent(event) { if (finish === 'cancelled' && event.type === 'tool_completed' && event.ok) controller.abort(); },
      model: { async complete() { return ++calls === 1 ? { content: 'edit', toolCalls: [{ id: randomUUID(), name: 'workspace.write_file',
        arguments: { path: 'a.txt', content: 'a3', expectedSha256: hash('a1') } }] } : { content: 'done' }; } } });
    pending = runner.run({ prompt: request.prompt, runId: randomUUID(), signal: controller.signal }).then(async result => ({
      status: result.status, pendingMessages: [], result: { ...result,
        changes: await Promise.all(result.events.filter(event => event.type === 'tool_completed' && event.summary.checkpointId)
          .map(event => runtime.getCheckpointDiff(event.summary.checkpointId))),
        route: { kind: 'official_connection', model: 'fixture', providerName: 'local deterministic model' }, billing: { kind: 'provider_direct' }, failoverCount: 0 }
    }));
    return { runId: 'accepted-run' };
  };
  const prepare = async turnId => {
    const session = state.codingSessions[0];
    state.pendingTurnEdit = { sessionId: session.id, turnId, prompt: 'replacement', pastedTextReferences: '' };
    const ids = branchHelpers.conversationCheckpointIdsToRestore(session.turns, turnId);
    state.turnEditRestoreWorkspace = true;
    state.turnEditRestorePreview = { status: 'ready', sourceState: branchHelpers.conversationHistoryStateToken(session), checkpointIds: ids,
      restorePlan: await state.createWorkspaceRestorePlan(session, ids, turnId) };
  };
  await prepare('t2'); await state.confirmTurnEdit('replace'); await submission;
  assert.equal(started, 1, JSON.stringify({ turnEditError: state.turnEditError, agentError: state.agentError, agentStage: state.agentStage })); assert.equal(state.agentStage, finish === 'completed' ? 'complete' : 'cancelled', state.agentError);
  const replacement = state.codingSessions[0].turns.at(-1);
  assert.equal(replacement.workspaceBaselines.length, 1); assert.equal(replacement.changes.length, 1);
  assert.notEqual(replacement.workspaceBaselines[0].checkpointId, replacement.changes[0].checkpointId);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'a3');
  const timeline = await runtime.restoreFileVersion({ checkpointId: first.checkpointId, side: 'before', expectedSha256: hash('a3'), conversationId: '10000000-0000-4000-8000-000000000001' });
  await state.recordContextFileVersion('session', canonical, timeline.checkpointId, replacement.id);
  assert.equal(state.codingSessions[0].turns.length, 2, 'timeline restores never delete messages');
  await prepare(replacement.id); const plan = state.turnEditRestorePreview.restorePlan;
  assert.deepEqual(plan[0].targets, [{ checkpointId: replacement.workspaceBaselines[0].checkpointId, side: 'after' }]);
  await state.platformService.restoreAgentCheckpointGroups(plan, { conversationId: 'session', turnId: 'second-edit' });
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'a1', 'must not undo the preparatory restore back to a2');
});

test('editor receipt stays on its save-start turn when a new turn appears during the diff RPC', async () => {
  const state = new Harness(), waiting = deferred();
  state.codingSessions = [{ id: 'session', turns: [{ id: 'original', changes: [] }] }];
  state.updateCodingTurn = function (sessionId, turnId, patch) {
    this.codingSessions[0].turns = this.codingSessions[0].turns.map(turn => turn.id === turnId ? { ...turn, ...patch } : turn);
  };
  state.platformService = { getAgentCheckpointDiff: () => waiting.promise };
  const recording = state.recordContextFileVersion('session', '/work', 'version');
  assert.equal(state.codingSessions[0].turns[0].fileVersionReceipts[0].checkpointId, 'version');
  state.codingSessions[0].turns.push({ id: 'newer', changes: [] });
  waiting.resolve({ checkpointId: 'version', workspaceRoot: '/work', path: 'a.ts' }); await recording;
  assert.equal(state.codingSessions[0].turns[0].changes[0].checkpointId, 'version');
  assert.deepEqual(state.codingSessions[0].turns[1].changes, []);
});

test('message restore uses the earliest owned version per physical file and leaves untouched baseline-only files alone', async () => {
  const state = new Harness();
  const diffs = [
    { checkpointId: 'a', workspaceRoot: '/one', path: 'same.ts', createdAt: '1' },
    { checkpointId: 'b', workspaceRoot: '/two', path: 'same.ts', createdAt: '1' },
    { checkpointId: 'later-a', workspaceRoot: '/two', path: '/one/same.ts', externalTarget: '/one/same.ts', createdAt: '2' },
    { checkpointId: 'baseline-a', workspaceRoot: '/one', path: 'same.ts', createdAt: '0' },
    { checkpointId: 'baseline-untouched', workspaceRoot: '/one', path: 'untouched.ts', createdAt: '0' }
  ];
  state.platformService = { getAgentCheckpointDiff: async (root, id) => {
    const diff = diffs.find(diff => diff.checkpointId === id && diff.workspaceRoot === root);
    if (!diff) throw Object.assign(new Error('wrong owner'), { code: 'ENOENT' }); return diff;
  } };
  const session = { turns: [{ id: 'edited', changes: diffs.slice(0, 3), workspaceBaselines: diffs.slice(3) }],
    workspacePath: '/one', workspaceBindings: [{ path: '/one' }, { path: '/two' }] };
  const ids = branchHelpers.conversationCheckpointIdsToRestore(session.turns, 'edited');
  const plan = await state.createWorkspaceRestorePlan(session, ids, 'edited');
  assert.deepEqual(plan.find(group => group.workspaceRoot === '/one').targets, [{ checkpointId: 'baseline-a', side: 'after' }]);
  assert.deepEqual(plan.find(group => group.workspaceRoot === '/two').targets, [{ checkpointId: 'b', side: 'before' }]);
  const failure = Object.assign(new Error('Access denied: /one/same.ts'), { code: 'EACCES' });
  state.platformService.getAgentCheckpointDiff = async () => { throw failure; };
  await assert.rejects(state.createWorkspaceRestorePlan(session, ['a'], 'edited'), error => error === failure);
});
