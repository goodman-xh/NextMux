import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise current production methods with controlled observer/timer deliveries.
// Monaco API: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneEditorConstructionOptions.html
// Resize delivery: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = name => file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
const member = (owner, name) => {
  const node = klass(owner).members.find(node => node.name?.getText(file) === name);
  assert.ok(node, `${owner}.${name} exists`);
  return node.getText(file);
};
const compile = (text, deps = {}) => Function(...Object.keys(deps), ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(deps));
function editorHarness(names, dependencies = {}) {
  const Editor = compile(`class NextMuxFileEditor { ${names.map(name => member('NextMuxFileEditor', name)).join('\n')} }; return NextMuxFileEditor;`, dependencies);
  return Object.assign(new Editor(), { props: { content: 'line one\r\nline two\r\n', theme: 'dark', onContentChange() {}, onDirty() {} },
    dirtyBySide: new Map(), baselineBySide: new Map(), models: [], disposables: [], fallbackDisposables: [], modelCacheKeys: [], newlyCreatedModelKeys: new Set() });
}

test('Codex themes register once and editor options select the exact palette and font stack', () => {
  const registered = new Map(); let calls = 0;
  const editor = editorHarness(['themesRegistered', 'registerThemes', 'editorOptions'], { monaco: { editor: { defineTheme(name, theme) { calls++; registered.set(name, theme); } } } });
  editor.lineNumbersMinChars = () => 1;
  editor.registerThemes(); editor.registerThemes();
  const another = new editor.constructor(); another.registerThemes();
  assert.equal(calls, 2);
  const tokens = [ ['comment'], ['keyword', 'storage', 'storage.modifier', 'tag', 'entity.name.tag', 'metatag', 'markup.heading'],
    ['storage.type', 'type', 'class', 'interface', 'function', 'identifier.function', 'support.function', 'entity.name.function',
      'entity.name.type', 'entity.name.class', 'support.class', 'support.type'],
    ['string', 'attribute.value'], ['regexp'],
    ['string.escape', 'constant.character.escape', 'number', 'constant.numeric', 'constant.language', 'boolean', 'attribute.name', 'entity.other.attribute-name'],
    ['constant', 'variable', 'variable.other', 'variable.property', 'property', 'meta.object-literal.key', 'key'],
    ['operator', 'keyword.operator', 'delimiter', 'punctuation', 'variable.parameter', 'support.type.property-name', 'string.key.json'] ];
  for (const [mode, base, colors, themeColors] of [
    ['dark', 'vs-dark', ['999999', 'F67576', 'B06DFF', '85DF7B', '3D8DFF', '6DCBF4', 'FA994C', '999999'],
      { 'editor.background': '#181818', 'editorGutter.background': '#181818', 'editor.foreground': '#FCFCFC',
        'editorLineNumber.foreground': '#5C5C5C', 'editorLineNumber.activeForeground': '#A0A0A0',
        'editor.lineHighlightBackground': '#ffffff0a', 'editor.selectionBackground': '#0169cc59' }],
    ['light', 'vs', ['666666', 'D53538', '751ED9', '008809', '001BCB', '0071EA', 'BD5800', '666666'],
      { 'editor.background': '#f9f9f9', 'editorGutter.background': '#f9f9f9', 'editor.foreground': '#0D0D0D',
        'editorLineNumber.foreground': '#A8A8A8', 'editorLineNumber.activeForeground': '#4F4F4F',
        'editor.lineHighlightBackground': '#0000000a', 'editor.selectionBackground': '#0169cc33' }]
  ]) {
    const theme = registered.get(`nextmux-codex-${mode}`);
    assert.equal(theme.base, base); assert.equal(theme.inherit, true);
    assert.deepEqual(theme.colors, themeColors);
    for (const [index, group] of tokens.entries()) for (const token of group) assert.equal(theme.rules.find(rule => rule.token === token)?.foreground, colors[index]);
    editor.props.theme = mode;
    assert.equal(editor.editorOptions().theme, `nextmux-codex-${mode}`);
  }
  assert.equal(editor.editorOptions().automaticLayout, false);
  const font = 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", "PingFang SC", "Microsoft YaHei UI", monospace';
  assert.equal(editor.editorOptions().fontFamily, font);
  const terminal = file.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(file) === 'NEXTMUX_TERMINAL_FONT_FAMILY'));
  assert.equal(terminal.declarationList.declarations[0].initializer.text, 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Microsoft YaHei UI", monospace');
});

test('editor resize bursts produce one layout per frame and unmount cancels pending work', () => {
  const frames = new Map(); let id = 0, observed, callback, disconnected = 0, layouts = 0, disposed = 0;
  const window = { requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } };
  class ResizeObserver { constructor(fn) { callback = fn; } observe(host) { observed = host; } disconnect() { disconnected++; } }
  const editor = editorHarness(['observeEditorLayout', 'disposeEditor'], { window, ResizeObserver, releaseNextMuxEditorModel() {} });
  editor.host = { replaceChildren() {}, classList: { remove() {} } };
  editor.editor = { layout() { layouts++; }, dispose() { disposed++; } };
  editor.observeEditorLayout();
  assert.equal(observed, editor.host); assert.equal(layouts, 1, 'mount lays out immediately');
  callback(); callback(); callback();
  assert.equal(layouts, 1); assert.equal(frames.size, 1);
  const next = [...frames.values()][0]; frames.clear(); next();
  assert.equal(layouts, 2);
  callback(); editor.disposeEditor();
  assert.equal(frames.size, 0); assert.equal(disconnected, 1); assert.equal(disposed, 1);
  assert.equal(editor.resizeObserver, undefined);
});

test('LF models accept CRLF disk refreshes and save acknowledgements without false dirty or redundant edits', () => {
  const events = []; let value = 'line one\nline two\n', operations = 0;
  const model = { getValue: () => value, pushStackElement() {}, getFullModelRange: () => ({}), pushEditOperations(_before, changes) { operations++; value = changes[0].text.replace(/\r\n/g, '\n'); } };
  const editor = editorHarness(['normalizeModelEol', 'acceptRefreshedSource', 'acceptSavedRevision']);
  editor.models = [model]; editor.props.onDirty = dirty => events.push(dirty);
  editor.acceptRefreshedSource({ content: 'line one\r\nline two\r\n' });
  assert.equal(operations, 0); assert.equal(editor.dirtyBySide.get('current'), false);
  assert.equal(editor.baselineBySide.get('current'), value);
  editor.acceptSavedRevision(); assert.equal(events.at(-1), false);
  const previous = editor.props;
  editor.props = { ...previous, content: 'new\r\nsource\r\n' };
  editor.acceptRefreshedSource(previous);
  assert.equal(operations, 1); assert.equal(value, 'new\nsource\n');
  assert.equal(editor.baselineBySide.get('current'), value);
  value += 'user edit'; editor.acceptSavedRevision(); assert.equal(events.at(-1), true);
});

function recoveryHarness() {
  const timers = new Map(), captures = []; let sequence = 0;
  const window = { setTimeout(callback, delay) { timers.set(++sequence, { callback, delay }); return sequence; }, clearTimeout(id) { timers.delete(id); } };
  const module = { exports: {} };
  compile(readFileSync(new URL('../src/browser/nextmux-editor-draft-recovery.ts', import.meta.url), 'utf8'), { module, exports: module.exports, require: () => ({}) });
  const names = ['scheduleContextEditorRecoveryCapture', 'captureContextEditorRecovery', 'detachContextEditorRecovery', 'requestContextFileSave'];
  const Widget = compile(`class Widget { ${names.map(name => member('NextMuxDesktopWidget', name)).join('\n')} }; return Widget;`, { window, editorRecoveryDirty: module.exports.editorRecoveryDirty });
  const preview = { uri: 'file:///large.txt', name: 'large.txt', content: 'a'.repeat(500_000), recoveryKey: 'draft-A', recoverySessionId: 'A' };
  const controller = { entries: new Map(), capture(key, snapshot) { captures.push(JSON.stringify(snapshot)); return true; } };
  const widget = Object.assign(new Widget(), { contextFilePreview: preview, contextFileDrafts: { current: preview.content },
    contextFileTabs: new Map(), contextFileSavingUris: new Set(), editorRecoveryController: () => controller,
    rememberContextFileTab() {}, update() {}, writeContextFile() {} });
  return { widget, timers, captures, input(text) { widget.contextFileDrafts = { current: text }; widget.scheduleContextEditorRecoveryCapture(); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(item => item.callback()); } };
}

test('500KB typing defers serialization for 250ms while detach and save synchronously capture the newest draft', () => {
  const f = recoveryHarness();
  for (let index = 0; index < 10; index++) f.input('b'.repeat(500_000) + index);
  assert.equal(f.captures.length, 0); assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 250);
  assert.equal(f.widget.contextFileRecoveryUncaptured, true, 'an old acknowledgement cannot cover pending input');
  f.flush(); assert.equal(f.captures.length, 1); assert.equal(f.widget.contextFileRecoveryUncaptured, false);
  assert.ok(JSON.parse(f.captures[0]).drafts.current.endsWith('9'));
  f.input('before switching'); assert.equal(f.widget.detachContextEditorRecovery(), true);
  assert.equal(f.timers.size, 0); assert.equal(JSON.parse(f.captures.at(-1)).drafts.current, 'before switching');
  f.input('before saving'); f.widget.requestContextFileSave('current', 'before saving');
  assert.equal(f.timers.size, 0); assert.equal(JSON.parse(f.captures.at(-1)).drafts.current, 'before saving');
  assert.equal(f.widget.pendingFileSave.content, 'before saving');
});

test('sidebar conversation navigation proceeds after rejected recovery while restoration preserves the unbacked tab', async () => {
  const methods = ['openCodingSession', 'restoreCodingViewState', 'detachContextEditorRecovery'];
  const Widget = compile(`class Widget { ${methods.map(name => member('NextMuxDesktopWidget', name)).join('\n')} }; return Widget;`, {
    window: { setTimeout() {} }, requestAnimationFrame() {}, editorRecoveryText: (_locale, key) => key
  });
  const preview = { uri: 'file:///oversized.txt', content: 'disk', recoveryKey: 'owner-A', recoverySessionId: 'A' };
  const drafts = { current: 'x'.repeat(1_100_000) }, tab = { preview, drafts, dirty: true };
  const captures = [], notifications = [];
  const widget = Object.assign(new Widget(), {
    codingSessionNavigationGeneration: 0, tiledCodingSessionIds: new Set(), removedCodingSessionIds: new Set(), expandedCodingProjects: new Set(),
    codingSessions: [{ id: 'A', turns: [] }, { id: 'B', turns: [] }], activeCodingSessionId: 'A',
    contextFileTabs: new Map([[preview.uri, tab]]), contextFilePreview: preview, contextFileDrafts: drafts, contextFileDirty: true,
    activeSection: 'coding', codingPanel: 'thread', isDisposed: false,
    captureContextEditorRecovery(...args) { captures.push(args); return false; },
    addNotification(...args) { notifications.push(args); }, stopVoiceInput() {}, flushComposerDraft() {}, persistActiveCodingSessionState() {},
    cancelContextFileListScrollRestore() {}, disconnectInactiveConversationTabs() {}, rememberNavigation() {},
    leaveCouncilRoleSubConversationToConversation() {}, restoreComposerDraft() {}, sessionPermissionMode() { return 'read_only'; },
    restoreCodingSourceSelection() {}, persistDesktopRestoreState() {}, syncActiveRelay() {}, syncModelRoute() {}, syncActiveTerminal() {},
    loadContextFiles() {}, update() {}, restoreCodingSessionState(session) { return this.restoreCodingViewState(session.viewState); }
  });
  await widget.openCodingSession('B');
  assert.equal(widget.activeCodingSessionId, 'B');
  assert.deepEqual(captures, [[false, true], [false, true]]);
  assert.equal(widget.contextFilePreview, preview);
  assert.equal(widget.contextFileDrafts, drafts);
  assert.equal(widget.contextFileTabs.get(preview.uri), tab);
  assert.equal(widget.contextFilePreview.recoverySessionId, 'A', 'draft keeps its original owner');
  assert.equal(notifications.length, 1, 'restoration reports the preserved unbacked tab without blocking navigation');
});
