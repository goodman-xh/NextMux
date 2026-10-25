import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { GuestTransport, GuestAutomation, registerBrowserAutomation, snapshotElementState } = require('../browser-automation.cjs');

test('snapshot exposes bounded form values and drop semantics without reading password values or local file paths', () => {
  const input = { tagName: 'INPUT', type: 'text', value: 'NextMux', getAttribute: () => null, matches: () => false };
  assert.equal(snapshotElementState(input).value, 'NextMux');
  assert.deepEqual({ ...snapshotElementState({ ...input, value: 'abcdef' }, 3) },
    { role: 'input', disabled: false, readonly: false, inputType: 'text', value: 'abc', valueTruncated: true });
  for (const attributes of [{ type: 'password' }, { autocomplete: 'current-password' }, { autocomplete: 'one-time-code' }]) {
    const secret = { ...input, ...attributes, get value() { throw Error('protected value must not be read'); } };
    assert.equal(snapshotElementState(secret).valueRedacted, true);
    assert.equal(Object.hasOwn(snapshotElementState(secret), 'value'), false);
  }
  const file = { ...input, type: 'file', value: '/private/secret.txt', files: [{ name: 'upload.txt', size: 4 }] };
  assert.equal(Object.hasOwn(snapshotElementState(file), 'value'), false);
  assert.deepEqual(snapshotElementState(file).files, [{ name: 'upload.txt', size: 4 }]);
  const option = { value: 'blue', label: 'Blue', selected: true };
  assert.deepEqual(snapshotElementState({ ...input, tagName: 'SELECT', value: 'blue', options: [option], selectedOptions: [option] }).selectedValues, ['blue']);
  assert.equal(snapshotElementState({ ...input, tagName: 'DIV', ondrop() {} }).dropTarget, true);
  assert.equal(snapshotElementState({ ...input, tagName: 'DIV', matches: selector => selector.includes('[data-dropzone]') }).dropTarget, true);
});

test('CDP transport cannot discover other tabs, attach foreign targets, or run browser-global commands', async () => {
  const debuggerEvents = new EventEmitter(), calls = [];
  Object.assign(debuggerEvents, { sendCommand: async (...args) => { calls.push(args); return {}; }, isAttached: () => false });
  const transport = new GuestTransport({ debugger: debuggerEvents, isDestroyed: () => false }, { targetId: 'owned' });
  assert.deepEqual(await transport.dispatch({ method: 'Target.getTargets' }), { targetInfos: [{ targetId: 'owned', type: 'page', browserContextId: undefined }] });
  for (const command of [
    { method: 'Target.attachToTarget', params: { targetId: 'foreign' } },
    { method: 'Target.createTarget', params: { url: 'about:blank' } },
    { method: 'Browser.close', sessionId: 'nextmux-guest' },
    { method: 'Target.attachToTarget', sessionId: 'nextmux-guest', params: { targetId: 'foreign' } },
    { method: 'Runtime.evaluate', sessionId: 'foreign' }
  ]) await assert.rejects(transport.dispatch(command));
  assert.equal(calls.length, 0);
  debuggerEvents.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'owned-frame' });
  await transport.dispatch({ method: 'Runtime.enable', sessionId: 'owned-frame' });
  assert.deepEqual(calls[0], ['Runtime.enable', {}, 'owned-frame']);
  debuggerEvents.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'owned-frame' });
  await assert.rejects(transport.dispatch({ method: 'Runtime.enable', sessionId: 'owned-frame' }));
  transport.close();
});

test('native IPC requires trusted host, matching webview partition, and immutable conversation/project ownership', async () => {
  const handlers = new Map(), partition = {}, sender = {}, calls = [];
  const guest = Object.assign(new EventEmitter(), { isDestroyed: () => false, getType: () => 'webview', hostWebContents: sender, session: partition });
  const original = GuestAutomation.create;
  GuestAutomation.create = async () => ({ run: async request => { calls.push(request); return { ok: true }; }, cancel: id => calls.push(id), dispose: async () => {} });
  try {
    registerBrowserAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, webContents: { fromId: id => id === 7 ? guest : undefined },
      session: { fromPartition: () => partition }, trustedMainFrame: event => event.trusted === true });
    const action = handlers.get('nextmux:browser:action'), event = { trusted: true, sender };
    const request = { id: 'request', action: 'snapshot', conversationId: 'conversation', browserId: 'tab', workspaceRoot: '/workspace', expiresAt: Date.now() + 5000 };
    const denied = await action({ ...event, trusted: false }, 7, request);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'BROWSER_REQUEST_DENIED');
    assert.equal(denied.message, 'This browser request is not allowed.');
    assert.equal((await action({ ...event, sender: {} }, 7, request)).ok, false);
    guest.session = {};
    assert.equal((await action(event, 7, request)).ok, false);
    guest.session = partition;
    assert.equal((await action(event, 8, request)).ok, false);
    assert.equal((await action(event, 7, request)).ok, true);
    for (const changed of [{ conversationId: 'another' }, { browserId: 'another' }, { workspaceRoot: '/another' }]) {
      assert.equal((await action(event, 7, { ...request, ...changed })).ok, false);
    }
    assert.equal(calls.length, 1);
    assert.equal(await handlers.get('nextmux:browser:cancel')({ ...event, sender: {} }, 7, 'request'), false);
    assert.equal(await handlers.get('nextmux:browser:cancel')(event, 7, 'request'), true);
    assert.equal(calls.at(-1), 'request');
  } finally { GuestAutomation.create = original; }
});

test('same backend operation ID is executed once even when renderer repeats IPC', async () => {
  const engine = new GuestAutomation({}, {}, { on() {} }, {});
  let executions = 0;
  engine.execute = async request => { executions++; return { requestId: request.id, ok: true }; };
  const results = await Promise.all([engine.run({ id: 'once' }), engine.run({ id: 'once' })]);
  assert.deepEqual(results[0], results[1]);
  await engine.run({ id: 'once' });
  assert.equal(executions, 1);
});

for (const reason of ['cancel', 'expire']) test(`a fill interrupted by ${reason} during its focus click cannot enter text or publish success`, async () => {
  const engine = new GuestAutomation({}, {}, { on() {} }, {});
  const request = { id: `focus-${reason}`, action: 'fill', selector: '#input', text: 'must not type', expiresAt: Date.now() + 5000 };
  let clicks = 0, fills = 0;
  const locator = {
    filter() { return this; },
    map() { return { wait: async () => true }; },
    click: async () => {
      clicks++;
      if (reason === 'cancel') engine.cancel(request.id);
      else request.expiresAt = Date.now() - 1;
    },
    setWaitForStableBoundingBox() { return this; },
    fill: async () => { fills++; }
  };
  engine.target = async () => locator;
  engine.snapshot = async () => { throw Error('cancelled fill must not reach final observation'); };
  const result = await engine.run(request);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BROWSER_ACTION_EXPIRED');
  assert.equal(clicks, 1);
  assert.equal(fills, 0);
  assert.deepEqual(await engine.run(request), result);
  assert.equal(clicks, 1, 'retrying a cancelled operation ID must not focus twice');
});

for (const action of ['snapshot', 'click']) test(`cancelling ${action} during its final observation never publishes late success or repeats the action`, async () => {
  const engine = new GuestAutomation({}, {}, { on() {} }, {});
  let observe, release, clicks = 0;
  const observing = new Promise(resolve => { observe = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  engine.target = async () => ({ click: async () => { clicks++; } });
  engine.snapshot = async () => { observe(); await held; return { snapshotId: 'late' }; };
  const request = { id: `cancel-${action}`, action, expiresAt: Date.now() + 5000 };
  const running = engine.run(request);
  await observing;
  engine.cancel(request.id);
  release();
  const result = await running;
  assert.equal(result.ok, false);
  assert.match(result.message, /cancelled or expired/);
  assert.equal(result.code, 'BROWSER_ACTION_EXPIRED');
  assert.deepEqual(result.params, {});
  assert.doesNotMatch(result.message, /\p{Script=Han}/u);
  assert.equal(result.data, undefined);
  assert.deepEqual(await engine.run(request), result);
  assert.equal(clicks, action === 'click' ? 1 : 0);
});

test('a snapshot that outlives its deadline cannot publish a successful result', async () => {
  const engine = new GuestAutomation({}, {}, { on() {} }, {});
  const request = { id: 'expired-snapshot', action: 'snapshot', expiresAt: Date.now() + 5000 };
  engine.snapshot = async () => { request.expiresAt = Date.now() - 1; return { snapshotId: 'expired' }; };
  const result = await engine.run(request);
  assert.equal(result.ok, false);
  assert.equal(result.data, undefined);
});

const never = () => new Promise(() => {});
const flush = () => new Promise(resolve => setImmediate(resolve));
function snapshotFixture() {
  const elements = [], lists = [];
  const element = name => {
    const handle = { disposed: 0, asElement: () => handle, dispose: async () => { handle.disposed++; },
      evaluate: async evaluator => evaluator.name === 'elementName' ? name : { role: 'button', disabled: false, readonly: false } };
    elements.push(handle); return handle;
  };
  const list = handles => {
    const handle = { disposed: 0, getProperties: async () => new Map(handles.map((value, index) => [String(index), value])), dispose: async () => { handle.disposed++; } };
    lists.push(handle); return handle;
  };
  const frame = (name, handles = []) => ({ detached: false, url: () => `https://example.test/${name}`,
    evaluate: async () => ({ title: name, text: `${name} text` }), evaluateHandle: async () => list(handles) });
  const main = frame('main', [element('main button')]);
  const page = Object.assign(new EventEmitter(), { mainFrame: () => main, frames: () => [main], url: main.url,
    title: () => { throw Error('snapshot must reuse the observed title'); } });
  const engine = new GuestAutomation({}, {}, page, {});
  return { engine, page, main, element, list, frame, elements, lists };
}

test('a stalled iframe returns bounded partial data and usable refs from healthy frames', async () => {
  const { engine, page, main, element, frame } = snapshotFixture();
  const stalled = frame('stalled'), healthy = frame('healthy', [element('child button')]);
  stalled.evaluate = never;
  page.frames = () => [stalled, healthy, main];
  // Releasing old CDP handles must not hold up the new snapshot either.
  engine.refs.set('old', { handle: { dispose: never } });
  const started = Date.now();
  const result = await engine.snapshot({ timeoutMs: 300, frameTimeoutMs: 30 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.title, 'main');
  assert.equal(result.frames[0].main, true);
  assert.equal(result.frames.find(frame => frame.url.endsWith('/stalled')).unavailable, true);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.elements.map(item => item.name), ['main button', 'child button']);
  assert.deepEqual([...engine.refs.keys()], result.elements.map(item => item.ref));
  for (const item of result.elements) assert.ok(engine.frames.has(item.frameId));
  assert.equal(engine.refs.has('old'), false);
});

test('the whole snapshot has one budget across multiple stalled frames', async () => {
  const { engine, page, main, frame } = snapshotFixture();
  const stalled = Array.from({ length: 20 }, (_, index) => ({ ...frame(`stalled${index}`), evaluate: never }));
  page.frames = () => [main, ...stalled];
  const started = Date.now();
  const result = await engine.snapshot({ timeoutMs: 75, frameTimeoutMs: 30 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.truncated, true);
  assert.ok(result.frames.length < 21, 'later frames are skipped when the total budget is exhausted');
  assert.equal(result.elements[0].name, 'main button');
});

for (const stage of ['list', 'properties']) test(`late ${stage} handles are disposed without changing the next snapshot refs`, async () => {
  const { engine, page, main, element, list, frame } = snapshotFixture();
  const lateElement = element('late button'), lateList = list([lateElement]), child = frame('late');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  if (stage === 'list') child.evaluateHandle = () => held;
  else { child.evaluateHandle = async () => lateList; lateList.getProperties = () => held; }
  page.frames = () => [main, child];
  const partial = await engine.snapshot({ timeoutMs: 300, frameTimeoutMs: 30 });
  assert.equal(partial.truncated, true);
  assert.equal(partial.elements.length, 1);
  page.frames = () => [main];
  const next = await engine.snapshot({ timeoutMs: 300 });
  release(stage === 'list' ? lateList : new Map([['0', lateElement]]));
  await flush();
  assert.equal(lateList.disposed, 1);
  if (stage === 'properties') assert.equal(lateElement.disposed, 1);
  assert.deepEqual([...engine.refs.keys()], next.elements.map(item => item.ref));
  assert.equal([...engine.refs.values()].some(item => item.handle === lateElement), false);
});

for (const reason of ['cancel', 'expire']) test(`a genuinely stalled snapshot responds to ${reason} and discards its staged refs`, async () => {
  const { engine, page, main, frame, elements } = snapshotFixture();
  let observing;
  const observed = new Promise(resolve => { observing = resolve; });
  const child = frame('stalled');
  child.evaluate = () => { observing(); return never(); };
  page.frames = () => [main, child];
  const request = { id: `stalled-${reason}`, action: 'snapshot', expiresAt: Date.now() + (reason === 'expire' ? 50 : 5000) };
  const started = Date.now(), running = engine.run(request);
  await observed;
  if (reason === 'cancel') engine.cancel(request.id);
  const result = await running;
  await flush();
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BROWSER_ACTION_EXPIRED');
  assert.equal(result.data, undefined);
  assert.equal(engine.refs.size, 0);
  assert.equal(engine.frames.size, 0);
  assert.equal(elements[0].disposed, 1);
  assert.deepEqual(await engine.run(request), result);
});

test('navigation invalidates a snapshot in progress without republishing old refs', async () => {
  const { engine, page, main, element, frame } = snapshotFixture();
  const late = element('old child'), child = frame('child', [late]);
  let observing, release;
  const observed = new Promise(resolve => { observing = resolve; }), held = new Promise(resolve => { release = resolve; });
  late.evaluate = () => { observing(); return held; };
  page.frames = () => [main, child];
  const running = engine.snapshot({ timeoutMs: 300 });
  await observed;
  page.emit('framenavigated', child);
  release('old child');
  await assert.rejects(running, { code: 'BROWSER_FRAME_CHANGED' });
  await flush();
  assert.equal(engine.refs.size, 0);
  assert.equal(engine.frames.size, 0);
  assert.equal(late.disposed, 1);
});

test('cancellation between a completed observation and its publication invalidates the resulting refs', async () => {
  const { engine, elements } = snapshotFixture();
  const snapshot = engine.snapshot.bind(engine), request = { id: 'cancel-at-publication', action: 'snapshot', expiresAt: Date.now() + 5000 };
  engine.snapshot = async options => { const result = await snapshot(options); engine.cancel(request.id); return result; };
  const result = await engine.run(request);
  await flush();
  assert.equal(result.code, 'BROWSER_ACTION_EXPIRED');
  assert.equal(engine.refs.size, 0);
  assert.equal(engine.frames.size, 0);
  assert.equal(elements[0].disposed, 1);
});

test('native bridge and executor are packaged without a separate browser binary dependency', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('browser-automation.cjs'));
  assert.equal(pkg.dependencies['puppeteer-core'], '25.1.0');
  assert.equal(pkg.dependencies.puppeteer, undefined);
});

test('browser-automation.cjs pierces nested shadowRoot in actionable and retries controlled input value setter', () => {
  const { readFileSync } = require('node:fs');
  const source = readFileSync(new URL('../browser-automation.cjs', import.meta.url), 'utf8');
  assert.match(source, /while\s*\(\s*hit\s*&&\s*hit\.shadowRoot\s*\)/);
  assert.match(source, /new InputEvent\('input'/);
});
