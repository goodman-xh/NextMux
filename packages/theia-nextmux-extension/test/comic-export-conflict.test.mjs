import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { comicExportFileStem, prepareComicExportDestination, publishComicExportDestination } from '../lib/node/nextmux-comic-export-destination.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const operations = { copyFile: fs.copyFile, rename: fs.rename, link: fs.link, unlink: fs.unlink };
const extensions = ['mp4', 'srt', 'vtt', 'ass'];
async function fixture(t, { old = true, subtitles = true } = {}) {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-export-conflict-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const destination = join(root, '中文 空格 destination'), sources = join(root, '中文 空格 sources');
    await fs.mkdir(destination); await fs.mkdir(sources);
    const files = {};
    for (const extension of subtitles ? extensions : ['mp4']) {
        files[extension] = join(sources, `new.${extension}`);
        await fs.writeFile(files[extension], `new-${extension}`);
        if (old) await fs.writeFile(join(destination, `film.${extension}`), `old-${extension}`);
    }
    const plan = await prepareComicExportDestination(destination, 'film', subtitles, 'overwrite');
    return { root, destination, sources, files, plan };
}
async function assertOriginals(f) {
    for (const extension of Object.keys(f.files)) assert.equal(await fs.readFile(join(f.destination, `film.${extension}`), 'utf8'), `old-${extension}`);
    for (const source of Object.values(f.files)) assert.match(await fs.readFile(source, 'utf8'), /^new-/);
}

test('preview uses exactly the saved naming rule, including Windows reserved basenames', async t => {
    const f = await fixture(t);
    const service = new NextMuxPlatformServiceImpl();
    for (const name of ['CON', 'con.txt', 'NUL', 'AUX', 'PRN', 'COM1', 'COM¹', 'LPT9', 'CONIN$', 'CONOUT$']) {
        const stem = comicExportFileStem(name, 'fallback');
        assert.ok(stem.startsWith('_'), name);
        const preview = await service.getComicExportDestination({ destinationDirectory: f.destination, fileName: name, fallbackName: 'fallback', subtitleMode: 'none' });
        assert.equal(preview.fileName, `${stem}.mp4`);
        assert.equal(service.comicExportFileStem(name, 'fallback'), stem);
    }
    assert.equal(comicExportFileStem('film.mp4', ''), 'film.mp4', 'existing extension semantics remain unchanged');
    assert.equal(comicExportFileStem('  雨夜 · 春风 / 片尾 ...', ''), '雨夜-春风-片尾');
    assert.equal(comicExportFileStem('', 'title'), 'title');
    assert.deepEqual(await service.getComicExportDestination({ destinationDirectory: f.destination, fileName: 'film', fallbackName: '', subtitleMode: 'sidecar' }), {
        fileName: 'film.mp4', conflicts: extensions.map(ext => `film.${ext}`)
    });
    const absent = join(f.root, 'not-created', 'child');
    assert.deepEqual(await service.getComicExportDestination({ destinationDirectory: absent, fallbackName: 'NUL', subtitleMode: 'none' }), { fileName: '_NUL.mp4', conflicts: [] });
    await assert.rejects(fs.stat(absent), { code: 'ENOENT' }, 'preview must not create the directory');
});

test('explicit error refuses all existing group names; overwrite publishes video and subtitles together', async t => {
    const f = await fixture(t);
    await assert.rejects(prepareComicExportDestination(f.destination, 'film', true, 'error'), { code: 'COMIC_EXPORT_DESTINATION_CONFLICT' });
    const saved = await publishComicExportDestination(f.plan, f.files);
    assert.equal(saved.savedPath, join(f.destination, 'film.mp4'));
    for (const extension of extensions) assert.equal(await fs.readFile(join(f.destination, `film.${extension}`), 'utf8'), `new-${extension}`);
    assert.deepEqual(await fs.readdir(f.sources), []);
    assert.deepEqual((await fs.readdir(f.destination)).sort(), extensions.map(ext => `film.${ext}`).sort());
});

test('an absent destination is created once with exact name, and stale subtitles are removed only in the requested group', async t => {
    const f = await fixture(t);
    await publishComicExportDestination(f.plan, { mp4: f.files.mp4 });
    assert.deepEqual(await fs.readdir(f.destination), ['film.mp4']);
    const destination = join(f.root, 'nested', 'new');
    const plan = await prepareComicExportDestination(destination, 'fresh', false, 'error');
    await publishComicExportDestination(plan, { mp4: f.files.srt });
    assert.equal(await fs.readFile(join(destination, 'fresh.mp4'), 'utf8'), 'new-srt');
});

test('new or changed files during rendering are never overwritten or silently numbered', async t => {
    const f = await fixture(t);
    await fs.writeFile(join(f.destination, 'film.srt'), 'external edit');
    await assert.rejects(publishComicExportDestination(f.plan, f.files), { code: 'COMIC_EXPORT_DESTINATION_CHANGED' });
    assert.equal(await fs.readFile(join(f.destination, 'film.mp4'), 'utf8'), 'old-mp4');
    assert.equal(await fs.readFile(join(f.destination, 'film.srt'), 'utf8'), 'external edit');
    const g = await fixture(t, { old: false });
    await fs.writeFile(join(g.destination, 'film.vtt'), 'new external file');
    await assert.rejects(publishComicExportDestination(g.plan, g.files), { code: 'COMIC_EXPORT_DESTINATION_CHANGED' });
    assert.deepEqual(await fs.readdir(g.destination), ['film.vtt']);
    assert.equal((await fs.readdir(g.sources)).length, 4, 'rendered project results remain available');
});

test('staging disk failure and Windows-style locked originals preserve every original and project output', async t => {
    const f = await fixture(t);
    await assert.rejects(publishComicExportDestination(f.plan, f.files, undefined, { ...operations,
        copyFile: async (source, target, flags) => { if (target.endsWith('.srt')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fs.copyFile(source, target, flags); }
    }), { code: 'ENOSPC' });
    await assertOriginals(f);
    await assert.rejects(publishComicExportDestination(f.plan, f.files, undefined, { ...operations,
        rename: async (source, target) => { if (source.endsWith('.srt')) throw Object.assign(new Error('locked file'), { code: 'EPERM' }); return fs.rename(source, target); }
    }), { code: 'EPERM' });
    await assertOriginals(f);
    assert.equal((await fs.readdir(f.destination)).filter(name => name.startsWith('.nextmux')).length, 0);
});

test('publication failure rolls back already replaced video and subtitles as a group', async t => {
    const f = await fixture(t);
    await assert.rejects(publishComicExportDestination(f.plan, f.files, undefined, { ...operations,
        link: async (source, target) => { if (source.endsWith('new.vtt')) throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); return fs.link(source, target); }
    }), { code: 'EIO' });
    await assertOriginals(f);
});

test('cancel during publication restores originals; pre-cancel never touches them', async t => {
    const f = await fixture(t);
    const controller = new AbortController();
    await assert.rejects(publishComicExportDestination(f.plan, f.files, controller.signal, { ...operations,
        link: async (source, target) => { await fs.link(source, target); if (source.endsWith('new.srt')) controller.abort(); }
    }), { name: 'AbortError' });
    await assertOriginals(f);
    const fresh = await prepareComicExportDestination(f.destination, 'film', true, 'overwrite');
    await assert.rejects(publishComicExportDestination(fresh, f.files, controller.signal), { name: 'AbortError' });
    await assertOriginals(f);
});

test('symlinks, directories and replaced destination directories cannot be overwritten', async t => {
    const f = await fixture(t, { old: false, subtitles: false });
    await fs.symlink(f.files.mp4, join(f.destination, 'film.mp4'));
    await assert.rejects(prepareComicExportDestination(f.destination, 'film', false), { code: 'COMIC_EXPORT_DESTINATION_UNSAFE' });
    await fs.unlink(join(f.destination, 'film.mp4'));
    await fs.mkdir(join(f.destination, 'film.mp4'));
    await assert.rejects(prepareComicExportDestination(f.destination, 'film', false), { code: 'COMIC_EXPORT_DESTINATION_UNSAFE' });
    const alias = join(f.root, 'alias'); await fs.symlink(f.destination, alias, 'dir');
    await assert.rejects(prepareComicExportDestination(alias, 'film', false), { code: 'COMIC_EXPORT_DESTINATION_UNSAFE' });
    await fs.rename(f.destination, join(f.root, 'original-directory')); await fs.mkdir(f.destination);
    await assert.rejects(publishComicExportDestination(f.plan, f.files), { code: 'COMIC_EXPORT_DESTINATION_CHANGED' });
    assert.deepEqual(await fs.readdir(f.destination), []);
});

test('filesystem without hardlinks uses exclusive copy and retains exact contents', async t => {
    const f = await fixture(t);
    await publishComicExportDestination(f.plan, f.files, undefined, { ...operations,
        link: async () => { throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' }); }
    });
    for (const extension of extensions) assert.equal(await fs.readFile(join(f.destination, `film.${extension}`), 'utf8'), `new-${extension}`);
});

test('a competing file during commit is preserved, while blocked rollback retains a recoverable original backup', async t => {
    const f = await fixture(t);
    let foreign;
    await assert.rejects(publishComicExportDestination(f.plan, f.files, undefined, { ...operations,
        link: async (source, target) => {
            if (source.endsWith('new.srt')) { foreign = target; await fs.writeFile(target, 'external replacement', { flag: 'wx' }); }
            return fs.link(source, target);
        }
    }), error => error.code === 'COMIC_EXPORT_DESTINATION_RECOVERY' && error.message.includes('.nextmux-export-'));
    assert.equal(await fs.readFile(foreign, 'utf8'), 'external replacement');
    assert.equal(await fs.readFile(join(f.destination, 'film.mp4'), 'utf8'), 'old-mp4');
    const backup = (await fs.readdir(f.destination)).find(name => name.startsWith('.nextmux-export-'));
    assert.equal(await fs.readFile(join(f.destination, backup, 'old.srt'), 'utf8'), 'old-srt');
    assert.equal((await fs.readdir(f.sources)).length, 4);
});

test('service rejects an explicit conflict before runtime/rendering and releases its reservation', async t => {
    const f = await fixture(t);
    const workspaceRoot = join(f.root, 'workspace'); await fs.mkdir(workspaceRoot);
    let runtimeCalls = 0;
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(f.root, 'profile'); }
        async getMediaRuntimeState() { runtimeCalls++; throw new Error('runtime must not be reached'); }
    }
    const service = new Service();
    await service.createComicProject({ workspaceRoot, title: 'film', starter: 'storyboard', frameRate: 24, canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
    const request = { workspaceRoot, quality: 'draft', subtitleMode: 'sidecar', allowPlaceholders: true, verifyAssetIntegrity: true, destinationDirectory: f.destination, destinationConflict: 'error' };
    await assert.rejects(service.startComicExport(request), { code: 'COMIC_EXPORT_DESTINATION_CONFLICT' });
    assert.equal(runtimeCalls, 0);
    await assert.rejects(service.startComicExport(request), { code: 'COMIC_EXPORT_DESTINATION_CONFLICT' }, 'first refusal must release export lock');
    await assert.rejects(service.startComicExport({ ...request, destinationConflict: 'unexpected' }), { code: 'INVALID_COMIC_EXPORT' });
    await assert.rejects(service.startComicExport({ ...request, destinationDirectory: undefined }), { code: 'INVALID_COMIC_EXPORT' });
    await assertOriginals(f);
});
