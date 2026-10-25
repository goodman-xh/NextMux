#!/usr/bin/env node

/**
 * Native-runner check for the user-data boundary.
 *
 * This is deliberately run only by the target release runner. It writes one
 * synthetic marker below the platform user-data directory, removes the test
 * application, and proves that the marker is still present. It never touches
 * a developer's real profile when invoked from the release workflow, which
 * supplies a disposable runner profile.
 */
import { createHash, randomUUID } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function value(name, required = true) {
  const index = process.argv.indexOf(name);
  const candidate = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!candidate || candidate.startsWith('--'))) throw new Error(`${name} requires a value`);
  return candidate;
}

const declaredPlatform = value('--platform');
const declaredArchitecture = value('--arch');
const installRoot = resolve(value('--install-root'));
const output = value('--output', false) ? resolve(value('--output')) : undefined;
const uninstaller = value('--uninstaller', false);
const installer = value('--installer', false);
const removeApp = value('--remove-app', false) === 'true';

const expectedRuntimePlatform = declaredPlatform === 'windows' ? 'win32' : 'darwin';
if (platform() !== expectedRuntimePlatform) throw new Error(`P9_NATIVE_PLATFORM_MISMATCH:${platform()}:${expectedRuntimePlatform}`);
if (!['x64', 'arm64'].includes(declaredArchitecture)) throw new Error(`P9_NATIVE_ARCH_INVALID:${declaredArchitecture}`);

const dataBase = declaredPlatform === 'windows'
  ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  : join(homedir(), 'Library', 'Application Support');
const dataRoot = join(dataBase, 'NextMux');
const markerPath = join(dataRoot, `.p9-preservation-${declaredArchitecture}-${randomUUID()}.json`);
const marker = { schemaVersion: 1, purpose: 'native-user-data-preservation', platform: declaredPlatform, architecture: declaredArchitecture, createdAt: new Date().toISOString() };
const markerBytes = Buffer.from(JSON.stringify(marker));
const markerHash = createHash('sha256').update(markerBytes).digest('hex');

async function markerIsIntact() {
  if (!existsSync(markerPath)) return false;
  const bytes = await readFile(markerPath);
  return createHash('sha256').update(bytes).digest('hex') === markerHash;
}

async function waitForMarker(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await markerIsIntact()) return true;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  return false;
}

await mkdir(dataRoot, { recursive: true });
await writeFile(markerPath, markerBytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

const actions = [];
if (declaredPlatform === 'windows') {
  const executable = resolve(uninstaller || join(installRoot, 'Uninstall NextMux.exe'));
  if (!existsSync(executable)) throw new Error(`P9_UNINSTALLER_MISSING:${executable}`);
  const result = spawnSync(executable, ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`P9_UNINSTALL_FAILED:${result.status}`);
  actions.push({ kind: 'nsis-uninstall', executable: executable.replaceAll('\\', '/') });
  if (!await waitForMarker()) throw new Error('P9_USER_DATA_REMOVED_BY_UNINSTALL');

  // Reinstalling the same immutable artifact proves the data boundary remains
  // outside the install directory after an update-like replacement.
  if (installer) {
    const installResult = spawnSync(resolve(installer), ['/S', `/D=${installRoot}`], {
      encoding: 'utf8', windowsHide: true, timeout: 120_000
    });
    if (installResult.error) throw installResult.error;
    if (installResult.status !== 0) throw new Error(`P9_REINSTALL_FAILED:${installResult.status}`);
    actions.push({ kind: 'nsis-reinstall', installer: resolve(installer).replaceAll('\\', '/') });
    if (!await waitForMarker()) throw new Error('P9_USER_DATA_LOST_AFTER_REINSTALL');
  }
} else if (removeApp) {
  await rm(installRoot, { recursive: true, force: true });
  actions.push({ kind: 'macos-app-remove', installRoot: installRoot.replaceAll('\\', '/') });
  if (!await waitForMarker()) throw new Error('P9_USER_DATA_LOST_AFTER_APP_REMOVE');
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  declared: { platform: declaredPlatform, architecture: declaredArchitecture },
  runner: { platform: platform(), architecture: process.arch },
  scope: 'native_runner_user_data_preservation',
  dataRoot: dataRoot.replaceAll('\\', '/'),
  marker: { sha256: markerHash, preserved: true },
  actions,
};
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify(result)}\n`);
