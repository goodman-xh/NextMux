import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const inside = (root, path) => {
  const delta = relative(root, path);
  assert.ok(delta && !delta.startsWith('..') && !isAbsolute(delta), 'QA_FILE_OUTSIDE_PROFILE');
};
export const fixtureHash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readAttachmentOwnerSession(state, id) {
  const directory = join(state, 'conversation-history-v1');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'manifest-v1.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.ok(Array.isArray(manifest.sessions) && manifest.sessions.length <= 32, 'QA_MANIFEST_NOT_BOUNDED');
  const entry = manifest.sessions.find(item => item.id === id);
  if (!entry) return;
  assert.match(entry.file, /^session-[a-f0-9]{64}-[a-f0-9-]{36}\.json$/);
  const path = join(directory, entry.file), metadata = await lstat(path);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 1024 * 1024, 'QA_SESSION_NOT_BOUNDED');
  const session = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(session.id, id);
  return session;
}

export async function verifiedFixtureAttachment(profile, reference, expectedBytes) {
  assert.ok(reference && reference.uri?.startsWith('file:'), 'QA_ATTACHMENT_NOT_LOCAL');
  const path = fileURLToPath(reference.uri);
  const root = await realpath(profile);
  // macOS may report the same owned temp tree as /var or /private/var.
  // Permit that known root alias, never symlinks below the allocated profile.
  const lexicalDelta = relative(resolve(profile), resolve(path));
  const lexicalInside = lexicalDelta && !lexicalDelta.startsWith('..') && !isAbsolute(lexicalDelta);
  const delta = lexicalInside ? lexicalDelta : relative(root, resolve(path));
  inside(root, resolve(root, delta));
  let current = root;
  for (const part of delta.split(/[\\/]/)) {
    current = join(current, part);
    assert.equal((await lstat(current)).isSymbolicLink(), false, 'QA_ATTACHMENT_SYMLINK');
  }
  inside(root, await realpath(path));
  const metadata = await lstat(path);
  assert.ok(metadata.isFile() && metadata.size === expectedBytes.length && metadata.size <= 128 * 1024, 'QA_ATTACHMENT_SIZE');
  const bytes = await readFile(path);
  assert.equal(fixtureHash(bytes), fixtureHash(expectedBytes), 'QA_ATTACHMENT_HASH');
  assert.equal(reference.size, bytes.length);
  return { path, sha256: fixtureHash(bytes), size: bytes.length };
}

// Recoverably remove only this run's exact synthetic file. Never replace a
// concurrently created path when restoring, even inside the disposable tree.
export async function hideFixtureAttachment(profile, reference, expectedBytes) {
  const verified = await verifiedFixtureAttachment(profile, reference, expectedBytes);
  const backup = `${verified.path}.missing-${randomUUID()}`;
  assert.equal(await lstat(backup).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false);
  await rename(verified.path, backup);
  let restored = false;
  return async () => {
    if (restored) return;
    await verifiedFixtureAttachment(profile, { uri: pathToFileURL(backup).href, size: expectedBytes.length }, expectedBytes);
    await link(backup, verified.path); // Atomic EEXIST refusal, unlike overwrite-capable rename.
    await unlink(backup);
    restored = true;
  };
}
