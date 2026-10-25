import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/build-resources/mcp-runtime/manifest.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'apps/desktop/electron-builder.config.cjs'), 'utf8');
const releaseScript = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).scripts['build:release'];

test('MCP release manifest pins every curated source and never uses mutable latest tags', () => {
  for (const [id, entry] of Object.entries(manifest.runtimes)) {
    assert.match(entry.entry, /^runtimes\/[a-z0-9-]+\/server\.cjs$/i, id);
    assert.ok(entry.source, id);
    assert.equal(entry.source.version.includes('latest'), false, id);
    assert.ok(entry.source.integrity || entry.source.sha256, id);
  }
});

test('electron-builder ships the MCP launcher and manifest outside asar', () => {
  assert.match(builder, /build-resources\/mcp-runtime/);
  assert.match(builder, /nextmux-mcp-runtime-launcher\.cjs/);
  assert.match(builder, /manifest\.json/);
});

test('release build prepares payloads before the production bundle', () => {
  assert.match(releaseScript, /prepare-mcp-runtime\.mjs --fetch/);
});

test('Playwright launcher uses shipped Chromium on clean machines and preserves explicit browser selection', t => {
  const temp = fs.mkdtempSync(path.join(tmpdir(), 'nextmux-mcp-launcher-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const runtime = path.join(temp, 'runtimes', 'playwright');
  const module = path.join(runtime, 'package', 'node_modules', 'playwright-core');
  fs.mkdirSync(module, { recursive: true });
  const executable = path.join(runtime, 'browsers', 'fixture-browser');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '');
  fs.writeFileSync(path.join(module, 'index.js'), `exports.chromium = { executablePath: () => ${JSON.stringify(executable)} };`);
  fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({ runtimes: { playwright: { entry: 'runtimes/playwright/server.cjs' } } }));
  fs.writeFileSync(path.join(runtime, 'server.cjs'), 'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), executable: process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH || null }));');
  const launcher = path.join(root, 'apps/desktop/build-resources/mcp-runtime/nextmux-mcp-runtime-launcher.cjs');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PLAYWRIGHT_')));
  const run = args => spawnSync(process.execPath, [launcher, '--preset', 'playwright', ...args], {
    env: { ...cleanEnv, NEXTMUX_MCP_RUNTIME_ROOT: temp }, encoding: 'utf8', timeout: 5000,
  });
  const defaultBrowser = run(['--headless', '--isolated']);
  assert.equal(defaultBrowser.status, 0, defaultBrowser.stderr);
  assert.deepEqual(JSON.parse(defaultBrowser.stdout), { args: ['--headless', '--isolated'], executable });
  const explicitBrowser = run(['--browser=msedge']);
  assert.equal(explicitBrowser.status, 0, explicitBrowser.stderr);
  assert.deepEqual(JSON.parse(explicitBrowser.stdout), { args: ['--browser=msedge'], executable: null });
  fs.unlinkSync(executable);
  // Installers ship no Chromium: an installed Chrome/Edge is used first.
  const chrome = path.join(temp, 'Google Chrome');
  fs.writeFileSync(chrome, '');
  const installed = spawnSync(process.execPath, [launcher, '--preset', 'playwright'], {
    env: { ...cleanEnv, NEXTMUX_MCP_RUNTIME_ROOT: temp, NEXTMUX_MCP_SYSTEM_BROWSERS: chrome, NEXTMUX_DESKTOP_STATE_DIR: path.join(temp, 'state') }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).executable, chrome);
  // Neither shipped nor installed: Playwright's own installer runs once into NextMux's data folder,
  // and its output never reaches stdout (reserved for MCP JSON-RPC).
  fs.writeFileSync(path.join(module, 'index.js'), `exports.chromium = { executablePath: () => require('path').join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium', 'chrome') };`);
  fs.writeFileSync(path.join(module, 'cli.js'), `const fs = require('fs'), path = require('path'); const target = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium', 'chrome'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, ''); console.log('Downloading Chromium… done');`);
  const state = path.join(temp, 'state');
  const offline = { ...cleanEnv, NEXTMUX_MCP_RUNTIME_ROOT: temp, NEXTMUX_MCP_SYSTEM_BROWSERS: '', NEXTMUX_DESKTOP_STATE_DIR: state };
  const downloaded = spawnSync(process.execPath, [launcher, '--preset', 'playwright'], { env: offline, encoding: 'utf8', timeout: 5000 });
  assert.equal(downloaded.status, 0, downloaded.stderr);
  assert.equal(JSON.parse(downloaded.stdout).executable, path.join(state, 'mcp-browsers', 'chromium', 'chrome'), 'stdout carries only the server output');
  assert.match(downloaded.stderr, /downloading the Chromium build Playwright uses/);
  assert.match(downloaded.stderr, /Downloading Chromium… done/);
  // The next start reuses it without downloading again.
  const again = spawnSync(process.execPath, [launcher, '--preset', 'playwright'], { env: offline, encoding: 'utf8', timeout: 5000 });
  assert.doesNotMatch(again.stderr, /downloading/);
  // An installer that cannot fetch anything ends with a clear message.
  fs.rmSync(path.join(state, 'mcp-browsers'), { recursive: true, force: true });
  fs.writeFileSync(path.join(module, 'cli.js'), 'process.exit(1);');
  const missing = spawnSync(process.execPath, [launcher, '--preset', 'playwright'], { env: offline, encoding: 'utf8', timeout: 5000 });
  assert.equal(missing.status, 78);
  assert.match(missing.stderr, /install Google Chrome or Microsoft Edge/);
});

test('installers leave Playwright\'s Chromium and other systems\' native builds out, keeping every run-time package', () => {
  if (process.platform === 'linux') process.env.NEXTMUX_PACKAGE_TARGET ||= 'darwin-x64';
  const require = createRequire(import.meta.url);
  const config = require(path.join(root, 'apps/desktop/electron-builder.config.cjs'));
  const targets = require(path.join(root, 'apps/desktop/electron-builder-targets.cjs'));
  const mcp = [...config.extraResources].find(resource => resource.to === 'mcp-runtime');
  assert.ok(mcp.filter.includes('!runtimes/playwright/browsers/**'));
  assert.deepEqual(targets.packagingTarget(['--mac', '--arm64'], ''), { platform: 'darwin', arch: 'arm64' });
  assert.throws(() => targets.packagingTarget(['--win', '--x64', '--arm64'], ''), /separate/);
  const mac = targets.foreignNativeExclusions({ platform: 'darwin', arch: 'arm64' });
  assert.ok(mac.includes('!node_modules/@ffmpeg-installer/darwin-x64/**/*') && mac.includes('!node_modules/@ffmpeg-installer/linux-x64/**/*'));
  assert.ok(!mac.some(pattern => pattern.includes('darwin-arm64')), 'the target system keeps its own builds');
  const packages = targets.runtimePackages();
  for (const name of ['@qwen-code/cua-sdk', 'puppeteer-core', 'electron-updater', 'typescript', '@vscode/tree-sitter-wasm', '@anthropic-ai/sandbox-runtime', 'ws']) {
    assert.ok(packages.includes(name), name);
  }
  // FFmpeg is downloaded after installation (Settings → Downloads), never shipped.
  assert.ok(!packages.some(name => name.startsWith('@ffmpeg-installer/')), 'FFmpeg stays out of the installer');
  assert.ok(!packages.includes('@theia/monaco-editor-core'), 'bundled JavaScript is not shipped twice');
  assert.deepEqual(config.files.filter(pattern => pattern.startsWith('!node_modules/**')), ['!node_modules/**/*']);
});

test('release preparation includes the pinned browser and rejects cross-architecture preparation', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/prepare-mcp-runtime.mjs'), 'utf8');
  assert.match(source, /'install', 'chromium', '--no-shell'/);
  assert.match(source, /PLAYWRIGHT_BROWSERS_PATH: join\(target, 'browsers'\)/);
  assert.match(source, /targetPlatform !== process.platform \|\| targetArchitecture !== process.arch/);
});
