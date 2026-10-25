import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, stat, readdir, rename, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const core = require('../app-plugin-core.cjs');
const zipAdapter = require('../app-plugin-zip.cjs');
const { registerAppPlugins, normalizeModel, normalizeVision, appMatches } = require('../app-plugins.cjs');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
function bitmap(width, height, paint = () => [20, 24, 32]) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = paint(x, y); const offset = (y * width + x) * 4;
    data[offset] = b; data[offset + 1] = g; data[offset + 2] = r; data[offset + 3] = 255;
  }
  return { width, height, stride: width * 4, data };
}
// The game: a red bar (health) at the top whose length is `hp`; a yellow coin at `coinX` (fraction).
const game = ({ hp = 1, coinX = 0.2 } = {}) => bitmap(400, 240, (x, y) => {
  if (y >= 8 && y < 16 && x >= 40 && x < 40 + 320 * hp) return [224, 50, 60];
  if ((x - coinX * 400) ** 2 + (y - 100) ** 2 <= 36) return [250, 200, 40];
  return [20, 24, 32];
});
const coin = bitmap(16, 16, (x, y) => (x - 8) ** 2 + (y - 8) ** 2 <= 36 ? [250, 200, 40] : [20, 24, 32]);

const pluginJson = (overrides = {}) => JSON.stringify({
  schema: 'nextmux.app-plugin/1', id: 'com.example.coin-catcher', version: '1.0.0', name: { en: 'Coin Catcher', 'zh-CN': '接金币' },
  description: { en: 'Moves the basket under the coin.' }, author: { name: 'NextMux' }, risk: ['account-ban'],
  apps: [{ platform: 'macos', bundleId: 'com.example.game' }], display: { width: 400, height: 240 },
  input: { modes: ['foreground'], keys: ['left', 'right'] },
  perception: { tickMs: 100, signals: [
    { id: 'hp', type: 'bar', rect: [0.1, 0.04, 0.8, 0.04], color: '#e0323c', tolerance: 30 },
    { id: 'coin', type: 'template', image: 'templates/coin.png', rect: [0, 0.2, 1, 0.8], threshold: 0.9, max: 1 }] },
  actions: { left: { label: 'Left', steps: [{ key: 'left', holdMs: 60 }] }, right: { label: 'Right', steps: [{ key: 'right', holdMs: 60 }] }, wait: { label: 'Wait', steps: [{ wait: 10 }] } },
  reflexes: [{ when: 'hp < 0.3', do: 'wait' }],
  decisions: [{ id: 'next', type: 'choice', everyMs: 200, question: 'Which way?', options: ['left', 'right', 'wait'], fallback: 'wait' }],
  events: [{ id: 'lost', when: 'not coin', message: 'The coin is gone', pause: true }],
  ...overrides
});

test('legacy remote image flags are recalculated without changing the saved route or vision helper', () => {
  for (const source of ['nextmux', 'connection']) {
    const saved = { source, model: 'typesafe/jev-1.13', images: true, ...(source === 'nextmux' ? { offeringId: 'offering-1', merchant: 'Seller' } : { connectionId: 'conn-1' }) };
    assert.deepEqual(normalizeModel(saved), { ...saved, images: false });
  }
  const helper = { source: 'connection', model: 'vision-model', connectionId: 'vision-1' };
  assert.deepEqual(normalizeVision(helper), helper);
});

test('saved Tev selections are retained but incompatible plugins are blocked before a run starts', async t => {
  const h = await harness(t, { frames: [game()] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  await h.call('nextmux:plugins:install', inspected.token);
  const chosen = { source: 'nextmux', model: 'togethercomputer/tev1-4b-experimental', offeringId: 'tev-offering' };
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: chosen });
  const plugin = (await h.call('nextmux:plugins:list', 'en'))[0];
  assert.equal(plugin.model.model, chosen.model); assert.equal(plugin.model.offeringId, chosen.offeringId);
  assert.equal(plugin.ready, false); assert.equal(plugin.modelCompatibilityError, 'decision_choice_only');
  assert.equal(plugin.summary.decisions[0].optionCount, 3); assert.equal(plugin.summary.decisions[0].minConfidence, 0.3);
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  assert.equal(started.error, 'decision_choice_only'); assert.ok(!h.sent.some(message => message.type === 'decide'));
});

async function harness(t, { frames, identity = { bundleId: 'com.example.game' }, packageFiles, platform = 'darwin', recognizeText, onKey, onPointer, onTrash, onDialog, capabilities, identify, viewReady, folder, secureStorage, licensePublicKey, directory: shared, incognito } = {}) {
  const directory = shared || await mkdtemp(join(tmpdir(), 'nextmux-plugins-test-'));
  if (!shared) t.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const trashed = [];
  const sent = [];
  const destroyed = [];
  const sender = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false, send: (channel, message) => sent.push(message) });
  const once = sender.once.bind(sender);
  sender.once = (name, callback) => { destroyed.push(callback); return once(name, callback); };
  const event = { sender, senderFrame: {} };
  const images = new Map([[PNG.toString('hex'), coin]]);
  const nativeImage = {
    createFromBuffer: buffer => { const image = images.get(buffer.toString('hex')); return { isEmpty: () => !image, getSize: () => ({ width: image.width, height: image.height }), toBitmap: () => image.data, resize: () => ({ toDataURL: () => 'data:image/png;base64,AA' }) }; },
    createFromBitmap: () => ({ resize() { return this; }, toJPEG: () => Buffer.from('jpeg') })
  };
  let frameIndex = 0;
  const keys = [];
  const pointers = [];
  const inputCalls = [];
  const userInputCalls = [];
  const frameCalls = [];
  const view = {
    ...(viewReady ? { ready: viewReady } : {}),
    canView: () => true,
    setUserInput: (...args) => { userInputCalls.push(args); return { ok: true }; },
    frame: async (...args) => { frameCalls.push(args); const value = frames[Math.min(frameIndex++, frames.length - 1)]; return { ok: true, ...value }; },
    recognizeText: recognizeText || (async () => ({ ok: false }))
  };
  const zipPath = join(directory, 'coin.nmxplugin');
  await writeFile(zipPath, zipAdapter.writeZip(packageFiles || [['plugin.json', Buffer.from(pluginJson())], ['templates/coin.png', PNG], ['README.md', Buffer.from('# Coin')]]));
  const plugins = registerAppPlugins({
    ipcMain, app: { getPath: () => directory, getVersion: () => '2.0.0' },
    shell: { trashItem: async path => { trashed.push(path); if (onTrash) return onTrash(path); await rm(path, { recursive: true, force: true }); } },
    dialog: { showOpenDialog: async (_owner, options) => onDialog ? onDialog(options) : ({ canceled: false, filePaths: [options?.properties?.includes('openDirectory') && folder ? folder : zipPath] }) },
    BrowserWindow: { fromWebContents: () => ({}) }, nativeImage, view, trusted: () => true, platform, incognito,
    identify: identify || (async () => identity),
    input: { capabilities, keys: async (...args) => { keys.push(args[4]); inputCalls.push({ key: args[4] }); return onKey ? onKey(args[4]) : { ok: true }; },
      pointer: async (...args) => { pointers.push(args[4]); inputCalls.push({ pointer: args[4] }); return onPointer ? onPointer(args[4]) : { ok: true }; } },
    ...(secureStorage !== undefined ? { secureStorage } : {}), ...(licensePublicKey ? { licensePublicKey } : {})
  });
  t.after(() => plugins.dispose());
  const call = (name, ...args) => handlers.get(name)(event, ...args);
  const wait = async (predicate, ms = 3000) => { const until = Date.now() + ms; while (!predicate()) { if (Date.now() > until) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } };
  // The page's side of a decision: answer every request with `choice`.
  const answer = choice => { for (const message of sent.filter(item => item.type === 'decide' && !item.answered)) { message.answered = true; void call('nextmux:plugins:answer', message.requestId, { ok: true, payload: { answers: { next: { choice, confidence: 0.9 } } }, costUsd: 0.001 }); } };
  return { directory, call, sent, keys, pointers, inputCalls, userInputCalls, frameCalls, trashed, wait, answer, destroyed, plugins, sender };
}

test('install: a package is checked and shown before anything is written; confirmed, it is listed and needs a model', async t => {
  const h = await harness(t, { frames: [game()] });
  const inspected = await h.call('nextmux:plugins:inspect', 'zh-CN');
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.summary.name, '接金币');
  assert.deepEqual(inspected.summary.risk, ['account-ban']);
  assert.deepEqual(await h.call('nextmux:plugins:list', 'en'), [], 'nothing installed before the user confirms');
  assert.equal((await h.call('nextmux:plugins:install', 'not-a-token')).error, 'install_expired');
  assert.deepEqual(await h.call('nextmux:plugins:install', inspected.token), { ok: true, id: 'com.example.coin-catcher' });
  assert.equal((await h.call('nextmux:plugins:install', inspected.token)).error, 'install_expired', 'a token installs once');
  const [info] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(info.ok, true);
  assert.equal(info.ready, false, 'no model yet');
  assert.equal(info.readme, '# Coin');
  assert.equal((await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: info.id })).error, 'plugin_model_required');
  assert.equal((await h.call('nextmux:plugins:configure', info.id, { model: { source: 'local', model: 'openjev-latest', endpoint: 'http://example.com:8080' } })).error, 'model_invalid', 'local means this computer');
  assert.equal((await h.call('nextmux:plugins:configure', info.id, { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } })).ok, true);
  assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].ready, true);
  // Updating goes through the same check; uninstalling moves the folder to the Trash.
  const again = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(again.installedVersion, '1.0.0');
  assert.equal((await h.call('nextmux:plugins:uninstall', info.id)).ok, true);
  assert.equal(h.trashed.length, 1);
  assert.match(h.trashed[0], /installed[\\/]com\.example\.coin-catcher$/);
});

test('a marketplace download installs through the same check, only as the plugin and version chosen there', async t => {
  const h = await harness(t, { frames: [game()] });
  const bytes = zipAdapter.writeZip([['plugin.json', Buffer.from(pluginJson())], ['templates/coin.png', PNG]]).toString('base64');
  const wrong = await h.call('nextmux:plugins:inspect-bytes', 'en', bytes, { id: 'com.example.coin-catcher', version: '2.0.0', verified: true });
  assert.deepEqual(wrong.errors, ['package_identity_mismatch'], 'a download must be the version the marketplace listed');
  const inspected = await h.call('nextmux:plugins:inspect-bytes', 'en', bytes, { id: 'com.example.coin-catcher', version: '1.0.0', verified: true });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.verified, true);
  assert.equal(inspected.fromMarket, true);
  await h.call('nextmux:plugins:install', inspected.token);
  const [info] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(info.verified, true, 'the card shows it was reviewed');
  assert.equal((await h.call('nextmux:plugins:inspect-bytes', 'en', 'not base64 zip', { id: 'com.example.coin-catcher', version: '1.0.0' })).ok, false);
});

test('a broken package is refused with the reasons; nothing is installed', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: [['plugin.json', Buffer.from(pluginJson({ decisions: [{ id: 'next', type: 'choice', question: 'x', options: ['fly'] }] }))], ['templates/coin.png', PNG]] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, false);
  assert.match(inspected.errors.join('\n'), /decisions\[0\]\.options/);
  assert.equal(inspected.token, undefined);
});

test('a run: the model decides, the key goes to the tab window; a reflex fires without a model; events pause; stop ends it', async t => {
  const h = await harness(t, { frames: [game({ coinX: 0.2 }), game({ coinX: 0.2 }), game({ coinX: 0.2 })] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  assert.equal((await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' }, )).ok, true);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  assert.equal(request.model.model, 'typesafe/jev-1.13');
  assert.match(request.state, /coin 1 found \(nearest at x 0\.2/);
  assert.deepEqual(Object.keys(request.questions), ['next']);
  h.answer('left');
  await h.wait(() => h.keys.length > 0);
  assert.equal(h.keys[0].signal.aborted, false);
  const { signal: _signal, ...pressed } = h.keys[0];
  assert.deepEqual(pressed, { key: 'left', modifiers: [], holdMs: 60, keepFront: true }, 'foreground plugins keep the game in front');
  const [run] = await h.call('nextmux:plugins:runs');
  assert.equal(run.actions >= 1, true);
  assert.ok(run.costUsd >= 0.001);
  assert.equal((await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' })).error, 'plugin_already_running');
  const stopped = await h.call('nextmux:plugins:stop', run.runId);
  assert.equal(stopped.reason, 'stopped');
  assert.ok(h.sent.some(item => item.type === 'ended' && item.runId === run.runId));
  const logs = await readdir(join(h.directory, 'app-plugins', 'logs'));
  assert.deepEqual(logs, [`${run.runId}.json`], 'every run leaves a log');
});

test('reflexes and events: low health waits without asking; a lost coin pauses and reports; dry runs send nothing', async t => {
  const h = await harness(t, { frames: [game({ hp: 0.2, coinX: 0.5 }), game({ hp: 0.2, coinX: 0.5 }), bitmap(400, 240)] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher', dryRun: true, goal: 'Catch 5' });
  await h.wait(() => h.sent.some(item => item.type === 'event' && item.id === 'lost'));
  const event = h.sent.find(item => item.type === 'event');
  assert.equal(event.message, 'The coin is gone');
  assert.equal(event.pause, true);
  assert.equal(h.keys.length, 0, 'a dry run never sends input');
  const status = await h.call('nextmux:plugins:status', started.runId);
  assert.equal(status.paused, true);
  assert.equal(status.lastAction?.action, 'wait', 'the reflex acted (recorded) while health was low');
  assert.equal(status.lastAction?.by, 'reflex');
  assert.equal(h.sent.some(item => item.type === 'decide'), false, 'no model call while a reflex handles it');
  const resumed = await h.call('nextmux:plugins:command', started.runId, { goal: 'Catch 10', resume: true });
  assert.equal(resumed.goal, 'Catch 10');
  assert.equal(resumed.paused, false);
});

test('limits: a plugin only runs on its own app; a spent budget stops it; the model setting is strict', async t => {
  const other = await harness(t, { frames: [game()], identity: { bundleId: 'com.other.app' } });
  const inspected = await other.call('nextmux:plugins:inspect', 'en');
  await other.call('nextmux:plugins:install', inspected.token);
  await other.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const refused = await other.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  assert.equal(refused.error, 'plugin_app_mismatch');
  assert.equal(refused.app, 'com.other.app');

  const h = await harness(t, { frames: [game({ coinX: 0.8 })] });
  const package2 = await h.call('nextmux:plugins:inspect', 'en');
  await h.call('nextmux:plugins:install', package2.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher', maxCostUsd: 0.0015 });
  for (let round = 0; round < 4 && !h.sent.some(item => item.type === 'ended'); round++) {
    await h.wait(() => h.sent.some(item => item.type === 'ended' || item.type === 'decide' && !item.answered));
    h.answer('right');
  }
  await h.wait(() => h.sent.some(item => item.type === 'ended'));
  assert.equal(h.sent.find(item => item.type === 'ended').reason, 'cost_limit');
  assert.equal((await h.call('nextmux:plugins:status', started.runId)).ended, true);

  assert.deepEqual(normalizeModel({ source: 'local', model: 'openjev-latest', endpoint: 'http://127.0.0.1:8080/v1', images: true }), { source: 'local', model: 'openjev-latest', images: true, endpoint: 'http://127.0.0.1:8080', protocol: 'systemone' });
  assert.deepEqual(normalizeModel({ source: 'local', model: 'qwen2.5vl:7b', endpoint: 'http://localhost:11434', protocol: 'ollama', images: true }),
    { source: 'local', model: 'qwen2.5vl:7b', images: true, endpoint: 'http://localhost:11434', protocol: 'ollama' }, 'Ollama tags carry a colon');
  assert.deepEqual(normalizeModel({ source: 'connection', model: 'typesafe/jev-1.13', connectionId: 'conn-1', connectionLabel: 'My relay', key: 'never kept' }),
    { source: 'connection', model: 'typesafe/jev-1.13', images: false, connectionId: 'conn-1', connectionLabel: 'My relay' });
  assert.equal(normalizeModel({ source: 'connection', model: 'typesafe/jev-1.13' }), undefined, 'a connection model names its connection');
  assert.equal(normalizeModel({ source: 'openrouter', model: 'typesafe/jev-1.13' }), undefined, 'the old source asks again');
  assert.deepEqual(normalizeVision({ source: 'local', model: 'llava:7b', endpoint: 'http://127.0.0.1:11434', protocol: 'ollama' }), { source: 'local', model: 'llava:7b', endpoint: 'http://127.0.0.1:11434', protocol: 'ollama' });
  assert.equal(normalizeVision({ source: 'local', model: 'llava', endpoint: 'https://example.com' }), undefined);
  assert.equal(normalizeModel({ source: 'local', model: 'x', endpoint: 'http://10.0.0.2:8080' }), undefined);
  assert.equal(normalizeModel({ source: 'cloud', model: 'x' }), undefined);
  const manifest = core.validateManifest(JSON.parse(pluginJson({ apps: [{ platform: 'macos', bundleId: 'com.apple.Safari', title: 'Coin' }, { platform: 'windows', program: 'Chrome.exe' }] })), { files: new Set(['templates/coin.png']) }).manifest;
  assert.equal(appMatches(manifest, { bundleId: 'com.apple.safari' }, 'Coin Catcher', 'darwin'), true);
  assert.equal(appMatches(manifest, { bundleId: 'com.apple.Safari' }, 'Mail', 'darwin'), false, 'the window title must match too');
  assert.equal(appMatches(manifest, { program: 'chrome' }, '', 'win32'), true);
});

test('decision failures retain presentation evidence over IPC and clear it after recovery', async t => {
  const h = await harness(t, { frames: [game()] });
  const inspected = await h.call('nextmux:plugins:inspect', 'zh-CN');
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  const readableError = { kind: 'provider_quota_exhausted', detail: 'The upstream account has insufficient credits.', source: 'relay', httpStatus: 402, code: 'insufficient_credits', relaySwitchCount: 1 };
  await h.call('nextmux:plugins:answer', request.requestId, { ok: false, error: 'upstream_balance_unavailable', readableError: { ...readableError, internal: 'must not cross IPC' } });
  const failed = await h.call('nextmux:plugins:status', started.runId);
  assert.equal(failed.error, 'upstream_balance_unavailable');
  assert.deepEqual(failed.readableError, readableError);
  assert.equal(failed.paused, false, 'one failed decision does not change the existing pause policy');
  await h.wait(() => h.sent.some(item => item.type === 'decide' && item.requestId !== request.requestId));
  h.answer('left');
  await h.wait(() => h.keys.length > 0);
  const recovered = await h.call('nextmux:plugins:status', started.runId);
  assert.equal(recovered.error, '');
  assert.equal(recovered.readableError, undefined);
});

test('vision failures reach the live plugin status and clear after a successful description', async t => {
  const manifest = JSON.parse(pluginJson());
  manifest.perception = { ...manifest.perception, vision: 'optional', visionEveryMs: 1000 };
  const h = await harness(t, { frames: [game()], packageFiles: [['plugin.json', Buffer.from(JSON.stringify(manifest))], ['templates/coin.png', PNG]] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', {
    model: { source: 'nextmux', model: 'typesafe/jev-1.13' },
    vision: { source: 'connection', model: 'vision-model', connectionId: 'vision-connection' }
  });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  await h.wait(() => h.sent.some(item => item.type === 'describe'));
  const request = h.sent.find(item => item.type === 'describe');
  const readableError = { kind: 'model_not_supported_here', detail: 'This model does not support image input.', source: 'own_api', httpStatus: 400 };
  await h.call('nextmux:plugins:answer', request.requestId, { ok: false, error: 'vision_http_400', readableError });
  await h.wait(() => h.sent.some(item => item.type === 'status' && item.error === 'vision_http_400'));
  const failed = await h.call('nextmux:plugins:status', started.runId);
  assert.deepEqual(failed.readableError, readableError);
  await h.wait(() => h.sent.some(item => item.type === 'describe' && item.requestId !== request.requestId));
  const recovery = h.sent.find(item => item.type === 'describe' && item.requestId !== request.requestId);
  await h.call('nextmux:plugins:answer', recovery.requestId, { ok: true, text: 'The coin is on the left.' });
  const recovered = await h.call('nextmux:plugins:status', started.runId);
  assert.equal(recovered.error, '');
  assert.equal(recovered.readableError, undefined);
});

async function startFixture(h, { model = { source: 'nextmux', model: 'typesafe/jev-1.13' }, ...options } = {}) {
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model });
  return h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher', ...options });
}
const packageOf = overrides => [['plugin.json', Buffer.from(pluginJson(overrides))], ['templates/coin.png', PNG]];

const slowDecisions = [{ id: 'next', type: 'choice', everyMs: 10_000, question: 'Which way?', options: ['left', 'right', 'wait'], fallback: 'wait' }];
const answerRequest = (h, request, choice = 'left') => h.call('nextmux:plugins:answer', request.requestId,
  { ok: true, costUsd: 0, payload: { answers: { next: { choice, confidence: 1 } } } });

test('Pass 2 starting, resuming and changing goals preserve the keyboard/mouse switch', async t => {
  for (const dryRun of [false, true]) {
    const h = await harness(t, { frames: [game()] });
    const { runId } = await startFixture(h, { dryRun });
    assert.deepEqual(h.userInputCalls, []);
    await h.call('nextmux:plugins:command', runId, { pause: true });
    assert.equal((await h.call('nextmux:plugins:command', runId, { goal: '   ' })).paused, true);
    assert.equal((await h.call('nextmux:plugins:command', runId, { resume: true })).paused, false);
    await h.call('nextmux:plugins:command', runId, { goal: '  New target  ' });
    assert.deepEqual(h.userInputCalls, []);
  }
});

test('Pass 2 user intervention only emits a non-blocking tip and leaves pending decisions running', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h, { locale: 'zh-CN' });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const first = h.sent.find(item => item.type === 'decide');
  h.plugins.onUserIntervention(99, 20);
  assert.equal(h.sent.some(item => item.type === 'event'), false, 'another window has no effect');
  h.plugins.onUserIntervention('10', '20');
  h.plugins.onUserIntervention(10, 20);
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.paused, false); assert.equal(status.ended, false); assert.equal(status.reason, '');
  assert.equal(h.sent.some(item => item.type === 'cancel' || item.type === 'ended'), false);
  const tip = h.sent.find(item => item.type === 'event' && item.id === 'user_input');
  assert.equal(tip.message, '键鼠已开启，你可随时介入操作，插件将继续运行');
  assert.equal(tip.pause, false); assert.equal(tip.stop, false);
  assert.equal(h.sent.filter(item => item.type === 'event' && item.id === 'user_input').length, 1, 'repeated input deduplicates tips');
  assert.ok(h.sent.some(item => item.type === 'status' && !item.paused && !item.ended));
  await answerRequest(h, first);
  await h.wait(() => h.keys.length === 1);
  assert.equal(h.keys[0].key, 'left');
  assert.deepEqual(h.userInputCalls, []);
});

test('Pass 2 user intervention preserves held input and the following action step', async t => {
  let release;
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({
    actions: { left: { steps: [{ key: 'left', holdMs: 3000 }, { key: 'right' }] }, right: { steps: [{ key: 'right' }] }, wait: { steps: [{ wait: 1 }] } }
  }), onKey: input => input.key === 'left' ? new Promise(resolve => { release = resolve; }) : { ok: true } });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide')); h.answer('left');
  await h.wait(() => h.keys.length === 1);
  h.plugins.onUserIntervention(10, 20);
  assert.equal(h.keys[0].signal.aborted, false);
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.paused, false); assert.equal(status.ended, false);
  const tip = h.sent.find(item => item.type === 'event' && item.id === 'user_input');
  assert.equal(tip.message, 'Keyboard & mouse active: you can intervene at any time while the plugin continues running.');
  release({ ok: true });
  await h.wait(() => h.keys.length === 2);
  assert.equal(h.keys[1].key, 'right');
});

test('Pass 2 rapid goal changes cancel old answers and bypass the previous decision cooldown', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h, { goal: 'Old target' });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const old = h.sent.find(item => item.type === 'decide');
  await h.call('nextmux:plugins:command', runId, { goal: 'Middle target' });
  await h.call('nextmux:plugins:command', runId, { goal: ' Final target ' });
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === old.requestId));
  await answerRequest(h, old);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  const fresh = h.sent.filter(item => item.type === 'decide')[1];
  assert.match(fresh.state, /Final target/); assert.doesNotMatch(fresh.state, /Old target|Middle target/);
  assert.equal(h.keys.length, 0);
  await answerRequest(h, fresh, 'right');
  await h.wait(() => h.keys.length === 1);
  assert.equal(h.keys[0].key, 'right');
});

test('Pass 2 an explicit resume clears the decision cooldown without changing the input switch', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  await answerRequest(h, h.sent.find(item => item.type === 'decide'));
  await h.wait(() => h.keys.length === 1);
  await h.call('nextmux:plugins:command', runId, { pause: true });
  await h.call('nextmux:plugins:command', runId, { resume: true });
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  assert.deepEqual(h.userInputCalls, []);
});

test('Pass 2 a hot model change cancels old work while invalid updates preserve the active model and run', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const old = h.sent.find(item => item.type === 'decide');
  const nextModel = { source: 'local', model: 'new-jev', protocol: 'openai', endpoint: 'http://localhost:18080' };
  assert.equal((await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: nextModel })).ok, true);
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === old.requestId));
  await answerRequest(h, old);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  assert.equal(h.sent.filter(item => item.type === 'decide')[1].model.model, 'new-jev');
  assert.equal(h.keys.length, 0);
  const invalid = await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', {
    enabled: false, model: { source: 'nextmux', model: 'typesafe/jev-1.13' }, vision: { source: 'invalid' }
  });
  assert.equal(invalid.error, 'vision_invalid');
  const [info] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(info.model.model, 'new-jev'); assert.equal(info.enabled, true);
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.ended, false); assert.equal(status.paused, false);
  const other = await h.call('nextmux:plugins:start', { conversationId: 'c2', tabId: 't2', pid: 11, windowId: 21, pluginId: info.id });
  assert.equal(other.ok, true);
  await h.call('nextmux:plugins:configure', info.id, { enabled: false });
  assert.equal((await h.call('nextmux:plugins:status', runId)).ended, false);
  assert.equal((await h.call('nextmux:plugins:status', other.runId)).ended, false);
  const disabledStart = await h.call('nextmux:plugins:start', { conversationId: 'c3', tabId: 't3', pid: 12, windowId: 22, pluginId: info.id });
  assert.equal(disabledStart.ok, true, 'legacy disable requests do not affect current or future runs');
  assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].enabled, true);
});

test('Pass 2 a late old-model receipt does not mark the newly selected model as priced', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const old = h.sent.find(item => item.type === 'decide');
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', {
    model: { source: 'connection', model: 'typesafe/jev-1.13', connectionId: 'unpriced-new-route' }
  });
  assert.equal((await h.call('nextmux:plugins:status', runId)).costStatus, 'unknown');
  await h.call('nextmux:plugins:answer', old.requestId, { ok: true, costUsd: 0.025, payload: { answers: { next: { choice: 'left', confidence: 1 } } } });
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.costStatus, 'unknown');
  assert.equal(status.costUsd, 0.025, 'a cancelled request still accounts for its actual bill');
  assert.equal(status.paused, false); assert.equal(status.ended, false); assert.equal(h.keys.length, 0);
});

test('Pass 2 null or incompatible saved models leave the current run and its existing model intact', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const first = h.sent.find(item => item.type === 'decide');
  for (const model of [null, { source: 'nextmux', model: 'togethercomputer/tev1-4b-experimental' }]) {
    assert.equal((await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model })).ok, true);
    const status = await h.call('nextmux:plugins:status', runId);
    assert.equal(status.paused, false); assert.equal(status.ended, false);
    assert.equal(h.sent.some(item => item.type === 'cancel'), false);
  }
  await answerRequest(h, first);
  await h.wait(() => h.keys.length === 1);
  await h.call('nextmux:plugins:command', runId, { goal: 'Continue' });
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  assert.equal(h.sent.filter(item => item.type === 'decide')[1].model.model, 'typesafe/jev-1.13');
});

test('Pass 2 hot vision changes supersede pending descriptions and use the new helper immediately', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions,
    perception: { vision: 'required', visionEveryMs: 60_000, visionHints: 'Describe the coin position.', tickMs: 100, signals: [] }, events: [], reflexes: []
  }) });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', {
    model: { source: 'nextmux', model: 'typesafe/jev-1.13' },
    vision: { source: 'connection', model: 'old-vision', connectionId: 'vision-1' }
  });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  assert.equal(started.ok, true, JSON.stringify(started));
  await h.wait(() => h.sent.some(item => item.type === 'describe'));
  const old = h.sent.find(item => item.type === 'describe');
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', {
    vision: { source: 'connection', model: 'new-vision', connectionId: 'vision-2' }
  });
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === old.requestId));
  await h.call('nextmux:plugins:answer', old.requestId, { ok: true, costUsd: 0, text: 'stale screen description' });
  await h.wait(() => h.sent.filter(item => item.type === 'describe').length === 2, 1000);
  const fresh = h.sent.filter(item => item.type === 'describe')[1];
  assert.equal(fresh.vision.model, 'new-vision');
  assert.equal(h.sent.some(item => item.type === 'decide'), false, 'the old description cannot unblock a decision');
  await h.call('nextmux:plugins:answer', fresh.requestId, { ok: true, costUsd: 0, text: 'current screen description' });
  await h.wait(() => h.sent.some(item => item.type === 'decide'), 1000);
  const decision = h.sent.find(item => item.type === 'decide');
  assert.match(decision.state, /current screen description/);
  assert.doesNotMatch(decision.state, /stale screen description/);
  assert.equal((await h.call('nextmux:plugins:status', started.runId)).paused, false);
});

test('Pass 2 reloading a running development plugin replaces its decisions and cancels old answers', async t => {
  const { mkdir } = await import('node:fs/promises');
  const folder = await mkdtemp(join(tmpdir(), 'nextmux-plugin-reload-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'templates'));
  await writeFile(join(folder, 'templates', 'coin.png'), PNG);
  await writeFile(join(folder, 'plugin.json'), pluginJson({ decisions: slowDecisions }));
  const h = await harness(t, { frames: [game()], folder });
  assert.equal((await h.call('nextmux:plugins:add-folder', 'Choose a plugin folder')).ok, true);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const { runId } = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const old = h.sent.find(item => item.type === 'decide');
  await writeFile(join(folder, 'plugin.json'), pluginJson({ decisions: [{ ...slowDecisions[0], question: 'Updated question?' }],
    presets: [{ id: 'new', label: 'New preset', goal: 'New goal' }], actions: {
      left: { steps: [{ key: 'right' }] }, right: { steps: [{ key: 'right' }] }, wait: { steps: [{ wait: 1 }] }
    }
  }));
  assert.equal((await h.call('nextmux:plugins:reload', 'com.example.coin-catcher')).ok, true);
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === old.requestId));
  await answerRequest(h, old);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  const fresh = h.sent.filter(item => item.type === 'decide')[1];
  assert.match(JSON.stringify(fresh.questions), /Updated question/);
  assert.equal(h.keys.length, 0);
  await answerRequest(h, fresh);
  await h.wait(() => h.keys.length === 1);
  assert.equal(h.keys[0].key, 'right', 'the reloaded action is used');
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.presets[0].id, 'new'); assert.equal(status.paused, false); assert.equal(status.ended, false);
});

test('Pass 2 rebinding and reloading read fresh OCR and frame memory on their first tick', async t => {
  const { mkdir } = await import('node:fs/promises');
  for (const change of ['rebind', 'reload']) {
    const folder = await mkdtemp(join(tmpdir(), 'nextmux-plugin-perception-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    await mkdir(join(folder, 'templates'));
    await writeFile(join(folder, 'templates', 'coin.png'), PNG);
    const manifest = JSON.parse(pluginJson({ decisions: slowDecisions, events: [], reflexes: [], perception: {
      tickMs: 100, vision: 'optional', visionEveryMs: 60_000,
      signals: [{ id: 'words', type: 'text', rect: [0, 0, 0.5, 1], everyMs: 60_000 }, { id: 'delta', type: 'change', rect: [0, 0, 1, 1] }]
    } }));
    await writeFile(join(folder, 'plugin.json'), JSON.stringify(manifest));
    let recognized = 'old launcher text';
    const regions = [];
    const h = await harness(t, { frames: [game()], folder, recognizeText: async (_frame, rects) => {
      regions.push(rects); return { ok: true, texts: [recognized] };
    } });
    assert.equal((await h.call('nextmux:plugins:add-folder', 'Choose a plugin folder')).ok, true);
    await h.call('nextmux:plugins:configure', manifest.id, {
      model: { source: 'nextmux', model: 'typesafe/jev-1.13' },
      vision: { source: 'connection', model: 'vision-model', connectionId: 'vision-connection' }
    });
    const { runId } = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: manifest.id });
    await h.wait(() => h.sent.some(item => item.type === 'decide') && h.sent.some(item => item.type === 'describe'));
    assert.match(h.sent.find(item => item.type === 'decide').state, /old launcher text/);
    const description = h.sent.find(item => item.type === 'describe');
    await h.call('nextmux:plugins:answer', description.requestId, { ok: true, text: 'old launcher description', costUsd: 0 });
    recognized = 'new target text';
    if (change === 'rebind') assert.equal(h.plugins.rebindWindow('c1', 10, 20, 11, 21), true);
    else {
      manifest.perception.signals[0].rect = [0.5, 0, 0.5, 1];
      await writeFile(join(folder, 'plugin.json'), JSON.stringify(manifest));
      assert.equal((await h.call('nextmux:plugins:reload', manifest.id)).ok, true);
    }
    assert.deepEqual((await h.call('nextmux:plugins:status', runId)).signals, {}, `${change} clears old signal presentation immediately`);
    await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
    const fresh = h.sent.filter(item => item.type === 'decide')[1];
    assert.match(fresh.state, /new target text/);
    assert.doesNotMatch(fresh.state, /old launcher text|old launcher description/);
    assert.equal(regions.length, 2, `${change} bypasses the old OCR cooldown`);
    assert.deepEqual(regions[1][0], manifest.perception.signals[0].rect);
    const status = await h.call('nextmux:plugins:status', runId);
    assert.equal(status.signals.delta, 1, `${change} starts with a fresh frame history`);
    assert.equal(status.paused, false); assert.equal(status.ended, false);
    assert.equal(h.sent.filter(item => item.type === 'describe').length, 2, `${change} refreshes the screen description immediately`);
  }
});

test('Pass 2 async startup rechecks model requirements after identification and OCR readiness', async t => {
  for (const phase of ['identify', 'ready']) for (const choice of ['null', 'incompatible', 'vision']) {
    let release, reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const deferred = () => { reached(); return new Promise(resolve => { release = resolve; }); };
    const windows = phase === 'ready';
    const h = await harness(t, { frames: [game()], platform: windows ? 'win32' : 'darwin',
      ...(windows ? { identity: { program: 'Game' }, viewReady: deferred, capabilities: { keyHold: true, chords: true, modifierKeys: true } } : { identify: deferred }),
      packageFiles: packageOf({ ...(windows ? { apps: [{ platform: 'windows', program: 'Game' }] } : {}),
        perception: { tickMs: 100, vision: choice === 'vision' ? 'required' : 'none', signals: [{ id: 'words', type: 'text', rect: [0, 0, 1, 1] }] },
        events: [], reflexes: []
      })
    });
    const initialModel = choice === 'vision' ? { source: 'local', model: 'image-jev', images: true, protocol: 'openai', endpoint: 'http://localhost:18080' }
      : { source: 'nextmux', model: 'typesafe/jev-1.13' };
    const starting = startFixture(h, { model: initialModel });
    await waiting;
    const model = choice === 'null' ? null : { source: 'nextmux', model: choice === 'incompatible' ? 'togethercomputer/tev1-4b-experimental' : 'typesafe/jev-1.13' };
    assert.equal((await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model })).ok, true);
    release(windows ? { ocr: true } : { bundleId: 'com.example.game' });
    const result = await starting;
    assert.equal(result.error, choice === 'null' ? 'plugin_model_required' : choice === 'incompatible' ? 'decision_choice_only' : 'plugin_vision_model_required', `${phase}: ${choice}`);
    assert.deepEqual(await h.call('nextmux:plugins:runs'), []);
    assert.equal(h.sent.some(item => item.type === 'decide' || item.type === 'describe'), false);
  }
});

test('Pass 2 window rebinding cancels old-window work, keeps pause state, and enforces exclusive window ownership', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({ decisions: slowDecisions }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const old = h.sent.find(item => item.type === 'decide');
  assert.equal(h.plugins.rebindWindow('wrong', 10, 20, 11, 21, 'Game'), false);
  assert.equal(h.plugins.rebindWindow('c1', 10, 20, -1, 21, 'Game'), false);
  assert.equal(h.plugins.rebindWindow('c1', 10, 20, 11, Number.MAX_SAFE_INTEGER + 1, 'Game'), false);
  assert.equal(h.plugins.rebindWindow('c1', '10', '20', '11', '21', 'Game'), true);
  const rebound = await h.call('nextmux:plugins:status', runId);
  assert.equal(rebound.pid, 11); assert.equal(rebound.windowId, 21);
  assert.equal(h.plugins.running(10, 20), false); assert.equal(h.plugins.running(11, 21), true);
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === old.requestId));
  h.plugins.stopForWindow(10, 20);
  assert.equal((await h.call('nextmux:plugins:status', runId)).ended, false);
  await answerRequest(h, old);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length === 2, 1000);
  assert.ok(h.frameCalls.some(args => args[1] === 11 && args[2] === 21));
  assert.equal(h.keys.length, 0);
  const other = await h.call('nextmux:plugins:start', { conversationId: 'c2', tabId: 't2', pid: 12, windowId: 22, pluginId: 'com.example.coin-catcher' });
  assert.equal(other.ok, true);
  assert.equal(h.plugins.rebindWindow('c1', 11, 21, 12, 22), false);
  await h.call('nextmux:plugins:command', runId, { pause: true });
  assert.equal(h.plugins.rebindWindow('c1', 11, 21, 13, 23), true);
  assert.equal((await h.call('nextmux:plugins:status', runId)).paused, true);
  h.plugins.stopForWindow(13, 23);
  assert.equal((await h.call('nextmux:plugins:status', runId)).reason, 'window_closed');
});

test('Pass 2 conversation cleanup ends all of its runs while leaving other conversations active', async t => {
  const h = await harness(t, { frames: [game()] });
  const first = await startFixture(h);
  const second = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't2', pid: 11, windowId: 21, pluginId: 'com.example.coin-catcher' });
  const other = await h.call('nextmux:plugins:start', { conversationId: 'c2', tabId: 't3', pid: 12, windowId: 22, pluginId: 'com.example.coin-catcher' });
  assert.equal(second.ok, true); assert.equal(other.ok, true);
  await h.plugins.stopForConversations(['c1']);
  assert.equal((await h.call('nextmux:plugins:status', first.runId)).ended, true);
  assert.equal((await h.call('nextmux:plugins:status', second.runId)).ended, true);
  assert.equal((await h.call('nextmux:plugins:status', other.runId)).ended, false);
});

test('app matching accepts executable paths, package families and literal window titles without losing platform or regex constraints', () => {
  const manifest = { apps: [{ platform: 'windows', program: 'Notepad', titleIncludes: '记事本' }] };
  for (const identity of [{ program: 'NOTEPAD.exe' }, { appId: 'C:\\Windows\\System32\\notepad.exe' }, { appId: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App' }]) {
    assert.equal(appMatches(manifest, identity, '', 'win32'), true, JSON.stringify(identity));
  }
  assert.equal(appMatches(manifest, { appId: 'unknown' }, '无标题 - 记事本', 'win32'), true);
  assert.equal(appMatches(manifest, { appId: 'unknown' }, '', 'win32', 'Untitled - Notepad'), true);
  assert.equal(appMatches(manifest, { appId: 'unknown' }, 'Unrelated', 'win32'), false);
  assert.equal(appMatches(manifest, { appId: 'Notepad' }, 'Notepad', 'darwin'), false);
  for (const [program, appId, title] of [['launcher', 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe', ''], ['League of Legends', 'C:/Games/League of Legends.exe', ''], ['WeGame', 'unrelated', 'League client - WeGame']]) {
    assert.equal(appMatches({ apps: [{ platform: 'windows', program }] }, { appId }, title, 'win32'), true);
  }
  assert.equal(appMatches({ apps: [{ platform: 'windows', program: 'C:\\Games\\Launcher.exe' }] }, { appId: 'D:/New/launcher.exe' }, '', 'win32'), true);
  assert.equal(appMatches({ apps: [{ platform: 'windows', program: 'C:\\Windows\\Notepad.exe' }] }, { appId: 'unknown' }, 'Untitled - Notepad', 'win32'), true);
  assert.equal(appMatches({ apps: [{ platform: 'windows', program: 'a' }] }, { appId: 'random_app!App' }, 'Mail', 'win32'), false, 'single-letter programs do not match arbitrary titles or packages');
  assert.equal(appMatches(manifest, { appId: 'C:\\Notepad_Backup\\unrelated.exe' }, '', 'win32'), false, 'directory names with underscores are not package identities');
  assert.equal(appMatches({ apps: [{ platform: 'macos', bundleId: 'com.example.game', title: '^Game$' }] }, { bundleId: 'com.example.game' }, 'Other', 'darwin'), false);
});

const aimingPlugin = (step, overrides = {}) => ({
  input: { modes: ['foreground'], keys: ['q', 'ctrl'], pointer: [{ id: 'field', rect: [0.1, 0.1, 0.8, 0.8] }] },
  actions: { aim: { steps: [step] }, wait: { steps: [{ wait: 0 }] } }, reflexes: [], events: [],
  decisions: [{ id: 'next', type: 'choice', everyMs: 1000, question: 'Aim?', options: ['aim', 'wait'], targets: { aim: [0.25, 0.75] } }],
  presets: [{ id: 'survive', label: 'Survive', goal: 'Stay alive' }], ...overrides
});

test('a choice target hovers then casts in order, with presets in list and status', async t => {
  const h = await harness(t, { frames: [game()], capabilities: { pointerMove: true }, packageFiles: packageOf(aimingPlugin({ type: 'aim_and_cast', key: 'q', fromDecision: 'next' })) });
  const started = await startFixture(h);
  assert.equal(started.ok, true, JSON.stringify(started));
  await h.wait(() => h.sent.some(message => message.type === 'decide'));
  h.answer('aim');
  await h.wait(() => h.keys.length > 0);
  assert.equal(h.inputCalls[0].pointer.kind, 'move');
  assert.equal(h.inputCalls[0].pointer.x, 0.25); assert.equal(h.inputCalls[0].pointer.y, 0.75);
  assert.equal(h.inputCalls[1].key.key, 'q');
  const [plugin] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(plugin.presets[0].goal, 'Stay alive'); assert.deepEqual(plugin.summary.presets, plugin.presets);
  assert.deepEqual((await h.call('nextmux:plugins:status', started.runId)).presets, plugin.presets);
});

test('a targeted chord hovers at its declared area centre before pressing keys', async t => {
  const h = await harness(t, { frames: [game()], capabilities: { pointerMove: true }, packageFiles: packageOf(aimingPlugin({ chord: ['ctrl', 'q'], area: 'field' })) });
  assert.equal((await startFixture(h)).ok, true);
  await h.wait(() => h.sent.some(message => message.type === 'decide')); h.answer('aim');
  await h.wait(() => h.keys.length > 0);
  assert.equal(h.inputCalls[0].pointer.x, 0.5); assert.equal(h.inputCalls[0].pointer.y, 0.5);
  assert.deepEqual(h.inputCalls[1].key.keys, ['ctrl', 'q']);
});

test('native adapters without hover capability reject aim-and-cast before a run', async t => {
  const h = await harness(t, { frames: [game()], packageFiles: packageOf(aimingPlugin({ key: 'q', area: 'field' })) });
  assert.equal((await startFixture(h)).error, 'computer_pointer_move_unsupported');
  const [plugin] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(plugin.ready, false); assert.match(plugin.inputErrors[0], /computer_pointer_move_unsupported/);
  assert.equal(h.inputCalls.length, 0);
});

test('Windows key modifiers require chord capability just like the chord alias', async t => {
  const original = JSON.parse(pluginJson());
  const h = await harness(t, { frames: [game()], platform: 'win32', identity: { program: 'Game' }, packageFiles: packageOf({
    apps: [{ platform: 'windows', program: 'Game' }], input: { keys: ['left', 'right', 'ctrl'] },
    actions: { ...original.actions, left: { steps: [{ key: 'left', modifiers: ['ctrl'] }] }, right: { steps: [{ key: 'right' }] } }
  }) });
  assert.equal((await startFixture(h)).error, 'computer_key_chord_unsupported');
  assert.equal(h.keys.length, 0);
});

test('a template target outside its allowed pointer area cannot hover or cast', async t => {
  const h = await harness(t, { frames: [game({ coinX: 0.2 })], capabilities: { pointerMove: true },
    packageFiles: packageOf(aimingPlugin({ key: 'q', fromDecision: 'next' }, {
      input: { keys: ['q'], pointer: [{ id: 'field', rect: [0.7, 0.7, 0.2, 0.2] }] },
      decisions: [{ id: 'next', type: 'choice', question: 'Aim?', options: ['aim', 'wait'], targets: { aim: 'signal:coin' } }]
    })) });
  assert.equal((await startFixture(h)).ok, true);
  await h.wait(() => h.sent.some(message => message.type === 'decide')); h.answer('aim');
  await h.wait(() => h.sent.some(message => message.error === 'pointer_target_unavailable'));
  assert.equal(h.inputCalls.length, 0);
});

test('failed hover and a missing decision target never cast', async t => {
  for (const missing of [false, true]) {
    const h = await harness(t, { frames: [game()], capabilities: { pointerMove: true }, onPointer: async () => ({ ok: false, error: 'hover_failed' }),
      packageFiles: packageOf(aimingPlugin({ key: 'q', fromDecision: 'next' }, missing ? { reflexes: [{ when: 'true', do: 'aim' }] } : {})) });
    const started = await startFixture(h); assert.equal(started.ok, true);
    if (!missing) { await h.wait(() => h.sent.some(message => message.type === 'decide')); h.answer('aim'); }
    await h.wait(() => h.sent.some(message => message.error === (missing ? 'pointer_target_unavailable' : 'hover_failed')));
    assert.equal(h.keys.length, 0); assert.equal(h.pointers.length > 0, !missing);
  }
});

test('pausing while hover awaits cancels the pending cast', async t => {
  let finishMove;
  const h = await harness(t, { frames: [game()], capabilities: { pointerMove: true }, onPointer: () => new Promise(resolve => { finishMove = resolve; }),
    packageFiles: packageOf(aimingPlugin({ key: 'q', area: 'field' })) });
  const started = await startFixture(h);
  await h.wait(() => h.sent.some(message => message.type === 'decide')); h.answer('aim');
  await h.wait(() => finishMove);
  await h.call('nextmux:plugins:command', started.runId, { pause: true });
  assert.equal(h.pointers[0].signal.aborted, true);
  finishMove({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.keys.length, 0);
});

test('all decision heads resolve their target choices before the first action casts', async t => {
  const decisions = [{ id: 'next', type: 'choice', question: 'Cast?', options: ['aim', 'wait'] },
    { id: 'target', type: 'choice', question: 'Where?', options: ['aim', 'wait'], targets: { wait: [0.6, 0.7] } }];
  const h = await harness(t, { frames: [game()], capabilities: { pointerMove: true },
    packageFiles: packageOf(aimingPlugin({ key: 'q', fromDecision: 'target' }, { decisions })) });
  assert.equal((await startFixture(h)).ok, true);
  await h.wait(() => h.sent.some(message => message.type === 'decide'));
  const request = h.sent.find(message => message.type === 'decide');
  await h.call('nextmux:plugins:answer', request.requestId, { ok: true, payload: { answers: { next: { choice: 'aim', confidence: 1 }, target: { choice: 'wait', confidence: 1 } } }, costUsd: 0 });
  await h.wait(() => h.keys.length > 0);
  assert.equal(h.pointers[0].x, 0.6); assert.equal(h.pointers[0].y, 0.7);
});

test('A-004 pause invalidates in-flight answers even after resume, but bills the late receipt exactly once', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  await h.call('nextmux:plugins:command', runId, { pause: true });
  assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === request.requestId));
  await h.call('nextmux:plugins:command', runId, { resume: true });
  const result = { ok: true, costUsd: 0.1, payload: { answers: { next: { choice: 'left', confidence: 1 } } } };
  assert.equal(await h.call('nextmux:plugins:answer', request.requestId, result), true);
  assert.equal(await h.call('nextmux:plugins:answer', request.requestId, result), false);
  assert.equal(h.keys.length, 0);
  assert.equal((await h.call('nextmux:plugins:status', runId)).costUsd, 0.1);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length > 1);
  const second = h.sent.filter(item => item.type === 'decide').at(-1);
  await h.call('nextmux:plugins:answer', second.requestId, result);
  await h.wait(() => h.keys.length === 1);
});

test('A-004 pause during an input cancels its hold and prevents every remaining action step', async t => {
  let release;
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({
    actions: { left: { steps: [{ key: 'left', holdMs: 3000 }, { key: 'right' }] }, right: { steps: [{ key: 'right' }] }, wait: { steps: [{ wait: 1 }] } }
  }), onKey: input => new Promise(resolve => { input.signal.addEventListener('abort', () => { release = true; resolve({ ok: false }); }, { once: true }); }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide')); h.answer('left');
  await h.wait(() => h.keys.length === 1);
  await h.call('nextmux:plugins:command', runId, { pause: true });
  await h.wait(() => release);
  assert.equal(h.keys[0].signal.aborted, true);
  assert.equal(h.keys.length, 1);
  assert.equal((await h.call('nextmux:plugins:status', runId)).actions, 0);
});

test('A-010 Windows omitted holdMs is a tap; explicit holds are refused before starting', async t => {
  const actions = { left: { steps: [{ key: 'left' }] }, right: { steps: [{ key: 'right' }] }, wait: { steps: [{ wait: 1 }] } };
  const options = { frames: [game()], platform: 'win32', identity: { program: 'Game' }, packageFiles: packageOf({ apps: [{ platform: 'windows', program: 'Game' }], actions }) };
  const h = await harness(t, options);
  const started = await startFixture(h); assert.equal(started.ok, true);
  await h.wait(() => h.sent.some(item => item.type === 'decide')); h.answer('left');
  await h.wait(() => h.keys.length);
  assert.equal(Object.hasOwn(h.keys[0], 'holdMs'), false);
  const held = await harness(t, { ...options, packageFiles: packageOf({ apps: [{ platform: 'windows', program: 'Game' }] }) });
  assert.equal((await startFixture(held)).error, 'computer_key_hold_unsupported');
  assert.equal(held.keys.length, 0);
  const native = await harness(t, { ...options, capabilities: { keyHold: true, chords: true, modifierKeys: true }, packageFiles: packageOf({ apps: [{ platform: 'windows', program: 'Game' }] }) });
  assert.equal((await startFixture(native)).ok, true, 'a capable native driver must not be blocked by a platform-name check');
  await native.wait(() => native.sent.some(item => item.type === 'decide')); native.answer('left');
  await native.wait(() => native.keys.length);
  assert.equal(native.keys[0].holdMs, 60, 'explicit holds remain holds on the native driver');
});

test('A-011 local cold-start answer at 13 seconds is accepted inside the shared 30 second deadline', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h, { model: { source: 'local', model: 'llama', protocol: 'ollama', endpoint: 'http://localhost:11434' } });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  assert.ok(request.deadlineAt > Date.now() + 29_000);
  await new Promise(resolve => setTimeout(resolve, 13_000));
  h.answer('left'); await h.wait(() => h.keys.length);
  assert.equal((await h.call('nextmux:plugins:status', runId)).error, '');
});

test('A-011 stopping or losing the owner cancels requests; late costs remain on an ended run', async t => {
  for (const destroy of [false, true]) {
    const h = await harness(t, { frames: [game()] });
    const { runId } = await startFixture(h);
    await h.wait(() => h.sent.some(item => item.type === 'decide'));
    const request = h.sent.find(item => item.type === 'decide');
    if (destroy) h.sender.emit('destroyed'); else await h.call('nextmux:plugins:stop', runId);
    assert.ok(h.sent.some(item => item.type === 'cancel' && item.requestId === request.requestId));
    await h.call('nextmux:plugins:answer', request.requestId, { ok: true, costUsd: 0.12, payload: { answers: { next: { choice: 'left', confidence: 1 } } } });
    const status = await h.call('nextmux:plugins:status', runId);
    assert.equal(status.costUsd, 0.12); assert.equal(status.ended, true); assert.equal(h.keys.length, 0);
  }
});

test('A-012 unknown BYOK spend is explicit and request limit still stops the run', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h, { maxRequests: 1, model: { source: 'connection', model: 'typesafe/jev-1.13', connectionId: 'own' } });
  const plugin = (await h.call('nextmux:plugins:list', 'en'))[0];
  assert.equal(plugin.budgetEnforceable, false);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  await h.call('nextmux:plugins:answer', request.requestId, { ok: true, costStatus: 'unknown', payload: { answers: {} } });
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.costStatus, 'unknown'); assert.equal(status.budgetEnforceable, false);
  await h.wait(() => h.sent.some(item => item.type === 'ended'));
  assert.equal((await h.call('nextmux:plugins:status', runId)).reason, 'request_limit');
});

test('A-023 owner listener count returns to baseline after twelve runs and dispose', async t => {
  const h = await harness(t, { frames: [game()] });
  const baseline = h.sender.listenerCount('destroyed');
  for (let i = 0; i < 12; i++) {
    const { runId } = await startFixture(h);
    assert.equal(h.sender.listenerCount('destroyed'), baseline + 1);
    await h.call('nextmux:plugins:stop', runId);
    assert.equal(h.sender.listenerCount('destroyed'), baseline);
  }
  await startFixture(h); await h.plugins.dispose();
  assert.equal(h.sender.listenerCount('destroyed'), baseline);
});

test('A-021 inspection distinguishes local source, market review and actual signature verification', async t => {
  const h = await harness(t, { frames: [game()] });
  const local = await h.call('nextmux:plugins:inspect', 'en');
  assert.deepEqual([local.source, local.reviewStatus, local.signaturePresent, local.signatureVerified], ['local-file', 'unreviewed', false, false]);
  const bytes = zipAdapter.writeZip(packageOf({})).toString('base64');
  const market = await h.call('nextmux:plugins:inspect-bytes', 'en', bytes, { id: 'com.example.coin-catcher', version: '1.0.0', source: 'marketplace', reviewStatus: 'approved', signaturePresent: true, signatureVerified: false });
  assert.deepEqual([market.source, market.reviewStatus, market.signaturePresent, market.signatureVerified], ['marketplace', 'approved', true, false]);
  await h.call('nextmux:plugins:install', market.token);
  const [installed] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(installed.signaturePresent, true); assert.equal(installed.signatureVerified, false);
});

test('A-003 hostile OCR regex finishes before the next stop command', async t => {
  const h = await harness(t, { frames: [game()], recognizeText: async () => ({ ok: true, texts: ['a'.repeat(34) + '!'] }), packageFiles: packageOf({
    perception: { tickMs: 100, signals: [{ id: 'words', type: 'text', rect: [0, 0, 1, 1], pattern: '(a+)+$' }] }, reflexes: [], events: []
  }) });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const before = performance.now();
  assert.equal((await h.call('nextmux:plugins:stop', runId)).ended, true);
  assert.ok(performance.now() - before < 500);
});

test('A-011 main deadline sends cancellation, then bills a late answer without input', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const request = h.sent.find(item => item.type === 'decide');
  assert.ok(request.deadlineAt <= Date.now() + 10_000);
  await h.wait(() => h.sent.some(item => item.type === 'cancel' && item.requestId === request.requestId), 13_000);
  await h.call('nextmux:plugins:answer', request.requestId, { ok: true, costUsd: 0.2, payload: { answers: { next: { choice: 'left', confidence: 1 } } } });
  assert.equal(h.keys.length, 0);
  assert.equal((await h.call('nextmux:plugins:status', runId)).costUsd, 0.2);
});

test('A-012 late-discovered BYOK pricing becomes known, while any unpriced receipt stays unknown', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h, { model: { source: 'connection', model: 'typesafe/jev-1.13', connectionId: 'own' } });
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const first = h.sent.find(item => item.type === 'decide');
  await h.call('nextmux:plugins:answer', first.requestId, { ok: true, costUsd: 0.01, costStatus: 'known', payload: { answers: {} } });
  assert.equal((await h.call('nextmux:plugins:status', runId)).budgetEnforceable, true);
  await h.wait(() => h.sent.filter(item => item.type === 'decide').length > 1);
  const second = h.sent.filter(item => item.type === 'decide').at(-1);
  await h.call('nextmux:plugins:answer', second.requestId, { ok: true, costStatus: 'unknown', payload: { answers: {} } });
  assert.equal((await h.call('nextmux:plugins:status', runId)).costStatus, 'unknown');
});

test('A-023 a destroyed owner during async start never creates a run or input', async t => {
  let identifyDone, reached;
  const waiting = new Promise(resolve => { reached = resolve; });
  const h = await harness(t, { frames: [game()], identify: () => { reached(); return new Promise(resolve => { identifyDone = resolve; }); } });
  const starting = startFixture(h);
  await waiting;
  h.sender.isDestroyed = () => true; h.sender.emit('destroyed');
  identifyDone({ bundleId: 'com.example.game' });
  assert.equal((await starting).error, 'page_closed');
  assert.equal(h.sender.listenerCount('destroyed'), 0);
  assert.equal(h.keys.length, 0);
  assert.deepEqual(await h.call('nextmux:plugins:runs'), []);
});

test('A-011 a truly destroyed renderer leaves an explicit unsettled cost instead of known zero', async t => {
  const h = await harness(t, { frames: [game()] });
  const { runId } = await startFixture(h);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  h.sender.isDestroyed = () => true;
  h.sender.emit('destroyed');
  const status = await h.call('nextmux:plugins:status', runId);
  assert.equal(status.ended, true);
  assert.equal(status.costStatus, 'unknown');
  assert.equal(h.keys.length, 0);
  assert.equal(h.sender.listenerCount('destroyed'), 0);
});


test('Windows plugins fall back from background-only declarations to foreground, while OCR preflight stays strict', async t => {
  const native = { keyHold: true, chords: true, modifierKeys: true };
  const base = { frames: [game()], platform: 'win32', identity: { program: 'Game' }, capabilities: native };
  const background = await harness(t, { ...base, packageFiles: packageOf({ apps: [{ platform: 'windows', program: 'Game' }],
    input: { modes: ['background'], keys: ['left', 'right'] } }) });
  const started = await startFixture(background);
  assert.equal(started.ok, true); assert.equal(started.mode, 'foreground');
  const original = JSON.parse(pluginJson());
  const ocr = await harness(t, { ...base, viewReady: async () => ({ ocr: false, ocrLanguages: [] }), packageFiles: packageOf({
    apps: [{ platform: 'windows', program: 'Game' }], perception: { ...original.perception,
      signals: [...original.perception.signals, { id: 'label', type: 'text', rect: [0, 0, 1, 1], everyMs: 1000 }] }
  }) });
  const result = await startFixture(ocr);
  assert.equal(result.error, 'ocr_language_unavailable'); assert.deepEqual(result.ocrLanguages, []);
  assert.equal(background.keys.length + ocr.keys.length, 0);
});


test('a Chinese plugin UI keeps decision knowledge and event handoffs in English', async t => {
  const data = pluginJson({
    description: { en: 'Catch falling coins.', 'zh-CN': '接住下落的金币。' },
    knowledge: { en: 'Coins fall down.', 'zh-CN': '金币向下落。' },
    events: [{ id: 'pause', when: 'true', message: { en: 'The game is paused', 'zh-CN': '游戏被暂停了' }, pause: true }]
  });
  const h = await harness(t, { frames: [game()], packageFiles: [['plugin.json', Buffer.from(data)], ['templates/coin.png', PNG]] });
  const inspected = await h.call('nextmux:plugins:inspect', 'zh-CN');
  await h.call('nextmux:plugins:install', inspected.token);
  const [info] = await h.call('nextmux:plugins:list', 'zh-CN');
  assert.equal(info.summary.description, '接住下落的金币。');
  assert.equal(info.modelSummary.description, 'Catch falling coins.');
  await h.call('nextmux:plugins:configure', info.id, { model: { source: 'local', model: 'openjev-latest', endpoint: 'http://127.0.0.1:8080' } });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: info.id, locale: 'zh-CN' });
  assert.equal(started.ok, true);
  await h.wait(() => h.sent.some(item => item.type === 'event'));
  const event = h.sent.find(item => item.type === 'event');
  assert.equal(event.message, '游戏被暂停了');
  assert.equal(event.modelMessage, 'The game is paused');
  const status = await h.call('nextmux:plugins:status', started.runId);
  assert.equal(status.events[0].modelMessage, 'The game is paused');
});


test('加载本地插件: a plugin folder loads as a local plugin, is fingerprinted, and runs once it has a model', async t => {
  const { mkdir } = await import('node:fs/promises');
  const folder = await mkdtemp(join(tmpdir(), 'nextmux-plugin-folder-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'templates'));
  await writeFile(join(folder, 'plugin.json'), pluginJson());
  await writeFile(join(folder, 'templates', 'coin.png'), PNG);
  await writeFile(join(folder, 'README.md'), '# Coin');
  const h = await harness(t, { frames: [game()], folder });
  assert.deepEqual(await h.call('nextmux:plugins:add-folder', 'Choose a plugin folder'), { ok: true, id: 'com.example.coin-catcher' });
  const [listed] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(listed.ok, true);
  assert.equal(listed.source, 'development');
  assert.equal(listed.folder, folder);
  assert.match(listed.fingerprint.behavior, /^[0-9a-f]{64}$/, 'a plugin from disk carries its content fingerprint');
  assert.equal(listed.ready, false, 'it needs a decision model first');
  assert.equal((await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'local', protocol: 'openai', endpoint: 'http://127.0.0.1:18080', model: 'mock', label: 'Mock' } })).ok, true);
  assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].ready, true, 'with a model it is ready to run');
});

test('a bought plugin is installed sealed to this computer: a copied folder is locked elsewhere, and it needs a valid license', async t => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { readdir: list } = await import('node:fs/promises');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  const now = Date.now();
  const fields = { userId: 'buyer-1', pluginId: 'com.example.coin-catcher', issuedAt: now - 1000, expiresAt: now + 86_400_000 };
  const license = { ...fields, signature: sign(null, Buffer.from(`nextmux-app-plugin-license/1\n${fields.pluginId}\n${fields.userId}\n${fields.issuedAt}\n${fields.expiresAt}`), privateKey).toString('base64') };
  const keychain = secret => ({ isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`${secret}:${text}`),
    decryptString: buffer => { const value = buffer.toString(); if (!value.startsWith(`${secret}:`)) throw new Error('another keychain'); return value.slice(secret.length + 1); } });
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-plugins-sealed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = zipAdapter.writeZip([['plugin.json', Buffer.from(pluginJson())], ['templates/coin.png', PNG], ['README.md', Buffer.from('# Coin')]]);
  const origin = { id: 'com.example.coin-catcher', version: '1.0.0', source: 'marketplace', reviewStatus: 'approved', paid: true };
  const h = await harness(t, { frames: [game()], secureStorage: keychain('this-mac'), licensePublicKey: key, directory });
  // Without a valid license nothing is installed.
  const unlicensed = await h.call('nextmux:plugins:inspect-bytes', 'en', bytes.toString('base64'), { ...origin, license: { ...license, userId: 'someone-else' } });
  assert.equal((await h.call('nextmux:plugins:install', unlicensed.token)).error, 'plugin_purchase_required');
  const inspected = await h.call('nextmux:plugins:inspect-bytes', 'en', bytes.toString('base64'), { ...origin, license });
  assert.deepEqual(await h.call('nextmux:plugins:install', inspected.token), { ok: true, id: 'com.example.coin-catcher' });
  const stored = await list(join(directory, 'app-plugins', 'installed', 'com.example.coin-catcher'));
  assert.deepEqual(stored.sort(), ['package.key', 'package.nmxsealed'], 'no readable plugin files on disk');
  const [listed] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(listed.ok, true, 'this computer opens it');
  assert.equal(listed.paid, true);
  assert.equal(listed.licenseUserId, 'buyer-1');
  h.plugins.dispose();
  // The same folder on another computer (another keychain): locked.
  const elsewhere = await harness(t, { frames: [game()], secureStorage: keychain('other-mac'), licensePublicKey: key, directory });
  const [locked] = await elsewhere.call('nextmux:plugins:list', 'en');
  assert.equal(locked.ok, false);
  assert.equal(locked.diagnostics[0].code, 'package_locked');
});


test('incognito plugin logs never persist and shutdown fences a late start', async t => {
  let closed = false;
  const incognito = { has: id => id === 'private', closed: id => id === 'private' && closed };
  const h = await harness(t, { frames: [game()], incognito });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  await h.call('nextmux:plugins:install', inspected.token);
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const request = { conversationId: 'private', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher', goal: 'private secret' };
  const started = await h.call('nextmux:plugins:start', request);
  assert.equal(started.ok, true);
  closed = true;
  await h.plugins.stopForConversations(['private']);
  const logs = await readdir(join(h.directory, 'app-plugins', 'logs')).catch(error => { if(error.code === 'ENOENT') return []; throw error; });
  assert.deepEqual(logs, []);
  assert.equal((await h.call('nextmux:plugins:start', request)).error, 'incognito_session_closed');
  const normal = await h.call('nextmux:plugins:start', { ...request, conversationId: 'normal', goal: 'normal goal' });
  assert.equal(normal.ok, true);
  await h.call('nextmux:plugins:stop', normal.runId);
  assert.deepEqual(await readdir(join(h.directory, 'app-plugins', 'logs')), [`${normal.runId}.json`]);
});

test('B19: updating an installed plugin swaps via a backup folder, survives Recycle Bin trashItem failure, and recovers orphaned .bak-* backups', async t => {
  let trashFailures = 0;
  const h = await harness(t, {
    frames: [game()],
    onTrash: async () => {
      trashFailures += 1;
      throw new Error('recycle_bin_unavailable');
    }
  });
  const first = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal((await h.call('nextmux:plugins:install', first.token)).ok, true);
  assert.equal(h.trashed.length, 0);

  const updatedBytes = zipAdapter.writeZip([
    ['plugin.json', Buffer.from(pluginJson({ version: '1.1.0' }))],
    ['templates/coin.png', PNG],
    ['README.md', Buffer.from('# Coin v1.1.0')]
  ]).toString('base64');
  const second = await h.call('nextmux:plugins:inspect-bytes', 'en', updatedBytes, { id: 'com.example.coin-catcher', version: '1.1.0', verified: true });
  assert.equal(second.ok, true);
  assert.equal((await h.call('nextmux:plugins:install', second.token)).ok, true);
  assert.equal(trashFailures, 1);
  assert.equal(h.trashed.length, 1);
  assert.match(h.trashed[0], /com\.example\.coin-catcher\.bak-/);
  const installedRoot = join(h.directory, 'app-plugins', 'installed');
  assert.deepEqual(await readdir(installedRoot), ['com.example.coin-catcher']);
  const [info] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(info.summary.version, '1.1.0');
  assert.equal(info.readme, '# Coin v1.1.0');

  // Simulate an interrupted swap + rollback where target is missing on disk and only .bak-* remains:
  const targetDir = join(installedRoot, 'com.example.coin-catcher');
  const orphanBackup = `${targetDir}.bak-9999999999999-deadbeef`;
  await rename(targetDir, orphanBackup);
  const reloaded = await h.call('nextmux:plugins:reload', 'com.example.coin-catcher');
  assert.equal(reloaded.ok, true);
  assert.deepEqual(await readdir(installedRoot), ['com.example.coin-catcher']);
});

test('file-line cursor ({{line:<param>}}) only advances after the text step succeeds and does not skip a line on failed at click', async t => {
  let failClick = true;
  const manifestObj = {
    schema: 'nextmux.app-plugin/1',
    id: 'com.example.comment-bot',
    version: '1.0.0',
    name: 'Comment Bot',
    description: 'Posts comments line by line.',
    author: { name: 'NextMux' },
    apps: [{ platform: 'macos', bundleId: 'com.example.game' }],
    display: { width: 400, height: 240 },
    params: [
      { id: 'comment_file', type: 'file', accept: ['.txt'], default: '', label: 'Comments' }
    ],
    input: {
      modes: ['foreground'],
      keys: ['enter'],
      pointer: [{ id: 'box', rect: [0.1, 0.1, 0.8, 0.8] }]
    },
    perception: {
      tickMs: 60,
      signals: [{ id: 'hp', type: 'bar', rect: [0.1, 0.04, 0.8, 0.04], color: '#e0323c', tolerance: 30 }]
    },
    actions: {
      post_comment: {
        label: 'Post',
        steps: [{ text: '{{line:comment_file}}', at: [0.5, 0.5], submit: true }]
      }
    },
    reflexes: [{ when: 'hp > 0.5', do: 'post_comment' }],
    decisions: []
  };
  const h = await harness(t, {
    frames: [game({ hp: 1 })],
    packageFiles: [['plugin.json', Buffer.from(JSON.stringify(manifestObj))], ['README.md', Buffer.from('# Bot')]],
    onPointer: async payload => {
      if (failClick) {
        failClick = false;
        return { ok: false, error: 'click_failed' };
      }
      return { ok: true };
    }
  });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal((await h.call('nextmux:plugins:install', inspected.token)).ok, true);
  assert.equal((await h.call('nextmux:plugins:configure', 'com.example.comment-bot', {
    params: { comment_file: 'first line\nsecond line' }
  })).ok, true);
  const started = await h.call('nextmux:plugins:start', {
    conversationId: 'c1',
    tabId: 't1',
    pid: 10,
    windowId: 20,
    pluginId: 'com.example.comment-bot'
  });
  assert.equal(started.ok, true);
  await h.wait(() => h.keys.some(item => item.text !== undefined), 3000);
  await h.call('nextmux:plugins:stop', started.runId);
  const typedTexts = h.keys.filter(item => item.text !== undefined).map(item => item.text);
  assert.equal(typedTexts[0], 'first line', 'first line must not be skipped when the first at click fails');
});


test('installed plugins migrate legacy disabled state and ignore disable requests', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-enabled-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = 'com.example.coin-catcher';
  const folder = join(directory, 'app-plugins', 'installed', id);
  await mkdir(join(folder, 'templates'), { recursive: true });
  await writeFile(join(folder, 'plugin.json'), pluginJson({ decisions: [] }));
  await writeFile(join(folder, 'templates', 'coin.png'), PNG);
  const statePath = join(directory, 'app-plugins', 'state.json');
  await writeFile(statePath, JSON.stringify({ plugins: { [id]: { enabled: false } } }));
  const h = await harness(t, { directory, frames: [game()] });
  const [plugin] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(plugin.ok, true, JSON.stringify(plugin));
  assert.equal(plugin.enabled, true); assert.equal(plugin.ready, true);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).plugins[id].enabled, true);
  await h.call('nextmux:plugins:configure', id, { enabled: false });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: id });
  assert.equal(started.ok, true);
});

test('invalid local uploads purge failed records, staging and tokens without touching healthy installs or user folders', async t => {
  const h = await harness(t, { frames: [game()] });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal((await h.call('nextmux:plugins:install', inspected.token)).ok, true);
  const stale = await h.call('nextmux:plugins:inspect', 'en');
  const root = join(h.directory, 'app-plugins', 'installed');
  const orphan = join(root, 'com.example.broken');
  const staging = join(root, '.com.example.broken.00000000-0000-0000-0000-000000000001');
  await mkdir(orphan); await writeFile(join(orphan, 'plugin.json'), '{bad');
  await mkdir(staging); await writeFile(join(staging, 'receipt.json'), '{}');
  await writeFile(join(h.directory, 'coin.nmxplugin'), Buffer.from('corrupt'));
  const rejected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(rejected.ok, false); assert.ok(rejected.diagnostics[0].code.startsWith('package_'));
  assert.equal((await h.call('nextmux:plugins:install', stale.token)).error, 'install_expired');
  await assert.rejects(stat(orphan), { code: 'ENOENT' });
  await assert.rejects(stat(staging), { code: 'ENOENT' });
  assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].ok, true);
  const unsupported = join(h.directory, 'notes.txt'); await writeFile(unsupported, 'notes');
  assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', unsupported)).error, 'package_format_unsupported');
  const folder = join(h.directory, 'invalid-folder'); await mkdir(folder); await writeFile(join(folder, 'notes.txt'), 'keep');
  assert.equal((await h.call('nextmux:plugins:add-folder', '', folder)).error, 'package_manifest_missing');
  assert.equal(await readFile(join(folder, 'notes.txt'), 'utf8'), 'keep');
});

test('invalid uploads preserve recorded installs whose JSON manifest fails validation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-recorded-plugin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = 'com.example.coin-catcher';
  const root = join(directory, 'app-plugins');
  const folder = join(root, 'installed', id);
  const manifest = pluginJson({ version: undefined });
  const state = { plugins: { [id]: { enabled: true, installedAt: 1234 } } };
  await mkdir(join(folder, 'templates'), { recursive: true });
  await writeFile(join(folder, 'plugin.json'), manifest);
  await writeFile(join(folder, 'templates', 'coin.png'), PNG);
  await writeFile(join(root, 'state.json'), JSON.stringify(state));
  const h = await harness(t, { directory, frames: [game()] });
  const [before] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(before.id, id);
  assert.equal(before.ok, false);
  assert.ok(before.errors.some(error => error.startsWith('version:')), JSON.stringify(before.errors));

  const unsupported = join(directory, 'unrelated.txt');
  await writeFile(unsupported, 'not a plugin');
  const rejected = await h.call('nextmux:plugins:inspect', 'en', '', unsupported);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'package_format_unsupported');
  assert.notEqual(rejected.cleanupFailed, true);
  assert.equal((await stat(folder)).isDirectory(), true);
  assert.equal(await readFile(join(folder, 'plugin.json'), 'utf8'), manifest);
  assert.deepEqual(await readFile(join(folder, 'templates', 'coin.png')), PNG);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')), state);
  const listed = await h.call('nextmux:plugins:list', 'en');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, id);
  assert.equal(listed[0].ok, false);
  assert.deepEqual(listed[0].errors, before.errors);
});

test('local aliases, manifest selection and folder selection use the real validation flow', async t => {
  const h = await harness(t, { frames: [game()] });
  for (const extension of ['zip', 'jevplugin', 'nmxplugin']) {
    const file = join(h.directory, `alias.${extension}`);
    await writeFile(file, zipAdapter.writeZip(packageOf({ decisions: [] })));
    assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', file)).ok, true);
  }
  const folder = join(h.directory, 'manifest-folder'); await mkdir(folder);
  await writeFile(join(folder, 'manifest.json'), pluginJson({ decisions: [], perception: { signals: [] }, events: [], reflexes: [{ when: 'false', do: 'wait' }] }));
  for (const file of [folder, join(folder, 'manifest.json')]) assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', file)).ok, true);
  await writeFile(join(folder, 'plugin.json'), '{}');
  assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', folder)).error, 'package_duplicate');
});

test('failed state persistence rolls back a new install and a version replacement', async t => {
  const h = await harness(t, { frames: [game()] });
  const root = join(h.directory, 'app-plugins');
  const statePath = join(root, 'state.json');
  for (const update of [false, true]) {
    if (update) {
      const first = await h.call('nextmux:plugins:inspect', 'en');
      assert.equal((await h.call('nextmux:plugins:install', first.token)).ok, true);
      await rm(statePath);
      await writeFile(join(h.directory, 'coin.nmxplugin'), zipAdapter.writeZip(packageOf({ version: '1.1.0' })));
    }
    const next = await h.call('nextmux:plugins:inspect', 'en');
    await mkdir(statePath, { recursive: true });
    const result = await h.call('nextmux:plugins:install', next.token);
    assert.equal(result.error, 'install_failed');
    const plugins = await h.call('nextmux:plugins:list', 'en');
    assert.equal(plugins.length, update ? 1 : 0);
    if (update) assert.equal(plugins[0].summary.version, '1.0.0');
    else await assert.rejects(stat(join(root, 'installed', 'com.example.coin-catcher')), { code: 'ENOENT' });
    assert.equal((await readdir(join(root, 'installed'))).some(name => name.startsWith('.')), false);
    await rm(statePath, { recursive: true });
  }
});

test('keyboard payloads preserve chords, modifiers, holds and platform primary keys on both platforms', async t => {
  const steps = [{ key: 'primary' }, { keys: ['a', 'b'], modifiers: ['primary', 'shift'], holdMs: 30 },
    ...['cmd', 'ctrl', 'alt', 'shift'].map(key => ({ key, holdMs: 10 }))];
  for (const platform of ['darwin', 'win32']) {
    const h = await harness(t, { frames: [game()], platform, identity: platform === 'darwin' ? { bundleId: 'com.example.game' } : { program: 'Game.exe' },
      capabilities: { keyHold: true, chords: true, modifierKeys: true }, packageFiles: packageOf({
        apps: [{ platform: 'macos', bundleId: 'com.example.game' }, { platform: 'windows', program: 'Game.exe' }],
        input: { modes: ['foreground'], keys: ['a', 'b', 'primary', 'cmd', 'ctrl', 'alt', 'shift'] },
        perception: { signals: [] }, actions: { press: { steps, cooldownMs: 60000 } },
        decisions: [], events: [], reflexes: [{ when: 'true', do: 'press' }]
      }) });
    const inspected = await h.call('nextmux:plugins:inspect', 'en'); assert.equal(inspected.ok, true, JSON.stringify(inspected));
    await h.call('nextmux:plugins:install', inspected.token);
    const result = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
    assert.equal(result.ok, true, JSON.stringify(result)); await h.wait(() => h.keys.length === steps.length);
    assert.equal(h.keys[0].key, platform === 'darwin' ? 'cmd' : 'ctrl');
    assert.deepEqual(h.keys[1].keys, ['a', 'b']);
    assert.deepEqual(h.keys[1].modifiers, [platform === 'darwin' ? 'cmd' : 'ctrl', 'shift']); assert.equal(h.keys[1].holdMs, 30);
    assert.deepEqual(h.keys.slice(2).map(key => [key.key, key.holdMs]), ['cmd', 'ctrl', 'alt', 'shift'].map(key => [key, 10]));
  }
  for (const modifiers of ['ctrl', ['unknown'], ['alt']]) {
    const parsed = core.validateManifest(JSON.parse(pluginJson({ input: { keys: ['a', 'b'] }, actions: { press: { steps: [{ keys: ['a', 'b'], modifiers }] } }, decisions: [], reflexes: [] })));
    assert.equal(parsed.ok, false, JSON.stringify(modifiers));
    assert.ok(parsed.diagnostics.some(item => item.path.endsWith('.modifiers')));
  }
});

test('failed legacy records are removed while valid developer folders and run receipts survive rejection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-residual-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'app-plugins');
  const broken = join(root, 'installed', 'com.example.broken');
  const developer = join(directory, 'developer');
  await mkdir(broken, { recursive: true }); await writeFile(join(broken, 'receipt.json'), '{}');
  await mkdir(developer); await writeFile(join(developer, 'notes.txt'), 'user source');
  await mkdir(join(root, 'logs')); await writeFile(join(root, 'logs', 'old-run.jsonl'), '{"cost":0.01}\n');
  await writeFile(join(root, 'state.json'), JSON.stringify({ plugins: {
    'com.example.broken': { enabled: false, receipt: 'unfinished' },
    'com.example.development': { dev: developer, enabled: false },
    'com.example.paid': { paid: true, enabled: true }
  } }));
  const h = await harness(t, { directory, frames: [game()] });
  const bad = join(directory, 'bad.txt'); await writeFile(bad, 'no plugin');
  assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', bad)).error, 'package_format_unsupported');
  const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
  assert.deepEqual(Object.keys(state.plugins), ['com.example.paid'], 'a paid/keychain failure is not a disposable failed upload');
  await assert.rejects(stat(broken), { code: 'ENOENT' });
  assert.equal(await readFile(join(developer, 'notes.txt'), 'utf8'), 'user source');
  assert.match(await readFile(join(root, 'logs', 'old-run.jsonl'), 'utf8'), /cost/);
});

test('tar.gz and tgz packages install through the same validated pending-token flow', async t => {
  const { gzipSync } = await import('node:zlib');
  const h = await harness(t, { frames: [game()] });
  const body = Buffer.from(pluginJson({ perception: { signals: [] }, decisions: [], events: [], reflexes: [{ when: 'false', do: 'wait' }] }));
  const header = Buffer.alloc(512);
  header.write('example/manifest.json');
  for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, body.length], [136, 12, 0]]) {
    header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  }
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
  header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  const bytes = gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]));
  for (const extension of ['tar.gz', 'tgz']) {
    const file = join(h.directory, `example.${extension}`); await writeFile(file, bytes);
    const inspected = await h.call('nextmux:plugins:inspect', 'en', '', file);
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal((await h.call('nextmux:plugins:install', inspected.token)).ok, true);
    assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].summary.id, 'com.example.coin-catcher');
  }
});


test('selected txt and md comment files skip blank lines, cycle, and submit in order', async t => {
  for (const extension of ['txt', 'md']) {
    const h = await harness(t, { frames: [game()], packageFiles: packageOf({
      params: [{ id: 'comment_file', type: 'file', accept: ['.txt', '.md'], label: 'Comments' }],
      input: { modes: ['foreground'], keys: ['enter'] }, perception: { tickMs: 60, signals: [] },
      actions: { post: { steps: [{ text: '{{line:comment_file}}', submit: true }], cooldownMs: 0 } },
      reflexes: [{ when: 'param.comment_file.count > 0', do: 'post' }], decisions: [], events: []
    }) });
    const inspected = await h.call('nextmux:plugins:inspect', 'en');
    assert.equal((await h.call('nextmux:plugins:install', inspected.token)).ok, true);
    const file = join(h.directory, `comments.${extension}`); await writeFile(file, '\ufeffFirst\r\n\r\n  \nSecond\n');
    const chosen = await h.call('nextmux:plugins:pick-param-file', 'com.example.coin-catcher', 'comment_file', file);
    assert.equal(chosen.ok, true); assert.equal(chosen.file.count, 2);
    const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
    assert.equal(started.ok, true);
    await h.wait(() => h.keys.filter(item => item.key === 'enter').length >= 3);
    await h.call('nextmux:plugins:stop', started.runId);
    assert.deepEqual(h.keys.filter(item => item.text).slice(0, 3).map(item => item.text), ['First', 'Second', 'First']);
    assert.deepEqual(h.keys.slice(0, 6).map(item => item.text || item.key), ['First', 'enter', 'Second', 'enter', 'First', 'enter']);
  }
});

test('option changes keep their scope: a tab edit reaches only its run, saved defaults reach no live run', async t => {
  const id = 'com.example.coin-catcher';
  const h = await harness(t, { frames: [game()], packageFiles: packageOf({
    params: [{ id: 'speed', type: 'number', min: 1, max: 9, default: 5, label: 'Speed' }, { id: 'mode', type: 'select', options: ['calm', 'fast'], default: 'calm', label: 'Mode' },
      { id: 'comment_file', type: 'file', accept: ['.txt'], label: 'Comments' }],
    input: { modes: ['foreground'], keys: ['enter'] }, perception: { tickMs: 60, signals: [] },
    actions: { wait: { steps: [{ wait: 1 }], cooldownMs: 0 } }, reflexes: [{ when: 'false', do: 'wait' }], decisions: [], events: []
  }) });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal((await h.call('nextmux:plugins:install', inspected.token)).ok, true);
  const a = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: id });
  const b = await h.call('nextmux:plugins:start', { conversationId: 'c2', tabId: 't2', pid: 11, windowId: 21, pluginId: id });
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b));
  const saved = async () => JSON.parse(await readFile(join(h.directory, 'app-plugins', 'state.json'), 'utf8')).plugins[id].params;
  const live = async () => Object.fromEntries((await h.call('nextmux:plugins:runs')).map(run => [run.runId, run.params]));
  await h.call('nextmux:plugins:command', a.runId, { params: { speed: 9 } });
  const edited = await h.call('nextmux:plugins:command', b.runId, { params: { mode: 'fast' } });
  assert.deepEqual([edited.params.speed, edited.params.mode], [5, 'fast'], "another tab's edit never leaks into this run");
  assert.deepEqual([(await saved()).speed, (await saved()).mode], [9, 'fast'], 'each tab edit saves only the option it changed');
  assert.equal((await h.call('nextmux:plugins:configure', id, { params: { speed: 2 }, scope: 'defaults' })).ok, true);
  assert.deepEqual([(await live())[a.runId].speed, (await live())[b.runId].speed, (await saved()).speed], [9, 5, 2], 'Settings changes only the saved defaults');
  const file = join(h.directory, 'comments.txt'); await writeFile(file, 'One\nTwo\n');
  const picked = await h.call('nextmux:plugins:pick-param-file', id, 'comment_file', file, { runId: b.runId, conversationId: 'c2', tabId: 't2' });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  const runs = await live();
  assert.deepEqual([runs[b.runId].comment_file.count, runs[b.runId].mode, runs[a.runId].comment_file.count], [2, 'fast', 0], "a tab's file choice keeps that run's other options and skips other tabs");
  await h.call('nextmux:plugins:stop', a.runId); await h.call('nextmux:plugins:stop', b.runId);
});

test('local folders reject sealed symlinks and oversized encrypted payloads before reading', async t => {
  const h = await harness(t, { frames: [game()] });
  const folder = join(h.directory, 'sealed-upload'); await mkdir(folder);
  const payload = join(folder, 'package.nmxsealed');
  await symlink(join(h.directory, 'coin.nmxplugin'), payload);
  assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', folder)).error, 'package_link');
  await rm(payload); await writeFile(payload, ''); await truncate(payload, 65 * 1024 * 1024);
  assert.equal((await h.call('nextmux:plugins:inspect', 'en', '', folder)).error, 'package_file_size');
  assert.deepEqual(await h.call('nextmux:plugins:list', 'en'), []);
});

test('pick-folder IPC returns selected directory path and resolves path parameters', async t => {
  const baseDir = await mkdtemp(join(tmpdir(), 'nextmux-path-param-'));
  t.after(() => rm(baseDir, { recursive: true, force: true }));
  const folder = join(baseDir, 'chosen-plugin-folder');
  const altFolder = join(baseDir, 'alt-folder');
  const insideFile = join(folder, 'secret.txt');
  await mkdir(folder, { recursive: true });
  await mkdir(altFolder, { recursive: true });
  await writeFile(insideFile, 'should never be read as lines\n');
  const dialogCalls = [];
  let dialogResult = null;
  const h = await harness(t, {
    frames: [game()],
    folder,
    onDialog: async options => {
      dialogCalls.push(options);
      if (dialogResult) return dialogResult;
      return { canceled: false, filePaths: [options?.properties?.includes('openDirectory') ? folder : join(h.directory, 'coin.nmxplugin')] };
    },
    packageFiles: [
      ['plugin.json', Buffer.from(pluginJson({
        params: [
          { id: 'save_dir', type: 'path', label: 'Save folder', default: '' },
          { id: 'out_dir', type: 'directory', label: 'Output folder', default: '' }
        ],
        input: { modes: ['foreground'], keys: ['enter'] },
        actions: {
          left: { label: 'Left', steps: [{ text: '{{param:save_dir}}', submit: true }] },
          right: { label: 'Right', steps: [{ wait: 10 }] },
          wait: { label: 'Wait', steps: [{ wait: 10 }] }
        }
      }))],
      ['templates/coin.png', PNG]
    ]
  });
  const picked = await h.call('nextmux:app-plugins:pick-folder', baseDir);
  assert.deepEqual(picked, { canceled: false, path: folder });
  const inspected = await h.call('nextmux:plugins:inspect', 'en');
  assert.equal(inspected.ok, true);
  await h.call('nextmux:plugins:install', inspected.token);

  // Picker handler opens native folder dialog with ['openDirectory', 'createDirectory'], never treating a label as a path.
  dialogCalls.length = 0;
  dialogResult = { canceled: false, filePaths: [`${folder}/../chosen-plugin-folder/`] };
  const pickedParam = await h.call('nextmux:plugins:pick-param-file', 'com.example.coin-catcher', 'save_dir', 'Save folder');
  assert.equal(dialogCalls.length, 1);
  assert.deepEqual(dialogCalls[0].properties, ['openDirectory', 'createDirectory']);
  assert.equal(pickedParam.ok, true);
  assert.equal(pickedParam.path, folder);
  assert.equal(pickedParam.params.save_dir, folder);
  const savedState = () => readFile(join(h.directory, 'app-plugins', 'state.json'), 'utf8').then(raw => JSON.parse(raw).plugins['com.example.coin-catcher'].params);
  assert.equal((await savedState()).save_dir, folder, 'chosen folder persists as saved default');

  // Cancelling the folder picker returns { ok: true, cancelled: true } and keeps the previous saved default.
  dialogResult = { canceled: true, filePaths: [] };
  const cancelled = await h.call('nextmux:plugins:pick-param-file', 'com.example.coin-catcher', 'save_dir', 'Save folder');
  assert.deepEqual(cancelled, { ok: true, cancelled: true });
  assert.equal((await savedState()).save_dir, folder);

  // Alias type "directory" also uses the folder picker and normalizes the chosen directory.
  dialogResult = { canceled: false, filePaths: [`${altFolder}/.`] };
  const pickedAlias = await h.call('nextmux:plugins:pick-param-file', 'com.example.coin-catcher', 'out_dir');
  assert.equal(pickedAlias.ok, true);
  assert.equal(pickedAlias.path, altFolder);
  assert.equal(pickedAlias.params.out_dir, altFolder);

  // Reject relative paths, regular files, missing directories, NUL bytes, >4096 chars, and non-strings with distinct param_path_invalid code.
  for (const invalidValue of ['relative/folder', './folder', '../folder', insideFile, join(baseDir, 'missing-dir'), `${folder}\u0000bad`, '/' + 'a'.repeat(4096), 123, true, { path: folder }]) {
    const res = await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { params: { save_dir: invalidValue } });
    assert.equal(res.ok, false, `expected failure for ${JSON.stringify(invalidValue)}`);
    assert.equal(res.error, 'param_path_invalid');
  }
  assert.equal((await savedState()).save_dir, folder, 'rejected values never overwrite saved defaults');

  // Empty path param when running a text step that resolves to empty string reports text_empty in status.
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { params: { save_dir: null }, model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const emptyStarted = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  assert.equal(emptyStarted.ok, true);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  h.answer('left');
  await h.wait(async () => (await h.call('nextmux:plugins:status', emptyStarted.runId)).error === 'text_empty');
  await h.call('nextmux:plugins:stop', emptyStarted.runId);
  h.sent.length = 0;

  // Clearing with null or empty string succeeds, and re-configuring with an unnormalized directory normalizes it.
  assert.equal((await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { params: { save_dir: null } })).ok, true);
  assert.equal((await h.call('nextmux:plugins:list', 'en'))[0].params.save_dir, '');
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { params: { save_dir: `${folder}/.` } });
  const [info] = await h.call('nextmux:plugins:list', 'en');
  assert.equal(info.params.save_dir, folder);

  // Runtime state and {{param:<id>}} substitute the folder path directly without reading folder contents.
  await h.call('nextmux:plugins:configure', 'com.example.coin-catcher', { model: { source: 'nextmux', model: 'typesafe/jev-1.13' } });
  const started = await h.call('nextmux:plugins:start', { conversationId: 'c1', tabId: 't1', pid: 10, windowId: 20, pluginId: 'com.example.coin-catcher' });
  assert.equal(started.ok, true);
  await h.wait(() => h.sent.some(item => item.type === 'decide'));
  const decideReq = h.sent.find(item => item.type === 'decide');
  assert.ok(decideReq.state.includes(`save_dir=${folder}`), decideReq.state);
  assert.ok(!decideReq.state.includes('lines'), decideReq.state);
  h.answer('left');
  await h.wait(() => h.keys.some(item => item.text === folder));
  await h.call('nextmux:plugins:stop', started.runId);
});

test('D5-09 decodeImages logs diagnostic warning when a template image exceeds TEMPLATE_PIXEL_BUDGET', async () => {
  const source = await readFile(new URL('../app-plugins.cjs', import.meta.url), 'utf8');
  assert.match(source, /skippedImages\.add\(signal\.image\)/);
  assert.match(source, /exceeded the \$\{TEMPLATE_PIXEL_BUDGET\}-pixel budget or failed to decode and was skipped/);
});
