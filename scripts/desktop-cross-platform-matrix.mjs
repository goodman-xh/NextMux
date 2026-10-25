#!/usr/bin/env node

/**
 * Offline cross-platform qualification report for the desktop shell.
 *
 * This command deliberately distinguishes repository/CI contracts from a
 * native run.  A target is marked host_verified only when this process is
 * running on that target.  A configured GitHub runner is never treated as a
 * substitute for a consumer OS or a signed hardware run.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetManifest = JSON.parse(await readFile(resolve(root, 'config/desktop-release-targets.json'), 'utf8'));
const workflow = await readFile(resolve(root, '.github/workflows/desktop-release.yml'), 'utf8');
const desktopPackage = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
const updaterSource = await readFile(resolve(root, 'apps/desktop/updater.cjs'), 'utf8');
const windowModule = await import(resolve(root, 'packages/theia-nextmux-extension/lib/common/nextmux-conversation-window.js'));
const { desktopEditorShortcutPlan } = await import(resolve(root, 'scripts/desktop-editor-shortcuts.mjs'));

const hostPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
const hostArch = process.arch;

function runWindowGeometryChecks() {
  const areas = [
    { name: 'small', x: 0, y: 0, width: 980, height: 680 },
    { name: 'wide', x: 0, y: 24, width: 2560, height: 1400 },
    { name: 'negative-origin', x: -1920, y: 0, width: 1920, height: 1080 },
  ];
  const counts = [1, 2, 4, 8, 16, 32];
  const cases = [];
  for (const area of areas) for (const count of counts) for (let index = 0; index < count; index += 1) {
    const bounds = windowModule.conversationTileBounds(area, index, count);
    const inside = bounds.x >= area.x && bounds.y >= area.y
      && bounds.x + bounds.width <= area.x + area.width
      && bounds.y + bounds.height <= area.y + area.height;
    if (!inside) throw new Error(`window tile escaped work area: ${area.name}/${count}/${index}`);
    cases.push({ area: area.name, count, index, bounds });
  }
  return { status: 'passed', cases: cases.length, areas: areas.map(({ name, width, height }) => ({ name, width, height })), counts };
}

function runStorageContractChecks() {
  // nextmuxDataRoot is intentionally private; validate its source contract
  // without pretending to execute a Windows filesystem on macOS.
  const source = requireText('packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts');
  const checks = {
    windowsLocalAppData: /process\.platform === 'win32'[\s\S]*?process\.env\.LOCALAPPDATA/.test(source),
    macApplicationSupport: /process\.platform === 'darwin'[\s\S]*?Library', 'Application Support/.test(source),
    linuxXdg: /process\.env\.XDG_DATA_HOME \|\| join\(homedir\(\), '\.local', 'share'\)/.test(source),
    stableProductDirectory: /join\(base, 'NextMux'\)/.test(source),
    isolatedConversationStore: /conversation-history-v1/.test(source),
  };
  const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  return { status: failed.length ? 'failed' : 'passed', checks, failed };
}

/**
 * Verify the parts of upgrade/uninstall persistence that are deterministic in
 * source.  An installer run is intentionally not inferred from these checks;
 * the native release job must attach that evidence for a target to qualify.
 */
function runPersistenceContractChecks() {
  const build = desktopPackage?.build || {};
  const checks = {
    stableAppId: build.appId === 'io.nextmux.desktop',
    appDataRetainedOnUninstall: build.nsis?.deleteAppDataOnUninstall === false,
    architectureScopedUpdates: /updates\/\$\{updatePlatform\}\/\$\{process\.arch\}/.test(updaterSource),
    noInstallDirectoryState: !/nextmuxDataRoot\(\)[\s\S]{0,1200}(?:app\.getAppPath|process\.cwd)/.test(requireText('packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts')),
    nativeWorkflowPersistsEvidence: /write-desktop-release-evidence\.mjs/.test(workflow)
      && /portable-e2e\.stdout\.log/.test(workflow)
      && /installed-e2e\.stdout\.log/.test(workflow),
  };
  const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  return {
    status: failed.length ? 'failed' : 'passed',
    checks,
    failed,
    scope: 'offline_contract_only',
    nativeEvidenceRequired: true,
  };
}

function runShortcutContractChecks() {
  const checks = {};
  for (const [platform, modifierBit] of [['darwin', 4], ['win32', 2]]) {
    const plan = desktopEditorShortcutPlan('save', platform);
    const downs = plan.filter(event => event.type === 'rawKeyDown');
    const ups = plan.filter(event => event.type === 'keyUp');
    checks[`${platform}Modifier`] = downs.some(event => event.key === (platform === 'darwin' ? 'Meta' : 'Control'))
      && downs.every(event => (event.modifiers & modifierBit) !== 0 || event.key === 'Control' || event.key === 'Meta');
    checks[`${platform}Balanced`] = downs.length === ups.length
      && plan.at(-1)?.key === (platform === 'darwin' ? 'Meta' : 'Control')
      && plan.at(-1)?.type === 'keyUp';
  }
  const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  return { status: failed.length ? 'failed' : 'passed', checks, failed };
}

// Synchronous source reads are only used for a tiny static contract check.
function requireText(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

export function buildCrossPlatformReport() {
  const targets = targetManifest.targets.map(target => {
    const hostMatch = target.platform === hostPlatform && target.arch === hostArch;
    // The workflow consumes the validated manifest as a JSON matrix, so the
    // runner name is intentionally not duplicated in YAML.
    const runnerConfigured = workflow.includes('runs-on: ${{ matrix.runner }}')
      && typeof target.runner === 'string' && target.runner.length > 0;
    return {
      id: target.id,
      platform: target.platform,
      architecture: target.arch,
      runner: target.runner,
      runnerConfigured,
      status: hostMatch ? 'host_verified_for_offline_contracts' : 'not_run',
      hardwareQualification: 'pending',
      signedArtifact: 'not_verified',
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    host: { platform: hostPlatform, architecture: hostArch, node: process.version, cpus: os.cpus().length },
    scope: 'offline_contract_and_geometry_only',
    targets,
    storage: runStorageContractChecks(),
    persistence: runPersistenceContractChecks(),
    shortcuts: runShortcutContractChecks(),
    windowGeometry: runWindowGeometryChecks(),
    boundaries: [
      'This report does not prove a Windows or Intel Mac run when no native runner executed it.',
      'Signed, notarized, installed, and consumer-hardware checks remain pending until evidence is uploaded by the target runner.',
      'The geometry check is pure code and does not replace Electron multi-monitor UI testing.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = buildCrossPlatformReport();
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : undefined;
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
