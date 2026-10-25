import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { identifyNative, inspectNativeFile, scanNativePackage, validateNative, assertNativePtyArtifacts } = require('../native-package-architecture.cjs');
const { packagingTarget, foreignNativeExclusions, foreignMcpNativeExclusions } = require('../electron-builder-targets.cjs');
const asar = createRequire(require.resolve('electron-builder/package.json'))('@electron/asar');
const arm = { platform: 'darwin', arch: 'arm64' }, win = { platform: 'win32', arch: 'arm64' };
function macho(arch, little = true) {
  const bytes = Buffer.alloc(32), write = little ? 'writeUInt32LE' : 'writeUInt32BE';
  bytes[write](0xfeedfacf, 0); bytes[write](arch === 'arm64' ? 0x0100000c : 0x01000007, 4); return bytes;
}
function pe(machine = 0xaa64, flags) {
  const wide = machine !== 0x14c, optionalSize = wide ? 240 : 224, directories = wide ? 112 : 96, sections = 152 + optionalSize;
  const bytes = Buffer.alloc(1024); bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(optionalSize, 148);
  bytes.writeUInt16LE(wide ? 0x20b : 0x10b, 152); bytes.writeUInt32LE(16, 152 + directories - 4);
  bytes.writeUInt32LE(0x2000, sections + 12); bytes.writeUInt32LE(512, sections + 16); bytes.writeUInt32LE(512, sections + 20);
  if (flags !== undefined) {
    bytes.writeUInt32LE(0x2000, 152 + directories + 14 * 8); bytes.writeUInt32LE(72, 152 + directories + 14 * 8 + 4);
    bytes.writeUInt32LE(72, 512); bytes.writeUInt32LE(0x2080, 520); bytes.writeUInt32LE(32, 524); bytes.writeUInt32LE(flags, 528);
    bytes.writeUInt32LE(0x424a5342, 640);
  }
  return bytes;
}
const inspect = bytes => identifyNative({ size: bytes.length, read: (offset, length) => {
  if (offset + length > bytes.length) throw new Error('Truncated fixture'); return bytes.subarray(offset, offset + length);
} });
function directory(t) { const result = mkdtempSync(join(tmpdir(), 'nextmux-architecture-')); t.after(() => rmSync(result, { recursive: true, force: true })); return result; }

test('packaging requires one supported target and rejects ambiguous CLI/programmatic combinations', () => {
  assert.deepEqual(packagingTarget(['--win', '--arm64'], ''), win);
  assert.deepEqual(packagingTarget([], 'darwin-x64'), { platform: 'darwin', arch: 'x64' });
  for (const args of [['--mac', '--win'], ['--x64', '--arm64'], ['--mac', '--universal'], ['--linux', '--x64']]) assert.throws(() => packagingTarget(args, ''), /separate|Unsupported/);
  assert.throws(() => packagingTarget(['--mac'], 'win32-x64'), /conflicts/);
  assert.throws(() => foreignNativeExclusions({ platform: 'darwin' }), /Unsupported/);
  assert.ok(foreignNativeExclusions(arm).includes('!lib/prebuilds/darwin-x64/**/*'));
});

test('thin Mach-O supports both endiannesses and fat headers validate actual slices', () => {
  for (const endian of [false, true]) assert.deepEqual(inspect(macho('arm64', endian)).architectures, ['arm64']);
  const bytes = Buffer.alloc(128); bytes.writeUInt32BE(0xcafebabe, 0); bytes.writeUInt32BE(2, 4);
  for (const [index, cpu, arch] of [[0, 0x01000007, 'x64'], [1, 0x0100000c, 'arm64']]) {
    bytes.writeUInt32BE(cpu, 8 + index * 20); bytes.writeUInt32BE(64 + index * 32, 16 + index * 20); bytes.writeUInt32BE(32, 20 + index * 20); macho(arch).copy(bytes, 64 + index * 32);
  }
  assert.deepEqual(inspect(bytes).architectures, ['x64', 'arm64']);
  bytes.writeUInt32BE(9999, 36); assert.throws(() => inspect(bytes), /fat slice bounds/);
});

test('only valid pure CLR AnyCPU is architecture-neutral, never raw x86 or 32-bit preferred', () => {
  assert.equal(inspect(pe(0x14c, 1)).anyCpu, true);
  for (const flags of [undefined, 0, 3, 0x20001, 0x11]) assert.equal(inspect(pe(0x14c, flags)).anyCpu, false);
  const nativeImage = pe(0x14c, 1); nativeImage.writeUInt32LE(0x2100, 576); assert.equal(inspect(nativeImage).anyCpu, false);
  const malformed = pe(); malformed.writeUInt32LE(0xfffffff0, 60); assert.throws(() => inspect(malformed), /PE offset/);
  const fakeMetadata = pe(0x14c, 1); fakeMetadata.writeUInt32LE(0, 640); assert.throws(() => inspect(fakeMetadata), /CLR metadata/);
});

test('Windows gate scans all resources and accepts AnyCPU while rejecting native x86/x64', t => {
  const root = directory(t); writeFileSync(join(root, 'NextMux.exe'), pe()); writeFileSync(join(root, 'speech.exe'), pe(0x14c, 1));
  assert.equal(scanNativePackage(root, win).binaries.length, 2);
  writeFileSync(join(root, 'other.dll'), pe(0x8664)); writeFileSync(join(root, 'raw-x86.exe'), pe(0x14c));
  assert.throws(() => scanNativePackage(root, win), error => error.report.violations.length === 2);
});

test('foreign binaries hidden inside ASAR and unpacked payloads both fail', async t => {
  for (const unpack of [false, true]) {
    const root = directory(t), stage = join(root, 'stage'), output = join(root, 'output'); mkdirSync(stage); mkdirSync(output);
    writeFileSync(join(stage, 'addon.node'), macho('x64'));
    await asar.createPackageWithOptions(stage, join(output, 'app.asar'), unpack ? { unpack: '*.node' } : {});
    assert.throws(() => scanNativePackage(output, arm, { asar }), /architecture violation/);
  }
});

test('in-bundle links are inspected once and escaping links fail closed', t => {
  const root = directory(t), bundle = join(root, 'bundle'); mkdirSync(bundle); writeFileSync(join(bundle, 'native'), macho('arm64'));
  symlinkSync('native', join(bundle, 'alias')); assert.equal(scanNativePackage(bundle, arm).binaries.length, 1);
  writeFileSync(join(root, 'outside'), macho('arm64')); symlinkSync('../outside', join(bundle, 'escape'));
  assert.throws(() => scanNativePackage(bundle, arm), /escapes/);
});

test('OS mismatch and malformed native extensions cannot pass as non-native assets', t => {
  const root = directory(t); writeFileSync(join(root, 'helper.exe'), pe());
  assert.throws(() => inspectNativeFile(join(root, 'helper.exe'), arm), /architecture mismatch/);
  writeFileSync(join(root, 'helper.exe'), 'text'); assert.throws(() => scanNativePackage(root, win), /Invalid packaged native/);
});

test('final packaging hook catches a foreign helper added by NSIS after afterPack', async t => {
  const previous = process.env.NEXTMUX_PACKAGE_TARGET;
  process.env.NEXTMUX_PACKAGE_TARGET = 'win32-arm64';
  const filename = require.resolve('../electron-builder.config.cjs'); delete require.cache[filename];
  const config = require(filename);
  if (previous === undefined) delete process.env.NEXTMUX_PACKAGE_TARGET; else process.env.NEXTMUX_PACKAGE_TARGET = previous;
  const root = directory(t); writeFileSync(join(root, 'NextMux.exe'), pe());
  const pty = join(root, 'resources/app.asar.unpacked/lib/prebuilds/win32-arm64');
  mkdirSync(join(pty, 'conpty'), { recursive: true });
  for (const file of ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']) writeFileSync(join(pty, file), pe());
  await config.afterPack({ electronPlatformName: 'win32', arch: 3, appOutDir: root, packager: { appInfo: { productFilename: 'NextMux' } } });
  writeFileSync(join(root, 'elevate.exe'), pe(0x14c));
  await assert.rejects(config.afterAllArtifactBuild(), /architecture violation/);
});

test('MCP native exclusions retain the exact OS/CPU launcher destination', () => {
  const builder = createRequire(require.resolve('electron-builder/package.json'));
  const { FileMatcher } = builder('app-builder-lib/out/fileMatcher');
  for (const target of [arm, { platform: 'darwin', arch: 'x64' }, win, { platform: 'win32', arch: 'x64' }]) {
    const root = '/staged-mcp';
    const matcher = new FileMatcher(root, '/output', value => value, ['**/*', ...foreignMcpNativeExclusions(target)]);
    const filter = matcher.createFilter();
    const paths = [
      ['darwin', null, 'Open Computer Use.app/Contents/MacOS/OpenComputerUse'],
      ['win32', 'arm64', 'windows/arm64/open-computer-use.exe'],
      ['win32', 'x64', 'windows/amd64/open-computer-use.exe'],
      ['linux', 'arm64', 'linux/arm64/open-computer-use'],
    ];
    for (const [platform, arch, relative] of paths) {
      assert.equal(filter(`${root}/runtimes/qwen-computer-use/package/dist/${relative}`, { isDirectory: () => false }), platform === target.platform && (arch === null || arch === target.arch));
    }
  }
});


test('all four targets reject foreign binaries in every extra-resource family and require a complete PTY', t => {
  for (const platform of ['darwin', 'win32']) for (const arch of ['arm64', 'x64']) {
    const target = { platform, arch }, root = directory(t), other = arch === 'arm64' ? 'x64' : 'arm64';
    const binary = value => platform === 'darwin' ? macho(value) : pe(value === 'arm64' ? 0xaa64 : 0x8664);
    const names = ['mcp-runtime/axorc', 'git-runtime/git', 'computer-runtime/worker', 'speech/helper', 'native/ffmpeg',
      'app.asar.unpacked/node_modules/trash/lib/macos-trash', `app.asar.unpacked/node_modules/node-pty/prebuilds/${platform}-${other}/pty.node`,
      'app.asar.unpacked/node_modules/onnxruntime-node/runtime', 'app.asar.unpacked/node_modules/@vscode/ripgrep/rg', 'app.asar.unpacked/node_modules/@parcel/watcher/watcher.node'];
    for (const name of names) { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), binary(arch)); }
    assert.equal(scanNativePackage(root, target).binaries.length, names.length);
    for (const name of names) {
      writeFileSync(join(root, name), binary(other));
      assert.throws(() => scanNativePackage(root, target), error => error.report.violations.length === 1 && error.report.violations[0].includes(name));
      writeFileSync(join(root, name), binary(arch));
    }
    const pty = join(root, 'pty'); mkdirSync(pty);
    const required = platform === 'darwin' ? ['pty.node'] : ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'];
    for (const file of required) { mkdirSync(join(pty, file, '..'), { recursive: true }); writeFileSync(join(pty, file), binary(arch)); }
    assert.equal(assertNativePtyArtifacts(pty, target).length, required.length);
    rmSync(join(pty, required.at(-1)));
    assert.throws(() => assertNativePtyArtifacts(pty, target), /ENOENT/);
    if (platform === 'win32') assert.throws(() => validateNative(inspect(pe(0x14c)), target, 'x86.exe'), /mismatch/);
  }
});

test('universal Mach-O needs the actual target slice and cannot alias overlapping slices', () => {
  const bytes = Buffer.alloc(128); bytes.writeUInt32BE(0xcafebabe, 0); bytes.writeUInt32BE(2, 4);
  for (const [index, cpu, arch] of [[0, 0x01000007, 'x64'], [1, 0x0100000c, 'arm64']]) {
    bytes.writeUInt32BE(cpu, 8 + index * 20); bytes.writeUInt32BE(64 + index * 32, 16 + index * 20); bytes.writeUInt32BE(32, 20 + index * 20); macho(arch).copy(bytes, 64 + index * 32);
  }
  for (const arch of ['arm64', 'x64']) assert.ok(validateNative(inspect(bytes), { platform: 'darwin', arch }, 'universal'));
  bytes.writeUInt32BE(1, 4);
  assert.throws(() => validateNative(inspect(bytes), arm, 'universal-x64-only'), /mismatch/);
  bytes.writeUInt32BE(2, 4); bytes.writeUInt32BE(64, 36);
  assert.throws(() => inspect(bytes), /overlapping fat slices/);
});
