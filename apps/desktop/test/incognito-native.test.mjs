import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { createIncognitoNativeRegistry } = createRequire(import.meta.url)('../incognito-native.cjs');

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'nextmux-private-native-test-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const id = randomUUID(), nonce = randomUUID(), owner = join(base, 'incognito-sessions-v1', `owner-${process.pid}-${nonce}`);
  const container = join(owner, id), workspaceRoot = join(container, 'workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const marker = join(owner, '.nextmux-incognito-owner.json');
  fs.writeFileSync(marker, JSON.stringify({ version: 1, kind: 'nextmux-incognito', pid: process.pid, nonce }));
  return { base, id, owner, container, workspaceRoot, marker, registry: createIncognitoNativeRegistry() };
}

function mode(f, value) {
  fs.writeFileSync(join(f.container, '.nextmux-incognito-session.json'), JSON.stringify({
    version: 1, kind: 'nextmux-incognito-session', id: f.id, incognitoOrigin: true,
    mode: value, revision: 1, activePid: process.pid, activeNonce: randomUUID()
  }));
}

test('mode switches retain the same capture directory and cannot be forged by another renderer', async t => {
  const f = fixture(t); mode(f, 'private');
  assert.equal(f.registry.register(f, 7), true);
  const lease = f.registry.acquire(f.id), directory = lease.directory();
  assert.equal(f.registry.setMode({ ...f, enabled: false }, 7), false, 'backend must commit normal first');
  mode(f, 'normal');
  assert.equal(f.registry.setMode({ ...f, enabled: false }, 8), false);
  assert.equal(f.registry.setMode({ ...f, enabled: false }, 7), true);
  assert.equal(f.registry.closed(f.id), false);
  assert.equal(lease.directory(), directory, 'an existing capture is safe because the path does not move');
  lease.release();
  const normalLease = f.registry.acquire(f.id);
  assert.equal(normalLease.directory(), directory, 'normal mode still keeps origin content in the owned container');
  normalLease.release();
  mode(f, 'private');
  assert.equal(f.registry.setMode({ ...f, enabled: true }, 7), true);
  assert.equal(await f.registry.finish([f.id], 7, async () => {}), true);
  assert.equal(f.registry.setMode({ ...f, enabled: true }, 7), false, 'mode switching never revives a deleted session');
});

test('quit rereads committed modes even when renderer switch acknowledgement was lost', async t => {
  const retained = fixture(t), switchedBack = fixture(t), registry = retained.registry;
  mode(retained, 'private'); mode(switchedBack, 'normal');
  assert.equal(registry.register(retained, 7), true);
  assert.equal(registry.register(switchedBack, 8), true);
  mode(retained, 'normal'); mode(switchedBack, 'private');
  let selected;
  assert.equal(await registry.finish([retained.id], 7, async ids => { selected = ids; }, { applicationQuit: true }), true);
  assert.deepEqual(selected, [switchedBack.id]);
  assert.equal(registry.closed(retained.id), false, 'committed normal session survives stale private UI state');
  assert.equal(registry.closed(switchedBack.id), true, 'committed private session drains despite stale normal UI state');
  assert.equal(fs.existsSync(retained.workspaceRoot), true);
});

test('invalid mode marker fails safely without selecting or retiring any session', async t => {
  const f = fixture(t); mode(f, 'private');
  assert.equal(f.registry.register(f, 7), true);
  fs.writeFileSync(join(f.container, '.nextmux-incognito-session.json'), '{');
  let stopped = false;
  assert.equal(await f.registry.finish([f.id], 7, async () => { stopped = true; }, { applicationQuit: true }), false);
  assert.equal(stopped, false); assert.equal(f.registry.closed(f.id), false);
  assert.equal(f.registry.setMode({ ...f, enabled: false }, 7), false);
});

test('only marked canonical owned workspaces register, including a multi-root primary child', t => {
  const f = fixture(t);
  assert.equal(f.registry.register({ id: f.id, workspaceRoot: f.base }, 7), false);
  assert.equal(f.registry.register({ id: '../outside', workspaceRoot: f.workspaceRoot }, 7), false);
  fs.mkdirSync(join(f.workspaceRoot, 'primary'));
  assert.equal(f.registry.register({ id: f.id, workspaceRoot: join(f.workspaceRoot, 'primary') }, 7), true);
  assert.equal(f.registry.register(f, 8), false);
  const lease = f.registry.acquire(f.id);
  assert.equal(lease.directory(), join(f.container, 'state', 'native', 'nextmux-frames-private'));
  lease.release();
  assert.equal(f.registry.acquire('ordinary'), undefined);
});

test('symlinked marker, workspace and native state cannot redirect captures into user files', t => {
  const f = fixture(t), other = join(f.base, 'user-data'); fs.mkdirSync(other);
  fs.renameSync(f.marker, join(f.base, 'marker'));
  fs.symlinkSync(join(f.base, 'marker'), f.marker);
  assert.equal(f.registry.register(f, 7), false);
  fs.unlinkSync(f.marker); fs.renameSync(join(f.base, 'marker'), f.marker);
  fs.rmdirSync(f.workspaceRoot); fs.symlinkSync(other, f.workspaceRoot, 'dir');
  assert.equal(f.registry.register(f, 7), false);
  fs.unlinkSync(f.workspaceRoot); fs.mkdirSync(f.workspaceRoot);
  assert.equal(f.registry.register(f, 7), true);
  fs.symlinkSync(other, join(f.container, 'state'), 'dir');
  const lease = f.registry.acquire(f.id);
  assert.throws(() => lease.directory(), /incognito_symlink/); lease.release();
  assert.deepEqual(fs.readdirSync(other), []);
});

test('finish fences new writes, waits an existing capture and never recreates a deleted session', async t => {
  const f = fixture(t); assert.equal(f.registry.register(f, 7), true);
  const lease = f.registry.acquire(f.id), directory = lease.directory();
  assert.equal(await f.registry.finish([f.id], 8, async () => {}), false);
  let stopped = false, finished = false;
  const finishing = f.registry.finish([f.id], 7, async () => { stopped = true; }).then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, true); assert.equal(finished, false);
  assert.throws(() => f.registry.acquire(f.id), /incognito_session_closed/);
  fs.writeFileSync(join(directory, 'capture.bgra'), 'private pixels');
  lease.release(); assert.equal(await finishing, true);
  fs.rmSync(f.container, { recursive: true });
  assert.throws(() => f.registry.acquire(f.id), /incognito_session_closed/);
  assert.equal(f.registry.register(f, 7), false);
  assert.equal(fs.existsSync(f.container), false);
  assert.equal(f.registry.has(f.id), true, 'late plugin receipts must still know the session is private');
});


test('unregistered private backend sessions need no native drain', async () => {
 const registry = createIncognitoNativeRegistry(); let called;
 assert.equal(await registry.finish([randomUUID()], 7, async ids => { called = ids; }), true);
 assert.deepEqual(called, []);
});


test('only the quit coordinator may drain registered sessions from another application window', async t => {
 const f = fixture(t); assert.equal(f.registry.register(f, 8), true);
 assert.equal(await f.registry.finish([f.id], 7, async () => {}), false);
 assert.equal(await f.registry.finish([f.id], 7, async ids => { assert.deepEqual(ids, [f.id]); assert.equal(f.registry.owner(f.id), 8); }, { applicationQuit: true }), true);
});

test('application quit drains a cross-window session registered after the renderer took its ID snapshot', async t => {
  const first = fixture(t), later = fixture(t), registry = first.registry;
  assert.equal(registry.register(first, 7), true);
  const oldIds = [first.id];
  assert.equal(registry.register(later, 8), true);
  const inFlightCapture = registry.acquire(later.id);
  let selected, finished = false;
  const draining = registry.finish(oldIds, 7, async ids => { selected = ids; }, { applicationQuit: true })
    .then(value => { finished = true; return value; });
  assert.equal(registry.closed(first.id), true, 'quit fences all registered sessions before any await');
  assert.equal(registry.closed(later.id), true, 'stale renderer list must not leave a newly registered window writable');
  assert.throws(() => registry.acquire(later.id), /incognito_session_closed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(new Set(selected), new Set([first.id, later.id]));
  assert.equal(registry.owner(later.id), 8, 'drain retains the real renderer owner');
  assert.equal(finished, false, 'backend cleanup must still wait for the late session capture');
  inFlightCapture.release();
  assert.equal(await draining, true);
});

test('trusted native IPC refuses registration during quit and permits a new private session after quit is cancelled', async t => {
  const { registerComputerAutomation } = createRequire(import.meta.url)('../computer-automation.cjs');
  const app = new EventEmitter(), handlers = new Map(), released = [];
  let quitting = false;
  app[Symbol.for('nextmux.desktop.is-quitting.v1')] = () => quitting;
  registerComputerAutomation({ app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedMainFrame: () => true,
    automation: { platform: 'darwin', release: async (id, owner) => { released.push({ id, owner }); return true; } } });
  const event = owner => ({ sender: { id: owner, isDestroyed: () => false } });
  const register = handlers.get('nextmux:incognito:register'), finish = handlers.get('nextmux:incognito:finish');
  const first = fixture(t), second = fixture(t), blocked = fixture(t);
  assert.equal(register(event(7), first), true);
  assert.equal(register(event(8), second), true);
  assert.equal(await finish(event(7), [second.id]), false, 'ordinary renderer cannot drain another owner');
  quitting = true;
  assert.equal(register(event(7), blocked), false, 'trusted renderer still cannot add a native session during app quit');
  assert.equal(await finish(event(7), [first.id]), true);
  assert.deepEqual(released, [{ id: first.id, owner: 7 }, { id: second.id, owner: 8 }]);
  quitting = false;
  assert.equal(register(event(7), blocked), true, 'cancelling app quit must not permanently disable new incognito sessions');
  assert.equal(register(event(7), first), false, 'already drained sessions remain retired');
  assert.equal(await finish(event(7), [blocked.id]), true);
  assert.deepEqual(released.at(-1), { id: blocked.id, owner: 7 });
});
