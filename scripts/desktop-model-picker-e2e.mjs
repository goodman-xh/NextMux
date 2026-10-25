#!/usr/bin/env node

import {
    ensureExactOfficialQaRoute,
    officialQaRouteConfig,
    removeExactOfficialQaRoute
} from './desktop-official-qa-route.mjs';

const port = process.env.NEXTMUX_CDP_PORT || '9222';
const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) throw new Error(`No desktop page on port ${port}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
});

function call(method, params = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const expect = (condition, label, value) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(value)}`);
};

async function waitFor(expression, label, timeout = 8_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function point(selector, horizontal = .5, vertical = .5) {
    return waitFor(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
            ? { x: rect.left + rect.width * ${horizontal}, y: rect.top + rect.height * ${vertical} }
            : null;
    })()`, selector);
}

async function move(selector, horizontal = .5, vertical = .5) {
    const target = await point(selector, horizontal, vertical);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await pause(220);
    return target;
}

async function click(selector) {
    const target = await move(selector);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await pause(220);
}

async function openPicker() {
    if (await evaluate(`Boolean(document.querySelector('.nmx-model-picker-popover'))`)) return;
    if (!await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.getAttribute('aria-current') === 'page'`)) {
        await waitFor(`Boolean(document.querySelector('[data-desktop-section="coding"]'))`, 'coding navigation');
        await evaluate(`document.querySelector('[data-desktop-section="coding"]')?.click()`);
    }
    await waitFor(`Boolean(document.querySelector('.nmx-route-button'))`, 'coding model control', 15_000);
    await waitFor(`(() => {
        if (document.querySelector('.nmx-model-picker-popover')) return true;
        const coding = document.querySelector('[data-desktop-section="coding"]');
        if (coding?.getAttribute('aria-current') !== 'page') {
            coding?.click();
            return false;
        }
        document.querySelector('.nmx-route-button')?.click();
        return false;
    })()`, 'model picker opens', 15_000);
}

async function pickerGeometry() {
    return evaluate(`(() => {
        const picker = document.querySelector('.nmx-model-picker-popover');
        const rect = picker?.getBoundingClientRect();
        const rows = [...document.querySelectorAll('.nmx-model-option')].map(node => {
            const row = node.getBoundingClientRect();
            const button = node.querySelector(':scope > button');
            const name = button?.querySelector('strong');
            const nameRect = name?.getBoundingClientRect();
            return {
                text: name?.textContent?.trim() || '',
                supported: !node.classList.contains('is-unsupported'),
                row: row.toJSON(),
                button: button?.getBoundingClientRect().toJSON(),
                name: nameRect?.toJSON(),
                whiteSpace: name ? getComputedStyle(name).whiteSpace : '',
                overflow: name ? getComputedStyle(name).overflow : ''
            };
        });
        return {
            viewport: { width: innerWidth, height: innerHeight },
            rect: rect?.toJSON(),
            rows,
            enabledText: picker?.innerText.includes('已启用') || picker?.innerText.includes('Enabled'),
            unsupportedLabel: Boolean(document.querySelector('.nmx-model-picker-section-label')),
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);
}

function assertPickerGeometry(state, label) {
    expect(state.rect, `${label}: picker exists`, state);
    expect(state.rect.top >= 8 && state.rect.left >= 8, `${label}: picker starts inside viewport`, state.rect);
    expect(state.rect.right <= state.viewport.width - 8 && state.rect.bottom <= state.viewport.height - 8,
        `${label}: picker ends inside viewport`, state);
    expect(!state.enabledText, `${label}: no redundant enabled text`, state);
    expect(state.unsupportedLabel, `${label}: unsupported group is visible`, state);
    expect(state.rows.length > 0, `${label}: model rows render`, state);
    expect(state.rows.every(row => row.row.height <= 32.5), `${label}: each model stays on one row`, state.rows);
    expect(state.rows.every(row => row.button.left >= state.rect.left && row.button.right <= state.rect.right),
        `${label}: buttons stay inside picker`, state.rows);
    expect(state.rows.every(row => !row.name || row.name.left >= row.button.left && row.name.right <= row.button.right),
        `${label}: model names stay inside their rows`, state.rows);
    expect(state.rows.every(row => row.whiteSpace === 'nowrap' && row.overflow === 'hidden'),
        `${label}: names use bounded single-line rendering`, state.rows);
}

let originalWindow;
let pickerWasOpen = false;
let passed = false;
let qaRoute;
const evidence = {};

try {
    await call('Page.enable');
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Page.setWebLifecycleState', { state: 'active' });

    // Every desktop E2E profile is disposable. Install one exact local route
    // rather than relying on a developer's saved connections or inventing
    // reasoning capabilities for an unconfigured model.
    qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: officialQaRouteConfig() });

    originalWindow = await evaluate(`({ outerWidth, outerHeight, innerWidth, innerHeight })`);
    pickerWasOpen = await evaluate(`Boolean(document.querySelector('.nmx-model-picker-popover'))`);
    await openPicker();
    await waitFor(`document.querySelectorAll('.nmx-model-picker-popover .nmx-model-option').length > 0
        && Boolean(document.querySelector('.nmx-model-picker-popover .nmx-model-picker-section-label'))`,
        'model picker supported and unsupported rows', 20_000);

    evidence.normal = await pickerGeometry();
    assertPickerGeometry(evidence.normal, 'normal window');

    evidence.relayEntry = await evaluate(`(() => {
        const relay = document.querySelector('[data-relay-trigger="composer"]');
        const model = document.querySelector('.nmx-route-button');
        const relayRect = relay?.getBoundingClientRect();
        const modelRect = model?.getBoundingClientRect();
        return {
            relay: relayRect?.toJSON(),
            model: modelRect?.toJSON(),
            immediatelyBeforeModel: relay?.nextElementSibling === model,
            visuallyBeforeModel: Boolean(relayRect && modelRect && relayRect.right <= modelRect.left),
            titlebarEntry: Boolean(document.querySelector('[data-relay-trigger="titlebar"], .nmx-titlebar-relay')),
            embeddedEntry: Boolean(document.querySelector('.nmx-model-picker-popover > header > .nmx-model-picker-relay'))
        };
    })()`);
    expect(evidence.relayEntry.relay && evidence.relayEntry.model
        && evidence.relayEntry.immediatelyBeforeModel && evidence.relayEntry.visuallyBeforeModel,
    'composer relay control sits immediately to the left of the model control', evidence.relayEntry);
    expect(!evidence.relayEntry.titlebarEntry && !evidence.relayEntry.embeddedEntry,
        'legacy titlebar and embedded relay controls are absent', evidence.relayEntry);

    await click('[data-relay-trigger="composer"]');
    await waitFor(`Boolean(document.querySelector('.nmx-model-picker-popover .nmx-model-picker-relay-view .nmx-relay-popover'))`,
        'composer relay chooser opens in the shared picker surface');
    evidence.relaySwitch = await evaluate(`(() => {
        const picker = document.querySelector('.nmx-model-picker-popover');
        const relay = picker?.querySelector('.nmx-model-picker-relay-view .nmx-relay-popover');
        const trigger = document.querySelector('[data-relay-trigger="composer"]');
        const sortControls = [...(relay?.querySelectorAll('.nmx-relay-sort > button') || [])];
        const optionMetrics = [...(relay?.querySelectorAll('.nmx-relay-option-metrics') || [])];
        return {
            viewport: { width: innerWidth, height: innerHeight },
            picker: picker?.getBoundingClientRect().toJSON(),
            relay: relay?.getBoundingClientRect().toJSON(),
            expanded: trigger?.getAttribute('aria-expanded'),
            topLevelClose: Boolean(picker?.querySelector(':scope > header > button')),
            embeddedEntry: Boolean(picker?.querySelector(':scope > header > .nmx-model-picker-relay')),
            sortControlCount: sortControls.length,
            iconSortControls: sortControls.every(button => Boolean(button.querySelector('i')) && Boolean(button.title)),
            metricRowCount: optionMetrics.length,
            optionMetricsUseIcons: optionMetrics.every(metrics => metrics.querySelectorAll(':scope > span').length === 4
                && [...metrics.querySelectorAll(':scope > span')].every(metric => Boolean(metric.querySelector('i')) && Boolean(metric.title)))
        };
    })()`);
    expect(evidence.relaySwitch.picker
        && evidence.relaySwitch.picker.top >= 8 && evidence.relaySwitch.picker.left >= 8
        && evidence.relaySwitch.picker.right <= evidence.relaySwitch.viewport.width - 8
        && evidence.relaySwitch.picker.bottom <= evidence.relaySwitch.viewport.height - 8
        && evidence.relaySwitch.picker.width <= 360,
    'relay chooser stays compact and inside the viewport', evidence.relaySwitch);
    expect(evidence.relaySwitch.relay
        && evidence.relaySwitch.relay.left >= evidence.relaySwitch.picker.left
        && evidence.relaySwitch.relay.right <= evidence.relaySwitch.picker.right
        && evidence.relaySwitch.relay.top >= evidence.relaySwitch.picker.top
        && evidence.relaySwitch.relay.bottom <= evidence.relaySwitch.picker.bottom,
    'relay chooser remains bounded by the shared picker surface', evidence.relaySwitch);
    expect(evidence.relaySwitch.expanded === 'true', 'composer relay control reports its expanded state', evidence.relaySwitch);
    expect(!evidence.relaySwitch.topLevelClose && !evidence.relaySwitch.embeddedEntry,
        'relay view has neither a redundant close button nor an embedded relay entry', evidence.relaySwitch);
    expect(evidence.relaySwitch.sortControlCount === 4 && evidence.relaySwitch.iconSortControls
        && evidence.relaySwitch.metricRowCount > 0 && evidence.relaySwitch.optionMetricsUseIcons,
    'relay sorting and metrics use compact titled icons', evidence.relaySwitch);
    const outsideRelayPoint = {
        x: Math.max(6, evidence.relaySwitch.picker.left - 12),
        y: Math.max(70, evidence.relaySwitch.picker.top - 12)
    };
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...outsideRelayPoint });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...outsideRelayPoint, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...outsideRelayPoint, button: 'left', clickCount: 1 });
    await waitFor(`!document.querySelector('.nmx-model-picker-popover')`, 'blank click closes the composer relay chooser');
    evidence.relayOutsideClickClosed = true;
    await openPicker();
    await waitFor(`Boolean(document.querySelector('.nmx-model-picker-popover .nmx-model-picker-search'))`, 'model list reopens in place');

    let supportedSelector;
    try {
        supportedSelector = await waitFor(`(() => {
            const row = [...document.querySelectorAll('.nmx-model-option:not(.is-unsupported)')]
                .find(node => node.querySelector('em'));
            return row ? '.nmx-model-option[data-model-id="' + CSS.escape(row.dataset.modelId || '') + '"]' : '';
        })()`, 'supported model with reasoning effort');
    } catch (error) {
        const rows = await evaluate(`[...document.querySelectorAll('.nmx-model-option')].map(node => ({
            id: node.getAttribute('data-model-id'), gate: node.getAttribute('data-capability-gate'),
            text: node.innerText, html: node.innerHTML
        }))`);
        throw new Error(`${error instanceof Error ? error.message : String(error)}. Rows: ${JSON.stringify(rows)}`);
    }
    await move(supportedSelector);
    await waitFor(`Boolean(document.querySelector('.nmx-model-effort-menu'))`, 'reasoning effort menu appears on hover');
    const beforeBridge = await evaluate(`(() => {
        const row = document.querySelector(${JSON.stringify(supportedSelector)}).getBoundingClientRect();
        const menu = document.querySelector('.nmx-model-effort-menu');
        const rect = menu.getBoundingClientRect();
        const style = getComputedStyle(menu);
        return {
            row: row.toJSON(), rect: rect.toJSON(), side: menu.classList.contains('is-left') ? 'left' : 'right',
            overflowX: style.overflowX, overflowY: style.overflowY,
            scrollWidth: menu.scrollWidth, clientWidth: menu.clientWidth,
            scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight,
            zIndex: Number(style.zIndex), text: menu.innerText
        };
    })()`);
    expect(Math.abs(beforeBridge.rect.top - beforeBridge.row.top) <= 1, 'effort menu aligns with hovered model', beforeBridge);
    expect(beforeBridge.rect.left >= 8 && beforeBridge.rect.right <= evidence.normal.viewport.width - 8,
        'effort menu stays in viewport', beforeBridge);
    expect(beforeBridge.scrollWidth <= beforeBridge.clientWidth && beforeBridge.scrollHeight <= beforeBridge.clientHeight,
        'effort menu has no overflow scrollbars', beforeBridge);
    expect(beforeBridge.zIndex > 510, 'effort menu stays above model picker', beforeBridge);
    await move('.nmx-model-effort-menu > button');
    evidence.effortBridge = await evaluate(`(() => ({
        picker: Boolean(document.querySelector('.nmx-model-picker-popover')),
        menu: Boolean(document.querySelector('.nmx-model-effort-menu')),
        hovered: document.querySelector('.nmx-model-effort-menu')?.matches(':hover'),
        active: document.querySelector('.nmx-model-effort-menu > button.is-active')?.textContent?.trim()
    }))()`);
    expect(evidence.effortBridge.picker && evidence.effortBridge.menu && evidence.effortBridge.hovered,
        'pointer can move from model row into effort menu', evidence.effortBridge);

    await evaluate(`window.resizeTo(900, 620)`);
    await pause(550);
    await openPicker();
    evidence.compact = await pickerGeometry();
    assertPickerGeometry(evidence.compact, 'compact window');

    await click('[data-relay-trigger="composer"]');
    await waitFor(`Boolean(document.querySelector('.nmx-model-picker-popover .nmx-model-picker-relay-view .nmx-relay-popover'))`,
        'compact composer relay chooser');
    evidence.compactRelay = await evaluate(`(() => {
        const picker = document.querySelector('.nmx-model-picker-popover')?.getBoundingClientRect();
        const relay = document.querySelector('[data-relay-trigger="composer"]')?.getBoundingClientRect();
        const model = document.querySelector('.nmx-route-button')?.getBoundingClientRect();
        return picker ? {
            viewport: { width: innerWidth, height: innerHeight },
            picker: picker.toJSON(),
            relayBeforeModel: Boolean(relay && model && relay.right <= model.left),
            horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        } : undefined;
    })()`);
    expect(evidence.compactRelay?.picker.left >= 8
        && evidence.compactRelay.picker.right <= evidence.compactRelay.viewport.width - 8
        && evidence.compactRelay.picker.top >= 8
        && evidence.compactRelay.picker.bottom <= evidence.compactRelay.viewport.height - 8,
    'relay chooser remains inside the compact viewport', evidence.compactRelay);
    expect(evidence.compactRelay?.relayBeforeModel && evidence.compactRelay.horizontalOverflow === 0,
        'compact composer keeps relay left of model without horizontal overflow', evidence.compactRelay);

    const compactOutsideY = Math.max(70, evidence.compactRelay.picker.top - 16);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 6, y: compactOutsideY });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 6, y: compactOutsideY, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 6, y: compactOutsideY, button: 'left', clickCount: 1 });
    await waitFor(`!document.querySelector('.nmx-model-picker-popover') && !document.querySelector('.nmx-model-effort-menu')`, 'blank click closes picker');
    evidence.blankClickClosed = true;
    passed = true;
} finally {
    if (originalWindow) {
        await evaluate(`window.resizeTo(${Number(originalWindow.innerWidth)}, ${Number(originalWindow.innerHeight)})`).catch(() => undefined);
        await pause(350);
    }
    if (pickerWasOpen) await openPicker().catch(() => undefined);
    else if (await evaluate(`Boolean(document.querySelector('.nmx-model-picker-popover'))`).catch(() => false)) {
        await evaluate(`(() => {
            const relay = document.querySelector('[data-relay-trigger="composer"]');
            if (relay?.getAttribute('aria-expanded') === 'true') relay.click();
            else document.querySelector('.nmx-route-button')?.click();
        })()`).catch(() => undefined);
    }
    if (qaRoute) await removeExactOfficialQaRoute({ evaluate, route: qaRoute }).catch(() => undefined);
    socket.close();
}

const compactGeometryEvidence = state => state ? {
    viewport: state.viewport,
    rect: state.rect,
    rowCount: state.rows.length,
    supportedCount: state.rows.filter(row => row.supported).length,
    unsupportedCount: state.rows.filter(row => !row.supported).length,
    namesBounded: state.rows.every(row => row.whiteSpace === 'nowrap' && row.overflow === 'hidden'),
    enabledText: state.enabledText,
    unsupportedLabel: state.unsupportedLabel,
    documentOverflow: state.documentOverflow
} : state;
console.log(JSON.stringify({
    passed,
    evidence: {
        normal: compactGeometryEvidence(evidence.normal),
        relayEntry: evidence.relayEntry,
        relaySwitch: evidence.relaySwitch,
        relayOutsideClickClosed: evidence.relayOutsideClickClosed,
        effortBridge: evidence.effortBridge,
        compact: compactGeometryEvidence(evidence.compact),
        compactRelay: evidence.compactRelay,
        blankClickClosed: evidence.blankClickClosed
    }
}, undefined, 2));
