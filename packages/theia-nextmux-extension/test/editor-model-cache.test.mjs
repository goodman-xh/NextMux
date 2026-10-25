import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

test('editor model cache keeps undo model for open tabs and releases a closed tab', async () => {
  const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const nextMuxEditorModelCache =');
  const end = source.indexOf('class NextMuxFileEditor extends', start);
  assert.ok(start >= 0 && end > start);
  const snippet = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  let disposed = 0;
  const fakeMonaco = {
    editor: {
      createModel(content) {
        return { value: content, isDisposed: () => false, dispose: () => { disposed++; } };
      }
    },
    Uri: { parse: value => value }
  };
  const helpers = Function('monaco', `${snippet}; return { acquireNextMuxEditorModel, releaseNextMuxEditorModel, reconcileNextMuxEditorModelCache };`)(fakeMonaco);
  const first = helpers.acquireNextMuxEditorModel('file:///work/a.ts::current', 'one', 'typescript');
  helpers.reconcileNextMuxEditorModelCache(['file:///work/a.ts']);
  helpers.releaseNextMuxEditorModel('file:///work/a.ts::current');
  assert.equal(disposed, 0, 'switching away from an open tab keeps its model');
  const second = helpers.acquireNextMuxEditorModel('file:///work/a.ts::current', 'one', 'typescript');
  assert.equal(second.reused, true);
  helpers.reconcileNextMuxEditorModelCache([]);
  helpers.releaseNextMuxEditorModel('file:///work/a.ts::current');
  assert.equal(disposed, 1, 'closing the tab releases the model');
  assert.notEqual(first.model, undefined);
});

test('a reused draft model compares Undo and Redo to the saved baseline after a tab switch', async () => {
  const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const methods = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && ['bindModel', 'normalizeModelEol'].includes(node.name.getText(file))) methods.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file); assert.equal(methods.length, 2);
  const code = ts.transpile(`class Editor { ${methods.join('\n')} };`, { target: ts.ScriptTarget.ES2022 });
  const Editor = Function('monaco', `${code}; return Editor;`)({ KeyMod: { CtrlCmd: 1, Shift: 2 }, KeyCode: { KeyS: 1, KeyZ: 2, KeyY: 3 },
    editor: { EditorOption: { minimap: 'minimap' } } });
  for (const side of ['before', 'current']) {
    const dirty = [], editor = new Editor(); let value = 'unsaved draft', changed;
    editor.props = { content: 'disk', beforeContent: 'before', onContentChange() {}, onDirty: value => dirty.push(value) };
    editor.baselineBySide = new Map(); editor.dirtyBySide = new Map(); editor.disposables = []; editor.validateModel = () => {};
    const model = { getValue: () => value, onDidChangeContent: fn => { changed = fn; } };
    editor.bindModel(model, side, { onDidFocusEditorText() {}, onDidScrollChange() {}, addCommand() {},
      onDidChangeConfiguration: () => ({ dispose() {} }), getOption: () => ({ enabled: true }), updateOptions() {} });
    assert.equal(editor.dirtyBySide.get(side), true);
    value = side === 'current' ? 'disk' : 'before'; changed();
    assert.equal(dirty.at(-1), false, 'undoing the draft restores the saved baseline');
    value = 'unsaved draft'; changed();
    assert.equal(dirty.at(-1), true, 'redo restores the dirty draft');
  }
});
