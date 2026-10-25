import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { common, recovery, service } from './helpers/editor-recovery-source-loader.mjs';

class RecoveryService extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    store() { return this.editorDraftRecoveryStore(); }
    close() { return this.disposeConnectionResources(); }
}
const error = code => candidate => candidate.code === `EDITOR_RECOVERY_${code}` && !/fixture-secret/.test(candidate.message);
const settings = (extra = {}) => ({ requireZeroDataRetention: false, denyDataCollection: true, saveConversationHistory: true, ...extra });
async function fixture(t, content = 'original\n') {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-editor-recovery-')));
    const state = join(root, 'state'), sourceFile = join(root, 'notes.txt');
    await fs.writeFile(sourceFile, content, { mode: 0o600 });
    const a = new RecoveryService(state), b = new RecoveryService(state);
    t.after(async () => { await Promise.all([a.close(), b.close()]); await fs.rm(root, { recursive: true, force: true }); });
    return { root, state, sourceFile, a, b, snapshot: { sessionId: 'fixture-session', sourceUri: pathToFileURL(sourceFile).href, name: 'notes.txt',
        baseline: { current: content, before: 'older' }, drafts: { current: 'edited', before: '' } } };
}
async function allocated(f, client = f.a) { const result = await client.openEditorDraftRecovery({}); assert.equal(result.kind, 'allocated'); return result.id; }
const request = (id, snapshot, expectedRevision = 0, extra = {}) => ({ id, snapshot, expectedRevision, mutationId: randomUUID(), ...extra });
async function saved(f, client = f.a) { const id = await allocated(f, client), input = request(id, f.snapshot); return { id, input, ack: await client.saveEditorDraftRecovery(input) }; }
const diskPath = (f, id) => join(f.state, 'file-editor-recovery-v1', `${id}.json`);

test('actual four RPCs persist both sides and empty draft, expose only safe DTOs, and never touch source bytes or attributes', async t => {
    const f = await fixture(t), before = await fs.stat(f.sourceFile), { id, input, ack } = await saved(f);
    assert.equal(ack.source.status, 'matching'); assert.equal(ack.revision, 1);
    assert.deepEqual(await f.a.saveEditorDraftRecovery(input), ack);
    const state = await f.b.listEditorDraftRecoveries();
    assert.equal(state.enabled, true); assert.equal(state.settingsRevision, 0); assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].drafts, undefined); assert.equal(state.entries[0].baseline, undefined);
    const opened = await f.b.openEditorDraftRecovery({ id });
    assert.equal(opened.kind, 'record'); assert.deepEqual(opened.record.snapshot, f.snapshot);
    assert.equal(opened.record.evidence, undefined); assert.equal(opened.record.expectedRevision, undefined);
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), f.snapshot.baseline.current);
    const after = await fs.stat(f.sourceFile);
    assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.mode, before.mode);
    if (process.platform !== 'win32') assert.equal((await fs.stat(diskPath(f, id))).mode & 0o777, 0o600);
    await f.b.discardEditorDraftRecovery({ id, expectedRevision: 1 });
    assert.equal((await f.a.listEditorDraftRecoveries()).entries.length, 0);
    await assert.rejects(f.a.saveEditorDraftRecovery(input), error('NOT_FOUND'));
});

test('one backend shares coordinator across two service connections: CAS has one winner and stale discard cannot erase it', async t => {
    const f = await fixture(t), { id } = await saved(f);
    assert.equal(await f.a.store(), await f.b.store());
    const inputs = [request(id, { ...f.snapshot, drafts: { current: 'A' } }, 1), request(id, { ...f.snapshot, drafts: { current: 'B' } }, 1)];
    const results = await Promise.allSettled([f.a.saveEditorDraftRecovery(inputs[0]), f.b.saveEditorDraftRecovery(inputs[1])]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.filter(value => value.status === 'rejected' && error('CONFLICT')(value.reason)).length, 1);
    await assert.rejects(f.b.discardEditorDraftRecovery({ id, expectedRevision: 1 }), error('CONFLICT'));
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.revision, 2);
});

test('receipt retries bind mutation, revision, content and explicit-baseline intent; missing IDs are never arbitrary upserts', async t => {
    const f = await fixture(t), { id, input, ack } = await saved(f);
    for (const changed of [{ snapshot: { ...f.snapshot, drafts: { current: 'different' } } }, { expectedRevision: 1 }, { refreshSourceBaseline: true }]) {
        await assert.rejects(f.a.saveEditorDraftRecovery({ ...input, ...changed }), error('CONFLICT'));
    }
    await assert.rejects(f.b.saveEditorDraftRecovery(request(randomUUID(), f.snapshot)), error('NOT_FOUND'));
    await assert.rejects(f.b.saveEditorDraftRecovery(request(id, { ...f.snapshot, sourceUri: pathToFileURL(join(f.root, 'other')).href }, 1)), error('CONFLICT'));
    await assert.rejects(f.b.saveEditorDraftRecovery(request(id, { ...f.snapshot, sessionId: 'different-owner' }, 1)), error('CONFLICT'));
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.snapshotSha256, ack.snapshotSha256);
});

test('uncommitted handles are owner-bound, bounded, explicitly releasable at revision zero, and disposal does not destroy shared data', async t => {
    const f = await fixture(t), ids = [];
    for (let i = 0; i < common.EDITOR_RECOVERY_MAX_COUNT; i++) ids.push(await allocated(f));
    await assert.rejects(allocated(f), error('QUOTA_EXCEEDED'));
    await assert.rejects(f.b.saveEditorDraftRecovery(request(ids[0], f.snapshot)), error('NOT_FOUND'));
    await assert.rejects(f.b.discardEditorDraftRecovery({ id: ids[0], expectedRevision: 0 }), error('NOT_FOUND'));
    await f.a.discardEditorDraftRecovery({ id: ids[0], expectedRevision: 0 });
    const id = await allocated(f); await f.a.saveEditorDraftRecovery(request(id, f.snapshot));
    await assert.rejects(f.a.discardEditorDraftRecovery({ id, expectedRevision: 0 }), error('CONFLICT'));
    await f.a.close();
    await assert.rejects(f.a.openEditorDraftRecovery({}), error('UNAVAILABLE'));
    await assert.rejects(f.b.saveEditorDraftRecovery(request(ids[1], f.snapshot)), error('NOT_FOUND'));
    assert.equal((await f.b.openEditorDraftRecovery({ id })).record.snapshot.drafts.before, '');
});

test('a fresh Node process reads the exact committed snapshot and receipt without needing a renderer or source write', async t => {
    const f = await fixture(t), { id, ack } = await saved(f);
    const loader = new URL('./helpers/editor-recovery-source-loader.mjs', import.meta.url).href;
    const code = `import { recovery } from ${JSON.stringify(loader)}; const store=await recovery.sharedEditorDraftRecoveryStore(process.argv[1]); process.stdout.write(JSON.stringify(await store.open('new-process',{id:process.argv[2]},async()=>({enabled:true,revision:0}))));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.state, id], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    const loaded = JSON.parse(child.stdout).record;
    assert.deepEqual(loaded.snapshot, f.snapshot); assert.equal(loaded.snapshotSha256, ack.snapshotSha256);
});

test('external edits, same-text inode replacement, readonly, missing and untrusted schemes remain readonly recoveries', async t => {
    const f = await fixture(t), { id } = await saved(f);
    await fs.writeFile(f.sourceFile, 'external');
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.source.status, 'changed');
    await f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, drafts: { current: 'continue safely' } }, 1));
    assert.equal(await fs.readFile(f.sourceFile, 'utf8'), 'external');
    await fs.rename(f.sourceFile, `${f.sourceFile}.old`); await fs.writeFile(f.sourceFile, f.snapshot.baseline.current);
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.source.canWriteSource, false);
    await fs.unlink(f.sourceFile);
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.source.status, 'missing');
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.snapshot.drafts.current, 'continue safely');
    for (const sourceUri of ['file:///C:/fixture-secret/windows/old.txt', 'https://example.test/never-request', 'file://remote/share/a.txt']) {
        const next = await allocated(f);
        const ack = await f.a.saveEditorDraftRecovery(request(next, { ...f.snapshot, sourceUri }));
        assert.equal(ack.source.canWriteSource, false);
    }
    if (process.platform !== 'win32') {
        await fs.writeFile(f.sourceFile, f.snapshot.baseline.current, { mode: 0o400 });
        const next = await saved(f); assert.equal(next.ack.source.status, 'read_only');
    }
});

test('only an explicit matching baseline refresh changes original source evidence; failed refresh still preserves draft', async t => {
    const f = await fixture(t), { id } = await saved(f);
    const replacement = 'explicit source save';
    await fs.writeFile(f.sourceFile, replacement);
    const snapshot = { ...f.snapshot, baseline: { current: replacement, before: 'older' }, drafts: { current: 'new unsaved', before: '' } };
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, snapshot, 1))).source.status, 'changed');
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.source.canWriteSource, false);
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, snapshot, 2, { refreshSourceBaseline: true }))).source.status, 'matching');
    await fs.writeFile(f.sourceFile, 'another external change');
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, snapshot, 3, { refreshSourceBaseline: true }))).source.status, 'changed');
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.snapshot.drafts.before, '');
});

test('source symlinks and recovery-directory symlink/replacement fail safely without modifying target files', async t => {
    const f = await fixture(t), link = join(f.root, 'source-link.txt');
    try { await fs.symlink(f.sourceFile, link); } catch (e) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(e.code)) return; throw e; }
    const id = await allocated(f);
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, sourceUri: pathToFileURL(link).href }))).source.status, 'unverified');
    const store = await f.a.store(), old = `${store.directory}-old`, outside = join(f.root, 'outside');
    await fs.mkdir(outside); await fs.writeFile(join(outside, 'keep.txt'), 'unchanged');
    await fs.rename(store.directory, old); await fs.symlink(outside, store.directory, 'dir');
    await assert.rejects(f.a.saveEditorDraftRecovery(request(id, f.snapshot, 1)), error('UNSAFE_PATH'));
    await assert.rejects(f.a.listEditorDraftRecoveries(), error('UNSAFE_PATH'));
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
});

test('utf8/full-record size, unknown fields and record corruption fail closed without replacing previous bytes', async t => {
    const f = await fixture(t), { id } = await saved(f), before = await fs.readFile(diskPath(f, id));
    for (const snapshot of [{ ...f.snapshot, drafts: { current: '🙂'.repeat(270_000) } }, { ...f.snapshot, baseline: { current: 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES + 1) } }]) {
        await assert.rejects(f.a.saveEditorDraftRecovery(request(id, snapshot, 1)), error('TOO_LARGE'));
    }
    await assert.rejects(f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, grant: 'untrusted' }, 1)), error('CORRUPT'));
    assert.deepEqual(await fs.readFile(diskPath(f, id)), before);
    const forged = JSON.parse(before); forged.snapshot.drafts.current = 'tampered'; await fs.writeFile(diskPath(f, id), JSON.stringify(forged));
    await assert.rejects(f.a.openEditorDraftRecovery({ id }), error('CORRUPT'));
    await assert.rejects(f.a.saveEditorDraftRecovery(request(id, f.snapshot, 1)), error('CORRUPT'));
    forged.version = 2; await fs.writeFile(diskPath(f, id), JSON.stringify(forged));
    await assert.rejects(f.a.openEditorDraftRecovery({ id }), error('UNSUPPORTED_VERSION'));
});

test('31 existing records and two simultaneous creates commit only the 32nd and never evict old backups', async t => {
    const f = await fixture(t);
    for (let i = 0; i < 31; i++) await saved(f);
    const a = await allocated(f), b = await allocated(f, f.b);
    const values = await Promise.allSettled([f.a.saveEditorDraftRecovery(request(a, f.snapshot)), f.b.saveEditorDraftRecovery(request(b, f.snapshot))]);
    assert.equal(values.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(values.filter(value => value.status === 'rejected' && error('QUOTA_EXCEEDED')(value.reason)).length, 1);
    const state = await f.b.listEditorDraftRecoveries(); assert.equal(state.entries.length, 32);
    assert.ok(state.totalBytes <= common.EDITOR_RECOVERY_TOTAL_BYTES);
});

test('real file write/sync/rename failures keep the committed version and clean only owned temporary files', async t => {
    const f = await fixture(t), { id } = await saved(f), before = await fs.readFile(diskPath(f, id));
    for (const phase of ['writeFile', 'sync', 'rename']) {
        const originalOpen = fs.open, originalRename = fs.rename;
        const injected = new Error('fixture-secret must not escape');
        const mock = phase === 'rename' ? t.mock.method(fs, 'rename', async (...args) => {
            if (String(args[0]).includes('.pending-')) throw injected;
            return originalRename(...args);
        }) : t.mock.method(fs, 'open', async (...args) => {
            const handle = await originalOpen(...args);
            if (String(args[0]).includes('.pending-')) handle[phase] = async () => { throw injected; };
            return handle;
        });
        await assert.rejects(f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, drafts: { current: phase } }, 1)), error('UNAVAILABLE'));
        mock.mock.restore();
        assert.deepEqual(await fs.readFile(diskPath(f, id)), before);
        assert.ok(!(await fs.readdir(join(f.state, 'file-editor-recovery-v1'))).some(name => name.startsWith('.pending-')));
    }
});

test('post-commit lost acknowledgement replays the original mutation without another write or revision', async t => {
    const f = await fixture(t), id = await allocated(f), store = await f.a.store(), original = store.writeRecord.bind(store), input = request(id, f.snapshot);
    let writes = 0;
    store.writeRecord = async (...args) => { writes++; await original(...args); throw new Error('fixture-secret lost response'); };
    await assert.rejects(f.a.saveEditorDraftRecovery(input), error('UNAVAILABLE'));
    const ack = await f.b.saveEditorDraftRecovery(input);
    assert.equal(ack.revision, 1); assert.equal(writes, 1);
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.mutationId, input.mutationId);
    store.writeRecord = original;
    await f.b.discardEditorDraftRecovery({ id, expectedRevision: 1 });
    await assert.rejects(f.a.saveEditorDraftRecovery(input), error('NOT_FOUND'));
});

test('privacy CAS validates before history side effects; old clients cannot re-enable a disabled recovery setting', async t => {
    const f = await fixture(t), { id } = await saved(f), initial = await f.a.getPrivacySettings();
    assert.equal(initial.saveFileEditorRecovery, true); assert.equal(initial.fileEditorRecoveryRevision, 0);
    const disabled = await f.b.savePrivacySettings(settings({ saveFileEditorRecovery: false, fileEditorRecoveryRevision: 0 }));
    assert.equal(disabled.fileEditorRecoveryRevision, 1);
    let clears = 0; f.a.conversationStore = () => ({ clear: async () => { clears++; } });
    await assert.rejects(f.a.savePrivacySettings(settings({ saveConversationHistory: false, saveFileEditorRecovery: true, fileEditorRecoveryRevision: 0 })), error('CONFLICT'));
    assert.equal(clears, 0);
    const legacy = await f.a.savePrivacySettings(settings());
    assert.equal(legacy.saveFileEditorRecovery, false); assert.equal(legacy.fileEditorRecoveryRevision, 1);
    await assert.rejects(f.a.saveEditorDraftRecovery(request(id, f.snapshot, 1)), error('DISABLED'));
    assert.deepEqual((await f.a.openEditorDraftRecovery({ id })).record.snapshot, f.snapshot);
    await f.a.savePrivacySettings(settings({ saveConversationHistory: false, saveFileEditorRecovery: true, fileEditorRecoveryRevision: 1 }));
    assert.equal(clears, 0, 'history opt-out preserves existing conversations until explicit local-data deletion');
    assert.equal((await f.a.listEditorDraftRecoveries()).entries.length, 1, 'history opt-out does not delete editor recovery');
});

test('privacy disable and queued saves share ordering; after disable acknowledgement no queued stale write commits', async t => {
    const f = await fixture(t), { id } = await saved(f), store = await f.a.store(), original = store.writeRecord.bind(store);
    await f.b.store();
    let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    store.writeRecord = async (...args) => { entered(); await gate; return original(...args); };
    const first = f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, drafts: { current: 'accepted before disable' } }, 1));
    await started;
    const disabled = f.b.savePrivacySettings(settings({ saveFileEditorRecovery: false, fileEditorRecoveryRevision: 0 }));
    // Let the disable RPC enter its queue while the earlier accepted write is held.
    await new Promise(resolve => setImmediate(resolve));
    const late = f.a.saveEditorDraftRecovery(request(id, { ...f.snapshot, drafts: { current: 'late stale body' } }, 2))
        .then(() => undefined, failure => failure);
    release(); await first; await disabled; assert.ok(error('DISABLED')(await late));
    await assert.rejects(f.b.saveEditorDraftRecovery(request(id, f.snapshot, 2)), error('DISABLED'));
    assert.equal((await f.b.openEditorDraftRecovery({ id })).record.snapshot.drafts.current, 'accepted before disable');
    store.writeRecord = original;
});

test('a transient app-root initialization failure can be retried and unsafe root aliases retain their fixed error code', async t => {
    const f = await fixture(t), originalMkdir = fs.mkdir;
    const injected = t.mock.method(fs, 'mkdir', async (...args) => {
        if (args[0] === f.state) throw new Error('fixture-secret storage path');
        return originalMkdir(...args);
    });
    await assert.rejects(f.a.openEditorDraftRecovery({}), error('UNAVAILABLE'));
    injected.mock.restore();
    const id = await allocated(f); assert.ok(id);
    const alias = join(f.root, 'aliased-state');
    try { await fs.symlink(f.state, alias, 'dir'); } catch (e) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(e.code)) return; throw e; }
    const unsafe = new RecoveryService(alias);
    await assert.rejects(unsafe.listEditorDraftRecoveries(), error('UNSAFE_PATH'));
    await unsafe.close();
});

test('a failed first baseline check does not acquire writable source evidence later without explicit verification', async t => {
    const f = await fixture(t), id = await allocated(f);
    await fs.unlink(f.sourceFile);
    const initial = await f.a.saveEditorDraftRecovery(request(id, f.snapshot));
    assert.equal(initial.source.status, 'missing');
    await fs.writeFile(f.sourceFile, f.snapshot.baseline.current);
    assert.equal((await f.a.openEditorDraftRecovery({ id })).record.source.canWriteSource, false);
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, f.snapshot, 1))).source.canWriteSource, false);
    assert.equal((await f.a.saveEditorDraftRecovery(request(id, f.snapshot, 2, { refreshSourceBaseline: true }))).source.status, 'matching');
});
