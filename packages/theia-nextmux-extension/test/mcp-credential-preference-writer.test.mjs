import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { writeMcpCredentialPreference } from '../lib/browser/nextmux-mcp-credential-preference-writer.js';
import { saveMcpCredentialSettings } from '../lib/browser/nextmux-mcp-credential-settings.js';
import { MCP_SERVERS_PREF } from '@theia/ai-mcp/lib/common/mcp-preferences.js';
import { guardMcpPreferenceSave, isMcpPreferenceSaveGuarded } from '../lib/browser/nextmux-mcp-preference-save-guard.js';
const require = createRequire(import.meta.url);
const preferenceRequire = createRequire(require.resolve('@theia/preferences/package.json'));
const jsonc = preferenceRequire('jsonc-parser');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;

// Execute the installed JSONC editor and shared-model edit methods, with no browser or user files.
const editorSource = await readFile(preferenceRequire.resolve('@theia/preferences/src/browser/monaco-jsonc-editor.ts'), 'utf8');
const exported = {};
Function('require', 'exports', compile(editorSource))(name => name === 'jsonc-parser' ? jsonc : name.includes('inversify')
    ? { injectable: () => value => value, inject: () => () => {} } : name === '@theia/monaco-editor-core'
        ? { editor: { DefaultEndOfLine: { LF: 1 } }, Range: { fromPositions: (start, end) => ({ start, end }) } } : { MonacoWorkspace: class {} }, exported);
const workspaceSource = await readFile(require.resolve('@theia/monaco/src/browser/monaco-workspace.ts'), 'utf8');
const ast = ts.createSourceFile('workspace.ts', workspaceSource, ts.ScriptTarget.Latest, true);
const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && ['applyBackgroundEdit', 'suppressOpenIfDirty'].includes(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, 2);
const Workspace = Function('MonacoEditor', `${compile(`class Workspace { suppressedOpenIfDirty = []; editorManager = {}; ${methods.join('\n')} }`)}; return Workspace;`)({ findByDocument: () => [] });
const ref = { id: '11111111-1111-4111-8111-111111111111', revision: '22222222-2222-4222-8222-222222222222', kind: 'bearer' };
const change = { serverName: 'fixture', fingerprint: 'test', action: 'set', kind: 'bearer', value: 'transient-only' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
    let content = `// Keep this user comment\n${JSON.stringify({ [MCP_SERVERS_PREF]: { fixture: { serverUrl: 'https://fixture.invalid/mcp', autostart: false }, other: { command: 'original' } }, 'editor.fontSize': 14 }, null, 2)}`;
    let effective = jsonc.parse(content)[MCP_SERVERS_PREF]; let writes = 0; let edits = 0; let disposed = 0;
    const listeners = new Set();
    const model = {
        dirty: false, readOnly: false, valid: true,
        getText: () => content, sync: async () => {},
        save: async () => { writes++; effective = jsonc.parse(content)[MCP_SERVERS_PREF]; model.dirty = false; for (const listener of listeners) listener({ preferenceName: MCP_SERVERS_PREF }); },
        textEditorModel: {
            getOptions: () => ({ insertSpaces: true, tabSize: 2, defaultEOL: 1 }), getPositionAt: offset => ({ lineNumber: 1, column: offset + 1 }), pushStackElement() {},
            pushEditOperations(_cursor, operations) { edits++; content = jsonc.applyEdits(content, operations.map(op => ({ offset: op.range.start.column - 1, length: op.range.end.column - op.range.start.column, content: op.text || '' }))); model.dirty = true; }
        }
    };
    const editor = new exported.MonacoJSONCEditor(); editor.workspace = new Workspace();
    const ports = { preferences: { getConfigUri: () => ({ toString: () => 'userstorage:/user/settings.json' }), get: () => effective,
        onPreferenceChanged: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } },
        models: { createModelReference: async () => ({ object: model, dispose: () => { disposed++; } }) }, editor };
    const settings = { readUser: () => effective, readEffective: () => effective, change: async () => ({ credential: ref, servers: [] }),
        writeCredential: (name, expected, value) => writeMcpCredentialPreference(name, expected, value, ports) };
    return { model, ports, settings, content: () => content, value: () => jsonc.parse(content), counts: () => ({ writes, edits, disposed }),
        editUser(path, value, reflect = true) { content = jsonc.applyEdits(content, jsonc.modify(content, path, value, {})); if (reflect) effective = jsonc.parse(content)[MCP_SERVERS_PREF]; } };
}

test('installed JSONC per-path editor preserves comments and another server changed while actual model acquisition waits', async () => {
    const f = fixture(); const entered = deferred(); const wait = deferred(); const open = f.ports.models.createModelReference;
    f.ports.models.createModelReference = async () => { entered.resolve(); await wait.promise; return open(); };
    const saving = saveMcpCredentialSettings(change, f.settings); await entered.promise;
    f.editUser([MCP_SERVERS_PREF, 'other', 'command'], 'new user edit'); f.editUser(['editor.fontSize'], 18);
    wait.resolve(); await saving;
    assert.equal(f.value()[MCP_SERVERS_PREF].other.command, 'new user edit'); assert.equal(f.value()['editor.fontSize'], 18);
    assert.deepEqual(f.value()[MCP_SERVERS_PREF].fixture.nextmuxCredential, ref);
    assert.match(f.content(), /^\/\/ Keep this user comment/); assert.doesNotMatch(f.content(), /transient-only/);
    assert.deepEqual(f.counts(), { writes: 1, edits: 1, disposed: 1 });
});

test('own server edit or deletion during model acquisition rejects before edits/write, including unchanged stale preference cache', async () => {
    for (const value of [undefined, { serverUrl: 'https://user-edit.invalid/mcp' }]) {
        const f = fixture(); const wait = deferred(); const entered = deferred(); const open = f.ports.models.createModelReference;
        f.ports.models.createModelReference = async () => { entered.resolve(); await wait.promise; return open(); };
        const saving = saveMcpCredentialSettings(change, f.settings).catch(error => error); await entered.promise;
        f.editUser([MCP_SERVERS_PREF, 'fixture'], value, false); wait.resolve();
        assert.match((await saving).message, /MCP_CONFIGURATION_CHANGED/);
        assert.deepEqual(f.value()[MCP_SERVERS_PREF].fixture, value); assert.deepEqual(f.counts(), { writes: 0, edits: 0, disposed: 1 });
    }
});

test('dirty model, invalid document and save conflict refuse success and release the save guard', async () => {
    for (const kind of ['dirty', 'readonly', 'invalid', 'conflict']) {
        const f = fixture();
        if (kind === 'dirty') f.model.dirty = true;
        if (kind === 'readonly') f.model.readOnly = true;
        if (kind === 'invalid') f.model.valid = false;
        if (kind === 'conflict') f.model.save = async () => { /* Existing resource version rejected a conflicting disk write. */ };
        await assert.rejects(saveMcpCredentialSettings(change, f.settings), /MCP_CONFIGURATION_BUSY|MCP_CONFIGURATION_SAVE_FAILED/);
        assert.equal(f.counts().writes, 0); assert.equal(f.counts().edits, kind === 'conflict' ? 1 : 0);
        assert.equal(f.counts().disposed, 1);
        assert.equal(isMcpPreferenceSaveGuarded('userstorage:/user/settings.json'), false);
    }
});

test('installed Resource.save full-write fallback refuses a conflict with no native dialog only inside the exact credential-save scope', async () => {
    const fsRequire = createRequire(require.resolve('@theia/filesystem/package.json'));
    const resourceApi = require('@theia/core/lib/common/resource.js');
    const fileEnums = {};
    const filesAst = ts.createSourceFile('files.ts', await readFile(fsRequire.resolve('@theia/filesystem/src/common/files.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const enums = filesAst.statements.filter(node => ts.isEnumDeclaration(node) && ['FileOperation', 'FileOperationResult', 'FileSystemProviderCapabilities'].includes(node.name.text));
    assert.equal(enums.length, 3);
    Function('exports', compile(enums.map(node => node.getText(filesAst)).join('\n')))(fileEnums);
    const files = { ...fsRequire('@theia/filesystem/lib/common/files.js'), ...fileEnums };
    const installed = await readFile(fsRequire.resolve('@theia/filesystem/src/browser/file-resource.ts'), 'utf8');
    let dialogs = 0; let updates = 0; let writes = 0;
    const installedExports = {};
    Function('require', 'exports', compile(installed))(name => {
        if (name === '../common/files') return files;
        if (name === '../common/filesystem-preferences') return { GENERAL_MAX_FILE_SIZE_MB: 512 };
        if (name === './file-service') return { FileService: class {}, TextFileOperationError: class {} };
        if (name.includes('/dialogs')) return { ConfirmDialog: class { async open() { dialogs++; return false; } }, Dialog: { YES: 'yes', NO: 'no' } };
        if (name.includes('/label-provider')) return { LabelProvider: class {} };
        if (name.includes('/frontend-application-state')) return { FrontendApplicationStateService: class {} };
        if (name === '@theia/core') return { nls: { localize: () => 'conflict' } };
        return fsRequire(name);
    }, installedExports);
    const resolverExports = {};
    Function('require', 'exports', compile(await readFile(new URL('../src/browser/nextmux-mcp-preference-resource-resolver.ts', import.meta.url), 'utf8')))(name => {
        if (name.includes('/file-resource')) return installedExports;
        if (name === './nextmux-mcp-preference-save-guard') return { isMcpPreferenceSaveGuarded };
        return require(name);
    }, resolverExports);
    const noEvent = () => ({ dispose() {} });
    const conflict = () => { throw new files.FileOperationError('synthetic external edit', files.FileOperationResult.FILE_MODIFIED_SINCE); };
    const service = { onDidFilesChange: noEvent, onDidRunOperation: noEvent, watch: noEvent,
        onDidChangeFileSystemProviderCapabilities: noEvent, onDidChangeFileSystemProviderReadOnlyMessage: noEvent,
        hasCapability: (_uri, capability) => capability === files.FileSystemProviderCapabilities.Update,
        async update() { updates++; return conflict(); }, async write(_uri, _content, options) { writes++; assert.notEqual(options.etag, files.ETAG_DISABLED); return conflict(); } };
    const resolver = new resolverExports.NextMuxMcpPreferenceResourceResolver();
    resolver.labelProvider = { getName: () => 'settings.json', getLongName: () => 'settings.json' };
    const uri = { scheme: 'userstorage', toString: () => 'userstorage:/user/settings.json' };
    const resource = new installedExports.FileResource(uri, service, { readOnly: false, shouldOverwrite: () => resolver.shouldOverwrite(uri), shouldOpenAsText: async () => false });
    const version = { encoding: 'utf8', etag: 'original-version', mtime: 1 };
    const save = () => resourceApi.Resource.save(resource, { content: 'x'.repeat(1000), contentLength: 1000, changes: [{ text: 'ref' }], options: { version } });
    const first = guardMcpPreferenceSave(uri.toString()); const nested = guardMcpPreferenceSave(uri.toString());
    try {
        await assert.rejects(save(), error => resourceApi.ResourceError.OutOfSync.is(error));
        first(); first(); assert.equal(isMcpPreferenceSaveGuarded(uri.toString()), true);
        await assert.rejects(save(), error => resourceApi.ResourceError.OutOfSync.is(error));
        assert.equal(dialogs, 0); assert.equal(updates, 2); assert.equal(writes, 2); // Actual incremental -> full fallback.
        await resolver.shouldOverwrite({ toString: () => 'file:///unrelated-user-file.txt' });
        assert.equal(dialogs, 1); // Ordinary user-file protection remains unchanged.
    } finally { first(); nested(); resource.dispose(); }
    assert.equal(isMcpPreferenceSaveGuarded(uri.toString()), false);
    await assert.rejects(save(), error => resourceApi.ResourceError.OutOfSync.is(error));
    assert.equal(dialogs, 2); // Outside this scope the original user-controlled conflict dialog remains.
    const frontend = await readFile(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');
    assert.match(frontend, /rebind\(FileResourceResolver\)[\s\S]*?\.to\(NextMuxMcpPreferenceResourceResolver\)/);
});

test('changes after the synchronous JSONC edit are never restored from the old whole-map snapshot', async () => {
    const f = fixture(); const wait = deferred(); const entered = deferred();
    const save = f.model.save; f.model.save = async () => { entered.resolve(); await wait.promise; return save(); };
    const saving = saveMcpCredentialSettings(change, f.settings).catch(error => error); await entered.promise;
    f.editUser([MCP_SERVERS_PREF, 'fixture', 'serverUrl'], 'https://later-edit.invalid/mcp');
    f.editUser([MCP_SERVERS_PREF, 'other', 'command'], 'later other'); wait.resolve();
    assert.match((await saving).message, /MCP_CONFIGURATION_SAVE_FAILED/);
    assert.equal(f.value()[MCP_SERVERS_PREF].fixture.serverUrl, 'https://later-edit.invalid/mcp');
    assert.equal(f.value()[MCP_SERVERS_PREF].other.command, 'later other'); assert.equal(f.counts().edits, 1);
});
