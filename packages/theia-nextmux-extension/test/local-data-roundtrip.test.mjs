import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Settings → Local data: export, delete and import each work end to end on a
// disposable profile (no desktop profile, account or network is touched).
class Fixture extends NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    async getPrivacySettings() { return { saveConversationHistory: true, requireZeroDataRetention: false, denyDataCollection: true }; }
}
const ids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
const entry = (state, category) => state.entries.find(item => item.category === category);

test('local data: export → delete conversations and attachments → import restores them; diagnostics export writes a report', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-local-data-roundtrip-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new Fixture(join(root, 'profile'));
    const attachment = await service.cacheDesktopAttachment({ name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('portable notes').toString('base64'), conversationId: ids[0], unique: true });
    await service.saveConversationHistory(ids.map((id, index) => ({ id, title: `Fixture ${index}`, workspacePath: '', createdAt: 1 + index, updatedAt: 2 + index,
        turns: [{ id: 'turn', prompt: `Question ${index}`, response: `Answer ${index}`, error: '', stage: 'complete', createdAt: 1,
            attachments: index === 0 ? [{ ...attachment, id: 'attachment', name: 'notes.txt', kind: 'text' }] : [] }] })));
    const before = await service.getDesktopLocalDataState('');
    assert.ok(entry(before, 'conversation_history').files > 0, 'history is measured');
    assert.ok(entry(before, 'conversation_attachments').files > 0, 'attachments are measured');

    // Export
    const archive = join(root, 'backup.nmxarchive');
    const exported = await service.exportConversationArchive(pathToFileURL(archive).href);
    assert.equal(exported.conversations, 2); assert.equal(exported.attachments, 1);
    assert.ok((await stat(archive)).size > 0);

    // Delete
    const cleared = await service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_history', 'conversation_attachments'] });
    assert.deepEqual([entry(cleared, 'conversation_history').files, entry(cleared, 'conversation_attachments').files], [0, 0]);
    assert.equal((await service.loadConversationHistory()).sessions.length, 0);
    await assert.rejects(service.readDesktopAttachment({ uri: attachment.uri, name: 'notes.txt', size: attachment.size }));

    // Import
    const preview = await service.previewConversationArchive(pathToFileURL(archive).href);
    assert.equal(preview.conversations.length, 2);
    assert.equal((await service.importConversationArchive(preview.previewId, 'skip')).imported, 2);
    const restored = (await service.loadConversationHistory()).sessions;
    assert.deepEqual(restored.map(session => session.id).sort(), [...ids].sort());
    const restoredAttachment = restored.find(session => session.id === ids[0]).turns[0].attachments[0];
    const read = await service.readDesktopAttachment({ uri: restoredAttachment.uri, name: restoredAttachment.name, size: restoredAttachment.size });
    assert.equal(Buffer.from(read.dataBase64, 'base64').toString(), 'portable notes');
    assert.ok(entry(await service.getDesktopLocalDataState(''), 'conversation_history').files > 0, 'measured again after import');

    // Diagnostics export
    const report = await service.createDesktopDiagnosticReport('');
    assert.match(report.fileName, /\.json$/);
    const parsed = JSON.parse(report.content);
    assert.equal(typeof parsed, 'object');
    assert.doesNotMatch(report.content, /portable notes|Question 0|Answer 1/, 'the diagnostic report never contains conversation content');
    assert.equal(await readFile(archive).then(bytes => bytes.length > 0), true);
});

test('local data UI actions confirm once, call the real RPC shape and update the page state', async () => {
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const method = name => {
        const start = widget.indexOf(`    protected ${name.startsWith('async ') ? name : name}(`);
        assert.ok(start >= 0, name);
        const next = widget.indexOf('\n    protected ', start + 10);
        return widget.slice(start, next);
    };
    const source = [method('async clearDesktopDataCategory'), method('codingSessionDeletionBlocked'), method('clearRendererData'), method('async clearDesktopCache')].join('\n');
    const storage = new Map([['nextmux.desktop.codingSessions.v1', '[1]'], ['nextmux.desktop.notifications.v1', '[2]']]);
    const window = { localStorage: { removeItem: key => storage.delete(key) }, nextmuxDesktop: { clearCache: async () => { calls.push('cache'); } } };
    const calls = [];
    const Harness = new Function('window', ts.transpile(`class Harness { ${source} }; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(window);
    const view = Object.assign(new Harness(), {
        localDataStage: 'idle', localDataConfirmAction: '', localDataMessage: '', localDataError: '', activeWorkspaceRoot: '/project',
        localDataState: { entries: [{ category: 'conversation_history', files: 3, bytes: 2048 }] }, agentStage: 'idle', notifications: [1],
        codingSessions: [{ id: 'a', turns: [] }], activeCodingSessionId: 'a', conversationHistoryPersistedSessions: new Set(['a']), conversationHistoryRevision: 1,
        conversationAgentRuns: new Map(), conversationWindows: [], scheduledAgentRuns: new Set(), agentChildContinuationStates: new Map(),
        conversationHasActiveRun: () => false,
        formatMediaSize: bytes => `${bytes} B`, update: () => undefined,
        platformService: { clearDesktopLocalData: async request => { calls.push(request); return { entries: [{ category: 'conversation_history', files: 0, bytes: 0 }] }; } }
    });
    await view.clearDesktopDataCategory('conversation_history');
    assert.deepEqual(calls, [], 'the first click only asks for confirmation');
    assert.match(view.localDataMessage, /再次点击确认删除/);
    await view.clearDesktopDataCategory('conversation_history');
    assert.deepEqual(calls, [{ workspaceRoot: '/project', categories: ['conversation_history'] }]);
    assert.equal(view.localDataState.entries[0].files, 0);
    assert.deepEqual(view.codingSessions, []); assert.equal(view.activeCodingSessionId, '');
    assert.equal(storage.has('nextmux.desktop.codingSessions.v1'), false);
    view.clearRendererData('notifications'); assert.equal(storage.has('nextmux.desktop.notifications.v1'), true);
    view.clearRendererData('notifications'); assert.equal(storage.has('nextmux.desktop.notifications.v1'), false);
    assert.deepEqual(view.notifications, []);
    await view.clearDesktopCache(); assert.deepEqual(calls.at(-1), 'cache'); assert.equal(view.localDataMessage, '网络缓存已清理');
    const updater = await readFile(new URL('../../../apps/desktop/updater.cjs', import.meta.url), 'utf8');
    assert.match(updater, /nextmux:cache:clear'[\s\S]*?trustedMainFrame\(event\)[\s\S]*?fromPartition\('persist:nextmux-browser'\)/, 'the built-in browser cache is cleared too');
});
