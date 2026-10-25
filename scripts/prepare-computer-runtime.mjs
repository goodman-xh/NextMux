#!/usr/bin/env node
/** Build-time only: pin and verify the upstream CUA runtime; installed NM never downloads code. */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = resolve(root, 'apps/desktop/node_modules/@qwen-code/cua-sdk');
const version = '0.20.9';
const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
if (manifest.version !== version) throw Error('CUA SDK and native runtime versions must match');
const { nativeTarget } = await import(pathToFileURL(join(sdk, 'dist/native-assets.js')));
const platform = process.env.NEXTMUX_TARGET_PLATFORM || process.platform;
const architecture = process.env.NEXTMUX_TARGET_ARCH || process.arch;
if (platform !== process.platform || architecture !== process.arch) throw Error('Prepare native assets on their target OS and architecture');
const target = nativeTarget(platform, architecture, version);
const base = `https://github.com/QwenLM/qwen-code/releases/download/cua-driver-rs-v${version}`;
// Values verified against this exact upstream release's checksums.txt.
const pinnedChecksums = {
  'darwin-arm64': '7a99d67e1dda4e275e5297b011700809b0c22af214a01fb3bb615872e3e8d275',
  'darwin-x64': '7a99d67e1dda4e275e5297b011700809b0c22af214a01fb3bb615872e3e8d275',
  'win32-arm64': '9262ed20b72c718cde8548ec4bcf8c1a1f3935cb139fd1cc54e8b6d6d772ad12',
  'win32-x64': '91198f3ac0af7ff6fa0111bca330b08e74cb16c100fa629b17e78ace2d44e640'
};
const destination = join(root, 'apps/desktop/build-resources/computer-runtime', `${platform}-${architecture}`);
const files = [target.library, target.runtime, ...target.companions, platform === 'win32' ? 'qwen-cua-driver.exe' : 'qwen-cua-driver'];
const expected = pinnedChecksums[`${platform}-${architecture}`];
if (!expected) throw Error('Unsupported CUA desktop target');
const fetchFile = async name => {
  // Build hosts can use a system proxy/PAC that Node fetch does not inherit.
  // curl is already present on supported macOS/Windows build runners.
  const { stdout } = await promisify(execFile)(process.platform === 'win32' ? 'curl.exe' : 'curl',
    ['--http1.1', '--proto', '=https', '--location', '--fail', '--silent', '--show-error', '--retry', '2',
      '--connect-timeout', '20', '--max-time', '180', `${base}/${name}`],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  return stdout;
};
let reused = false;
try {
  const cached = JSON.parse(await readFile(join(destination, 'complete.json'), 'utf8'));
  reused = cached.version === version && cached.checksum === expected && cached.platform === platform && cached.architecture === architecture
    && JSON.stringify(Object.keys(cached.files).sort()) === JSON.stringify([...files].sort());
  for (const file of files) reused = reused && createHash('sha256').update(await readFile(join(destination, file))).digest('hex') === cached.files[file];
  if (reused && platform === 'win32') {
    const pe = await readFile(join(destination, 'qwen-cua-driver.exe'));
    const peOffset = pe.readUInt32LE(0x3c);
    reused = pe.readUInt32LE(peOffset) === 0x00004550 && pe.readUInt16LE(peOffset + 24 + 68) === 2;
  }
} catch { reused = false; }
if (!reused) {
  const archive = await fetchFile(target.archive);
  const checksum = createHash('sha256').update(archive).digest('hex');
  if (checksum !== expected) throw Error('CUA archive checksum mismatch');
  const temporary = await mkdtemp(join(tmpdir(), 'nextmux-computer-runtime-'));
  try {
  const archivePath = join(temporary, target.archive); await writeFile(archivePath, archive);
  const extracted = join(temporary, 'extracted'); await mkdir(extracted);
  execFileSync(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', ['-xf', archivePath, '-C', extracted]);
  if (platform === 'win32') {
    const worker = join(extracted, 'qwen-cua-driver-uia.exe').replaceAll("'", "''");
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `if ((Get-AuthenticodeSignature -LiteralPath '${worker}').Status -ne 'Valid') { throw 'Invalid CUA UIAccess worker signature' }`]);
    const driverExe = join(extracted, 'qwen-cua-driver.exe');
    const pe = Buffer.from(await readFile(driverExe));
    const peOffset = pe.readUInt32LE(0x3c);
    if (pe.readUInt32LE(peOffset) === 0x00004550 && pe.readUInt16LE(peOffset + 24 + 68) === 3) {
      pe.writeUInt16LE(2, peOffset + 24 + 68);
      await writeFile(driverExe, pe);
    }
  }
  const hashes = {};
  for (const file of files) hashes[file] = createHash('sha256').update(await readFile(join(extracted, file))).digest('hex');
  await mkdir(destination, { recursive: true });
  for (const file of files) { await cp(join(extracted, file), join(destination, file)); await chmod(join(destination, file), 0o755); }
  await writeFile(join(destination, 'complete.json'), JSON.stringify({ version, platform, architecture, archive: target.archive, source: base, checksum, files: hashes }, null, 2) + '\n');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
for (const file of ['LICENSE.md', 'NOTICE.md']) await cp(join(sdk, file), join(destination, file));
await writeFile(join(destination, 'THIRD-PARTY-SOURCES.json'), JSON.stringify({
    sdk: { name: '@qwen-code/cua-sdk', version, license: 'MIT', source: `https://github.com/QwenLM/qwen-code/tree/cua-driver-rs-v${version}/packages/cua-driver` },
    nativeRuntime: { license: 'MPL-2.0', licenseUrl: 'https://www.mozilla.org/MPL/2.0/',
      source: `https://github.com/QwenLM/qwen-code/blob/cua-driver-rs-v${version}/packages/cua-driver/scripts/build-node-runtime.mjs`,
      upstream: 'https://registry.npmjs.org/uniffi-bindgen-react-native/-/uniffi-bindgen-react-native-0.31.0-3.tgz' }
  }, null, 2) + '\n');
console.log(JSON.stringify({ prepared: true, reused, version, platform, architecture, destination, files }, null, 2));
