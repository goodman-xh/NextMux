#!/usr/bin/env node

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

async function waitFor(expression, label) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function center(selector, index = 0) {
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

async function moveTo(point) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await pause(180);
}

async function clickAt(point) {
    await moveTo(point);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(260);
}

await call('Page.enable');
await call('Page.bringToFront');
await call('Emulation.setFocusEmulationEnabled', { enabled: true });
await call('Page.setWebLifecycleState', { state: 'active' });
await call('Page.reload', { ignoreCache: true });
await waitFor(`Boolean(document.querySelector('.nmx-titlebar-primary-nav'))`, 'titlebar navigation');
await pause(650);

for (const index of [0, 1, 2, 1]) {
    await clickAt(await center('.nmx-titlebar-primary-nav button', index));
    const active = await evaluate(`[...document.querySelectorAll('.nmx-titlebar-primary-nav button')].findIndex(node => node.classList.contains('is-active'))`);
    expect(active === index, 'titlebar section switch', { expected: index, active });
}

await waitFor(`document.querySelectorAll('.nmx-thread-file-row').length > 0`, 'project file rail');
const collapsed = await evaluate(`(() => {
    const rail = document.querySelector('.nmx-thread-files > div');
    const compact = [...document.querySelectorAll('.nmx-thread-file-compact')].slice(0, 12).map(node => node.textContent);
    return { width: rail.getBoundingClientRect().width, compact, legacyRailButtons: document.querySelectorAll('.nmx-rail-button').length, workspaceWidth: document.querySelector('.nmx-workspace').getBoundingClientRect().width };
})()`);
expect(collapsed.width <= 44, 'collapsed file rail width', collapsed);
expect(collapsed.legacyRailButtons === 0, 'legacy left navigation removed', collapsed);
expect(collapsed.compact.length > 0 && collapsed.compact.every(label => Array.from(label).length <= 5 && label.endsWith('...')), 'two-character file labels with three dots', collapsed);

await moveTo(await center('.nmx-thread-files > div'));
const expanded = await evaluate(`(() => {
    const rail = document.querySelector('.nmx-thread-files > div');
    const labels = [...document.querySelectorAll('.nmx-thread-file-name')].slice(0, 20).map(node => ({ text: node.textContent, display: getComputedStyle(node).display }));
    return { width: rail.getBoundingClientRect().width, labels };
})()`);
expect(expanded.width >= 160, 'hover expands file rail', expanded);
expect(expanded.labels.length > 0 && expanded.labels.every(label => label.display !== 'none' && Array.from(label.text).length <= 10), 'expanded file labels', expanded);

const filePoint = await evaluate(`(() => {
    const scroller = document.querySelector('.nmx-thread-files > div > section');
    scroller.scrollTop = scroller.scrollHeight;
    const bounds = scroller.getBoundingClientRect();
    const rows = [...scroller.querySelectorAll('.nmx-thread-file-row:not([aria-expanded])')].filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const node = rows.at(-1);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, name: node.getAttribute('aria-label') };
})()`);
expect(Boolean(filePoint), 'visible file row', filePoint);
await clickAt(filePoint);
await waitFor(`Boolean(document.querySelector('.nmx-work-context .nmx-context-file-preview'))`, 'file preview drawer');
const preview = await evaluate(`(() => ({
    title: document.querySelector('.nmx-work-context > header strong')?.textContent,
    preview: Boolean(document.querySelector('.nmx-context-file-preview .nmx-monaco-file-editor, .nmx-context-file-preview pre, .nmx-context-file-preview .nmx-file-preview-state')),
    drawerTabs: document.querySelectorAll('.nmx-work-context-tabs').length,
    drawerFileTree: document.querySelectorAll('.nmx-context-file-list').length,
    dynamicFileRail: document.querySelectorAll('.nmx-thread-files').length,
    workspaceWidth: document.querySelector('.nmx-workspace').getBoundingClientRect().width,
    drawerWidth: document.querySelector('.nmx-work-context').getBoundingClientRect().width,
    drawerPosition: getComputedStyle(document.querySelector('.nmx-work-context')).position
}))()`);
expect(preview.title === filePoint.name && preview.preview, 'file opens in right preview', { filePoint, preview });
expect(preview.drawerTabs === 0 && preview.drawerFileTree === 1, 'drawer keeps one fixed file list beside the editor', preview);
expect(preview.dynamicFileRail === 0, 'dynamic conversation file rail is hidden while the fixed drawer list is visible', preview);
expect(Math.abs((collapsed.workspaceWidth - preview.workspaceWidth) - preview.drawerWidth) <= 2 && preview.drawerPosition === 'absolute', 'drawer reduces the full conversation layout by its width', { collapsed, preview });

await clickAt(await center('.nmx-file-editor-tab button'));
await waitFor(`Boolean(document.querySelector('.nmx-context-file-list')) && !document.querySelector('.nmx-monaco-file-editor')`, 'fixed file list remains after the preview closes');
const closedPreview = await evaluate(`({ drawer: Boolean(document.querySelector('.nmx-work-context')), fixedFileList: Boolean(document.querySelector('.nmx-context-file-list')), filePreview: Boolean(document.querySelector('.nmx-monaco-file-editor')), dynamicFileRail: Boolean(document.querySelector('.nmx-thread-files')) })`);
expect(closedPreview.drawer && closedPreview.fixedFileList && !closedPreview.filePreview && !closedPreview.dynamicFileRail, 'closing a file keeps the fixed list and avoids a duplicate dynamic list', closedPreview);

const closeButtons = await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button').length`);
await clickAt(await center('.nmx-work-context > header nav button', closeButtons - 1));
await waitFor(`!document.querySelector('.nmx-work-context')`, 'drawer closes');
await clickAt(await center('.nmx-workspace-controls button', 1));
await waitFor(`Boolean(document.querySelector('.nmx-work-context .nmx-context-browser'))`, 'browser-only drawer');
const browserState = await evaluate(`({ browser: Boolean(document.querySelector('.nmx-context-browser')), filePreview: Boolean(document.querySelector('.nmx-context-file-preview')), fixedFileList: Boolean(document.querySelector('.nmx-context-file-list')) })`);
expect(browserState.browser && !browserState.filePreview && !browserState.fixedFileList, 'browser drawer contains only the project browser', browserState);
const browserCloseButtons = await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button').length`);
await clickAt(await center('.nmx-work-context > header nav button', browserCloseButtons - 1));
await waitFor(`!document.querySelector('.nmx-work-context')`, 'browser drawer closes');

socket.close();
console.log(JSON.stringify({ passed: true, collapsed, expanded, openedFile: filePoint.name, preview, closedPreview, browserState }, undefined, 2));
