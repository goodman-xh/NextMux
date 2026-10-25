import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inactiveWindowButtonsSupported, installInactiveWindowButtons, WINDOW_FULLSCREEN_CLASS, WINDOW_INACTIVE_CLASS } from '../lib/browser/nextmux-inactive-window-buttons.js';

function fakeDocument() {
  const classes = new Set();
  const appended = [];
  const element = () => { const node = { className: '', attributes: {}, children: [], setAttribute(name, value) { this.attributes[name] = value; },
    append(...nodes) { this.children.push(...nodes); }, remove() { const index = appended.indexOf(this); if (index >= 0) appended.splice(index, 1); } }; return node; };
  return { appended, classes, createElement: element, body: { appendChild(node) { appended.push(node); },
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, remove(...names) { names.forEach(name => classes.delete(name)); } } } };
}

test('only macOS 26 and later get the calibrated discs', () => {
  assert.equal(inactiveWindowButtonsSupported(26), true);
  assert.equal(inactiveWindowButtonsSupported(27), true);
  assert.equal(inactiveWindowButtonsSupported(15), false, 'macOS 15 lays the buttons out differently');
  assert.equal(inactiveWindowButtonsSupported(0), false);
  const doc = fakeDocument();
  const off = installInactiveWindowButtons(doc, { macosMajor: 15, onWindowFocusChange: () => () => undefined });
  assert.equal(doc.appended.length, 0);
  off();
});

test('the real window focus and full-screen state drive the discs', async () => {
  const doc = fakeDocument();
  let push;
  let unsubscribed = false;
  const off = installInactiveWindowButtons(doc, {
    macosMajor: 26,
    getWindowFocusState: async () => ({ focused: true, fullScreen: false }),
    onWindowFocusChange: callback => { push = callback; return () => { unsubscribed = true; }; }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(doc.appended.length, 1);
  assert.equal(doc.appended[0].className, 'nmx-inactive-window-buttons');
  assert.equal(doc.appended[0].children.length, 3);
  assert.equal(doc.classes.has(WINDOW_INACTIVE_CLASS), false);
  push({ focused: false, fullScreen: false });
  assert.equal(doc.classes.has(WINDOW_INACTIVE_CLASS), true);
  push({ focused: false, fullScreen: true });
  assert.equal(doc.classes.has(WINDOW_FULLSCREEN_CLASS), true);
  push({ focused: true, fullScreen: false });
  assert.equal(doc.classes.has(WINDOW_INACTIVE_CLASS), false);
  off();
  assert.equal(unsubscribed, true);
  assert.equal(doc.appended.length, 0);
});

test('discs only show for the light theme, outside full screen and modals, at the calibrated centres', () => {
  const css = readFileSync(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url), 'utf8');
  assert.ok(css.includes('body.nmx-window-inactive:not(.nmx-window-fullscreen):not(.nmx-modal-open):has(#nextmux\\.desktop\\.widget:not(.lm-mod-hidden) .nmx-shell.nmx-theme-light) .nmx-inactive-window-buttons { display: block; }'));
  // Centres 20 / 42 / 64 pt and 18 pt down, 14.5 pt discs (measured on macOS 26).
  for (const [nth, left] of [[1, 12.75], [2, 34.75], [3, 56.75]]) assert.ok(css.includes(`i:nth-child(${nth}) { left: ${left}px; }`));
  assert.match(css, /top: 10\.75px; width: 14\.5px; height: 14\.5px/);
  const main = readFileSync(new URL('../src/electron-main/nextmux-conversation-windows.ts', import.meta.url), 'utf8');
  assert.match(main, /app\.on\('browser-window-blur', \(_event, window\) => sendFocus\(window\)\);/);
  const preload = readFileSync(new URL('../../../apps/desktop/nextmux-electron-preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /macosMajor: typeof process !== 'undefined' && process\.platform === 'darwin' && typeof process\.getSystemVersion === 'function'/);
});
