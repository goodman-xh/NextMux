import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connect,
  deviceId,
  safeEvent,
  sessionUrl,
  waitFor,
} from './managed-session-client.mjs';

class FakeSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.sent = [];
    this.closed = false;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type, value) {
    for (const listener of this.listeners.get(type) || []) listener(value);
  }

  send(frame) { this.sent.push(String(frame)); }
  close() { this.closed = true; }
}

test('sessionUrl uses websocket transport and preserves session id', () => {
  assert.equal(sessionUrl('https://platform.example///', 'session/one'), 'wss://platform.example/api/gateway/session?session=session%2Fone');
  assert.equal(sessionUrl('http://localhost:8787', 's1'), 'ws://localhost:8787/api/gateway/session?session=s1');
});

test('deviceId is injectable and never requires keychain in local tests', () => {
  assert.equal(deviceId({ env: { NEXTMUX_CANARY_DEVICE_ID: 'fixture-device-0000001' }, platform: 'linux' }), 'fixture-device-0000001');
  assert.throws(() => deviceId({ env: {}, platform: 'linux' }), /device_id_required_on_non_macos/);
  assert.equal(deviceId({ env: {}, platform: 'darwin', exec: () => 'fixture-from-keychain\n' }), 'fixture-from-keychain');
});

test('connect only opens a fake socket and collects JSON frames', async () => {
  FakeSocket.instances.length = 0;
  const result = await connect('session-1', 'fixture-device-0000001', { origin: 'https://platform.example', WebSocket: FakeSocket, timeoutMs: 100 });
  assert.equal(result.socket.url, 'wss://platform.example/api/gateway/session?session=session-1');
  assert.deepEqual(result.socket.options.headers, {
    'x-nextmux-device-id': 'fixture-device-0000001',
    'x-nextmux-session-id': 'session-1',
  });
  result.socket.emit('message', { data: JSON.stringify({ type: 'pong', taskId: 'task-1', sequence: 1 }) });
  result.socket.emit('message', { data: 'not-json' });
  assert.deepEqual(result.events, [{ type: 'pong', taskId: 'task-1', sequence: 1 }]);
});

test('waitFor observes a later frame and times out without network activity', async () => {
  const events = [];
  setTimeout(() => events.push({ type: 'session.event', taskId: 't1' }), 5);
  assert.deepEqual(await waitFor(events, event => event.taskId === 't1', 100), { type: 'session.event', taskId: 't1' });
  await assert.rejects(waitFor([], () => true, 1), /websocket_event_timeout/);
});

test('safeEvent strips prompt and response bodies while retaining protocol metadata', () => {
  const result = safeEvent({
    type: 'session.resume', taskId: 't1', sequence: 3, body: 'secret prompt and response',
    recoveryContract: { version: 1, contentRetained: false, replayable: false, providerResume: 'adapter-only' },
    event: { type: 'session.accepted', requestId: 'request-1' },
  });
  assert.deepEqual(result, {
    type: 'session.resume', taskId: 't1', sequence: 3,
    eventType: 'session.accepted', requestId: 'request-1',
    recoveryContract: { version: 1, contentRetained: false, replayable: false, providerResume: 'adapter-only' },
  });
  assert.equal(Object.hasOwn(result, 'body'), false);
});
