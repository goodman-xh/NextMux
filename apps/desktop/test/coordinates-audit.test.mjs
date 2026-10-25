import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ComputerUse } from '../node_modules/@qwen-code/cua-sdk/computer-use/index.js';

const require = createRequire(import.meta.url);
const { ComputerAutomation } = require('../computer-automation.cjs');
const { buildQuestions, readAnswers, readPixels, findTemplate } = require('../app-plugin-core.cjs');
const { normalizeModel } = require('../app-plugins.cjs');
const target = { pid: 7, windowId: 9 };
const request = (action, input = {}) => ({ action, input, conversationId: 'coordinates-audit',
  id: crypto.randomUUID(), expiresAt: Date.now() + 10_000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// No native host is started: the real SDK facade terminates at these typed driver stubs.
for (const platform of ['darwin', 'win32']) {
  test(`${platform}: screenshot pixels normalize for background input without desktop-origin or 1000-scale conversion`, async t => {
    const calls = [];
    const native = { getWindowState() {} };
    for (const name of ['windowClick', 'doubleClick', 'rightClick', 'windowDrag', 'windowScroll']) {
      native[name] = async value => { calls.push([name, value]); return { text: 'fixture dispatched', isError: false }; };
    }
    const computer = new ComputerUse(native);
    const context = { windowBounds: { x: -1800, y: -900, width: 800, height: 600 },
      screenshotScale: 2, screenshotFrameValid: true };
    const background = [];
    const engine = new ComputerAutomation({ platform,
      windowsInput: { post: async input => { background.push(input); }, dispose: async () => {} },
      view: { grant() {}, pointer: async (_c, pid, windowId, input) => { background.push({ pid, windowId, ...input }); return { ok: true }; }, dispose: async () => {} },
      sdkLoader: async () => ({ create: async () => ({
      observeWindow: async () => ({ ...target, context, elements: [{ element_token: 'scroll-region' }],
        screenshot: { width: 1600, height: 1200, images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }] } }),
      ...Object.fromEntries(['click', 'doubleClick', 'rightClick', 'drag', 'scroll'].map(name => [name, input => computer[name](input)])),
      close: async () => {}
    }) }) });
    t.after(() => engine.dispose());
    for (const [action, input, coordinateKeys] of [
      ['click', { x: 1200, y: 700, button: 'left' }, ['x', 'y']],
      ['doubleClick', { x: 400, y: 300 }, ['x', 'y']],
      ['rightClick', { x: 1599, y: 1199 }, ['x', 'y']],
      ['drag', { fromX: 1200, fromY: 700, toX: 400, toY: 300, durationMs: 100 }, ['fromX', 'fromY', 'toX', 'toY']],
      ['scroll', { x: 500, y: 600, direction: 'left', amount: 2 }, ['x', 'y']]
    ]) {
      const observation = await engine.run(request('observeWindow', target), 1);
      assert.deepEqual(observation.output.context, context);
      assert.equal(observation.images[0].data, 'AAAA');
      const result = await engine.run(request(action, { ...target, snapshotId: observation.output.snapshotId, ...input }), 1);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(calls.length, background.length - 1, 'engine never invokes opaque SDK event injection');
      const delivered = background.at(-1);
      if (action === 'drag') {
        assert.deepEqual(delivered.from, { x: input.fromX / 1600, y: input.fromY / 1200 });
        assert.deepEqual(delivered.to, { x: input.toX / 1600, y: input.toY / 1200 });
      } else { assert.equal(delivered.x, input.x / 1600); assert.equal(delivered.y, input.y / 1200); }
      // Retain the separate upstream facade coordinate contract, using driver stubs only.
      await computer[action]({ ...target, ...input, deliveryMode: 'background' });
      for (const key of coordinateKeys) assert.equal(calls.at(-1)[1][key], input[key]);
      assert.equal(Number(delivered.pid), target.pid);
      assert.equal(Number(delivered.windowId), target.windowId);
    }
    assert.equal(calls.length, 5);
  });
}

test('Windows tab endpoints remain fractions until native dispatch and never inherit an SDK screenshot scale', async t => {
  const calls = [];
  const engine = new ComputerAutomation({ platform: 'win32', windowsInput: {
    post: async input => { calls.push([input.kind, input]); return { effect: 'dispatched' }; },
    execute: async () => assert.fail('global dispatch is forbidden'),
    dispose: async () => {}
  }, sdkLoader: async () => ({ create: async () => ({
    listWindows: async () => assert.fail('native geometry must be read after foreground acquisition'),
    click: async () => assert.fail('Qwen bitmap coordinates are a different space'),
    scroll: async () => assert.fail('Qwen bitmap coordinates are a different space'),
    drag: async () => assert.fail('Qwen bitmap coordinates are a different space'),
    close: async () => {}
  }) }) });
  t.after(() => engine.dispose());
  for (const input of [
    { kind: 'click', x: 1, y: 1 },
    { kind: 'doubleClick', x: 0, y: 1, whole: true },
    { kind: 'scroll', x: 1, y: 0, direction: 'right', amount: 2 },
    { kind: 'drag', from: { x: 0, y: 1 }, to: { x: 1, y: 0 }, durationMs: 50 }
  ]) assert.equal((await engine.userPointer('coordinates-audit', 1, { ...target, ...input })).ok, true);
  assert.deepEqual(calls.map(([action]) => action), ['click', 'doubleClick', 'scroll', 'drag']);
  assert.ok(calls.every(([, input]) => input.pid === target.pid && input.windowId === target.windowId));
  assert.equal(calls[0][1].x, 1); assert.equal(calls[0][1].y, 1);
  assert.equal(calls[1][1].kind, 'doubleClick');
  assert.equal(calls[2][1].direction, 'right');
  assert.equal(calls[3][1].from.y, 1); assert.equal(calls[3][1].to.x, 1);
});

test('Windows screenshot scrolling posts once and never retries a committed request', async t => {
  const { engine, calls, run } = windowsCoordinateFixture(t);
  const observed = await run('first', 'observeWindow', target);
  const pixel = { ...request('scroll', { ...target, snapshotId: observed.output.snapshotId, x: 500, y: 300, direction: 'down', amount: 1 }), conversationId: 'first' };
  assert.equal((await engine.run(pixel, 1)).ok, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'scroll');
  assert.equal(calls[0].x, .5); assert.equal(calls[0].y, .5);
  assert.equal((await engine.run(pixel, 1)).ok, true, 'identical request returns its cached result');
  assert.equal((await engine.run({ ...pixel, input: { ...pixel.input, amount: 2 } }, 1)).ok, false);
  assert.equal(calls.length, 1);
});

function windowsCoordinateFixture(t, observe) {
  const calls = [];
  const engine = new ComputerAutomation({ platform: 'win32', windowsInput: { post: async input => { calls.push(input); }, dispose: async () => {} }, sdkLoader: async () => ({ create: async () => ({
    observeWindow: observe || (async () => ({ elements: [{ element_token: 'button' }], screenshot: { width: 1000, height: 600 } })),
    click: async () => assert.fail('opaque SDK click is forbidden'),
    close: async () => {}
  }) }) });
  t.after(() => engine.dispose());
  const run = (conversationId, action, input) => engine.run({ ...request(action, input), conversationId }, 1);
  return { engine, calls, run };
}

test('Windows pixel input refreshes after another window of the same PID changes the SDK screenshot scale', async t => {
  const { run, calls } = windowsCoordinateFixture(t);
  const first = await run('first', 'observeWindow', target);
  await run('second', 'observeWindow', { pid: 7, windowId: 10 });
  const stale = await run('first', 'click', { ...target, snapshotId: first.output.snapshotId, x: 500, y: 300 });
  assert.equal(stale.error, 'computer_snapshot_stale');
  assert.equal(calls.length, 0);
  assert.equal((await run('first', 'click', { ...target, snapshotId: first.output.snapshotId, elementToken: 'button' })).error, 'computer_element_unlocatable');
  const fresh = await run('first', 'observeWindow', target);
  await run('third', 'observeWindow', { pid: 8, windowId: 11 });
  assert.equal((await run('first', 'click', { ...target, snapshotId: fresh.output.snapshotId, x: 500, y: 300 })).ok, true,
    'a different PID has an independent SDK resize entry');
  assert.equal(calls.length, 1);
});

test('Windows pending observations invalidate the shared PID screenshot mapping before any pixel input', async t => {
  const started = deferred(), finish = deferred();
  const { run, calls } = windowsCoordinateFixture(t, async input => {
    if (input.windowId === 10) { started.resolve(); await finish.promise; }
    return { elements: [{ element_token: 'button' }], screenshot: { width: input.windowId === 9 ? 1000 : 500, height: 600 } };
  });
  const first = await run('first', 'observeWindow', target);
  const observing = run('second', 'observeWindow', { pid: 7, windowId: 10 });
  await started.promise;
  let completed = false;
  const clicking = run('first', 'click', { ...target, snapshotId: first.output.snapshotId, x: 500, y: 300 }).then(value => { completed = true; return value; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, true); assert.equal(calls.length, 0);
  } finally { finish.resolve(); }
  assert.equal((await observing).ok, true);
  assert.equal((await clicking).error, 'computer_snapshot_stale');
  assert.equal(calls.length, 0);
});

test('Windows failed or screenshot-free observations cannot authorize pixel input or opaque token injection', async t => {
  const { run, calls } = windowsCoordinateFixture(t, async input => {
    if (input.windowId === 11) throw Object.assign(Error('fixture capture failed'), { code: 'fixture_capture_failed' });
    return { elements: [{ element_token: 'button' }],
      ...(input.includeScreenshot === false ? {} : { screenshot: { width: 1000, height: 600 } }) };
  });
  const first = await run('first', 'observeWindow', target);
  const secondTarget = { pid: 7, windowId: 10 };
  const second = await run('second', 'observeWindow', { ...secondTarget, includeScreenshot: false });
  assert.equal((await run('first', 'click', { ...target, snapshotId: first.output.snapshotId, x: 500, y: 300 })).error, 'computer_snapshot_stale');
  assert.equal((await run('second', 'click', { ...secondTarget, snapshotId: second.output.snapshotId, x: 100, y: 100 })).error, 'computer_snapshot_stale');
  assert.equal(calls.length, 0);
  assert.equal((await run('second', 'click', { ...secondTarget, snapshotId: second.output.snapshotId, elementToken: 'button' })).error, 'computer_element_unlocatable');
  assert.equal(calls.length, 0);
  const refreshed = await run('first', 'observeWindow', target);
  assert.equal((await run('third', 'observeWindow', { pid: 7, windowId: 11 })).error, 'fixture_capture_failed');
  assert.equal((await run('first', 'click', { ...target, snapshotId: refreshed.output.snapshotId, x: 500, y: 300 })).error, 'computer_snapshot_stale');
  assert.equal(calls.length, 0);
});

test('Jev decisions select declared actions; arbitrary model coordinates cannot become executable actions', () => {
  const decision = { id: 'move', type: 'choice', question: 'Which action?', options: ['left', 'right'] };
  const actions = { left: { label: 'Left', steps: [{ click: [0.25, 0.5] }] },
    right: { label: 'Right', steps: [{ click: [0.75, 0.5] }] } };
  assert.deepEqual(Object.keys(buildQuestions({ actions }, [decision]).move.criteria), ['left', 'right']);
  assert.deepEqual(readAnswers({ answers: { move: { x: 1000, y: 800, choice: 'click', confidence: 1 } } }, [decision]), {});
  const answers = readAnswers({ answers: { move: { choice: 'right', confidence: 0.9, x: -500, y: 8000 } } }, [decision]);
  assert.equal(answers.move.choice, 'right');
  assert.equal(Object.hasOwn(answers.move, 'x'), false);
  assert.deepEqual(actions.right.steps, [{ click: [0.75, 0.5] }]);
  for (const source of ['nextmux', 'connection']) {
    const model = normalizeModel({ source, model: 'typesafe/jev-1.13', images: true, connectionId: 'fixture' });
    assert.equal(model.images, false, 'remote decision models do not gain vision from their model name or stale saved flag');
  }
});

function bitmap(width, height, paint, padding = 0) {
  const stride = width * 4 + padding, data = Buffer.alloc(stride * height, 0xee);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y), at = y * stride + x * 4;
    data[at] = b; data[at + 1] = g; data[at + 2] = r; data[at + 3] = 255;
  }
  return { width, height, stride, data };
}

test('plugin pixel regions include the final pixel and use the declared BGRA row stride', () => {
  for (const [width, height, padding] of [[2, 3, 0], [7, 5, 12], [50, 30, 16]]) {
    const frame = bitmap(width, height, (x, y) => x === width - 1 && y === height - 1 ? [240, 20, 30] : [0, 0, 0], padding);
    assert.equal(readPixels(frame, { points: [[1, 1, '#f0141e']], tolerance: 0 }), true);
    assert.equal(readPixels(frame, { points: [[0, 0, '#f0141e']], tolerance: 0 }), false);
  }
});

test('template coordinates remain window fractions when a captured frame is uniformly scaled', () => {
  const paint = (x, y) => x >= 4 && x < 12 && y >= 4 && y < 12 ? [250, 240, 100] : [10, 20, 30];
  const template = bitmap(16, 16, paint);
  for (const factor of [1, 2]) {
    const frame = bitmap(160 * factor, 100 * factor, (x, y) => {
      const localX = Math.floor(x / factor) - 100, localY = Math.floor(y / factor) - 30;
      return localX >= 0 && localX < 16 && localY >= 0 && localY < 16 ? paint(localX, localY) : [2, 3, 4];
    });
    const result = findTemplate(frame, { rect: [0, 0, 1, 1], threshold: 1, max: 1 }, template, { width: 160, height: 100 });
    assert.equal(result.found, true);
    assert.equal(result.x, 0.675);
    assert.equal(result.y, 0.38);
  }
});
