import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import signatures from '../../../scripts/native-runtime-signature.cjs';
import assets from '../../../scripts/git-runtime-assets.cjs';
import { verifyComputerRuntime } from '../../../scripts/verify-computer-runtime.mjs';

if (process.platform === 'linux') process.env.NEXTMUX_PACKAGE_TARGET ||= 'darwin-x64';
const require = createRequire(import.meta.url);
const nativeBytes = platform => {
  const bytes = Buffer.alloc(128);
  if (platform === 'win32') { bytes.writeUInt16LE(0x5a4d); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); }
  else { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x01000007, 4); }
  return bytes;
};
const temporary = async t => { const root = await mkdtemp(join(tmpdir(), 'nm-runtime-signature-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };

test('installed electron-builder filter preserves the pinned UIAccess worker while signing other EXEs', () => {
  const desktopRequire = createRequire(new URL('../package.json', import.meta.url));
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
  builderRequire('app-builder-lib'); // Initialize the package entry before its mutually importing packager classes.
  const { WinPackager } = builderRequire('app-builder-lib/out/winPackager.js');
  const { win } = require('../electron-builder.config.cjs');
  const context = { platformSpecificBuildOptions: win };
  for (const path of ['qwen-cua-driver-uia.exe', 'C:\\app\\resources\\computer-runtime\\win32-x64\\qwen-cua-driver-uia.exe']) {
    assert.equal(WinPackager.prototype.shouldSignFile.call(context, path), false);
    assert.equal(WinPackager.prototype.shouldSignFile.call(context, path, true), false);
  }
  for (const path of ['NextMux.exe', 'qwen-cua-driver.exe', 'C:\\app\\resources\\git-runtime\\cmd\\git.exe']) {
    assert.equal(WinPackager.prototype.shouldSignFile.call(context, path), true);
  }
});

for (const platform of ['win32', 'darwin']) test(`${platform}: changed runtime signature must be valid and match the configured release identity`, async t => {
  const root = await temporary(t), file = join(root, 'native'); await writeFile(file, nativeBytes(platform));
  const environment = { WINDOWS_PUBLISHER_NAME: 'NextMux Company', APPLE_TEAM_ID: 'TEAM123456' };
  let status = 0, identity = platform === 'win32' ? 'NextMux Company' : 'TEAM123456', valid = true, calls = 0;
  const run = (_command, args, options) => {
    calls++;
    if (platform === 'win32') {
      assert.equal(options.env.NEXTMUX_RUNTIME_SIGNATURE_FILE, file);
      assert.ok(!args.at(-1).includes(file), 'the path is an environment value, never interpolated shell code');
      return { status, stdout: JSON.stringify({ status: valid ? 'Valid' : 'HashMismatch', publisher: identity }) };
    }
    return { status: valid ? status : 1, stdout: '', stderr: args[0] === '-d' ? `TeamIdentifier=${identity}\n` : '' };
  };
  signatures.verifyNativeRuntimeSignature(file, { platform, environment, run });
  assert.ok(calls > 0);
  identity = 'unrelated-publisher';
  assert.throws(() => signatures.verifyNativeRuntimeSignature(file, { platform, environment, run }), /unexpected/);
  identity = platform === 'win32' ? 'NextMux Company' : 'TEAM123456'; valid = false;
  assert.throws(() => signatures.verifyNativeRuntimeSignature(file, { platform, environment, run }), /invalid/);
  valid = true; status = 1;
  assert.throws(() => signatures.verifyNativeRuntimeSignature(file, { platform, environment, run }), /failed|invalid/);
  assert.throws(() => signatures.verifyNativeRuntimeSignature(file, { platform, environment: {}, run }), /required/);
  const before = calls; await writeFile(file, '#!/bin/sh\necho not-a-native-binary');
  assert.throws(() => signatures.verifyNativeRuntimeSignature(file, { platform, environment, run }), /not a native/);
  assert.equal(calls, before);
});

for (const platform of ['win32', 'darwin']) test(`${platform}: computer release hash exceptions require signatures; UIAccess always keeps the pinned bytes`, async t => {
  const root = await temporary(t), target = join(root, 'computer-runtime', `${platform}-x64`); await mkdir(target, { recursive: true });
  const names = platform === 'win32' ? ['cua_driver_sdk.dll', 'cua_driver_node_runtime.node', 'qwen-cua-driver-uia.exe', 'qwen-cua-driver.exe']
    : ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node', 'qwen-cua-driver'];
  const files = {};
  for (const name of names) { const bytes = nativeBytes(platform); await writeFile(join(target, name), bytes); files[name] = createHash('sha256').update(bytes).digest('hex'); }
  for (const name of ['LICENSE.md', 'NOTICE.md', 'THIRD-PARTY-SOURCES.json']) await writeFile(join(target, name), 'fixture');
  await writeFile(join(target, 'complete.json'), JSON.stringify({ version: '0.20.9', platform, architecture: 'x64', files }));
  const checked = [], options = { platform, architecture: 'x64', run: () => ({ status: 0 }), verifySignature: file => { checked.push(file); } };
  verifyComputerRuntime(root, options); assert.equal(checked.length, 0);
  const executable = platform === 'win32' ? 'qwen-cua-driver.exe' : 'qwen-cua-driver';
  await writeFile(join(target, executable), Buffer.concat([nativeBytes(platform), Buffer.from('signed') ]));
  assert.throws(() => verifyComputerRuntime(root, options), /checksum mismatch/);
  verifyComputerRuntime(root, { ...options, packaged: true }); assert.deepEqual(checked, [join(target, executable)]);
  assert.throws(() => verifyComputerRuntime(root, { ...options, packaged: true, verifySignature: () => { throw Error('bad signer'); } }), /bad signer/);
  if (platform === 'win32') {
    await writeFile(join(target, executable), nativeBytes(platform));
    await writeFile(join(target, 'qwen-cua-driver-uia.exe'), Buffer.concat([nativeBytes(platform), Buffer.from('resigned') ]));
    assert.throws(() => verifyComputerRuntime(root, { ...options, packaged: true }), /checksum mismatch: qwen-cua-driver-uia.exe/);
  }
});

for (const platform of ['win32', 'darwin']) test(`${platform}: Git release checks changed executable signatures but never relaxes other inventory hashes`, async t => {
  const root = await temporary(t), info = assets.targetInfo(platform, 'x64');
  for (const name of new Set([info.binary, info.coreBinary, info.uploadPack, `${info.execPath}/${platform === 'win32' ? 'git.exe' : 'git'}`,
    'share/git-core/templates/description', 'licenses/Git-GPL-2.0.txt', 'licenses/dugite-MIT.txt', 'SOURCE-PROVENANCE.json'])) {
    await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), nativeBytes(platform));
  }
  await writeFile(join(root, 'complete.json'), JSON.stringify({ schema: 1, release: assets.manifest.release, platform, architecture: 'x64',
    archive: info.archive, archiveSha256: info.sha256, ...await assets.inventory(root) }));
  await writeFile(join(root, info.binary), Buffer.concat([await readFile(join(root, info.binary)), Buffer.from('signed')]));
  const checked = [], options = { platform, architecture: 'x64', verifySignature: file => { checked.push(file); } };
  await assert.rejects(assets.verifyGitRuntime(root, options), /integrity mismatch/);
  await assets.verifyGitRuntime(root, { ...options, packaged: true }); assert.deepEqual(checked, [join(root, info.binary)]);
  await assert.rejects(assets.verifyGitRuntime(root, { ...options, packaged: true, verifySignature: () => { throw Error('bad signer'); } }), /bad signer/);
  await writeFile(join(root, 'licenses/Git-GPL-2.0.txt'), 'changed license');
  await assert.rejects(assets.verifyGitRuntime(root, { ...options, packaged: true }), /integrity mismatch/);
});
