import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { common, service } from './helpers/editor-recovery-source-loader.mjs';
import { conversationAgentRunActive } from '../lib/browser/nextmux-conversation-agent-run.js';

// Run current widget/controller/RPC source, not a parallel implementation or stale lib.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const classes = new Map();
function visit(node) {
    if (ts.isClassDeclaration(node) && node.name) classes.set(node.name.text, node);
    ts.forEachChild(node, visit);
}
visit(file);
const method = (owner, name) => {
    const result = classes.get(owner)?.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(file) === name);
    assert.ok(result, `${owner}.${name} must exist in current production source`); return result;
};
const compile = (text, values = {}) => new Function(...Object.keys(values), ts.transpile(text, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(values));
const controllerModule = { exports: {} };
compile(readFileSync(new URL('../src/browser/nextmux-editor-draft-recovery.ts', import.meta.url), 'utf8'), {
    module: controllerModule, exports: controllerModule.exports, require: () => common
});
const { EditorDraftRecoveryController, editorRecoveryDirty, editorRecoveryError } = controllerModule.exports;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const idle = () => new Promise(setImmediate);
class URI {
    constructor(value) { this.value = value; this.path = { fsPath: () => fileURLToPath(value), base: value.split('/').at(-1) }; }
    toString() { return this.value; }
}
const widgetNames = ['scheduleContextEditorRecoveryCapture', 'captureContextEditorRecovery', 'preserveContextFileTabRecovery', 'detachContextEditorRecovery', 'openContextEditorRecovery',
    'discardContextEditorRecovery', 'copyContextEditorRecovery', 'beginContextFileOpen', 'finishContextFileOpen', 'rememberContextFileTab',
    'activateContextFileTab', 'closeContextFileTab',
    'previewContextFile', 'restoreCodingViewState', 'closeContextFilePreview', 'selectWorkspaceRoot',
    'assertApplicationExitSaved', 'shutdownForApplicationExit', 'requestContextFileSave', 'writeContextFile', 'applyPrivacySettings', 'persistPrivacyMirror'];
const rendererStorage = new Map();
const render = method('NextMuxDesktopWidget', 'renderWorkContext');
const editorJsx = [...function* nodes(node) { yield node; for (const child of node.getChildren(file)) yield* nodes(child); }(render)]
    .find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'NextMuxFileEditor');
assert.ok(editorJsx);
const callbackNames = ['onDirty', 'onContentChange', 'onFocus', 'onSave', 'onScrollPositionChange'];
const callbackProperties = callbackNames.map(name => {
    const attribute = editorJsx.attributes.properties.find(item => item.name?.getText(file) === name);
    assert.ok(attribute?.initializer?.expression, `actual editor ${name}`);
    return `${name}: ${attribute.initializer.expression.getText(file)}`;
});
const callbackPrelude = render.body.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => ['preview', 'fileGeneration', 'isCurrentEditor'].includes(declaration.name.getText(file))))
    .map(statement => statement.getText(file)).join('\n');
const Widget = compile(`class Harness { ${widgetNames.map(name => method('NextMuxDesktopWidget', name).getText(file)).join('\n')}
    callbacks() { ${callbackPrelude}; return { ${callbackProperties.join(',')} }; }
}; return Harness;`, {
    URI, editorRecoveryDirty, editorRecoveryError, conversationAgentRunActive, editorRecoveryText: (_locale, key) => key,
    FileSystemProviderCapabilities: { Readonly: 1 }, FileOperationError: class extends Error {}, FileOperationResult: { FILE_MODIFIED_SINCE: 3, FILE_TOO_LARGE: 7, FILE_EXCEEDS_MEMORY_LIMIT: 9 },
    toFileOperationResult: error => error?.fileOperationResult ?? 0, FILE_DRAWER_TEXT_MAX_BYTES: 64 * 1024 * 1024, IMAGE_PREVIEW_MAX_BYTES: 32 * 1024 * 1024,
    filePreviewRequestIsCurrent: (currentToken, token, currentOwner, owner) => currentToken === token && currentOwner === owner,
    normalizeContextFileScrollPositions: value => value || {}, normalizeAgentChildScrollStates: value => value || {},
    requireDurablePastedTextReferences: (prompt, references) => { assert.equal(prompt, ''); assert.deepEqual(references, []); },
    filePreviewErrorText: (_locale, kind) => kind,
    NextMuxDesktopWidget: { WORK_CONTEXT_MIN_WIDTH: 200, WORK_CONTEXT_MAX_WIDTH: 1000, FILE_LIST_MIN_WIDTH: 100,
        FILE_LIST_MAX_WIDTH: 400, TERMINAL_MIN_HEIGHT: 100, TERMINAL_MAX_HEIGHT: 700,
        TERMINAL_LIST_TIGHT_MIN_WIDTH: 100, TERMINAL_LIST_MAX_WIDTH: 400, LARGE_TEXT_FILE_CHARACTERS: 200000 },
    window: { setTimeout, clearTimeout, localStorage: { getItem: key => rendererStorage.get(key) ?? null,
        setItem: (key, value) => rendererStorage.set(key, value), removeItem: key => rendererStorage.delete(key) } }
});
class RecoveryService extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.testRoot = root; }
    nextmuxDataRoot() { return this.testRoot; }
    close() { return this.disposeConnectionResources(); }
}
async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-recovery-widget-')));
    const sourceFile = join(root, 'only.txt'), stateRoot = join(root, 'app-state');
    await fs.writeFile(sourceFile, 'original', { mode: 0o600 });
    const a = new RecoveryService(stateRoot), b = new RecoveryService(stateRoot);
    const controllers = [], events = [], fileEvents = [], notices = [];
    const controllerFor = owner => {
        const controller = new EditorDraftRecoveryController(owner); controllers.push(controller); return controller;
    };
    const controller = controllerFor(a), widget = new Widget();
    const sourceUri = pathToFileURL(sourceFile).href;
    Object.assign(widget, {
        activeCodingSessionId: 'session-A', activeWorkspaceRoot: root, codingSessions: [{ id: 'session-A', workspacePath: root, turns: [] }],
        workspaceOptions: [{ path: root }, { path: join(root, 'other') }],
        contextFilePreview: { uri: sourceUri, path: sourceFile, name: 'only.txt', content: 'original', beforeContent: 'checkpoint',
            revision: 0, recoveryKey: 'local-A', recoverySessionId: 'session-A' },
        contextFileDrafts: { current: 'unsaved current', before: '' }, contextFileDirty: true,
        // The file drawer now tracks multiple open tabs. This recovery
        // harness exercises the single preview lifecycle and therefore keeps
        // the tab bookkeeping inert while supplying the production shape.
        contextFileTabs: new Map(), contextFileSavingUris: new Set(), rememberContextFileTab() {},
        contextFileSaveStatus: 'idle', contextFilePreviewRequestToken: 1, codingViewRestoreToken: 1,
        contextFileRecoveryUncaptured: false, contextFilePreviewLoading: false, editorRecoveryBusy: false,
        editorDraftRecovery: controller, editorRecoveryController() { return this.editorDraftRecovery; },
        platformService: a, desktopLocale: 'en', workContextMode: 'file', workContextOpen: true,
        workContextWidth: 900, contextFileListWidth: 200, activeSection: 'coding', codingPanel: 'thread',
        applicationExitGeneration: 1, applicationExitPreparing: true, pendingContextFileWrites: new Set(),
        pendingAttachmentImports: new Map(), pendingDraftAttachmentRestores: () => [],
        pastedTextPersistence: new Map(), unpersistedPastedTextReferences: new Map(), prompt: '', pastedTextReferences: [],
        privacySettings: { saveConversationHistory: false }, conversationHistoryPersistenceReady: true,
        conversationHistoryLoadGeneration: 0, conversationHistoryPersistedSessions: new Map(),
        // History hydration has its own current-source suite; this fixture owns only editor recovery.
        async restoreDurableCodingSessions() { events.push('history-hydration-requested'); },
        discardInitialConversationMirror() { events.push('history-mirror-discarded'); },
        pruneUnpersistedPastedTextReferences() {}, pendingAgentSubmissions: new Set(), activeAgentRunId: '',
        conversationAgentRuns: new Map(), agentChildContinuationStates: new Map(), scheduledAgentRuns: new Map(),
        terminalRecords: [{ id: 'owned-synthetic-terminal' }],
        flushComposerDraft() { events.push('composer'); }, async flushConversationHistory() { events.push('history'); },
        workspaceConfigurationSaver: { hasPendingChanges: false, async flush() { events.push('workspace'); } },
        persistTerminalRecords() { events.push('terminals'); }, async terminateAndDisposeConversationTerminal() { events.push('terminate'); },
        persistActiveCodingSessionState() { events.push('view'); }, update() {}, addNotification(...args) { notices.push(args); },
        onContextFileEditorScroll(uri, position) { events.push({ scroll: { uri, position } }); },
        async loadContextFiles() { events.push('list-files'); }, workContextMaximumWidth: () => 1000,
        contextFileListMaximumWidth: () => 400, clampPaneSize: (value, min) => Number.isFinite(value) ? value : min,
        constrainPaneSizes() {}, persistPaneSize() {}, syncPaneCssVariables() {}, schedulePaneResizeUpdate() {},
        cancelContextFileListScrollRestore() {}, boundedContextFileListScrollTop: value => value,
        syncActiveTerminal() {}, syncActiveBrowser() {}, scheduleContextFileListScrollRestore() {}, currentAgentChildren: () => [],
        attachmentExtension: name => name.split('.').at(-1), isCheckpointRestored: () => false, contextFileVersionTarget: () => undefined,
        fileService: {
            async read(uri) { fileEvents.push('read'); return { value: await fs.readFile(fileURLToPath(uri.value), 'utf8'), mtime: 1, etag: 'fixture' }; },
            async resolve(uri) { fileEvents.push('resolve'); const stat = await fs.stat(fileURLToPath(uri.value)); return { isDirectory: stat.isDirectory(), isReadonly: !(stat.mode & 0o222) }; },
            hasCapability() { return false; },
            async write() { fileEvents.push('WRITE'); throw new Error('No test is permitted to write the source through the widget'); }
        }
    });
    await controller.refresh();
    t.after(async () => {
        clearTimeout(widget.contextEditorRecoveryCaptureTimer);
        controllers.forEach(value => value.dispose()); await Promise.all([a.close(), b.close()]);
        await fs.rm(root, { recursive: true, force: true });
    });
    const persist = async () => { assert.equal(widget.captureContextEditorRecovery(), true); await controller.flushAll(); return controller.entries.get('local-A').ack; };
    return { widget, controller, controllerFor, a, b, sourceUri, sourceFile, root, events, fileEvents, notices, persist };
}

test('actual input → capture → Node backup → shutdown preserves both drafts without marking the source clean', async t => {
    const f = await fixture(t), before = await fs.stat(f.sourceFile), callbacks = f.widget.callbacks();
    callbacks.onContentChange('current', 'typed immediately before quit'); callbacks.onDirty(true);
    assert.equal(f.controller.hasUnconfirmed, false, 'typing waits for the capture debounce');
    assert.equal(f.widget.contextFileRecoveryUncaptured, true);
    await f.widget.shutdownForApplicationExit();
    assert.equal(f.controller.isConfirmed('local-A'), true);
    const listed = await f.b.listEditorDraftRecoveries(), record = (await f.b.openEditorDraftRecovery({ id: listed.entries[0].id })).record;
    assert.equal(record.snapshot.sessionId, 'session-A');
    assert.deepEqual(record.snapshot.drafts, { current: 'typed immediately before quit', before: '' });
    assert.equal(f.widget.contextFileDirty, true); assert.equal(f.widget.contextFileSaveStatus, 'idle');
    assert.equal(f.widget.contextFilePreview.content, 'original');
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
    const after = await fs.stat(f.sourceFile); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.mode, before.mode);
    assert.equal(f.fileEvents.includes('WRITE'), false); assert.equal(f.events.includes('terminate'), true);
});

test('oversized/disabled current capture cannot reuse an older confirmed entry to exit, close or change workspace', async t => {
    for (const reason of ['large', 'disabled']) {
        const f = await fixture(t); await f.persist();
        const preview = f.widget.contextFilePreview;
        if (reason === 'disabled') f.controller.state = { ...f.controller.state, enabled: false };
        const text = reason === 'large' ? 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES) : 'new after disabling';
        f.widget.callbacks().onContentChange('current', text);
        assert.equal(f.widget.contextFileRecoveryUncaptured, true); assert.equal(f.controller.isConfirmed('local-A'), true);
        assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
        await assert.rejects(f.widget.shutdownForApplicationExit(), /FILE_NOT_SAVED/);
        f.widget.closeContextFilePreview(); f.widget.selectWorkspaceRoot(join(f.root, 'other'));
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.activeWorkspaceRoot, f.root);
        assert.equal(f.widget.contextFileDrafts.current, text); assert.equal(f.events.includes('terminate'), false);
        assert.equal(f.fileEvents.includes('WRITE'), false); assert.ok(f.notices.length >= 2);
    }
});

test('Node save failure rejects shutdown and preserves current editor instead of assuming an older receipt covers it', async t => {
    const f = await fixture(t); await f.persist();
    f.a.saveEditorDraftRecovery = async () => { throw new Error('EDITOR_RECOVERY_UNAVAILABLE'); };
    f.widget.callbacks().onContentChange('before', 'new before');
    await assert.rejects(f.widget.shutdownForApplicationExit(), /EDITOR_RECOVERY_UNAVAILABLE/);
    assert.equal(f.widget.contextFileDrafts.before, 'new before'); assert.equal(f.widget.contextFileDirty, true);
    assert.equal(f.controller.hasUnconfirmed, true); assert.equal(f.events.includes('terminate'), false);
});

test('an inactive tab with an unbacked draft blocks workspace changes and exit while the active tab is clean', async t => {
    const f = await fixture(t);
    const preview = f.widget.contextFilePreview;
    const inactive = { preview: { ...preview, uri: `${f.sourceUri}.other`, recoveryKey: 'inactive' },
        drafts: { current: 'unbacked inactive text' }, dirty: true, activeSide: 'current' };
    f.widget.contextFileTabs.set(inactive.preview.uri, inactive);
    f.widget.contextFileDrafts = { current: preview.content, before: preview.beforeContent };
    f.widget.contextFileDirty = false;
    f.controller.state = { ...f.controller.state, enabled: false };
    assert.equal(f.widget.detachContextEditorRecovery(), false);
    f.widget.selectWorkspaceRoot(join(f.root, 'other'));
    assert.equal(f.widget.activeWorkspaceRoot, f.root);
    assert.equal(f.widget.contextFileTabs.get(inactive.preview.uri), inactive);
    await assert.rejects(f.widget.shutdownForApplicationExit(), /FILE_NOT_SAVED/);
    assert.equal(f.widget.contextFileTabs.get(inactive.preview.uri).drafts.current, 'unbacked inactive text');
    assert.equal(f.events.includes('terminate'), false);
});

test('closing a captured preview clears only its view; an acknowledged copy reopens with its original owner', async t => {
    const f = await fixture(t); await f.persist(); f.widget.closeContextFilePreview();
    assert.equal(f.widget.contextFilePreview, undefined); assert.equal(f.controller.entries.size, 1);
    f.widget.contextFileActiveSide = 'before';
    await f.widget.openContextEditorRecovery('local-A');
    assert.deepEqual(f.widget.contextFileDrafts, { current: 'unsaved current', before: '' });
    assert.equal(f.widget.contextFilePreview.recoverySessionId, 'session-A'); assert.equal(f.widget.contextFileDirty, true);
    assert.equal(f.widget.contextFilePreview.readOnly, false); assert.equal(f.fileEvents.includes('WRITE'), false);
    assert.equal(f.widget.contextFileActiveSide, 'current', 'A recovered view must not inherit a previous diff-before save target');
});

test('fresh renderer restores the durable backup before source resolution, even when the source has vanished', async t => {
    const f = await fixture(t); await f.persist(); await fs.unlink(f.sourceFile);
    const next = f.controllerFor(f.b); f.widget.editorDraftRecovery = next;
    f.widget.contextFilePreview = undefined; f.widget.contextFileDrafts = {}; f.widget.contextFileDirty = false;
    f.widget.fileService.resolve = async () => { f.fileEvents.push('resolve'); throw new Error('ENOENT'); };
    await f.widget.restoreCodingViewState({ workContextOpen: true, workContextMode: 'file', contextFileUri: f.sourceUri });
    assert.equal(f.widget.contextFilePreview.uri, f.sourceUri); assert.equal(f.widget.contextFilePreview.error, '');
    assert.equal(f.widget.contextFilePreview.readOnly, true); assert.equal(f.widget.contextFileDirty, true);
    assert.deepEqual(f.widget.contextFileDrafts, { current: 'unsaved current', before: '' });
    assert.deepEqual(f.fileEvents, [], 'missing-source recovery must not require source.resolve to succeed first');
});

test('preview lookup and open retain changed/readonly source drafts but refuse both save entry points', async t => {
    for (const mode of ['changed', 'readonly', 'resolve-error']) {
        const f = await fixture(t); const ack = await f.persist();
        if (mode === 'changed') await fs.writeFile(f.sourceFile, 'external version');
        if (mode === 'readonly') await fs.chmod(f.sourceFile, 0o400);
        if (mode === 'resolve-error') f.widget.fileService.resolve = async () => { throw new Error('synthetic resolve failure'); };
        f.widget.editorDraftRecovery = f.controllerFor(f.b); f.widget.contextFilePreview = undefined;
        f.widget.contextFileDrafts = {}; f.widget.contextFileDirty = false;
        await f.widget.previewContextFile({ uri: f.sourceUri, path: f.sourceFile, name: 'only.txt', directory: false });
        assert.equal(f.widget.contextFilePreview.recoveryKey, ack.id); assert.equal(f.widget.contextFilePreview.readOnly, true);
        assert.equal(f.widget.contextFileDrafts.current, 'unsaved current');
        f.widget.requestContextFileSave('current', 'forbidden'); assert.equal(f.widget.pendingFileSave, undefined);
        f.widget.pendingFileSave = { uri: f.sourceUri, side: 'current', content: 'forbidden' };
        await f.widget.writeContextFile(true); assert.equal(f.fileEvents.includes('WRITE'), false);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), mode === 'changed' ? 'external version' : 'original');
    }
});

test('late recovery open cannot replace a new session or same-URI preview generation', async t => {
    for (const change of ['session', 'generation']) {
        const f = await fixture(t); await f.persist(); const gate = deferred();
        const original = f.a.openEditorDraftRecovery.bind(f.a);
        f.a.openEditorDraftRecovery = async request => { await gate.promise; return original(request); };
        const opening = f.widget.openContextEditorRecovery('local-A');
        await idle();
        const replacement = { ...f.widget.contextFilePreview, recoveryKey: 'new-preview', content: 'new baseline' };
        f.widget.contextFilePreview = replacement; f.widget.contextFileDrafts = { current: 'new session text' };
        if (change === 'session') f.widget.activeCodingSessionId = 'session-B'; else f.widget.contextFilePreviewRequestToken++;
        gate.resolve(); await opening;
        assert.equal(f.widget.contextFilePreview, replacement); assert.deepEqual(f.widget.contextFileDrafts, { current: 'new session text' });
        assert.equal(f.fileEvents.includes('WRITE'), false);
    }
});

test('late recovery metadata or source reads cannot replace newly uncaptured text with an older acknowledged snapshot', async t => {
    for (const delayed of ['metadata', 'source']) {
        const f = await fixture(t); await f.persist();
        const entry = f.controller.entries.get('local-A'), version = entry.version, preview = f.widget.contextFilePreview;
        const gate = deferred(), entered = deferred();
        if (delayed === 'metadata') {
            const read = f.a.openEditorDraftRecovery.bind(f.a);
            f.a.openEditorDraftRecovery = async request => { entered.resolve(); await gate.promise; return read(request); };
        } else {
            const read = f.widget.fileService.read;
            f.widget.fileService.read = async (...args) => { entered.resolve(); await gate.promise; return read(...args); };
        }
        const opening = f.widget.openContextEditorRecovery('local-A');
        await entered.promise;
        const text = 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES);
        f.widget.callbacks().onContentChange('current', text);
        const drafts = f.widget.contextFileDrafts;
        assert.equal(entry.version, version); assert.equal(f.widget.contextFileRecoveryUncaptured, true);
        gate.resolve(); await opening;
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.widget.contextFileDrafts.current, text); assert.equal(f.widget.contextFileDirty, true);
        assert.equal(f.widget.contextFileRecoveryUncaptured, true);
        assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original'); assert.equal(f.fileEvents.includes('WRITE'), false);
    }
});

test('new uncaptured input during preview metadata refresh keeps the existing editor and never reads the target file', async t => {
    const f = await fixture(t); await f.persist();
    const entry = f.controller.entries.get('local-A'), version = entry.version, preview = f.widget.contextFilePreview, mounted = f.widget.callbacks();
    const gate = deferred(), entered = deferred(), refresh = f.a.listEditorDraftRecoveries.bind(f.a);
    f.a.listEditorDraftRecoveries = async () => { entered.resolve(); await gate.promise; return refresh(); };
    const target = join(f.root, 'must-not-open.txt');
    const opening = f.widget.previewContextFile({ uri: pathToFileURL(target).href, path: target, name: 'must-not-open.txt', directory: false });
    await entered.promise;
    const text = 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES);
    mounted.onContentChange('current', text);
    const drafts = f.widget.contextFileDrafts;
    assert.equal(entry.version, version); assert.equal(f.widget.contextFileRecoveryUncaptured, true);
    gate.resolve(); await opening;
    assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
    assert.equal(f.widget.contextFileDrafts.current, text); assert.equal(f.widget.contextFileDirty, true);
    assert.equal(f.widget.contextFileRecoveryUncaptured, true); assert.deepEqual(f.fileEvents, []);
    assert.equal(f.widget.contextFilePreviewLoading, false); assert.equal(f.widget.contextFileOpening, undefined);
    assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
});

test('pending file header preserves the previous tab and backs up final mounted input before cancelling its lookup', async t => {
    const f = await fixture(t), ack = await f.persist(), preview = f.widget.contextFilePreview, mounted = f.widget.callbacks();
    // Exercise the actual tab capture guard, including its loading-placeholder distinction.
    delete f.widget.rememberContextFileTab;
    f.widget.rememberContextFileTab();
    const gate = deferred(), entered = deferred(), refresh = f.a.listEditorDraftRecoveries.bind(f.a);
    f.a.listEditorDraftRecoveries = async () => { entered.resolve(); await gate.promise; return refresh(); };
    const target = join(f.root, 'must-not-open.txt'), targetUri = pathToFileURL(target).href;
    const opening = f.widget.previewContextFile({ uri: targetUri, path: target, name: 'must-not-open.txt', directory: false });
    assert.equal(f.widget.contextFileOpening.uri, targetUri);
    assert.equal(f.widget.contextFilePreview, preview);
    assert.equal(f.widget.contextFilePreviewLoading, true);
    await entered.promise;
    mounted.onContentChange('current', 'final input before the loading placeholder mounts'); mounted.onDirty(true);
    assert.equal(f.widget.contextFileTabs.get(f.sourceUri).drafts.current, 'final input before the loading placeholder mounts');
    gate.resolve(); await opening; f.widget.captureContextEditorRecovery(); await f.controller.flushAll();
    assert.equal(f.widget.contextFilePreview, preview);
    assert.equal(f.widget.contextFilePreviewLoading, false); assert.equal(f.widget.contextFileOpening, undefined);
    assert.deepEqual(f.fileEvents, []);
    assert.equal((await f.b.openEditorDraftRecovery({ id: ack.id })).record.snapshot.drafts.current,
        'final input before the loading placeholder mounts');
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
});

for (const action of ['select-existing-tab', 'close-pending-tab']) {
    test(`${action} cancels a pending file lookup and leaves the original unsaved tab intact`, async t => {
        const f = await fixture(t); await f.persist();
        delete f.widget.rememberContextFileTab;
        f.widget.rememberContextFileTab();
        const preview = f.widget.contextFilePreview, drafts = f.widget.contextFileDrafts;
        const gate = deferred(), entered = deferred(), refresh = f.a.listEditorDraftRecoveries.bind(f.a);
        f.a.listEditorDraftRecoveries = async () => { entered.resolve(); await gate.promise; return refresh(); };
        const target = join(f.root, 'must-not-open.txt'), targetUri = pathToFileURL(target).href;
        const operation = {}; f.widget.checkpointFileOpenOperation = operation; f.widget.checkpointDiffLoading = true;
        const opening = f.widget.previewContextFile({ uri: targetUri, path: target, name: 'must-not-open.txt', directory: false }, undefined, operation);
        await entered.promise;
        assert.equal(f.widget.contextFileOpening.uri, targetUri);
        assert.equal(f.widget.contextFileTabs.has(targetUri), false, 'the pending header is not a loaded draft tab');
        const token = f.widget.contextFilePreviewRequestToken;
        if (action === 'select-existing-tab') assert.equal(f.widget.activateContextFileTab(f.sourceUri), true);
        else f.widget.closeContextFileTab(targetUri);
        assert.ok(f.widget.contextFilePreviewRequestToken > token);
        assert.equal(f.widget.contextFileOpening, undefined); assert.equal(f.widget.contextFilePreviewLoading, false);
        assert.equal(f.widget.checkpointFileOpenOperation, undefined); assert.equal(f.widget.checkpointDiffLoading, false);
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.widget.contextFileTabs.get(f.sourceUri).drafts.current, 'unsaved current');
        gate.resolve(); await opening;
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.widget.contextFileOpening, undefined); assert.equal(f.widget.contextFilePreviewLoading, false);
        assert.deepEqual(f.fileEvents, []);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
    });
}

test('closing the only pending file header closes the empty drawer and prevents its delayed read', async t => {
    const f = await fixture(t);
    delete f.widget.rememberContextFileTab;
    f.widget.contextFilePreview = undefined; f.widget.contextFileDrafts = {}; f.widget.contextFileDirty = false;
    f.widget.workContextOpen = false;
    const gate = deferred(), entered = deferred(), refresh = f.a.listEditorDraftRecoveries.bind(f.a);
    f.a.listEditorDraftRecoveries = async () => { entered.resolve(); await gate.promise; return refresh(); };
    const target = join(f.root, 'must-not-open.txt'), targetUri = pathToFileURL(target).href;
    const opening = f.widget.previewContextFile({ uri: targetUri, path: target, name: 'must-not-open.txt', directory: false });
    await entered.promise;
    assert.equal(f.widget.workContextOpen, true); assert.equal(f.widget.contextFileTabs.size, 0);
    f.widget.closeContextFileTab(targetUri);
    assert.equal(f.widget.workContextOpen, false); assert.equal(f.widget.contextFileOpening, undefined);
    assert.equal(f.widget.contextFilePreviewLoading, false);
    gate.resolve(); await opening;
    assert.equal(f.widget.contextFilePreview, undefined); assert.equal(f.widget.contextFileTabs.size, 0);
    assert.deepEqual(f.fileEvents, []);
});

test('internal preview activation keeps its checkpoint operation while retaining the existing current draft', async t => {
    const f = await fixture(t); await f.persist();
    delete f.widget.rememberContextFileTab;
    const node = { uri: f.sourceUri, path: f.sourceFile, name: 'only.txt', directory: false }, operation = {};
    f.widget.checkpointFileOpenOperation = operation; f.widget.checkpointDiffLoading = true;
    assert.equal(f.widget.beginContextFileOpen(node), true);
    const token = f.widget.contextFilePreviewRequestToken;
    await f.widget.previewContextFile(node, undefined, operation);
    assert.equal(f.widget.checkpointFileOpenOperation, operation, 'internal activation must not cancel its own checkpoint opener');
    assert.equal(f.widget.checkpointDiffLoading, true, 'the owning checkpoint opener finishes this state');
    assert.equal(f.widget.contextFilePreviewRequestToken, token);
    assert.equal(f.widget.contextFilePreview.uri, f.sourceUri);
    assert.equal(f.widget.contextFileDrafts.current, 'unsaved current'); assert.equal(f.widget.contextFileDirty, true);
    assert.equal(f.widget.contextFileOpening, undefined); assert.equal(f.widget.contextFilePreviewLoading, false);
    assert.deepEqual(f.fileEvents, []);
});

for (const waitingAt of ['open-metadata', 'open-source', 'preview-metadata']) {
    test(`already-mounted editor callbacks retain input while ${waitingAt} is waiting`, async t => {
        const f = await fixture(t); await f.persist();
        const mounted = f.widget.callbacks(), preview = f.widget.contextFilePreview;
        const gate = deferred(), entered = deferred();
        if (waitingAt === 'open-metadata') {
            const read = f.a.openEditorDraftRecovery.bind(f.a);
            f.a.openEditorDraftRecovery = async request => { entered.resolve(); await gate.promise; return read(request); };
        } else if (waitingAt === 'open-source') {
            const read = f.widget.fileService.read;
            f.widget.fileService.read = async (...args) => { entered.resolve(); await gate.promise; return read(...args); };
        } else {
            const list = f.a.listEditorDraftRecoveries.bind(f.a);
            f.a.listEditorDraftRecoveries = async () => { entered.resolve(); await gate.promise; return list(); };
        }
        const target = join(f.root, 'must-not-open.txt');
        const opening = waitingAt === 'preview-metadata'
            ? f.widget.previewContextFile({ uri: pathToFileURL(target).href, path: target, name: 'must-not-open.txt', directory: false })
            : f.widget.openContextEditorRecovery('local-A');
        await entered.promise;
        const text = 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES);
        // Deliberately use props from the model already mounted before the await, not a fabricated rerender.
        mounted.onContentChange('current', text); mounted.onDirty(true);
        gate.resolve(); await opening;
        assert.ok(f.widget.contextFileDrafts.current === text, 'The already-visible editor input must not be ignored or replaced');
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDirty, true);
        assert.equal(f.widget.contextFileRecoveryUncaptured, true);
        assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
        if (waitingAt !== 'open-source') assert.deepEqual(f.fileEvents, [], 'Superseded metadata must not start a source read');
        assert.equal(f.fileEvents.includes('WRITE'), false); assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
    });
}

test('mounted input within quota is captured and reaches the Node backup while an older open is pending', async t => {
    const f = await fixture(t), ack = await f.persist(), mounted = f.widget.callbacks(), preview = f.widget.contextFilePreview;
    const gate = deferred(), entered = deferred(), read = f.a.openEditorDraftRecovery.bind(f.a);
    f.a.openEditorDraftRecovery = async request => { entered.resolve(); await gate.promise; return read(request); };
    const opening = f.widget.openContextEditorRecovery('local-A'); await entered.promise;
    mounted.onContentChange('current', 'within-quota typing from the still-mounted model');
    gate.resolve(); await opening; f.widget.captureContextEditorRecovery(); await f.controller.flushAll();
    assert.equal(f.widget.contextFilePreview, preview);
    assert.equal(f.widget.contextFileDrafts.current, 'within-quota typing from the still-mounted model');
    assert.equal(f.widget.contextFileRecoveryUncaptured, false); assert.equal(f.controller.isConfirmed('local-A'), true);
    assert.equal((await f.b.openEditorDraftRecovery({ id: ack.id })).record.snapshot.drafts.current,
        'within-quota typing from the still-mounted model');
    assert.deepEqual(f.fileEvents, []); assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
});

test('after actual same-URI recovery reopen or another file opens the old mounted callbacks cannot write', async t => {
    for (const destination of ['same-uri', 'other-file']) {
        const f = await fixture(t); await f.persist();
        const mounted = f.widget.callbacks(), previous = f.widget.contextFilePreview;
        if (destination === 'same-uri') await f.widget.openContextEditorRecovery('local-A');
        else {
            const target = join(f.root, 'other.txt'); await fs.writeFile(target, 'other baseline', { flag: 'wx' });
            await f.widget.previewContextFile({ uri: pathToFileURL(target).href, path: target, name: 'other.txt', directory: false });
        }
        const replacement = f.widget.contextFilePreview, drafts = f.widget.contextFileDrafts;
        const dirty = f.widget.contextFileDirty, side = f.widget.contextFileActiveSide;
        assert.notEqual(replacement, previous);
        mounted.onContentChange('current', 'late old model text'); mounted.onDirty(!dirty);
        mounted.onFocus('before'); mounted.onSave('current', 'late old save');
        assert.equal(f.widget.contextFilePreview, replacement); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.widget.contextFileDirty, dirty); assert.equal(f.widget.contextFileActiveSide, side);
        assert.equal(f.widget.pendingFileSave, undefined); assert.equal(f.fileEvents.includes('WRITE'), false);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
    }
});

test('a delayed backup listing cannot start an old-owner preview or read its source after navigation', async t => {
    for (const change of ['session', 'generation', 'restore']) {
        const f = await fixture(t), gate = deferred();
        f.widget.contextFilePreview = undefined; f.widget.contextFileDirty = false; f.widget.contextFileDrafts = {};
        const original = f.a.listEditorDraftRecoveries.bind(f.a);
        f.a.listEditorDraftRecoveries = async () => { await gate.promise; return original(); };
        const opening = f.widget.previewContextFile({ uri: f.sourceUri, path: f.sourceFile, name: 'only.txt' }, 1);
        await idle();
        const replacement = { uri: 'file:///synthetic/new.txt', recoveryKey: 'B', content: 'new baseline' };
        f.widget.contextFilePreview = replacement; f.widget.contextFileDrafts = { current: 'new owner text' };
        if (change === 'session') f.widget.activeCodingSessionId = 'session-B';
        else if (change === 'generation') f.widget.contextFilePreviewRequestToken++;
        else f.widget.codingViewRestoreToken++;
        gate.resolve(); await opening;
        assert.equal(f.widget.contextFilePreview, replacement); assert.equal(f.widget.contextFileDrafts.current, 'new owner text');
        assert.deepEqual(f.fileEvents, []);
    }
});

test('actual render callbacks reject stale preview keys and generations, and capture keeps the source owner', async t => {
    for (const change of ['key', 'generation', 'session']) {
        const f = await fixture(t), callbacks = f.widget.callbacks();
        const replacement = { ...f.widget.contextFilePreview, recoveryKey: change === 'key' ? 'new-preview' : 'local-A' };
        f.widget.contextFilePreview = replacement;
        if (change === 'generation') f.widget.contextFilePreviewRequestToken++;
        if (change === 'session') f.widget.activeCodingSessionId = 'session-B';
        f.widget.contextFileDrafts = { current: 'new view text' }; f.widget.contextFileDirty = false;
        callbacks.onContentChange('current', 'late old text'); callbacks.onDirty(true); callbacks.onSave('current', 'late saved text');
        assert.deepEqual(f.widget.contextFileDrafts, { current: 'new view text' }); assert.equal(f.widget.contextFileDirty, false);
        assert.equal(f.controller.entries.size, 0); assert.equal(f.widget.pendingFileSave, undefined);
    }
    const f = await fixture(t); await f.persist(); f.widget.activeCodingSessionId = 'session-B';
    f.widget.contextFileDrafts.current = 'original view still belongs to A';
    assert.equal(f.widget.captureContextEditorRecovery(), true); await f.controller.flushAll();
    assert.equal(f.controller.entries.get('local-A').snapshot.sessionId, 'session-A');
});

test('projectless undefined owner stays projectless before first capture and after a saved entry exists', async t => {
    for (const alreadyCaptured of [false, true]) {
        const f = await fixture(t);
        f.widget.activeCodingSessionId = '';
        f.widget.contextFilePreview = { ...f.widget.contextFilePreview, recoverySessionId: undefined };
        if (alreadyCaptured) {
            await f.persist();
            assert.equal(f.controller.entries.get('local-A').snapshot.sessionId, undefined);
        }
        f.widget.activeCodingSessionId = 'later-active-session';
        f.widget.contextFileDrafts = { current: 'still projectless draft', before: '' };
        assert.equal(f.widget.captureContextEditorRecovery(), true);
        assert.equal(f.controller.entries.get('local-A').snapshot.sessionId, undefined);
        await f.controller.flushAll();
        const id = f.controller.entries.get('local-A').ack.id;
        const result = (await f.b.openEditorDraftRecovery({ id })).record.snapshot;
        assert.equal(result.sessionId, undefined); assert.equal(result.drafts.current, 'still projectless draft');
        assert.equal(f.widget.contextFilePreview.recoverySessionId, undefined);
    }
});

test('late old privacy read preserves newer recovery policy in controller, settings, draft and actual mirror', async t => {
    const f = await fixture(t);
    f.controller.state = { ...f.controller.state, enabled: false, settingsRevision: 3 };
    const incoming = { requireZeroDataRetention: true, denyDataCollection: false, saveConversationHistory: true,
        saveFileEditorRecovery: true, fileEditorRecoveryRevision: 1 };
    f.widget.applyPrivacySettings(incoming);
    const expected = { ...incoming, denyDataCollection: true, saveFileEditorRecovery: false, fileEditorRecoveryRevision: 3 };
    assert.deepEqual(f.widget.privacySettings, expected); assert.deepEqual(f.widget.privacyDraft, expected);
    assert.equal(f.controller.state.enabled, false); assert.equal(f.controller.state.settingsRevision, 3);
    assert.deepEqual(JSON.parse(rendererStorage.get('nextmux.desktop.privacy.v1')), expected);
    assert.equal(incoming.saveFileEditorRecovery, true, 'Do not mutate the stale RPC result supplied by another observer');
    f.widget.contextFileDrafts.current = 'blocked by newer off policy';
    assert.equal(f.widget.captureContextEditorRecovery(), false);
    assert.equal(f.widget.contextFileRecoveryUncaptured, true);
});

test('equal/newer privacy reads apply normally and keep recovery mirror revision aligned', async t => {
    const f = await fixture(t);
    for (const revision of [3, 4]) {
        f.controller.state = { ...f.controller.state, enabled: false, settingsRevision: 3 };
        const incoming = { requireZeroDataRetention: false, denyDataCollection: true, saveConversationHistory: true,
            saveFileEditorRecovery: true, fileEditorRecoveryRevision: revision };
        f.widget.applyPrivacySettings(incoming);
        const expected = { ...incoming, requireZeroDataRetention: true };
        assert.deepEqual(f.widget.privacySettings, expected); assert.deepEqual(f.widget.privacyDraft, expected);
        assert.equal(f.controller.state.enabled, true); assert.equal(f.controller.state.settingsRevision, revision);
        assert.deepEqual(JSON.parse(rendererStorage.get('nextmux.desktop.privacy.v1')), expected);
    }
});

test('actual guarded scroll callback records its current URI but ignores events from a detached editor', async t => {
    const f = await fixture(t), callbacks = f.widget.callbacks(), position = { top: 210, left: 17 };
    callbacks.onScrollPositionChange(position);
    assert.deepEqual(f.events.filter(event => event?.scroll), [{ scroll: { uri: f.sourceUri, position } }]);
    f.widget.contextFilePreviewRequestToken++;
    f.widget.contextFilePreview = { ...f.widget.contextFilePreview };
    callbacks.onScrollPositionChange({ top: 999, left: 999 });
    assert.equal(f.events.filter(event => event?.scroll).length, 1);
});

test('discard uses the offered local/remote revision and cannot erase another window update', async t => {
    for (const remote of [false, true]) {
        const f = await fixture(t), ack = await f.persist(), oldSnapshot = structuredClone(f.controller.entries.get('local-A').snapshot);
        if (remote) {
            f.widget.editorDraftRecovery = f.controllerFor(f.b); await f.widget.editorDraftRecovery.refresh();
            f.widget.contextFilePreview = undefined; f.widget.contextFileDrafts = {}; f.widget.contextFileDirty = false;
        }
        const key = remote ? ack.id : 'local-A', entry = f.controller.entries.get('local-A');
        const version = remote ? `remote:${ack.id}:1` : `local:local-A:${entry.version}:${ack.revision}`;
        await f.b.saveEditorDraftRecovery({ id: ack.id, expectedRevision: ack.revision, mutationId: randomUUID(),
            snapshot: { ...oldSnapshot, drafts: { current: 'other window newest' } } });
        await f.widget.discardContextEditorRecovery(key, version);
        assert.equal(f.widget.editorDraftRecovery.error, 'EDITOR_RECOVERY_CONFLICT');
        assert.equal((await f.b.openEditorDraftRecovery({ id: ack.id })).record.snapshot.drafts.current, 'other window newest');
        assert.equal(f.fileEvents.includes('WRITE'), false);
    }
});

test('stale delete token cannot discard newly typed local content; successful explicit discard removes only the copy', async t => {
    const f = await fixture(t), ack = await f.persist(), entry = f.controller.entries.get('local-A');
    const token = `local:local-A:${entry.version}:${entry.ack.revision}`;
    f.widget.callbacks().onContentChange('current', 'new after confirmation opened');
    await f.widget.discardContextEditorRecovery('local-A', token);
    assert.equal(f.widget.editorDraftRecovery.error, 'EDITOR_RECOVERY_CONFLICT');
    assert.equal(f.widget.contextFileDrafts.current, 'new after confirmation opened');
    await f.controller.flushAll();
    const current = f.controller.entries.get('local-A');
    await f.widget.discardContextEditorRecovery('local-A', `local:local-A:${current.version}:${current.ack.revision}`);
    assert.equal(f.widget.contextFilePreview, undefined); assert.deepEqual(f.widget.contextFileDrafts, {});
    await assert.rejects(f.b.openEditorDraftRecovery({ id: ack.id }), /NOT_FOUND/);
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original'); assert.equal(f.fileEvents.includes('WRITE'), false);
});

test('old delete confirmation cannot remove an acknowledged copy while newer oversized or disabled text is uncaptured', async t => {
    for (const reason of ['large', 'disabled']) {
        const f = await fixture(t), ack = await f.persist(), entry = f.controller.entries.get('local-A');
        const version = entry.version, token = `local:local-A:${version}:${ack.revision}`;
        const recordBefore = (await f.b.openEditorDraftRecovery({ id: ack.id })).record;
        const preview = f.widget.contextFilePreview;
        let deletes = 0;
        const discard = f.a.discardEditorDraftRecovery.bind(f.a);
        f.a.discardEditorDraftRecovery = request => { deletes++; return discard(request); };
        if (reason === 'disabled') f.controller.state = { ...f.controller.state, enabled: false };
        const text = reason === 'large' ? 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES) : 'uncaptured after disabling';
        f.widget.callbacks().onContentChange('current', text);
        const drafts = f.widget.contextFileDrafts;
        assert.equal(entry.version, version, 'Admission rejection must leave the old controller version unchanged');
        assert.equal(f.controller.isConfirmed('local-A'), true);
        assert.equal(f.widget.contextFileRecoveryUncaptured, true);
        await f.widget.discardContextEditorRecovery('local-A', token);
        assert.equal(f.controller.error, 'EDITOR_RECOVERY_CONFLICT');
        assert.equal(deletes, 0, 'The stale confirmation must never dispatch a delete for a different current editor');
        assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.widget.contextFileDrafts.current, text); assert.equal(f.widget.contextFileDirty, true);
        assert.deepEqual((await f.b.openEditorDraftRecovery({ id: ack.id })).record, recordBefore);
        assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original'); assert.equal(f.fileEvents.includes('WRITE'), false);
    }
});

test('oversized input during delete keeps its editor and exit barrier even when the unchanged old version is removed', async t => {
    const f = await fixture(t), ack = await f.persist(), entry = f.controller.entries.get('local-A');
    const version = entry.version, preview = f.widget.contextFilePreview, gate = deferred(), entered = deferred();
    const discard = f.a.discardEditorDraftRecovery.bind(f.a);
    let deletes = 0;
    f.a.discardEditorDraftRecovery = async request => { deletes++; entered.resolve(); await gate.promise; return discard(request); };
    const deleting = f.widget.discardContextEditorRecovery('local-A', `local:local-A:${version}:${ack.revision}`);
    await entered.promise;
    const text = 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES);
    f.widget.callbacks().onContentChange('current', text);
    const drafts = f.widget.contextFileDrafts;
    assert.equal(entry.version, version, 'Oversized new input is absent from the controller, not from the editor');
    assert.equal(f.widget.contextFileRecoveryUncaptured, true);
    gate.resolve(); await deleting;
    assert.equal(deletes, 1); await assert.rejects(f.b.openEditorDraftRecovery({ id: ack.id }), /NOT_FOUND/);
    assert.equal(f.controller.entries.has('local-A'), false, 'Only the explicitly confirmed old copy was discarded');
    assert.equal(f.widget.contextFilePreview, preview); assert.equal(f.widget.contextFileDrafts, drafts);
    assert.equal(f.widget.contextFileDrafts.current, text); assert.equal(f.widget.contextFileDirty, true);
    assert.equal(f.widget.contextFileRecoveryUncaptured, true);
    assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
    await assert.rejects(f.widget.shutdownForApplicationExit(), /FILE_NOT_SAVED/);
    assert.equal(f.events.includes('terminate'), false);
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original'); assert.equal(f.fileEvents.includes('WRITE'), false);
});

test('new input during explicit deletion is retained and receives a new durable ID, not a resurrected deleted ID', async t => {
    const f = await fixture(t), ack = await f.persist(), entry = f.controller.entries.get('local-A'), gate = deferred();
    const original = f.a.discardEditorDraftRecovery.bind(f.a);
    f.a.discardEditorDraftRecovery = async request => { await gate.promise; return original(request); };
    const deleting = f.widget.discardContextEditorRecovery('local-A', `local:local-A:${entry.version}:${ack.revision}`);
    await idle(); f.widget.callbacks().onContentChange('current', 'typed while deletion pending');
    gate.resolve(); await deleting;
    assert.equal(f.widget.editorDraftRecovery.error, 'EDITOR_RECOVERY_CONFLICT');
    assert.equal(f.widget.contextFileDrafts.current, 'typed while deletion pending'); assert.equal(f.widget.contextFileDirty, true);
    await f.controller.flushAll(); const next = f.controller.entries.get('local-A').ack;
    assert.notEqual(next.id, ack.id);
    assert.equal((await f.b.openEditorDraftRecovery({ id: next.id })).record.snapshot.drafts.current, 'typed while deletion pending');
    await assert.rejects(f.b.openEditorDraftRecovery({ id: ack.id }), /NOT_FOUND/);
    assert.equal(f.fileEvents.includes('WRITE'), false);
});

test('late successful deletion cannot clear a replacement preview, even when it uses the same URI', async t => {
    const f = await fixture(t), ack = await f.persist(), entry = f.controller.entries.get('local-A'), gate = deferred();
    const original = f.a.discardEditorDraftRecovery.bind(f.a);
    f.a.discardEditorDraftRecovery = async request => { await gate.promise; return original(request); };
    const deleting = f.widget.discardContextEditorRecovery('local-A', `local:local-A:${entry.version}:${ack.revision}`);
    await idle();
    const replacement = { ...f.widget.contextFilePreview, recoveryKey: 'replacement', recoverySessionId: 'session-B' };
    f.widget.contextFilePreview = replacement; f.widget.activeCodingSessionId = 'session-B';
    f.widget.contextFilePreviewRequestToken++; f.widget.contextFileDrafts = { current: 'B unsaved bytes' };
    gate.resolve(); await deleting;
    assert.equal(f.widget.contextFilePreview, replacement); assert.equal(f.widget.contextFileDirty, true);
    assert.deepEqual(f.widget.contextFileDrafts, { current: 'B unsaved bytes' });
    await assert.rejects(f.b.openEditorDraftRecovery({ id: ack.id }), /NOT_FOUND/);
});

test('foreign Windows-path backup can be copied into a readonly view without opening or writing that source', async t => {
    const f = await fixture(t), allocated = await f.a.openEditorDraftRecovery({});
    const uri = 'file:///C:/synthetic-windows-only/33/missing.txt';
    const snapshot = { sessionId: 'old-windows-owner', sourceUri: uri, name: 'missing.txt',
        baseline: { current: 'original Windows bytes' }, drafts: { current: '' } };
    await f.a.saveEditorDraftRecovery({ id: allocated.id, expectedRevision: 0, mutationId: randomUUID(), snapshot });
    f.widget.contextFilePreview = undefined; f.widget.contextFileDrafts = {}; f.widget.contextFileDirty = false;
    await f.widget.openContextEditorRecovery(allocated.id);
    assert.equal(f.widget.contextFilePreview.readOnly, true); assert.equal(f.widget.contextFilePreview.recoverySessionId, 'old-windows-owner');
    assert.deepEqual(f.widget.contextFileDrafts, { current: '' }); assert.equal(f.widget.contextFileDirty, true);
    f.widget.callbacks().onSave('current', 'do not write Windows');
    assert.equal(f.widget.pendingFileSave, undefined); assert.deepEqual(f.fileEvents, []);
});

test('readonly copy uses the active pane exact draft including empty text, or its independent baseline', async t => {
    const f = await fixture(t); await f.persist(); f.widget.contextFilePreview.readOnly = true;
    const writes = []; f.widget.clipboardService = { async writeText(value) { writes.push(value); } };
    const ack = structuredClone(f.controller.entries.get('local-A').ack);
    for (const [side, drafts, expected] of [
        ['before', { before: '', current: 'different' }, ''],
        ['current', { before: 'different', current: '' }, ''],
        ['before', { current: 'different' }, 'checkpoint'],
        ['current', { before: 'different' }, 'original'],
        ['before', { before: 'before draft', current: 'different' }, 'before draft']
    ]) {
        f.widget.contextFileActiveSide = side; f.widget.contextFileDrafts = drafts;
        await f.widget.copyContextEditorRecovery(); assert.equal(writes.at(-1), expected);
        assert.deepEqual(f.widget.contextFileDrafts, drafts); assert.equal(f.widget.contextFileDirty, true);
        assert.equal(f.widget.contextFilePreview.readOnly, true); assert.equal(f.widget.contextFileSaveStatus, 'idle');
        assert.deepEqual(f.controller.entries.get('local-A').ack, ack);
    }
    f.widget.contextFilePreview = { ...f.widget.contextFilePreview, beforeContent: undefined };
    f.widget.contextFileActiveSide = 'before'; f.widget.contextFileDrafts = { current: 'single pane text' };
    await f.widget.copyContextEditorRecovery(); assert.equal(writes.at(-1), 'single pane text');
    assert.equal(f.fileEvents.includes('WRITE'), false);
});

test('late clipboard success or failure cannot clear new owner input, recovery acknowledgement or exit refusal', async t => {
    for (const failed of [false, true]) {
        const f = await fixture(t); await f.persist(); const gate = deferred(), values = [];
        f.widget.contextFilePreview.readOnly = true; f.widget.contextFileActiveSide = 'current';
        f.widget.clipboardService = { writeText(value) { values.push(value); return gate.promise; } };
        const copying = f.widget.copyContextEditorRecovery();
        const next = { ...f.widget.contextFilePreview, recoveryKey: 'B', recoverySessionId: 'session-B' };
        f.widget.activeCodingSessionId = 'session-B'; f.widget.contextFilePreview = next; f.widget.contextFilePreviewRequestToken++;
        f.widget.contextFileDrafts = { current: 'B newest unsaved text' }; f.widget.contextFileRecoveryUncaptured = true;
        const oldAck = structuredClone(f.controller.entries.get('local-A').ack);
        if (failed) gate.reject(new Error('SYNTHETIC_PRIVATE_CLIPBOARD_ERROR')); else gate.resolve();
        await copying;
        assert.deepEqual(values, ['unsaved current']); assert.equal(f.widget.contextFilePreview, next);
        assert.deepEqual(f.widget.contextFileDrafts, { current: 'B newest unsaved text' }); assert.equal(f.widget.contextFileDirty, true);
        assert.equal(f.widget.contextFileRecoveryUncaptured, true); assert.deepEqual(f.controller.entries.get('local-A').ack, oldAck);
        assert.throws(() => f.widget.assertApplicationExitSaved(1), /FILE_NOT_SAVED/);
        assert.deepEqual(f.notices.at(-1), [failed ? 'error' : 'success', 'title', failed ? 'failed' : 'copied', 'session-A']);
        assert.doesNotMatch(JSON.stringify(f.notices), /SYNTHETIC_PRIVATE|newest unsaved|unsaved current/);
    }
});

test('copy helper rejects writable, image, error, loading and missing previews before clipboard access', async t => {
    const f = await fixture(t), original = f.widget.contextFilePreview;
    f.widget.clipboardService = { writeText() { assert.fail('invalid preview must not reach clipboard'); } };
    for (const preview of [undefined, original, { ...original, readOnly: true, kind: 'image' }, { ...original, readOnly: true, error: 'missing' }]) {
        f.widget.contextFilePreview = preview; await f.widget.copyContextEditorRecovery();
    }
    f.widget.contextFilePreview = { ...original, readOnly: true }; f.widget.contextFilePreviewLoading = true;
    await f.widget.copyContextEditorRecovery(); assert.deepEqual(f.notices, []); assert.deepEqual(f.fileEvents, []);
});

function editorFixture(drafts, readOnly = false) {
    const changes = [], dirty = [], saves = [], textareas = [], commands = [];
    const monaco = { KeyMod: { CtrlCmd: 256, Shift: 512 }, KeyCode: { KeyS: 1, KeyZ: 2, KeyY: 3 },
        editor: { EditorOption: { minimap: 'minimap' } } };
    const document = { createElement(tag) {
        assert.equal(tag, 'textarea'); const listeners = new Map();
        const textarea = { value: '', listeners, setAttribute() {}, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener() {} };
        return textarea;
    } };
    const names = ['normalizeModelEol', 'bindModel', 'applyInitialEditorDrafts', 'createFallbackEditor', 'createEditorSafely'];
    const Editor = compile(`class Editor { ${names.map(name => method('NextMuxFileEditor', name).getText(file)).join('\n')} }; return Editor;`, { monaco, document });
    const editor = new Editor();
    Object.assign(editor, { props: { name: 'only.txt', content: 'original', beforeContent: 'checkpoint', initialDrafts: drafts, readOnly,
        onContentChange: (side, value) => changes.push([side, value]), onDirty: value => dirty.push(value), onFocus() {}, onSave: (...args) => saves.push(args) },
        baselineBySide: new Map(), dirtyBySide: new Map(), disposables: [], fallbackDisposables: [], models: [], validateModel() {},
        host: { classList: { add() {} }, appendChild: textarea => textareas.push(textarea) },
        disposeEditor() { this.editor = undefined; this.models = []; }
    });
    const model = initial => {
        let value = initial; const handlers = [];
        return { getValue: () => value, setValue(next) { value = next; handlers.forEach(handler => handler()); },
            onDidChangeContent(handler) { handlers.push(handler); return { dispose() {} }; } };
    };
    const original = model('checkpoint'), modified = model('original');
    const surface = { onDidFocusEditorText: () => ({ dispose() {} }), onDidScrollChange: () => ({ dispose() {} }), addCommand: (key, callback) => commands.push({ key, callback }),
        onDidChangeConfiguration: () => ({ dispose() {} }), getOption: () => ({ enabled: true }), updateOptions() {} };
    editor.bindModel(original, 'before', surface); editor.bindModel(modified, 'current', surface);
    editor.models = [original, modified]; editor.editor = { getModifiedEditor() {}, getModel: () => ({ original, modified }) };
    return { editor, original, modified, changes, dirty, saves, textareas, commands };
}

test('actual Monaco initial drafts preserve empty strings and independent disk/before baselines', () => {
    for (const drafts of [{ current: '', before: 'changed before' }, { current: 'changed current', before: '' }]) {
        const f = editorFixture(drafts); f.editor.applyInitialEditorDrafts();
        assert.equal(f.original.getValue(), drafts.before); assert.equal(f.modified.getValue(), drafts.current);
        assert.deepEqual([...f.editor.baselineBySide], [['before', 'checkpoint'], ['current', 'original']]);
        assert.equal(f.dirty.at(-1), true);
        f.original.setValue('checkpoint'); assert.equal(f.dirty.at(-1), true, 'undoing before does not clean current');
        f.modified.setValue('original'); assert.equal(f.dirty.at(-1), false);
    }
});

test('actual Monaco failure fallback restores both draft sides and readonly save stays blocked', () => {
    const f = editorFixture({ before: '', current: 'restored text' }, true);
    f.editor.createEditor = () => { throw new Error('synthetic Monaco initialization failure'); };
    f.editor.createEditorSafely();
    assert.deepEqual(f.textareas.map(item => item.value), ['', 'restored text']);
    assert.equal(f.textareas.every(item => item.readOnly), true); assert.equal(f.dirty.at(-1), true);
    for (const textarea of f.textareas) textarea.listeners.get('keydown')({ ctrlKey: true, key: 's', preventDefault() {} });
    assert.deepEqual(f.saves, []);
    f.textareas[0].value = 'checkpoint'; f.textareas[0].listeners.get('input')(); assert.equal(f.dirty.at(-1), true);
    f.textareas[1].value = 'original'; f.textareas[1].listeners.get('input')(); assert.equal(f.dirty.at(-1), false);
});
