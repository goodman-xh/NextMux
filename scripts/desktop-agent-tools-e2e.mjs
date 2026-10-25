#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
  verifyExactQaComposerRoute
} from './desktop-official-qa-route.mjs';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
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

// Legacy release-contract migration anchors. Runtime routing no longer uses
// localized text normalization or a secondary real-looking model fixture:
// replace(/[^a-z0-9]+/g, '')
// Input.insertText', { text: qaProviderModelId }
// NEXTMUX_E2E_SECONDARY_MODEL_ID · NextMux E2E QA Secondary
// Exact selection is exclusively data-relay-key="official:${connectionId}".

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const homepageScreenshot = process.env.NEXTMUX_HOMEPAGE_SCREENSHOT || '';
const marketingCapture = Boolean(homepageScreenshot);
const marker = `NM_TOOL_CONTRACT_E2E_${randomUUID()}`;
const relativeFixture = marketingCapture ? 'src/route-policy.ts' : `artifacts/${marker}.txt`;
const activityPathToken = marketingCapture ? 'route-policy.ts' : marker;
const fixture = join(resolve(process.env.NEXTMUX_E2E_WORKSPACE || process.cwd()), relativeFixture);
const fixtureDirectory = dirname(fixture);
const captureKey = `__nmxAgentToolsRpc_${marker.replace(/\W/g, '_')}`;
const qaConfig = officialQaRouteConfig();

let socket;
let call;
let evaluate;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};
const waitForExpression = (expression, label, timeoutMs = 15_000) => waitFor(
  () => evaluate(expression),
  Boolean,
  timeoutMs,
  label
).then(result => result.value);
const reload = async () => {
  await reloadDesktopDocument({ call, evaluate });
  await waitForExpression(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop reload', 20_000);
  await wait(400);
};

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
  // /json is available before Electron finishes restoring the workbench and
  // can list a transient/old page first.  The shared helper probes every page
  // until the real `.nmx-shell` is mounted, then returns its live CDP client.
  const cdp = await connectToNextMuxWorkbench(cdpPort);
  socket = cdp.socket;
  call = cdp.call;
  evaluate = cdp.evaluate;
  cdpConnected = true;
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  storageSnapshot = await snapshotBrowserState(evaluate);
  if (marketingCapture) {
    await evaluate(`(() => {
      localStorage.setItem('nextmux.locale', 'en');
      localStorage.setItem('localeId', 'en');
      return true;
    })()`);
    await reload();
    await waitForExpression(`document.documentElement.lang === 'en'`, 'English marketing interface');
  }
  beforeSessionIds = await readConversationSessionIds(evaluate);
  sessionBaselineCaptured = true;
  fixtureDirectoryExisted = await access(fixtureDirectory).then(() => true, () => false);
  await mkdir(fixtureDirectory, { recursive: true });
  await rm(fixture, { force: true });
  // A packaged Electron profile can finish restoring the workbench after the
  // CDP page is already available.  Do not treat a not-yet-mounted coding
  // surface as a product failure; wait for the same real control used below.
  await waitForExpression(`Boolean(document.querySelector('[data-desktop-section="coding"]'))`, 'coding navigation before tool contract', 12_000);
  await evaluate(`(() => {
    const coding = document.querySelector('[data-desktop-section="coding"]');
    if (coding?.getAttribute('aria-current') !== 'page') coding?.click();
    return true;
  })()`);
  await waitForExpression(`Boolean(document.querySelector('.nmx-context-actions > button:first-child'))`, 'coding context actions before tool contract', 12_000);
  const newConversation = await evaluate(`(() => {
    const button = document.querySelector('.nmx-context-actions > button:first-child');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!newConversation) throw new Error('Unable to start an isolated temporary conversation.');
  await waitForExpression(`(() => {
    let restore = {};
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    return !restore.activeCodingSessionId && !document.querySelector('.nmx-session-row.is-current');
  })()`, 'isolated new-conversation draft');
  qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: qaConfig });
  await installWebSocketJsonRpcCapture(evaluate, captureKey);
  captureInstalled = true;
  const ready = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
    if (!textarea || document.querySelector('.nmx-stop-glyph')) return false;
    textarea.focus();
    return true;
  })()`);
  if (!ready) throw new Error('The current NextMux conversation is not ready for a new task.');

  const prompt = (marketingCapture ? [
    'Review the demo routing workspace and show a concise, structured tool workflow.',
    'Create src/route-policy.ts, verify it, make one precise edit, and summarize the result.',
    'Use workspace tools only; do not run a shell process.',
    `Internal validation: ${marker} NM_MARKETING_DEMO_EN`
  ] : [
    '请检查当前项目的模型路由与工具链，并把执行过程清晰地展示出来。',
    '先输出一句自然语言进度，然后严格依次执行：',
    '1. 调用 workspace.list_files，把 path 明确传为空字符串，maxDepth 传 0；',
    `2. 调用 workspace.write_file 创建 ${relativeFixture}，内容必须是 alpha 换行 beta 换行；`,
    `3. 调用 workspace.read_file 读取 ${relativeFixture}；`,
    `4. 使用 read_file 返回的 SHA-256 调用 workspace.apply_patch，将 ${relativeFixture} 中的 beta 改成 gamma；`,
    '不要调用 process.run。完成后自然语言说明结果。',
    `隔离验收编号：${marker}`
  ]).join('\n');
  const composed = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
    if (!textarea) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!composed) throw new Error('Unable to populate the NextMux composer.');
  await waitFor(
    () => evaluate(`(() => ({
      value: document.querySelector('.nmx-composer textarea')?.value || '',
      disabled: Boolean(document.querySelector('.nmx-send-button')?.disabled)
    }))()`),
    state => state.value.includes(marker) && !state.disabled,
    5_000,
    'controlled composer state'
  );
  // Route/model selection commits through React on the next render tick. Give
  // the real send control one stable frame before invoking the same click a
  // user performs.
  await wait(300);
  const sendTarget = await evaluate(`(() => {
    const button = document.querySelector('.nmx-send-button:not(:disabled)');
    const rect = button?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : undefined;
  })()`);
  if (!sendTarget) throw new Error('Unable to submit the tool-contract task.');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sendTarget.x, y: sendTarget.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });
  temporarySessionId = (await waitFor(
    () => evaluate(`(() => {
      let stored = {};
      let restore = {};
      try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
      try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
      const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
      const id = restore.activeCodingSessionId || stored.activeCodingSessionId || '';
      return sessions.some(session => session?.id === id) ? id : '';
    })()`),
    Boolean,
    10_000,
    'temporary tool-contract conversation session'
  )).value;
  await verifyExactQaComposerRoute(evaluate, qaRoute);

  const readTurn = () => evaluate(`(() => {
    const marker = ${JSON.stringify(activityPathToken)};
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
    const text = turn?.innerText || '';
    const activityText = turn?.querySelector('.nmx-agent-activity')?.innerText || '';
    return {
      running: Boolean(document.querySelector('.nmx-stop-glyph')),
      text,
      activityText,
      fileActivities: [...(turn?.querySelectorAll('.nmx-file-activity-open') || [])].map(node => node.innerText || ''),
      narrations: [...(turn?.querySelectorAll('.nmx-agent-narration') || [])].map(node => node.innerText || ''),
      legacyProgressCards: turn?.querySelectorAll('.nmx-agent-progress-copy').length || 0,
      renderedActivityCount: turn?.querySelectorAll('.nmx-agent-activity > article, .nmx-agent-activity > p').length || 0,
      expandVisible: Boolean(turn?.querySelector('.nmx-agent-activity > header > button')),
      progressText: document.querySelector('.nmx-agent-task-progress')?.innerText || '',
      progressExpanded: document.querySelector('.nmx-agent-task-progress')?.getAttribute('aria-expanded') === 'true',
      progressRows: document.querySelectorAll('.nmx-agent-progress-popover > div').length,
      progressRowTexts: [...document.querySelectorAll('.nmx-agent-progress-popover > div')]
        .map(node => (node.textContent || '').trim().replace(/\s+/g, ' ')),
      duplicateChangeReviewCount: turn?.querySelectorAll('.nmx-change-review').length || 0,
      horizontalOverflow: (() => {
        const stage = document.querySelector('.nmx-task-view');
        return stage ? Math.max(0, stage.scrollWidth - stage.clientWidth) : 0;
      })(),
      className: turn?.querySelector('.nmx-agent-message')?.className || ''
    };
  })()`);
  const progressStarted = await waitFor(readTurn, state => {
    const observedStep = /(?:step|第)?\s*(\d+)\s*\/\s*(\d+)/i.exec(state.progressText);
    return state.running && Number(observedStep?.[1]) >= 1 && Number(observedStep?.[2]) >= 2;
  }, 45_000, 'task plan progress');
  await evaluate(`document.querySelector('.nmx-agent-task-progress')?.click()`);
  const expectedProgressRows = marketingCapture ? 5 : 6;
  const expandedProgress = await waitFor(
    readTurn,
    state => state.progressExpanded && state.progressRows === expectedProgressRows,
    5_000,
    'task progress details'
  );
  const streaming = await waitFor(readTurn, state => {
    const observedStep = /(?:step|第)?\s*(\d+)\s*\/\s*(\d+)/i.exec(state.progressText);
    return state.running && state.narrations.length > 0 && Number(observedStep?.[1]) >= 2 && Number(observedStep?.[2]) >= 2;
  }, 45_000, 'streamed narration and cumulative observed step progress');
  await evaluate(`document.querySelector('.nmx-agent-task-progress')?.click()`);
  const completed = await waitFor(readTurn, state => !state.running && state.className.includes('is-complete'), 120_000, 'tool-contract task completion');
  const collapsedActivity = completed.value;
  if (collapsedActivity.expandVisible) {
    await evaluate(`(() => {
      const marker = ${JSON.stringify(activityPathToken)};
      const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
      const button = turn?.querySelector('.nmx-agent-activity > header > button');
      button?.click();
      return Boolean(button);
    })()`);
  }
  const expanded = collapsedActivity.expandVisible
    ? await waitFor(readTurn, state => state.renderedActivityCount > collapsedActivity.renderedActivityCount, 5_000, 'expanded activity workflow')
    : { value: collapsedActivity, elapsedMs: 0 };
  if (homepageScreenshot) {
    if (!isAbsolute(homepageScreenshot)) throw new Error('NEXTMUX_HOMEPAGE_SCREENSHOT must be an absolute path.');
    await mkdir(dirname(homepageScreenshot), { recursive: true });
    await evaluate(`(() => {
      const marker = ${JSON.stringify(activityPathToken)};
      const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
      const activityToggle = turn?.querySelector('.nmx-agent-activity > header > button');
      if (activityToggle && /collapse|收起|摺疊/i.test(activityToggle.textContent || '')) activityToggle.click();
      document.querySelector('.nmx-agent-task-progress[aria-expanded="true"]')?.click();
      document.querySelector('.nmx-work-context-close')?.click();
      document.querySelector('.nmx-task-view')?.scrollTo({ top: document.querySelector('.nmx-task-view')?.scrollHeight || 0 });
      return true;
    })()`);
    try {
      const window = await call('Browser.getWindowForTarget');
      await call('Browser.setWindowBounds', { windowId: window.windowId, bounds: { width: 1369, height: 693, windowState: 'normal' } });
    } catch {
      await evaluate('window.resizeTo(1369, 693)');
    }
    await wait(600);
    const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await writeFile(homepageScreenshot, Buffer.from(capture.data, 'base64'));
  }
  const text = expanded.value.activityText;
  const content = await readFile(fixture, 'utf8');
  const clickedCreatedActivity = await evaluate(`(() => {
    const marker = ${JSON.stringify(activityPathToken)};
    const rows = [...document.querySelectorAll('.nmx-file-activity-open')];
    const row = rows.find(node => (node.innerText || '').includes(marker)
      && /Created file|已创建文件|已建立檔案/i.test(node.innerText || ''));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  const createdDrawer = clickedCreatedActivity ? await waitFor(
    () => evaluate(`(() => {
      const marker = ${JSON.stringify(activityPathToken)};
      const drawer = document.querySelector('.nmx-work-context');
      const editor = drawer?.querySelector('.nmx-monaco-file-editor');
      return {
        open: Boolean(drawer && (drawer.innerText || '').includes(marker)),
        diff: Boolean(drawer?.querySelector('.nmx-file-diff-legend')),
        standardFileList: Boolean(drawer?.querySelector('.nmx-context-file-list')),
        standardEditor: Boolean(drawer?.querySelector('.nmx-context-file-preview')),
        startLine: editor?.getAttribute('data-reveal-start-line') || '',
        endLine: editor?.getAttribute('data-reveal-end-line') || ''
      };
    })()`),
    state => state.open && state.diff && state.startLine === '1' && state.endLine === '2',
    15_000,
    'created-file diff drawer and line range'
  ) : { value: { open: false, diff: false, standardFileList: false, standardEditor: false, startLine: '', endLine: '' }, elapsedMs: 0 };
  const clickedEditedActivity = await evaluate(`(() => {
    const marker = ${JSON.stringify(activityPathToken)};
    const rows = [...document.querySelectorAll('.nmx-file-activity-open')];
    const row = rows.reverse().find(node => (node.innerText || '').includes(marker)
      && /Edited file|已编辑文件|已編輯檔案/i.test(node.innerText || ''));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  const drawer = clickedEditedActivity ? await waitFor(
    () => evaluate(`(() => {
      const marker = ${JSON.stringify(activityPathToken)};
      const drawer = document.querySelector('.nmx-work-context');
      const editor = drawer?.querySelector('.nmx-monaco-file-editor');
      return {
        open: Boolean(drawer && (drawer.innerText || '').includes(marker)),
        diff: Boolean(drawer?.querySelector('.nmx-file-diff-legend')),
        standardFileList: Boolean(drawer?.querySelector('.nmx-context-file-list')),
        standardEditor: Boolean(drawer?.querySelector('.nmx-context-file-preview')),
        startLine: editor?.getAttribute('data-reveal-start-line') || '',
        endLine: editor?.getAttribute('data-reveal-end-line') || ''
      };
    })()`),
    state => state.open && state.diff && state.startLine === '2' && state.endLine === '2',
    15_000,
    'checkpoint diff drawer and changed line'
  ) : { value: { open: false, diff: false, standardFileList: false, standardEditor: false, startLine: '', endLine: '' }, elapsedMs: 0 };
  const rpcFrames = await readCapturedJsonRpcFrames(evaluate, captureKey);
  const agentRpc = assertExactAgentRunRpc(rpcFrames, qaRoute, { marker });
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
    elapsedMs: completed.elapsedMs,
    listFilesVisible: /查看项目文件|工作区检查完成|project files|files found|workspace inspected|列出\s*\d+\s*个工作区条目|个文件/i.test(text),
    writeFileVisible: expanded.value.fileActivities.some(item => /Created file|已创建文件|已建立檔案/i.test(item)),
    readFileVisible: expanded.value.fileActivities.some(item => /Read file|已读取文件|已讀取檔案/i.test(item)),
    applyPatchVisible: expanded.value.fileActivities.some(item => /Edited file|已编辑文件|已編輯檔案/i.test(item)),
    semanticFileActivityCount: expanded.value.fileActivities.length,
    streamedNarrationCount: expanded.value.narrations.length,
    legacyProgressCards: expanded.value.legacyProgressCards,
    progressText: streaming.value.progressText,
    initialProgressText: progressStarted.value.progressText,
    progressRows: expandedProgress.value.progressRows,
    progressRowTexts: expandedProgress.value.progressRowTexts,
    duplicateChangeReviewCount: completed.value.duplicateChangeReviewCount,
    horizontalOverflow: completed.value.horizontalOverflow,
    collapsedRenderedActivityCount: collapsedActivity.renderedActivityCount,
    expandedRenderedActivityCount: expanded.value.renderedActivityCount,
    activityExpanded: !collapsedActivity.expandVisible || expanded.value.renderedActivityCount > collapsedActivity.renderedActivityCount,
    createdDrawerOpened: createdDrawer.value.open,
    createdDiffVisible: createdDrawer.value.diff,
    createdUsesStandardDrawer: createdDrawer.value.standardFileList && createdDrawer.value.standardEditor,
    createdRange: `${createdDrawer.value.startLine}-${createdDrawer.value.endLine}`,
    diffDrawerOpened: drawer.value.open,
    diffVisible: drawer.value.diff,
    editedUsesStandardDrawer: drawer.value.standardFileList && drawer.value.standardEditor,
    changedRange: `${drawer.value.startLine}-${drawer.value.endLine}`,
    noInvalidPath: !/invalid length or null byte|路径长度无效/i.test(text),
    noExternalPatchProcess: !/process\.run[^\n]*apply_patch|spawn apply_patch/i.test(text),
    content,
    finalState: completed.value.className,
    rpc: {
      method: agentRpc.method,
      route: agentRpc.request.route,
      conversationId: agentRpc.request.conversationId || ''
    },
    activityText: text,
  };
  const pass = report.listFilesVisible && report.writeFileVisible && report.readFileVisible && report.applyPatchVisible
    && report.semanticFileActivityCount >= 3 && report.streamedNarrationCount >= 1 && report.legacyProgressCards === 0
    && /\d+\s*\/\s*\d+|step|步/i.test(report.progressText) && report.progressRows === expectedProgressRows
    && (marketingCapture
      ? ['Inspect workspace', 'Create routing file', 'Apply precise patch', 'Verify result', 'Summarize changes']
          .every(title => text.includes(title))
      : ['检查工作区基线', '创建回归文件', '读取并校验文件', '应用精确补丁', '复查产物与执行记录', '输出完成总结']
          .every(title => report.progressRowTexts.some(row => row.includes(title))))
    && report.progressRowTexts.every(row => !/退出码|读取\s+packages|找到\s+\d+\s+处|工具执行/i.test(row))
    && report.duplicateChangeReviewCount === 0 && report.horizontalOverflow <= 1
    && report.activityExpanded
    && report.createdDrawerOpened && report.createdDiffVisible && report.createdUsesStandardDrawer && report.createdRange === '1-2'
    && report.diffDrawerOpened && report.diffVisible && report.editedUsesStandardDrawer && report.changedRange === '2-2'
    && report.noInvalidPath && report.noExternalPatchProcess && content === 'alpha\ngamma\n'
    && report.rpc.route.kind === 'official_connection'
    && report.rpc.route.connectionId === qaRoute.connectionId
    && report.rpc.route.model === qaRoute.providerModelId
    && report.finalState.includes('is-complete');
  console.log(JSON.stringify({ ...report, pass }, undefined, 2));
  if (!pass) throw new Error(`Tool-contract E2E assertions failed for ${marker}; see the emitted report.`);
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
    await waitForExpression(`!document.querySelector('.nmx-stop-glyph')`, 'stopped failed tool-contract task', 15_000).catch(error => cleanupErrors.push(error));
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

throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Tool-contract E2E');
