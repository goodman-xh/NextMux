import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { registerSystemNotifications } = require('../system-notifications.cjs');
const pkg = require('../package.json');

function fixture(platform, supported = true) {
  const handlers = new Map(), identities = [], notifications = [], effects = [];
  const sender = { isDestroyed: () => false, send: (channel, target) => effects.push([channel, target]) };
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => effects.push('restore'),
    show: () => effects.push('show'), focus: () => effects.push('focus') };
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { effects.push('notification'); }
  }
  const valid = { sender, trusted: true };
  registerSystemNotifications({ platform, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, Notification,
    BrowserWindow: { fromWebContents: owner => owner === sender ? window : undefined },
    app: { setAppUserModelId: value => identities.push(value) }, trustedMainFrame: event => event?.trusted === true });
  return { valid, identities, notifications, effects, invoke: (name, event, request) => handlers.get(`nextmux:notify:${name}`)(event, request) };
}

test('Windows notifications retain the installed shortcut and updater app identity; macOS leaves its native identity alone', () => {
  const windows = fixture('win32');
  assert.deepEqual(windows.identities, [pkg.build.appId]);
  assert.equal(windows.identities[0], pkg.theia.frontend.config.electron.appUserModelId);
  assert.deepEqual(fixture('darwin').identities, []);
});

test('Mac and Windows notification clicks restore the originating window and route to its conversation', () => {
  for (const platform of ['darwin', 'win32']) {
    const f = fixture(platform);
    assert.equal(f.invoke('show', f.valid, { title: 'Task\nfinished', body: 'done', target: 'conversation-1' }), true);
    assert.equal(f.notifications[0].options.title, 'Task finished');
    f.notifications[0].emit('click');
    assert.deepEqual(f.effects, ['notification', 'restore', 'show', 'focus', ['nextmux:notify:click', 'conversation-1']]);
  }
});

test('untrusted or unsupported notification requests produce no native notification', () => {
  const f = fixture('win32');
  for (const event of [undefined, {}, { trusted: false }]) {
    assert.equal(f.invoke('supported', event), false);
    assert.equal(f.invoke('show', event, { title: 'Task finished' }), false);
  }
  assert.equal(f.notifications.length, 0);
  const unavailable = fixture('darwin', false);
  assert.equal(unavailable.invoke('supported', unavailable.valid), false);
  assert.equal(unavailable.invoke('show', unavailable.valid, { title: 'Task finished' }), false);
  assert.equal(unavailable.notifications.length, 0);
});
