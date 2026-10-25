#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDirectory = join(root, 'apps', 'desktop', 'native', 'ffmpeg', 'win32-arm64');
const targetBinary = join(targetDirectory, 'ffmpeg.exe');
const targetProbeBinary = join(targetDirectory, 'ffprobe.exe');
const provenancePath = join(targetDirectory, 'PROVENANCE.json');
export const WINDOWS_ARM64_FFMPEG_RELEASE = Object.freeze({
  version: 'N-126342-gf88b741dbf',
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-N-126342-gf88b741dbf-winarm64-gpl.zip',
  archiveSha256: '7ba67fd79d1b858cd1cf7058f1303813e2817171da987bdf49b4d94bdafc15cc',
  license: 'GPL-3.0-or-later',
});

const sha256 = value => createHash('sha256').update(value).digest('hex');

function assertArm64Pe(bytes) {
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ', 'FFmpeg is not a PE executable');
  const peOffset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', 'FFmpeg has no PE signature');
  assert.equal(bytes.readUInt16LE(peOffset + 4), 0xaa64, 'FFmpeg is not a native Windows ARM64 executable');
}

async function currentBinaryIsValid() {
  try {
    const [binary, probeBinary, provenance] = await Promise.all([
      readFile(targetBinary),
      readFile(targetProbeBinary),
      readFile(provenancePath, 'utf8').then(JSON.parse),
    ]);
    assertArm64Pe(binary);
    assertArm64Pe(probeBinary);
    return provenance.sourceUrl === WINDOWS_ARM64_FFMPEG_RELEASE.url
      && provenance.archiveSha256 === WINDOWS_ARM64_FFMPEG_RELEASE.archiveSha256
      && provenance.binarySha256 === sha256(binary)
      && (!provenance.probeSha256 || provenance.probeSha256 === sha256(probeBinary));
  } catch {
    return false;
  }
}

async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(pathname, name);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
      return pathname;
    }
  }
  return undefined;
}

export async function prepareWindowsArm64Ffmpeg() {
  if (process.platform !== 'win32' || process.arch !== 'arm64') return { skipped: true };
  if (await currentBinaryIsValid()) return { cached: true, path: targetBinary };

  const temporary = await mkdtemp(join(tmpdir(), 'nextmux-ffmpeg-winarm64-'));
  try {
    const response = await fetch(WINDOWS_ARM64_FFMPEG_RELEASE.url, { redirect: 'follow' });
    assert.equal(response.ok, true, `FFmpeg download failed with HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(archive), WINDOWS_ARM64_FFMPEG_RELEASE.archiveSha256, 'FFmpeg archive SHA-256 does not match the pinned release');
    const archivePath = join(temporary, 'ffmpeg.zip');
    await writeFile(archivePath, archive, { flag: 'wx' });
    const extracted = join(temporary, 'extracted');
    await mkdir(extracted);
    const unpack = spawnSync('tar.exe', ['-xf', archivePath, '-C', extracted], { encoding: 'utf8', windowsHide: true });
    assert.equal(unpack.status, 0, `Unable to extract FFmpeg: ${unpack.stderr || unpack.error || ''}`);

    const [binarySource, probeSource, licenseSource] = await Promise.all([
      findFile(extracted, 'ffmpeg.exe'),
      findFile(extracted, 'ffprobe.exe'),
      findFile(extracted, 'LICENSE.txt'),
    ]);
    assert.ok(binarySource, 'Pinned FFmpeg archive has no ffmpeg.exe');
    assert.ok(probeSource, 'Pinned FFmpeg archive has no ffprobe.exe');
    assert.ok(licenseSource, 'Pinned FFmpeg archive has no LICENSE.txt');
    const [binary, probeBinary] = await Promise.all([readFile(binarySource), readFile(probeSource)]);
    assertArm64Pe(binary);
    assertArm64Pe(probeBinary);

    await mkdir(targetDirectory, { recursive: true });
    const binaryTemporary = `${targetBinary}.tmp`;
    const probeTemporary = `${targetProbeBinary}.tmp`;
    const licenseTarget = join(targetDirectory, 'LICENSE.txt');
    const licenseTemporary = `${licenseTarget}.tmp`;
    await Promise.all([
      copyFile(binarySource, binaryTemporary),
      copyFile(probeSource, probeTemporary),
      copyFile(licenseSource, licenseTemporary),
    ]);
    await Promise.all([
      rename(binaryTemporary, targetBinary),
      rename(probeTemporary, targetProbeBinary),
      rename(licenseTemporary, licenseTarget),
    ]);
    await writeFile(provenancePath, `${JSON.stringify({
      schemaVersion: 1,
      version: WINDOWS_ARM64_FFMPEG_RELEASE.version,
      sourceUrl: WINDOWS_ARM64_FFMPEG_RELEASE.url,
      archiveSha256: WINDOWS_ARM64_FFMPEG_RELEASE.archiveSha256,
      binarySha256: sha256(binary),
      probeSha256: sha256(probeBinary),
      license: WINDOWS_ARM64_FFMPEG_RELEASE.license,
    }, undefined, 2)}\n`);
    return { cached: false, path: targetBinary };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareWindowsArm64Ffmpeg();
  console.log(result.skipped ? 'Windows ARM64 FFmpeg preparation is not needed on this target.'
    : `Windows ARM64 FFmpeg ready: ${result.path}${result.cached ? ' (cached)' : ''}`);
}
