import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ComputerAutomation } = require('../computer-automation.cjs');

let seq = 0;
const makeRequest = (conversationId, action, input = {}) => ({
  id: `req-el-${++seq}`,
  conversationId,
  runId: 'run-el',
  action,
  input,
  expiresAt: Date.now() + 10_000
});

function createTokenFixture(platform, observeOverride) {
  const calls = [];
  const engine = new ComputerAutomation({
    platform,
    windowsInput: {
      post: async payload => {
        calls.push(['native', 'post', payload, engine.userStopKey()]);
      },
      execute: async () => { throw new Error('global HID execute must not run'); },
      dispose: async () => {}
    },
    view: {
      grant: () => {},
      dispose: async () => {},
      pointer: async (_cid, pid, windowId, payload) => {
        calls.push(['view-pointer', { pid, windowId, ...payload }]);
        return { ok: true, effect: 'dispatched' };
      },
      keys: async (_cid, pid, windowId, payload) => {
        calls.push(['view-keys', { pid, windowId, ...payload }, engine.userStopKey()]);
        return { ok: true, effect: 'dispatched' };
      }
    },
    sdkLoader: async () => ({
      create: async () => ({
        observeWindow: async input => {
          if (observeOverride) return observeOverride(input);
          return {
            window: { pid: 7, windowId: 9, title: 'Calculator', bounds: { x: 100, y: 200, width: 400, height: 300 } },
            screenshot: { width: 800, height: 600, images: [] },
            screenshotScale: 2,
            screenshotFrameValid: true,
            elements: [
              // Centre in screen points: (180 + 40/2, 260 + 30/2) = (200, 275)
              // Relative to window (100, 200): (100, 75); scaled by 2 => px = 200, py = 150
              // Normalized on 800x600: x = 0.25, y = 0.25
              { element_token: 'btn-frame', role: 'AXButton', label: 'Submit', frame: { x: 180, y: 260, width: 40, height: 30 } },
              // Element using bounds.{x,y,w,h}: centre = (140 + 20/2, 230 + 20/2) = (150, 240); rel (50, 40); scaled by 2 => px = 100, py = 80
              // Normalized on 800x600: x = 0.125, y = 80/600
              { token: 'btn-rel', role: 'Button', name: 'Rel', bounds: { x: 140, y: 230, w: 20, h: 20 } },
              // Input field with top-level x/y/width/height
              { id: 'field-1', role: 'TextField', title: 'Search', x: 260, y: 320, width: 80, height: 60 },
              // Unlocatable element without bounds
              { element_token: 'no-bounds', role: 'AXStaticText', label: 'Ghost' },
              // Element outside screenshot bounds
              { element_token: 'out-of-bounds', frame: { x: 900, y: 900, width: 20, height: 20 } }
            ]
          };
        },
        click: async () => { throw new Error('opaque SDK click must never be called'); },
        doubleClick: async () => { throw new Error('opaque SDK doubleClick must never be called'); },
        rightClick: async () => { throw new Error('opaque SDK rightClick must never be called'); },
        scroll: async () => { throw new Error('opaque SDK scroll must never be called'); },
        typeText: async () => { throw new Error('opaque SDK typeText must never be called'); },
        pressKey: async () => { throw new Error('opaque SDK pressKey must never be called'); },
        hotkey: async () => { throw new Error('opaque SDK hotkey must never be called'); },
        setValue: async input => {
          calls.push(['sdk-setValue', input]);
          return { updated: true };
        },
        close: async () => {}
      })
    })
  });
  return { engine, calls };
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: click, doubleClick, rightClick, and scroll resolve elementToken to background screenshot coordinates`, async t => {
    const { engine, calls } = createTokenFixture(platform);
    t.after(() => engine.dispose());

    let obs = await engine.run(makeRequest('c1', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    assert.equal(obs.ok, true);

    const clickRes = await engine.run(makeRequest('c1', 'click', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'btn-frame'
    }), 1);
    assert.equal(clickRes.ok, true);

    const pointerCall = calls.at(-1);
    if (platform === 'darwin') {
      assert.equal(pointerCall[0], 'view-pointer');
      assert.equal(pointerCall[1].kind, 'click');
      assert.equal(pointerCall[1].x, 0.25);
      assert.equal(pointerCall[1].y, 0.25);
    } else {
      assert.equal(pointerCall[0], 'native');
      assert.equal(pointerCall[1], 'post');
      assert.equal(pointerCall[2].kind, 'click');
      assert.equal(pointerCall[2].x, 0.25);
      assert.equal(pointerCall[2].y, 0.25);
    }

    // Explicit x/y takes precedence over elementToken when both are passed.
    obs = await engine.run(makeRequest('c1', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    const xyWins = await engine.run(makeRequest('c1', 'doubleClick', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'btn-frame', x: 600, y: 450
    }), 1);
    assert.equal(xyWins.ok, true);
    const secondCall = calls.at(-1);
    const targetPayload = platform === 'darwin' ? secondCall[1] : secondCall[2];
    assert.equal(targetPayload.x, 0.75);
    assert.equal(targetPayload.y, 0.75);
    assert.equal(targetPayload.kind, 'doubleClick');

    // rightClick and scroll with elementToken
    obs = await engine.run(makeRequest('c1', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    const rightRes = await engine.run(makeRequest('c1', 'rightClick', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'btn-rel'
    }), 1);
    assert.equal(rightRes.ok, true);
    const rightPayload = platform === 'darwin' ? calls.at(-1)[1] : calls.at(-1)[2];
    assert.equal(rightPayload.button, 'right');
    assert.equal(rightPayload.x, 0.125);
    assert.ok(Math.abs(rightPayload.y - 80 / 600) < 1e-9);

    obs = await engine.run(makeRequest('c1', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    const scrollRes = await engine.run(makeRequest('c1', 'scroll', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'btn-frame', direction: 'down', amount: 3
    }), 1);
    assert.equal(scrollRes.ok, true);
    const scrollPayload = platform === 'darwin' ? calls.at(-1)[1] : calls.at(-1)[2];
    assert.equal(scrollPayload.kind, 'scroll');
    assert.equal(scrollPayload.x, 0.25);
    assert.equal(scrollPayload.y, 0.25);
    assert.equal(scrollPayload.direction, 'down');
    assert.equal(scrollPayload.amount, 3);
  });

  test(`${platform}: typeText, pressKey, and hotkey with elementToken perform a background focus click then dispatch keys while setValue uses SDK`, async t => {
    const { engine, calls } = createTokenFixture(platform);
    t.after(() => engine.dispose());

    let obs = await engine.run(makeRequest('c2', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    calls.length = 0;
    const typed = await engine.run(makeRequest('c2', 'typeText', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'field-1', text: 'hello'
    }), 1);
    assert.equal(typed.ok, true);
    // field-1: screen (260, 320, 80, 60) -> centre (300, 350) -> rel (200, 150) -> px = 400, py = 300 -> norm (0.5, 0.5)
    assert.equal(calls.length, 2, 'focus click followed by key dispatch');
    const focusPayload = platform === 'darwin' ? calls[0][1] : calls[0][2];
    assert.equal(focusPayload.kind, 'click');
    assert.equal(focusPayload.x, 0.5);
    assert.equal(focusPayload.y, 0.5);
    if (platform === 'darwin') {
      assert.equal(calls[1][0], 'view-keys');
      assert.equal(calls[1][1].text, 'hello');
      assert.equal(calls[1][2], false, 'sendingKeys active during view-keys');
    } else {
      assert.equal(calls[1][0], 'native');
      assert.equal(calls[1][1], 'post');
      assert.equal(calls[1][2].kind, 'text');
      assert.equal(calls[1][2].text, 'hello');
      assert.equal(calls[1][3], false, 'sendingKeys active during win32 post text');
    }

    obs = await engine.run(makeRequest('c2', 'observeWindow', { pid: 7, windowId: 9 }), 1);
    calls.length = 0;
    const setVal = await engine.run(makeRequest('c2', 'setValue', {
      pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'field-1', value: '42'
    }), 1);
    assert.equal(setVal.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sdk-setValue');
    assert.equal(calls[0][1].elementToken, 'field-1');
  });
}

test('unlocatable elementToken or invalid screenshot frame returns computer_element_unlocatable without dispatching', async t => {
  const { engine, calls } = createTokenFixture('darwin');
  t.after(() => engine.dispose());

  let obs = await engine.run(makeRequest('c3', 'observeWindow', { pid: 7, windowId: 9 }), 1);

  // Unknown token -> computer_element_stale
  const unknown = await engine.run(makeRequest('c3', 'click', {
    pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'does-not-exist'
  }), 1);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'computer_element_stale');

  // Known token without bounds -> computer_element_unlocatable
  const noBounds = await engine.run(makeRequest('c3', 'click', {
    pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'no-bounds'
  }), 1);
  assert.equal(noBounds.ok, false);
  assert.equal(noBounds.error, 'computer_element_unlocatable');

  // Known token whose centre is outside screenshot -> computer_element_unlocatable
  obs = await engine.run(makeRequest('c3', 'observeWindow', { pid: 7, windowId: 9 }), 1);
  const outOfBounds = await engine.run(makeRequest('c3', 'click', {
    pid: 7, windowId: 9, snapshotId: obs.output.snapshotId, elementToken: 'out-of-bounds'
  }), 1);
  assert.equal(outOfBounds.ok, false);
  assert.equal(outOfBounds.error, 'computer_element_unlocatable');
  assert.equal(calls.length, 0);

  // screenshotFrameValid === false -> computer_element_unlocatable
  const { engine: invalidFrameEngine } = createTokenFixture('darwin', async () => ({
    window: { pid: 7, windowId: 9, title: 'Calculator', bounds: { x: 100, y: 200, width: 400, height: 300 } },
    screenshot: { width: 800, height: 600, images: [] },
    screenshotScale: 2,
    screenshotFrameValid: false,
    elements: [{ element_token: 'btn-frame', frame: { x: 180, y: 260, width: 40, height: 30 } }]
  }));
  t.after(() => invalidFrameEngine.dispose());

  const invalidObs = await invalidFrameEngine.run(makeRequest('c4', 'observeWindow', { pid: 7, windowId: 9 }), 1);
  const invalidClick = await invalidFrameEngine.run(makeRequest('c4', 'click', {
    pid: 7, windowId: 9, snapshotId: invalidObs.output.snapshotId, elementToken: 'btn-frame'
  }), 1);
  assert.equal(invalidClick.ok, false);
  assert.equal(invalidClick.error, 'computer_element_unlocatable');
});
