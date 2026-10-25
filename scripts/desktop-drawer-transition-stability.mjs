#!/usr/bin/env node

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const shouldAssert = process.argv.includes('--assert');
const targetDrawer = process.argv.includes('--terminal') ? 'terminal' : 'work-context';
const fileMode = process.argv.includes('--file');
const scrollMode = !process.argv.includes('--no-scroll');
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
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');

await evaluate(`(() => {
  if (document.querySelector('.nmx-terminal-drawer')) {
    document.querySelector('.nmx-workspace-controls button:first-child')?.click();
  }
  const drawer = document.querySelector('.nmx-work-context');
  if (drawer) {
    drawer.querySelector(':scope > header > nav button:last-child')?.click();
  }
})()`);
for (let attempt = 0; attempt < 30; attempt += 1) {
  const ready = await evaluate(`(() => {
    const drawerSelector = '.nmx-terminal-drawer, .nmx-work-context';
    const triggerSelector = ${JSON.stringify(targetDrawer === 'terminal'
      ? '.nmx-workspace-controls button:first-child'
      : fileMode ? '.nmx-thread-file-row.is-file' : '.nmx-workspace-controls button:last-child')};
    return !document.querySelector(drawerSelector) && Boolean(document.querySelector(triggerSelector));
  })()`);
  if (ready) break;
  await wait(50);
}

const trigger = await evaluate(`(() => {
  const selector = ${JSON.stringify(targetDrawer === 'terminal'
    ? '.nmx-workspace-controls button:first-child'
    : fileMode ? '.nmx-thread-file-row.is-file' : '.nmx-workspace-controls button:last-child')};
  const button = document.querySelector(selector);
  if (!button) return null;
  return { selector };
})()`);
if (!trigger) throw new Error(`No ${targetDrawer} drawer trigger was found.`);

// Start from a deterministic middle section. This forces the drawer width
// change to remeasure rich turns above and below the viewport instead of
// accidentally exercising only an already-cached bottom item.
await evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  if (!stage) throw new Error('No active NextMux conversation was found.');
  stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) * .52);
})()`);
await wait(180);

await evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  const workspace = document.querySelector('.nmx-workspace');
  if (!stage || !workspace) throw new Error('No active NextMux conversation was found.');
  const probe = {
    running: true,
    frames: [],
    stageRects: [],
    heights: [],
    visibleTurnCounts: [],
    stageIdentityChanges: 0,
    drawerIdentityChanges: 0,
    drawerAnimationStarts: 0,
    commandedDirection: 0,
    oppositeScrollFrames: 0,
    largestOppositeScrollDelta: 0,
    lastScrollTop: stage.scrollTop,
    resizeEvents: 0,
    mutations: 0,
    stage,
    drawer: undefined,
    lastFrame: performance.now(),
    resizeObserver: undefined,
    mutationObserver: undefined,
    animationListener: undefined
  };
  const sample = now => {
    const currentStage = document.querySelector('.nmx-task-view');
    const currentDrawer = document.querySelector(${JSON.stringify(targetDrawer === 'terminal' ? '.nmx-terminal-drawer' : '.nmx-work-context')});
    if (currentStage !== probe.stage) {
      probe.stageIdentityChanges += 1;
      probe.stage = currentStage;
    }
    if (currentDrawer !== probe.drawer) {
      if (probe.drawer !== undefined) probe.drawerIdentityChanges += 1;
      probe.drawer = currentDrawer;
    }
    const stageRect = currentStage.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    probe.frames.push(now - probe.lastFrame);
    probe.lastFrame = now;
    probe.stageRects.push({
      time: now,
      left: stageRect.left,
      width: stageRect.width,
      workspaceWidth: workspaceRect.width,
      scrollTop: currentStage.scrollTop,
      scrollHeight: currentStage.scrollHeight
    });
    const scrollDelta = currentStage.scrollTop - probe.lastScrollTop;
    if (probe.commandedDirection && scrollDelta * probe.commandedDirection < -2) {
      probe.oppositeScrollFrames += 1;
      probe.largestOppositeScrollDelta = Math.max(probe.largestOppositeScrollDelta, Math.abs(scrollDelta));
    }
    probe.lastScrollTop = currentStage.scrollTop;
    probe.heights.push(currentStage.scrollHeight);
    probe.visibleTurnCounts.push([...currentStage.querySelectorAll('.nmx-task-turn')]
      .filter(turn => {
        const rect = turn.getBoundingClientRect();
        return rect.bottom > stageRect.top && rect.top < stageRect.bottom;
      }).length);
    if (probe.running) requestAnimationFrame(sample);
  };
  probe.resizeObserver = new ResizeObserver(() => { probe.resizeEvents += 1; });
  probe.resizeObserver.observe(stage);
  probe.mutationObserver = new MutationObserver(records => { probe.mutations += records.length; });
  probe.mutationObserver.observe(stage, { subtree: true, childList: true, attributes: true, characterData: true });
  probe.animationListener = event => {
    if (event.target?.matches?.(${JSON.stringify(targetDrawer === 'terminal' ? '.nmx-terminal-drawer' : '.nmx-work-context')})) {
      probe.drawerAnimationStarts += 1;
    }
  };
  document.addEventListener('animationstart', probe.animationListener, true);
  globalThis.__nmxDrawerTransitionProbe = probe;
  requestAnimationFrame(sample);
})()`);

await evaluate(`document.querySelector(${JSON.stringify(targetDrawer === 'terminal'
  ? '.nmx-workspace-controls button:first-child'
  : fileMode ? '.nmx-thread-file-row.is-file' : '.nmx-workspace-controls button:last-child')})?.click()`);

const scrollPoint = await evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  const rect = stage.getBoundingClientRect();
  return { x: rect.left + rect.width * .55, y: rect.top + rect.height * .55 };
})()`);

if (scrollMode) {
  for (let index = 0; index < 28; index += 1) {
    if (index === 0 || index === 14) {
      await evaluate(`globalThis.__nmxDrawerTransitionProbe.commandedDirection = ${index < 14 ? -1 : 1}`);
    }
    await call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: scrollPoint.x,
      y: scrollPoint.y,
      deltaX: 0,
      deltaY: index < 14 ? -220 : 220
    });
    await wait(18);
  }
  await evaluate(`globalThis.__nmxDrawerTransitionProbe.commandedDirection = 0`);
}
await wait(900);

const report = await evaluate(`(() => {
  const probe = globalThis.__nmxDrawerTransitionProbe;
  probe.running = false;
  probe.resizeObserver?.disconnect();
  probe.mutationObserver?.disconnect();
  document.removeEventListener('animationstart', probe.animationListener, true);
  const frames = probe.frames.slice(2).sort((left, right) => left - right);
  const percentile = ratio => frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] || 0;
  const significantHeights = probe.heights.filter((height, index) => index === 0 || Math.abs(height - probe.heights[index - 1]) > 2);
  const widths = probe.stageRects.map(rect => rect.width).filter((width, index, values) => index === 0 || Math.abs(width - values[index - 1]) > .5);
  return {
    drawer: ${JSON.stringify(targetDrawer)},
    mode: ${JSON.stringify(fileMode ? 'file' : targetDrawer === 'terminal' ? 'terminal' : 'browser')},
    interaction: ${JSON.stringify(scrollMode ? 'toggle-and-scroll' : 'toggle-only')},
    frameCount: frames.length,
    averageFrameMs: frames.length ? frames.reduce((total, value) => total + value, 0) / frames.length : 0,
    p95FrameMs: percentile(.95),
    maximumFrameMs: frames.at(-1) || 0,
    framesOver50Ms: frames.filter(value => value > 50).length,
    framesOver80Ms: frames.filter(value => value > 80).length,
    resizeEvents: probe.resizeEvents,
    mutations: probe.mutations,
    stageIdentityChanges: probe.stageIdentityChanges,
    drawerIdentityChanges: probe.drawerIdentityChanges,
    drawerAnimationStarts: probe.drawerAnimationStarts,
    oppositeScrollFrames: probe.oppositeScrollFrames,
    largestOppositeScrollDelta: probe.largestOppositeScrollDelta,
    blankViewportFrames: probe.visibleTurnCounts.filter(count => count === 0).length,
    minimumVisibleTurnCount: Math.min(...probe.visibleTurnCounts),
    stageWidths: widths,
    stageHeights: significantHeights,
    open: Boolean(document.querySelector(${JSON.stringify(targetDrawer === 'terminal' ? '.nmx-terminal-drawer' : '.nmx-work-context')})),
    viewport: { width: innerWidth, height: innerHeight }
  };
})()`);

report.pass = report.open
  && report.p95FrameMs <= 35
  && report.framesOver80Ms === 0
  && report.stageHeights.length <= 3;

console.log(JSON.stringify(report, undefined, 2));
socket.close();
if (shouldAssert && !report.pass) process.exitCode = 1;
