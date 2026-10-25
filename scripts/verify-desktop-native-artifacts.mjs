#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPackageFileBoundary } from './verify-package-file-boundary.mjs';
import { verifyComputerRuntime } from './verify-computer-runtime.mjs';
import gitAssets from './git-runtime-assets.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopPackagePath = join(root, 'apps', 'desktop', 'package.json');
const desktopRequire = createRequire(desktopPackagePath);
const extensionPackagePath = join(root, 'packages', 'theia-nextmux-extension', 'package.json');
const extensionRequire = createRequire(extensionPackagePath);
const platformDirectory = `${process.platform}-${process.arch}`;
const MACOS_DEPLOYMENT_TARGET = '12.0';

function runningUnderRosetta() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') return false;
  const result = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], {
    encoding: 'utf8', timeout: 5_000,
  });
  return result.status === 0 && result.stdout.trim() === '1';
}

const rosettaQualification = runningUnderRosetta();
const nativeProbeTimeout = rosettaQualification ? 300_000 : 20_000;

function sha256(pathname) {
  return createHash('sha256').update(readFileSync(pathname)).digest('hex');
}

function displayPath(pathname) {
  const local = relative(root, pathname);
  return (local.startsWith('..') ? pathname : local).replaceAll('\\', '/');
}

function machineArchitectures(pathname, platform = process.platform) {
  const bytes = readFileSync(pathname);
  if (platform === 'win32') {
    assert.ok(bytes.length >= 0x40, `${pathname} has a truncated PE header`);
    assert.equal(bytes.toString('ascii', 0, 2), 'MZ', `${pathname} is not a PE binary`);
    const peOffset = bytes.readUInt32LE(0x3c);
    assert.ok(peOffset >= 0x40 && peOffset + 6 <= bytes.length, `${pathname} has an invalid PE offset`);
    assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', `${pathname} has no PE signature`);
    const machine = bytes.readUInt16LE(peOffset + 4);
    return new Set([machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : `pe-${machine.toString(16)}`]);
  }

  const littleMagic = bytes.readUInt32LE(0);
  if (littleMagic === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    return new Set([cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `macho-${cpu.toString(16)}`]);
  }
  const bigMagic = bytes.readUInt32BE(0);
  assert.ok(bigMagic === 0xcafebabe || bigMagic === 0xcafebabf, `${pathname} is not a Mach-O binary`);
  const count = bytes.readUInt32BE(4);
  const entrySize = bigMagic === 0xcafebabf ? 32 : 20;
  const architectures = new Set();
  for (let index = 0; index < count; index += 1) {
    const cpu = bytes.readUInt32BE(8 + index * entrySize);
    architectures.add(cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `macho-${cpu.toString(16)}`);
  }
  return architectures;
}

function macosMinimumVersions(pathname) {
  const result = spawnSync('/usr/bin/vtool', ['-show-build', pathname], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0,
    `Unable to inspect the macOS deployment target for ${pathname}: ${result.stderr || result.error || ''}`);
  // Newer binaries use LC_BUILD_VERSION/minos while valid older x64 native
  // modules can still use LC_VERSION_MIN_MACOSX/version. Track the load
  // command so a compiler-tool "version" line is not mistaken for min macOS.
  const versions = [];
  let loadCommand = '';
  for (const line of result.stdout.split(/\r?\n/)) {
    const command = /^\s*cmd\s+(LC_\S+)\s*$/.exec(line);
    if (command) loadCommand = command[1];
    const field = loadCommand === 'LC_BUILD_VERSION' ? 'minos'
      : loadCommand === 'LC_VERSION_MIN_MACOSX' ? 'version'
        : undefined;
    if (!field) continue;
    const value = new RegExp(`^\\s*${field}\\s+(\\d+(?:\\.\\d+){0,2})\\s*$`).exec(line);
    if (value) versions.push(value[1]);
  }
  assert.ok(versions.length > 0, `${pathname} has no macOS minimum-version load command`);
  const versionNumber = value => {
    const [major = 0, minor = 0, patch = 0] = value.split('.').map(Number);
    return major * 1_000_000 + minor * 1_000 + patch;
  };
  for (const version of versions) {
    assert.ok(versionNumber(version) <= versionNumber(MACOS_DEPLOYMENT_TARGET),
      `${pathname} requires macOS ${version}, which exceeds the supported ${MACOS_DEPLOYMENT_TARGET} baseline`);
  }
  return [...new Set(versions)];
}

function inspectBinary(pathname, { platform = process.platform, architecture = process.arch } = {}) {
  assert.ok(existsSync(pathname), `Missing native desktop artifact: ${pathname}`);
  const architectures = [...machineArchitectures(pathname, platform)];
  assert.ok(architectures.includes(architecture),
    `${pathname} contains ${architectures.join(', ')}, not required ${architecture}`);
  return {
    path: displayPath(pathname),
    bytes: statSync(pathname).size,
    architectures,
    sha256: sha256(pathname),
    ...(platform === 'darwin' ? { minimumMacosVersions: macosMinimumVersions(pathname) } : {}),
  };
}

function run(pathname, args, label) {
  const result = spawnSync(pathname, args, {
    encoding: 'utf8',
    timeout: nativeProbeTimeout,
    windowsHide: true,
  });
  assert.equal(result.status, 0,
    `${label} failed (${result.status}): ${(result.stderr || result.stdout || result.error || '').toString().slice(0, 1000)}`);
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function speechHelperPath(baseDirectory, packaged = false) {
  if (process.platform === 'win32') {
    return packaged
      ? join(baseDirectory, 'speech', 'NextMuxSpeechHelper.exe')
      : join(baseDirectory, 'apps', 'desktop', 'native', 'speech', 'windows', 'NextMuxSpeechHelper.exe');
  }
  const relative = join('NextMuxSpeechHelper.app', 'Contents', 'MacOS', 'NextMuxSpeechHelper');
  return packaged
    ? join(baseDirectory, 'speech', relative)
    : join(baseDirectory, 'apps', 'desktop', 'native', 'speech', 'macos', relative);
}

function inspectSpeechHelper(pathname) {
  assert.ok(existsSync(pathname), `Missing native speech helper: ${pathname}`);
  const executableArchitectures = [...machineArchitectures(pathname)];
  if (process.platform === 'darwin') {
    assert.ok(executableArchitectures.includes(process.arch),
      `${pathname} contains ${executableArchitectures.join(', ')}, not required ${process.arch}`);
  } else {
    assert.deepEqual(executableArchitectures, ['pe-14c'],
      'Windows speech helper must be the managed AnyCPU PE emitted by /platform:anycpu');
  }
  const output = run(pathname, ['--probe', 'en-US'], 'local speech capability probe');
  let capability;
  try { capability = JSON.parse(output); }
  catch { assert.fail(`Local speech helper emitted invalid JSON: ${output.slice(0, 500)}`); }
  const expectedEngine = process.platform === 'darwin' ? 'macos-speech' : 'windows-system-speech';
  assert.equal(capability.type, 'capability', 'Local speech helper returned the wrong message type');
  assert.equal(capability.engine, expectedEngine, 'Local speech helper returned the wrong engine');
  assert.equal(capability.localOnly, true, 'Local speech helper must not permit network recognition');
  assert.equal(capability.defaultDeviceOnly, true, 'Local speech helper must use only the system default microphone');
  assert.ok(['ready', 'permission-required', 'permission-denied', 'language-unavailable'].includes(capability.status),
    `Local speech helper returned an invalid capability status: ${capability.status}`);
  return {
    path: displayPath(pathname),
    bytes: statSync(pathname).size,
    architectures: process.platform === 'win32' ? ['managed-anycpu'] : executableArchitectures,
    executableArchitectures,
    sha256: sha256(pathname),
    engine: expectedEngine,
    probeStatus: capability.status,
  };
}

function verifyElectronNativeAbi(electronExecutable, nativeModule) {
  const probe = [
    "const keytar = require(process.argv[1]);",
    "for (const name of ['getPassword', 'setPassword', 'deletePassword', 'findCredentials']) {",
    "  if (typeof keytar[name] !== 'function') throw new Error(`keytar export ${name} is missing`);",
    '}',
    "process.stdout.write(JSON.stringify({ loaded: true, modules: process.versions.modules, napi: process.versions.napi }));",
  ].join('\n');
  const result = spawnSync(electronExecutable, ['-e', probe, nativeModule], {
    encoding: 'utf8',
    // First launch can spend over a minute translating an x64 Electron on an
    // Apple Silicon qualification host. Native runners retain the strict gate.
    timeout: nativeProbeTimeout,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.equal(result.status, 0,
    `keytar Electron ABI probe failed (${result.status}): ${(result.stderr || result.stdout || result.error || '').toString().slice(0, 1000)}`);
  const abi = JSON.parse(result.stdout.trim());
  assert.equal(abi.loaded, true, 'keytar did not load in the target Electron runtime');
  assert.match(String(abi.modules || ''), /^\d+$/, 'Electron did not report a native module ABI');
  assert.match(String(abi.napi || ''), /^\d+$/, 'Electron did not report an N-API version');
  return abi;
}

function hasValidPlatformSignature(pathname) {
  if (process.platform === 'darwin') {
    return spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', pathname], {
      encoding: 'utf8', timeout: 20_000,
    }).status === 0;
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const powerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powerShell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '(Get-AuthenticodeSignature -LiteralPath $env:NEXTMUX_NATIVE_FILE).Status.ToString()',
  ], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
    env: { ...process.env, NEXTMUX_NATIVE_FILE: pathname },
  });
  return result.status === 0 && result.stdout.trim() === 'Valid';
}

function packageArtifact(packageName, relativePath) {
  const manifest = desktopRequire.resolve(`${packageName}/package.json`);
  return join(dirname(manifest), relativePath);
}

/** Verify the Windows portable pair outside ASAR, in a supported resource layout. */
export function verifyBundledFfmpeg(baseDirectory, {
  packaged = false,
  platform = process.platform,
  architecture = process.arch,
  references,
  runBinary = run,
  verifySignature = hasValidPlatformSignature,
} = {}) {
  assert.equal(platform, 'win32', 'Bundled FFmpeg verification requires Windows');
  assert.ok(['x64', 'arm64'].includes(architecture), `Unsupported bundled FFmpeg architecture: ${architecture}`);
  const names = ['ffmpeg', 'ffprobe'];
  const directories = [
    join(baseDirectory, 'bin'),
    packaged ? join(baseDirectory, 'native', 'ffmpeg')
      : join(baseDirectory, 'native', 'ffmpeg', `${platform}-${architecture}`),
  ];
  const directory = directories.find(candidate => names.some(name => existsSync(join(candidate, `${name}.exe`))));
  assert.ok(directory, `Windows must bundle ffmpeg.exe and ffprobe.exe in the same directory: ${directories.join(' or ')}`);
  const report = {};
  for (const name of names) {
    const pathname = join(directory, `${name}.exe`);
    report[name] = inspectBinary(pathname, { platform, architecture });
    if (references) {
      assert.ok(references[name]?.sha256, `Missing verified source reference for ${name}.exe`);
      report[name].sourceSha256Match = report[name].sha256 === references[name].sha256;
      report[name].signedVariation = !report[name].sourceSha256Match && verifySignature(pathname);
      assert.ok(report[name].sourceSha256Match || report[name].signedVariation,
        `Packaged ${name}.exe differs from the verified source and has no valid platform signature`);
    }
    const version = runBinary(pathname, ['-version'], `${packaged ? 'packaged ' : ''}${name}`).split(/\r?\n/, 1)[0];
    assert.match(version, new RegExp(`^${name} version\\s+\\S+`), `${name}.exe did not identify the expected FFmpeg tool`);
    report[name].version = version;
  }
  return report;
}


async function sourceArtifacts() {
  const watcherPackage = `@parcel/watcher-${platformDirectory}`;
  const ripgrepPackage = `@vscode/ripgrep-${platformDirectory}`;
  const watcher = packageArtifact(watcherPackage, 'watcher.node');
  const ripgrep = packageArtifact(ripgrepPackage, join('bin', process.platform === 'win32' ? 'rg.exe' : 'rg'));
  const keytarManifest = extensionRequire.resolve('keytar/package.json');
  const keytarPackageRoot = dirname(keytarManifest);
  const keytar = join(keytarPackageRoot, 'build', 'Release', 'keytar.node');
  // macOS downloads a pinned FFmpeg build after installation. Windows must
  // ship a verified portable ffmpeg.exe / ffprobe.exe pair instead.
  const components = readFileSync(join(root, 'packages', 'theia-nextmux-extension', 'src', 'node', 'nextmux-components.ts'), 'utf8');
  if (process.platform !== 'win32') {
    assert.ok(components.includes(`'${platformDirectory}': { version:`), `No downloadable FFmpeg is pinned for ${platformDirectory}. Do not publish this target.`);
  }
  assert.ok(components.includes(`'${platformDirectory}': { folder:`), `No downloadable speech recogniser is pinned for ${platformDirectory}. Do not publish this target.`);
  const electron = join(
    dirname(desktopRequire.resolve('electron/package.json')),
    'dist',
    process.platform === 'win32' ? 'electron.exe' : join('Electron.app', 'Contents', 'MacOS', 'Electron')
  );

  const keytarManifestJson = JSON.parse(readFileSync(keytarManifest, 'utf8'));
  const expectedKeytarVersion = JSON.parse(readFileSync(extensionPackagePath, 'utf8')).dependencies.keytar;
  assert.equal(keytarManifestJson.version, expectedKeytarVersion,
    'installed keytar must match the desktop extension dependency contract');
  const report = {
    electron: inspectBinary(electron),
    keytar: inspectBinary(keytar),
    watcher: inspectBinary(watcher),
    ripgrep: inspectBinary(ripgrep),
    speech: inspectSpeechHelper(speechHelperPath(root)),
    computer: verifyComputerRuntime(join(root, 'apps', 'desktop', 'build-resources'), { machineArchitectures }),
    git: await gitAssets.verifyGitRuntime(join(root, 'apps', 'desktop', 'build-resources', 'git-runtime', platformDirectory), { platform: process.platform, architecture: process.arch }),
  };
  report.keytar.version = keytarManifestJson.version;
  report.keytar.packageManifest = displayPath(keytarManifest);
  report.keytar.packagingLocation = 'node_modules/keytar/build/Release/keytar.node';
  report.keytar.electronAbi = verifyElectronNativeAbi(electron, keytar);
  report.ripgrep.version = run(ripgrep, ['--version'], 'ripgrep').split(/\r?\n/, 1)[0];
  if (process.platform === 'win32') report.ffmpeg = verifyBundledFfmpeg(join(root, 'apps', 'desktop'));
  return report;
}

async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) await walk(pathname, results);
    else if (entry.isFile()) results.push(pathname);
  }
  return results;
}

function packagedExecutable(resourcesDirectory) {
  if (process.platform === 'win32') return join(dirname(resourcesDirectory), 'NextMux.exe');
  return join(dirname(resourcesDirectory), 'MacOS', 'NextMux');
}

async function packagedArtifacts(resourcesDirectory, references) {
  const fileBoundary = await verifyPackageFileBoundary(resourcesDirectory);
  const unpackedRoot = join(resourcesDirectory, 'app.asar.unpacked');
  assert.ok(existsSync(unpackedRoot), `Missing packaged native resources: ${unpackedRoot}`);
  const unpackedFiles = await walk(unpackedRoot);
  // macOS retains the downloaded-component contract; Windows bundles both tools.
  if (process.platform !== 'win32') {
    assert.ok(!unpackedFiles.some(pathname => /[\\/]@ffmpeg-installer[\\/]/.test(pathname) && /ffmpeg(\.exe)?$/i.test(pathname))
      && !existsSync(join(resourcesDirectory, 'native', 'ffmpeg')), 'macOS FFmpeg must not be packaged: it is downloaded after installation');
  }
  const expectedNames = {
    keytar: 'keytar.node',
    watcher: 'watcher.node',
    ripgrep: process.platform === 'win32' ? 'rg.exe' : 'rg',
  };
  const electronExecutable = packagedExecutable(resourcesDirectory);
  const report = { electron: inspectBinary(electronExecutable), fileBoundary,
    computer: verifyComputerRuntime(resourcesDirectory, { packaged: true, machineArchitectures }),
    git: await gitAssets.verifyGitRuntime(join(resourcesDirectory, 'git-runtime', platformDirectory), { platform: process.platform, architecture: process.arch, packaged: true }) };
  if (process.platform === 'win32') {
    assert.ok(references.ffmpeg, 'Missing verified source FFmpeg pair');
    report.ffmpeg = verifyBundledFfmpeg(resourcesDirectory, { packaged: true, references: references.ffmpeg });
  }
  for (const [key, name] of Object.entries(expectedNames)) {
    const matches = unpackedFiles.filter(pathname => basename(pathname) === name
      // The backend bundle loads keytar from lib/backend/native (older builds kept it in node_modules).
      && (key !== 'keytar' || /\/(?:lib\/backend\/native|node_modules\/keytar\/build\/Release)\/keytar\.node$/.test(pathname.replaceAll('\\', '/'))));
    assert.ok(matches.length > 0, `Packaged app is missing ${name} under app.asar.unpacked`);
    const reference = references[key];
    const exact = matches.find(pathname => sha256(pathname) === reference.sha256);
    const signed = exact ? undefined : matches.find(hasValidPlatformSignature);
    const pathname = exact || signed || matches[0];
    report[key] = inspectBinary(pathname);
    report[key].sourceSha256Match = report[key].sha256 === reference.sha256;
    report[key].signedVariation = !report[key].sourceSha256Match && hasValidPlatformSignature(pathname);
    assert.ok(report[key].sourceSha256Match || report[key].signedVariation,
      `Packaged ${name} differs from the verified dependency and has no valid platform signature`);
  }
  report.keytar.packagingLocation = 'app.asar.unpacked/node_modules/keytar/build/Release/keytar.node';
  const keytarPath = report.keytar.path.startsWith('apps/') ? join(root, report.keytar.path) : report.keytar.path;
  report.keytar.electronAbi = verifyElectronNativeAbi(electronExecutable, keytarPath);
  report.ripgrep.version = run(report.ripgrep.path.startsWith('apps/') ? join(root, report.ripgrep.path) : report.ripgrep.path,
    ['--version'], 'packaged ripgrep').split(/\r?\n/, 1)[0];
  const speechPath = speechHelperPath(resourcesDirectory, true);
  report.speech = inspectSpeechHelper(speechPath);
  report.speech.sourceSha256Match = report.speech.sha256 === references.speech.sha256;
  report.speech.signedVariation = !report.speech.sourceSha256Match && hasValidPlatformSignature(speechPath);
  assert.ok(report.speech.sourceSha256Match || report.speech.signedVariation,
    'Packaged speech helper differs from the verified source helper and has no valid platform signature');
  return report;
}

async function main() {
  assert.ok(['win32', 'darwin'].includes(process.platform),
    `Native desktop verification is not configured for ${process.platform}`);
  assert.ok(['x64', 'arm64'].includes(process.arch),
    `Native desktop verification is not configured for ${process.arch}`);
  const source = await sourceArtifacts();
  const report = {
    platform: process.platform,
    architecture: process.arch,
    rosettaQualification,
    source,
  };

  const packagedIndex = process.argv.indexOf('--packaged');
  if (packagedIndex >= 0) {
    const value = process.argv[packagedIndex + 1];
    assert.ok(value && !value.startsWith('--'), '--packaged requires the final Electron Resources directory');
    report.packaged = await packagedArtifacts(resolve(value), source);
    report.packagedResources = displayPath(resolve(value));
  }

  const serialized = `${JSON.stringify(report, undefined, 2)}\n`;
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) {
    const value = process.argv[outputIndex + 1];
    assert.ok(value && !value.startsWith('--'), '--output requires a JSON report path');
    const output = resolve(value);
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    writeFileSync(temporary, serialized);
    renameSync(temporary, output);
  }
  console.log(serialized.trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
