import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['beginContextFileOpen', 'finishContextFileOpen', 'closeContextFilePreview', 'previewContextFile', 'openContextFile', 'openConversationFileLink', 'handleAssistantContentClick',
    'openCheckpointDiffById', 'openCheckpointDiff', 'openToolFileActivity', 'fileActivityRootContains', 'resolveConversationTarget', 'conversationFileEvidence', 'conversationLinkAgentChild',
    'loadContextDirectory', 'contextFileVisible', 'rememberContextFileTab'];
const bodies = methods.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const { outputFiles } = await desktop('esbuild').build({
    stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../src/browser/', import.meta.url)), contents: `
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FileOperationError, FileOperationResult, FileSystemProviderCapabilities, toFileOperationResult } from '@theia/filesystem/src/common/files';
import { conversationFileUri, conversationTurnFileEvidence, resolveConversationFileTarget } from './nextmux-conversation-file-target';
import { conversationMediaKind, isLocalConversationTarget } from './nextmux-conversation-media';
import { projectConversationStream } from './nextmux-conversation-stream-model';
import { NextMuxChangeReview } from './nextmux-change-review';
import { FILE_DRAWER_TEXT_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES, filePreviewErrorText, filePreviewRequestIsCurrent } from './nextmux-file-preview';
import { linkOpeningText } from './nextmux-link-opening-locale';
const NextMuxDesktopWidget = { FILE_LIST_MIN_WIDTH: 100, LARGE_TEXT_FILE_CHARACTERS: 1000000 };
const conversationText = (_locale, key) => key;
const localizeDesktopSurface = (_locale, text) => text;
export class Fixture { ${bodies.join('\n')} }
export { URI, FileUri, FileOperationError, FileOperationResult, projectConversationStream, NextMuxChangeReview };
` }, bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' }
});
const bundled = { exports: {} };
Function('require', 'module', 'exports', outputFiles[0].text + '\n//# sourceURL=batch2-widget-fixture.cjs')(createRequire(import.meta.url), bundled, bundled.exports);
const { Fixture, URI, FileUri, FileOperationError, FileOperationResult, projectConversationStream, NextMuxChangeReview } = bundled.exports;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const waitFor = async predicate => { for (let count = 0; count < 100 && !predicate(); count++) await new Promise(resolve => setTimeout(resolve, 2)); assert.ok(predicate(), 'async stage reached'); };
const missing = () => new FileOperationError('File not found', FileOperationResult.FILE_NOT_FOUND);
const node = path => ({ uri: URI.fromFilePath(path).toString(), path, name: path.split('/').at(-1), directory: false });

function fixture(root = '/project') {
    const f = new Fixture(), files = new Map(), directories = new Map(root ? [[root, []]] : []), reads = [], resolutions = [], lightboxes = [], reveals = [], warnings = [], updates = [];
    const recovery = { refresh: async () => {}, find: () => undefined, state: { entries: [] } };
    Object.assign(f, {
        root, session: { id: 'session', turns: [] }, activeCodingSessionId: 'session', activeWorkspaceRoot: root,
        activeSection: 'coding', codingPanel: 'thread', desktopLocale: 'zh-CN', codingViewRestoreToken: 0,
        contextFilePreviewRequestToken: 0, contextFileTabs: new Map(), contextFileSavingUris: new Set(), contextFileChildren: new Map(),
        contextFileDrafts: {}, contextFileListWidth: 180, contextFilePreviewLoading: false, workContextOpen: false, workContextMode: 'browser',
        activeCodingSession() { return this.session; }, codingSessionWorkspaceRoot() { return this.root; },
        codingSessionStoredWorkspaceRoots() { return this.root ? [this.root] : []; },
        update() { updates.push({ loading: this.contextFilePreviewLoading, opening: this.contextFileOpening?.path }); },
        rememberNavigation() {}, detachContextEditorRecovery: () => true,
        rememberContextFileTab() { if (this.contextFilePreview && !this.contextFilePreviewLoading) this.contextFileTabs.set(this.contextFilePreview.uri, { preview: this.contextFilePreview }); },
        activateContextFileTab: () => false, editorRecoveryController: () => recovery,
        contextFileVersionTarget: () => undefined, attachmentExtension: name => name.split('.').at(-1),
        clampPaneSize: value => value, contextFileListMaximumWidth: () => 300, constrainPaneSizes() {},
        persistActiveCodingSessionState() {}, revealContextFileInTree: async value => { reveals.push(value); },
        syncActiveBrowser() {}, loadSiteState: async () => {}, currentAgentChildren: () => [],
        loadContextFiles: async () => {}, loadContextFileHistory: async () => {},
        openAttachmentLightbox: (...args) => lightboxes.push(args), addNotification: (...args) => warnings.push(args),
        platformService: { resolveWorkspaceFile: async (_root, path) => ({ inside: true, path }), getAgentCheckpointDiff: async () => { throw new Error('unknown checkpoint'); }, getAgentFileState: async () => ({ exists: false }) },
        fileService: {
            async resolve(uri) { const path = FileUri.fsPath(uri); resolutions.push(path);
                if (directories.has(path)) return { resource: uri, isDirectory: true, children: directories.get(path).map(entry => ({ resource: new URI(entry.uri), name: entry.name, isDirectory: entry.directory })) };
                if (!files.has(path)) throw missing(); return { resource: uri, isDirectory: false, isReadonly: false }; },
            async read(uri) { const path = FileUri.fsPath(uri); reads.push(path); if (!files.has(path)) throw missing(); return { value: files.get(path), mtime: 1, etag: 'etag' }; },
            hasCapability: () => false
        }
    });
    f.__fixture = { warnings, resolutions };
    return { f, files, directories, reads, resolutions, lightboxes, reveals, warnings, updates, recovery };
}

function assertOpening(f, path) {
    assert.equal(f.workContextOpen, true);
    assert.equal(f.workContextMode, 'file');
    assert.equal(f.contextFilePreviewLoading, true);
    assert.equal(f.contextFileOpening?.path, path, 'the pending file supplies the immediate tab header');
}

test('main and nested subagent clicks use the resolved native path and preserve line ranges', async t => {
    class LinkElement {
        constructor(href, path, child = false) { this.href = href; this.dataset = path ? { nmxPath: path } : {}; this.child = child; }
        getAttribute(name) { return name === 'data-href' ? this.href : null; }
        closest(selector) {
            if (selector.startsWith('a[href], a[data-href]')) return this; // the handler also accepts file path pills
            if (selector === '.nmx-task-turn[data-turn-id]') return { dataset: { turnId: 'turn' } };
            if (selector === '.nmx-agent-child-detail[data-agent-child-detail]' && this.child) return { dataset: { agentChildDetail: 'child' } };
            return null;
        }
    }
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'Element');
    Object.defineProperty(globalThis, 'Element', { configurable: true, value: LinkElement });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'Element', previous); else delete globalThis.Element; });
    for (const child of [false, true]) {
        const { f, files, reads } = fixture('c:/Users/49674/Desktop/ai漫剧');
        const path = 'c:/Users/49674/Desktop/ai漫剧/tests/admin-unified-layout.test.mjs'; files.set(path, 'verified target');
        const link = new LinkElement('tests/admin-unified-layout.test.mjs#L3-L7', path.replaceAll('/', '\\'), child);
        let pending, clickedTurn, prevented = false, stopped = false;
        const open = f.openConversationFileLink.bind(f);
        f.openConversationFileLink = (target, turnId) => { clickedTurn = turnId; return pending = open(target, turnId); };
        f.handleAssistantContentClick({ button: 0, target: link, currentTarget: { contains: () => true },
            preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
        await pending;
        assert.equal(clickedTurn, child ? 'child' : 'turn'); assert.ok(prevented && stopped);
        assert.deepEqual(reads, [path]); assert.deepEqual(f.contextFilePreview.revealRange, { startLine: 3, endLine: 7 });
    }
    const { f, files, reads } = fixture();
    const native = '/project/literal%20#draft?.ts'; files.set(native, 'native');
    const opened = [], web = []; f.requestConversationLinkOpen = target => web.push(target);
    const open = f.openConversationFileLink.bind(f);
    f.openConversationFileLink = (target, turnId, sourceTarget) => { const pending = open(target, turnId, sourceTarget); opened.push(pending); return pending; };
    const click = link => f.handleAssistantContentClick({ button: 0, target: link, currentTarget: { contains: () => true }, preventDefault() {}, stopPropagation() {} });
    click(new LinkElement('literal.ts#L2', native)); await opened.at(-1);
    assert.deepEqual(reads, [native]); assert.deepEqual(f.contextFilePreview.revealRange, { startLine: 2, endLine: 2 });
    click(new LinkElement('https://example.com/path', native)); assert.deepEqual(web, ['https://example.com/path']);
    files.set('/project/ordinary.ts', 'ordinary'); click(new LinkElement('ordinary.ts')); await opened.at(-1);
    assert.equal(f.contextFilePreview.path, '/project/ordinary.ts');
    files.set('/project/output/discovered.ts', 'discovered');
    f.contextFileChildren.set('/project/output', [node('/project/output/discovered.ts')]);
    const { warnings } = f.__fixture;
    click(new LinkElement('discovered.ts', '/project/discovered.ts')); await opened.at(-1);
    assert.equal(f.contextFilePreview.path, '/project/ordinary.ts', 'a decorated root guess is opened as-is; a cached same-named file is never substituted');
    assert.equal(reads.includes('/project/output/discovered.ts'), false);
    assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session']);
    files.set('/project/discovered.ts', 'unrelated');
    click(new LinkElement('discovered.ts', '/missing/discovered.ts')); await opened.at(-1);
    assert.equal(reads.includes('/project/discovered.ts'), false, 'an exact resolved external path never falls back to another directory');
    assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session']);
});

test('main and subagent file evidence prefer their own workspace file among duplicate names', async () => {
    const event = path => ({ type: 'tool_completed', ok: true, toolName: 'workspace.read_file', summary: { resource: { kind: 'file', action: 'read', path } } });
    for (const child of [false, true]) {
        const { f, files, reads } = fixture(); files.set('/project/a.ts', 'workspace'); files.set('/outside/a.ts', 'outside');
        const events = [event('/project/a.ts'), event('/outside/a.ts')];
        f.session.turns = [{ id: 'turn', events: child ? [event('/outside/a.ts')] : events,
            childAgents: child ? [{ childRunId: 'child', events }] : [] }];
        await f.openConversationFileLink('a.ts', child ? 'child' : 'turn');
        assert.deepEqual(reads, ['/project/a.ts']); assert.equal(f.contextFilePreview.content, 'workspace');
    }
});

test('stored subagent evidence uses its own workspace when the live child list is empty', async () => {
    const { f, files, reads } = fixture();
    const childPath = '/child/tests/result.ts'; files.set(childPath, 'child'); files.set('/project/tests/result.ts', 'parent');
    const event = path => ({ type: 'tool_completed', ok: true, toolName: 'workspace.read_file', summary: { resource: { kind: 'file', action: 'read', path } } });
    f.currentAgentChildren = () => [];
    f.session.turns = [{ id: 'turn', childAgents: [{ childRunId: 'child', taskContext: { workspaceRoot: '/child' },
        events: [event(childPath), event('/project/tests/result.ts')] }] }];
    await f.openConversationFileLink('tests/result.ts', 'child');
    assert.deepEqual(reads, [childPath]); assert.equal(f.contextFilePreview.content, 'child');
});

test('file drawer and tab render synchronously before resolve, recovery, disk read or checkpoint IPC', async () => {
    for (const entry of ['openContextFile', 'previewContextFile', 'openConversationFileLink', 'openCheckpointDiff']) {
        const { f, files, resolutions, reads, recovery } = fixture();
        const path = '/project/AdminConsole.tsx', gate = deferred(); files.set(path, 'x'.repeat(1500000));
        let refreshes = 0, checkpoints = 0;
        recovery.refresh = async () => { refreshes++; await gate.promise; };
        f.platformService.getAgentCheckpointDiff = async () => { checkpoints++; await gate.promise; return { path, checkpointId: 'cp', beforeContent: 'old' }; };
        const pending = entry === 'openContextFile' ? f.openContextFile(node(path).uri)
            : entry === 'previewContextFile' ? f.previewContextFile(node(path))
                : entry === 'openConversationFileLink' ? f.openConversationFileLink(path)
                    : f.openCheckpointDiff({ path, checkpointId: 'cp' });
        assertOpening(f, path);
        assert.deepEqual([resolutions.length, reads.length, refreshes, checkpoints], [0, 0, 0, 0], entry);
        gate.resolve(); await pending;
        assert.equal(f.contextFilePreviewLoading, false, entry);
        assert.equal(f.contextFilePreview.content.length, 1500000, entry);
        assert.equal(f.contextFilePreview.largeFile, true, entry);
    }
});

test('nested file-opening paths preserve and restore the original drawer visibility and tab', async () => {
    for (const [wasOpen, mode] of [[false, 'browser'], [true, 'browser'], [true, 'agent'], [true, 'file']]) {
        for (const entry of ['previewContextFile', 'openContextFile', 'openConversationFileLink', 'openToolFileActivity', 'openCheckpointDiff']) {
            const { f, files } = fixture(), path = '/project/preview.ts'; files.set(path, 'original return surface');
            f.workContextOpen = wasOpen; f.workContextMode = mode;
            if (entry === 'previewContextFile') await f.previewContextFile(node(path));
            else if (entry === 'openContextFile') await f.openContextFile(node(path).uri);
            else if (entry === 'openConversationFileLink') await f.openConversationFileLink(path);
            else if (entry === 'openToolFileActivity') await f.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
            else await f.openCheckpointDiff({ path, checkpointId: 'cp' });
            const label = `${entry}: ${wasOpen}/${mode}`;
            assert.equal(f.contextFilePreview.path, path, label);
            assert.equal(f.contextFileReturnOpen, wasOpen, label);
            assert.equal(f.contextFileReturnMode, mode, label);
            f.closeContextFilePreview();
            assert.equal(f.workContextOpen, wasOpen, label);
            assert.equal(f.workContextMode, mode, label);
            assert.equal(f.contextFileReturnPending, false, label);
        }
    }
});

test('directory activity still opens and reveals the tree without creating a file preview', async () => {
    const { f, directories, reveals, reads } = fixture(), path = '/project/output'; directories.set(path, []);
    await f.openToolFileActivity({ kind: 'workspace.list_files', resource: { kind: 'file', path, action: 'read' } });
    assert.equal(f.workContextOpen, true);
    assert.equal(f.workContextMode, 'file');
    assert.equal(f.contextFilePreviewLoading, false);
    assert.equal(f.contextFilePreview, undefined);
    assert.deepEqual(reads, []);
    assert.deepEqual(reveals, [{ ...node(path), directory: true }]);
});

test('a genuinely missing file leaves no loading state and reports the composer notice', async () => {
    for (const entry of ['openContextFile', 'openConversationFileLink', 'openCheckpointDiff']) {
        const { f, warnings } = fixture(); const path = '/project/globals.css';
        if (entry === 'openContextFile') await f.openContextFile(node(path).uri);
        else if (entry === 'openConversationFileLink') await f.openConversationFileLink(path);
        else await f.openCheckpointDiff({ path, checkpointId: 'missing-checkpoint' });
        // The bottom-right composer notice, scoped to the conversation that asked.
        assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session'], entry);
        assert.equal(f.contextFilePreviewLoading, false, entry);
        assert.equal(f.contextFileOpening, undefined, entry);
    }
});

test('checkpoint rejection or null falls back to its actual file, including absolute paths without a workspace', async () => {
    for (const [root, result] of [['/project', 'throw'], ['/project', 'null'], ['', 'throw']]) {
        const { f, files, reads } = fixture(root);
        const path = '/outside/app/globals.css'; files.set(path, 'body {}');
        f.platformService.getAgentCheckpointDiff = async () => { if (result === 'null') return null; throw new Error('missing'); };
        const pending = f.openCheckpointDiffById('cp', 'diff', { path });
        assertOpening(f, path); await pending;
        assert.deepEqual(reads, [path]);
        assert.equal(f.contextFilePreview.content, 'body {}');
        assert.equal(f.contextFilePreview.readOnly, true);
        assert.equal(f.contextFilePreviewLoading, false);
    }
});

test('a deleted working copy with checkpoint content keeps readable history and clears the missing notice', async () => {
    const { f } = fixture();
    f.councilBelowNotice = '该文件不存在'; // left by an earlier tool-activity click on the deleted file
    await f.openCheckpointDiff({ path: '/project/globals.css', workspaceRoot: '/project', checkpointId: 'cp', beforeContent: 'previous css' });
    assert.equal(f.contextFilePreview.historicalMissing, true);
    assert.equal(f.contextFilePreview.beforeContent, 'previous css');
    assert.equal(f.contextFilePreview.error, '');
    assert.equal(f.councilBelowNotice, '');
});

test('a bare image name opens its file under the conversation root in the lightbox plus left tree', async () => {
    const { f, files, lightboxes, reveals, reads, resolutions } = fixture();
    const path = '/project/Promo.png'; files.set(path, 'image');
    f.contextFileChildren.set('/project/artifacts', [node('/project/artifacts/Promo.png')]);
    await f.openConversationFileLink('Promo.png');
    assert.deepEqual(lightboxes, [['Promo.png', node(path).uri]]);
    assert.equal(f.attachmentLightboxPath, path);
    assert.deepEqual(reveals.map(value => value.path), [path]);
    assert.deepEqual(resolutions, [path], 'one root, no folder search');
    assert.deepEqual(reads, [], 'image pixels stay in the media viewer');
});

test('image evidence still passes through branch rebasing before the lightbox reads a file', async () => {
    const { f, files, lightboxes, resolutions } = fixture('/private-copy');
    const sourcePath = '/original/artifacts/promo.png', privatePath = '/private-copy/artifacts/promo.png';
    f.session = { id: 'session', ownedWorkspace: true, sourceConversationId: 'parent', turns: [{ id: 'turn', changes: [{ path: sourcePath }] }] };
    files.set(sourcePath, 'ancestor'); files.set(privatePath, 'copy');
    const rebased = [];
    f.resolveToolReadBranchUri = async (_session, _uri, originalPath) => { rebased.push(originalPath); return URI.fromFilePath(privatePath); };
    await f.openConversationFileLink('promo.png', 'turn');
    assert.deepEqual(rebased, [sourcePath]);
    assert.deepEqual(lightboxes, [['promo.png', node(privatePath).uri]]);
    assert.equal(resolutions.at(-1), privatePath);
});

test('a link to a network share outside the conversation roots is refused before any file access', async () => {
    for (const target of ['file://files.example/share/report.md', 'file://files.example/share/promo.png']) {
        const { f, resolutions, reads, lightboxes, warnings } = fixture();
        await f.openConversationFileLink(target);
        assert.deepEqual(resolutions, [], 'the system never contacts the server');
        assert.deepEqual(reads, []); assert.deepEqual(lightboxes, []);
        assert.deepEqual(warnings.at(-1), ['warning', '链接未打开', '该链接类型不受支持或存在安全风险。', 'session']);
        assert.equal(f.contextFilePreviewLoading, false); assert.equal(f.contextFileOpening, undefined);
    }
});

test('an older delayed file read cannot replace the file chosen afterward', async () => {
    const { f, files } = fixture(); const first = '/project/first.ts', second = '/project/second.ts';
    files.set(first, 'old'); files.set(second, 'new'); const gate = deferred();
    const read = f.fileService.read; let started = false;
    f.fileService.read = async uri => { if (FileUri.fsPath(uri) === first) { started = true; await gate.promise; } return read(uri); };
    const pending = f.openContextFile(node(first).uri); await waitFor(() => started);
    await f.openContextFile(node(second).uri); gate.resolve(); await pending;
    assert.equal(f.contextFilePreview.path, second);
    assert.equal(f.contextFilePreview.content, 'new');
    assert.equal(f.contextFilePreviewLoading, false);
});

// These regressions protect the request token handoff between discovery, the viewer and checkpoints.
test('opening an image cancels a previous file spinner without allowing its delayed read to win', async () => {
    const { f, files, lightboxes } = fixture(); const text = '/project/slow.ts', image = '/project/promo.png';
    files.set(text, 'late'); files.set(image, 'image'); const gate = deferred(); let started = false;
    const read = f.fileService.read;
    f.fileService.read = async uri => { if (FileUri.fsPath(uri) === text) { started = true; await gate.promise; } return read(uri); };
    const pending = f.openContextFile(node(text).uri); await waitFor(() => started);
    await f.openConversationFileLink(image); gate.resolve(); await pending;
    assert.equal(lightboxes.length, 1);
    assert.equal(f.contextFilePreviewLoading, false);
    assert.equal(f.contextFileOpening, undefined);
});

test('a superseded checkpoint failure never reopens its old fallback file', async () => {
    const { f, files, reads } = fixture(); const first = '/project/old.css', second = '/project/new.ts';
    files.set(first, 'old'); files.set(second, 'new'); const gate = deferred(); let started = false;
    f.platformService.getAgentCheckpointDiff = async () => { started = true; await gate.promise; throw new Error('missing checkpoint'); };
    const pending = f.openCheckpointDiffById('cp', 'diff', { path: first }); await waitFor(() => started);
    await f.openContextFile(node(second).uri); gate.resolve(); await pending;
    assert.equal(f.contextFilePreview.path, second);
    assert.equal(reads.includes(first), false);
});

test('native evidenced percent signs are not decoded a second time by the click handler', async () => {
    const { f, files, reads } = fixture(); const path = '/project/literal%20name.ts'; files.set(path, 'literal percent');
    f.session.turns = [{ id: 'turn', changes: [{ path }] }];
    await f.openConversationFileLink('literal%2520name.ts', 'turn');
    assert.deepEqual(reads, [path]);
    assert.equal(f.contextFilePreview.content, 'literal percent');
});


function* reactElements(element) {
    if (!React.isValidElement(element)) return;
    yield element;
    for (const child of React.Children.toArray(element.props.children)) yield* reactElements(child);
}

test('actual completed stream file resources without checkpoints open absolute created/updated files read-only', async () => {
    for (const action of ['created', 'updated']) {
        const { f, files, reads, warnings } = fixture();
        const path = 'c:/Users/49674/Desktop/ai漫剧/app/globals.css'; files.set(path, 'body {}');
        const projection = projectConversationStream({ locale: 'zh-CN', running: false, events: [{
            type: 'tool_completed', callId: action, toolName: 'workspace.write_file', ok: true,
            summary: { title: 'write', resource: { kind: 'file', action, path } }
        }] });
        const row = projection.items.find(item => item.kind === 'row' && item.open?.kind === 'file');
        assert.ok(row, 'the production stream exposes an open target even without a checkpoint');
        assert.equal(row.open.summary.checkpointId, undefined);
        await f.openToolFileActivity(row.open.summary);
        assert.deepEqual(reads, [path]);
        assert.equal(f.contextFilePreview.readOnly, true);
        assert.deepEqual(warnings, []);
    }
});

test('the actual bottom changed-file row remains clickable without a checkpoint and falls back to its path', async () => {
    const { f, files } = fixture(); const path = '/project/globals.css'; files.set(path, 'body {}');
    let pending;
    const tree = NextMuxChangeReview({ locale: 'zh-CN', changes: [{ path, additions: 2, deletions: 1 }],
        isRestored: () => false, onOpen: change => { pending = f.openCheckpointDiff(change); },
        onRestore() {}, onRestoreAll() {}, restoring: false, blocked: false });
    const button = [...reactElements(tree)].find(element => element.props.className === 'nmx-review-file-path');
    assert.ok(button);
    assert.notEqual(button.props.disabled, true);
    button.props.onClick(); assertOpening(f, path); await pending;
    assert.equal(f.contextFilePreview.content, 'body {}');
});

test('all required image suffixes including SVG, AVIF and ICO open the lightbox and reveal the tree', async () => {
    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'avif', 'ico']) {
        const { f, files, lightboxes, reveals, reads } = fixture(); const path = `/project/logo.${extension}`; files.set(path, 'image');
        await f.openConversationFileLink(path);
        assert.deepEqual(lightboxes, [[`logo.${extension}`, node(path).uri]], extension);
        assert.deepEqual(reveals.map(value => value.path), [path], extension);
        assert.deepEqual(reads, [], extension);
    }
});

test('stream filename clicks open a detailed file row without toggling its diff while the row still expands', () => {
    const streamSource = readFileSync(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url), 'utf8');
    const streamAst = ts.createSourceFile('stream.tsx', streamSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = streamAst.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
        .find(declaration => declaration.name.getText(streamAst) === 'StreamRow');
    const rowFunction = declaration.initializer.arguments[0].getText(streamAst);
    const placeholder = () => null;
    for (const phrase of [false, true]) {
        const opened = [], toggles = [];
        const react = { ...React, useState: () => [false, next => toggles.push(next)], useRef: () => ({ current: '' }) };
        const compile = ts.transpile(`return (${rowFunction});`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React });
        const render = Function('React', 'conversationStreamText', 'SwapText', 'StreamSearchText', 'StreamCollapse', 'StreamDetailsView', 'StreamFilePath', compile)(
            react, (_locale, key) => key, placeholder, placeholder, placeholder, placeholder, placeholder);
        const summary = { checkpointId: 'cp', resource: { kind: 'file', action: 'updated', path: '/project/globals.css' } };
        const item = { kind: 'row', key: 'row', title: 'Edited', target: 'globals.css', targetStyle: 'file', icon: 'edit',
            tone: 'done', phrase, details: { kind: 'diff', patch: '+body {}' }, open: { kind: 'file', label: 'Open', summary } };
        const tree = render({ item, locale: 'zh-CN', idPrefix: 'test', onOpen: target => opened.push(target) });
        const elements = [...reactElements(tree)];
        const filename = elements.find(element => element.type === 'span' && element.props.className?.startsWith('nmx-stream-target'));
        let stopped = false; filename.props.onClick({ stopPropagation() { stopped = true; } });
        assert.equal(stopped, true);
        assert.deepEqual(opened, [{ kind: 'file', summary }]);
        assert.deepEqual(toggles, [], 'file target click does not expand the diff');
        elements.find(element => element.props.className === 'nmx-stream-trigger').props.onClick();
        assert.equal(toggles.length, 1, 'the remaining row surface keeps its detail toggle');
    }
});


test('without turn evidence a bare name checks only its root path: cached and unopened folders are never searched', async () => {
    for (const name of ['promo.png', 'notes.md']) {
        const { f, files, directories, lightboxes, reads, resolutions, warnings } = fixture();
        directories.set('/project', ['artifacts', 'output'].map(folder => ({ ...node(`/project/${folder}`), directory: true })));
        for (const folder of ['artifacts', 'output']) {
            const path = `/project/${folder}/${name}`; files.set(path, folder); directories.set(`/project/${folder}`, [node(path)]);
        }
        f.contextFileChildren.set('/project/artifacts', [node(`/project/artifacts/${name}`)]);
        f.expandedContextDirectories = new Set(['/project']);
        await f.openConversationFileLink(name);
        assert.deepEqual(resolutions, [`/project/${name}`], name);
        assert.deepEqual(reads, [], name);
        assert.deepEqual(lightboxes, [], name);
        assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session'], name);
        assert.deepEqual([...f.expandedContextDirectories], ['/project'], 'the visible tree is not expanded');
        assert.equal(f.contextFilePreviewLoading, false, name);
        assert.equal(f.contextFileOpening, undefined, name);
    }
});

test('an exact turn file wins over a shallower cached file with the same name', async () => {
    const { f, files, lightboxes } = fixture();
    const expected = '/project/output/deep/promo.png', other = '/project/artifacts/promo.png';
    files.set(expected, 'turn'); files.set(other, 'other'); f.contextFileChildren.set('/project/artifacts', [node(other)]);
    f.session.turns = [{ id: 'turn', changes: [{ path: expected }] }];
    await f.openConversationFileLink('promo.png', 'turn');
    assert.deepEqual(lightboxes, [['promo.png', node(expected).uri]]);
});

test('a missing exact turn reference never opens an unrelated file with the same basename', async () => {
    for (const name of ['promo.png', 'tasks.sqlite']) {
        const { f, files, directories, lightboxes, reads, resolutions, warnings } = fixture();
        const expected = `/project/output/${name}`, unrelated = `/project/artifacts/${name}`;
        files.set(unrelated, 'unrelated');
        directories.set('/project', [{ ...node('/project/artifacts'), directory: true }]);
        directories.set('/project/artifacts', [node(unrelated)]);
        f.contextFileChildren.set('/project/artifacts', [node(unrelated)]);
        f.session.turns = [{ id: 'turn', changes: [{ path: expected }] }];
        await f.openConversationFileLink(name, 'turn');
        assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session'], name);
        assert.equal(resolutions.includes(unrelated), false, name);
        assert.equal(reads.includes(unrelated), false, name);
        assert.deepEqual(lightboxes, [], name);
        assert.equal(f.contextFilePreviewLoading, false, name);
    }
});

test('name-only or root-file turn evidence resolves at the conversation root, never in a subdirectory', async () => {
    for (const evidence of [{ attachments: [{ name: 'promo.png' }] }, { changes: [{ path: 'promo.png' }] },
        { changes: [{ path: '/project/promo.png' }] }]) {
        const { f, files, directories, lightboxes, resolutions, warnings } = fixture();
        const path = '/project/artifacts/promo.png'; files.set(path, 'image');
        directories.set('/project', [{ ...node('/project/artifacts'), directory: true }]);
        directories.set('/project/artifacts', [node(path)]);
        f.session.turns = [{ id: 'turn', ...evidence }];
        await f.openConversationFileLink('promo.png', 'turn');
        assert.deepEqual(resolutions, ['/project/promo.png']);
        assert.deepEqual(lightboxes, []);
        assert.deepEqual(warnings.at(-1), ['error', '该文件不存在', '', 'session']);
    }
});

test('an image link still being checked cannot open after a newer file click', async () => {
    const { f, files, lightboxes } = fixture();
    const image = '/project/promo.png', next = '/project/new.ts';
    files.set(image, 'image'); files.set(next, 'new');
    const resolve = f.fileService.resolve, gate = deferred(); let started = false;
    f.fileService.resolve = async uri => { if (FileUri.fsPath(uri) === image) { started = true; await gate.promise; } return resolve(uri); };
    const pending = f.openConversationFileLink('promo.png'); await waitFor(() => started);
    await f.openContextFile(node(next).uri); gate.resolve(); await pending;
    assert.deepEqual(lightboxes, []);
    assert.equal(f.contextFilePreview.path, next);
    assert.equal(f.contextFilePreview.content, 'new');
});

test('an unfinished read placeholder is never saved as a loaded empty tab when another file opens', async () => {
    const { f, files } = fixture(); delete f.rememberContextFileTab;
    const first = '/project/slow.ts', next = '/project/new.ts'; files.set(first, 'late'); files.set(next, 'new');
    const read = f.fileService.read, gate = deferred(); let started = false;
    f.fileService.read = async uri => { if (FileUri.fsPath(uri) === first) { started = true; await gate.promise; } return read(uri); };
    const pending = f.openContextFile(node(first).uri); await waitFor(() => started);
    await f.openContextFile(node(next).uri); gate.resolve(); await pending;
    const oldTab = f.contextFileTabs.get(node(first).uri);
    assert.ok(!oldTab || oldTab.preview.content === 'late', 'an interrupted read cannot become an empty cached document');
    assert.equal(f.contextFilePreview.path, next);
});

test('image tool resources with checkpoint IDs still open the lightbox rather than a code drawer', async () => {
    const { f, files, lightboxes, reads } = fixture(); const path = '/project/logo.svg'; files.set(path, '<svg/>');
    let checkpointReads = 0;
    f.platformService.getAgentCheckpointDiff = async () => { checkpointReads++; return { path, checkpointId: 'cp', beforeContent: '<svg/>' }; };
    await f.openToolFileActivity({ checkpointId: 'cp', resource: { kind: 'file', path, action: 'created' } });
    assert.deepEqual(lightboxes, [['logo.svg', node(path).uri]]);
    assert.equal(checkpointReads, 0);
    assert.deepEqual(reads, []);
});
