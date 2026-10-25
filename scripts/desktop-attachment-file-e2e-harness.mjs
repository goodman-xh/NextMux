import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createE2eProcessCleanup, finishE2eRun, installE2eSignalCleanup } from './desktop-terminal-ci-e2e.mjs';
import { developmentDesktopLaunch } from './desktop-development-launch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childMarker = 'NEXTMUX_ATTACHMENT_FILE_E2E_CHILD';
const isWindows = process.platform === 'win32';
const processOwners = new WeakMap();

export function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.once('error', rejectPort);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

export function waitForPort(port, timeoutMs, child) {
  const startedAt = Date.now();
  return new Promise((resolvePort, rejectPort) => {
    let settled = false;
    const cleanup = () => {
      child?.removeListener('error', fail);
      child?.removeListener('close', closed);
    };
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const resolveOnce = finish(resolvePort);
    const rejectOnce = finish(rejectPort);
    const fail = error => rejectOnce(error);
    const closed = code => rejectOnce(new Error(`Desktop process exited before port ${port} was ready (code ${code ?? 'unknown'}).`));
    const launchError = child && processOwners.get(child)?.launchError;
    if (launchError) { fail(launchError); return; }
    if (child && (child.exitCode !== null || child.signalCode !== null)) { closed(child.exitCode); return; }
    child?.once('error', fail);
    child?.once('close', closed);
    const probe = () => {
      if (settled) return;
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolveOnce();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          rejectOnce(new Error(`Port ${port} did not become ready within ${timeoutMs} ms.`));
        } else setTimeout(probe, 200);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    probe();
  });
}

async function waitForDisposableChromiumProfile(electronProfile, timeoutMs) {
  const markers = [join(electronProfile, 'Local State'), join(electronProfile, 'Default')];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (markers.some(existsSync)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error(`Electron did not create its disposable Chromium profile under ${electronProfile}.`);
}

export function launchOwnedE2eProcess(command, args, options) {
  const stdout = openSync(options.stdout, 'wx');
  let stderr;
  let child;
  try {
    stderr = openSync(options.stderr, 'wx');
    child = spawn(command, args, {
      cwd: root,
      env: options.env,
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
    try { closeSync(stdout); } catch { /* descriptor already closed */ }
    try { closeSync(stderr); } catch { /* descriptor already closed */ }
  });
  return trackOwnedE2eProcess(child);
}

function trackOwnedE2eProcess(child) {
  // Detached Theia backends outlive the launcher; retain only observed identities.
  const owner = createE2eProcessCleanup();
  const state = { owner, tracking: undefined, launchError: undefined };
  // Queue callers may start waiting after this event. Retain the original error, without a global handler.
  child.on('error', error => { state.launchError ||= error; });
  try { owner.register(child); } catch { /* cleanup retries; failure keeps the profile */ }
  const tracking = setInterval(() => { try { owner.refresh(); } catch { /* retry during cleanup */ } }, 500);
  tracking.unref();
  state.tracking = tracking;
  processOwners.set(child, state);
  return child;
}

export function runForeground(command, args, env, onChild) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('close', code => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${basename(args.at(-1) || command)} exited with code ${code ?? 'unknown'}.`)));
    onChild(trackOwnedE2eProcess(child));
  });
}

export async function terminateTree(child) {
  if (!child) return;
  const tracked = processOwners.get(child);
  if (!tracked) throw new Error('E2E_PROCESS_NOT_OWNED');
  clearInterval(tracked.tracking);
  await tracked.owner.terminate();
}

export function desktopLaunchCommand({ cdpPort, electronProfile, environment = process.env }) {
  const workspaceRoot = environment.NEXTMUX_E2E_WORKSPACE || root;
  const common = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${electronProfile}`,
    `--electronUserData=${electronProfile}`,
  ];
  if (environment.NEXTMUX_PACKAGED_EXECUTABLE) {
    const command = resolve(environment.NEXTMUX_PACKAGED_EXECUTABLE);
    if (!existsSync(command)) throw new Error('NEXTMUX_PACKAGED_EXECUTABLE does not exist; refusing development fallback.');
    return { command, args: [workspaceRoot, ...common], kind: 'packaged' };
  }
  return developmentDesktopLaunch({ workspaceRoot, cdpPort, electronProfile });
}

export function launchNextMuxDesktop({ cdpPort, electronProfile, environment, stdout, stderr, nativeInspectorPort }) {
  const plan = desktopLaunchCommand({ cdpPort, electronProfile, environment });
  process.stdout.write(`${JSON.stringify({ event: 'qa_desktop_launch', kind: plan.kind, executable: plan.command })}\n`);
  const args = nativeInspectorPort ? [...plan.args, `--inspect=127.0.0.1:${nativeInspectorPort}`] : plan.args;
  return launchOwnedE2eProcess(plan.command, args, { env: environment, stdout, stderr });
}

async function openCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) listeners.forEach(listener => listener(message));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, rejectCall) => pending.set(id, { resolve: resolveCall, reject: rejectCall }));
  };
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  return { socket, call, evaluate, onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

/** Select the real NextMux workbench page instead of trusting /json ordering. */
export async function connectToNextMuxWorkbench(cdpPort, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  while (Date.now() < deadline) {
    lastTargets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
    for (const target of lastTargets.filter(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl)) {
      const client = await openCdpClient(target.webSocketDebuggerUrl);
      try {
        await client.call('Runtime.enable');
        if (await client.evaluate(`Boolean(document.querySelector('.nmx-shell'))`)) return client;
      } catch {
        // The target may be navigating while the workbench mounts; retry it.
      }
      client.socket.close();
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error(`No CDP page mounted the NextMux workbench within ${timeoutMs} ms. Targets: ${JSON.stringify(lastTargets.map(target => ({ type: target.type, title: target.title, url: target.url })))}`);
}

/**
 * Relaunch one of the two production regression scripts inside a fresh Electron
 * profile. The child is the only process that drives CDP; no real profile or
 * physical keyboard/mouse input is touched.
 */
export async function runInDisposableAttachmentFileDesktop(scriptUrl, options = {}) {
  if (process.env[childMarker] === '1') return false;

  const profileRoot = await mkdtemp(join(tmpdir(), 'nextmux-attachment-file-e2e-'));
  const electronProfile = join(profileRoot, 'electron-user-data');
  const stateDirectory = join(profileRoot, 'nextmux-state');
  const configDirectory = join(profileRoot, 'theia-config');
  const localAppData = join(profileRoot, 'local-app-data');
  const roamingAppData = join(profileRoot, 'roaming-app-data');
  const logs = join(profileRoot, 'logs');
  const appExitMarker = join(profileRoot, 'desktop-app-exited.json');
  await Promise.all([electronProfile, stateDirectory, configDirectory, localAppData, roamingAppData, logs].map(path => mkdir(path, { recursive: true })));

  const cdpPort = await freePort();
  const nativeInspectorPort = options.nativeInspector ? await freePort() : undefined;
  let qaPort = await freePort();
  while (qaPort === cdpPort) qaPort = await freePort();
  const children = [];
  const commonEnvironment = {
    ...process.env,
    [childMarker]: '1',
    NEXTMUX_CDP_PORT: String(cdpPort),
    ...(nativeInspectorPort ? { NEXTMUX_E2E_NATIVE_INSPECTOR_PORT: String(nativeInspectorPort) } : {}),
    NEXTMUX_OFFICIAL_QA_PORT: String(qaPort),
    NEXTMUX_E2E_MODEL_ID: 'custom_openai/gpt-5.6-sol',
    NEXTMUX_QA_MODEL: 'gpt-5.6-sol',
    NEXTMUX_ALLOW_INSECURE_OFFICIAL: '1',
    NEXTMUX_DESKTOP_STATE_DIR: stateDirectory,
    NEXTMUX_AGENT_STATE_DIR: stateDirectory,
    NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
    NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profileRoot,
    NEXTMUX_DESKTOP_E2E_APP_EXIT_MARKER: appExitMarker,
    NEXTMUX_E2E_WORKSPACE: root,
    THEIA_CONFIG_DIR: configDirectory,
    ...(isWindows ? { LOCALAPPDATA: localAppData, APPDATA: roamingAppData } : {
      XDG_DATA_HOME: join(profileRoot, 'xdg-data'),
      XDG_CONFIG_HOME: join(profileRoot, 'xdg-config'),
    }),
  };

  console.log(`NextMux ${options.label || 'attachment/file'} isolated profile: ${profileRoot}; CDP: ${cdpPort}; QA: ${qaPort}`);
  let primaryError;
  let stopping = false, interrupted = false, cleanupPromise;
  const ensureRunning = () => { if (stopping) throw new Error('E2E_STOPPING'); };
  const cleanup = () => {
    stopping = true;
    return cleanupPromise ||= (async () => {
      const cleanupResults = await Promise.allSettled([...children].reverse().map(terminateTree));
      const failures = cleanupResults.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) {
        console.error(`E2E cleanup failed; preserved isolated profile: ${profileRoot}`);
        throw new AggregateError(failures, 'Isolated desktop cleanup failed');
      }
      if (primaryError || interrupted || process.env.NMX_E2E_KEEP === '1' || process.env.NEXTMUX_E2E_KEEP_PROFILE === '1') console.log(`Preserved isolated E2E profile: ${profileRoot}`);
      else await rm(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    })();
  };
  const disposeSignals = installE2eSignalCleanup(() => { interrupted = true; return cleanup(); });
  try {
    ensureRunning();
    if (options.withQaRoute) {
      const qa = launchOwnedE2eProcess(process.execPath, [join(root, 'scripts', 'official-model-qa-server.mjs')], {
        env: { ...commonEnvironment, NEXTMUX_OFFICIAL_QA_DELAY_MS: String(options.qaDelayMs ?? 80) },
        stdout: join(logs, 'qa.stdout.log'),
        stderr: join(logs, 'qa.stderr.log'),
      });
      children.push(qa);
      await waitForPort(qaPort, 15_000, qa);
    }

    ensureRunning();
    const app = launchNextMuxDesktop({
      cdpPort,
      electronProfile,
      environment: commonEnvironment,
      stdout: join(logs, 'app.stdout.log'),
      stderr: join(logs, 'app.stderr.log'),
      nativeInspectorPort,
    });
    app.once('close', (code, signal) => {
      try {
        writeFileSync(appExitMarker, JSON.stringify({ code, signal, exitedAt: Date.now() }));
      } catch { /* the child regression will report a missing exit marker */ }
    });
    children.push(app);
    await waitForPort(cdpPort, 90_000, app);
    if (nativeInspectorPort) await waitForPort(nativeInspectorPort, 15_000, app);
    await waitForDisposableChromiumProfile(electronProfile, 20_000);
    await new Promise(resolveWait => setTimeout(resolveWait, 8_000));

    ensureRunning();
    await runForeground(process.execPath, [fileURLToPath(scriptUrl)], commonEnvironment, child => children.push(child));
    return true;
  } catch (error) {
    primaryError = error;
    const tails = [];
    for (const name of ['app.stderr.log', 'qa.stderr.log']) {
      const path = join(logs, name);
      if (!existsSync(path)) continue;
      tails.push(`${name}: ${path}`);
    }
    if (tails.length) console.error(`Disposable process logs: ${tails.join('; ')}`);
  } finally {
    try { await finishE2eRun(cleanup, primaryError); }
    finally { disposeSignals(); }
  }
}
