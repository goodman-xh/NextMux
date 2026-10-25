import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createComputerOverlay, overlayPage } = require('../computer-overlay.cjs');
const { ComputerAutomation } = require('../computer-automation.cjs');

function fakes(displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 957 } }]) {
  const created = [];
  class BrowserWindow {
    constructor(options) { this.options = options; this.destroyed = false; this.calls = []; this.shown = false; created.push(this); }
    setIgnoreMouseEvents(value) { this.calls.push(['ignoreMouse', value]); }
    setAlwaysOnTop(value, level) { this.calls.push(['onTop', value, level]); }
    setVisibleOnAllWorkspaces(value) { this.calls.push(['allWorkspaces', value]); }
    setContentProtection(value) { this.calls.push(['contentProtection', value]); }
    setBounds(bounds) { this.options = { ...this.options, ...bounds }; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    showInactive() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => displays });
  return { BrowserWindow, screen: () => screen, created, displays, emitter: screen };
}

test('the frame appears on every display while the AI acts and goes away when it stops', async () => {
  const f = fakes([
    { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 957 } },
    { id: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, workArea: { x: 1512, y: 0, width: 1920, height: 1080 } }
  ]);
  const overlay = createComputerOverlay({ BrowserWindow: f.BrowserWindow, screen: f.screen, app: { getLocale: () => 'zh-CN' } });
  overlay.activity('conversation-a', 'NextMux-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.created.length, 2);
  for (const window of f.created) {
    assert.equal(window.options.focusable, false);
    assert.equal(window.options.transparent, true);
    assert.deepEqual(window.calls.find(call => call[0] === 'ignoreMouse'), ['ignoreMouse', true], 'clicks pass through');
    assert.deepEqual(window.calls.find(call => call[0] === 'contentProtection'), ['contentProtection', true], 'kept out of screenshots');
    assert.equal(window.shown, true);
  }
  const page = decodeURIComponent(f.created[0].url.slice(f.created[0].url.indexOf(',') + 1));
  assert.match(page, /正在控制电脑/);
  assert.match(page, /按 Esc 退出控制/);
  assert.doesNotMatch(page, /NextMux-1/);
  assert.match(page, /top:35px/, 'the pill sits below the menu bar');
  overlay.activity('conversation-a', 'NextMux');
  assert.equal(f.created.length, 2, 'more actions reuse the frame');
  overlay.end('conversation-a');
  assert.ok(f.created.every(window => window.destroyed));
  assert.equal(overlay.active(), false);
});

test('a quiet spell hides the frame even if the run never released its session', async () => {
  const f = fakes();
  const overlay = createComputerOverlay({ BrowserWindow: f.BrowserWindow, screen: f.screen, app: { getLocale: () => 'en-US' }, idleHideMs: 20 });
  overlay.activity('conversation-b', 'NextMux-2');
  assert.equal(f.created.length, 1);
  assert.match(decodeURIComponent(f.created[0].url), /is using your computer/);
  assert.match(decodeURIComponent(f.created[0].url), /press Esc to stop/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(f.created[0].destroyed, true);
  assert.equal(overlay.active(), false);
});

test('labels are escaped and the automation engine drives the frame per conversation', async () => {
  assert.doesNotMatch(overlayPage({ status: 'x', labels: ['<script>'], pillTop: 10 }), /<script>/);
  const events = [];
  const overlay = { activity: (id, label) => events.push(['activity', id, label]), end: id => events.push(['end', id]), dispose: () => events.push(['dispose']) };
  const engine = new ComputerAutomation({ platform: 'darwin', architecture: 'arm64', overlay, sdkLoader: async () => ({ create: async () => ({ listApps: async () => [], close: async () => undefined }) }) });
  engine.capability = () => ({ available: true });
  const result = await engine.run({ id: 'request-1', conversationId: 'conversation-c', action: 'listApps', input: {}, expiresAt: Date.now() + 60_000 }, 7);
  assert.equal(result.ok, true);
  assert.deepEqual(events[0], ['activity', 'conversation-c', 'NextMux']);
  await engine.release('conversation-c', 7);
  assert.deepEqual(events.at(-1), ['end', 'conversation-c']);
  await engine.dispose();
  assert.ok(events.some(event => event[0] === 'dispose'));
});


test('an active overlay follows all twelve app locales and refreshes when the renderer changes language', async () => {
  const f = fakes();
  const app = Object.assign(new EventEmitter(), { getLocale: () => 'zh-CN' });
  const overlay = createComputerOverlay({ BrowserWindow: f.BrowserWindow, screen: f.screen, app });
  const key = Symbol.for('nextmux.desktop.app-locale.v1');
  overlay.activity('locale-test', 'NextMux-1');
  const rendered = new Set();
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    app[key] = locale;
    app.emit('nextmux-locale-changed', locale);
    const page = decodeURIComponent(f.created[0].url);
    rendered.add(page);
    if (locale === 'zh-TW') assert.match(page, /正在控制電腦/);
    if (locale === 'en') assert.match(page, /is using your computer/);
  }
  assert.equal(rendered.size, 12);
  assert.equal(f.created.length, 1, 'locale changes reuse the native overlay');
  overlay.dispose();
  assert.equal(app.listenerCount('nextmux-locale-changed'), 0);
});
