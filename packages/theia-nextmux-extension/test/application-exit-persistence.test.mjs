import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';
import { conversationAgentRunActive } from '../lib/browser/nextmux-conversation-agent-run.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['beginApplicationExit', 'cancelApplicationExit', 'assertApplicationExitSaved', 'shutdownForApplicationExit', 'pruneUnpersistedPastedTextReferences', 'pendingDraftAttachmentRestores'];
const methods = [];
const visit = node => {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
};
visit(file); assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const pasteHelpers = {};
new Function('exports', 'require', ts.transpile(readFileSync(new URL('../src/browser/nextmux-composer-long-paste.ts', import.meta.url), 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
}))(pasteHelpers, requireCopyFallback);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const document = { body: { inert: false } }, events = [];
  const Harness = new Function('document', 'closePersistenceText', 'requireDurablePastedTextReferences', 'conversationAgentRunActive', `${code}; return Harness;`)(
    document, (_locale, key) => key, pasteHelpers.requireDurablePastedTextReferences, conversationAgentRunActive);
  const state = new Harness();
  Object.assign(state, {
    node: { inert: false }, applicationExitGeneration: 0, applicationExitPreparing: false, desktopLocale: 'en',
    contextFileDirty: false, contextFileSaveStatus: 'idle', pendingFileSave: undefined, pendingContextFileWrites: new Set(),
    // These legacy close fixtures have no mounted editor/recovery controller.
    captureContextEditorRecovery() { assert.equal(this.contextFilePreview, undefined); return true; },
    privacySettings: { saveConversationHistory: true }, codingSessions: [{ id: 'synthetic' }],
    conversationHistoryPersistenceReady: true, conversationHistoryPersistDirty: false, conversationHistoryPersisting: false,
    prompt: '', pastedTextReferences: [], unpersistedPastedTextReferences: new Map(),
    pendingAttachmentImports: new Map(),
    draftAttachmentRestores: new Map(),
    pastedTextPersistence: new Map(), terminalRecords: [{ id: 'synthetic-terminal' }], activeTerminalRecordId: 'synthetic-terminal',
    pendingAgentSubmissions: new Set(), conversationAgentRuns: new Map(), agentChildContinuationStates: new Map(), scheduledAgentRuns: new Map(), followUpDrainReadySessionIds: new Set(), activeCodingSession() { return undefined; },
    flushComposerDraft() { events.push('draft'); }, async flushConversationHistory() { events.push('history'); },
    workspaceConfigurationSaver: { hasPendingChanges: false, async flush() { events.push('workspace'); } },
    persistTerminalRecords() { events.push('terminals-snapshot'); },
    async terminateAndDisposeConversationTerminal() { events.push('terminate'); },
    platformService: { async cancelAgentRun() { events.push('cancel-agent'); } },
    addNotification(...value) { events.push(['notice', ...value]); }, update() {},
  });
  return { state, events, document };
}

test('successful shutdown confirms persistence before disposing terminals, without a dialog', async () => {
  const { state, events, document } = fixture();
  state.beginApplicationExit();
  assert.equal(state.node.inert, true); assert.equal(document.body.inert, true);
  await state.shutdownForApplicationExit();
  assert.deepEqual(events, ['draft', 'draft', 'history', 'workspace', 'terminals-snapshot', 'terminate']);
  assert.deepEqual(state.terminalRecords, []);
});

test('a swallowed backend save failure and an in-flight or unready history never approve close', async () => {
  for (const changes of [{ conversationHistoryPersistDirty: true }, { conversationHistoryPersisting: true },
    { conversationHistoryFlushPromise: Promise.resolve() }, { conversationHistoryPersistenceReady: false }]) {
    const { state, events } = fixture(); Object.assign(state, changes);
    await assert.rejects(state.shutdownForApplicationExit(), /APPLICATION_EXIT_HISTORY_NOT_SAVED/);
    assert.equal(events.includes('terminate'), false); assert.equal(state.terminalRecords.length, 1);
  }
});

test('unsaved editor panes, pending confirmation and failed workspace preservation keep the window usable', async () => {
  for (const changes of [{ contextFileDirty: true }, { contextFileSaveStatus: 'saving' }, { pendingFileSave: {} },
    { workspaceConfigurationSaver: { hasPendingChanges: true, async flush() {} } }]) {
    const { state, events, document } = fixture(); Object.assign(state, changes); state.beginApplicationExit();
    await assert.rejects(state.shutdownForApplicationExit(), /APPLICATION_EXIT_(FILE|WORKSPACE)_NOT_SAVED/);
    state.cancelApplicationExit('failed');
    assert.equal(state.node.inert, false); assert.equal(document.body.inert, false);
    assert.equal(events.includes('terminate'), false); assert.equal(events.filter(event => Array.isArray(event)).length, 1);
  }
});

test('a cancelled generation cannot terminate terminals after its delayed flush finally finishes', async () => {
  const { state, events } = fixture(), waiting = deferred(); state.beginApplicationExit();
  state.workspaceConfigurationSaver.flush = () => waiting.promise;
  const closing = state.shutdownForApplicationExit(); await Promise.resolve();
  state.cancelApplicationExit('timeout'); waiting.resolve();
  await assert.rejects(closing, /APPLICATION_EXIT_CANCELLED/);
  assert.equal(events.includes('terminate'), false); assert.equal(state.terminalRecords.length, 1);
});

test('pending file writes are awaited even if the user already switched the preview', async () => {
  const { state, events } = fixture(), writing = deferred(); state.pendingContextFileWrites.add(writing.promise);
  const closing = state.shutdownForApplicationExit(); await Promise.resolve();
  assert.equal(events.includes('terminate'), false);
  state.pendingContextFileWrites.delete(writing.promise); writing.resolve(); await closing;
  assert.equal(events.includes('terminate'), true);
});

test('failed paste or file persistence cannot be mistaken for fulfilled allSettled completion', async () => {
  for (const kind of ['paste', 'file']) {
    const { state, events } = fixture(), pending = deferred();
    if (kind === 'paste') state.pastedTextPersistence.set('synthetic', pending.promise);
    else state.pendingContextFileWrites.add(pending.promise);
    const closing = state.shutdownForApplicationExit(); pending.reject(new Error('synthetic-private-cause'));
    await assert.rejects(closing, /APPLICATION_EXIT_(ATTACHMENT|FILE)_NOT_SAVED/);
    assert.equal(events.includes('terminate'), false);
  }
});

test('an old preview write failing while paste is pending remains part of this close acknowledgement', async () => {
  const { state, events } = fixture(), writing = deferred(), paste = deferred();
  state.pendingContextFileWrites.add(writing.promise); state.pastedTextPersistence.set('synthetic', paste.promise);
  const closing = state.shutdownForApplicationExit();
  state.pendingContextFileWrites.delete(writing.promise); writing.reject(new Error('synthetic-old-preview'));
  await Promise.resolve(); paste.resolve();
  await assert.rejects(closing, /APPLICATION_EXIT_FILE_NOT_SAVED/);
  assert.equal(events.includes('terminate'), false);
});

test('exit waits for an incognito mode commit without losing a concurrent file-write failure', async () => {
  const { state, events } = fixture(), writing = deferred(), mode = deferred();
  state.pendingContextFileWrites.add(writing.promise); state.incognitoModeOperation = mode.promise;
  const closing = state.shutdownForApplicationExit();
  state.pendingContextFileWrites.delete(writing.promise); writing.reject(new Error('synthetic-old-preview'));
  await Promise.resolve(); assert.equal(events.includes('history'), false);
  mode.resolve(); await assert.rejects(closing, /APPLICATION_EXIT_FILE_NOT_SAVED/);
  assert.equal(events.includes('terminate'), false);
});

test('the final check covers session changes made while terminal disposal was awaited', async () => {
  const { state } = fixture();
  state.terminateAndDisposeConversationTerminal = async () => { state.conversationHistoryPersistDirty = true; };
  await assert.rejects(state.shutdownForApplicationExit(), /APPLICATION_EXIT_HISTORY_NOT_SAVED/);
});

test('history opt-out and an empty pre-hydration window do not invent a pending conversation', async () => {
  for (const changes of [{ privacySettings: { saveConversationHistory: false }, conversationHistoryPersistDirty: true },
    { conversationHistoryPersistenceReady: false, codingSessions: [] }]) {
    const { state } = fixture(); Object.assign(state, changes); await state.shutdownForApplicationExit();
  }
});

test('navigation cancellation releases inert without a needless failure notification', () => {
  const { state, events, document } = fixture(); state.beginApplicationExit(); state.cancelApplicationExit('navigated');
  assert.equal(document.body.inert, false); assert.deepEqual(events, []);
});

test('close failure messages cover all twelve supported locales without external interpolation', () => {
  const localeSource = readFileSync(new URL('../src/browser/nextmux-close-persistence-locale.ts', import.meta.url), 'utf8');
  const exports = {};
  new Function('exports', 'require', ts.transpile(localeSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(exports, requireCopyFallback);
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    for (const key of ['title', 'failed', 'file']) assert.ok(exports.closePersistenceText(locale, key).length > 3);
  }
});


test('application exit detaches ordinary roots and children but explicitly stops incognito owners', async () => {
  const {state}=fixture(), calls=[];
  state.codingSessions=[{id:'ordinary'},{id:'private',incognito:true}];
  const roots=[{activeAgentSessionId:'ordinary',activeAgentRunId:'ordinary-run',agentStage:'running'},{activeAgentSessionId:'private',activeAgentRunId:'private-run',agentStage:'running'}];
  state.conversationAgentRuns=new Map(roots.map(r=>[r.activeAgentSessionId,r]));
  state.agentChildContinuationStates=new Map([['ordinary-child',{sessionId:'ordinary',runId:'ordinary-child-run',controller:new AbortController()}],['private-child',{sessionId:'private',runId:'private-child-run',controller:new AbortController()}]]);
  state.platformService.cancelAgentRun=async (id,reason)=>{calls.push([id,reason]);const root=roots.find(r=>r.activeAgentRunId===id);if(root){root.agentStage='cancelled';root.activeAgentRunId='';}};
  await state.shutdownForApplicationExit();
  assert.deepEqual(calls.sort(),[['ordinary-child-run','client_shutdown'],['ordinary-run','client_shutdown'],['private-child-run','exit_incognito'],['private-run','exit_incognito']].sort());
});
