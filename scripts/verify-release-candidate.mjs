#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import signatures from './native-runtime-signature.cjs';
import { fileDigest } from './release-candidate-ci.mjs';
import { parseUpdateManifest, updateManifestName } from './promote-desktop-updates.mjs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function executableArchitectures(file) {
  const fd = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(8192), length = readSync(fd, bytes, 0, bytes.length, 0);
    assert.ok(length >= 64, 'Truncated executable');
    if (bytes.readUInt16LE(0) === 0x5a4d) {
      const offset = bytes.readUInt32LE(60), pe = Buffer.alloc(6);
      assert.ok(offset >= 64 && offset <= 16 * 1024 ** 2, 'Invalid PE offset');
      assert.equal(readSync(fd, pe, 0, 6, offset), 6); assert.equal(pe.readUInt32LE(0), 0x4550);
      return [({ 0x8664: 'x64', 0xaa64: 'arm64' })[pe.readUInt16LE(4)] || 'unsupported'];
    }
    const cpuName = cpu => ({ 0x01000007: 'x64', 0x0100000c: 'arm64' })[cpu] || 'unsupported';
    if (bytes.readUInt32LE(0) === 0xfeedfacf) return [cpuName(bytes.readUInt32LE(4))];
    const magic = bytes.readUInt32BE(0); assert.ok([0xcafebabe, 0xcafebabf].includes(magic), 'Unsupported Mach-O header');
    const count = bytes.readUInt32BE(4), width = magic === 0xcafebabf ? 32 : 20;
    assert.ok(count > 0 && count <= 32 && 8 + count * width <= length, 'Invalid universal executable');
    return Array.from({ length: count }, (_, i) => cpuName(bytes.readUInt32BE(8 + i * width)));
  } finally { closeSync(fd); }
}
function run(command, args, { env = process.env, timeout = 120_000 } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, env, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} verification failed (exit ${result.status}); no candidate was published`);
  return { command, args, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
export async function validateDownloadedTarget(metadata, platform, arch, directory) {
  const files = metadata.files.filter(file => file.platform === platform && file.arch === arch);
  assert.equal(files.length, 5, 'Complete target files are required');
  for (const file of files) {
    assert.equal((await stat(join(directory, file.fileName))).size, file.size, 'Downloaded artifact size changed');
    assert.equal(await fileDigest(join(directory, file.fileName)), file.sha256, 'Downloaded artifact digest changed');
  }
  const manifestName = updateManifestName(platform, metadata.version), manifest = parseUpdateManifest(await readFile(join(directory, manifestName), 'utf8'));
  assert.equal(manifest.version, metadata.version); assert.equal(manifest.files.length, 1);
  const updater = platform === 'windows' ? `NextMux-${metadata.version}-${arch}-setup.exe` : `NextMux-${metadata.version}-${arch}.zip`;
  assert.equal(manifest.files[0].url, updater); assert.equal(manifest.files[0].size, (await stat(join(directory, updater))).size);
  const hash = createHash('sha512'); for await (const bytes of createReadStream(join(directory, updater))) hash.update(bytes);
  assert.equal(manifest.files[0].sha512, hash.digest('base64'), 'Updater manifest hash mismatch');
  const checksumSource = await readFile(join(directory, `SHA256SUMS-${platform}-${arch}.txt`), 'utf8');
  const sums = new Map();
  for (const line of checksumSource.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) \*([0-9A-Za-z][0-9A-Za-z._+()-]{0,199})$/i.exec(line);
    assert.ok(match && !sums.has(match[2]), 'Malformed or duplicate checksum entry'); sums.set(match[2], match[1].toLowerCase());
  }
  for (const file of files.filter(file => !file.fileName.startsWith('SHA256SUMS-'))) assert.equal(sums.get(file.fileName), file.sha256, 'Uploaded checksum does not match bytes');
  return files;
}
async function inspectApplication(executable, resources, { platform, arch, version, evidence, label, runE2e = true }) {
  signatures.verifyNativeRuntimeSignature(executable, { platform: platform === 'windows' ? 'win32' : 'darwin' });
  assert.ok(executableArchitectures(executable).includes(arch), 'Installed application architecture differs from candidate');
  if (platform === 'macos') {
    const plist = join(dirname(dirname(executable)), 'Info.plist');
    const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]).stdout);
    assert.equal(info.CFBundleIdentifier, 'io.nextmux.desktop'); assert.equal(info.CFBundleShortVersionString, version);
  } else {
    const inspection = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:NEXTMUX_VERSION_FILE); [pscustomobject]@{version=$v.ProductVersion;product=$v.ProductName} | ConvertTo-Json -Compress'],
    { env: { ...process.env, NEXTMUX_VERSION_FILE: executable } });
    const info = JSON.parse(inspection.stdout); assert.equal(info.product, 'NextMux'); assert.equal(info.version, version);
  }
  const commands = [];
  for (const [script, suffix] of [['verify-terminal-native-artifact.mjs', 'terminal'], ['verify-desktop-native-artifacts.mjs', 'native']]) {
    const report = join(evidence, `${label}-${suffix}.json`);
    run(process.execPath, [join(root, 'scripts', script), '--packaged', resources, '--output', report], { timeout: 600_000 });
    commands.push({ kind: suffix, status: 'passed', report: `${label}-${suffix}.json`, sha256: await fileDigest(report) });
  }
  if (runE2e) {
    run(process.execPath, [join(root, 'scripts/desktop-terminal-ci-e2e.mjs')], { timeout: 45 * 60_000,
      env: { ...process.env, NEXTMUX_PACKAGED_EXECUTABLE: executable, NEXTMUX_DESKTOP_E2E_SUITE: 'desktop', NEXTMUX_DESKTOP_E2E_ARTIFACTS: join(evidence, `${label}-e2e`) } });
    commands.push({ kind: 'packaged-desktop-e2e', status: 'passed' });
  }
  return { label, status: 'passed', architecture: arch, identity: 'expected-release-publisher', productVersion: version, checks: commands };
}
async function findPortableFiles(directory, pattern) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await findPortableFiles(path, pattern));
    else if (item.isFile() && pattern.test(item.name)) files.push(path);
  }
  return files;
}
async function inspectPortable(file, temporary, options) {
  // electron-builder's portable.nsi extracts app-64/app-arm64.7z (or zip),
  // unless configured to embed the application directory directly. Inspect
  // that payload, since the NSIS launcher's own PE machine can be x86.
  const sevenZip = join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
  const outer = join(temporary, 'portable-container'); await mkdir(outer);
  run(sevenZip, ['x', file, `-o${outer}`, '-y'], { timeout: 600_000 });
  const archives = await findPortableFiles(outer, /^app-(?:64|arm64)\.(?:7z|zip)$/);
  let payload = outer;
  if (archives.length) {
    assert.equal(archives.length, 1, 'Portable candidate must contain one architecture');
    assert.ok(new RegExp(`app-${options.arch === 'arm64' ? 'arm64' : '64'}\\.(7z|zip)$`).test(archives[0]), 'Portable payload architecture label mismatch');
    payload = join(temporary, 'portable-payload'); await mkdir(payload);
    run(sevenZip, ['x', archives[0], `-o${payload}`, '-y'], { timeout: 600_000 });
  }
  const executables = await findPortableFiles(payload, /^NextMux\.exe$/);
  assert.equal(executables.length, 1, 'Portable application payload missing or ambiguous');
  return inspectApplication(executables[0], join(dirname(executables[0]), 'resources'), { ...options, label: 'portable', runE2e: false });
}
export async function verifyCandidateTarget({ metadata, platform, arch, directory, evidence }) {
  assert.equal(process.platform, platform === 'windows' ? 'win32' : 'darwin'); assert.equal(process.arch, arch, 'Native verification runner architecture mismatch');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Candidate acceptance evidence is generated only in trusted CI');
  assert.match(process.env.GITHUB_SHA || '', /^[a-f0-9]{40}$/); assert.match(metadata.manifestSha256 || '', /^[a-f0-9]{64}$/);
  const files = await validateDownloadedTarget(metadata, platform, arch, directory); await mkdir(evidence, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), 'nm-candidate-verify-')); const checks = [];
  try {
    if (platform === 'macos') {
      const extracted = join(directory, 'candidate-extracted');
      run('python3', [join(root, 'scripts/extract-release-zip.py'), join(directory, `NextMux-${metadata.version}-${arch}.zip`), extracted], { timeout: 600_000 });
      // This verifier checks both extracted ZIP and mounted DMG identities,
      // notarization and hardened runtime before any uploaded code runs.
      run(process.execPath, [join(root, 'scripts/verify-desktop-signing.mjs'), '--release-dir', directory, '--signed', 'true', '--output', join(evidence, 'signing-verifier.json')], { timeout: 600_000 });
      const app = join(extracted, 'NextMux.app', 'Contents');
      checks.push(await inspectApplication(join(app, 'MacOS/NextMux'), join(app, 'Resources'), { platform, arch, version: metadata.version, evidence, label: 'zip' }));
      const mount = join(temporary, 'dmg'); await mkdir(mount);
      run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, join(directory, `NextMux-${metadata.version}-${arch}.dmg`)]);
      try {
        const contents = join(mount, 'NextMux.app', 'Contents');
        checks.push(await inspectApplication(join(contents, 'MacOS/NextMux'), join(contents, 'Resources'), { platform, arch, version: metadata.version, evidence, label: 'dmg' }));
      } finally { run('/usr/bin/hdiutil', ['detach', mount, '-force']); }
    } else {
      // An NSIS launcher may be x86 for an arm64 payload. Verify signatures
      // first, then inspect the actual installed Electron executable.
      run(process.execPath, [join(root, 'scripts/verify-desktop-signing.mjs'), '--release-dir', directory, '--signed', 'true', '--output', join(evidence, 'signing-verifier.json')]);
      const install = join(temporary, 'installed');
      run(join(directory, `NextMux-${metadata.version}-${arch}-setup.exe`), ['/S', `/D=${install}`], { timeout: 600_000 });
      checks.push(await inspectApplication(join(install, 'NextMux.exe'), join(install, 'resources'), { platform, arch, version: metadata.version, evidence, label: 'installed' }));
      checks.push(await inspectPortable(join(directory, `NextMux-${metadata.version}-${arch}-portable.exe`), temporary, { platform, arch, version: metadata.version, evidence }));
      run(process.execPath, [join(root, 'scripts/desktop-terminal-ci-e2e.mjs')], { timeout: 45 * 60_000,
        env: { ...process.env, NEXTMUX_PACKAGED_EXECUTABLE: join(directory, `NextMux-${metadata.version}-${arch}-portable.exe`), NEXTMUX_DESKTOP_E2E_SUITE: 'desktop', NEXTMUX_DESKTOP_E2E_ARTIFACTS: join(evidence, 'portable-e2e') } });
      checks.at(-1).checks.push({ kind: 'packaged-desktop-e2e', status: 'passed' }, { kind: 'portable-launcher-e2e', status: 'passed' });
    }
    const provenance = { kind: 'candidate-import', candidateId: metadata.id, manifestSha256: metadata.manifestSha256,
      verificationCommit: process.env.GITHUB_SHA, sourceBuildCommit: null, sourceQualityGate: 'not_run' };
    await writeFile(join(evidence, 'candidate-verifier.json'), JSON.stringify({ schemaVersion: 1, status: 'verified', platform, arch, version: metadata.version, provenance, checks }) + '\n');
    await writeFile(join(evidence, 'runner.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA, provenance, declared: { platform, architecture: arch },
      runner: { nodePlatform: process.platform, nodeArchitecture: process.arch, githubRunId: process.env.GITHUB_RUN_ID },
      artifacts: files.map(file => ({ path: file.fileName, bytes: file.size, sha256: file.sha256 })) }) + '\n');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
async function main() {
  const args = process.argv.slice(2), options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const metadata = JSON.parse(await readFile(resolve(options['--metadata']), 'utf8'));
  await verifyCandidateTarget({ metadata, platform: options['--platform'], arch: options['--arch'], directory: resolve(options['--directory']), evidence: resolve(options['--evidence']) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
