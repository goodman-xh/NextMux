import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RECONNECT_GRACE_MS, MAX_MANAGED_SESSION_FRAME_BYTES, ManagedGatewaySessionPool, ManagedGatewaySessionShardPool, ManagedSessionUnavailable } from '../lib/node/nextmux-managed-session.js';
import { GatewaySession, gatewaySessionLimits } from '../../../apps/cloudflare-platform/src/gateway-session.js';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class FakeSocket {
  static instances = [];
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.emit('open', {}); });
  }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
  send(raw) {
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    if (frame.type === 'start') {
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1, event: { type: 'session.accepted', taskId: frame.taskId } }) }));
      const completed = {
        type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 2,
        event: { type: 'completed', result: { call: { id: frame.taskId }, response: { content: 'ok', model: 'fixture', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } } }
      };
      queueMicrotask(() => this.emit('message', { data: JSON.stringify(completed) }));
    }
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', {}); }
}

class QuietSocket extends FakeSocket {
  send(raw) {
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
      type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1,
      event: { type: 'session.accepted', taskId: frame.taskId }
    }) }));
    if (frame.type === 'ping') queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'pong' }) }));
  }
}

for (const reason of ['client_shutdown', 'user_stop', 'exit_incognito']) test(`compatibility session ${reason} preserves explicit-stop semantics`, async () => {
  FakeSocket.instances = [];
  const signal = new AbortController();
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: QuietSocket });
  try {
    const response = await pool.openStream({ messages: [{ role: 'user', content: 'long' }] }, 'client-request-stop-0001', signal.signal);
    signal.abort(reason);
    await response.text();
    const frames = FakeSocket.instances.flatMap(socket => socket.sent);
    assert.equal(frames.filter(frame => frame.type === 'start').length, 1);
    assert.equal(frames.filter(frame => frame.type === 'cancel').length, reason === 'client_shutdown' ? 0 : 1);
  } finally { pool.close(); }
});

test('large screenshot frames select HTTP before opening or sending on a managed session', async () => {
  FakeSocket.instances = [];
  assert.equal(MAX_MANAGED_SESSION_FRAME_BYTES, gatewaySessionLimits.maxFrameBytes);
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: FakeSocket });
  await assert.rejects(pool.openStream({ messages: [{ role: 'user', attachments: [{ kind: 'image', dataBase64: 'A'.repeat(400_000) }] }] }, 'client-request-screenshot'), error => {
    assert.ok(error instanceof ManagedSessionUnavailable);
    assert.equal(error.beforeDispatch, true);
    return true;
  });
  assert.equal(pool.inFlightCount, 0);
  assert.equal(FakeSocket.instances.length, 0);
  pool.close();
});

test('the exact frame boundary uses UTF-8 bytes and leaves unrelated live tasks alone', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: QuietSocket });
  const key = 'client-request-boundary';
  const empty = { type: 'start', taskId: '00000000-0000-4000-8000-000000000001', idempotencyKey: key, body: { content: '' }, delivery: 'ack-v1' };
  const room = MAX_MANAGED_SESSION_FRAME_BYTES - Buffer.byteLength(JSON.stringify(empty));
  const response = await pool.openStream({ content: 'x'.repeat(room) }, key);
  assert.equal(Buffer.byteLength(JSON.stringify(FakeSocket.instances[0].sent[0])), MAX_MANAGED_SESSION_FRAME_BYTES);
  await assert.rejects(pool.openStream({ content: 'x'.repeat(room + 1) }, key), ManagedSessionUnavailable);
  // Fewer characters than the limit still exceed it in UTF-8.
  await assert.rejects(pool.openStream({ content: '图'.repeat(Math.floor(room / 3) + 1) }, key), ManagedSessionUnavailable);
  assert.equal(pool.inFlightCount, 1);
  assert.equal(FakeSocket.instances[0].sent.filter(frame => frame.type === 'start').length, 1);
  const taskId = FakeSocket.instances[0].sent[0].taskId;
  FakeSocket.instances[0].emit('message', { data: JSON.stringify({ type: 'session.event', sessionId: 'session', taskId, sequence: 2,
    event: { type: 'completed', result: { call: { id: 'receipt' } } } }) });
  assert.match(await response.text(), /"id":"receipt"/);
  pool.close();
});

test('100 logical starts share one authenticated WebSocket and preserve per-task sequence', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: FakeSocket, connectTimeoutMs: 500 });
  const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => pool.openStream({ messages: [{ role: 'user', content: String(index) }] }, `client-request-${String(index).padStart(8, '0')}`)));
  const bodies = await Promise.all(responses.map(response => response.text()));
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].options.headers['x-nextmux-device-id'], 'fixture-device-0000001');
  assert.equal(FakeSocket.instances[0].options.headers['x-nextmux-session-id'], pool.sessionId);
  assert.match(FakeSocket.instances[0].url, new RegExp(`session=${pool.sessionId}`));
  assert.equal(FakeSocket.instances[0].sent.filter(frame => frame.type === 'start').length, 100);
  assert.deepEqual(FakeSocket.instances[0].sent.filter(frame => frame.type === 'start').map(frame => frame.idempotencyKey), Array.from({ length: 100 }, (_, index) => `client-request-${String(index).padStart(8, '0')}`));
  for (const body of bodies) {
    const rows = body.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.sequence), [1, 2]);
    assert.equal(rows.at(-1).type, 'completed');
  }
  pool.close();
});

test('disconnect resumes the same session without sending a second start', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: class ResumeSocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1, event: { type: 'session.accepted' } }) }));
      if (frame.type === 'resume') queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'session.resume', taskId: frame.taskId, running: true, requestId: '00000000-0000-4000-8000-000000000001', lastSequence: 1, recoveryContract: { version: 1, contentRetained: false, replayable: false, providerResume: 'adapter-only' } }) }));
    }
  }, connectTimeoutMs: 500, maxReconnects: 1 });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'long' }] }, 'client-request-resume-0001');
  const first = FakeSocket.instances[0];
  first.close();
  const body = await response.text();
  assert.match(body, /BILLING_TRANSPORT_UNKNOWN/);
  const recovery = body.trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(recovery.error.recoveryContract.contentRetained, false);
  assert.equal(recovery.error.recoveryContract.replayable, false);
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(FakeSocket.instances[0].sent.filter(frame => frame.type === 'start').length, 1);
  assert.equal(FakeSocket.instances[1].sent.filter(frame => frame.type === 'start').length, 0);
  assert.equal(FakeSocket.instances[1].sent.filter(frame => frame.type === 'resume').length, 1);
  pool.close();
});

test('default reconnect policy keeps the task alive beyond three transient sockets without a lifetime cap', async () => {
  FakeSocket.instances = [];
  let socketNumber = 0;
  class GraceSocket extends FakeSocket {
    constructor(...args) {
      super(...args);
      this.number = ++socketNumber;
    }
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type === 'start') {
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({
          type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1,
          event: { type: 'session.accepted' }
        }) }));
        if (this.number <= 3) queueMicrotask(() => this.close());
      }
      if (frame.type === 'resume') {
        if (this.number <= 3) queueMicrotask(() => this.close());
        else {
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({
            type: 'session.resume', taskId: frame.taskId, running: true, live: true, lastSequence: 1
          }) }));
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({
            type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 2,
            event: { type: 'session.completed', status: 'completed' }
          }) }));
        }
      }
    }
  }
  const pool = new ManagedGatewaySessionPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: GraceSocket, connectTimeoutMs: 500
  });
  assert.equal(DEFAULT_RECONNECT_GRACE_MS, Number.POSITIVE_INFINITY);
  assert.equal(pool.reconnectGraceMs, Number.POSITIVE_INFINITY);
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'grace' }] }, 'client-request-reconnect-grace-0001');
  const body = await response.text();
  assert.match(body, /session\.completed/);
  assert.ok(socketNumber >= 4);
  assert.equal(GraceSocket.instances.flatMap(socket => socket.sent).filter(frame => frame.type === 'start').length, 1);
  assert.equal(GraceSocket.instances.flatMap(socket => socket.sent).filter(frame => frame.type === 'resume').length, socketNumber - 1);
  pool.close();
});

test('live reconnect rebinds the stream when no sequence was missed', async () => {
  FakeSocket.instances = [];
  class LiveResumeSocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
        type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1,
        event: { type: 'session.accepted' }
      }) }));
      if (frame.type === 'resume') {
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({
          type: 'session.resume', taskId: frame.taskId, running: true, live: true, lastSequence: 1,
          recoveryContract: { version: 1, contentRetained: false, replayable: false, providerResume: 'adapter-only' }
        }) }));
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({
          type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 2,
          event: { type: 'session.completed', status: 'completed' }
        }) }));
      }
    }
  }
  const pool = new ManagedGatewaySessionPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: LiveResumeSocket, connectTimeoutMs: 500, maxReconnects: 1,
  });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'live-rebind' }] }, 'client-request-live-rebind-0001');
  await wait(0);
  FakeSocket.instances[0].close();
  const body = await response.text();
  assert.match(body, /session\.completed/);
  assert.equal(FakeSocket.instances[1].sent.filter(frame => frame.type === 'start').length, 0);
  assert.equal(FakeSocket.instances[1].sent.filter(frame => frame.type === 'resume').length, 1);
  pool.close();
});

test('BYOK-shaped bodies are rejected before a managed socket is created', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: FakeSocket });
  await assert.rejects(pool.openStream({ apiKey: 'local-secret', messages: [] }, 'client-request-byok-0001'), error => error instanceof ManagedSessionUnavailable);
  assert.equal(FakeSocket.instances.length, 0);
});

test('reconnect replays missed frames once and ACKs without creating another inference', async () => {
  FakeSocket.instances = [];
  class ReplaySocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      const deliver = value => queueMicrotask(() => this.emit('message', { data: JSON.stringify(value) }));
      const event = (sequence, data) => deliver({ type: 'session.event', taskId: frame.taskId, sequence, delivery: 'ack-v1', event: data });
      if (frame.type === 'start') event(1, { type: 'session.accepted' });
      if (frame.type === 'resume') {
        assert.equal(frame.sequence, 1);
        deliver({ type: 'session.resume', taskId: frame.taskId, running: false, lastSequence: 3,
          delivery: 'ack-v1', replayFrom: 2, recoveryContract: { replayable: true, replayScope: 'live-memory' } });
        event(2, { type: 'content.delta', delta: 'missing text' });
        event(2, { type: 'content.delta', delta: 'missing text' });
        event(3, { type: 'session.completed' });
      }
    }
  }
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: ReplaySocket, connectTimeoutMs: 500 });
  try {
    const response = await pool.openStream({ input: [] }, 'client-replay-test-00001');
    await wait(0);
    FakeSocket.instances[0].close();
    const body = await response.text();
    const rows = body.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.sequence), [1, 2, 3]);
    assert.equal(rows[1].delta, 'missing text');
    const frames = FakeSocket.instances.flatMap(socket => socket.sent);
    assert.equal(frames.filter(frame => frame.type === 'start').length, 1);
    assert.equal(frames.filter(frame => frame.type === 'ack').at(-1).sequence, 3);
  } finally { pool.close(); }
});

test('desktop and gateway negotiate recovery together when provider completes during a disconnect', async () => {
  const data = new Map();
  const session = new GatewaySession({ storage: {
    async list() { return []; }, async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, structuredClone(value)); }
  }, getWebSockets() { return []; } }, {});
  let dispatches = 0;
  session.runTask = async (ws, task) => {
    dispatches++;
    ws.client.close(); // accepted reached the desktop; subsequent output did not
    session.sendTask(ws, task, { type: 'content.delta', delta: 'completed offline' });
    task.status = 'completed';
    session.sendTask(ws, task, { type: 'session.completed' });
    await session.releaseTask(task);
  };
  class BridgeSocket extends FakeSocket {
    constructor(...args) {
      super(...args);
      this.server = { client: this,
        deserializeAttachment() { return { sessionId: 'bridge-session', userId: 'owner', deviceId: 'bridge-device' }; },
        send: raw => { if (this.readyState !== 1) throw new Error('offline'); this.emit('message', { data: raw }); }
      };
    }
    send(raw) { this.sent.push(JSON.parse(raw)); void session.webSocketMessage(this.server, raw); }
    close() { session.webSocketClose(this.server); super.close(); }
  }
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: BridgeSocket, connectTimeoutMs: 500 });
  try {
    const response = await pool.openStream({ input: [{ role: 'user', content: 'private prompt' }] }, 'client-bridge-request-0001');
    const rows = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.sequence), [1, 2, 3]);
    assert.equal(rows[1].delta, 'completed offline');
    assert.equal(dispatches, 1);
    assertOnlyReplayJournalRetains(data, /completed offline/, /private prompt/);
  } finally { pool.close(); }
});

test('session terminal markers close the stream when a provider omits response.completed', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: class TerminalSocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
        type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 1,
        event: { type: 'session.accepted' }
      }) }));
      if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
        type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 2,
        event: { type: 'session.completed', status: 'completed' }
      }) }));
    }
  } });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'terminal' }] }, 'client-request-terminal-0001');
  const body = await response.text();
  assert.match(body, /session\.completed/);
  assert.equal(pool.inFlightCount, 0);
  pool.close();
});

test('the billed result after the provider response.completed still reaches the stream', async () => {
  // The gateway sends the provider's response.completed, settles billing, then sends `completed` and session.completed.
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: class OrderedSocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type !== 'start') return;
      const events = [{ type: 'session.accepted' }, { type: 'response.started' }, { type: 'content.delta', delta: 'hi' },
        { type: 'response.completed', usage: { inputTokens: 1, outputTokens: 1 } },
        { type: 'completed', result: { call: { id: frame.taskId }, response: { content: 'hi', toolCalls: [] } } },
        { type: 'session.completed', status: 'completed' }];
      events.forEach((event, index) => setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: index + 1, event }) }), index * 2));
    }
  } });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'ordered' }] }, 'client-request-ordered-00001');
  const types = (await response.text()).trim().split('\n').map(line => JSON.parse(line).type);
  assert.deepEqual(types.slice(-2), ['response.completed', 'completed'], 'the billed result frame is delivered and ends the stream');
  pool.close();
});

test('a sequence gap fails closed instead of silently reordering a billable stream', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001', WebSocket: class GapSocket extends FakeSocket {
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
        type: 'session.event', sessionId: 'session', taskId: frame.taskId, sequence: 2,
        event: { type: 'content.delta', delta: 'out of order' }
      }) }));
    }
  } });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'gap' }] }, 'client-request-gap-00001');
  const body = await response.text();
  assert.match(body, /BILLING_TRANSPORT_UNKNOWN/);
  assert.equal(pool.inFlightCount, 0);
  pool.close();
});

test('idle session heartbeat renews the lease without opening another socket', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    heartbeatMs: 5, WebSocket: FakeSocket
  });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'heartbeat' }] }, 'client-request-heartbeat-0001');
  await response.text();
  await wait(20);
  assert.equal(FakeSocket.instances.length, 1);
  assert.ok(FakeSocket.instances[0].sent.some(frame => frame.type === 'ping'));
  pool.close();
});

test('stale socket callbacks neither fail active tasks nor stop the new connection heartbeat', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: QuietSocket, connectTimeoutMs: 500, maxReconnects: 3, heartbeatMs: 10,
  });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'stale-close' }] }, 'client-request-stale-close-0001');
  const first = FakeSocket.instances[0];
  first.close();
  await wait(140);
  assert.equal(FakeSocket.instances.length, 2);
  // A provider/runtime may deliver the old generation's close callback late.
  // It must not replace or reconnect over the currently open generation.
  first.emit('close', {});
  const second = FakeSocket.instances[1];
  const heartbeats = second.sent.filter(frame => frame.type === 'ping').length;
  first.emit('message', { data: JSON.stringify({ type: 'session.error', code: 'old_socket_error' }) });
  await wait(180);
  assert.equal(FakeSocket.instances.length, 2);
  assert.equal(pool.inFlightCount, 1);
  assert.ok(second.sent.filter(frame => frame.type === 'ping').length > heartbeats);
  await response.body?.cancel();
  pool.close();
});

test('a top-level duplicate acknowledgement cannot leave a retried stream hanging', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: class DuplicateSocket extends FakeSocket {
      send(raw) {
        const frame = JSON.parse(raw);
        this.sent.push(frame);
        if (frame.type === 'start') queueMicrotask(() => this.emit('message', { data: JSON.stringify({
          type: 'session.accepted', taskId: frame.taskId, duplicate: true,
          idempotencyKey: frame.idempotencyKey, status: 'completed'
        }) }));
      }
    }
  });
  const response = await pool.openStream({ messages: [{ role: 'user', content: 'duplicate' }] }, 'client-request-duplicate-stream-01');
  const body = await response.text();
  assert.match(body, /BILLING_TRANSPORT_UNKNOWN/);
  assert.equal(pool.inFlightCount, 0);
  pool.close();
});

test('sharded pool opens two sessions at the seventeenth active task', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionShardPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: QuietSocket, maxShards: 8, connectTimeoutMs: 500,
  });
  const responses = await Promise.all(Array.from({ length: 17 }, (_, index) => pool.openStream(
    { messages: [{ role: 'user', content: String(index) }] }, `client-request-shard-${String(index).padStart(8, '0')}`
  )));
  assert.equal(responses.length, 17);
  assert.equal(pool.shardCount, 2);
  assert.deepEqual(pool.shardInFlightCounts, [16, 1]);
  assert.equal(FakeSocket.instances.length, 2);
  assert.ok(FakeSocket.instances.every(socket => socket.sent.filter(frame => frame.type === 'start').length <= 16));
  pool.close();
});

test('sharded pool opens seven sessions for one hundred active tasks and caps at maxShards', async () => {
  FakeSocket.instances = [];
  const pool = new ManagedGatewaySessionShardPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: QuietSocket, maxShards: 8, connectTimeoutMs: 500,
  });
  const responses = await Promise.all(Array.from({ length: 100 }, (_, index) => pool.openStream(
    { messages: [{ role: 'user', content: String(index) }] }, `client-request-shard-${String(index).padStart(8, '0')}`
  )));
  assert.equal(responses.length, 100);
  assert.equal(pool.shardCount, 7);
  assert.deepEqual(pool.shardInFlightCounts, [16, 16, 16, 16, 16, 16, 4]);
  assert.equal(FakeSocket.instances.length, 7);
  pool.close();

  FakeSocket.instances = [];
  const bounded = new ManagedGatewaySessionShardPool({
    baseUrl: 'https://platform.test', deviceId: async () => 'fixture-device-0000001',
    WebSocket: QuietSocket, maxShards: 1, connectTimeoutMs: 500,
  });
  const limited = await Promise.allSettled(Array.from({ length: 17 }, (_, index) => bounded.openStream(
    { messages: [{ role: 'user', content: String(index) }] }, `client-request-bounded-${String(index).padStart(8, '0')}`
  )));
  assert.equal(limited.filter(item => item.status === 'fulfilled').length, 16);
  assert.equal(limited.filter(item => item.status === 'rejected' && item.reason instanceof ManagedSessionUnavailable).length, 1);
  assert.equal(bounded.shardCount, 1);
  bounded.close();
});

// Cross-layer fault injection lives with desktop transport tests so the
// server-only suite does not require a compiled desktop extension.
const sessionId = '11111111-1111-4111-8111-111111111111';
function restartFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE inference_requests(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,idempotency_key TEXT,failure_code TEXT DEFAULT '',updated_at INTEGER,reserved_micros INTEGER,task_authority_epoch INTEGER DEFAULT 0);
    CREATE TABLE inference_attempts(id TEXT PRIMARY KEY,request_id TEXT,status TEXT,metering_source TEXT DEFAULT 'pending',reconciliation_status TEXT DEFAULT 'pending',failure_stage TEXT DEFAULT '',failure_code TEXT DEFAULT '');
    CREATE TABLE gateway_finalization_outbox(request_id TEXT PRIMARY KEY);
    CREATE TABLE gateway_wallet_finalizations(request_id TEXT PRIMARY KEY);
    CREATE TABLE gateway_response_resume_cursors(request_id TEXT,attempt_id TEXT,recovery_state TEXT,updated_at INTEGER,recovery_claimed_at INTEGER,queue_ref_json TEXT DEFAULT '');
    CREATE TABLE audit_logs(id TEXT PRIMARY KEY,actor_user_id TEXT,action TEXT,target_type TEXT,target_id TEXT,ip_hash TEXT,created_at INTEGER);
    CREATE TABLE platform_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at INTEGER);
    CREATE TABLE gateway_session_leases(user_id TEXT,session_id TEXT,PRIMARY KEY(user_id,session_id));`);
  const adapter = {
    prepare(sql) {
      let args = [];
      const statement = { bind(...next) { args = next; return statement; },
        first() { return db.prepare(sql).get(...args) || null; },
        all() { return { results: db.prepare(sql).all(...args) }; },
        run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } };
      return statement;
    },
    batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const queued = [];
  const env = { DB: adapter, SESSION_SECRET: 'restart-secret', GATEWAY_RESUME_JOBS: { async sendBatch(messages) { queued.push(...messages); } } };
  function addRequest(id = 'request', attemptStatus = 'streaming', requestStatus = 'streaming') {
    db.prepare('INSERT INTO inference_requests(id,user_id,status,idempotency_key,failure_code,updated_at,reserved_micros) VALUES(?,?,?,?,?,?,?)').run(id, 'customer', requestStatus, `idempotency-${id}-0001`, '', 1, 10_000);
    db.prepare('INSERT INTO inference_attempts(id,request_id,status) VALUES(?,?,?)').run(`attempt-${id}`, id, attemptStatus);
    db.prepare('INSERT INTO gateway_response_resume_cursors(request_id,attempt_id,recovery_state,updated_at,recovery_claimed_at) VALUES(?,?,?,?,NULL)').run(id, `attempt-${id}`, 'pending', 1);
    return { version: 1, taskId: `task-${id}`, userId: 'customer', sessionId,
      idempotencyKey: `idempotency-${id}-0001`, requestId: id, sequence: 4, status: 'running', updatedAt: 1 };
  }
  return { db, env, queued, addRequest };
}

function restartDurableState(records = []) {
  const data = new Map(records);
  const listCalls = [];
  const alarms = [];
  const state = { storage: {
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async delete(key) { data.delete(key); },
    async list(options) {
      listCalls.push(options);
      return new Map([...data].filter(([key]) => key.startsWith(options.prefix) && (!options.startAfter || key > options.startAfter))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, options.limit));
    },
    async getAlarm() { return alarms.at(-1) || null; }, async setAlarm(when) { alarms.push(when); },
  }, getWebSockets() { return []; } };
  return { state, data, listCalls, alarms };
}


async function eventually(predicate, message) {
  for (let tries = 0; tries < 100; tries++) {
    if (await predicate()) return;
    await wait(1);
  }
  assert.fail(message);
}

// The gateway deliberately keeps output in a bounded, short-lived durable replay journal so a
// reconnecting client still receives the frames it missed (gateway-session.js persistReplay /
// restoreReplay write `replay:<taskId>:<generation>:<n>` with an `expiresAt`). Everything else the
// session stores stays content-free, and the prompt itself is never written.
function assertOnlyReplayJournalRetains(store, output, prompt) {
  const entries = [...store.entries()];
  const retaining = entries.filter(([, value]) => output.test(JSON.stringify(value)));
  assert.deepEqual(retaining.map(([key]) => key).filter(key => !key.startsWith('replay:')), [], 'output lives only in the bounded replay journal');
  for (const [key, value] of retaining) assert.ok(Number.isSafeInteger(value.expiresAt), `${key} carries an expiry`);
  assert.doesNotMatch(JSON.stringify(entries.map(([, value]) => value)), prompt, 'the prompt is never persisted');
}

for (const resumable of [true, false]) {
  test(`desktop reconnect to a recreated object ends with unknown billing, not a second model/tool delivery (upstream resume ${resumable})`, async t => {
    const f = restartFixture(t);
    const s = restartDurableState();
    let session = new GatewaySession(s.state, f.env);
    await session.ready;
    const frames = [];
    const sockets = [];
    let dispatches = 0;
    let acceptedTask;
    session.runTask = async (ws, task) => {
      dispatches++;
      const row = f.addRequest();
      if (!resumable) f.db.exec('DELETE FROM gateway_response_resume_cursors');
      f.db.prepare('UPDATE inference_requests SET idempotency_key=?').run(task.idempotencyKey);
      task.requestId = row.requestId;
      session.sendTask(ws, task, { type: 'tool_call.completed', callId: 'tool-once',
        toolCall: { id: 'tool-once', name: 'write_file', arguments: { path: 'fixture.txt', content: 'private output' } } });
      await task.persist;
      acceptedTask = task;
    };
    class BridgeSocket {
      constructor() {
        this.readyState = 0;
        this.listeners = new Map();
        this.server = { deserializeAttachment: () => ({ userId: 'customer', sessionId, deviceId: 'device' }),
          send: raw => { if (this.readyState !== 1) throw new Error('offline'); this.emit('message', { data: raw }); } };
        sockets.push(this);
        queueMicrotask(() => { this.readyState = 1; this.emit('open', {}); });
      }
      addEventListener(type, listener) { this.listeners.set(type, [...this.listeners.get(type) || [], listener]); }
      emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
      send(raw) { frames.push(JSON.parse(raw)); void session.webSocketMessage(this.server, raw); }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', {}); }
    }
    const pool = new ManagedGatewaySessionPool({ baseUrl: 'https://fixture.invalid', deviceId: async () => 'device',
      WebSocket: BridgeSocket, connectTimeoutMs: 500, maxReconnects: 1 });
    t.after(() => pool.close());
    const response = await pool.openStream({ input: 'private prompt' }, `restart-bridge-request-${resumable}`);
    await eventually(() => acceptedTask, 'initial model fixture did not persist the task');
    // Replace only the object: same durable storage and D1, no replay buffer or
    // provider controller. The provider is a counter, not a paid/live service.
    session = new GatewaySession(s.state, f.env);
    session.runTask = async () => { dispatches++; };
    await session.ready;
    sockets[0].close();
    let timeout;
    const text = await Promise.race([response.text(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('desktop_hung_after_object_recreation')), 2_000);
    })]).finally(() => clearTimeout(timeout));
    const delivered = text.trim().split('\n').map(JSON.parse);
    assert.equal(delivered.filter(event => event.type === 'tool_call.completed').length, 1);
    assert.equal(delivered.at(-1).type, 'error');
    assert.equal(delivered.at(-1).error.code, 'BILLING_TRANSPORT_UNKNOWN');
    assert.equal(delivered.at(-1).error.recoveryContract.replayable, false);
    assert.equal(delivered.filter(event => event.type === 'completed').length, 0);
    assert.equal(dispatches, 1);
    assert.equal(frames.filter(frame => frame.type === 'start').length, 1);
    assert.equal(frames.filter(frame => frame.type === 'resume').length, 1);
    assert.equal(f.queued.length, resumable ? 1 : 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gateway_wallet_finalizations').get().n, 0);
    assertOnlyReplayJournalRetains(s.data, /private output|write_file/, /private prompt/);
  });
}
