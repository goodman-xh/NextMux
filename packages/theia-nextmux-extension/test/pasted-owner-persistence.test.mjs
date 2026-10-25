import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';

// Exercise the actual producer, draft switching and close guard together.
// Only the attachment cache is fake; raw contents never touch a user directory.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['setComposerPrompt', 'addPastedTextReference', 'removePastedTextReference', 'activePastedTextReferences',
  'pruneUnpersistedPastedTextReferences', 'persistComposerDraft', 'flushComposerDraft', 'restoreComposerDraft',
  'startNewCodingTask', 'restoreCodingSourceSelection', 'recentCodingSource', 'codingSessionRelayKey', 'assertApplicationExitSaved',
  'shutdownForApplicationExit', 'composerDraftAttachmentReferences', 'pendingDraftAttachmentRestores'];
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
const secretBody = 'SYNTHETIC_RAW_PASTE_NOT_IN_HISTORY';

function fixture() {
  const dependencies = { ...paste, ...routeHelpers, crypto: globalThis.crypto, MAX_TOTAL_ATTACHMENTS_PER_TASK: 20,
    ...createRequire(import.meta.url)('../lib/common/nextmux-price-quote.js'),
    // Restoring a conversation's model choice also restores its context window choice.
    ...createRequire(import.meta.url)('../lib/common/nextmux-context-budget.js'),
    ...createRequire(import.meta.url)('../lib/browser/nextmux-domain-error-locale.js'),
    requestAnimationFrame() {}, window: { clearTimeout() {} } };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  const writes = [], persisted = [], state = new Harness();
  Object.assign(state, {
    prompt: '', activeCodingSessionId: 'A', codingSessions: [{ id: 'A', turns: [], pinned: false }],
    activeRelayKey: '', activeModelRouteId: '', selectedModelIds: { coding: '', comic: '' },
    platformCatalog: { offerings: [] }, officialModels: { connections: [] },
    attachments: [], pastedTextReferences: [], pastedTextPersistence: new Map(), unpersistedPastedTextReferences: new Map(),
    pendingAttachmentImports: new Map(),
    draftAttachmentRestores: new Map(),
    editedTurnAttachmentOrder: [], desktopLocale: 'en', attachmentError: '', node: { querySelector() { return null; } },
    applicationExitGeneration: 0, contextFileDirty: false, contextFileSaveStatus: 'idle', pendingContextFileWrites: new Set(),
    // Paste ownership fixtures have no mounted file editor; retain the actual close guards below.
    captureContextEditorRecovery() { assert.equal(this.contextFilePreview, undefined); return true; },
    detachContextEditorRecovery() { return this.captureContextEditorRecovery(); },
    privacySettings: { saveConversationHistory: true }, conversationHistoryPersistenceReady: true,
    conversationHistoryPersistDirty: false, conversationHistoryPersisting: false,
    workspaceConfigurationSaver: { hasPendingChanges: false, async flush() {} },
    pendingAgentSubmissions: new Set(), terminalRecords: [{ id: 'synthetic-terminal' }],
    async flushConversationHistory() {}, persistTerminalRecords() {},
    async terminateAndDisposeConversationTerminal() { throw new Error('TERMINAL_MUST_STAY_ALIVE'); },
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    nextComposerAttachmentOrdinal() { return this.pastedTextReferences.length + 1; },
    codingSessionWorkspaceRoot() { return ''; }, codingSessionTitle() { return 'synthetic'; },
    bytesToBase64(bytes) { return Buffer.from(bytes).toString('base64'); },
    platformService: { cacheDesktopAttachment(request) { const operation = deferred(); writes.push({ request, ...operation }); return operation.promise; } },
    persistCodingSessions() { persisted.push(JSON.stringify(this.codingSessions)); },
    persistActiveCodingSessionState() {}, rememberNavigation() {}, persistDesktopRestoreState() {}, update() {},
    // No mounted conversation tabs in this paste-ownership fixture.
    disconnectInactiveConversationTabs() {}
  });
  const add = (text = secretBody) => {
    state.addPastedTextReference(text, { selectionStart: state.prompt.length, selectionEnd: state.prompt.length });
    return state.pastedTextReferences.at(-1);
  };
  const switchTo = id => {
    state.startNewCodingTask();
    assert.equal(state.activeRelayKey, ''); assert.equal(state.activeModelRouteId, ''); assert.equal(state.selectedModelIds.coding, '');
    if (!state.codingSessions.some(session => session.id === id)) state.codingSessions.push({ id, turns: [], pinned: false });
    state.activeCodingSessionId = id;
    state.restoreComposerDraft(state.activeCodingSession());
  };
  const settle = () => Promise.all([...state.pastedTextPersistence.values()]);
  const cached = (name = 'A') => ({ uri: `file:///synthetic-owned/${name}.txt`, name: `${name}.txt`, size: 64 });
  return { state, writes, persisted, add, switchTo, settle, cached };
}

test('actual producer failure is fulfilled but durable close guard preserves current raw paste', async () => {
  const f = fixture(), reference = f.add(); f.state.flushComposerDraft();
  f.writes[0].reject(new Error('synthetic-cache-error')); await f.settle();
  assert.equal(f.state.pastedTextPersistence.size, 0);
  assert.equal(f.state.pastedTextReferences[0].content, secretBody);
  assert.throws(() => f.state.assertApplicationExitSaved(0), /^Error: APPLICATION_EXIT_ATTACHMENT_NOT_SAVED$/);
  await assert.rejects(f.state.shutdownForApplicationExit(), /^Error: APPLICATION_EXIT_ATTACHMENT_NOT_SAVED$/);
  assert.equal(f.state.terminalRecords.length, 1);
  assert.ok(f.persisted.every(value => !value.includes(secretBody)));
  f.state.removePastedTextReference(reference.id);
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0));
});

test('shutdown begun during the actual producer still rejects its internally caught cache failure', async () => {
  const f = fixture(); f.add();
  const closing = f.state.shutdownForApplicationExit();
  f.writes[0].reject(new Error('synthetic-cache-error')); await f.settle();
  await assert.rejects(closing, /^Error: APPLICATION_EXIT_ATTACHMENT_NOT_SAVED$/);
  assert.equal(f.state.terminalRecords.length, 1);
});

test('late successful cache fills original session after real new-conversation switch, without touching current draft', async () => {
  const f = fixture(), reference = f.add(); f.switchTo('B'); f.state.prompt = 'B stays unchanged'; f.state.flushComposerDraft();
  f.writes[0].resolve(f.cached()); await f.settle();
  const original = f.state.codingSessions.find(session => session.id === 'A');
  assert.equal(JSON.parse(original.draftPastedTextReferences)[0].id, reference.id);
  assert.equal(f.state.prompt, 'B stays unchanged'); assert.deepEqual(f.state.pastedTextReferences, []);
  assert.equal(f.state.unpersistedPastedTextReferences.size, 0);
  f.switchTo('A');
  assert.equal(f.state.pastedTextReferences[0].attachment.uri, f.cached().uri);
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0));
  assert.ok(f.persisted.every(value => !value.includes(secretBody)));
});

test('late failure remains restorable under original owner and blocks close from another session', async () => {
  const f = fixture(), reference = f.add(); f.switchTo('B'); f.state.attachmentError = 'B status';
  f.writes[0].reject(new Error('A error should not display in B')); await f.settle();
  assert.equal(f.state.attachmentError, 'B status');
  assert.throws(() => f.state.assertApplicationExitSaved(0), /APPLICATION_EXIT_ATTACHMENT_NOT_SAVED/);
  f.switchTo('A');
  assert.equal(f.state.pastedTextReferences[0].id, reference.id);
  assert.equal(f.state.pastedTextReferences[0].content, secretBody);
  f.state.prompt = ''; f.state.flushComposerDraft();
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0));
});

test('removed references, cleared owner drafts and deleted sessions never resurrect after late cache', async () => {
  for (const action of ['remove', 'clear', 'delete']) {
    const f = fixture(), reference = f.add();
    if (action === 'remove') f.state.removePastedTextReference(reference.id);
    else {
      f.switchTo('B');
      if (action === 'clear') f.state.codingSessions = f.state.codingSessions.map(session => session.id === 'A'
        ? { ...session, draftPrompt: undefined, draftPastedTextReferences: undefined } : session);
      else f.state.codingSessions = f.state.codingSessions.filter(session => session.id !== 'A');
    }
    f.writes[0].resolve(f.cached()); await f.settle();
    assert.equal(f.state.unpersistedPastedTextReferences.size, 0);
    assert.ok(f.state.codingSessions.every(session => !session.draftPastedTextReferences));
    assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0));
  }
});

test('two sessions can finish cache operations out of order without swapping references or errors', async () => {
  for (const firstFails of [false, true]) {
    const f = fixture(), a = f.add(`${secretBody}_A`); f.switchTo('B'); const b = f.add(`${secretBody}_B`);
    f.writes[1].resolve(f.cached('B'));
    await f.state.pastedTextPersistence.get(b.id);
    if (firstFails) f.writes[0].reject(new Error('private A cause')); else f.writes[0].resolve(f.cached('A'));
    await f.settle();
    assert.equal(f.state.attachmentError, '');
    assert.equal(f.state.pastedTextReferences[0].id, b.id);
    assert.equal(f.state.pastedTextReferences[0].attachment.uri, f.cached('B').uri);
    f.switchTo('A');
    assert.equal(f.state.pastedTextReferences[0].id, a.id);
    if (firstFails) {
      assert.equal(f.state.pastedTextReferences[0].content, `${secretBody}_A`);
      assert.throws(() => f.state.assertApplicationExitSaved(0), /APPLICATION_EXIT_ATTACHMENT_NOT_SAVED/);
    } else assert.equal(f.state.pastedTextReferences[0].attachment.uri, f.cached('A').uri);
    assert.ok(f.persisted.every(value => !value.includes(secretBody)));
  }
});

test('switching back before completion reattaches the pending raw reference and then the durable receipt', async () => {
  const f = fixture(), a = f.add(); f.switchTo('B'); f.switchTo('A');
  assert.equal(f.state.pastedTextReferences[0].content, secretBody);
  f.writes[0].resolve(f.cached()); await f.settle();
  assert.equal(f.state.pastedTextReferences[0].id, a.id);
  assert.equal(f.state.pastedTextReferences[0].attachment.uri, f.cached().uri);
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0));
});

test('invalid durable receipt and history opt-out do not silently discard still referenced in-memory text', async () => {
  const f = fixture(); f.add(); f.state.privacySettings.saveConversationHistory = false;
  f.writes[0].resolve({ uri: '', size: 0 }); await f.settle();
  assert.throws(() => f.state.assertApplicationExitSaved(0), /APPLICATION_EXIT_ATTACHMENT_NOT_SAVED/);
  assert.equal(f.state.pastedTextReferences[0].content, secretBody);
});
