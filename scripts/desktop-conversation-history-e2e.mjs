#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9333';
const phase = process.env.NEXTMUX_HISTORY_E2E_PHASE || 'seed';
const workspacePath = resolve(process.cwd());
const qaRoot = resolve(process.env.NEXTMUX_HISTORY_E2E_ROOT || join(workspacePath, 'output', 'conversation-history-e2e'));
const storeRoot = join(qaRoot, 'state', 'conversation-history-v1');
const sessionId = 'history-e2e-session';
const title = 'History E2E · 2000 turns';
const turnCount = 2_000;
const earlyMarker = 'HISTORY_E2E_EARLY_10';

const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function fetchPageTarget(timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
      const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw new Error(`No Electron page is available on CDP port ${cdpPort}: ${lastError || 'timed out'}`);
}

const page = await fetchPageTarget();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  socket.addEventListener('open', resolvePromise, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const operation = pending.get(message.id);
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
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
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
      // Navigation briefly destroys the execution context. Retry against the
      // new document instead of treating a healthy reload as an E2E failure.
      lastError = error;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}${lastError ? `; ${lastError}` : ''}`);
}

async function readCommittedSession() {
  const rawManifest = await readFile(join(storeRoot, 'manifest-v1.json'), 'utf8');
  const manifest = JSON.parse(rawManifest);
  const entry = manifest.sessions.find(candidate => candidate.id === sessionId);
  if (!entry) return undefined;
  const sessionPath = join(storeRoot, entry.file);
  const [sessionRaw, metadata] = await Promise.all([readFile(sessionPath, 'utf8'), stat(sessionPath)]);
  return { entry, session: JSON.parse(sessionRaw), bytes: metadata.size };
}

const readUiState = () => evaluate(`(() => {
  const mirrorRaw = localStorage.getItem('nextmux.desktop.codingSessions.v1') || '';
  let mirror;
  try { mirror = JSON.parse(mirrorRaw); } catch { mirror = null; }
  const current = document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || '';
  return {
    widget: Boolean(document.querySelector('.nmx-desktop-widget')),
    current,
    renderedTurns: document.querySelectorAll('.nmx-task-turn').length,
    renderedTimelineItems: document.querySelectorAll('.nmx-thread-timeline [data-turn-id]').length,
    mirrorVersion: mirror?.version ?? null,
    mirrorComplete: mirror?.complete ?? null,
    mirrorSessions: Array.isArray(mirror?.sessions) ? mirror.sessions.length : -1,
    mirrorTurns: Array.isArray(mirror?.sessions?.[0]?.turns) ? mirror.sessions[0].turns.length : -1,
    mirrorBytes: new Blob([mirrorRaw]).size,
    firstRenderedTurn: document.querySelector('.nmx-task-turn')?.dataset.turnId || '',
    lastRenderedTurn: [...document.querySelectorAll('.nmx-task-turn')].at(-1)?.dataset.turnId || ''
  };
})()`);

async function runSearchRegression() {
  const focusPoint = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea');
    const stage = document.querySelector('.nmx-coding-stage');
    textarea?.focus();
    const bounds = (stage || textarea)?.getBoundingClientRect();
    return bounds ? { x: bounds.left + Math.min(40, bounds.width / 2), y: bounds.top + Math.min(40, bounds.height / 2) } : null;
  })()`);
  if (!focusPoint) throw new Error('Conversation surface is unavailable for search regression.');
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70, modifiers: 2
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70, modifiers: 2
  });
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-thread-find input'))`),
    Boolean,
    5_000,
    'current-conversation search control'
  );
  await call('Input.insertText', { text: earlyMarker });
  return waitFor(
    () => evaluate(`(() => ({
      query: document.querySelector('.nmx-thread-find input')?.value || '',
      counter: document.querySelector('.nmx-thread-find > span')?.textContent || '',
      mounted: Boolean(document.querySelector('.nmx-task-turn[data-turn-id="history-turn-10"]')),
      highlighted: [...document.querySelectorAll('.nmx-task-turn[data-turn-id="history-turn-10"] mark')]
        .some(node => (node.textContent || '').includes(${JSON.stringify(earlyMarker)})),
      renderedTurns: document.querySelectorAll('.nmx-task-turn').length
    }))()`),
    state => state.query === earlyMarker && state.mounted && state.highlighted && /^1\//.test(state.counter),
    10_000,
    'old turn mounted and highlighted through the real search UI'
  );
}

async function runGlobalSearchRegression() {
  const opened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-context-heading > div > button:first-child');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('Global conversation search button is unavailable.');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-sidebar-search input'))`),
    Boolean,
    5_000,
    'global conversation search input'
  );
  await call('Input.insertText', { text: earlyMarker });
  const found = await waitFor(
    () => evaluate(`(() => ({
      query: document.querySelector('.nmx-sidebar-search input')?.value || '',
      title: document.querySelector('.nmx-session-row .nmx-session-open span')?.textContent || '',
      match: document.querySelector('.nmx-session-row .nmx-session-open small')?.textContent || ''
    }))()`),
    value => value.query === earlyMarker && value.title.includes('History E2E') && /history-/i.test(value.match),
    10_000,
    'old durable message through global search'
  );
  await evaluate(`document.querySelector('.nmx-sidebar-search > button')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-sidebar-search input'))`),
    value => !value,
    5_000,
    'global search close'
  );
  return found;
}

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-desktop-widget'))`),
    Boolean,
    30_000,
    'NextMux desktop widget'
  );

  let seededBytes = 0;
  if (phase === 'seed') {
    const seeded = await evaluate(`(() => {
      const sessionId = ${JSON.stringify(sessionId)};
      const now = Date.now();
      const turns = Array.from({ length: ${turnCount} }, (_, index) => ({
        id: 'history-turn-' + index,
        prompt: index === 10
          ? ${JSON.stringify(`${earlyMarker} · early durable history search target`)}
          : 'HISTORY_E2E_PROMPT_' + index + ' · durable conversation payload',
        response: 'HISTORY_E2E_RESPONSE_' + index + ' · restored answer body ' + 'x'.repeat(96),
        error: '',
        stage: 'complete',
        createdAt: now - (${turnCount} - index) * 1000,
        completedAt: now - (${turnCount} - index) * 1000 + 500,
        permissionMode: 'full_access',
        routeLabel: 'GPT 5.6 Sol',
        executionLabel: '',
        usageLabel: ''
      }));
      const sessions = [{
        id: sessionId,
        workspacePath: ${JSON.stringify(workspacePath)},
        title: ${JSON.stringify(title)},
        turns,
        browsers: [],
        pinned: false,
        routeId: '',
        relayKey: '',
        reasoningEffort: 'xhigh',
        permissionMode: 'full_access',
        followUpQueue: [],
        viewState: {
          workContextOpen: false,
          workContextMode: 'browser',
          terminalDrawerOpen: false,
          terminalScope: 'current',
          workContextWidth: 358,
          contextFileListWidth: 218,
          terminalDrawerHeight: 264,
          terminalListWidth: 218,
          threadWasAtBottom: true,
          threadAnchorTurnId: 'history-turn-1999',
          threadAnchorOffset: 0
        },
        createdAt: now - ${turnCount} * 1000,
        updatedAt: now
      }];
      const raw = JSON.stringify(sessions);
      localStorage.setItem('nextmux.desktop.privacy.v1', JSON.stringify({
        requireZeroDataRetention: true,
        denyDataCollection: true,
        saveConversationHistory: true
      }));
      localStorage.setItem('nextmux.desktop.codingSessions.v1', raw);
      localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
        version: 1,
        section: 'coding',
        workspace: ${JSON.stringify(workspacePath)},
        codingPanel: 'thread',
        activeCodingSessionId: sessionId,
        newConversation: false,
        settingsPanel: 'profile',
        billingTab: 'usage',
        modelCenterView: 'all',
        modelCapabilityFilter: 'all',
        comicView: 'storyboard'
      }));
      return { bytes: new Blob([raw]).size, turns: turns.length };
    })()`);
    seededBytes = seeded.bytes;
    await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
  } else if (phase !== 'verify') {
    throw new Error(`Unsupported NEXTMUX_HISTORY_E2E_PHASE: ${phase}`);
  }

  const ready = await waitFor(
    readUiState,
    state => state.widget && state.current.includes('History E2E')
      && state.mirrorVersion === 2 && state.mirrorComplete === false && state.mirrorTurns === 4,
    45_000,
    'durable conversation restored with a bounded startup mirror'
  );
  const committed = await waitFor(
    async () => {
      try { return await readCommittedSession(); } catch { return undefined; }
    },
    value => value?.session?.turns?.length === turnCount,
    45_000,
    '2000-turn durable session commit'
  );
  const globalSearch = await runGlobalSearchRegression();
  const search = await runSearchRegression();
  const finalUi = await readUiState();

  const stored = committed.value.session;
  const report = {
    phase,
    seededBytes,
    startupElapsedMs: ready.elapsedMs,
    durableCommitElapsedMs: committed.elapsedMs,
    durableBytes: committed.value.bytes,
    durableTurns: stored.turns.length,
    durableFirstTurn: stored.turns[0]?.id,
    durableLastTurn: stored.turns.at(-1)?.id,
    mirrorVersion: finalUi.mirrorVersion,
    mirrorTurns: finalUi.mirrorTurns,
    mirrorBytes: finalUi.mirrorBytes,
    renderedTurns: finalUi.renderedTurns,
    renderedTimelineItems: finalUi.renderedTimelineItems,
    globalSearch: globalSearch.value,
    search: search.value,
    pass: stored.turns.length === turnCount
      && stored.turns[0]?.id === 'history-turn-0'
      && stored.turns.at(-1)?.id === 'history-turn-1999'
      && finalUi.mirrorVersion === 2
      && finalUi.mirrorComplete === false
      && finalUi.mirrorTurns === 4
      && finalUi.mirrorBytes < 2_500_000
      && finalUi.renderedTurns < 100
      && finalUi.renderedTimelineItems < 100
      && globalSearch.value.title.includes('History E2E')
      && /history-/i.test(globalSearch.value.match)
      && search.value.mounted
      && search.value.highlighted
      && search.value.renderedTurns < 100
  };
  console.log(JSON.stringify(report, undefined, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  socket.close();
}
