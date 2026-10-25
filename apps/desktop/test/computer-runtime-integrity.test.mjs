import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { ComputerAutomation } = createRequire(import.meta.url)('../computer-automation.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
function peImage(architecture, subsystem = 2) {
  const image = Buffer.alloc(512), pe = 128;
  image.writeUInt16LE(0x5a4d, 0); image.writeUInt32LE(pe, 0x3c);
  image.writeUInt32LE(0x4550, pe); image.writeUInt16LE(architecture === 'arm64' ? 0xaa64 : 0x8664, pe + 4);
  image.writeUInt16LE(240, pe + 20); image.writeUInt16LE(0x20b, pe + 24); image.writeUInt16LE(subsystem, pe + 24 + 68);
  return image;
}
function verifyFixture(architecture, image, changeManifest, shouldPass = false, name = 'qwen-cua-driver.exe') {
  const directory = mkdtempSync(join(tmpdir(), 'nextmux-runtime-integrity-test-'));
  try {
    const engine = new ComputerAutomation({ platform: 'win32', architecture, resourcesPath: directory });
    mkdirSync(engine.runtimeRoot, { recursive: true });
    const binary = join(engine.runtimeRoot, name);
    const manifest = { version: '0.20.9', platform: 'win32', architecture, files: { [name]: sha(image) } };
    changeManifest?.(manifest);
    writeFileSync(binary, image);
    writeFileSync(join(engine.runtimeRoot, 'complete.json'), JSON.stringify(manifest));
    const before = statSync(binary, { bigint: true });
    if (shouldPass) assert.equal(engine.ensureWindowsGuiBinary(binary, name), binary);
    else assert.throws(() => engine.ensureWindowsGuiBinary(binary, name), { code: 'computer_runtime_invalid' });
    const after = statSync(binary, { bigint: true });
    assert.deepEqual(readFileSync(binary), image, 'installed bytes remain untouched');
    assert.equal(after.mtimeNs, before.mtimeNs, 'no runtime rewrite');
    assert.deepEqual(readdirSync(engine.runtimeRoot).sort(), ['complete.json', name]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

for (const architecture of ['arm64', 'x64']) test(`accepts a prepared ${architecture} GUI driver with its exact final hash`, () => {
  verifyFixture(architecture, peImage(architecture), undefined, true);
});
test('rejects an old console driver instead of mutating or silently launching it', () => {
  verifyFixture('x64', peImage('x64', 3));
});
test('UIAccess worker must independently satisfy the hidden GUI and hash contract', () => {
  verifyFixture('x64', peImage('x64'), undefined, true, 'qwen-cua-driver-uia.exe');
  verifyFixture('x64', peImage('x64', 3), undefined, false, 'qwen-cua-driver-uia.exe');
  verifyFixture('x64', peImage('x64'), manifest => { manifest.files['qwen-cua-driver-uia.exe'] = '0'.repeat(64); }, false, 'qwen-cua-driver-uia.exe');
});
test('rejects a foreign architecture even when its manifest hash is internally consistent', () => {
  verifyFixture('arm64', peImage('x64'));
});
test('rejects a changed installed driver whose recorded hash no longer matches', () => {
  verifyFixture('x64', peImage('x64'), manifest => { manifest.files['qwen-cua-driver.exe'] = '0'.repeat(64); });
});
test('rejects a runtime manifest for a different platform, architecture or version', () => {
  for (const field of ['platform', 'architecture', 'version']) verifyFixture('x64', peImage('x64'), manifest => { manifest[field] = 'unexpected'; });
});
test('rejects malformed and truncated PE headers without falling back to the input path', () => {
  const mutations = [
    image => image.subarray(0, 40),
    image => { image.writeUInt16LE(0, 0); return image; },
    image => { image.writeUInt32LE(0xfffffff0, 0x3c); return image; },
    image => { image.writeUInt32LE(0, 128); return image; },
    image => { image.writeUInt16LE(70, 148); return image; },
    image => { image.writeUInt16LE(0x10b, 152); return image; },
    image => { image.writeUInt16LE(600, 148); return image; }
  ];
  for (const mutate of mutations) verifyFixture('x64', mutate(peImage('x64')));
});
