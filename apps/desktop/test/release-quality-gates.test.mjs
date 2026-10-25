import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);

const root = new URL('../../../', import.meta.url);
const workflow = await readFile(new URL('.github/workflows/desktop-release.yml', root), 'utf8');
const desktopVerifier = await readFile(new URL('scripts/verify-desktop-native-artifacts.mjs', root), 'utf8');
const terminalVerifier = await readFile(new URL('scripts/verify-terminal-native-artifact.mjs', root), 'utf8');
const windowsArm64FfmpegPreparer = await readFile(new URL('scripts/prepare-windows-arm64-ffmpeg.mjs', root), 'utf8');
const electronInstaller = await readFile(new URL('scripts/ensure-electron.mjs', root), 'utf8');
const ffmpegPortable = await readFile(new URL('packages/theia-ffmpeg-portable/index.js', root), 'utf8');
const desktopManifestWriter = await readFile(new URL('scripts/apply-desktop-csp.mjs', root), 'utf8');
const desktopE2eRunner = await readFile(new URL('scripts/desktop-terminal-ci-e2e.mjs', root), 'utf8');
const dataPersistenceE2e = await readFile(new URL('scripts/desktop-install-data-persistence-e2e.mjs', root), 'utf8');
const desktopPackage = JSON.parse(await readFile(new URL('apps/desktop/package.json', root), 'utf8'));
const builderConfigurationUrl = new URL('apps/desktop/electron-builder.config.cjs', root);
const signingVerifierUrl = new URL('scripts/verify-desktop-signing.mjs', root);
const commandCaptureUrl = new URL('scripts/capture-desktop-release-command.mjs', root);
const evidenceWriterUrl = new URL('scripts/write-desktop-release-evidence.mjs', root);
const rolloutGate = await readFile(new URL('scripts/p10-rollout-gate.mjs', root), 'utf8');

function builderExtraResources(platform, architecture) {
  const probe = [
    "Object.defineProperty(process, 'platform', { value: process.argv[1] });",
    "Object.defineProperty(process, 'arch', { value: process.argv[2] });",
    'const configuration = require(process.argv[3]);',
    "process.stdout.write(JSON.stringify(configuration.extraResources || []));",
  ].join('\n');
  const result = spawnSync(process.execPath, [
    '-e', probe, platform, architecture, fileURLToPath(builderConfigurationUrl),
  ], {
    encoding: 'utf8',
    env: { ...process.env, NEXTMUX_REQUIRE_SIGNING: '0', WINDOWS_PUBLISHER_NAME: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('desktop release is blocked on the same commit by the full workspace and model-runtime gates', () => {
  assert.match(workflow, /quality-gate:[\s\S]*?pnpm check[\s\S]*?pnpm --filter @nextmux\/model-runtime test/);
  assert.equal((workflow.match(/needs:\s*\[quality-gate,\s*release-targets\]/g) || []).length, 2,
    'both native release jobs must depend on the shared quality gate and validated target matrix');
  assert.equal((workflow.match(/needs\.quality-gate\.outputs\.commit/g) || []).length, 2,
    'both native release jobs must prove that they checked out the quality-gated commit');
});

test('every native runner uploads durable verifier, E2E, runner, checksum, and signing evidence', () => {
  assert.equal((workflow.match(/name:\s+Upload release evidence/g) || []).length, 2);
  assert.equal((workflow.match(/if:\s+always\(\)/g) || []).length >= 4, true,
    'runner metadata and evidence upload must survive earlier gate failures');
  for (const evidence of [
    'source-terminal-verifier.json',
    'source-desktop-verifier.json',
    'packaged-terminal-verifier.json',
    'packaged-desktop-verifier.json',
    'runner.json',
    'signing-verifier.json',
    'data-persistence.json',
    'SHA256SUMS-',
  ]) assert.match(workflow, new RegExp(evidence.replaceAll('.', '\\.')));
  assert.match(workflow, /source-e2e\.stdout\.log/);
  assert.match(workflow, /source-e2e\.stderr\.log/);
});

test('evidence downloads are flat and the complete four-target set is checked before publication', () => {
  const evidenceUploads = [...workflow.matchAll(
    /name:\s+nextmux-(?:windows|macos)-\$\{\{ matrix\.arch \}\}-evidence\s+path:\s+([^\n]+)/g,
  )];
  assert.equal(evidenceUploads.length, 2);
  for (const match of evidenceUploads) {
    assert.equal(match[1].trim(), '${{ env.NEXTMUX_RELEASE_EVIDENCE }}',
      'an extra checksum path would change upload-artifact\'s common root and nest runner.json');
  }
  const preflight = workflow.indexOf('Verify the complete signed four-target distribution set');
  const publish = workflow.indexOf('Publish immutable GitHub release assets');
  assert.ok(preflight >= 0 && preflight < publish,
    'all four signed installers, portable/archive companions, checksums and evidence must pass before GitHub publication');
  assert.match(workflow, /promote-desktop-updates\.mjs release[^\n]+--dry-run/);
});

test('publishing invokes the fail-closed production rollout gate before release assets', () => {
  const gate = workflow.indexOf('Run the fail-closed P10 production rollout gate');
  const preflight = workflow.indexOf('Verify the complete signed four-target distribution set');
  const publish = workflow.indexOf('Publish immutable GitHub release assets');
  assert.ok(gate >= 0 && gate < preflight && preflight < publish);
  assert.match(workflow, /NEXTMUX_ROLLOUT_EVIDENCE_JSON/);
  assert.match(workflow, /p10-rollout-gate\.mjs --input rollout-evidence\.json/);
  assert.match(workflow, /refusing to publish without current production evidence/);
  assert.match(rolloutGate, /mode: 'decision_only'/);
});

test('native verifier proves keytar package location, architecture, hash, and Electron ABI loading', () => {
  for (const expected of [
    'keytar/package.json',
    "'build', 'Release', 'keytar.node'",
    'app.asar.unpacked',
    'node_modules/keytar/build/Release/keytar.node',
    'ELECTRON_RUN_AS_NODE',
    'process.versions.modules',
    'process.versions.napi',
    'sourceSha256Match',
  ]) assert.ok(desktopVerifier.includes(expected), `native verifier must include ${expected}`);
  assert.match(desktopVerifier, /Windows must bundle ffmpeg\.exe and ffprobe\.exe in the same directory/);
  assert.match(desktopVerifier, /sysctl\.proc_translated/);
  assert.match(desktopVerifier, /nativeProbeTimeout = rosettaQualification \? 300_000 : 20_000/);
  assert.match(desktopVerifier, /--output/);
  assert.match(terminalVerifier, /--output/);
});

test('Windows bundles FFmpeg with a verified portable pair while macOS retains pinned downloads', async () => {
  const components = await readFile(new URL('packages/theia-nextmux-extension/src/node/nextmux-components.ts', root), 'utf8');
  // Every desktop release target has a pinned FFmpeg and speech-recogniser entry.
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64']) {
    assert.ok(components.includes(`'${target}': { version:`), `FFmpeg for ${target}`);
    assert.ok(components.includes(`'${target}': { folder:`), `speech recogniser for ${target}`);
  }
  // The Windows ARM64 build is the same audited archive the old release preparation pinned.
  const sourceUrl = /url:\s*'([^']+)'/.exec(windowsArm64FfmpegPreparer)?.[1];
  const archiveSha256 = /archiveSha256:\s*'([a-f0-9]{64})'/.exec(windowsArm64FfmpegPreparer)?.[1];
  assert.ok(sourceUrl && components.includes(sourceUrl) && archiveSha256 && components.includes(archiveSha256));
  assert.match(components, /if \(digest !== artifact\.digest\) throw/);
  assert.doesNotMatch(desktopPackage.scripts['build:release'], /prepare-windows-arm64-ffmpeg/);

  const speech = { from: 'native/speech/windows', to: 'speech', filter: ['NextMuxSpeechHelper.exe'] };
  const tray = { from: 'build-resources/icon.ico', to: 'icon.ico' };
  const compiler = { from: dirname(require.resolve('typescript')), to: 'language-runtime/typescript', filter: ['lib*.d.ts'] };
  const mcp = { from: 'build-resources/mcp-runtime', to: 'mcp-runtime',
    filter: ['manifest.json', 'nextmux-mcp-runtime-launcher.cjs', 'runtimes/**/*', '!runtimes/playwright/browsers/**'] };
  const computer = platform => ({ from: `build-resources/computer-runtime/${platform}-\${arch}`, to: `computer-runtime/${platform}-\${arch}`, filter: ['*'] });
  const git = platform => ({ from: `build-resources/git-runtime/${platform}-\${arch}`, to: `git-runtime/${platform}-\${arch}`, filter: ['**/*'] });
  for (const target of [['win32', 'arm64'], ['win32', 'x64']]) {
    const resources = builderExtraResources(...target);
    const ffmpeg = resources.find(resource => resource.to === 'native/ffmpeg');
    assert.ok(ffmpeg, `Windows FFmpeg resource on ${target.join('-')}`);
    assert.equal(ffmpeg.from, 'native/ffmpeg/win32-${arch}');
    assert.ok(ffmpeg.filter.includes('ffmpeg.exe'));
    const actualMcp = resources.find(resource => resource.to === 'mcp-runtime');
    assert.ok(mcp.filter.every(pattern => actualMcp.filter.includes(pattern)));
    assert.ok(actualMcp.filter.includes('!runtimes/qwen-computer-use/package/dist/linux/**'));
    assert.ok(actualMcp.filter.includes('!runtimes/qwen-computer-use/package/dist/Open Computer Use.app/**'));
    assert.deepEqual(resources.filter(resource => resource !== ffmpeg && resource !== actualMcp), [computer('win32'), git('win32'), compiler, tray, speech]);
  }
  for (const target of [['darwin', 'x64'], ['darwin', 'arm64']]) {
    const resources = builderExtraResources(...target);
    const actualMcp = resources.find(resource => resource.to === 'mcp-runtime');
    assert.ok(mcp.filter.every(pattern => actualMcp.filter.includes(pattern)));
    assert.ok(actualMcp.filter.includes('!runtimes/qwen-computer-use/package/dist/windows/**'));
    assert.deepEqual(resources.filter(resource => resource !== actualMcp), [computer('darwin'), git('darwin'), compiler], `no FFmpeg resource on ${target.join('-')}`);
  }
  // The runtime gate requires both native tools even if a prepared payload is incomplete.
  assert.match(desktopVerifier, /const names = \['ffmpeg', 'ffprobe'\]/);
  assert.match(desktopVerifier, /verifyBundledFfmpeg\(join\(root, 'apps', 'desktop'\)\)/);
  assert.match(desktopVerifier, /verifyBundledFfmpeg\(resourcesDirectory, \{ packaged: true, references: references\.ffmpeg \}\)/);
  assert.match(desktopVerifier, /if \(process\.platform !== 'win32'\) \{\s*assert\.ok\(!unpackedFiles/);
  assert.match(desktopVerifier, /macOS FFmpeg must not be packaged: it is downloaded after installation/);
  assert.doesNotMatch(desktopVerifier, /WINDOWS_ARM64_FFMPEG_RELEASE/);
});

test('new native computer and Git payloads are prepared and verified in both source and final package', async () => {
  assert.match(desktopPackage.scripts['build:release'], /prepare-computer-runtime\.mjs.*prepare-git-runtime\.mjs.*theia build/);
  const builder = await readFile(builderConfigurationUrl, 'utf8');
  assert.match(builder, /beforePack:[\s\S]*await gitAssets\.beforePack\(context\)/);
  // electron-builder 26 keeps the app directory on packager.info; older versions on the packager.
  assert.match(builder, /const appDir = context\.packager\.appDir \|\| context\.packager\.info\?\.appDir/);
  assert.match(builder, /verifyComputerRuntime\(join\(appDir, 'build-resources'\)/);
  // The shared runtimes come from the top-level list on every system; macOS adds only its own extras
  // (listing the shared ones again copied them twice and broke on the Git runtime's symlinks).
  assert.match(builder, /mac:[\s\S]*extraResources: \[trayTemplate, trayTemplateRetina, \{ from: 'native\/speech\/macos/);
  assert.doesNotMatch(builder.slice(builder.indexOf('mac: {')), /extraResources: \[mcpRuntimeResources/);
  assert.match(desktopVerifier, /computer: verifyComputerRuntime\(join\(root, 'apps', 'desktop', 'build-resources'\)/);
  assert.match(desktopVerifier, /computer: verifyComputerRuntime\(resourcesDirectory, \{ packaged: true, machineArchitectures \}\)/);
  assert.match(desktopVerifier, /git: await gitAssets\.verifyGitRuntime\(join\(resourcesDirectory, 'git-runtime', platformDirectory\), \{ platform: process\.platform, architecture: process\.arch, packaged: true \}\)/);
});

test('macOS cross-architecture builds cannot reuse host-architecture Electron or FFmpeg', () => {
  assert.match(electronInstaller, /installedExecutableMatchesTarget/);
  assert.match(electronInstaller, /npm_config_platform:\s*platform/);
  assert.match(electronInstaller, /npm_config_arch:\s*arch/);
  assert.match(electronInstaller, /lipo[\s\S]*?-archs/);
  assert.match(ffmpegPortable, /electron-v\$\{electronVersion\}-\$\{platform\}-\$\{arch\}/);
  assert.match(ffmpegPortable, /artifactName:\s*'ffmpeg',[\s\S]*?platform,[\s\S]*?arch/);
});

test('macOS release artifacts prove the declared macOS 12 deployment baseline', () => {
  assert.match(workflow, /MACOSX_DEPLOYMENT_TARGET:\s*'12\.0'/);
  assert.match(desktopVerifier, /vtool[\s\S]*?-show-build/);
  assert.match(desktopVerifier, /LC_BUILD_VERSION[\s\S]*?LC_VERSION_MIN_MACOSX/,
    'both modern and legacy macOS minimum-version load commands must be accepted');
  assert.match(desktopVerifier, /let loadCommand/,
    'compiler tool-version fields must not be mistaken for the deployment baseline');
  assert.match(desktopVerifier, /macOS minimum-version load command/);
  assert.match(desktopVerifier, /minimumMacosVersions/);
});

test('packaged E2E runs the actual Windows installer and portable EXE plus DMG and ZIP apps', () => {
  assert.match(workflow, /NextMux-\*-portable\.exe[\s\S]*?portable-e2e\.stdout\.log/);
  assert.match(workflow, /NextMux-\*-setup\.exe[\s\S]*?installed-e2e\.stdout\.log/);
  assert.match(workflow, /NEXTMUX_PACKAGED_EXECUTABLE[\s\S]*?install/);
  assert.match(workflow, /hdiutil attach[\s\S]*?dmg-e2e\.stdout\.log/);
  assert.match(workflow, /unzip[\s\S]*?zip-e2e\.stdout\.log/);
});

test('native release runners verify user data survives app removal and replacement', () => {
  assert.match(workflow, /desktop-install-data-persistence-e2e\.mjs --platform windows/);
  assert.match(workflow, /desktop-install-data-persistence-e2e\.mjs --platform macos/);
  assert.match(workflow, /data-persistence\.stdout\.log/);
  assert.match(dataPersistenceE2e, /delete|remove|uninstall/i);
  assert.match(dataPersistenceE2e, /LOCALAPPDATA/);
  assert.match(dataPersistenceE2e, /Library', 'Application Support/);
  assert.match(dataPersistenceE2e, /marker.*preserved|preserved.*marker/i);
});

test('final installer and archive contents repeat native and package-boundary verification', () => {
  for (const target of ['installed', 'zip', 'dmg']) {
    assert.match(workflow, new RegExp(`${target}-terminal-verifier\\.stdout\\.log`));
    assert.match(workflow, new RegExp(`${target}-desktop-verifier\\.stdout\\.log`));
  }
});

test('macOS signing verifier checks app bundles directly and mounted apps inside DMGs', async () => {
  const source = await readFile(signingVerifierUrl, 'utf8');
  assert.match(source, /NextMux\.app/);
  assert.match(source, /\.dmg/);
  assert.match(source, /hdiutil/);
  assert.match(source, /mountpoint/);
  assert.equal((source.match(/stapler/g) || []).length >= 2, true);
  assert.match(source, /codesign/);
  assert.match(source, /spctl/);
  assert.doesNotMatch(source, /'stapler', 'validate', diskImage/);
  assert.doesNotMatch(source, /'--type', 'open'/);
});

test('release command capture preserves separated stdout and stderr', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-release-command-'));
  try {
    const stdout = join(directory, 'stdout.log');
    const stderr = join(directory, 'stderr.log');
    const result = spawnSync(process.execPath, [fileURLToPath(commandCaptureUrl), '--stdout', stdout, '--stderr', stderr, '--',
      process.execPath, '-e', "process.stdout.write('out'); process.stderr.write('err')"], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(stdout, 'utf8'), 'out');
    assert.equal(await readFile(stderr, 'utf8'), 'err');
    const failure = spawnSync(process.execPath, [fileURLToPath(commandCaptureUrl), '--stdout', stdout, '--stderr', stderr, '--',
      process.execPath, '-e', 'process.exit(7)'], { encoding: 'utf8' });
    assert.equal(failure.status, 7, 'capture wrapper must preserve a failing release command exit code');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release evidence records declared and actual runner identity plus artifact SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-release-evidence-'));
  try {
    const releaseDirectory = join(directory, 'release');
    const output = join(directory, 'runner.json');
    await mkdir(releaseDirectory);
    await writeFile(join(releaseDirectory, 'NextMux-test.exe'), 'artifact');
    const result = spawnSync(process.execPath, [fileURLToPath(evidenceWriterUrl),
      '--output', output,
      '--release-dir', releaseDirectory,
      '--platform', 'windows',
      '--arch', 'x64'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.declared.platform, 'windows');
    assert.equal(report.declared.architecture, 'x64');
    assert.equal(report.runner.nodePlatform, process.platform);
    assert.equal(report.runner.nodeArchitecture, process.arch);
    assert.equal(report.artifacts[0].sha256,
      createHash('sha256').update('artifact').digest('hex'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
