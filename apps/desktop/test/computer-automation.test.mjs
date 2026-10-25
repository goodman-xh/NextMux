import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ComputerUse, ComputerUseError } from '../node_modules/@qwen-code/cua-sdk/computer-use/index.js';
const { ComputerAutomation, registerComputerAutomation, computerFailure } = createRequire(import.meta.url)('../computer-automation.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const request = (action, input = {}, conversationId = 'conversation-a', id = `${action}-${crypto.randomUUID()}`) => ({
  id, conversationId, expiresAt: Date.now() + 10000, action, input
});
function fixture(options = {}) {
  const calls = [], clients = [];
  const engine = new ComputerAutomation({ platform: 'darwin', sdkLoader: async () => ({ create: async id => {
    const client = {
      listApps: async () => [{ id: 'fixture' }], listWindows: async () => [{ pid: 7, window_id: 9 }],
      observeWindow: async params => { calls.push(['observe', id, params]); return { text: 'Button', elements: [{ element_token: 'button-1' }], screenshot: { images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }] } }; },
      setValue: async params => { calls.push(['setValue', id, params]); return { effect: 'confirmed' }; },
      close: async () => { calls.push(['close', id]); },
      ...options.client
    };
    clients.push(client); return client;
  } }), ...options.engine });
  return { engine, calls, clients };
}
const windowInput = { pid: 7, windowId: 9 };
test('automated input to the NextMux host is rejected before loading a driver, while external apps remain usable', async () => {
  const { engine, clients, calls } = fixture();
  try {
    for (const [action, input] of [
      ['typeText', { text: 'private form value' }], ['hotkey', { keys: ['CTRL', 'V'] }],
      ['pressKey', { key: 'ENTER' }], ['click', { x: 1, y: 2 }], ['setValue', { elementToken: 'input', value: 'value' }]
    ]) {
      const result = await engine.run(request(action, { pid: process.pid, windowId: 9, snapshotId: 'host', ...input }), 1);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'computer_builtin_surface_requires_browser');
    }
    assert.equal(clients.length, 0);
    assert.equal(calls.length, 0);
    const observed = await engine.run(request('observeWindow', windowInput), 1);
    assert.equal(observed.ok, true);
    const clicked = await engine.run(request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' }), 1);
    assert.equal(clicked.ok, true);
    assert.equal(calls.filter(call => call[0] === 'setValue').length, 1);
  } finally { await engine.dispose(); }
});
test('verification maps only the three Rust JSON fields to installed SDK records and preserves unknown', async () => {
  let actual;
  const unknown = { status: 'unknown', stable: false, predicates: [{ index: 0, status: 'unknown', unknown_reason: 'invalid_predicate' }] };
  const { engine } = fixture({ client: { verifyState: async input => { actual = input; return unknown; } } });
  const expect = [{ element: { selector: { label_contains: 'Increment QA counter', role: 'AXButton' }, exists: true,
    value_equals: '', enabled: false, selected: true } }, { window: { exists: true, bounds: { x: 0, y: 1, width: 200, height: 100, tolerance_px: 0 } } }];
  const original = structuredClone(expect);
  try {
    const observed = await engine.run(request('observeWindow', windowInput), 1);
    const result = await engine.run(request('verifyState', { ...windowInput, snapshotId: observed.output.snapshotId, expect, timeoutMs: 1, stableSamples: 2 }), 1);
    assert.deepEqual(expect, original, 'raw evidence and public request remain unchanged');
    assert.deepEqual(actual.expect, [{ element: { selector: { labelContains: 'Increment QA counter', role: 'AXButton' }, exists: true,
      valueEquals: '', enabled: false, selected: true } }, { window: { exists: true, bounds: { x: 0, y: 1, width: 200, height: 100, tolerancePx: 0 } } }]);
    assert.equal(actual.timeoutMs, 1); assert.equal(actual.stableSamples, 2); assert.equal(actual.deliveryMode, undefined);
    assert.equal(result.ok, true); assert.deepEqual(result.output, unknown, 'transport success never turns an unknown predicate into satisfied');
  } finally { await engine.dispose(); }
});

test('installed UniFFI predicate serializer retains normalized fields and demonstrably drops raw snake_case', async t => {
  const runtime = fileURLToPath(new URL(`../build-resources/computer-runtime/${process.platform}-${process.arch}/`, import.meta.url));
  if (!existsSync(`${runtime}/cua_driver_node_runtime.node`)) return t.skip('Matching native SDK payload is not prepared');
  const prior = process.env.QWEN_CUA_SDK_NATIVE_DIR; process.env.QWEN_CUA_SDK_NATIVE_DIR = runtime;
  let contract;
  try { contract = (await import('../node_modules/@qwen-code/cua-sdk/dist/native/cua_driver_contract.js')).default; }
  finally { if (prior === undefined) delete process.env.QWEN_CUA_SDK_NATIVE_DIR; else process.env.QWEN_CUA_SDK_NATIVE_DIR = prior; }
  // Exercise the installed FFI converter, without starting a native host or observing any window.
  const converter = contract.converters.FfiConverterTypeStatePredicate;
  const roundTrip = value => converter.lift(converter.lower(value, size => new Uint8Array(size)));
  const raw = [{ element: { selector: { label_contains: 'Increment QA counter' }, exists: true, value_equals: '0' } },
    { window: { bounds: { x: 0, y: 0, width: 200, height: 100, tolerance_px: 3 } } }];
  assert.equal(roundTrip(raw[0]).element.selector.labelContains, undefined);
  assert.equal(roundTrip(raw[0]).element.valueEquals, undefined);
  assert.equal(roundTrip(raw[1]).window.bounds.tolerancePx, undefined);
  let actual;
  const { engine } = fixture({ client: { verifyState: async input => { actual = input.expect.map(roundTrip); return { status: 'unknown', stable: false }; } } });
  try {
    const observed = await engine.run(request('observeWindow', windowInput), 1);
    await engine.run(request('verifyState', { ...windowInput, snapshotId: observed.output.snapshotId, expect: raw }), 1);
    assert.equal(actual[0].element.selector.labelContains, 'Increment QA counter');
    assert.equal(actual[0].element.valueEquals, '0'); assert.equal(actual[1].window.bounds.tolerancePx, 3);
  } finally { await engine.dispose(); }
});

test('requires exact fresh observations; native effects and images remain truthful', async () => {
  const { engine, calls } = fixture();
  const unobserved = await engine.run(request('setValue', { ...windowInput, elementToken: 'button-1', value: 'fixture value' }), 1);
  assert.equal(unobserved.error, 'computer_snapshot_stale');
  const observed = await engine.run(request('observeWindow', { ...windowInput, maxTextChars: 1000000 }), 1);
  assert.equal(observed.ok, true); assert.equal(observed.images.length, 1); assert.equal(observed.output.screenshot, undefined);
  assert.equal(calls.at(-1)[2].maxTextChars, 48000); assert.equal(calls.at(-1)[2].disableDiff, true);
  const input = { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' };
  assert.equal((await engine.run(request('setValue', { ...input, elementToken: 'invented' }), 1)).error, 'computer_element_stale');
  const clicked = await engine.run(request('setValue', input), 1);
  assert.equal(clicked.output.effect, 'confirmed'); assert.equal(calls.at(-1)[2].deliveryMode, undefined);
  assert.equal((await engine.run(request('setValue', input), 1)).error, 'computer_snapshot_stale');
  await engine.dispose();
});
test('global window ownership and per-renderer conversation ownership prevent cross-talk', async () => {
  const { engine } = fixture();
  assert.equal((await engine.run(request('observeWindow', windowInput), 1)).ok, true);
  assert.equal((await engine.run(request('observeWindow', windowInput, 'conversation-b'), 1)).error, 'computer_window_owned');
  assert.equal((await engine.run(request('listApps'), 2)).error, 'computer_session_owned');
  assert.equal(await engine.release('conversation-a', 2), false);
  assert.equal(await engine.release('conversation-a', 1), true);
  assert.equal((await engine.run(request('observeWindow', windowInput, 'conversation-b'), 1)).ok, true);
  await engine.dispose();
});
test('last computer session releases the embedded host, while another session keeps it alive', async () => {
  const { engine, calls } = fixture();
  const lifecycle = [];
  await engine.run(request('listApps'), 1);
  await engine.run(request('listApps', {}, 'conversation-b'), 1);
  engine.host = { stop: async () => { lifecycle.push(['stop', calls.filter(call => call[0] === 'close').length]); },
    uniffiDestroy: () => lifecycle.push(['destroy']) };
  await engine.release('conversation-a', 1);
  assert.deepEqual(lifecycle, []);
  await engine.release('conversation-b', 1);
  assert.deepEqual(lifecycle, [['stop', 2], ['destroy']]);
  assert.equal(engine.host, undefined);
  assert.equal(engine.loading, undefined);
  await engine.dispose();
  assert.equal(lifecycle.length, 2);
});
test('an old host finishing idle shutdown cannot invalidate a new conversation generation', async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  const stopping = deferred(), finish = deferred(); let destroyed = 0;
  engine.host = { stop: async () => { stopping.resolve(); await finish.promise; }, uniffiDestroy: () => { destroyed++; } };
  const released = engine.release('conversation-a', 1);
  await Promise.race([stopping.promise, new Promise((_, reject) => setTimeout(() => reject(Error('idle host was not stopped')), 500))]);
  const generation = engine.generation;
  assert.equal((await engine.run(request('observeWindow', windowInput, 'conversation-b'), 1)).ok, true);
  const session = engine.sessions.get('conversation-b');
  finish.resolve(); await released;
  assert.equal(engine.generation, generation);
  assert.equal(engine.sessions.get('conversation-b'), session);
  assert.equal(engine.windows.get('7:9'), 'conversation-b');
  assert.equal(destroyed, 1);
  await engine.dispose();
});
test('failed SDK client creation does not strand a running embedded host', async () => {
  let stopped = 0, destroyed = 0;
  const { engine } = fixture({ engine: { sdkLoader: async () => {
    engine.host = { stop: async () => { stopped++; }, uniffiDestroy: () => { destroyed++; } };
    return { create: async () => { throw Object.assign(Error('fixture connection refused'), { code: 'connection_refused' }); } };
  } } });
  assert.equal((await engine.run(request('listApps'), 1)).error, 'connection_refused');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.sessions.size, 0); assert.equal(stopped, 1); assert.equal(destroyed, 1);
  assert.equal(engine.host, undefined);
  await engine.dispose();
});
test('failed SDK client creation keeps the host used by another conversation', async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  const sdk = await engine.load(), create = sdk.create;
  sdk.create = async id => { if (id === 'conversation-b') throw Object.assign(Error('refused'), { code: 'connection_refused' }); return create(id); };
  let stopped = 0;
  engine.host = { stop: async () => { stopped++; }, uniffiDestroy() {} };
  assert.equal((await engine.run(request('listApps', {}, 'conversation-b'), 1)).error, 'connection_refused');
  assert.equal(stopped, 0); assert.equal(engine.sessions.size, 1);
  assert.equal((await engine.run(request('listApps'), 1)).ok, true);
  await engine.release('conversation-a', 1);
  assert.equal(stopped, 1);
  await engine.dispose();
});
test('reset while the SDK loads cannot create a client from the retired generation', { timeout: 2000 }, async () => {
  const loading = deferred(); let created = 0;
  const { engine } = fixture({ engine: { sdkLoader: () => loading.promise } });
  const pending = engine.run(request('listApps'), 1);
  const reset = engine.reset();
  loading.resolve({ create: async () => { created++; return { close: async () => {} }; } });
  assert.equal((await pending).error, 'computer_host_closed');
  await reset;
  assert.equal(created, 0); assert.equal(engine.sessions.size, 0); assert.equal(engine.loading, undefined);
  await engine.dispose();
});
test('a retired connection completing late closes once and cannot remove its replacement window lease', { timeout: 2000 }, async () => {
  const connecting = deferred(), connected = deferred(); let closed = 0, created = 0;
  const { engine } = fixture({ engine: { sdkLoader: async () => ({ create: async () => {
    if (++created === 1) { connecting.resolve(); await connected.promise; }
    return { listApps: async () => [], observeWindow: async () => ({ elements: [] }), close: async () => { closed++; } };
  } }) } });
  const pending = engine.run(request('listApps'), 1); await connecting.promise;
  const releasing = engine.release('conversation-a', 1);
  engine.invalidateGeneration();
  assert.equal((await engine.run(request('observeWindow', windowInput), 1)).ok, true);
  const replacement = engine.sessions.get('conversation-a');
  connected.resolve();
  assert.equal((await pending).error, 'computer_session_closed'); await releasing;
  assert.equal(closed, 1); assert.equal(engine.sessions.get('conversation-a'), replacement);
  assert.equal(engine.windows.get('7:9'), 'conversation-a');
  await engine.dispose(); assert.equal(closed, 2);
});
test('a stale host exit callback cannot invalidate the current session or its observation', async () => {
  const { engine } = fixture();
  await engine.run(request('observeWindow', windowInput), 1);
  const session = engine.sessions.get('conversation-a'), generation = engine.generation;
  const oldHost = { stop: async () => {}, uniffiDestroy() {} };
  engine.invalidateGeneration(oldHost);
  assert.equal(engine.generation, generation); assert.equal(engine.sessions.get('conversation-a'), session);
  assert.equal(engine.windows.get('7:9'), 'conversation-a');
  await engine.dispose();
});
test('dispose joins an already detached idle host shutdown and destroys it only once', { timeout: 2000 }, async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  const stopping = deferred(), finish = deferred(); let stopped = 0, destroyed = 0, disposed = false;
  engine.host = { stop: async () => { stopped++; stopping.resolve(); await finish.promise; }, uniffiDestroy: () => { destroyed++; } };
  const releasing = engine.release('conversation-a', 1); await stopping.promise;
  const disposing = engine.dispose().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false); assert.equal(destroyed, 0);
  finish.resolve(); await Promise.all([releasing, disposing]);
  assert.equal(disposed, true); assert.equal(stopped, 1); assert.equal(destroyed, 1);
});
test('reset draining an old client cannot stop a new conversation host', { timeout: 2000 }, async () => {
  const closing = deferred(), finish = deferred(), stops = [];
  let hostNumber = 0;
  const { engine } = fixture({ engine: { sdkLoader: async () => {
    const number = ++hostNumber;
    engine.host = { stop: async () => { stops.push(number); }, uniffiDestroy() {} };
    return { create: async () => ({ listApps: async () => [], close: async () => {
      if (number === 1) { closing.resolve(); await finish.promise; }
    } }) };
  } } });
  await engine.run(request('listApps'), 1);
  const resetting = engine.reset(); await closing.promise;
  assert.equal((await engine.run(request('listApps', {}, 'conversation-b'), 1)).ok, true);
  const newHost = engine.host;
  finish.resolve(); await resetting;
  assert.equal(engine.host, newHost); assert.deepEqual(stops, [1]);
  assert.equal((await engine.run(request('listApps', {}, 'conversation-b'), 1)).ok, true);
  await engine.dispose(); assert.deepEqual(stops, [1, 2]);
});
test('a throwing native destructor cannot reject shutdown or strand its tracked stop', async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  engine.host = { stop: async () => {}, uniffiDestroy() { throw Error('native destructor failed'); } };
  try {
    await assert.doesNotReject(engine.release('conversation-a', 1));
    assert.equal(engine.stoppingHosts.size, 0);
    await assert.doesNotReject(engine.dispose());
  } finally { await engine.dispose().catch(() => undefined); }
});
test('a failed host stop is retained and must succeed before a later dispose can complete', async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  let stops = 0, destroyed = 0;
  const host = { stop: async () => { if (++stops === 1) throw Error('temporary stop failure'); },
    uniffiDestroy: () => { destroyed++; } };
  engine.host = host;
  await assert.rejects(engine.dispose());
  assert.equal(destroyed, 0, 'a failed stop must not destroy the only retryable host handle');
  await engine.dispose();
  assert.equal(stops, 2);
  assert.equal(destroyed, 1);
});
test('a new conversation cannot start a second host while an old driver refuses to stop', async () => {
  const { engine } = fixture();
  const loader = engine.sdkLoader;
  let loads = 0, stops = 0;
  engine.sdkLoader = async () => { loads++; return loader(); };
  await engine.run(request('listApps'), 1);
  engine.host = { stop: async () => { stops++; throw Error('PRIVATE_NATIVE_FAILURE'); }, uniffiDestroy() {} };
  await assert.rejects(engine.release('conversation-a', 1));
  const result = await engine.run(request('listApps', {}, 'conversation-b'), 1);
  assert.equal(result.error, 'computer_driver_shutdown_incomplete');
  assert.equal(loads, 1, 'a failed previous driver must be reaped before loading another SDK host');
  assert.equal(stops, 2, 'the next admission attempts the idempotent stop again');
  await assert.rejects(engine.dispose());
});
test('a failed session close retires the shared host instead of leaving a leaked session beside another conversation', async () => {
  let closes = 0, stops = 0;
  const { engine } = fixture({ client: { close: async () => { if (++closes === 1) throw Error('private session close failure'); } } });
  await engine.run(request('listApps'), 1);
  await engine.run(request('listApps', {}, 'conversation-b'), 1);
  engine.host = { stop: async () => { stops++; }, uniffiDestroy() {} };
  await assert.rejects(engine.release('conversation-a', 1));
  assert.equal(stops, 1);
  assert.equal(engine.host, undefined);
  assert.equal(engine.sessions.size, 0);
  await engine.dispose();
});
test('dispose waits for an invalidated pending SDK initialization to settle', { timeout: 2000 }, async () => {
  const loading = deferred(); let disposed = false, created = 0;
  const { engine } = fixture({ engine: { sdkLoader: () => loading.promise } });
  const pending = engine.run(request('listApps'), 1);
  engine.invalidateGeneration();
  const disposing = engine.dispose().then(() => { disposed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposed, false);
  } finally {
    loading.resolve({ create: async () => { created++; return { close: async () => {} }; } });
    await Promise.all([pending, disposing]);
  }
  assert.equal(created, 0); assert.equal(disposed, true);
});
test('dispose waits for the client close detached by host invalidation', { timeout: 2000 }, async () => {
  const closing = deferred(), finish = deferred(); let disposed = false, closed = 0;
  const { engine } = fixture({ client: { close: async () => { closing.resolve(); await finish.promise; closed++; } } });
  await engine.run(request('listApps'), 1);
  engine.invalidateGeneration(); await closing.promise;
  const disposing = engine.dispose().then(() => { disposed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false);
  } finally { finish.resolve(); await disposing; }
  assert.equal(closed, 1); assert.equal(disposed, true);
});
test('concurrent writes cannot reuse the same observation; duplicate IDs do not repeat a native mutation', async () => {
  const { engine, calls } = fixture();
  const observed = await engine.run(request('observeWindow', windowInput), 1);
  const input = { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' };
  const first = request('setValue', input);
  const [a, b, duplicate] = await Promise.all([engine.run(first, 1), engine.run(request('setValue', input), 1), engine.run(first, 1)]);
  assert.equal(a.ok, true); assert.equal(b.error, 'computer_snapshot_stale'); assert.deepEqual(duplicate, a);
  assert.deepEqual(await engine.run(first, 1), a);
  assert.equal(calls.filter(call => call[0] === 'setValue').length, 1);
  assert.equal((await engine.run({ ...first, input: { ...input, value: 'different' } }, 1)).error, 'computer_request_already_dispatched');
  await engine.dispose();
});
test('cancellation reaches the SDK; ambiguous mutation invalidates snapshot and cannot repeat', async () => {
  const started = deferred(); let deliveredSignal;
  const { engine } = fixture({ client: { setValue: async ({ signal }) => {
    deliveredSignal = signal; started.resolve();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } } });
  const observed = await engine.run(request('observeWindow', windowInput), 1);
  const input = { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' };
  const pendingRequest = request('setValue', input); const pending = engine.run(pendingRequest, 1);
  await started.promise;
  assert.equal(engine.cancel('conversation-a', pendingRequest.id, 2), false);
  assert.equal(engine.cancel('conversation-a', pendingRequest.id, 1), true);
  assert.equal((await pending).error, 'cancelled'); assert.equal(deliveredSignal.aborted, true);
  assert.equal((await engine.run(pendingRequest, 1)).error, 'computer_request_already_dispatched');
  assert.equal((await engine.run(request('setValue', input), 1)).error, 'computer_snapshot_stale');
  await engine.dispose();
});
test('Windows semantic writes retain serialization across conversations without changing observed window IDs', async () => {
  const first = deferred(), unblock = deferred(); let active = 0, maximum = 0;
  const { engine } = fixture({ engine: { platform: 'win32' }, client: { setValue: async params => {
    assert.equal(params.deliveryMode, undefined); maximum = Math.max(maximum, ++active); first.resolve();
    await unblock.promise; active--; return { effect: 'unverifiable' };
  } } });
  const a = await engine.run(request('observeWindow', windowInput), 1);
  const b = await engine.run(request('observeWindow', { pid: 8, windowId: 10 }, 'conversation-b'), 1);
  const x = engine.run(request('setValue', { ...windowInput, snapshotId: a.output.snapshotId, elementToken: 'button-1', value: 'fixture value' }), 1);
  await first.promise;
  const y = engine.run(request('setValue', { pid: 8, windowId: 10, snapshotId: b.output.snapshotId, elementToken: 'button-1', value: 'fixture value' }, 'conversation-b'), 1);
  unblock.resolve(); const result = await Promise.all([x, y]);
  assert.equal(maximum, 1); assert.ok(result.every(item => item.output.effect === 'unverifiable')); await engine.dispose();
});
test('late native completion retains its actual effect and the window lease until release drains', async () => {
  const started = deferred(), terminal = deferred();
  const { engine } = fixture({ client: { setValue: async () => { started.resolve(); await terminal.promise; return { effect: 'confirmed', operation: { committed: true } }; } } });
  const observed = await engine.run(request('observeWindow', windowInput), 1);
  const operation = request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' });
  const pending = engine.run(operation, 1); await started.promise;
  const releasing = engine.release('conversation-a', 1);
  assert.equal((await engine.run(request('observeWindow', windowInput, 'conversation-b'), 1)).error, 'computer_window_owned');
  terminal.resolve(); const result = await pending;
  assert.equal(result.output.effect, 'confirmed'); assert.equal(result.output.cancellationRequested, true);
  await releasing;
  assert.equal((await engine.run(request('observeWindow', windowInput, 'conversation-b'), 1)).ok, true);
  await engine.dispose();
});
test('unsupported OS and missing bundled runtime do not advertise usable computer control', async () => {
  assert.equal(new ComputerAutomation({ platform: 'linux' }).capability().reason, 'unsupported_system');
  assert.equal(new ComputerAutomation({ platform: 'win32', resourcesPath: '/nextmux-does-not-exist' }).capability().reason, 'runtime_missing');
});
test('untrusted renderer IPC cannot inspect or manipulate any desktop', async () => {
  const handlers = new Map(); let invoked = 0;
  registerComputerAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, trustedMainFrame: () => false,
    automation: { capability: () => { invoked++; }, run: () => { invoked++; }, requestPermission: () => { invoked++; } } });
  assert.equal((await handlers.get('nextmux:computer:action')({}, request('listApps'))).error, 'computer_untrusted_sender');
    await handlers.get('nextmux:computer:capability')({}); await handlers.get('nextmux:computer:permission')({}); assert.equal(invoked, 0);
});

test('quit waits for the computer driver shutdown before allowing Electron to exit', async () => {
  const app = new EventEmitter(), stopping = deferred(), finish = deferred();
  let disposals = 0, quitCalls = 0, terminalQuitAllowed = false;
  app.quit = () => {
    quitCalls++;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('will-quit', event);
    terminalQuitAllowed = !event.defaultPrevented;
  };
  registerComputerAutomation({ app, ipcMain: { handle() {} }, trustedMainFrame: () => false,
    automation: { dispose: async () => { disposals++; stopping.resolve(); await finish.promise; } } });
  app.quit();
  await stopping.promise;
  assert.equal(terminalQuitAllowed, false, 'the first quit must wait while the native driver is still running');
  assert.equal(quitCalls, 1);
  app.quit();
  assert.equal(terminalQuitAllowed, false, 'repeated quit requests must not skip the same in-flight drain');
  finish.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposals, 1);
  assert.equal(quitCalls, 3);
  assert.equal(terminalQuitAllowed, true, 'only a completed driver stop may allow the final quit');
});

test('completed shutdown retries quit after Electron has unwound the current quit dispatch', async () => {
  const app = new EventEmitter();
  let inNativeQuit = false, accepted = 0, quitCalls = 0;
  app.quit = () => {
    quitCalls++;
    // Electron ignores a reentrant quit while its previous quit dispatch is
    // still in progress, even when will-quit was prevented.
    if (inNativeQuit) return;
    inNativeQuit = true;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('will-quit', event);
    if (!event.defaultPrevented) accepted++;
    setImmediate(() => { inNativeQuit = false; });
  };
  registerComputerAutomation({ app, ipcMain: { handle() {} }, trustedMainFrame: () => false,
    automation: { dispose: async () => undefined } });
  app.quit();
  // Drain the native unwind and queued retry, independent of wall-clock load.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 2);
  assert.equal(accepted, 1, 'a fast dispose must not strand Electron with zero windows');
});

test('failed computer shutdown keeps Electron alive and retries without leaking native error text', async () => {
  const app = new EventEmitter(), previousError = console.error, messages = [];
  let attempts = 0, quitCalls = 0, terminalQuitAllowed = false;
  app.quit = () => {
    quitCalls++;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('will-quit', event);
    terminalQuitAllowed = !event.defaultPrevented;
  };
  registerComputerAutomation({ app, ipcMain: { handle() {} }, trustedMainFrame: () => false,
    automation: { dispose: async () => {
      if (++attempts === 1) throw Error('PRIVATE_WINDOW_TEXT');
    } } });
  console.error = message => messages.push(message);
  try {
    app.quit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminalQuitAllowed, false);
    assert.equal(attempts, 1);
    assert.deepEqual(messages, ['[nextmux] computer driver shutdown did not complete']);
    app.quit();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2);
    assert.equal(quitCalls, 3);
    assert.equal(terminalQuitAllowed, true);
  } finally { console.error = previousError; }
});
test('Electron retries a real ComputerAutomation host after one failed native stop', async () => {
  const { engine } = fixture();
  await engine.run(request('listApps'), 1);
  let stops = 0, destroyed = 0, terminalQuitAllowed = false;
  engine.host = { stop: async () => { if (++stops === 1) throw Error('PRIVATE_NATIVE_FAILURE'); },
    uniffiDestroy: () => { destroyed++; } };
  const app = new EventEmitter(), previousError = console.error, messages = [];
  app.quit = () => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('will-quit', event);
    terminalQuitAllowed = !event.defaultPrevented;
  };
  registerComputerAutomation({ app, ipcMain: { handle() {} }, trustedMainFrame: () => false, automation: engine });
  console.error = message => messages.push(message);
  try {
    app.quit();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminalQuitAllowed, false);
    assert.equal(stops, 1);
    assert.equal(destroyed, 0);
    app.quit();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminalQuitAllowed, true);
    assert.equal(stops, 2);
    assert.equal(destroyed, 1);
    assert.deepEqual(messages, ['[nextmux] computer driver shutdown did not complete']);
  } finally { console.error = previousError; }
});

test('typed driver failures retain only stable categories and never replay a possibly dispatched action', async () => {
  const variants = [
    ['Configuration', 'computer_driver_configuration'], ['InvalidArguments', 'computer_driver_invalid_arguments'],
    ['Transport', 'computer_driver_transport'], ['Protocol', 'computer_driver_protocol'], ['Tool', 'native_refusal'],
    ['Shutdown', 'computer_driver_shutdown'], ['RuntimeAlreadyExists', 'computer_driver_runtime_exists'],
    ['Worker', 'computer_driver_worker'], ['Remote', 'computer_driver_remote'],
    ['ActionInterrupted', 'computer_action_interrupted']
  ];
  for (const [tag, expected] of variants) {
    let writes = 0;
    const nativeError = Object.assign(Error('PRIVATE_WINDOW_TEXT'), { tag,
      inner: { reason: 'PRIVATE_WINDOW_TEXT', message: 'PRIVATE_WINDOW_TEXT', socketPath: '/PRIVATE_SOCKET', errorCode: 'native_refusal', completion: 2 } });
    const { engine } = fixture({ client: { setValue: async () => { writes++; throw nativeError; } } });
    try {
      const observed = await engine.run(request('observeWindow', windowInput), 1);
      const input = { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' };
      const operation = request('setValue', input), result = await engine.run(operation, 1);
      assert.equal(result.ok, false); assert.equal(result.error, expected);
      assert.equal(result.diagnostic.driverTag, tag); assert.equal(result.diagnostic.source, 'driver');
      assert.equal(result.diagnostic.phase, 'native_call'); assert.equal(result.diagnostic.nextAction, 'observe_before_action');
      assert.equal(result.diagnostic.completion, tag === 'ActionInterrupted' ? 'unknown' : undefined);
      assert.equal(result.diagnostic.operation, undefined, 'missing SDK facts must not become dispatched=false or committed=false');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|stack|reason|message/);
      assert.equal((await engine.run(operation, 1)).error, 'computer_request_already_dispatched');
      assert.equal((await engine.run(request('setValue', input), 1)).error, 'computer_snapshot_stale');
      assert.equal(writes, 1);
    } finally { await engine.dispose(); }
  }
});

test('ComputerUseError keeps only boolean operation facts and bounded nested Tool codes', async () => {
  for (const errorCode of ['tool_refused', 'secret://window text']) {
    const error = new ComputerUseError('PRIVATE_WINDOW_TEXT', { details: {
      cause: { tag: 'Tool', inner: { errorCode, message: 'PRIVATE_WINDOW_TEXT' } },
      operation: { id: 'PRIVATE_OPERATION', state: 'PRIVATE_STATE', dispatched: true, committed: false, cancellationRequested: true },
      content: 'PRIVATE_WINDOW_TEXT'
    } });
    const { engine } = fixture({ client: { setValue: async () => { throw error; } } });
    try {
      const observed = await engine.run(request('observeWindow', windowInput), 1);
      const result = await engine.run(request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' }), 1);
      assert.equal(result.error, errorCode === 'tool_refused' ? errorCode : 'computer_driver_tool');
      assert.deepEqual(result.diagnostic.operation, { dispatched: true, committed: false, cancellationRequested: true });
      assert.equal(result.diagnostic.nextAction, 'observe_before_action');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|secret:/);
    } finally { await engine.dispose(); }
  }
});

test('actual ComputerUse facade error result remains uncertain even when its operation was committed', async () => {
  let writes = 0;
  const computer = new ComputerUse({ getWindowState() {}, setValue: async () => {
    writes++; return { text: 'PRIVATE_WINDOW_TEXT', isError: true,
      structuredJson: JSON.stringify({ effect: 'partial', privateText: 'PRIVATE_WINDOW_TEXT' }), action: { effect: 1 } };
  } });
  const { engine } = fixture({ client: { setValue: input => computer.setValue(input) } });
  try {
    const observed = await engine.run(request('observeWindow', windowInput), 1);
    const operation = request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' });
    const result = await engine.run(operation, 1);
    assert.equal(result.ok, false); assert.equal(result.error, 'computer_operation_failed');
    assert.equal(result.diagnostic.source, 'computer_use'); assert.equal(result.diagnostic.phase, 'native_call');
    assert.deepEqual(result.diagnostic.operation, { dispatched: true, committed: true, cancellationRequested: false });
    assert.equal(result.diagnostic.nextAction, 'observe_before_action');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    assert.equal((await engine.run(operation, 1)).error, 'computer_request_already_dispatched'); assert.equal(writes, 1);
  } finally { await engine.dispose(); }
});

test('a result encoding failure is distinguished from a native failure without repeating the effect', async () => {
  let writes = 0;
  const output = { effect: 'confirmed', privateText: 'PRIVATE_WINDOW_TEXT' }; output.circular = output;
  const { engine } = fixture({ client: { setValue: async () => { writes++; return output; } } });
  try {
    const observed = await engine.run(request('observeWindow', windowInput), 1);
    const operation = request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' });
    const result = await engine.run(operation, 1);
    assert.equal(result.ok, false); assert.equal(result.diagnostic.phase, 'result_encoding');
    assert.equal(result.diagnostic.nextAction, 'observe_before_action'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|circular/);
    assert.equal((await engine.run(operation, 1)).error, 'computer_request_already_dispatched'); assert.equal(writes, 1);
  } finally { await engine.dispose(); }
});

test('real SDK DriverError constructors preserve all ActionCompletion enums without inventing success', async t => {
  const runtime = fileURLToPath(new URL(`../build-resources/computer-runtime/${process.platform}-${process.arch}/`, import.meta.url));
  if (!existsSync(`${runtime}/cua_driver_node_runtime.node`)) return t.skip('Matching native SDK payload is not prepared');
  const prior = process.env.QWEN_CUA_SDK_NATIVE_DIR; process.env.QWEN_CUA_SDK_NATIVE_DIR = runtime;
  let sdk;
  try { sdk = await import('../node_modules/@qwen-code/cua-sdk/dist/native/cua_driver_sdk.js'); }
  finally { if (prior === undefined) delete process.env.QWEN_CUA_SDK_NATIVE_DIR; else process.env.QWEN_CUA_SDK_NATIVE_DIR = prior; }
  // Only instantiate generated error records. No driver/session/window is created.
  for (const [name, completion] of [['NotStarted', 'not_started'], ['Completed', 'completed'], ['Unknown', 'unknown']]) {
    const error = sdk.DriverError.ActionInterrupted.new({ completion: sdk.ActionCompletion[name], reason: 'PRIVATE_WINDOW_TEXT' });
    assert.equal(error.code, undefined, 'the real FFI contract does not expose a top-level code');
    const { engine } = fixture({ client: { setValue: async () => { throw error; } } });
    try {
      const observed = await engine.run(request('observeWindow', windowInput), 1);
      const result = await engine.run(request('setValue', { ...windowInput, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture value' }), 1);
      assert.equal(result.ok, false); assert.equal(result.error, 'computer_action_interrupted');
      assert.equal(result.diagnostic.completion, completion); assert.equal(result.diagnostic.nextAction, 'observe_before_action');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    } finally { await engine.dispose(); }
  }
});

test('the legacy SDK AXPress cannot-complete classifier retains uncertainty and no private text', async () => {
  const message='AX action failed: AXUIElementPerformAction(AXPress) returned -25204';
  for(const [platform,text,expected] of [['darwin',message,'computer_ax_action_unconfirmed'],['win32',message,'computer_operation_failed'],['darwin',`PRIVATE ${message}`,'computer_operation_failed']]) {
    let writes=0;const computer=new ComputerUse({getWindowState(){},windowClick:async()=>{writes++;return{text,isError:true};}});
    let error;try{await computer.click({...windowInput,elementToken:'button-1',deliveryMode:'background'});}catch(cause){error=cause;}
    const result=computerFailure(request('click',windowInput),error,'native_call',platform);
    assert.equal(result.error,expected);assert.equal(writes,1);assert.equal(result.diagnostic.nativeCode,expected==='computer_ax_action_unconfirmed'?-25204:undefined);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|AX action failed/);
  }
});

test('Windows posted right clicks retain normalized coordinates; drag never reaches global input', async () => {
  const inputs = [];
  const windowsInput = { post: async input => inputs.push(input), execute: async () => assert.fail('global input'), dispose: async () => {} };
  const { engine } = fixture({ engine: { platform: 'win32', windowsInput } });
  try {
    assert.equal((await engine.userPointer('conversation-a', 1, { ...windowInput, kind: 'click', x: .25, y: .5, button: 'right' })).ok, true);
    assert.equal(inputs[0].button, 'right'); assert.equal(inputs[0].x, .25); assert.equal(inputs[0].y, .5);
    for (const durationMs of [undefined, 50, 2000]) assert.equal((await engine.userPointer('conversation-a', 1, {
      ...windowInput, kind: 'drag', from: {x:0,y:0}, to:{x:1,y:1}, durationMs })).ok, true);
    assert.equal(inputs.length, 4);
  } finally { await engine.dispose(); }
});
test('Windows malformed input is rejected before dispatch; held/chord input uses the background driver', async () => {
  let dispatched = 0;
  const { engine } = fixture({ engine: { platform: 'win32', windowsInput: {
    post: async () => dispatched++, execute: async () => assert.fail('global input'), dispose: async () => {} } } });
  try {
    for (const input of [{ keys: [] }, { keys: ['a','b','c','d','e'] }, { key:'a',holdMs:-1 }, { key:'a',text:'x' }, { key:'a',modifiers:['invalid'] }])
      assert.equal((await engine.userKeys('conversation-a',1,{...windowInput,...input})).error,'computer_input_invalid');
    for (const input of [{ keys:['left','alt'] }, { key:'a',holdMs:50 }, { key:'a',modifiers:['ctrl'] }])
      assert.equal((await engine.userKeys('conversation-a',1,{...windowInput,...input})).ok,true);
    assert.equal((await engine.userKeys('conversation-a',1,{...windowInput,text:'hello'})).ok,true);
    assert.equal(dispatched,4);
  } finally { await engine.dispose(); }
});
test('posted window input cancellation drains same-conversation queue without global fallback', async () => {
  const started=deferred(), terminal=deferred();let sent=0;
  const {engine}=fixture({engine:{platform:'win32',windowsInput:{dispose:async()=>{},post:async()=>{sent++;started.resolve();await terminal.promise;},execute:()=>assert.fail('global input')}}});
  try {
    const first=engine.userPointer('conversation-a',1,{...windowInput,kind:'click',x:.2,y:.3});await started.promise;
    const controller=new AbortController();const next=engine.userPointer('conversation-a',1,{...windowInput,kind:'click',x:.2,y:.3,signal:controller.signal});controller.abort();terminal.resolve();
    assert.equal((await first).ok,true);assert.equal((await next).ok,false);assert.equal(sent,1);
  }finally{terminal.resolve();await engine.dispose();}
});
test('posted window native errors retain their code without a foreground fallback', async () => {
  let sent=0;const {engine}=fixture({engine:{platform:'win32',windowsInput:{dispose:async()=>{},post:async()=>{sent++;throw Object.assign(Error('private'),{code:'background_unsupported'});},execute:()=>assert.fail('global input')}}});
  try{assert.equal((await engine.userPointer('conversation-a',1,{...windowInput,kind:'click',x:.2,y:.3,delivery:'auto'})).error,'background_unsupported');assert.equal(sent,1);}finally{await engine.dispose();}
});

test('trusted tab IPC forwards button, drag, chord and optional hold fields without dropping them', async () => {
  const viewModule = createRequire(import.meta.url)('../computer-window-view.cjs');
  const createView = viewModule.createComputerWindowView;
  const handlers = new Map(), calls = [];
  try {
    viewModule.createComputerWindowView = () => ({ canView: () => true });
    registerComputerAutomation({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, desktopCapturer: {},
      trustedMainFrame: () => true, automation: { platform: 'win32',
        userPointer: async (...args) => { calls.push(['pointer', ...args]); return { ok: true }; },
        userKeys: async (...args) => { calls.push(['keys', ...args]); return { ok: true }; }
      } });
  } finally { viewModule.createComputerWindowView = createView; }
  const event = { sender: { id: 1, isDestroyed: () => false } };
  const pointer = handlers.get('nextmux:computer:view:pointer'), keys = handlers.get('nextmux:computer:view:keys');
  await pointer(event, 'conversation-a', { ...windowInput, kind: 'click', x: 0.4, y: 0.7, button: 'right' });
  assert.equal(calls.at(-1)[3].button, 'right');
  await pointer(event, 'conversation-a', { ...windowInput, kind: 'drag', from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.9 }, durationMs: 400 });
  assert.deepEqual(calls.at(-1)[3].from, { x: 0.2, y: 0.3 }); assert.deepEqual(calls.at(-1)[3].to, { x: 0.8, y: 0.9 });
  assert.equal(calls.at(-1)[3].durationMs, 400);
  await keys(event, 'conversation-a', { ...windowInput, keys: ['left', 'alt'], holdMs: 300 });
  assert.deepEqual(calls.at(-1)[3].keys, ['left', 'alt']); assert.equal(calls.at(-1)[3].holdMs, 300);
  await keys(event, 'conversation-a', { ...windowInput, key: 'a' });
  assert.equal(calls.at(-1)[3].holdMs, undefined, 'omitted hold must stay omitted for legacy instantaneous Windows key input');
});

for (const platform of ['darwin','win32']) test(`${platform} opaque SDK drag is rejected without dispatch or fallback`, async()=>{
  let dispatched=0;const {engine}=fixture({engine:{platform},client:{drag:async()=>{dispatched++;}}});
  try{const observed=await engine.run(request('observeWindow',windowInput),1);const operation=request('drag',{...windowInput,snapshotId:observed.output.snapshotId,fromX:0,fromY:0,toX:100,toY:100});assert.equal((await engine.run(operation,1)).error,'background_unsupported');assert.equal((await engine.run(operation,1)).error,'computer_request_already_dispatched');assert.equal(dispatched,0);}finally{await engine.dispose();}
});
