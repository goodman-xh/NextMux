#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDisposableDesktopE2E, throwPrimaryOrCleanupErrors } from './desktop-e2e-state.mjs';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';

const NAVIGATION_FIXTURE_KEYS = [
    'nextmux.desktop.restoreState.v1', 'nextmux.desktop.activeRelay.v1',
    'nextmux.desktop.route.coding', 'nextmux.desktop.route.comic',
    'nextmux.desktop.selectedModel.coding.v1', 'nextmux.desktop.selectedModel.comic.v1'
];

/** Snapshot navigation only: never copy, clear or replace conversation history. */
export async function snapshotNavigationFixture(evaluate) {
    return evaluate(`(() => {
        if (document.querySelector('.nmx-stop-glyph, .nmx-file-editor-tab em, .nmx-file-save-confirm'))
            throw new Error('Navigation QA requires no running task or unsaved file');
        return {
            local: Object.fromEntries(${JSON.stringify(NAVIGATION_FIXTURE_KEYS)}.map(key => [key, localStorage.getItem(key)])),
            reload: sessionStorage.getItem('nextmux.desktop.reloadState.v1'),
            width: outerWidth, height: outerHeight
        };
    })()`);
}

export async function prepareNavigationEmptyCodingState({ evaluate, waitFor, reload }) {
    await evaluate(`(() => {
        if (document.querySelector('.nmx-stop-glyph, .nmx-file-editor-tab em, .nmx-file-save-confirm'))
            throw new Error('Navigation QA requires no running task or unsaved file');
        const coding = document.querySelector('[data-desktop-section="coding"]');
        if (!coding) throw new Error('Coding navigation entry is missing');
        coding.click();
    })()`);
    await waitFor(`Boolean(document.querySelector('.nmx-context-actions > button:first-child'))`, 'new conversation control');
    await evaluate(`(() => {
        const button = document.querySelector('.nmx-context-actions > button:first-child');
        if (!button || button.disabled) throw new Error('New conversation control is unavailable');
        button.click();
    })()`);
    const emptyDraft = `(() => {
        const restored = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
        return restored.newConversation === true && !restored.activeCodingSessionId
            && Boolean(document.querySelector('.nmx-empty-task')) && !document.querySelector('.nmx-session-row.is-current');
    })()`;
    await waitFor(emptyDraft, 'explicit empty conversation draft');
    // A fresh document resets in-memory page history without deleting sessions.
    await reload();
    await waitFor(`Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop ready');
    try {
        await waitFor(emptyDraft, 'empty conversation draft restored');
    } catch (error) {
        // Navigation flags only: no conversation body, identifiers, paths, or credentials.
        const evidence = await evaluate(`(() => {
            const state = key => { try {
                const item = JSON.parse(key === 'reload' ? sessionStorage.getItem('nextmux.desktop.reloadState.v1') || '{}'
                    : localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}');
                return { present: Object.keys(item).length > 0, section: item.section, codingPanel: item.codingPanel,
                    newConversation: item.newConversation, hasSession: Boolean(item.activeCodingSessionId || item.codingSessionId) };
            } catch { return { invalid: true }; } };
            return { durable: state('durable'), transient: state('reload'),
                shellCount: document.querySelectorAll('.nmx-shell').length,
                emptyCount: document.querySelectorAll('.nmx-empty-task').length,
                selectedSessionCount: document.querySelectorAll('.nmx-session-row.is-current').length,
                turns: document.querySelectorAll('.nmx-coding-turn').length, readyState: document.readyState };
        })()`).catch(() => ({ unavailable: true }));
        throw new Error(`${error.message}; navigation=${JSON.stringify(evidence)}`, { cause: error });
    }
}

export async function reloadNavigationDocument({ evaluate, waitFor, call }) {
    const previous = await evaluate('performance.timeOrigin');
    await call('Page.reload', { ignoreCache: true });
    await waitFor(`performance.timeOrigin !== ${JSON.stringify(previous)} && Boolean(document.querySelector('.nmx-shell'))`, 'new desktop document');
}

export async function restoreNavigationFixture({ evaluate, snapshot, reload }) {
    if (!snapshot) return;
    await evaluate(`(() => {
        const snapshot = ${JSON.stringify(snapshot)};
        for (const key of ${JSON.stringify(NAVIGATION_FIXTURE_KEYS)}) {
            const value = snapshot.local[key];
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        }
        if (snapshot.reload === null) sessionStorage.removeItem('nextmux.desktop.reloadState.v1');
        else sessionStorage.setItem('nextmux.desktop.reloadState.v1', snapshot.reload);
        window.resizeTo(snapshot.width, snapshot.height);
    })()`);
    await reload();
}

export async function runDesktopNavigationQa() {
assertDisposableDesktopE2E();
const port = process.env.NEXTMUX_CDP_PORT || '9222';
const { socket, call, evaluate } = await connectToNextMuxWorkbench(port);

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(expression, label, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function physicalClick(selector, index = 0) {
    const result = await evaluate(`(() => {
        const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
        if (!node || node.disabled) return false;
        for (const type of ['mousedown', 'mouseup', 'click']) node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        return true;
    })()`);
    if (!result) throw new Error(`Unable to click ${selector}[${index}]`);
    await pause(300);
}

async function physicalClickText(selector, text) {
    const result = await evaluate(`(() => {
        const text = ${JSON.stringify(text)};
        const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
            .find(candidate => candidate.textContent.trim().replace(/\\s+/g, ' ') === text);
        if (!node || node.disabled) return false;
        for (const type of ['mousedown', 'mouseup', 'click']) node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        return true;
    })()`);
    if (!result) throw new Error(`Unable to click ${text}`);
    await pause(300);
}

async function mouseNavigation(button) {
    const point = await evaluate(`(() => {
        const rect = document.querySelector('.nmx-workspace')?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + Math.min(120, rect.height / 2) } : undefined;
    })()`);
    if (!point) throw new Error('Unable to find a safe workspace point for mouse navigation');
    const name = button === 3 ? 'back' : 'forward';
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: name, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: name, clickCount: 1 });
    await pause(300);
}

async function state() {
    return evaluate(`(() => {
        const navigation = [...document.querySelectorAll('.nmx-titlebar-primary-nav > button')];
        const history = [...document.querySelectorAll('.nmx-titlebar-actions button')];
        const section = navigation.find(node => node.classList.contains('is-active'))?.textContent.trim() || 'settings';
        return {
            backDisabled: history[1]?.disabled,
            forwardDisabled: history[2]?.disabled,
            section,
            settingsPanel: document.querySelector('.nmx-settings-nav button.is-active')?.textContent.trim() || '',
            modelView: document.querySelector('.nmx-context-nav button.is-active')?.textContent.trim().replace(/\\s+/g, ' ') || '',
            voiceDialog: Boolean(document.querySelector('.nmx-voice-dialog')),
            microphone: Boolean(document.querySelector('.nmx-mic-button')),
            microphoneListening: Boolean(document.querySelector('.nmx-mic-button.is-listening')),
            invisibleContextResizer: Boolean(document.querySelector('.nmx-context-panel-resize'))
                && !['编程', '漫剧', 'Coding', 'Comic'].includes(section)
        };
    })()`);
}

async function layoutState() {
    return evaluate(`(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        const actions = document.querySelector('.nmx-titlebar-actions');
        const primary = document.querySelector('.nmx-titlebar-primary-nav');
        const topPanel = document.querySelector('#theia-top-panel');
        const dragRegion = document.querySelector('.nmx-titlebar-drag-region');
        const empty = document.querySelector('.nmx-empty-task');
        return {
            viewport: { width: innerWidth, height: innerHeight },
            window: { outerWidth, outerHeight, chromeHeight: Math.max(0, outerHeight - innerHeight) },
            os: document.body.classList.contains('mac') ? 'mac'
                : document.body.classList.contains('windows') ? 'windows' : 'linux',
            topPanel: rect('#theia-top-panel'),
            dragRegion: rect('.nmx-titlebar-drag-region'),
            windowControls: rect('#window-controls'),
            actions: rect('.nmx-titlebar-actions'),
            primary: rect('.nmx-titlebar-primary-nav'),
            positions: [actions, primary].map(node => node ? getComputedStyle(node).position : ''),
            regions: {
                titlebar: topPanel ? getComputedStyle(topPanel).getPropertyValue('-webkit-app-region') : '',
                dragRegion: dragRegion ? getComputedStyle(dragRegion).getPropertyValue('-webkit-app-region') : '',
                actions: actions ? getComputedStyle(actions).getPropertyValue('-webkit-app-region') : '',
                primary: primary ? getComputedStyle(primary).getPropertyValue('-webkit-app-region') : ''
            },
            sections: [...document.querySelectorAll('.nmx-titlebar-primary-nav [data-desktop-section]')]
                .map(node => node.getAttribute('data-desktop-section')),
            emptyHeading: empty?.querySelector('h2')?.textContent?.trim() || '',
            ownEmptyLogo: Boolean(empty?.querySelector('.nmx-empty-brand-svg')),
            horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        };
    })()`);
}

function assertTitlebarLayout(layout, label) {
    const titlebar = layout.topPanel?.height >= 40 ? layout.topPanel : layout.dragRegion;
    expect(layout.sections.join(',') === 'models,coding,comic', `${label}: primary workbenches stay in the titlebar`, layout);
    expect(layout.positions.every(position => position === 'fixed'), `${label}: navigation controls stay fixed`, layout);
    expect(layout.actions && layout.primary, `${label}: titlebar controls render`, layout);
    expect(titlebar && layout.window.chromeHeight <= 8,
        `${label}: web content extends into the native window titlebar`, layout);
    expect([layout.actions, layout.primary].every(rect => rect.top >= titlebar.top
        && rect.bottom <= titlebar.bottom),
    `${label}: every product navigation control is inside the window titlebar row`, layout);
    expect(Math.max(layout.actions.top, layout.primary.top)
        - Math.min(layout.actions.top, layout.primary.top) <= 2,
    `${label}: navigation controls share one row`, layout);
    expect(layout.actions.left >= 0 && layout.primary.right <= layout.viewport.width,
        `${label}: titlebar controls stay inside the viewport`, layout);
    expect(layout.actions.right <= layout.primary.left,
        `${label}: titlebar controls do not overlap`, layout);
    expect(layout.regions.actions === 'no-drag' && layout.regions.primary === 'no-drag',
    `${label}: titlebar buttons remain clickable`, layout);
    if (layout.os === 'mac') {
        expect(layout.actions.left >= 74 && layout.regions.dragRegion === 'drag',
            `${label}: macOS traffic lights stay clear and the titlebar remains draggable`, layout);
    }
    if (layout.os === 'windows' && layout.windowControls) {
        expect(layout.primary.right <= layout.windowControls.left,
            `${label}: Windows caption buttons stay clear`, layout);
    }
    expect(layout.horizontalOverflow === 0, `${label}: workbench has no horizontal overflow`, layout);
}

function expect(condition, label, value) {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
}

const report = [];
let snapshot;
let primaryError;
const cleanupErrors = [];
const reload = () => reloadNavigationDocument({ evaluate, waitFor, call });
try {
await call('Page.enable');
snapshot = await snapshotNavigationFixture(evaluate);
await prepareNavigationEmptyCodingState({ evaluate, waitFor, reload });

let current = await state();
expect(current.backDisabled && current.forwardDisabled, 'initial history is empty', current);
expect(!current.invisibleContextResizer, 'coding resizer is visible and scoped', current);
const initialLayout = await layoutState();
assertTitlebarLayout(initialLayout, 'default window');
expect(initialLayout.ownEmptyLogo && Boolean(initialLayout.emptyHeading),
    'empty coding state uses the NextMux logo', initialLayout);
report.push({ step: 'initial-coding', ...current, layout: initialLayout });

await physicalClick('.nmx-account-trigger');
current = await state();
expect(current.section === 'settings', 'account trigger opens settings', current);
expect(!current.backDisabled, 'settings preserves page return target', current);
const settingsAccountAction = await evaluate(`document.querySelector('.nmx-profile-card > button')?.textContent?.trim() || ''`);
expect(/登录\/注册|sign in/i.test(settingsAccountAction), 'unlinked settings uses the login/register label', settingsAccountAction);
report.push({ step: 'settings-open', ...current, accountAction: settingsAccountAction });

const networkLabel = await evaluate(`[...document.querySelectorAll('.nmx-settings-nav button')]
    .find(node => /网络|Network|Proxy/i.test(node.textContent))?.textContent.trim()`);
expect(Boolean(networkLabel), 'network settings tab exists', networkLabel);
await physicalClickText('.nmx-settings-nav button', networkLabel);
current = await state();
expect(current.settingsPanel === networkLabel, 'settings internal tab opens', current);
expect(!current.invisibleContextResizer, 'settings has no invisible resizer', current);
report.push({ step: 'settings-internal-tab', ...current });

await physicalClick('.nmx-titlebar-actions button', 1);
current = await state();
expect(['编程', 'Coding'].includes(current.section), 'page back skips settings internal tabs', current);
expect(!current.forwardDisabled, 'settings page is available to forward navigation', current);
report.push({ step: 'settings-page-back', ...current });

await physicalClick('.nmx-titlebar-actions button', 2);
current = await state();
expect(current.section === 'settings' && current.settingsPanel === networkLabel, 'page forward restores settings page', current);
report.push({ step: 'settings-page-forward', ...current });

await physicalClick('.nmx-account-trigger');
current = await state();
expect(['编程', 'Coding'].includes(current.section), 'second settings click returns to workbench', current);
report.push({ step: 'settings-toggle-close', ...current });

await call('Page.reload', { ignoreCache: true });
await waitFor(`Boolean(document.querySelector('.nmx-desktop-widget'))`, 'desktop reloaded');
await waitFor(`['编程', 'Coding'].includes(document.querySelector('.nmx-titlebar-primary-nav > button.is-active')?.textContent.trim())`, 'coding restored again');
await pause(500);

const modelsLabel = await evaluate(`[...document.querySelectorAll('.nmx-titlebar-primary-nav > button')]
    .find(node => /模型中心|Model Center/i.test(node.textContent))?.textContent.trim()`);
expect(Boolean(modelsLabel), 'model center navigation exists', modelsLabel);
await physicalClickText('.nmx-titlebar-primary-nav > button', modelsLabel);
current = await state();
expect(!current.invisibleContextResizer, 'model center has no invisible resizer', current);

const compactModelCenter = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.nmx-model-context-nav > button')];
    const labels = buttons.map(button => button.querySelector('.nmx-context-nav-label')).filter(Boolean);
    const routing = document.querySelector('.nmx-model-center-topbar .nmx-topbar-routing');
    const account = document.querySelector('.nmx-model-center-topbar .nmx-primary-button');
    const introBody = document.querySelector('.nmx-model-center-intro > p');
    const topbar = document.querySelector('.nmx-model-center-topbar')?.getBoundingClientRect();
    return {
        buttonCount: buttons.length,
        allTextControls: buttons.every(button => !button.querySelector(':scope > i') && Boolean(button.title)),
        labelsVisible: labels.length === buttons.length && labels.every(label => {
            const rect = label.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && Boolean(label.textContent.trim())
                && label.textContent.trim() === label.parentElement.title;
        }),
        introBodyHidden: !(introBody instanceof Element) || getComputedStyle(introBody).display === 'none',
        routingImmediatelyBeforeAccount: routing?.nextElementSibling === account,
        routingLeftOfAccount: Boolean(routing && account
            && routing.getBoundingClientRect().left < account.getBoundingClientRect().left),
        accountText: account?.textContent?.trim() || '',
        exposesDirectoryLinked: /目录已连接|directory is linked/i.test(document.querySelector('.nmx-model-center')?.innerText || ''),
        exposesBrowserLogin: /使用浏览器登录|浏览器登录|sign in with browser|browser sign-in/i.test(document.querySelector('.nmx-model-center')?.innerText || ''),
        topbarInsideViewport: Boolean(topbar && topbar.left >= 0 && topbar.right <= innerWidth)
    };
})()`);
expect(compactModelCenter.buttonCount >= 10 && compactModelCenter.allTextControls
    && compactModelCenter.labelsVisible && compactModelCenter.introBodyHidden,
'model center navigation retains visible text labels', compactModelCenter);
expect(compactModelCenter.routingImmediatelyBeforeAccount && compactModelCenter.routingLeftOfAccount,
    'automatic routing is immediately left of login/register', compactModelCenter);
expect(/登录\/注册|sign in|recharge|充值/i.test(compactModelCenter.accountText)
    && !compactModelCenter.exposesDirectoryLinked && !compactModelCenter.exposesBrowserLogin
    && compactModelCenter.topbarInsideViewport,
'model center exposes only the relevant compact account action', compactModelCenter);
report.push({ step: 'compact-model-center', ...compactModelCenter });

const directApiLabel = await evaluate(`[...document.querySelectorAll('.nmx-context-nav button')]
    .find(node => /直连 API|Direct API/i.test(node.textContent))?.textContent.trim().replace(/\\s+/g, ' ')`);
expect(Boolean(directApiLabel), 'direct API model tab exists', directApiLabel);
await physicalClickText('.nmx-context-nav button', directApiLabel);
await physicalClick('.nmx-titlebar-actions button', 1);
current = await state();
expect(['编程', 'Coding'].includes(current.section), 'model center back skips internal tabs', current);
report.push({ step: 'model-center-page-back', ...current });

await physicalClick('.nmx-titlebar-actions button', 2);
current = await state();
expect(current.section === modelsLabel && current.modelView === directApiLabel, 'model center forward restores selected tab', current);
report.push({ step: 'model-center-page-forward', ...current });

await mouseNavigation(3);
current = await state();
expect(['编程', 'Coding'].includes(current.section), 'mouse back returns to workbench', current);
await mouseNavigation(4);
current = await state();
expect(current.section === modelsLabel, 'mouse forward returns to model center', current);
report.push({ step: 'mouse-navigation', ...current });

const codingLabel = await evaluate(`[...document.querySelectorAll('.nmx-titlebar-primary-nav > button')]
    .find(node => /编程|Coding/i.test(node.textContent))?.textContent.trim()`);
expect(Boolean(codingLabel), 'coding navigation exists', codingLabel);
await physicalClickText('.nmx-titlebar-primary-nav > button', codingLabel);
current = await state();
expect(current.microphone, 'coding composer exposes microphone control', current);
expect(!current.voiceDialog, 'microphone uses inline listening/settings flow', current);
report.push({ step: 'microphone-entry', ...current });

const composerControlOrder = await evaluate(`(() => {
    const relay = document.querySelector('[data-relay-trigger="composer"]');
    const model = document.querySelector('.nmx-route-button');
    const relayRect = relay?.getBoundingClientRect();
    const modelRect = model?.getBoundingClientRect();
    return relay && model && relayRect && modelRect ? {
        adjacent: relay.nextElementSibling === model,
        relayLeftOfModel: relayRect.left < modelRect.left,
        relayVisible: relayRect.width > 0 && relayRect.height > 0,
        modelVisible: modelRect.width > 0 && modelRect.height > 0,
        titlebarRelayAbsent: !document.querySelector('[data-relay-trigger="titlebar"], .nmx-titlebar-relay'),
        embeddedRelayAbsent: !document.querySelector('.nmx-model-picker-relay')
    } : undefined;
})()`);
expect(composerControlOrder?.adjacent && composerControlOrder?.relayLeftOfModel
    && composerControlOrder?.relayVisible && composerControlOrder?.modelVisible
    && composerControlOrder?.titlebarRelayAbsent && composerControlOrder?.embeddedRelayAbsent,
    'relay selection is the independent control immediately left of model selection', composerControlOrder);

await physicalClick('[data-relay-trigger="composer"]');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover'))`, 'composer relay drawer opens');
const composerRelayGeometry = await evaluate(`(() => {
    const trigger = document.querySelector('[data-relay-trigger="composer"]')?.getBoundingClientRect();
    const picker = document.querySelector('.nmx-model-picker-popover')?.getBoundingClientRect();
    const drawer = document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover')?.getBoundingClientRect();
    return trigger && picker && drawer ? {
        triggerVisible: trigger.width > 0 && trigger.height > 0,
        drawerVisible: drawer.width > 0 && drawer.height > 0,
        drawerLeft: Math.round(drawer.left),
        drawerRight: Math.round(drawer.right),
        drawerWidth: Math.round(drawer.width),
        pickerWidth: Math.round(picker.width),
        pickerLeft: picker.left, pickerRight: picker.right, pickerTop: picker.top, pickerBottom: picker.bottom,
        safeTop: Math.max(document.querySelector('.nmx-titlebar-primary-nav')?.getBoundingClientRect().bottom || 40,
            document.querySelector('.nmx-coding-topbar')?.getBoundingClientRect().bottom || 40) + 6,
        workspaceLeft: document.querySelector('.nmx-workspace')?.getBoundingClientRect().left || 0,
        sidebarWidth: document.querySelector('.nmx-context-panel')?.getBoundingClientRect().width || 0,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hasRedundantClose: Boolean(document.querySelector('.nmx-model-picker-popover > header > button, .nmx-model-picker-relay-view .nmx-relay-popover > header > button')),
        iconSortControls: [...document.querySelectorAll('.nmx-model-picker-relay-view .nmx-relay-sort > button')]
            .every(button => Boolean(button.querySelector('i')) && Boolean(button.dataset.tooltip)
                && button.dataset.tooltip === button.getAttribute('aria-label')
                && button.querySelector('span')?.getBoundingClientRect().width <= 1),
        optionMetricsUseIcons: [...document.querySelectorAll('.nmx-model-picker-relay-view .nmx-relay-option-metrics')]
            .every(metrics => metrics.querySelectorAll(':scope > span').length === 4
                && [...metrics.querySelectorAll(':scope > span')].every(metric => Boolean(metric.querySelector('i')) && Boolean(metric.getAttribute('aria-label'))))
    } : undefined;
})()`);
expect(composerRelayGeometry?.triggerVisible && composerRelayGeometry?.drawerVisible,
    'composer relay control and drawer are visible', composerRelayGeometry);
expect(composerRelayGeometry.drawerLeft >= 0
    && composerRelayGeometry.drawerRight <= composerRelayGeometry.viewportWidth
    && composerRelayGeometry.drawerWidth <= composerRelayGeometry.pickerWidth
    && composerRelayGeometry.pickerWidth <= Math.min(348, composerRelayGeometry.viewportWidth - 16)
    && composerRelayGeometry.pickerLeft >= Math.max(8, composerRelayGeometry.workspaceLeft)
    && composerRelayGeometry.pickerRight <= composerRelayGeometry.viewportWidth - 8
    && composerRelayGeometry.pickerTop >= composerRelayGeometry.safeTop
    && composerRelayGeometry.pickerBottom <= composerRelayGeometry.viewportHeight - 8,
    'relay drawer is narrow and fits the current window', composerRelayGeometry);
expect(!composerRelayGeometry.hasRedundantClose && composerRelayGeometry.iconSortControls
    && composerRelayGeometry.optionMetricsUseIcons,
    'relay drawer uses icon metrics without a redundant close button', composerRelayGeometry);
await evaluate(`document.querySelector('.nmx-relay-source-search input').focus()`);
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await pause(180);
const sortKeyboard = await evaluate(`(() => {
    const button = document.activeElement;
    const tooltip = getComputedStyle(button, '::after');
    return { keyboardReachable: button.matches('.nmx-relay-sort > button') && button.matches(':focus-visible'),
        tooltipVisible: tooltip.visibility === 'visible' && Number(tooltip.opacity) > .9,
        tooltipMatchesLabel: tooltip.content === JSON.stringify(button.getAttribute('aria-label')),
        hasFocusRing: Number.parseFloat(getComputedStyle(button).outlineWidth) > 0,
        mode: button.getAttribute('data-relay-sort') };
})()`);
expect(sortKeyboard.keyboardReachable && sortKeyboard.tooltipVisible && sortKeyboard.tooltipMatchesLabel
    && sortKeyboard.hasFocusRing, 'sort tooltip is visible for keyboard users', sortKeyboard);
report.push({ step: 'relay-sort-keyboard-tooltip', ...sortKeyboard });
await physicalClick('.nmx-coding-stage');
await waitFor(`!document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover')`, 'outside click closes composer relay drawer');

await physicalClick('.nmx-route-button');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-popover'))`, 'model picker opens');
expect(await evaluate(`!document.querySelector('.nmx-model-picker-relay')`),
    'model picker does not duplicate the relay control', undefined);
await physicalClick('[data-relay-trigger="composer"]');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover'))`, 'adjacent relay control switches to relay drawer');
await physicalClick('.nmx-route-button');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-list'))`, 'model control switches back to model list');
report.push({ step: 'relay-and-model-picker', composerControlOrder, composerRelayGeometry });
await physicalClick('.nmx-coding-stage');
await waitFor(`!document.querySelector('.nmx-model-picker-popover')`, 'model picker closes after outside click');

const originalWindow = await evaluate(`({ outerWidth, outerHeight })`);
await evaluate(`window.resizeTo(980, 680)`);
await pause(500);
const compactLayout = await layoutState();
assertTitlebarLayout(compactLayout, 'minimum window');
expect(compactLayout.viewport.width <= initialLayout.viewport.width
    && compactLayout.viewport.height <= initialLayout.viewport.height,
    'minimum-window check actually reduced or retained the default viewport', { initialLayout, compactLayout });
await physicalClick('[data-relay-trigger="composer"]');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover'))`, 'compact relay drawer opens');
const compactRelayGeometry = await evaluate(`(() => {
    const trigger = document.querySelector('[data-relay-trigger="composer"]')?.getBoundingClientRect();
    const model = document.querySelector('.nmx-route-button')?.getBoundingClientRect();
    const drawer = document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover')?.getBoundingClientRect();
    return trigger && model && drawer ? {
        left: drawer.left, right: drawer.right, width: drawer.width, viewportWidth: innerWidth,
        top: drawer.top, bottom: drawer.bottom, viewportHeight: innerHeight,
        workspaceLeft: document.querySelector('.nmx-workspace')?.getBoundingClientRect().left || 0,
        sidebarWidth: document.querySelector('.nmx-context-panel')?.getBoundingClientRect().width || 0,
        safeTop: Math.max(document.querySelector('.nmx-titlebar-primary-nav')?.getBoundingClientRect().bottom || 40,
            document.querySelector('.nmx-coding-topbar')?.getBoundingClientRect().bottom || 40) + 6,
        triggerLeftOfModel: trigger.left < model.left,
        triggerVisible: trigger.width > 0 && trigger.height > 0
    } : undefined;
})()`);
expect(compactRelayGeometry?.left >= Math.max(8, compactRelayGeometry.workspaceLeft)
    && compactRelayGeometry?.right <= compactRelayGeometry?.viewportWidth - 8
    && compactRelayGeometry?.width <= Math.min(348, compactRelayGeometry.viewportWidth - 16)
    && compactRelayGeometry?.top >= compactRelayGeometry.safeTop
    && compactRelayGeometry?.bottom <= compactRelayGeometry.viewportHeight - 8
    && compactRelayGeometry?.sidebarWidth > 0 && compactRelayGeometry?.triggerLeftOfModel
    && compactRelayGeometry?.triggerVisible,
    'relay drawer remains bounded at the minimum window size', compactRelayGeometry);
await physicalClick('.nmx-coding-stage');
report.push({ step: 'minimum-window', layout: compactLayout, relay: compactRelayGeometry });

await physicalClick('[data-desktop-section="comic"]');
await waitFor(`Boolean(document.querySelector('.nmx-comic-agent-controls'))`, 'comic agent controls open');
const comicControlOrder = await evaluate(`(() => {
    const relay = document.querySelector('[data-relay-trigger="comic"]');
    const model = document.querySelector('.nmx-comic-agent-controls select:nth-of-type(2)');
    const relayRect = relay?.getBoundingClientRect();
    const modelRect = model?.getBoundingClientRect();
    return relay && model && relayRect && modelRect ? {
        adjacent: relay.nextElementSibling === model,
        relayLeftOfModel: relayRect.left < modelRect.left,
        relayVisible: relayRect.width > 0 && relayRect.height > 0,
        modelVisible: modelRect.width > 0 && modelRect.height > 0,
        relayLabelHidden: getComputedStyle(relay.querySelector('span')).display === 'none',
        relayChevronHidden: getComputedStyle(relay.querySelector('i:last-child')).display === 'none',
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
    } : undefined;
})()`);
expect(comicControlOrder?.adjacent && comicControlOrder?.relayLeftOfModel
    && comicControlOrder?.relayVisible && comicControlOrder?.modelVisible
    && comicControlOrder?.relayLabelHidden && comicControlOrder?.relayChevronHidden
    && comicControlOrder?.horizontalOverflow === 0,
    'comic relay selection is immediately left of its model selection', comicControlOrder);
await physicalClick('[data-relay-trigger="comic"]');
await waitFor(`Boolean(document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover'))`, 'comic relay drawer opens');
const comicRelayGeometry = await evaluate(`(() => {
    const trigger = document.querySelector('[data-relay-trigger="comic"]')?.getBoundingClientRect();
    const drawer = document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover')?.getBoundingClientRect();
    return trigger && drawer ? {
        left: drawer.left,
        right: drawer.right,
        width: drawer.width,
        viewportWidth: window.innerWidth,
        triggerVisible: trigger.width > 0 && trigger.height > 0,
        hasRedundantClose: Boolean(document.querySelector('.nmx-model-picker-popover > header > button'))
    } : undefined;
})()`);
expect(comicRelayGeometry?.triggerVisible && comicRelayGeometry?.left >= 0
    && comicRelayGeometry?.right <= comicRelayGeometry?.viewportWidth
    && comicRelayGeometry?.width <= 348 && !comicRelayGeometry?.hasRedundantClose,
    'comic uses the same narrow close-free relay drawer', comicRelayGeometry);
await physicalClick('.nmx-comic-agent-copy');
await waitFor(`!document.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover')`, 'outside click closes comic relay drawer');
report.push({ step: 'comic-relay-and-model', controls: comicControlOrder, relay: comicRelayGeometry });
await evaluate(`window.resizeTo(${Number(originalWindow.outerWidth)}, ${Number(originalWindow.outerHeight)})`);
await pause(350);

} catch (error) {
    primaryError = error;
} finally {
    try { await restoreNavigationFixture({ evaluate, snapshot, reload }); }
    catch (error) { cleanupErrors.push(error); }
    socket.close();
}
throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Desktop navigation QA');
console.log(JSON.stringify({ passed: true, report }, undefined, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopNavigationQa();
