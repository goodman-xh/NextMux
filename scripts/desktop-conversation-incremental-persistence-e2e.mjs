#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9333';
const workspacePath = resolve(process.cwd());
const stateRoot = resolve(process.env.NEXTMUX_INCREMENTAL_E2E_STATE || join(
  workspacePath,
  'output',
  'conversation-incremental-e2e',
  'state'
));
const storeRoot = join(stateRoot, 'conversation-history-v1');
const firstId = 'incremental-e2e-first';
const secondId = 'incremental-e2e-second';
const renamedTitle = `Incremental rename ${Date.now()}`;
const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function pageTarget(timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await wait(200);
  }
  throw new Error(`No Electron page is available on CDP port ${cdpPort}.`);
}

const page = await pageTarget();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  socket.addEventListener('open', resolvePromise, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const operation = pending.get(message.id);
  if (!operation) return;
  pending.delete(message.id);
  if (message.error) operation.reject(new Error(message.error.message));
  else operation.resolve(message.result);
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};
async function waitFor(read, predicate, timeoutMs, label) {
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
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}${lastError ? `; ${lastError}` : ''}`);
}
async function click(selector, label) {
  const located = await waitFor(
    () => evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!(node instanceof HTMLElement) || node.matches(':disabled')) return null;
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null;
    })()`),
    Boolean,
    8_000,
    label
  );
  const { x, y } = located.value;
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await wait(100);
}
async function manifest() {
  return JSON.parse(await readFile(join(storeRoot, 'manifest-v1.json'), 'utf8'));
}

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await waitFor(() => evaluate(`Boolean(document.querySelector('.nmx-desktop-widget'))`), Boolean, 30_000, 'NextMux desktop widget');
  const now = Date.now();
  const seeded = await evaluate(`(() => {
    const now = ${now};
    const makeTurns = prefix => Array.from({ length: 2000 }, (_, index) => ({
      id: prefix + '-turn-' + index,
      prompt: prefix + '-prompt-' + index,
      response: prefix + '-response-' + index + '-' + 'x'.repeat(96),
      error: '', stage: 'complete', createdAt: now - (2000 - index) * 1000,
      completedAt: now - (2000 - index) * 1000 + 300,
      permissionMode: 'workspace_write', routeLabel: 'QA', executionLabel: '', usageLabel: ''
    }));
    const base = {
      workspacePath: ${JSON.stringify(workspacePath)}, browsers: [], pinned: false,
      routeId: '', relayKey: '', reasoningEffort: 'medium', permissionMode: 'workspace_write',
      followUpQueue: [], createdAt: now - 2_000_000
    };
    const sessions = [
      { ...base, id: ${JSON.stringify(firstId)}, title: 'Incremental first', turns: makeTurns('first'), updatedAt: now },
      { ...base, id: ${JSON.stringify(secondId)}, title: 'Incremental untouched', turns: makeTurns('second'), updatedAt: now - 1 }
    ];
    const raw = JSON.stringify(sessions);
    localStorage.setItem('nextmux.desktop.privacy.v1', JSON.stringify({
      requireZeroDataRetention: true, denyDataCollection: true, saveConversationHistory: true
    }));
    localStorage.setItem('nextmux.desktop.codingSessions.v1', raw);
    localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
      version: 1, section: 'coding', workspace: ${JSON.stringify(workspacePath)}, codingPanel: 'thread',
      activeCodingSessionId: ${JSON.stringify(firstId)}, newConversation: false, settingsPanel: 'profile',
      billingTab: 'usage', modelCenterView: 'all', modelCapabilityFilter: 'all', comicView: 'storyboard'
    }));
    return { bytes: new Blob([raw]).size };
  })()`);
  await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
  await waitFor(
    () => evaluate(`document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || ''`),
    value => value === 'Incremental first',
    30_000,
    'first seeded conversation'
  );
  const initial = await waitFor(
    manifest,
    value => value.sessions?.length === 2
      && value.sessions.find(entry => entry.id === firstId)?.updatedAt === now
      && value.sessions.find(entry => entry.id === secondId)?.updatedAt === now - 1
      && value.sessions.every(entry => entry.bytes > 0 && entry.sha256),
    45_000,
    'initial two-session durable commit'
  );
  const initialFiles = new Map(initial.value.sessions.map(entry => [entry.id, entry.file]));

  const menuOpened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-session-row.is-current .nmx-session-more');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!menuOpened) throw new Error('Current conversation menu button is unavailable.');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-session-row.is-current .nmx-session-menu'))`),
    Boolean,
    5_000,
    'conversation menu surface'
  );
  const renameOpened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-session-row.is-current .nmx-session-menu button:first-child');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!renameOpened) throw new Error('Rename conversation action is unavailable.');
  await waitFor(() => evaluate(`Boolean(document.querySelector('.nmx-thread-dialog input'))`), Boolean, 5_000, 'rename dialog');
  await evaluate(`(() => {
    const input = document.querySelector('.nmx-thread-dialog input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(renamedTitle)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const renameSaved = await evaluate(`(() => {
    const button = document.querySelector('.nmx-thread-dialog footer button.is-primary');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!renameSaved) throw new Error('Rename save action is unavailable.');

  const committed = await waitFor(
    manifest,
    value => value.sessions?.find(entry => entry.id === firstId)?.title === renamedTitle,
    15_000,
    'incremental rename commit'
  );
  const finalFiles = new Map(committed.value.sessions.map(entry => [entry.id, entry.file]));
  const storedFiles = (await readdir(storeRoot)).filter(file => /^session-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(file));
  const report = {
    seededBytes: seeded.bytes,
    initialCommitMs: initial.elapsedMs,
    incrementalCommitMs: committed.elapsedMs,
    changedFileReplaced: initialFiles.get(firstId) !== finalFiles.get(firstId),
    untouchedFileReused: initialFiles.get(secondId) === finalFiles.get(secondId),
    storedSessionFiles: storedFiles.length,
    pass: initialFiles.get(firstId) !== finalFiles.get(firstId)
      && initialFiles.get(secondId) === finalFiles.get(secondId)
      && storedFiles.length === 2
  };
  console.log(JSON.stringify(report, undefined, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  socket.close();
}
