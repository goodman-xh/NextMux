// Explicit native integration check: node --test test/computer-automation-native-lifecycle.mjs
// Starts only private embedded hosts. The sole desktop operation is read-only listApps;
// no application/window data is printed and no existing process is signalled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { ComputerAutomation } = createRequire(import.meta.url)('../computer-automation.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const list = (engine, conversationId) => engine.run({ id: randomUUID(), conversationId, action: 'listApps', input: {}, expiresAt: Date.now() + 15000 }, 73);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const assertStopped = connection => { assert.equal(alive(connection.pid), false); assert.equal(existsSync(connection.socketPath), false); };

test('real host remains shared until its last session, then reaps its process/socket and can restart', { timeout: 30000 }, async () => {
  const engine = new ComputerAutomation();
  try {
    assert.equal(engine.capability().available, true, 'Prepare the matching native computer runtime first');
    assert.equal((await list(engine, 'native-lifecycle-a')).ok, true);
    assert.equal((await list(engine, 'native-lifecycle-b')).ok, true);
    const host = engine.host, connection = host.connection();
    assert.ok(alive(connection.pid)); assert.ok(existsSync(connection.socketPath));
    await engine.release('native-lifecycle-a', 73);
    assert.equal(engine.host, host); assert.ok(alive(connection.pid));
    await engine.release('native-lifecycle-b', 73);
    assert.equal(engine.host, undefined); assertStopped(connection);
    assert.equal((await list(engine, 'native-lifecycle-c')).ok, true);
    const next = engine.host.connection();
    assert.notEqual(next.generation, connection.generation); assert.ok(alive(next.pid));
    await engine.dispose(); assertStopped(next);
  } finally { await engine.dispose(); }
});

test('reset during real host startup stops its process and never connects a stale SDK client', { timeout: 30000 }, async () => {
  const engine = new ComputerAutomation();
  process.env.QWEN_CUA_SDK_NATIVE_DIR = engine.runtimeRoot;
  const { EmbeddedCuaDriverHost } = await import('../node_modules/@qwen-code/cua-sdk/dist/index.js');
  const { ComputerUse } = await import('../node_modules/@qwen-code/cua-sdk/computer-use/index.js');
  const start = EmbeddedCuaDriverHost.prototype.start, connect = ComputerUse.connect;
  const started = deferred(), finish = deferred(); let connection, connected = 0;
  EmbeddedCuaDriverHost.prototype.start = async function (...args) {
    connection = await start.apply(this, args); started.resolve(); await finish.promise; return connection;
  };
  ComputerUse.connect = async (...args) => { connected++; return connect.apply(ComputerUse, args); };
  try {
    const pending = list(engine, 'native-lifecycle-reset'); await started.promise;
    const exit = engine.host.waitForExit(connection.generation);
    const resetting = engine.reset();
    await exit; assertStopped(connection);
    finish.resolve();
    assert.equal((await pending).error, 'computer_host_closed'); await resetting;
    assert.equal(connected, 0); assert.equal(engine.sessions.size, 0); assert.equal(engine.host, undefined);
  } finally {
    finish.resolve(); EmbeddedCuaDriverHost.prototype.start = start; ComputerUse.connect = connect;
    await engine.dispose();
  }
});

test('failed real SDK connection releases the freshly started native host', { timeout: 30000 }, async () => {
  const engine = new ComputerAutomation();
  process.env.QWEN_CUA_SDK_NATIVE_DIR = engine.runtimeRoot;
  const { ComputerUse } = await import('../node_modules/@qwen-code/cua-sdk/computer-use/index.js');
  const connect = ComputerUse.connect; let connection;
  ComputerUse.connect = async () => {
    connection = engine.host.connection(); throw Object.assign(Error('fixture refused'), { code: 'connection_refused' });
  };
  try {
    assert.equal((await list(engine, 'native-lifecycle-refused')).error, 'connection_refused');
    // The failed-request cleanup is asynchronous; dispose must join that same
    // detached stop instead of returning while its daemon is still alive.
    await engine.dispose(); assertStopped(connection);
    assert.equal(engine.sessions.size, 0); assert.equal(engine.host, undefined);
  } finally { ComputerUse.connect = connect; await engine.dispose(); }
});

test('dispose joins real startup completion after host invalidation detached its session', { timeout: 30000 }, async () => {
  const engine = new ComputerAutomation();
  process.env.QWEN_CUA_SDK_NATIVE_DIR = engine.runtimeRoot;
  const { EmbeddedCuaDriverHost } = await import('../node_modules/@qwen-code/cua-sdk/dist/index.js');
  const start = EmbeddedCuaDriverHost.prototype.start;
  const started = deferred(), finish = deferred(); let connection, disposed = false, disposing, pending;
  EmbeddedCuaDriverHost.prototype.start = async function (...args) {
    connection = await start.apply(this, args); started.resolve(); await finish.promise; return connection;
  };
  try {
    pending = list(engine, 'native-lifecycle-detached'); await started.promise;
    const exit = engine.host.waitForExit(connection.generation);
    engine.invalidateGeneration(); await exit; assertStopped(connection);
    disposing = engine.dispose().then(() => { disposed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false);
    finish.resolve();
    assert.equal((await pending).error, 'computer_host_closed'); await disposing;
    assert.equal(disposed, true); assert.equal(engine.pendingLoads.size, 0); assert.equal(engine.closingClients.size, 0);
  } finally {
    finish.resolve(); EmbeddedCuaDriverHost.prototype.start = start;
    await Promise.allSettled([pending, disposing]); await engine.dispose();
  }
});
