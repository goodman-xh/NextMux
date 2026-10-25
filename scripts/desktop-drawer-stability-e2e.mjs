#!/usr/bin/env node

/**
 * Temporal regression for the conversation + terminal drawer surface.
 *
 * A screenshot cannot detect flicker. This test records layout geometry,
 * DOM replacement, layout shifts, long frames, and scroll monotonicity while
 * the real Electron renderer receives CDP wheel input.
 */

import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
// Electron exposes more than one `page` target during navigation. Select the
// renderer that actually mounted NextMux instead of trusting `/json` order.
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');

await evaluate(`(() => {
  const coding = document.querySelector('[data-desktop-section="coding"]');
  if (coding && !document.querySelector('.nmx-coding-stage')) coding.click();
  return true;
})()`);
let prepared = false;
for (let attempt = 0; attempt < 150; attempt += 1) {
  prepared = await evaluate(`Boolean(document.querySelector('.nmx-desktop-widget') && document.querySelector('.nmx-coding-stage'))`);
  if (prepared) break;
  await wait(100);
}
if (!prepared) throw new Error('The NextMux desktop widget is unavailable.');

// The composer may gain elevation while focused, but its border must not
// change colour or expose a native textarea outline. This runs in the real
// Electron renderer so late-loaded Theia/production CSS cannot silently
// reintroduce the visible focus border.
const composerFocus = await evaluate(`(() => {
  const composer = document.querySelector('.nmx-composer');
  const textarea = composer?.querySelector('textarea:not(:disabled)');
  if (!composer || !textarea) return null;
  textarea.blur();
  const before = {
    borderColor: getComputedStyle(composer).borderColor,
    outlineStyle: getComputedStyle(composer).outlineStyle
  };
  textarea.focus();
  const after = {
    borderColor: getComputedStyle(composer).borderColor,
    outlineStyle: getComputedStyle(composer).outlineStyle,
    textareaOutlineWidth: getComputedStyle(textarea).outlineWidth,
    textareaBoxShadow: getComputedStyle(textarea).boxShadow
  };
  return { before, after };
})()`);
if (!composerFocus) throw new Error('The NextMux composer is unavailable.');
await evaluate(`(() => {
  const terminal = [...document.querySelectorAll('.nmx-workspace-controls button')]
    .find(button => /terminal|终端|ターミナル/i.test((button.getAttribute('aria-label') || '') + (button.title || '')));
  if (terminal && !document.querySelector('.nmx-terminal-drawer.is-open')) terminal.click();
})()`);
await wait(700);

const target = await evaluate(`(() => {
  // A fresh disposable profile has no turns yet, so Virtuoso has not mounted
  // nmx-task-view. The stable coding stage is the correct wheel surface in
  // that state; once turns exist, exercise the real virtualized scroller.
  const scroller = document.querySelector('.nmx-task-view') || document.querySelector('.nmx-coding-stage');
  const drawer = document.querySelector('.nmx-terminal-drawer');
  if (!scroller || !drawer) return null;
  const bounds = scroller.getBoundingClientRect();
  window.__nmxStability = {
    startedAt: performance.now(),
    samples: [],
    mutations: [],
    layoutShifts: [],
    longTasks: [],
    resizeEvents: [],
    identities: {
      drawer,
      scroller,
      terminalLayout: document.querySelector('.nmx-terminal-layout'),
      terminalSurface: document.querySelector('.nmx-terminal-surface')
    }
  };
  const state = window.__nmxStability;
  const root = document.querySelector('.nmx-desktop-widget');
  state.mutationObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        state.mutations.push({
          t: performance.now() - state.startedAt,
          type: 'childList',
          target: record.target.className || record.target.nodeName,
          added: record.addedNodes.length,
          removed: record.removedNodes.length
        });
      } else if (record.attributeName === 'class' || record.attributeName === 'style') {
        state.mutations.push({
          t: performance.now() - state.startedAt,
          type: record.attributeName,
          target: record.target.className || record.target.nodeName
        });
      }
    }
  });
  state.mutationObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  state.resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const rect = entry.target.getBoundingClientRect();
      state.resizeEvents.push({ t: performance.now() - state.startedAt, target: entry.target.className, rect: [rect.x, rect.y, rect.width, rect.height] });
    }
  });
  for (const node of Object.values(state.identities)) if (node) state.resizeObserver.observe(node);
  try {
    state.layoutObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput && entry.startTime >= state.startedAt) state.layoutShifts.push({
        t: entry.startTime - state.startedAt,
        value: entry.value,
        sources: (entry.sources || []).map(source => ({
          node: source.node?.className || source.node?.nodeName || '',
          previous: source.previousRect ? [source.previousRect.x, source.previousRect.y, source.previousRect.width, source.previousRect.height] : null,
          current: source.currentRect ? [source.currentRect.x, source.currentRect.y, source.currentRect.width, source.currentRect.height] : null
        }))
      });
    });
    state.layoutObserver.observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    state.longTaskObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.startTime >= state.startedAt) state.longTasks.push({ t: entry.startTime - state.startedAt, duration: entry.duration });
    });
    state.longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {}
  let previousFrame = performance.now();
  const sample = now => {
    if (!window.__nmxStability) return;
    const currentDrawer = document.querySelector('.nmx-terminal-drawer');
    const currentScroller = document.querySelector('.nmx-task-view') || document.querySelector('.nmx-coding-stage');
    const drawerRect = currentDrawer?.getBoundingClientRect();
    const scrollerRect = currentScroller?.getBoundingClientRect();
    const rect = node => {
      const value = node?.getBoundingClientRect();
      return value ? [value.x, value.y, value.width, value.height] : null;
    };
    const shell = document.querySelector('.nmx-shell');
    const workspace = document.querySelector('.nmx-workspace');
    const workContext = document.querySelector('.nmx-work-context');
    state.samples.push({
      t: now - state.startedAt,
      frame: now - previousFrame,
      drawerSame: currentDrawer === state.identities.drawer,
      scrollerSame: currentScroller === state.identities.scroller,
      drawer: drawerRect ? [drawerRect.x, drawerRect.y, drawerRect.width, drawerRect.height] : null,
      scroller: scrollerRect ? [scrollerRect.x, scrollerRect.y, scrollerRect.width, scrollerRect.height] : null,
      viewport: [innerWidth, innerHeight],
      widget: rect(document.querySelector('.nmx-desktop-widget')),
      shell: rect(shell),
      workspace: rect(workspace),
      workContext: rect(workContext),
      shellGrid: shell ? getComputedStyle(shell).gridTemplateColumns : '',
      bodyClient: [document.body.clientWidth, document.body.clientHeight],
      scrollTop: currentScroller?.scrollTop || 0,
      scrollHeight: currentScroller?.scrollHeight || 0,
      turns: document.querySelectorAll('.nmx-task-turn').length
    });
    previousFrame = now;
    state.frame = requestAnimationFrame(sample);
  };
  state.frame = requestAnimationFrame(sample);
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
})()`);
if (!target) throw new Error('The conversation scroller or terminal drawer is unavailable.');

// Use compositor input rather than assigning scrollTop so this exercises the
// same path as a real wheel without taking over the user\'s physical pointer.
for (let index = 0; index < 24; index += 1) {
  await call('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: target.x,
    y: target.y,
    deltaX: 0,
    deltaY: index < 12 ? 146 : -146
  });
  await wait(32);
}
await wait(900);

const report = await evaluate(`(() => {
  const state = window.__nmxStability;
  if (!state) return null;
  cancelAnimationFrame(state.frame);
  state.mutationObserver?.disconnect();
  state.resizeObserver?.disconnect();
  state.layoutObserver?.disconnect();
  state.longTaskObserver?.disconnect();
  delete window.__nmxStability;
  const rounded = value => Math.round(value * 100) / 100;
  const uniqueGeometry = values => [...new Set(values.map(value => JSON.stringify(value)))];
  const frameGaps = state.samples.filter(sample => sample.frame > 34).map(sample => rounded(sample.frame));
  // A debugger/OS lifecycle suspension produces a very large RAF discontinuity
  // without a renderer long-task entry. Keep it visible in the evidence, but do
  // not misreport it as animation jank. A real blocked renderer is still caught
  // by the long-task observer below.
  const interactiveFrameGaps = frameGaps.filter(frame => frame <= 1_000);
  const suspensionFrameGaps = frameGaps.filter(frame => frame > 1_000);
  const drawerGeometry = uniqueGeometry(state.samples.map(sample => sample.drawer));
  const scrollerGeometry = uniqueGeometry(state.samples.map(sample => sample.scroller));
  const unexpectedMutations = state.mutations.filter(event => {
    const target = String(event.target || '');
    return /terminal-drawer|terminal-layout|terminal-surface|nmx-task-view|nmx-coding-stage/.test(target)
      || event.type === 'childList' && /nmx-shell|nmx-workspace/.test(target);
  });
  return {
    durationMs: rounded(performance.now() - state.startedAt),
    sampleCount: state.samples.length,
    frameGapCount: frameGaps.length,
    worstFrameMs: frameGaps.length ? Math.max(...frameGaps) : 0,
    worstInteractiveFrameMs: interactiveFrameGaps.length ? Math.max(...interactiveFrameGaps) : 0,
    suspensionFrameGapCount: suspensionFrameGaps.length,
    longTasks: state.longTasks,
    layoutShiftScore: rounded(state.layoutShifts.reduce((sum, item) => sum + item.value, 0)),
    layoutShifts: state.layoutShifts,
    drawerGeometry,
    scrollerGeometry,
    drawerIdentityStable: state.samples.every(sample => sample.drawerSame),
    scrollerIdentityStable: state.samples.every(sample => sample.scrollerSame),
    resizeEvents: state.resizeEvents,
    mutationCount: state.mutations.length,
    unexpectedMutations: unexpectedMutations.slice(0, 80),
    unexpectedMutationCount: unexpectedMutations.length,
    scrollRange: [Math.min(...state.samples.map(sample => sample.scrollTop)), Math.max(...state.samples.map(sample => sample.scrollTop))],
    renderedTurnRange: [Math.min(...state.samples.map(sample => sample.turns)), Math.max(...state.samples.map(sample => sample.turns))]
  };
})()`);

if (!report) throw new Error('The temporal stability report was not produced.');

const togglePoint = await evaluate(`(() => {
  window.__nmxDrawerIdentity = {
    drawer: document.querySelector('.nmx-terminal-drawer'),
    host: document.querySelector('.nmx-terminal-host')
  };
  const node = [...document.querySelectorAll('.nmx-workspace-controls button')]
    .find(button => /terminal|终端|ターミナル/i.test((button.getAttribute('aria-label') || '') + (button.title || '')));
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
if (!togglePoint) throw new Error('The terminal drawer toggle is unavailable.');

const toggle = async () => {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: togglePoint.x, y: togglePoint.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: togglePoint.x, y: togglePoint.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: togglePoint.x, y: togglePoint.y, button: 'left', clickCount: 1 });
};
const sampleTransition = () => evaluate(`new Promise(resolve => {
  const heights = [];
  const startedAt = performance.now();
  const sample = now => {
    const drawer = document.querySelector('.nmx-terminal-drawer');
    heights.push(drawer ? Math.round(drawer.getBoundingClientRect().height * 100) / 100 : null);
    if (now - startedAt < 260) requestAnimationFrame(sample);
    else resolve({
      heights,
      drawerPresent: Boolean(drawer),
      drawerSame: drawer === window.__nmxDrawerIdentity?.drawer,
      hostSame: document.querySelector('.nmx-terminal-host') === window.__nmxDrawerIdentity?.host,
      className: drawer?.className || '',
      display: drawer ? getComputedStyle(drawer).display : 'none'
    });
  };
  requestAnimationFrame(sample);
})`);

await toggle();
const closeTransition = await sampleTransition();
await toggle();
const openTransition = await sampleTransition();
await evaluate(`delete window.__nmxDrawerIdentity`);

report.toggle = { closeTransition, openTransition };
report.composerFocus = composerFocus;
console.log(JSON.stringify(report, undefined, 2));

const failures = [];
if (composerFocus.before.borderColor !== composerFocus.after.borderColor) {
  failures.push(`composer border changed on focus (${composerFocus.before.borderColor} -> ${composerFocus.after.borderColor})`);
}
if (composerFocus.after.textareaOutlineWidth !== '0px' || composerFocus.after.textareaBoxShadow !== 'none') {
  failures.push('composer textarea exposed a native focus outline or shadow');
}
if (!report.drawerIdentityStable) failures.push('terminal drawer DOM node was replaced during scrolling');
if (!report.scrollerIdentityStable) failures.push('conversation scroller DOM node was replaced during scrolling');
if (report.drawerGeometry.length !== 1) failures.push(`terminal drawer geometry oscillated (${report.drawerGeometry.length} states)`);
if (report.scrollerGeometry.length !== 1) failures.push(`conversation scroller geometry oscillated (${report.scrollerGeometry.length} states)`);
if (report.layoutShiftScore > 0.01) failures.push(`layout shift score was ${report.layoutShiftScore}`);
if (report.worstInteractiveFrameMs > 120) failures.push(`worst interactive animation frame was ${report.worstInteractiveFrameMs} ms`);
if (report.longTasks.some(task => task.duration > 120)) failures.push(`renderer long task was ${Math.max(...report.longTasks.map(task => task.duration))} ms`);
if (report.unexpectedMutationCount > 4) failures.push(`pane chrome mutated ${report.unexpectedMutationCount} times during wheel scrolling`);
if (!report.toggle.closeTransition.drawerPresent) failures.push('closing the terminal drawer unmounted its DOM instead of preserving the terminal surface');
if (!report.toggle.closeTransition.drawerSame || !report.toggle.openTransition.drawerSame) failures.push('terminal drawer identity changed across close/open');
if (!report.toggle.closeTransition.hostSame || !report.toggle.openTransition.hostSame) failures.push('terminal host identity changed across close/open');
if (report.toggle.closeTransition.heights.filter(value => value !== null).length < 4) failures.push('terminal drawer close did not expose a frame-based transition');
if (report.toggle.openTransition.heights.filter(value => value !== null).length < 4) failures.push('terminal drawer open did not expose a frame-based transition');
if ((report.toggle.closeTransition.heights.at(-1) ?? Infinity) > 1) failures.push('terminal drawer did not settle closed');
if ((report.toggle.openTransition.heights.at(-1) ?? 0) < 180) failures.push('terminal drawer did not settle open');

socket.close();
if (failures.length) throw new Error(`Drawer stability regression:\n- ${failures.join('\n- ')}`);
