import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const actionSource = readFileSync(new URL('../src/browser/nextmux-context-file-actions.ts', import.meta.url), 'utf8');
const actionExports = {};
new Function('exports', ts.transpile(actionSource, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(actionExports);
const { ContextFileActionError, contextFileActionItems, validContextFileName } = actionExports;
const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widget, 'the real desktop widget must exist');
const methods = [
    'contextFileMenuCurrent', 'contextFileResourceReadOnly', 'contextFileMenuResource',
    'contextFileTreeSelectionCurrent', 'runContextFileTreeAction',
    'resolveUniquePasteDestination', 'performContextFileAction'
].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(method, `the real ${name} method must exist`);
    return method.getText(ast);
}).join('\n');
const Harness = new Function('URI', 'OS', 'ContextFileActionError', 'contextFileActionItems', 'validContextFileName',
    'contextFileText', 'FileSystemProviderCapabilities', 'toFileOperationResult', 'FileOperationResult', 'document',
    ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
    URI, { type: () => 'Linux', Type: { Windows: 'Windows', OSX: 'OSX' } },
    ContextFileActionError, contextFileActionItems, validContextFileName,
    (_locale, key) => key, { Readonly: 1, Trash: 2 }, () => undefined, { FILE_MOVE_CONFLICT: 4 },
    { activeElement: null }
);

// Execute current source methods; only filesystem/RPC/DOM boundaries are faked.
// These are renderer unit tests, not native clipboard or real filesystem acceptance tests.
function fixture() {
    const entries = new Map();
    const operations = [], notifications = [], rebases = [];
    const state = Object.assign(new Harness(), {
        activeSection: 'coding', codingPanel: 'thread', activeCodingSessionId: 'session-a',
        contextFilesWorkspace: '/workspace', codingSessionNavigationGeneration: 1,
        contextFileTreeActionRequest: 0, contextFileActionBusy: false,
        contextFileChildren: new Map(), pendingContextFileWrites: new Set(), desktopLocale: 'en',
        activeCodingSession() { return { id: this.activeCodingSessionId, workspacePath: this.contextFilesWorkspace }; },
        codingSessionWorkspaceRoot(session) { return session.workspacePath; },
        update() {},
        addNotification(...args) { notifications.push(args); },
        async loadContextFiles() {},
        async saveContextFilesBeforeMutation() { return true; },
        rebaseContextFileTabs(source, destination) { rebases.push([source.path.fsPath(), destination.path.fsPath()]); },
        fileService: {
            async exists(resource) { return entries.has(resource.path.fsPath()); },
            async resolve(resource) {
                const entry = entries.get(resource.path.fsPath());
                assert.ok(entry, `missing fixture resource: ${resource}`);
                return { resource, isDirectory: entry.directory, isReadonly: entry.readOnly };
            },
            hasCapability() { return false; }
        },
        platformService: {
            async resolveWorkspaceFile(workspaceRoot, path) {
                return { inside: URI.fromFilePath(workspaceRoot).isEqualOrParent(URI.fromFilePath(path)), path };
            },
            async copyOrMoveWorkspaceFile(workspaceRoot, source, destination, mode) {
                assert.ok(entries.has(source), 'the source must still exist');
                assert.equal(entries.has(destination), false, 'paste must never overwrite an existing file');
                operations.push({ workspaceRoot, source, destination, mode });
                entries.set(destination, { ...entries.get(source) });
                if (mode === 'move') entries.delete(source);
            }
        }
    });
    function add(path, directory = false, options = {}) {
        entries.set(path, { directory, readOnly: false, content: `original:${path}`, ...options });
        const uri = URI.fromFilePath(path);
        return { uri: uri.toString(), path, name: uri.path.base, directory };
    }
    function menu(node) {
        return {
            owner: state.activeCodingSessionId, workspaceRoot: state.contextFilesWorkspace,
            navigation: state.codingSessionNavigationGeneration, node,
            root: node.path === state.contextFilesWorkspace, ready: true,
            readOnly: false, parentReadOnly: false, trash: false, trigger: { isConnected: false }
        };
    }
    function switchSession(id, workspaceRoot = state.contextFilesWorkspace) {
        state.activeCodingSessionId = id;
        state.contextFilesWorkspace = workspaceRoot;
        state.codingSessionNavigationGeneration += 1;
    }
    add('/workspace', true);
    add('/workspace/source', true);
    add('/workspace/target', true);
    const source = add('/workspace/source/report.md');
    const target = add('/workspace/target/selected.txt', false, { content: 'selected file must survive' });
    return { state, entries, operations, notifications, rebases, add, menu, switchSession, source, target };
}

test('file-target paste is available for a readonly file with a writable parent and obeys menu guards', () => {
    const base = { root: false, directory: false, ready: true, readonly: true, parentReadonly: false, trash: false, paste: true, busy: false };
    const paste = value => contextFileActionItems(value).find(item => item.id === 'paste');
    assert.equal(paste(base)?.disabled, false);
    for (const patch of [{ parentReadonly: true }, { paste: false }, { ready: false }, { busy: true }]) {
        assert.equal(paste({ ...base, ...patch })?.disabled, true, JSON.stringify(patch));
    }
});

test('pasting on a file copies into its parent without replacing the selected readonly file', async () => {
    const f = fixture();
    f.entries.get(f.target.path).readOnly = true;
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    const clipboard = f.state.contextFileClipboard;
    await f.state.performContextFileAction(f.menu(f.target), 'paste');
    assert.deepEqual(f.operations, [{ workspaceRoot: '/workspace', source: f.source.path,
        destination: '/workspace/target/report.md', mode: 'copy' }]);
    assert.equal(f.entries.get(f.target.path).content, 'selected file must survive');
    assert.equal(f.entries.get('/workspace/target/report.md').content, f.entries.get(f.source.path).content);
    assert.equal(f.state.contextFileClipboard, clipboard, 'copy clipboard remains reusable');
    assert.equal(f.state.contextFileActionBusy, false);
    assert.equal(f.state.pendingContextFileWrites.size, 0);
    assert.equal(f.notifications.some(([kind]) => kind === 'error'), false);
});

test('file-tree paste on a selected file routes through the same parent-directory behavior', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    f.state.contextFileSelection = {
        owner: 'session-a', workspaceRoot: '/workspace', navigation: 1, node: f.target
    };
    await f.state.runContextFileTreeAction({ isConnected: false }, f.target, 'paste');
    assert.deepEqual(f.operations.map(operation => operation.destination), ['/workspace/target/report.md']);
    assert.equal(f.notifications.some(([kind]) => kind === 'error'), false);
});

test('duplicate file pastes preserve the original and use successive unique names with the extension intact', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    await f.state.performContextFileAction(f.menu(f.source), 'paste');
    await f.state.performContextFileAction(f.menu(f.source), 'paste');
    assert.deepEqual(f.operations.map(operation => operation.destination), [
        '/workspace/source/report copy.md', '/workspace/source/report copy 2.md'
    ]);
    for (const path of [f.source.path, ...f.operations.map(operation => operation.destination)]) {
        assert.equal(f.entries.get(path).content, `original:${f.source.path}`);
    }
    assert.ok(f.state.contextFileClipboard);
});

test('unique paste naming handles extensionless files, dotfiles, dotted directories, and existing copies', async () => {
    for (const [name, directory, expected] of [
        ['README', false, 'README copy 2'], ['.env', false, '.env copy 2'],
        ['archive.tar.gz', false, 'archive.tar copy 2.gz'], ['release.v1', true, 'release.v1 copy 2']
    ]) {
        const f = fixture();
        f.add(`/workspace/target/${name}`, directory);
        f.add(`/workspace/target/${expected.replace(' copy 2', ' copy')}`, directory);
        const destination = await f.state.resolveUniquePasteDestination(URI.fromFilePath('/workspace/target'), name, directory);
        assert.equal(destination.path.fsPath(), `/workspace/target/${expected}`, name);
        assert.deepEqual(f.operations, [], 'resolving a unique name does not mutate files');
    }
});

test('a copied file can be pasted by another conversation in the same workspace', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    const clipboard = f.state.contextFileClipboard;
    assert.equal(clipboard.owner, 'session-a');
    f.switchSession('session-b');
    await f.state.performContextFileAction(f.menu(f.target), 'paste');
    assert.equal(f.operations.length, 1);
    assert.equal(f.operations[0].destination, '/workspace/target/report.md');
    assert.equal(f.state.contextFileClipboard, clipboard);
    assert.equal(f.notifications.some(([kind]) => kind === 'error'), false);
});

test('a cut file can move across conversations in the same workspace and clears the clipboard', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'cut');
    assert.equal(f.state.contextFileClipboard.owner, 'session-a');
    f.switchSession('session-b');
    await f.state.performContextFileAction(f.menu(f.target), 'paste');
    assert.deepEqual(f.operations, [{ workspaceRoot: '/workspace', source: f.source.path,
        destination: '/workspace/target/report.md', mode: 'move' }]);
    assert.equal(f.entries.has(f.source.path), false);
    assert.equal(f.state.contextFileClipboard, undefined);
    assert.deepEqual(f.rebases, [[f.source.path, '/workspace/target/report.md']]);
});

test('a different workspace cannot consume the clipboard from the previous conversation', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    const clipboard = f.state.contextFileClipboard;
    f.add('/other-workspace', true);
    const other = f.add('/other-workspace/selected.txt');
    f.switchSession('session-b', '/other-workspace');
    await f.state.performContextFileAction(f.menu(other), 'paste');
    assert.deepEqual(f.operations, []);
    assert.equal(f.state.contextFileClipboard, clipboard);
});

test('a stale menu cannot paste after switching conversation even inside the same workspace', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    const oldMenu = f.menu(f.target);
    f.switchSession('session-b');
    await f.state.performContextFileAction(oldMenu, 'paste');
    assert.deepEqual(f.operations, []);
    assert.equal(f.state.contextFileActionBusy, false);
});

test('file-target paste rechecks its parent permission and refuses a readonly directory', async () => {
    const f = fixture();
    await f.state.performContextFileAction(f.menu(f.source), 'copy');
    f.entries.get('/workspace/target').readOnly = true;
    await f.state.performContextFileAction(f.menu(f.target), 'paste');
    assert.deepEqual(f.operations, []);
    assert.deepEqual(f.notifications.at(-1), ['error', 'actions', 'readOnly', 'session-a']);  // Filed under the conversation that started the paste.
    assert.equal(f.entries.get(f.target.path).content, 'selected file must survive');
    assert.equal(f.state.contextFileActionBusy, false);
});

test('a copied directory cannot be pasted onto a file inside that directory', async () => {
    const f = fixture();
    const directory = f.add('/workspace/source/nested', true);
    const descendant = f.add('/workspace/source/nested/selected.txt');
    await f.state.performContextFileAction(f.menu(directory), 'copy');
    await f.state.performContextFileAction(f.menu(descendant), 'paste');
    assert.deepEqual(f.operations, []);
    assert.deepEqual(f.notifications.at(-1), ['error', 'actions', 'pasteIntoSelf', 'session-a']);
});

test('cut paste conflicts never overwrite an existing target or silently choose a copy name', async () => {
    const f = fixture();
    f.add('/workspace/target/report.md', false, { content: 'keep existing target' });
    await f.state.performContextFileAction(f.menu(f.source), 'cut');
    const clipboard = f.state.contextFileClipboard;
    await f.state.performContextFileAction(f.menu(f.target), 'paste');
    assert.deepEqual(f.operations, []);
    assert.deepEqual(f.notifications.at(-1), ['error', 'actions', 'exists', 'session-a']);
    assert.equal(f.entries.get('/workspace/target/report.md').content, 'keep existing target');
    assert.ok(f.entries.has(f.source.path));
    assert.equal(f.state.contextFileClipboard, clipboard);
    assert.equal(f.state.pendingContextFileWrites.size, 0);
});
