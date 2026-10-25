import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ComputerAutomation } = require('../computer-automation.cjs');
const { IDLE_HIDE_MS } = require('../computer-overlay.cjs');

// Only the model's (or a plugin's) own actions may light "NextMux is controlling the computer". Opening a past
// conversation, the user's clicks in a tab and passive checks must never show it (Batch 5 regression: a historical
// conversation re-checked its app tab every 15 s and kept the frame on screen with no turn running).
function fixture(t) {
  const overlay = { calls: [], activity(conversationId) { this.calls.push(['activity', conversationId]); }, end(conversationId) { this.calls.push(['end', conversationId]); } };
  const engine = new ComputerAutomation({ platform: 'darwin', overlay, view: {
    grant() {}, pointer: async () => ({ ok: true }), keys: async () => ({ ok: true }),
    snapshot: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAAA', width: 4, height: 3 }), dispose: async () => {}
  }, sdkLoader: async () => ({ create: async () => ({
    listApps: async () => [{ name: 'Editor', bundle_id: 'test.editor', launch_path: '/Applications/Editor.app', pid: 10, running: true }],
    getApp: async () => ({ name: 'Editor', getState: async () => ({}) }),
    listWindows: async () => [{ window_id: 77, is_app_target: true, bounds: { width: 800, height: 600 } }],
    observeWindow: async () => ({ elements: [], text: 'ready', screenshot: { width: 800, height: 600 } }),
    close: async () => {}
  }) }) });
  t.after(() => engine.dispose());
  const lit = () => overlay.calls.filter(([kind]) => kind === 'activity').length;
  return { engine, overlay, lit };
}

test('opening an app in a tab lights the frame only for the model or a plugin, never for checks or the user', async t => {
  const { engine, lit } = fixture(t);
  for (const options of [{}, { source: 'user' }, { source: 'passive' }, { source: 'agent', onlyIfRunning: true }, { source: 'agent', probeOnly: true },
    { onlyIfRunning: true }, { source: 'plugin', probeOnly: true }]) {
    await engine.openAppInTab('conv', 1, 'Editor', options);
    assert.equal(lit(), 0, JSON.stringify(options));
    assert.equal(engine.activeConversations.has('conv'), false, `no recent-activity record for ${JSON.stringify(options)}`);
  }
  await engine.openAppInTab('conv', 1, 'Editor', { source: 'agent' });
  assert.equal(lit(), 1);
  await engine.openAppInTab('conv-plugin', 1, 'Editor', { source: 'plugin' });
  assert.equal(lit(), 2);
});

test('the user\'s pointer, keys and the live picture never light the frame; explicit agent and plugin input does', async t => {
  const { engine, lit } = fixture(t);
  const target = { pid: 10, windowId: 77 };
  await engine.userPointer('conv', 1, { ...target, kind: 'click', x: 0.5, y: 0.5, source: 'user' });
  await engine.userPointer('conv', 1, { ...target, kind: 'click', x: 0.5, y: 0.5, restore: true });
  await engine.userKeys('conv', 1, { ...target, key: 'a', source: 'user', restore: true });
  await engine.userKeys('conv', 1, { ...target, text: 'hi', restore: true });
  await engine.captureView('conv', 1, 10, 77, 800);
  await engine.captureView('conv', 1, 10, 77, 800, { source: 'user' });
  assert.equal(lit(), 0, 'a sourceless call is not taken for the AI any more');
  await engine.userPointer('conv', 1, { ...target, kind: 'click', x: 0.5, y: 0.5, source: 'agent' });
  await engine.userKeys('conv', 1, { ...target, key: 'a', source: 'plugin' });
  await engine.captureView('conv', 1, 10, 77, 800, { source: 'agent' });
  assert.equal(lit(), 3);
});

test('after Esc the user may still reopen their tab; the AI and legacy sourceless opens stay refused', async t => {
  const { engine } = fixture(t);
  engine.userEscInterrupted.add('conv');
  assert.equal((await engine.openAppInTab('conv', 1, 'Editor', { source: 'agent' })).error, 'interrupted_by_user_esc');
  assert.equal((await engine.openAppInTab('conv', 1, 'Editor', {})).error, 'interrupted_by_user_esc');
  assert.notEqual((await engine.openAppInTab('conv', 1, 'Editor', { source: 'user' })).error, 'interrupted_by_user_esc');
  // The AI's own input after Esc is still refused, including the older shape without a source.
  assert.equal((await engine.userKeys('conv', 1, { pid: 10, windowId: 77, key: 'a', restore: true })).error, 'interrupted_by_user_esc');
});

test('releasing a conversation always takes its frame down, even when its session already closed, and the frame fades fast', async t => {
  const { engine, overlay } = fixture(t);
  assert.equal(await engine.release('never-started', 1), false);
  assert.deepEqual(overlay.calls, [['end', 'never-started']]);
  assert.equal(IDLE_HIDE_MS, 4_000);
});
