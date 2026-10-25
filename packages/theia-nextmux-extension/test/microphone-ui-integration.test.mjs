import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const updater = readFileSync(fileURLToPath(new URL('../../../apps/desktop/updater.cjs', import.meta.url)), 'utf8');
const preload = readFileSync(fileURLToPath(new URL('../../../apps/desktop/nextmux-electron-preload.cjs', import.meta.url)), 'utf8');

const methodBody = name => {
  const start = widget.indexOf(`protected ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = widget.indexOf('\n    protected ', start + 16);
  return widget.slice(start, next === -1 ? widget.length : next);
};

test('opening audio settings probes passively and only an explicit action requests access', () => {
  const load = methodBody('async loadMicrophones');
  assert.match(load, /requestPermission[\s\S]*?requestMicrophoneAccess/);
  assert.match(load, /getMicrophonePermission\(\)/);
  assert.match(load, /probeMicrophoneCapability/);
  assert.match(updater, /nextmux:microphone:status/);
  assert.match(preload, /getMicrophonePermission: \(\) => ipcRenderer\.invoke\('nextmux:microphone:status'\)/);
});

test('the device picker refreshes on open and the renderer listens for hot-plug changes', () => {
  const settings = methodBody('renderSettings');
  assert.match(settings, /nmx-system-permission-mic-select[\s\S]*?onClick=\{\(\) => \{ void this\.loadMicrophones\(false\); \}\}/,
    'opening the picker must perform a passive device enumeration');
  // The picker sits in the microphone's own permission row: no 58px legacy box, no level meter or test button.
  assert.doesNotMatch(settings, /className='nmx-microphone-select'|nmx-microphone-meter|toggleMicrophoneTest/);
  assert.match(widget, /navigator\.mediaDevices\.addEventListener\('devicechange'/,
    'device changes must refresh the list without requiring a restart');
  assert.match(widget, /navigator\.mediaDevices\.removeEventListener\('devicechange'/,
    'the device-change listener must be disposed with the widget');
});

test('microphone metering updates only the meter DOM at 10 Hz and never rerenders the workspace', () => {
  const meter = methodBody('startMicrophoneMeter');
  assert.match(meter, /setInterval\(paint, 100\)/);
  assert.match(meter, /\.nmx-microphone-meter > i/);
  assert.doesNotMatch(meter, /requestAnimationFrame/);
  assert.doesNotMatch(meter, /this\.update\(\)/);
});

test('leaving system permissions settings and disposing the widget release every microphone resource', () => {
  assert.match(methodBody('selectSection'), /settingsPanel === 'system'[\s\S]*?stopMicrophoneCapture\(false\)/);
  assert.match(methodBody('openSettingsPanel'), /settingsPanel === 'system'[\s\S]*?stopMicrophoneCapture\(false\)/);
  assert.doesNotMatch(widget, /settingsButton\('audio'/);
  const stop = methodBody('stopMicrophoneCapture');
  for (const cleanup of [
    /microphoneRequestController\?\.abort\(\)/,
    /microphoneTestSession\?\.cancel\(\)/,
    /getTracks\(\)\.forEach\(track => track\.stop\(\)\)/,
    /clearInterval\(this\.microphoneMeterTimer\)/,
    /microphoneAudioContext\?\.close\(\)/
  ]) assert.match(stop, cleanup);
  assert.match(widget, /this\.toDispose\.push\(\{ dispose: \(\) => this\.stopVoiceInput\(false\) \}\)/);
});

test('desktop permission descriptors distinguish OS generation and CPU architecture', () => {
  assert.match(updater, /osRelease: os\.release\(\)/);
  assert.match(updater, /arch: process\.arch/);
  assert.match(updater, /scope: process\.platform === 'win32' \? 'desktop-apps'/);
});
