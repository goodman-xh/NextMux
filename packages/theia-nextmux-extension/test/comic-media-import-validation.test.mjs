import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

function makeMedia(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
}

test('comic import accepts decoded media but skips invalid and extension-mismatched files without leaving copies', { timeout: 60_000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'nextmux-comic-import-validation-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspaceRoot = join(base, 'workspace');
  await mkdir(workspaceRoot);
  class Fixture extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(base, 'profile'); }
    async getMediaRuntimeState() {
      return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
        comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
    }
  }
  const service = new Fixture();
  await service.createComicProject({ workspaceRoot, title: 'Import validation', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 } });

  const picture = join(base, 'picture.png');
  const portrait = join(base, 'portrait.jpg');
  const tone = join(base, 'tone.wav');
  const clip = join(base, 'clip.mp4');
  const mislabeled = join(base, 'mislabeled.png');
  const mislabeledContainer = join(base, 'mislabeled.webm');
  const unreadable = join(base, 'not-a-picture.png');
  makeMedia(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-y', picture]);
  makeMedia(['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-y', portrait]);
  makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'pcm_s16le', '-y', tone]);
  makeMedia(['-f', 'lavfi', '-i', 'color=c=green:s=64x64:duration=0.2', '-c:v', 'mpeg4', '-y', clip]);
  await copyFile(portrait, mislabeled);
  await copyFile(clip, mislabeledContainer);
  await writeFile(unreadable, 'This is not an image.');

  const validFiles = [picture, portrait, tone, clip];
  const result = await service.importComicMedia({ workspaceRoot, paths: [...validFiles, mislabeled, mislabeledContainer, unreadable] });
  assert.equal(result.assetIds.length, 4, 'only valid media with matching extensions enters the project');
  assert.deepEqual(result.sources.map(Boolean), [true, true, true, true, false, false, false]);
  assert.deepEqual(result.skipped.map(item => [item.name, item.reason]), [
    ['mislabeled.png', 'unreadable'], ['mislabeled.webm', 'unreadable'], ['not-a-picture.png', 'unreadable']
  ]);
  const assets = result.assetIds.map(id => result.state.project.assets.find(item => item.id === id));
  assert.deepEqual(assets.map(asset => asset.mimeType), ['image/png', 'image/jpeg', 'audio/wav', 'video/mp4']);
  assert.equal(assets[2].durationMs, 200);
  assert.equal((await readdir(join(workspaceRoot, 'nextmux.media', 'imports'))).length, 4,
    'rejected material does not leave orphaned copies');
  for (let index = 0; index < validFiles.length; index += 1) {
    assert.deepEqual(await readFile(join(workspaceRoot, assets[index].uri)), await readFile(validFiles[index]),
      'the selected original is copied exactly and remains untouched');
  }
  assert.deepEqual(await readFile(mislabeled), await readFile(portrait));
  assert.deepEqual(await readFile(mislabeledContainer), await readFile(clip));
  assert.equal((await readFile(unreadable, 'utf8')), 'This is not an image.');
});

test('every advertised image, video, and audio extension still imports a real sample', { timeout: 60_000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'nextmux-comic-import-formats-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspaceRoot = join(base, 'workspace');
  await mkdir(workspaceRoot);
  class Fixture extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(base, 'profile'); }
    async getMediaRuntimeState() {
      return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
        comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
    }
  }
  const service = new Fixture();
  await service.createComicProject({ workspaceRoot, title: 'Format coverage', starter: 'empty', frameRate: 24,
    canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
  const videoExtensions = ['mp4', 'm4v', 'mov', 'webm'];
  const audioExtensions = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'];
  const allExtensions = [...imageExtensions, ...videoExtensions, ...audioExtensions];
  const paths = [];
  for (const extension of allExtensions) {
    const pathname = join(base, `sample.${extension}`);
    if (extension === 'webp') {
      // Two-pixel WebP fixture; the bundled FFmpeg can decode WebP, but cannot encode it.
      await writeFile(pathname, Buffer.from('UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAgA0JaACdLoAA5gA/vmTb/+QH/+QH/+QH/8gP+IXeyAwAA==', 'base64'));
    } else if (imageExtensions.includes(extension)) {
      makeMedia(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-y', pathname]);
    } else if (videoExtensions.includes(extension)) {
      makeMedia(['-f', 'lavfi', '-i', 'color=c=green:s=64x64:duration=0.2',
        '-c:v', extension === 'webm' ? 'libvpx' : 'mpeg4', '-y', pathname]);
    } else {
      const codec = extension === 'mp3' ? 'libmp3lame' : extension === 'wav' ? 'pcm_s16le'
        : extension === 'ogg' ? 'libvorbis' : extension === 'opus' ? 'libopus'
          : extension === 'flac' ? 'flac' : 'aac';
      makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', codec, '-y', pathname]);
    }
    paths.push(pathname);
  }
  const result = await service.importComicMedia({ workspaceRoot, paths });
  assert.deepEqual(result.skipped, [], `real supported files must not be skipped: ${JSON.stringify(result.skipped)}`);
  assert.equal(result.assetIds.length, allExtensions.length);
  assert.equal(result.sources.every(Boolean), true);
  assert.deepEqual(result.assetIds.map(id => result.state.project.assets.find(item => item.id === id)?.kind),
    allExtensions.map(extension => imageExtensions.includes(extension) ? 'image' : videoExtensions.includes(extension) ? 'video' : 'music'));
});
