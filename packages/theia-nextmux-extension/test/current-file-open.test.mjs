import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { filePreviewRequestIsCurrent } from '../lib/browser/nextmux-file-preview.js';
import { rebaseConversationBranchFileView } from '../lib/browser/nextmux-conversation-branch.js';

const require = createRequire(import.meta.url), URI = require('@theia/core/lib/common/uri').default;
const { FileUri } = require('@theia/core/lib/common/file-uri');
const fileErrors = require('@theia/filesystem/lib/common/files');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['beginContextFileOpen', 'finishContextFileOpen', 'resolveConversationTarget', 'previewContextFile', 'openContextFile', 'fileActivityRootContains', 'resolveToolReadBranchUri', 'openToolFileActivity', 'openCheckpointDiffById', 'rememberContextFileTab', 'activateContextFileTab'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const bindings = { ...require('../lib/browser/nextmux-conversation-file-target.js'), ...require('../lib/browser/nextmux-conversation-media.js'), URI, FileUri, filePreviewRequestIsCurrent, rebaseConversationBranchFileView, NextMuxDesktopWidget: { LARGE_TEXT_FILE_CHARACTERS: 1000000, FILE_LIST_MIN_WIDTH: 160 },
    toFileOperationResult: fileErrors.toFileOperationResult, FileOperationResult: { FILE_NOT_FOUND: 1, FILE_TOO_LARGE: 7, FILE_EXCEEDS_MEMORY_LIMIT: 9 },
    FILE_DRAWER_TEXT_MAX_BYTES: 64 * 1024 * 1024, IMAGE_PREVIEW_MAX_BYTES: 32 * 1024 * 1024,
    FileSystemProviderCapabilities: { Readonly: 1 }, filePreviewErrorText: (_locale, key) => key, localizeDesktopSurface: (_locale, value) => value,
    conversationText: (_locale, key) => key };
const Harness = Function(...Object.keys(bindings), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
const node = path => { const uri = URI.fromFilePath(path); return { uri: uri.toString(), path, name: uri.path.base, directory: false }; };
function fixture() {
    const host = new Harness(), reads = [], checkpointReads = [], captures = [], notices = [];
    const files = new Map([['/work/a.ts', 'current on disk'], ['/other/a.ts', 'other current']]);
    const session = { id: 'session', workspacePath: '/work', turns: [{ changes: [{ path: 'a.ts', checkpointId: 'checkpoint' }] }] };
    const detail = { checkpointId: 'checkpoint', path: 'a.ts', beforeContent: 'historical before', afterContent: 'historical after', kind: 'modified' };
    Object.assign(host, {
        activeCodingSessionId: session.id, activeWorkspaceRoot: '/work', activeSection: 'coding', codingPanel: 'thread', desktopLocale: 'en',
        codingSessions: [session], activeCodingSession: () => session, codingSessionWorkspaceRoot: () => session.workspacePath,
        codingSessionStoredWorkspaceRoots: () => ['/work', '/other'],
        contextFileTabs: new Map(), contextFileSavingUris: new Set(), contextFileDrafts: {}, contextFileDirty: false,
        contextFileActiveSide: 'current', contextFilePreviewRequestToken: 0, codingViewRestoreToken: 0,
        contextFileHistoryRequestToken: 0, contextFileHistorySelectionToken: 0, contextFileHistoryOpen: false,
        workContextMode: 'file', workContextOpen: true, workContextWidth: 720,
        workContextMaximumWidth: () => 1000, contextFileListWidth: 218, contextFileListMaximumWidth: () => 400,
        clampPaneSize: (value, min, max) => Math.min(Math.max(value, min), max), constrainPaneSizes() {}, rememberNavigation() {}, update() {}, persistActiveCodingSessionState() {},
        attachmentExtension: () => 'ts', contextFileVersionTarget: () => undefined, detachContextEditorRecovery: () => true,
        captureContextEditorRecovery: () => true,
        preserveContextFileTabRecovery(tab) { captures.push(structuredClone(tab)); return true; },
        editorRecoveryController: () => ({ refresh: async () => {}, find: () => undefined, state: { entries: [] } }),
        loadContextFiles: async () => {}, loadContextFileHistory: async () => {},
        addNotification: (...args) => notices.push(args),
        fileService: {
            async read(uri) { const path = uri.path.fsPath(); reads.push(path); if (!files.has(path)) throw new Error('ENOENT'); return { value: files.get(path), mtime: 2, etag: 'current' }; },
            async resolve(uri) { if (!files.has(uri.path.fsPath())) throw new fileErrors.FileOperationError('Unable to resolve nonexistent file', 1); return { resource: uri, isReadonly: false }; },
            hasCapability: () => false
        },
        platformService: { async getAgentCheckpointDiff(root, checkpointId) { checkpointReads.push({ root, checkpointId }); return detail; } }
    });
    function cache({ path = '/work/a.ts', content = 'cached working copy', current = content, before = 'historical before', dirty = false } = {}) {
        host.contextFilePreview = { ...node(path), content, beforeContent: before, checkpointId: 'old-checkpoint', recoveryKey: 'old-recovery', revision: 1 };
        host.contextFileDrafts = { current, ...(before !== undefined ? { before } : {}) }; host.contextFileDirty = dirty;
        host.rememberContextFileTab();
    }
    return { host, reads, checkpointReads, captures, notices, files, detail, cache, session };
}

test('normal file open reads current bytes without looking up recorded changes', async () => {
    const f = fixture(); await f.host.previewContextFile(node('/work/a.ts'));
    assert.equal(f.host.contextFilePreview.content, 'current on disk');
    assert.equal(f.host.contextFilePreview.beforeContent, undefined); assert.equal(f.host.contextFilePreview.checkpointId, undefined);
    assert.deepEqual(f.checkpointReads, []); assert.deepEqual(f.host.contextFileDrafts, { current: 'current on disk' });
});

test('normal click and markdown file links replace an already-open clean diff with fresh current content', async () => {
    for (const viaLink of [false, true]) {
        const f = fixture(); f.cache();
        if (viaLink) await f.host.openContextFile(node('/work/a.ts').uri, { startLine: 2, endLine: 3 });
        else await f.host.previewContextFile(node('/work/a.ts'));
        assert.equal(f.host.contextFilePreview.content, 'current on disk'); assert.equal(f.host.contextFilePreview.beforeContent, undefined);
        assert.deepEqual(f.reads, ['/work/a.ts']);
        if (viaLink) assert.deepEqual(f.host.contextFilePreview.revealRange, { startLine: 2, endLine: 3 });
    }
});

test('opening current keeps unsaved current text and preserves edited historical text separately', async () => {
    const f = fixture(); f.cache({ current: '', dirty: true });
    f.host.contextFileDrafts.before = 'unsaved historical edit';
    await f.host.previewContextFile(node('/work/a.ts'));
    assert.deepEqual(f.reads, []); assert.deepEqual(f.host.contextFileDrafts, { current: '' }); assert.equal(f.host.contextFileDirty, true);
    assert.equal(f.host.contextFilePreview.beforeContent, undefined); assert.notEqual(f.host.contextFilePreview.recoveryKey, 'old-recovery');
    assert.equal(f.captures[0].drafts.before, 'unsaved historical edit'); assert.equal(f.host.contextFileActiveSide, 'current');
});

test('a historical-only draft is retained without reopening that recovery in place of the current file', async () => {
    const f = fixture(); f.cache({ dirty: true }); f.host.contextFileDrafts.before = 'keep this historical draft';
    f.host.editorRecoveryController = () => ({ refresh: async () => {}, find: () => ({ key: 'old-recovery' }), state: { entries: [] } });
    f.host.openContextEditorRecovery = () => assert.fail('ordinary open must not switch back to the historical recovery');
    await f.host.previewContextFile(node('/work/a.ts'));
    assert.equal(f.captures[0].drafts.before, 'keep this historical draft');
    assert.equal(f.host.contextFilePreview.content, 'current on disk'); assert.equal(f.host.contextFilePreview.beforeContent, undefined);
    assert.equal(f.host.contextFileDirty, false); assert.deepEqual(f.reads, ['/work/a.ts']);
});

test('a rejected draft backup or an in-flight save leaves the original editor and drafts intact', async () => {
    for (const saving of [false, true]) {
        const f = fixture(); f.cache({ current: 'unsaved', dirty: true });
        const preview = f.host.contextFilePreview, drafts = f.host.contextFileDrafts;
        if (saving) f.host.contextFileSavingUris.add(preview.uri);
        else f.host.preserveContextFileTabRecovery = () => false;
        await f.host.previewContextFile(node('/work/a.ts'));
        assert.equal(f.host.contextFilePreview, preview); assert.equal(f.host.contextFileDrafts, drafts); assert.deepEqual(f.reads, []);
    }
});

test('activity checkpoint resolves its owning root but never supplies historical file contents', async () => {
    const f = fixture(); f.host.platformService.getAgentCheckpointDiff = async root => {
        if (root === '/work') throw new Error('not here'); return f.detail;
    };
    await f.host.openToolFileActivity({ checkpointId: 'checkpoint', resource: { kind: 'file', path: 'a.ts', action: 'updated' } });
    assert.equal(f.host.contextFilePreview.path, '/other/a.ts'); assert.equal(f.host.contextFilePreview.content, 'other current');
    assert.equal(f.host.contextFilePreview.beforeContent, undefined); assert.equal(f.host.activeCheckpointDiff, undefined);
    assert.deepEqual(f.reads, ['/other/a.ts']);
});

test('explicit diff still displays historical before against the current working copy', async () => {
    const f = fixture(); await f.host.openCheckpointDiffById('checkpoint');
    assert.equal(f.host.contextFilePreview.beforeContent, 'historical before');
    assert.equal(f.host.contextFilePreview.content, 'current on disk');
});

test('deleted current files show a missing error, while the explicit deleted diff remains available', async () => {
    const f = fixture(); f.files.delete('/work/a.ts'); f.detail.kind = 'deleted';
    await f.host.openToolFileActivity({ checkpointId: 'checkpoint', resource: { kind: 'file', path: 'a.ts', action: 'updated' } });
    assert.equal(f.host.contextFilePreview.error, 'missing'); assert.equal(f.host.contextFilePreview.beforeContent, undefined);
    assert.equal(f.host.activeCheckpointDiff, undefined);
    await f.host.openCheckpointDiffById('checkpoint');
    assert.equal(f.host.contextFilePreview.historicalMissing, true);
    assert.equal(f.host.contextFilePreview.beforeContent, f.detail.afterContent);
});

test('a link to a vanished cached file reports missing current bytes instead of reviving its old diff', async () => {
    const f = fixture(); f.cache(); f.files.delete('/work/a.ts'); await f.host.openContextFile(node('/work/a.ts').uri);
    assert.equal(f.host.contextFilePreview.error, 'missing'); assert.equal(f.host.contextFilePreview.beforeContent, undefined);
});

test('activity lookup cannot open its old file after the user switches conversations', async () => {
    const f = fixture(); const resolve = f.host.fileService.resolve;
    f.host.fileService.resolve = async uri => { f.host.activeCodingSessionId = 'another-session'; return resolve(uri); };
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined);
});


test('current checkpoint activity and explicit diff preserve the same line navigation', async () => {
    for (const explicitDiff of [false, true]) {
        const f = fixture(); Object.assign(f.detail, { startLine: 180, endLine: 184 });
        if (explicitDiff) await f.host.openCheckpointDiffById('checkpoint');
        else await f.host.openToolFileActivity({ checkpointId: 'checkpoint', resource: { kind: 'file', path: 'a.ts', action: 'updated', startLine: 180, endLine: 184 } });
        assert.deepEqual(f.host.contextFilePreview.revealRange, { startLine: 180, endLine: 184 });
        assert.equal(f.host.contextFilePreview.content, 'current on disk');
        assert.equal(f.host.contextFilePreview.beforeContent, explicitDiff ? 'historical before' : undefined);
    }
});

test('a user click on an external read opens current bytes as readonly without any agent permission RPC', async () => {
    for (const path of ['/other/a.ts', 'file:///other/a.ts']) {
        const f = fixture(); f.files.set('/other/a.ts', 'latest external content');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read', startLine: 8, endLine: 12 } });
        assert.equal(f.host.contextFilePreview.content, 'latest external content'); assert.equal(f.host.contextFilePreview.readOnly, true);
        assert.equal(f.host.contextFilePreview.beforeContent, undefined); assert.deepEqual(f.host.contextFilePreview.revealRange, { startLine: 8, endLine: 12 });
        assert.equal(f.host.contextFileTabs.get(node('/other/a.ts').uri).preview.readOnly, true);
        assert.deepEqual(f.checkpointReads, []);
    }
});

test('old relative read activities find the unique file across stored workspace roots', async () => {
    const f = fixture(); f.files.set('/other/copied-hash/baseline.txt', 'secondary current bytes');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'copied-hash/baseline.txt', action: 'read', startLine: 2, endLine: 4 } });
    assert.deepEqual(f.reads, ['/other/copied-hash/baseline.txt']);
    assert.equal(f.host.contextFilePreview.content, 'secondary current bytes');
    assert.equal(f.host.contextFilePreview.readOnly, true);
    assert.deepEqual(f.host.contextFilePreview.revealRange, { startLine: 2, endLine: 4 });
});

test('duplicate relative files prefer the active workspace even when it is not the first stored root', async () => {
    const f = fixture(); f.host.codingSessionStoredWorkspaceRoots = () => ['/other', '/work'];
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/work/a.ts']);
    assert.equal(f.host.contextFilePreview.content, 'current on disk');
    assert.deepEqual(f.notices, []);
});

test('missing relative files still report missing without opening another file', async () => {
    const f = fixture(); f.files.clear();
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined);
    assert.equal(f.notices.length, 1); assert.equal(f.notices[0][2], 'missing');
});

test('the active root exact path outranks files inside a nested stored root', async () => {
    const f = fixture(); f.files.set('/work/sub/a.ts', 'nested');
    f.host.codingSessionStoredWorkspaceRoots = () => ['/work/sub', '/work'];
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/work/a.ts']); assert.deepEqual(f.notices, []);
});

test('duplicate relative files fall back to the first existing match when the active workspace has none', async () => {
    const f = fixture(); f.files.delete('/work/a.ts'); f.files.set('/third/a.ts', 'third');
    f.host.codingSessionStoredWorkspaceRoots = () => ['/other', '/third', '/work'];
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/other/a.ts']); assert.deepEqual(f.notices, []);
});

test('duplicate branch files prefer the primary private root over the active secondary root', async () => {
    const f = fixture(); Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'parent', workspacePath: '/private/secondary' });
    f.host.codingSessionStoredWorkspaceRoots = () => ['/private/secondary', '/private/primary'];
    f.host.platformService.getConversationWorkspaceBindings = async () => ({ workspaces: [
        { workspaceRoot: '/private/primary' }, { workspaceRoot: '/private/secondary' }
    ] });
    f.files.set('/private/primary/a.ts', 'primary copy'); f.files.set('/private/secondary/a.ts', 'secondary copy');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/private/primary/a.ts']);
    assert.equal(f.host.contextFilePreview.content, 'primary copy'); assert.deepEqual(f.notices, []);
});

test('old relative branch reads recover secondary roots from the actual private layout', async () => {
    const f = fixture(); Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'parent', workspacePath: '' });
    f.host.codingSessionStoredWorkspaceRoots = () => ['/private/child/root'];
    f.host.platformService.getConversationWorkspaceBindings = async (id, existingOnly) => {
        assert.equal(id, 'session'); assert.equal(existingOnly, true);
        return { workspaceRoot: '/private/child/root', workspaces: [
            { sourceWorkspaceRoot: '/parent/root', workspaceRoot: '/private/child/root' },
            { sourceWorkspaceRoot: '/parent/external', workspaceRoot: '/private/child/external' }
        ] };
    };
    const path = 'd4749f32b165aa01c0543484/baseline.txt';
    f.files.set(`/private/child/external/${path}`, 'private secondary current');
    f.files.set(`/parent/external/${path}`, 'ancestor must stay closed');
    f.files.set(`/work/${path}`, 'unrelated active root must stay closed');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
    assert.deepEqual(f.reads, [`/private/child/external/${path}`]);
    assert.equal(f.host.contextFilePreview.content, 'private secondary current');
});

test('inherited relative bindings map to current copies before testing existence', async () => {
    for (const missing of [false, true]) {
        const f = fixture(); Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'parent', workspacePath: '' });
        f.host.codingSessionStoredWorkspaceRoots = () => ['/work'];
        f.host.platformService.getConversationWorkspaceBindings = async () => ({ workspaceRoot: '/private/child/root',
            workspaces: [{ sourceWorkspaceRoot: '/work', workspaceRoot: '/private/child/root' }] });
        if (!missing) f.files.set('/private/child/root/a.ts', 'private current');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
        assert.deepEqual(f.reads, ['/private/child/root/a.ts']);
        assert.equal(f.host.contextFilePreview.error, missing ? 'missing' : '');
    }
});

test('real Theia missing-file errors allow a private secondary root match', async t => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nextmux real file service ')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const primary = join(directory, 'roots', '0', 'project'), external = join(directory, 'external');
    const relative = 'd4749f32b165aa01c0543484/baseline.txt', target = join(external, relative);
    mkdirSync(primary, { recursive: true }); mkdirSync(join(external, relative.split('/')[0]), { recursive: true });
    writeFileSync(target, 'current private bytes');
    writeFileSync(join(directory, '.nextmux-fork-layout.json'), JSON.stringify({ version: 1, phase: 'complete', primary: 'roots/0/project',
        workspaces: [{ sourceWorkspaceRoot: join(directory, 'parent'), path: 'roots/0/project' }, { sourceWorkspaceRoot: '', path: 'external' }] }));
    const { readWorkspaceForkLayout } = require('../../agent-runtime/lib/workspace-fork.js');
    const { DiskFileSystemProvider } = require('@theia/filesystem/lib/node/disk-file-system-provider');
    // Execute the installed FileService's real error conversion and stat path.
    // Only its browser DI shell is omitted; disk/stat/error behavior is not mocked.
    const serviceSource = readFileSync(require.resolve('@theia/filesystem/lib/browser/file-service'), 'utf8');
    const serviceAst = ts.createSourceFile('file-service.js', serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let serviceClass;
    const visit = node => { if (ts.isClassExpression(node) && node.name?.text === 'FileService') serviceClass = node; ts.forEachChild(node, visit); };
    visit(serviceAst);
    const serviceMethods = ['resolve', 'doResolveFile', 'toFileStat'].map(name => serviceClass.members
        .find(node => ts.isMethodDeclaration(node) && node.name.getText(serviceAst) === name).getText(serviceAst));
    const Service = Function('files_1', 'ternary_search_tree_1', 'core_1', `return class Service { ${serviceMethods.join('\n')} }`)(fileErrors,
        require('@theia/core/lib/common/ternary-search-tree'), require('@theia/core/lib/common/nls'));
    const provider = new DiskFileSystemProvider(), service = new Service(), resolved = [];
    service.withProvider = async () => provider; service.resourceForError = uri => uri.toString(); service.logger = { error: assert.fail };
    const f = fixture(); Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'parent', workspacePath: '' });
    f.host.codingSessionStoredWorkspaceRoots = () => [primary, external];
    f.host.platformService.getConversationWorkspaceBindings = async () => readWorkspaceForkLayout(directory);
    f.host.fileService.resolve = async uri => { resolved.push(FileUri.fsPath(uri)); return service.resolve(uri); };
    f.host.fileService.read = async uri => {
        f.reads.push(FileUri.fsPath(uri)); return { value: (await provider.readFile(uri)).toString('utf8'), mtime: 2, etag: 'current' };
    };
    await assert.rejects(service.resolve(FileUri.create(join(primary, relative))), error =>
        error instanceof fileErrors.FileOperationError && error.fileOperationResult === 1 && /nonexistent/.test(error.message));
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: relative, action: 'read', startLine: 1, endLine: 2 } });
    assert.deepEqual(resolved.slice(0, 2), [join(primary, relative), target]);
    assert.deepEqual(f.reads, [target]); assert.equal(f.host.contextFilePreview.content, 'current private bytes');
    assert.equal(f.host.contextFilePreview.readOnly, true); assert.deepEqual(f.notices, []);
    rmSync(target); f.host.contextFilePreview = undefined; f.host.contextFileTabs.clear(); f.reads.length = 0;
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: relative, action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.notices.at(-1)[2], 'missing');
});

test('typed permission and availability errors never become a missing-root fallback', async () => {
    for (const code of [6, 11]) {
        const f = fixture(), resolved = [];
        f.host.fileService.resolve = async uri => { resolved.push(uri.toString()); throw new fileErrors.FileOperationError('not found appears in this path', code); };
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
        assert.equal(resolved.length, 1); assert.deepEqual(f.reads, []); assert.equal(f.notices.at(-1)[2], 'unavailable');
        const legacy = legacyBranchFixture();
        legacy.host.fileService.resolve = f.host.fileService.resolve;
        await assert.rejects(legacy.host.resolveToolReadBranchUri(legacy.session, FileUri.create('/outside/new.txt'), '/outside/new.txt'),
            error => error instanceof fileErrors.FileOperationError && error.fileOperationResult === code);
    }
});

test('current file resources preserve real directory and filename spaces', async t => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nextmux current  spaces ')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'file  name.txt '); writeFileSync(path, 'real current bytes');
    const f = fixture(); f.host.fileService.resolve = async uri => ({ resource: uri, isDirectory: statSync(uri.path.fsPath()).isDirectory() });
    f.host.fileService.read = async uri => { f.reads.push(uri.path.fsPath()); return { value: readFileSync(uri.path.fsPath(), 'utf8'), mtime: 2, etag: 'current' }; };
    await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
    assert.deepEqual(f.reads, [path]); assert.equal(f.host.contextFilePreview.content, 'real current bytes');
});

test('POSIX backslash filenames do not open a different slash-separated file', { skip: process.platform === 'win32' }, async t => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nextmux-file-separators-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, 'a'));
    const backslash = join(directory, 'a\\b.txt'), slash = join(directory, 'a', 'b.txt');
    writeFileSync(backslash, 'literal backslash'); writeFileSync(slash, 'slash-separated decoy');
    const f = fixture(); f.session.workspacePath = directory; f.host.activeWorkspaceRoot = directory;
    f.host.codingSessionStoredWorkspaceRoots = () => [directory];
    // Match DiskFileSystemProvider, rather than the separator-normalizing Theia Path abstraction.
    f.host.fileService.resolve = async uri => ({ resource: uri, isDirectory: statSync(FileUri.fsPath(uri)).isDirectory() });
    f.host.fileService.read = async uri => { f.reads.push(FileUri.fsPath(uri)); return { value: readFileSync(FileUri.fsPath(uri), 'utf8'), mtime: 2, etag: 'current' }; };
    for (const path of [backslash, 'a\\b.txt']) {
        await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
        assert.equal(f.host.contextFilePreview.content, 'literal backslash');
        assert.equal(f.host.contextFilePreview.path, backslash); assert.equal(f.host.contextFilePreview.name, 'a\\b.txt');
    }
    assert.deepEqual(f.reads, [backslash, backslash]);
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a/b.txt', action: 'read' } });
    assert.equal(f.host.contextFilePreview.content, 'slash-separated decoy');
    f.detail.path = 'a\\b.txt';
    for (const externalTarget of [undefined, backslash]) {
        f.detail.externalTarget = externalTarget;
        await f.host.openCheckpointDiffById('checkpoint', 'current');
        assert.equal(f.host.contextFilePreview.content, 'literal backslash');
        assert.equal(f.host.contextFilePreview.path, backslash);
        assert.equal(f.host.contextFilePreview.name, 'a\\b.txt');
    }
});

test('relative Windows separators follow each existing binding and cannot traverse outside it', async () => {
    for (const root of ['C:\\Work', '\\\\server\\share']) {
        const f = fixture(); f.session.workspacePath = root; f.host.activeWorkspaceRoot = root;
        f.host.codingSessionStoredWorkspaceRoots = () => [root];
        const expected = URI.fromFilePath(root.replace(/\\/g, '/')).resolve('a/b.txt');
        f.files.set(expected.path.fsPath(), 'Windows bound file');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a\\b.txt', action: 'read' } });
        assert.deepEqual(f.reads, [expected.path.fsPath()]); assert.equal(f.host.contextFilePreview.content, 'Windows bound file');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: '..\\outside.txt', action: 'read' } });
        assert.equal(f.reads.length, 1); assert.equal(f.notices.length, 1);
    }
});

test('switching conversations during multi-root lookup cannot open the old target', async () => {
    const f = fixture(); f.host.fileService.resolve = async () => { f.host.activeCodingSessionId = 'another-session'; return { isDirectory: false }; };
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: 'a.ts', action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined); assert.deepEqual(f.notices, []);
});

test('command, network, data, relative file URI and malformed imported paths never reach the file reader', async () => {
    for (const path of ['command:workbench.action.openSettings', 'https://server/a.ts', 'data:text/plain,secret', 'file:relative.ts',
        'file://unbound-server/share/a.ts', '//unbound-server/share/a.ts', 'file:///other/a.ts?command=run', 'file:///other/a.ts#run',
        'file:///other/%00.ts', '../other/a.ts', '/other/a\0.ts']) {
        const f = fixture(); await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
        assert.deepEqual(f.reads, [], path); assert.equal(f.host.contextFilePreview, undefined, path); assert.equal(f.notices.length, 1, path);
    }
});

test('UNC file reads retain support only under an existing workspace binding', async () => {
    const f = fixture(); f.host.codingSessionStoredWorkspaceRoots = () => ['//bound-server/share']; f.files.set('/share/a.ts', 'bound UNC content');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '//bound-server/share/a.ts', action: 'read' } });
    assert.equal(f.host.contextFilePreview.uri, 'file://bound-server/share/a.ts'); assert.equal(f.host.contextFilePreview.readOnly, true);
    assert.equal(f.host.contextFilePreview.content, 'bound UNC content');
});

test('inherited absolute activity paths resolve to the current private copy, including missing current files', async () => {
    for (const missing of [false, true]) {
        const f = fixture(); f.session.ownedWorkspace = true; f.session.sourceConversationId = 'origin';
        f.host.platformService.getConversationWorkspaceBindings = async () => ({ workspaceRoot: '/private/branch',
            workspaces: [{ sourceWorkspaceRoot: '/work', workspaceRoot: '/private/branch' }] });
        if (!missing) f.files.set('/private/branch/a.ts', 'branch current content');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
        assert.deepEqual(f.reads, ['/private/branch/a.ts']); assert.equal(f.host.contextFilePreview.uri, 'file:///private/branch/a.ts');
        assert.equal(f.host.contextFilePreview.content, missing ? '' : 'branch current content');
        assert.equal(f.host.contextFilePreview.error, missing ? 'missing' : '');
    }
});

test('an unavailable private mapping or conversation switch never opens the old source path', async () => {
    for (const fail of [true, false]) {
        const f = fixture(); f.session.ownedWorkspace = true; f.session.sourceConversationId = 'origin';
        f.host.platformService.getConversationWorkspaceBindings = async () => {
            if (fail) throw new Error('mapping unavailable'); f.host.activeCodingSessionId = 'different';
            return { workspaceRoot: '/private/branch', workspaces: [{ sourceWorkspaceRoot: '/work', workspaceRoot: '/private/branch' }] };
        };
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
        assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined);
    }
});

test('reopening an external read keeps an existing unsaved draft and never grants editing', async () => {
    const f = fixture(); f.cache({ path: '/other/a.ts', current: 'unsaved draft', dirty: true });
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/other/a.ts', action: 'read' } });
    assert.equal(f.host.contextFileDrafts.current, 'unsaved draft'); assert.equal(f.host.contextFileDirty, true);
    assert.equal(f.host.contextFilePreview.readOnly, true); assert.deepEqual(f.reads, []);
});

function legacyBranchFixture() {
    const f = fixture(), layouts = new Map(), parents = new Map(), directories = new Set(), historyReads = [];
    Object.assign(f.session, { ownedWorkspace: true, workspacePath: '', sourceConversationId: 'branch-b' });
    for (const [id, parent, root, sourceRoot, external, externalSource] of [
        ['session', 'branch-b', '/private/c/root', '/private/b/root', '/private/c/copied-external', '/private/b/copied-external'],
        ['branch-b', 'branch-a', '/private/b/root', '/private/a/root', '/private/b/copied-external', '/private/a/external'],
        ['branch-a', 'origin', '/private/a/root', '/work', '/private/a/external', '']
    ]) {
        parents.set(id, { id, ownedWorkspace: true, sourceConversationId: parent, workspacePath: '', turns: [] });
        layouts.set(id, { workspaceRoot: root, workspaces: [{ sourceWorkspaceRoot: sourceRoot, workspaceRoot: root },
            { sourceWorkspaceRoot: externalSource, workspaceRoot: external }] });
    }
    parents.set('origin', { id: 'origin', workspacePath: '/work', ownedWorkspace: false, turns: [] });
    f.host.codingSessionStoredWorkspaceRoots = session => session.workspacePath ? [session.workspacePath] : [];
    f.host.platformService.getConversationWorkspaceBindings = async (id, existingOnly) => {
        assert.equal(existingOnly, true, 'viewing old activities cannot allocate a missing private directory');
        if (!layouts.has(id)) throw new Error('unavailable layout'); return layouts.get(id);
    };
    f.host.platformService.readConversationHistorySession = async id => { historyReads.push(id); return parents.get(id); };
    const resolve = f.host.fileService.resolve;
    f.host.fileService.resolve = async uri => directories.has(uri.path.fsPath())
        ? { resource: uri, isDirectory: true } : resolve(uri);
    return { ...f, layouts, parents, directories, historyReads };
}

test('three-generation legacy read paths map from the original project to current private bytes', async () => {
    const f = legacyBranchFixture(); f.files.set('/private/c/root/a.ts', 'third branch content');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/private/c/root/a.ts']); assert.equal(f.host.contextFilePreview.content, 'third branch content');
    assert.deepEqual(f.historyReads, ['branch-b', 'branch-a', 'origin']);
});

test('legacy external copies use the exact source-path hash through three generations, even after deleting the private file', async () => {
    for (const source of ['/outside/a.ts', 'C:\\Outside\\A.ts']) for (const missing of [false, true]) {
        const f = legacyBranchFixture(), hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
        const name = source.includes('\\') ? 'A.ts' : 'a.ts', target = `/private/c/copied-external/${hash}/${name}`;
        f.directories.add(`/private/a/external/${hash}`);
        f.directories.add(`/private/c/copied-external/${hash}`);
        f.files.set(node(source.replace(/\\/g, '/')).path, 'original source must not open');
        if (!missing) f.files.set(target, 'third private external content');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: source, action: 'read' } });
        assert.deepEqual(f.reads, [target]); assert.equal(f.host.contextFilePreview.uri, node(target).uri);
        assert.equal(f.host.contextFilePreview.content, missing ? '' : 'third private external content');
        assert.equal(f.host.contextFilePreview.error, missing ? 'missing' : '');
    }
});

test('current external copies remain authoritative after ancestor hash directories are deleted', async () => {
    for (const missing of [false, true]) {
        const f = legacyBranchFixture(), source = '/outside/a.ts', hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
        const target = `/private/c/copied-external/${hash}/a.ts`;
        f.directories.add(`/private/c/copied-external/${hash}`); // No A or B hash directory remains.
        f.files.set(source, 'original source must not open');
        if (!missing) f.files.set(target, 'surviving current copy');
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: source, action: 'read' } });
        assert.deepEqual(f.reads, [target]); assert.equal(f.host.contextFilePreview.uri, node(target).uri);
        assert.equal(f.host.contextFilePreview.content, missing ? '' : 'surviving current copy');
        assert.equal(f.host.contextFilePreview.error, missing ? 'missing' : '');
    }
});

test('an older external copy prevents a source fallback when the current hash directory is gone', async () => {
    const f = legacyBranchFixture(), source = '/outside/a.ts', hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
    f.directories.add(`/private/a/external/${hash}`); f.files.set(source, 'original must not open');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: source, action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.notices[0][2], 'restoreWorkspaceMissing');
});

test('Windows current paths and bound UNC shares compare without case, while POSIX roots keep case', async () => {
    const f = fixture(), path = 'c:/PRIVATE/current/a.ts'; Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'deleted-parent' });
    f.files.set(URI.fromFilePath(path).path.fsPath(), 'current Windows copy');
    f.host.platformService.getConversationWorkspaceBindings = async () => ({ workspaceRoot: 'C:\\Private\\Current',
        workspaces: [{ sourceWorkspaceRoot: 'C:\\Private\\Parent', workspaceRoot: 'C:\\Private\\Current' }] });
    f.host.platformService.readConversationHistorySession = async () => assert.fail('current private path needs no deleted parent');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path, action: 'read' } });
    assert.equal(f.host.contextFilePreview.content, 'current Windows copy');
    assert.equal(f.host.fileActivityRootContains('/private/Case', new URI('file:///private/case/a.ts')), false);
    const unc = fixture(); unc.host.codingSessionStoredWorkspaceRoots = () => ['\\\\SERVER\\Share'];
    unc.files.set('/share/a.ts', 'bound UNC');
    await unc.host.openToolFileActivity({ resource: { kind: 'file', path: 'file://server/share/a.ts', action: 'read' } });
    assert.equal(unc.host.contextFilePreview.content, 'bound UNC'); assert.equal(unc.host.contextFilePreview.readOnly, true);
});

test('external copies first captured in a later generation are not hidden by an earlier unrelated external root', async () => {
    const f = legacyBranchFixture(), source = '/outside/a.ts', hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
    f.layouts.get('branch-b').workspaces.push({ sourceWorkspaceRoot: '', workspaceRoot: '/private/b/external' });
    f.layouts.get('session').workspaces.push({ sourceWorkspaceRoot: '/private/b/external', workspaceRoot: '/private/c/later-external' });
    const target = `/private/c/later-external/${hash}/a.ts`;
    f.directories.add(`/private/c/later-external/${hash}`); f.files.set(target, 'later generation copy');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: source, action: 'read' } });
    assert.deepEqual(f.reads, [target]); assert.equal(f.host.contextFilePreview.content, 'later generation copy');
});

test('a genuinely new external read remains a readonly viewer request when no generation copied it', async () => {
    const f = legacyBranchFixture(); f.files.set('/new-external/a.ts', 'new external content');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/new-external/a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/new-external/a.ts']); assert.equal(f.host.contextFilePreview.content, 'new external content');
    assert.equal(f.host.contextFilePreview.readOnly, true);
});

test('ordinary projectless external reads do not require or create a branch layout', async () => {
    const f = fixture(); f.session.ownedWorkspace = true;
    f.host.platformService.getConversationWorkspaceBindings = async () => assert.fail('viewer must not allocate a workspace');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/other/a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/other/a.ts']); assert.equal(f.host.contextFilePreview.readOnly, true);
});

test('a missing parent or incomplete layout never silently opens known ancestor bytes', async () => {
    for (const absent of ['parent', 'layout']) {
        const f = legacyBranchFixture();
        if (absent === 'parent') f.parents.delete('branch-b');
        else f.layouts.set('branch-b', { workspaceRoot: '/private/b', workspaces: [{ sourceWorkspaceRoot: '', workspaceRoot: '/private/b' }] });
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
        assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined);
        assert.equal(f.notices[0][2], 'restoreWorkspaceMissing');
    }
});

test('an already mapped private path still opens when its parent conversation was deleted', async () => {
    const f = legacyBranchFixture(); f.parents.delete('branch-b'); f.files.set('/private/c/root/a.ts', 'current private');
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/private/b/root/a.ts', action: 'read' } });
    assert.deepEqual(f.reads, ['/private/c/root/a.ts']); assert.deepEqual(f.historyReads, []);
});

test('cyclic ancestry and switching conversations during ancestor hydration stop the old file open', async () => {
    for (const cycle of [true, false]) {
        const f = legacyBranchFixture();
        if (cycle) f.parents.get('branch-a').sourceConversationId = 'session';
        else f.host.platformService.readConversationHistorySession = async id => { f.host.activeCodingSessionId = 'different'; return f.parents.get(id); };
        await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
        assert.deepEqual(f.reads, []); assert.equal(f.host.contextFilePreview, undefined);
    }
});

test('known ancestor roots without a complete copy mapping never fall back to the original file', async () => {
    const f = legacyBranchFixture(); f.layouts.get('branch-a').workspaces[0].sourceWorkspaceRoot = '/different-project';
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
    assert.deepEqual(f.reads, []); assert.equal(f.notices[0][2], 'restoreWorkspaceMissing');
});

test('ancestry lookup is bounded to 32 tasks and cannot open the source beyond that boundary', async () => {
    const f = fixture(); Object.assign(f.session, { ownedWorkspace: true, sourceConversationId: 'ancestor-0' });
    let lookups = 0;
    f.host.platformService.readConversationHistorySession = async id => { lookups++; const index = Number(id.split('-')[1]);
        return { id, sourceConversationId: `ancestor-${index + 1}`, ownedWorkspace: true, workspacePath: '', turns: [] }; };
    f.host.platformService.getConversationWorkspaceBindings = async id => {
        const index = id === 'session' ? -1 : Number(id.split('-')[1]);
        return { workspaceRoot: `/chain/${index}`, workspaces: [{ sourceWorkspaceRoot: `/chain/${index + 1}`, workspaceRoot: `/chain/${index}` }] };
    };
    await f.host.openToolFileActivity({ resource: { kind: 'file', path: '/work/a.ts', action: 'read' } });
    assert.equal(lookups, 31); assert.deepEqual(f.reads, []); assert.equal(f.notices[0][2], 'restoreWorkspaceMissing');
});
