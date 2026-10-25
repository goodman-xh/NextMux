'use strict';

const { build } = require('./package.json');
const { dirname, join } = require('node:path');
const gitAssets = require('../../scripts/git-runtime-assets.cjs');

const signingRequired = process.env.NEXTMUX_REQUIRE_SIGNING === '1';
const publisherNames = String(process.env.WINDOWS_PUBLISHER_NAME || '')
  .split(';')
  .map(value => value.trim())
  .filter(Boolean);
const { packagingTarget, foreignMcpNativeExclusions } = require('./electron-builder-targets.cjs');
const { inspectNativeFile, scanNativePackage, assertNativePtyArtifacts } = require('./native-package-architecture.cjs');
const targetSpec = packagingTarget();
const targetPlatform = targetSpec.platform;
const isWindows = targetPlatform === 'win32';
const packagedDirectories = new Map();
function assertPackagedPtyArtifacts(appPath, target) {
  const resources = target.platform === 'darwin' ? join(appPath, 'Contents', 'Resources') : join(appPath, 'resources');
  assertNativePtyArtifacts(join(resources, 'app.asar.unpacked', 'lib', 'prebuilds', `${target.platform}-${target.arch}`), target);
}
// Keep Windows archives compatible with the bundled NSIS decoder (upstream #9989).
if (isWindows) process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ';
const windowsSpeech = {
  from: 'native/speech/windows',
  to: 'speech',
  filter: ['NextMuxSpeechHelper.exe'],
};
const windowsFfmpeg = {
  from: 'native/ffmpeg/win32-${arch}',
  to: 'native/ffmpeg',
  filter: ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt', 'PROVENANCE.json'],
};
// The menu-bar logo (the colour logo, 18 pt). Retina: Electron loads name@2x.png next to it automatically.
const trayTemplate = {
  from: 'build-resources/tray-logo.png',
  to: 'tray-logo.png',
};
const trayTemplateRetina = {
  from: 'build-resources/tray-logo@2x.png',
  to: 'tray-logo@2x.png',
};
const windowsTrayIcon = {
  from: 'build-resources/icon.ico',
  to: 'icon.ico',
};
const mcpRuntimeResources = {
  from: 'build-resources/mcp-runtime',
  to: 'mcp-runtime',
  // Playwright's own Chromium (~400 MB) stays out of installers: the launcher uses the
  // installed Chrome/Edge, or downloads Playwright's pinned build once on first use.
  filter: [
    'manifest.json',
    'nextmux-mcp-runtime-launcher.cjs',
    'runtimes/**/*',
    '!runtimes/playwright/browsers/**',
    ...foreignMcpNativeExclusions(targetSpec),
    ...(isWindows ? ['!runtimes/macos-automator/**'] : ['!runtimes/windows-computer-use/**']),
    ...(targetPlatform === 'darwin' && targetSpec.arch === 'x64' ? ['!runtimes/macos-automator/package/dist/axorc/axorc'] : []),
  ],
};
const computerRuntimeResources = {
  from: `build-resources/computer-runtime/${targetPlatform}-\${arch}`,
  to: `computer-runtime/${targetPlatform}-\${arch}`,
  filter: ['*'],
};
const gitRuntimeResources = {
  from: `build-resources/git-runtime/${targetPlatform}-\${arch}`,
  to: `git-runtime/${targetPlatform}-\${arch}`,
  filter: ['**/*'],
};
// electron-builder removes node_modules/*.d.ts by default, but the compiler
// needs these public standard-library declarations at runtime for type checks.
const compilerLibraryResources = {
  from: dirname(require.resolve('typescript')),
  to: 'language-runtime/typescript',
  filter: ['lib*.d.ts'],
};

// Other systems' native builds stay out of installers (see electron-builder-targets.cjs).
const { bundledPackageExclusions, foreignNativeExclusions } = require('./electron-builder-targets.cjs');

if (signingRequired && isWindows && publisherNames.length === 0) {
  throw new Error('WINDOWS_PUBLISHER_NAME is required for a signed Windows release.');
}

module.exports = {
  ...build,
  // Bundled JavaScript is not shipped twice, and other systems' native builds not at all.
  files: [...(build.files || []), 'comic-visual-renderer.cjs', 'comic-visual-renderer-preload.cjs', 'build-resources/comic-visual-renderer/**/*', ...bundledPackageExclusions(), ...foreignNativeExclusions()],
  // The child runs with ELECTRON_RUN_AS_NODE and needs a real JS path. Keep the
  // external ONNX packages alongside it, including the addon and its dylib/DLL.
  asarUnpack: [...(build.asarUnpack || []), 'comic-visual-renderer.cjs', 'comic-visual-renderer-preload.cjs', 'build-resources/comic-visual-renderer/**/*', 'lib/backend/nextmux-canvas-on-device-worker.js',
    'node_modules/onnxruntime-node/**/*', 'node_modules/onnxruntime-common/**/*'],
  beforePack: async context => {
    const fs = require('node:fs');
    const architecture = typeof context.arch === 'string' ? context.arch : ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' })[context.arch];
    if (context.electronPlatformName !== targetSpec.platform || architecture !== targetSpec.arch) {
      throw new Error('Builder target differs from configured exclusions. Start a separate process with NEXTMUX_PACKAGE_TARGET=<platform>-<arch>.');
    }
    const appDir = context.packager.appDir || context.packager.info?.appDir || context.packager.projectDir;
    const target = { platform: context.electronPlatformName, arch: architecture };
    await gitAssets.beforePack(context);
    scanNativePackage(join(appDir, 'build-resources', 'git-runtime', `${target.platform}-${target.arch}`), target);
    const { verifyComputerRuntime } = await import('../../scripts/verify-computer-runtime.mjs');
    verifyComputerRuntime(join(appDir, 'build-resources'), {
      platform: context.electronPlatformName, architecture,
      machineArchitectures: filename => {
        const native = inspectNativeFile(filename, { platform: context.electronPlatformName, arch: architecture });
        if (!native || native.anyCpu) throw new Error(`Expected a native computer runtime binary: ${filename}`);
        return new Set(native.architectures);
      },
    });

    // Packaging reads prepared inputs. Never replace shared node_modules binaries
    // or delete another target's lib/prebuilds in a multi-target working tree.
    const targetPair = `${context.electronPlatformName}-${architecture}`;
    const prebuilds = join(appDir, 'lib', 'prebuilds', targetPair);
    if (!fs.existsSync(prebuilds)) throw new Error(`Missing prepared node-pty input for ${targetPair}: ${prebuilds}`);
    assertNativePtyArtifacts(prebuilds, target);
    scanNativePackage(prebuilds, target);
    if (context.electronPlatformName === 'darwin') {
      const trashPkg = require.resolve('trash/package.json', { paths: [appDir] });
      for (const filename of [join(dirname(trashPkg), 'lib', 'macos-trash'), join(appDir, 'lib', 'backend', 'macos-trash')]) {
        if (!inspectNativeFile(filename, target)) throw new Error(`Missing native macos-trash input: ${filename}`);
      }
    } else {
      for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
        const filename = join(appDir, 'native', 'ffmpeg', targetPair, name);
        if (!inspectNativeFile(filename, target)) throw new Error(`Missing native Windows media input: ${filename}`);
      }
    }
    const {buildComicVisualRenderer}=await import('../../scripts/build-comic-visual-renderer.mjs');
    await buildComicVisualRenderer(join(appDir, 'build-resources', 'comic-visual-renderer'));
  },
  afterPack: async context => {
    const fs = require('node:fs');
    const architecture = typeof context.arch === 'string' ? context.arch : ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' })[context.arch];
    const platform = context.electronPlatformName;
    const appPath = platform === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : context.appOutDir;
    const executable = platform === 'darwin'
      ? join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productFilename)
      : join(appPath, `${context.packager.appInfo.productFilename}.exe`);
    if (!inspectNativeFile(executable, { platform, arch: architecture })) throw new Error(`Missing native Electron executable: ${executable}`);
    if (platform === 'darwin') {
      const infoPlistPath = join(appPath, 'Contents', 'Info.plist');
      if (fs.existsSync(infoPlistPath)) {
        const plist = fs.readFileSync(infoPlistPath, 'utf8')
          .replace(/\s*<key>NSCameraUsageDescription<\/key>\s*<string>[^<]*<\/string>/g, '')
          .replace(/\s*<key>NSCameraUseContinuityCameraDeviceType<\/key>\s*<(?:true|false)\/>/g, '');
        fs.writeFileSync(infoPlistPath, plist, 'utf8');
      }
    }
    // Includes the Electron host, nested frameworks/helpers, ASAR contents,
    // unpacked modules and every extra resource. Links must stay in the bundle.
    assertPackagedPtyArtifacts(appPath, { platform, arch: architecture });
    packagedDirectories.set(appPath, { platform, arch: architecture });
    scanNativePackage(appPath, { platform, arch: architecture });
  },
  afterAllArtifactBuild: async () => {
    // NSIS adds elevate.exe after afterPack. Check the final payload again before
    // the separate release/upload job may consume these locally built artifacts.
    if (!packagedDirectories.size) throw new Error('No validated package directories; prepackaged artifacts require the normal target packaging gates.');
    for (const [directory, target] of packagedDirectories) {
      assertPackagedPtyArtifacts(directory, target);
      scanNativePackage(directory, target);
    }
    return [];
  },

  // MCP servers are optional release payloads. The manifest and launcher are
  // always shipped; architecture-specific server payloads are added by the
  // release pipeline when present and never downloaded by the installed app.
  extraResources: [...(build.extraResources || []), mcpRuntimeResources, computerRuntimeResources, gitRuntimeResources, compilerLibraryResources],
  ...(isWindows ? {
    nsis: {
      ...build.nsis,
      include: join(__dirname, 'build-resources', 'nextmux-installer-space.nsh'),
    },
    // Keep the status icon outside asar so Tray can load it in packaged
    // Windows builds as well as in the macOS bundle.
    extraResources: [...(build.extraResources || []), mcpRuntimeResources, computerRuntimeResources, gitRuntimeResources, compilerLibraryResources, windowsTrayIcon, windowsSpeech, windowsFfmpeg],
  } : {}),
  forceCodeSigning: signingRequired,
  win: {
    ...build.win,
    // electron-builder 26.15.3 shouldSignFile supports !suffix exclusions.
    // Keep this upstream-signed UIAccess worker byte-identical: its pinned hash
    // is also checked by the elevated Program Files installer at first use.
    signExts: [...(build.win?.signExts || []), '!qwen-cua-driver-uia.exe'],
    ...(publisherNames.length ? { publisherName: publisherNames } : {}),
  },
  mac: {
    ...build.mac,
    // Only macOS-specific extras: electron-builder adds these to the top-level extraResources (the
    // shared runtimes above), and listing those here again copied them twice — the git runtime's
    // symlinks then failed with EEXIST and packaging stopped.
    extraResources: [trayTemplate, trayTemplateRetina, { from: 'native/speech/macos/NextMuxSpeechHelper.app', to: 'speech/NextMuxSpeechHelper.app',
      filter: ['Contents/Info.plist', 'Contents/MacOS/NextMuxSpeechHelper'] },
      // The virtual display that keeps the AI's windows in the conversation tab (computer-window-view.cjs).
      { from: 'native/display/macos', to: 'display', filter: ['NextMuxDisplayHelper'] }],
    hardenedRuntime: true,
    // Microphone and Apple Events need explicit hardened-runtime entitlements;
    // helpers and bundled tools inherit them.
    entitlements: 'entitlements.mac.plist',
    entitlementsInherit: 'entitlements.mac.plist',
    notarize: signingRequired,
  },
};
