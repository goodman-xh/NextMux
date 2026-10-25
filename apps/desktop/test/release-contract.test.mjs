import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DESKTOP_RELEASE_TARGETS } from '../../../scripts/desktop-release-targets.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const agentRuntimePackageJson = JSON.parse(await readFile(new URL('../../../packages/agent-runtime/package.json', import.meta.url), 'utf8'));
const workspaceConfiguration = await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
const lockfile = await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
const updater = await readFile(new URL('../updater.cjs', import.meta.url), 'utf8');
const builderConfiguration = await readFile(new URL('../electron-builder.config.cjs', import.meta.url), 'utf8');
const preflight = await readFile(new URL('../../../scripts/verify-desktop-release-environment.mjs', import.meta.url), 'utf8');
const nativeDependencyVerifier = await readFile(new URL('../../../scripts/verify-desktop-native-artifacts.mjs', import.meta.url), 'utf8');
const updatePromotion = await readFile(new URL('../../../scripts/promote-desktop-updates.mjs', import.meta.url), 'utf8');
const terminalE2e = await readFile(new URL('../../../scripts/desktop-terminal-ci-e2e.mjs', import.meta.url), 'utf8');
const terminalProfileE2e = await readFile(new URL('../../../scripts/desktop-terminal-profile-e2e.mjs', import.meta.url), 'utf8');
const terminalProfileLaunchE2e = await readFile(new URL('../../../scripts/desktop-terminal-profile-launch-e2e.mjs', import.meta.url), 'utf8');
const terminalLifecycleE2e = await readFile(new URL('../../../scripts/desktop-terminal-lifecycle-e2e.mjs', import.meta.url), 'utf8');
const managedTerminalE2e = await readFile(new URL('../../../scripts/desktop-managed-terminal-e2e.mjs', import.meta.url), 'utf8');
const agentToolsE2e = await readFile(new URL('../../../scripts/desktop-agent-tools-e2e.mjs', import.meta.url), 'utf8');
const agentRecoveryE2e = await readFile(new URL('../../../scripts/desktop-agent-recovery-e2e.mjs', import.meta.url), 'utf8');
const lightThemeE2e = await readFile(new URL('../../../scripts/desktop-light-theme-visual-e2e.mjs', import.meta.url), 'utf8');
const modelPickerE2e = await readFile(new URL('../../../scripts/desktop-model-picker-e2e.mjs', import.meta.url), 'utf8');
const conversationScrollE2e = await readFile(new URL('../../../scripts/desktop-conversation-scroll-e2e.mjs', import.meta.url), 'utf8');
const desktopReloadHelper = await readFile(new URL('../../../scripts/desktop-cdp-reload.mjs', import.meta.url), 'utf8');
const desktopReloadFlows = await Promise.all([
  'desktop-conversation-incremental-persistence-e2e.mjs',
  'desktop-conversation-history-e2e.mjs',
  'desktop-conversation-branch-e2e.mjs',
  'desktop-conversation-scroll-e2e.mjs',
  'desktop-follow-up-queue-isolation-e2e.mjs',
  'desktop-permission-persistence-e2e.mjs',
  'desktop-terminal-lifecycle-e2e.mjs',
  'desktop-light-theme-visual-e2e.mjs',
].map(name => readFile(new URL(`../../../scripts/${name}`, import.meta.url), 'utf8')));
const officialQaServer = await readFile(new URL('../../../scripts/official-model-qa-server.mjs', import.meta.url), 'utf8');
const nativeVerifier = await readFile(new URL('../../../scripts/verify-terminal-native-artifact.mjs', import.meta.url), 'utf8');
const signingVerifier = await readFile(new URL('../../../scripts/verify-desktop-signing.mjs', import.meta.url), 'utf8');
const theiaCorePatch = await readFile(new URL('../../../patches/@theia+core@1.74.1.patch', import.meta.url), 'utf8');

test('macOS release matrix builds fresh extension output for Intel and Apple Silicon', () => {
  assert.deepEqual(
    DESKTOP_RELEASE_TARGETS.filter(target => target.platform === 'macos')
      .map(({ arch, runner }) => ({ arch, runner })),
    [
      { arch: 'x64', runner: 'macos-26-intel' },
      { arch: 'arm64', runner: 'macos-26' },
    ],
  );
  assert.match(workflow, /matrix:\s*\$\{\{\s*fromJSON\(needs\.release-targets\.outputs\.macos\)\s*\}\}/);
  assert.match(workflow, /pnpm desktop:build[\s\S]*?dist:mac:\$\{\{ matrix\.arch \}\}/);
  assert.equal(packageJson.optionalDependencies['@parcel/watcher-darwin-x64'], '2.6.0');
  assert.equal(packageJson.optionalDependencies['@parcel/watcher-darwin-arm64'], '2.6.0');
  assert.equal(packageJson.optionalDependencies['@vscode/ripgrep-darwin-x64'], '1.18.0');
  assert.equal(packageJson.optionalDependencies['@vscode/ripgrep-darwin-arm64'], '1.18.0');
  assert.equal(packageJson.build.mac.minimumSystemVersion, '12.0');
  assert.match(workspaceConfiguration, /'@ffmpeg-installer\/darwin-arm64': true/);
  assert.match(workspaceConfiguration, /'@ffmpeg-installer\/darwin-x64': true/);
});

test('Windows release matrix builds native x64 and ARM64 terminal dependencies', () => {
  assert.deepEqual(
    DESKTOP_RELEASE_TARGETS.filter(target => target.platform === 'windows')
      .map(({ arch, runner }) => ({ arch, runner })),
    [
      { arch: 'x64', runner: 'windows-2025' },
      { arch: 'arm64', runner: 'windows-11-arm' },
    ],
  );
  assert.match(workflow, /matrix:\s*\$\{\{\s*fromJSON\(needs\.release-targets\.outputs\.windows\)\s*\}\}/);
  assert.match(workflow, /dist:win:\$\{\{ matrix\.arch \}\}/);
  assert.equal(packageJson.optionalDependencies['@parcel/watcher-win32-x64'], '2.6.0');
  assert.equal(packageJson.optionalDependencies['@parcel/watcher-win32-arm64'], '2.6.0');
  assert.equal(packageJson.optionalDependencies['@vscode/ripgrep-win32-x64'], '1.18.0');
  assert.equal(packageJson.optionalDependencies['@vscode/ripgrep-win32-arm64'], '1.18.0');
  assert.match(packageJson.scripts['dist:win:x64:prepared'], /--x64/);
  assert.match(packageJson.scripts['dist:win:arm64:prepared'], /--arm64/);
});

test('desktop and agent runtime use the same audited native PTY release', () => {
  assert.equal(packageJson.dependencies['node-pty'], '1.2.0-beta.14');
  assert.equal(agentRuntimePackageJson.dependencies['node-pty'], packageJson.dependencies['node-pty']);
  assert.match(workspaceConfiguration, /overrides:[\s\S]*?node-pty:\s*["']1\.2\.0-beta\.14["']/,
    'Theia and every transitive terminal path must resolve the same native PTY release');
  const lockedVersions = [...new Set([...lockfile.matchAll(/^\s{2}node-pty@([^:]+):/gm)].map(match => match[1]))];
  assert.deepEqual(lockedVersions, ['1.2.0-beta.14'],
    'the frozen lockfile must not retain a second node-pty JavaScript/native ABI pair');
});

test('signed releases retain architecture-scoped updater manifests and publish them to R2', () => {
  assert.match(workflow, /apps\/desktop\/release\/\*\.yml/);
  assert.match(workflow, /apps\/desktop\/release\/\*\.zip\.blockmap/);
  assert.match(workflow, /channel="\$\{version#\*-\}"/);
  assert.match(workflow, /promote-desktop-updates\.mjs release/);
  assert.match(workflow, /nextmux-windows-x64-evidence/);
  assert.match(workflow, /nextmux-windows-arm64-evidence/);
  assert.match(workflow, /nextmux-macos-x64-evidence/);
  assert.match(workflow, /nextmux-macos-arm64-evidence/);
  assert.match(workflow, /--evidence release-evidence/);
  assert.match(updatePromotion, /nextmux-platform-assets/);
  assert.match(updatePromotion, /\$\{prefix\}\/releases\/\$\{tag\}\/\$\{layout\.platform\}\/\$\{layout\.arch\}/);
  assert.match(updatePromotion, /upload\(bucket, `\$\{liveBase\}\/\$\{manifestName\}`/,
    'mutable manifest must be uploaded only after versioned artifacts');
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(updater, /updates\/\$\{updatePlatform\}\/\$\{process\.arch\}/);
  assert.match(updater, /autoUpdater\.channel\s*=\s*updateChannel/);
  assert.match(updater, /allowDowngrade\s*=\s*false/,
    'an archived feed alone must not authorize a desktop downgrade');
  assert.match(updatePromotion, /signing-verifier\.json/);
  assert.match(updatePromotion, /release-attestation\.json/);
  assert.match(updatePromotion, /signedRequired/);
  assert.match(updater, /api\/releases\/target/);
  assert.match(updater, /UPDATE_TARGET_UNAVAILABLE/);
  assert.doesNotMatch(updater, /return \{ kind: 'live' \}/,
    'a packaged client must not bypass the administrator target through the mutable feed');
  assert.match(updater, /downgradeFrom\.includes\(app\.getVersion\(\)\)/);
  assert.match(workflow, /promote-desktop-updates\.mjs rollback/);
});

test('tagged macOS artifacts are signed, notarized, and stapled before publishing', () => {
  assert.match(workflow, /NEXTMUX_REQUIRE_SIGNING/);
  assert.match(workflow, /verify-desktop-signing\.mjs/);
  assert.match(signingVerifier, /'--verify', '--deep', '--strict'/);
  assert.match(signingVerifier, /'stapler', 'validate', application/);
  assert.match(signingVerifier, /hdiutil[\s\S]*?mountpoint/,
    'DMG verification must inspect the mounted application bundle');
  assert.match(signingVerifier, /'stapler', 'validate', application/);
  assert.doesNotMatch(signingVerifier, /'stapler', 'validate', diskImage/,
    'a DMG container must not be treated as an app bundle');
  assert.match(signingVerifier, /'--type', 'execute'/);
  assert.doesNotMatch(signingVerifier, /'--type', 'open'/,
    'Gatekeeper assessment belongs to the mounted app bundle');
  assert.match(builderConfiguration, /forceCodeSigning:\s*signingRequired/);
  assert.match(builderConfiguration, /notarize:\s*signingRequired/);
  assert.match(builderConfiguration, /publisherName:\s*publisherNames/,
    'electron-updater must enforce the configured Windows publisher during installation');
  assert.match(builderConfiguration, /hardenedRuntime:\s*true/);
});

test('release preflight refuses cross-built or unsigned production artifacts', () => {
  assert.match(preflight, /hostPlatform/);
  assert.match(preflight, /hostArch/);
  assert.match(preflight, /WIN_CSC_LINK/);
  assert.match(preflight, /WINDOWS_PUBLISHER_NAME/);
  assert.match(preflight, /APPLE_API_KEY/);
  assert.match(preflight, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(preflight, /Release tag .* does not match desktop version/);
});

test('desktop native verifier covers Electron, watcher, ripgrep, speech and the Windows FFmpeg pair', () => {
  for (const expected of ['electron', 'watcher.node', 'rg.exe', 'NextMuxSpeechHelper.exe', 'ffmpeg.exe', 'ffprobe.exe', 'verifyBundledFfmpeg']) {
    assert.match(nativeDependencyVerifier, new RegExp(expected.replace('.', '\\.')));
  }
  assert.match(nativeDependencyVerifier, /process\.arch/);
  assert.match(nativeDependencyVerifier, /app\.asar\.unpacked/);
  assert.match(nativeDependencyVerifier, /verifyBundledFfmpeg\(resourcesDirectory, \{ packaged: true, references: references\.ffmpeg \}\)/);
  assert.doesNotMatch(packageJson.build.asarUnpack.join('\n'), /@ffmpeg-installer/);
  assert.match(packageJson.build.asarUnpack.join('\n'), /@parcel\/watcher/);
  assert.match(packageJson.build.asarUnpack.join('\n'), /@vscode\/ripgrep/);
});

test('every native release runner executes real PTY E2E before and after packaging', () => {
  const testStep = /name:\s+Run native terminal and release regressions[\s\S]*?@nextmux\/agent-runtime test[\s\S]*?@nextmux\/theia-extension test[\s\S]*?@nextmux\/desktop test/g;
  assert.equal([...workflow.matchAll(testStep)].length, 2);
  assert.equal((workflow.match(/source-e2e\.stdout\.log/g) || []).length, 2,
    'Windows and macOS native runners must exercise the complete source product suite');
  for (const target of ['portable', 'installed', 'zip', 'dmg']) {
    assert.match(workflow, new RegExp(`${target}-e2e\\.stdout\\.log`),
      `release workflow must exercise the real ${target} distribution target`);
  }
  assert.doesNotMatch(workflow, /NEXTMUX_DESKTOP_E2E_ONLY:/,
    'production release jobs must not silently narrow the product regression suite');
  assert.match(packageJson.scripts['test:e2e:terminal'], /desktop-terminal-ci-e2e\.mjs/);
  assert.equal((workflow.match(/verify-terminal-native-artifact\.mjs --bundle/g) || []).length, 2);
  assert.match(nativeVerifier, /bundledVersions/);
  assert.match(nativeVerifier, /does not match \$\{process\.arch\}/);
  assert.match(terminalE2e, /desktop-terminal-profile-launch-e2e\.mjs/,
    'the source and packaged application must launch every profile it presents as selectable');
  assert.match(terminalProfileLaunchE2e, /for \(const profile of launchableProfiles\)/);
  assert.match(terminalProfileLaunchE2e, /markerWritten/);
  assert.match(terminalProfileLaunchE2e, /data-terminal-profile-id/,
    'profile launch E2E must observe the live terminal DOM, not a removed persistence mirror');
  assert.doesNotMatch(terminalProfileLaunchE2e, /nextmux\.desktop\.terminalRecords\.v1/,
    'interactive PTY records are intentionally process-local and must never be restored from localStorage');
});

test('release runners launch the packaged native application and repeat terminal E2E after packaging', () => {
  assert.equal((workflow.match(/name:\s+Run packaged desktop product E2E/g) || []).length, 2);
  assert.equal((workflow.match(/(?:\$env:|export )NEXTMUX_PACKAGED_EXECUTABLE/g) || []).length, 4,
    'portable, installed NSIS, ZIP, and mounted DMG applications must each run the packaged suite');
  assert.match(terminalE2e, /process\.env\.NEXTMUX_PACKAGED_EXECUTABLE/);
  assert.match(terminalE2e, /--user-data-dir=/);
  assert.match(terminalE2e, /--remote-debugging-port=/);
});

test('desktop E2E uses a disposable Electron profile and removes it after every run', () => {
  assert.match(terminalE2e, /mkdtemp\(join\(tmpdir\(\), 'nextmux-desktop-e2e-'\)\)/);
  assert.match(terminalE2e, /--electronUserData/);
  assert.match(terminalE2e, /--user-data-dir=/,
    'Chromium storage must be isolated before Electron creates its default session');
  assert.match(terminalE2e, /npm_execpath/);
  assert.match(terminalE2e, /waitForDisposableElectronProfile/);
  assert.match(terminalE2e, /chromiumProfileMarkers/);
  assert.doesNotMatch(terminalE2e, /readdirSync\(userDataDirectory\)\.length > 0/,
    'pre-created state/config directories are not proof that Chromium used the profile');
  assert.match(terminalE2e, /rm\(userDataDirectory, \{ recursive: true, force: true/);
  assert.doesNotMatch(terminalE2e, /AppData[\\/]Roaming[\\/]NextMux/);
});

test('desktop product E2E extends the terminal gate with real UI regressions', () => {
  assert.match(packageJson.scripts['test:e2e:desktop'], /desktop-terminal-ci-e2e\.mjs/);
  assert.match(terminalE2e, /npm_lifecycle_event === 'test:e2e:desktop'/);
  for (const script of [
    'desktop-locale-e2e.mjs',
    'desktop-navigation-qa.mjs',
    'desktop-light-theme-visual-e2e.mjs',
    'desktop-model-picker-e2e.mjs',
    'desktop-drawer-stability-e2e.mjs',
    'desktop-file-editor-e2e.mjs',
    'desktop-permission-persistence-e2e.mjs',
    'desktop-conversation-scroll-e2e.mjs',
    'desktop-conversation-branch-e2e.mjs',
    'desktop-restart-persistence-e2e.mjs',
    'desktop-agent-queue-e2e.mjs',
    'desktop-agent-steering-e2e.mjs',
    'desktop-agent-lifecycle-e2e.mjs',
    'desktop-agent-recovery-e2e.mjs',
    'desktop-follow-up-queue-isolation-e2e.mjs',
  ]) assert.match(terminalE2e, new RegExp(script.replaceAll('.', '\\.')));
});

test('self-hosted queue regressions run only after every shared Electron-window flow', () => {
  const isolatedFlows = [
    'desktop-agent-queue-e2e.mjs',
    'desktop-agent-steering-e2e.mjs',
    'desktop-follow-up-queue-isolation-e2e.mjs',
  ];
  const sharedTail = terminalE2e.indexOf("'desktop-restart-persistence-e2e.mjs'");
  assert.notEqual(sharedTail, -1);
  assert.ok(sharedTail > terminalE2e.indexOf("'desktop-agent-recovery-e2e.mjs'"),
    'restart persistence must close the original Electron window only after every other shared-window flow');
  for (const flow of isolatedFlows) {
    assert.ok(terminalE2e.indexOf(`'${flow}'`) > sharedTail,
      `${flow} must not trigger the single-instance boundary before shared-window E2E finishes`);
  }
});

test('official-route E2E identifies models independently of localized display punctuation', () => {
  assert.match(agentToolsE2e, /replace\(\/\[\^a-z0-9\]\+\/g, ''\)/);
  assert.match(agentToolsE2e, /Input\.insertText', \{ text: qaProviderModelId \}/);
  assert.match(agentToolsE2e, /NEXTMUX_E2E_SECONDARY_MODEL_ID/);
  assert.match(agentToolsE2e, /NextMux E2E QA Secondary/);
  assert.doesNotMatch(agentToolsE2e, /text: '5\.6 sol'/);
  assert.match(managedTerminalE2e, /getAttribute\('data-model-id'\)/);
  assert.match(managedTerminalE2e, /route\.modelId !== qaRoute\.modelId/);
  assert.doesNotMatch(managedTerminalE2e, /gpt\\s\*5/);
  assert.match(agentRecoveryE2e, /getAttribute\('data-model-id'\)/);
  assert.doesNotMatch(agentRecoveryE2e, /GPT\\s\*5/);
});

test('light-theme E2E restores the official-model view before opening the compatible API drawer', () => {
  assert.match(lightThemeE2e, /data-desktop-section="coding"/);
  assert.match(lightThemeE2e, /the stable coding conversation composer/);
  assert.match(lightThemeE2e, /nmx-session-row\.is-current \.nmx-session-open/);
  assert.match(lightThemeE2e, /data-context-panel-toggle/);
  assert.match(lightThemeE2e, /data-model-center-view=\"official\"/);
  assert.match(lightThemeE2e, /data-provider-id=\"custom_openai\"/);
  assert.doesNotMatch(lightThemeE2e, /\.nmx-content-section \.nmx-section-heading > button/);
});

test('renderer reload E2E waits for a new document instead of interacting with stale DOM', () => {
  assert.match(desktopReloadHelper, /data-nextmux-e2e-document/);
  assert.match(desktopReloadHelper, /state\?\.marker !== marker/);
  assert.match(desktopReloadHelper, /Chromium may briefly have no execution context/);
  for (const source of desktopReloadFlows) {
    assert.match(source, /reloadDesktopDocument\(\{/);
    assert.doesNotMatch(source, /await call\('Page\.reload'/);
  }
});

test('Theia renderer channels release paired WebContents listeners after navigation or destruction', () => {
  assert.match(workspaceConfiguration, /'@theia\/core@1\.74\.1':\s+patches\/@theia\+core@1\.74\.1\.patch/);
  assert.match(lockfile, /'@theia\/core@1\.74\.1':\s+[a-f0-9]{64}/);
  assert.match(theiaCorePatch, /sender\.removeListener\('destroyed', onDestroyed\)/);
  assert.match(theiaCorePatch, /sender\.removeListener\('did-navigate', onDidNavigate\)/);
  assert.match(theiaCorePatch, /sender\.once\('did-navigate', onDidNavigate\)/);
  assert.match(theiaCorePatch, /sender\.once\('destroyed', onDestroyed\)/);
});

test('model-picker E2E establishes its own coding-navigation precondition', () => {
  assert.match(modelPickerE2e, /data-desktop-section=\"coding\"/);
  assert.match(modelPickerE2e, /coding model control/);
  assert.match(modelPickerE2e, /if \(document\.querySelector\('\.nmx-model-picker-popover'\)\) return true/);
  assert.match(modelPickerE2e, /coding\?\.getAttribute\('aria-current'\) !== 'page'/);
  assert.match(modelPickerE2e, /model picker supported and unsupported rows/);
  assert.match(lightThemeE2e, /the stable coding conversation composer/);
  assert.match(lightThemeE2e, /the restored desktop section/);
  assert.match(lightThemeE2e, /!document\.querySelector\('\.nmx-model-center'\)/);
});

test('scroll E2E binds its seeded conversation to the exact route created by that run', () => {
  assert.match(conversationScrollE2e, /routeId:\s*\$\{JSON\.stringify\(qaRoute\.routeId\)\}/);
  assert.match(conversationScrollE2e, /relayKey:\s*\$\{JSON\.stringify\(qaRoute\.relayKey\)\}/);
  assert.match(conversationScrollE2e, /modelId:\s*\$\{JSON\.stringify\(qaRoute\.modelId\)\}/);
  assert.doesNotMatch(conversationScrollE2e, /base\?\.(?:routeId|relayKey|modelId)\s*\|\|/);
});

test('managed PTY QA observes incremental output across the complete tool context', () => {
  assert.match(officialQaServer, /const toolOutputs = messages\.filter/);
  assert.match(officialQaServer, /toolOutputs\.flatMap\(result => Array\.isArray\(result\?\.chunks\)/);
  assert.match(officialQaServer, /attempt < 6/);
});

test('long-paste QA proves that removing a historical anchor removes its model attachment', () => {
  assert.match(officialQaServer, /bodyMarker \? requestMarker : `\$\{requestMarker\}_EDITED_NO_ATTACHMENT`/);
  assert.match(officialQaServer, /!bodyMarker && hasNamedTextAttachment/,
    'the second request must fail if the removed attachment is still sent to the provider');
  assert.match(terminalE2e, /desktop-long-paste-e2e\.mjs/);
});

test('release runners build the desktop bundle before source verification and verify final packaged resources', () => {
  const sourceGate = /name:\s+Build production desktop application bundle[\s\S]*?pnpm desktop:build:release[\s\S]*?verify-terminal-native-artifact\.mjs --bundle[\s\S]*?test:e2e:desktop/g;
  assert.equal([...workflow.matchAll(sourceGate)].length, 2,
    'each native runner must create apps/desktop/lib before bundle verification and source E2E');
  assert.equal((workflow.match(/verify-terminal-native-artifact\.mjs --packaged/g) || []).length, 5,
    'release runners must verify builder output, installed NSIS, extracted ZIP, and mounted DMG resources');
  assert.equal((workflow.match(/verify-desktop-native-artifacts\.mjs --packaged/g) || []).length, 5,
    'every final resource tree must also verify Electron, keytar, watcher, ripgrep, FFmpeg, speech, and file boundaries');
  assert.match(workspaceConfiguration, /publicHoistPattern:[\s\S]*?-\s*node-pty/,
    'strict pnpm installs must expose the pinned node-pty package to Theia bundle-plugin itself');
  assert.doesNotMatch(workflow, /\bNODE_PATH\s*:/,
    'release builds must not depend on a CI-only NODE_PATH workaround');
});

test('native release verification covers every runtime PTY artifact in the final package', () => {
  for (const artifact of [
    'conpty.node',
    'conpty_console_list.node',
    'conpty.dll',
    'OpenConsole.exe',
    'pty.node',
    'spawn-helper',
  ]) {
    assert.match(nativeVerifier, new RegExp(artifact.replace('.', '\\.')),
      `native verifier must cover ${artifact}`);
  }
  assert.match(nativeVerifier, /app\.asar\.unpacked/);
  assert.match(nativeVerifier, /versionsInArchive\(appAsar/,
    'packaged wrapper version must be read from the final app.asar, not the source tree');
  assert.match(nativeVerifier, /details\.sha256 === referenceArtifact\.sha256/,
    'packaged native files must match the audited node-pty release, not merely share an architecture');
  assert.match(nativeVerifier, /hasValidPlatformSignature/,
    'release signing may alter native bytes, so signed final binaries need an explicit signature fallback');
});

test('terminal profile E2E fails closed when host discovery is inconclusive or the UI omits a usable shell', () => {
  assert.doesNotMatch(terminalProfileE2e, /hostWslDistributionCount !== 0/,
    'an undefined WSL probe result must never count as an installed distribution');
  assert.match(terminalProfileE2e, /discoverUsableHostProfiles/);
  assert.match(terminalProfileE2e, /hostDiscoveryReliable/);
  assert.match(terminalProfileE2e, /missingProfileIds/);
  assert.match(terminalProfileE2e, /unexpectedProfileIds/);
  assert.match(terminalProfileLaunchE2e, /discoverUsableHostProfiles/,
    'launch E2E must independently restrict itself to host-proven profiles');
  assert.match(terminalProfileLaunchE2e, /missingProfileIds/,
    'launch E2E must fail if the application omits a host-proven profile');
});

test('terminal lifecycle E2E quotes fixture and argument paths for every selectable shell family', () => {
  assert.match(terminalLifecycleE2e, /quotePowerShellArgument/);
  assert.match(terminalLifecycleE2e, /quoteCommandPromptArgument/);
  assert.match(terminalLifecycleE2e, /quotePosixArgument/);
  assert.match(terminalLifecycleE2e, /shellVisiblePath/);
  assert.match(terminalLifecycleE2e, /nextmux terminal & dollar\$/,
    'the real lifecycle fixture must run from a path containing shell metacharacters');
});

test('desktop microphone bridge separates passive inspection from an explicit permission request', () => {
  assert.match(updater, /nextmux:microphone:status/);
  assert.match(updater, /nextmux:microphone:permission/);
  assert.match(updater, /osRelease: os\.release\(\)/);
  assert.match(updater, /arch: process\.arch/);
  assert.match(updater, /process\.platform === 'darwin' && status === 'not-determined'/,
    'macOS must show its native consent prompt only after the explicit request path');
});
