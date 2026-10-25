import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const token = '00000000-0000-4000-8000-000000000001';
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const ipc = new EventEmitter(), invocations = []; let result = true, bridge;
  ipc.invoke = async (...args) => { invocations.push(args); if (result instanceof Error) throw result; return result; };
  runInNewContext(readFileSync(new URL('../nextmux-electron-preload.cjs', import.meta.url), 'utf8'), {
    require: id => id === 'electron' ? { contextBridge: { exposeInMainWorld: (_, value) => { bridge = value; } }, ipcRenderer: ipc, webUtils: {} }
      : { preload() {} }
  });
  return { ipc, bridge, invocations, setResult: value => { result = value; } };
}

test('preload only sends validated close nonces and explicit outcomes, with strict boolean replies', async () => {
  const f = fixture();
  for (const invalid of [null, 1, '', 'short', token + '\n']) {
    assert.equal(await f.bridge.beginPrepareClose(invalid), false);
    assert.equal(await f.bridge.completePrepareClose(invalid, 'saved'), false);
  }
  for (const outcome of [undefined, null, true, 'success']) assert.equal(await f.bridge.completePrepareClose(token, outcome), false);
  assert.equal(f.invocations.length, 0);
  assert.equal(await f.bridge.beginPrepareClose(token), true);
  assert.deepEqual(f.invocations.at(-1), ['nextmux:prepare-close:begin', token]);
  assert.equal(await f.bridge.completePrepareClose(token, 'saved'), true);
  assert.deepEqual(f.invocations.at(-1), ['nextmux:prepare-close:complete', token, 'saved']);
  f.setResult('true'); assert.equal(await f.bridge.beginPrepareClose(token), false);
});

test('preload validates request and cancellation callback values and disposes queued notifications', async () => {
  const f = fixture(), requests = [], cancellations = [];
  const offRequest = f.bridge.onPrepareClose(value => requests.push(value));
  const offCancel = f.bridge.onPrepareCloseCancelled((value, reason) => cancellations.push([value, reason]));
  f.ipc.emit('nextmux:prepare-close', {}, 'wrong');
  f.ipc.emit('nextmux:prepare-close:cancelled', {}, token, 'wrong');
  f.ipc.emit('nextmux:prepare-close', {}, token);
  for (const reason of ['timeout', 'failed', 'navigated']) f.ipc.emit('nextmux:prepare-close:cancelled', {}, token, reason);
  await settle(); assert.deepEqual(requests, [token]); assert.equal(cancellations.length, 3);
  f.ipc.emit('nextmux:prepare-close', {}, token); f.ipc.emit('nextmux:prepare-close:cancelled', {}, token, 'timeout');
  offRequest(); offCancel(); await settle();
  assert.equal(requests.length, 1); assert.equal(cancellations.length, 3);
  assert.equal(f.ipc.listenerCount('nextmux:prepare-close'), 0); assert.equal(f.ipc.listenerCount('nextmux:prepare-close:cancelled'), 0);
});

test('throwing and rejecting renderer callbacks never approve close or produce unhandled rejections', async () => {
  for (const callback of [() => { throw new Error('synthetic callback failure'); }, async () => { throw new Error('synthetic callback failure'); }]) {
    const f = fixture(); f.bridge.onPrepareClose(callback); f.ipc.emit('nextmux:prepare-close', {}, token);
    await settle(); assert.deepEqual(f.invocations, [['nextmux:prepare-close:complete', token, 'failed']]);
    f.setResult(new Error('synthetic IPC failure'));
    f.ipc.emit('nextmux:prepare-close', {}, token); await settle();
    assert.ok(f.invocations.every(args => args[2] === 'failed'));
    f.bridge.onPrepareCloseCancelled(callback); f.ipc.emit('nextmux:prepare-close:cancelled', {}, token, 'timeout');
    await settle();
  }
});
