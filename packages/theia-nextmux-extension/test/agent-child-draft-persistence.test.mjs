import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Compile current source in memory: no stale lib, profile, network or product build is used.
const src = fileURLToPath(new URL('../src/', import.meta.url)), cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  const require = createRequire(path);
  const localRequire = name => {
    if (name.startsWith('.')) {
      const base = resolve(dirname(path), name), candidate = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (candidate?.endsWith('.ts') || candidate?.endsWith('.tsx')) return load(candidate);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
  }).outputText)(localRequire, module, module.exports);
  return module.exports;
}
const drafts = load(join(src, 'common/nextmux-agent-child-drafts.ts'));
const history = load(join(src, 'browser/nextmux-conversation-history.ts'));
const persistence = load(join(src, 'browser/nextmux-conversation-persistence.ts'));
const { ConversationStore } = load(join(src, 'node/nextmux-conversation-store.ts'));
const { ConversationArchiveService } = load(join(src, 'node/nextmux-conversation-archive.ts'));
const { agentChildDraftText } = load(join(src, 'browser/nextmux-agent-child-draft-locale.ts'));
const widget = readFileSync(join(src, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map(); let input;
function visit(node) {
  if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast));
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onChange'
    && node.initializer?.expression?.getText(ast).includes('this.setAgentChildDraft(draftOwner')) input = node.initializer.expression.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(input);
const names = ['childDraft', 'setAgentChildDraft', 'findAgentChild', 'persistCodingSessions', 'writeConversationHistoryMirror',
  'changedStartupChildDraftCount', 'conversationHistoryReady',
  'scheduleConversationHistoryPersist', 'refreshConversationHistoryPersistDirty', 'flushConversationHistory',
  'executeAgentChildContinuation', 'createCodingSessionBranch', 'assertApplicationExitSaved'];
const code = ts.transpile(`class Harness { ${names.map(name => { assert.ok(methods.has(name)); return methods.get(name); }).join('\n')}
  input(draftOwner,event) { return (${input})(event); } }`, { target: ts.ScriptTarget.ES2022 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const child = () => ({ childRunId: 'child-a', rootRunId: 'root-a', parentRunId: 'root-a', task: 'Synthetic child', status: 'completed', depth: 1,
  events: [], taskContext: { version: 1, depth: 1, parentRunId: 'root-a', rootRunId: 'root-a', workspaceRoot: '/synthetic', goal: 'Synthetic child', permissionMode: 'read_only', constraints: [], relevantPaths: [], recentOperations: [], selectedMemory: [] },
  result: { resumeCheckpointId: 'checkpoint-a', finalText: 'completed' } });
const session = (id = 'session-a') => ({ id, title: id, workspacePath: '/synthetic', createdAt: 1, updatedAt: 2,
  turns: [{ id: 'turn-a', prompt: 'parent', response: '', error: '', stage: 'complete', createdAt: 1, childAgents: [child()] }] });
const owner = id => ({ sessionId: id || 'session-a', turnId: 'turn-a', childRunId: 'child-a', rootRunId: 'root-a' });
function fixture() {
  const timers = [], notices = [], mirror = new Map();
  const dependencies = { ...load(join(src, 'browser/nextmux-model-errors.ts')), ...load(join(src, 'browser/nextmux-domain-error-locale.ts')), ...drafts, ...history, ...persistence, agentChildDraftText,
    ...load(join(src, 'common/nextmux-model-controls.ts')),
    ...load(join(src, 'common/nextmux-price-quote.ts')),
    ...load(join(src, 'common/nextmux-context-budget.ts')),
    ...load(join(src, 'common/nextmux-relay-switch.ts')),
    NEXTMUX_DESKTOP_LOCALES: load(join(src, 'browser/nextmux-locale.ts')).NEXTMUX_DESKTOP_LOCALES,
    historyReadinessText: load(join(src, 'browser/nextmux-history-readiness-locale.ts')).historyReadinessText,
    agentChildText: (_locale, key) => key, conversationText: () => 'branch',
    window: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
      localStorage: { setItem: (key, value) => mirror.set(key, value), removeItem: key => mirror.delete(key) } } };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  const state = new Harness();
  Object.assign(state, { codingSessions: [session()], activeCodingSessionId: 'session-a', liveAgentChildren: [],
    applicationExitPreparing: false, applicationExitGeneration: 0, desktopLocale: 'en',
    privacySettings: { saveConversationHistory: true }, conversationHistoryRevision: 0,
    conversationHistoryPersistedSessions: persistence.createConversationPersistenceBaseline([]), conversationHistoryPersistenceReady: true,
    activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); },
    // The durable-recovery approval step (its own dialog and tests) approves here.
    prepareDurableRecovery: async () => ({ proceed: true }),
    addNotification(...args) { notices.push(args); }, update() {}, platformService: { async patchConversationHistory() {} },
    // Child-draft tests do not instantiate the native conversation-window
    // coordinator. Keep this production side effect inert while satisfying
    // the current persistence path's publish hook.
    async publishConversationWindowChanges() {},
    agentChildContinuationStates: new Map(), agentChildSubmitting: new Set(), childContinuationHandle: item => item.result?.resumeCheckpointId,
    codingRouteForSession: () => ({ kind: 'official_connection', connection: { id: 'synthetic', model: 'synthetic' } }),
    codingSessionWorkspaceRoot: () => '/synthetic', async prepareAgentSkills() { return []; }, managedModelRoute() {},
    modelReasoningContract() {}, reasoningSettingsForRoute() {}, reasoningEffortForRoute() {}, selectedTerminalProfile() {},
    updateCodingChildSnapshot() {}, async pollAgentChildRun() {},
    pendingAttachmentImports: new Map(), pendingDraftAttachmentRestores: () => [], pruneUnpersistedPastedTextReferences() {},
    pastedTextReferences: [], prompt: '', unpersistedPastedTextReferences: new Map(),
    contextFileDirty: false, pendingContextFileWrites: new Set(), workspaceConfigurationSaver: { hasPendingChanges: false },
  });
  return { state, timers, notices, mirror };
}
// assertApplicationExitSaved shares this no-op only for unrelated pasted-attachment validation.
// Supply the actual close method with no attachments and the production child/history state.
const originalFunction = globalThis.Function;

test('actual child input writes exact owner text through mirror and atomic backend, then restores after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-child-draft-')); t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(), store = new ConversationStore(root), text = '  Continue this child\n中文 <script>not HTML</script>  ';
  f.state.platformService.patchConversationHistory = request => store.patch(request.upserts, request.removedSessionIds);
  f.state.input(owner(), { currentTarget: { value: text } });
  assert.equal(f.state.childDraft('child-a'), text); assert.equal(f.timers.length, 1);
  assert.equal(history.readConversationHistoryMirror(f.mirror.get('nextmux.desktop.codingSessions.v1')).sessions[0].agentChildDrafts[0].text, text);
  await f.state.flushConversationHistory(); assert.equal(f.state.conversationHistoryPersistDirty, false);
  const restarted = fixture(); restarted.state.codingSessions = (await new ConversationStore(root).load()).sessions;
  assert.equal(restarted.state.childDraft('child-a'), text); assert.equal(restarted.state.codingSessions[0].turns.length, 1);
  assert.deepEqual(Object.keys(restarted.state.codingSessions[0].agentChildDrafts[0]).sort(), ['childRunId', 'rootRunId', 'text', 'turnId']);
});

test('failed persistence leaves the unsent draft dirty and does not claim close success', async () => {
  const f = fixture(); f.state.input(owner(), { currentTarget: { value: 'unsent' } });
  f.state.platformService.patchConversationHistory = async () => { throw new Error('synthetic storage failure'); };
  await f.state.flushConversationHistory();
  assert.equal(f.state.childDraft('child-a'), 'unsent'); assert.equal(f.state.conversationHistoryPersistDirty, true);
  assert.equal(f.notices.length, 1);
  // Assert the actual exit method reaches its unsaved-history rejection, not a copied condition.
  const Close = new originalFunction('requireDurablePastedTextReferences', ts.transpile(`class Close { ${methods.get('assertApplicationExitSaved')} }; return Close;`, { target: ts.ScriptTarget.ES2022 }))(() => {});
  assert.throws(() => Close.prototype.assertApplicationExitSaved.call(f.state, 0), /APPLICATION_EXIT_HISTORY_NOT_SAVED/);
});

test('an accepted continuation clears only equal bytes from its captured original owner, never a new owner or input', async () => {
  for (const newerInput of [false, true]) {
    const f = fixture(), accepted = deferred(); f.state.codingSessions.push(session('session-b'));
    f.state.input(owner(), { currentTarget: { value: 'submitted A' } });
    f.state.platformService.startAgentRun = () => accepted.promise;
    const pending = f.state.executeAgentChildContinuation('child-a'); await new Promise(resolve => setImmediate(resolve));
    f.state.activeCodingSessionId = 'session-b'; f.state.input(owner('session-b'), { currentTarget: { value: 'B stays' } });
    if (newerInput) f.state.input(owner(), { currentTarget: { value: 'new A stays' } });
    accepted.resolve({ runId: 'accepted-a' }); await pending;
    assert.equal(f.state.childDraft('child-a'), 'B stays');
    assert.equal(f.state.childDraft('child-a', owner()), newerInput ? 'new A stays' : '');
    assert.ok(f.state.codingSessions[0].agentChildDraftsUpdatedAt > 0);
  }
});

test('preparation failure, rejected start and close during preparation keep exact unsent input', async () => {
  for (const mode of ['prepare', 'start', 'closing']) {
    const f = fixture(); f.state.input(owner(), { currentTarget: { value: '  preserved  ' } });
    f.state.prepareAgentSkills = async () => { if (mode === 'prepare') throw new Error('synthetic'); if (mode === 'closing') f.state.applicationExitPreparing = true; return []; };
    f.state.platformService.startAgentRun = async () => { throw new Error('synthetic'); };
    await f.state.executeAgentChildContinuation('child-a'); assert.equal(f.state.childDraft('child-a'), '  preserved  ');
  }
});

test('branch duplicates child ids but never inherits unsent text; stale owner/root/deleted session cannot receive edits', () => {
  const f = fixture(); f.state.input(owner(), { currentTarget: { value: 'source only' } });
  const source = f.state.codingSessions[0], branch = f.state.createCodingSessionBranch(source, source.turns, undefined, 3);
  f.state.codingSessions.push(branch); f.state.activeCodingSessionId = branch.id;
  assert.equal(f.state.childDraft('child-a'), ''); assert.equal(f.state.childDraft('child-a', owner()), 'source only');
  f.state.setAgentChildDraft({ ...owner(), rootRunId: 'wrong-root' }, 'wrong');
  assert.equal(f.state.childDraft('child-a', owner()), 'source only');
  f.state.codingSessions = [branch]; f.state.setAgentChildDraft(owner(), 'late'); assert.equal(f.state.codingSessions.length, 1);
  assert.equal(f.state.childDraft('child-a'), '');
});

test('partial mirror retains older draft owners; newer empty collection beats stale backend without losing unrelated history', () => {
  const f = fixture(); f.state.input(owner(), { currentTarget: { value: 'older child text' } });
  const full = f.state.codingSessions[0]; full.turns.push(...Array.from({ length: 9 }, (_, i) => ({ id: `new-${i}`, prompt: 'new', response: 'x'.repeat(10_000), createdAt: i + 2 })));
  const limits = { sessions: 1, turnsPerSession: 1, promptCharacters: 8, responseCharacters: 8, errorCharacters: 8 };
  const partial = history.readConversationHistoryMirror(JSON.stringify(history.createConversationHistoryMirror([full], limits))).sessions;
  assert.equal(partial[0].agentChildDrafts[0].text, 'older child text'); assert.equal(partial[0].turns[0].id, 'turn-a');
  const merged = history.mergeConversationHistorySessions(partial, [full], { mutatedDuringLoad: false, initialSessionIds: new Set(['session-a']) });
  assert.equal(merged.sessions[0].turns.length, 10); assert.equal(merged.sessions[0].agentChildDrafts[0].text, 'older child text');
  f.state.setAgentChildDraft(owner(), '', 'older child text');
  const empty = history.readConversationHistoryMirror(f.mirror.get('nextmux.desktop.codingSessions.v1')).sessions;
  const cleared = history.mergeConversationHistorySessions(empty, [{ ...full, updatedAt: Date.now() + 1000 }], { mutatedDuringLoad: true, initialSessionIds: new Set(['session-a']) });
  assert.deepEqual(cleared.sessions[0].agentChildDrafts, []); assert.equal(cleared.changedFromDurable, true);
});

test('history opt-out does not create a hidden disk or localStorage path for child input', async () => {
  const f = fixture(); f.state.privacySettings.saveConversationHistory = false; let writes = 0;
  f.state.platformService.patchConversationHistory = async () => { writes++; };
  f.state.input(owner(), { currentTarget: { value: 'private unsent' } }); await f.state.flushConversationHistory();
  assert.equal(f.state.childDraft('child-a'), 'private unsent'); assert.equal(writes, 0); assert.equal(f.mirror.size, 0); assert.equal(f.timers.length, 0);
});

test('malformed/unbound drafts are discarded; quota rejects edits without truncating previous accepted text', () => {
  const f = fixture(), own = owner(); f.state.input(own, { currentTarget: { value: 'previous' } });
  f.state.input(own, { currentTarget: { value: 'x'.repeat(120_001) } }); assert.equal(f.state.childDraft('child-a'), 'previous');
  assert.equal(f.notices.length, 1);
  assert.deepEqual(drafts.normalizeAgentChildDrafts([{ ...own, text: 'valid', password: 'not part of DTO' }, { ...own, childRunId: 'absent', text: 'bad' }], f.state.codingSessions[0].turns),
    [{ turnId: 'turn-a', rootRunId: 'root-a', childRunId: 'child-a', text: 'valid' }]);
  assert.deepEqual(drafts.normalizeAgentChildDrafts([{ ...own, text: 'secret' }], [{ ...f.state.codingSessions[0].turns[0], branchUserOnly: true }]), []);
  const large = Array.from({ length: 4 }, (_, i) => ({ ...own, childRunId: `child-${i}`, text: 'x'.repeat(120_000) }));
  assert.equal(drafts.replaceAgentChildDraft(large, own, 'x'.repeat(120_000)), undefined);
  assert.equal(drafts.replaceAgentChildDraft(Array.from({ length: 32 }, (_, i) => ({ ...own, childRunId: `child-${i}`, text: 'x' })), own, 'x'), undefined);
});

test('archive explicitly omits unsent child drafts and live handles; import cannot turn them into dispatch input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-child-archive-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConversationStore(join(root, 'source')), destination = new ConversationStore(join(root, 'target'));
  const f = fixture(); f.state.input(owner(), { currentTarget: { value: 'UNSENT_PRIVATE_CHILD_TEXT' } });
  await store.save(f.state.codingSessions);
  const exporter = new ConversationArchiveService({ store, attachmentRoot: join(root, 'attachments'), readAttachment() { throw new Error('no attachments expected'); } });
  const file = join(root, 'selected.nmxarchive'); await exporter.exportFile(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(exported.warnings.includes('unsent_child_drafts_omitted')); assert.doesNotMatch(JSON.stringify(exported), /UNSENT_PRIVATE_CHILD_TEXT|checkpoint-a/);
  const importer = new ConversationArchiveService({ store: destination, attachmentRoot: join(root, 'imported'), readAttachment() { throw new Error('no attachments'); } });
  const preview = await importer.previewFile(file); assert.ok(preview.warnings.includes('unsent_child_drafts_omitted'));
  await importer.importPreview(preview.previewId, 'skip');
  assert.equal((await destination.load()).sessions[0].agentChildDrafts, undefined);
  assert.equal((await destination.load()).sessions[0].turns[0].childAgents, undefined);
});

test('all twelve locales explain quota and archive omission; UI applies the same full-text maximum', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    assert.ok(agentChildDraftText(locale, 'limit').length > 30); assert.ok(agentChildDraftText(locale, 'archiveOmitted').length > 30);
    assert.ok(agentChildDraftText(locale, 'private').length > 10);
  }
  assert.match(widget, /value=\{draftText\} maxLength=\{AGENT_CHILD_DRAFT_MAX_LENGTH\}/);
  assert.doesNotMatch(widget, /agentChildDrafts = new Map/);
});
