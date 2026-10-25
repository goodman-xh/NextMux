import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app-plugins.cjs', import.meta.url), 'utf8');
const runtimeId = '@nextmux/model-runtime/decision-adapter';
const extensionId = '@nextmux/theia-extension/package.json';
const runtime = { decisionPluginCompatibility: () => '', isTevDecisionModel: () => false };
function isolated(mode) {
  const calls = [];
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' }); };
  const loader = id => {
    if (id === runtimeId) { calls.push(id); return mode === 'packaged' ? runtime : missing(); }
    if (id === 'node:module') return { createRequire: () => id => { calls.push(`extension:${id}`); return mode === 'development' ? runtime : missing(); } };
    return require(id.startsWith('./') ? `../${id.slice(2)}` : id);
  };
  loader.resolve = id => { calls.push(`resolve:${id}`); return mode === 'development' ? '/extension/package.json' : missing(); };
  const module = { exports: {} };
  runInNewContext(source, { require: loader, module, Buffer, URL, process, setTimeout, clearTimeout, AbortController });
  return { api: module.exports, calls };
}

test('packaged and pnpm layouts load the decision adapter lazily, preferring the top-level runtime', () => {
  for (const mode of ['packaged', 'development', 'missing']) {
    const { api, calls } = isolated(mode);
    assert.equal(calls.length, 0, 'loading app-plugins never resolves the optional runtime');
    assert.equal(api.normalizeModel({ source: 'local', model: 'jev', endpoint: 'http://localhost:8000' }).model, 'jev');
    assert.equal(calls[0], runtimeId);
    if (mode === 'packaged') assert.deepEqual(calls, [runtimeId]);
    else assert.ok(calls.includes(`resolve:${extensionId}`));
  }
});

test('missing decision runtime reports readiness and start errors without crashing registration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-missing-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = 'com.example.runtime';
  const folder = join(directory, 'app-plugins', 'installed', id);
  await mkdir(folder, { recursive: true });
  const manifest = { schema: 'nextmux.app-plugin/1', id, version: '1.0.0', name: 'Runtime', description: 'Runtime test', author: { name: 'Test' },
    apps: [{ platform: 'macos', bundleId: 'com.example.app' }], input: { keys: ['a'] }, perception: { signals: [] },
    actions: { press: { steps: [{ key: 'a' }] }, wait: { steps: [{ wait: 1 }] } },
    decisions: [{ id: 'next', type: 'choice', options: ['press', 'wait'], fallback: 'wait', question: 'Which?' }] };
  await writeFile(join(folder, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'app-plugins', 'state.json'), JSON.stringify({ plugins: { [id]: { enabled: true, model: { source: 'nextmux', model: 'jev' } } } }));
  const { api } = isolated('missing');
  const handlers = new Map();
  const plugins = api.registerAppPlugins({ ipcMain: { handle: (id, fn) => handlers.set(id, fn) }, app: { getPath: () => directory, getVersion: () => '2.0.0' },
    input: {}, trusted: () => true, platform: 'darwin', secureStorage: null, view: { canView: () => true } });
  t.after(() => plugins.dispose());
  const [listed] = await handlers.get('nextmux:plugins:list')({}, 'en');
  assert.equal(listed.ok, true, JSON.stringify(listed)); assert.equal(listed.ready, false);
  assert.equal(listed.modelCompatibilityError, 'plugin_runtime_unavailable');
  const start = await handlers.get('nextmux:plugins:start')({}, { conversationId: 'c1', tabId: 't1', pluginId: id, pid: 10, windowId: 20 });
  assert.equal(start.error, 'plugin_runtime_unavailable');
});

test('all twelve locales explain invalid formats and runtime failures without generic retry text', () => {
  const { buildSync } = require('esbuild');
  const entry = new URL('../../../packages/theia-nextmux-extension/src/browser/nextmux-app-plugin-runtime-locale.ts', import.meta.url);
  const { outputFiles } = buildSync({ entryPoints: [entry.pathname], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const module = { exports: {} };
  runInNewContext(outputFiles[0].text, { module, exports: module.exports, require, console });
  for (const locale of require('../app-plugin-core.cjs').LOCALES) {
    for (const error of ['package_format_unsupported', 'package_corrupt', 'package_manifest_missing', 'plugin_invalid', 'package_duplicate', 'package_file_size', 'package_read_failed']) {
      const message = module.exports.appPluginPackageError(locale, error);
      // The copy lists the formats users are asked to bring; .nmxplugin (NextMux's own export) stays accepted by the picker.
      for (const format of ['.zip', '.jevplugin', '.tar.gz', '.tgz', 'plugin.json', 'manifest.json']) assert.ok(message.includes(format), `${locale}/${error}/${format}`);
      assert.doesNotMatch(message, /没有完成，请稍后重试/);
    }
    assert.match(module.exports.appPluginPackageError(locale, 'plugin_runtime_unavailable'), /NextMux/);
  }
  const view = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/browser/nextmux-app-plugins-view.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /props\.onToggle\(|plugin\.enabled/);
});
