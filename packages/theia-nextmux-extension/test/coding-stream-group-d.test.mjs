import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createImageLightboxState, updateImageLightbox } from '../lib/browser/nextmux-image-lightbox.js';
import { supersededEditFailures } from '../lib/browser/nextmux-agent-activity.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { compactDirectoryPrefix, conversationMediaKind, filePathPillHtml } from '../lib/browser/nextmux-conversation-media.js';
import { resolveConversationFileTarget } from '../lib/browser/nextmux-conversation-file-target.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = name => ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
const member = (owner, name) => { const result = klass(owner).members.find(node => node.name?.getText(ast) === name); assert.ok(result, name); return result; };
function harness(names, dependencies = {}, owner = 'NextMuxDesktopWidget') {
    const code = ts.transpile(`class ${owner} { ${names.map(name => member(owner, name).getText(ast)).join('\n')} }; return ${owner};`,
        { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
    const Type = Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
    return new Type();
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

test('wheel zoom preserves the cursor point above, at and below 100%; drag and reset are atomic', () => {
    let state = updateImageLightbox(createImageLightboxState(), { type: 'open', image: { src: 'image' } }).state;
    for (const deltaY of [-1, -1, 1, 1, 1, 1, -1]) {
        const x = 240, y = 130, point = [(x - state.panX) / (state.zoomPercent / 100), (y - state.panY) / (state.zoomPercent / 100)];
        state = updateImageLightbox(state, { type: 'wheel', deltaY, pointerX: x, pointerY: y }).state;
        assert.ok(Math.abs(point[0] * state.zoomPercent / 100 + state.panX - x) < 1e-8);
        assert.ok(Math.abs(point[1] * state.zoomPercent / 100 + state.panY - y) < 1e-8);
    }
    while (state.zoomPercent <= 100) state = updateImageLightbox(state, { type: 'zoom-in' }).state;
    const prior = state;
    state = updateImageLightbox(state, { type: 'pan', deltaX: 20, deltaY: -11 }).state;
    assert.equal(state.panX, prior.panX + 20); assert.equal(state.panY, prior.panY - 11);
    assert.equal(updateImageLightbox(state, { type: 'pan', deltaX: NaN, deltaY: 1 }).handled, false);
    state = updateImageLightbox(state, { type: 'reset' }).state;
    assert.deepEqual([state.zoomPercent, state.panX, state.panY], [100, 0, 0]);
    assert.equal(updateImageLightbox(state, { type: 'close', source: 'escape' }).state.isOpen, false);
});

const edit = (id, path, ok, extra = {}) => ({ type: 'tool_completed', callId: id, toolName: 'workspace.write_file', ok,
    status: ok ? 'succeeded' : 'failed', durationMs: 1, at: '2026-10-21T00:00:00Z',
    summary: { title: path, kind: 'workspace.write_file', resource: { kind: 'file', action: 'modified', path }, ...extra },
    ...(!ok ? { failure: { code: 'PATCH_FAILED', message: 'rejected patch' } } : {}) });
test('only a later successful edit of the same file suppresses retry rows', () => {
    const events = [edit('fixed', 'src/a.ts', false), edit('unfixed', 'src/b.ts', false), edit('success', 'src/a.ts', true), edit('last-failure', 'src/a.ts', false)];
    assert.deepEqual([...supersededEditFailures(events)], ['fixed']);
    const projection = projectConversationStream({ locale: 'en', events, running: false });
    const failures = projection.items.filter(item => item.kind === 'row' && item.tone === 'failed');
    assert.equal(failures.length, 2, 'final failures remain visible even with PATCH_FAILED');
    assert.equal(supersededEditFailures([edit('a', 'src/a.ts', false), edit('b', 'src/a.ts', true, { params: { workspaceRoot: '/other' } })]).size, 0);
    assert.equal(supersededEditFailures([edit('a', 'src/a.ts', false), { type: 'backend_selected' }, edit('b', 'src/a.ts', true)]).size, 0);
});

test('path markup keeps the full path in title and data-path, a compact directory, basename-only files and escaped literal names', () => {
    const html = filePathPillHtml('src/a.ts', '/work/src/a.ts');
    assert.match(html, /class="nmx-file-path-pill" role="link" tabindex="0" title="\/work\/src\/a.ts" data-path="\/work\/src\/a.ts"/);
    assert.match(html, /nmx-file-path-dir"><span>…\/src\/<\/span><\/span><span class="nmx-file-path-name"><span>a.ts/);
    assert.match(filePathPillHtml('src/a.ts'), /nmx-file-path-dir"><span>src\/<\/span>/, 'a short single folder stays whole');
    assert.doesNotMatch(filePathPillHtml('README.md'), /nmx-file-path-dir/);
    assert.match(filePathPillHtml('C:\\work\\a.ts'), /<span>…\\work\\<\/span>/);
    const runtime = filePathPillHtml('C:/Users/49674/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
    assert.match(runtime, /title="C:\/Users\/49674\/\.cache\/codex-runtimes\/codex-primary-runtime\/dependencies\/node\/bin\/node\.exe"/);
    assert.match(runtime, /<span class="nmx-file-path-dir"><span>…\/bin\/<\/span><\/span><span class="nmx-file-path-name"><span>node\.exe<\/span>/);
    assert.doesNotMatch(filePathPillHtml('/tmp/<img onerror="bad">.txt'), /<img/);
    assert.equal(resolveConversationFileTarget('src/a.ts', '/own/root').path, '/own/root/src/a.ts');
    assert.equal(resolveConversationFileTarget('/another/a.ts', '/own/root').path, '/another/a.ts');
});

test('a pill directory keeps at most its last folder behind an ellipsis, in the path\'s own separator', () => {
    for (const [directory, compact] of [
        ['src/', 'src/'], ['/tmp/', '/tmp/'], ['C:/', 'C:/'], ['./', './'], ['', ''],
        ['/work/src/', '…/src/'], ['../src/', '…/src/'], ['~/Desktop/', '…/Desktop/'],
        ['C:/Users/49674/.cache/codex-runtimes/node/bin/', '…/bin/'], ['C:\\work\\', '…\\work\\'],
        ['\\\\server\\share\\reports\\', '…\\reports\\'],
        ['a-single-folder-name/', '…/'], ['/repo/fourteen-chars/', '…/fourteen-chars/'], ['/repo/fifteen-chars-1/', '…/'],
        ['fifteen-chars-1/', 'fifteen-chars-1/']
    ]) assert.equal(compactDirectoryPrefix(directory), compact, JSON.stringify(directory));
});

test('compaction completed rows contain only the localized title in all supported locales', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const row = projectConversationStream({ locale, running: false, events: [{ type: 'context_compaction_completed', turn: 1, segment: 1, beforeMessages: 100, afterMessages: 3 }] }).items[0];
        assert.ok(row.title); assert.equal(row.meta, undefined); assert.equal(row.details, undefined);
        assert.doesNotMatch(row.title, /100|3|→/);
        if (locale === 'zh-CN') assert.equal(row.title, '上下文已自动压缩');
    }
});

test('resize restores the first visible turn at the same fraction of its new height', () => {
    const turn = { dataset: { turnId: 'turn' }, getBoundingClientRect: () => ({ top: -76, height: 2000 }) };
    const stage = { clientWidth: 500, scrollTop: 100, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [turn] };
    const host = harness(['restoreThreadReadingAnchor']);
    Object.assign(host, { activeCodingSessionId: 'owner', threadAwayFromBottom: true,
        threadReadingAnchor: { sessionId: 'owner', turnId: 'turn', offsetPx: 140, turnRatio: 0.14, stageWidth: 800 } });
    host.restoreThreadReadingAnchor(stage);
    // 0.14 of the 2000px turn below the stage inset: 100 + (280 - 100).
    assert.equal(stage.scrollTop, 280); assert.equal(host.threadReadingAnchor.stageWidth, 500);
});

test('tab wheel uses a removable non-passive listener and handles pixels, lines, pages and zoom modifiers', () => {
    const host = harness(['fileEditorTabsWheel', 'bindFileEditorTabsWheel']);
    const events = [], nav = { scrollWidth: 1000, clientWidth: 200, scrollLeft: 0,
        addEventListener: (...args) => events.push(['add', ...args]), removeEventListener: (...args) => events.push(['remove', ...args]) };
    host.bindFileEditorTabsWheel(nav);
    assert.equal(events[0][3].passive, false);
    let prevented = 0;
    const wheel = { deltaX: 0, deltaY: 3, deltaMode: 0, preventDefault() { prevented++; }, stopPropagation() {} };
    host.fileEditorTabsWheel(wheel); host.fileEditorTabsWheel({ ...wheel, deltaMode: 1 }); host.fileEditorTabsWheel({ ...wheel, deltaMode: 2 });
    assert.equal(nav.scrollLeft, 663); assert.equal(prevented, 3);
    host.fileEditorTabsWheel({ ...wheel, ctrlKey: true }); assert.equal(nav.scrollLeft, 663);
    host.bindFileEditorTabsWheel(null); assert.equal(events.at(-1)[2], events[0][2]);
});

test('file history selection requires confirmation and a restored checkpoint offers undo', async () => {
    const writes = [], focus = { isConnected: true, focus() {} };
    const host = harness(['requestContextFileHistory', 'confirmPendingRestore', 'dismissRestoreConfirmation'], { document: { activeElement: focus }, HTMLElement: Object });
    Object.assign(host, { activeCodingSessionId: 'owner', activeWorkspaceRoot: '/own', contextFilePreview: { uri: 'file:///own/a.ts', path: '/own/a.ts' },
        isCheckpointRestored: () => false, update() {}, selectContextFileHistory: async entry => writes.push(entry), requestRestoreCheckpoint: id => writes.push(['undo', id]) });
    const entry = { uri: 'file:///own/a.ts', checkpointId: 'checkpoint', side: 'before' };
    host.requestContextFileHistory(entry); assert.deepEqual(writes, []);
    await host.confirmPendingRestore(); assert.deepEqual(writes, [entry]);
    host.isCheckpointRestored = () => true; host.requestContextFileHistory(entry); assert.deepEqual(writes.at(-1), ['undo', 'checkpoint']);
    host.isCheckpointRestored = () => false; host.requestContextFileHistory(entry); host.activeCodingSessionId = 'different';
    await host.confirmPendingRestore(); assert.equal(writes.length, 2);
});

test('history restoration retains old content until the replacement is ready and synchronizes checkpoint state', async () => {
    const read = deferred(), reachedRead = deferred(), marks = [];
    const URI = class { constructor(value) { this.value = value; } };
    const host = harness(['selectContextFileHistory'], { URI, FILE_DRAWER_TEXT_MAX_BYTES: 64 * 1024 * 1024, fileDrawerText: (_locale, key) => key, editorRecoveryText: (_locale, key) => key });
    const preview = { uri: 'file:///own/a.ts', path: '/own/a.ts', name: 'a.ts', content: 'old', baselineSha256: 'old-sha' };
    const owner = { id: 'owner', turns: [{ id: 'turn' }] }; let reads = 0;
    Object.assign(host, { activeCodingSessionId: 'owner', codingSessions: [owner], contextFilePreview: preview, contextFileDrafts: { current: 'old' },
        contextFileSavingUris: new Set(), contextFileHistorySelectionToken: 0, activeCodingSession: () => owner, update() {},
        contextFileVersionTarget: () => ({ workspaceRoot: '/own', conversationId: 'owner', path: 'a.ts' }),
        platformService: { getAgentFileState: async () => ++reads === 1 ? { sha256: 'old-sha', exists: true } : { sha256: 'new-sha', exists: true, size: 3 },
            restoreAgentFileVersion: async () => ({ checkpointId: 'restore' }) },
        fileService: { read: () => { reachedRead.resolve(); return read.promise; } },
        markCheckpointRestored: (...args) => marks.push(args), unmarkCheckpointRestored() {}, recordContextFileVersion: async () => {}, rememberContextFileTab() {} });
    const pending = host.selectContextFileHistory({ uri: preview.uri, checkpointId: 'original', workspaceRoot: '/own', side: 'before' });
    await reachedRead.promise;
    assert.equal(host.contextFilePreview, preview); assert.equal(host.contextFilePreview.content, 'old');
    read.resolve({ value: 'new', mtime: 1, etag: 'new' }); await pending;
    assert.equal(host.contextFilePreview.content, 'new'); assert.deepEqual(marks, [['original', owner]]);
    assert.equal(host.contextFileHistorySelecting, false);
});

test('the requested editor palette and metrics are registered without changing backgrounds', () => {
    const themes = new Map();
    const host = harness(['themesRegistered', 'registerThemes', 'editorOptions', 'lineNumbersMinChars'],
        { monaco: { editor: { defineTheme: (name, value) => themes.set(name, value) } } }, 'NextMuxFileEditor');
    host.props = { content: 'line\n'.repeat(120), theme: 'dark' }; host.registerThemes();
    for (const [name, foreground, keyword, operator] of [['dark', '#FCFCFC', 'F67576', '999999'], ['light', '#0D0D0D', 'D53538', '666666']]) {
        const theme = themes.get(`nextmux-codex-${name}`);
        assert.equal(theme.colors['editor.foreground'], foreground);
        assert.equal(theme.rules.find(rule => rule.token === 'keyword').foreground, keyword);
        assert.equal(theme.rules.find(rule => rule.token === 'keyword.operator').foreground, operator);
        assert.equal(theme.colors['editor.background'], name === 'dark' ? '#181818' : '#f9f9f9');
    }
    const options = host.editorOptions(); assert.equal(options.fontSize, 13); assert.equal(options.lineHeight, 20);
    assert.equal(options.lineNumbersMinChars, 3); assert.equal(options.minimap.enabled, true);
    host.props.largeFile = true; assert.equal(host.editorOptions().minimap.enabled, false);
});

test('Monaco diff option resets immediately re-enable only the modified minimap', () => {
    const firstStatement = member('NextMuxFileEditor', 'bindModel').body.statements[0].getText(ast);
    let listener, enabled = false;
    const host = { props: {}, disposables: [] };
    const editor = { onDidChangeConfiguration(fn) { listener = fn; return {}; }, getOption: () => ({ enabled }), updateOptions: options => { enabled = options.minimap.enabled; } };
    const bind = Function('monaco', 'side', 'editor', ts.transpile(firstStatement, { target: ts.ScriptTarget.ES2022 }));
    bind.call(host, { editor: { EditorOption: { minimap: 1 } } }, 'current', editor);
    listener({ hasChanged: () => true }); assert.equal(enabled, true);
    host.props.largeFile = true; listener({ hasChanged: () => true }); assert.equal(enabled, false);
});

test('file links expose loading immediately, resolve against one root and report missing files to their owner', async () => {
    class URI { constructor(value) { this.value = value; } }
    const conversationFileUri = path => ({ path: { base: path.split('/').at(-1) } });
    const host = harness(['openConversationFileLink'], { URI, conversationFileUri, conversationMediaKind,
        toFileOperationResult: error => error.code, FileOperationResult: { FILE_NOT_FOUND: 'ENOENT' },
        filePreviewErrorText: (_locale, kind) => kind === 'missing' ? '该文件不存在' : 'unavailable', setTimeout });
    const stat = deferred(), visited = [], notices = [];
    Object.assign(host, { activeCodingSessionId: 'owner', activeWorkspaceRoot: '/own', contextFilePreviewRequestToken: 0,
        activeCodingSession: () => ({ id: 'owner' }), codingSessionWorkspaceRoot: () => '/own',
        resolveConversationTarget: path => resolveConversationFileTarget(path, '/own'),
        beginContextFileOpen(node) { this.loading = node.path; return true; }, finishContextFileOpen() { this.loading = undefined; },
        fileService: { resolve: uri => { visited.push(uri.value); return stat.promise; } },
        fileActivityRootContains: (root, uri) => uri.value.startsWith(`file://${root}/`),
        platformService: { resolveWorkspaceFile: async (_root, path) => ({ inside: true, path }) },
        previewContextFile: async node => { host.contextFilePreview = { ...node, content: 'ready' }; },
        rememberContextFileTab() {}, update() {}, addNotification: (...args) => notices.push(args) });
    const pending = host.openConversationFileLink('src/a.ts#L4');
    assert.equal(host.loading, '/own/src/a.ts');
    await new Promise(resolve => setTimeout(resolve, 5)); stat.resolve({ isDirectory: false }); await pending;
    assert.deepEqual(visited, ['file:///own/src/a.ts']); assert.equal(host.contextFilePreview.revealRange.startLine, 4);
    host.fileService.resolve = async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    await host.openConversationFileLink('missing.ts');
    assert.deepEqual(notices, [['error', '该文件不存在', '', 'owner']]);
    assert.equal(host.loading, undefined);
});

test('both prompt and assistant search mark the current occurrence with the shared classes', () => {
    const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
    const host = harness(['renderThreadText'], { React });
    Object.assign(host, { threadFindOpen: true, threadFindQuery: 'needle', threadFindIndex: 0 });
    for (const field of ['prompt', 'response']) {
        host.threadSearchMatches = () => [{ turnId: 'turn', field, offset: 7 }];
        const result = host.renderThreadText('prefix needle and needle', 'turn', field);
        const marks = result.props.children.flat().filter(node => node.type === 'mark');
        assert.equal(marks.length, 2); assert.equal(marks[0].props.className, 'nmx-search-hit is-active is-current');
        assert.equal(marks[1].props.className, 'nmx-search-hit');
    }
});

test('the production wheel adapter anchors both centered drawer images and origin-zero fullscreen images', () => {
    for (const origin of [[0, 0], [300, 200]]) {
        let state = updateImageLightbox(createImageLightboxState(), { type: 'open', image: { src: 'image' } }).state;
        const host = harness(['updateImagePreviewWheel'], { updateImageLightbox, getComputedStyle: () => ({ transformOrigin: `${origin[0]}px ${origin[1]}px` }) });
        const image = { getBoundingClientRect: () => ({ left: 100 + origin[0] * (1 - state.zoomPercent / 100) + state.panX,
            top: 50 + origin[1] * (1 - state.zoomPercent / 100) + state.panY, width: 600 * state.zoomPercent / 100, height: 400 * state.zoomPercent / 100 }) };
        host.applyImagePreviewTransform = () => {};
        for (const deltaY of [-1, -1, 1, 1, 1]) {
            const rect = image.getBoundingClientRect(), x = 220, y = 140;
            const point = [(x - rect.left) / (state.zoomPercent / 100), (y - rect.top) / (state.zoomPercent / 100)];
            state = host.updateImagePreviewWheel(state, { deltaY, clientX: x, clientY: y, currentTarget: { querySelector: () => image },
                preventDefault() {}, stopPropagation() {} }).state;
            const next = image.getBoundingClientRect();
            assert.ok(Math.abs(next.left + point[0] * state.zoomPercent / 100 - x) < 1e-8);
            assert.ok(Math.abs(next.top + point[1] * state.zoomPercent / 100 - y) < 1e-8);
        }
    }
});

test('moving Find to another turn clears the previous current mark across the conversation', () => {
    const removed = [], added = [];
    const previous = { classList: { remove: (...classes) => removed.push(classes) } };
    const mark = { classList: { add: (...classes) => added.push(classes) } };
    const block = { textContent: 'needle', querySelector: () => mark };
    const turnElement = { closest: () => ({ querySelectorAll: () => [previous] }), querySelector: () => null,
        querySelectorAll: () => [block] };
    const host = harness(['threadSearchTargetElement']);
    host.activeCodingSession = () => ({ turns: [{ id: 'next', prompt: '', response: 'needle' }] });
    assert.equal(host.threadSearchTargetElement(turnElement, { turnId: 'next', field: 'response', offset: 0 }), mark);
    assert.deepEqual(removed, [['is-active', 'is-current']]); assert.deepEqual(added, [['is-active', 'is-current']]);
});
