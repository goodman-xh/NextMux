#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import {
    assertDisposableDesktopE2E,
    snapshotBrowserState,
    throwPrimaryOrCleanupErrors
} from './desktop-e2e-state.mjs';

assertDisposableDesktopE2E();

const port = process.env.NEXTMUX_CDP_PORT || '9222';
const { socket, call, evaluate } = await connectToNextMuxWorkbench(port);
// The coding top bar also contains browser and agent shortcuts.  Do not use
// positional button indices: those controls are intentionally extensible and
// a new shortcut must not make a pane-resize test click the wrong surface.
const terminalControl = '.nmx-workspace-controls button:has(.codicon-layout-panel)';
const contextControl = '.nmx-workspace-controls button:has(.codicon-layout-sidebar-right)';

const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
const expect = (condition, label, value) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
};

async function waitFor(expression, label) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function reload() {
    await reloadDesktopDocument({ call, evaluate });
    await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop reload');
    await pause(450);
}

async function point(selector, index = 0) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const value = await evaluate(`(() => {
            const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
            if (!node || node.disabled) return null;
            const rect = node.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return hit && (node === hit || node.contains(hit)) ? { x, y } : null;
        })()`);
        if (value) return value;
        await pause(100);
    }
    throw new Error(`Unable to locate an unobstructed ${selector}[${index}]`);
}

async function click(selector, index = 0) {
    const target = await point(selector, index);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await pause(220);
}

async function drag(selector, deltaX, deltaY) {
    const start = await point(selector);
    const end = { x: start.x + deltaX, y: start.y + deltaY };
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
        await call('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: start.x + deltaX * step / 8,
            y: start.y + deltaY * step / 8,
            button: 'left',
            buttons: 1
        });
        await pause(24);
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await pause(260);
}

async function dimensions() {
    return evaluate(`(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
        const value = selector => {
            const node = document.querySelector(selector);
            return node ? { now: Number(node.getAttribute('aria-valuenow')), min: Number(node.getAttribute('aria-valuemin')), max: Number(node.getAttribute('aria-valuemax')) } : null;
        };
        const shell = rect('.nmx-shell');
        const context = rect('.nmx-context-panel');
        const workspace = rect('.nmx-workspace');
        const drawer = rect('.nmx-work-context');
        const terminal = rect('.nmx-terminal-drawer');
        const terminalList = rect('.nmx-terminal-list');
        const terminalSurface = rect('.nmx-terminal-surface');
        const codingStage = rect('.nmx-coding-stage');
        const composer = rect('.nmx-composer-wrap');
        const relayButton = document.querySelector('[data-relay-trigger="composer"]');
        const relayButtonRect = relayButton?.getBoundingClientRect();
        const relayLabel = relayButton?.querySelector('span');
        const relayChevron = relayButton?.querySelector('i:last-child');
        const modelButton = document.querySelector('.nmx-route-button');
        const modelButtonRect = modelButton?.getBoundingClientRect();
        const desktop = rect('.nmx-desktop-widget');
        const xtermScreen = rect('.nmx-terminal-host .xterm-screen');
        const restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        const storedSessions = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
        const sessions = Array.isArray(storedSessions) ? storedSessions
            : Array.isArray(storedSessions.sessions) ? storedSessions.sessions : [];
        const activeViewState = sessions.find(session => session?.id === restore.activeCodingSessionId)?.viewState;
        return {
            viewport: { width: innerWidth, height: innerHeight },
            desktop: desktop && { left: desktop.left, right: desktop.right, top: desktop.top, bottom: desktop.bottom, width: desktop.width, height: desktop.height },
            shell: shell && { left: shell.left, right: shell.right, width: shell.width },
            context: context && { left: context.left, right: context.right, width: context.width },
            workspace: workspace && { left: workspace.left, right: workspace.right, width: workspace.width },
            drawer: drawer && { top: drawer.top, bottom: drawer.bottom, height: drawer.height, left: drawer.left, right: drawer.right, width: drawer.width, position: getComputedStyle(document.querySelector('.nmx-work-context')).position },
            terminal: terminal && { top: terminal.top, bottom: terminal.bottom, height: terminal.height },
            terminalList: terminalList && { left: terminalList.left, right: terminalList.right, width: terminalList.width },
            terminalSurface: terminalSurface && { left: terminalSurface.left, right: terminalSurface.right, width: terminalSurface.width },
            xtermScreen: xtermScreen && { left: xtermScreen.left, right: xtermScreen.right, width: xtermScreen.width, height: xtermScreen.height },
            codingStage: codingStage && { top: codingStage.top, bottom: codingStage.bottom, height: codingStage.height },
            composer: composer && {
                left: composer.left,
                right: composer.right,
                width: composer.width,
                horizontalOverflow: Math.max(0, document.querySelector('.nmx-composer')?.scrollWidth - document.querySelector('.nmx-composer')?.clientWidth),
                relayImmediatelyBeforeModel: relayButton?.nextElementSibling === modelButton,
                relayLeftOfModel: Boolean(relayButtonRect && modelButtonRect && relayButtonRect.right <= modelButtonRect.left),
                relayLabelDisplay: relayLabel ? getComputedStyle(relayLabel).display : '',
                relayChevronDisplay: relayChevron ? getComputedStyle(relayChevron).display : ''
            },
            values: {
                context: value('.nmx-context-panel-resize'),
                drawer: value('.nmx-work-context-resize'),
                terminal: value('.nmx-terminal-resize'),
                terminalList: value('.nmx-terminal-list-resize')
            },
            stored: {
                context: Number(localStorage.getItem('nextmux.desktop.pane.contextWidth.v1')),
                drawer: Number(localStorage.getItem('nextmux.desktop.pane.workContextWidth.v1')),
                terminal: Number(localStorage.getItem('nextmux.desktop.pane.terminalHeight.v1')),
                terminalList: Number(localStorage.getItem('nextmux.desktop.pane.terminalListWidth.v1'))
            },
            restoreState: {
                activeCodingSessionId: typeof restore.activeCodingSessionId === 'string' ? restore.activeCodingSessionId : '',
                newConversation: Boolean(restore.newConversation),
                section: restore.section || '',
                codingPanel: restore.codingPanel || ''
            },
            activeDomSessionId: document.querySelector('.nmx-session-row.is-current')?.getAttribute('data-session-id') || '',
            sessionPreferred: activeViewState ? {
                drawer: Number(activeViewState.workContextWidth),
                terminal: Number(activeViewState.terminalDrawerHeight),
                terminalList: Number(activeViewState.terminalListWidth)
            } : null
        };
    })()`);
}

let report;
let screenshotPath = '';
let browserSnapshot;
let originalWindow;
let baselineWindow;
let focusEmulationEnabled = false;
let primaryError;
const cleanupErrors = [];
try {
    await Promise.all([call('Runtime.enable'), call('Page.enable')]);
    browserSnapshot = await snapshotBrowserState(evaluate);
    originalWindow = await evaluate(`({ innerWidth, innerHeight, outerWidth, outerHeight })`);
    await call('Page.bringToFront');
    focusEmulationEnabled = true;
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Keep the test self-contained. A failed prior run must not make the next run
    // inherit an already compact window, and restoring inner dimensions as outer
    // dimensions must not shrink the app by the titlebar on every execution.
    await evaluate(`window.resizeTo(Math.max(1280, outerWidth), Math.max(760, outerHeight))`);
    await pause(650);
    baselineWindow = await evaluate(`({ innerWidth, innerHeight, outerWidth, outerHeight })`);
    await evaluate(`(() => {
        localStorage.setItem('nextmux.desktop.pane.contextWidth.v1', '276');
        localStorage.setItem('nextmux.desktop.pane.workContextWidth.v1', '358');
        localStorage.setItem('nextmux.desktop.pane.terminalHeight.v1', '264');
        localStorage.setItem('nextmux.desktop.pane.terminalListWidth.v1', '218');
        const restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        const activeSessionId = typeof restore.activeCodingSessionId === 'string' ? restore.activeCodingSessionId : '';
        const stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
        const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
        const updatedSessions = sessions.map(session => session?.id === activeSessionId ? {
            ...session,
            viewState: {
                ...(session.viewState || {}),
                workContextOpen: false,
                terminalDrawerOpen: false,
                workContextWidth: 358,
                terminalDrawerHeight: 264,
                terminalListWidth: 218
            }
        } : session);
        localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify(
            Array.isArray(stored) ? updatedSessions : { ...stored, sessions: updatedSessions }
        ));
        return true;
    })()`);
    await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
    await waitFor(`Boolean(document.querySelector('.nmx-titlebar-primary-nav'))`, 'desktop workbench');
    await pause(650);
    await click('.nmx-titlebar-primary-nav button', 1);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-context-panel-resize'))`)) await click('.nmx-titlebar-actions button', 0);
    await waitFor(`Boolean(document.querySelector('.nmx-context-panel-resize'))`, 'project divider');
    if (!await evaluate(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open'))`)) await click(terminalControl);
    if (await evaluate(`Boolean(document.querySelector('.nmx-work-context'))`)) await click('.nmx-work-context > header nav button:last-child');

    const initial = await dimensions();
    await drag('.nmx-context-panel-resize', 64, 0);
    const contextGrown = await dimensions();
    expect(contextGrown.context.width > initial.context.width + 45, 'project pane grows by pointer drag', { initial, contextGrown });
    expect(contextGrown.workspace.width < initial.workspace.width - 45, 'conversation pane follows project divider', { initial, contextGrown });

    await drag('.nmx-context-panel-resize', -96, 0);
    const contextPrepared = await dimensions();
    expect(contextPrepared.context.width < contextGrown.context.width - 70, 'project pane shrinks by pointer drag', { contextGrown, contextPrepared });

    const workspaceBeforeDrawer = contextPrepared.workspace.width;
    if (!await evaluate(`Boolean(document.querySelector('.nmx-work-context'))`)) await click(contextControl);
    await waitFor(`Boolean(document.querySelector('.nmx-work-context-resize'))`, 'right drawer divider');
    const drawerInitial = await dimensions();
    expect(Math.abs((workspaceBeforeDrawer - drawerInitial.workspace.width) - drawerInitial.drawer.width) <= 2, 'right drawer compresses the full conversation layout by its visible width', drawerInitial);
    expect(Math.abs(drawerInitial.workspace.right - drawerInitial.drawer.left) <= 1, 'right drawer starts after the conversation layout', drawerInitial);
    await drag('.nmx-work-context-resize', -64, 0);
    const drawerGrown = await dimensions();
    expect(drawerGrown.drawer.width > drawerInitial.drawer.width + 45, 'right drawer grows by pointer drag', { drawerInitial, drawerGrown });
    expect(drawerGrown.workspace.width < drawerInitial.workspace.width - 45, 'conversation layout follows the right drawer divider', { drawerInitial, drawerGrown });
    expect(drawerGrown.drawer.left - drawerGrown.workspace.left >= 399, 'right drawer preserves visible conversation width', drawerGrown);
    expect(drawerGrown.drawer.position === 'absolute', 'right drawer remains independently positioned', drawerGrown);
    if (drawerGrown.sessionPreferred) {
        expect(Math.abs(drawerGrown.sessionPreferred.drawer - drawerGrown.drawer.width) <= 1,
            'right drawer drag updates the active conversation preference immediately', drawerGrown);
    }

    await click('.nmx-work-context > header nav button:last-child');
    await waitFor(`!document.querySelector('.nmx-work-context')`, 'right drawer closes');
    if (!await evaluate(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open'))`)) await click(terminalControl);
    await waitFor(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open')?.getBoundingClientRect().height > 0 && document.querySelector('.nmx-terminal-list-resize'))`, 'open terminal list divider');
    const terminalInitial = await dimensions();
    await drag('.nmx-terminal-resize', 0, -54);
    const terminalTaller = await dimensions();
    expect(terminalTaller.terminal.height > terminalInitial.terminal.height + 35, 'terminal grows vertically', { terminalInitial, terminalTaller });
    expect(terminalTaller.codingStage.height >= 219, 'terminal preserves conversation stage height', terminalTaller);
    await drag('.nmx-terminal-list-resize', -54, 0);
    const terminalListGrown = await dimensions();
    expect(terminalListGrown.terminalList.width > terminalTaller.terminalList.width + 35, 'terminal list grows horizontally', { terminalTaller, terminalListGrown });
    expect(terminalListGrown.terminalSurface.width >= 419, 'terminal surface keeps minimum width', terminalListGrown);
    if (terminalListGrown.sessionPreferred) {
        expect(Math.abs(terminalListGrown.sessionPreferred.terminal - terminalListGrown.terminal.height) <= 1
            && Math.abs(terminalListGrown.sessionPreferred.terminalList - terminalListGrown.terminalList.width) <= 1,
        'terminal drags update the active conversation preferences immediately', terminalListGrown);
    }

    for (const [name, data, size] of [
        ['context', terminalListGrown.values.context, terminalListGrown.context.width],
        ['drawer', drawerGrown.values.drawer, drawerGrown.drawer.width],
        ['terminal', terminalListGrown.values.terminal, terminalListGrown.terminal.height],
        ['terminalList', terminalListGrown.values.terminalList, terminalListGrown.terminalList.width]
    ]) {
        expect(data && data.now >= data.min && data.now <= data.max, `${name} aria bounds`, { data, size });
        expect(Math.abs(data.now - size) <= 1, `${name} visual size matches state`, { data, size });
        expect(Math.abs(terminalListGrown.stored[name] - data.now) <= 1, `${name} persisted after drag`, { stored: terminalListGrown.stored[name], data });
    }

    const persisted = {
        contextWidth: terminalListGrown.context.width,
        drawerWidth: drawerGrown.drawer.width,
        terminalHeight: terminalListGrown.terminal.height,
        terminalListWidth: terminalListGrown.terminalList.width,
        restoreState: terminalListGrown.restoreState,
        activeDomSessionId: terminalListGrown.activeDomSessionId,
        sessionPreferred: terminalListGrown.sessionPreferred
    };
    await reloadDesktopDocument({ call, evaluate, ignoreCache: true });
    await waitFor(`Boolean(document.querySelector('.nmx-titlebar-primary-nav'))`, 'desktop restart');
    await pause(650);
    await click('.nmx-titlebar-primary-nav button', 1);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-context-panel-resize'))`)) await click('.nmx-titlebar-actions button', 0);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open'))`)) await click(terminalControl);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-work-context'))`)) await click(contextControl);
    await waitFor(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open')?.getBoundingClientRect().height > 0 && document.querySelector('.nmx-terminal-list-resize') && document.querySelector('.nmx-work-context-resize'))`, 'restored open pane controls');
    const restored = await dimensions();
    expect(Math.abs(restored.context.width - persisted.contextWidth) <= 1, 'project width restored after restart', { persisted, restored });
    expect(Math.abs(restored.drawer.width - persisted.drawerWidth) <= 1, 'drawer width restored after restart', { persisted, restored });
    expect(Math.abs(restored.terminal.height - persisted.terminalHeight) <= 1, 'terminal height restored after restart', { persisted, restored });
    const restoredTerminalListWidth = Math.min(persisted.terminalListWidth, restored.values.terminalList.max);
    expect(Math.abs(restored.terminalList.width - restoredTerminalListWidth) <= 1,
        'terminal list preferred width is restored and clamped only by available space', { persisted, restored });
    expect(Math.abs(restored.stored.terminalList - persisted.terminalListWidth) <= 1,
        'terminal list keeps its unclamped preferred width while the right drawer is open', { persisted, restored });
    expect(restored.drawer.left >= restored.terminalList.right - 1,
        'right drawer remains beside the terminal instead of covering it', restored);

    await click(contextControl);
    await waitFor(`!document.querySelector('.nmx-work-context')`, 'right drawer closed for preferred-width check');
    const restoredWithoutDrawer = await dimensions();
    expect(Math.abs(restoredWithoutDrawer.terminalList.width - persisted.terminalListWidth) <= 1,
        'terminal list returns to its preferred width when space becomes available', { persisted, restoredWithoutDrawer });
    await click(contextControl);
    await waitFor(`Boolean(document.querySelector('.nmx-work-context'))`, 'right drawer reopened');
    const wideBeforeCompact = await dimensions();

    await evaluate(`window.resizeTo(940, 640)`);
    await pause(650);
    const compactViewport = await evaluate(`({ innerWidth, innerHeight })`);
    expect(compactViewport.innerWidth < baselineWindow.innerWidth - 180 && compactViewport.innerHeight < baselineWindow.innerHeight - 40,
        'desktop enters its platform-constrained compact window size', { baselineWindow, compactViewport });
    await pause(500);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open'))`)) await click(terminalControl);
    if (!await evaluate(`Boolean(document.querySelector('.nmx-work-context'))`)) await click(contextControl);
    await waitFor(`Boolean(document.querySelector('.nmx-terminal-drawer.is-open')?.getBoundingClientRect().height > 0 && document.querySelector('.nmx-terminal-list-resize') && document.querySelector('.nmx-work-context'))`, 'compact open terminal and right drawer');
    let compactInitial = await dimensions();
    expect(compactInitial.composer?.width <= 560,
        'open side panes exercise the narrow composer container breakpoint', compactInitial.composer);
    expect(compactInitial.composer.relayImmediatelyBeforeModel && compactInitial.composer.relayLeftOfModel,
        'narrow composer keeps relay immediately left of model', compactInitial.composer);
    expect(compactInitial.composer.relayLabelDisplay === 'none' && compactInitial.composer.relayChevronDisplay === 'none',
        'narrow composer collapses relay text and chevron to one titled icon', compactInitial.composer);
    expect(compactInitial.composer.horizontalOverflow <= 1,
        'narrow composer controls do not overflow horizontally', compactInitial.composer);

    await click('[data-relay-trigger="composer"]');
    await waitFor(`Boolean(document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover'))`, 'narrow relay drawer');
    const narrowRelay = await evaluate(`(() => {
        const picker = document.querySelector('.nmx-model-picker-popover')?.getBoundingClientRect();
        return picker ? {
            left: picker.left, right: picker.right, top: picker.top, bottom: picker.bottom,
            width: picker.width, viewportWidth: innerWidth, viewportHeight: innerHeight,
            hasClose: Boolean(document.querySelector('.nmx-model-picker-popover > header > button'))
        } : null;
    })()`);
    expect(narrowRelay && narrowRelay.left >= 8 && narrowRelay.right <= narrowRelay.viewportWidth - 8
        && narrowRelay.top >= 8 && narrowRelay.bottom <= narrowRelay.viewportHeight - 8
        && narrowRelay.width <= 280 && !narrowRelay.hasClose,
    'narrow relay drawer stays in the viewport without a redundant close button', narrowRelay);
    await click('[data-relay-trigger="composer"]');
    await waitFor(`!document.querySelector('.nmx-model-picker-popover')`, 'narrow relay drawer closes from its adjacent trigger');
    expect(JSON.stringify(compactInitial.stored) === JSON.stringify(wideBeforeCompact.stored),
        'automatic compact constraints never overwrite local preferred pane sizes', { wideBeforeCompact, compactInitial });
    expect(JSON.stringify(compactInitial.sessionPreferred) === JSON.stringify(wideBeforeCompact.sessionPreferred),
        'automatic compact constraints never overwrite conversation preferred pane sizes', { wideBeforeCompact, compactInitial });

    await evaluate(`window.resizeTo(${Number(baselineWindow.outerWidth)}, ${Number(baselineWindow.outerHeight)})`);
    await pause(850);
    const expandedRecovered = await dimensions();
    for (const [name, data, size] of [
        ['context', expandedRecovered.values.context, expandedRecovered.context.width],
        ['drawer', expandedRecovered.values.drawer, expandedRecovered.drawer.width],
        ['terminal', expandedRecovered.values.terminal, expandedRecovered.terminal.height],
        ['terminalList', expandedRecovered.values.terminalList, expandedRecovered.terminalList.width]
    ]) {
        const expected = Math.max(data.min, Math.min(wideBeforeCompact.stored[name], data.max));
        expect(Math.abs(size - expected) <= 1, `${name} returns to its preferred width after the viewport expands`, {
            preferred: wideBeforeCompact.stored[name], expected, data, size
        });
    }
    expect(JSON.stringify(expandedRecovered.stored) === JSON.stringify(wideBeforeCompact.stored),
        'expanding the viewport leaves local preferred pane sizes unchanged', { wideBeforeCompact, expandedRecovered });
    expect(JSON.stringify(expandedRecovered.sessionPreferred) === JSON.stringify(wideBeforeCompact.sessionPreferred),
        'expanding the viewport leaves conversation preferred pane sizes unchanged', { wideBeforeCompact, expandedRecovered });

    await evaluate(`window.resizeTo(940, 640)`);
    await pause(850);
    compactInitial = await dimensions();
    const compactRange = compactInitial.values.terminalList.max - compactInitial.values.terminalList.min;
    expect(compactRange >= 36, 'compact terminal divider keeps a useful adjustment range', compactInitial);
    const compactCanGrow = compactInitial.values.terminalList.max - compactInitial.values.terminalList.now >= 30;
    await drag('.nmx-terminal-list-resize', compactCanGrow ? -32 : 32, 0);
    const compactResized = await dimensions();
    expect(Math.abs(compactResized.terminalList.width - compactInitial.terminalList.width) >= 24,
        'compact terminal list responds to pointer drag', { compactInitial, compactResized });
    expect(Math.abs(compactResized.terminalSurface.width - compactInitial.terminalSurface.width) >= 24,
        'compact terminal surface follows the divider', { compactInitial, compactResized });
    if (compactInitial.xtermScreen && compactResized.xtermScreen) {
        expect(Math.abs(compactResized.xtermScreen.width - compactInitial.xtermScreen.width) >= 16,
            'xterm reflows with the compact terminal surface', { compactInitial, compactResized });
    }
    expect(Math.abs(compactResized.desktop.width - compactResized.viewport.width) <= 2,
        'desktop fills compact viewport without a right white strip', compactResized);
    expect(compactResized.drawer.left >= compactResized.terminalList.right - 1,
        'compact right drawer remains beside the terminal instead of covering it', compactResized);

    const capture = await call('Page.captureScreenshot', { format: 'png' });
    screenshotPath = join(tmpdir(), `nextmux-pane-resize-${randomUUID()}.png`);
    await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'), { flag: 'wx' });
    report = { passed: true, initial, contextGrown, contextPrepared, drawerGrown, terminalListGrown, restored, compactInitial, narrowRelay, expandedRecovered, compactResized, screenshotCaptured: true,
        ...(process.env.NEXTMUX_E2E_KEEP_PROFILE === '1' ? { screenshotPath } : {}) };
} catch (error) {
    primaryError = error;
} finally {
    const cleanup = async (label, operation) => {
        try {
            await operation();
        } catch (error) {
            cleanupErrors.push(new Error(`${label}: ${error.message}`, { cause: error }));
        }
    };

    // Restore every mutable surface independently: one failed cleanup must not
    // prevent the remaining state from being returned to its baseline.
    if (browserSnapshot) {
        await cleanup('restore localStorage', () => evaluate(`(() => {
            localStorage.clear();
            for (const [key, value] of Object.entries(${JSON.stringify(browserSnapshot.local)})) localStorage.setItem(key, value);
            return true;
        })()`));
        await cleanup('restore sessionStorage', () => evaluate(`(() => {
            sessionStorage.clear();
            for (const [key, value] of Object.entries(${JSON.stringify(browserSnapshot.session)})) sessionStorage.setItem(key, value);
            return true;
        })()`));
        await cleanup('reload restored desktop state', reload);
        await cleanup('restore document scroll position', () => evaluate(
            `scrollTo(${Number(browserSnapshot.scrollX || 0)}, ${Number(browserSnapshot.scrollY || 0)})`
        ));
    }
    if (originalWindow) {
        await cleanup('restore and verify window dimensions', async () => {
            // Electron's renderer window.resizeTo delegates to setContentSize on
            // Windows. Passing the recorded outer size therefore adds the native
            // frame (16x8 on the current host) a second time. Restore the exact
            // content dimensions and verify against both renderer coordinate
            // systems so repeated E2E runs cannot make the window grow.
            await evaluate(`window.resizeTo(${Number(originalWindow.innerWidth)}, ${Number(originalWindow.innerHeight)})`);
            await pause(300);
            const restoredWindow = await evaluate(`({ innerWidth, innerHeight, outerWidth, outerHeight })`);
            expect(Math.abs(restoredWindow.outerWidth - originalWindow.outerWidth) <= 2
                && Math.abs(restoredWindow.outerHeight - originalWindow.outerHeight) <= 2
                && Math.abs(restoredWindow.innerWidth - originalWindow.innerWidth) <= 2
                && Math.abs(restoredWindow.innerHeight - originalWindow.innerHeight) <= 2,
            'window dimensions restored', { originalWindow, restoredWindow });
        });
    }
    if (focusEmulationEnabled) {
        await cleanup('disable CDP focus emulation', () => call('Emulation.setFocusEmulationEnabled', { enabled: false }));
    }
    if (screenshotPath && process.env.NEXTMUX_E2E_KEEP_PROFILE !== '1') await cleanup('remove temporary pane screenshot', () => rm(screenshotPath, { force: true }));
    await cleanup('close pane-resize CDP socket', async () => socket.close());
}

throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Desktop pane resize QA');
console.log(JSON.stringify(report, undefined, 2));
