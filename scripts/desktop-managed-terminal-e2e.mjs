#!/usr/bin/env node

import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
} from './desktop-official-qa-route.mjs';
import { throwPrimaryOrCleanupErrors } from './desktop-e2e-state.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const marker = `NM_MANAGED_PTY_E2E_${Date.now()}`;
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
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
let qaRoute;
let primaryError;
const cleanupErrors = [];
try {
qaRoute = await ensureExactOfficialQaRoute({
  evaluate,
  config: officialQaRouteConfig(process.env, `managed-terminal-${Date.now()}`),
});
const route = await evaluate(`(() => {
  const button = document.querySelector('.nmx-route-button');
  return { modelId: button?.getAttribute('data-model-id') || '', label: button?.textContent || '' };
})()`);
if (route.modelId !== qaRoute.modelId) {
  throw new Error(`The deterministic QA model must be selected before this regression. Current route: ${JSON.stringify(route)}`);
}
const permission = await evaluate(`document.querySelector('.nmx-permission-button')?.textContent || ''`);
if (!/Full Access|完全访问|フルアクセス|전체 액세스/i.test(permission)) {
  await evaluate(`document.querySelector('.nmx-permission-button')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-permission-popover button:nth-of-type(3)'))`),
    Boolean,
    5_000,
    'full-access permission option'
  );
  await evaluate(`document.querySelector('.nmx-permission-popover button:nth-of-type(3)')?.click()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-permission-sheet .nmx-primary-button'))`),
    Boolean,
    5_000,
    'full-access confirmation'
  );
  await evaluate(`document.querySelector('.nmx-permission-sheet .nmx-primary-button')?.click()`);
  await waitFor(
    () => evaluate(`/Full Access|完全访问|フルアクセス|전체 액세스/i.test(document.querySelector('.nmx-permission-button')?.textContent || '')`),
    Boolean,
    5_000,
    'full-access permission persistence'
  );
}
const ready = await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
  if (!textarea || document.querySelector('.nmx-stop-glyph')) return false;
  const prompt = ${JSON.stringify('MARKER：在当前对话验证真实交互终端。先逐步说明进度，再使用 process.start 打开设置中选择的终端，以 process.write 执行 echo，使用 process.read 的序列游标读取结果，最后 process.terminate 清理进程并总结。'.replace('MARKER', marker))};
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, prompt);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
if (!ready) throw new Error('The current NextMux conversation is not ready for a managed-terminal task.');
await waitFor(
  () => evaluate(`Boolean(document.querySelector('.nmx-send-button:not(:disabled)'))`),
  Boolean,
  5_000,
  'enabled send button'
);
// Let the controlled textarea value and the route selection settle through
// React's next render frame before resolving the physical send target.
await wait(300);
// Use the real pointer path here.  React's delegated click handler can ignore
// a synthetic DOM click while the route picker has just committed state.
const sendTarget = await evaluate(`(() => {
  const button = document.querySelector('.nmx-send-button:not(:disabled)');
  const rect = button?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : undefined;
})()`);
if (!sendTarget) throw new Error('Unable to submit the managed-terminal task.');
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sendTarget.x, y: sendTarget.y });
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });

const readState = () => evaluate(`(() => {
  const marker = ${JSON.stringify(marker)};
  const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.textContent || '').includes(marker));
  const terminal = document.querySelector('.nmx-terminal-list article');
  const xterm = document.querySelector('.nmx-terminal-host .xterm');
  const xtermInput = document.querySelector('.nmx-terminal-host .xterm-helper-textarea');
  return {
    running: Boolean(document.querySelector('.nmx-stop-glyph')),
    complete: Boolean(turn?.querySelector('.nmx-agent-message.is-complete')),
    text: turn?.innerText || '',
    narrations: [...(turn?.querySelectorAll('.nmx-agent-narration') || [])].map(node => (node.textContent || '').trim()).filter(Boolean),
    activities: [...(turn?.querySelectorAll('.nmx-agent-activity article') || [])].map(node => (node.textContent || '').trim()),
    drawerOpen: document.querySelector('.nmx-terminal-drawer')?.classList.contains('is-open') || false,
    terminalPresent: Boolean(terminal),
    terminalWritable: Boolean(xtermInput) && !xtermInput.disabled && !xtermInput.readOnly,
    terminalXtermPresent: Boolean(xterm),
    terminalText: xterm?.textContent || '',
  };
})()`);

const running = await waitFor(readState, state => state.running && state.narrations.length > 0, 45_000, 'natural terminal progress');
if (!running.value.drawerOpen) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => /Open Terminal|打开终端|ターミナル|터미널|Terminal/i.test(node.getAttribute('aria-label') || ''));
    button?.click();
    return Boolean(button);
  })()`);
}
const liveTerminal = await waitFor(async () => {
  await evaluate(`document.querySelector('.nmx-terminal-list article .nmx-terminal-select')?.click()`);
  return readState();
}, state => state.terminalPresent && state.terminalWritable && state.terminalXtermPresent, 10_000, 'live shared terminal xterm');
const completed = await waitFor(readState, state => !state.running && state.complete && state.text.includes(marker), 180_000, 'managed terminal completion');

const narrationText = completed.value.narrations.join('\n');
const report = {
  marker,
  selectedRoute: route.label.trim(),
  selectedModelId: route.modelId,
  naturalProgressVisibleAfterMs: running.elapsedMs,
  liveTaskTerminalVisibleAfterMs: liveTerminal.elapsedMs,
  taskXtermWasWritable: liveTerminal.value.terminalWritable,
  taskXtermWasReal: liveTerminal.value.terminalXtermPresent,
  narrationStages: completed.value.narrations,
  modelReadMarker: completed.value.text.includes('真实终端已完成输入、实时输出、模型游标读取与进程清理'),
  taskStopped: !completed.value.running,
  intentionalCleanupShownAsFailure: /(?:执行|執行|run|failed|失敗|실패|falló|échec|fehlgeschlagen|falha|ошибка|فشل|विफल).*?(?:失败|失敗|failed|실패|falló|échec|fehlgeschlagen|falha|ошибка|فشل|विफल)/i.test(completed.value.text),
  checks: {
    liveWritable: liveTerminal.value.terminalWritable,
    liveXterm: liveTerminal.value.terminalXtermPresent,
    narrationCount: completed.value.narrations.length,
    hasStartNarration: /process[.]start|启动|終端|terminal/i.test(narrationText),
    hasCompleteStartNarration: narrationText.includes('正在启动所选终端，并验证实时输出能被界面和模型同时读取。'),
    hasWriteNarration: /process[.]write|写入|命令|input/i.test(narrationText),
    hasReadText: /process[.]read|游标|序列|cursor/i.test(completed.value.text),
    hasTerminateText: /process[.]terminate|终止|清理|terminate/i.test(completed.value.text),
    hasMarker: completed.value.text.includes(marker),
  },
  pass: liveTerminal.value.terminalWritable
    && liveTerminal.value.terminalXtermPresent
    && completed.value.narrations.length >= 4
    && /process[.]start|启动|終端|terminal/i.test(narrationText)
    && narrationText.includes('正在启动所选终端，并验证实时输出能被界面和模型同时读取。')
    && /process[.]write|写入|命令|input/i.test(narrationText)
    && /process[.]read|游标|序列|cursor/i.test(completed.value.text)
    && /process[.]terminate|终止|清理|terminate/i.test(completed.value.text)
    && completed.value.text.includes(marker)
    && !/(?:执行|執行|run|failed|失敗|실패|falló|échec|fehlgeschlagen|falha|ошибка|فشل|विफल).*?(?:失败|失敗|failed|실패|falló|échec|fehlgeschlagen|falha|ошибка|فشل|विफल)/i.test(completed.value.text),
};
console.log(JSON.stringify(report, undefined, 2));
if (!report.pass) throw new Error(`Managed-terminal E2E assertions failed for ${marker}; see the emitted report.`);
} catch (error) {
  primaryError = error;
} finally {
  let running = false;
  try {
    running = await evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (running) {
    await evaluate(`document.querySelector('.nmx-stop-button, .nmx-send-button')?.click()`)
      .catch(error => cleanupErrors.push(error));
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`),
      value => !value,
      15_000,
      'failed managed-terminal task cleanup',
    ).catch(error => cleanupErrors.push(error));
  }
  if (qaRoute) {
    await removeExactOfficialQaRoute({ evaluate, route: qaRoute })
      .catch(error => cleanupErrors.push(error));
  }
  socket.close();
}

throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, 'Managed-terminal E2E');
