import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { ClickNavigationObservation, GuestAutomation } = require('../browser-automation.cjs');
const start = (contents, url = 'https://example.test/next') => contents.emit('did-start-navigation', { url, isMainFrame: true });

test('a button without observed navigation does not wait for a navigation timeout', async () => {
  const contents = new EventEmitter(), observer = new ClickNavigationObservation(contents);
  const result = await observer.settle({ timeoutMs: 10000 });
  assert.equal(result.status, 'not-observed'); observer.dispose();
  assert.equal(contents.eventNames().length, 0);
});

test('wait follows an already started redirect through a committed destination', async () => {
  const contents = new EventEmitter(), observer = new ClickNavigationObservation(contents);
  start(contents); const pending = observer.settle();
  contents.emit('will-redirect', { url: 'https://example.test/final', isMainFrame: true });
  contents.emit('did-navigate', {}, 'https://example.test/final');
  assert.deepEqual(await pending, { scope: 'main-frame', status: 'committed', url: 'https://example.test/final' });
  observer.dispose(); assert.equal(contents.eventNames().length, 0);
});

test('a later Electron security listener veto is reported without overriding that listener', async () => {
  const contents = new EventEmitter(), observer = new ClickNavigationObservation(contents);
  contents.on('will-navigate', event => { event.defaultPrevented = true; });
  start(contents);
  const pending = observer.settle();
  contents.emit('will-navigate', { url: 'https://example.test/next', isMainFrame: true, defaultPrevented: false });
  assert.equal((await pending).status, 'blocked'); observer.dispose();
  assert.equal(contents.listenerCount('will-navigate'), 1, 'security listener remains installed');
});

for (const [event, code, status] of [['did-fail-load', -105, 'failed'], ['did-fail-provisional-load', -3, 'cancelled']]) {
  test(`${event} retains navigation failure without claiming a completed destination`, async () => {
    const contents = new EventEmitter(), observer = new ClickNavigationObservation(contents);
    start(contents); const pending = observer.settle();
    contents.emit(event, {}, code, 'fixture failure', 'https://example.test/next', true);
    assert.deepEqual(await pending, { scope: 'main-frame', status, url: 'https://example.test/next', errorCode: code, description: 'fixture failure' });
    observer.dispose();
  });
}

test('subframe and unrelated prior-request failures cannot settle the main-frame navigation', async () => {
  const contents = new EventEmitter(), observer = new ClickNavigationObservation(contents);
  contents.emit('did-start-navigation', {}, 'https://example.test/child', false, false);
  assert.equal(observer.state.status, 'not-observed');
  start(contents);
  contents.emit('did-fail-load', {}, -105, 'foreign child', 'https://example.test/next', false);
  contents.emit('did-fail-load', {}, -105, 'prior request', 'https://example.test/previous', true);
  assert.equal(observer.state.status, 'pending');
  assert.equal((await observer.settle({ timeoutMs: 5 })).status, 'pending'); observer.dispose();
});

test('aborting an in-flight wait releases all operation listeners and never repeats the click', async () => {
  const contents = new EventEmitter(), engine = new GuestAutomation(contents, {}, { on() {} }, {});
  let clicked = 0;
  engine.target = async () => ({ click: async () => { clicked++; start(contents); setImmediate(() => engine.cancel('cancel')); } });
  engine.snapshot = async () => assert.fail('cancelled click must not publish a snapshot');
  const result = await engine.run({ id: 'cancel', action: 'click', expiresAt: Date.now() + 10000 });
  assert.equal(result.code, 'BROWSER_ACTION_EXPIRED'); assert.equal(clicked, 1);
  assert.equal(contents.eventNames().length, 0);
  assert.deepEqual(await engine.run({ id: 'cancel', action: 'click', expiresAt: Date.now() + 10000 }), result);
  assert.equal(clicked, 1);
});

test('click result distinguishes dispatched input from observed navigation and keeps the page snapshot', async () => {
  const contents = new EventEmitter(), engine = new GuestAutomation(contents, {}, { on() {} }, {});
  engine.target = async () => ({ click: async () => {} });
  engine.snapshot = async () => ({ url: 'https://example.test/', title: 'Original' });
  const result = await engine.run({ id: 'button', action: 'click', expiresAt: Date.now() + 10000 });
  assert.equal(result.ok, true);
  assert.equal(result.data.verification, 'browser-input-dispatched-and-page-observed');
  assert.equal(result.data.navigation.status, 'not-observed');
  assert.equal(result.data.snapshot.title, 'Original'); assert.equal(contents.eventNames().length, 0);
});

test('a navigation frame race re-observes once and never reissues the trusted input', async () => {
  const contents = new EventEmitter(), engine = new GuestAutomation(contents, {}, { on() {} }, {});
  let clicks = 0, reads = 0;
  engine.target = async () => ({ click: async () => { clicks++; start(contents); contents.emit('did-navigate', {}, 'https://example.test/next'); } });
  engine.snapshot = async () => { if (++reads === 1) throw Object.assign(Error('frame replaced'), { code: 'BROWSER_FRAME_CHANGED' }); return { url: 'https://example.test/next' }; };
  const result = await engine.run({ id: 'race', action: 'click', expiresAt: Date.now() + 10000 });
  assert.equal(result.ok, true); assert.equal(result.data.navigation.status, 'committed');
  assert.equal(clicks, 1); assert.equal(reads, 2);
  assert.deepEqual(await engine.run({ id: 'race', action: 'click', expiresAt: Date.now() + 10000 }), result);
  assert.equal(clicks, 1); assert.equal(reads, 2);
});

test('repeated frame replacement remains bounded instead of hiding an unstable page', async () => {
  const contents = new EventEmitter(), engine = new GuestAutomation(contents, {}, { on() {} }, {});
  let clicks = 0, reads = 0;
  engine.target = async () => ({ click: async () => { clicks++; } });
  engine.snapshot = async () => { reads++; throw Object.assign(Error('frame replaced'), { code: 'BROWSER_FRAME_CHANGED' }); };
  const result = await engine.run({ id: 'unstable', action: 'click', expiresAt: Date.now() + 10000 });
  assert.equal(result.ok, false); assert.equal(result.code, 'BROWSER_FRAME_CHANGED'); assert.equal(clicks, 1); assert.equal(reads, 2);
  assert.equal(contents.eventNames().length, 0);
});
