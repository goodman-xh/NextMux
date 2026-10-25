import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { service } from './helpers/editor-recovery-source-loader.mjs';

// Both sides of this regression use production methods: the renderer's actual
// mode transition/history writer and the backend's actual disk-backed mode CAS.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['incognitoModeIsBusy', 'requestIncognitoMode', 'confirmIncognitoMode', 'applyIncognitoMode',
    'refreshConversationHistoryPersistDirty', 'flushConversationHistory', 'unstartedCodingDraft', 'draftWorkspaceCanChange', 'bindCodingDraftWorkspace'].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name); return method.getText(file);
}).join('\n');
const transpile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const persistence = {};
new Function('exports', transpile(readFileSync(new URL('../src/browser/nextmux-conversation-persistence.ts', import.meta.url), 'utf8')))(persistence);
const historySource = readFileSync(new URL('../src/browser/nextmux-conversation-history.ts', import.meta.url), 'utf8');
const historyFile = ts.createSourceFile('history.ts', historySource, ts.ScriptTarget.Latest, true);
const portableNode = historyFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'portableConversationHistorySessions');
const portable = {};
new Function('exports', transpile(portableNode.getText(historyFile)))(portable);
const window = { nextmuxDesktop: { async setIncognitoConversationMode() { return true; } } };
const bindings = { ...persistence, ...portable, window, requestAnimationFrame: callback => callback(),
    incognitoText: (_locale, key) => key, NEXTMUX_DESKTOP_LOCALES: [['en']],
    historyReadinessText: (_locale, key) => key, desktopDomainErrorText: (_locale, error) => String(error), workbenchText: (_locale, key) => key };
const Harness = new Function(...Object.keys(bindings), `${transpile(`class Harness { ${methods} }`)}; return Harness;`)(...Object.values(bindings));
class Host extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
}
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(t, { attachment = false } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nm-toggle-renderer-cas-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const host = new Host(root), owned = await host.createIncognitoConversation();
    const first = { id: owned.id, workspacePath: '', ownedWorkspace: true, incognito: true, incognitoOrigin: true,
        incognitoRevision: 0, title: 'Synthetic regression', turns: [], draftPrompt: '', createdAt: 1, updatedAt: 2,
        historyLoaded: true, privateWorkspacePath: owned.workspaceRoot };
    await host.patchConversationHistory({ upserts: portable.portableConversationHistorySessions([first]), removedSessionIds: [] });
    if (attachment) {
        const cached = await host.cacheDesktopAttachment({ name: 'synthetic.txt', mimeType: 'text/plain',
            dataBase64: Buffer.from('synthetic attachment').toString('base64'), conversationId: first.id, workspaceRoot: owned.workspaceRoot });
        first.draftAttachments = [{ id: 'attachment', name: 'synthetic.txt', mimeType: 'text/plain', ...cached }];
        await host.patchConversationHistory({ upserts: portable.portableConversationHistorySessions([first]), removedSessionIds: [] });
    }
    const patches = [], errors = [], state = new Harness();
    Object.assign(state, {
        desktopLocale: 'en', activeCodingSessionId: first.id, codingSessions: [first],
        conversationHistoryPersistedSessions: new Map([[first.id, first]]),
        conversationHistoryPersistDirty: false, conversationHistoryRevision: 0,
        conversationHistoryPersistenceReady: true, conversationHistorySaveErrorShown: false,
        privacySettings: { saveConversationHistory: true }, incognitoModeError: '', applicationExitPreparing: false,
        agentChildContinuationStates: new Map(), pendingAttachmentImports: new Map(), draftAttachmentRestores: new Map(),
        pastedTextPersistence: new Map(), unpersistedPastedTextReferences: new Map(), tiledCodingSessionIds: new Set(),
        prompt: '', attachments: [], conversationHasActiveRun() { return false; },
        conversationHistoryReady() { return true; }, async hydrateCodingSession(id) { return this.codingSessions.find(item => item.id === id); },
        hasPendingAttachmentImports() { return false; }, hasUnresolvedDraftAttachments() { return false; },
        flushComposerDraft() {}, restoreComposerDraft(session) { this.prompt = session.draftPrompt; this.attachments = session.draftAttachments || []; },
        persistCodingSessions() { this.conversationHistoryRevision++; this.refreshConversationHistoryPersistDirty(); },
        scheduleConversationHistoryPersist() {}, refreshIncognitoModeCaches() {}, update() {},
        setProjectVisible() {}, expandedCodingProjects: new Set(), async resetDraftWorkspaceView() {}, detachContextEditorRecovery() { return true; }, persistDesktopRestoreState() {},
        addNotification(...value) { errors.push(value); }, node: { querySelector() { return null; } },
        platformService: {
            setConversationIncognito: request => host.setConversationIncognito(request),
            bindConversationDraftWorkspace: request => host.bindConversationDraftWorkspace(request),
            async patchConversationHistory(request) { patches.push(request); return host.patchConversationHistory(request); }
        }
    });
    const toggle = async enabled => {
        state.requestIncognitoMode(first.id);
        assert.equal(state.pendingIncognitoMode.enabled, enabled);
        await state.confirmIncognitoMode();
        assert.equal(state.incognitoModeError, '', JSON.stringify(errors));
        assert.equal(state.codingSessions[0].incognito, enabled);
    };
    const edit = changes => {
        const current = state.codingSessions[0];
        state.codingSessions[0] = { ...current, ...changes, updatedAt: current.updatedAt + 1 };
        state.persistCodingSessions();
    };
    return { root, host, state, first, patches, errors, toggle, edit };
}

test('empty same-ID private-to-normal adopts its committed timestamp without a redundant history rewrite', async t => {
    const { state, first, patches, errors, toggle } = await fixture(t);
    for (const [index, enabled] of [false].entries()) {
        await toggle(enabled);
        assert.equal(state.codingSessions[0].id, first.id);
        assert.equal(state.codingSessions[0].incognitoRevision, index + 1);
        assert.equal(state.conversationHistoryPersistedSessions.get(first.id), state.codingSessions[0]);
        await state.flushConversationHistory();
        assert.equal(state.conversationHistoryPersistDirty, false);
    }
    assert.equal(patches.length, 0); assert.deepEqual(errors, []);
});

test('private-to-normal then immediate draft edits and flush preserve text and actual attachment bytes', async t => {
    const { state, host, first, patches, errors, toggle, edit } = await fixture(t, { attachment: true });
    const attachment = first.draftAttachments[0];
    await toggle(false);
    for (const draft of ['after close', 'second edit', 'third edit']) {
        const enabled = false;
        const canonicalUpdatedAt = state.codingSessions[0].updatedAt;
        edit({ draftPrompt: draft });
        await state.flushConversationHistory();
        assert.equal(state.conversationHistoryPersistDirty, false, JSON.stringify(errors));
        assert.equal(patches.at(-1).baseUpdatedAt[first.id], canonicalUpdatedAt);
        const durable = await host.readConversationHistorySession(first.id);
        assert.equal(durable.draftPrompt, draft);
        assert.equal(durable.incognito, enabled);
        assert.equal(durable.draftAttachments[0].uri, attachment.uri);
        assert.equal(await readFile(fileURLToPath(attachment.uri), 'utf8'), 'synthetic attachment');
    }
    assert.equal(patches.length, 3); assert.deepEqual(errors, []);
});

test('post-toggle view metadata save uses the new mode baseline even with an empty composer', async t => {
    const { state, host, first, toggle, edit, errors } = await fixture(t);
    await toggle(false);
    edit({ viewState: { conversationScrollTop: 12 }, viewStateUpdatedAt: Date.now() });
    await state.flushConversationHistory();
    assert.equal(state.conversationHistoryPersistDirty, false, JSON.stringify(errors));
    assert.deepEqual((await host.readConversationHistorySession(first.id)).viewState, { conversationScrollTop: 12 });
});

test('an already-running save is drained before mode commit and cannot restore the old baseline', async t => {
    const { state, host, first, toggle, edit } = await fixture(t), gate = defer();
    edit({ draftPrompt: 'saved before switching' });
    const original = state.platformService.patchConversationHistory;
    state.platformService.patchConversationHistory = async request => { await gate.promise; return original(request); };
    const saving = state.flushConversationHistory(), switching = toggle(false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await host.readConversationHistorySession(first.id)).incognito, true);
    gate.resolve(); await Promise.all([saving, switching]);
    assert.equal(state.conversationHistoryPersistedSessions.get(first.id), state.codingSessions[0]);
    assert.equal(state.conversationHistoryPersistDirty, false);
    assert.equal(state.codingSessions[0].draftPrompt, 'saved before switching');
});

test('a failed mode RPC cannot advance the acknowledged baseline or lose the draft', async t => {
    const { state, first, toggle } = await fixture(t);
    state.platformService.setConversationIncognito = async () => { throw new Error('synthetic mode failure'); };
    state.requestIncognitoMode(first.id); await state.confirmIncognitoMode();
    assert.equal(state.incognitoModeError, 'failed');
    assert.equal(state.conversationHistoryPersistedSessions.get(first.id), first);
    assert.equal(state.codingSessions[0], first); assert.equal(state.codingSessions[0].incognito, true);
});

test('actual renderer binds a retained normal draft to a real project, then saves and unbinds without losing its attachment', async t => {
    const { state, root, host, first, toggle, edit, errors } = await fixture(t, { attachment: true });
    const project = join(root, 'external-project'); await mkdir(project);
    await toggle(false);
    assert.equal(await state.bindCodingDraftWorkspace(first.id, project), true, JSON.stringify(errors));
    assert.equal(state.codingSessions[0].workspacePath, project); assert.equal(state.codingSessions[0].privateWorkspacePath, undefined);
    assert.equal(state.codingSessions[0].ownedWorkspace, false); assert.equal(state.activeCodingSessionId, first.id);
    edit({ draftPrompt: 'same owner after binding' }); await state.flushConversationHistory();
    assert.equal(state.conversationHistoryPersistDirty, false, JSON.stringify(errors));
    const bound = await host.readConversationHistorySession(first.id);
    assert.equal(bound.draftPrompt, 'same owner after binding'); assert.equal(bound.workspacePath, project);
    assert.equal(await readFile(fileURLToPath(bound.draftAttachments[0].uri), 'utf8'), 'synthetic attachment');
    assert.equal(await state.bindCodingDraftWorkspace(first.id, ''), true);
    assert.equal(state.codingSessions[0].ownedWorkspace, true); assert.equal(state.codingSessions[0].workspacePath, '');
    assert.equal(state.codingSessions[0].id, first.id);
    assert.equal((await host.readConversationHistorySession(first.id)).draftAttachments[0].uri, first.draftAttachments[0].uri);
    assert.deepEqual(errors, []);
});
