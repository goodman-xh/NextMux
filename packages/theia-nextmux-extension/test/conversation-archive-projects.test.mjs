import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';
import { ConversationArchiveService } from '../lib/node/nextmux-conversation-archive.js';
import { captureArchiveDirectoryBinding, verifyArchiveDirectoryBinding } from '../lib/node/nextmux-archive-project-bindings.js';

const sourceSession = id => ({ id, title: `Conversation ${id}`, workspacePath: 'C:\\OldDevice\\PrivateProject', permissionMode: 'full_access',
    privateWorkspacePath: '/old-device/private-root', apiKey: 'OLD_METADATA_SECRET', followUpQueue: [{ prompt: 'never schedule' }],
    createdAt: 1, updatedAt: 2, turns: [{ id: 'turn', prompt: 'Visible question', response: 'Visible answer', createdAt: 1, stage: 'complete' }] });
async function fixture(t, count = 2) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-archive-projects-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = new ConversationStore(join(root, 'source'));
    const destination = new ConversationStore(join(root, 'destination'));
    const sessions = Array.from({ length: count }, () => sourceSession(randomUUID()));
    await source.save(sessions);
    const readAttachment = async () => { throw new Error('No attachment fixture'); };
    const exporter = new ConversationArchiveService({ store: source, attachmentRoot: join(root, 'source-assets'), readAttachment });
    const importer = new ConversationArchiveService({ store: destination, attachmentRoot: join(root, 'imported-assets'), readAttachment });
    const archive = join(root, 'export.nmxarchive');
    const local = join(root, 'Explicit local folder');
    await mkdir(local); await writeFile(join(local, 'existing.txt'), 'untouched');
    const groups = [{ label: 'Alpha', sessionIds: [sessions[0].id] }];
    const exportLabels = () => exporter.exportFile(archive, undefined, { projects: groups });
    return { root, source, destination, sessions, exporter, importer, archive, local, groups, exportLabels };
}
async function bind(f, preview, refs = [preview.projects[0].ref]) {
    return f.importer.prepareBindings(preview.previewId, refs.map(projectRef => ({ projectRef, directoryUri: pathToFileURL(f.local).href })));
}
async function mutateArchive(f, mutation, rehash = true) {
    const parsed = JSON.parse(await readFile(f.archive, 'utf8'));
    mutation(parsed);
    if (rehash) parsed.contentSha256 = createHash('sha256').update(JSON.stringify({ conversations: parsed.conversations,
        files: parsed.files.map(({ dataBase64, ...file }) => file), ...(parsed.projects ? { projects: parsed.projects } : {}) })).digest('hex');
    await writeFile(f.archive, JSON.stringify(parsed));
}

test('default archive stays v1 with no old paths, labels or runtime authority', async t => {
    const f = await fixture(t);
    f.sessions[0].archiveProject = { sourceSha256: 'a'.repeat(64), ref: randomUUID(), label: 'Previously imported label' };
    await f.source.save(f.sessions);
    await f.exporter.exportFile(f.archive);
    const raw = await readFile(f.archive, 'utf8'), parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1); assert.equal(parsed.minimumReaderVersion, 1); assert.equal(parsed.projects, undefined);
    assert.doesNotMatch(raw, /OldDevice|old-device|OLD_METADATA_SECRET|Previously imported label|archiveProject|projectRef/);
    const preview = await f.importer.previewFile(f.archive);
    assert.equal(preview.projects, undefined);
    await f.importer.importPreview(preview.previewId, 'skip');
    for (const session of await f.destination.snapshot()) {
        assert.equal(session.workspacePath, ''); assert.equal(session.ownedWorkspace, true);
        assert.equal(session.permissionMode, 'read_only'); assert.equal(session.followUpQueue, undefined);
    }
});

test('explicit labels produce hash-covered v2 archive-local groups, never merge equal labels', async t => {
    const f = await fixture(t);
    await f.exporter.exportFile(f.archive, undefined, { projects: f.sessions.map(session => ({ label: 'Same label', sessionIds: [session.id] })) });
    const raw = await readFile(f.archive, 'utf8'), parsed = JSON.parse(raw);
    assert.equal(parsed.version, 2); assert.equal(parsed.minimumReaderVersion, 2); assert.equal(parsed.projects.length, 2);
    assert.notEqual(parsed.projects[0].ref, parsed.projects[1].ref);
    assert.doesNotMatch(raw, /OldDevice|old-device|OLD_METADATA_SECRET|directoryUri|directoryPath/);
    const before = await readdir(f.root), preview = await f.importer.previewFile(f.archive);
    assert.deepEqual(await readdir(f.root), before);
    assert.deepEqual(preview.projects.map(project => project.binding), [{ kind: 'owned_workspace' }, { kind: 'owned_workspace' }]);
    assert.deepEqual(preview.projects.map(project => project.conversations), [1, 1]);
    await mutateArchive(f, value => { value.projects[0].label = 'Changed'; }, false);
    await assert.rejects(f.importer.previewFile(f.archive), { code: 'ARCHIVE_INVALID' });
});

test('unbound v2 import preserves display grouping and owned fallback without touching project directories', async t => {
    const f = await fixture(t); await f.exportLabels();
    const preview = await f.importer.previewFile(f.archive);
    const imported = await f.importer.importPreview(preview.previewId, 'skip');
    assert.equal(imported.boundDirectories, undefined);
    const sessions = await f.destination.snapshot(), grouped = sessions.find(session => session.id === f.sessions[0].id);
    assert.deepEqual(grouped.archiveProject, { sourceSha256: preview.sha256, ref: preview.projects[0].ref, label: 'Alpha' });
    assert.equal(grouped.workspacePath, ''); assert.equal(grouped.ownedWorkspace, true);
    assert.deepEqual(await readdir(f.local), ['existing.txt']);
});

test('only explicit local choice binds newly imported sessions and consumes the old preview', async t => {
    const f = await fixture(t); await f.exportLabels();
    const initial = await f.importer.previewFile(f.archive), preview = await bind(f, initial);
    assert.notEqual(initial.previewId, preview.previewId);
    assert.deepEqual(preview.projects[0].binding, { kind: 'local_directory', directoryUri: pathToFileURL(f.local).href, directoryPath: f.local });
    await assert.rejects(f.importer.importPreview(initial.previewId, 'skip'), { code: 'ARCHIVE_PREVIEW_EXPIRED' });
    assert.deepEqual(await f.destination.snapshot(), [], 'choosing a folder does not commit history');
    assert.deepEqual(await readdir(f.local), ['existing.txt']);
    const result = await f.importer.importPreview(preview.previewId, 'skip');
    assert.deepEqual(result.boundDirectories, [pathToFileURL(f.local).href]);
    const sessions = await f.destination.snapshot(), bound = sessions.find(session => session.id === f.sessions[0].id), unbound = sessions.find(session => session.id === f.sessions[1].id);
    assert.equal(bound.workspacePath, f.local); assert.equal(bound.ownedWorkspace, false); assert.equal(bound.privateWorkspacePath, undefined);
    assert.equal(bound.permissionMode, 'read_only'); assert.equal(bound.turns[0].permissionMode, 'read_only');
    assert.equal(bound.followUpQueue, undefined); assert.equal(unbound.workspacePath, ''); assert.equal(unbound.ownedWorkspace, true);
    assert.deepEqual(await readdir(f.local), ['existing.txt']); assert.equal(await readFile(join(f.local, 'existing.txt'), 'utf8'), 'untouched');
    const second = join(f.root, 'again.nmxarchive'); await f.importer.exportFile(second);
    assert.doesNotMatch(await readFile(second, 'utf8'), /Explicit local folder|directoryUri|directoryPath|archiveProject/);
});

test('skip never rebinds existing history and copy binds only its new deterministic ID', async t => {
    const f = await fixture(t, 1); await f.exportLabels();
    const original = { ...f.sessions[0], workspacePath: '/original/local', title: 'Keep me' };
    await f.destination.save([original]);
    let preview = await bind(f, await f.importer.previewFile(f.archive));
    const skip = await f.importer.importPreview(preview.previewId, 'skip');
    assert.equal(skip.imported, 0); assert.equal(skip.boundDirectories, undefined); assert.deepEqual(await f.destination.snapshot(), [original]);
    preview = await bind(f, await f.importer.previewFile(f.archive));
    const copy = await f.importer.importPreview(preview.previewId, 'copy');
    assert.equal(copy.imported, 1); assert.equal(copy.idMap[original.id], preview.conversations[0].copyId);
    const stored = await f.destination.snapshot();
    assert.deepEqual(stored.find(session => session.id === original.id), original);
    assert.equal(stored.find(session => session.id !== original.id).workspacePath, f.local);
    preview = await bind(f, await f.importer.previewFile(f.archive));
    assert.equal((await f.importer.importPreview(preview.previewId, 'copy')).imported, 0);
    assert.deepEqual(await f.destination.snapshot(), stored);
});

test('directory replacement invalidates confirmation; a fresh unbound preview safely imports', async t => {
    const f = await fixture(t); await f.exportLabels();
    const preview = await bind(f, await f.importer.previewFile(f.archive));
    await rename(f.local, `${f.local}-original`); await mkdir(f.local);
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), { code: 'ARCHIVE_BINDING_CHANGED' });
    assert.deepEqual(await f.destination.snapshot(), []); assert.deepEqual(await readdir(f.local), []);
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), { code: 'ARCHIVE_PREVIEW_EXPIRED' });
    const fresh = await f.importer.previewFile(f.archive);
    assert.equal(fresh.projects[0].binding.kind, 'owned_workspace');
    await f.importer.importPreview(fresh.previewId, 'skip');
    assert.ok((await f.destination.snapshot()).every(session => session.workspacePath === '' && session.ownedWorkspace));
});

test('directory identity is checked inside the queued manifest preparation, not just at RPC entry', async t => {
    const f = await fixture(t); await f.exportLabels();
    const preview = await bind(f, await f.importer.previewFile(f.archive));
    const insert = f.destination.insertArchiveSessions.bind(f.destination);
    f.destination.insertArchiveSessions = (sessions, options, prepare) => insert(sessions, options, async (...args) => {
        await rename(f.local, `${f.local}-original`); await mkdir(f.local);
        return prepare(...args);
    });
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), { code: 'ARCHIVE_BINDING_CHANGED' });
    assert.deepEqual(await f.destination.snapshot(), []);
});

test('binding changes replace the whole mapping and bad choices cannot leave a confirmed old binding', async t => {
    const f = await fixture(t); await f.exportLabels();
    let preview = await bind(f, await f.importer.previewFile(f.archive));
    preview = await f.importer.prepareBindings(preview.previewId, []);
    assert.equal(preview.projects[0].binding.kind, 'owned_workspace');
    const oldId = preview.previewId;
    await assert.rejects(f.importer.prepareBindings(oldId, [{ projectRef: preview.projects[0].ref, directoryUri: pathToFileURL(join(f.root, 'missing')).href }]), { code: 'ARCHIVE_BINDING_INVALID' });
    await assert.rejects(f.importer.importPreview(oldId, 'skip'), { code: 'ARCHIVE_PREVIEW_EXPIRED' });
    await assert.rejects(readdir(join(f.root, 'missing')), { code: 'ENOENT' });
});

test('rejects symlink, network, query, file and missing directory choices without creating them', async t => {
    const f = await fixture(t), alias = join(f.root, 'directory-alias');
    await symlink(f.local, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const uri of ['https://example.test/folder', 'file://server/share', `${pathToFileURL(f.local).href}?x=1`,
        pathToFileURL(alias).href, pathToFileURL(join(f.local, 'existing.txt')).href, pathToFileURL(join(f.root, 'not-created')).href]) {
        await assert.rejects(captureArchiveDirectoryBinding(uri), { code: 'ARCHIVE_BINDING_INVALID' });
    }
    const captured = await captureArchiveDirectoryBinding(pathToFileURL(f.local).href);
    await verifyArchiveDirectoryBinding(captured);
    await rename(f.local, `${f.local}-before`); await symlink(`${f.local}-before`, f.local, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(verifyArchiveDirectoryBinding(captured), { code: 'ARCHIVE_BINDING_CHANGED' });
    await assert.rejects(readdir(join(f.root, 'not-created')), { code: 'ENOENT' });
});

test('export grouping rejects paths, invisible labels, unselected IDs and duplicate membership', async t => {
    const f = await fixture(t);
    for (const label of ['/old/path', 'C:\\old\\path', 'C:old', 'a\u202eb', 'a\u0085b', '', 'x'.repeat(161)]) {
        await assert.rejects(f.exporter.exportFile(f.archive, undefined, { projects: [{ label, sessionIds: [f.sessions[0].id] }] }), { code: 'ARCHIVE_INVALID' });
    }
    for (const projects of [[{ label: 'A', sessionIds: ['missing'] }], [{ label: 'A', sessionIds: [] }],
        [{ label: 'A', sessionIds: [f.sessions[0].id] }, { label: 'B', sessionIds: [f.sessions[0].id] }],
        Array.from({ length: 129 }, () => ({ label: 'A', sessionIds: [f.sessions[0].id] }))]) {
        await assert.rejects(f.exporter.exportFile(f.archive, undefined, { projects }), { code: 'ARCHIVE_INVALID' });
    }
    await assert.rejects(readFile(f.archive), { code: 'ENOENT' });
});

test('malicious v2 metadata, unknown refs and path fields are rejected even with a recomputed content hash', async t => {
    const f = await fixture(t); await f.exportLabels();
    const original = await readFile(f.archive);
    const changes = [
        value => { value.unexpectedField = 'unknown'; },
        value => { value.projects[0].directoryUri = 'file:///old-device'; },
        value => { value.projects[0].label = '/old-device'; },
        value => { value.projects.push({ ...value.projects[0] }); },
        value => { value.conversations[0].projectRef = randomUUID(); },
        value => { value.projects[0].ref = '../bad'; },
        value => { value.projects.push({ ref: randomUUID(), label: 'Unused' }); },
        value => { value.version = 1; value.minimumReaderVersion = 1; }
    ];
    for (const change of changes) {
        await writeFile(f.archive, original); await mutateArchive(f, change);
        await assert.rejects(f.importer.previewFile(f.archive), { code: 'ARCHIVE_INVALID' });
    }
    assert.deepEqual(await f.destination.snapshot(), []);
});

test('foreign or duplicate project refs cannot create a directory binding receipt', async t => {
    const f = await fixture(t); await f.exportLabels();
    const directoryUri = pathToFileURL(f.local).href;
    let preview = await f.importer.previewFile(f.archive);
    await assert.rejects(f.importer.prepareBindings(preview.previewId, [{ projectRef: randomUUID(), directoryUri }]), { code: 'ARCHIVE_INVALID' });
    preview = await f.importer.previewFile(f.archive);
    const item = { projectRef: preview.projects[0].ref, directoryUri };
    await assert.rejects(f.importer.prepareBindings(preview.previewId, [item, item]), { code: 'ARCHIVE_INVALID' });
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), { code: 'ARCHIVE_PREVIEW_EXPIRED' });
    assert.deepEqual(await f.destination.snapshot(), []);
});
