#!/usr/bin/env node

import { join } from 'node:path';
import { ConversationStore } from '../packages/theia-nextmux-extension/lib/node/nextmux-conversation-store.js';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
  verifyExactQaComposerRoute,
} from './desktop-official-qa-route.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const marker = `NM_SCROLL_LIFECYCLE_${Date.now()}`;
const fixtureId = `nmx-scroll-e2e-${Date.now()}`;
const alternateFixtureId = `${fixtureId}-alternate`;
const fixtureTitle = `NM scroll E2E ${Date.now()}`;
const alternateFixtureTitle = `${fixtureTitle} alternate`;
const desktopStateDirectory = process.env.NEXTMUX_DESKTOP_STATE_DIR || '';
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

const readStage = () => evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  if (!stage) return null;
  const bounds = stage.getBoundingClientRect();
  const turns = [...stage.querySelectorAll('.nmx-task-turn')];
  const anchor = turns.find(turn => turn.getBoundingClientRect().bottom > bounds.top + 2);
  return {
    top: stage.scrollTop,
    height: stage.clientHeight,
    total: stage.scrollHeight,
    distance: stage.scrollHeight - stage.scrollTop - stage.clientHeight,
    anchorId: anchor?.dataset.turnId || '',
    anchorOffset: anchor ? Math.round(anchor.getBoundingClientRect().top - bounds.top) : 0,
    toBottom: Boolean(document.querySelector('.nmx-thread-to-bottom')),
    unseen: Boolean(document.querySelector('.nmx-thread-to-bottom.has-unseen')),
  };
})()`);

let qaRoute;
try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  if (!desktopStateDirectory) throw new Error('The E2E runner must expose its isolated desktop state directory.');
  qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: officialQaRouteConfig() });

  // This regression must not depend on earlier scripts having produced enough
  // history. Clone only the active session's route/profile settings and seed a
  // disposable, deterministic long conversation in the isolated test store.
  const seed = await evaluate(`(() => {
    const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
    const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
    const currentId = document.querySelector('.nmx-session-row.is-current')?.getAttribute('data-session-id') || '';
    const base = sessions.find(session => session.id === currentId) || sessions[0];
    const workspacePath = base?.workspacePath || ${JSON.stringify(process.env.NEXTMUX_E2E_WORKSPACE || '')};
    if (!workspacePath) return null;
    return {
      workspacePath,
      // The fixture must use the route created by this E2E run. A preceding
      // flow may leave an unrelated conversation selected; cloning that
      // conversation's route makes the aggregate suite order-dependent and
      // can accidentally exercise a stale provider instead of localhost QA.
      routeId: ${JSON.stringify(qaRoute.routeId)},
      relayKey: ${JSON.stringify(qaRoute.relayKey)},
      modelId: ${JSON.stringify(qaRoute.modelId)},
      reasoningEffort: base?.reasoningEffort || 'medium',
      permissionMode: base?.permissionMode || 'workspace_write'
    };
  })()`);
  if (!seed) throw new Error('The isolated desktop workspace is required to seed the scroll fixture.');
  const fixtureNow = Date.now();
  const fixturePermissionMode = 'full_access';
  const fixtureTurns = Array.from({ length: 48 }, (_, index) => ({
    id: `${fixtureId}-turn-${index + 1}`,
    prompt: `Scroll fixture user message ${index + 1}: preserve this historical viewport while new output arrives.`,
    response: `Scroll fixture assistant response ${index + 1}: deterministic content for virtual-list height and anchor restoration.`,
    error: '',
    stage: 'complete',
    createdAt: fixtureNow - (48 - index) * 2_000,
    completedAt: fixtureNow - (48 - index) * 2_000 + 500,
    permissionMode: fixturePermissionMode,
    routeLabel: 'E2E fixture',
    executionLabel: '',
    usageLabel: ''
  }));
  const sessionDefaults = {
    workspacePath: seed.workspacePath,
    pinned: false,
    routeId: seed.routeId,
    relayKey: seed.relayKey,
    modelId: seed.modelId,
    reasoningEffort: seed.reasoningEffort,
    permissionMode: fixturePermissionMode,
    createdAt: fixtureNow - 120_000,
    updatedAt: fixtureNow
  };
  const fixtureRecord = { ...sessionDefaults, id: fixtureId, title: fixtureTitle, turns: fixtureTurns };
  const alternateRecord = {
    ...sessionDefaults,
    id: alternateFixtureId,
    title: alternateFixtureTitle,
    turns: [{
      ...fixtureTurns[0],
      id: `${alternateFixtureId}-turn-1`,
      prompt: 'Alternate scroll restoration fixture',
      response: 'Alternate conversation used only to verify per-conversation viewport restoration.'
    }]
  };
  const conversationStore = new ConversationStore(join(desktopStateDirectory, 'conversation-history-v1'));
  await conversationStore.patch([fixtureRecord, alternateRecord], []);
  await evaluate(`(() => {
    const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || 'null');
    const sessions = Array.isArray(mirror) ? mirror : Array.isArray(mirror?.sessions) ? mirror.sessions : [];
    const fixtures = ${JSON.stringify([fixtureRecord, alternateRecord])};
    const existing = sessions.filter(session => !fixtures.some(fixture => fixture.id === session.id));
    localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify({ version: 2, complete: false, sessions: [...fixtures, ...existing] }));
    localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
      version: 1,
      section: 'coding',
      workspace: ${JSON.stringify(seed.workspacePath)},
      codingPanel: 'thread',
      activeCodingSessionId: ${JSON.stringify(fixtureId)},
      newConversation: false,
      settingsPanel: 'profile',
      billingTab: 'usage',
      modelCenterView: 'all',
      modelCapabilityFilter: 'all',
      comicView: 'storyboard'
    }));
    return true;
  })()`);
  await reloadDesktopDocument({ call, evaluate });
  await waitFor(
    () => evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`),
    Boolean,
    30_000,
    'fixture reload',
  );
  await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.click()`);
  await waitFor(
    () => evaluate(`(() => [...document.querySelectorAll('.nmx-session-row')].some(node =>
      node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)}))()`),
    Boolean,
    20_000,
    'seeded scroll fixture row',
  );
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.nmx-session-row')].find(node =>
      node.querySelector('.nmx-session-open span')?.textContent === ${JSON.stringify(fixtureTitle)});
    row?.querySelector('.nmx-session-open')?.click();
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || ''`),
    value => value === fixtureTitle,
    12_000,
    'active scroll fixture',
  );
  // Virtuoso measures variable-height turns after the selected row is marked
  // current. Wait for that real layout instead of sampling the transient
  // zero-height range from the first render frame.
  const setup = (await waitFor(
    () => evaluate(`(() => {
      const stage = document.querySelector('.nmx-task-view');
      const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
      const current = document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || '';
      if (!stage || !textarea || !current || document.querySelector('.nmx-stop-glyph')) return null;
      stage.scrollTo({ top: stage.scrollHeight, behavior: 'auto' });
      textarea.focus();
      textarea.select?.();
      return { current, range: stage.scrollHeight - stage.clientHeight };
    })()`),
    value => value?.range >= 800,
    12_000,
    'measured scrollable conversation history',
  )).value;
  await wait(300);

  const prompt = `${marker}：请在当前项目执行一次真实滚动生命周检查。先输出一句自然语言进度，再调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${marker}_DONE'),5000)。工具完成后输出一句自然语言总结。`;
  await call('Input.insertText', { text: prompt });
  await evaluate(`document.querySelector('.nmx-send-button')?.click()`);
  await verifyExactQaComposerRoute(evaluate, qaRoute);
  // Virtuoso may retain a small bottom item margin while still reporting the
  // list as at-bottom (the product threshold is 96 px). Keep the assertion
  // tight enough to catch a missed follow without requiring a zero margin.
  const afterSubmit = await waitFor(readStage, state => state && state.distance <= 24, 4_000, 'submitted message at bottom');

  const readTurn = () => evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
    return {
      running: Boolean(document.querySelector('.nmx-stop-glyph')),
      text: turn?.innerText || '',
      className: turn?.querySelector('.nmx-agent-message')?.className || '',
    };
  })()`);
  await waitFor(readTurn, state => state.running && /正在运行|Running/i.test(state.text), 45_000, 'running delayed tool');

  const point = await evaluate(`(() => {
    const stage = document.querySelector('.nmx-task-view');
    const rect = stage.getBoundingClientRect();
    // The compact timeline rail is intentionally an independent scroller.
    // Exercise the ordinary conversation blank/content area instead.
    return { x: rect.left + rect.width * 0.58, y: rect.top + rect.height / 2 };
  })()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  for (let index = 0; index < 4; index += 1) {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -260 });
    await wait(45);
  }
  const away = await waitFor(readStage, state => state && state.distance > 300 && state.toBottom, 4_000, 'wheel scroll from conversation blank area');
  const anchorBeforeOutput = away.value;

  const completed = await waitFor(readTurn, state => !state.running && state.className.includes('is-complete')
    && state.text.includes(marker), 90_000, 'assistant completion while reading history');
  const afterOutput = (await waitFor(
    readStage,
    state => state
      && state.anchorId === anchorBeforeOutput.anchorId
      && Math.abs(state.anchorOffset - anchorBeforeOutput.anchorOffset) <= 12
      && state.distance > 200,
    4_000,
    'settled history anchor after streamed output',
  )).value;
  const anchorPreservedDuringOutput = afterOutput.anchorId === anchorBeforeOutput.anchorId
    && Math.abs(afterOutput.anchorOffset - anchorBeforeOutput.anchorOffset) <= 12
    && afterOutput.distance > 200;
  const unseenVisible = afterOutput.unseen;

  const smoothSamples = await evaluate(`(async () => {
    const stage = document.querySelector('.nmx-task-view');
    const button = document.querySelector('.nmx-thread-to-bottom');
    if (!stage || !button) return [];
    const values = [];
    button.click();
    const started = performance.now();
    while (performance.now() - started < 700) {
      await new Promise(requestAnimationFrame);
      values.push(Math.round(stage.scrollTop));
    }
    return values;
  })()`);
  const afterSmoothBottom = await readStage();
  const distinctSmoothPositions = new Set(smoothSamples).size;

  for (let index = 0; index < 4; index += 1) {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: -280 });
    await wait(45);
  }
  const beforeSwitch = await waitFor(readStage, state => state && state.distance > 300, 4_000, 'history position before conversation switch');
  const switched = await evaluate(`(() => {
    const other = [...document.querySelectorAll('.nmx-session-row:not(.is-current) .nmx-session-open')]
      .find(button => button.querySelector('span')?.textContent === ${JSON.stringify(alternateFixtureTitle)});
    if (!other) return false;
    other.click();
    return true;
  })()`);
  if (!switched) throw new Error('A second conversation is required for scroll restoration testing.');
  await waitFor(
    () => evaluate(`document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || ''`),
    value => value && value !== setup.current,
    5_000,
    'alternate conversation',
  );
  await evaluate(`(() => {
    const expected = ${JSON.stringify(setup.current)};
    const original = [...document.querySelectorAll('.nmx-session-open')]
      .find(button => (button.querySelector('span')?.textContent || '') === expected);
    original?.click();
  })()`);
  await waitFor(
    () => evaluate(`document.querySelector('.nmx-session-row.is-current .nmx-session-open span')?.textContent || ''`),
    value => value === setup.current,
    5_000,
    'original conversation',
  );
  const restored = await waitFor(
    readStage,
    state => state
      && state.anchorId === beforeSwitch.value.anchorId
      && Math.abs(state.anchorOffset - beforeSwitch.value.anchorOffset) <= 12,
    5_000,
    'settled restored conversation anchor',
  );
  const anchorRestoredAfterSwitch = Math.abs(restored.value.anchorOffset - beforeSwitch.value.anchorOffset) <= 12;

  const report = {
    marker,
    submitFollowedBottom: afterSubmit.value.distance <= 24,
    blankAreaWheelScrolled: away.value.top < afterSubmit.value.top,
    anchorPreservedDuringOutput,
    anchorBeforeOutput: {
      id: anchorBeforeOutput.anchorId,
      offset: anchorBeforeOutput.anchorOffset,
      top: anchorBeforeOutput.top,
      distance: anchorBeforeOutput.distance,
    },
    anchorAfterOutput: {
      id: afterOutput.anchorId,
      offset: afterOutput.anchorOffset,
      top: afterOutput.top,
      distance: afterOutput.distance,
    },
    unseenVisible,
    smoothBottomAnimated: distinctSmoothPositions >= 3,
    smoothSampleCount: smoothSamples.length,
    distinctSmoothPositions,
    finalBottomDistance: afterSmoothBottom.distance,
    anchorRestoredAfterSwitch,
    anchorBeforeSwitch: {
      id: beforeSwitch.value.anchorId,
      offset: beforeSwitch.value.anchorOffset,
      top: beforeSwitch.value.top,
      distance: beforeSwitch.value.distance,
    },
    anchorAfterRestore: {
      id: restored.value.anchorId,
      offset: restored.value.anchorOffset,
      top: restored.value.top,
      distance: restored.value.distance,
    },
    completedState: completed.value.className,
  };
  const pass = report.submitFollowedBottom && report.blankAreaWheelScrolled
    && report.anchorPreservedDuringOutput && report.unseenVisible
    && report.smoothBottomAnimated && report.finalBottomDistance <= 24
    && report.anchorRestoredAfterSwitch && report.completedState.includes('is-complete');
  console.log(JSON.stringify({ ...report, pass }, undefined, 2));
  if (!pass) process.exitCode = 1;
} finally {
  if (qaRoute) await removeExactOfficialQaRoute({ evaluate, route: qaRoute });
  socket.close();
}
