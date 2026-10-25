#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
  verifyExactQaComposerRoute
} from './desktop-official-qa-route.mjs';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import { localizeDesktopSurface } from '../packages/theia-nextmux-extension/lib/browser/nextmux-surface-locale.js';
import { normalizeDesktopLocale } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';
import {
  assertExactAgentRunRpc,
  assertDisposableDesktopE2E,
  deleteActiveTemporaryConversation,
  installWebSocketJsonRpcCapture,
  readCapturedJsonRpcFrames,
  readConversationSessionIds,
  resolveUniqueNewConversationId,
  restoreBrowserState,
  snapshotBrowserState,
  throwPrimaryOrCleanupErrors,
  uninstallWebSocketJsonRpcCapture
} from './desktop-e2e-state.mjs';

assertDisposableDesktopE2E();

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const qaConfig = officialQaRouteConfig();
const qaPort = qaConfig.port;
const stamp = randomUUID();
const marker = `NM_AGENT_DELEGATION_E2E_${stamp}`;
const childMarker = `NM_AGENT_DELEGATION_CHILD_E2E_${stamp}`;
const childResultMarker = `NM_AGENT_DELEGATION_CHILD_RESULT_${stamp}`;
const childContinuationMarker = `NM_AGENT_DELEGATION_CHILD_CONTINUE_E2E_${stamp}`;
const failureMarker = `NM_AGENT_DELEGATION_FAILURE_E2E_${stamp}`;
const relativeFixture = `artifacts/${marker}.txt`;
const fixture = join(process.cwd(), relativeFixture);
const fixtureDirectory = dirname(fixture);
const captureKey = `__nmxAgentDelegationRpc_${marker.replace(/\W/g, '_')}`;
const expectedFixture = `${marker}\nparent-resumed-after-child\n`;
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(40);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};
const waitForExpression = (expression, label, timeoutMs = 15_000) => waitFor(
  () => evaluate(expression), Boolean, timeoutMs, label
).then(result => result.value);
const reload = async () => {
  await reloadDesktopDocument({ call, evaluate });
  await waitForExpression(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop reload', 20_000);
  await wait(400);
};

const readTurn = () => evaluate(`(() => {
  const marker = ${JSON.stringify(marker)};
  const turn = [...document.querySelectorAll('.nmx-task-turn')]
    .find(node => (node.innerText || '').includes(marker));
  const activities = [...(turn?.querySelectorAll('.nmx-agent-operation') || [])].map(node => ({
    className: node.className || '',
    summary: (node.querySelector('summary')?.textContent || node.querySelector('strong')?.textContent || '').trim(),
    details: (node.querySelector('details p')?.textContent || node.innerText || '').trim()
  }));
  const childLinks = [...(turn?.querySelectorAll('.nmx-agent-child-link') || [])].map(node => ({
    id: node.getAttribute('data-agent-child-id') || '',
    title: node.getAttribute('title') || '',
    text: (node.innerText || '').trim(),
    className: node.className || ''
  }));
  return {
    running: Boolean(document.querySelector('.nmx-stop-glyph')),
    className: turn?.querySelector('.nmx-agent-message')?.className || '',
    text: turn?.innerText || '',
    activities,
    childLinks
  };
})()`);

let storageSnapshot;
let qaRoute;
let temporarySessionId = '';
let beforeSessionIds = [];
let sessionBaselineCaptured = false;
let fixtureDirectoryExisted = true;
let captureInstalled = false;
let cdpConnected = false;
let primaryError;
const cleanupErrors = [];
try {
  cdpConnected = true;
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  storageSnapshot = await snapshotBrowserState(evaluate);
  beforeSessionIds = await readConversationSessionIds(evaluate);
  sessionBaselineCaptured = true;
  fixtureDirectoryExisted = await access(fixtureDirectory).then(() => true, () => false);
  await mkdir(fixtureDirectory, { recursive: true });
  await rm(fixture, { force: true });
  // The desktop suite intentionally reuses one Electron instance.  A prior
  // flow may leave the restored surface on Model center or Settings, where
  // the coding context actions are not mounted.  Navigate through the real
  // product control instead of assuming the previous flow's panel survived.
  await waitForExpression(`Boolean(document.querySelector('[data-desktop-section="coding"]'))`, 'coding navigation before delegation', 12_000);
  await evaluate(`(() => {
    const coding = document.querySelector('[data-desktop-section="coding"]');
    if (coding?.getAttribute('aria-current') !== 'page') coding?.click();
    return true;
  })()`);
  await waitForExpression(`Boolean(document.querySelector('.nmx-context-actions'))`, 'coding context actions before delegation', 12_000);
  const initial = await readTurn();
  if (initial.running) throw new Error('NextMux is already running another task.');
  const newConversation = await evaluate(`(() => {
    const button = document.querySelector('.nmx-context-actions > button:first-child');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!newConversation) throw new Error('Unable to start an isolated temporary delegation conversation.');
  await waitForExpression(`(() => {
    let restore = {};
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    return !restore.activeCodingSessionId && !document.querySelector('.nmx-session-row.is-current');
  })()`, 'isolated delegation conversation draft');
  qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: qaConfig });
  await installWebSocketJsonRpcCapture(evaluate, captureKey);
  captureInstalled = true;

  const permissionLocale = normalizeDesktopLocale(await evaluate(`document.querySelector('.nmx-desktop-widget')?.getAttribute('lang') || document.documentElement.lang || navigator.language`));
  const workspacePermissionLabel = localizeDesktopSurface(permissionLocale, '工作区写入');
  const permission = await evaluate(`document.querySelector('.nmx-permission-button')?.textContent?.trim() || ''`);
  if (permission !== workspacePermissionLabel) {
    await evaluate(`document.querySelector('.nmx-permission-button')?.click()`);
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-permission-popover button:nth-of-type(2)'))`),
      Boolean,
      5_000,
      'workspace-write permission option'
    );
    await evaluate(`document.querySelector('.nmx-permission-popover button:nth-of-type(2)')?.click()`);
    await waitFor(
      () => evaluate(`(document.querySelector('.nmx-permission-button')?.textContent?.trim() || '') === ${JSON.stringify(workspacePermissionLabel)}`),
      Boolean,
      5_000,
      'workspace-write permission applied'
    );
  }

  const ready = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
    if (!textarea || document.querySelector('.nmx-stop-glyph')) return false;
    textarea.focus();
    textarea.select?.();
    return true;
  })()`);
  if (!ready) throw new Error('The coding composer is not ready for the delegation task.');

  const prompt = [
    `${marker}：请处理一次真实的父子 Agent 交接。`,
    `父 Agent 必须先调用 agent.delegate，让子 Agent 独立调用模型，并且只能用受限的 workspace.list_files 工具读取项目根目录。子任务标记为 ${childMarker}，结果必须包含 ${childResultMarker}。`,
    `子 Agent 返回后，父 Agent 继续使用 workspace.write_file 在 ${relativeFixture} 写入临时验收内容，再用 workspace.read_file 复查。`,
    `随后再发起一个可预期失败的子任务 ${failureMarker}，验证失败不会阻止父 Agent 总结。`,
    '最终总结需要说明子 Agent 结果、父 Agent 继续操作、权限未提升和任务已清理。'
  ].join('\n');
  await call('Input.insertText', { text: prompt });
  await evaluate(`document.querySelector('.nmx-send-button')?.click()`);
  temporarySessionId = (await waitFor(
    () => evaluate(`(() => {
      let stored = {};
      let restore = {};
      try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
      try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
      const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
      const id = restore.activeCodingSessionId || stored.activeCodingSessionId || '';
      return sessions.some(session => session?.id === id) ? id : '';
    })()`), Boolean, 10_000, 'temporary delegation conversation session'
  )).value;
  await verifyExactQaComposerRoute(evaluate, qaRoute);

  const childStarted = await waitFor(
    readTurn,
    state => state.running && state.activities.some(activity => activity.className.includes('is-running')
      && activity.summary.includes(childMarker)),
    30_000,
    'successful child-agent start event'
  );
  const childCompleted = await waitFor(
    readTurn,
    state => state.activities.some(activity => !activity.className.includes('is-running')
      && activity.details.includes(childResultMarker)),
    30_000,
    'successful child-agent completion event'
  );
  const parentContinued = await waitFor(
    readTurn,
    state => state.activities.some(activity => activity.details.includes(relativeFixture.split('/').at(-1))),
    20_000,
    'parent artifact operation after child result'
  );
  const failedChildStarted = await waitFor(
    readTurn,
    // A failed child can legitimately traverse running -> failed between two
    // 40 ms polls.  The durable child link is the product contract: it keeps
    // the task and terminal status visible even after the transient spinner is
    // gone, and proves that the child actually entered the parent's journal.
    state => state.running && state.childLinks.some(child => child.title.includes(failureMarker)
      || child.text.includes(failureMarker)),
    30_000,
    'failed child-agent lifecycle entry'
  );
  const final = (await waitFor(
    readTurn,
    state => !state.running && state.className.includes('is-complete')
      && state.activities.some(activity => activity.className.includes('is-error')),
    45_000,
    'parent completion after child-agent failure'
  )).value;
  // Child completion is intentionally rendered in the conversation as a
  // compact link and opened in the right-hand Agent drawer.  Verify the
  // production interaction instead of looking for the child's private result
  // in the parent's low-level activity rows.
  const childLinkOpened = await evaluate(`(() => {
    const link = [...document.querySelectorAll('.nmx-agent-child-link')]
      .find(node => (node.getAttribute('title') || node.innerText || '').includes(${JSON.stringify(childResultMarker)}));
    if (!(link instanceof HTMLButtonElement)) return false;
    link.click();
    return true;
  })()`);
  if (!childLinkOpened) throw new Error('Completed child-agent link is not available in the parent conversation.');
  const childPanel = await waitForExpression(`Boolean(document.querySelector('.nmx-agent-child-detail')
    && (document.querySelector('.nmx-agent-child-result')?.innerText || '').includes(${JSON.stringify(childResultMarker)}))`,
    'completed child-agent result in the Agent drawer', 10_000);

  // The Agent and Browser drawers are two views of the same work context.  The
  // cross-links must perform a real tab switch (not merely change an aria
  // label), and switching back must preserve the selected child detail.
  const agentToBrowser = await evaluate(`(() => {
    const button = document.querySelector('.nmx-agent-open-browser');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!agentToBrowser) throw new Error('Agent drawer does not expose its Browser entry point.');
  await waitForExpression(`Boolean(document.querySelector('#nmx-context-panel-browser')
    && document.querySelector('.nmx-browser-open-agents'))`,
    'Browser drawer after Agent cross-link', 10_000);
  const browserToAgent = await evaluate(`(() => {
    const button = document.querySelector('.nmx-browser-open-agents');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!browserToAgent) throw new Error('Browser drawer does not expose its Agent entry point.');
  await waitForExpression(`Boolean(document.querySelector('#nmx-context-panel-agents .nmx-agent-child-detail')
    && (document.querySelector('.nmx-agent-child-result')?.innerText || '').includes(${JSON.stringify(childResultMarker)}))`,
    'Agent drawer after Browser cross-link', 10_000);

  let continuationComposerReady;
  try {
    continuationComposerReady = await waitForExpression(`Boolean(document.querySelector('.nmx-agent-child-composer textarea:not(:disabled)'))`,
      'child-agent continuation composer', 10_000);
  } catch (error) {
    const diagnostic = await evaluate(`(() => {
      const detail = document.querySelector('.nmx-agent-child-detail');
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
      const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
      const children = sessions.flatMap(session => (session?.turns || []).flatMap(turn => turn?.childAgents || []));
      const visible = [...document.querySelectorAll('.nmx-agent-child-tab')].map(node => ({
        id: node.getAttribute('data-agent-child-tab') || '', text: (node.innerText || '').trim()
      }));
      return {
        detailText: (detail?.innerText || '').slice(0, 4_000),
        visible,
        childState: children.map(child => ({
          childRunId: child?.childRunId || '', status: child?.status || '',
          result: child?.result ? {
            runId: child.result.runId || '', status: child.result.status || '',
            resumeCheckpointId: child.result.resumeCheckpointId || '',
            checkpointError: child.result.checkpointError || null
          } : null,
          error: child?.error ? {
            code: child.error.code || '', resumeCheckpointId: child.error.resumeCheckpointId || ''
          } : null,
          checkpointError: child?.checkpointError || null
        }))
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)} Diagnostic: ${JSON.stringify(diagnostic)}`);
  }
  if (!continuationComposerReady) throw new Error('Completed child-agent did not expose its continuation composer.');
  const continuationPrompt = `${marker} ${childMarker} ${childContinuationMarker}：请保留当前子任务上下文，直接返回这个续接标记。`;
  await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-agent-child-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    textarea.focus();
    return true;
  })()`);
  await call('Input.insertText', { text: continuationPrompt });
  await waitForExpression(`Boolean(document.querySelector('.nmx-agent-child-composer button:not(:disabled)'))`,
    'child-agent continuation input committed', 5_000);
  await evaluate(`document.querySelector('.nmx-agent-child-composer button')?.click()`);
  // A 120 ms local model may finish between CDP round trips. The unique new
  // result plus the fixture's model-call receipt still proves real execution.
  const continuationProgress = await waitForExpression(`(() => {
    if (document.querySelector('.nmx-agent-child-composer .nmx-agent-child-send.is-stop')) return 'running';
    if ((document.querySelector('.nmx-agent-child-result')?.innerText || '').includes(${JSON.stringify(childContinuationMarker)})) return 'completed';
    return false;
  })()`, 'child-agent continuation running or completed', 15_000);
  const continuationCompleted = await waitForExpression(`(document.querySelector('.nmx-agent-child-result')?.innerText || '').includes(${JSON.stringify(childContinuationMarker)})`,
    'child-agent continuation result', 30_000);

  const [fixtureContent, qaStateResponse] = await Promise.all([
    readFile(fixture, 'utf8'),
    fetch(`http://127.0.0.1:${qaPort}/__nextmux_qa/delegation?marker=${encodeURIComponent(marker)}`)
  ]);
  if (!qaStateResponse.ok) throw new Error(`Delegation QA state returned HTTP ${qaStateResponse.status}.`);
  const qaState = await qaStateResponse.json();
  const rpcFrames = await readCapturedJsonRpcFrames(evaluate, captureKey);
  const agentRpc = assertExactAgentRunRpc(rpcFrames, qaRoute, { marker });
  if (agentRpc.request.permissionMode !== 'workspace_write') throw new Error('Delegation request must retain workspace-write permission');
  const delegateRows = final.activities.filter(activity => /\u5b50任务|child|delegat/i.test(`${activity.summary} ${activity.details}`));
  const report = {
    marker,
    qaRoute: {
      connectionId: qaRoute.connectionId,
      connectionLabel: qaRoute.connectionLabel,
      endpoint: qaRoute.endpoint,
      modelId: qaRoute.modelId,
      relayKey: qaRoute.relayKey,
      routeId: qaRoute.routeId
    },
    childStartedAfterMs: childStarted.elapsedMs,
    childCompletedAfterMs: childCompleted.elapsedMs,
    parentContinuedAfterMs: parentContinued.elapsedMs,
    failedChildStartedAfterMs: failedChildStarted.elapsedMs,
    childStartVisible: true,
    childCompletionVisible: Boolean(childPanel),
    agentBrowserCrossLink: Boolean(agentToBrowser && browserToAgent),
    childContinuationStarted: Boolean(continuationProgress),
    childContinuationRunningObserved: continuationProgress === 'running',
    childContinuationVisible: Boolean(continuationCompleted),
    childContinuationCalls: Number(qaState.childContinuationCalls || 0),
    childFailureVisible: final.activities.some(activity => activity.className.includes('is-error'))
      && final.childLinks.some(child => child.title.includes(failureMarker) || child.text.includes(failureMarker)),
    parentReceivedChildResult: qaState.parentReceivedChildResult === true,
    parentContinuedWithArtifact: fixtureContent === expectedFixture && qaState.parentArtifactVerified === true,
    permissionCouldNotElevate: qaState.childPermissionRequest === 'full_access'
      && qaState.childWorkspaceListExposed === true
      && qaState.childProcessToolExposed === false
      && qaState.childWriteToolExposed === false,
    childCalledModelIndependently: Number(qaState.childModelCalls) >= 2,
    noResidualChildProcesses: qaState.activeChildModelRuns === 0
      && qaState.childProcessToolCalls === 0
      && !final.running
      && !final.activities.some(activity => activity.className.includes('is-running')),
    rpc: {
      method: agentRpc.method,
      route: agentRpc.request.route,
      conversationId: agentRpc.request.conversationId || ''
    },
    delegateRows,
    finalText: final.text,
    qaState,
  };
  report.pass = report.childStartVisible
    && report.childCompletionVisible
    && report.agentBrowserCrossLink
    && report.childContinuationStarted
    && report.childContinuationVisible
    && report.childContinuationCalls >= 1
    && report.childFailureVisible
    && report.parentReceivedChildResult
    && report.parentContinuedWithArtifact
    && report.permissionCouldNotElevate
    && report.childCalledModelIndependently
    && report.noResidualChildProcesses
    && report.rpc.route.kind === 'official_connection'
    && report.rpc.route.connectionId === qaRoute.connectionId
    && report.rpc.route.model === qaRoute.providerModelId
    && final.text.includes(marker)
    && final.text.includes(childResultMarker);
  console.log(JSON.stringify(report, undefined, 2));
  if (!report.pass) throw new Error(`Delegation E2E assertions failed for ${marker}; see the emitted report.`);
} catch (error) {
  primaryError = error;
} finally {
  if (cdpConnected && captureInstalled) await uninstallWebSocketJsonRpcCapture(evaluate, captureKey).catch(error => cleanupErrors.push(error));
  let running = false;
  if (cdpConnected) {
    try {
      running = await evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (running) {
    await evaluate(`document.querySelector('.nmx-stop-button, .nmx-send-button')?.click()`).catch(error => cleanupErrors.push(error));
    await waitForExpression(`!document.querySelector('.nmx-stop-glyph')`, 'stopped failed delegation task', 15_000).catch(error => cleanupErrors.push(error));
  }
  let cleanupSessionId = temporarySessionId;
  if (!cleanupSessionId && cdpConnected && sessionBaselineCaptured) {
    try {
      cleanupSessionId = await resolveUniqueNewConversationId(evaluate, beforeSessionIds);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cdpConnected && cleanupSessionId) {
    if (beforeSessionIds.includes(cleanupSessionId)) {
      cleanupErrors.push(new Error(`Refusing to delete pre-existing conversation session ${cleanupSessionId}.`));
    } else await deleteActiveTemporaryConversation({ evaluate, sessionId: cleanupSessionId, waitFor: waitForExpression })
      .catch(error => cleanupErrors.push(error));
  }
  if (cdpConnected && qaRoute) await removeExactOfficialQaRoute({ evaluate, route: qaRoute }).catch(error => cleanupErrors.push(error));
  if (cdpConnected && storageSnapshot) await restoreBrowserState({ evaluate, snapshot: storageSnapshot, reload }).catch(error => cleanupErrors.push(error));
  await rm(fixture, { force: true }).catch(error => cleanupErrors.push(error));
  if (!fixtureDirectoryExisted) await rmdir(fixtureDirectory).catch(error => {
    if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') cleanupErrors.push(error);
  });
  if (socket) {
    try { socket.close(); } catch (error) { cleanupErrors.push(error); }
  }
}

throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Delegation E2E');
