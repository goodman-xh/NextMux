import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDuration, runTransportSoak } from './p3-managed-transport-soak.mjs';

test('transport soak accepts only the bounded evidence durations', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('72h'), 259_200_000);
  assert.throws(() => parseDuration('5m'), /duration_must_be_10m_1h_or_72h/);
});

test('transport soak sends only ping frames and records pongs without billing', async () => {
  const sent = [];
  class FakeSocket {
    static instances = [];
    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      FakeSocket.instances.push(this);
      queueMicrotask(() => { this.readyState = 1; this.emit('open', {}); });
    }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    emit(type, value) { for (const listener of this.listeners.get(type) || []) listener(value); }
    send(value) {
      const frame = JSON.parse(value);
      sent.push(frame);
      if (frame.type === 'start') throw new Error('start_frame_forbidden');
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'pong', version: 1 }) }));
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', { code: 1000 }); }
  }
  const report = await runTransportSoak({
    origin: 'http://fixture.local', durationMs: 25, durationName: '10m', production: false,
    rawDevice: 'fixture-device-0000001', WebSocketCtor: FakeSocket, pingIntervalMs: 5,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.billing.providerRequests, 0);
  assert.equal(report.counters.startFrames, 0);
  assert.ok(report.counters.ping > 0);
  assert.ok(report.counters.pong > 0);
  assert.ok(sent.every(frame => frame.type === 'ping'));
});

