import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { desktopEditorShortcutPlan } from './desktop-editor-shortcuts.mjs';

for (const platform of ['darwin', 'win32', 'linux']) test(`${platform} editor shortcuts use the platform modifier and release every held key`, () => {
  const mac = platform === 'darwin', modifier = mac ? 4 : 2;
  for (const action of ['selectAll', 'find', 'replace', 'undo', 'redo', 'save', 'documentEnd']) {
    const events = desktopEditorShortcutPlan(action, platform), held = new Set();
    assert.equal(events[0].key, mac ? 'Meta' : 'Control');
    assert.equal(events[0].modifiers, modifier);
    for (const event of events) {
      assert.ok(Number.isSafeInteger(event.windowsVirtualKeyCode));
      assert.equal(Object.hasOwn(event, 'nativeVirtualKeyCode'), false, 'do not reuse Windows codes as macOS native codes');
      if (event.type === 'rawKeyDown') held.add(event.code);
      else { assert.equal(event.type, 'keyUp'); assert.ok(held.delete(event.code)); }
    }
    assert.equal(held.size, 0); assert.equal(events.at(-1).modifiers, 0);
    const key = events.find(event => event.type === 'rawKeyDown' && !['Control', 'Meta', 'Shift'].includes(event.key));
    assert.equal(key.modifiers, modifier | (action === 'redo' ? 8 : 0));
    assert.equal(events.length, action === 'redo' ? 6 : 4);
    if (action === 'documentEnd') assert.equal(key.key, mac ? 'ArrowDown' : 'End');
    else assert.equal(key.code, { selectAll: 'KeyA', find: 'KeyF', replace: 'KeyH', undo: 'KeyZ', redo: 'KeyZ', save: 'KeyS' }[action]);
    assert.equal(events.some(event => event.key === (mac ? 'Control' : 'Meta')), false);
  }
});

test('document-end plan matches the actual installed Monaco platform bindings', () => {
  const require = createRequire(new URL('../packages/theia-nextmux-extension/package.json', import.meta.url));
  const path = join(dirname(require.resolve('@theia/monaco-editor-core/package.json')), 'esm/vs/editor/browser/coreCommands.js');
  const source = readFileSync(path, 'utf8');
  const command = source.slice(source.indexOf("id: 'cursorBottom',"), source.indexOf('CoreNavigationCommands.CursorBottomSelect'));
  assert.match(command, /primary: 2048 \/\* KeyMod\.CtrlCmd \*\/ \| 13 \/\* KeyCode\.End \*\//);
  assert.match(command, /mac: \{ primary: 2048 \/\* KeyMod\.CtrlCmd \*\/ \| 18 \/\* KeyCode\.DownArrow \*\/ \}/);
});

test('file regression dispatches real platform shortcuts and retains undo/redo/save assertions', () => {
  const source = readFileSync(new URL('./desktop-file-editor-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /desktopEditorShortcutPlan\(action, process\.platform\)/);
  assert.match(source, /call\('Input\.dispatchKeyEvent', event\)/);
  for (const action of ['selectAll', 'find', 'replace', 'undo', 'redo', 'save', 'documentEnd']) assert.ok(source.includes(`await shortcut('${action}')`));
  assert.match(source, /undo clears dirty marker/); assert.match(source, /redo after save returns to saved baseline/);
  assert.match(source, /waitForDisk\(editablePath, editMarker/);
  assert.doesNotMatch(source, /modifiers:\s*(?:2|10)\b|ctrlEnd\(|editor\.undo\(|model\.undo\(|executeCommand\(|\.trigger\(/);
});

test('unknown platforms and shortcut actions fail rather than silently using Control', () => {
  assert.throws(() => desktopEditorShortcutPlan('undo', 'unknown'), /Unsupported desktop shortcut platform/);
  assert.throws(() => desktopEditorShortcutPlan('toString', 'darwin'), /Unsupported desktop editor shortcut/);
});
