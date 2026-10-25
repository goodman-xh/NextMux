#!/usr/bin/env node

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const workspace = process.env.NEXTMUX_E2E_WORKSPACE || process.cwd();
const mode = process.argv.includes('--cancel') ? 'cancel' : 'complete';
const marker = `NM_ACP_${mode.toUpperCase()}_${Date.now()}`;
const inputPath = join(workspace, 'input.txt');
const outputPath = join(workspace, 'output.txt');
const input = `acp-desktop-${marker}\n`;

await writeFile(inputPath, input, { encoding: 'utf8', flag: 'wx' });
await rm(outputPath, { force: true });

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
  const promise = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) promise.reject(new Error(message.error.message));
  else promise.resolve(message.result);
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};
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

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-composer textarea:not(:disabled)'))`),
    Boolean,
    20_000,
    'ready composer',
  );

  const hasFullAccess = await evaluate(`/Full Access|完全访问|フルアクセス|전체 액세스/i.test(document.querySelector('.nmx-permission-button')?.innerText || '')`);
  if (!hasFullAccess) {
    await evaluate(`document.querySelector('.nmx-permission-button')?.click()`);
    await waitFor(
      () => evaluate(`Boolean([...document.querySelectorAll('.nmx-permission-popover button')].find(node => /Full Access|完全访问|フルアクセス|전체 액세스/i.test(node.innerText || '')))`),
      Boolean,
      5_000,
      'full-access option',
    );
    await evaluate(`[...document.querySelectorAll('.nmx-permission-popover button')].find(node => /Full Access|完全访问|フルアクセス|전체 액세스/i.test(node.innerText || ''))?.click()`);
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-permission-sheet .nmx-primary-button'))`),
      Boolean,
      5_000,
      'full-access confirmation',
    );
    await evaluate(`document.querySelector('.nmx-permission-sheet .nmx-primary-button')?.click()`);
  }

  const prompt = mode === 'cancel' ? `WAIT_FOR_CANCEL ${marker}` : `Run ACP desktop conformance ${marker}`;
  const composerFocused = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
    if (!textarea) return false;
    textarea.focus();
    textarea.select?.();
    return true;
  })()`);
  if (!composerFocused) throw new Error('Composer could not be focused.');
  await call('Input.insertText', { text: prompt });
  await waitFor(
    () => evaluate(`!document.querySelector('.nmx-send-button')?.disabled`),
    Boolean,
    5_000,
    'enabled send button',
  );
  await evaluate(`document.querySelector('.nmx-send-button')?.click()`);

  const readTurn = () => evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
    return {
      running: Boolean(document.querySelector('.nmx-stop-glyph')),
      text: turn?.innerText || '',
      className: turn?.querySelector('.nmx-agent-message')?.className || ''
    };
  })()`);
  const progress = await waitFor(readTurn, state => /Inspecting the workspace|waiting for cancellation/i.test(state.text), 20_000, 'ACP streamed progress');
  if (mode === 'cancel') {
    await evaluate(`document.querySelector('.nmx-send-button')?.click()`);
    await waitFor(readTurn, state => !state.running && /Task stopped|任务已停止|タスクを停止/i.test(state.text), 15_000, 'ACP cancellation');
  } else {
    await waitFor(readTurn, state => !state.running && /Task completed|任务已完成|タスク完了/i.test(state.text), 30_000, 'ACP completion');
  }
  const final = await readTurn();
  const output = mode === 'complete' ? await readFile(outputPath, 'utf8') : '';
  const pass = mode === 'cancel'
    ? final.className.includes('is-cancelled') && !output
    : final.className.includes('is-complete')
      && output === `copied:${input}`
      && /Read input\.txt|读取 input\.txt/i.test(final.text)
      && /Run terminal check|运行终端检查/i.test(final.text)
      && /output\.txt/i.test(final.text);
  console.log(JSON.stringify({
    mode,
    marker,
    progressVisibleAfterMs: progress.elapsedMs,
    streamedProgress: progress.value.text.includes('Inspecting the workspace') || progress.value.text.includes('waiting for cancellation'),
    outputVerified: mode === 'complete' ? output === `copied:${input}` : undefined,
    checkpointVisible: /output\.txt/i.test(final.text),
    finalState: final.className,
    pass,
  }, undefined, 2));
  if (!pass) process.exitCode = 1;
} finally {
  socket.close();
  await rm(inputPath, { force: true });
  await rm(outputPath, { force: true });
}
