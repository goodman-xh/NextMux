#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { desktopText, normalizeDesktopLocale } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';
import { localizeDesktopSurface } from '../packages/theia-nextmux-extension/lib/browser/nextmux-surface-locale.js';

import {
  connectToNextMuxWorkbench,
  freePort,
  launchNextMuxDesktop,
  runInDisposableAttachmentFileDesktop,
  terminateTree,
  waitForPort,
} from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import { finishE2eRun } from './desktop-terminal-ci-e2e.mjs';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  verifyExactQaComposerRoute,
} from './desktop-official-qa-route.mjs';
import {
  assertDisposableDesktopE2E,
  assertExactAgentRunRpc,
  installWebSocketJsonRpcCapture,
  readCapturedJsonRpcFrames,
  uninstallWebSocketJsonRpcCapture,
} from './desktop-e2e-state.mjs';
import { relayMerchantNumber } from '../packages/theia-nextmux-extension/lib/browser/nextmux-relay-marketplace.js';

const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));

async function waitFor(read, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let value;
  let lastError;
  while (Date.now() < deadline) {
    try {
      value = await read();
      if (predicate(value)) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await pause(120);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}${lastError ? `; ${lastError.message}` : ''}`);
}

async function portIsOpen(port) {
  return new Promise(resolveProbe => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(400);
    socket.once('connect', () => { socket.destroy(); resolveProbe(true); });
    const closed = () => { socket.destroy(); resolveProbe(false); };
    socket.once('error', closed);
    socket.once('timeout', closed);
  });
}

async function click(evaluate, selector) {
  const clicked = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLElement) || node.matches(':disabled')) return false;
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }));
    node.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Expected an enabled element for ${selector}`);
  await pause(220);
}

async function readDurableSession(stateRoot, sessionId) {
  try {
    const root = join(stateRoot, 'conversation-history-v1');
    const manifest = JSON.parse(await readFile(join(root, 'manifest-v1.json'), 'utf8'));
    const entry = manifest.sessions?.find(candidate => candidate.id === sessionId);
    if (!entry?.file) return undefined;
    return JSON.parse(await readFile(join(root, entry.file), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function managedOffering(id, merchantId, endpointName, recommendedRank) {
  return {
    id,
    merchantId,
    providerName: 'Same relay',
    endpointName,
    modelFamily: 'GPT 5.6',
    displayName: 'GPT 5.6 Sol',
    providerModelCode: 'gpt-5.6-sol',
    category: 'coding',
    registryModelId: 'custom_openai/gpt-5.6-sol',
    canonicalModel: 'custom_openai/gpt-5.6-sol',
    sourceType: 'verified_relay',
    status: 'active',
    region: 'global',
    capabilities: ['language', 'tools', 'reasoning'],
    input: ['text'],
    output: ['text'],
    workbenches: ['coding'],
    price: {
      currency: 'USD',
      mode: 'reference_multiplier',
      multiplierBps: 10_000,
      inputPerMillionMicros: 1_000_000,
      outputPerMillionMicros: 2_000_000,
      cachedInputPerMillionMicros: null,
      imageEachMicros: null,
      videoSecondMicros: null,
      audioPerMillionCharactersMicros: null,
    },
    routeScore: 90,
    multiplierBps: 10_000,
    recommendedRank,
    recommended: true,
    merchantTrustScore: 95,
    likes: 20,
    dislikes: 1,
    fidelity: { index: 95, confidence: 'high', sampleCount: 20 },
    agentReadiness: { index: 95, level: 'ready' },
    network: { availability: 0.999, p95LatencyMs: 180, state: 'healthy' },
    privacy: { zeroDataRetention: true, dataCollection: false },
  };
}

const duplicateNamedMerchants = [
  managedOffering('offering-a', 'merchant-a', 'Primary A', 1),
  managedOffering('offering-b', 'merchant-b', 'Primary B', 2),
];

function linkedPlatformFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    requests.push(pathname);
    let payload;
    if (pathname === '/api/devices/session') {
      payload = {
        ok: true,
        linked: true,
        user: { id: 'nextmux-e2e-user', email: 'linked-e2e@nextmux.invalid', displayName: 'Linked E2E', locale: 'zh-CN' },
        wallets: [],
      };
    } else if (pathname === '/api/wallet') {
      payload = { ok: true, wallets: [], usage: [], conversations: [] };
    } else if (pathname === '/api/catalog') {
      payload = { offerings: duplicateNamedMerchants, measuredAt: new Date().toISOString() };
    } else if (pathname === '/api/models/registry') {
      payload = { models: [], nextOffset: null };
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"not found"}}');
      return;
    }
    const body = JSON.stringify(payload);
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  return { requests, server };
}

async function runRestartPersistenceRegression() {
  const { profile, state } = assertDisposableDesktopE2E();
  const firstPort = Number(process.env.NEXTMUX_CDP_PORT || 9222);
  const sessionId = randomUUID();
  const marker = `NM_TOOL_CONTRACT_E2E_${randomUUID()}`;
  const relativeFixture = `artifacts/${marker}.txt`;
  const privateRoot = join(state, 'conversation-workspaces', sessionId);
  const fixturePath = join(privateRoot, 'artifacts', `${marker}.txt`);
  const staleWorkspace = process.platform === 'win32'
    ? `Z:\\NextMux-unmounted-${sessionId}\\33`
    : `C:\\Users\\49674\\Desktop\\33-${sessionId}`;
  const firstAppExitMarker = process.env.NEXTMUX_DESKTOP_E2E_APP_EXIT_MARKER;
  assert.ok(firstAppExitMarker, 'restart regression requires the harness app-exit marker');
  const rpcCaptureKey = `__nmxRestartPersistenceRpc_${sessionId.replaceAll('-', '_')}`;
  const qaConfig = officialQaRouteConfig();
  const evidence = { sessionId, staleWorkspace, privateRoot };
  let first;
  let second;
  let platform;
  let secondProcess;
  let primaryError;

  try {
    first = await connectToNextMuxWorkbench(firstPort, 45_000);
    await Promise.all([first.call('Runtime.enable'), first.call('Page.enable')]);
    const route = await ensureExactOfficialQaRoute({ evaluate: first.evaluate, config: qaConfig });
    const now = Date.now();
    const fixture = {
      id: sessionId,
      workspacePath: staleWorkspace,
      title: `Windows 33 continuation ${sessionId.slice(0, 8)}`,
      turns: [{
        id: randomUUID(),
        userMessageId: randomUUID(),
        assistantMessageId: randomUUID(),
        prompt: 'Windows 旧项目中的已有对话',
        response: '这条历史记录必须在 Mac 上继续使用同一个 conversationId。',
        error: '',
        stage: 'complete',
        createdAt: now - 2_000,
        completedAt: now - 1_000,
        permissionMode: 'workspace_write',
        routeLabel: 'NextMux E2E',
        executionLabel: '',
        usageLabel: '',
      }],
      pinned: false,
      routeId: route.routeId,
      relayKey: route.relayKey,
      modelId: route.modelId,
      reasoningEffort: 'low',
      permissionMode: 'workspace_write',
      followUpQueue: [],
      viewState: { threadWasAtBottom: true, threadScrollTop: 0, threadAnchorTurnId: '', threadAnchorOffset: 0 },
      createdAt: now - 4_000,
      updatedAt: now,
    };

    await first.evaluate(`(() => {
      let stored = {};
      let restore = {};
      try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
      try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
      const sessions = (Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [])
        .filter(session => session?.id !== ${JSON.stringify(sessionId)});
      sessions.unshift(${JSON.stringify(fixture)});
      localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({ version: 2, complete: false, sessions }));
      localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
        ...restore,
        version: 1,
        section: 'coding',
        codingPanel: 'thread',
        activeCodingSessionId: '',
        newConversation: true
      }));
      sessionStorage.clear();
      return true;
    })()`);
    await reloadDesktopDocument({ call: first.call, evaluate: first.evaluate });
    await waitFor(
      () => first.evaluate(`Boolean(document.querySelector('.nmx-desktop-widget'))`),
      Boolean,
      20_000,
      'desktop reload after stale Windows fixture'
    );
    // Expanding a project is a real workspace selection and persists state.
    // Do not do it while complete history is still hydrating from the mirror.
    await waitFor(() => readDurableSession(state, sessionId), value => value?.id === sessionId
      && value.workspacePath === staleWorkspace && value.turns?.length === 1,
    25_000, 'stale Windows fixture durably restored before sidebar interaction');
    await waitFor(
      () => first.evaluate(`(() => {
        document.querySelectorAll('.nmx-project-row[aria-expanded="false"], .nmx-project-conversation-toggle[aria-expanded="false"]')
          .forEach(node => node.click());
        return Boolean(document.querySelector('.nmx-session-row[data-session-id="${sessionId}"] .nmx-session-open'));
      })()`),
      Boolean,
      20_000,
      'stale Windows conversation row'
    );
    await click(first.evaluate, `.nmx-session-row[data-session-id="${sessionId}"] .nmx-session-open`);
    const opened = await waitFor(
      () => first.evaluate(`(() => {
        let stored = {};
        let restore = {};
        try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
        try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
        const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
        return {
          activeId: restore.activeCodingSessionId || '',
          matchingCount: sessions.filter(session => session?.id === ${JSON.stringify(sessionId)}).length,
          workspaceLabel: document.querySelector('.nmx-session-row[data-session-id="${sessionId}"] .nmx-session-unavailable-badge')?.getAttribute('aria-label') || ''
        };
      })()`),
      value => value.activeId === sessionId && value.matchingCount === 1
        && /本机对话工作区|项目目录未挂载|local conversation workspace/i.test(value.workspaceLabel),
      12_000,
      'stale conversation opens without duplication'
    );
    evidence.opened = opened;
    await verifyExactQaComposerRoute(first.evaluate, route);
    await installWebSocketJsonRpcCapture(first.evaluate, rpcCaptureKey);

    const prompt = [
      `${marker}：继续这个 Windows 对话并验证本机私有工作区。`,
      '依次调用 workspace.list_files、workspace.write_file、workspace.read_file、workspace.apply_patch，再次读取并列出 artifacts。',
      `目标文件必须是 ${relativeFixture}。`,
    ].join('\n');
    const composed = await first.evaluate(`(() => {
      const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, ${JSON.stringify(prompt)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(composed, true, 'stale conversation composer must be editable');
    await waitFor(
      () => first.evaluate(`Boolean(document.querySelector('.nmx-send-button:not(:disabled)'))`),
      Boolean,
      5_000,
      'stale conversation send action'
    );
    await click(first.evaluate, '.nmx-send-button:not(:disabled)');
    const toolCompletion = await waitFor(
      async () => ({
        running: await first.evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`),
        file: await access(fixturePath).then(() => true, () => false),
        turn: await first.evaluate(`(() => {
          const node = [...document.querySelectorAll('.nmx-task-turn')]
            .find(candidate => (candidate.innerText || '').includes(${JSON.stringify(marker)}));
          return node ? {
            className: node.querySelector('.nmx-agent-message')?.className || '',
            text: (node.innerText || '').trim().replace(/\\s+/g, ' ')
          } : null;
        })()`),
      }),
      value => !value.running && Boolean(value.turn)
        && (value.file || /is-(?:complete|error|cancelled|paused)/.test(value.turn.className)),
      120_000,
      'tool write completes in private conversation workspace'
    );
    assert.equal(toolCompletion.file, true, `tool run did not create ${fixturePath}: ${JSON.stringify(toolCompletion.turn)}`);
    assert.match(toolCompletion.turn.className, /is-complete/);
    assert.equal(await readFile(fixturePath, 'utf8'), 'alpha\ngamma\n');
    const durable = await waitFor(
      () => readDurableSession(state, sessionId),
      value => value?.ownedWorkspace === true && value.turns?.some(turn => turn.prompt?.includes(marker)),
      25_000,
      'continued stale conversation persists durably'
    );
    const rpc = assertExactAgentRunRpc(await readCapturedJsonRpcFrames(first.evaluate, rpcCaptureKey), route, { marker });
    assert.equal(rpc.request.conversationId, sessionId, 'tool run must reuse the stale conversation ID');
    assert.equal(resolve(rpc.request.workspaceRoot), resolve(privateRoot), 'tool run must use the per-conversation workspace');
    evidence.toolRun = {
      conversationId: rpc.request.conversationId,
      workspaceRoot: rpc.request.workspaceRoot,
      durableWorkspacePath: durable.workspacePath,
      ownedWorkspace: durable.ownedWorkspace,
      content: await readFile(fixturePath, 'utf8'),
    };
    await uninstallWebSocketJsonRpcCapture(first.evaluate, rpcCaptureKey);

    const available = await first.evaluate(`({ width: screen.availWidth, height: screen.availHeight })`);
    const targetWidth = Math.max(980, Math.min(1180, Number(available.width || 1369) - 80));
    const targetHeight = Math.max(680, Math.min(760, Number(available.height || 800) - 80));
    await first.evaluate(`window.resizeTo(${targetWidth}, ${targetHeight})`);
    const sized = await waitFor(
      async () => ({ visible: await first.evaluate(`({ width: outerWidth, height: outerHeight })`) }),
      value => Math.abs(value.visible.width - targetWidth) <= 2 && Math.abs(value.visible.height - targetHeight) <= 2,
      8_000,
      'real Electron window resize'
    );
    evidence.windowBeforeRestart = sized;

    const firstSocket = first.socket;
    await Promise.race([first.evaluate(`window.close(); true`).catch(() => undefined), pause(1_000)]);
    try { firstSocket.close(); } catch { /* browser already closed */ }
    first = undefined;
    await waitFor(async () => ({
      portOpen: await portIsOpen(firstPort),
      launcherExited: await access(firstAppExitMarker).then(() => true, () => false),
    }), value => !value.portOpen && value.launcherExited, 30_000, 'first Electron process and launcher to close');
    const firstExit = JSON.parse(await readFile(firstAppExitMarker, 'utf8'));
    assert.equal(firstExit.code, 0, 'the first app must exit normally, not crash');
    assert.equal(firstExit.signal, null, 'test cleanup must not stand in for a normal close');
    evidence.firstApplicationExit = { code: firstExit.code, signal: firstExit.signal };

    const restartPort = await freePort();
    platform = linkedPlatformFixture();
    await new Promise((resolveListen, rejectListen) => {
      platform.server.once('error', rejectListen);
      platform.server.listen(0, '127.0.0.1', resolveListen);
    });
    const platformAddress = platform.server.address();
    const platformPort = typeof platformAddress === 'object' && platformAddress ? platformAddress.port : 0;
    const restartEnvironment = {
      ...process.env,
      NEXTMUX_CDP_PORT: String(restartPort),
      NEXTMUX_PLATFORM_API_URL: `http://127.0.0.1:${platformPort}`,
      NEXTMUX_PUBLIC_APP_URL: `http://127.0.0.1:${platformPort}`,
      THEIA_CONFIG_DIR: join(profile, 'theia-config'),
      ...(process.platform === 'win32' ? {
        LOCALAPPDATA: join(profile, 'local-app-data'),
        APPDATA: join(profile, 'roaming-app-data'),
      } : {
        XDG_DATA_HOME: join(profile, 'xdg-data'),
        XDG_CONFIG_HOME: join(profile, 'xdg-config'),
      }),
    };
    // The shared terminal runner keeps its first-launch logs in artifacts;
    // unlike the standalone harness it has not allocated profile/logs yet.
    await mkdir(join(profile, 'logs'), { recursive: true });
    secondProcess = launchNextMuxDesktop({
      cdpPort: restartPort,
      electronProfile: join(profile, 'electron-user-data'),
      environment: restartEnvironment,
      stdout: join(profile, 'logs', 'restart-app.stdout.log'),
      stderr: join(profile, 'logs', 'restart-app.stderr.log'),
    });
    await waitForPort(restartPort, 90_000, secondProcess);
    second = await connectToNextMuxWorkbench(restartPort, 45_000);
    await Promise.all([second.call('Runtime.enable'), second.call('Page.enable')]);
    await second.call('Page.bringToFront');

    const restoredNormal = await waitFor(
      () => second.evaluate(`({ width: outerWidth, height: outerHeight })`),
      value => Math.abs(value.width - sized.visible.width) <= 2 && Math.abs(value.height - sized.visible.height) <= 2,
      8_000,
      'saved Electron dimensions after full restart'
    );
    evidence.windowAfterRestart = {
      normal: restoredNormal,
      sizeRestored: true,
    };

    const restoredConversation = await waitFor(
      () => second.evaluate(`(() => {
        document.querySelectorAll('.nmx-project-row[aria-expanded="false"], .nmx-project-conversation-toggle[aria-expanded="false"]')
          .forEach(node => node.click());
        let stored = {};
        let restore = {};
        try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
        try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
        const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
        const session = sessions.find(candidate => candidate?.id === ${JSON.stringify(sessionId)});
        return {
          activeId: restore.activeCodingSessionId || '',
          matchingCount: sessions.filter(candidate => candidate?.id === ${JSON.stringify(sessionId)}).length,
          turnVisible: [...document.querySelectorAll('.nmx-task-turn')]
            .some(node => (node.innerText || '').includes(${JSON.stringify(marker)})),
          rowVisible: Boolean(document.querySelector('.nmx-session-row[data-session-id="${sessionId}"]')),
          ownedWorkspace: session?.ownedWorkspace === true,
          workspacePath: session?.workspacePath || '',
          workspaceLabel: document.querySelector('.nmx-session-row[data-session-id="${sessionId}"] .nmx-session-unavailable-badge')?.getAttribute('aria-label') || ''
        };
      })()`),
      value => value.activeId === sessionId && value.matchingCount === 1 && value.turnVisible
        && value.rowVisible && value.ownedWorkspace && value.workspacePath === staleWorkspace
        && /本机对话工作区|local conversation workspace/i.test(value.workspaceLabel),
      30_000,
      'same stale conversation after full Electron restart'
    );
    assert.equal(await readFile(fixturePath, 'utf8'), 'alpha\ngamma\n');
    evidence.conversationAfterRestart = { ...restoredConversation, fileStillPresent: true };

    await waitFor(
      () => second.evaluate(`Boolean(document.querySelector('.nmx-account-avatar.is-linked'))`),
      Boolean,
      20_000,
      'linked account fixture after restart'
    );
    await click(second.evaluate, '[data-desktop-section="models"]');
    const linkedModelCenter = await waitFor(
      () => second.evaluate(`(() => {
        const root = document.querySelector('.nmx-model-center');
        const topbar = document.querySelector('.nmx-model-center-topbar');
        const account = topbar?.querySelector('.nmx-primary-button');
        return {
          visible: Boolean(root),
          accountText: account?.textContent?.trim() || '',
          browserLoginVisible: /使用浏览器登录|浏览器登录|sign in with browser|browser sign-in/i.test(
            [topbar?.innerText, root?.innerText].filter(Boolean).join(' ')
          )
        };
      })()`),
      value => value.visible && Boolean(value.accountText),
      15_000,
      'linked model center account action'
    );
    assert.equal(linkedModelCenter.browserLoginVisible, false);
    const restoredLocale = normalizeDesktopLocale(await second.evaluate(`document.querySelector('.nmx-desktop-widget')?.getAttribute('lang') || document.documentElement.lang || navigator.language`));
    assert.equal(linkedModelCenter.accountText, desktopText(restoredLocale, 'recharge'));

    await click(second.evaluate, '[data-model-center-view="all"]');
    const merchantNumber = relayMerchantNumber('merchant-b');
    const duplicateMerchants = await waitFor(
      () => second.evaluate(`(() => [...document.querySelectorAll('.nmx-relay-merchant-card')]
        .map(card => ({
          name: card.querySelector('.nmx-relay-merchant-name strong')?.textContent?.trim() || '',
          number: card.getAttribute('data-merchant-number') || ''
        })).filter(card => card.name === 'Same relay'))()`),
      value => value.length === 2 && value.some(card => card.number === merchantNumber),
      15_000,
      'duplicate display names remain separate merchant cards'
    );
    await click(second.evaluate, `.nmx-relay-merchant-card[data-merchant-number="${merchantNumber}"] footer button`);
    const selectedMerchant = await waitFor(
      () => second.evaluate(`({
        relayKey: localStorage.getItem('nextmux.desktop.activeRelay.v1') || '',
        section: document.querySelector('[data-desktop-section].is-active')?.getAttribute('data-desktop-section') || '',
        pickerOpen: Boolean(document.querySelector('.nmx-model-picker-popover')),
        query: document.querySelector('.nmx-model-picker-search input')?.value || ''
      })`),
      value => value.relayKey === 'managed:merchant-b' && value.section === 'coding'
        && value.pickerOpen && value.query === merchantNumber,
      12_000,
      'exact merchantId selection from duplicate display names'
    );
    evidence.merchantSelection = { duplicateMerchants, selectedMerchant };

    await click(second.evaluate, '[data-desktop-section="models"]');
    await waitFor(
      () => second.evaluate(`Boolean(document.querySelector('.nmx-model-center-topbar .nmx-topbar-routing input:not(:checked)'))`),
      Boolean,
      8_000,
      'automatic routing is off after fixed merchant selection'
    );
    await click(second.evaluate, '.nmx-model-center-topbar .nmx-topbar-routing input');
    const automaticRouting = await waitFor(
      () => second.evaluate(`({
        relayKey: localStorage.getItem('nextmux.desktop.activeRelay.v1') || '',
        checked: Boolean(document.querySelector('.nmx-model-center-topbar .nmx-topbar-routing input:checked'))
      })`),
      value => value.relayKey === 'auto' && value.checked,
      8_000,
      'topbar automatic routing switch'
    );
    evidence.automaticRouting = automaticRouting;

    await click(second.evaluate, '.nmx-account-trigger');
    const linkedSettings = await waitFor(
      () => second.evaluate(`(() => {
        const root = document.querySelector('.nmx-settings-panel');
        return {
          action: root?.querySelector('.nmx-profile-card > button')?.textContent?.trim() || '',
          browserLoginVisible: /使用浏览器登录|浏览器登录|sign in with browser|browser sign-in/i.test(root?.innerText || '')
        };
      })()`),
      value => Boolean(value.action),
      12_000,
      'linked settings account action'
    );
    assert.equal(linkedSettings.browserLoginVisible, false);
    assert.equal(linkedSettings.action, localizeDesktopSurface(restoredLocale, '管理账户'));
    evidence.linkedAccount = {
      modelCenter: linkedModelCenter,
      settings: linkedSettings,
      sessionEndpointObserved: platform.requests.includes('/api/devices/session'),
    };
    assert.equal(evidence.linkedAccount.sessionEndpointObserved, true);

    console.log(JSON.stringify({ passed: true, evidence }, undefined, 2));
  } catch (error) {
    primaryError = error;
  } finally {
    await finishE2eRun(async () => {
    if (first) {
      await Promise.race([uninstallWebSocketJsonRpcCapture(first.evaluate, rpcCaptureKey).catch(() => undefined), pause(800)]);
      try { first.socket.close(); } catch { /* already closed */ }
    }
    if (second) {
      await Promise.race([second.evaluate(`window.close(); true`).catch(() => undefined), pause(800)]);
      try { second.socket.close(); } catch { /* already closed */ }
    }
    const cleanupResults = await Promise.allSettled([
      terminateTree(secondProcess),
      platform ? new Promise((resolveClose, rejectClose) => {
        platform.server.close(error => error ? rejectClose(error) : resolveClose());
        platform.server.closeAllConnections();
      }) : Promise.resolve(),
    ]);
    const failures = cleanupResults.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Restart regression cleanup failed');
    }, primaryError);
  }
}

if (process.env.NEXTMUX_DESKTOP_E2E_ISOLATED === '1') {
  await runRestartPersistenceRegression();
} else {
  await runInDisposableAttachmentFileDesktop(import.meta.url, {
    label: 'restart persistence regression',
    withQaRoute: true,
  });
}
