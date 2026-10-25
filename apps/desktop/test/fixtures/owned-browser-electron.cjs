'use strict';
const electron = require('electron');
const { app, BrowserWindow, BaseWindow, WebContentsView, session, ipcMain, screen, webContents } = electron;
const { createOwnedBrowserRegistry } = require('../../owned-browser-registry.cjs');
const { registerOwnedBrowserIpc } = require('../../owned-browser-ipc.cjs');
const { GuestAutomation } = require('../../browser-automation.cjs');
const { loadNavigationHandlers } = require('./browser-navigation-handlers.cjs');
const assert = require('node:assert/strict'), http = require('node:http');
const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = require('node:fs'), { rm } = require('node:fs/promises');
const { join } = require('node:path'), { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'nm-owned-registry-'));
const structuralOnly = !process.argv.includes('--visible-manual');
const output = process.env.NEXTMUX_OWNED_BROWSER_TEST_OUTPUT || mkdtempSync(join(tmpdir(), 'nm-owned-results-'));
mkdirSync(output, { recursive: true });
const { createRequire } = require('node:module');
const extensionRequire = createRequire(join(__dirname, '../../../../packages/theia-nextmux-extension/package.json'));
const ts = extensionRequire('typescript'), vm = require('node:vm');
// Reuse the actual production preload declarations, without booting unrelated
// Theia preloads or copying a second implementation of the browser bridge.
const preloadSource = readFileSync(join(__dirname, '../../nextmux-electron-preload.cjs'), 'utf8');
const preloadAst = ts.createSourceFile('preload.cjs', preloadSource, ts.ScriptTarget.Latest, true);
const declaration = name => {
  const statement = preloadAst.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(preloadAst) === name));
  if (!statement) throw Error('Production preload declaration missing: ' + name);
  return statement.getText(preloadAst);
};
const preloadPath = join(profile, 'fixture-owned-preload.cjs');
writeFileSync(preloadPath, "const {contextBridge,ipcRenderer}=require('electron');\n" + declaration('prefix') + '\n' + declaration('ownedBrowser') + "\ncontextBridge.exposeInMainWorld('nextmuxDesktop',Object.freeze({ownedBrowser}));\n");
app.setPath('userData', join(profile, 'profile')); app.on('window-all-closed', () => {});
const registry = createOwnedBrowserRegistry({ app, BrowserWindow, BaseWindow, WebContentsView, session, GuestAutomation,
  trustedMainFrame: event => event.sender === host?.webContents && event.senderFrame === host.webContents.mainFrame });
const removeIpc = registerOwnedBrowserIpc({ ipcMain, registry });
let host, server, guest, typingTimer, pointerTimer, rogue;
const cases = [], hits = [], markers = [], phases = [], transfers = [], pointers = [], windowEvents = [], actionTimes = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { const end = Date.now() + 6000; do { if (await predicate()) return; await delay(25); } while (Date.now() < end); throw Error('Fixture wait timed out'); };
const owner = { conversationId: 'draft:fixture-conversation', browserId: 'fixture-browser', workspaceRoot: '/fixture/workspace' };
const bounds = { x: 470, y: 90, width: 600, height: 600 };
let expected = '', requestNumber = 0;
const sample = () => pointers.push({ at: Date.now(), ...screen.getCursorScreenPoint() });
const note = async (name, body) => { const startedAt = Date.now(); await body(); cases.push({ name, passed: true, startedAt, endedAt: Date.now() }); };
app.whenReady().then(async () => {
  try {
    const handlers = loadNavigationHandlers(electron);
    const mainSource = readFileSync(join(__dirname, '../../../../packages/theia-nextmux-extension/src/electron-main/nextmux-electron-main-module.ts'), 'utf8');
    const mainAst = ts.createSourceFile('actual-main.ts', mainSource, ts.ScriptTarget.Latest, true);
    const cls = mainAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxElectronMainApplication');
    const member = cls.members.find(node => node.name?.getText(mainAst) === 'onWebContentsCreated');
    const Base = class { onWebContentsCreated(event, contents) { handlers.theia.onWebContentsCreated(event, contents); } };
    const symbol = Symbol.for('nextmux.owned-browser.isRegistered.v1');
    const mainGlobal = {};
    Object.defineProperty(mainGlobal, symbol, { value: registry.isRegisteredOwnedContents, writable: false, configurable: false });
    const ActualMain = vm.runInNewContext(ts.transpileModule('(class extends Base { ' + member.getText(mainAst) + ' })', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {Base, session, globalThis:mainGlobal});
    const actualMain = new ActualMain();
    app.on('web-contents-created', (event, contents) => {
      const owned = registry.isRegisteredOwnedContents(contents);
      markers.push({ id: contents.id, type: contents.getType(), owned, at: Date.now() });
      // The exact proposed integration, retaining the actual current handler for
      // every non-owned contents, including an unrelated matching partition.
      actualMain.onWebContentsCreated(event, contents);
    });
    server = http.createServer((request, response) => {
      hits.push({ path: request.url, at: Date.now() });
      if (request.url === '/hang') return;
      if (request.url === '/redirect-bad') { response.writeHead(302, { Location: 'file:///fixture-not-allowed' }); response.end(); return; }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.url === '/next') { response.end('<title>Second owned page</title><h1>Second page</h1>'); return; }
      response.end(`<!doctype html><title>Owned registry page</title><style>body{font:18px system-ui;padding:20px}input{font:18px system-ui;width:280px}button,a{display:block;margin-top:20px}</style>
        <h1>Owned page</h1><input id="field" name="field"><button id="count">Count</button><output id="value">0</output><a id="next" href="/next">Next page</a><a id="popup" target="_blank" href="/next">Popup</a>
        <script>window.docToken=crypto.randomUUID();window.clicks=[];document.addEventListener('click',e=>clicks.push({id:e.target.id,trusted:e.isTrusted}));document.getElementById('count').onclick=()=>{const el=document.getElementById('value');el.textContent=+el.textContent+1;sessionStorage.setItem('count',el.textContent)};document.getElementById('field').oninput=e=>sessionStorage.setItem('field',e.target.value);</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    host = new BrowserWindow({ show: false, width: 1100, height: 760, title: 'NextMux isolated owned-browser registry', webPreferences: {
      sandbox: true, contextIsolation: true, backgroundThrottling: false, preload: preloadPath } });
    for (const type of ['show', 'hide', 'focus', 'blur', 'minimize']) host.on(type, () => windowEvents.push({ type, at: Date.now() }));
    await host.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(`<!doctype html><title>Owned-browser fixture host</title><style>body{font:18px system-ui;padding:20px}button{font:16px system-ui;margin:4px;padding:8px}textarea{display:block;width:390px;height:250px;margin-top:28px}</style>
      <button id="takeover">接管原页面</button><button id="release">交回后台</button><textarea id="composer"></textarea><p id="mode">background</p>
      <script>window.owner=${JSON.stringify(owner)};window.events=[];document.addEventListener('focusout',e=>events.push({type:'focusout',id:e.target.id,at:Date.now()}));document.addEventListener('input',e=>events.push({type:'input',data:e.data,inputType:e.inputType,id:e.target.id,trusted:e.isTrusted,at:Date.now()}));document.addEventListener('keydown',e=>events.push({type:'keydown',key:e.key,code:e.code,id:e.target.id,trusted:e.isTrusted,at:Date.now()}));for(const action of ['takeover','release'])document.getElementById(action).onclick=async e=>{window.controlTrusted=e.isTrusted;try{const state=await nextmuxDesktop.ownedBrowser[action](owner,${JSON.stringify(bounds)});document.getElementById('mode').textContent=state.mode}catch(error){document.getElementById('mode').textContent='ERROR:'+error.message}};</script>`));
    const call = (method, ...args) => host.webContents.executeJavaScript(`nextmuxDesktop.ownedBrowser[${JSON.stringify(method)}](${args.map(value => JSON.stringify(value)).join(',')})`);
    const hostState = () => host.webContents.executeJavaScript('({active:document.activeElement?.id,value:document.getElementById("composer").value,events:window.events,trusted:window.controlTrusted})');
    const state = () => call('state', owner);
    const action = async input => { const entry = { input, startedAt: Date.now() }; actionTimes.push(entry); try { const result = await call('action', owner, { id: 'request-' + (++requestNumber), expiresAt: Date.now() + 14000, ...input }); entry.result = { ok: result.ok, code: result.code }; return result; } finally { entry.endedAt = Date.now(); } };
    const pageState = async () => ({ id: guest.id, ...await guest.executeJavaScript('({url:location.href,docToken:window.docToken,field:document.getElementById("field")?.value,count:document.getElementById("value")?.textContent,saved:sessionStorage.getItem("field"),clicks:window.clicks})'), history: guest.navigationHistory.getAllEntries(), historyIndex: guest.navigationHistory.getActiveIndex() });
    const click = async (contents, selector) => {
      const point = await contents.executeJavaScript(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); await delay(60);
    };
    await note('sandbox preload / synchronous exact registration / idempotent creation', async () => {
      assert.equal(await host.webContents.executeJavaScript('Object.isFrozen(nextmuxDesktop.ownedBrowser)'), true);
      const created = await call('create', owner, origin + '/'); guest = webContents.fromId(created.id);
      assert.equal(created.mode, 'background'); assert.equal(created.url, origin + '/');
      assert.equal(markers.find(entry => entry.id === guest.id)?.owned, true);
      assert.equal(guest.getLastWebPreferences().sandbox, true); assert.equal(guest.getLastWebPreferences().nodeIntegration, false);
      const before = hits.length; assert.equal((await call('create', owner, origin + '/next')).id, guest.id); assert.equal(hits.length, before);
      const leaked = await guest.executeJavaScript('({require:typeof require,bridge:typeof nextmuxDesktop})'); assert.deepEqual(leaked, { require: 'undefined', bridge: 'undefined' });
    });
    await note('foreign conversation/workspace/frame and invalid URLs denied', async () => {
      for (const changed of [{ ...owner, conversationId: 'other' }, { ...owner, workspaceRoot: '/other' }]) await assert.rejects(call('state', changed));
      const fakeEvent = { sender: host.webContents, senderFrame: { ...host.webContents.mainFrame } };
      assert.throws(() => registry.state(fakeEvent, owner));
      for (const destination of ['file:///tmp/no', 'javascript:alert(1)', 'https://user:secret@example.com/']) await assert.rejects(call('create', { ...owner, browserId: 'bad-url' }, destination));
    });
    await note('same-partition unregistered view keeps original Theia navigation policy', async () => {
      rogue = new WebContentsView({ webPreferences: { session: session.fromPartition('persist:nextmux-browser'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      assert.equal(registry.isRegisteredOwnedContents(rogue.webContents), false);
      assert.equal(markers.find(entry => entry.id === rogue.webContents.id)?.owned, false);
      const blocked = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      rogue.webContents.emit('will-navigate', blocked, origin + '/next'); assert.equal(blocked.defaultPrevented, true);
      rogue.webContents.close({ waitForBeforeUnload: false }); rogue = undefined;
    });
    // Do not compete with a human using the real desktop. A single baseline is
    // observed before showing this isolated window; activity aborts visible QA.
    if (!structuralOnly) {
      const baseline = [];
      for (let index = 0; index < 250; index += 1) { baseline.push(screen.getCursorScreenPoint()); await delay(20); }
      if (baseline.some((point, index) => index && (point.x !== baseline[index - 1].x || point.y !== baseline[index - 1].y))) throw Error('FIXTURE_USER_ACTIVE: physical pointer moved during baseline; visible focus validation not attempted.');
      host.show(); host.focus(); await delay(100);
    }
    await click(host.webContents, '#composer');
    pointerTimer = setInterval(sample, 10);
    const phase = async (name, work) => {
      const startedAt = Date.now(), prior = await hostState(), sent = [];
      assert.equal(prior.active, 'composer');
      typingTimer = setInterval(() => { const character = String.fromCharCode(97 + expected.length % 26); expected += character; sent.push({ character, at: Date.now() }); host.webContents.sendInputEvent({ type: 'char', keyCode: character }); }, 20);
      try { await work(); await delay(100); } finally { clearInterval(typingTimer); typingTimer = undefined; }
      await delay(50); const after = await hostState(), endedAt = Date.now();
      const focusouts = after.events.filter(item => item.type === 'focusout' && item.at >= startedAt && item.at <= endedAt);
      const inside = pointers.filter(item => item.at >= startedAt && item.at <= endedAt), moves = inside.filter((item, index) => index && (item.x !== inside[index - 1].x || item.y !== inside[index - 1].y));
      phases.push({ name, startedAt, endedAt, sent, after, expected, charsSent: sent.length, totalReceived: after.value.length, exactText: after.value === expected, focusouts,
        pointer: { samples: inside.length, changes: moves.length, maxGapMs: Math.max(0, ...inside.slice(1).map((item, index) => item.at - inside[index].at)) } });
      assert.equal(after.active, 'composer'); assert.equal(after.value, expected); assert.equal(focusouts.length, 0); if (!structuralOnly) assert.equal(moves.length, 0);
    };
    await note('real CDP inputs and history preserve host continuous targeted input', async () => {
      await phase('background-before-manual', async () => {
        for (const request of [{ action: 'fill', selector: '#field', text: 'Retained original form' }, { action: 'click', selector: '#count' }, { action: 'click', selector: '#next' }, { action: 'back' }]) {
          const result = await action(request); assert.equal(result.ok, true, JSON.stringify(result));
        }
        assert.equal((await pageState()).field, 'Retained original form');
        const single = { id: 'dedupe', expiresAt: Date.now() + 14000, action: 'click', selector: '#count' };
        const results = await Promise.all([call('action', owner, single), call('action', owner, single)]); assert.equal(results[0].ok, true); assert.deepEqual(results[0], results[1]);
        assert.equal((await pageState()).count, '1'); // Returning via history created a new DOM, but preserved form state.
        const conflict = await call('action', owner, { ...single, selector: '#next' }); assert.equal(conflict.code, 'BROWSER_REQUEST_CONFLICT');
      });
    });
    await note('bounded preview is on demand / same-page single capture / background resize', async () => {
      const before = await state(); assert.equal((await call('resize', owner, { x: 123, y: 123, width: 1000, height: 700 })).mode, 'background');
      await delay(80); const images = await Promise.all([call('preview', owner), call('preview', owner)]); assert.equal(images[0].dataURL, images[1].dataURL);
      assert.ok(images[0].width <= 1920 && images[0].height <= 2160); assert.ok(images[0].dataURL.length < 8 * 1024 * 1024); assert.ok(images[0].revision > before.revision);
      writeFileSync(join(output, 'owned-preview.png'), Buffer.from(images[0].dataURL.split(',')[1], 'base64'));
      await assert.rejects(call('preview', owner));
    });
    if (!structuralOnly) await note('takeover invalidates old queue, cancels active input and rejects manual model mutation', async () => {
      const pending = action({ action: 'click', selector: '#never-exists', timeoutMs: 5000 });
      const queued = action({ action: 'click', selector: '#count' });
      await delay(80); const before = await pageState(), hitsBefore = hits.length;
      await click(host.webContents, '#takeover'); await until(async () => (await state()).mode === 'manual');
      const after = await pageState(); assert.deepEqual(after, before); assert.equal(hits.length, hitsBefore);
      const results = await Promise.all([pending, queued]); assert.ok(results.every(result => !result.ok && result.code === 'BROWSER_ACTION_EXPIRED'));
      assert.equal((await action({ action: 'click', selector: '#count' })).code, 'BROWSER_MANUAL_CONTROL');
      assert.equal((await hostState()).trusted, true);
      transfers.push({ action: 'takeover', before, after, cancelled: results.map(result => ({ ok: result.ok, code: result.code })), noReload: hits.length === hitsBefore });
      await click(guest, '#field'); await guest.insertText(' manual'); assert.match((await pageState()).field, /manual/);
    });
    if (!structuralOnly) await note('release retains exact view/document/form/history and does not restore host focus', async () => {
      const before = await pageState(), hitsBefore = hits.length;
      await click(host.webContents, '#release'); await until(async () => (await state()).mode === 'background');
      const after = await pageState(); assert.deepEqual(after, before); assert.equal(hits.length, hitsBefore);
      // The explicit user click selects the release button; the registry must
      // not secretly select composer to mask a browser input side effect.
      assert.equal((await hostState()).active, 'release');
      transfers.push({ action: 'release', before, after, noReload: hits.length === hitsBefore });
      await click(host.webContents, '#composer');
      await phase('background-after-manual', async () => {
        const result = await action({ action: 'fill', selector: '#field', text: 'After manual ownership' }); assert.equal(result.ok, true, JSON.stringify(result));
      });
    });
    await note('popups are denied and unsafe redirects cannot replace the page', async () => {
      const count = webContents.getAllWebContents().length; const popup = await action({ action: 'click', selector: '#popup' }); assert.equal(popup.ok, true); assert.equal(webContents.getAllWebContents().length, count);
      const redirected = await action({ action: 'navigate', url: origin + '/redirect-bad' }); assert.equal(redirected.ok, false); assert.ok(!(await state()).url.startsWith('file:'));
      const restored = await action({ action: 'navigate', url: origin + '/' }); assert.equal(restored.ok, true, JSON.stringify(restored));
    });
    if (structuralOnly) await note('hidden host cannot gain manual native view', async () => {
      await assert.rejects(call('takeover', owner, bounds), /BROWSER_HOST_HIDDEN/); assert.equal((await state()).mode, 'background'); assert.equal(host.isVisible(), false);
    });
    if (!structuralOnly) await note('manual bounds validation, hide/minimize safely return same page to background', async () => {
      await assert.rejects(call('takeover', owner, { ...bounds, x: 9999 }));
      await call('takeover', owner, bounds); const before = await pageState(); host.hide(); await until(async () => (await state()).mode === 'background'); assert.deepEqual(await pageState(), before);
      await assert.rejects(call('takeover', owner, bounds)); host.show(); await delay(50);
      await call('takeover', owner, bounds); host.minimize(); await until(async () => (await state()).mode === 'background'); assert.equal(guest.id, before.id); host.restore(); await delay(70);
    });
    await note('model close uses the owned action gate and destroys only its own live page', async () => {
      const otherOwner = { ...owner, browserId: 'model-close-browser' };
      const created = await call('create', otherOwner, origin + '/');
      const closingGuest = webContents.fromId(created.id), windowCount = BaseWindow.getAllWindows().length;
      const result = await call('action', otherOwner, { id: 'model-close-request', action: 'close', ...otherOwner, expiresAt: Date.now() + 5000 });
      assert.equal(result.ok, true, JSON.stringify(result));
      await until(() => closingGuest.isDestroyed());
      await until(() => BaseWindow.getAllWindows().length === windowCount - 1);
      assert.equal(guest.isDestroyed(), false); assert.equal((await state()).id, guest.id);
      await assert.rejects(call('state', otherOwner));
    });
    await note('host reload destroys owned contents and rejects stale ownership', async () => {
      const id = guest.id; await host.loadURL('data:text/html,New%20owning%20document'); await until(() => !webContents.fromId(id)); assert.equal(registry.isRegisteredOwnedContents(guest), false);
      await assert.rejects(call('state', owner));
    });
    await note('host destruction explicitly closes all view contents and hidden holders', async () => {
      const final = await call('create', { ...owner, browserId: 'closing-browser' }, origin + '/'); const closingGuest = webContents.fromId(final.id);
      const before = BaseWindow.getAllWindows().length; assert.ok(before >= 2); host.destroy(); await until(() => closingGuest.isDestroyed());
      await until(() => BaseWindow.getAllWindows().length === 0);
    });
    writeFileSync(join(output, structuralOnly ? 'owned-browser-electron-hidden-result.json' : 'owned-browser-electron-result.json'), JSON.stringify({ status: structuralOnly ? 'hidden_structural_passed' : 'passed', electron: process.versions.electron, chromium: process.versions.chrome,
      cases, markers, phases, transfers, hits, windowEvents, actionTimes, boundary: (structuralOnly ? 'Host is hidden; physical pointer changes are observational only and are NOT an isolation assertion. Manual transfers are not tested in this run. ' : '') + 'Isolated fixture only; real Electron WebContentsView, sandbox preload IPC, GuestAutomation/CDP and targeted trusted host input. No post-model focus restoration. Not product/native human keyboard/IME/AX/Windows acceptance.' }, null, 2));
    console.log(JSON.stringify({ status: structuralOnly ? 'hidden_structural_passed' : 'passed', cases: cases.length, phases: phases.map(phase => ({ name: phase.name, charsSent: phase.charsSent, exactText: phase.exactText, focusouts: phase.focusouts.length, pointer: phase.pointer })) }));
  } catch (cause) {
    console.error(cause); process.exitCode = 1;
    writeFileSync(join(output, 'owned-browser-electron-failure.json'), JSON.stringify({ message: cause.message, stack: cause.stack, cases, phases, transfers, markers, hits, windowEvents, actionTimes }, null, 2));
  } finally {
    clearInterval(typingTimer); clearInterval(pointerTimer); removeIpc(); await registry.dispose();
    if (rogue && !rogue.webContents.isDestroyed()) rogue.webContents.close({ waitForBeforeUnload: false });
    if (host && !host.isDestroyed()) host.destroy(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(cause => console.error('Fixture profile cleanup:', cause.code));
    app.exit(process.exitCode || 0);
  }
});
