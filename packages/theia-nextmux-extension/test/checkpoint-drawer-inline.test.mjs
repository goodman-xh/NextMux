import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = require('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = name => ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
const method = (owner, name) => klass(owner).members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast);
const compile = (text, bindings) => Function(...Object.keys(bindings), ts.transpile(text, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
}))(...Object.values(bindings));
const layoutBundle = desktopRequire('esbuild').buildSync({
    entryPoints: [require.resolve('@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions.js')],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
});
const layoutModule = { exports: {} };
Function('require', 'module', 'exports', layoutBundle.outputFiles[0].text)(require, layoutModule, layoutModule.exports);
const { EditorOptions, EditorLayoutInfoComputer } = layoutModule.exports;
const layoutOptions = new Map(Object.values(EditorOptions).map(option => [option.id, option]));
function monacoLayout(options, lines) {
    return EditorLayoutInfoComputer.computeLayout({ get(id) {
        const option = layoutOptions.get(id);
        return option.validate(options[option.name]);
    } }, { outerWidth: 300, outerHeight: 500, lineHeight: 22, lineNumbersDigitCount: String(lines).length,
        typicalHalfwidthCharacterWidth: 8, maxDigitWidth: 8, pixelRatio: 1, viewLineCount: lines,
        isDominatedByLongLines: false, glyphMarginDecorationLaneCount: 1 });
}

function editorFixture(renderSideBySide) {
    const changes = [], dirty = [], saves = [], options = [];
    const model = value => ({ value, listeners: [], getValue() { return this.value; },
        setValue(next) { this.value = next; this.listeners.forEach(listener => listener()); },
        onDidChangeContent(listener) { this.listeners.push(listener); return { dispose() {} }; } });
    const codeEditor = () => ({ commands: [], options: [], updateOptions(value) { this.options.push(value); }, onDidFocusEditorText() { return { dispose() {} }; },
        onDidChangeConfiguration() { return { dispose() {} }; }, onDidScrollChange() { return { dispose() {} }; }, addCommand(key, handler) { this.commands.push([key, handler]); } });
    const originalEditor = codeEditor(), modifiedEditor = codeEditor();
    const textareas = [], classes = new Set();
    const monaco = { KeyMod: { CtrlCmd: 1, Shift: 2 }, KeyCode: { KeyS: 4, KeyZ: 8, KeyY: 16, KeyV: 32, KeyC: 64, KeyX: 128 },
        editor: { create(_host, opts) { options.push(opts); return modifiedEditor; },
            createDiffEditor(_host, opts) { options.push(opts); return { setModel(pair) { this.pair = pair; }, getModel() { return this.pair; },
            updateOptions(value) { options.push(value); }, getOriginalEditor: () => originalEditor, getModifiedEditor: () => modifiedEditor }; } } };
    const document = { createElement() { return { value: '', listeners: new Map(), setAttribute() {},
        addEventListener(name, handler) { this.listeners.set(name, handler); }, removeEventListener() {} }; } };
    const names = ['createEditor', 'componentDidUpdate', 'editorOptions', 'lineNumbersMinChars', 'applyInitialEditorDrafts', 'bindModel', 'createFallbackEditor', 'normalizeModelEol'];
    const Editor = compile(`class Editor { ${names.map(name => method('NextMuxFileEditor', name)).join('\n')} }; return Editor;`, {
        monaco, document, ensureNextMuxEditorLanguages() {}
    });
    const editor = new Editor();
    Object.assign(editor, { props: { uri: 'file:///fixture/source.ts', name: 'source.ts', beforeContent: 'old', content: 'current',
        renderSideBySide, initialDrafts: { before: 'unsaved historical draft', current: 'unsaved current draft' },
        onContentChange: (...args) => changes.push(args), onDirty: value => dirty.push(value), onSave: (...args) => saves.push(args),
        onFocus() {}, onClipboardError() {} },
        host: { classList: { add: name => classes.add(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } }, appendChild: value => textareas.push(value) },
        models: [], disposables: [], fallbackDisposables: [], dirtyBySide: new Map(), baselineBySide: new Map(),
        // Theme registration and the ResizeObserver-driven layout pass are browser-only side effects of createEditor.
        registerThemes() {}, observeEditorLayout() {},
        validateModel() {}, createModel(value, suffix) { const result = model(value); result.suffix = suffix; this.models.push(result); return result; }
    });
    return { editor, changes, dirty, saves, options, originalEditor, modifiedEditor, textareas, classes };
}

test('drawer inline diff keeps both models, draft callbacks and legacy historical-save binding', () => {
    const f = editorFixture(false); f.editor.createEditor();
    assert.equal(f.options[0].renderSideBySide, false);
    assert.equal(f.options[0].originalEditable, true);
    assert.equal(f.options[0].renderOverviewRuler, false);
    assert.equal(f.options[0].renderMarginRevertIcon, false);
    assert.ok(f.classes.has('is-inline-current'));
    assert.deepEqual(f.originalEditor.options[0], { lineNumbers: 'off', lineNumbersMinChars: 0, glyphMargin: false, folding: false, lineDecorationsWidth: 0 });
    assert.equal(f.modifiedEditor.options[0].lineNumbers, 'on');
    assert.deepEqual(f.modifiedEditor.options[0].minimap, {
        enabled: true, autohide: 'none', side: 'right', showSlider: 'mouseover', renderCharacters: true, maxColumn: 80, scale: 1
    });
    assert.deepEqual(f.editor.models.map(model => [model.suffix, model.getValue()]), [
        ['before', 'unsaved historical draft'], ['current', 'unsaved current draft']
    ]);
    f.editor.models[1].setValue('current');
    assert.equal(f.dirty.at(-1), true, 'the hidden original draft must still keep the editor dirty');
    f.originalEditor.commands.find(([key]) => key === 5)[1]();
    assert.deepEqual(f.saves, [['before', 'unsaved historical draft']]);
    f.editor.models[0].setValue('old');
    assert.equal(f.dirty.at(-1), false);
});

test('unspecified layout is inline, while explicit side-by-side callers retain both number columns', () => {
    const f = editorFixture(undefined); f.editor.createEditor();
    assert.equal(f.options[0].renderSideBySide, false);
    const comparison = editorFixture(true); comparison.editor.createEditor();
    assert.equal(comparison.options[0].renderSideBySide, true);
    assert.equal(comparison.options[0].renderOverviewRuler, true);
    assert.equal(comparison.originalEditor.options[0].lineNumbers, 'on');
    assert.equal(comparison.originalEditor.options[0].folding, false);
    assert.equal(comparison.classes.has('is-inline-current'), false);
});

test('switching layouts updates both editor gutters, inline class, overview ruler and code minimap', () => {
    const f = editorFixture(true); f.editor.createEditor();
    const previous = f.editor.props;
    f.editor.props = { ...previous, renderSideBySide: false, largeFile: true };
    f.editor.componentDidUpdate(previous);
    assert.equal(f.classes.has('is-inline-current'), true);
    assert.deepEqual(f.options.at(-1), { renderSideBySide: false, renderOverviewRuler: false, renderMarginRevertIcon: false });
    assert.deepEqual(f.originalEditor.options.at(-1), { lineNumbers: 'off', lineNumbersMinChars: 0, glyphMargin: false, folding: false, lineDecorationsWidth: 0 });
    assert.equal(f.modifiedEditor.options.at(-1).lineNumbers, 'on');
    assert.equal(f.modifiedEditor.options.at(-1).minimap.enabled, false, 'large files keep the minimap disabled for responsiveness');
    assert.equal(f.modifiedEditor.options.at(-1).minimap.renderCharacters, true);
    const inline = f.editor.props;
    f.editor.props = { ...inline, renderSideBySide: true, largeFile: false };
    f.editor.componentDidUpdate(inline);
    assert.equal(f.classes.has('is-inline-current'), false);
    assert.equal(f.originalEditor.options.at(-1).lineNumbers, 'on');
    assert.equal(f.modifiedEditor.options.at(-1).minimap.enabled, true);
});

test('standalone drawer starts with a compact gutter sized to every line-count digit boundary', () => {
    for (const [content, digits] of [
        ['', 1], ['one', 1], ['\n'.repeat(8), 1], ['\n'.repeat(9), 2],
        ['\n'.repeat(98), 2], ['\n'.repeat(99), 3], ['\n'.repeat(999_999), 7],
        ['line\r\n'.repeat(9), 2], ['line\r'.repeat(9), 2], ['line\r\nline\rline\n'.repeat(3), 2]
    ]) {
        const f = editorFixture(false);
        f.editor.props = { ...f.editor.props, content, beforeContent: undefined, initialDrafts: undefined };
        f.editor.createEditor();
        assert.equal(f.options[0].lineNumbersMinChars, digits);
        assert.equal(f.options[0].glyphMargin, false);
        assert.equal(f.options[0].folding, false);
        assert.equal(f.options[0].lineDecorationsWidth, 4);
    }
});

test('standalone content updates grow and shrink its gutter without recreating the editor', () => {
    const f = editorFixture(false);
    f.editor.props = { ...f.editor.props, content: 'one', beforeContent: undefined, initialDrafts: undefined };
    f.editor.createEditor();
    const standalone = f.editor.editor;
    for (const [content, digits] of [['\n'.repeat(99), 3], ['one\ntwo', 1]]) {
        const previous = f.editor.props;
        f.editor.props = { ...previous, content };
        f.editor.componentDidUpdate(previous);
        assert.equal(f.editor.editor, standalone);
        assert.deepEqual(f.modifiedEditor.options.at(-1), {
            lineNumbersMinChars: digits, glyphMargin: false, folding: false, lineDecorationsWidth: 4
        });
    }
    const updates = f.modifiedEditor.options.length;
    f.editor.componentDidUpdate(f.editor.props);
    assert.equal(f.modifiedEditor.options.length, updates, 'unchanged standalone content does not recompute options');
});

test('diff gutters size from both versions only in side-by-side mode and follow content changes', () => {
    const f = editorFixture(true);
    f.editor.props = { ...f.editor.props, content: 'one', beforeContent: '\n'.repeat(99), initialDrafts: undefined };
    f.editor.createEditor();
    for (const editor of [f.originalEditor, f.modifiedEditor]) {
        assert.equal(editor.options.at(-1).lineNumbersMinChars, 3);
        assert.equal(editor.options.at(-1).lineDecorationsWidth, 4);
        assert.equal(editor.options.at(-1).glyphMargin, false);
        assert.equal(editor.options.at(-1).folding, false);
    }
    for (const [changed, originalDigits, modifiedDigits, originalWidth] of [
        [{ beforeContent: 'old' }, 1, 1, 4],
        [{ content: '\n'.repeat(9) }, 2, 2, 4],
        [{ renderSideBySide: false, content: 'one', beforeContent: '\n'.repeat(99) }, 0, 1, 0],
        [{ content: '\n'.repeat(999) }, 0, 4, 0],
        [{ renderSideBySide: true }, 4, 4, 4]
    ]) {
        const previous = f.editor.props;
        f.editor.props = { ...previous, ...changed };
        f.editor.componentDidUpdate(previous);
        assert.equal(f.originalEditor.options.at(-1).lineNumbersMinChars, originalDigits);
        assert.equal(f.originalEditor.options.at(-1).lineDecorationsWidth, originalWidth);
        assert.equal(f.originalEditor.options.at(-1).folding, false);
        assert.equal(f.modifiedEditor.options.at(-1).lineNumbersMinChars, modifiedDigits);
        assert.equal(f.modifiedEditor.options.at(-1).lineDecorationsWidth, 4);
        assert.equal(f.modifiedEditor.options.at(-1).folding, false);
    }
});

test('installed Monaco layout places single-digit code after 12 px and removes the hidden original gutter', () => {
    const f = editorFixture(false);
    f.editor.props = { ...f.editor.props, content: 'one', beforeContent: '\n'.repeat(99), initialDrafts: undefined };
    f.editor.createEditor();
    const modified = monacoLayout({ ...f.options[0], ...f.modifiedEditor.options[0] }, 1);
    assert.equal(modified.glyphMarginWidth, 0);
    assert.equal(modified.lineNumbersLeft, 0);
    assert.equal(modified.lineNumbersWidth, 8);
    assert.equal(modified.decorationsWidth, 4);
    assert.equal(modified.contentLeft, 12);
    const original = monacoLayout({ ...f.options[0], ...f.originalEditor.options[0] }, 100);
    assert.equal(original.lineNumbersWidth, 0);
    assert.equal(original.decorationsWidth, 0);
    assert.equal(original.contentLeft, 0, 'lineNumbers: off eliminates width even if Monaco clamps the minimum to one');
    const previous = f.editor.props;
    f.editor.props = { ...previous, renderSideBySide: true };
    f.editor.componentDidUpdate(previous);
    for (const [editor, lines] of [[f.originalEditor, 100], [f.modifiedEditor, 1]]) {
        const side = monacoLayout({ ...f.options[0], ...editor.options.at(-1) }, lines);
        assert.equal(side.glyphMarginWidth, 0);
        assert.equal(side.lineNumbersLeft, 0);
        assert.equal(side.lineNumbersWidth, 24);
        assert.equal(side.decorationsWidth, 4);
        assert.equal(side.contentLeft, 28);
    }
});

test('fallback shows one column while keeping both drafts and dirty state', () => {
    const f = editorFixture(false); f.editor.createFallbackEditor();
    assert.equal(f.classes.has('is-diff'), false);
    assert.deepEqual(f.textareas.map(textarea => [textarea.value, textarea.hidden]), [
        ['unsaved historical draft', true], ['unsaved current draft', false]
    ]);
    f.textareas[1].value = 'current'; f.textareas[1].listeners.get('input')();
    assert.equal(f.dirty.at(-1), true);
    assert.ok(f.changes.some(([side, content]) => side === 'before' && content === 'unsaved historical draft'));
});

function* nodes(node) { yield node; for (const child of node.getChildren(ast)) yield* nodes(child); }
const render = klass('NextMuxDesktopWidget').members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'renderWorkContext');
const section = [...nodes(render)].find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
    attribute.name?.getText(ast) === 'className' && attribute.initializer?.text === 'nmx-context-file-preview'));
assert.ok(section);
const Drawer = compile(`class Drawer { renderPreview(preview) { return ${section.getText(ast)}; } }; return Drawer;`, {
    React, NextMuxFileEditor: props => React.createElement('div', { 'data-editor-side-by-side': props.renderSideBySide, 'data-checkpoint-before': props.beforeContent }),
    fileDrawerText: (_locale, key) => key, workbenchText: (_locale, key) => key,
    editorRecoveryText: (_locale, key) => key, localizeDesktopSurface: (_locale, text) => text
});
const drawer = new Drawer();
Object.assign(drawer, { desktopLocale: 'zh-CN', contextFileSaveStatus: 'idle', contextFileDrafts: {}, resolvedDesktopTheme: () => 'dark', contextFileEditorScrollPosition: () => undefined });

test('actual drawer JSX has no before-version column or legend and preserves checkpoint input', () => {
    const html = renderToStaticMarkup(drawer.renderPreview({ uri: 'file:///fixture/source.ts', name: 'source.ts', content: 'current', beforeContent: 'old' }));
    assert.match(html, /data-editor-side-by-side="false"/);
    assert.match(html, /data-checkpoint-before="old"/);
    assert.match(html, /currentVersion/);
    assert.doesNotMatch(html, /beforeVersion/);
});

test('missing working copy shows literal read-only history instead of an empty current editor', () => {
    const html = renderToStaticMarkup(drawer.renderPreview({ uri: 'file:///fixture/source.ts', name: 'source.ts', content: '', beforeContent: 'immutable <history>', historicalMissing: true }));
    assert.match(html, /<pre data-nmx-literal="true">immutable &lt;history&gt;<\/pre>/);
    assert.doesNotMatch(html, /data-editor-side-by-side/);
    assert.match(html, />history</);
});

const build = desktopRequire('esbuild').buildSync({ entryPoints: [fileURLToPath(new URL('../src/browser/nextmux-change-review.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.css': 'empty' }, logLevel: 'silent' });
const reviewModule = { exports: {} };
Function('require', 'module', 'exports', build.outputFiles[0].text)(require, reviewModule, reviewModule.exports);
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const structuralWarning = 'Folders, folder permissions or symbolic links changed; those changes cannot be restored from checkpoints';

test('change review omits warning copy inside the modified files list in all 12 locales', () => {
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(reviewModule.exports.NextMuxChangeReview, {
            locale, changes: [], warnings: [structuralWarning, 'Unknown <coverage> diagnostic'], restoring: false, blocked: false,
            isRestored: () => false, onOpen() {}, onRestore() {}, onRestoreAll() {}
        }));
        assert.equal(html, '');
    }
});

test('actual message-rollback warning JSX uses the same exact translations and literal unknown fallback', () => {
    const localeModule = { exports: {} };
    Function('exports', ts.transpile(readFileSync(new URL('../src/browser/nextmux-checkpoint-warning-locale.ts', import.meta.url), 'utf8'), {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
    }))(localeModule.exports);
    const warningJsx = [...nodes(klass('NextMuxDesktopWidget'))].find(node => ts.isJsxExpression(node)
        && node.expression?.getText(ast).startsWith('visibleCheckpointWarnings(restorePreview.warnings).map'));
    assert.ok(warningJsx);
    const renderWarning = compile(`return function(restorePreview) { return <>${warningJsx.getText(ast)}</>; };`, {
        React, checkpointWarningText: localeModule.exports.checkpointWarningText, visibleCheckpointWarnings: localeModule.exports.visibleCheckpointWarnings
    });
    for (const locale of locales) {
        const html = renderToStaticMarkup(renderWarning.call({ desktopLocale: locale }, {
            warnings: [structuralWarning, 'Unknown <coverage> diagnostic']
        }));
        assert.match(html, /Unknown &lt;coverage&gt; diagnostic/);
        assert.equal(html.match(/data-nmx-literal="true"/g)?.length, 2);
        if (locale === 'en') assert.match(html, /Folders, folder permissions/);
        else assert.doesNotMatch(html, /Folders, folder permissions/);
    }
});
