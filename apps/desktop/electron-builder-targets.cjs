'use strict';

// Native builds published per system as npm optional dependencies. pnpm installs all of them, so
// an installer carried FFmpeg, ripgrep and file-watcher binaries for every OS (about 270 MB on
// macOS). Only the target's stay; the target comes from the builder's --mac/--win and --x64/--arm64
// flags. Each process packages exactly one OS/CPU, including programmatic builds.
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
function packagingTarget(argv = process.argv.slice(2), explicitTarget = process.env.NEXTMUX_PACKAGE_TARGET) {
  const has = (...flags) => flags.some(flag => argv.includes(flag));
  const platforms = [['win32', '--win', '-w', '--windows'], ['darwin', '--mac', '-m', '--macos'], ['linux', '--linux', '-l']]
    .filter(([, ...flags]) => has(...flags)).map(([platform]) => platform);
  const architectures = ['x64', 'arm64', 'ia32', 'armv7l', 'universal'].filter(architecture => has(`--${architecture}`));
  if (platforms.length > 1 || architectures.length > 1) throw new Error('Build each desktop OS/CPU in a separate electron-builder process.');
  let target = { platform: platforms[0] || process.platform, arch: architectures[0] || process.arch };
  if (explicitTarget) {
    const match = /^(darwin|win32)-(arm64|x64)$/.exec(explicitTarget);
    if (!match) throw new Error('NEXTMUX_PACKAGE_TARGET must identify one supported desktop OS/CPU.');
    if (platforms.length && platforms[0] !== match[1] || architectures.length && architectures[0] !== match[2]) throw new Error('NEXTMUX_PACKAGE_TARGET conflicts with electron-builder flags.');
    target = { platform: match[1], arch: match[2] };
  }
  require('./native-package-architecture.cjs').assertTarget(target);
  return target;
}
function foreignNativeExclusions(target = packagingTarget()) {
  require('./native-package-architecture.cjs').assertTarget(target);
  const keeps = name => name.includes(`${target.platform}-${target.arch}`);
  const nativeTargets = [
    ['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'arm64'], ['win32', 'x64'],
    ['linux', 'arm64'], ['linux', 'x64'],
  ];
  const trashExclusions = target.platform === 'darwin'
    ? ['!node_modules/trash/lib/windows-trash.exe', '!node_modules/trash/lib/xdg-trash']
    : target.platform === 'win32'
      ? ['!node_modules/trash/lib/macos-trash', '!node_modules/trash/lib/xdg-trash', '!lib/backend/macos-trash']
      : ['!node_modules/trash/lib/macos-trash', '!node_modules/trash/lib/windows-trash.exe', '!lib/backend/macos-trash'];
  return [
    ...optionalNativePackages.filter(name => !keeps(name)).map(name => `!node_modules/${name}/**/*`),
    // The sandbox invokes these helpers only on Linux. Neither desktop OS uses them.
    '!node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/**/*',
    // Install/build inputs only: node-pty loads the engine next to conpty.node
    // in prebuilds, never from third_party at runtime.
    '!node_modules/node-pty/third_party/conpty/**/*',
    // ONNX Runtime and node-pty carry prebuilt native binaries for multiple OS/CPU targets
    // inside one package rather than separate optional architecture packages.
    ...nativeTargets.filter(([platform, arch]) => platform !== target.platform || (target.arch && arch !== target.arch))
      .flatMap(([platform, arch]) => [
        `!node_modules/onnxruntime-node/bin/napi-v6/${platform}/${arch}/**/*`,
        `!node_modules/node-pty/prebuilds/${platform}-${arch}/**/*`,
        `!lib/prebuilds/${platform}-${arch}/**/*`,
      ]),
    ...trashExclusions,
  ];
}

function foreignMcpNativeExclusions(target = packagingTarget()) {
  require('./native-package-architecture.cjs').assertTarget(target);
  const prefix = '!runtimes/qwen-computer-use/package/dist/';
  return [`${prefix}linux/**`, ...(target.platform === 'darwin'
    ? [`${prefix}windows/**`]
    : [`${prefix}Open Computer Use.app/**`, `${prefix}windows/${target.arch === 'arm64' ? 'amd64' : 'arm64'}/**`])];
}

// The production bundles (lib/) already contain almost all JavaScript. Only these are loaded from
// node_modules at run time: the esbuild externals (typescript, tree-sitter WASM, sandbox runtime),
// packages required by the unbundled main-process files (computer control, updater, browser
// automation) and the optional native helpers. FFmpeg is not shipped: it is downloaded after
// installation (Settings → Downloads, packages/theia-nextmux-extension/src/node/nextmux-components.ts).
const runtimeRoots = [
  '@anthropic-ai/sandbox-runtime', '@qwen-code/cua-sdk', 'electron-updater', 'puppeteer-core', 'typescript',
  '@vscode/tree-sitter-wasm', 'node-pty', 'trash', '@parcel/watcher', '@vscode/ripgrep',
  'bufferutil', 'utf-8-validate', 'onnxruntime-node',
  're2js', '@nextmux/model-runtime', 'ajv', 'ajv-formats', 'iconv-lite',
];

/** Every package the runtime roots need, following dependencies and optional dependencies. */
function runtimePackages(appDir = __dirname) {
  const fs = require('node:fs');
  const path = require('node:path');
  const seen = new Set();
  const resolve = (name, from) => {
    for (let directory = from; ; directory = path.dirname(directory)) {
      const candidate = path.join(directory, 'node_modules', name, 'package.json');
      if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
      if (path.dirname(directory) === directory) return undefined;
    }
  };
  const visit = (name, from) => {
    if (seen.has(name)) return;
    const directory = resolve(name, from);
    seen.add(name);
    if (!directory) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) visit(dependency, directory);
  };
  for (const name of runtimeRoots) visit(name, appDir);
  return [...seen].sort();
}

/** Keep only the run-time packages in the app's node_modules (package manifests stay for metadata lookups). */
function bundledPackageExclusions(appDir = __dirname) {
  return ['!node_modules/**/*', 'node_modules/*/package.json', 'node_modules/@*/*/package.json',
    ...runtimePackages(appDir).map(name => `node_modules/${name}/**/*`)];
}

module.exports = { optionalNativePackages, packagingTarget, foreignNativeExclusions, foreignMcpNativeExclusions, runtimeRoots, runtimePackages, bundledPackageExclusions };
