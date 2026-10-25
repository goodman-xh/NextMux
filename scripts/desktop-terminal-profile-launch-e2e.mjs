#!/usr/bin/env node

import { access, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) throw new Error(`No Electron page is available on CDP port ${cdpPort}.`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const promise = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) promise.reject(new Error(message.error.message));
  else promise.resolve(message.result);
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};
const exists = path => access(path, constants.F_OK).then(() => true, () => false);
const fileContainsMarker = async (path, marker) => {
  if (!(await exists(path))) return false;
  const bytes = await readFile(path);
  const hasUtf16LeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  let zeroBytes = 0;
  for (const byte of bytes) if (byte === 0) zeroBytes += 1;
  const content = hasUtf16LeBom || zeroBytes > bytes.length / 4
    ? bytes.toString('utf16le') : bytes.toString('utf8');
  return content.replace(/^\ufeff/, '').includes(marker);
};

function discoverUsableHostProfiles() {
  const discoveryScript = fileURLToPath(new URL('./desktop-terminal-profile-e2e.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [discoveryScript, '--discover-host-profiles'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 512 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Host terminal discovery failed: ${result.error?.message || result.stderr || result.status}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`Host terminal discovery returned invalid JSON: ${error.message}`);
  }
}

const openGeneralSettings = async () => {
  await evaluate(`(() => {
    if (!document.querySelector('[data-settings-panel="general"]')) {
      document.querySelector('.nmx-account-trigger')?.click();
    }
    return true;
  })()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('[data-settings-panel="general"]'))`),
    Boolean,
    5_000,
    'settings navigation'
  );
  await evaluate(`document.querySelector('[data-settings-panel="general"]')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-terminal-profile-controls select:not(:disabled)'))`),
    Boolean,
    10_000,
    'terminal profile settings'
  );
};

const openCodingWorkbench = async () => {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('[data-workbench="coding"]')
      || [...document.querySelectorAll('button')].find(node => /^(编程|coding|コーディング|코딩|programación|codage|programmierung|programação|кодирование|البرمجة)$/i.test((node.textContent || '').trim()));
    button?.click();
    return Boolean(button);
  })()`);
  if (!opened) throw new Error('The coding workbench button is unavailable.');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-composer'))`),
    Boolean,
    5_000,
    'coding workbench'
  );
};

const openTerminalDrawer = async () => {
  const alreadyOpen = await evaluate(`document.querySelector('.nmx-terminal-drawer')?.classList.contains('is-open') || false`);
  if (alreadyOpen) return;
  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => /Open Terminal|打开终端|ターミナル|터미널|Terminal/i.test(node.getAttribute('aria-label') || ''));
    button?.click();
    return Boolean(button);
  })()`);
  if (!opened) throw new Error('The terminal drawer toggle is unavailable.');
  await waitFor(
    () => evaluate(`document.querySelector('.nmx-terminal-drawer')?.classList.contains('is-open') || false`),
    Boolean,
    5_000,
    'terminal drawer'
  );
};

const readTerminalState = () => evaluate(`(() => {
  const interactive = [...document.querySelectorAll('.nmx-terminal-list article:not(.is-readonly)')];
  const active = interactive.find(record => record.classList.contains('is-active'));
  return {
    interactiveCount: interactive.length,
    activeProfileId: active?.getAttribute('data-terminal-profile-id') || '',
    profileIds: interactive.map(record => record.getAttribute('data-terminal-profile-id') || '').filter(Boolean),
    xterm: Boolean(document.querySelector('.nmx-terminal-host .xterm-helper-textarea')),
    terminalText: (document.querySelector('.nmx-terminal-host .xterm-rows')?.textContent || '')
      .replace(/\s+/g, ' ').trim().slice(-2_000),
    closeAllDisabled: document.querySelector('.nmx-terminal-close-all')?.disabled ?? true,
    newTerminalDisabled: document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button')?.disabled ?? true,
  };
})()`);

const closeInteractiveTerminals = async () => {
  const state = await readTerminalState();
  if (!state.interactiveCount) return;
  const closed = await evaluate(`(() => {
    const button = document.querySelector('.nmx-terminal-close-all');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!closed) throw new Error('Existing interactive terminals could not be closed.');
  await waitFor(readTerminalState, value => value.interactiveCount === 0 && !value.xterm, 8_000, 'terminal cleanup');
};

const dispatchEnter = async () => {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
};

const typeTerminal = async command => {
  const focused = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
    textarea?.focus();
    return document.activeElement === textarea;
  })()`);
  if (!focused) throw new Error('The active xterm input is unavailable.');
  await call('Input.insertText', { text: command });
  await dispatchEnter();
};

function shellVisiblePath(profileId, nativePath) {
  const normalized = nativePath.replace(/\\/g, '/');
  if (process.platform !== 'win32') return normalized;
  const match = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!match) throw new Error(`Unable to map the Windows marker path: ${nativePath}`);
  const drive = match[1].toLowerCase();
  if (profileId === 'git_bash') return `/${drive}${match[2]}`;
  if (profileId.startsWith('wsl:')) return `/mnt/${drive}${match[2]}`;
  return normalized;
}

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
const originalStoredProfile = await evaluate(`localStorage.getItem('nextmux.desktop.terminalProfile.v1')`);
const reports = [];
const markerPaths = [];

try {
  await openGeneralSettings();
  const profiles = await evaluate(`(() => {
    const select = document.querySelector('.nmx-terminal-profile-controls select');
    return select instanceof HTMLSelectElement
      ? [...select.options].map(option => ({ id: option.value, label: option.textContent?.trim() || option.value }))
      : [];
  })()`);
  if (!profiles.length) throw new Error('The application did not expose any launchable terminal profile.');

  const hostDiscovery = discoverUsableHostProfiles();
  const expectedProfileIds = hostDiscovery.profiles.map(profile => profile.id);
  const uiProfileIds = profiles.map(profile => profile.id);
  const missingProfileIds = expectedProfileIds.filter(id => !uiProfileIds.includes(id));
  const unexpectedProfileIds = uiProfileIds.filter(id => !expectedProfileIds.includes(id));
  if (!hostDiscovery.reliable) {
    throw new Error(`Host profile discovery was inconclusive: ${hostDiscovery.diagnostics.join(', ') || 'unknown failure'}`);
  }
  if (missingProfileIds.length || unexpectedProfileIds.length) {
    throw new Error(`Terminal profile mismatch. Missing: ${missingProfileIds.join(', ') || 'none'}; unexpected: ${unexpectedProfileIds.join(', ') || 'none'}.`);
  }
  const launchableProfiles = profiles.filter(profile => expectedProfileIds.includes(profile.id));

  for (const profile of launchableProfiles) {
    await openGeneralSettings();
    const selected = await evaluate(`(() => {
      const select = document.querySelector('.nmx-terminal-profile-controls select');
      if (!(select instanceof HTMLSelectElement) || select.disabled
        || ![...select.options].some(option => option.value === ${JSON.stringify(profile.id)})) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, ${JSON.stringify(profile.id)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!selected) throw new Error(`Unable to select terminal profile ${profile.label}.`);
    await waitFor(
      () => evaluate(`(() => ({
        stored: localStorage.getItem('nextmux.desktop.terminalProfile.v1'),
        selected: document.querySelector('.nmx-terminal-profile-controls select')?.value || ''
      }))()`),
      value => value.stored === profile.id && value.selected === profile.id,
      3_000,
      `profile persistence for ${profile.label}`
    );

    await openCodingWorkbench();
    await openTerminalDrawer();
    await closeInteractiveTerminals();
    const created = await evaluate(`(() => {
      const button = document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!created) throw new Error(`The New terminal action was unavailable for ${profile.label}.`);
    const launched = await waitFor(
      readTerminalState,
      value => value.interactiveCount === 1 && value.xterm
        && value.activeProfileId === profile.id && value.profileIds.includes(profile.id),
      profile.id.startsWith('wsl:') ? 15_000 : 10_000,
      `real PTY launch for ${profile.label}`
    );

    const marker = `NMX_PROFILE_${Date.now()}_${reports.length}`;
    const markerPath = join(tmpdir(), `nextmux-profile-${process.pid}-${reports.length}.txt`);
    markerPaths.push(markerPath);
    const visiblePath = shellVisiblePath(profile.id, markerPath);
    await wait(600);
    await typeTerminal(`echo ${marker} > "${visiblePath.replace(/"/g, '\\"')}"`);
    const markerWritten = await waitFor(
      async () => ({
        // Windows PowerShell 5.1 redirects text as UTF-16LE by default. The
        // terminal must preserve that native behavior; the verifier decodes it.
        written: await fileContainsMarker(markerPath, marker),
        terminal: await readTerminalState(),
      }),
      value => value.written,
      profile.id.startsWith('wsl:') ? 15_000 : 8_000,
      `host-visible output from ${profile.label}`
    );

    await typeTerminal('exit');
    const exited = await waitFor(
      readTerminalState,
      value => value.interactiveCount === 0 && !value.xterm,
      profile.id.startsWith('wsl:') ? 15_000 : 8_000,
      `${profile.label} PTY exit cleanup`
    );
    reports.push({
      id: profile.id,
      label: profile.label,
      launchedAfterMs: launched.elapsedMs,
      markerWritten: markerWritten.value.written,
      exitedAfterMs: exited.elapsedMs,
    });
    await rm(markerPath, { force: true });
  }
} finally {
  for (const markerPath of markerPaths) await rm(markerPath, { force: true }).catch(() => undefined);
  await openCodingWorkbench().catch(() => undefined);
  await openTerminalDrawer().catch(() => undefined);
  await closeInteractiveTerminals().catch(() => undefined);
  await openGeneralSettings().catch(() => undefined);
  await evaluate(`(() => {
    const original = ${JSON.stringify(originalStoredProfile)};
    const select = document.querySelector('.nmx-terminal-profile-controls select');
    if (select instanceof HTMLSelectElement && original && [...select.options].some(option => option.value === original)) {
      select.value = original;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (original === null) {
      localStorage.removeItem('nextmux.desktop.terminalProfile.v1');
    }
    return true;
  })()`).catch(() => undefined);
  await openCodingWorkbench().catch(() => undefined);
  socket.close();
}

const report = {
  platform: process.platform,
  architecture: process.arch,
  profiles: reports,
  pass: reports.length > 0 && reports.every(profile => profile.markerWritten),
};
console.log(JSON.stringify(report, undefined, 2));
if (!report.pass) process.exitCode = 1;
