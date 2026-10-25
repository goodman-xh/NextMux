import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class DeviceProbe extends NextMuxPlatformServiceImpl {
  constructor({ reads = [], writeErrors = 0, delay = 0 } = {}) {
    super(); this.reads = [...reads]; this.writeErrors = writeErrors; this.delay = delay;
    this.writes = []; this.fetches = [];
    this.networkFetch = async (_url, init) => { this.fetches.push(init); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  }
  async readDeviceId() { if (this.delay) await new Promise(r => setTimeout(r, this.delay)); const v = this.reads.shift(); if (v instanceof Error) throw v; return v ?? null; }
  async writeDeviceId(value) { if (this.writeErrors-- > 0) throw new Error('keychain locked'); this.writes.push(value); }
}

test('keychain failure is retryable and identity is only written once', async () => {
  const service = new DeviceProbe({ writeErrors: 1 });
  await assert.rejects(() => service.request('/api/devices/session', { authenticated: true }), error => error.code === 'PLATFORM_OFFLINE');
  await service.request('/api/devices/session', { authenticated: true });
  assert.equal(service.writes.length, 1);
  assert.match(service.writes[0], /^desktop-/);
  assert.equal(service.fetches.length, 1);
});

test('request timeout aborts a pending keychain wait without dispatching network', async () => {
  const service = new DeviceProbe({ delay: 100 });
  await assert.rejects(() => service.request('/api/devices/session', { authenticated: true, timeoutMs: 10 }), error => error.code === 'PLATFORM_TIMEOUT');
  assert.equal(service.fetches.length, 0);
  await service.request('/api/devices/session', { authenticated: true, timeoutMs: 300 });
  assert.equal(service.fetches.length, 1);
  assert.equal(service.writes.length, 1);
});

test('caller cancellation before keychain authorization never reaches the network', async () => {
  const service = new DeviceProbe({ delay: 100 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => service.request('/api/devices/session', { authenticated: true, signal: controller.signal }), error => error.code === 'CANCELLED');
  assert.equal(service.fetches.length, 0);
});

test('concurrent authenticated requests share one device identity', async () => {
  const service = new DeviceProbe({ delay: 20 });
  await Promise.all([
    service.request('/api/a', { authenticated: true }),
    service.request('/api/b', { authenticated: true })
  ]);
  assert.equal(service.writes.length, 1);
  assert.equal(service.fetches[0].headers['x-nextmux-device-id'], service.fetches[1].headers['x-nextmux-device-id']);
});
