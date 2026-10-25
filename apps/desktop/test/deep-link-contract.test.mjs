import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  installNextMuxDeepLinks,
  parseNextMuxDeepLink,
  registerProtocolClient,
} from '../deep-link.cjs';

const validNonce = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const validUrl = `nextmux://device-link/complete?nonce=${validNonce}`;

test('isolated source launches leave the installed protocol handler unchanged', () => {
  for (const args of [
    ['--user-data-dir=/tmp/nextmux isolated'],
    ['--user-data-dir', '/tmp/nextmux isolated'],
    ['--electronUserData=C:\\NextMux-Test\\electron'],
    ['--electronUserData', 'C:\\NextMux-Test\\electron'],
    ['--electronUserData=./isolated-profile'],
  ]) {
    const calls = [];
    const result = registerProtocolClient({ isPackaged: false, setAsDefaultProtocolClient: (...values) => calls.push(values) }, {
      argv: ['electron', '/source/apps/desktop', ...args], execPath: '/runtime/electron',
    });
    assert.equal(result, false);
    assert.deepEqual(calls, [], args.join(' '));
  }
});

test('missing, malformed, and non-option profile values keep ordinary source registration', () => {
  for (const args of [[], ['--user-data-dir'], ['--electronUserData'], ['--user-data-dir='],
    ['--electronUserData=   '], ['--user-data-dir', '--log-level=debug'],
    ['--electronUserData=--log-level=debug'], ['--user-data-dir=/tmp/bad\0path'],
    ['--', '--user-data-dir=/tmp/not-an-option'], ['--other-user-data-dir=/tmp/unrelated']]) {
    const calls = [];
    registerProtocolClient({ isPackaged: false, setAsDefaultProtocolClient: (...values) => calls.push(values) }, {
      argv: ['electron', '/source/apps/desktop', ...args], entryPath: '/source/apps/desktop', execPath: '/runtime/electron',
    });
    assert.equal(calls.length, 1, JSON.stringify(args));
    assert.equal(calls[0][0], 'nextmux');
    assert.equal(calls[0][1], '/runtime/electron');
    assert.equal(calls[0][2].length, 1);
  }
});

test('packaged launches retain normal protocol registration with profile options', () => {
  const calls = [];
  registerProtocolClient({ isPackaged: true, setAsDefaultProtocolClient: (...values) => calls.push(values) }, {
    argv: ['NextMux.exe', '--user-data-dir=C:\\NextMux-Test\\electron', '--electronUserData', 'C:\\NextMux-Test\\electron'],
  });
  assert.deepEqual(calls, [['nextmux']]);
});

test('isolated source launch still receives validated direct callbacks and exposes the broker', () => {
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: false, setAsDefaultProtocolClient: () => assert.fail('isolated launch registered a protocol') });
  const handlers = new Map();
  const broker = installNextMuxDeepLinks({ app, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }, {
    argv: ['electron', '/source/apps/desktop', '--user-data-dir', '/tmp/nextmux-profile', validUrl],
  });
  assert.equal(handlers.has('nextmux:deep-link:take-pending'), true);
  assert.deepEqual(broker.takePending(), [validUrl]);
  let prevented = false;
  app.emit('open-url', { preventDefault: () => { prevented = true; } }, validUrl);
  assert.equal(prevented, true);
  assert.deepEqual(broker.takePending(), [validUrl]);
});

test('desktop deep links accept only the one-time device-link callback surface', () => {
  assert.deepEqual(parseNextMuxDeepLink(validUrl), {
    kind: 'device-link-complete',
    nonce: validNonce,
    url: validUrl,
  });

  for (const value of [
    'https://device-link/complete?nonce=' + validNonce,
    'nextmux://conversation/complete?nonce=' + validNonce,
    'nextmux://device-link/other?nonce=' + validNonce,
    'nextmux://device-link/complete?nonce=short',
    validUrl + '&next=/account',
    validUrl + '#fragment',
    'nextmux://user:pass@device-link/complete?nonce=' + validNonce,
    'nextmux://device-link:443/complete?nonce=' + validNonce,
  ]) assert.equal(parseNextMuxDeepLink(value), undefined, value);
});

test('cold start, macOS open-url, and Windows second-instance share one validated broker', async () => {
  class FakeApp extends EventEmitter {
    isPackaged = true;
    protocolCalls = [];
    setAsDefaultProtocolClient(...args) { this.protocolCalls.push(args); return true; }
  }
  const app = new FakeApp();
  const sent = [];
  let focused = 0;
  const mainFrame = {};
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => { focused += 1; },
    focus: () => { focused += 1; },
    webContents: { send: (...args) => sent.push(args), getURL: () => 'file:///app/lib/frontend/index.html', mainFrame },
  };
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const BrowserWindow = { getAllWindows: () => [window], fromWebContents: contents => contents === window.webContents ? window : undefined };
  const appFrame = { sender: window.webContents, senderFrame: mainFrame };

  installNextMuxDeepLinks({ app, BrowserWindow, ipcMain }, {
    argv: ['NextMux.exe', validUrl],
    platform: 'win32',
    execPath: 'C:\\Program Files\\NextMux\\NextMux.exe',
  });
  assert.deepEqual(app.protocolCalls, [['nextmux']]);
  // Only the app's own main frame can take the queue (audit B12-02).
  assert.deepEqual(await handlers.get('nextmux:deep-link:take-pending')({ sender: window.webContents, senderFrame: {} }), []);
  assert.deepEqual(await handlers.get('nextmux:deep-link:take-pending')(), []);
  assert.deepEqual(await handlers.get('nextmux:deep-link:take-pending')(appFrame), [validUrl]);

  app.emit('second-instance', {}, ['NextMux.exe'], 'C:\\', ['NextMux.exe', '--open-url', validUrl]);
  assert.deepEqual(sent.at(-1), ['nextmux:deep-link', validUrl]);
  assert.equal(focused > 0, true);

  const focusedAfterDeepLink = focused;
  app.emit('second-instance', {}, ['NextMux.exe'], 'C:\\', ['NextMux.exe']);
  assert.equal(focused > focusedAfterDeepLink, true, 'a duplicate launch must focus the existing window');
  assert.deepEqual(sent.at(-1), ['nextmux:deep-link', validUrl], 'a plain duplicate launch must not invent a deep link');

  const focusedBeforeWake = focused;
  app.emit('second-instance', {}, ['NextMux.exe', '--nextmux-scheduled'], 'C:\\', ['NextMux.exe']);
  app.emit('second-instance', {}, ['NextMux.exe'], 'C:\\', ['NextMux.exe', '--nextmux-scheduled']);
  assert.equal(focused, focusedBeforeWake, 'background schedule wake-ups must not show or focus the workbench');
  app.emit('second-instance', {}, ['NextMux.exe', '--nextmux-scheduled'], 'C:\\', ['NextMux.exe', '--open-url', validUrl]);
  assert.ok(focused > focusedBeforeWake, 'a genuine user account callback still opens its window');

  let prevented = false;
  app.emit('open-url', { preventDefault: () => { prevented = true; } }, validUrl);
  assert.equal(prevented, true);
  assert.deepEqual(await handlers.get('nextmux:deep-link:take-pending')(appFrame), [validUrl]);
});

test('packaging and bootstrap register the nextmux protocol before the generated Electron main', async () => {
  const desktopPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const bootstrap = await readFile(new URL('../bootstrap.cjs', import.meta.url), 'utf8');
  const electronMain = await readFile(new URL('../src-gen/backend/electron-main.js', import.meta.url), 'utf8');
  assert.deepEqual(desktopPackage.build.protocols, [{ name: 'NextMux Device Link', schemes: ['nextmux'] }]);
  assert.equal(desktopPackage.theia.backend.config.singleInstance, true, 'the source config must explicitly preserve the single-instance boundary');
  assert.equal(desktopPackage.theia.frontend.config.electron.uriScheme, 'theia', 'Theia must not consume the security-sensitive callback as a generic URI');
  assert.ok(bootstrap.indexOf("require('./deep-link.cjs')") < bootstrap.indexOf("require('./lib/backend/electron-main.js')"));
  assert.match(electronMain, /app\.requestSingleInstanceLock\(process\.argv\)/, 'Electron must own a single-instance lock');
  assert.match(electronMain, /app\.quit\(\)/, 'a losing Electron instance must exit before creating a window');
});

test('desktop package exposes an automatable deep-link E2E entrypoint', async () => {
  const desktopPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const e2e = await readFile(new URL('../../../scripts/desktop-device-link-e2e.mjs', import.meta.url), 'utf8');
  assert.match(desktopPackage.scripts['test:e2e:device-link'], /desktop-device-link-e2e\.mjs/);
  assert.match(e2e, /NEXTMUX_DEVICE_LINK_E2E_DEEP_LINK/);
  assert.match(e2e, /NEXTMUX_DEVICE_LINK_E2E_EXPECTED_IDENTITY/);
  assert.match(e2e, /nmx-account-avatar\.is-linked/);
});

test('broadcast keeps deep links pending until delivered ack, skips non-workbench windows, and caps pending at 16', async () => {
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, setAsDefaultProtocolClient: () => true });
  const mainFrame = {};
  const mainSent = [];
  const childSent = [];
  const mainWin = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => {},
    focus: () => {},
    webContents: { send: (...args) => mainSent.push(args), getURL: () => 'file:///app/lib/frontend/index.html', isLoading: () => false, mainFrame },
  };
  const tabWin = {
    isDestroyed: () => false,
    webContents: { send: (...args) => childSent.push(args), getURL: () => 'file:///app/computer-tab-window.html', mainFrame: {} },
  };
  const convWin = {
    isDestroyed: () => false,
    webContents: { send: (...args) => childSent.push(args), getURL: () => 'file:///app/lib/frontend/index.html?nextmuxConversation=1', mainFrame: {} },
  };
  const detachedWin = {
    [Symbol.for('nextmux.conversation-window.detached.v1')]: true,
    isDestroyed: () => false,
    webContents: { send: (...args) => childSent.push(args), getURL: () => 'file:///app/lib/frontend/index.html', mainFrame: {} },
  };
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const BrowserWindow = {
    getAllWindows: () => [tabWin, convWin, detachedWin, mainWin],
    fromWebContents: contents => contents === mainWin.webContents ? mainWin : undefined,
  };
  installNextMuxDeepLinks({ app, BrowserWindow, ipcMain }, { argv: ['NextMux.exe'], platform: 'win32' });
  assert.equal(handlers.has('nextmux:deep-link:delivered'), true);

  app.emit('open-url', { preventDefault: () => {} }, validUrl);
  assert.deepEqual(mainSent, [['nextmux:deep-link', validUrl]]);
  assert.deepEqual(childSent, [], 'non-workbench windows must never receive deep-link broadcasts');

  // Untrusted frame/sender cannot acknowledge and remove the pending link
  assert.equal(await handlers.get('nextmux:deep-link:delivered')({ sender: mainWin.webContents, senderFrame: {} }, validUrl), false);
  assert.equal(await handlers.get('nextmux:deep-link:delivered')({ sender: tabWin.webContents, senderFrame: tabWin.webContents.mainFrame }, validUrl), false);

  // Trusted main frame acknowledges delivery, removing it from pending
  assert.equal(await handlers.get('nextmux:deep-link:delivered')({ sender: mainWin.webContents, senderFrame: mainFrame }, validUrl), true);
  assert.deepEqual(await handlers.get('nextmux:deep-link:take-pending')({ sender: mainWin.webContents, senderFrame: mainFrame }), []);

  // Pending queue is capped at 16 entries (oldest dropped)
  const urls = [];
  for (let i = 0; i < 20; i += 1) {
    const nonce = `abcdefghijklmnopqrstuvwxyzABCDEFGH${String(100000000 + i)}`;
    const u = `nextmux://device-link/complete?nonce=${nonce}`;
    urls.push(u);
    app.emit('open-url', { preventDefault: () => {} }, u);
  }
  const pending = await handlers.get('nextmux:deep-link:take-pending')({ sender: mainWin.webContents, senderFrame: mainFrame });
  assert.equal(pending.length, 16);
  assert.deepEqual(pending, urls.slice(4));
});
