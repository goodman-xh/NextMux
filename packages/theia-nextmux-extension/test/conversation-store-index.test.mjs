import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ConversationStore, CONVERSATION_PAYLOAD_WRITE_CONCURRENCY } from '../lib/node/nextmux-conversation-store.js';
import { ConversationIndex } from '../lib/node/nextmux-conversation-index.js';

const session = (number, workspacePath = '/project/a') => ({
  id: `conversation-${String(number).padStart(6, '0')}`, workspacePath, title: `Conversation ${number}`,
  createdAt: 1, updatedAt: number + 2, pinned: false,
  turns: [{ id: `turn-${number}`, prompt: `Question ${number}`, response: `Answer ${number}`, createdAt: 1, stage: 'complete' }],
});

async function storeFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-index-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new ConversationStore(root);
}

test('derived conversation index uses WAL and NORMAL synchronization', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-index-pragma-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const indexPath = join(root, 'index-v1.sqlite');
  const index = new ConversationIndex(indexPath);
  // synchronous is connection-scoped in SQLite, so inspect it on the
  // configured index connection before closing it; journal_mode persists.
  assert.equal(index.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(index.db.prepare('PRAGMA synchronous').get().synchronous, 1);
  index.close();

  const db = new DatabaseSync(indexPath);
  try { assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal'); }
  finally { db.close(); }
});

test('payload writes use a bounded worker pool without changing the durable format', async t => {
  const store = await storeFor(t);
  const original = store.writeSerializedSession.bind(store);
  let active = 0;
  let maximum = 0;
  store.writeSerializedSession = async (...args) => {
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return await original(...args);
    } finally {
      active -= 1;
    }
  };
  await store.save(Array.from({ length: 12 }, (_, i) => session(i)));
  assert.equal(maximum, CONVERSATION_PAYLOAD_WRITE_CONCURRENCY);
  assert.equal((await store.list({ limit: 20 })).total, 12);
  assert.equal((await store.readSession(session(0).id)).id, session(0).id);
});

test('a mid-batch payload failure keeps the previous generation recoverable after restart', async t => {
  const store = await storeFor(t);
  const baseline = session(0);
  await store.save([baseline]);
  const original = store.writeSerializedSession.bind(store);
  let calls = 0;
  store.writeSerializedSession = async (...args) => {
    calls += 1;
    if (calls === 3) throw new Error('injected payload failure');
    return original(...args);
  };
  await assert.rejects(
    () => store.save(Array.from({ length: 20 }, (_, i) => session(i + 1))),
    error => error.domainError?.params.reason === 'store_snapshot_save_failed'
  );

  const restarted = new ConversationStore(store.root);
  const recovered = await restarted.load();
  assert.equal(recovered.sessions.length, 1);
  assert.equal(recovered.sessions[0].id, baseline.id);
  // The failure was reported to the caller, so nothing of it is replayed later (audit B04-05).
  assert.ok(!recovered.pendingRecovery?.length, 'a reported failure leaves no commit intent to roll forward');
  assert.deepEqual(await restarted.readSession(baseline.id), baseline);
});

test('indexed pagination keeps sharded manifest pointers lazy until a body read', async t => {
  const store = await storeFor(t);
  const data = Array.from({ length: 12 }, (_, i) => session(i));
  await store.save(data);
  const manifestPath = join(store.root, 'manifest-v1.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const shardRaw = JSON.stringify({ sessions: manifest.sessions });
  const shard = `manifest-v1-shard-${createHash('sha256').update(shardRaw).digest('hex')}.json`;
  await writeFile(join(store.root, shard), shardRaw, 'utf8');
  await writeFile(manifestPath, JSON.stringify({ ...manifest, sessions: [], shardFiles: [shard] }), 'utf8');

  const reader = new ConversationStore(store.root);
  let shardReads = 0;
  const original = reader.readFile;
  reader.readFile = async (path, ...args) => {
    if (String(path).endsWith(shard)) shardReads += 1;
    return original(path, ...args);
  };
  const page = await reader.list({ workspacePath: '/project/a', limit: 3 });
  assert.equal(page.total, data.length);
  assert.equal(page.sessions.length, 3);
  assert.equal(shardReads, 0, 'indexed list must not expand every manifest shard');
  await reader.readSession(data.at(-1).id);
  assert.equal(shardReads, 1, 'direct body lookup expands the manifest exactly when needed');
});

for (const count of [10_001, 50_000]) test(`${count} durable conversations in one project page, search, open, sort and delete`, async t => {
  const store = await storeFor(t);
  const data = Array.from({ length: count }, (_, i) => session(i));
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  await store.save(data);
  t.diagnostic(JSON.stringify({ count, saveMs: Math.round(performance.now() - started), cpuMicros: process.cpuUsage(cpuStart), peakRssKiB: process.resourceUsage().maxRSS }));

  const reader = new ConversationStore(store.root);
  let payloadReads = 0;
  const original = reader.readFile;
  reader.readFile = async (path, ...args) => {
    if (String(path).split('/').pop().startsWith('session-')) payloadReads++;
    return original(path, ...args);
  };
  const first = await reader.list({ workspacePath: '/project/a', limit: 73 });
  assert.equal(first.total, count);
  assert.equal(first.sessions.length, 73);
  assert.equal(first.sessions[0].id, data.at(-1).id);
  assert.equal(first.sessions[0].historyLoaded, false);
  assert.deepEqual(first.sessions[0].turns, []);
  const second = await reader.list({ workspacePath: '/project/a', limit: 73, cursor: first.nextCursor });
  assert.equal(new Set([...first.sessions, ...second.sessions].map(s => s.id)).size, 146);
  assert.equal(payloadReads, 0);
  assert.equal((await reader.search({ query: `Question ${count - 1}` })).matches[0].conversationId, data.at(-1).id);
  assert.equal(payloadReads, 0, 'search reads the SQLite index only');
  assert.deepEqual(await reader.readSession(data.at(-1).id), data.at(-1));
  assert.equal(payloadReads, 1);

  await reader.patch([{ ...data.at(-1), title: 'Renamed', updatedAt: 99_000,
    turns: [{ ...data.at(-1).turns[0], prompt: 'new distinct indexed content' }] }], [data[0].id]);
  assert.equal((await reader.list({ workspacePath: '/project/a' })).total, count - 1);
  assert.equal((await reader.search({ query: 'new distinct indexed content' })).matches[0].title, 'Renamed');
  assert.equal(payloadReads, 1, 'incremental index update never rebuilds unrelated histories');
  assert.equal((await reader.list({ workspacePath: '/project/a', limit: 1 })).sessions[0].title, 'Renamed');
  await assert.rejects(() => reader.list({ workspacePath: '/project/b', cursor: first.nextCursor }), error => error.domainError?.params.reason === 'store_conversation_cursor_invalid');
});

test('50,000 indexed summaries support stable project pagination and exact search with zero payload reads', async t => {
  const store = await storeFor(t);
  const generation = randomUUID();
  const index = new ConversationIndex(join(store.root, 'index-v1.sqlite'));
  const entries = [];
  index.begin(true);
  const started = performance.now();
  for (let i = 0; i < 50_000; i++) {
    const s = session(i);
    // Include equal timestamps to prove the ID tie-break cursor neither repeats nor skips records.
    s.updatedAt = 2 + Math.floor(i / 3);
    index.upsert(s);
    entries.push({ id: s.id, workspacePath: s.workspacePath, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      file: `session-${createHash('sha256').update(s.id).digest('hex')}-${generation}.json` });
  }
  index.commit(generation);
  index.close();
  await writeFile(join(store.root, 'manifest-v1.json'), JSON.stringify({ schemaVersion: 1, createdByVersion: 2,
    minimumReaderVersion: 2, generation, sessions: entries }));
  t.diagnostic(`index 50,000 records: ${Math.round(performance.now() - started)} ms`);
  store.readFile = async (path, ...args) => {
    assert.ok(!String(path).split('/').pop().startsWith('session-'), 'pagination/search must not hydrate bodies');
    return readFile(path, ...args);
  };
  const seen = new Set();
  let cursor;
  const pageStarted = performance.now();
  do {
    const page = await store.list({ workspacePath: '/project/a', limit: 500, cursor });
    assert.equal(page.total, 50_000);
    for (const item of page.sessions) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 50_000);
  const exact = await store.search({ conversationId: session(1).id, messageId: 'turn-1:user' });
  assert.equal(exact.matches[0].conversationId, session(1).id);
  t.diagnostic(`page all 50,000 summaries: ${Math.round(performance.now() - pageStarted)} ms`);
});

test('legacy index migration and corrupt SQLite rebuild preserve authoritative JSON', async t => {
  const store = await storeFor(t);
  const original = session(1);
  await store.save([original]);
  const manifestPath = join(store.root, 'manifest-v1.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.createdByVersion; delete manifest.minimumReaderVersion;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(store.root, 'index-v1.sqlite'), 'not a sqlite database');
  // A failed SQLite open must quarantine its WAL/SHM sidecars together with
  // the main derived file; otherwise a fresh index can observe stale pages.
  await writeFile(join(store.root, 'index-v1.sqlite-wal'), 'orphan wal');
  await writeFile(join(store.root, 'index-v1.sqlite-shm'), 'orphan shm');
  const result = await store.list();
  assert.equal(result.sessions[0].id, original.id);
  assert.deepEqual(await store.readSession(original.id), original);
  assert.ok((await readdir(store.root)).includes('manifest-v1.legacy-backup.json'));
  assert.equal((await store.search({ query: 'Question 1' })).matches[0].conversationId, original.id);
  assert.equal((await readdir(join(store.root, 'corrupt'))).filter(name => name.startsWith('session-')).length, 0);
  const corrupt = await readdir(join(store.root, 'corrupt'));
  assert.equal(corrupt.filter(name => name.startsWith('index-v1.sqlite')).length, 1);
  assert.equal((await readdir(store.root)).some(name => /^index-v1\.sqlite-(wal|shm)$/.test(name)), false,
    'a rebuilt index must never retain orphan WAL/SHM sidecars');
  assert.deepEqual(JSON.parse(await readFile(join(store.root, manifest.sessions[0].file), 'utf8')), original);
});

test('rebuilding an index with a missing payload still exposes healthy conversations', async t => {
  const store = await storeFor(t);
  await store.save([session(1), session(2)]);
  const manifest = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
  await rm(join(store.root, manifest.sessions[0].file));
  await rm(join(store.root, 'index-v1.sqlite'));
  const page = await store.list();
  assert.equal(page.status, 'partial');
  assert.equal(page.total, 1);
  assert.equal(page.sessions[0].id, session(2).id);
  assert.deepEqual(await store.readSession(session(2).id), session(2));
});

test('summary placeholders and stale snapshots cannot overwrite durable conversation bodies', async t => {
  const store = await storeFor(t);
  const original = session(9);
  await store.save([original]);
  const summary = (await store.list()).sessions[0];
  await assert.rejects(() => store.patch([summary], []), error => error.domainError?.params.reason === 'store_session_invalid');
  await assert.rejects(() => store.patch([{ ...original, updatedAt: 1 }], []), error => error.domainError?.params.reason === 'store_concurrent_update');
  assert.deepEqual(await store.readSession(original.id), original);
});

test('explicit history deletion removes searchable plaintext as well as JSON payloads', async t => {
  const store = await storeFor(t);
  await store.save([session(1)]);
  assert.equal((await store.search({ query: 'Question' })).matches.length, 1);
  await store.clear();
  assert.equal((await readdir(store.root)).some(name => name.startsWith('index-v1.sqlite')), false);
  assert.equal((await store.search({ query: 'Question' })).matches.length, 0);
});

test('post-commit cleanup failure never rolls back already committed payload files', async t => {
  const store = await storeFor(t);
  const original = session(1);
  const removed = session(2);
  await store.save([original, removed]);
  store.unlinkFile = async () => { throw new Error('cleanup failed'); };
  // Exercise the strict cleanup branch used by project deletion after the index is committed.
  await assert.rejects(() => store.deleteProject('/project/a'), error => error.domainError?.params.reason === 'store_removed_cleanup_failed');
  assert.equal((await store.list()).total, 0);
  assert.equal(await store.readSession(original.id), undefined);
  assert.equal((await readdir(store.root)).filter(name => name.startsWith('session-')).length, 2,
    'failed cleanup must preserve source bytes, never resurrect them in the committed index');
});

test('an error after manifest publication retains the newly referenced body for recovery', async t => {
  const store = await storeFor(t);
  const original = session(1);
  await store.save([original]);
  const replacement = { ...original, title: 'Published despite directory sync failure', updatedAt: 77 };
  const atomicWrite = store.atomicWrite.bind(store);
  store.atomicWrite = async (temporary, target, content) => {
    await atomicWrite(temporary, target, content);
    if (target.endsWith('manifest-v1.json')) throw new Error('directory sync failed after rename');
  };
  await assert.rejects(() => store.patch([replacement], []));
  assert.deepEqual(await new ConversationStore(store.root).readSession(original.id), replacement);
  assert.equal((await new ConversationStore(store.root).search({ query: replacement.title })).matches[0].title, replacement.title);
});

test('valid histories larger than the old 128 MiB aggregate cap remain readable and patchable', async t => {
  const store = await storeFor(t);
  const generation = randomUUID();
  const entries = [];
  for (let i = 0; i < 3; i++) {
    const s = session(i);
    s.turns[0].response = 'x'.repeat(44 * 1024 * 1024);
    const content = JSON.stringify(s);
    const file = `session-${createHash('sha256').update(s.id).digest('hex')}-${generation}.json`;
    await writeFile(join(store.root, file), content);
    entries.push({ id: s.id, workspacePath: s.workspacePath, title: s.title, createdAt: s.createdAt,
      updatedAt: s.updatedAt, file, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) });
  }
  assert.ok(entries.reduce((n, entry) => n + entry.bytes, 0) > 128 * 1024 * 1024);
  await writeFile(join(store.root, 'manifest-v1.json'), JSON.stringify({ schemaVersion: 1, createdByVersion: 2,
    minimumReaderVersion: 2, generation, sessions: entries }));
  assert.equal((await store.patch([session(99)], [])).conversations, 4);
  const restored = await store.load();
  assert.equal(restored.status, 'ok');
  assert.equal(restored.sessions.length, 4);
  assert.ok(!(await readdir(store.root)).includes('corrupt'), 'valid payloads cannot be quarantined because total storage grew');
});

test('readSessionTurnWindow paginates older turns for scroll-up loading while preserving every historical turn', async t => {
  const store = await storeFor(t);
  const longSession = {
    ...session(500),
    turns: Array.from({ length: 1_200 }, (_, i) => ({
      id: `turn-${i}`,
      prompt: `Prompt number ${i}`,
      response: `Response number ${i}`,
      createdAt: i + 1,
      stage: 'complete'
    }))
  };
  await store.save([longSession]);
  const newestWindow = await store.readSessionTurnWindow(longSession.id, { limit: 50 });
  assert.equal(newestWindow.totalTurns, 1_200);
  assert.equal(newestWindow.startTurnIndex, 1_150);
  assert.equal(newestWindow.endTurnIndex, 1_200);
  assert.equal(newestWindow.hasOlderTurns, true);
  assert.equal(newestWindow.turns.length, 50);
  assert.equal(newestWindow.turns[0].id, 'turn-1150');
  assert.equal(newestWindow.turns.at(-1).id, 'turn-1199');

  const olderWindow = await store.readSessionTurnWindow(longSession.id, { beforeTurnIndex: newestWindow.startTurnIndex, limit: 50 });
  assert.equal(olderWindow.startTurnIndex, 1_100);
  assert.equal(olderWindow.endTurnIndex, 1_150);
  assert.equal(olderWindow.hasOlderTurns, true);
  assert.equal(olderWindow.turns[0].id, 'turn-1100');

  const earliestWindow = await store.readSessionTurnWindow(longSession.id, { beforeTurnIndex: 25, limit: 50 });
  assert.equal(earliestWindow.startTurnIndex, 0);
  assert.equal(earliestWindow.endTurnIndex, 25);
  assert.equal(earliestWindow.hasOlderTurns, false);
  assert.equal(earliestWindow.turns[0].id, 'turn-0');

  // Verify the earliest turn is still 100% searchable in the SQLite FTS index.
  const searchEarliest = await store.search({ query: 'Prompt number 0' });
  assert.equal(searchEarliest.matches[0].conversationId, longSession.id);
});
