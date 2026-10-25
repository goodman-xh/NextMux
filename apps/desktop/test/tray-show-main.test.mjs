import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import path from 'node:path';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');
const body = source.match(/const showWorkbench = \(\) => \{([\s\S]*?)\n  \};\n  try \{/s)?.[1];
assert.ok(body, 'updater must keep a testable tray show-workbench function');
const showMainKey = Symbol.for('nextmux.desktop.show-main.v1');
const quittingKey = Symbol.for('nextmux.desktop.is-quitting.v1');
const detachedKey = Symbol.for('nextmux.conversation-window.detached.v1');

test('Windows loads the product ICO while macOS uses its transparent status template', () => {
  const start = source.indexOf('const iconPath = ');
  const end = source.indexOf('let image =', start);
  assert.ok(start >= 0 && end > start);
  const selectIcon = new Function('process', 'app', 'path', 'existsSync', 'iconName',
    `${source.slice(start, end)} return iconPath;`);
  const app = { getAppPath: () => '/app' };
  for (const packaged of [true, false]) {
    const exists = candidate => packaged ? candidate.startsWith('/resources/') : candidate.startsWith('/app/');
    const prefix = packaged ? '/resources/' : '/app/build-resources/';
    assert.equal(selectIcon({ platform: 'win32', resourcesPath: '/resources' }, app, path, exists, 'icon.ico'), `${prefix}icon.ico`);
    assert.equal(selectIcon({ platform: 'darwin', resourcesPath: '/resources' }, app, path, exists, 'icon.png'), `${prefix}tray-logo.png`);
  }
});

function fixture({ showMain, quitting, windows = [] } = {}) {
  const calls = { activate: 0, queried: 0, restores: 0, shows: 0, focuses: 0 };
  const app = { emit(event) { if (event === 'activate') calls.activate += 1; },
    [showMainKey]: showMain, [quittingKey]: quitting };
  const candidates = windows.map(candidate => {
    const win = {
      [detachedKey]: Boolean(candidate.detached),
      isDestroyed: () => Boolean(candidate.destroyed),
      isMinimized: () => Boolean(candidate.minimized),
      restore: () => { calls.restores += 1; candidate.minimized = false; },
      show: () => { calls.shows += 1; win.shown = (win.shown || 0) + 1; },
      focus: () => { calls.focuses += 1; win.focused = (win.focused || 0) + 1; },
      webContents: { getURL: () => candidate.url, isLoading: () => Boolean(candidate.loading) }
    };
    return win;
  });
  const BrowserWindow = { getAllWindows: () => { calls.queried += 1; return candidates; } };
  const localRequire = id => id === './main-window-focus.cjs' ? require('../main-window-focus.cjs') : require(id);
  const show = new Function('app', 'BrowserWindow', 'URL', 'showMainWindowKey', 'isQuittingKey', 'require', `return () => {${body}\n};`)(
    app, BrowserWindow, URL, showMainKey, quittingKey, localRequire);
  return { show, calls, candidates };
}

test('tray uses the registered primary show hook only when it reports success', () => {
  const calls = []; const f = fixture({ showMain: () => { calls.push('show-main'); return true; }, windows: [{ url: 'file:///app/index.html' }] });
  f.show(); assert.deepEqual(calls, ['show-main']); assert.deepEqual(f.calls, { activate: 0, queried: 0, restores: 0, shows: 0, focuses: 0 });
});

test('a false primary hook falls back to activate when the primary is destroyed', () => {
  const f = fixture({ showMain: () => false, windows: [{ destroyed: true, url: 'file:///app/index.html' }] });
  f.show(); assert.equal(f.calls.activate, 1); assert.equal(f.calls.queried, 1);
});

test('fallback restores and focuses the non-conversation workbench, never a child or helper window', () => {
  const f = fixture({ windows: [
    { url: 'file:///app/computer-tab-window.html' },
    { url: 'data:text/html,overlay' },
    { detached: true, url: 'file:///app/index.html' },
    { minimized: true, url: 'file:///app/index.html' },
    { url: 'file:///app/index.html?nextmuxConversation=session-1' }
  ] });
  f.show(); assert.deepEqual(f.calls, { activate: 0, queried: 1, restores: 1, shows: 1, focuses: 1 });
  assert.equal(f.candidates[3].focused, 1);
});

test('tray does not activate or create a fallback window while native quit is in progress', () => {
  const f = fixture({ showMain: () => false, quitting: () => true, windows: [{ url: 'file:///app/index.html' }] });
  f.show(); assert.equal(f.calls.activate, 0); assert.equal(f.calls.queried, 0);
});

test('tray menu follows the renderer app language with system language as its initial default', () => {
  const start = source.indexOf('const trayLabels = {');
  const end = source.indexOf('const closePreparations = new WeakMap();');
  assert.ok(start >= 0 && end > start, 'tray labels live in one testable table');
  const appLocaleKey = Symbol.for('nextmux.desktop.app-locale.v1');
  const labelsFor = (preferred, locale = 'en-US', selected) => new Function('app', 'appLocaleKey', `${source.slice(start, end)} return trayMenuLabels();`)(
    { getPreferredSystemLanguages: () => preferred, getLocale: () => locale, [appLocaleKey]: selected }, appLocaleKey);
  // “Open window / Close NextMux” as requested on 2026-09-25.
  assert.deepEqual(labelsFor(['zh-Hans-CN']), ['打开界面', '关闭 NextMux']);
  assert.deepEqual(labelsFor(['zh-Hant-TW']), ['開啟介面', '關閉 NextMux']);
  assert.deepEqual(labelsFor(['pt-PT']), ['Abrir janela', 'Sair do NextMux']);
  assert.deepEqual(labelsFor(['ar-EG']), ['فتح النافذة', 'إنهاء NextMux']);
  assert.deepEqual(labelsFor([], 'ja'), ['ウインドウを開く', 'NextMux を終了']);
  assert.deepEqual(labelsFor(['sv-SE']), ['Open window', 'Quit NextMux'], 'unsupported languages fall back to English');
  assert.deepEqual(labelsFor(['zh-Hans-CN'], 'zh-CN', 'en'), ['Open window', 'Quit NextMux']);
  assert.deepEqual(labelsFor(['en-US'], 'en-US', 'zh-TW'), ['開啟介面', '關閉 NextMux']);
  const selected = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  assert.equal(new Set(selected.map(locale => JSON.stringify(labelsFor(['en-US'], 'en-US', locale)))).size, 12);
});
