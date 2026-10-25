import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

test('a finished film moves to the chosen folder under a free name, subtitles alongside', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-export-destination-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const exports = join(root, 'project', 'nextmux.media', 'exports');
    await mkdir(exports, { recursive: true });
    const destination = join(root, 'Movies', 'NextMux');
    const service = new NextMuxPlatformServiceImpl();
    const write = async name => { const path = join(exports, name); await writeFile(path, name); return path; };

    const first = await service.saveComicExportToDirectory(destination, '雨夜', {
        mp4: await write('a.mp4'), srt: await write('a.srt'), vtt: await write('a.vtt'), ass: await write('a.ass')
    });
    assert.equal(first.savedPath, join(destination, '雨夜.mp4'));
    assert.deepEqual(first.savedSubtitlePaths, { srt: join(destination, '雨夜.srt'), vtt: join(destination, '雨夜.vtt'), ass: join(destination, '雨夜.ass') });
    assert.equal(await readFile(first.savedPath, 'utf8'), 'a.mp4');
    assert.deepEqual(await readdir(exports), [], 'moved, not copied');

    // A second export of the same film never overwrites the first.
    const second = await service.saveComicExportToDirectory(destination, '雨夜', { mp4: await write('b.mp4') });
    assert.equal(second.savedPath, join(destination, '雨夜 2.mp4'));
    assert.equal(second.savedSubtitlePaths, undefined);
    assert.equal(await readFile(join(destination, '雨夜.mp4'), 'utf8'), 'a.mp4');
});

test('only absolute folders are accepted, and the default is the system Movies / Videos folder', () => {
    const service = new NextMuxPlatformServiceImpl();
    assert.equal(service.validComicExportDirectory('/Users/a/Movies'), true);
    assert.equal(service.validComicExportDirectory('relative/folder'), false);
    assert.equal(service.validComicExportDirectory('/bad\0path'), false);
    assert.equal(service.validComicExportDirectory(''), false);
    assert.match(service.comicExportDefaultDirectory(), process.platform === 'darwin' ? /Movies[\\/]NextMux$/ : /Videos[\\/]NextMux$/);
});
