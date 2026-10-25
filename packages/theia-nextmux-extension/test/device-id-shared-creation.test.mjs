import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Audit DS-12: windows opened together each get a service instance in the one
// backend process. They must create one device ID and all use it.
test('windows starting together agree on one device ID and create it once', async () => {
  let persisted = null;
  const writes = [];
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  class WindowService extends NextMuxPlatformServiceImpl {
    async readDeviceId() { await tick(); return persisted; }
    async writeDeviceId(id) { await tick(); writes.push(id); persisted = id; }
  }
  const windows = [new WindowService(), new WindowService(), new WindowService()];
  const ids = await Promise.all(windows.map(window => window.deviceId()));
  assert.equal(new Set(ids).size, 1, JSON.stringify(ids));
  assert.equal(writes.length, 1);
  assert.equal(ids[0], persisted);
});

test('an existing device ID is reused and a failed keychain write does not block the next attempt', async () => {
  let persisted = 'desktop-existing';
  class Existing extends NextMuxPlatformServiceImpl {
    async readDeviceId() { return persisted; }
    async writeDeviceId() { throw new Error('must not write'); }
  }
  assert.equal(await new Existing().deviceId(), 'desktop-existing');
  persisted = null;
  let fail = true;
  class Flaky extends NextMuxPlatformServiceImpl {
    async readDeviceId() { return persisted; }
    async writeDeviceId(id) { if (fail) { fail = false; throw new Error('keychain locked'); } persisted = id; }
  }
  const service = new Flaky();
  await assert.rejects(service.deviceId(), /keychain locked/);
  const recovered = await new Flaky().deviceId();
  assert.match(recovered, /^desktop-/);
});
