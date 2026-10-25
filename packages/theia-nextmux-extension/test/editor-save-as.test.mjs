import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveAs, saveAsCommon, service } from './helpers/editor-recovery-source-loader.mjs';

const uri = pathname => pathToFileURL(pathname).href;
const isError = code => error => {
    assert.equal(error.code, `EDITOR_SAVE_AS_${code}`);
    assert.equal(error.message, error.code); assert.equal(error.message.includes('fixture-secret'), false); return true;
};
class SaveAsService extends service.NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { assert.fail('Save As must not access recovery data or privacy'); }
    editorDraftRecoveryStore() { assert.fail('Save As must not mutate the recovery store'); }
}
async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-editor-save-as-')));
    const source = join(root, 'fixture-secret-source.txt');
    await fs.writeFile(source, 'original', { mode: 0o600 });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, source, request: (name, content = 'new') => ({ sourceUri: uri(source), destinationUri: uri(join(root, name)), content }) };
}
async function noTemporary(root) { assert.equal((await fs.readdir(root)).some(name => name.startsWith('.nextmux-save-as-')), false); }

test('actual RPC exclusively publishes exact UTF-8 and empty text without touching source, recovery, privacy or ack', async t => {
    const f = await fixture(t), before = await fs.stat(f.source), client = new SaveAsService();
    for (const [name, content] of [['text.txt', '你好🙂\r\nsecond\n'], ['empty.txt', '']]) {
        const result = await client.saveEditorDraftAsNewFile(f.request(name, content));
        assert.deepEqual(result, { created: true, destinationUri: uri(join(f.root, name)), bytes: Buffer.byteLength(content) });
        assert.equal(await fs.readFile(join(f.root, name), 'utf8'), content);
        if (process.platform !== 'win32') assert.equal((await fs.stat(join(f.root, name))).mode & 0o777, 0o600);
    }
    const after = await fs.stat(f.source);
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original'); assert.equal(before.ino, after.ino);
    assert.equal(before.mode, after.mode); assert.equal(before.mtimeMs, after.mtimeMs);
    await noTemporary(f.root);
});

test('8 concurrent requests to one destination publish exactly one complete file', async t => {
    const f = await fixture(t), clients = [new SaveAsService(), new SaveAsService()];
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => clients[i % 2].saveEditorDraftAsNewFile(f.request('race.txt', `body-${i}`))));
    const winning = results.findIndex(value => value.status === 'fulfilled');
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.filter(value => value.status === 'rejected' && value.reason.code === 'EDITOR_SAVE_AS_TARGET_EXISTS').length, 7);
    assert.equal(await fs.readFile(join(f.root, 'race.txt'), 'utf8'), `body-${winning}`);
    await noTemporary(f.root);
});

test('existing regular files, directories and hard links are never overwritten or removed', async t => {
    const f = await fixture(t), target = join(f.root, 'existing.txt'), directory = join(f.root, 'directory'), hardlink = join(f.root, 'hardlink.txt');
    await fs.writeFile(target, 'foreign-original'); await fs.mkdir(directory); await fs.link(f.source, hardlink);
    const before = await fs.stat(target);
    for (const name of ['existing.txt', 'directory', 'hardlink.txt']) await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(name)), isError('TARGET_EXISTS'));
    assert.equal(await fs.readFile(target, 'utf8'), 'foreign-original'); assert.equal((await fs.stat(target)).ino, before.ino);
    assert.equal(await fs.readFile(hardlink, 'utf8'), 'original'); assert.equal(await fs.readFile(f.source, 'utf8'), 'original');
    assert.ok((await fs.stat(directory)).isDirectory()); await noTemporary(f.root);
});

test('existing symlinks including dangling targets are rejected without following or replacing them', async t => {
    const f = await fixture(t);
    try { await fs.symlink(f.source, join(f.root, 'link.txt')); }
    catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS symlink privilege is unavailable'); return; } throw error; }
    await fs.symlink(join(f.root, 'missing.txt'), join(f.root, 'dangling.txt'));
    for (const name of ['link.txt', 'dangling.txt']) {
        await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(name)), isError('TARGET_EXISTS'));
        assert.ok((await fs.lstat(join(f.root, name))).isSymbolicLink());
    }
    await assert.rejects(fs.stat(join(f.root, 'missing.txt')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original'); await noTemporary(f.root);
});

test('same source is rejected even when missing or spelled through a canonical parent alias', async t => {
    const f = await fixture(t);
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(basename(f.source))), isError('SAME_SOURCE'));
    await fs.unlink(f.source);
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(basename(f.source))), isError('SAME_SOURCE'));
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(basename(f.source).toUpperCase())), isError('SAME_SOURCE'));
    const directory = join(f.root, 'real'), alias = join(f.root, 'alias'); await fs.mkdir(directory);
    try { await fs.symlink(directory, alias, 'dir'); }
    catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
    await assert.rejects(saveAs.saveEditorDraftAsNewFile({ sourceUri: uri(join(alias, 'missing.txt')), destinationUri: uri(join(directory, 'missing.txt')), content: 'new' }), isError('SAME_SOURCE'));
    await assert.rejects(fs.stat(join(directory, 'missing.txt')), { code: 'ENOENT' }); await noTemporary(f.root);
});

test('unsafe/nonlocal/foreign-OS destination URIs cannot create a file or directory', async t => {
    const f = await fixture(t);
    const invalid = ['https://example.test/a', 'file://remote/share/a', 'file:relative.txt', 'not a uri', join(f.root, 'relative.txt'),
        `${uri(join(f.root, 'a'))}?query=fixture-secret`, `${uri(join(f.root, 'a'))}#fragment`,
        `${uri(f.root)}/bad%2Fname`, `${uri(f.root)}/bad%00name`, `${uri(f.root)}/bad%0Aname`, `${uri(f.root)}/`];
    if (process.platform !== 'win32') invalid.push('file:///C:/Users/fixture/a.txt', 'file:///C%3A/Users/fixture/a.txt');
    for (const destinationUri of invalid) await assert.rejects(saveAs.saveEditorDraftAsNewFile({ ...f.request('a'), destinationUri }), isError('INVALID_URI'));
    assert.deepEqual(await fs.readdir(f.root), [basename(f.source)]);
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('missing-parent/new.txt')), isError('UNAVAILABLE'));
    assert.deepEqual(await fs.readdir(f.root), [basename(f.source)]);
});

test('strict request shape and UTF-8 byte limits preserve empty strings without lossy conversion', async t => {
    const f = await fixture(t);
    for (const request of [{ ...f.request('a'), content: null }, { ...f.request('a'), content: '\ud800' }, { ...f.request('a'), overwrite: true }]) {
        await assert.rejects(saveAs.saveEditorDraftAsNewFile(request), isError('INVALID_REQUEST'));
    }
    for (const content of ['x'.repeat(saveAsCommon.EDITOR_SAVE_AS_MAX_BYTES + 1), '🙂'.repeat(saveAsCommon.EDITOR_SAVE_AS_MAX_BYTES / 4 + 1)]) {
        await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('a', content)), isError('TOO_LARGE'));
    }
    assert.deepEqual(await fs.readdir(f.root), [basename(f.source)]);
});

test('missing/readonly/foreign source remains only a label for a separately selected new target', async t => {
    const f = await fixture(t);
    const sources = [uri(join(f.root, 'missing-source')), 'file:///C:/old-windows/project/a.txt', 'nextmux-context:/unavailable/a'];
    for (const [i, sourceUri] of sources.entries()) {
        await saveAs.saveEditorDraftAsNewFile({ ...f.request(`copy-${i}.txt`, ''), sourceUri });
        assert.equal(await fs.readFile(join(f.root, `copy-${i}.txt`), 'utf8'), '');
    }
    if (process.platform !== 'win32') {
        await fs.chmod(f.source, 0o400); await saveAs.saveEditorDraftAsNewFile(f.request('readonly-copy.txt'));
        assert.equal((await fs.stat(f.source)).mode & 0o777, 0o400);
    }
    assert.equal(await fs.readFile(f.source, 'utf8'), 'original'); await noTemporary(f.root);
});

test('pre-cancelled request or closed RPC connection cannot create a target', async t => {
    const f = await fixture(t), controller = new AbortController(); controller.abort();
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('cancelled.txt'), { signal: controller.signal }), isError('CANCELLED'));
    const client = new SaveAsService(); client.connectionDisposed = true;
    await assert.rejects(client.saveEditorDraftAsNewFile(f.request('closed.txt')), isError('CANCELLED'));
    assert.deepEqual(await fs.readdir(f.root), [basename(f.source)]);
});

test('cancellation after staging sync still prevents publication and removes only its own stage', async t => {
    const f = await fixture(t), controller = new AbortController(), originalOpen = fs.open;
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args), sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); controller.abort(); }; return handle;
    });
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('cancelled.txt'), { signal: controller.signal }), isError('CANCELLED'));
    await assert.rejects(fs.stat(join(f.root, 'cancelled.txt')), { code: 'ENOENT' }); await noTemporary(f.root);
});

test('late cancellation after exclusive link publication cannot delete or deny the created file', async t => {
    const f = await fixture(t), controller = new AbortController(), originalLink = fs.link;
    t.mock.method(fs, 'link', async (...args) => { await originalLink(...args); controller.abort(); });
    const result = await saveAs.saveEditorDraftAsNewFile(f.request('committed.txt'), { signal: controller.signal });
    assert.equal(result.created, true); assert.equal(await fs.readFile(join(f.root, 'committed.txt'), 'utf8'), 'new'); await noTemporary(f.root);
});

test('actual stage write/sync/close/publish failures do not overwrite source or leave a partial destination', async t => {
    const f = await fixture(t);
    for (const phase of ['writeFile', 'sync', 'close', 'link']) {
        const originalOpen = fs.open;
        const injected = Object.assign(new Error('fixture-secret body and path must not escape'), { code: 'EIO' });
        const mock = phase === 'link' ? t.mock.method(fs, 'link', async () => { throw injected; }) : t.mock.method(fs, 'open', async (...args) => {
            const handle = await originalOpen(...args), original = handle[phase].bind(handle); let once = false;
            handle[phase] = async (...values) => {
                if (once) return original(...values); once = true;
                if (phase === 'writeFile') await original('partial');
                else if (phase === 'close') await original();
                throw injected;
            }; return handle;
        });
        await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request(`${phase}.txt`)), isError('UNAVAILABLE'));
        mock.mock.restore(); await assert.rejects(fs.stat(join(f.root, `${phase}.txt`)), { code: 'ENOENT' }); await noTemporary(f.root);
        assert.equal(await fs.readFile(f.source, 'utf8'), 'original');
    }
});

test('a target appearing at the publication instant is not overwritten or removed during cleanup', async t => {
    const f = await fixture(t), originalLink = fs.link;
    t.mock.method(fs, 'link', async (from, target) => { await fs.writeFile(target, 'foreign-race', { flag: 'wx' }); return originalLink(from, target); });
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('race.txt')), isError('TARGET_EXISTS'));
    assert.equal(await fs.readFile(join(f.root, 'race.txt'), 'utf8'), 'foreign-race'); await noTemporary(f.root);
});

test('failure cleanup never deletes a replaced stranger at its temporary pathname', async t => {
    const f = await fixture(t), originalOpen = fs.open; let temporary;
    t.mock.method(fs, 'open', async (...args) => {
        temporary = String(args[0]); const handle = await originalOpen(...args);
        handle.sync = async () => {
            await fs.rename(temporary, `${temporary}.owned-moved`);
            await fs.writeFile(temporary, 'foreign-temp', { flag: 'wx' });
            throw new Error('fixture-secret injected');
        }; return handle;
    });
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('new.txt')), isError('UNAVAILABLE'));
    assert.equal(await fs.readFile(temporary, 'utf8'), 'foreign-temp');
    await assert.rejects(fs.stat(join(f.root, 'new.txt')), { code: 'ENOENT' });
});

test('parent identity replacement before publish fails closed without touching the replacement directory', async t => {
    const f = await fixture(t), parent = join(f.root, 'selected'), moved = join(f.root, 'moved'), originalOpen = fs.open;
    await fs.mkdir(parent);
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args), originalSync = handle.sync.bind(handle);
        handle.sync = async () => { await originalSync(); await fs.rename(parent, moved); await fs.mkdir(parent); await fs.writeFile(join(parent, basename(String(args[0]))), 'foreign-temp'); };
        return handle;
    });
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('selected/new.txt')), isError('UNSAFE_PATH'));
    const names = await fs.readdir(parent); assert.equal(names.length, 1); assert.equal(await fs.readFile(join(parent, names[0]), 'utf8'), 'foreign-temp');
    await assert.rejects(fs.stat(join(parent, 'new.txt')), { code: 'ENOENT' });
});

test('unsupported exclusive publication never falls back to overwrite-capable operations', async t => {
    const f = await fixture(t);
    t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('fixture-secret'), { code: 'ENOTSUP' }); });
    t.mock.method(fs, 'rename', async () => { assert.fail('unsafe fallback'); });
    await assert.rejects(saveAs.saveEditorDraftAsNewFile(f.request('new.txt')), isError('UNSUPPORTED_FILESYSTEM'));
    await assert.rejects(fs.stat(join(f.root, 'new.txt')), { code: 'ENOENT' }); await noTemporary(f.root);
});

test('post-commit temporary cleanup failure preserves the published success and never unlinks the target', async t => {
    const f = await fixture(t), originalUnlink = fs.unlink;
    const mock = t.mock.method(fs, 'unlink', async pathname => {
        if (basename(String(pathname)).startsWith('.nextmux-save-as-')) throw new Error('fixture-secret');
        return originalUnlink(pathname);
    });
    const result = await saveAs.saveEditorDraftAsNewFile(f.request('committed.txt')); mock.mock.restore();
    assert.equal(result.created, true); assert.equal(await fs.readFile(join(f.root, 'committed.txt'), 'utf8'), 'new');
    assert.equal((await fs.readdir(f.root)).filter(name => name.startsWith('.nextmux-save-as-')).length, 1);
});
