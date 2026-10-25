import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createE2eArtifactsDirectory, createE2eProcessCleanup, finishE2eRun, installE2eSignalCleanup, readE2eProcessSnapshot } from './desktop-terminal-ci-e2e.mjs';

const row = (pid, ppid, identity = `started:${pid}`) => ({ pid, ppid, identity, zombie: false });
const child = pid => ({ pid, exitCode: null, signalCode: null });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('only launched roots and observed descendants remain owned after reparenting into independent process groups', async () => {
  let rows = [row(100, 1), row(101, 100), row(102, 101), row(200, 1), row(201, 200)];
  const killed = [];
  const owner = createE2eProcessCleanup({ snapshot: () => rows, pause: async () => {},
    kill(pid, signal) { killed.push([pid, signal]); rows = rows.filter(item => item.pid !== pid); } });
  const root = child(100); owner.register(root);
  rows = rows.filter(item => item.pid !== 100).map(item => ({ ...item, ppid: item.pid === 101 ? 1 : item.ppid })); root.exitCode = 0;
  await owner.terminate();
  assert.deepEqual(killed, [[101, 'SIGTERM'], [102, 'SIGTERM']]);
  assert.deepEqual(rows.map(item => item.pid), [200, 201]);
});

test('a reused PID is neither signalled nor authority to capture another application child', async () => {
  let rows = [row(100, 1), row(101, 100)]; const killed = [];
  const owner = createE2eProcessCleanup({ snapshot: () => rows, pause: async () => {}, kill(pid) { killed.push(pid); rows = rows.filter(item => item.pid !== pid); } });
  owner.register(child(100));
  rows = [row(100, 1, 'different-start'), row(101, 1, 'different-child-start'), row(102, 101)];
  await owner.terminate(); assert.deepEqual(killed, []); assert.equal(rows.length, 3);
});

test('PID identity is revalidated between snapshot and each signal, and escalation captures newly observed descendants', async () => {
  let rows = [row(100, 1), row(101, 100)], reads = 0, pauses = 0; const killed = [];
  const owner = createE2eProcessCleanup({ snapshot() { reads++; if (reads === 3) rows = [row(100, 1, 'reused'), row(101, 1)]; return rows; },
    async pause() { if (++pauses === 1) rows.push(row(102, 101)); },
    kill(pid, signal) { killed.push([pid, signal]); if (signal === 'SIGKILL') rows = rows.filter(item => item.pid !== pid); } });
  owner.register(child(100)); await owner.terminate();
  assert.equal(killed.some(([pid]) => pid === 100), false);
  assert.ok(killed.some(([pid, signal]) => pid === 101 && signal === 'SIGKILL'));
  assert.ok(killed.some(([pid, signal]) => pid === 102 && signal === 'SIGKILL'));
});

test('an exited launch never adopts a later PID, zombies are ignored, and unresolved cleanup is an error', async () => {
  let rows = []; const root = { ...child(100), exitCode: 0 };
  const owner = createE2eProcessCleanup({ snapshot: () => rows, pause: async () => {}, kill() { assert.fail('unowned PID'); } });
  owner.register(root); rows = [row(100, 1)]; await assert.rejects(owner.terminate(), /E2E_LAUNCH_OWNERSHIP_UNOBSERVED/);
  const stuck = createE2eProcessCleanup({ snapshot: () => [row(200, 1)], pause: async () => {}, kill() {} });
  stuck.register(child(200)); await assert.rejects(stuck.terminate(), /E2E_OWNED_PROCESSES_REMAIN: 200/);
  const zombie = createE2eProcessCleanup({ snapshot: () => [{ ...row(300, 1), zombie: true }], pause: async () => {}, kill() { assert.fail('zombie'); } });
  zombie.register(child(300)); await zombie.terminate();
});

test('a failed process snapshot or denied signal fails closed instead of claiming cleanup succeeded', async () => {
  let fail = false;
  const denied = createE2eProcessCleanup({ snapshot() { if (fail) throw new Error('E2E_PROCESS_SNAPSHOT_FAILED'); return [row(100, 1)]; },
    pause: async () => {}, kill() { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } });
  denied.register(child(100));
  await assert.rejects(denied.terminate(), { code: 'EPERM' });
  fail = true; await assert.rejects(denied.terminate(), /E2E_PROCESS_SNAPSHOT_FAILED/);
});

test('an initial snapshot failure followed by launcher exit cannot certify cleanup or kill an unobserved orphan', async () => {
  let fail = true; const root = child(100); const primary = new Error('fixture-original-failure'); let removed = false;
  const owner = createE2eProcessCleanup({ snapshot() { if (fail) throw new Error('fixture-snapshot-unavailable'); return [row(101, 1)]; },
    pause: async () => {}, kill() { assert.fail('unobserved process must never be killed'); } });
  assert.throws(() => owner.register(root), /fixture-snapshot-unavailable/);
  root.exitCode = 0; fail = false;
  await assert.rejects(finishE2eRun(async () => { await owner.terminate(); removed = true; }, primary), error => {
    assert.equal(error.cause, primary); assert.equal(error.errors[0], primary);
    assert.match(error.errors[1].message, /E2E_LAUNCH_OWNERSHIP_UNOBSERVED/); return true;
  });
  assert.equal(removed, false);
});

test('a later successful live snapshot resolves initial observation failure without expanding ownership', async () => {
  let fail = true; let rows = [row(100, 1), row(101, 100), row(200, 1)]; const killed = [];
  const owner = createE2eProcessCleanup({ snapshot() { if (fail) throw new Error('fixture-snapshot-unavailable'); return rows; },
    pause: async () => {}, kill(pid) { killed.push(pid); rows = rows.filter(item => item.pid !== pid); } });
  assert.throws(() => owner.register(child(100)), /fixture-snapshot-unavailable/); fail = false;
  owner.refresh(); await owner.terminate(); assert.deepEqual(killed, [100, 101]); assert.deepEqual(rows, [row(200, 1)]);
});

test('cleanup cannot hide the original test failure and success is reported only when both phases succeed', async () => {
  const primary = new Error('synthetic-validation-timeout'), cleanup = new Error('synthetic-cleanup-denied');
  await assert.rejects(finishE2eRun(async () => { throw cleanup; }, primary), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
  });
  await assert.rejects(finishE2eRun(async () => {}, primary), error => error === primary);
  await assert.rejects(finishE2eRun(async () => { throw cleanup; }), error => error === cleanup);
  await finishE2eRun(async () => {});
});

test('scoped repeated signals use one cleanup and remove only their own handlers after completion', async () => {
  const target = new EventEmitter(), exits = []; let resolveCleanup, cleanups = 0;
  const unrelated = () => {}; target.on('SIGINT', unrelated);
  const dispose = installE2eSignalCleanup(() => { cleanups++; return new Promise(resolve => { resolveCleanup = resolve; }); },
    { target, exit: code => exits.push(code) });
  target.emit('SIGINT'); target.emit('SIGTERM'); target.emit('SIGINT');
  assert.equal(cleanups, 1); assert.deepEqual(exits, []);
  resolveCleanup(); await pause(0); assert.deepEqual(exits, [130]);
  dispose(); assert.deepEqual(target.listeners('SIGINT'), [unrelated]); assert.equal(target.listenerCount('SIGTERM'), 0);
});

test('scoped signal cleanup failure exits nonzero without retrying a second cleanup path', async () => {
  const target = new EventEmitter(), exits = []; let cleanups = 0;
  const dispose = installE2eSignalCleanup(() => { cleanups++; throw new Error('fixture-cleanup-failure'); }, { target, exit: code => exits.push(code) });
  target.emit('SIGTERM'); target.emit('SIGTERM'); await pause(0);
  assert.equal(cleanups, 1); assert.deepEqual(exits, [1]); dispose();
});

test('per-run logs cannot truncate or share an older process open file descriptor', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-cleanup-logs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const oldDirectory = await createE2eArtifactsDirectory(root), newDirectory = await createE2eArtifactsDirectory(root);
  assert.notEqual(oldDirectory, newDirectory);
  const old = await open(join(oldDirectory, 'app.log'), 'wx');
  try {
    await old.write('old-before\n');
    const current = await open(join(newDirectory, 'app.log'), 'wx'); await current.write('new-only\n'); await current.close();
    await old.write('old-late\n');
    assert.equal(await readFile(join(oldDirectory, 'app.log'), 'utf8'), 'old-before\nold-late\n');
    assert.equal(await readFile(join(newDirectory, 'app.log'), 'utf8'), 'new-only\n');
    await assert.rejects(createE2eArtifactsDirectory(root, oldDirectory), { code: 'EEXIST' });
    await assert.rejects(createE2eArtifactsDirectory(root, 'relative-output'), /absolute directory/);
    const explicit = join(root, 'explicit'); assert.equal(await createE2eArtifactsDirectory(root, explicit), explicit);
  } finally { await old.close(); }
});

test('real detached backend and watcher are cleaned after their owned main exits; unrelated process survives', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const unique = `nextmux-cleanup-fixture-${randomUUID()}`;
  const owner = createE2eProcessCleanup();
  const outsider = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', `${unique}-outsider`], { stdio: 'ignore' });
  const watcherCode = 'setInterval(()=>{},1000)';
  const backendCode = `const w=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(watcherCode)},${JSON.stringify(unique)}],{stdio:'ignore'});console.log(w.pid);setInterval(()=>{},1000);`;
  const rootCode = `const b=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(backendCode)},${JSON.stringify(unique)}],{detached:true,stdio:['ignore','pipe','ignore']});console.log(b.pid);b.stdout.on('data',d=>process.stdout.write(d));setInterval(()=>{},1000);`;
  const main = spawn(process.execPath, ['-e', rootCode, unique], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(async () => { await owner.terminate().catch(() => {}); if (outsider.exitCode === null) outsider.kill('SIGKILL'); if (main.exitCode === null) main.kill('SIGKILL'); });
  owner.register(main);
  let output = ''; main.stdout.on('data', data => { output += data; });
  let ownedPids;
  for (let count = 0; count < 100; count++) {
    owner.refresh(); const ids = output.trim().split(/\s+/).filter(Boolean).map(Number);
    if (ids.length === 2 && ids.every(Number.isSafeInteger)) { ownedPids = [main.pid, ...ids]; break; }
    await pause(20);
  }
  assert.ok(ownedPids, 'fixture main published backend/watcher'); owner.refresh();
  const exited = new Promise(done => main.once('exit', done)); main.kill('SIGTERM'); await exited;
  const remaining = readE2eProcessSnapshot();
  assert.ok(remaining.some(item => item.pid === ownedPids[1] && !item.zombie));
  await owner.terminate();
  const after = readE2eProcessSnapshot();
  assert.equal(after.some(item => ownedPids.includes(item.pid) && !item.zombie), false);
  assert.ok(after.some(item => item.pid === outsider.pid && !item.zombie));
});
