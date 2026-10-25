import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';

const session = (id, title = id, updatedAt = 2) => ({
  id, workspacePath: '/project', title, createdAt: 1, updatedAt,
  turns: [{ id: 'turn-1', prompt: 'question', response: 'answer', createdAt: 1, stage: 'complete' }],
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-conversation-intent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new ConversationStore(root) };
}

async function pendingUpdate(root, original, updated) {
  const path = join(root, 'manifest-v1.json');
  const previous = JSON.parse(await readFile(path, 'utf8'));
  const generation = randomUUID();
  const content = JSON.stringify(updated);
  const file = `session-${createHash('sha256').update(updated.id).digest('hex')}-${generation}.json`;
  await writeFile(join(root, file), content, { encoding: 'utf8', flag: 'wx' });
  const entry = { id: updated.id, file, workspacePath: updated.workspacePath, title: updated.title,
    createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) };
  const manifest = { ...previous, generation, sessions: [entry, ...previous.sessions.filter(item => item.id !== updated.id)] };
  const intent = { schemaVersion: 1, baseGeneration: previous.generation, manifest };
  await writeFile(join(root, `.conversation-store-intent-${generation}.json`), JSON.stringify(intent), 'utf8');
  return { previous, manifest, generation, file };
}

test('a valid pending intent is recovered only when its base generation is current', async t => {
  const { root, store } = await fixture(t);
  const original = session('one', 'original');
  await store.save([original]);
  const updated = session('one', 'recovered', 3);
  const pending = await pendingUpdate(root, original, updated);
  const reader = new ConversationStore(root);
  assert.deepEqual(await reader.readSession('one'), updated);
  assert.equal((await reader.load()).pendingRecovery, undefined);
  assert.equal(await readFile(join(root, 'manifest-v1.json'), 'utf8').then(raw => JSON.parse(raw).generation), pending.generation);
});

test('a pending intent with a changed manifest generation remains pending and cannot overwrite newer state', async t => {
  const { root, store } = await fixture(t);
  const original = session('one', 'original');
  await store.save([original]);
  const pending = await pendingUpdate(root, original, session('one', 'stale intent', 3));
  const current = { ...pending.previous, generation: randomUUID() };
  await writeFile(join(root, 'manifest-v1.json'), JSON.stringify(current), 'utf8');
  const reader = new ConversationStore(root);
  assert.deepEqual(await reader.readSession('one'), original);
  const loaded = await reader.load();
  assert.deepEqual(loaded.pendingRecovery, [`.conversation-store-intent-${pending.generation}.json`]);
  assert.equal(await readFile(join(root, `.conversation-store-intent-${pending.generation}.json`), 'utf8').then(Boolean), true);
});

test('a pending intent never resurrects a session that acquired a deletion tombstone', async t => {
  const { root, store } = await fixture(t);
  const original = session('one', 'original');
  await store.save([original]);
  const pending = await pendingUpdate(root, original, session('one', 'must not return', 3));
  const tombstone = { ...pending.previous, generation: randomUUID(), sessions: [], deletedSessionIds: ['one'] };
  await writeFile(join(root, 'manifest-v1.json'), JSON.stringify(tombstone), 'utf8');
  const reader = new ConversationStore(root);
  assert.equal(await reader.readSession('one'), undefined);
  const loaded = await reader.load();
  assert.deepEqual(loaded.pendingRecovery, [`.conversation-store-intent-${pending.generation}.json`]);
  assert.deepEqual(loaded.deletedSessionIds, ['one']);
});
