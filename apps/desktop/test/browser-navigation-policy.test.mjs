import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { loadNavigationHandlers } = require('./fixtures/browser-navigation-handlers.cjs');

function fixture() {
  const dedicated = {}, others = {}, opened = [];
  const handlers = loadNavigationHandlers({ session: { fromPartition: name => {
    assert.equal(name, 'persist:nextmux-browser'); return dedicated;
  } }, shell: { openExternal: url => opened.push(url) }, dialog: { showMessageBoxSync: () => assert.fail('Native dialog must not open') } });
  const contents = (type = 'webview', own = true) => Object.assign(new EventEmitter(), {
    getType: () => type, session: own ? dedicated : others,
    setWindowOpenHandler(callback) { this.open = callback; }
  });
  const navigate = (contents, url, eventName = 'will-navigate') => {
    const event = { url, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    contents.emit(eventName, event, url); return event.defaultPrevented;
  };
  return { ...handlers, contents, navigate, opened };
}

test('actual inherited Theia handler reproduces normal browser link veto and overwrites popup isolation', () => {
  const f = fixture(), guest = f.contents();
  f.updater({}, guest); f.theia.onWebContentsCreated({}, guest);
  assert.equal(f.navigate(guest, 'https://iana.org/help/example-domains'), true);
  assert.equal(guest.open({ url: 'https://example.test/popup' }).action, 'deny');
  assert.deepEqual(f.opened, ['https://example.test/popup'], 'legacy denial happens after opening the system browser');
});

test('dedicated guest keeps HTTP(S) navigation, redirect filtering and deny-only popup isolation', () => {
  const f = fixture(), guest = f.contents();
  f.updater({}, guest); f.nextmux.onWebContentsCreated({}, guest);
  for (const event of ['will-navigate', 'will-redirect']) {
    for (const url of ['https://iana.org/help/example-domains', 'http://localhost/page']) assert.equal(f.navigate(guest, url, event), false);
    for (const url of ['file:///private/test', 'javascript:alert(1)', 'nextmux://open', 'data:text/html,unsafe', 'invalid']) assert.equal(f.navigate(guest, url, event), true);
  }
  for (const url of ['https://example.test/popup', 'file:///fixture/secondary-window.html', 'nextmux://open']) assert.equal(guest.open({ url }).action, 'deny');
  assert.deepEqual(f.opened, []);
});

test('regular windows, secondary windows and non-dedicated guests keep actual inherited navigation policy', () => {
  const f = fixture();
  for (const [type, dedicated] of [['window', true], ['window', false], ['webview', false], ['browserView', true]]) {
    const contents = f.contents(type, dedicated);
    f.updater({}, contents); f.nextmux.onWebContentsCreated({}, contents);
    assert.equal(f.navigate(contents, 'https://example.test/external'), true, `${type}/${dedicated} must call super`);
    assert.equal(f.navigate(contents, 'file:///fixture/index.html'), true);
    // The updater still blocks file: in non-dedicated guests; ordinary Theia
    // windows retain the specific secondary-window navigation exception.
    if (type === 'window') assert.equal(f.navigate(contents, 'file:///fixture/secondary-window.html'), false);
  }
});
