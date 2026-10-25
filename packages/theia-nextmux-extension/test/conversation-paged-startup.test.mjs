import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

// This fixture executes the current startup method and its real merge/retry/
// persistence helpers. It intentionally does not rebuild or modify the widget.
const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
function sourceModule(name) {
    const { outputFiles } = desktopRequire('esbuild').buildSync({
        entryPoints: [fileURLToPath(new URL(`../src/browser/${name}.ts`, import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
    });
    const module = { exports: {} };
    Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}
const history = sourceModule('nextmux-conversation-history');
const persistence = sourceModule('nextmux-conversation-persistence');
const queue = sourceModule('nextmux-agent-task-queue');
const retry = sourceModule('nextmux-history-load');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(declaration);
const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'loadDurableCodingSessions');
assert.ok(method);
const fields = declaration.members.filter(node => ts.isPropertyDeclaration(node)
    && /^(conversationHistoryInitialSnapshot|conversationHistoryLoadGeneration|conversationHistoryPersistedSessions|conversationHistoryPersistenceReady|conversationHistoryLoadFailed|codingSessionPage|codingSessions|removedCodingSessionIds|conversationHistoryMirrorLegacy|isDisposed|privacySettings|conversationHistoryLoadPromise)/.test(node.name.getText(file)))
    .map(node => node.getText(file)).join('\n');
const bindings = {
    ...history, ...persistence, ...queue, ...retry,
    DEFAULT_PRIVACY_SETTINGS: { saveConversationHistory: true },
    createConversationPersistenceBaseline: persistence.createConversationPersistenceBaseline,
    hasLegacyToolActivityQueueRecords: () => false,
    window: { setTimeout: callback => { callback(); return 1; }, clearTimeout() {} },
    crypto: { randomUUID: () => 'recovered-draft' }
};
const Widget = Function(...Object.keys(bindings), ts.transpile(`class Harness { ${fields}\n${method.getText(file)} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(bindings));

const full = (id, response = `FULL_${id}`) => ({ id, title: `Title ${id}`, workspacePath: '/project',
    pinned: false, historyLoaded: true, createdAt: 1, updatedAt: 10, permissionMode: 'full_access',
    turns: [{ id: `${id}-turn`, prompt: `prompt-${id}`, response, error: '', stage: 'complete', createdAt: 1 }]
});
const header = record => ({ ...record, historyLoaded: false, turns: [] });
const compact = record => ({ ...record, historyLoaded: true, turns: [{ ...record.turns[0], response: 'COMPACT' }] });

function fixture() {
    const old = full('old', 'ORIGINAL_OLD_BODY');
    const currentMirror = compact(old);
    const draft = { id: 'new-draft', title: 'Draft', workspacePath: '', turns: [], createdAt: 20, updatedAt: 20, pinned: false, historyLoaded: true };
    const initialSnapshot = { sessions: [currentMirror], complete: false, revision: 0 };
    const reads = [], patches = [], durable = new Map([['old', structuredClone(old)], ['new-draft', undefined]]);
    const widget = Object.assign(new Widget(), {
        privacySettings: { saveConversationHistory: true }, conversationHistoryLoadGeneration: 1,
        conversationHistoryInitialSnapshot: initialSnapshot, conversationHistoryRevision: 0,
        conversationHistoryPersistedSessions: persistence.createConversationPersistenceBaseline([currentMirror]),
        codingSessions: [currentMirror, draft], activeCodingSessionId: 'old', pendingDesktopRestoreState: undefined,
        removedCodingSessionIds: new Set(), conversationHistoryMirrorLegacy: false, isDisposed: false,
        codingSessionPageCursors: new Map(), codingSessionPagesLoaded: new Set(),
        normalizeCodingSessions: records => records.map(record => ({ ...record })),
        update() {}, writeConversationHistoryMirror() {}, addNotification(...args) { throw new Error(`unexpected notification: ${args.join(' ')}`); },
        refreshConversationHistoryPersistDirty() {}, scheduleConversationHistoryPersist() {}, discardInitialConversationMirror() {},
        activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); },
        hydrateDelegationLedgersForSession() {}, expandedCodingProjects: new Set(),
        async loadNextCodingSessionsPage() {}, async loadNextCodingHistoryProjects() {},
        platformService: {
            async listConversationHistory() { return { sessions: [header(full('newest'))], total: 2, nextCursor: 'cursor' }; },
            async readConversationHistorySession(id) { reads.push(id); return id === 'old' ? structuredClone(old) : undefined; },
            async patchConversationHistory(patch) { patches.push(structuredClone(patch)); }
        }
    });
    return { widget, old, draft, reads, patches, durable };
}

test('startup restores an old page-out mirror body before persistence and keeps a new draft writable', async () => {
    const f = fixture();
    await f.widget.loadDurableCodingSessions(1);
    assert.equal(f.widget.conversationHistoryPersistenceReady, true);
    assert.deepEqual(f.reads, ['old'], 'the page-out mirror is read through the durable session API');
    assert.equal(f.widget.codingSessions.find(session => session.id === 'old').turns[0].response, 'ORIGINAL_OLD_BODY');
    assert.deepEqual(f.patches, [], 'recovery of old mirror data never rewrites a compact snapshot');
    const draft = f.widget.codingSessions.find(session => session.id === 'new-draft');
    assert.ok(draft, 'a session created after the mirror remains in renderer state');
    const changes = persistence.conversationPersistenceChanges(f.widget.codingSessions, f.widget.conversationHistoryPersistedSessions);
    assert.deepEqual(changes.removedSessionIds, []);
    assert.deepEqual(changes.upserts.map(session => session.id), ['new-draft']);
    assert.equal(changes.upserts.some(session => session.id === 'old'), false, 'old recovery is already baselined with full turns');
});

test('startup recovery batches initial ids and includes the active session even when absent from the first page', async () => {
    const f = fixture();
    f.widget.conversationHistoryInitialSnapshot = { sessions: [], complete: false, revision: 0 };
    f.widget.activeCodingSessionId = 'old';
    await f.widget.loadDurableCodingSessions(1);
    assert.deepEqual(f.reads, ['old']);
    assert.equal(f.widget.codingSessions.find(session => session.id === 'old').turns[0].response, 'ORIGINAL_OLD_BODY');
});

test('a header in the first page cannot replace the original turns of a startup mirror', async () => {
    const f = fixture();
    f.old.turns = Array.from({ length: 9 }, (_, i) => ({ ...f.old.turns[0], id: `turn-${i}`, createdAt: i, response: `BODY_${i}_`.repeat(1000) }));
    const mirror = { ...f.old, turns: [{ ...f.old.turns.at(-1), response: 'COMPACT' }] };
    f.widget.conversationHistoryInitialSnapshot = { sessions: [mirror], complete: false, revision: 0 };
    f.widget.codingSessions = [mirror, f.draft];
    f.widget.platformService.readConversationHistorySession = async id => { f.reads.push(id); return structuredClone(f.old); };
    f.widget.platformService.listConversationHistory = async () => ({ sessions: [header(f.old)], total: 1, status: 'ready' });
    await f.widget.loadDurableCodingSessions(1);
    assert.equal(f.widget.conversationHistoryPersistenceReady, true);
    assert.deepEqual(f.widget.codingSessions.find(session => session.id === 'old').turns.slice(0, 9), f.old.turns);
    const writes = persistence.conversationPersistenceChanges(f.widget.codingSessions, f.widget.conversationHistoryPersistedSessions).upserts;
    for (const record of writes.filter(record => record.id === 'old')) assert.deepEqual(record.turns.slice(0, 9), f.old.turns);
});

test('failure to read an original keeps persistence closed and preserves the startup draft', async () => {
    const f = fixture();
    f.widget.platformService.readConversationHistorySession = async () => { throw new Error('synthetic disk unavailable'); };
    await f.widget.loadDurableCodingSessions(1);
    assert.equal(f.widget.conversationHistoryPersistenceReady, false);
    assert.equal(f.widget.conversationHistoryLoadFailed, true);
    assert.equal(f.widget.codingSessions.find(session => session.id === 'new-draft'), f.draft);
    assert.deepEqual(f.patches, []);
});
