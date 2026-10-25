#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const durationMs = Math.max(1_000, Number(process.env.NEXTMUX_RECORD_MS || 4_000));
const exerciseScroll = process.env.NEXTMUX_RECORD_SCROLL === '1';
const exerciseTerminalToggle = process.env.NEXTMUX_RECORD_TERMINAL_TOGGLE === '1';
const outputDirectory = resolve(process.argv[2] || 'artifacts/desktop-temporal');
const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) throw new Error(`No Electron page is available on CDP port ${cdpPort}.`);

await mkdir(outputDirectory, { recursive: true });
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const frames = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
    return;
  }
  if (message.method === 'Page.screencastFrame') {
    frames.push({ data: message.params.data, metadata: message.params.metadata });
    socket.send(JSON.stringify({ id: ++sequence, method: 'Page.screencastFrameAck', params: { sessionId: message.params.sessionId } }));
  }
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

await call('Page.enable');
await call('Page.bringToFront');
await call('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
if (exerciseScroll) {
  const point = await evaluate(`(() => {
    const node = document.querySelector('.nmx-task-view');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error('The conversation scroller is unavailable.');
  for (let index = 0; index < 20; index += 1) {
    await call('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: index < 10 ? 180 : -180
    });
    await wait(32);
  }
}
if (exerciseTerminalToggle) {
  for (let index = 0; index < 4; index += 1) {
    const point = await evaluate(`(() => {
      const node = [...document.querySelectorAll('.nmx-workspace-controls button')]
        .find(button => /terminal|终端|ターミナル/i.test((button.getAttribute('aria-label') || '') + (button.title || '')));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error('The terminal drawer toggle is unavailable.');
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await wait(420);
  }
}
await wait(durationMs);
await call('Page.stopScreencast');

for (let index = 0; index < frames.length; index += 1) {
  await writeFile(resolve(outputDirectory, `frame-${String(index).padStart(4, '0')}.png`), Buffer.from(frames[index].data, 'base64'));
}
await writeFile(resolve(outputDirectory, 'frames.json'), JSON.stringify(frames.map((frame, index) => ({ index, ...frame.metadata })), undefined, 2));
console.log(JSON.stringify({ outputDirectory, durationMs, exerciseScroll, exerciseTerminalToggle, frames: frames.length }, undefined, 2));
socket.close();
