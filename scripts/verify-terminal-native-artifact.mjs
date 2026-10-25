#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopPackagePath = join(root, 'apps', 'desktop', 'package.json');
const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8'));
const expectedVersion = desktopPackage.dependencies['node-pty'];
assert.match(expectedVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const desktopRequire = createRequire(desktopPackagePath);
const installedManifestPath = desktopRequire.resolve('node-pty/package.json');
const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'));
const installedPackageRoot = dirname(installedManifestPath);
assert.equal(installedManifest.version, expectedVersion, 'desktop node-pty must match the audited release');

const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const lockedVersions = [...new Set([...lockfile.matchAll(/^\s{2}node-pty@([^:]+):/gm)].map(match => match[1]))];
assert.deepEqual(lockedVersions, [expectedVersion], 'the frozen lockfile contains more than one node-pty ABI pair');

const platformDirectory = `${process.platform}-${process.arch}`;
const nativeRelativePaths = process.platform === 'win32'
  ? [
      'conpty.node',
      'conpty_console_list.node',
      join('conpty', 'conpty.dll'),
      join('conpty', 'OpenConsole.exe'),
    ]
  : process.platform === 'darwin'
    ? ['pty.node', 'spawn-helper']
    : [];
assert.ok(nativeRelativePaths.length > 0,
  `Native desktop release verification is not configured for ${process.platform}`);

function machineType(file) {
  const bytes = readFileSync(file);
  if (process.platform === 'win32') {
    assert.equal(bytes.toString('ascii', 0, 2), 'MZ', `${file} is not a PE binary`);
    const peOffset = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', `${file} has no PE signature`);
    const machine = bytes.readUInt16LE(peOffset + 4);
    const expected = process.arch === 'arm64' ? 0xaa64 : process.arch === 'x64' ? 0x8664 : -1;
    assert.equal(machine, expected, `${file} does not match ${process.arch}`);
    return `pe-${machine.toString(16)}`;
  }
  const magic = bytes.readUInt32LE(0);
  assert.equal(magic, 0xfeedfacf, `${file} is not a 64-bit Mach-O binary`);
  const cpu = bytes.readUInt32LE(4);
  const expected = process.arch === 'arm64' ? 0x0100000c : process.arch === 'x64' ? 0x01000007 : -1;
  assert.equal(cpu, expected, `${file} does not match ${process.arch}`);
  return `macho-${cpu.toString(16)}`;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function displayPath(file) {
  const local = relative(root, file);
  return (!local.startsWith('..') && !isAbsolute(local) ? local : file).replaceAll('\\', '/');
}

function hasValidPlatformSignature(file) {
  if (process.platform === 'darwin') {
    return spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file], {
      encoding: 'utf8', timeout: 15_000,
    }).status === 0;
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const powerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powerShell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "(Get-AuthenticodeSignature -LiteralPath $env:NEXTMUX_NATIVE_FILE).Status.ToString()",
  ], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, NEXTMUX_NATIVE_FILE: file },
  });
  return result.status === 0 && result.stdout.trim() === 'Valid';
}

function inspectNative(file, referenceArtifact, allowSignedDifference = false) {
  assert.ok(existsSync(file), `missing native PTY artifact: ${file}`);
  const details = {
    path: displayPath(file),
    bytes: statSync(file).size,
    architecture: machineType(file),
    sha256: sha256(file),
    nodePtyVersion: expectedVersion,
  };
  if (referenceArtifact) {
    const sourceSha256Match = details.sha256 === referenceArtifact.sha256;
    const signedVariation = !sourceSha256Match && allowSignedDifference && hasValidPlatformSignature(file);
    assert.ok(sourceSha256Match || signedVariation,
      `${file} neither matches the audited node-pty ${expectedVersion} artifact nor carries a valid platform signature`);
    details.sourceSha256Match = sourceSha256Match;
    details.signedVariation = signedVariation;
  }
  if (process.platform === 'darwin' && file.endsWith('spawn-helper')) {
    assert.notEqual(statSync(file).mode & 0o111, 0, `${file} is not executable`);
  }
  return details;
}

function inspectNativeSet(baseDirectory, references, allowSignedDifference = false) {
  return Object.fromEntries(nativeRelativePaths.map(relativePath => {
    const portableName = relativePath.replaceAll('\\', '/');
    return [portableName, inspectNative(
      join(baseDirectory, relativePath), references?.[portableName], allowSignedDifference
    )];
  }));
}

function versionsInBundle(source, label) {
  const bundledVersions = [...new Set([...source.matchAll(/node-pty@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)]
    .map(match => match[1]))];
  assert.deepEqual(bundledVersions, [expectedVersion], `${label} embedded a stale node-pty JavaScript wrapper`);
  return bundledVersions;
}

function versionsInArchive(file, label) {
  const descriptor = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const versions = new Set();
  let carry = '';
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const source = carry + buffer.toString('latin1', 0, bytesRead);
      for (const match of source.matchAll(/node-pty@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)) versions.add(match[1]);
      carry = source.slice(-160);
    }
  } finally {
    closeSync(descriptor);
  }
  const bundledVersions = [...versions];
  assert.deepEqual(bundledVersions, [expectedVersion], `${label} embedded a stale node-pty JavaScript wrapper`);
  return bundledVersions;
}

const installedBase = join(installedPackageRoot, 'prebuilds', platformDirectory);
const reference = inspectNativeSet(installedBase);
const report = {
  nodePtyVersion: installedManifest.version,
  platform: process.platform,
  architecture: process.arch,
  installed: reference,
};

if (process.argv.includes('--bundle')) {
  const bundleRoot = join(root, 'apps', 'desktop', 'lib');
  const backendBundle = join(bundleRoot, 'backend', 'main.js');
  const runtimeManifest = join(bundleRoot, 'native-runtime-manifest.json');
  assert.ok(existsSync(backendBundle),
    'apps/desktop/lib is missing; run `pnpm desktop:build` before --bundle verification');
  assert.ok(existsSync(runtimeManifest),
    'native runtime provenance is missing; run the production desktop build before verification');
  const provenance = JSON.parse(readFileSync(runtimeManifest, 'utf8'));
  assert.equal(provenance.platform, process.platform, 'bundle provenance platform mismatch');
  assert.equal(provenance.architecture, process.arch, 'bundle provenance architecture mismatch');
  report.bundleVersions = versionsInBundle(
    `${readFileSync(backendBundle, 'utf8')}\n${readFileSync(runtimeManifest, 'utf8')}`,
    'desktop backend bundle and native provenance'
  );
  report.bundleProvenance = provenance;
  report.bundle = inspectNativeSet(join(bundleRoot, 'prebuilds', platformDirectory), reference);
}

const packagedFlagIndex = process.argv.indexOf('--packaged');
if (packagedFlagIndex >= 0) {
  const resourcesArgument = process.argv[packagedFlagIndex + 1];
  assert.ok(resourcesArgument && !resourcesArgument.startsWith('--'),
    '--packaged requires the final Electron Resources directory');
  const resourcesDirectory = resolve(resourcesArgument);
  const appAsar = join(resourcesDirectory, 'app.asar');
  const unpackedRoot = join(resourcesDirectory, 'app.asar.unpacked');
  assert.ok(existsSync(appAsar), `missing final packaged archive: ${appAsar}`);
  assert.ok(existsSync(unpackedRoot), `missing final app.asar.unpacked directory: ${unpackedRoot}`);

  report.packagedVersions = versionsInArchive(appAsar, 'final app.asar backend bundle');
  report.packaged = inspectNativeSet(
    join(unpackedRoot, 'lib', 'prebuilds', platformDirectory),
    reference,
    true
  );
  report.packagedResources = displayPath(resourcesDirectory);
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
