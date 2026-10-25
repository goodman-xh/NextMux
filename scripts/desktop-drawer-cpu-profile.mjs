#!/usr/bin/env node

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const targetDrawer = process.argv.includes('--terminal') ? 'terminal' : 'work-context';
const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) throw new Error('No Electron page is available.');

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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result?.value;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await Promise.all([call('Runtime.enable'), call('Profiler.enable'), call('Page.enable')]);
await call('Page.bringToFront');
await evaluate(`(() => {
  if (document.querySelector('.nmx-terminal-drawer')) document.querySelector('.nmx-workspace-controls button:first-child')?.click();
  document.querySelector('.nmx-work-context > header > nav button:last-child')?.click();
})()`);
await wait(350);

await call('Profiler.setSamplingInterval', { interval: 100 });
await call('Profiler.start');
await evaluate(`document.querySelector(${JSON.stringify(targetDrawer === 'terminal'
  ? '.nmx-workspace-controls button:first-child'
  : '.nmx-workspace-controls button:last-child')})?.click()`);
await wait(600);
const { profile } = await call('Profiler.stop');

const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const totals = new Map();
for (let index = 0; index < (profile.samples || []).length; index += 1) {
  const nodeId = profile.samples[index];
  const duration = profile.timeDeltas?.[index] || 0;
  totals.set(nodeId, (totals.get(nodeId) || 0) + duration);
}
const top = [...totals.entries()]
  .map(([nodeId, duration]) => {
    const frame = nodes.get(nodeId)?.callFrame || {};
    return {
      durationMs: duration / 1000,
      functionName: frame.functionName || '(anonymous)',
      url: String(frame.url || '').replace(/^file:\/\/\//, ''),
      line: Number(frame.lineNumber || 0) + 1
    };
  })
  .filter(entry => entry.durationMs >= .5)
  .sort((left, right) => right.durationMs - left.durationMs)
  .slice(0, 40);

console.log(JSON.stringify({ drawer: targetDrawer, top }, undefined, 2));
socket.close();
