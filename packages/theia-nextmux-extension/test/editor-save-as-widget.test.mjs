import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { common, saveAsCommon, service } from './helpers/editor-recovery-source-loader.mjs';
import { requireCopyFallback } from './copy-fallback-module.mjs';
import { conversationAgentRunActive } from '../lib/browser/nextmux-conversation-agent-run.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let widgetClass;
function visit(node) { if (ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget') widgetClass = node; ts.forEachChild(node, visit); }
visit(file);
const method = name => {
    const found = widgetClass.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(file) === name);
    assert.ok(found, `actual production method ${name}`); return found;
};
const compile = (text, values = {}) => new Function(...Object.keys(values), ts.transpile(text, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(values));
function moduleFromSource(name, require) {
    const module = { exports: {} };
    compile(readFileSync(new URL(`../src/browser/${name}.ts`, import.meta.url), 'utf8'), { module, exports: module.exports, require });
    return module.exports;
}
const { EditorDraftRecoveryController, editorRecoveryDirty } = moduleFromSource('nextmux-editor-draft-recovery', () => common);
const { editorRecoveryText, editorSaveAsErrorKey } = moduleFromSource('nextmux-editor-recovery-locale', requireCopyFallback);
const render = method('renderWorkContext');
function* nodes(node) { yield node; for (const child of node.getChildren(file)) yield* nodes(child); }
const editor = [...nodes(render)].find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'NextMuxFileEditor');
assert.ok(editor);
const callbackNames = ['onDirty', 'onContentChange', 'onFocus'];
const callbacks = callbackNames.map(name => {
    const attribute = editor.attributes.properties.find(item => item.name?.getText(file) === name);
    assert.ok(attribute?.initializer?.expression); return `${name}: ${attribute.initializer.expression.getText(file)}`;
});
const prelude = render.body.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => ['preview', 'fileGeneration', 'isCurrentEditor'].includes(declaration.name.getText(file))))
    .map(statement => statement.getText(file)).join('\n');
const names = ['scheduleContextEditorRecoveryCapture', 'saveContextEditorRecoveryAsNewFile', 'captureContextEditorRecovery', 'assertApplicationExitSaved', 'shutdownForApplicationExit'];
const Widget = compile(`class Harness { ${names.map(name => method(name).getText(file)).join('\n')}
    callbacks() { ${prelude}; return { ${callbacks.join(',')} }; }
}; return Harness;`, {
    window: { setTimeout, clearTimeout }, conversationAgentRunActive, EDITOR_SAVE_AS_MAX_BYTES: saveAsCommon.EDITOR_SAVE_AS_MAX_BYTES, editorRecoveryText, editorSaveAsErrorKey, editorRecoveryDirty,
    requireDurablePastedTextReferences(prompt, refs) { assert.equal(prompt, ''); assert.deepEqual(refs, []); }
});
class RecoveryService extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    close() { return this.disposeConnectionResources(); }
}
const uri = pathname => pathToFileURL(pathname).href;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const idle = () => new Promise(setImmediate);
async function fixture(t, drafts = { current: 'edited current', before: '' }) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-save-as-widget-')));
    const sourceFile = join(root, 'source.txt'), target = join(root, 'selected.txt'); await fs.writeFile(sourceFile, 'original', { mode: 0o600 });
    const rpc = new RecoveryService(join(root, 'app-data')), controller = new EditorDraftRecoveryController(rpc);
    const widget = new Widget(), notices = [], events = [], dialogs = [], calls = [];
    Object.assign(widget, {
        activeCodingSessionId: 'session-A', codingSessions: [{ id: 'session-A', turns: [] }], desktopLocale: 'en',
        contextFilePreview: { uri: uri(sourceFile), name: 'source.txt', content: 'original', beforeContent: 'baseline before',
            revision: 0, readOnly: true, recoveryKey: 'local-A', recoverySessionId: 'session-A' },
        contextFileDrafts: drafts, contextFileActiveSide: 'current', contextFileDirty: true,
        contextFileTabs: new Map(), rememberContextFileTab() {},
        contextFilePreviewRequestToken: 1, contextFilePreviewLoading: false, contextFileRecoveryUncaptured: false,
        contextFileSaveStatus: 'idle', editorRecoveryBusy: false, applicationExitPreparing: false, applicationExitGeneration: 1,
        pendingContextFileWrites: new Set(), contextFileSavingUris: new Set(), conversationAgentRuns: new Map(),
        agentChildContinuationStates: new Map(), scheduledAgentRuns: new Map(), editorDraftRecovery: controller, editorRecoveryController: () => controller,
        platformService: { async saveEditorDraftAsNewFile(input) { calls.push(input); return rpc.saveEditorDraftAsNewFile(input); } },
        fileDialogService: { async showSaveDialog(options) { dialogs.push(options); return { toString: () => uri(target) }; } },
        update() {}, addNotification(...args) { notices.push(args); }, persistActiveCodingSessionState() { events.push('view-persist'); },
        flushComposerDraft() { events.push('composer'); }, async flushConversationHistory() { events.push('history'); },
        workspaceConfigurationSaver: { hasPendingChanges: false, async flush() { events.push('workspace'); } },
        pendingAttachmentImports: new Map(), pendingDraftAttachmentRestores: () => [], pastedTextPersistence: new Map(),
        unpersistedPastedTextReferences: new Map(), pruneUnpersistedPastedTextReferences() {}, prompt: '', pastedTextReferences: [],
        privacySettings: { saveConversationHistory: false }, pendingAgentSubmissions: new Set(), activeAgentRunId: '',
        terminalRecords: [{ id: 'synthetic-owned-terminal' }], persistTerminalRecords() { events.push('terminal-state'); },
        async terminateAndDisposeConversationTerminal() { events.push('terminal-disposed'); }
    });
    await controller.refresh(); assert.equal(widget.captureContextEditorRecovery(), true); await controller.flushAll();
    const ack = structuredClone(controller.entries.get('local-A').ack);
    const record = await rpc.openEditorDraftRecovery({ id: ack.id });
    t.after(async () => { clearTimeout(widget.contextEditorRecoveryCaptureTimer); controller.dispose(); await rpc.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, sourceFile, target, widget, rpc, controller, notices, events, dialogs, calls, ack, record,
        backup: () => rpc.openEditorDraftRecovery({ id: ack.id }) };
}
function assertViewIntact(f, drafts, preview) {
    assert.equal(f.widget.contextFileDrafts, drafts); assert.equal(f.widget.contextFilePreview, preview);
    assert.equal(f.widget.contextFileDirty, true); assert.equal(f.widget.contextFilePreview.readOnly, true);
    assert.equal(f.widget.contextFileSaveStatus, 'idle');
}

test('real widget → real Node RPC saves exact selected side including empty string; original/drafts/readonly/backup ack stay intact', async t => {
    for (const [side, drafts, expected] of [['current', { current: '中文🙂\r\n', before: 'other' }, '中文🙂\r\n'],
        ['before', { current: 'must not export', before: '' }, ''], ['current', { before: 'other side dirty' }, 'original'], ['before', { current: 'other side dirty' }, 'baseline before']]) {
        const f = await fixture(t, drafts), preview = f.widget.contextFilePreview; f.widget.contextFileActiveSide = side;
        const before = await fs.stat(f.sourceFile);
        await f.widget.saveContextEditorRecoveryAsNewFile();
        assert.equal(await fs.readFile(f.target, 'utf8'), expected);
        assert.deepEqual(f.calls, [{ sourceUri: uri(f.sourceFile), destinationUri: uri(f.target), content: expected }]);
        assertViewIntact(f, drafts, preview); assert.deepEqual(await f.backup(), f.record);
        assert.deepEqual(f.controller.entries.get('local-A').ack, f.ack);
        assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original'); assert.equal((await fs.stat(f.sourceFile)).mtimeMs, before.mtimeMs);
        assert.equal(f.widget.pendingContextFileWrites.size, 0); assert.equal(f.widget.editorRecoveryBusy, false);
        assert.equal(f.notices.at(-1)[2], editorRecoveryText('en', 'savedAs'));
    }
});

test('before focus without a before version exports current side, never undefined or unrelated draft', async t => {
    const f = await fixture(t); f.widget.contextFilePreview = { ...f.widget.contextFilePreview, beforeContent: undefined };
    f.widget.contextFileActiveSide = 'before'; await f.widget.saveContextEditorRecoveryAsNewFile();
    assert.equal(await fs.readFile(f.target, 'utf8'), 'edited current'); assert.equal(f.calls[0].content, 'edited current');
});

test('picker cancellation sends no RPC and preserves both dirty editor and durable backup', async t => {
    const f = await fixture(t), drafts = f.widget.contextFileDrafts, preview = f.widget.contextFilePreview;
    f.widget.fileDialogService.showSaveDialog = async () => undefined;
    await f.widget.saveContextEditorRecoveryAsNewFile();
    assert.deepEqual(f.calls, []); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
    assertViewIntact(f, drafts, preview); assert.deepEqual(await f.backup(), f.record); assert.deepEqual(f.notices, []);
});

test('actual new-draft callback, navigation, preview generation and exit during picker cancel before any file RPC', async t => {
    for (const change of ['draft', 'session', 'preview', 'token', 'exit']) {
        const f = await fixture(t), picked = deferred();
        f.widget.fileDialogService.showSaveDialog = async () => picked.promise;
        const callbacks = f.widget.callbacks(), pending = f.widget.saveContextEditorRecoveryAsNewFile();
        assert.equal(f.widget.pendingContextFileWrites.size, 1);
        if (change === 'draft') callbacks.onContentChange('current', 'new while choosing');
        if (change === 'session') f.widget.activeCodingSessionId = 'session-B';
        if (change === 'preview') f.widget.contextFilePreview = { ...f.widget.contextFilePreview, name: 'new view' };
        if (change === 'token') f.widget.contextFilePreviewRequestToken++;
        if (change === 'exit') f.widget.applicationExitPreparing = true;
        picked.resolve({ toString: () => uri(f.target) }); await pending;
        assert.deepEqual(f.calls, []); await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
        if (change === 'draft') assert.equal(f.widget.contextFileDrafts.current, 'new while choosing');
        assert.equal(f.widget.contextFileDirty, true); assert.equal(f.widget.pendingContextFileWrites.size, 0);
        assert.equal(f.notices.at(-1)[2], editorRecoveryText('en', 'saveAsChanged'));
    }
});

test('input after actual Node staging starts remains dirty and backed up; export completes only its captured content', async t => {
    const f = await fixture(t), reached = deferred(), release = deferred(), originalLink = fs.link;
    const mock = t.mock.method(fs, 'link', async (...args) => { reached.resolve(); await release.promise; return originalLink(...args); });
    const callbacks = f.widget.callbacks(), preview = f.widget.contextFilePreview;
    const pending = f.widget.saveContextEditorRecoveryAsNewFile(); await reached.promise;
    assert.equal(f.widget.pendingContextFileWrites.size, 1);
    callbacks.onContentChange('current', 'new input after dispatch'); const latestDrafts = f.widget.contextFileDrafts;
    release.resolve(); await pending; mock.mock.restore(); f.widget.captureContextEditorRecovery(); await f.controller.flushAll();
    assert.equal(await fs.readFile(f.target, 'utf8'), 'edited current'); assertViewIntact(f, latestDrafts, preview);
    assert.equal((await f.backup()).record.snapshot.drafts.current, 'new input after dispatch');
    assert.equal(f.controller.entries.get('local-A').ack.revision, f.ack.revision + 1);
});

test('existing destination and arbitrary Node errors produce only fixed localized information without losing drafts', async t => {
    for (const failure of ['exists', 'same-source', 'secret']) {
        const f = await fixture(t), drafts = f.widget.contextFileDrafts, preview = f.widget.contextFilePreview;
        if (failure === 'exists') await fs.writeFile(f.target, 'foreign original');
        if (failure === 'same-source') f.widget.fileDialogService.showSaveDialog = async () => ({ toString: () => uri(f.sourceFile) });
        if (failure === 'secret') f.widget.platformService.saveEditorDraftAsNewFile = async () => { throw new Error('PRIVATE_BODY_AND_PATH_SENTINEL'); };
        await f.widget.saveContextEditorRecoveryAsNewFile(); assertViewIntact(f, drafts, preview);
        const key = failure === 'exists' ? 'saveAsExists' : failure === 'same-source' ? 'saveAsSource' : 'saveAsFailed';
        assert.equal(f.notices.at(-1)[2], editorRecoveryText('en', key));
        assert.equal(JSON.stringify(f.notices).includes('PRIVATE_BODY_AND_PATH_SENTINEL'), false);
        assert.deepEqual(await f.backup(), f.record); assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'original');
        if (failure === 'exists') assert.equal(await fs.readFile(f.target, 'utf8'), 'foreign original');
    }
});

test('16 MiB UTF-8 preflight rejects before a picker/RPC and does not silently drop the large dirty draft', async t => {
    for (const content of ['x'.repeat(saveAsCommon.EDITOR_SAVE_AS_MAX_BYTES + 1), '🙂'.repeat(saveAsCommon.EDITOR_SAVE_AS_MAX_BYTES / 4 + 1)]) {
        const f = await fixture(t); f.widget.contextFileDrafts = { current: content };
        const drafts = f.widget.contextFileDrafts; await f.widget.saveContextEditorRecoveryAsNewFile();
        assert.deepEqual(f.dialogs, []); assert.deepEqual(f.calls, []); assert.equal(f.widget.contextFileDrafts, drafts);
        assert.equal(f.notices.at(-1)[2], editorRecoveryText('en', 'saveAsTooLarge'));
        assert.equal(f.widget.editorRecoveryBusy, false); assert.equal(f.widget.pendingContextFileWrites.size, 0);
    }
});

test('double click is locked and the same pending Promise covers both dialog and actual Node publish', async t => {
    const f = await fixture(t), picked = deferred(), reached = deferred(), release = deferred(), originalLink = fs.link;
    let dialogs = 0; f.widget.fileDialogService.showSaveDialog = async () => { dialogs++; return picked.promise; };
    const mock = t.mock.method(fs, 'link', async (...args) => { reached.resolve(); await release.promise; return originalLink(...args); });
    const pending = f.widget.saveContextEditorRecoveryAsNewFile(), tracked = [...f.widget.pendingContextFileWrites][0];
    await f.widget.saveContextEditorRecoveryAsNewFile(); assert.equal(dialogs, 1); assert.equal(f.widget.editorRecoveryBusy, true);
    picked.resolve({ toString: () => uri(f.target) }); await reached.promise;
    assert.equal([...f.widget.pendingContextFileWrites][0], tracked); assert.equal(f.calls.length, 1);
    await f.widget.saveContextEditorRecoveryAsNewFile(); assert.equal(dialogs, 1);
    release.resolve(); await pending; mock.mock.restore();
    assert.equal(f.widget.pendingContextFileWrites.size, 0); assert.equal(f.widget.editorRecoveryBusy, false);
});

test('real shutdown joins already dispatched Save As and cannot dispose terminals before publication', async t => {
    const f = await fixture(t), reached = deferred(), release = deferred(), originalLink = fs.link;
    const mock = t.mock.method(fs, 'link', async (...args) => { reached.resolve(); await release.promise; return originalLink(...args); });
    const saving = f.widget.saveContextEditorRecoveryAsNewFile(); await reached.promise;
    f.widget.applicationExitPreparing = true; let exited = false;
    const exiting = f.widget.shutdownForApplicationExit().then(() => { exited = true; });
    await idle(); assert.equal(exited, false); assert.equal(f.events.includes('terminal-disposed'), false);
    release.resolve(); await Promise.all([saving, exiting]); mock.mock.restore();
    assert.equal(exited, true); assert.equal(await fs.readFile(f.target, 'utf8'), 'edited current');
    assert.equal(f.events.includes('terminal-disposed'), true); assert.equal(f.widget.contextFileDirty, true);
    assert.deepEqual(await f.backup(), f.record);
});

test('real shutdown also waits for open dialog and conservatively rejects a stale-picker cancellation, preserving backup', async t => {
    const f = await fixture(t), picked = deferred(); f.widget.fileDialogService.showSaveDialog = async () => picked.promise;
    const saving = f.widget.saveContextEditorRecoveryAsNewFile(); f.widget.applicationExitPreparing = true;
    let settled = false;
    const exiting = f.widget.shutdownForApplicationExit().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    await idle(); assert.equal(settled, false); assert.equal(f.events.includes('terminal-disposed'), false);
    picked.resolve({ toString: () => uri(f.target) }); await saving;
    assert.equal((await exiting).message, 'APPLICATION_EXIT_FILE_NOT_SAVED'); assert.deepEqual(f.calls, []);
    assert.equal(f.events.includes('terminal-disposed'), false); assert.deepEqual(await f.backup(), f.record);
});

test('guarded non-editor/busy/loading/error/exit entry points cannot open a picker', async t => {
    const f = await fixture(t), original = f.widget.contextFilePreview;
    for (const changed of [{ contextFilePreview: undefined }, { contextFilePreview: { ...original, readOnly: false } },
        { contextFilePreview: { ...original, error: 'fixed' } }, { contextFilePreview: { ...original, kind: 'image' } },
        { contextFilePreviewLoading: true }, { editorRecoveryBusy: true }, { applicationExitPreparing: true }]) {
        Object.assign(f.widget, { contextFilePreview: original, contextFilePreviewLoading: false, editorRecoveryBusy: false, applicationExitPreparing: false }, changed);
        await f.widget.saveContextEditorRecoveryAsNewFile();
    }
    assert.deepEqual(f.dialogs, []); assert.deepEqual(f.calls, []);
});
