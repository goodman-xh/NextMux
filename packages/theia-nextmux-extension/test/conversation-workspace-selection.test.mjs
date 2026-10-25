import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';

const require = createRequire(import.meta.url);
const { resolveAgentWorkspaces } = require('../lib/node/nextmux-agent-workspaces');
const { MultiWorkspaceToolRuntime, AgentToolRegistry } = require('@nextmux/agent-runtime');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => klass.members.find(node => node.name?.getText(file) === name).getText(file);
const normalizer = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeCodingWorkspaceBindings').getText(file);
const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const serviceFile = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
const serviceClass = serviceFile.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(serviceFile) === 'validateConversationWorkspaceBindings'));
const serviceMethod = name => serviceClass.members.find(node => node.name?.getText(serviceFile) === name).getText(serviceFile);
const transpile = code => ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React });
const Validator = new Function('resolveAgentWorkspaces', transpile(`class Validator { ${serviceMethod('validateConversationWorkspaceBindings')} }; return Validator;`))(resolveAgentWorkspaces);
const normalize = new Function(transpile(`${normalizer}; return normalizeCodingWorkspaceBindings;`))();
const URI = { fromFilePath: path => ({ path: { fsPath: () => path } }) };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t) {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-conversation-directories-')));
    const a = join(base, 'a'), b = join(base, 'b'); await mkdir(a); await mkdir(b);
    t.after(() => rm(base, { recursive: true, force: true }));
    const Harness = new Function('URI', 'desktopFailureMessage', 'localizeDesktopSurface', transpile(`class Harness {
        ${['conversationWorkspaceBindings', 'conversationDirectoryMutationBlocked', 'openConversationDirectories',
            'chooseConversationWorkspaceDirectory', 'unlinkConversationWorkspaceDirectory', 'ensureCodingSessionWorkspace'].map(method).join('\n')}
    }; return Harness;`))(URI, (_locale, error) => error.message, localizeDesktopSurface);
    const state = new Harness(), validator = new Validator();
    const sourceSession = { id: 'owner', title: 'QA', workspacePath: a, workspaceBindings: [{ id: 'a', path: a, kind: 'project', status: 'available', permission: 'full_access' }],
        permissionMode: 'full_access', turns: [], updatedAt: 1, draftPrompt: 'KEEP_OWNER_DRAFT' };
    const other = { id: 'other', workspacePath: b, turns: [], draftPrompt: 'KEEP_OTHER_DRAFT' };
    let persisted = 0, validationCalls = 0;
    Object.assign(state, { desktopLocale: 'zh-CN', codingSessions: [sourceSession, other], activeCodingSessionId: 'owner', conversationDirectoriesSessionId: 'owner',
        conversationDirectoriesBusy: false, conversationDirectoriesError: '', codingPopover: 'directories',
        applicationExitPreparing: false, restoringCheckpointId: '', turnEditSubmitting: false, scheduledAgentRuns: new Map(),
        activeAgentSessionId: '', agentStage: 'idle', activeAgentRunId: '', agentStopping: false, defaultPermissionMode: 'read_only',
        conversationHasActiveRun(id) { return this.activeAgentSessionId === id && Boolean(this.activeAgentRunId || this.agentStage === 'running' || this.agentStopping); },
        update() {}, activeCodingSession() { return this.codingSessions.find(session => session.id === this.activeCodingSessionId); },
        persistCodingSessions() { persisted++; }, persistDesktopRestoreState() {}, verifyCodingProjectPath: async () => true,
        fileDialogService: { showOpenDialog: async () => URI.fromFilePath(b) },
        fileService: { resolve: async uri => ({ isDirectory: (await stat(uri.path.fsPath())).isDirectory() }) },
        platformService: { validateConversationWorkspaceBindings: async (...args) => { validationCalls++; return validator.validateConversationWorkspaceBindings(...args); } },
    });
    return { state, validator, base, a, b, sourceSession, other, persisted: () => persisted, validationCalls: () => validationCalls };
}

test('native-picker selection persists only the owning conversation binding without changing primary, global roots, permissions or drafts', async t => {
    const f = await fixture(t);
    f.state.workspaceOptions = [{ path: f.a }, { path: join(f.base, 'unrelated-global-root') }];
    await f.state.chooseConversationWorkspaceDirectory();
    const result = f.state.activeCodingSession();
    assert.equal(result.workspacePath, f.a); assert.equal(result.workspaceBindings.length, 2);
    assert.equal(result.workspaceBindings[1].path, f.b); assert.equal(result.workspaceBindings[1].kind, 'selected');
    assert.equal(result.workspaceBindings[1].permission, 'full_access'); assert.equal(result.workspaceBindings[0].permission, 'full_access');
    assert.equal(f.state.defaultPermissionMode, 'read_only'); assert.equal(result.draftPrompt, 'KEEP_OWNER_DRAFT');
    assert.equal(f.state.codingSessions[1], f.other); assert.equal(f.other.draftPrompt, 'KEEP_OTHER_DRAFT');
    assert.equal(f.state.workspaceOptions.length, 2); assert.equal(f.persisted(), 1);
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(result.workspaceBindings))), result.workspaceBindings);
});

test('read-only additions remain read-only and canonical duplicates, missing paths and files do not change bindings', async t => {
    const f = await fixture(t), alias = join(f.base, 'alias-a'), regular = join(f.base, 'file');
    await symlink(f.a, alias); await writeFile(regular, 'fixture');
    f.sourceSession.permissionMode = 'read_only'; f.sourceSession.workspaceBindings[0].permission = 'read_only';
    for (const path of [f.a, alias, join(f.base, 'missing'), regular]) {
        f.state.fileDialogService.showOpenDialog = async () => URI.fromFilePath(path);
        await f.state.chooseConversationWorkspaceDirectory();
        assert.equal(f.state.activeCodingSession().workspaceBindings.length, 1);
        assert.ok(f.state.conversationDirectoriesError); assert.equal(f.persisted(), 0);
    }
    f.state.fileDialogService.showOpenDialog = async () => URI.fromFilePath(f.b);
    await f.state.chooseConversationWorkspaceDirectory();
    assert.equal(f.state.activeCodingSession().workspaceBindings[1].permission, 'read_only');
});

test('cancelled picker and picker/RPC completion after navigation, permission change or run start cannot change a conversation', async t => {
    for (const change of ['cancel', 'navigate', 'run', 'permission', 'rpc-run']) {
        const f = await fixture(t), selected = deferred();
        f.state.fileDialogService.showOpenDialog = () => selected.promise;
        let validated;
        if (change === 'rpc-run') f.state.platformService.validateConversationWorkspaceBindings = async (...args) => {
            validated = await f.validator.validateConversationWorkspaceBindings(...args);
            f.state.activeAgentSessionId = 'owner'; f.state.activeAgentRunId = 'still-running'; return validated;
        };
        const pending = f.state.chooseConversationWorkspaceDirectory();
        if (change === 'navigate') f.state.activeCodingSessionId = 'other';
        if (change === 'run') f.state.activeAgentSessionId = 'owner', f.state.activeAgentRunId = 'running';
        if (change === 'permission') f.sourceSession.permissionMode = 'workspace_write';
        selected.resolve(change === 'cancel' ? undefined : URI.fromFilePath(f.b)); await pending;
        assert.equal(f.state.codingSessions[0].workspaceBindings.length, 1, change);
        assert.equal(f.persisted(), 0, change); assert.equal(f.state.conversationDirectoriesBusy, false);
    }
});

test('unlink preserves disk and primary and is blocked until cancellation has actually settled', async t => {
    const f = await fixture(t); await f.state.chooseConversationWorkspaceDirectory();
    const id = f.state.activeCodingSession().workspaceBindings[1].id;
    await writeFile(join(f.b, 'preserved.txt'), 'KEEP');
    f.state.unlinkConversationWorkspaceDirectory('a'); assert.equal(f.state.activeCodingSession().workspaceBindings[0].status, 'available');
    f.state.activeAgentSessionId = 'owner'; f.state.activeAgentRunId = 'stopping'; f.state.agentStage = 'cancelled';
    const snapshot = JSON.stringify(f.state.activeCodingSession().workspaceBindings);
    f.state.unlinkConversationWorkspaceDirectory(id); await f.state.chooseConversationWorkspaceDirectory();
    assert.equal(JSON.stringify(f.state.activeCodingSession().workspaceBindings), snapshot);
    f.state.activeAgentRunId = ''; f.state.unlinkConversationWorkspaceDirectory(id);
    assert.equal(f.state.activeCodingSession().workspaceBindings[1].status, 'unlinked');
    assert.equal(await readFile(join(f.b, 'preserved.txt'), 'utf8'), 'KEEP');
    await f.state.chooseConversationWorkspaceDirectory();
    assert.equal(f.state.activeCodingSession().workspaceBindings.length, 2);
    assert.equal(f.state.activeCodingSession().workspaceBindings[1].id, id);
    assert.equal(f.state.activeCodingSession().workspaceBindings[1].status, 'available');
});

test('private preferences survive history normalization and layout reconstruction without trusting saved paths or reviving unlinked roots', async t => {
    const f = await fixture(t);
    const stored = normalize([
        { id: 'private-0', path: '/untrusted/primary', kind: 'private', permission: 'read_only', status: 'available' },
        { id: 'private-1', path: '/untrusted/secondary', kind: 'private', permission: 'workspace_write', status: 'unlinked' },
        { id: 'selected', path: f.b, kind: 'selected', permission: 'read_only', status: 'unlinked' },
    ]);
    assert.equal(stored[0].path, ''); assert.equal(stored[1].path, '');
    const owner = { ...f.sourceSession, workspacePath: '', workspaceBindings: stored, ownedWorkspace: true };
    f.state.codingSessions[0] = owner;
    f.state.platformService.getConversationWorkspaceBindings = async () => ({ workspaceRoot: f.a, workspaces: [{ workspaceRoot: f.a }, { workspaceRoot: f.b }] });
    const resolved = await f.state.ensureCodingSessionWorkspace(owner);
    assert.equal(resolved.workspaceBindings[0].path, f.a); assert.equal(resolved.workspaceBindings[0].permission, 'read_only');
    assert.equal(resolved.workspaceBindings[1].path, f.b); assert.equal(resolved.workspaceBindings[1].permission, 'workspace_write');
    assert.equal(resolved.workspaceBindings[1].status, 'unlinked'); assert.equal(resolved.workspaceBindings[2].status, 'unlinked');
    const reopened = { ...resolved, privateWorkspacePath: undefined, workspaceBindings: normalize(JSON.parse(JSON.stringify(resolved.workspaceBindings))) };
    f.state.codingSessions[0] = reopened;
    assert.deepEqual((await f.state.ensureCodingSessionWorkspace(reopened)).workspaceBindings, resolved.workspaceBindings);
});

test('late private-layout initialization cannot reinsert a deleted owner or change bindings after closing, switching or starting a run', async t => {
    for (const action of ['delete', 'close', 'switch', 'run']) {
        const f = await fixture(t), layout = deferred();
        const owner = { ...f.sourceSession, workspacePath: '', workspaceBindings: [], ownedWorkspace: true };
        f.state.codingSessions[0] = owner;
        f.state.platformService.getConversationWorkspaceBindings = () => layout.promise;
        const pending = f.state.openConversationDirectories();
        if (action === 'delete') f.state.codingSessions = [f.other];
        if (action === 'close') f.state.codingPopover = '';
        if (action === 'switch') f.state.activeCodingSessionId = 'other';
        if (action === 'run') f.state.activeAgentSessionId = 'owner', f.state.activeAgentRunId = 'running';
        layout.resolve({ workspaceRoot: f.a, workspaces: [{ workspaceRoot: f.a }, { workspaceRoot: f.b }] }); await pending;
        assert.equal(f.persisted(), 0, action);
        if (action === 'delete') assert.equal(f.state.codingSessions.some(session => session.id === 'owner'), false);
        else { assert.equal(f.state.codingSessions[0], owner); assert.deepEqual(owner.workspaceBindings, []); }
    }
});

test('an explicitly unlinked historical checkpoint is rejected before any restore lookup while legacy external owners remain compatible', async t => {
    const f = await fixture(t), calls = [];
    const Harness = new Function(transpile(`class Harness {
        ${method('codingSessionStoredWorkspaceRoots')}
        ${method('createWorkspaceRestorePlan')}
    }; return Harness;`))();
    const state = new Harness(); state.platformService = { getAgentCheckpointDiff: async (root, id) => {
        calls.push({ root, id }); return { checkpointId: id, workspaceRoot: root, path: 'qa.txt' };
    } };
    const session = { workspacePath: f.a, workspaceBindings: [{ id: 'a', path: f.a }, { id: 'b', path: f.b, status: 'unlinked' }],
        turns: [{ changes: [{ checkpointId: 'checkpoint-b', workspaceRoot: f.b }] }] };
    await assert.rejects(state.createWorkspaceRestorePlan(session, ['checkpoint-b']), { code: 'WORKSPACE_UNLINKED' });
    assert.equal(calls.length, 0, 'no file/diff lookup or restore can follow a known unlink');
    const legacy = { ...session, workspaceBindings: [{ id: 'a', path: f.a }] };
    assert.equal((await state.createWorkspaceRestorePlan(legacy, ['checkpoint-b']))[0].workspaceRoot, f.b);
    assert.equal(calls.length, 1);
});

test('file timeline rejects checkpoint and text restores for an unlinked root, including unlink during the disk baseline read', async t => {
    for (const checkpoint of [true, false]) for (const when of ['already', 'during']) {
        const f = await fixture(t), baseline = deferred(), calls = [];
        const Timeline = new Function('fileDrawerText', 'editorRecoveryText', transpile(`class Timeline { ${method('selectContextFileHistory')} }; return Timeline;`))(
            (_locale, key) => key, (_locale, key) => key);
        f.state.selectContextFileHistory = Timeline.prototype.selectContextFileHistory;
        f.sourceSession.workspaceBindings.push({ id: 'b', path: f.b, status: when === 'already' ? 'unlinked' : 'available' });
        const preview = { uri: 'file:///fixture/qa.txt', baselineSha256: 'disk' };
        Object.assign(f.state, { contextFilePreview: preview, contextFileSavingUris: new Set(), contextFileSaveAllActive: false,
            contextFileHistorySelecting: false, contextFileHistorySelectionToken: 0, contextFileDrafts: {}, contextFileDirty: false,
            contextFileVersionTarget: () => ({ workspaceRoot: f.b, conversationId: 'owner', path: 'qa.txt' }) });
        f.state.platformService.getAgentFileState = async () => { calls.push('read'); return baseline.promise; };
        f.state.platformService.restoreAgentFileVersion = async () => { calls.push('restore'); };
        f.state.platformService.saveAgentFileVersion = async () => { calls.push('save'); };
        const pending = f.state.selectContextFileHistory({ id: 'old', uri: preview.uri, content: 'historic',
            ...(checkpoint ? { workspaceRoot: f.b, checkpointId: 'checkpoint-b', side: 'before' } : {}) });
        assert.equal(f.state.conversationDirectoryMutationBlocked(f.sourceSession), when === 'during', 'timeline in flight blocks directory mutations');
        if (when === 'during') {
            f.sourceSession.workspaceBindings = f.sourceSession.workspaceBindings.map(binding => binding.id === 'b' ? { ...binding, status: 'unlinked' } : binding);
            baseline.resolve({ sha256: 'disk' });
        }
        await pending;
        assert.deepEqual(calls, when === 'already' ? [] : ['read']);
        assert.match(f.state.contextFileHistoryError, /已解除绑定/);
        assert.equal(f.state.contextFileHistorySelecting, false);
    }
});

test('retained unlink preferences cannot crowd active bindings out of the 32-entry history limit', async t => {
    const f = await fixture(t);
    f.sourceSession.workspaceBindings.push(...Array.from({ length: 31 }, (_, i) => ({ id: `old-${i}`, path: join(f.base, `old-${i}`), kind: 'selected', status: 'unlinked', permission: 'read_only' })));
    await f.state.chooseConversationWorkspaceDirectory();
    assert.equal(f.state.activeCodingSession().workspaceBindings.length, 32);
    assert.match(f.state.conversationDirectoriesError, /32/); assert.equal(f.persisted(), 0);
});

test('read-only validation enforces canonical identity, permissions and limits without modifying directories', async t => {
    const f = await fixture(t), before = await readdir(f.base);
    const result = await f.validator.validateConversationWorkspaceBindings(f.a, [{ id: 'a', path: f.a, permissionMode: 'full_access' }, { id: 'b', path: f.b, permissionMode: 'workspace_write' }], 'read_only');
    assert.deepEqual(result.bindings.map(binding => binding.permissionMode), ['read_only', 'read_only']);
    await assert.rejects(f.validator.validateConversationWorkspaceBindings(f.a, Array.from({ length: 33 }, (_, i) => ({ id: `b${i}`, path: f.b, permissionMode: 'read_only' })), 'read_only'));
    await assert.rejects(f.validator.validateConversationWorkspaceBindings(f.a, [{ id: 'bad id', path: f.b, permissionMode: 'read_only' }], 'read_only'));
    await assert.rejects(f.validator.validateConversationWorkspaceBindings(f.a, [{ id: 'b', path: f.b, permissionMode: 'admin' }], 'read_only'));
    assert.deepEqual(await readdir(f.base), before);
});

test('backend private-layout reconstruction respects explicit unlink preferences and cannot remove the primary', async t => {
    const f = await fixture(t);
    const layout = { workspaceRoot: f.a, workspaces: [{ workspaceRoot: f.a }, { workspaceRoot: f.b }] };
    const Harness = new Function('realpath', 'readWorkspaceForkLayout', 'relative', 'isAbsolute', 'sep', 'createHash', 'PlatformRequestError',
        transpile(`class Harness { ${serviceMethod('resolveConversationForkRequest')} }; return Harness;`))(
        realpath, async () => layout, relative, isAbsolute, sep, createHash, Error);
    const service = new Harness(); service.conversationWorkspacePath = () => f.base;
    service.incognitoSessions = () => ({ has: () => false, owns: () => false });
    const request = { conversationId: 'fixture', workspaceRoot: f.a, permissionMode: 'full_access',
        workspaceBindings: [{ id: 'private-0', path: f.a, permissionMode: 'read_only' }], unlinkedPrivateWorkspaceBindingIds: ['private-1'] };
    const resolved = await service.resolveConversationForkRequest(request);
    assert.deepEqual(resolved.workspaceBindings, request.workspaceBindings);
    assert.equal((await service.resolveConversationForkRequest({ ...request, unlinkedPrivateWorkspaceBindingIds: undefined })).workspaceBindings.length, 2, 'legacy requests still recover their complete layout');
    await assert.rejects(service.resolveConversationForkRequest({ ...request, unlinkedPrivateWorkspaceBindingIds: ['private-0'] }));
    await assert.rejects(service.resolveConversationForkRequest({ ...request, unlinkedPrivateWorkspaceBindingIds: ['private-99'] }));
    await assert.rejects(service.resolveConversationForkRequest({ ...request, workspaceRoot: f.b }));
    await assert.rejects(service.resolveConversationForkRequest({ ...request, workspaceBindings: [...request.workspaceBindings, { id: 'private-1', path: f.b, permissionMode: 'full_access' }] }));
    await rm(f.b, { recursive: true });
    assert.deepEqual((await service.resolveConversationForkRequest(request)).workspaceBindings, request.workspaceBindings, 'an unlinked missing directory is never required or revived');
});

test('a new private fork excludes an unlinked root and preserves each retained directory permission', async t => {
    const f = await fixture(t), selected = join(f.base, 'selected'); await mkdir(selected);
    const Harness = new Function('URI', 'rebaseConversationBranchFileView', transpile(`class Harness {
        ${method('codingSessionStoredWorkspaceRoots')}
        ${method('prepareConversationBranchWorkspace')}
    }; return Harness;`))(URI, view => view);
    const state = new Harness(); let forkRequest;
    const sourceSession = { id: 'source', workspacePath: '', ownedWorkspace: true, permissionMode: 'full_access', turns: [], workspaceBindings: [
        { id: 'private-0', path: f.a, kind: 'private', permission: 'read_only' },
        { id: 'private-1', path: f.b, kind: 'private', permission: 'workspace_write', status: 'unlinked' },
        { id: 'selected', path: selected, kind: 'selected', permission: 'workspace_write' },
    ] };
    Object.assign(state, { codingSessionWorkspaceRoot: owner => owner.privateWorkspacePath,
        createWorkspaceRestorePlan: async () => [{ workspaceRoot: f.a, checkpointIds: ['checkpoint-a'] }],
        rebaseProjectlessConversationAttachments: async target => target,
        platformService: { getConversationWorkspaceBindings: async () => ({ workspaceRoot: f.a, workspaces: [{ workspaceRoot: f.a }, { workspaceRoot: f.b }] }),
            forkConversationWorkspaces: async request => { forkRequest = request; return { workspaceRoot: join(f.base, 'copy-a'), resourceMappings: [],
                workspaces: request.groups.map((group, i) => ({ sourceWorkspaceRoot: group.workspaceRoot, workspaceRoot: join(f.base, `copy-${i}`) })) }; } }
    });
    const branch = await state.prepareConversationBranchWorkspace(sourceSession, { id: 'branch', turns: [{ changes: [{ checkpointId: 'checkpoint-a', workspaceRoot: f.a }] }] });
    assert.deepEqual(forkRequest.groups.map(group => group.workspaceRoot), [f.a, selected]);
    assert.deepEqual(branch.workspaceBindings.map(binding => binding.permission), ['read_only', 'workspace_write']);
    assert.equal(branch.workspaceBindings.some(binding => binding.path === f.b), false);
    const RestorePlanner = new Function(transpile(`class RestorePlanner { ${method('createWorkspaceRestorePlan')} }; return RestorePlanner;`))();
    state.createWorkspaceRestorePlan = RestorePlanner.prototype.createWorkspaceRestorePlan;
    state.platformService.getAgentCheckpointDiff = async (root, id) => ({ checkpointId: id, workspaceRoot: root, path: 'qa.txt' });
    sourceSession.turns = [{ changes: [{ checkpointId: 'checkpoint-b', workspaceRoot: f.b }] }];
    forkRequest = undefined;
    await assert.rejects(state.prepareConversationBranchWorkspace(sourceSession, { id: 'other-branch', turns: sourceSession.turns }), { code: 'WORKSPACE_UNLINKED' });
    assert.equal(forkRequest, undefined, 'fork must not carry an unlinked source owner into a new private history');
});

for (const mode of ['workspace_write', 'full_access']) test(`actual ${mode} submit request carries selected bindings into real multi-root tools and independent command checkpoints`, async t => {
    const f = await fixture(t); await f.state.chooseConversationWorkspaceDirectory();
    // Existing grants are ceilings: lowering the conversation mode must narrow
    // both roots without silently rewriting either persisted grant.
    f.state.activeCodingSession().permissionMode = mode;
    let requestInitializer;
    const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'startRequest') requestInitializer = node.initializer.getText(file); ts.forEachChild(node, visit); };
    visit(klass.members.find(node => node.name?.getText(file) === 'executePromptSubmission'));
    assert.ok(requestInitializer);
    const deps = { queuedRequestId: undefined, route: { kind: 'official_connection', connection: { id: 'qa-no-network', model: 'fixture' } },
        workbench: 'coding', value: 'fixture', requestedSwitchPolicy: undefined, taskAttachments: [], conversationHistory: [],
        effectiveWorkspaceRoot: f.a, codingSession: f.state.activeCodingSession(), runPermission: mode, runReasoningEffort: undefined, runReasoningSettings: {},
        runContextWindowTokens: undefined, sharedTerminal: undefined, skills: [], resumedExecution: undefined, submission: undefined };
    const request = new Function(...Object.keys(deps), transpile(`return (${requestInitializer});`)).call({ selectedTerminalProfile: () => undefined, recentToolNames: () => [] }, ...Object.values(deps));
    assert.equal(request.workspaceBindings.length, 2);
    const scope = await resolveAgentWorkspaces(request.workspaceRoot, request.workspaceBindings, request.permissionMode);
    const runtime = await MultiWorkspaceToolRuntime.create({ ...scope, permissionMode: request.permissionMode,
        checkpointRootForWorkspace: root => join(f.base, root === f.a ? 'versions-a' : 'versions-b') });
    t.after(() => runtime.dispose());
    const registry = new AgentToolRegistry(); runtime.registerTools(registry);
    for (const [index, binding] of scope.bindings.entries()) {
        const written = await registry.execute({ id: `file-${index}`, name: 'workspace.write_file', arguments: { workspaceBindingId: binding.id, path: 'qa.txt', content: `root-${index}` } }, mode, { runId: 'qa-multiroot-selection' });
        assert.equal(written.ok, true, JSON.stringify(written.error));
        const command = await registry.execute({ id: `command-${index}`, name: 'process.run', arguments: { workspaceBindingId: binding.id, command: '/bin/sh', args: ['-c', 'printf command > command.txt'], timeoutMs: 2000 } }, mode, { runId: 'qa-multiroot-selection' });
        assert.equal(command.ok, true, JSON.stringify(command.error));
        assert.equal(await readFile(join(binding.path, 'qa.txt'), 'utf8'), `root-${index}`);
        assert.equal(await readFile(join(binding.path, 'command.txt'), 'utf8'), 'command');
    }
    await runtime.finalizeProcessCheckpoints();
    const groups = runtime.getWorkspaceCheckpointGroups(); assert.equal(groups.length, 2);
    for (const group of groups) { assert.ok(group.checkpointIds.length >= 2); for (const id of group.checkpointIds) assert.equal((await runtime.getCheckpointDiff(id)).workspaceRoot, group.workspaceRoot); }
});
