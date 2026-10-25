import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDesktopFullAccess } from './desktop-e2e-permission.mjs';
import { connectToNextMuxWorkbench, desktopLaunchCommand, launchOwnedE2eProcess, terminateTree, waitForPort } from './desktop-attachment-file-e2e-harness.mjs';
import { finishE2eRun, installE2eSignalCleanup } from './desktop-terminal-ci-e2e.mjs';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  verifyExactQaComposerRoute,
} from './desktop-official-qa-route.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const pause = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

async function availablePort(label) {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.once('error', error => rejectPort(new Error(`${label} port allocation failed: ${error.message}`)));
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

async function tail(path, maximumCharacters = 6_000) {
  try {
    const content = await readFile(path, 'utf8');
    return content.slice(-maximumCharacters);
  } catch {
    return '';
  }
}

export async function runIsolatedAgentQueueE2E({ name, qaDelayMs = 40, isolatedWorkspace = false }, run) {
  const cdpPort = await availablePort(`${name} CDP`);
  let qaPort = await availablePort(`${name} QA`);
  while (qaPort === cdpPort) qaPort = await availablePort(`${name} QA`);
  const profile = await mkdtemp(join(tmpdir(), `nextmux-${name}-`));
  const electronUserDataDirectory = join(profile, 'electron-user-data');
  const stateDirectory = join(profile, 'nextmux-state');
  const configDirectory = join(profile, 'theia-config');
  const localAppData = join(profile, 'local-app-data');
  const logs = join(profile, 'logs');
  const workspaceRoot = isolatedWorkspace ? join(profile, 'workspace') : root;
  await Promise.all([
    mkdir(electronUserDataDirectory, { recursive: true }),
    mkdir(stateDirectory, { recursive: true }),
    mkdir(configDirectory, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(logs, { recursive: true }),
    ...(isolatedWorkspace ? [mkdir(workspaceRoot, { recursive: true })] : []),
  ]);

  const environment = {
    ...process.env,
    NEXTMUX_ALLOW_INSECURE_OFFICIAL: '1',
    NEXTMUX_DESKTOP_STATE_DIR: stateDirectory,
    NEXTMUX_AGENT_STATE_DIR: stateDirectory,
    NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
    NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile,
    NEXTMUX_E2E_WORKSPACE: workspaceRoot,
    NEXTMUX_OFFICIAL_QA_PORT: String(qaPort),
    NEXTMUX_OFFICIAL_QA_KEY: 'nextmux-qa-secret',
    NEXTMUX_QA_ALLOW_LOCAL_NO_AUTH: '1',
    NEXTMUX_OFFICIAL_QA_DELAY_MS: String(qaDelayMs),
    NEXTMUX_E2E_MODEL_ID: 'custom_openai/nextmux-queue-qa-model',
    NEXTMUX_E2E_SECONDARY_MODEL_ID: 'custom_openai/gpt-nextmux-qa-secondary',
    NEXTMUX_E2E_CONNECTION_LABEL: `NextMux ${name} QA`,
    NEXTMUX_QA_MODEL: 'nextmux-queue-qa-model',
    NEXTMUX_QA_SECONDARY_MODEL: 'gpt-nextmux-qa-secondary',
    THEIA_CONFIG_DIR: configDirectory,
    ...(isWindows ? {
      LOCALAPPDATA: localAppData,
      APPDATA: join(profile, 'roaming-app-data'),
    } : {
      XDG_DATA_HOME: join(profile, 'xdg-data'),
      XDG_CONFIG_HOME: join(profile, 'xdg-config'),
    }),
  };
  const children = [];
  let stopping = false, interrupted = false, cleanupPromise;
  const launch = (command, args, processName, childEnvironment) => {
    if (stopping) throw new Error('E2E_STOPPING');
    const stdoutPath = join(logs, `${processName}.stdout.log`);
    const stderrPath = join(logs, `${processName}.stderr.log`);
    const child = launchOwnedE2eProcess(command, args, { env: childEnvironment, stdout: stdoutPath, stderr: stderrPath });
    children.push({ child, processName, stdoutPath, stderrPath });
    return child;
  };

  let cdp;
  let primaryError;
  const cleanup = () => {
    stopping = true;
    return cleanupPromise ||= (async () => {
      try { cdp?.socket.close(); } catch { /* CDP already closed. */ }
      const results = await Promise.allSettled(children.map(({ child }) => terminateTree(child)));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) {
        console.error(`E2E cleanup failed; preserved isolated profile: ${profile}`);
        throw new AggregateError(failures, 'Isolated queue cleanup failed');
      }
      if (primaryError) {
        const evidence = [];
        for (const entry of children) {
          const [stdout, stderr] = await Promise.all([tail(entry.stdoutPath), tail(entry.stderrPath)]);
          if (stdout || stderr) evidence.push(`\n--- ${entry.processName} stdout ---\n${stdout}\n--- ${entry.processName} stderr ---\n${stderr}`);
        }
        if (evidence.length) process.stderr.write(evidence.join(''));
      }
      if (primaryError || interrupted || process.env.NEXTMUX_E2E_KEEP_PROFILE === '1') process.stdout.write(`Preserved isolated NextMux profile: ${profile}\n`);
      else await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    })();
  };
  const disposeSignals = installE2eSignalCleanup(() => { interrupted = true; return cleanup(); });
  try {
    const qa = launch(process.execPath, [join(root, 'scripts', 'official-model-qa-server.mjs')], `${name}-qa`, environment);
    await waitForPort(qaPort, 15_000, qa);
    const desktop = desktopLaunchCommand({ cdpPort, electronProfile: electronUserDataDirectory, environment });
    process.stdout.write(`${JSON.stringify({ event: 'qa_desktop_launch', kind: desktop.kind, executable: desktop.command })}\n`);
    const app = launch(desktop.command, desktop.args, `${name}-desktop`, environment);
    await waitForPort(cdpPort, 90_000, app);
    const profileDeadline = Date.now() + 20_000;
    while (Date.now() < profileDeadline
      && !existsSync(join(electronUserDataDirectory, 'Local State'))
      && !existsSync(join(electronUserDataDirectory, 'Default'))) await pause(150);
    if (!existsSync(join(electronUserDataDirectory, 'Local State'))
      && !existsSync(join(electronUserDataDirectory, 'Default'))) {
      throw new Error(`Electron did not create Chromium markers in disposable profile ${profile}.`);
    }

    cdp = await connectToNextMuxWorkbench(cdpPort);
    await Promise.all([cdp.call('Runtime.enable'), cdp.call('Page.enable')]);
    await cdp.call('Page.bringToFront');
    const waitFor = async (read, predicate, timeoutMs, label) => {
      const startedAt = Date.now();
      let value;
      let lastError;
      while (Date.now() - startedAt < timeoutMs) {
        try {
          value = await read();
          if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
          lastError = undefined;
        } catch (error) {
          lastError = error;
        }
        await pause(120);
      }
      throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}${lastError ? `; ${lastError.message}` : ''}`);
    };
    await waitFor(
      () => cdp.evaluate(`Boolean(document.querySelector('.nmx-desktop-widget'))`),
      Boolean,
      45_000,
      'NextMux desktop widget in the disposable profile'
    );
    const routeConfig = officialQaRouteConfig(environment);
    let route;
    try {
      route = await ensureExactOfficialQaRoute({ evaluate: cdp.evaluate, environment, config: routeConfig });
    } catch (error) {
      const diagnostics = await cdp.evaluate(`(() => {
        const relay = document.querySelector('[data-relay-trigger="composer"]');
        const relayRect = relay?.getBoundingClientRect();
        const relayStyle = relay ? getComputedStyle(relay) : undefined;
        return {
        section: document.querySelector('.nmx-titlebar-primary-nav [data-desktop-section][aria-current="page"]')?.getAttribute('data-desktop-section') || '',
        relay: {
          exists: relay instanceof HTMLElement,
          disabled: relay instanceof HTMLButtonElement ? relay.disabled : null,
          rect: relayRect ? { x: relayRect.x, y: relayRect.y, width: relayRect.width, height: relayRect.height } : null,
          display: relayStyle?.display || '',
          visibility: relayStyle?.visibility || '',
        },
        modelOptions: [...document.querySelectorAll('.nmx-model-option')].map(node => ({
          id: node.getAttribute('data-model-id') || '',
          text: (node.innerText || '').trim().replace(/\\s+/g, ' '),
          unsupported: node.classList.contains('is-unsupported')
        })),
        error: document.querySelector('.nmx-purchase-error')?.textContent?.trim() || ''
      }})()`);
      throw new Error(`Unable to establish exact local QA route ${routeConfig.modelId}: ${error instanceof Error ? error.message : error}. UI diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
    await ensureDesktopFullAccess(cdp.evaluate, 12_000);
    const send = async text => {
      const ready = await cdp.evaluate(`(() => {
        const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        textarea.focus();
        textarea.select();
        return true;
      })()`);
      if (!ready) throw new Error('The isolated NextMux composer is not editable.');
      await cdp.call('Input.insertText', { text });
      const sent = await cdp.evaluate(`(() => {
        const button = document.querySelector('.nmx-send-button:not(:disabled)');
        button?.click();
        return Boolean(button);
      })()`);
      if (!sent) throw new Error('The isolated NextMux send action is unavailable.');
    };
    await run({
      ...cdp,
      environment,
      profile,
      qaPort,
      route,
      routeConfig,
      root: workspaceRoot,
      send,
      verifyExactRoute: () => verifyExactQaComposerRoute(cdp.evaluate, route),
      wait: pause,
      waitFor,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    try { await finishE2eRun(cleanup, primaryError); }
    finally { disposeSignals(); }
  }
}
