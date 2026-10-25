import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledFfmpegCandidates } from '../lib/node/nextmux-bundled-ffmpeg.js';

test('Windows ARM64 FFmpeg candidates prefer the packaged resource and retain the development path', () => {
  assert.deepEqual(bundledFfmpegCandidates({
    platform: 'win32',
    architecture: 'arm64',
    resourcesPath: 'C:\\Program Files\\NextMux\\resources',
    moduleDirectory: 'C:\\repo\\packages\\theia-nextmux-extension\\lib\\node',
  }), [
    'C:\\Program Files\\NextMux\\resources\\native\\ffmpeg\\ffmpeg.exe',
    'C:\\repo\\apps\\desktop\\native\\ffmpeg\\win32-arm64\\ffmpeg.exe',
  ]);

  assert.deepEqual(bundledFfmpegCandidates({
    platform: 'win32',
    architecture: 'arm64',
    moduleDirectory: 'C:\\repo\\packages\\theia-nextmux-extension\\lib\\node',
  }), ['C:\\repo\\apps\\desktop\\native\\ffmpeg\\win32-arm64\\ffmpeg.exe']);
});

test('Windows x64 uses its own packaged FFmpeg (never an ARM64 binary); macOS and Linux bundle none', () => {
  // electron-builder.config.cjs packs native/ffmpeg/win32-${arch} for each Windows target and beforePack requires it.
  assert.deepEqual(bundledFfmpegCandidates({
    platform: 'win32',
    architecture: 'x64',
    resourcesPath: 'C:\\Program Files\\NextMux\\resources',
    moduleDirectory: 'C:\\repo\\packages\\theia-nextmux-extension\\lib\\node',
  }), [
    'C:\\Program Files\\NextMux\\resources\\native\\ffmpeg\\ffmpeg.exe',
    'C:\\repo\\apps\\desktop\\native\\ffmpeg\\win32-x64\\ffmpeg.exe',
  ]);
  for (const [platform, architecture] of [
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
    ['linux', 'x64'],
    ['win32', 'ia32'],
  ]) {
    assert.deepEqual(bundledFfmpegCandidates({
      platform,
      architecture,
      resourcesPath: '/Applications/NextMux/resources',
      moduleDirectory: '/repo/packages/theia-nextmux-extension/lib/node',
    }), [], `${platform}-${architecture}`);
  }
});
