import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyContentSecurityPolicyToHtml } from '../../../scripts/apply-desktop-csp.mjs';

const desktopPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const runtimeConfig = await readFile(new URL('../desktop-runtime-config.cjs', import.meta.url), 'utf8');
const macLauncher = await readFile(new URL('../../../scripts/start-nextmux-macos.sh', import.meta.url), 'utf8');
const windowsLauncher = await readFile(new URL('../../../scripts/start-nextmux.ps1', import.meta.url), 'utf8');
const updater = await readFile(new URL('../updater.cjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../nextmux-electron-preload.cjs', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../bootstrap.cjs', import.meta.url), 'utf8');
const contribution = await readFile(new URL('../../../packages/theia-nextmux-extension/src/browser/nextmux-desktop-contribution.ts', import.meta.url), 'utf8');

test('the Electron frontend runs under a strict CSP: scripts only from the app, applied to the pages it loads', async () => {
  const require = (await import('node:module')).createRequire(import.meta.url);
  const { strictContentSecurityPolicy: policy } = require('../desktop-runtime-config.cjs');
  const script = /(?:^|;\s*)script-src ([^;]*)/.exec(policy)?.[1] || '';
  // 'unsafe-eval' is required by Theia's AJV schema compiler; no inline code, no remote script host.
  assert.equal(script.trim(), "'self' 'unsafe-eval'");
  assert.doesNotMatch(script, /unsafe-inline|https?:|\*/);
  assert.match(policy, /object-src 'none'/);
  assert.match(desktopPackage.scripts['build:release'], /theia build --mode production/);
  assert.match(desktopPackage.scripts['build:release'], /apply-desktop-csp\.mjs/);
  assert.match(desktopPackage.scripts['build:dev'], /apply-desktop-csp\.mjs --pages-only/, 'development runs under the same page policy');
  const writer = await readFile(new URL('../../../scripts/apply-desktop-csp.mjs', import.meta.url), 'utf8');
  assert.match(writer, /join\(desktopRoot, 'lib', 'frontend', 'index\.html'\)/, 'the policy lands in the HTML Electron loads (lib), not only src-gen');
  assert.match(writer, /join\(desktopRoot, 'lib', 'frontend', 'secondary-window\.html'\)/);
  const source = '<!doctype html>\n<html><head>\n  <meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-eval\'">\n</head><body></body></html>';
  const once = applyContentSecurityPolicyToHtml(source, runtimeConfig.match(/strictContentSecurityPolicy\s*=\s*(["'`])([\s\S]*?)\1/)?.[2] || "default-src 'self'; script-src 'self'");
  const twice = applyContentSecurityPolicyToHtml(once, "default-src 'self'; script-src 'self'");
  assert.equal((twice.match(/Content-Security-Policy/g) || []).length, 1);
  assert.match(twice, /script-src (?:&apos;|&#39;|')self/);
  assert.doesNotMatch(twice, /script-src 'unsafe-eval'"/, 'a page\'s own weaker policy is replaced');
});

test('NextMux exits without the generic workspace-save confirmation', () => {
  assert.equal(desktopPackage.theia.frontend.config.preferences['application.confirmExit'], 'never');
});

test('Electron requires an explicit begun/saved receipt and cancels timed-out close requests', () => {
  assert.match(updater, /window\.on\('close',[\s\S]*?event\.preventDefault\(\)[\s\S]*?offerClosePreparation\(window\)/);
  assert.match(updater, /function offerClosePreparation[\s\S]*?webContents\.send\('nextmux:prepare-close', token\)/);
  assert.match(updater, /closePreparationTimeoutMs\s*=\s*5_000/);
  assert.match(updater, /event\.senderFrame\s*!==\s*event\.sender\?\.mainFrame/);
  assert.match(updater, /nextmux:prepare-close:begin/);
  assert.match(updater, /!match\.state\.begun/);
  assert.match(updater, /setTimeout\(\(\) => cancelClosePreparation\(window, 'timeout', state\), closePreparationTimeoutMs\)/);
  assert.match(updater, /nextmux:prepare-close:cancelled/);
  assert.match(preload, /onPrepareClose:[\s\S]*?nextmux:prepare-close/);
  assert.match(preload, /completePrepareClose:[\s\S]*?nextmux:prepare-close:complete/);
  assert.match(contribution, /onPrepareClose[\s\S]*?shutdownForApplicationExit\(\)[\s\S]*?completePrepareClose/);
});

test('embedded browsing is isolated in the main process and cannot open native surfaces', () => {
  assert.match(updater, /session\.fromPartition\('persist:nextmux-browser'\)/);
  assert.match(updater, /browserSession\.setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(updater, /browserSession\.on\('will-download',[\s\S]*?preventDefault/);
  assert.match(updater, /will-attach-webview/);
  assert.match(updater, /params\.partition !== 'persist:nextmux-browser'/);
  assert.match(updater, /delete webPreferences\.preload/);
  assert.match(updater, /contents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(updater, /contents\.on\('will-redirect', blockUnsafeNavigation\)/);
  assert.match(updater, /nextmux:external:open[\s\S]*?trustedMainFrame\(event\)/);
  assert.match(updater, /nextmux:path:open[\s\S]*?trustedMainFrame\(event\)[\s\S]*?safeLocalOpenTarget\(value\)/);
  assert.match(updater, /launchableExtensions = [^\n]*app\|command\|/);
  assert.match(updater, /stats\.mode & 0o111/);
});

test('desktop content shares the native titlebar without covering macOS traffic lights', () => {
  const options = desktopPackage.theia.frontend.config.electron.windowOptions;
  assert.equal(options.titleBarStyle, 'hiddenInset');
  assert.deepEqual(options.trafficLightPosition, { x: 12, y: 11 });
});

test('macOS launcher selects a supported runtime on Apple Silicon and Intel without a user-specific path', () => {
  assert.match(macLauncher, /major > 22 \|\| \(major == 22 && minor >= 12\)/);
  assert.match(macLauncher, /sysctl\.proc_translated/);
  assert.match(macLauncher, /candidate_arch=.*process\.arch/);
  assert.match(macLauncher, /candidate_arch.*NODE_EXPECTED_ARCH/);
  assert.match(macLauncher, /\/opt\/homebrew\/opt\/node@24\/bin\/node/);
  assert.match(macLauncher, /\/usr\/local\/opt\/node@24\/bin\/node/);
  assert.match(macLauncher, /\$HOME\/\.cache\/codex-runtimes\/codex-primary-runtime/);
  assert.doesNotMatch(macLauncher, /\/Users\/xuhao/);
  assert.ok(
    macLauncher.indexOf('if [[ -n "$codex_runtime_pnpm"') < macLauncher.indexOf('if command -v corepack'),
    'the bundled pnpm fallback must be tried before an old interactive Corepack'
  );
});

test('macOS launcher starts the packaged NextMux entry instead of Electron default_app', () => {
  assert.match(macLauncher, /node_modules\/\.bin\/electron/);
  assert.match(macLauncher, /node_modules\/electron\/dist\/Electron\.app\/Contents\/MacOS\/Electron/);
  assert.match(macLauncher, /select_electron\(\)/);
  assert.match(macLauncher, /ROOT\/apps\/desktop/);
  assert.match(macLauncher, /--electronUserData=\"\$DESKTOP_PROFILE\"/);
  assert.match(macLauncher, /--user-data-dir=\"\$DESKTOP_PROFILE\"/);
  assert.match(macLauncher, /NEXTMUX_OPEN_PORTAL/);
  assert.doesNotMatch(macLauncher, /pnpm_run --filter @nextmux\/desktop start\s*$/m);
});

test('source Electron launches identify themselves as NextMux', () => {
  assert.equal(desktopPackage.theia.frontend.config.preferences['window.title'], 'NextMux');
  assert.match(bootstrap, /app\.setName\(['"]NextMux['"]\)/);
  assert.match(bootstrap, /setAppUserModelId\?\.\(['"]io\.nextmux\.desktop['"]\)/);
  assert.match(bootstrap, /browser-window-created[\s\S]*?page-title-updated[\s\S]*?window\.setTitle\(['"]NextMux['"]\)/);
  // The window is sized to the display before creation (extension electron-main),
  // never resized after it is shown.
  assert.doesNotMatch(bootstrap, /setBounds\(/);
  assert.equal(desktopPackage.theia.frontend.config.electron.windowOptions.width, undefined);
});

test('source launchers bind dependency caches to the native runtime and force a native rebuild after a mismatch', () => {
  for (const launcher of [macLauncher, windowsLauncher]) {
    assert.match(launcher, /platform=/);
    assert.match(launcher, /arch=/);
    assert.match(launcher, /modules=/);
    assert.match(launcher, /electron=/);
    assert.match(launcher, /dependencies\.sha256/);
  }
  assert.match(macLauncher, /process\.versions\.modules/);
  assert.match(macLauncher, /devDependencies\.electron/);
  assert.match(macLauncher, /DEPENDENCIES_UPDATED=1/);
  assert.match(macLauncher, /DEPENDENCIES_UPDATED == 1.*desktop_build_required/s);
  assert.match(macLauncher, /install --frozen-lockfile --force/);
  assert.ok(macLauncher.indexOf('pnpm_run desktop:build') < macLauncher.lastIndexOf('dependency_stamp >'));
  assert.match(windowsLauncher, /process\.versions\.modules/);
  assert.match(windowsLauncher, /devDependencies\.electron/);
  assert.match(windowsLauncher, /RuntimeInformation\]::OSArchitecture/);
  assert.match(windowsLauncher, /nodeArchitecture -ne \$expectedNodeArchitecture/);
  assert.match(windowsLauncher, /\$dependenciesUpdated -or \(Test-DesktopBuildRequired\)/);
  assert.match(windowsLauncher, /@\('install', '--frozen-lockfile', '--force'\)/);
  assert.ok(windowsLauncher.indexOf("Invoke-Pnpm -Arguments @('desktop:build')") < windowsLauncher.lastIndexOf('Save-DependencyStamp'));
});

test('Windows source startup prepares the native ARM64 FFmpeg before deciding whether to build desktop', () => {
  const prepare = windowsLauncher.indexOf("scripts\\prepare-windows-arm64-ffmpeg.mjs");
  const buildDecision = windowsLauncher.indexOf('if ($dependenciesUpdated -or (Test-DesktopBuildRequired))');
  assert.ok(prepare >= 0, 'the Windows launcher must invoke the pinned ARM64 FFmpeg preparer');
  assert.ok(prepare < buildDecision, 'ARM64 FFmpeg must be ready before the desktop build decision');
});

test('Windows source startup rebuilds when the local system speech helper is missing or changed', () => {
  assert.match(windowsLauncher, /native\\speech\\windows\\NextMuxSpeechHelper\.exe/);
  assert.match(windowsLauncher, /apps\\desktop\\native\\speech/);
  assert.ok(windowsLauncher.indexOf('NextMuxSpeechHelper.exe') < windowsLauncher.indexOf('if ($dependenciesUpdated -or (Test-DesktopBuildRequired))'));
  assert.match(JSON.stringify(desktopPackage.scripts), /build-native-speech\.mjs/);
});

test('Windows launcher rejects Node versions below the dependency floor before invoking pnpm', () => {
  assert.match(windowsLauncher, /process\.versions\.node/);
  assert.match(windowsLauncher, /\[System\.Version\]'22\.12\.0'/);
  assert.match(windowsLauncher, /Node\.js 22\.12/);
  assert.ok(
    windowsLauncher.indexOf("$nodeCommand.Source -p 'process.versions.node'") < windowsLauncher.indexOf('$pnpmCommand = Resolve-Pnpm'),
    'Node compatibility must be checked before package-manager discovery or installation'
  );
  assert.doesNotMatch(windowsLauncher, /Node\.js 20/);
});
