import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function methods(path, className, names) {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const type = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  assert(type);
  return names.map(name => {
    const method = type.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert(method, name); return method.getText(file);
  }).join('\n');
}
const widgetMethods = methods('../src/browser/nextmux-desktop-widget.tsx', 'NextMuxDesktopWidget',
  ['beginTurnEdit', 'requestTurnEditConfirmation', 'confirmTurnEdit', 'setPermissionMode', 'confirmFullAccess']);
const bindings = {
  conversationHistoryStateToken: session => JSON.stringify(session),
  bindPriceQuote: route => route,
  conversationText: (_locale, key) => key,
  runningTaskText: (_locale, key) => key,
  localizeDesktopSurface: (_locale, text) => text,
  desktopDomainErrorText: (_locale, error) => error.message,
  ConversationAttachmentRecoveryError: class extends Error {},
  window: {}
};
const Widget = Function(...Object.keys(bindings), ts.transpile(`class Harness { ${widgetMethods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const trace = [], stopped = defer();
  const a = { id: 'a', updatedAt: 1, permissionMode: 'full_access', routeId: 'missing', turns: [{ id: 'a-turn', prompt: 'original', stage: 'running', permissionMode: 'full_access' }] };
  const b = { id: 'b', updatedAt: 1, permissionMode: 'read_only', turns: [{ id: 'b-turn', prompt: 'unrelated', stage: 'running', permissionMode: 'read_only' }] };
  const widget = Object.assign(new Widget(), {
    codingSessions: [a, b], activeCodingSessionId: 'a', permissionMode: 'full_access', desktopLocale: 'en',
    conversationHistoryLoadGeneration: 0, turnEditSubmitting: false, turnEditError: '', editingTurnId: '',
    conversationHistoryReady: () => true, conversationHasActiveRun: id => id === 'a' && a.turns[0].stage === 'running',
    update() {}, focusTurnEditor() {}, flushComposerDraft() {}, rememberNavigation() {}, completeNavigationSurface() {},
    resetTurnEditRestore() { this.turnEditRestoreWorkspace = false; this.turnEditRestorePreview = { status: 'idle' }; },
    async stopConversationAgentRun(id, join) { trace.push(['stop', id, join]); await stopped.promise; a.turns[0].stage = 'cancelled'; trace.push(['settled', id]); },
    codingSessionRelayKey: () => 'relay-a', routesForRelay() { trace.push(['route']); return []; },
    persistActiveCodingSessionState(touch) {
      trace.push(['persist', this.activeCodingSessionId, touch]);
      const owner = this.codingSessions.find(session => session.id === this.activeCodingSessionId);
      if (owner) owner.permissionMode = this.permissionMode;
    },
    persistCodingSessions() { trace.push(['persist-all']); }
  });
  return { widget, a, b, trace, stopped };
}

test('editing and preparing a running message does not stop either conversation', () => {
  const { widget, a, b, trace } = fixture();
  widget.beginTurnEdit('a', 'a-turn');
  assert.equal(widget.editingTurnValue, 'original');
  widget.editingTurnValue = 'edited';
  widget.requestTurnEditConfirmation('a', 'a-turn');
  assert.equal(widget.pendingTurnEdit.prompt, 'edited');
  assert.equal(a.turns[0].stage, 'running'); assert.equal(b.turns[0].stage, 'running');
  assert.deepEqual(trace, []);
});

test('send waits for only its original run to settle before touching history or dispatch', async () => {
  const { widget, a, b, trace, stopped } = fixture();
  widget.beginTurnEdit('a', 'a-turn'); widget.editingTurnValue = 'edited'; widget.requestTurnEditConfirmation('a', 'a-turn');
  const saving = widget.confirmTurnEdit('replace');
  await Promise.resolve();
  assert.deepEqual(trace, [['stop', 'a', true]]);
  assert.equal(widget.turnEditSubmitting, true); assert.equal(a.turns[0].prompt, 'original');
  stopped.resolve(); await saving;
  assert.deepEqual(trace, [['stop', 'a', true], ['settled', 'a'], ['route']]);
  assert.equal(widget.turnEditError, 'routeUnavailable', 'normal dispatch validation happens only after cancellation');
  assert.equal(widget.pendingTurnEdit.prompt, 'edited', 'failed validation preserves the edit');
  assert.equal(b.turns[0].stage, 'running'); assert.equal(b.turns[0].prompt, 'unrelated');
});

test('an unconfirmed cancellation preserves the edit and never dispatches a replacement', async () => {
  const { widget, a, trace, stopped } = fixture();
  widget.beginTurnEdit('a', 'a-turn'); widget.editingTurnValue = 'edited'; widget.requestTurnEditConfirmation('a', 'a-turn');
  const saving = widget.confirmTurnEdit('replace'); stopped.reject(new Error('cancel not confirmed')); await saving;
  assert.equal(widget.turnEditError, 'cancel not confirmed'); assert.equal(widget.turnEditSubmitting, false);
  assert.equal(a.turns[0].prompt, 'original'); assert.equal(widget.pendingTurnEdit.prompt, 'edited');
  assert.deepEqual(trace, [['stop', 'a', true]]);
});

test('navigation while waiting to stop does not rewrite a newly visible conversation', async () => {
  const { widget, a, b, trace, stopped } = fixture();
  widget.beginTurnEdit('a', 'a-turn'); widget.editingTurnValue = 'edited'; widget.requestTurnEditConfirmation('a', 'a-turn');
  const saving = widget.confirmTurnEdit('replace');
  widget.activeCodingSessionId = 'b'; widget.pendingTurnEdit = undefined;
  stopped.resolve(); await saving;
  assert.deepEqual(trace, [['stop', 'a', true], ['settled', 'a']]);
  assert.equal(a.turns[0].prompt, 'original'); assert.equal(b.turns[0].prompt, 'unrelated');
});

test('saving next-task permissions leaves current run and other conversations unchanged', () => {
  const { widget, a, b, trace } = fixture();
  widget.setPermissionMode('read_only');
  assert.equal(a.permissionMode, 'read_only'); assert.equal(a.turns[0].permissionMode, 'full_access');
  assert.equal(a.turns[0].stage, 'running'); assert.equal(b.permissionMode, 'read_only');
  assert.deepEqual(trace, [['persist', 'a', true]]);
});

test('a full-access confirmation remains owned by the conversation that opened it', () => {
  const { widget, a, b } = fixture();
  widget.permissionMode = a.permissionMode = 'read_only';
  widget.setPermissionMode('full_access');
  widget.activeCodingSessionId = 'b'; widget.permissionMode = 'read_only';
  widget.confirmFullAccess();
  assert.equal(widget.codingSessions.find(session => session.id === 'a').permissionMode, 'full_access');
  assert.equal(b.permissionMode, 'read_only'); assert.equal(widget.permissionMode, 'read_only');
});

test('backend cancellation acknowledgement joins the actual run completion', async () => {
  const code = methods('../src/node/nextmux-platform-service.ts', 'NextMuxPlatformServiceImpl', ['cancelAgentRun']);
  const Backend = Function('PlatformRequestError', ts.transpile(`class Harness { ${code} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(Error);
  const completion = defer(), controller = new AbortController();
  const job = { status: 'running', completion: completion.promise, controller };
  const backend = Object.assign(new Backend(), { validateAgentRunId: value => value, agentJobs: new Map([['a', job]]), wakeAgentJob() {} });
  let acknowledged = false;
  const cancelling = backend.cancelAgentRun('a').then(result => { acknowledged = true; return result; });
  await Promise.resolve(); assert.equal(controller.signal.aborted, true); assert.equal(acknowledged, false);
  completion.resolve(); assert.deepEqual(await cancelling, { cancelled: true, status: 'cancelled' });
});
