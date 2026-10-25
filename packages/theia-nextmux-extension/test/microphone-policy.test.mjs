import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDesktopPlatform,
  getMicrophoneSettingsStrategy,
  probeMicrophoneCapability,
  requestMicrophoneAccess,
  selectSpeechRecognitionEngine,
  startMicrophoneTest
} from '../lib/browser/nextmux-microphone-policy.js';

const audioDevice = { deviceId: 'mic-1', groupId: 'group-1', kind: 'audioinput', label: 'Desk microphone' };

const mediaDevices = ({ devices = [audioDevice], getUserMedia } = {}) => ({
  enumerateDevices: async () => devices,
  getUserMedia: getUserMedia ?? (async () => streamWithStops([]))
});

const streamWithStops = stops => ({
  getTracks: () => [{ stop: () => stops.push('track') }]
});

const namedError = name => Object.assign(new Error(name), { name });

class LifecycleTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
}

test('capability probing distinguishes every user-actionable microphone state', async () => {
  assert.equal((await probeMicrophoneCapability({})).status, 'unsupported');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    permissionQuery: async () => 'prompt'
  })).status, 'prompt');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    permissionQuery: async () => 'granted'
  })).status, 'granted');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    permissionQuery: async () => 'denied'
  })).status, 'denied');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    systemPermission: { status: 'restricted' }
  })).status, 'system-blocked');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    systemPermission: { status: 'denied' }
  })).status, 'system-blocked');

  assert.equal((await probeMicrophoneCapability({
    mediaDevices: mediaDevices({ devices: [] }),
    permissionQuery: async () => 'granted'
  })).status, 'device-missing');

  const deniedWithDevices = await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    permissionQuery: async () => 'denied'
  });
  assert.equal(deniedWithDevices.status, 'denied');
  assert.equal(deniedWithDevices.devices.length, 2);

  const browserDeniedOverSystemGranted = await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    systemPermission: { status: 'granted' },
    permissionQuery: async () => 'denied'
  });
  assert.equal(browserDeniedOverSystemGranted.status, 'denied');
  assert.equal(browserDeniedOverSystemGranted.devices.length, 2);

  const systemGrantedOverPrompt = await probeMicrophoneCapability({
    mediaDevices: mediaDevices(),
    systemPermission: { status: 'granted' },
    permissionQuery: async () => 'prompt'
  });
  assert.equal(systemGrantedOverPrompt.status, 'granted');
  assert.equal(systemGrantedOverPrompt.devices.length, 2);
});

test('requesting access maps failures, retries stale deviceIds with default constraints, and always releases the probe stream', async () => {
  const stops = [];
  const granted = await requestMicrophoneAccess({
    mediaDevices: mediaDevices({ getUserMedia: async () => streamWithStops(stops) }),
    requestSystemPermission: async () => ({ status: 'granted' })
  });
  assert.equal(granted.status, 'granted');
  assert.deepEqual(stops, ['track']);

  const constraintsSeen = [];
  const fallbackGranted = await requestMicrophoneAccess({
    deviceId: 'stale-mic-id',
    mediaDevices: mediaDevices({
      getUserMedia: async constraints => {
        constraintsSeen.push(constraints);
        if (typeof constraints?.audio === 'object' && constraints.audio?.deviceId) {
          throw namedError('OverconstrainedError');
        }
        return streamWithStops(stops);
      }
    }),
    requestSystemPermission: async () => ({ status: 'granted' })
  });
  assert.equal(fallbackGranted.status, 'granted');
  assert.equal(constraintsSeen.length, 2);

  assert.equal((await requestMicrophoneAccess({
    mediaDevices: mediaDevices({ getUserMedia: async () => { throw namedError('NotAllowedError'); } })
  })).status, 'denied');

  assert.equal((await requestMicrophoneAccess({
    mediaDevices: mediaDevices({ getUserMedia: async () => { throw namedError('SecurityError'); } })
  })).status, 'system-blocked');

  assert.equal((await requestMicrophoneAccess({
    mediaDevices: mediaDevices({ getUserMedia: async () => { throw namedError('NotFoundError'); } })
  })).status, 'device-missing');
});

test('platform classification and settings guidance cover supported desktop variants without promising a bypass', () => {
  const cases = [
    [{ platform: 'win32', osRelease: '10.0.19045', arch: 'x64' }, 'windows-10', 'ms-settings:privacy-microphone', '隐私'],
    [{ platform: 'win32', osRelease: '10.0.22631', arch: 'arm64' }, 'windows-11', 'ms-settings:privacy-microphone', '隐私和安全性'],
    [{ platform: 'darwin', arch: 'x64' }, 'macos-intel', 'x-apple.systempreferences:', 'Intel'],
    [{ platform: 'darwin', arch: 'arm64' }, 'macos-apple-silicon', 'x-apple.systempreferences:', 'Apple Silicon']
  ];

  for (const [input, expectedPlatform, uriPrefix, copyFragment] of cases) {
    const platform = classifyDesktopPlatform(input);
    const strategy = getMicrophoneSettingsStrategy(platform, 'denied', true);
    assert.equal(platform, expectedPlatform);
    assert.ok(strategy.settingsUri?.startsWith(uriPrefix));
    assert.match(strategy.instructions, new RegExp(copyFragment));
    assert.match(strategy.permissionBoundary, /不能.*绕过|无法.*绕过/);
    assert.equal(strategy.canRequestAgain, true);
    assert.equal(strategy.restartRequired, expectedPlatform.startsWith('macos'));
  }
});

test('an aborted pending microphone test releases a late stream and never creates a worker', async () => {
  let resolveStream;
  const pendingStream = new Promise(resolve => { resolveStream = resolve; });
  const stops = [];
  let workers = 0;
  const abortController = new AbortController();

  const starting = startMicrophoneTest({
    mediaDevices: mediaDevices({ getUserMedia: () => pendingStream }),
    signal: abortController.signal,
    createWorker: () => {
      workers += 1;
      return { terminate() {} };
    }
  });
  abortController.abort();
  resolveStream(streamWithStops(stops));

  await assert.rejects(starting, error => error.name === 'AbortError');
  assert.deepEqual(stops, ['track']);
  assert.equal(workers, 0);
});

test('leaving the page immediately stops every track and worker and cleanup is idempotent', async () => {
  const stops = [];
  const lifecycleTarget = new LifecycleTarget();
  let workerTerminations = 0;
  const session = await startMicrophoneTest({
    mediaDevices: mediaDevices({ getUserMedia: async () => ({
      getTracks: () => [
        { stop: () => stops.push('audio') },
        { stop: () => stops.push('auxiliary') }
      ]
    }) }),
    lifecycleTarget,
    createWorker: () => ({ terminate: () => { workerTerminations += 1; } })
  });

  lifecycleTarget.dispatch('pagehide');
  assert.deepEqual(stops, ['audio', 'auxiliary']);
  assert.equal(workerTerminations, 1);
  assert.equal(session.active, false);

  session.cancel();
  assert.deepEqual(stops, ['audio', 'auxiliary']);
  assert.equal(workerTerminations, 1);
});

test('cancellation during worker creation terminates the new worker and rejects startup', async () => {
  const stops = [];
  let workerTerminations = 0;
  const abortController = new AbortController();
  const starting = startMicrophoneTest({
    mediaDevices: mediaDevices({ getUserMedia: async () => streamWithStops(stops) }),
    signal: abortController.signal,
    createWorker: () => {
      abortController.abort();
      return { terminate: () => { workerTerminations += 1; } };
    }
  });

  await assert.rejects(starting, error => error.name === 'AbortError');
  assert.deepEqual(stops, ['track']);
  assert.equal(workerTerminations, 1);
});

test('engine selection is local/cloud pluggable and never downloads a model on the UI path', async () => {
  let prepareCalls = 0;
  const local = {
    id: 'local-small',
    execution: 'local',
    readiness: async () => 'download-required',
    prepare: async () => { prepareCalls += 1; },
    start: async () => { throw new Error('not selected'); }
  };
  const cloud = {
    id: 'cloud-streaming',
    execution: 'cloud',
    readiness: async () => 'ready',
    start: async () => ({ cancel() {} })
  };

  const selected = await selectSpeechRecognitionEngine([local, cloud], ['local-small', 'cloud-streaming']);
  assert.equal(selected, cloud);
  assert.equal(prepareCalls, 0);
});
