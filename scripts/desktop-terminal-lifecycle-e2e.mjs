#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const stamp = Date.now();
const specialPathRoot = join(tmpdir(), `nextmux terminal & dollar$ (${stamp})`);
await mkdir(specialPathRoot, { recursive: true });
const readyPath = join(specialPathRoot, 'ready output & result$.txt');
const killedPath = join(specialPathRoot, 'killed output & result$.txt');
const childPidPath = join(specialPathRoot, 'child pid & result$.txt');
const interruptedShellPath = join(specialPathRoot, 'ctrl-c shell output & result$.txt');
const failedCommandPath = join(specialPathRoot, 'failed output & result$.txt');
const pastedCommandPath = join(specialPathRoot, 'pasted output & result$.txt');
const copyMarker = `NMX_TERMINAL_COPY_${stamp}`;
const renamedTitle = `QA Terminal ${String(stamp).slice(-5)}`;
const fixtureScript = join(specialPathRoot, 'terminal fixture & dollar$ (copy).mjs');
await copyFile(fileURLToPath(new URL('./desktop-terminal-fixture.mjs', import.meta.url)), fixtureScript);

function shellVisiblePath(profileId, nativePath) {
  if (process.platform !== 'win32') return nativePath;
  const normalized = nativePath.replace(/\\/g, '/');
  const match = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!match) throw new Error(`Unable to map the Windows terminal path: ${nativePath}`);
  const drive = match[1].toLowerCase();
  if (profileId === 'git_bash') return `/${drive}${match[2]}`;
  if (profileId.startsWith('wsl:')) return `/mnt/${drive}${match[2]}`;
  return nativePath;
}

function quotePowerShellArgument(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteCommandPromptArgument(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quotePosixArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function quoteTerminalArgument(profileId, value, isPath = false) {
  const visible = isPath ? shellVisiblePath(profileId, value) : String(value);
  if (profileId === 'powershell' || profileId === 'windows_powershell') return quotePowerShellArgument(visible);
  if (profileId === 'command_prompt') return quoteCommandPromptArgument(visible);
  return quotePosixArgument(visible);
}

function fixtureCommand(profileId, action, ...args) {
  return [
    'node',
    quoteTerminalArgument(profileId, fixtureScript, true),
    action,
    ...args.map(({ value, path = false }) => quoteTerminalArgument(profileId, value, path)),
  ].join(' ');
}

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
const rendererExceptions = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    rendererExceptions.push(message.params?.exceptionDetails?.exception?.description
      ?? message.params?.exceptionDetails?.text
      ?? 'Unknown renderer exception');
  }
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
    'coding workbench',
  );
};
const exists = async path => access(path, constants.F_OK).then(() => true, () => false);
const processIsRunning = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};
const readTerminalState = () => evaluate(`(() => ({
  drawerOpen: document.querySelector('.nmx-terminal-drawer')?.classList.contains('is-open') || false,
  records: [...document.querySelectorAll('.nmx-terminal-list article')].map(node => ({
    title: (node.querySelector('.nmx-terminal-select strong, .nmx-terminal-rename input')?.value
      || node.querySelector('.nmx-terminal-select strong')?.textContent || '').trim(),
    active: node.classList.contains('is-active'),
    readonly: node.classList.contains('is-readonly'),
    profileId: node.getAttribute('data-terminal-profile-id') || ''
  })),
  activeProfileId: document.querySelector('.nmx-terminal-list article.is-active')?.getAttribute('data-terminal-profile-id') || '',
  xterm: Boolean(document.querySelector('.nmx-terminal-host .xterm-helper-textarea')),
  scrollbackLines: Number(document.querySelector('.nmx-terminal-host [data-nextmux-scrollback-lines]')?.getAttribute('data-nextmux-scrollback-lines') || 0),
  shellIcon: document.querySelector('.nmx-terminal-list article.is-active .nmx-terminal-select > i')?.className || '',
  closeAllDisabled: document.querySelector('.nmx-terminal-close-all')?.disabled ?? true,
  newTerminalDisabled: document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button')?.disabled ?? true
}))()`);
const point = selector => evaluate(`(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
const clickAt = async (target, clickCount = 1) => {
  if (!target) throw new Error('Unable to click a missing terminal control.');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount });
};
const typeTerminal = async command => {
  const focused = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
    textarea?.focus();
    return document.activeElement === textarea;
  })()`);
  if (!focused) throw new Error('The active terminal input is unavailable.');
  // xterm consumes keyboard/character events rather than a DOM input value.
  // `Input.insertText` can mutate Chromium's hidden textarea without invoking
  // xterm's key pipeline. CDP character events accept one printable character,
  // so replay the command through the same path as real keyboard input.
  for (const character of command) {
    await call('Input.dispatchKeyEvent', {
      type: 'char',
      key: character,
      text: character,
      unmodifiedText: character,
    });
  }
  await dispatchEnter();
};
const dispatchEnter = async () => {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
};
const dispatchControlC = async () => {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
};

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');
const originalRecords = await evaluate(`localStorage.getItem('nextmux.desktop.terminalRecords.v1')`);
let report;
try {
  await openCodingWorkbench();
  if (!(await readTerminalState()).drawerOpen) {
    const opened = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => /Open Terminal|打开终端|ターミナル/.test(node.getAttribute('aria-label') || ''));
      button?.click();
      return Boolean(button);
    })()`);
    if (!opened) throw new Error('The terminal drawer toggle is unavailable.');
  }
  const initial = await waitFor(readTerminalState, state => state.drawerOpen, 5_000, 'terminal drawer');
  const terminalRecords = state => state.records;
  const syntheticTaskRecords = state => state.records.filter(record => record.readonly);
  if (terminalRecords(initial.value).length) {
    const cleared = await evaluate(`(() => {
      const button = document.querySelector('.nmx-terminal-close-all');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!cleared) throw new Error('Existing QA terminals could not be cleared.');
    await waitFor(readTerminalState, state => terminalRecords(state).length === 0 && !state.xterm, 5_000, 'clean terminal baseline');
  }
  const initialCount = 0;
  const createTerminal = async () => {
    const created = await evaluate(`(() => {
      const button = document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!created) throw new Error('The New terminal button is unavailable.');
    return waitFor(
      readTerminalState,
      state => terminalRecords(state).length > initialCount && state.xterm && state.scrollbackLines === 10_000,
      8_000,
      'a live terminal with production scrollback'
    );
  };
  const firstCreated = await createTerminal();
  const activeProfileId = firstCreated.value.activeProfileId;
  if (!activeProfileId) throw new Error('The active terminal did not expose its profile identity.');
  // `TerminalWidget.start()` creates the PTY before the shell prompt has
  // necessarily attached its input listener. Wait for that short, real
  // renderer hand-off rather than racing the very first keystroke.
  await wait(500);
  await typeTerminal(fixtureCommand(activeProfileId, '--fixture-write',
    { value: readyPath, path: true }, { value: 'ready' }));
  const ready = await waitFor(() => exists(readyPath), Boolean, 8_000, 'terminal command output side effect');
  await wait(650);

  await typeTerminal(fixtureCommand(activeProfileId, '--fixture-echo', { value: copyMarker }));
  await wait(650);
  const copyRow = await waitFor(
    () => evaluate(`(() => {
      const screen = document.querySelector('.nmx-terminal-host .xterm-screen');
      const textarea = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
       if (!screen || !textarea) return null;
       const screenRect = screen.getBoundingClientRect();
       // Select the complete visible terminal viewport. A long fixture path can
       // wrap the command onto more than three rows, so selecting only the rows
       // nearest the cursor can capture merely the numeric tail of the marker.
       // The canvas renderer has no text-row DOM nodes; the clipboard result is
       // still the observable proof that real pointer selection + Enter worked.
       return {
         target: {
           start: { x: screenRect.left + 4, y: screenRect.top + 4 },
           end: { x: screenRect.right - 4, y: screenRect.bottom - 4 }
         }
       };
    })()`),
    value => Boolean(value?.target),
    8_000,
    'copy marker in xterm output'
  );
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: copyRow.value.target.start.x, y: copyRow.value.target.start.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: copyRow.value.target.start.x, y: copyRow.value.target.start.y, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: copyRow.value.target.end.x, y: copyRow.value.target.end.y, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: copyRow.value.target.end.x, y: copyRow.value.target.end.y, button: 'left', buttons: 0, clickCount: 1 });
  // This build uses xterm's canvas renderer, so selection is painted into the
  // terminal canvas rather than represented by a DOM selection layer. The
  // native clipboard assertion below is the observable selection contract.
  const selectionReady = { value: true };
  await wait(80);
  await dispatchEnter();
  const copiedText = await waitFor(
    () => evaluate(`window.electronTheiaCore?.readClipboard?.() || ''`),
    value => String(value).includes(copyMarker),
    3_000,
    'Enter-copy clipboard result'
  );

  const pastedCommand = fixtureCommand(activeProfileId, '--fixture-write',
    { value: pastedCommandPath, path: true }, { value: 'right-click-paste' });
  await evaluate(`window.electronTheiaCore?.writeClipboard?.(${JSON.stringify(pastedCommand)})`);
  const terminalPoint = await point('.nmx-terminal-host .xterm-screen');
  if (!terminalPoint) throw new Error('The active xterm screen is unavailable for right-click paste.');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: terminalPoint.x, y: terminalPoint.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: terminalPoint.x, y: terminalPoint.y, button: 'right', buttons: 2, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: terminalPoint.x, y: terminalPoint.y, button: 'right', buttons: 0, clickCount: 1 });
  await wait(180);
  await dispatchEnter();
  const rightClickPasted = await waitFor(() => exists(pastedCommandPath), Boolean, 8_000, 'right-click pasted terminal command');

  const activeSelector = '.nmx-terminal-list article.is-active .nmx-terminal-select';
  await clickAt(await point(activeSelector), 2);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-terminal-list article.is-active .nmx-terminal-rename input'))`),
    Boolean,
    3_000,
    'terminal rename input'
  );
  await evaluate(`(() => { const input = document.querySelector('.nmx-terminal-list article.is-active .nmx-terminal-rename input'); input?.focus(); input?.select(); return Boolean(input); })()`);
  await call('Input.insertText', { text: renamedTitle });
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  const renamed = await waitFor(readTerminalState, state => state.records.some(record => record.title === renamedTitle), 4_000, 'renamed terminal');

  const idleCount = terminalRecords(renamed.value).length;
  const idleReuseClicked = await evaluate(`(() => {
    const button = document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!idleReuseClicked) throw new Error('The idle terminal reuse action was unavailable.');
  const idleReused = await waitFor(readTerminalState, state => terminalRecords(state).length === idleCount && state.xterm, 4_000, 'idle terminal reuse');
  await waitFor(readTerminalState, state => !state.newTerminalDisabled, 4_000, 'idle terminal reuse completion');

  // A real child process makes the first shell busy. Only then may the app
  // allocate another PTY for the same conversation.
  await typeTerminal(fixtureCommand(activeProfileId, '--fixture-delayed-write',
    { value: killedPath, path: true }, { value: childPidPath, path: true }));
  const childPid = Number((await waitFor(
    async () => await exists(childPidPath) ? (await readFile(childPidPath, 'utf8')).trim() : '',
    value => /^\d+$/.test(value) && processIsRunning(Number(value)),
    8_000,
    'long-running child process handshake',
  )).value);
  const busyCount = terminalRecords(await readTerminalState()).length;
  const secondCreated = await evaluate(`(() => {
    const button = document.querySelector('.nmx-terminal-drawer > header .codicon-add')?.closest('button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!secondCreated) throw new Error('A second terminal could not be created while the first shell was busy.');
  await waitFor(readTerminalState, state => terminalRecords(state).length === busyCount + 1 && state.xterm, 8_000, 'second live terminal');
  await wait(500);

  // A command may return a non-zero exit code without terminating its shell.
  await typeTerminal(fixtureCommand(activeProfileId, '--fixture-write',
    { value: failedCommandPath, path: true }, { value: 'failed-command-recorded' }, { value: '3' }));
  await waitFor(() => exists(failedCommandPath), Boolean, 8_000, 'non-zero command completion');
  const commandFailurePreservedShell = terminalRecords(await readTerminalState()).length === busyCount + 1;

  // An explicit shell exit is different: its terminal disappears immediately.
  await typeTerminal('exit');
  const shellExitRemovedTerminal = await waitFor(
    readTerminalState,
    state => terminalRecords(state).length === busyCount,
    8_000,
    'exited shell removal'
  );

  // The original terminal still owns the long-running child. With no xterm
  // selection, Ctrl+C must reach that PTY as ETX instead of becoming a copy.
  const selectedBusyTerminal = await evaluate(`(() => {
    const record = [...document.querySelectorAll('.nmx-terminal-list article')]
      .find(node => (node.querySelector('.nmx-terminal-select strong')?.textContent || '').trim() === ${JSON.stringify(renamedTitle)});
    record?.querySelector('.nmx-terminal-select')?.click();
    return Boolean(record);
  })()`);
  if (!selectedBusyTerminal) throw new Error('The busy terminal could not be selected for Ctrl+C verification.');
  await waitFor(readTerminalState, state => state.records.some(record => record.active && record.title === renamedTitle), 3_000, 'busy terminal selection');
  const focusedForInterrupt = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
    textarea?.focus();
    return document.activeElement === textarea;
  })()`);
  if (!focusedForInterrupt) throw new Error('The busy terminal could not receive Ctrl+C.');
  await dispatchControlC();
  await wait(250);
  await typeTerminal(fixtureCommand(activeProfileId, '--fixture-write',
    { value: interruptedShellPath, path: true }, { value: 'ctrl-c-returned-to-shell' }));
  const ctrlCInterruptedForegroundProcess = await waitFor(
    () => exists(interruptedShellPath), Boolean, 5_000, 'Ctrl+C to return control to the shell'
  );

  const closeAllAvailable = !(await readTerminalState()).closeAllDisabled;
  const closed = await evaluate(`(() => {
    const button = document.querySelector('.nmx-terminal-close-all');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!closed) throw new Error('Close current conversation terminals was unavailable.');
  const allClosed = await waitFor(readTerminalState, state => terminalRecords(state).length === 0 && !state.xterm, 5_000, 'all current-conversation terminals to close');
  const childWasTerminated = await waitFor(
    async () => !processIsRunning(childPid) && !(await exists(killedPath)),
    Boolean,
    8_000,
    'closed terminal child process to exit without delayed side effects',
  );

  // Recreate one real PTY and reload while its xterm renderer is still live.
  // This reproduces the renderer/idle-callback teardown race that only occurs
  // during a genuine Electron page lifecycle, not in static component tests.
  rendererExceptions.length = 0;
  const reloadTerminal = await createTerminal();
  await wait(500);
  await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
  await wait(3_500);
  const afterReload = await waitFor(
    async () => {
      try {
        return await readTerminalState();
      } catch {
        return undefined;
      }
    },
    state => Boolean(state?.drawerOpen) && terminalRecords(state).length === 0,
    10_000,
    'active terminal cleanup after a renderer reload'
  );
  const rendererReloadSafe = reloadTerminal.value.xterm
    && terminalRecords(afterReload.value).length === 0
    && rendererExceptions.length === 0;
  report = {
    initialTerminalCount: initialCount,
    firstTerminalCreatedAfterMs: firstCreated.elapsedMs,
    shellIcon: firstCreated.value.shellIcon,
    scrollbackLines: firstCreated.value.scrollbackLines,
    commandExecuted: ready.value,
    enterCopiedSelection: selectionReady.value && String(copiedText.value).includes(copyMarker),
    rightClickPastedCommand: rightClickPasted.value,
    renamePersisted: renamed.value.records.some(record => record.title === renamedTitle),
    idleTerminalReused: terminalRecords(idleReused.value).length === idleCount,
    busyShellAllocatedSecondTerminal: true,
    commandFailurePreservedShell,
    shellExitRemovedTerminal: terminalRecords(shellExitRemovedTerminal.value).length === busyCount,
    ctrlCInterruptedForegroundProcess: ctrlCInterruptedForegroundProcess.value,
    closeAllAvailable,
    allCurrentTerminalsRemoved: terminalRecords(allClosed.value).length === 0,
    syntheticTaskTerminalsAbsent: syntheticTaskRecords(initial.value).length === 0
      && syntheticTaskRecords(allClosed.value).length === 0,
    childWasTerminated: childWasTerminated.value,
    rendererReloadSafe,
    rendererExceptions,
    pass: firstCreated.value.xterm
      && firstCreated.value.scrollbackLines === 10_000
      && ready.value
      && selectionReady.value
      && String(copiedText.value).includes(copyMarker)
      && rightClickPasted.value
      && renamed.value.records.some(record => record.title === renamedTitle)
      && terminalRecords(idleReused.value).length === idleCount
      && commandFailurePreservedShell
      && terminalRecords(shellExitRemovedTerminal.value).length === busyCount
      && ctrlCInterruptedForegroundProcess.value
      && closeAllAvailable
      && terminalRecords(allClosed.value).length === 0
      && syntheticTaskRecords(initial.value).length === 0
      && syntheticTaskRecords(allClosed.value).length === 0
      && childWasTerminated.value
      && rendererReloadSafe
  };
} finally {
  await rm(readyPath, { force: true }).catch(() => undefined);
  await rm(killedPath, { force: true }).catch(() => undefined);
  await rm(childPidPath, { force: true }).catch(() => undefined);
  await rm(interruptedShellPath, { force: true }).catch(() => undefined);
  await rm(failedCommandPath, { force: true }).catch(() => undefined);
  await rm(pastedCommandPath, { force: true }).catch(() => undefined);
  await rm(specialPathRoot, { recursive: true, force: true }).catch(() => undefined);
  await evaluate(`(() => {
    const value = ${JSON.stringify(originalRecords)};
    if (value === null) localStorage.removeItem('nextmux.desktop.terminalRecords.v1');
    else localStorage.setItem('nextmux.desktop.terminalRecords.v1', value);
    return true;
  })()`);
  await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
  await wait(1_800);
  socket.close();
}

console.log(JSON.stringify(report, undefined, 2));
if (!report?.pass) process.exitCode = 1;
