#!/usr/bin/env node

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const modelId = process.env.NEXTMUX_E2E_MODEL_ID || 'custom_openai/gpt-5.6-sol';
const expectedLabel = process.env.NEXTMUX_E2E_MODEL_LABEL || 'GPT 5.6 Sol';
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
    if (predicate(value)) return value;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  const current = await evaluate(`document.querySelector('.nmx-route-button span')?.textContent?.trim() || ''`);
  if (current !== expectedLabel) {
    await evaluate(`(() => {
      if (!document.querySelector('.nmx-model-picker-popover')) document.querySelector('.nmx-route-button')?.click();
      return true;
    })()`);
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-model-picker-popover'))`),
      Boolean,
      5_000,
      'model picker'
    );
    await evaluate(`(() => {
      const input = document.querySelector('.nmx-model-picker-search input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(expectedLabel)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-model-option[data-model-id=${JSON.stringify(modelId)}] > button:not(:disabled)'))`),
      Boolean,
      5_000,
      'requested E2E model option'
    );
    const selected = await evaluate(`(() => {
      const option = document.querySelector('.nmx-model-option[data-model-id=${JSON.stringify(modelId)}] > button:not(:disabled)');
      option?.click();
      return Boolean(option);
    })()`);
    if (!selected) throw new Error(`The requested E2E model is unavailable: ${modelId}`);
  }
  const route = await waitFor(
    () => evaluate(`document.querySelector('.nmx-route-button span')?.textContent?.trim() || ''`),
    value => value === expectedLabel,
    5_000,
    'selected E2E model'
  );
  console.log(JSON.stringify({ modelId, route, pass: true }, undefined, 2));
} finally {
  socket.close();
}
