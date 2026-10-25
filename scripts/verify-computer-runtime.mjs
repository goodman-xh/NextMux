import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import signatureVerifier from './native-runtime-signature.cjs';

/** Release gate, not a claim that native desktop actions have passed on this OS. */
export function verifyComputerRuntime(resourcesDirectory, { platform = process.platform, architecture = process.arch, packaged = false, machineArchitectures, verifySignature = signatureVerifier.verifyNativeRuntimeSignature, run = spawnSync } = {}) {
  const directory = join(resourcesDirectory, 'computer-runtime', `${platform}-${architecture}`);
  const record = JSON.parse(readFileSync(join(directory, 'complete.json'), 'utf8'));
  assert.equal(record.version, '0.20.9'); assert.equal(record.platform, platform); assert.equal(record.architecture, architecture);
  const expected = platform === 'win32'
    ? ['cua_driver_sdk.dll', 'cua_driver_node_runtime.node', 'qwen-cua-driver-uia.exe', 'qwen-cua-driver.exe']
    : ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node', 'qwen-cua-driver'];
  assert.deepEqual(Object.keys(record.files).sort(), expected.sort());
  for (const document of ['LICENSE.md', 'NOTICE.md', 'THIRD-PARTY-SOURCES.json']) assert.ok(existsSync(join(directory, document)), `Missing computer runtime ${document}`);
  const files = {};
  for (const name of expected) {
    const path = join(directory, name);
    const bytes = readFileSync(path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const architectures = machineArchitectures?.(path);
    if (architectures) assert.ok(architectures.has(architecture), `Computer runtime architecture mismatch: ${name}`);
    let signed = false;
    if (hash !== record.files[name]) {
      assert.ok(packaged && name !== 'qwen-cua-driver-uia.exe', `Computer runtime checksum mismatch: ${name}`);
      verifySignature(path, { platform }); signed = true;
    }
    if (platform === 'win32' && name === 'qwen-cua-driver.exe' && bytes.length >= 0x40) {
      const peOffset = bytes.readUInt32LE(0x3c);
      if (bytes.length >= peOffset + 24 + 70 && bytes.readUInt32LE(peOffset) === 0x00004550) {
        assert.equal(bytes.readUInt16LE(peOffset + 24 + 68), 2, 'The bundled Windows CUA driver must use the GUI subsystem (2) to prevent console window popups');
      }
    }
    if (platform === 'win32' && name === 'qwen-cua-driver-uia.exe') {
      const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `if ((Get-AuthenticodeSignature -LiteralPath '${path.replaceAll("'", "''")}').Status -ne 'Valid') { exit 1 }`], { timeout: 15000 });
      assert.equal(result.status, 0, 'The bundled UIAccess worker must retain a valid upstream signature'); signed = true;
    }
    files[name] = { sha256: hash, ...(architectures ? { architectures: [...architectures] } : {}), signed };
  }
  return { version: record.version, platform, architecture, minimumMacOS: '13.0', files,
    installedWorkerRequired: platform === 'win32', nativeInteractionTested: false };
}
