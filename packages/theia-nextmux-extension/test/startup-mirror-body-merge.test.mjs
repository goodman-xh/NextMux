import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as history from '../lib/browser/nextmux-conversation-history.js';
import * as persistence from '../lib/browser/nextmux-conversation-persistence.js';
import { loadConversationHistoryWithRetry } from '../lib/browser/nextmux-history-load.js';

const turn = (id, response, extra = {}) => ({ id, createdAt: 1, prompt: `full prompt ${id}`, response, ...extra });
const session = (turns, updatedAt = 10, extra = {}) => ({ id: 'A', updatedAt, historyRevision: 1, turns, ...extra });
const options = (initial, complete = false) => ({ mutatedDuringLoad: true, initialSessionIds: new Set(initial.map(value => value.id)), initialSnapshot: { complete, sessions: initial } });

test('new session timestamp from an early click cannot promote unchanged compact prompt/response/error fields', () => {
  const saved = session([turn('old', 'older full body'), turn('shared', 'full durable response', { error: 'full durable error' })]);
  const initial = session([turn('shared', 'full', { prompt: 'full', error: 'full' })]);
  const current = { ...initial, updatedAt: 20, draftPrompt: 'new unsent draft' };
  const result = history.mergeConversationHistorySessions([current], [saved], options([initial]));
  assert.deepEqual(result.sessions[0].turns, saved.turns);
  assert.equal(result.sessions[0].draftPrompt, 'new unsent draft');
  assert.equal(result.changedFromDurable, true);
});

test('explicit fields modified during startup survive without truncating their untouched sibling fields', () => {
  const saved = session([turn('t', 'full durable response', { error: 'full error', events: [{ text: 'full durable event body' }] })]);
  const initial = session([turn('t', 'full', { prompt: 'full', error: 'err', events: [{ text: 'full' }] })]);
  const current = { ...initial, updatedAt: 20, turns: [{ ...initial.turns[0], response: 'explicit replacement', error: undefined }] };
  const result = history.mergeConversationHistorySessions([current], [saved], options([initial]));
  assert.equal(result.sessions[0].turns[0].response, 'explicit replacement');
  assert.equal(result.sessions[0].turns[0].prompt, saved.turns[0].prompt);
  assert.equal(result.sessions[0].turns[0].error, undefined);
  assert.deepEqual(result.sessions[0].turns[0].events, saved.turns[0].events);
});

test('equal-value cloned fields are unchanged, while an explicit array clear is kept', () => {
  const saved = session([turn('t', 'durable', { events: [{ text: 'full body' }], changes: [{ id: 'one' }, { id: 'two' }] })]);
  const initial = session([turn('t', 'dur', { events: [{ text: 'full' }], changes: [{ id: 'one' }] })]);
  const current = JSON.parse(JSON.stringify(initial)); current.updatedAt = 20; current.turns[0].changes = [];
  const result = history.mergeConversationHistorySessions([current], [saved], options([initial]));
  assert.deepEqual(result.sessions[0].turns[0].events, saved.turns[0].events);
  assert.deepEqual(result.sessions[0].turns[0].changes, []);
});

test('new turns and durable-only sessions remain while unknown shared baselines cannot replace saved bodies', () => {
  const saved = session([turn('not-in-mirror', 'full older'), turn('shared', 'full shared')]);
  const initial = session([turn('shared', 'full')]);
  const current = session([turn('not-in-mirror', 'unproven short'), ...initial.turns, turn('new', 'new content')], 20);
  const result = history.mergeConversationHistorySessions([current], [saved, { ...session([]), id: 'B' }], options([initial]));
  assert.deepEqual(result.sessions.find(value => value.id === 'A').turns.map(value => value.response), ['full older', 'full shared', 'new content']);
  assert.ok(result.sessions.some(value => value.id === 'B'));
});

test('an actual field edit is marked dirty even when timestamps and turn-count fingerprints are equal', () => {
  const saved = session([turn('t', 'saved')]), initial = session([turn('t', 'sav')]);
  const current = { ...initial, turns: [turn('t', 'explicit new response')] };
  const result = history.mergeConversationHistorySessions([current], [saved], options([initial]));
  assert.equal(result.sessions[0].turns[0].response, 'explicit new response');
  assert.equal(result.changedFromDurable, true);
});

test('complete legacy snapshots and higher history revisions keep their existing contracts', () => {
  const saved = session([turn('t', 'saved'), turn('tail', 'old tail')]), initial = session([turn('t', 'partial')]);
  const current = { ...initial, updatedAt: 20 };
  assert.equal(history.mergeConversationHistorySessions([current], [saved], options([initial], true)).sessions[0].turns[0].response, 'partial');
  const rewritten = { ...current, historyRevision: 2, turns: [turn('replacement', 'new history')] };
  const result = history.mergeConversationHistorySessions([rewritten], [saved], options([initial]));
  assert.deepEqual(result.sessions[0].turns, rewritten.turns);
});

test('unchanged incomplete mirrors do not invent writes, and deleted sessions stay deleted', () => {
  const saved = session([turn('t', 'long complete body')]), initial = session([turn('t', 'long')]);
  assert.equal(history.mergeConversationHistorySessions([initial], [saved], options([initial])).changedFromDurable, false);
  assert.deepEqual(history.mergeConversationHistorySessions([], [saved], options([initial])).sessions, []);
});

const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['loadCodingSessions', 'restoreDurableCodingSessions', 'loadDurableCodingSessions', 'persistCodingSessions', 'refreshConversationHistoryPersistDirty'];
const methods = [];
function visit(node) {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) methods.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast); assert.equal(methods.length, names.length);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });

test('actual widget captures provenance before early mutations and clears it after complete backend hydration', async () => {
  const saved = session([turn('t', 'full durable response')]);
  const mirror = history.createConversationHistoryMirror([saved], { sessions: 1, turnsPerSession: 1, promptCharacters: 4, responseCharacters: 4, errorCharacters: 4 });
  const dependencies = Object.fromEntries(Object.entries({ ...history, ...persistence, loadConversationHistoryWithRetry, hasLegacyToolActivityQueueRecords: () => false,
    window: { localStorage: { getItem: () => JSON.stringify(mirror), removeItem() {} } } }).filter(([key]) => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key)));
  const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
  let resolve; const loading = new Promise(done => { resolve = done; });
  const state = new Harness(), scheduled = [];
  Object.assign(state, {
    privacySettings: { saveConversationHistory: true }, conversationHistoryRevision: 0,
    conversationHistoryLoadGeneration: 0, conversationHistoryPersistenceReady: false,
    conversationHistoryPersistedSessions: new Map(), codingSessions: [],
    normalizeCodingSessions: values => values, platformService: { loadConversationHistory: () => loading },
    writeConversationHistoryMirror() {}, scheduleConversationHistoryPersist(delay) { scheduled.push(delay); },
    async publishConversationWindowChanges() {},
    update() {}, addNotification() {}, activeCodingSession() { return this.codingSessions[0]; }, hydrateDelegationLedgersForSession() {}
  });
  state.loadCodingSessions(); const original = state.conversationHistoryInitialSnapshot;
  // A click/save before loadConversationHistory is dispatched must not replace the baseline.
  state.codingSessions = state.codingSessions.map(value => ({ ...value, updatedAt: 30, draftPrompt: 'early draft' }));
  state.persistCodingSessions();
  const restoring = state.restoreDurableCodingSessions(); resolve({ status: 'ok', sessions: [saved] }); await restoring;
  assert.equal(original.complete, false); assert.equal(original.sessions[0].turns[0].response, 'full');
  assert.equal(state.codingSessions[0].turns[0].response, saved.turns[0].response);
  assert.equal(state.codingSessions[0].draftPrompt, 'early draft');
  assert.equal(state.conversationHistoryInitialSnapshot, undefined);
  assert.equal(state.conversationHistoryPersistenceReady, true); assert.ok(scheduled.includes(0));
  assert.equal(state.conversationHistoryPersistDirty, true);
});
