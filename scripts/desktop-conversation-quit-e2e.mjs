import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInDisposableAttachmentFileDesktop, connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { ensureExactOfficialQaRoute, officialQaRouteConfig } from './desktop-official-qa-route.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
import { readDurableDraft } from './desktop-close-persistence-e2e.mjs';

if (await runInDisposableAttachmentFileDesktop(import.meta.url, { label: 'conversation ordered quit', withQaRoute: true, qaDelayMs: 5000, nativeInspector: true })) process.exit(0);
assert.equal(process.env.NEXTMUX_DESKTOP_E2E_ISOLATED, '1', 'Only the owned disposable app may be quit');
const port = process.env.NEXTMUX_CDP_PORT, profile = process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR;
const stateDirectory = process.env.NEXTMUX_DESKTOP_STATE_DIR, exitMarker = process.env.NEXTMUX_DESKTOP_E2E_APP_EXIT_MARKER;
assert.ok(profile && stateDirectory.startsWith(profile) && exitMarker.startsWith(profile));
const primary = await connectToNextMuxWorkbench(port), clients = [primary], observations = [], confirmations = [];
const primaryEvaluate = primary.evaluate;
primary.evaluate = expression => Promise.race([primaryEvaluate(expression), new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('QA_PRIMARY_READ_TIMEOUT')), 10000); timer.unref();
})]);
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const drafts = ids.map((_, index) => `退出前小窗 ${index + 1} 的最后草稿`);
async function wait(probe, test, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await probe(); if (test(result)) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`CONVERSATION_QUIT_E2E_TIMEOUT: ${label}`);
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map(), listeners = new Set();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    for (const listener of listeners) listener(message);
    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__conversationQuitObserve') {
      observations.push(JSON.parse(message.params.payload));
    }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); }
  });
  socket.addEventListener('close', () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('QA_TARGET_CLOSED')); } pending.clear(); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`QA_CDP_TIMEOUT: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'QA_EVALUATION_FAILED');
    return result.result?.value;
  };
  const client = { socket, call, evaluate, onEvent: listener => listeners.add(listener) }; clients.push(client); return client;
}
async function observe(client, label) {
  client.onEvent(message => {
    if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'confirm') {
      confirmations.push({ window: label, message: message.params.message });
      // This script explicitly requests Quit in its own disposable app. Exercise
      // the real interruption prompt rather than leaving a hidden modal pending.
      void client.call('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  await client.call('Page.enable');
  await client.call('Runtime.addBinding', { name: '__conversationQuitObserve' });
  if (client === primary) client.onEvent(message => {
    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__conversationQuitObserve') observations.push(JSON.parse(message.params.payload));
  });
  await client.evaluate(`(() => {
    const log = kind => window.__conversationQuitObserve(JSON.stringify({window:${JSON.stringify(label)},kind}));
    window.nextmuxDesktop.onPrepareClose(() => log('offered'));
    window.nextmuxDesktop.onPrepareCloseCancelled((_token, reason) => log('cancelled:' + reason));
  })()`);
}
try {
  const route = await ensureExactOfficialQaRoute({ evaluate: primary.evaluate, config: officialQaRouteConfig() });
  await primary.evaluate(`(() => {
    const now = Date.now(), sessions = ${JSON.stringify(ids)}.map((id, index) => ({id,title:'退出验收 '+index,workspacePath:'',createdAt:now,updatedAt:now-index,
      browsers:[],permissionMode:'full_access',reasoningEffort:'medium',relayKey:${JSON.stringify(route.relayKey)},modelId:${JSON.stringify(route.modelId)},routeId:${JSON.stringify(route.routeId)},
      followUpQueue:[],draftPrompt:'初始草稿 '+index,turns:[{id:id+'-turn',prompt:'你好',response:'测试历史消息',stage:'complete',createdAt:now-1000,completedAt:now,permissionMode:'full_access',routeLabel:'QA',error:''}]}));
    localStorage.setItem('nextmux.desktop.codingSessions.v1',JSON.stringify(sessions));
    localStorage.setItem('nextmux.desktop.restoreState.v1',JSON.stringify({version:1,section:'coding',workspace:'',codingPanel:'thread',activeCodingSessionId:sessions[0].id,newConversation:false,settingsPanel:'profile',billingTab:'usage',modelCenterView:'all',modelCapabilityFilter:'all',comicView:'storyboard'}));
  })()`);
  await reloadDesktopDocument({ ...primary, ignoreCache: true });
  await wait(() => primary.evaluate('window.nextmuxDesktop.getConversationWindowState()'), value => ids.every(id => value.sessions?.some(session => session.id === id)), 'three sessions restored');
  await observe(primary, 'primary');
  assert.equal(await primary.evaluate(`window.nextmuxDesktop.openConversationWindows(${JSON.stringify(ids)})`), true);
  const targets = await wait(async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), value => value.filter(target => target.url.includes('nextmuxConversation=')).length === 3, 'three native children');
  const children = [];
  for (const [index, id] of ids.entries()) {
    const client = await connect(targets.find(target => target.url.includes(`nextmuxConversation=${id}`))); children.push(client);
    await wait(() => client.evaluate("Boolean(document.querySelector('.is-detached-conversation .nmx-composer textarea'))"), Boolean, `child ${index + 1} ready`);
    await observe(client, `child-${index + 1}`);
  }
  // Keep one hidden child genuinely running when Quit is requested.
  const running = children[2];
  await running.call('Page.bringToFront');
  await running.evaluate("(() => {const e=document.querySelector('.nmx-composer textarea');e.focus();e.select();})()");
  await running.call('Input.insertText', { text: '退出时取消后台运行验收' });
  await wait(() => running.evaluate("!document.querySelector('.nmx-send-button').disabled"), Boolean, 'third child send enabled');
  const send = await running.evaluate("(() => {const r=document.querySelector('.nmx-send-button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await running.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...send, button: 'left', clickCount: 1 });
  await running.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...send, button: 'left', clickCount: 1 });
  await wait(() => primary.evaluate('window.nextmuxDesktop.getConversationWindowState()'), value => value.windows.some(window => window.sessionId === ids[2] && window.running), 'third child running');
  for (const [index, child] of children.entries()) {
    await child.evaluate("(() => {const e=document.querySelector('.nmx-composer textarea');e.focus();e.select();})()");
    await child.call('Input.insertText', { text: drafts[index] });
  }
  await running.evaluate('window.nextmuxDesktop.closeDesktopWindow()');
  await wait(() => primary.evaluate('window.nextmuxDesktop.getConversationWindowState()'), value => value.windows.some(window => window.sessionId === ids[2] && window.running && !window.visible), 'hidden running child retained');
  await primary.evaluate('window.nextmuxDesktop.closeDesktopWindow()');
  assert.equal(await children[0].evaluate('window.nextmuxDesktop.showMainWindow()'), true);
  await wait(() => primary.evaluate('document.visibilityState'), value => value === 'visible', 'shared native show-main restored primary');

  const nativePort = process.env.NEXTMUX_E2E_NATIVE_INSPECTOR_PORT;
  assert.ok(nativePort && /^\d+$/.test(nativePort), 'Only the temporary native inspector created by this harness may be used');
  const nativeTargets = await (await fetch(`http://127.0.0.1:${nativePort}/json/list`)).json();
  assert.equal(nativeTargets.length, 1);
  const native = await connect(nativeTargets[0]);
  const identity = await native.evaluate(`({type:process.type,profile:process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR,ppid:process.ppid})`);
  assert.equal(identity.type, 'browser'); assert.equal(identity.profile, profile); assert.equal(identity.ppid, process.ppid);
  // Resolve the native module synchronously before scheduling the quit call.
  assert.equal(await native.evaluate(`(() => {
    const app = process.getBuiltinModule('module').createRequire(${JSON.stringify(join(process.cwd(), 'apps/desktop/bootstrap.cjs'))})('electron').app;
    if (typeof app?.quit !== 'function') return false;
    setImmediate(() => app.quit());
    return true;
  })()`), true);
  native.socket.close();
  const exit = await wait(async () => {
    try { return JSON.parse(await readFile(exitMarker, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, Boolean, 'app exited naturally after all child saves', 30000);
  assert.equal(exit.code, 0); assert.equal(exit.signal, null, 'Process exited through app.quit, without cleanup signals');
  const durable = [];
  for (const draft of drafts) { const saved = await readDurableDraft(stateDirectory, draft); assert.ok(saved, `Missing saved draft: ${draft}`); durable.push(saved); }
  assert.deepEqual(observations.filter(event => event.kind === 'offered').map(event => event.window), ['child-1', 'child-2', 'child-3', 'primary']);
  assert.equal(observations.some(event => event.kind.startsWith('cancelled:')), false, JSON.stringify(observations));
  assert.ok(confirmations.length > 0, 'A running conversation must request interruption confirmation');
  const result = { ok: true, children: 3, hiddenRunningChild: true, showMain: true, durableDrafts: durable.length, naturalExit: exit, observations, confirmations };
  await writeFile(join(profile, 'logs', 'conversation-quit-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, client] of clients.entries()) if (client.socket.readyState === 1) {
    try { console.error('QA window', index, await client.evaluate("({draft:document.querySelector('.nmx-composer textarea')?.value,text:document.body.innerText.slice(-1200)})")); } catch { /* A successfully closed target has no diagnostic DOM. */ }
  }
  await writeFile(join(profile, 'logs', 'conversation-quit-failure.json'), JSON.stringify({ observations, message: error.message }, null, 2));
  console.error('Ordered quit observations:', JSON.stringify(observations)); throw error;
} finally { for (const client of clients) client.socket.close(); }
