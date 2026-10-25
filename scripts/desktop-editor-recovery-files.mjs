import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureHash, verifiedFixtureAttachment } from './desktop-attachment-owner-files.mjs';

/** Read bounded records only from the freshly allocated synthetic profile. */
export async function readOwnedEditorRecovery(profile, expected) {
  const directory = join(profile, 'nextmux-state', 'file-editor-recovery-v1');
  const info = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return; throw error; });
  if (!info) return;
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'RECOVERY_QA_UNSAFE_DIRECTORY');
  const files = (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  assert.ok(files.length <= 32, 'RECOVERY_QA_RECORD_LIMIT');
  for (const name of files) {
    const path = join(directory, name), metadata = await lstat(path);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 1024 * 1024, 'RECOVERY_QA_UNSAFE_RECORD');
    const record = JSON.parse(await readFile(path, 'utf8'));
    if (record.snapshot?.name !== expected.name) continue;
    assert.equal(`${record.id}.json`, name); assert.equal(record.version, 1);
    assert.equal(record.snapshot.baseline.current, expected.original);
    assert.equal(record.snapshot.drafts.current, expected.draft);
    assert.ok([pathToFileURL(expected.file).href, pathToFileURL(await realpath(expected.file)).href].includes(record.snapshot.sourceUri),
      'RECOVERY_QA_WRONG_SOURCE');
    assert.equal(record.snapshotSha256, fixtureHash(Buffer.from(JSON.stringify(record.snapshot))));
    return { id: record.id, revision: record.revision, snapshotSha256: record.snapshotSha256,
      sourceUri: record.snapshot.sourceUri, source: record.source, draftSha256: fixtureHash(Buffer.from(record.snapshot.drafts.current)) };
  }
}

/** The app has already exited naturally. Alter only this run's verified fixture. */
export async function replaceOwnedEditorFixture(profile, path, before, after) {
  const original = Buffer.from(before), next = Buffer.from(after);
  assert.ok(next.length > 0 && next.length <= 128 * 1024, 'RECOVERY_QA_FIXTURE_LIMIT');
  const reference = { uri: pathToFileURL(path).href, size: original.length };
  await verifiedFixtureAttachment(profile, reference, original);
  const expected = await lstat(path);
  const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    assert.ok(current.isFile() && current.dev === expected.dev && current.ino === expected.ino, 'RECOVERY_QA_CHANGED_FIXTURE');
    const bytes = await handle.readFile();
    assert.equal(fixtureHash(bytes), fixtureHash(original));
    await handle.truncate(0);
    for (let offset = 0; offset < next.length;) {
      const result = await handle.write(next, offset, next.length - offset, offset);
      assert.ok(result.bytesWritten > 0, 'RECOVERY_QA_SHORT_WRITE');
      offset += result.bytesWritten;
    }
    await handle.sync();
  } finally { await handle.close(); }
  await verifiedFixtureAttachment(profile, { ...reference, size: next.length }, next);
  return { beforeSha256: fixtureHash(original), afterSha256: fixtureHash(next), bytes: next.length };
}
