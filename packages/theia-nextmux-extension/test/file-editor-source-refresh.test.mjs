import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platformRequire = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
// Mount the entire production React editor, its model cache and language
// registrations against the real Monaco library in a disposable browser.
// Language registration lives in its own module; the editor + model cache start at the cache interface.
const editorSource = source.slice(source.indexOf('interface NextMuxCachedEditorModel'), source.indexOf('interface NextMuxBrowserViewProps'));
const languagesModule = fileURLToPath(new URL('../src/browser/nextmux-editor-languages.ts', import.meta.url));
const bundle = desktopRequire('esbuild').buildSync({ stdin: { contents: `
import * as React from 'react';
import { createRoot } from ${JSON.stringify(coreRequire.resolve('react-dom/client'))};
import { flushSync } from ${JSON.stringify(coreRequire.resolve('react-dom'))};
import * as monaco from '@theia/monaco-editor-core/esm/vs/editor/editor.api.js';
import { ensureNextMuxEditorLanguages, ensureEditorLanguage, editorLanguageForName } from ${JSON.stringify(languagesModule)};
${editorSource}
const root = createRoot(document.getElementById('host'));
let instance, props, edits = [], dirty = [];
window.fixture = {
  mount(extra = {}) {
    flushSync(() => root.render(null));
    edits = []; dirty = [];
    props = { uri: 'file:///isolated/source.txt', name: 'source.txt', content: 'branch-two', revision: 1,
      theme: 'dark', initialDrafts: { current: 'branch-two' },
      clipboardService: {}, onClipboardError(error) { throw error; },
      onContentChange(side, content) { edits.push([side, content]); }, onDirty(value) { dirty.push(value); },
      onSave() {}, onFocus() {}, ...extra };
    reconcileNextMuxEditorModelCache([props.uri]);
    flushSync(() => root.render(React.createElement(NextMuxFileEditor, { ...props, ref: value => { instance = value; } })));
    if (!instance?.editor || !instance.models.length) throw Error('Real Monaco failed to mount');
    return this.snapshot();
  },
  update(extra) { props = { ...props, ...extra }; flushSync(() => root.render(React.createElement(NextMuxFileEditor, { ...props, ref: value => { instance = value; } }))); return this.snapshot(); },
  snapshot() { const model = instance.editor?.getModel(); return { current: model?.modified?.getValue() ?? model?.getValue(),
    before: model?.original?.getValue(), dirty: dirty.at(-1) ?? false, edits: [...edits],
    canUndo: (model?.modified || model)?.canUndo(), fallback: instance.host?.classList.contains('is-fallback') }; },
  type(text, side = 'current') { const pair = instance.editor.getModel(); const model = side === 'before' ? pair.original : pair.modified || pair;
    model.pushStackElement(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null); model.pushStackElement(); return this.snapshot(); },
  async undo() { const pair = instance.editor.getModel(); await (pair.modified || pair).undo(); return this.snapshot(); },
  async redo() { const pair = instance.editor.getModel(); await (pair.modified || pair).redo(); return this.snapshot(); },
  unmount() { flushSync(() => root.render(null)); reconcileNextMuxEditorModelCache([]); },
  fallback() { flushSync(() => root.render(null)); reconcileNextMuxEditorModelCache([]);
    const original = NextMuxFileEditor.prototype.createEditor;
    NextMuxFileEditor.prototype.createEditor = () => { throw Error('Force real textarea fallback'); };
    try { props = { ...props, uri: 'file:///isolated/fallback.txt', content: 'branch-two', beforeContent: undefined,
      initialDrafts: { current: 'branch-two' }, revision: 1, sourceRevision: undefined };
      flushSync(() => root.render(React.createElement(NextMuxFileEditor, { ...props, ref: value => { instance = value; } })));
    } finally { NextMuxFileEditor.prototype.createEditor = original; }
    return instance.host.querySelector('textarea').value;
  },
  fallbackValue() { return { value: instance.host.querySelector('textarea').value, dirty: dirty.at(-1) }; },
  fallbackType(value) { const area = instance.host.querySelector('textarea'); area.value = value; area.dispatchEvent(new Event('input')); return this.fallbackValue(); }
};
`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'browser', format: 'iife', write: false, outfile: '/isolated-editor.js',
  loader: { '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });

test('production React editor reconciles restored disk content using real Monaco without a false dirty draft', { timeout: 30_000 }, async t => {
  const { default: puppeteer } = await import(platformRequire.resolve('puppeteer'));
  const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  await page.setContent('<style>html,body,#host,.nmx-monaco-file-editor{width:100%;height:100%;margin:0}</style><div id="host"></div>');
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'));
  if (css) await page.addStyleTag({ content: css.text });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });

  await t.test('clean restore replaces the model and retains real undo/redo boundaries', async () => {
    assert.equal((await page.evaluate(() => fixture.mount())).fallback, false);
    const updated = await page.evaluate(() => fixture.update({ content: 'before', initialDrafts: { current: 'before' }, revision: 2, sourceRevision: 1 }));
    assert.equal(updated.current, 'before'); assert.equal(updated.dirty, false);
    assert.equal(updated.edits.at(-1)[1], 'before'); assert.equal(updated.canUndo, true);
    const undone = await page.evaluate(() => fixture.undo());
    assert.equal(undone.current, 'branch-two'); assert.equal(undone.dirty, true);
    const redone = await page.evaluate(() => fixture.redo());
    assert.equal(redone.current, 'before'); assert.equal(redone.dirty, false);
    await page.evaluate(() => fixture.unmount());
  });

  await t.test('Windows CRLF baselines remain clean across LF models, disk refresh, save and cached remount', async () => {
    await page.evaluate(() => fixture.mount({ content: 'one\r\ntwo\r\n', initialDrafts: { current: 'one\ntwo\n' } }));
    const same = await page.evaluate(() => fixture.update({ content: 'one\r\ntwo\r\n', revision: 2, sourceRevision: 1 }));
    assert.equal(same.dirty, false); assert.equal(same.canUndo, false, 'EOL-only refresh never inserts an undo operation');
    const updated = await page.evaluate(() => fixture.update({ content: 'new\r\ntext\r\n', revision: 3, sourceRevision: 2 }));
    assert.equal(updated.current.replace(/\r\n/g, '\n'), 'new\ntext\n'); assert.equal(updated.dirty, false);
    await page.evaluate(() => fixture.type('user\nedit\n'));
    const saved = await page.evaluate(() => fixture.update({ content: 'user\r\nedit\r\n', revision: 4 }));
    assert.equal(saved.dirty, false);
    const remounted = await page.evaluate(() => fixture.mount({ content: 'user\r\nedit\r\n', initialDrafts: { current: 'user\nedit\n' } }));
    assert.equal(remounted.dirty, false);
    await page.evaluate(() => fixture.unmount());
  });

  await t.test('a normal save acknowledgement preserves typing made after that save started', async () => {
    await page.evaluate(() => fixture.mount());
    await page.evaluate(() => fixture.type('new user draft'));
    const result = await page.evaluate(() => fixture.update({ content: 'saved submitted text', revision: 2 }));
    assert.equal(result.current, 'new user draft'); assert.equal(result.dirty, true);
    await page.evaluate(() => fixture.unmount());
  });

  await t.test('typing between a restored source read and React render is not overwritten', async () => {
    await page.evaluate(() => fixture.mount()); await page.evaluate(() => fixture.type('typed during refresh'));
    const result = await page.evaluate(() => fixture.update({ content: 'before', initialDrafts: { current: 'before' }, revision: 2, sourceRevision: 1 }));
    assert.equal(result.current, 'typed during refresh'); assert.equal(result.dirty, true);
    await page.evaluate(() => fixture.unmount());
  });

  await t.test('a diff keeps its historical side while the current model follows the restored disk', async () => {
    await page.evaluate(() => fixture.mount({ beforeContent: 'historical', initialDrafts: { current: 'branch-two', before: 'historical' } }));
    const result = await page.evaluate(() => fixture.update({ content: 'before', initialDrafts: { current: 'before', before: 'historical' }, revision: 2, sourceRevision: 1 }));
    assert.equal(result.current, 'before'); assert.equal(result.before, 'historical'); assert.equal(result.dirty, false);
    await page.evaluate(() => fixture.unmount());
  });

  await t.test('the real textarea fallback refreshes its baseline without marking restored text dirty', async () => {
    await page.evaluate(() => fixture.mount()); assert.equal(await page.evaluate(() => fixture.fallback()), 'branch-two');
    await page.evaluate(() => fixture.update({ content: 'before', initialDrafts: { current: 'before' }, revision: 2, sourceRevision: 1 }));
    assert.deepEqual(await page.evaluate(() => fixture.fallbackValue()), { value: 'before', dirty: false });
    assert.deepEqual(await page.evaluate(() => fixture.fallbackType('user input')), { value: 'user input', dirty: true });
    assert.deepEqual(await page.evaluate(() => fixture.fallbackType('before')), { value: 'before', dirty: false });
    await page.evaluate(() => fixture.fallbackType('typed during refresh'));
    await page.evaluate(() => fixture.update({ content: 'next disk version', revision: 3, sourceRevision: 2 }));
    assert.deepEqual(await page.evaluate(() => fixture.fallbackValue()), { value: 'typed during refresh', dirty: true });
    assert.deepEqual(await page.evaluate(() => fixture.fallbackType('before')), { value: 'before', dirty: true });
    assert.deepEqual(await page.evaluate(() => fixture.fallbackType('next disk version')), { value: 'next disk version', dirty: false });
    await page.evaluate(() => fixture.unmount());
  });
});
