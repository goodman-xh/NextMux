import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
class Fixture extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
  async getMediaRuntimeState() {
    return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' },
      comfyUi: { configured: false, available: false, source: 'missing', message: '' } };
  }
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'nmx-comic-export-history-archive-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspaceRoot = join(base, 'workspace');
  const destination = join(base, 'backups');
  await mkdir(workspaceRoot);
  await mkdir(destination);
  const service = new Fixture(join(base, 'profile'));
  await service.createComicProject({ workspaceRoot, title: 'PRIVATE_PROJECT_TITLE_FOR_ARCHIVE_TEST', starter: 'storyboard',
    frameRate: 24, canvas: { aspectRatio: '16:9', width: 320, height: 180 } });
  return { base, workspaceRoot, destination, service };
}

async function completedExport(service, workspaceRoot, destinationDirectory) {
  const started = await service.startComicExport({ workspaceRoot, quality: 'draft', subtitleMode: 'none',
    allowPlaceholders: true, verifyAssetIntegrity: true, ...(destinationDirectory ? { destinationDirectory } : {}) });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await service.getComicExportWorkspaceState(workspaceRoot);
    const item = state.exports.find(candidate => candidate.id === started.id);
    if (!state.active && item?.status === 'completed') return item;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('real comic export did not complete');
}

test('completed export record round-trips as inert metadata without film bytes or paths', async t => {
  const { base, workspaceRoot, destination, service } = await fixture(t);
  const movies = join(base, 'movies');
  await mkdir(movies);
  const completed = await completedExport(service, workspaceRoot, movies);
  assert.ok(completed.output?.relativeUri);
  assert.ok(completed.output.savedPath);
  const result = await service.exportComicExportHistoryArchive(workspaceRoot, pathToFileURL(destination).toString());
  assert.equal(result.records, 1);
  const archivePath = new URL(result.fileUri);
  const archiveText = await readFile(archivePath, 'utf8');
  assert.ok((await stat(archivePath)).size < 128_000);
  assert.equal(archiveText.includes('PRIVATE_PROJECT_TITLE_FOR_ARCHIVE_TEST'), false);
  assert.equal(archiveText.includes(completed.output.relativeUri), false);
  assert.equal(archiveText.includes(completed.output.savedPath), false);
  assert.equal(archiveText.includes('savedPath'), false);
  assert.equal(archiveText.includes('output'), false);
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  const imported = await service.importComicExportHistoryArchive(workspaceRoot, result.fileUri);
  assert.equal(imported.records, 1);
  const state = await service.getComicExportWorkspaceState(workspaceRoot);
  assert.equal(state.active, undefined);
  assert.equal(state.exports[0]?.restoredHistoryOnly, true);
  assert.equal(state.exports[0]?.status, 'completed');
  assert.equal(state.exports[0]?.output, undefined);
  assert.equal(state.exports[0]?.cancellable, false);
  await assert.rejects(service.importComicExportHistoryArchive(workspaceRoot, result.fileUri),
    { code: 'COMIC_EXPORT_HISTORY_NOT_EMPTY' });
});

test('tampered archive and other workspace binding leave an empty destination unchanged', async t => {
  const { base, workspaceRoot, destination, service } = await fixture(t);
  await completedExport(service, workspaceRoot);
  const result = await service.exportComicExportHistoryArchive(workspaceRoot, pathToFileURL(destination).toString());
  const original = JSON.parse(await readFile(new URL(result.fileUri), 'utf8'));
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  const tampered = join(destination, 'tampered.nmxcomicexports');
  const forgedRecords = [{ ...original.records[0], output: { savedPath: '/private/token.mp4' } }];
  await writeFile(tampered, JSON.stringify({ ...original, records: forgedRecords,
    contentSha256: createHash('sha256').update(JSON.stringify(forgedRecords)).digest('hex') }));
  await assert.rejects(service.importComicExportHistoryArchive(workspaceRoot, pathToFileURL(tampered).toString()),
    { code: 'COMIC_EXPORT_HISTORY_ARCHIVE_INVALID' });
  const otherWorkspace = join(base, 'other-workspace');
  await mkdir(otherWorkspace);
  await assert.rejects(service.importComicExportHistoryArchive(otherWorkspace, result.fileUri),
    { code: 'COMIC_EXPORT_HISTORY_WORKSPACE_MISMATCH' });
  const state = await service.getComicExportWorkspaceState(workspaceRoot);
  assert.equal(state.exports.length, 0);
});

test('one hundred restored future-dated records cannot hide or block a fresh export', async t => {
  const { workspaceRoot, destination, service } = await fixture(t);
  await completedExport(service, workspaceRoot);
  const result = await service.exportComicExportHistoryArchive(workspaceRoot, pathToFileURL(destination).toString());
  const original = JSON.parse(await readFile(new URL(result.fileUri), 'utf8'));
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  const records = Array.from({ length: 100 }, () => ({ ...original.records[0], id: `comic-export-${randomUUID()}`,
    startedAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:00:00.000Z' }));
  const largeArchive = join(destination, 'large.nmxcomicexports');
  await writeFile(largeArchive, JSON.stringify({ ...original, records, recordCount: records.length,
    contentSha256: createHash('sha256').update(JSON.stringify(records)).digest('hex') }));
  assert.equal((await service.importComicExportHistoryArchive(workspaceRoot, pathToFileURL(largeArchive).toString())).records, 100);
  await assert.rejects(service.cancelComicExport(workspaceRoot, records[0].id), { code: 'COMIC_EXPORT_READ_ONLY' });
  const fresh = await completedExport(service, workspaceRoot);
  const listed = await service.getComicExportWorkspaceState(workspaceRoot);
  assert.equal(listed.exports.length, 101);
  assert.equal(listed.exports[0].id, fresh.id);
  assert.equal(listed.exports[0].restoredHistoryOnly, undefined);
  assert.equal(listed.exports.filter(item => item.restoredHistoryOnly).length, 100);
});

test('an archive name collision never removes an existing backup file', async t => {
  const { workspaceRoot, destination, service } = await fixture(t);
  await completedExport(service, workspaceRoot);
  const existing = join(destination, 'existing.nmxcomicexports');
  await writeFile(existing, 'ORIGINAL_BACKUP_BYTES');
  service.comicExportArchiveFileName = () => 'existing.nmxcomicexports';
  await assert.rejects(service.exportComicExportHistoryArchive(workspaceRoot, pathToFileURL(destination).toString()),
    { code: 'COMIC_EXPORT_HISTORY_EXPORT_FAILED' });
  assert.equal(await readFile(existing, 'utf8'), 'ORIGINAL_BACKUP_BYTES');
});

test('existing history temp files are never removed after an exclusive-create collision', async t => {
  const { workspaceRoot, service } = await fixture(t);
  const cryptoModule = require('node:crypto');
  const originalRandomUUID = cryptoModule.randomUUID;
  cryptoModule.randomUUID = () => 'owned-by-another-writer';
  t.after(() => { cryptoModule.randomUUID = originalRandomUUID; });
  const workspaceId = service.mediaWorkspaceId(workspaceRoot);
  for (const target of [service.comicExportHistoryPath(workspaceId), service.restoredComicExportHistoryPath(workspaceId)]) {
    await mkdir(dirname(target), { recursive: true });
    const existing = `${target}.tmp-owned-by-another-writer`;
    await writeFile(existing, 'OTHER_WRITER_TEMP_FILE');
    if (target.endsWith('restored-v1.json')) {
      await assert.rejects(service.writeRestoredComicExportHistory(workspaceId, [], () => {}), { code: 'EEXIST' });
    } else {
      await assert.rejects(service.writeComicExportHistory(workspaceId, []), { code: 'EEXIST' });
    }
    assert.equal(await readFile(existing, 'utf8'), 'OTHER_WRITER_TEMP_FILE');
  }
});

test('an empty export-history directory can receive an archive, but unknown files block it', async t => {
  const { workspaceRoot, destination, service } = await fixture(t);
  await completedExport(service, workspaceRoot);
  const archive = await service.exportComicExportHistoryArchive(workspaceRoot, pathToFileURL(destination).toString());
  await service.clearDesktopLocalData({ workspaceRoot, categories: ['comic_exports'] });
  const category = dirname(service.comicExportHistoryPath(service.mediaWorkspaceId(workspaceRoot)));
  await mkdir(category, { recursive: true });
  const entry = (await service.getDesktopLocalDataState(workspaceRoot)).entries.find(item => item.category === 'comic_exports');
  assert.equal(entry.files, 0);
  const unknown = join(category, 'unknown-record');
  await writeFile(unknown, 'DO_NOT_OVERWRITE');
  await assert.rejects(service.importComicExportHistoryArchive(workspaceRoot, archive.fileUri),
    { code: 'COMIC_EXPORT_HISTORY_NOT_EMPTY' });
  assert.equal(await readFile(unknown, 'utf8'), 'DO_NOT_OVERWRITE');
  await rm(unknown);
  assert.equal((await service.importComicExportHistoryArchive(workspaceRoot, archive.fileUri)).records, 1);
});
