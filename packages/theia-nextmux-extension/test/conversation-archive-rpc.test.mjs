import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ArchiveServiceFixture extends NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; this.historyEnabled = true; }
    nextmuxDataRoot() { return this.root; }
    async getPrivacySettings() { return { saveConversationHistory: this.historyEnabled }; }
}
class PrivacyRaceArchiveFixture extends NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    conversationStore() {
        const store = super.conversationStore();
        if (!this.insertGate) return store;
        return new Proxy(store, { get: (target, name) => name === 'insertArchiveSessions'
            ? async (...args) => { this.insertGate.entered.resolve(); await this.insertGate.release.promise; return target.insertArchiveSessions(...args); }
            : Reflect.get(target, name) });
    }
    async getPrivacySettings() {
        const settings = await super.getPrivacySettings();
        const raw = await readFile(this.privacySettingsPath(), 'utf8').then(text => JSON.parse(text), () => undefined);
        return typeof raw?.saveConversationHistory === 'boolean'
            ? { ...settings, saveConversationHistory: raw.saveConversationHistory }
            : settings;
    }
    async savePrivacySettings(settings) {
        this._requestedHistoryEnabled = settings?.saveConversationHistory;
        return super.savePrivacySettings(settings);
    }
    async writePrivacySettings(value) {
        if (this.privacyGate) { this.privacyGate.entered.resolve(); await this.privacyGate.release.promise; }
        return super.writePrivacySettings({
            ...value,
            ...(typeof this._requestedHistoryEnabled === 'boolean'
                ? { saveConversationHistory: this._requestedHistoryEnabled }
                : {})
        });
    }
}
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const uri = path => pathToFileURL(path).href;
const session = (id, attachment, workspacePath = '') => ({ id, title: id, workspacePath, createdAt: 1, updatedAt: 2,
    turns: [{ id: 'turn', prompt: 'Read the attachment', response: 'Saved answer', error: '', stage: 'complete', createdAt: 1, attachments: attachment ? [{ ...attachment, id: 'attachment', name: 'notes.txt', kind: 'text' }] : [] }] });
async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-archive-rpc-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = new ArchiveServiceFixture(join(root, 'source'));
    const destination = new ArchiveServiceFixture(join(root, 'destination'));
    return { root, source, destination, archiveUri: uri(join(root, 'transfer.nmxarchive')) };
}
const cache = (service, text, extra = {}) => service.cacheDesktopAttachment({ name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from(text).toString('base64'), ...extra });

test('real archive RPC explicitly rebinds v2 labels while attachments remain in owned cache and permissions inert', async t => {
    const f = await fixture(t), project = join(f.root, 'Chosen destination');
    await mkdir(project); await writeFile(join(project, 'existing.txt'), 'unchanged');
    const attachment = await cache(f.source, 'portable attachment');
    await f.source.saveConversationHistory([{ ...session(ids[0], attachment), workspacePath: 'C:\\OldPrivateProject', permissionMode: 'full_access', followUpQueue: [{ prompt: 'never execute' }] }]);
    await f.source.exportConversationArchive(f.archiveUri, undefined, { projects: [{ label: 'Chosen label', sessionIds: [ids[0]] }] });
    const preview = await f.destination.previewConversationArchive(f.archiveUri);
    assert.equal(preview.projects[0].binding.kind, 'owned_workspace');
    const confirmed = await f.destination.prepareConversationArchiveBindings(preview.previewId, [{ projectRef: preview.projects[0].ref, directoryUri: uri(project) }]);
    assert.equal(confirmed.projects[0].binding.directoryPath, project);
    f.destination.historyEnabled = false;
    await assert.rejects(f.destination.importConversationArchive(confirmed.previewId, 'skip'), { code: 'ARCHIVE_HISTORY_DISABLED' });
    f.destination.historyEnabled = true;
    const result = await f.destination.importConversationArchive(confirmed.previewId, 'skip');
    assert.deepEqual(result.boundDirectories, [uri(project)]);
    const [restored] = (await f.destination.loadConversationHistory()).sessions;
    assert.equal(restored.workspacePath, project); assert.equal(restored.ownedWorkspace, false);
    assert.equal(restored.permissionMode, 'read_only'); assert.equal(restored.followUpQueue, undefined);
    const imported = restored.turns[0].attachments[0];
    assert.ok(fileURLToPath(imported.uri).startsWith(join(f.destination.root, 'conversation-attachments')));
    const read = await f.destination.readDesktopAttachment({ uri: imported.uri, name: imported.name, size: imported.size });
    assert.equal(Buffer.from(read.dataBase64, 'base64').toString(), 'portable attachment');
    await assert.rejects(readFile(join(project, '.nextmux', 'conversation-attachments', 'notes.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(project, 'existing.txt'), 'utf8'), 'unchanged');
    await assert.rejects(f.destination.importConversationArchive(preview.previewId, 'skip'), { code: 'ARCHIVE_PREVIEW_EXPIRED' });
});

test('real archive RPC roundtrip authorizes global, owned and bound-project attachments including compact history without size', async t => {
    const f = await fixture(t);
    const project = join(f.root, 'project');
    await mkdir(project);
    f.source.workspaceServer = { getMostRecentlyUsedWorkspace: async () => uri(project) };
    const global = await cache(f.source, 'global attachment');
    const owned = await cache(f.source, 'owned attachment', { conversationId: ids[1] });
    const bound = await cache(f.source, 'bound attachment', { conversationId: ids[2], workspaceRoot: project });
    const compactGlobal = { ...global }; delete compactGlobal.size;
    await f.source.saveConversationHistory([session(ids[0], compactGlobal), session(ids[1], owned), session(ids[2], bound, project)]);
    // Project authorization must work from its saved binding, without relying on the current window.
    f.source.workspaceServer = undefined;
    const exported = await f.source.exportConversationArchive(f.archiveUri);
    assert.equal(exported.conversations, 3);
    assert.equal(exported.attachments, 3);
    const preview = await f.destination.previewConversationArchive(f.archiveUri);
    assert.equal(preview.conversations.length, 3);
    assert.equal((await f.destination.importConversationArchive(preview.previewId, 'skip')).imported, 3);
    const restored = (await f.destination.loadConversationHistory()).sessions;
    for (const [index, content] of ['global attachment', 'owned attachment', 'bound attachment'].entries()) {
        const current = restored.find(value => value.id === ids[index]);
        const attachment = current.turns[0].attachments[0];
        assert.equal(current.workspacePath, '');
        assert.equal(attachment.workspaceRelativePath, undefined);
        const read = await f.destination.readDesktopAttachment({ uri: attachment.uri, name: attachment.name, size: attachment.size });
        assert.equal(Buffer.from(read.dataBase64, 'base64').toString(), content);
        assert.match(await f.destination.getConversationWorkspace(current.id), /conversation-workspaces/);
    }
    assert.equal(await readFile(fileURLToPath(bound.uri), 'utf8'), 'bound attachment', 'source project remains untouched');
});

test('multi-root secondary attachment survives export, selected local clear and import without authorizing an unlinked root', async t => {
    const f = await fixture(t);
    const primary = join(f.root, 'primary-project');
    const secondary = join(f.root, 'secondary-project');
    await mkdir(primary); await mkdir(secondary);
    const primarySource = join(primary, 'source.txt');
    const secondarySource = join(secondary, 'source.txt');
    await writeFile(primarySource, 'keep primary source');
    await writeFile(secondarySource, 'keep secondary source');
    f.source.workspaceServer = { getMostRecentlyUsedWorkspace: async () => uri(secondary) };
    const attachment = await cache(f.source, 'second-root attachment bytes', { conversationId: ids[0], workspaceRoot: secondary });
    const saved = { ...session(ids[0], attachment, primary), workspaceBindings: [
        { id: 'primary', path: primary, kind: 'project', status: 'available' },
        { id: 'secondary', path: secondary, kind: 'project', status: 'available' }
    ] };
    await f.source.saveConversationHistory([saved]);
    f.source.workspaceServer = undefined;
    for (const workspaceBindings of [
        [saved.workspaceBindings[0], { ...saved.workspaceBindings[1], status: 'unlinked' }],
        [saved.workspaceBindings[0]]
    ]) {
        await f.source.saveConversationHistory([{ ...saved, workspaceBindings }]);
        await assert.rejects(f.source.exportConversationArchive(f.archiveUri), error => error.code === 'ATTACHMENT_READ_UNSAFE');
        await assert.rejects(readFile(fileURLToPath(f.archiveUri)), { code: 'ENOENT' });
    }
    await f.source.saveConversationHistory([saved]);
    const exported = await f.source.exportConversationArchive(f.archiveUri);
    assert.equal(exported.attachments, 1);
    const archive = JSON.parse(await readFile(fileURLToPath(f.archiveUri), 'utf8'));
    assert.deepEqual(archive.conversations[0].turns[0].attachments.map(value => value.uri),
        [`attachments/${createHash('sha256').update('second-root attachment bytes').digest('hex')}.txt`]);
    await f.source.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_history', 'conversation_attachments'] });
    assert.equal((await f.source.loadConversationHistory()).sessions.length, 0);
    await assert.rejects(readFile(fileURLToPath(attachment.uri)), { code: 'ENOENT' });
    const preview = await f.source.previewConversationArchive(f.archiveUri);
    const imported = await f.source.importConversationArchive(preview.previewId, 'skip');
    assert.equal(imported.imported, 1);
    const restored = (await f.source.loadConversationHistory()).sessions[0].turns[0].attachments[0];
    const read = await f.source.readDesktopAttachment({ uri: restored.uri, name: restored.name, size: restored.size });
    assert.equal(Buffer.from(read.dataBase64, 'base64').toString(), 'second-root attachment bytes');
    assert.equal(await readFile(primarySource, 'utf8'), 'keep primary source');
    assert.equal(await readFile(secondarySource, 'utf8'), 'keep secondary source');
});

test('RPC preview and copy imports preserve originals and allocate valid portable owned workspaces', async t => {
    const f = await fixture(t);
    await f.source.saveConversationHistory([session(ids[0])]);
    await f.source.exportConversationArchive(f.archiveUri, [ids[0]]);
    await f.destination.saveConversationHistory([{ ...session(ids[0]), title: 'Original local conversation' }]);
    const preview = await f.destination.previewConversationArchive(f.archiveUri);
    const expectedCopy = preview.conversations[0].copyId;
    assert.match(expectedCopy, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    const result = await f.destination.importConversationArchive(preview.previewId, 'copy');
    assert.equal(result.idMap[ids[0]], expectedCopy);
    assert.equal((await f.destination.loadConversationHistory()).sessions.find(value => value.id === ids[0]).title, 'Original local conversation');
    assert.match(await f.destination.getConversationWorkspace(expectedCopy), new RegExp(expectedCopy));
    const repeat = await f.destination.previewConversationArchive(f.archiveUri);
    assert.equal(repeat.conversations[0].copyConflict, true);
    assert.equal((await f.destination.importConversationArchive(repeat.previewId, 'copy')).skipped, 1);
});

test('RPC rejects remote or malformed archive paths and honors the local-history import privacy setting', async t => {
    const f = await fixture(t);
    for (const invalid of ['https://example.com/file.nmxarchive', 'file://remote/share/file.nmxarchive', uri(join(f.root, 'wrong.zip')), `${f.archiveUri}?x=1`, `${f.archiveUri}#fragment`]) {
        await assert.rejects(f.source.exportConversationArchive(invalid), error => error.code === 'ARCHIVE_INVALID');
        await assert.rejects(f.destination.previewConversationArchive(invalid), error => error.code === 'ARCHIVE_INVALID');
    }
    await f.source.saveConversationHistory([session(ids[0])]);
    await f.source.exportConversationArchive(f.archiveUri);
    const preview = await f.destination.previewConversationArchive(f.archiveUri);
    f.destination.historyEnabled = false;
    await assert.rejects(f.destination.importConversationArchive(preview.previewId, 'skip'), error => error.code === 'ARCHIVE_HISTORY_DISABLED');
    f.destination.historyEnabled = true;
    assert.equal((await f.destination.importConversationArchive(preview.previewId, 'skip')).imported, 1, 'privacy refusal does not consume the preview');
});

test('history-off acknowledgement waits for an already-started archive import to commit', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-archive-privacy-race-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = new PrivacyRaceArchiveFixture(join(root, 'source'));
    const destination = new PrivacyRaceArchiveFixture(join(root, 'destination'));
    const secondWindow = new PrivacyRaceArchiveFixture(join(root, 'destination'));
    const archiveUri = uri(join(root, 'history.nmxarchive'));
    const attachment = await cache(source, 'privacy race attachment');
    await source.saveConversationHistory([session(ids[0], attachment)]);
    await source.exportConversationArchive(archiveUri);
    destination.insertGate = { entered: deferred(), release: deferred() };
    const preview = await destination.previewConversationArchive(archiveUri);
    const importing = destination.importConversationArchive(preview.previewId, 'skip');
    await destination.insertGate.entered.promise;
    const disabling = secondWindow.savePrivacySettings({
        ...(await secondWindow.getPrivacySettings()), saveConversationHistory: false
    });
    const observed = await Promise.race([
        disabling.then(() => 'disabled', () => 'failed'),
        new Promise(resolve => setTimeout(() => resolve('pending'), 300))
    ]);
    destination.insertGate.release.resolve();
    const [imported, disabled] = await Promise.allSettled([importing, disabling]);
    assert.equal(imported.status, 'fulfilled');
    assert.equal(imported.value.imported, 1);
    assert.equal(disabled.status, 'fulfilled');
    assert.equal(disabled.value.saveConversationHistory, false);
    assert.equal(observed, 'pending', 'history-off must not return before the active archive import commits');
    const [restored] = (await secondWindow.loadConversationHistory()).sessions;
    assert.equal(restored.id, ids[0]);
    assert.equal(Buffer.from((await secondWindow.readDesktopAttachment({
        uri: restored.turns[0].attachments[0].uri,
        name: restored.turns[0].attachments[0].name,
        size: restored.turns[0].attachments[0].size
    })).dataBase64, 'base64').toString(), 'privacy race attachment');
});

test('archive import queued behind history-off sees the committed setting and keeps its preview', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-archive-privacy-queue-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = new PrivacyRaceArchiveFixture(join(root, 'source'));
    const destination = new PrivacyRaceArchiveFixture(join(root, 'destination'));
    const secondWindow = new PrivacyRaceArchiveFixture(join(root, 'destination'));
    const archiveUri = uri(join(root, 'history.nmxarchive'));
    await source.saveConversationHistory([session(ids[0])]);
    await source.exportConversationArchive(archiveUri);
    const preview = await destination.previewConversationArchive(archiveUri);
    secondWindow.privacyGate = { entered: deferred(), release: deferred() };
    const disabling = secondWindow.savePrivacySettings({
        ...(await secondWindow.getPrivacySettings()), saveConversationHistory: false
    });
    await secondWindow.privacyGate.entered.promise;
    const importing = destination.importConversationArchive(preview.previewId, 'skip');
    const observed = await Promise.race([
        importing.then(() => 'imported', () => 'rejected'),
        new Promise(resolve => setTimeout(() => resolve('pending'), 300))
    ]);
    secondWindow.privacyGate.release.resolve();
    await disabling;
    assert.equal(observed, 'pending', 'import must wait for the earlier privacy preference commit');
    await assert.rejects(importing, error => error.code === 'ARCHIVE_HISTORY_DISABLED');
    assert.deepEqual((await destination.loadConversationHistory()).sessions, []);
    await secondWindow.savePrivacySettings({ ...(await secondWindow.getPrivacySettings()), saveConversationHistory: true });
    assert.equal((await destination.importConversationArchive(preview.previewId, 'skip')).imported, 1);
});

test('archive attachment resolver rejects foreign caches, remote URLs, forged project bindings and symlinks', async t => {
    const f = await fixture(t);
    const unrelated = join(f.root, 'unrelated'); await mkdir(unrelated);
    const bytes = Buffer.from('not an authorized attachment');
    const name = `${createHash('sha256').update(bytes).digest('hex')}.txt`;
    const outside = join(unrelated, name); await writeFile(outside, bytes);
    const ref = { id: 'attachment', kind: 'text', uri: uri(outside), name: 'notes.txt', size: bytes.length };
    await assert.rejects(f.source.readArchiveAttachment(session(ids[0]), ref), error => error.code === 'ATTACHMENT_READ_UNSAFE');
    await assert.rejects(f.source.readArchiveAttachment(session(ids[0]), { ...ref, uri: 'file://remote/share/notes.txt' }), error => error.code === 'ATTACHMENT_READ_UNSAFE');
    const foreignCache = join(unrelated, '.nextmux', 'conversation-attachments'); await mkdir(foreignCache, { recursive: true });
    const forged = join(foreignCache, name); await writeFile(forged, bytes);
    await assert.rejects(f.source.readArchiveAttachment(session(ids[0], undefined, unrelated), { ...ref, uri: uri(forged) }), /授权|工作区|authorized/);
    const global = await cache(f.source, 'safe cached content');
    const globalPath = fileURLToPath(global.uri);
    await rm(globalPath);
    try { await symlink(outside, globalPath); }
    catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
    await assert.rejects(f.source.readArchiveAttachment(session(ids[0]), { ...global, id: 'attachment', name: 'notes.txt', kind: 'text' }), error => error.code === 'ATTACHMENT_READ_UNSAFE');
});
