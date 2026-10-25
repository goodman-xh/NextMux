import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { microphoneText } from '../lib/browser/nextmux-microphone-locale.js';
import {
  getMicrophoneSettingsStrategy, probeMicrophoneCapability, requestMicrophoneAccess, resolveMicrophoneSelection, startMicrophoneTest
} from '../lib/browser/nextmux-microphone-policy.js';

const device = (deviceId, label = '') => ({ kind: 'audioinput', deviceId, label });
const failure = name => Object.assign(new Error(name), { name });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const media = (devices = [device('usb', 'USB microphone')]) => ({
  enumerateDevices: async () => devices,
  getUserMedia: async () => ({ getTracks: () => [] })
});

test('permission filtering is not mistaken for missing hardware; passive refresh never captures', async () => {
  for (const [permission, expected] of [['denied', 'denied'], ['prompt', 'prompt'], ['granted', 'device-missing']]) {
    const devices = media([]);
    devices.getUserMedia = () => assert.fail('passive refresh must not request access');
    assert.equal((await probeMicrophoneCapability({ mediaDevices: devices, permissionQuery: async () => permission })).status, expected);
  }
});

test('an explicit request unlocks labels and stops every track before enumerating again', async () => {
  let granted = false;
  const stops = [];
  const devices = media();
  devices.enumerateDevices = async () => {
    if (granted) assert.deepEqual(stops, ['first', 'second']);
    return [device('usb', granted ? 'USB microphone' : '')];
  };
  devices.getUserMedia = async () => {
    granted = true;
    return { getTracks: () => [
      { stop() { stops.push('first'); throw new Error('already ended'); } },
      { stop() { stops.push('second'); } }
    ] };
  };
  const before = await probeMicrophoneCapability({ mediaDevices: devices });
  assert.equal(before.status, 'prompt');
  const after = await requestMicrophoneAccess({ mediaDevices: devices, permissionQuery: async () => 'denied' });
  assert.equal(after.status, 'granted');
  assert.deepEqual(after.devices, [{ deviceId: 'default', label: '系统默认麦克风' }, { deviceId: 'usb', label: 'USB microphone' }]);
});

test('Windows role aliases and repeated IDs do not duplicate options or merge identical physical microphones', async () => {
  const result = await probeMicrophoneCapability({ mediaDevices: media([
    device('usb-a', 'USB'), device('communications', 'Communications - USB'),
    device('default'), device('usb-a', 'USB'), device('usb-b', 'USB'),
    device('default', 'Default - USB'), { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }
  ]) });
  assert.deepEqual(result.devices, [
    { deviceId: 'default', label: 'Default - USB' },
    { deviceId: 'usb-a', label: 'USB' }, { deviceId: 'usb-b', label: 'USB' }
  ]);
});

test('redacted input placeholders have one stable option and readable labels', async () => {
  const result = await probeMicrophoneCapability({ mediaDevices: media([device(''), device(''), device('default', '   ')]) });
  assert.deepEqual(result.devices.map(d => d.deviceId), ['default']);
  assert.ok(result.devices.every(d => d.label.trim()));
});

for (const [name, status, openSettings] of [
  ['NotAllowedError', 'denied', true], ['PermissionDeniedError', 'denied', true],
  ['NotFoundError', 'device-missing', false], ['OverconstrainedError', 'device-missing', false],
  ['ConstraintNotSatisfiedError', 'device-missing', false],
  ['NotReadableError', 'device-busy', false], ['TrackStartError', 'device-busy', false]
]) {
  test(`${name} remains actionable and a subsequent explicit request tries again`, async () => {
    let attempts = 0;
    const devices = media();
    devices.getUserMedia = async () => {
      if (++attempts === 1) throw failure(name);
      return { getTracks: () => [] };
    };
    const first = await requestMicrophoneAccess({ mediaDevices: devices });
    assert.equal(first.status, status);
    assert.equal(first.canRequestAgain, true);
    assert.equal(first.shouldOpenSettings, openSettings);
    assert.equal(getMicrophoneSettingsStrategy('windows-11', status).canRequestAgain, true);
    assert.equal((await requestMicrophoneAccess({ mediaDevices: devices })).status, 'granted');
    assert.equal(attempts, 2);
  });
}

test('a fresh OS grant permits retry after a previous OS denial', async () => {
  const devices = media();
  let calls = 0;
  devices.getUserMedia = async () => { calls++; return { getTracks: () => [] }; };
  assert.equal((await requestMicrophoneAccess({ mediaDevices: devices, requestSystemPermission: async () => ({ status: 'denied' }) })).status, 'system-blocked');
  assert.equal(calls, 0);
  assert.equal((await requestMicrophoneAccess({ mediaDevices: devices, requestSystemPermission: async () => ({ status: 'granted' }) })).status, 'granted');
  assert.equal(calls, 1);
});

test('default and old communications selections use unconstrained system input', async () => {
  for (const deviceId of ['', 'default', 'communications']) {
    const devices = media();
    devices.getUserMedia = async constraints => {
      assert.equal(constraints.audio.deviceId, undefined);
      return { getTracks: () => [] };
    };
    const session = await startMicrophoneTest({ mediaDevices: devices, deviceId });
    session.cancel();
  }
});

test('a disconnected selected input falls back once, but a busy or denied input never switches silently', async () => {
  for (const name of ['NotFoundError', 'OverconstrainedError', 'NotAllowedError', 'NotReadableError']) {
    const calls = [];
    const devices = media();
    devices.getUserMedia = async constraints => {
      calls.push(constraints);
      if (constraints.audio.deviceId) throw failure(name);
      return { getTracks: () => [] };
    };
    const result = await requestMicrophoneAccess({ mediaDevices: devices, deviceId: 'unplugged' });
    assert.deepEqual(calls[0].audio.deviceId, { exact: 'unplugged' });
    assert.equal(calls.length, ['NotFoundError', 'OverconstrainedError'].includes(name) ? 2 : 1);
    assert.equal(result.status, name === 'NotAllowedError' ? 'denied' : name === 'NotReadableError' ? 'device-busy' : 'granted');
  }
});

test('a missing default route does not repeat the same unconstrained request', async () => {
  for (const deviceId of ['default', 'communications']) {
    let calls = 0;
    const devices = media();
    devices.getUserMedia = async () => { calls++; throw failure('NotFoundError'); };
    assert.equal((await requestMicrophoneAccess({ mediaDevices: devices, deviceId })).status, 'device-missing');
    assert.equal(calls, 1);
  }
});

test('cancelling while native permission is pending cannot publish a stale denial', async () => {
  const pending = deferred();
  const controller = new AbortController();
  const devices = media();
  devices.getUserMedia = () => assert.fail('cancelled request must not capture');
  const request = requestMicrophoneAccess({ mediaDevices: devices, signal: controller.signal, requestSystemPermission: () => pending.promise });
  controller.abort();
  pending.resolve({ status: 'denied' });
  await assert.rejects(request, { name: 'AbortError' });
});

test('cancellation during label enumeration releases tracks and rejects the stale result', async () => {
  const pending = deferred();
  const enumerating = deferred();
  const controller = new AbortController();
  let stops = 0;
  const devices = media();
  devices.getUserMedia = async () => ({ getTracks: () => [{ stop() { stops++; } }] });
  devices.enumerateDevices = () => { enumerating.resolve(); return pending.promise; };
  const request = requestMicrophoneAccess({ mediaDevices: devices, signal: controller.signal });
  await enumerating.promise;
  assert.equal(stops, 1);
  controller.abort();
  pending.resolve([device('usb')]);
  await assert.rejects(request, { name: 'AbortError' });
});

test('an aborted pending permission capture stops a late stream', async () => {
  const pending = deferred();
  const capturing = deferred();
  const controller = new AbortController();
  let stops = 0;
  const devices = media();
  devices.getUserMedia = () => { capturing.resolve(); return pending.promise; };
  const request = requestMicrophoneAccess({ mediaDevices: devices, signal: controller.signal });
  await capturing.promise;
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  pending.resolve({ getTracks: () => [{ stop() { stops++; } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
});

test('the existing devicechange wiring preserves a present selection and falls back to the default route', async () => {
  // Exercise only the compiled widget's existing wiring; loading its full
  // Theia dependency graph requires an Electron renderer.
  const compiled = readFileSync(new URL('../lib/browser/nextmux-desktop-widget.js', import.meta.url), 'utf8');
  const wiring = compiled.match(/const refreshMicrophones = [\s\S]*?this\.toDispose\.push\([^\n]+/)[0];
  const apply = compiled.match(/\n    applyMicrophoneCapability\([\s\S]*?(?=\n    async loadMicrophones\()/)[0];
  const devices = Object.assign(new EventTarget(), media());
  const saved = new Map();
  const window = { localStorage: { setItem(key, value) { saved.set(key, value); } } };
  const widget = {
    selectedMicrophoneId: 'usb-b', toDispose: [], microphones: [], desktopLocale: 'zh-CN',
    // The compiled method reads these two module namespaces (selection and default-device label).
    ...new Function('window', 'nextmux_microphone_policy_1', 'nextmux_microphone_locale_1', `return ({ ${apply} });`)(
        window, { resolveMicrophoneSelection }, { microphoneText })
  };
  let completed;
  widget.loadMicrophones = async () => {
    const result = await probeMicrophoneCapability({ mediaDevices: devices, permissionQuery: async () => 'granted' });
    widget.applyMicrophoneCapability(result, false);
    completed.resolve();
  };
  new Function('navigator', wiring).call(widget, { mediaDevices: devices });
  for (const [list, expected] of [
    [[device('usb-a'), device('default'), device('usb-b')], 'usb-b'],
    [[device('usb-a'), device('default')], 'default']
  ]) {
    devices.enumerateDevices = async () => list;
    completed = deferred();
    devices.dispatchEvent(new Event('devicechange'));
    await completed.promise;
    assert.equal(widget.selectedMicrophoneId, expected);
    assert.equal(saved.get('nextmux.desktop.microphone.v1'), expected);
  }
  widget.toDispose[0].dispose();
  devices.enumerateDevices = () => assert.fail('disposed listener must not refresh');
  devices.dispatchEvent(new Event('devicechange'));
});


test('a browser with physical IDs only still offers one localized system route', async () => {
  const result = await probeMicrophoneCapability({ mediaDevices: media([device('usb')]), locale: 'en' });
  assert.deepEqual(result.devices, [
    { deviceId: 'default', label: 'System default microphone' },
    { deviceId: 'usb', label: 'Microphone 1' }
  ]);
});

test('saved selection survives filtered or failed enumeration, and only a complete list proves removal', async () => {
  for (const permission of ['prompt', 'denied']) {
    const filtered = await probeMicrophoneCapability({ mediaDevices: media([]), permissionQuery: async () => permission });
    assert.equal(resolveMicrophoneSelection('saved-usb', filtered), 'saved-usb');
    const redacted = await probeMicrophoneCapability({ mediaDevices: media([device('')]), permissionQuery: async () => permission });
    assert.equal(resolveMicrophoneSelection('saved-usb', redacted), 'saved-usb');
  }
  const available = await probeMicrophoneCapability({ mediaDevices: media([device('saved-usb', 'USB')]), permissionQuery: async () => 'granted' });
  assert.equal(resolveMicrophoneSelection('saved-usb', available), 'saved-usb');
  const removed = await probeMicrophoneCapability({ mediaDevices: media([]), permissionQuery: async () => 'granted' });
  assert.equal(resolveMicrophoneSelection('saved-usb', removed), 'default');
  const failed = await probeMicrophoneCapability({ mediaDevices: { ...media(), enumerateDevices: async () => { throw failure('NotReadableError'); } } });
  assert.equal(resolveMicrophoneSelection('saved-usb', failed), 'saved-usb');
  for (const saved of ['', 'default', 'communications']) assert.equal(resolveMicrophoneSelection(saved, available), 'default');
});

test('an OS grant alone cannot make a browser-filtered empty list prove missing hardware', async () => {
  const result = await probeMicrophoneCapability({ mediaDevices: media([]), systemPermission: { status: 'granted' }, permissionQuery: async () => 'prompt' });
  assert.equal(result.status, 'prompt');
  assert.equal(result.deviceListComplete, false);
  assert.equal(resolveMicrophoneSelection('saved-usb', result), 'saved-usb');
});

test('synchronous cancellation inside getUserMedia rejects and releases a late stream exactly once', async () => {
  const controller = new AbortController();
  let stops = 0;
  const pending = deferred();
  const devices = media();
  devices.getUserMedia = () => { controller.abort(); return pending.promise; };
  const request = requestMicrophoneAccess({ mediaDevices: devices, signal: controller.signal });
  await assert.rejects(request, { name: 'AbortError' });
  pending.resolve({ getTracks: () => [{ stop() { stops++; } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
});
