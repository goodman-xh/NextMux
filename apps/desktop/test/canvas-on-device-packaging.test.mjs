import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform === 'linux') process.env.NEXTMUX_PACKAGE_TARGET ||= 'darwin-x64';
const require = createRequire(path.join(appDir, 'package.json'));
const targets = require('./electron-builder-targets.cjs');
const config = require('./electron-builder.config.cjs');

test('canvas inference is retained outside asar with its native shared libraries', () => {
  const runtime = targets.runtimePackages();
  assert.ok(runtime.includes('onnxruntime-node'));
  assert.ok(runtime.includes('onnxruntime-common'));
  assert.ok(config.files.includes('node_modules/onnxruntime-node/**/*'));
  for (const entry of ['lib/backend/nextmux-canvas-on-device-worker.js',
    'node_modules/onnxruntime-node/**/*', 'node_modules/onnxruntime-common/**/*']) {
    assert.ok(config.asarUnpack.includes(entry), `Missing unpacked worker dependency: ${entry}`);
  }
});

for (const target of [{ platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' }]) {
  test(`canvas inference ships usable CPU bindings for ${target.platform}/${target.arch}`, () => {
    const runtimeDir = path.dirname(require.resolve('onnxruntime-node/package.json'));
    const bindingDir = path.join(runtimeDir, 'bin', 'napi-v6', target.platform, target.arch);
    assert.ok(fs.existsSync(path.join(bindingDir, 'onnxruntime_binding.node')), `Missing CPU addon: ${bindingDir}`);
    const sharedLibrary = target.platform === 'darwin' ? 'libonnxruntime.1.22.0.dylib' : 'onnxruntime.dll';
    assert.ok(fs.existsSync(path.join(bindingDir, sharedLibrary)), `Missing adjacent shared library: ${bindingDir}`);
    const excluded = targets.foreignNativeExclusions(target);
    assert.ok(!excluded.includes(`!node_modules/onnxruntime-node/bin/napi-v6/${target.platform}/${target.arch}/**/*`));
    assert.ok(excluded.includes('!node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*'));
    const foreign = target.platform === 'darwin' ? 'win32/x64' : 'darwin/arm64';
    assert.ok(excluded.includes(`!node_modules/onnxruntime-node/bin/napi-v6/${foreign}/**/*`));
  });
}
