import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createComputerWindowView } = require('../computer-window-view.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = []; let parkOk = true, unparkOk = true, unmuteOk = true;
  const service = {
    ready: async () => {}, capability: () => ({ canPark: true, sound: true }),
    topWindows: async () => ({ ok: true, windows: [] }), windowCapability: async () => ({ ok: true, canPark: true }),
    park: async (...args) => { calls.push(['park', ...args]); return { ok: parkOk, error: 'park_failed' }; },
    unpark: async (...args) => { calls.push(['unpark', ...args]); return { ok: unparkOk, error: 'unpark_failed' }; },
    mute: async (pid, muted) => { calls.push(['mute', pid, muted]); return { ok: muted || unmuteOk }; },
    shield: async () => ({ ok: true }), restoreDesktops: async () => { calls.push(['restoreDesktops']); },
    call: async (...args) => { calls.push(args); return { ok: true }; }, dispose: async () => { calls.push(['dispose']); }
  };
  const view = createComputerWindowView({ platform: 'win32', windowsServices: service });
  return { view, calls, park: value => parkOk = value, unpark: value => unparkOk = value, unmute: value => unmuteOk = value };
}

test('failed native moves do not claim isolation or discard the return-to-desktop lease', async () => {
  const f = fixture();
  try {
    f.park(false); assert.equal((await f.view.openInTab('c', process.pid, 10)).placement, 'desktop');
    f.park(true); assert.equal((await f.view.place('c', process.pid, 10, 'tab')).ok, true);
    f.unpark(false); assert.equal((await f.view.place('c', process.pid, 10, 'desktop')).ok, false);
    assert.equal(f.view.isParked(process.pid, 10), true);
    f.unpark(true); assert.equal((await f.view.place('c', process.pid, 10, 'desktop')).ok, true);
    assert.equal(f.view.isParked(process.pid, 10), false);
  } finally { await f.view.dispose(); }
});

test('close unmute retries a failed restoration and never closes an app already open before NextMux', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    await f.view.openInTab('c', process.pid, 10, { launched: false }); f.view.setCloseBehavior('quit');
    f.unmute(false); await f.view.forget('c', process.pid, 10);
    assert.equal(f.calls.some(call => call[0] === 'closeWindow'), false);
    assert.equal(f.calls.filter(call => call[0] === 'mute' && !call[2]).length, 1);
    f.unmute(true); t.mock.timers.tick(1000); await tick();
    assert.equal(f.calls.filter(call => call[0] === 'mute' && !call[2]).length, 2);
    assert.equal(f.calls.some(call => call[0] === 'unpark'), true);
  } finally { await f.view.dispose(); }
});

test('closing one of two same-process windows retains mute until the final holder disconnects', async () => {
  const f = fixture();
  try {
    await f.view.openInTab('c', process.pid, 10); await f.view.openInTab('c', process.pid, 11);
    await f.view.forget('c', process.pid, 10);
    assert.equal(f.calls.some(call => call[0] === 'mute' && !call[2]), false);
    await f.view.forget('c', process.pid, 11);
    assert.equal(f.calls.filter(call => call[0] === 'mute' && !call[2]).length, 1);
  } finally { await f.view.dispose(); }
});
