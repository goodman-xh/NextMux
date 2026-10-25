import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class Fixture extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'nmx-comic-media-files-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspaceRoot = join(base, 'workspace');
  const destination = join(base, 'backups');
  await mkdir(workspaceRoot);
  await mkdir(destination);
  const service = new Fixture(join(base, 'profile'));
  await service.createComicProject({ workspaceRoot, title: '媒体文件备份验证', starter: 'storyboard',
    frameRate: 24, canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  return { base, workspaceRoot, destination, service };
}

test('actual managed media bytes round-trip independently of record-only archives', async t => {
  const { base, workspaceRoot, destination, service } = await fixture(t);
  const media = join(workspaceRoot, 'nextmux.media');
  await mkdir(join(media, 'imports'), { recursive: true });
  await mkdir(join(media, 'exports'), { recursive: true });
  const picture = Buffer.from('ACTUAL_IMAGE_BYTES_\u0000\u0001');
  const movie = Buffer.from('ACTUAL_MP4_BYTES_\u0002\u0003');
  await writeFile(join(media, 'imports', 'source.png'), picture);
  await writeFile(join(media, 'exports', 'film.mp4'), movie);
  const backup = await service.exportComicMediaFilesArchive(workspaceRoot, pathToFileURL(destination).href);
  assert.equal(backup.files, 2);
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_media_files'] });
  const restored = await service.importComicMediaFilesArchive(workspaceRoot, backup.directoryUri);
  assert.equal(restored.files, 2);
  assert.deepEqual(await readFile(join(media, 'imports', 'source.png')), picture);
  assert.deepEqual(await readFile(join(media, 'exports', 'film.mp4')), movie);
  const restarted = new Fixture(join(base, 'profile'));
  const state = await restarted.getDesktopLocalDataState(workspaceRoot);
  assert.deepEqual(state.entries.find(entry => entry.category === 'comic_media_files')?.files, 2);
});

test('tampered archive bytes cannot publish a partial restore', async t => {
  const { workspaceRoot, destination, service } = await fixture(t);
  const media = join(workspaceRoot, 'nextmux.media');
  await mkdir(join(media, 'imports'), { recursive: true });
  const original = Buffer.from('recoverable media bytes');
  await writeFile(join(media, 'imports', 'source.png'), original);
  const backup = await service.exportComicMediaFilesArchive(workspaceRoot, pathToFileURL(destination).href);
  const archivedFile = join(fileURLToPath(backup.directoryUri), 'files', 'imports', 'source.png');
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_media_files'] });
  await writeFile(archivedFile, Buffer.alloc(original.length, 0x78));
  await assert.rejects(service.importComicMediaFilesArchive(workspaceRoot, backup.directoryUri),
    error => error?.code === 'COMIC_MEDIA_ARCHIVE_INVALID');
  const afterFailure = await service.getDesktopLocalDataState(workspaceRoot);
  assert.equal(afterFailure.entries.find(entry => entry.category === 'comic_media_files')?.files, 0);
  await writeFile(archivedFile, original);
  await mkdir(media);
  const restored = await service.importComicMediaFilesArchive(workspaceRoot, backup.directoryUri);
  assert.equal(restored.files, 1);
  assert.deepEqual(await readFile(join(media, 'imports', 'source.png')), original);
});
