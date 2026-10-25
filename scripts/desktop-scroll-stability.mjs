#!/usr/bin/env node

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const shouldAssert = process.argv.includes('--assert');
const idleMode = process.argv.includes('--idle');
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

await Promise.all([
  call('Runtime.enable'),
  call('Page.enable')
]);
await call('Page.bringToFront');

const target = await evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  return {
    x: rect.left + Math.min(rect.width * .55, Math.max(40, rect.width - 40)),
    y: rect.top + Math.min(rect.height * .55, Math.max(40, rect.height - 40))
  };
})()`);
if (!target) throw new Error('No active NextMux conversation scroller was found.');

await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });

// Warm Virtuoso once before measuring so the scrolling result represents a
// normal interaction rather than application startup.
if (!idleMode) {
  for (const deltaY of [-360, -360, -360, 360, 360, 360]) {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY });
    await wait(18);
  }
}
await wait(250);

await evaluate(`(() => {
  const stage = document.querySelector('.nmx-task-view');
  const probe = {
    running: true,
    frames: [],
    mutations: 0,
    characterDataMutations: 0,
    characterDataSamples: [],
    heightSamples: [stage.scrollHeight],
    observer: undefined,
    layoutObserver: undefined,
    layoutShiftValue: 0,
    lastFrame: performance.now()
  };
  const recordHeight = () => {
    const height = stage.scrollHeight;
    if (probe.heightSamples.at(-1) !== height) probe.heightSamples.push(height);
  };
  const frame = now => {
    probe.frames.push(now - probe.lastFrame);
    probe.lastFrame = now;
    recordHeight();
    if (probe.running) requestAnimationFrame(frame);
  };
  probe.observer = new MutationObserver(records => {
    probe.mutations += records.length;
    const characterRecords = records.filter(record => record.type === 'characterData');
    probe.characterDataMutations += characterRecords.length;
    for (const record of characterRecords) {
      if (probe.characterDataSamples.length >= 20) break;
      probe.characterDataSamples.push({
        parent: record.target.parentElement?.className || record.target.parentElement?.tagName || '',
        before: record.oldValue || '',
        after: record.target.data || ''
      });
    }
    recordHeight();
  });
  probe.observer.observe(stage, { subtree: true, childList: true, characterData: true, characterDataOldValue: true, attributes: true, attributeFilter: ['class', 'style'] });
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift')) {
    probe.layoutObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) probe.layoutShiftValue += entry.value;
    });
    probe.layoutObserver.observe({ type: 'layout-shift', buffered: false });
  }
  globalThis.__nmxScrollStabilityProbe = probe;
  requestAnimationFrame(frame);
})()`);

if (idleMode) {
  await wait(5_000);
} else {
  for (let index = 0; index < 48; index += 1) {
    const deltaY = index < 24 ? -260 : 260;
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY });
    await wait(18);
  }
  await wait(900);
}

const report = await evaluate(`(() => {
  const probe = globalThis.__nmxScrollStabilityProbe;
  probe.running = false;
  probe.observer?.disconnect();
  probe.layoutObserver?.disconnect();
  const frames = probe.frames.slice(2).sort((left, right) => left - right);
  const heightDeltas = probe.heightSamples.slice(1).map((height, index) => height - probe.heightSamples[index]);
  const significantHeightDeltas = heightDeltas.filter(delta => Math.abs(delta) > 2);
  const heightDirections = significantHeightDeltas.map(delta => Math.sign(delta)).filter(Boolean);
  const heightDirectionReversals = heightDirections.slice(1)
    .filter((direction, index) => direction !== heightDirections[index]).length;
  const percentile = ratio => frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] || 0;
  return {
    mode: ${JSON.stringify(idleMode ? 'idle' : 'scroll')},
    frameCount: frames.length,
    averageFrameMs: frames.length ? frames.reduce((total, value) => total + value, 0) / frames.length : 0,
    p95FrameMs: percentile(.95),
    maximumFrameMs: frames.at(-1) || 0,
    framesOver50Ms: frames.filter(value => value > 50).length,
    framesOver80Ms: frames.filter(value => value > 80).length,
    mutations: probe.mutations,
    characterDataMutations: probe.characterDataMutations,
    characterDataSamples: probe.characterDataSamples,
    heightSamples: probe.heightSamples,
    heightDirectionReversals,
    maximumHeightStep: heightDeltas.length ? Math.max(...heightDeltas.map(Math.abs)) : 0,
    layoutShiftValue: probe.layoutShiftValue,
    drawers: {
      terminal: Boolean(document.querySelector('.nmx-terminal-drawer')),
      workContext: Boolean(document.querySelector('.nmx-work-context')),
      modelPicker: Boolean(document.querySelector('.nmx-model-picker-popover'))
    },
    viewport: { width: innerWidth, height: innerHeight }
  };
})()`);

report.pass = report.p95FrameMs <= 35
  && report.characterDataMutations === 0
  && report.heightDirectionReversals <= 2
  && (idleMode
    ? report.mutations === 0 && report.heightSamples.length === 1
    : report.framesOver80Ms === 0);

console.log(JSON.stringify(report, undefined, 2));
socket.close();
if (shouldAssert && !report.pass) process.exitCode = 1;
