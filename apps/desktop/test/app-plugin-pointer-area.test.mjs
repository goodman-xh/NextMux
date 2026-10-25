// Audit DS-06: a click point found at run time must lie in a declared click area.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import test from 'node:test';

// The injected Electron/native adapters follow apps/desktop/test/app-plugins.test.mjs.
// The package parser, manifest validator, run loop, and signal matcher are real.
const require = createRequire(import.meta.url);
const { registerAppPlugins } = require('../app-plugins.cjs');
const { writeZip } = require('../app-plugin-zip.cjs');

function bitmap(width, height, paint) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y);
    const offset = (y * width + x) * 4;
    data[offset] = b; data[offset + 1] = g; data[offset + 2] = r; data[offset + 3] = 255;
  }
  return { width, height, stride: width * 4, data };
}

const template = bitmap(16, 16, (x, y) =>
  (x - 8) ** 2 + (y - 8) ** 2 <= 36 ? [250, 200, 40] : [20, 24, 32]);
const frame = bitmap(400, 240, (x, y) =>
  (x - 200) ** 2 + (y - 120) ** 2 <= 36 ? [250, 200, 40] : [20, 24, 32]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const pluginId = 'com.example.pointer-boundary';
const baseManifest = {
  schema: 'nextmux.app-plugin/1', id: pluginId, version: '1.0.0',
  name: 'Pointer boundary', description: 'Repro', author: { name: 'Audit fixture' },
  apps: [{ platform: 'macos', bundleId: 'com.example.game' }],
  display: { width: 400, height: 240 },
  input: { modes: ['foreground'], keys: [], pointer: [] },
  perception: { tickMs: 100, signals: [{ id: 'target', type: 'template', image: 'templates/target.png', rect: [0, 0, 1, 1], threshold: 0.9, max: 1 }] },
  actions: { click_target: { label: 'Click target', steps: [{ click: 'signal:target' }] } },
  reflexes: [{ when: 'target.found', do: 'click_target' }]
};

async function runWithPointerArea(t, pointerRegion) {
  const manifest = { ...baseManifest, input: { ...baseManifest.input, pointer: [{ id: 'corner', rect: pointerRegion }] } };
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-plugin-pointer-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const zipPath = join(directory, 'plugin.nmxplugin');
  await writeFile(zipPath, writeZip([
    ['plugin.json', Buffer.from(JSON.stringify(manifest))],
    ['templates/target.png', png]
  ]));

  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const sender = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false, send: () => {} });
  const event = { sender, senderFrame: {} };
  const pointers = [];
  const nativeImage = {
    createFromBuffer: buffer => {
      const image = buffer.equals(png) ? template : undefined;
      return { isEmpty: () => !image, getSize: () => ({ width: image.width, height: image.height }), toBitmap: () => image.data };
    },
    createFromBitmap: () => ({ resize() { return this; }, toJPEG: () => Buffer.from('jpeg') })
  };
  const plugins = registerAppPlugins({
    ipcMain, app: { getPath: () => directory, getVersion: () => '2.0.0' },
    shell: { trashItem: async path => rm(path, { recursive: true, force: true }) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [zipPath] }) },
    BrowserWindow: { fromWebContents: () => ({}) }, nativeImage,
    view: { canView: () => true, frame: async () => ({ ok: true, ...frame }) },
    trusted: () => true, platform: 'darwin', identify: async () => ({ bundleId: 'com.example.game' }),
    input: { keys: async () => ({ ok: true }), pointer: async (...args) => { pointers.push(args[4]); return { ok: true }; } }
  });
  t.after(() => plugins.dispose());
  const call = (name, ...args) => handlers.get(name)(event, ...args);

  const inspected = await call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal((await call('nextmux:plugins:install', inspected.token)).ok, true);
  assert.equal((await call('nextmux:plugins:configure', pluginId, { model: { source: 'nextmux', model: 'fixture/model' } })).ok, true);
  assert.equal((await call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId })).ok, true);
  const deadline = Date.now() + 1500;
  while (!pointers.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  return pointers;
}

test('a template click found outside every declared click area is never sent', async t => {
  assert.deepEqual(await runWithPointerArea(t, [0, 0, 0.05, 0.05]), []);
});

test('a template click found inside a declared click area is sent there', async t => {
  const [point] = await runWithPointerArea(t, [0.4, 0.4, 0.2, 0.2]);
  assert.ok(point && point.x >= 0.4 && point.x <= 0.6 && point.y >= 0.4 && point.y <= 0.6, JSON.stringify(point));
});
