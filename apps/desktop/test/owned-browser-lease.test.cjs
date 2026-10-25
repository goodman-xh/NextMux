'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { registerBrowserAutomation } = require('../browser-automation.cjs');
test('existing release/keepalive IPC call owned lease hooks and never page ownership release', () => {
  const handlers = new Map(), calls = [], event = { sender: {} };
  registerBrowserAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, webContents: {}, session: {}, trustedMainFrame: input => input === event,
    ownedRegistry: { releaseAutomation: (...args) => { calls.push(['release', ...args]); return true; }, keepaliveAutomation: (...args) => { calls.push(['keepalive', ...args]); return 2; }, release: () => { throw Error('Must not transfer view'); } } });
  assert.equal(handlers.get('nextmux:browser:release')(event, 'conversation'), true);
  assert.equal(handlers.get('nextmux:browser:keepalive')(event, ['conversation', 'conversation', 42]), 2);
  assert.deepEqual(calls, [['release', event, 'conversation'], ['keepalive', event, ['conversation']]]);
  assert.equal(handlers.get('nextmux:browser:release')({}, 'conversation'), false); assert.equal(calls.length, 2);
});
test('old registration without owned registry remains valid; denied owned hook does not break legacy channel', () => {
  for (const ownedRegistry of [undefined, { releaseAutomation() { throw Error('Denied'); }, keepaliveAutomation() { throw Error('Denied'); } }]) {
    const handlers = new Map(); registerBrowserAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, webContents: {}, session: {}, trustedMainFrame: () => true, ownedRegistry });
    assert.equal(handlers.get('nextmux:browser:release')({}, 'conversation'), false); assert.equal(handlers.get('nextmux:browser:keepalive')({}, ['conversation']), 0);
  }
});
