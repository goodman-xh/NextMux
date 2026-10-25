import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ArchiveService extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-comic-history-archive-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const destination = join(sandbox, 'backups');
  const profile = join(sandbox, 'profile');
  await mkdir(workspaceRoot);
  await mkdir(destination);
  const service = new ArchiveService(profile);
  const store = await service.comicProjectStore(workspaceRoot);
  const initial = await store.initialize({ title: 'Backup fixture' });
  const changed = await store.commitPrepared(initial.project.revision, {
    ...initial.project, revision: initial.project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  const historyRoot = join(profile, 'comic-history', service.mediaWorkspaceId(workspaceRoot));
  const snapshotName = (await readdir(historyRoot)).find(name => name.endsWith('.json'));
  assert.ok(snapshotName);
  const original = await readFile(join(historyRoot, snapshotName));
  return { workspaceRoot, destination, service, store, changed, historyRoot, snapshotName, original };
}

test('versioned comic history archive restores verified snapshots after clear', async t => {
  const f = await fixture(t);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  assert.equal(exported.files, 1);
  const archiveRoot = fileURLToPath(exported.directoryUri);
  const manifest = JSON.parse(await readFile(join(archiveRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'nextmux.comic-history');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.projectId, f.changed.project.id);
  assert.equal(manifest.projectRevision, f.changed.project.revision);
  assert.deepEqual(await readFile(join(archiveRoot, 'files', f.snapshotName)), f.original);

  await f.service.clearDesktopLocalData({ workspaceRoot: f.workspaceRoot, categories: ['comic_history'] });
  const imported = await f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri);
  assert.equal(imported.files, 1);
  assert.deepEqual(await readFile(join(f.historyRoot, f.snapshotName)), f.original);
  assert.equal((await f.store.read()).project.revision, f.changed.project.revision);
});

test('tampered comic history archive is refused and leaves the destination empty', async t => {
  const f = await fixture(t);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  await f.service.clearDesktopLocalData({ workspaceRoot: f.workspaceRoot, categories: ['comic_history'] });
  await writeFile(join(fileURLToPath(exported.directoryUri), 'files', f.snapshotName), 'tampered');
  await assert.rejects(f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri),
    { code: 'COMIC_HISTORY_ARCHIVE_INVALID' });
  assert.deepEqual(await readdir(f.historyRoot), []);
});

test('comic history import refuses a changed current project revision', async t => {
  const f = await fixture(t);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  await f.store.commitPrepared(f.changed.project.revision, {
    ...f.changed.project, revision: f.changed.project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  await f.service.clearDesktopLocalData({ workspaceRoot: f.workspaceRoot, categories: ['comic_history'] });
  await assert.rejects(f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri),
    { code: 'COMIC_HISTORY_CONFLICT' });
  assert.equal((await f.store.read()).project.revision, f.changed.project.revision + 1);
  assert.deepEqual(await readdir(f.historyRoot), []);
});

test('comic history import refuses to replace existing snapshots', async t => {
  const f = await fixture(t);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  await assert.rejects(f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri),
    { code: 'COMIC_HISTORY_NOT_EMPTY' });
  assert.deepEqual(await readFile(join(f.historyRoot, f.snapshotName)), f.original);
});

test('multiple snapshots round-trip without copying the live project file', async t => {
  const f = await fixture(t);
  await f.store.commitPrepared(f.changed.project.revision, {
    ...f.changed.project, revision: f.changed.project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  const names = (await readdir(f.historyRoot)).filter(name => name.endsWith('.json')).sort();
  assert.equal(names.length, 2);
  const originals = await Promise.all(names.map(name => readFile(join(f.historyRoot, name))));
  const liveProject = await readFile(f.store.projectPath);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  assert.equal(exported.files, 2);
  assert.deepEqual((await readdir(fileURLToPath(exported.directoryUri))).sort(), ['files', 'manifest.json']);
  await f.service.clearDesktopLocalData({ workspaceRoot: f.workspaceRoot, categories: ['comic_history'] });
  await f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri);
  assert.deepEqual(await Promise.all(names.map(name => readFile(join(f.historyRoot, name)))), originals);
  assert.deepEqual(await readFile(f.store.projectPath), liveProject);
});

test('symlinked archive snapshot is rejected before restoring any history', async t => {
  const f = await fixture(t);
  const exported = await f.service.exportComicHistoryArchive(f.workspaceRoot, pathToFileURL(f.destination).toString());
  await f.service.clearDesktopLocalData({ workspaceRoot: f.workspaceRoot, categories: ['comic_history'] });
  const file = join(fileURLToPath(exported.directoryUri), 'files', f.snapshotName);
  const external = join(f.destination, 'external-snapshot.json');
  await writeFile(external, f.original);
  await rm(file);
  await symlink(external, file);
  await assert.rejects(f.service.importComicHistoryArchive(f.workspaceRoot, exported.directoryUri),
    { code: 'COMIC_HISTORY_ARCHIVE_INVALID' });
  assert.deepEqual(await readdir(f.historyRoot), []);
});
