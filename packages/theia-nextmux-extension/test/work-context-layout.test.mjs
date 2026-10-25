import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { methods } from './helpers/work-context-layout-source.mjs';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const Widget = Function('React', 'NextMuxFileTabButton', 'NextMuxFileEditor', 'workbenchText', 'agentChildText', 'editorRecoveryText', 'fileDrawerText', 'isGoalFilePath', 'goalScheduleText',
    ts.transpile(`class NextMuxDesktopWidget { ${Object.values(methods).join('\n')} }; return NextMuxDesktopWidget;`,
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }))(
    React, function FileTab() {}, function Editor() {}, (_locale, key) => key, (_locale, key) => key, (_locale, key) => key, (_locale, key) => key,
    () => false, (_locale, key) => key);
const walk = value => !value || typeof value !== 'object' ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(walk)];
function widget() {
    return Object.assign(new Widget(), { workContextOpen: true, activeSection: 'coding', workContextMode: 'file',
        contextFilePreview: { uri: 'file:///synthetic/file.txt', path: '/synthetic/file.txt', name: 'file.txt', content: 'original' },
        contextFileDrafts: { current: 'unsaved' }, contextFileDirty: true, contextFilePreviewRequestToken: 1,
        activeCodingSessionId: 'test-session', desktopLocale: 'en', contextFileSaveStatus: 'idle',
        activeCodingSession: () => undefined, activeWorkspace: () => undefined, currentCodingBrowsers: () => [],
        currentAgentChildren: () => [], workContextInlineMaximumWidth: () => 1000, workContextMaximumWidth: () => 1000, contextFileListMaximumWidth: () => 400,
        renderContextDrawerFileList: () => React.createElement('aside', { className: 'nmx-context-file-list' }),
        contextFileEditorScrollPosition: () => undefined, resolvedDesktopTheme: () => 'dark' });
}
test('responsive presentation changes only a layout class and leaves the same keyed editor at every pane width', () => {
    const instance = widget();
    const renders = [297, 497, 900].map(width => { instance.workContextWidth = width; return walk(instance.renderWorkContext()); });
    const editors = renders.map(nodes => nodes.find(node => node.type?.name === 'Editor'));
    assert.equal(editors.length, 3); assert.ok(editors.every(node => node && node.key === editors[0].key && node.type === editors[0].type));
    for (const nodes of renders) {
        assert.match(nodes.find(node => node.props.id === 'nmx-context-panel-files').props.className, /has-file-preview/);
        assert.ok(nodes.find(node => node.props.className === 'nmx-context-file-list'));
        assert.ok(nodes.find(node => node.props.className === 'nmx-context-file-list-resize'));
    }
    assert.deepEqual(instance.contextFileDrafts, { current: 'unsaved' }); assert.equal(instance.contextFileDirty, true);
});
test('without a preview the actual renderer marks tree-only mode, and Back uses the existing close guard', () => {
    const instance = widget(); let closes = 0;
    instance.closeContextFilePreview = () => { closes++; };
    const nodes = walk(instance.renderWorkContext());
    nodes.find(node => node.type === 'button' && node.props['aria-label'] === 'back').props.onClick();
    assert.equal(closes, 1);
    instance.contextFilePreview = undefined;
    const noPreview = walk(instance.renderWorkContext());
    assert.match(noPreview.find(node => node.props.id === 'nmx-context-panel-files').props.className, /is-file-list-only/);
    assert.ok(noPreview.find(node => node.props.className === 'nmx-context-file-list'), 'the project file list remains visible before a file is selected');
    assert.ok(noPreview.find(node => node.props.className === 'nmx-context-file-preview'), 'the editor side keeps its empty state');
});
test('CSS uses actual pane width and keeps the file navigator visible before a file is selected', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-work-context\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*nmx-work-context;/);
    assert.match(css, /@container nmx-work-context \(max-width: 420px\)/);
    assert.match(css, /\.nmx-context-file-layout\.has-file-preview\s*\{\s*grid-template-columns:\s*minmax\(156px, 42%\) 6px minmax\(0, 1fr\)/);
    assert.doesNotMatch(css, /\.has-file-preview > \.nmx-context-file-list,\s*\.nmx-context-file-layout\.has-file-preview > \.nmx-context-file-list-resize\s*\{\s*display: none/);
    assert.match(css, /\.nmx-context-file-layout\.is-file-list-only\s*\{\s*grid-template-columns: var\(--nmx-context-file-list-width, 218px\) 6px minmax\(0, 1fr\)/);
    assert.doesNotMatch(css, /\.nmx-context-file-layout\.is-file-list-only > \.nmx-context-file-preview\s*\{\s*display: none/);
    assert.match(css, /\.nmx-work-context\.is-editor-maximized > \.nmx-work-context-resize\s*\{\s*display: block/);
    assert.match(css, /\.nmx-thread-files header > i\s*\{[^}]*align-items:\s*center;[^}]*line-height:\s*20px/);
    assert.match(css, /\.nmx-thread-files:hover header strong,[\s\S]*?line-height:\s*20px/);
    assert.doesNotMatch(methods.renderWorkContext, /innerWidth|matchMedia|ResizeObserver/);
});

test('file menu closes on drawer blank clicks and remains bounded when resizing an expanded editor', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /className='nmx-context-file-menu-trigger'/);
    assert.match(source, /contextFileMenuOpen && !target\?\.closest\('\.nmx-context-file-menu, \.nmx-context-file-menu-trigger'\)/);
    assert.match(source, /const startWidth = this\.effectiveWorkContextWidth\(\)/);
    assert.match(source, /NextMuxDesktopWidget\.WORK_CONTEXT_MIN_WIDTH, this\.workContextMaximumWidth\(\)/);
});
