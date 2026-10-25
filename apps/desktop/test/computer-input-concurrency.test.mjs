import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWindowsInput } = require('../computer-input-windows.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(autoCancel = false) {
  const requests = [], child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  let boot = false, buffer = '';
  const reply = (id, ok = true) => child.stdout.write(`${JSON.stringify({ id, ok, error: ok ? undefined : 'cancelled' })}\n`);
  child.kill = () => child.emit('close', 0);
  child.stdin.on('finish', child.kill);
  child.stdin.on('data', chunk => {
    buffer += chunk;
    for (let at; (at = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!boot) { boot = true; queueMicrotask(() => child.stdout.write('{"ready":true}\n')); }
      else {
        const request = JSON.parse(line); requests.push(request);
        if (autoCancel && request.action === 'cancel') reply(request.id, false);
      }
    }
  });
  const input = createWindowsInput({ spawn: (_file, _args, options) => { assert.equal(options.windowsHide, true); assert.notEqual(options.detached, true); return child; }, source: () => '' });
  return { input, requests, reply };
}

test('same HWND is serialized while another HWND progresses during a held chord', async () => {
  const { input, requests, reply } = fixture();
  try {
    const a = input.post({ pid: 1, windowId: 10, kind: 'key', keys: ['a', 'b'], modifiers: ['rightctrl'], holdMs: 3000 });
    const b = input.post({ pid: 1, windowId: 10, kind: 'key', key: 'shift' });
    const c = input.post({ pid: 2, windowId: 20, kind: 'move', x: .5, y: .5 });
    await tick();
    assert.deepEqual(requests.map(request => request.windowId).sort((a, b) => a - b), [10, 20]);
    const held = requests.find(request => request.windowId === 10), other = requests.find(request => request.windowId === 20);
    assert.deepEqual(held.modifiers, ['rightctrl']);
    reply(other.id); await c;
    assert.equal(requests.length, 2);
    reply(held.id); await a; await tick();
    assert.equal(requests[2].key, 'shift'); reply(requests[2].id); await b;
  } finally { await input.dispose(); }
});

test('abort waits for native release acknowledgement before the next same-window operation', async () => {
  const { input, requests, reply } = fixture(); const abort = new AbortController();
  try {
    const a = input.post({ pid: 1, windowId: 10, kind: 'key', key: 'leftalt', holdMs: 3000, signal: abort.signal });
    const rejected = assert.rejects(a, { name: 'AbortError' });
    const b = input.post({ pid: 1, windowId: 10, kind: 'text', text: 'after' });
    await tick(); abort.abort(); await tick();
    assert.deepEqual(requests.map(request => request.action), ['post', 'cancel']);
    assert.equal(requests[1].id, requests[0].id);
    reply(requests[0].id, false); await rejected; await tick();
    assert.equal(requests[2].text, 'after'); reply(requests[2].id); await b;
  } finally { await input.dispose(); }
});

test('an immediate cancel reply clears its cleanup timer before another window uses the helper', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, requests, reply } = fixture(true); const abort = new AbortController();
  try {
    const pending = input.post({ pid: 1, windowId: 10, kind: 'key', key: 'ctrl', holdMs: 3000, signal: abort.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await tick(); abort.abort(); await rejected;
    t.mock.timers.tick(2100);
    const next = input.post({ pid: 2, windowId: 20, kind: 'key', key: 'a' });
    await tick(); assert.equal(requests.at(-1).windowId, 20); reply(requests.at(-1).id); await next;
  } finally { await input.dispose(); }
});
