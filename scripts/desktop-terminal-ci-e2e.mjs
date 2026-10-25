#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentDesktopLaunch } from './desktop-development-launch.mjs';

/** No environment inspection or application-name matching: record descendants of our launches. */
export function readE2eProcessSnapshot() {
  if (process.platform === 'win32') {
    const powershell = join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -gt 1 -and $_.CreationDate -and $_.ExecutablePath } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;ppid=$_.ParentProcessId;started=$_.CreationDate.ToUniversalTime().Ticks.ToString();executable=$_.ExecutablePath} } | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || result.error) throw new Error('E2E_PROCESS_SNAPSHOT_FAILED');
    const parsed = JSON.parse(result.stdout || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(row => row.pid > 1 && row.started && row.executable)
      .map(row => ({ pid: row.pid, ppid: row.ppid, identity: `${row.started}\0${row.executable}`, zombie: false }));
  }
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error('E2E_PROCESS_SNAPSHOT_FAILED');
  const rows = result.stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]),
      identity: `${match[4]}\0${match[5]}\0${match[7]}`, zombie: match[6].includes('Z') }] : [];
  });
  if (!rows.length) throw new Error('E2E_PROCESS_SNAPSHOT_FAILED');
  return rows;
}

export function createE2eProcessCleanup({ snapshot = readE2eProcessSnapshot, kill = (pid, signal) => process.kill(pid, signal),
  pause = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const launches = new Map(), owned = new Map(), unobservedLaunches = new Set();
  function refresh() {
    const rows = snapshot(), current = new Map(rows.map(row => [row.pid, row]));
    for (const [pid, child] of launches) {
      // A ChildProcess which has exited is never authority for a reused PID.
      if (!owned.has(pid) && child.exitCode === null && child.signalCode === null && current.has(pid)) owned.set(pid, current.get(pid));
      if (owned.get(pid)?.identity === current.get(pid)?.identity && owned.has(pid)) unobservedLaunches.delete(child);
    }
    const live = new Set([...owned.values()].filter(row => current.get(row.pid)?.identity === row.identity).map(row => row.pid));
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (row.pid > 1 && !owned.has(row.pid) && live.has(row.ppid)) {
        owned.set(row.pid, row); live.add(row.pid); changed = true;
      }
    }
    return [...live].map(pid => current.get(pid)).filter(row => !row.zombie);
  }
  return {
    register(child) {
      if (!Number.isSafeInteger(child?.pid) || child.pid <= 1 || child.pid === process.pid) return;
      launches.set(child.pid, child); unobservedLaunches.add(child); refresh();
    },
    refresh,
    async terminate() {
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        for (const candidate of refresh()) {
          // Revalidate immediately before each individual signal; never kill a PGID or name match.
          const current = snapshot().find(row => row.pid === candidate.pid);
          if (!current || current.zombie || current.identity !== candidate.identity) continue;
          try { kill(candidate.pid, signal); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
        }
        await pause(signal === 'SIGTERM' ? 750 : 100);
      }
      const remaining = refresh();
      if (remaining.length) throw new Error(`E2E_OWNED_PROCESSES_REMAIN: ${remaining.map(row => row.pid).join(',')}`);
      // An exited launcher which was never observed is not proof that it left no detached backend.
      if (unobservedLaunches.size) throw new Error('E2E_LAUNCH_OWNERSHIP_UNOBSERVED');
    },
  };
}

export async function createE2eArtifactsDirectory(root, requested) {
  if (requested) {
    if (!isAbsolute(requested)) throw new Error('NEXTMUX_DESKTOP_E2E_ARTIFACTS must be a new absolute directory.');
    const directory = resolve(requested);
    await mkdir(directory); // Existing output is never truncated, including an older live process's logs.
    return directory;
  }
  const parent = join(root, 'artifacts');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'desktop-e2e-'));
}

export async function finishE2eRun(cleanup, primaryError) {
  try { await cleanup(); }
  catch (cleanupError) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Desktop E2E failed and cleanup also failed.', { cause: primaryError });
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}

/** Only an observed application exit can witness restart; cleanup is not a natural close. */
export function observeE2eAppExit(child, marker, isCleaningUp, onError) {
  child.once('exit', (code, signal) => {
    if (isCleaningUp()) return;
    try {
      writeFileSync(marker, JSON.stringify({ code, signal, exitedAt: Date.now() }), { flag: 'wx' });
    } catch (error) { onError(error); }
  });
}

/** Installed only by an active run. Repeated signals share its existing cleanup, never a second kill path. */
export function installE2eSignalCleanup(cleanup, { target = process, exit = code => process.exit(code) } = {}) {
  let handling = false;
  const request = code => {
    if (handling) return;
    handling = true;
    let result;
    try { result = cleanup(); } catch (error) { result = Promise.reject(error); }
    void Promise.resolve(result).then(() => exit(code), () => exit(1));
  };
  const interrupt = () => request(130), terminate = () => request(143);
  target.on('SIGINT', interrupt); target.on('SIGTERM', terminate);
  return () => { target.off('SIGINT', interrupt); target.off('SIGTERM', terminate); };
}

async function main() {
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
// Preserve the package-manager launch context when this E2E is invoked from
// an npm/pnpm lifecycle. Development launches still use Electron directly,
// but child flows receive the same npm_execpath so package-manager resolution
// remains deterministic on CI and on Windows.
const packageManagerCli = process.env.npm_execpath;
const packageManagerEnvironment = packageManagerCli && existsSync(packageManagerCli)
  ? { npm_execpath: packageManagerCli }
  : {};
const packagedExecutable = process.env.NEXTMUX_PACKAGED_EXECUTABLE
  ? resolve(process.env.NEXTMUX_PACKAGED_EXECUTABLE)
  : '';
const probesPackagedWindowsArm64Ffmpeg = Boolean(packagedExecutable)
  && isWindows && process.arch === 'arm64';
const requestedSuite = process.env.NEXTMUX_DESKTOP_E2E_SUITE
  || (process.env.npm_lifecycle_event === 'test:e2e:desktop' ? 'desktop' : 'terminal');
if (requestedSuite !== 'terminal' && requestedSuite !== 'desktop') {
  throw new Error(`Unknown NextMux desktop E2E suite: ${requestedSuite}`);
}
const processCleanup = createE2eProcessCleanup();
let stopping = false;
let launchFailure;
const tracking = setInterval(() => { try { processCleanup.refresh(); } catch { /* Cleanup retries; failure there preserves the profile. */ } }, 500);
tracking.unref();

async function availablePort(explicitValue, label) {
  const explicit = explicitValue ? Number(explicitValue) : 0;
  if (explicitValue && (!Number.isSafeInteger(explicit) || explicit < 1024 || explicit > 65535)) {
    throw new Error(`${label} port is invalid: ${explicitValue}`);
  }
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.once('error', error => rejectPort(new Error(`${label} port ${explicit || 'auto'} is unavailable: ${error.message}`)));
    server.listen({ host: '127.0.0.1', port: explicit }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

const cdpPort = await availablePort(process.env.NEXTMUX_CDP_PORT, 'CDP');
let qaPort = await availablePort(process.env.NEXTMUX_OFFICIAL_QA_PORT, 'QA');
while (qaPort === cdpPort) qaPort = await availablePort(undefined, 'QA');

const artifacts = await createE2eArtifactsDirectory(root, process.env.NEXTMUX_DESKTOP_E2E_ARTIFACTS);
const appExitMarker = join(artifacts, 'desktop-app-exited.json');
const userDataDirectory = await mkdtemp(join(tmpdir(), 'nextmux-desktop-e2e-'));
const marketingScreenshot = Boolean(process.env.NEXTMUX_HOMEPAGE_SCREENSHOT);
// Marketing captures use the production renderer and agent runtime, but never
// mount the repository (whose basename and history are private source data).
const workspaceRoot = marketingScreenshot
  ? join(userDataDirectory, 'NextMux Demo')
  : resolve(process.env.NEXTMUX_E2E_WORKSPACE || root);
const electronUserDataDirectory = join(userDataDirectory, 'electron-user-data');
const isolatedStateDirectory = join(userDataDirectory, 'nextmux-state');
const isolatedConfigDirectory = join(userDataDirectory, 'theia-config');
const isolatedLocalAppData = join(userDataDirectory, 'local-app-data');
await Promise.all([
  mkdir(workspaceRoot, { recursive: true }),
  mkdir(isolatedStateDirectory, { recursive: true }),
  mkdir(isolatedConfigDirectory, { recursive: true }),
  mkdir(isolatedLocalAppData, { recursive: true }),
]);
console.log(`NextMux desktop E2E profile: ${userDataDirectory}; CDP: ${cdpPort}; QA: ${qaPort}`);
console.log(`NextMux desktop E2E logs: ${artifacts}`);

function launch(command, args, name, env = process.env) {
  if (stopping) throw new Error('E2E_STOPPING');
  const stdout = openSync(join(artifacts, `${name}.stdout.log`), 'wx');
  let stderr, child;
  try {
    stderr = openSync(join(artifacts, `${name}.stderr.log`), 'wx');
    child = spawn(command, args, {
      cwd: root,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdout, stderr],
    });
  } catch (error) {
    closeSync(stdout);
    if (stderr !== undefined) closeSync(stderr);
    throw error;
  }
  child.once('close', () => {
    try { closeSync(stdout); } catch { /* Already closed during startup failure. */ }
    try { closeSync(stderr); } catch { /* Already closed during startup failure. */ }
  });
  child.once('error', error => { launchFailure = error; });
  processCleanup.register(child);
  child.once('exit', () => { try { processCleanup.refresh(); } catch { /* Final cleanup retries. */ } });
  return child;
}

function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolvePort, rejectPort) => {
    const probe = () => {
      if (launchFailure) return rejectPort(launchFailure);
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolvePort();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) rejectPort(new Error(`Port ${port} did not become ready.`));
        else setTimeout(probe, 250);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    probe();
  });
}

async function waitForDisposableElectronProfile(timeoutMs) {
  const startedAt = Date.now();
  const chromiumProfileMarkers = [
    join(electronUserDataDirectory, 'Local State'),
    join(electronUserDataDirectory, 'Default'),
  ];
  while (Date.now() - startedAt < timeoutMs) {
    // State/config directories are created by this runner before Electron and
    // therefore prove nothing. Require Chromium's own profile artifacts so a
    // test can never migrate the developer's real localStorage into QA state.
    if (chromiumProfileMarkers.some(markerPath => existsSync(markerPath))) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Electron did not use the disposable profile: ${userDataDirectory}`);
}

function runNodeScript(script) {
  return new Promise((resolveRun, rejectRun) => {
    if (stopping) return rejectRun(new Error('E2E_STOPPING'));
    const child = spawn(process.execPath, [join(root, 'scripts', script)], {
      cwd: root,
      env: {
        ...process.env,
        ...packageManagerEnvironment,
        NEXTMUX_CDP_PORT: String(cdpPort),
        NEXTMUX_OFFICIAL_QA_PORT: String(qaPort),
        NEXTMUX_E2E_MODEL_ID: 'custom_openai/gpt-5.6-sol',
        NEXTMUX_E2E_SECONDARY_MODEL_ID: 'custom_openai/gpt-nextmux-qa-secondary',
        NEXTMUX_QA_MODEL: 'gpt-5.6-sol',
        NEXTMUX_QA_SECONDARY_MODEL: 'gpt-nextmux-qa-secondary',
        NEXTMUX_QUEUE_MODEL: 'gpt-nextmux-qa-secondary',
        NEXTMUX_DESKTOP_STATE_DIR: isolatedStateDirectory,
        NEXTMUX_AGENT_STATE_DIR: isolatedStateDirectory,
        NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
        NEXTMUX_DESKTOP_E2E_PROFILE_DIR: userDataDirectory,
        NEXTMUX_DESKTOP_E2E_ARTIFACTS: artifacts,
        NEXTMUX_DESKTOP_E2E_APP_EXIT_MARKER: appExitMarker,
        NEXTMUX_E2E_WORKSPACE: workspaceRoot,
        ...(marketingScreenshot ? { NEXTMUX_E2E_CONNECTION_LABEL: 'OpenAI Direct' } : {}),
      },
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('close', code => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${script} exited with code ${code ?? 'unknown'}.`)));
    processCleanup.register(child);
  });
}

const qaEnvironment = {
  ...process.env,
  ...packageManagerEnvironment,
  NEXTMUX_OFFICIAL_QA_PORT: String(qaPort),
  NEXTMUX_OFFICIAL_QA_DELAY_MS: process.env.NEXTMUX_OFFICIAL_QA_DELAY_MS || (marketingScreenshot ? '500' : '120'),
};
const appEnvironment = {
  ...process.env,
  ...packageManagerEnvironment,
  NEXTMUX_ALLOW_INSECURE_OFFICIAL: '1',
  // Electron user data alone does not isolate the backend conversation store.
  // Keep deterministic QA turns/checkpoints out of the developer's real NM history.
  NEXTMUX_DESKTOP_STATE_DIR: isolatedStateDirectory,
  NEXTMUX_AGENT_STATE_DIR: isolatedStateDirectory,
  NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
  NEXTMUX_DESKTOP_E2E_PROFILE_DIR: userDataDirectory,
  THEIA_CONFIG_DIR: isolatedConfigDirectory,
  // Keep a second isolation boundary for older/stale desktop bundles that do
  // not yet understand NEXTMUX_DESKTOP_STATE_DIR. This also prevents an E2E
  // process from reading or overwriting a developer's real NextMux index.
  ...(isWindows ? {
    LOCALAPPDATA: isolatedLocalAppData,
    APPDATA: join(userDataDirectory, 'roaming-app-data'),
  } : {
    XDG_DATA_HOME: join(userDataDirectory, 'xdg-data'),
    XDG_CONFIG_HOME: join(userDataDirectory, 'xdg-config'),
  }),
};
let cleanupPromise, primaryError;
function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  stopping = true;
  clearInterval(tracking);
  cleanupPromise = (async () => {
    try { await processCleanup.terminate(); }
    catch (error) {
      console.error(`Desktop E2E cleanup failed; preserved profile: ${userDataDirectory}`);
      throw error;
    }
    if (primaryError || process.env.NEXTMUX_E2E_KEEP_PROFILE === '1') console.log(`Preserved NextMux desktop E2E profile: ${userDataDirectory}`);
    else await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  })();
  return cleanupPromise;
}
const disposeSignals = installE2eSignalCleanup(() => {
  primaryError ||= new Error('E2E_INTERRUPTED');
  return cleanup();
});
try {
  launch(process.execPath, [join(root, 'scripts', 'official-model-qa-server.mjs')], 'terminal-ci-qa', qaEnvironment);
  await waitForPort(qaPort, 15_000);
  let application;
  if (packagedExecutable) {
    if (!existsSync(packagedExecutable)) throw new Error(`Packaged NextMux executable not found: ${packagedExecutable}`);
    application = launch(packagedExecutable, [
      workspaceRoot,
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${electronUserDataDirectory}`,
      `--electronUserData=${electronUserDataDirectory}`,
    ], 'terminal-ci-packaged-app', appEnvironment);
  } else {
    const plan = developmentDesktopLaunch({ workspaceRoot, cdpPort, electronProfile: electronUserDataDirectory });
    application = launch(plan.command, plan.args, 'terminal-ci-app', appEnvironment);
  }
  observeE2eAppExit(application, appExitMarker, () => stopping, error => { launchFailure = error; });
  await waitForPort(cdpPort, 90_000);
  await waitForDisposableElectronProfile(20_000);
  // CDP starts before Theia has restored the workbench and mounted NextMux.
  // Wait for the normal frontend contribution startup window before driving
  // product controls; slower native CI hosts still remain bounded by each E2E.
  await new Promise(resolveWait => setTimeout(resolveWait, 10_000));

  // The first flow installs/selects the deterministic local QA route. The
  // remaining flows then prove target-host discovery, shared PTY output,
  // cursor reads, input semantics, terminal reuse and process-tree cleanup.
  const terminalFlows = [
    'desktop-agent-tools-e2e.mjs',
    'desktop-long-paste-e2e.mjs',
    'desktop-attachment-e2e.mjs',
    'desktop-terminal-profile-e2e.mjs',
    'desktop-terminal-profile-launch-e2e.mjs',
    'desktop-managed-terminal-e2e.mjs',
    'desktop-terminal-lifecycle-e2e.mjs',
  ];
  const desktopFlows = [
    'desktop-locale-e2e.mjs',
    'desktop-navigation-qa.mjs',
    'desktop-light-theme-visual-e2e.mjs',
    'desktop-model-picker-e2e.mjs',
    'desktop-model-discovery-e2e.mjs',
    'desktop-drawer-stability-e2e.mjs',
    'desktop-pane-resize-qa.mjs',
    'desktop-file-editor-e2e.mjs',
    'desktop-permission-persistence-e2e.mjs',
    ...(probesPackagedWindowsArm64Ffmpeg ? ['desktop-media-runtime-e2e.mjs'] : []),
    'desktop-conversation-scroll-e2e.mjs',
    'desktop-conversation-branch-e2e.mjs',
    'desktop-agent-delegation-e2e.mjs',
    'desktop-agent-lifecycle-e2e.mjs',
    'desktop-agent-cancel-e2e.mjs',
    'desktop-agent-recovery-e2e.mjs',
    // This closes and relaunches the shared application to prove persistence,
    // so it is the final flow that relies on the original main window.
    'desktop-restart-persistence-e2e.mjs',
    // These three flows deliberately start a second, fully isolated Electron
    // application. NextMux has a production single-instance boundary, so run
    // every shared-main-window regression first; the isolated flows remain
    // self-contained even after the original disposable instance exits.
    'desktop-agent-queue-e2e.mjs',
    'desktop-agent-steering-e2e.mjs',
    'desktop-follow-up-queue-isolation-e2e.mjs',
  ];
  const allFlows = [...terminalFlows, ...(requestedSuite === 'desktop' ? desktopFlows : [])];
  const selectedFlows = (process.env.NEXTMUX_DESKTOP_E2E_ONLY || '').split(',').map(value => value.trim()).filter(Boolean);
  const unknownFlows = selectedFlows.filter(flow => !allFlows.includes(flow));
  if (unknownFlows.length) {
    throw new Error(`Unknown NextMux desktop E2E flow: ${unknownFlows.join(', ')}`);
  }
  for (const script of selectedFlows.length ? selectedFlows : allFlows) {
    await runNodeScript(script);
    if (script === 'desktop-agent-tools-e2e.mjs'
      && !existsSync(join(isolatedStateDirectory, 'official-connections-v1.json'))) {
      throw new Error(`The desktop ignored its isolated NextMux state directory: ${isolatedStateDirectory}`);
    }
  }
} catch (error) {
  primaryError = error;
} finally {
  try { await finishE2eRun(cleanup, primaryError); }
  finally { disposeSignals(); }
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
