'use strict';

const base = require('./electron-builder.config.cjs');

const targetArch = process.env.NEXTMUX_QUALIFICATION_ARCH;
if (!['x64', 'arm64'].includes(targetArch)) {
  throw new Error('NEXTMUX_QUALIFICATION_ARCH must be x64 or arm64.');
}

const windowsSpeech = {
  from: 'native/speech/windows',
  to: 'speech',
  filter: ['NextMuxSpeechHelper.exe'],
};
const windowsArm64Ffmpeg = {
  from: 'native/ffmpeg/win32-arm64',
  to: 'native/ffmpeg',
  filter: ['ffmpeg.exe', 'LICENSE.txt', 'PROVENANCE.json'],
};

const keep = new Set([
  `@parcel/watcher-win32-${targetArch}`,
  `@vscode/ripgrep-win32-${targetArch}`,
  ...(targetArch === 'x64' ? [
    '@ffmpeg-installer/win32-x64',
    '@msgpackr-extract/msgpackr-extract-win32-x64',
  ] : []),
]);
const optionalNativePackages = [
  '@parcel/watcher-android-arm64', '@parcel/watcher-darwin-arm64', '@parcel/watcher-darwin-x64',
  '@parcel/watcher-freebsd-x64', '@parcel/watcher-linux-arm-glibc', '@parcel/watcher-linux-arm-musl',
  '@parcel/watcher-linux-arm64-glibc', '@parcel/watcher-linux-arm64-musl',
  '@parcel/watcher-linux-x64-glibc', '@parcel/watcher-linux-x64-musl',
  '@parcel/watcher-win32-arm64', '@parcel/watcher-win32-x64',
  '@vscode/ripgrep-darwin-arm64', '@vscode/ripgrep-darwin-x64', '@vscode/ripgrep-linux-arm',
  '@vscode/ripgrep-linux-arm64', '@vscode/ripgrep-linux-ia32', '@vscode/ripgrep-linux-ppc64',
  '@vscode/ripgrep-linux-riscv64', '@vscode/ripgrep-linux-s390x', '@vscode/ripgrep-linux-x64',
  '@vscode/ripgrep-win32-arm64', '@vscode/ripgrep-win32-ia32', '@vscode/ripgrep-win32-x64',
  '@ffmpeg-installer/darwin-arm64', '@ffmpeg-installer/darwin-x64', '@ffmpeg-installer/linux-arm',
  '@ffmpeg-installer/linux-arm64', '@ffmpeg-installer/linux-ia32', '@ffmpeg-installer/linux-x64',
  '@ffmpeg-installer/win32-ia32', '@ffmpeg-installer/win32-x64',
  '@msgpackr-extract/msgpackr-extract-darwin-arm64', '@msgpackr-extract/msgpackr-extract-darwin-x64',
  '@msgpackr-extract/msgpackr-extract-linux-arm', '@msgpackr-extract/msgpackr-extract-linux-arm64',
  '@msgpackr-extract/msgpackr-extract-linux-x64', '@msgpackr-extract/msgpackr-extract-win32-x64',
];
const otherPtyTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']
  .filter(target => target !== `win32-${targetArch}`);

module.exports = {
  ...base,
  electronDist: undefined,
  files: [
    ...(base.files || []),
    ...optionalNativePackages.filter(name => !keep.has(name)).map(name => `!node_modules/${name}/**/*`),
    ...otherPtyTargets.map(target => `!node_modules/node-pty/prebuilds/${target}/**/*`),
    `!node_modules/node-pty/third_party/conpty/*/win10-${targetArch === 'x64' ? 'arm64' : 'x64'}/**/*`,
    '!node_modules/msgpackr-extract/build/**/*',
  ],
  extraResources: [
    ...(base.extraResources || []),
    windowsSpeech,
    ...(targetArch === 'arm64' ? [windowsArm64Ffmpeg] : []),
  ],
};
