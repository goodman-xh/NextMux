#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import nativeSignatures from './native-runtime-signature.cjs';

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) throw new Error(`${name} requires a value`);
  return value;
}

function walkDirectories(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'NextMux.app') result.push(pathname);
      else walkDirectories(pathname, result);
    }
  }
  return result;
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, windowsHide: true });
  const record = {
    label,
    command,
    args,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
  process.stdout.write(`[${label}] ${command} ${args.join(' ')}\n${record.stdout}`);
  process.stderr.write(record.stderr);
  assert.equal(result.status, 0,
    `${label} failed (${result.status}): ${(result.stderr || result.stdout || result.error || '').toString().slice(0, 2000)}`);
  return record;
}

function writeReport(report, outputArgument) {
  const serialized = `${JSON.stringify(report, undefined, 2)}\n`;
  if (outputArgument) {
    const output = resolve(outputArgument);
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    writeFileSync(temporary, serialized);
    renameSync(temporary, output);
  }
  console.log(serialized.trimEnd());
}

function verifyMacApplication(application, labelPrefix = 'app') {
  // Validate the configured release identity, not merely any notarized app.
  nativeSignatures.verifyNativeRuntimeSignature(join(application, 'Contents', 'MacOS', 'NextMux'), { platform: 'darwin' });
  const checks = [
    runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', application], `${labelPrefix} codesign`),
    runCommand('/usr/bin/codesign', ['-d', '--verbose=4', application], `${labelPrefix} hardened runtime`),
    runCommand('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', application], `${labelPrefix} Gatekeeper notarization`),
    runCommand('/usr/bin/xcrun', ['stapler', 'validate', application], `${labelPrefix} stapler`),
  ];
  assert.match(`${checks[1].stdout}\n${checks[1].stderr}`, /runtime/i, `${application} does not enable hardened runtime`);
  return checks;
}

function verifyMountedDiskImage(diskImage) {
  // electron-builder signs/notarizes the app bundle. A DMG is a distribution
  // container and is not itself a code-signing target, so inspect the mounted
  // app instead of applying codesign/spctl/stapler directly to the DMG.
  const mountpoint = mkdtempSync(join(tmpdir(), 'nextmux-dmg-'));
  let failure;
  try {
    const mount = runCommand('/usr/bin/hdiutil', [
      'attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, diskImage,
    ], 'DMG mount');
    const applications = walkDirectories(mountpoint);
    assert.ok(applications.length > 0, `mounted ${basename(diskImage)} does not contain NextMux.app`);
    const checks = applications.map(application => ({
      application: relative(mountpoint, application),
      commands: verifyMacApplication(application, `DMG ${basename(diskImage)} app`),
    }));
    return { mount, mountpoint, checks };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const detached = spawnSync('/usr/bin/hdiutil', ['detach', mountpoint, '-force'], {
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
    });
    process.stdout.write(`[DMG detach] /usr/bin/hdiutil detach ${mountpoint} -force\n${detached.stdout || ''}`);
    process.stderr.write(detached.stderr || '');
    rmSync(mountpoint, { recursive: true, force: true });
    if (!failure) {
      assert.equal(detached.status, 0,
        `DMG detach failed (${detached.status}): ${(detached.stderr || detached.stdout || '').slice(0, 2000)}`);
    }
  }
}

const releaseDirectory = resolve(argument('--release-dir'));
const signed = argument('--signed') === 'true';
const output = argument('--output', { required: false });
const report = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  releaseDirectory,
  signedRequired: signed,
  checks: [],
};

if (!signed) {
  report.status = 'unsigned-qualification-build';
  writeReport(report, output);
} else if (process.platform === 'win32') {
  const publisherNames = String(process.env.WINDOWS_PUBLISHER_NAME || '')
    .split(';').map(value => value.trim()).filter(Boolean);
  assert.ok(publisherNames.length > 0, 'WINDOWS_PUBLISHER_NAME is required');
  const executables = readdirSync(releaseDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^NextMux-.*-(?:setup|portable)\.exe$/.test(entry.name))
    .map(entry => join(releaseDirectory, entry.name));
  assert.ok(executables.some(pathname => basename(pathname).endsWith('-setup.exe')), 'signed NSIS setup EXE is missing');
  assert.ok(executables.some(pathname => basename(pathname).endsWith('-portable.exe')), 'signed portable EXE is missing');
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const powerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const pathname of executables) {
    const identity = nativeSignatures.verifyNativeRuntimeSignature(pathname, { platform: 'win32' });
    const script = [
      '$signature = Get-AuthenticodeSignature -LiteralPath $env:NEXTMUX_SIGNING_FILE',
      '[pscustomobject]@{ status = $signature.Status.ToString(); signer = $signature.SignerCertificate.Subject; timestamp = $signature.TimeStamperCertificate.Subject } | ConvertTo-Json -Compress',
    ].join('; ');
    const result = spawnSync(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
      env: { ...process.env, NEXTMUX_SIGNING_FILE: pathname },
    });
    process.stdout.write(`[Authenticode ${basename(pathname)}]\n${result.stdout || ''}`);
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, `Authenticode inspection failed for ${pathname}`);
    const signature = JSON.parse(result.stdout.trim());
    assert.equal(signature.status, 'Valid', `${basename(pathname)} is not Authenticode-valid`);
    assert.ok(signature.timestamp, `${basename(pathname)} has no trusted timestamp`);
    assert.ok(publisherNames.includes(identity.publisher), 'Unexpected release publisher');
    report.checks.push({ artifact: relative(releaseDirectory, pathname), kind: 'authenticode', ...signature, publisher: identity.publisher });
  }
  report.status = 'verified';
  writeReport(report, output);
} else if (process.platform === 'darwin') {
  const applications = walkDirectories(releaseDirectory);
  const diskImages = readdirSync(releaseDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.dmg'))
    .map(entry => join(releaseDirectory, entry.name));
  assert.ok(applications.length > 0, 'signed NextMux.app is missing');
  assert.ok(diskImages.length > 0, 'signed and notarized .dmg is missing');
  for (const application of applications) {
    const checks = verifyMacApplication(application);
    report.checks.push({ artifact: relative(releaseDirectory, application), kind: 'application', commands: checks });
  }
  for (const diskImage of diskImages) {
    const mounted = verifyMountedDiskImage(diskImage);
    report.checks.push({
      artifact: relative(releaseDirectory, diskImage),
      kind: 'disk-image',
      commands: [mounted.mount, ...mounted.checks.flatMap(application => application.commands)],
      mountedApplications: mounted.checks,
    });
  }
  report.status = 'verified';
  writeReport(report, output);
} else {
  throw new Error(`Desktop signing verification is not configured for ${process.platform}`);
}
