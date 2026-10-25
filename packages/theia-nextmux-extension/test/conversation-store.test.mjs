import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CONVERSATION_STORE_READER_VERSION,
  CONVERSATION_STORE_SCHEMA_VERSION,
  CONVERSATION_STORE_WRITER_VERSION,
  CONVERSATION_MANIFEST_MAX_BYTES,
  CONVERSATION_SESSION_MAX_BYTES,
  ConversationStore,
  ConversationStoreError,
} from '../lib/node/nextmux-conversation-store.js';

const session = (id, turns = 1) => ({
  id,
  workspacePath: '/workspace/project',
  title: 'Durable history',
  turns: Array.from({ length: turns }, (_, index) => ({
    id: `turn-${index}`,
    prompt: `prompt-${index}`,
    response: `response-${index}`,
    error: '',
    stage: 'complete',
    createdAt: index + 1,
    permissionMode: 'workspace_write',
    routeLabel: 'route',
    executionLabel: '',
    usageLabel: '',
  })),
  pinned: false,
  createdAt: 1,
  updatedAt: turns + 1,
});

async function temporaryStore(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new ConversationStore(root);
}

test('conversation store keeps thousands of turns across a fresh store instance', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-store-');
  const original = session('session-1', 2_000);

  await store.save([original]);
  const restored = await new ConversationStore(store.root).load();

  assert.deepEqual(restored.sessions, [original]);
  assert.equal(restored.status, 'ok');
});

test('conversation store writes a versioned manifest and atomically replaces a session', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-atomic-');
  const first = session('session-1', 2);
  const second = { ...first, turns: [...first.turns, { ...first.turns[0], id: 'turn-2' }], updatedAt: 4 };

  await store.save([first]);
  await store.save([second]);

  const files = await readdir(store.root);
  assert.ok(files.includes('manifest-v1.json'));
  const manifest = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, CONVERSATION_STORE_SCHEMA_VERSION);
  assert.equal(manifest.createdByVersion, CONVERSATION_STORE_WRITER_VERSION);
  assert.equal(manifest.minimumReaderVersion, CONVERSATION_STORE_READER_VERSION);
  assert.equal(files.filter(file => /^session-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(file)).length, 1);
  assert.deepEqual((await store.load()).sessions, [second]);
  assert.deepEqual(files.filter(file => file.includes('.tmp-')), []);
});

test('legacy v1 manifests remain readable and are upgraded once through the atomic writer', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-legacy-manifest-');
  const original = session('session-1', 2);
  await store.save([original]);
  const path = join(store.root, 'manifest-v1.json');
  const legacy = JSON.parse(await readFile(path, 'utf8'));
  delete legacy.createdByVersion;
  delete legacy.minimumReaderVersion;
  const rawLegacy = JSON.stringify(legacy);
  await writeFile(path, rawLegacy, 'utf8');

  const reader = new ConversationStore(store.root);
  const originalWrite = reader.writeFile;
  let writes = 0;
  reader.writeFile = async (...args) => {
    writes += 1;
    return originalWrite(...args);
  };

  assert.deepEqual(await reader.load(), { sessions: [original], status: 'ok' });
  assert.equal(writes, 2);
  assert.deepEqual(await reader.load(), { sessions: [original], status: 'ok' });
  assert.equal(writes, 2);
  const upgraded = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(upgraded.createdByVersion, CONVERSATION_STORE_WRITER_VERSION);
  assert.equal(upgraded.minimumReaderVersion, CONVERSATION_STORE_READER_VERSION);
  const backupPath = join(store.root, 'manifest-v1.legacy-backup.json');
  assert.equal(await readFile(backupPath, 'utf8'), rawLegacy);

  // Restoring the preserved file is sufficient to rerun the same idempotent migration.
  await writeFile(path, await readFile(backupPath, 'utf8'), 'utf8');
  assert.deepEqual(await new ConversationStore(store.root).load(), { sessions: [original], status: 'ok' });
  assert.equal(await readFile(backupPath, 'utf8'), rawLegacy);
  assert.deepEqual((await readdir(store.root)).filter(file => file.includes('.tmp-')), []);
});

test('save preserves orphaned payloads when the manifest pointer is missing', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-missing-manifest-');
  const original = session('session-1', 2);
  await store.save([original]);
  await rm(join(store.root, 'manifest-v1.json'));

  const added = session('session-2', 1);
  await store.save([added]);

  const restored = await new ConversationStore(store.root).load();
  assert.deepEqual(restored.sessions.map(value => value.id).sort(), [original.id, added.id].sort());
  assert.equal(restored.status, 'ok');
});

test('save does not resurrect a permanent-delete tombstone when the manifest pointer is missing', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-tombstone-');
  const deleted = session('session-to-delete', 2);
  await store.save([deleted]);

  // Simulate a committed delete whose payload cleanup was interrupted. The
  // manifest and the durable tombstone are committed, while the body remains
  // on disk for a later cleanup retry.
  store.unlinkFile = async () => { throw Object.assign(new Error('cleanup interrupted'), { code: 'EACCES' }); };
  await assert.rejects(() => store.deleteProject('/workspace/project'), error =>
    error instanceof ConversationStoreError && error.code === 'STORE_UNAVAILABLE');
  const manifestPath = join(store.root, 'manifest-v1.json');
  const tombstonePath = join(store.root, '.conversation-store-tombstones-v1.json');
  const tombstones = JSON.parse(await readFile(tombstonePath, 'utf8'));
  assert.deepEqual(tombstones.deletedSessionIds, [deleted.id]);
  await rm(manifestPath);

  const added = session('session-after-missing-manifest', 1);
  await new ConversationStore(store.root).save([added]);
  const restored = await new ConversationStore(store.root).load();
  assert.deepEqual(restored.sessions.map(value => value.id), [added.id]);
  assert.deepEqual(restored.deletedSessionIds, [deleted.id]);
});

test('a malformed tombstone fence fails closed and leaves orphaned bodies intact', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-tombstone-corrupt-');
  const original = session('session-1', 1);
  await store.save([original]);
  await rm(join(store.root, 'manifest-v1.json'));
  await writeFile(join(store.root, '.conversation-store-tombstones-v1.json'), '{not-json', 'utf8');

  await assert.rejects(() => store.save([session('session-2', 1)]), error =>
    error instanceof ConversationStoreError && error.code === 'STORE_CORRUPT');
  assert.equal((await readdir(store.root)).some(file => file.startsWith('session-')), true);
});

test('indexed history rebuild also honors a durable tombstone when the manifest is missing', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-tombstone-index-');
  const deleted = session('session-to-delete', 1);
  await store.save([deleted]);
  store.unlinkFile = async () => { throw Object.assign(new Error('cleanup interrupted'), { code: 'EACCES' }); };
  await assert.rejects(() => store.deleteProject('/workspace/project'));
  await rm(join(store.root, 'manifest-v1.json'));

  const rebuilt = await new ConversationStore(store.root).list({ workspacePath: '/workspace/project' });
  assert.equal(rebuilt.total, 0);
  assert.deepEqual(rebuilt.sessions, []);
  assert.deepEqual(rebuilt.deletedSessionIds, [deleted.id]);
});

test('current manifest metadata is read-only during repeated loads', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-current-manifest-');
  const original = session('session-1', 2);
  await store.save([original]);
  const reader = new ConversationStore(store.root);
  let writes = 0;
  reader.writeFile = async () => {
    writes += 1;
    throw new Error('current manifests must not be rewritten while loading');
  };

  assert.deepEqual((await reader.load()).sessions, [original]);
  assert.deepEqual((await reader.load()).sessions, [original]);
  assert.equal(writes, 0);
});

test('future schema and reader versions fail closed without quarantine or overwrite', async t => {
  for (const [name, futureMetadata] of [
    ['schema', { schemaVersion: CONVERSATION_STORE_SCHEMA_VERSION + 1 }],
    ['reader', { minimumReaderVersion: CONVERSATION_STORE_READER_VERSION + 1 }],
  ]) {
    await t.test(name, async t => {
      const store = await temporaryStore(t, `nextmux-conversation-future-${name}-`);
      const original = session('session-1', 2);
      await store.save([original]);
      const path = join(store.root, 'manifest-v1.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      const future = JSON.stringify({ ...manifest, ...futureMetadata });
      await writeFile(path, future, 'utf8');

      const unsupported = error => error instanceof ConversationStoreError && error.code === 'UNSUPPORTED_VERSION';
      await assert.rejects(() => store.load(), unsupported);
      await assert.rejects(() => store.save([{ ...original, updatedAt: 10 }]), unsupported);
      await assert.rejects(() => store.patch([], ['session-1']), unsupported);
      await assert.rejects(() => store.clear(), unsupported);

      assert.equal(await readFile(path, 'utf8'), future);
      assert.equal((await readdir(store.root)).includes('corrupt'), false);
    });
  }
});

test('oversized manifests fail closed without quarantine or overwrite', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-oversized-manifest-');
  const original = session('session-1', 2);
  await store.save([original]);
  const path = join(store.root, 'manifest-v1.json');
  await writeFile(path, 'x'.repeat(CONVERSATION_MANIFEST_MAX_BYTES + 1), 'utf8');
  const oversized = error => error instanceof ConversationStoreError && error.code === 'TOO_LARGE';

  await assert.rejects(() => store.load(), oversized);
  await assert.rejects(() => store.save([{ ...original, updatedAt: 10 }]), oversized);
  await assert.rejects(() => store.patch([], ['session-1']), oversized);
  await assert.rejects(() => store.clear(), oversized);

  assert.equal((await stat(path)).size, CONVERSATION_MANIFEST_MAX_BYTES + 1);
  assert.equal((await readdir(store.root)).includes('corrupt'), false);
});

test('conversation store reuses unchanged session files instead of rewriting the full history', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-incremental-');
  const first = session('session-1', 2_000);
  const unchanged = session('session-2', 2_000);

  await store.save([first, unchanged]);
  const before = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  const beforeFiles = new Map(before.sessions.map(item => [item.id, item.file]));

  await store.save([{ ...first, title: 'Updated title', updatedAt: first.updatedAt + 1 }, unchanged]);
  const after = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  const afterFiles = new Map(after.sessions.map(item => [item.id, item.file]));

  assert.notEqual(afterFiles.get('session-1'), beforeFiles.get('session-1'));
  assert.equal(afterFiles.get('session-2'), beforeFiles.get('session-2'));
  assert.equal((await readdir(store.root)).filter(file => /^session-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(file)).length, 2);
});

test('conversation store patch serializes and replaces only changed sessions', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-patch-');
  const changed = session('session-1', 2_000);
  const untouched = session('session-2', 2_000);
  await store.save([changed, untouched]);
  const before = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  const beforeFiles = new Map(before.sessions.map(item => [item.id, item.file]));
  const updated = { ...changed, title: 'Only this session changed', updatedAt: changed.updatedAt + 1 };

  const result = await store.patch([updated], []);
  const after = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  const afterFiles = new Map(after.sessions.map(item => [item.id, item.file]));

  assert.deepEqual(result, { conversations: 2, upserted: 1, removed: 0 });
  assert.notEqual(afterFiles.get('session-1'), beforeFiles.get('session-1'));
  assert.equal(afterFiles.get('session-2'), beforeFiles.get('session-2'));
  assert.deepEqual((await store.load()).sessions, [updated, untouched]);
});

test('conversation store patch removes only requested sessions', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-patch-remove-');
  const first = session('session-1', 10);
  const second = session('session-2', 10);
  await store.save([first, second]);

  const result = await store.patch([], ['session-1']);

  assert.deepEqual(result, { conversations: 1, upserted: 0, removed: 1 });
  assert.deepEqual((await store.load()).sessions, [second]);
  assert.equal((await readdir(store.root)).filter(file => /^session-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(file)).length, 1);
});

test('failed incremental writes keep the previously committed manifest and sessions', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-patch-failure-');
  const original = session('session-1', 10);
  await store.save([original]);
  const originalWrite = store.writeFile;
  store.writeFile = async () => { throw new Error('disk full'); };

  await assert.rejects(() => store.patch([{ ...original, title: 'not committed', updatedAt: 99 }], []));
  store.writeFile = originalWrite;

  assert.deepEqual((await store.load()).sessions, [original]);
});

test('clearing conversation history removes committed and quarantined payload files', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-clear-');
  await store.save([session('session-1', 20)]);
  await writeFile(join(store.root, 'manifest-v1.legacy-backup.json'), 'private legacy history', 'utf8');
  await writeFile(join(store.root, 'corrupt', 'old-data.json'), 'private history', { encoding: 'utf8', flag: 'wx' }).catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(store.root, 'corrupt'));
    await writeFile(join(store.root, 'corrupt', 'old-data.json'), 'private history', 'utf8');
  });

  await store.clear();

  const files = await readdir(store.root);
  assert.deepEqual(files.filter(file => file.startsWith('session-')), []);
  assert.equal(files.includes('corrupt'), false);
  assert.equal(files.includes('manifest-v1.legacy-backup.json'), false);
  assert.deepEqual(await store.load(), { sessions: [], status: 'empty' });
});

test('conversation store rejects a non-directory storage root', async t => {
  const root = join(tmpdir(), `nextmux-conversation-unsafe-${crypto.randomUUID()}`);
  await writeFile(root, 'not a directory', 'utf8');
  t.after(() => rm(root, { force: true }));

  await assert.rejects(
    () => new ConversationStore(root).load(),
    error => error instanceof ConversationStoreError && error.code === 'STORE_UNSAFE'
  );
});

test('corrupt session data is quarantined without discarding healthy sessions', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-corrupt-');
  await store.save([session('healthy', 1), session('broken', 1)]);
  const manifest = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  const brokenEntry = manifest.sessions.find(item => item.id === 'broken');
  await writeFile(join(store.root, brokenEntry.file), '{not-json', 'utf8');

  const restored = await store.load();

  assert.deepEqual(restored.sessions.map(item => item.id), ['healthy']);
  assert.equal(restored.status, 'partial');
  assert.ok((await readdir(join(store.root, 'corrupt'))).length >= 1);
});

test('store rejects unsafe identifiers and oversized individual sessions without truncation', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-invalid-');
  await assert.rejects(
    () => store.save([session('../escape', 1)]),
    error => error instanceof ConversationStoreError && error.code === 'INVALID_SESSION'
  );
  const huge = session('huge', 1);
  huge.turns[0].response = 'x'.repeat(CONVERSATION_SESSION_MAX_BYTES);
  await assert.rejects(
    () => store.save([huge]),
    error => error instanceof ConversationStoreError && error.code === 'TOO_LARGE'
  );
});

test('failed writes leave the last committed history intact', async t => {
  const store = await temporaryStore(t, 'nextmux-conversation-failure-');
  const first = session('session-1', 2);
  await store.save([first]);
  const originalWrite = store.writeFile;
  store.writeFile = async () => { throw new Error('disk full'); };

  await assert.rejects(() => store.save([{ ...first, turns: [...first.turns, { ...first.turns[0], id: 'turn-2' }] }]));
  store.writeFile = originalWrite;
  assert.deepEqual((await store.load()).sessions, [first]);
});
