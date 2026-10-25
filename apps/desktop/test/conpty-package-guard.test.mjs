import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertNativePtyArtifacts, scanNativePackage } = require('../native-package-architecture.cjs');
const { foreignNativeExclusions } = require('../electron-builder-targets.cjs');
const required = ['conpty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'];

function pe(arch, managed = false) {
  const machine = managed ? 0x14c : arch === 'arm64' ? 0xaa64 : 0x8664;
  const wide = machine !== 0x14c, optionalSize = wide ? 240 : 224, directories = wide ? 112 : 96;
  const bytes = Buffer.alloc(1024), sections = 152 + optionalSize;
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(optionalSize, 148);
  bytes.writeUInt16LE(wide ? 0x20b : 0x10b, 152); bytes.writeUInt32LE(16, 152 + directories - 4);
  bytes.writeUInt32LE(0x2000, sections + 12); bytes.writeUInt32LE(512, sections + 16); bytes.writeUInt32LE(512, sections + 20);
  if (managed) {
    bytes.writeUInt32LE(0x2000, 152 + directories + 14 * 8); bytes.writeUInt32LE(72, 152 + directories + 14 * 8 + 4);
    bytes.writeUInt32LE(72, 512); bytes.writeUInt32LE(0x2080, 520); bytes.writeUInt32LE(32, 524);
    bytes.writeUInt32LE(1, 528); bytes.writeUInt32LE(0x424a5342, 640);
  }
  return bytes;
}
function temp(t) {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-conpty-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function complete(root, arch) {
  mkdirSync(join(root, 'conpty'), { recursive: true });
  for (const file of required) writeFileSync(join(root, file), pe(arch));
}
function configFor(arch) {
  const prior = process.env.NEXTMUX_PACKAGE_TARGET;
  try {
    process.env.NEXTMUX_PACKAGE_TARGET = `win32-${arch}`;
    const path = require.resolve('../electron-builder.config.cjs'); delete require.cache[path];
    return require(path);
  } finally {
    if (prior === undefined) delete process.env.NEXTMUX_PACKAGE_TARGET;
    else process.env.NEXTMUX_PACKAGE_TARGET = prior;
  }
}
function packaged(root, arch) {
  writeFileSync(join(root, 'NextMux.exe'), pe(arch));
  const base = join(root, 'resources', 'app.asar.unpacked', 'lib', 'prebuilds', `win32-${arch}`);
  complete(base, arch);
  return base;
}
function context(root, arch) {
  return { electronPlatformName: 'win32', arch, appOutDir: root, packager: { appInfo: { productFilename: 'NextMux' } } };
}

for (const arch of ['x64', 'arm64']) {
  const target = { platform: 'win32', arch };
  test(`${arch}: complete required set passes target architecture inspection`, t => {
    const root = temp(t); complete(root, arch);
    const report = assertNativePtyArtifacts(root, target);
    assert.equal(report.length, 4);
    assert.ok(report.every(row => row.platform === 'win32' && row.architectures.includes(arch) && !row.anyCpu));
  });
  for (const file of required) {
    test(`${arch}: missing ${file} cannot pass even though present-file scan passes`, t => {
      const root = temp(t); complete(root, arch); rmSync(join(root, file));
      assert.equal(scanNativePackage(root, target).binaries.length, 3);
      assert.throws(() => assertNativePtyArtifacts(root, target), error => error.code === 'ENOENT');
    });
    test(`${arch}: wrong PE architecture in ${file} is rejected`, t => {
      const root = temp(t); complete(root, arch); writeFileSync(join(root, file), pe(arch === 'arm64' ? 'x64' : 'arm64'));
      assert.throws(() => assertNativePtyArtifacts(root, target), /architecture mismatch/);
    });
    test(`${arch}: afterPack rejects missing ${file}`, async t => {
      const root = temp(t), pty = packaged(root, arch); rmSync(join(pty, file));
      await assert.rejects(configFor(arch).afterPack(context(root, arch)), error => error.code === 'ENOENT');
    });
    test(`${arch}: final artifact hook rejects ${file} removed after a passing afterPack`, async t => {
      const root = temp(t), pty = packaged(root, arch), config = configFor(arch);
      await config.afterPack(context(root, arch));
      rmSync(join(pty, file));
      await assert.rejects(config.afterAllArtifactBuild(), error => error.code === 'ENOENT');
    });
  }
  test(`${arch}: text and AnyCPU cannot stand in for native engine`, t => {
    const root = temp(t); complete(root, arch);
    for (const bytes of [Buffer.from('not a native DLL'), pe(arch, true)]) {
      writeFileSync(join(root, 'conpty/conpty.dll'), bytes);
      assert.throws(() => assertNativePtyArtifacts(root, target), /Expected native PTY artifact/);
    }
  });
  test(`${arch}: complete afterPack and final artifact hook pass`, async t => {
    const root = temp(t); packaged(root, arch); const config = configFor(arch);
    await config.afterPack(context(root, arch));
    assert.deepEqual(await config.afterAllArtifactBuild(), []);
  });
}

for (const arch of ['x64', 'arm64']) {
  test(`darwin-${arch}: only existing pty.node required set is added`, t => {
    const root = temp(t), target = { platform: 'darwin', arch };
    assert.throws(() => assertNativePtyArtifacts(root, target), error => error.code === 'ENOENT');
    const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    writeFileSync(join(root, 'pty.node'), bytes);
    assert.equal(assertNativePtyArtifacts(root, target).length, 1);
  });
}

test('actual file matcher omits installation-only third_party engines and retains each target prebuild set', () => {
  const builder = createRequire(require.resolve('electron-builder/package.json'));
  const { FileMatcher } = builder('app-builder-lib/out/fileMatcher');
  for (const platform of ['win32', 'darwin']) for (const arch of ['x64', 'arm64']) {
    const target = { platform, arch }, root = '/staged';
    const filter = new FileMatcher(root, '/output', value => value, ['**/*', ...foreignNativeExclusions(target)]).createFilter();
    for (const engineArch of ['x64', 'arm64']) {
      for (const file of ['conpty.dll', 'OpenConsole.exe']) {
        assert.equal(filter(`${root}/node_modules/node-pty/third_party/conpty/1.25.260303002/win10-${engineArch}/${file}`, { isDirectory: () => false }), false);
      }
      for (const file of required) {
        for (const prefix of ['lib', 'node_modules/node-pty']) {
          assert.equal(filter(`${root}/${prefix}/prebuilds/win32-${engineArch}/${file}`, { isDirectory: () => false }), platform === 'win32' && arch === engineArch);
        }
      }
    }
  }
});
