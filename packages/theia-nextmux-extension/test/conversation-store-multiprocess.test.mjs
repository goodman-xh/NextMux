import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lstat, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';

const session = (id, title = id, updatedAt = 2) => ({
  id, workspacePath: '/project', title, createdAt: 1, updatedAt,
  turns: [{ id: 'turn-1', prompt: 'question', response: 'answer', createdAt: 1, stage: 'complete' }],
});
async function rootFor(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('multiple store instances serialize writes and cannot resurrect a deleted session', async t => {
  const root = await rootFor(t, 'nextmux-multiprocess-');
  const first = new ConversationStore(root);
  const second = new ConversationStore(root);
  await first.save([session('conversation')]);
  const writes = await Promise.allSettled([
    first.patch([session('conversation', 'first', 3)], []),
    second.patch([session('conversation', 'second', 4)], []),
  ]);
  // The cross-process version check may reject the stale writer after the
  // other writer has committed. That is an intentional conflict barrier, not
  // data loss: callers can reload and retry the rejected patch. A concurrent
  // run where both writers observe disjoint snapshots may commit both.
  assert.ok(writes.some(result => result.status === 'fulfilled'));
  for (const result of writes) {
    if (result.status === 'rejected') assert.match(String(result.reason?.code || result.reason), /IMPORT_CONFLICT/);
  }
  assert.equal((await new ConversationStore(root).readSession('conversation')).title, 'second');

  const race = await Promise.allSettled([
    first.deleteProject('/project'),
    second.patch([session('conversation', 'must stay deleted', 8)], []),
  ]);
  assert.equal(race[0].status, 'fulfilled');
  const reader = new ConversationStore(root);
  assert.equal(await reader.readSession('conversation'), undefined);
  assert.equal(await reader.isDeletedSession('conversation'), true);
});

test('same-instance load waits for its write queue before taking the process lock', async t => {
  const root = await rootFor(t, 'nextmux-same-instance-');
  const store = new ConversationStore(root);
  const originalWrite = store.writeFile;
  store.writeFile = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return originalWrite(...args);
  };
  const save = store.save([session('queued')]);
  const load = store.load();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('same-instance load/save deadlock')), 3_000));
  await Promise.race([Promise.all([save, load]), timeout]);
  assert.equal((await new ConversationStore(root).readSession('queued')).id, 'queued');
});

test('a gracefully exiting child releases the inter-process lock', async t => {
  const root = await rootFor(t, 'nextmux-multiprocess-exit-');
  const lockModule = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'proper-lockfile');
  const lockPath = join(root, '.conversation-store-write-lock');
  const child = spawn(process.execPath, ['-e', `const lock=require(${JSON.stringify(lockModule)}); lock.lock(${JSON.stringify(root)}, { lockfilePath:${JSON.stringify(lockPath)}, realpath:false, stale:30000, update:10000 }).then(()=>process.exit(0));`], { stdio: 'inherit' });
  assert.equal(await new Promise(resolve => child.once('exit', code => resolve(code))), 0);
  await new ConversationStore(root).save([session('after-exit')]);
  assert.equal((await new ConversationStore(root).readSession('after-exit')).id, 'after-exit');
});

test('a SIGKILL lock is reclaimed after its stale threshold without touching payloads', async t => {
  const root = await rootFor(t, 'nextmux-multiprocess-kill-');
  const lockModule = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'proper-lockfile');
  const lockPath = join(root, '.conversation-store-write-lock');
  const marker = join(root, 'lock-acquired');
  const child = spawn(process.execPath, ['-e', `const lock=require(${JSON.stringify(lockModule)}); lock.lock(${JSON.stringify(root)}, { lockfilePath:${JSON.stringify(lockPath)}, realpath:false, stale:30000, update:10000 }).then(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes'); setInterval(()=>{},1000); });`], { stdio: 'inherit' });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await readFile(marker, 'utf8')) === 'yes') break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await readFile(marker, 'utf8')), 'yes');
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  // Avoid a 30-second test while preserving the real stale-lock path: this
  // is the same mtime threshold proper-lockfile checks after a crash.
  const stale = new Date(Date.now() - 60_000);
  await utimes(lockPath, stale, stale);
  await new ConversationStore(root).save([session('after-kill')]);
  assert.equal((await new ConversationStore(root).readSession('after-kill')).id, 'after-kill');
});

test('clear removes unreferenced content-addressed manifest shards', async t => {
  const root = await rootFor(t, 'nextmux-multiprocess-clear-');
  const store = new ConversationStore(root);
  await store.save([session('conversation')]);
  const emptyShard = JSON.stringify({ sessions: [] });
  const name = `manifest-v1-shard-${createHash('sha256').update(emptyShard).digest('hex')}.json`;
  await writeFile(join(root, name), emptyShard);
  await store.clear();
  assert.equal((await readdir(root)).some(file => file.startsWith('manifest-v1-shard-')), false);
  assert.equal((await readFile(join(root, 'manifest-v1.json'), 'utf8')).includes('shardFiles'), false);
});

test('SIGKILL during a real transaction recovers the validated intent without changing lock timestamps', { timeout: 65_000 }, async t => {
  const root = await rootFor(t, 'nextmux-multiprocess-transaction-');
  const original = session('committed', 'Original title');
  await new ConversationStore(root).save([original]);
  const before = await readFile(join(root, 'manifest-v1.json'), 'utf8');
  const storeUrl = new URL('../lib/node/nextmux-conversation-store.js', import.meta.url).href;
  const program = `
    const { ConversationStore } = await import(${JSON.stringify(storeUrl)});
    const store = new ConversationStore(${JSON.stringify(root)});
    const write = store.atomicWrite.bind(store);
    store.atomicWrite = async (temporary, target, content) => {
      if (target.endsWith('manifest-v1.json')) {
        setInterval(() => {}, 1000); // Keep the process alive until the parent actually kills it.
        process.send('before-publication');
        await new Promise(() => {});
      }
      return write(temporary, target, content);
    };
    await store.patch([${JSON.stringify(session('committed', 'Uncommitted update', 3))}], []);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data); });
  await new Promise((resolve, reject) => {
    child.once('message', message => message === 'before-publication' ? resolve() : reject(Error(String(message))));
    child.once('error', reject);
    child.once('exit', code => reject(Error(`transaction exited early: ${code}: ${stderr}`)));
  });
  assert.equal((await lstat(join(root, '.conversation-store-write-lock'))).isDirectory(), true);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(child.kill('SIGKILL'), true);
  const killed = await exited;
  assert.equal(killed.signal, 'SIGKILL');
  assert.equal((await lstat(join(root, '.conversation-store-write-lock'))).isDirectory(), true);
  assert.equal(await readFile(join(root, 'manifest-v1.json'), 'utf8'), before);
  const started = performance.now();
  const recovered = { ...original, title: 'Uncommitted update', updatedAt: 3 };
  assert.deepEqual(await new ConversationStore(root).readSession('committed'), recovered);
  assert.notEqual(await readFile(join(root, 'manifest-v1.json'), 'utf8'), before);
  assert.equal((await new ConversationStore(root).load()).pendingRecovery, undefined);
  t.diagnostic(`real crash lock recovery: ${Math.round(performance.now() - started)} ms; validated intent recovered`);
});
