#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { parseNextMuxDeepLink } = require('../apps/desktop/deep-link.cjs');
const deepLink = process.env.NEXTMUX_DEVICE_LINK_E2E_DEEP_LINK || '';
const expectedIdentity = process.env.NEXTMUX_DEVICE_LINK_E2E_EXPECTED_IDENTITY || '';
const parsed = parseNextMuxDeepLink(deepLink);
if (!parsed) throw new Error('NEXTMUX_DEVICE_LINK_E2E_DEEP_LINK must be a strict NextMux device-link callback URL.');
if (!expectedIdentity) throw new Error('NEXTMUX_DEVICE_LINK_E2E_EXPECTED_IDENTITY is required.');

const port = process.env.NEXTMUX_CDP_PORT || '9222';
const endpoint = `http://127.0.0.1:${port}/json`;
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));

async function pageTarget(timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(endpoint).then(response => response.json());
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await pause(120);
  }
  throw new Error(`No desktop page became available on CDP port ${port}.`);
}

let existingTarget;
try { existingTarget = await pageTarget(400); } catch {}
const packagedExecutable = process.env.NEXTMUX_PACKAGED_EXECUTABLE || '';
const electronExecutable = packagedExecutable || require('electron');
const sourceArgs = packagedExecutable ? [] : [resolve(repositoryRoot, 'apps/desktop')];
const launchArgs = existingTarget
  ? [...sourceArgs, parsed.url]
  : packagedExecutable
    ? [parsed.url, `--remote-debugging-port=${port}`]
    : [`--remote-debugging-port=${port}`, ...sourceArgs, parsed.url];
const child = spawn(electronExecutable, launchArgs, { cwd: repositoryRoot, stdio: 'ignore', windowsHide: true });
child.unref();

const target = existingTarget || await pageTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
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
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
};
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};

const startedAt = Date.now();
const deadline = startedAt + Number(process.env.NEXTMUX_DEVICE_LINK_E2E_TIMEOUT_MS || 15_000);
let account;
while (Date.now() < deadline) {
  account = await evaluate(`(() => {
    const avatar = document.querySelector('.nmx-account-avatar.is-linked');
    const trigger = avatar?.closest('.nmx-account-trigger');
    return avatar ? { linked: true, text: trigger?.textContent?.trim().replace(/\\s+/g, ' ') || '' } : null;
  })()`);
  if (account?.linked && account.text.includes(expectedIdentity)) break;
  await pause(100);
}
socket.close();
if (!account?.linked || !account.text.includes(expectedIdentity)) {
  throw new Error(`Desktop account did not refresh after the deep link: ${JSON.stringify(account)}`);
}
const elapsedMs = Date.now() - startedAt;
const immediateThreshold = Number(process.env.NEXTMUX_DEVICE_LINK_E2E_IMMEDIATE_MS || 2_900);
if (existingTarget && elapsedMs >= immediateThreshold) {
  throw new Error(`Desktop refresh took ${elapsedMs}ms, which is not earlier than the ${immediateThreshold}ms polling fallback.`);
}
process.stdout.write(`${JSON.stringify({ ok: true, mode: existingTarget ? 'second-instance' : 'cold-start', elapsedMs, account })}\n`);
