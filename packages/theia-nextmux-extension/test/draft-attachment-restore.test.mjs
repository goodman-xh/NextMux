import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';

const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['setComposerPrompt', 'pendingDraftAttachmentRestores', 'hasPendingDraftAttachments', 'hasUnresolvedDraftAttachments',
  'unresolvedDraftAttachmentReferences', 'composerDraftAttachmentReferences', 'appendOwnedAttachment',
  'queuedAttachmentReference', 'activePastedTextReferences', 'pruneUnpersistedPastedTextReferences', 'persistComposerDraft',
  'flushComposerDraft', 'restoreComposerDraft', 'retryDraftAttachments', 'renderUnresolvedDraftAttachments',
  'removeAttachment', 'startNewCodingTask', 'restoreCodingSourceSelection', 'recentCodingSource', 'codingSessionRelayKey',
  'assertApplicationExitSaved', 'shutdownForApplicationExit'];
const methods = [];
function visit(node) {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file); assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
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
const reference = id => ({ id, uri: `file:///synthetic-owned/${id}`, name: `${id}.txt`, size: 3, kind: 'file', mimeType: 'text/plain' });
const record = (id, marker = 'RAW_BYTES_NOT_IN_HISTORY') => ({ ...reference(id), attachment: { kind: 'file', name: `${id}.txt`, mimeType: 'text/plain', dataBase64: marker } });

function fixture(ids = ['old']) {
  const dependencies = { ...paste, ...routeHelpers, ...require('../lib/browser/nextmux-conversation-agent-run.js'), React, MAX_TOTAL_ATTACHMENTS_PER_TASK: 20, MAX_FILE_ATTACHMENTS_PER_TASK: 8, MAX_ATTACHMENT_TOTAL_BYTES: 32 * 1024 * 1024,
    ...require('../lib/common/nextmux-price-quote.js'),
    // Restoring a conversation's model choice also restores its context window choice.
    ...require('../lib/common/nextmux-context-budget.js'),
    ...require('../lib/browser/nextmux-composer-attachments.js'),
    requestAnimationFrame() {}, window: { clearTimeout() {} },
    conversationText: (_locale, _key, values) => `Cannot restore ${values?.name || 'attachment'}`,
    localizeDesktopSurface: (_locale, text) => text };
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  const state = new Harness(), reads = [], snapshots = [];
  Object.assign(state, {
    conversationAgentRuns: new Map(),
    prompt: '', activeCodingSessionId: 'A', codingSessions: [{ id: 'A', turns: [], draftAttachments: ids.map(reference) }],
    activeRelayKey: '', activeModelRouteId: '', selectedModelIds: { coding: '', comic: '' },
    platformCatalog: { offerings: [] }, officialModels: { connections: [] },
    attachments: [], pastedTextReferences: [], unpersistedPastedTextReferences: new Map(), draftAttachmentRestores: new Map(),
    pendingAttachmentImports: new Map(), pastedTextPersistence: new Map(), pendingContextFileWrites: new Set(), pendingAgentSubmissions: new Set(),
    terminalRecords: [{ id: 'terminal' }], editedTurnAttachmentOrder: [], desktopLocale: 'en', attachmentError: '',
    applicationExitGeneration: 0, applicationExitPreparing: false, node: { querySelector() {} },
    // Composer restore/close fixtures do not mount a file editor or recovery controller.
    captureContextEditorRecovery() { assert.equal(this.contextFilePreview, undefined); return true; },
    detachContextEditorRecovery() { return this.captureContextEditorRecovery(); },
    privacySettings: { saveConversationHistory: true }, conversationHistoryPersistenceReady: true,
    workspaceConfigurationSaver: { hasPendingChanges: false, async flush() {} },
    async flushConversationHistory() {}, persistTerminalRecords() {}, async terminateAndDisposeConversationTerminal() {},
    activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
    nextComposerAttachmentOrdinal() { return this.attachments.length + 1; }, codingSessionTitle() { return 'synthetic'; },
    resolveAttachmentReferences(refs, session) { const waiting = deferred(); reads.push({ id: refs[0].id, owner: session.id, ...waiting }); return waiting.promise; },
    persistCodingSessions() { snapshots.push(JSON.stringify(this.codingSessions)); },
    persistActiveCodingSessionState() {}, rememberNavigation() {}, persistDesktopRestoreState() {}, update() {},
    disconnectInactiveConversationTabs() {},
    scheduleComposerDraftPersist() { this.persistComposerDraft(); }, tx: key => key === 'retry' ? 'Retry' : key, formatMediaSize: size => `${size} B`,
  });
  const restore = () => { state.restoreComposerDraft(state.activeCodingSession()); return state.pendingDraftAttachmentRestores()[0]; };
  const switchTo = id => {
    state.startNewCodingTask();
    assert.equal(state.activeRelayKey, ''); assert.equal(state.activeModelRouteId, ''); assert.equal(state.selectedModelIds.coding, '');
    if (!state.codingSessions.some(session => session.id === id)) state.codingSessions.push({ id, turns: [] });
    state.activeCodingSessionId = id; return restore();
  };
  return { state, reads, snapshots, restore, switchTo };
}

test('actual draft persistence keeps original metadata during asynchronous restore and close waits for it', async () => {
  const f = fixture(), restoring = f.restore(); await tick();
  f.state.prompt = 'new prompt while loading'; f.state.persistComposerDraft();
  assert.deepEqual(f.state.codingSessions[0].draftAttachments.map(item => item.id), ['old']);
  const closing = f.state.shutdownForApplicationExit(); await tick();
  assert.equal(f.state.terminalRecords.length, 1);
  f.reads[0].resolve([record('old')]); await Promise.all([restoring, closing]);
  assert.deepEqual(f.state.codingSessions[0].draftAttachments.map(item => item.id), ['old']);
  assert.ok(f.snapshots.every(value => !value.includes('RAW_BYTES_NOT_IN_HISTORY')));
});

test('new attachment and recovering originals retain original order and share one real capacity bound', async () => {
  const f = fixture(Array.from({ length: 7 }, (_, i) => `old-${i}`)), restoring = f.restore(); await tick();
  f.state.appendOwnedAttachment('A', record('new'));
  assert.equal(f.state.composerDraftAttachmentReferences().length, 8);
  assert.throws(() => f.state.appendOwnedAttachment('A', record('overflow')), /8/);
  f.reads.forEach(read => read.resolve([record(read.id)])); await restoring;
  assert.deepEqual(f.state.attachments.map(item => item.id), [...Array.from({ length: 7 }, (_, i) => `old-${i}`), 'new']);
  assert.equal(f.state.codingSessions[0].draftAttachments.length, 8);
});

test('A to B to A starts a fresh restore and an older completion cannot replace the new bytes', async () => {
  const f = fixture(), old = f.restore(); await tick(); f.switchTo('B'); const current = f.switchTo('A'); await tick();
  f.reads[1].resolve([record('old', 'NEWER')]); await current;
  f.reads[0].resolve([record('old', 'OLDER')]); await old;
  assert.equal(f.state.attachments[0].attachment.dataBase64, 'NEWER');
  assert.equal(f.state.pendingDraftAttachmentRestores().length, 0);
});

test('inactive owner success never populates another composer, and deletion discards a late result', async () => {
  for (const deleted of [false, true]) {
    const f = fixture(), restoring = f.restore(); await tick(); f.switchTo('B');
    if (deleted) f.state.codingSessions = f.state.codingSessions.filter(session => session.id !== 'A');
    f.reads[0].resolve([record('old')]); await restoring;
    assert.deepEqual(f.state.attachments, []); assert.equal(f.state.draftAttachmentRestores.has('A'), false);
    if (!deleted) assert.deepEqual(f.state.codingSessions.find(session => session.id === 'A').draftAttachments.map(item => item.id), ['old']);
  }
});

test('partial failure preserves missing metadata, exposes no fake bytes, and offers exact remove plus retry', async () => {
  const f = fixture(['ok', 'missing']), restoring = f.restore(); await tick();
  f.reads[0].resolve([record('ok')]); f.reads[1].reject(new Error('SYNTHETIC_PRIVATE_READ_ERROR')); await restoring;
  assert.deepEqual(f.state.attachments.map(item => item.id), ['ok']);
  f.state.persistComposerDraft(); assert.deepEqual(f.state.codingSessions[0].draftAttachments.map(item => item.id), ['ok', 'missing']);
  assert.equal(f.state.hasUnresolvedDraftAttachments('A'), true); assert.equal(f.state.hasPendingDraftAttachments('A'), false);
  assert.doesNotMatch(f.state.attachmentError, /PRIVATE_READ/);
  const markup = renderToStaticMarkup(f.state.renderUnresolvedDraftAttachments());
  assert.match(markup, /missing\.txt/); assert.match(markup, /aria-label="Retry"/); assert.match(markup, /移除 missing\.txt/);
  assert.doesNotMatch(markup, /<img|dataBase64|RAW_BYTES|nmx-attachment-preview/);
  assert.doesNotThrow(() => f.state.assertApplicationExitSaved(0)); // Durable metadata survives; failed read is not forced data deletion.
  f.state.removeAttachment('missing');
  assert.equal(f.state.hasUnresolvedDraftAttachments('A'), false);
  assert.deepEqual(f.state.codingSessions[0].draftAttachments.map(item => item.id), ['ok']);
});

test('removing a visible metadata placeholder before late success cannot revive it', async () => {
  const f = fixture(['keep', 'remove']), restoring = f.restore(); await tick();
  assert.match(renderToStaticMarkup(f.state.renderUnresolvedDraftAttachments()), /移除 remove\.txt/);
  f.state.removeAttachment('remove');
  f.reads.forEach(read => read.resolve([record(read.id)])); await restoring;
  assert.deepEqual(f.state.attachments.map(item => item.id), ['keep']);
  assert.deepEqual(f.state.codingSessions[0].draftAttachments.map(item => item.id), ['keep']);
});

test('retry operates on the current persisted draft and clears unresolved state only after real success', async () => {
  const f = fixture(), first = f.restore(); await tick(); f.reads[0].reject(new Error('missing')); await first;
  f.state.prompt = 'do not replace this edit'; f.state.retryDraftAttachments();
  const retry = f.state.pendingDraftAttachmentRestores()[0]; await tick();
  assert.equal(f.state.prompt, 'do not replace this edit'); assert.equal(f.state.hasPendingDraftAttachments('A'), true);
  f.reads[1].resolve([record('old')]); await retry;
  assert.equal(f.state.hasUnresolvedDraftAttachments('A'), false); assert.equal(f.state.attachmentError, '');
  assert.equal(f.state.codingSessions[0].draftPrompt, 'do not replace this edit');
});

test('two explicit restores use separate identities and deleted all placeholders do not keep close pending', async () => {
  const f = fixture(), first = f.restore(); await tick(); const second = f.restore(); await tick();
  f.state.removeAttachment('old'); assert.deepEqual(f.state.pendingDraftAttachmentRestores(), []);
  f.reads.forEach(read => read.resolve([record(read.id)])); await Promise.all([first, second]);
  assert.deepEqual(f.state.attachments, []); assert.equal(f.state.codingSessions[0].draftAttachments, undefined);
});
