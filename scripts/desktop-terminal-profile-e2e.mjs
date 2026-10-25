#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';

const marker = `NEXTMUX_HOST_PROFILE_${process.pid}`;

function executable(candidate) {
  if (!candidate || !isAbsolute(candidate) || candidate.includes('\0')) return undefined;
  try {
    const resolved = realpathSync(candidate);
    return statSync(resolved).isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function pathExecutables(name) {
  const seen = new Set();
  const results = [];
  for (const entry of String(process.env.PATH || '').split(delimiter).map(value => value.trim()).filter(Boolean)) {
    const candidate = executable(join(entry, name));
    const key = process.platform === 'win32' ? candidate?.toLowerCase() : candidate;
    if (candidate && !seen.has(key)) {
      seen.add(key);
      results.push(candidate);
    }
  }
  return results;
}

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    const resolved = executable(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

function runProbe(command, args, input, timeout = 10_000) {
  const result = spawnSync(command, args, {
    cwd: homedir(),
    env: {
      ...process.env,
      NEXTMUX_TERMINAL_PROBE: '1',
      HISTFILE: process.platform === 'win32' ? process.env.HISTFILE : '/dev/null',
      fish_history: '',
      TERM: process.env.TERM || 'xterm-256color',
    },
    input,
    windowsHide: true,
    timeout,
    maxBuffer: 256 * 1024,
  });
  const output = Buffer.concat([
    Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
    Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || ''),
  ]).toString('utf8').replace(/\0/g, '');
  return !result.error && result.status === 0 && output.includes(marker);
}

function parseWslDistributions(bytes) {
  const value = Buffer.from(bytes);
  const zeroBytes = [...value].filter(byte => byte === 0).length;
  const decoded = zeroBytes > value.length / 4 ? value.toString('utf16le') : value.toString('utf8');
  return [...new Set(decoded.replace(/^\ufeff/, '').replace(/\0/g, '').split(/\r?\n/)
    .map(item => item.trim())
    .filter(item => item && !/^(docker|rancher)-desktop/i.test(item)))];
}

function discoverWindowsProfiles() {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const installationRoots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(Arm)'],
    process.env['ProgramFiles(x86)'],
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const profiles = [];
  const diagnostics = [];
  const add = (id, label, shellPath, args, input, timeout) => {
    if (shellPath && runProbe(shellPath, args, input, timeout)) profiles.push({ id, label, shellPath });
  };

  const powerShell = firstExecutable([
    ...pathExecutables('pwsh.exe'),
    ...installationRoots.map(root => join(root, 'PowerShell', '7', 'pwsh.exe')),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'PowerShell', '7', 'pwsh.exe') : undefined,
  ]);
  add('powershell', 'PowerShell', powerShell, ['-NoLogo'], `Write-Output '${marker}'; exit 0\r\n`);

  const windowsPowerShell = firstExecutable([
    join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ]);
  if (windowsPowerShell?.toLowerCase() !== powerShell?.toLowerCase()) {
    add('windows_powershell', 'Windows PowerShell', windowsPowerShell, ['-NoLogo'],
      `Write-Output '${marker}'; exit 0\r\n`);
  }

  const commandPrompt = firstExecutable([
    process.env.COMSPEC,
    join(systemRoot, 'Sysnative', 'cmd.exe'),
    join(systemRoot, 'System32', 'cmd.exe'),
    ...pathExecutables('cmd.exe'),
  ]);
  add('command_prompt', 'Command Prompt', commandPrompt, [], `echo ${marker} & exit /b 0\r\n`);

  const gitRoots = [];
  const reg = firstExecutable([
    join(systemRoot, 'Sysnative', 'reg.exe'),
    join(systemRoot, 'System32', 'reg.exe'),
  ]);
  if (reg) {
    for (const key of [
      'HKCU\\Software\\GitForWindows',
      'HKLM\\Software\\GitForWindows',
      'HKLM\\Software\\WOW6432Node\\GitForWindows',
    ]) {
      const result = spawnSync(reg, ['query', key, '/v', 'InstallPath'], {
        encoding: 'utf8', windowsHide: true, timeout: 3_000,
      });
      const installPath = result.status === 0
        ? result.stdout.match(/^\s*InstallPath\s+REG_[A-Z0-9_]+\s+(.+?)\s*$/im)?.[1]?.trim()
        : undefined;
      if (installPath && !gitRoots.some(root => root.toLowerCase() === installPath.toLowerCase())) gitRoots.push(installPath);
    }
  }
  const gitExecutables = pathExecutables('git.exe');
  const gitBash = firstExecutable([
    ...gitRoots.map(root => join(root, 'bin', 'bash.exe')),
    ...gitExecutables.map(git => join(dirname(dirname(git)), 'bin', 'bash.exe')),
    ...installationRoots.map(root => join(root, 'Git', 'bin', 'bash.exe')),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
    ...pathExecutables('bash.exe').filter(candidate => /[\\/]Git[\\/]/i.test(candidate)),
  ]);
  add('git_bash', 'Git Bash', gitBash, ['--login', '-i'], `printf '%s\\n' '${marker}'; exit 0\n`);

  const wsl = firstExecutable([
    join(systemRoot, 'Sysnative', 'wsl.exe'),
    join(systemRoot, 'System32', 'wsl.exe'),
    ...pathExecutables('wsl.exe'),
  ]);
  let reliable = true;
  let wslStatus = wsl ? 'setup_required' : 'unavailable';
  let wslDistributions = [];
  if (wsl) {
    const listed = spawnSync(wsl, ['--list', '--quiet'], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    if (listed.error || listed.status !== 0 || !Buffer.isBuffer(listed.stdout)) {
      reliable = false;
      wslStatus = 'probe_failed';
      diagnostics.push(`wsl-list:${listed.error?.code || listed.status || 'unknown'}`);
    } else {
      wslDistributions = parseWslDistributions(listed.stdout);
      wslStatus = wslDistributions.length ? 'ready' : 'setup_required';
      let usableWslCount = 0;
      for (const distribution of wslDistributions) {
        const digest = createHash('sha256').update(distribution).digest('hex').slice(0, 12);
        const before = profiles.length;
        add(`wsl:${digest}`, `WSL · ${distribution}`, wsl, ['-d', distribution],
          `printf '%s\\n' '${marker}'; exit 0\n`, 15_000);
        if (profiles.length > before) usableWslCount += 1;
      }
      if (wslDistributions.length && !usableWslCount) wslStatus = 'probe_failed';
    }
  }
  return { reliable, profiles, wslStatus, wslDistributions, diagnostics };
}

function discoverPosixProfiles() {
  let accountShell = '';
  try { accountShell = userInfo().shell || ''; } catch { /* Keep discovery deterministic. */ }
  let loginShells = [];
  try {
    loginShells = readFileSync('/etc/shells', 'utf8').split(/\r?\n/)
      .map(value => value.trim()).filter(value => value.startsWith('/') && !value.startsWith('/#'));
  } catch { /* /etc/shells is optional. */ }
  const pathShells = ['zsh', 'bash', 'fish', 'pwsh', 'nu'].flatMap(pathExecutables);
  const candidates = [accountShell, process.env.SHELL, ...loginShells, ...pathShells, '/bin/zsh', '/bin/bash', '/bin/sh'];
  const discoveredProfiles = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const shellPath = executable(candidate);
    if (!shellPath || seen.has(shellPath)) continue;
    seen.add(shellPath);
    const fileName = basename(shellPath).toLowerCase();
    const shellKind = ['zsh', 'bash', 'fish', 'sh'].includes(fileName) ? fileName
      : fileName === 'pwsh' ? 'powershell' : 'unknown';
    const baseId = shellKind === 'unknown'
      ? (fileName || 'shell').replace(/[^a-z0-9._-]/g, '-') || 'shell'
      : shellKind;
    let id = baseId;
    for (let suffix = 2; discoveredProfiles.some(item => item.id === id); suffix += 1) id = `${baseId}-${suffix}`;
    const args = shellKind === 'powershell' ? ['-NoLogo']
      : shellKind === 'unknown' ? [] : ['-l'];
    const input = shellKind === 'powershell'
      ? `Write-Output '${marker}'; exit 0\n`
      : `printf '%s\\n' '${marker}'; exit 0\n`;
    discoveredProfiles.push({ id, label: fileName || 'Shell', shellPath, args, input });
  }
  const profiles = discoveredProfiles
    .filter(profile => runProbe(profile.shellPath, profile.args, profile.input))
    .map(({ id, label, shellPath }) => ({ id, label, shellPath }));
  return { reliable: true, profiles, wslStatus: 'not_applicable', wslDistributions: [], diagnostics: [] };
}

export function discoverUsableHostProfiles() {
  if (process.platform === 'win32') return discoverWindowsProfiles();
  if (process.platform === 'darwin' || process.platform === 'linux') return discoverPosixProfiles();
  return { reliable: false, profiles: [], wslStatus: 'not_applicable', wslDistributions: [], diagnostics: ['unsupported-platform'] };
}

if (process.argv.includes('--discover-host-profiles')) {
  console.log(JSON.stringify(discoverUsableHostProfiles()));
  process.exit(0);
}

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

try {
  await call('Runtime.enable');
  await evaluate(`(() => {
    if (!document.querySelector('[data-settings-panel="general"]')) document.querySelector('.nmx-account-trigger')?.click();
    return true;
  })()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-settings-panel="general"]'))`), Boolean, 5_000, 'settings navigation');
  await evaluate(`document.querySelector('[data-settings-panel="general"]')?.click()`);

  const readSettings = () => evaluate(`(() => {
    const select = document.querySelector('.nmx-terminal-profile-controls select');
    const refresh = document.querySelector('.nmx-terminal-profile-controls button');
    const note = document.querySelector('.nmx-terminal-runtime-note');
    return {
      ready: select instanceof HTMLSelectElement && !select.disabled,
      busy: select?.getAttribute('aria-busy') === 'true',
      selected: select instanceof HTMLSelectElement ? select.value : '',
      options: select instanceof HTMLSelectElement
        ? [...select.options].map(option => ({ value: option.value, label: option.textContent?.trim() || '' })) : [],
      refreshText: refresh?.textContent?.trim() || '',
      note: note?.textContent?.trim().replace(/\s+/g, ' ') || '',
      platform: navigator.platform,
    };
  })()`);
  const initial = await waitFor(readSettings, state => state.ready && state.options.length > 0, 15_000, 'detected terminal profiles');
  const originalProfile = initial.value.selected;
  const originalStoredProfile = await evaluate(`window.localStorage.getItem('nextmux.desktop.terminalProfile.v1')`);
  await evaluate(`(() => {
    window.localStorage.removeItem('nextmux.desktop.terminalProfile.v1');
    document.querySelector('.nmx-terminal-profile-controls button')?.click();
    return true;
  })()`);
  const refreshed = await waitFor(readSettings, state => state.ready && !state.busy && state.options.length > 0, 20_000, 'refreshed terminal profiles');
  const detectedDefaultProfile = refreshed.value.selected;

  const alternate = refreshed.value.options.find(option => option.value === 'command_prompt')
    || refreshed.value.options.find(option => option.value !== originalProfile);
  let selectionPersisted = true;
  if (alternate) {
    selectionPersisted = await evaluate(`(() => {
      const select = document.querySelector('.nmx-terminal-profile-controls select');
      if (!(select instanceof HTMLSelectElement)) return false;
      select.value = ${JSON.stringify(alternate.value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return window.localStorage.getItem('nextmux.desktop.terminalProfile.v1') === ${JSON.stringify(alternate.value)};
    })()`);
  }

  const hostDiscovery = discoverUsableHostProfiles();
  const expectedProfileIds = hostDiscovery.profiles.map(profile => profile.id);
  const uiProfileIds = refreshed.value.options.map(profile => profile.value);
  const missingProfileIds = expectedProfileIds.filter(id => !uiProfileIds.includes(id));
  const unexpectedProfileIds = uiProfileIds.filter(id => !expectedProfileIds.includes(id));
  const hostDiscoveryReliable = hostDiscovery.reliable;
  const wslGuidanceVisible = /wsl|linux|安装|setup|required|distribution|发行版|probe|检测|探测/i.test(refreshed.value.note);
  const wslRequirementSatisfied = hostDiscovery.wslStatus === 'not_applicable'
    || hostDiscovery.wslStatus === 'ready'
    || wslGuidanceVisible;
  const report = {
    platform: refreshed.value.platform,
    options: refreshed.value.options,
    hostProfiles: hostDiscovery.profiles,
    hostDiscoveryReliable,
    hostDiagnostics: hostDiscovery.diagnostics,
    previousProfile: originalProfile,
    defaultProfile: detectedDefaultProfile,
    refreshText: refreshed.value.refreshText,
    runtimeNote: refreshed.value.note,
    selectionPersisted,
    missingProfileIds,
    unexpectedProfileIds,
    wslStatus: hostDiscovery.wslStatus,
    wslDistributions: hostDiscovery.wslDistributions,
    pass: hostDiscoveryReliable
      && expectedProfileIds.length > 0
      && selectionPersisted
      && missingProfileIds.length === 0
      && unexpectedProfileIds.length === 0
      && detectedDefaultProfile === expectedProfileIds[0]
      && wslRequirementSatisfied,
  };
  console.log(JSON.stringify(report, undefined, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await evaluate(`(() => {
    const coding = [...document.querySelectorAll('button')].find(button => /^(编程|coding)$/i.test((button.textContent || '').trim()));
    coding?.click();
    return Boolean(coding);
  })()`).catch(() => undefined);
  socket.close();
}
