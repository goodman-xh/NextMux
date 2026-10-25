import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { SystemPermissionsList } = require('../lib/browser/nextmux-system-permissions-panel.js');
const { requestMicrophoneAccess } = require('../lib/browser/nextmux-microphone-policy.js');

function rowFixture(t, devices, callback, bridge = {}) {
  // Keep this a unit test of the real compiled event handler and its state;
  // React DOM, Electron and an actual microphone are not needed.
  const values = [];
  let index = 0;
  t.mock.method(React, 'useState', initial => {
    const slot = index++;
    if (!(slot in values)) values[slot] = initial;
    return [values[slot], next => { values[slot] = next; }];
  });
  t.mock.method(React, 'useRef', initial => {
    const slot = index++;
    if (!(slot in values)) values[slot] = { current: initial };
    return values[slot];
  });
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: devices }));
  const props = {
    locale: 'zh-CN', bridge, onRequestMicrophone: callback,
    microphoneSlot: React.createElement('select', { 'data-test': 'microphone' }),
    state: { platform: 'win32', version: 22631, items: [{ kind: 'microphone', status: 'denied', essential: true, settingsUrl: 'ms-settings:privacy-microphone' }] },
    onState(next) { props.state = next; }
  };
  const nodes = value => !value || typeof value !== 'object' ? []
    : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
  const render = () => { index = 0; return nodes(SystemPermissionsList(props)); };
  return {
    async request() { await render().find(node => node.type === 'button').props.onClick(); },
    // The pill keeps the short words every row uses; the microphone's own sentence is its hover text, and a device
    // problem (busy, missing) replaces the row's hint. Together they must state the exact situation.
    status() {
      const nodesNow = render();
      const pill = nodesNow.find(node => node.type === 'span');
      const hint = nodesNow.find(node => node.type === 'small');
      return [pill.props.children, pill.props.title, hint?.props.children].filter(Boolean).join(' · ');
    },
    pill() { return render().find(node => node.type === 'span').props.children; },
    busy() { return Boolean(render().find(node => node.type === 'button').props.disabled); },
    buttons() { return render().filter(node => node.type === 'button'); },
    setStatus(status) { props.state = { ...props.state, items: props.state.items.map(item => ({ ...item, status })) }; },
    setCaptureStatus(status) { props.microphoneStatus = status; },
    hasInlineSelect() { return render().some(node => node.type === 'select'); }
  };
}

test('the inline microphone row delegates a single capture and retries a busy device', async t => {
  let attempts = 0;
  let stops = 0;
  const devices = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default microphone' }],
    async getUserMedia() {
      if (++attempts === 1) throw Object.assign(new Error('busy'), { name: 'NotReadableError' });
      return { getTracks: () => [{ stop() { stops++; } }] };
    }
  };
  let refreshes = 0;
  const row = rowFixture(t, devices, () => requestMicrophoneAccess({ mediaDevices: devices }), {
    requestSystemPermission: () => assert.fail('the delegated probe already requests native permission'),
    async getSystemPermissions() {
      refreshes++;
      return { platform: 'win32', version: 22631, items: [{ kind: 'microphone', status: 'granted', essential: true, settingsUrl: 'ms-settings:privacy-microphone' }] };
    }
  });
  assert.equal(row.hasInlineSelect(), true);
  await row.request();
  assert.equal(attempts, 1);
  assert.match(row.status(), /占用/);
  assert.equal(row.busy(), false);
  await row.request();
  assert.equal(attempts, 2);
  assert.equal(stops, 1);
  assert.equal(refreshes, 2);
  assert.doesNotMatch(row.status(), /占用/);
});

for (const [name, message] of [
  ['NotAllowedError', /拒绝/], ['NotFoundError', /麦克风/], ['OverconstrainedError', /麦克风/]
]) {
  test(`the standalone permission row shows ${name} and releases its busy state`, async t => {
    const devices = {
      enumerateDevices: async () => [],
      getUserMedia: async () => { throw Object.assign(new Error(name), { name }); }
    };
    const row = rowFixture(t, devices);
    await row.request();
    assert.match(row.status(), message);
    assert.equal(row.busy(), false);
  });
}

test('the standalone probe stops remaining tracks when one stop throws, even if native settings fail', async t => {
  const stops = [];
  const devices = {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default' }],
    getUserMedia: async () => ({ getTracks: () => [
      { stop() { stops.push('one'); throw new Error('ended'); } }, { stop() { stops.push('two'); } }
    ] })
  };
  const row = rowFixture(t, devices, undefined, { getSystemPermissions: async () => { throw new Error('bridge unavailable'); } });
  await row.request();
  assert.deepEqual(stops, ['one', 'two']);
  assert.equal(row.busy(), false);
});


test('standalone capture does not ask twice and a successful retry is shown even without a native refresh', async t => {
  let captures = 0;
  const row = rowFixture(t, {
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'usb', label: 'USB' }],
    getUserMedia: async () => { captures++; return { getTracks: () => [] }; }
  }, undefined, { requestSystemPermission() { assert.fail('capture already asked'); } });
  await row.request();
  assert.equal(captures, 1);
  assert.match(row.status(), /已允许/);
  assert.equal(row.buttons().length, 1);
  assert.equal(row.buttons()[0].props.children, '打开系统设置');
});

test('denied capture retains a direct system settings action and a readable retry', async t => {
  let opened = 0;
  const row = rowFixture(t, {
    enumerateDevices: async () => [],
    getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }
  }, undefined, { openPermissionSettings: async kind => { assert.equal(kind, 'microphone'); opened++; return true; } });
  await row.request();
  assert.equal(row.buttons()[0].props.children, '重新请求权限');
  await row.buttons()[1].props.onClick();
  assert.equal(opened, 1);
});

test('double-clicking request cannot create two concurrent captures', async t => {
  let resolve;
  let calls = 0;
  const pending = new Promise(done => { resolve = done; });
  const row = rowFixture(t, {}, async () => { calls++; await pending; return { status: 'device-busy' }; });
  const first = row.request();
  await row.request();
  assert.equal(calls, 1);
  assert.equal(row.busy(), true);
  resolve();
  await first;
  assert.equal(row.busy(), false);
});

test('current inline capture state replaces stale errors and later native revocation clears a grant', async t => {
  const row = rowFixture(t, {}, async () => ({ status: 'device-busy' }));
  await row.request();
  assert.match(row.status(), /占用/);
  row.setCaptureStatus('granted');
  assert.match(row.status(), /已允许/);
  row.setCaptureStatus(undefined);
  row.setStatus('granted');
  assert.equal(row.pill(), '已授权');
  row.setStatus('restricted');
  assert.equal(row.pill(), '被系统限制');
  // Same vocabulary as Screen Recording and Accessibility; the busy device was a hint, not a permission state.
  row.setCaptureStatus('device-busy');
  assert.equal(row.pill(), '被系统限制');
  assert.match(row.status(), /占用/);
});

test('a thrown delegated capture error is readable and does not leave the row busy', async t => {
  const row = rowFixture(t, {}, async () => { throw Object.assign(new Error('busy'), { name: 'NotReadableError' }); });
  await row.request();
  assert.match(row.status(), /占用/);
  assert.equal(row.busy(), false);
});
