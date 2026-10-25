import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { verifyBundledFfmpeg } from '../../../scripts/verify-desktop-native-artifacts.mjs';

const machines = { x64: 0x8664, arm64: 0xaa64 };

function peBinary(architecture = 'x64', marker = 0) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'ascii');
  bytes.writeUInt16LE(machines[architecture], 0x84);
  bytes[bytes.length - 1] = marker;
  return bytes;
}

async function fixture(t, entries) {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-bundled-ffmpeg-verifier-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [relative, bytes] of Object.entries(entries)) {
    const pathname = join(directory, relative);
    await mkdir(join(pathname, '..'), { recursive: true });
    await writeFile(pathname, bytes);
  }
  return directory;
}

function options(extra = {}) {
  return {
    platform: 'win32', architecture: 'x64', packaged: true,
    runBinary(pathname, args) {
      assert.deepEqual(args, ['-version']);
      return `${basename(pathname, '.exe')} version n7.1-test\nfixture probe output`;
    },
    verifySignature: () => false,
    ...extra,
  };
}

test('bin portable pair verifies both tools, target architecture, versions and packaged source hashes', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': peBinary() });
  const source = verifyBundledFfmpeg(directory, options({ packaged: false }));
  const report = verifyBundledFfmpeg(directory, options({ references: source }));
  for (const name of ['ffmpeg', 'ffprobe']) {
    assert.deepEqual(report[name].architectures, ['x64']);
    assert.match(report[name].sha256, /^[a-f0-9]{64}$/);
    assert.equal(report[name].bytes, 512);
    assert.equal(report[name].version, `${name} version n7.1-test`);
    assert.equal(report[name].sourceSha256Match, true);
    assert.equal(report[name].signedVariation, false);
  }
});

test('existing native FFmpeg layout verifies ARM64 source and packaged pairs', async t => {
  const sourceDirectory = await fixture(t, {
    'native/ffmpeg/win32-arm64/ffmpeg.exe': peBinary('arm64'),
    'native/ffmpeg/win32-arm64/ffprobe.exe': peBinary('arm64'),
  });
  const resources = await fixture(t, {
    'native/ffmpeg/ffmpeg.exe': peBinary('arm64'), 'native/ffmpeg/ffprobe.exe': peBinary('arm64'),
  });
  const source = verifyBundledFfmpeg(sourceDirectory, options({ architecture: 'arm64', packaged: false }));
  const report = verifyBundledFfmpeg(resources, options({ architecture: 'arm64', references: source }));
  assert.deepEqual(report.ffmpeg.architectures, ['arm64']);
  assert.deepEqual(report.ffprobe.architectures, ['arm64']);
});

test('missing portable pair blocks a Windows release', async t => {
  const directory = await fixture(t, {});
  assert.throws(() => verifyBundledFfmpeg(directory, options()), /Windows must bundle ffmpeg\.exe and ffprobe\.exe/);
});

test('either missing executable blocks a Windows release', async t => {
  for (const name of ['ffmpeg', 'ffprobe']) {
    const directory = await fixture(t, { [`bin/${name}.exe`]: peBinary() });
    assert.throws(() => verifyBundledFfmpeg(directory, options()), /Missing native desktop artifact/);
  }
});

test('separate layout directories cannot supply a mismatched portable pair', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'native/ffmpeg/ffprobe.exe': peBinary() });
  assert.throws(() => verifyBundledFfmpeg(directory, options()), /Missing native desktop artifact.*ffprobe\.exe/);
});

test('wrong architecture in either tool blocks x64 and ARM64 releases', async t => {
  for (const architecture of ['x64', 'arm64']) {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const other = architecture === 'x64' ? 'arm64' : 'x64';
      const entries = { 'bin/ffmpeg.exe': peBinary(architecture), 'bin/ffprobe.exe': peBinary(architecture) };
      entries[`bin/${name}.exe`] = peBinary(other);
      const directory = await fixture(t, entries);
      assert.throws(() => verifyBundledFfmpeg(directory, options({ architecture })), new RegExp(`not required ${architecture}`));
    }
  }
});

test('malformed PE binaries cannot pass native verification', async t => {
  const badOffset = peBinary();
  badOffset.writeUInt32LE(0xffffff, 0x3c);
  const badSignature = peBinary();
  badSignature.write('NOPE', 0x80);
  for (const bytes of [Buffer.from('not a binary'), badOffset, badSignature]) {
    const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': bytes });
    assert.throws(() => verifyBundledFfmpeg(directory, options()), /PE (header|offset|signature)/);
  }
});

test('version probes identify ffmpeg and ffprobe independently and propagate execution failure', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': peBinary() });
  assert.throws(() => verifyBundledFfmpeg(directory, options({ runBinary: () => 'ffmpeg version n7.1' })), /ffprobe\.exe did not identify/);
  assert.throws(() => verifyBundledFfmpeg(directory, options({ runBinary: () => { throw new Error('native probe failed'); } })), /native probe failed/);
});

test('changed unsigned packaged tools fail the source-integrity check', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': peBinary() });
  const source = verifyBundledFfmpeg(directory, options({ packaged: false }));
  await writeFile(join(directory, 'bin/ffprobe.exe'), peBinary('x64', 1));
  assert.throws(() => verifyBundledFfmpeg(directory, options({ references: source })), /Packaged ffprobe\.exe differs/);
});

test('legitimately signed packaged variants retain the existing native-signature contract', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': peBinary() });
  const source = verifyBundledFfmpeg(directory, options({ packaged: false }));
  await writeFile(join(directory, 'bin/ffmpeg.exe'), peBinary('x64', 1));
  const report = verifyBundledFfmpeg(directory, options({ references: source, verifySignature: () => true }));
  assert.equal(report.ffmpeg.sourceSha256Match, false);
  assert.equal(report.ffmpeg.signedVariation, true);
  assert.equal(report.ffprobe.sourceSha256Match, true);
});

test('packaged integrity checks require a source reference for each executable', async t => {
  const directory = await fixture(t, { 'bin/ffmpeg.exe': peBinary(), 'bin/ffprobe.exe': peBinary() });
  const source = verifyBundledFfmpeg(directory, options({ packaged: false }));
  assert.throws(() => verifyBundledFfmpeg(directory, options({ references: { ffmpeg: source.ffmpeg } })), /Missing verified source reference for ffprobe\.exe/);
});
