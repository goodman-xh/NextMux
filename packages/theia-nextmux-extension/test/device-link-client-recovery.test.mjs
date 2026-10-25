import assert from 'node:assert/strict';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const firstRequestId = 'desktop-link-request-0001';
const rotatedRequestId = 'desktop-link-request-0002';

class DeviceLinkProbeService extends NextMuxPlatformServiceImpl {
  constructor(storage, responses = []) {
    super();
    this.storage = storage;
    this.responses = [...responses];
    this.calls = [];
  }

  async readDeviceLinkRequestId() {
    return this.storage.value;
  }

  async writeDeviceLinkRequestId(value) {
    this.storage.value = value;
  }

  async clearDeviceLinkRequestId() {
    this.storage.value = null;
  }

  async request(pathname, options = {}) {
    this.calls.push({ pathname, requestId: options.body?.requestId });
    const response = this.responses.shift();
    if (response) return response;
    return {
      linked: true,
      wallets: [],
    };
  }
}

test('a fresh desktop service reuses the pending device-link request after restart', async () => {
  const storage = { value: firstRequestId };
  const first = new DeviceLinkProbeService(storage, [{
    code: '1234-5678',
    requestId: firstRequestId,
    verificationUrl: 'https://nextmux.app/connect-device?code=1234-5678',
    expiresAt: Date.now() + 300_000,
  }]);
  await first.startDeviceLink();

  const restarted = new DeviceLinkProbeService(storage, [{
    code: '1234-5678',
    requestId: firstRequestId,
    verificationUrl: 'https://nextmux.app/connect-device?code=1234-5678',
    expiresAt: Date.now() + 300_000,
  }]);
  await restarted.startDeviceLink();

  assert.equal(first.calls[0].requestId, firstRequestId);
  assert.equal(restarted.calls[0].requestId, firstRequestId);
  assert.equal(storage.value, firstRequestId);
});

test('a server-rotated request id replaces the persisted id', async () => {
  const storage = { value: firstRequestId };
  const service = new DeviceLinkProbeService(storage, [{
    code: '8765-4321',
    requestId: rotatedRequestId,
    verificationUrl: 'https://nextmux.app/connect-device?code=8765-4321',
    expiresAt: Date.now() + 300_000,
  }]);

  await service.startDeviceLink();

  assert.equal(service.calls[0].requestId, firstRequestId);
  assert.equal(storage.value, rotatedRequestId);
});

test('a missing or invalid id is persisted before the first network request', async () => {
  const storage = { value: 'not a valid request id' };
  let idVisibleDuringRequest = null;
  class FirstStartProbeService extends DeviceLinkProbeService {
    async request(pathname, options = {}) {
      idVisibleDuringRequest = storage.value;
      return super.request(pathname, options);
    }
  }
  const service = new FirstStartProbeService(storage, [{
    code: '2468-1357',
    requestId: firstRequestId,
    verificationUrl: 'https://nextmux.app/connect-device?code=2468-1357',
    expiresAt: Date.now() + 300_000,
  }]);

  await service.startDeviceLink();

  assert.match(idVisibleDuringRequest, /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);
  assert.equal(idVisibleDuringRequest, service.calls[0].requestId);
  assert.equal(storage.value, firstRequestId);
});

test('linked session clears the persisted pending request id', async () => {
  const storage = { value: firstRequestId };
  const service = new DeviceLinkProbeService(storage);

  const session = await service.completeDeviceLink('abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

  assert.equal(session.linked, true);
  assert.equal(storage.value, null);
});

test('polling a linked session also clears the persisted pending request id', async () => {
  const storage = { value: firstRequestId };
  const service = new DeviceLinkProbeService(storage);

  const session = await service.getDeviceSession();

  assert.equal(session.linked, true);
  assert.equal(storage.value, null);
});
