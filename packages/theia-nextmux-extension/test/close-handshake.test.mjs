import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-contribution.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('contribution.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), methods = [];
const names = new Set(['initialize', 'prepareApplicationClose', 'cancelApplicationClose', 'runApplicationClose', 'onStop']);
function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(file))) methods.push(node.getText(file)); ts.forEachChild(node, visit); }
visit(file); assert.equal(methods.length, names.size);
const code = ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ widget = true } = {}) {
  const calls = [], saves = [], disposals = []; let begin = async () => true, complete = async () => true, request, cancel;
  const bridge = { beginPrepareClose: async token => { calls.push(['begin', token]); return begin(token); },
    completePrepareClose: async (token, outcome) => { calls.push(['complete', token, outcome]); return complete(token, outcome); },
    onPrepareClose: callback => { request = callback; return () => disposals.push('request'); },
    onPrepareCloseCancelled: callback => { cancel = callback; return () => disposals.push('cancel'); } };
  const value = { beginApplicationExit: () => calls.push(['freeze']), cancelApplicationExit: reason => calls.push(['unfreeze', reason]),
    shutdownForApplicationExit: () => { const save = deferred(); saves.push(save); calls.push(['save']); return save.promise; } };
  const Harness = new Function('window', code)({ nextmuxDesktop: bridge, addEventListener() {}, removeEventListener() {}, localStorage: { length: 0 } });
  const state = Object.assign(new Harness(), { closeAttempts: new Map(), productMenuRegistrations: [], tryGetWidget: () => widget ? value : undefined });
  state.initialize();
  return { state, calls, saves, disposals, request: token => request(token), cancel: (token, reason) => cancel(token, reason),
    setBegin: fn => { begin = fn; }, setComplete: fn => { complete = fn; } };
}

test('begin acceptance precedes freezing and persistence; denied or cancelled acknowledgements do not start work', async () => {
  const f = fixture(); f.setBegin(async () => false); await f.request('A'); assert.deepEqual(f.calls, [['begin', 'A']]);
  const ack = deferred(); f.setBegin(() => ack.promise); const operation = f.request('B');
  f.cancel('B', 'timeout'); ack.resolve(true); await operation;
  assert.equal(f.saves.length, 0); assert.equal(f.calls.some(call => call[0] === 'complete'), false);
});

test('a duplicate nonce shares one operation and only confirmed persistence sends saved', async () => {
  const f = fixture(), first = f.request('A'); assert.equal(f.request('A'), first);
  await tick(); assert.deepEqual(f.calls, [['begin', 'A'], ['freeze'], ['save']]);
  f.saves[0].resolve(); await first;
  assert.deepEqual(f.calls.at(-1), ['complete', 'A', 'saved']);
  await f.state.onStop(); assert.equal(f.saves.length, 1); assert.deepEqual(f.disposals, ['request', 'cancel']);
});

test('save failure is failed-only and unlocks UI even when the failure IPC rejects', async () => {
  const f = fixture(); f.setComplete(async () => { throw new Error('synthetic IPC failure'); });
  const operation = f.request('A'); await tick(); f.saves[0].reject(new Error('synthetic persistence failure')); await operation;
  assert.deepEqual(f.calls.slice(-2), [['complete', 'A', 'failed'], ['unfreeze', 'failed']]);
  assert.equal(f.state.closePreparation, undefined); assert.equal(f.state.activeCloseAttempt, undefined);
});

test('new nonce after cancellation starts a fresh flush without waiting for the old one', async () => {
  const f = fixture(), first = f.request('A'); await tick(); f.cancel('A', 'timeout');
  const second = f.request('B'); await tick(); assert.equal(f.saves.length, 2);
  f.saves[0].resolve(); await first; await tick();
  assert.equal(f.calls.some(call => call[0] === 'complete' && call[1] === 'A'), false);
  const count = f.calls.length; f.cancel('A', 'failed'); assert.equal(f.calls.length, count);
  assert.equal(f.state.activeCloseAttempt.token, 'B');
  f.saves[1].resolve(); await second; assert.deepEqual(f.calls.at(-1), ['complete', 'B', 'saved']);
});

test('a new nonce timing out cannot dispose terminals or leave a stale close waiting', async () => {
  const f = fixture(), first = f.request('A'); await tick(); f.cancel('A', 'timeout');
  const second = f.request('B'); await tick(); f.cancel('B', 'timeout');
  f.saves[0].resolve(); await Promise.all([first, second]);
  assert.equal(f.saves.length, 2); assert.equal(f.calls.filter(call => call[0] === 'freeze').length, 2);
  assert.equal(f.calls.some(call => call[0] === 'complete'), false);
});

test('an old saved acknowledgement arriving after cancellation cannot unlock a newer close', async () => {
  const f = fixture(), oldReceipt = deferred();
  f.setComplete((token, outcome) => token === 'A' && outcome === 'saved' ? oldReceipt.promise : Promise.resolve(true));
  const first = f.request('A'); await tick(); f.saves[0].resolve(); await tick();
  f.cancel('A', 'timeout'); const second = f.request('B'); await tick();
  assert.equal(f.saves.length, 2); const count = f.calls.filter(call => call[0] === 'unfreeze').length;
  oldReceipt.resolve(false); await first;
  assert.equal(f.state.activeCloseAttempt.token, 'B');
  assert.equal(f.calls.filter(call => call[0] === 'unfreeze').length, count);
  f.saves[1].resolve(); await second; assert.deepEqual(f.calls.at(-1), ['complete', 'B', 'saved']);
});

test('a rejected saved receipt unlocks only its current nonce and no-widget close does not create a widget', async () => {
  const f = fixture(); f.setComplete(async () => false); const operation = f.request('A'); await tick(); f.saves[0].resolve(); await operation;
  assert.deepEqual(f.calls.at(-1), ['unfreeze', 'failed']);
  const empty = fixture({ widget: false }); await empty.request('B');
  assert.deepEqual(empty.calls, [['begin', 'B'], ['complete', 'B', 'saved']]); assert.equal(empty.saves.length, 0);
});

test('stop cleanup unsubscribes both callbacks even if its ordinary flush fails', async () => {
  const f = fixture(), stopping = f.state.onStop(); f.saves[0].reject(new Error('synthetic failure'));
  await assert.rejects(stopping, /synthetic failure/); assert.deepEqual(f.disposals, ['request', 'cancel']);
});
