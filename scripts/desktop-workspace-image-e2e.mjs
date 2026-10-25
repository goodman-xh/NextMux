#!/usr/bin/env node

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const port = process.env.NEXTMUX_CDP_PORT || '9222';
const fixtureName = '_nmx_workspace_image_e2e.png';
const fixturePath = join(process.cwd(), fixtureName);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

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

async function waitFor(expression, label, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
}

async function center(selector) {
    return waitFor(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node || node.disabled) return null;
        node.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`, selector);
}

async function click(selector) {
    const point = await center(selector);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(180);
}

await writeFile(fixturePath, png);
let snapshot;
let passed = false;
const evidence = {};

try {
    await call('Page.enable');
    await call('Page.bringToFront');
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Page.setWebLifecycleState', { state: 'active' });
    await waitFor(`Boolean(document.querySelector('.nmx-workspace'))`, 'desktop workspace');

    snapshot = await evaluate(`({
        terminalOpen: Boolean(document.querySelector('.nmx-terminal-drawer')),
        workContextOpen: Boolean(document.querySelector('.nmx-work-context')),
        nativeDialogs: document.querySelectorAll('.dialogOverlay, .theia-dialog, .dialog-shell').length
    })`);
    if (snapshot.terminalOpen) await click('.nmx-workspace-controls button:first-child');
    if (snapshot.workContextOpen) {
        const count = await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button').length`);
        await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button')[${count - 1}]?.click()`);
        await waitFor(`!document.querySelector('.nmx-work-context')`, 'close existing drawer');
    }
    await waitFor(`Boolean(document.querySelector('.nmx-thread-files'))`, 'project file rail');

    await waitFor(`Boolean(document.querySelector('.nmx-thread-files header button:not(:disabled)'))`, 'file rail refresh is ready');
    await evaluate(`document.querySelector('.nmx-thread-files header button:not(:disabled)')?.click()`);
    await waitFor(`Boolean([...document.querySelectorAll('.nmx-thread-file-row')].find(node => node.getAttribute('aria-label') === ${JSON.stringify(fixtureName)}))`, 'image fixture in file rail');
    await evaluate(`(() => {
        const node = [...document.querySelectorAll('.nmx-thread-file-row')].find(candidate => candidate.getAttribute('aria-label') === ${JSON.stringify(fixtureName)});
        node?.scrollIntoView({ block: 'center' });
        node?.click();
    })()`);
    await waitFor(`document.querySelector('.nmx-context-image-preview img')?.complete && document.querySelector('.nmx-context-image-preview img')?.naturalWidth > 0`, 'workspace image preview');

    const preview = await evaluate(`(() => {
        const image = document.querySelector('.nmx-context-image-preview img');
        const canvas = document.querySelector('.nmx-context-image-canvas');
        const drawer = document.querySelector('.nmx-work-context');
        const rect = image?.getBoundingClientRect();
        const bounds = drawer?.getBoundingClientRect();
        return {
            name: document.querySelector('.nmx-file-editor-tab strong')?.textContent,
            mime: document.querySelector('.nmx-context-image-preview footer span')?.textContent,
            naturalWidth: image?.naturalWidth,
            naturalHeight: image?.naturalHeight,
            contained: Boolean(rect && bounds && rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom),
            zoomCursor: canvas ? getComputedStyle(canvas).cursor : '',
            monaco: Boolean(document.querySelector('.nmx-monaco-file-editor')),
            nativeDialogs: document.querySelectorAll('.dialogOverlay, .theia-dialog, .dialog-shell').length
        };
    })()`);
    expect(preview.name === fixtureName && preview.mime === 'image/png', 'image metadata', preview);
    expect(preview.naturalWidth === 1 && preview.naturalHeight === 1 && preview.contained, 'image is loaded and contained', preview);
    expect(preview.zoomCursor === 'zoom-in' && !preview.monaco, 'image bypasses the text editor', preview);
    expect(preview.nativeDialogs === snapshot.nativeDialogs, 'no native binary-file dialog', { snapshot, preview });
    evidence.preview = preview;

    await click('.nmx-context-image-canvas');
    await waitFor(`document.querySelector('.nmx-attachment-lightbox img')?.complete && document.querySelector('.nmx-attachment-lightbox img')?.naturalWidth > 0`, 'image lightbox');
    evidence.lightbox = await evaluate(`({ open: Boolean(document.querySelector('.nmx-attachment-lightbox')), name: document.querySelector('.nmx-attachment-lightbox strong')?.textContent })`);
    await click('.nmx-attachment-lightbox header button');
    await waitFor(`!document.querySelector('.nmx-attachment-lightbox')`, 'close image lightbox');

    await click('.nmx-context-image-preview footer button');
    await waitFor(`Boolean([...document.querySelectorAll('.nmx-attachment-chips > span')].find(node => node.textContent.includes(${JSON.stringify(fixtureName)})))`, 'image added to composer');
    evidence.addedToComposer = await evaluate(`(() => {
        const chip = [...document.querySelectorAll('.nmx-attachment-chips > span')].find(node => node.textContent.includes(${JSON.stringify(fixtureName)}));
        const composer = document.querySelector('.nmx-composer');
        const chipRect = chip?.getBoundingClientRect();
        const composerRect = composer?.getBoundingClientRect();
        return { present: Boolean(chip), outsideEditor: Boolean(chipRect && composerRect && chipRect.bottom <= composerRect.top + 1) };
    })()`);
    expect(evidence.addedToComposer.present, 'image attachment chip');
    await evaluate(`(() => {
        const chip = [...document.querySelectorAll('.nmx-attachment-chips > span')].find(node => node.textContent.includes(${JSON.stringify(fixtureName)}));
        chip?.querySelector('.nmx-attachment-remove')?.click();
    })()`);
    await waitFor(`![...document.querySelectorAll('.nmx-attachment-chips > span')].some(node => node.textContent.includes(${JSON.stringify(fixtureName)}))`, 'remove image fixture from composer');
    passed = true;
} finally {
    try {
        await evaluate(`(() => {
            document.querySelector('.nmx-attachment-lightbox header button')?.click();
            const chip = [...document.querySelectorAll('.nmx-attachment-chips > span')].find(node => node.textContent.includes(${JSON.stringify(fixtureName)}));
            chip?.querySelector('.nmx-attachment-remove')?.click();
            document.querySelector('.nmx-file-editor-tab button')?.click();
        })()`);
        if (snapshot?.terminalOpen && !await evaluate(`Boolean(document.querySelector('.nmx-terminal-drawer'))`)) {
            await click('.nmx-workspace-controls button:first-child');
        }
        if (!snapshot?.workContextOpen && await evaluate(`Boolean(document.querySelector('.nmx-work-context'))`)) {
            const count = await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button').length`);
            await evaluate(`document.querySelectorAll('.nmx-work-context > header nav button')[${count - 1}]?.click()`);
        }
    } catch {
        // Preserve the primary failure; disk cleanup still runs.
    }
    await rm(fixturePath, { force: true });
    try { await evaluate(`document.querySelector('.nmx-thread-files header button')?.click()`); } catch { }
    socket.close();
}

console.log(JSON.stringify({ passed, fixtureName, evidence }, undefined, 2));
