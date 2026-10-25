'use strict';

// Run with the installed Electron binary. The isolated window stays hidden
// (or showInactive with NEXTMUX_FILL_VISIBLE=1), using only localhost and its
// disposable profile. The main document represents the chat composer.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const http = require('node:http');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { GuestAutomation } = require('../../browser-automation.cjs');
const directory = mkdtempSync(join(tmpdir(), 'nm-browser-fill-'));
app.setPath('userData', join(directory, 'profile'));
app.commandLine.appendSwitch('site-per-process');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {}); // The finally block owns cleanup and exit status.

const react = readFileSync(join(dirname(require.resolve('react/package.json')), 'umd/react.development.js'));
const reactDom = readFileSync(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'));
const script = `
  window.events = []; for (const type of ['mousedown', 'click', 'focusin', 'keydown', 'input']) document.addEventListener(type, e => { window.events.push([type,e.target.id,e.target.value]); if(window.events.length>30)window.events.shift(); });
  window.clicks = 0; document.addEventListener('click', () => window.clicks++);
  window.changes = [];
  document.querySelector('#cover-on-click').addEventListener('click', event => {
    const r=event.target.getBoundingClientRect(), cover=document.createElement('div');
    cover.id='new-cover'; Object.assign(cover.style,{position:'fixed',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',background:'gray',zIndex:1000}); document.body.append(cover);
  });
  document.querySelector('#move-on-click').addEventListener('click', event => { event.target.style.marginLeft='50px'; });
  function Controlled() {
    const [value, setValue] = React.useState('original');
    const [render, setRender] = React.useState(0);
    window.forceControlledRender = () => setRender(x => x + 1);
    return React.createElement(React.Fragment, null,
      React.createElement('input', { id: 'controlled', 'aria-label': 'Controlled input', value,
        onChange: e => { window.changes.push(e.target.value); setValue(e.target.value); } }),
      React.createElement('output', { id: 'controlled-state', 'data-render': render }, value));
  }
  ReactDOM.createRoot(document.querySelector('#react')).render(React.createElement(Controlled));
`;
let server, window, engine, contents, sequence = 0;
const cases = [];
app.whenReady().then(async () => {
  try {
    server = http.createServer((request, response) => {
      if (request.url === '/react.js' || request.url === '/react-dom.js' || request.url === '/fixture.js') {
        response.setHeader('Content-Type', 'application/javascript');
        return response.end(request.url === '/react.js' ? react : request.url === '/react-dom.js' ? reactDom : script);
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.url === '/frame') return response.end('<!doctype html><label>Frame input<input id="frame-input" value="frame original"></label>');
      response.end(`<!doctype html><html><head><style>
        body { font: 16px system-ui; margin: 20px; } input, textarea, select, [contenteditable] { margin: 5px; padding: 5px; }
        .covered { position: relative; display: inline-block; } .cover { position: absolute; inset: 0; background: gray; }
        iframe { display: block; width: 600px; height: 100px; } [contenteditable] { border: 1px solid; min-height: 20px; }
      </style></head><body>
        <label>Text<input id="text" value="existing value"></label>
        <label>Multiline<textarea id="multiline">existing lines</textarea></label>
        <div contenteditable="true" id="editable" aria-label="Editable">existing content</div>
        <input type="number" id="number" value="7" aria-label="Number">
        <input type="date" id="date" value="2025-01-01" aria-label="Date">
        <select id="select" aria-label="Select"><option value="red">Red</option><option value="blue">Blue</option></select>
        <input readonly id="readonly" value="protected"><input aria-readonly="true" id="aria-readonly" value="protected">
        <input disabled id="disabled" value="protected">
        <span class="covered"><input id="covered" value="protected"><span class="cover"></span></span>
        <button id="button">Not fillable</button><div id="react"></div>
        <input id="cover-on-click" value="protected"><input id="move-on-click" value="before move">
        <iframe src="http://127.0.0.1:${server.address().port}/frame"></iframe>
        <script src="/react.js"></script><script src="/react-dom.js"></script><script src="/fixture.js"></script>
      </body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: false, nodeIntegration: true, contextIsolation: false, webviewTag: true } });
    if (process.env.NEXTMUX_FILL_VISIBLE === '1') window.showInactive();
    const guestCreated = new Promise(resolve => window.webContents.once('did-attach-webview', (_event, guest) => resolve(guest)));
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<textarea id="composer">用户正在写的草稿</textarea><webview src="http://localhost:${server.address().port}/" style="width:100%;height:750px" partition="persist:nextmux-browser"></webview>`)}`);
    contents = await guestCreated;
    if (contents.isLoading()) await new Promise(resolve => contents.once('did-stop-loading', resolve));
    engine = await GuestAutomation.create(contents);
    await engine.page.waitForSelector('#controlled');
    const focusComposer = () => window.webContents.executeJavaScript('document.querySelector("#composer").focus()');
    const assertComposer = async () => {
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#composer").value'), '用户正在写的草稿');
      assert.equal(window.isFocused(), false, 'fill must not focus a native window');
      assert.equal(window.isVisible(), process.env.NEXTMUX_FILL_VISIBLE === '1', 'fill must not change native window visibility');
    };
    const run = async (name, values, expected = true) => {
      await focusComposer();
      const result = await engine.run({ id: `fill-${++sequence}`, action: 'fill', conversationId: 'fill-conversation', browserId: 'fill-browser', workspaceRoot: directory, expiresAt: Date.now() + 5000, ...values });
      cases.push({ name, ok: result.ok, code: result.code });
      console.log(JSON.stringify(cases.at(-1)));
      if (!result.ok && expected) console.log(JSON.stringify(await contents.executeJavaScript(`(() => {const el=document.querySelector('#controlled'),r=el.getBoundingClientRect();return {events: window.events, focus: document.hasFocus(), active: document.activeElement.id,rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};})()`)));
      assert.equal(result.ok, expected, `${name}: ${result.message || ''}`);
      await assertComposer();
      return result;
    };
    await focusComposer();
    assert.equal(await contents.executeJavaScript('document.hasFocus()'), false, 'regression requires an unfocused guest');
    await run('first fill without any preceding click', { selector: '#text', text: 'NextMux' });
    assert.equal(await contents.executeJavaScript('window.clicks'), 1);
    for (const text of ['NextMux 中文', '', 'replacement']) {
      await run(`replace existing text ${JSON.stringify(text)}`, { selector: '#text', text });
      assert.equal(await contents.executeJavaScript('document.querySelector("#text").value'), text);
    }
    await run('Chinese multiline textarea', { selector: '#multiline', text: '第一行\n第二行\n' });
    assert.equal(await contents.executeJavaScript('document.querySelector("#multiline").value'), '第一行\n第二行\n');
    await run('contenteditable', { selector: '#editable', text: '可编辑中文' });
    await run('number', { selector: '#number', text: '42' });
    await run('date', { selector: '#date', text: '2026-10-03' });
    await run('select', { selector: '#select', text: 'blue' });
    await run('controlled React input', { selector: '#controlled', text: 'React 接收变化' });
    assert.equal(await contents.executeJavaScript('window.changes.at(-1)'), 'React 接收变化');
    assert.equal(await contents.executeJavaScript('document.querySelector("#controlled-state").textContent'), 'React 接收变化');
    await contents.executeJavaScript('window.forceControlledRender()');
    await engine.page.waitForFunction(() => document.querySelector('#controlled-state').dataset.render === '1');
    assert.equal(await contents.executeJavaScript('document.querySelector("#controlled").value'), 'React 接收变化');
    const clicksBeforeProtected = await contents.executeJavaScript('window.clicks');
    for (const selector of ['#readonly', '#aria-readonly', '#disabled', '#covered', '#button']) {
      await run(`protected ${selector}`, { selector, text: 'must not write', timeoutMs: 200 }, false);
      if (selector !== '#button') assert.equal(await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).value`), 'protected');
    }
    assert.equal(await contents.executeJavaScript('window.clicks'), clicksBeforeProtected, 'fill must not click protected targets');
    await run('overlay appears after actionable click', { selector: '#cover-on-click', text: 'must not write', timeoutMs: 200 }, false);
    assert.equal(await contents.executeJavaScript('document.querySelector("#cover-on-click").value'), 'protected');
    await contents.executeJavaScript('document.querySelector("#new-cover").remove()');
    await run('input changes position after click', { selector: '#move-on-click', text: 'after move' });
    assert.equal(await contents.executeJavaScript('document.querySelector("#move-on-click").value'), 'after move');
    const childRef = async () => {
      const shot = (await engine.run({ id: `snapshot-${++sequence}`, action: 'snapshot', expiresAt: Date.now() + 5000 })).data;
      return shot.elements.find(element => element.name === 'Frame input').ref;
    };
    assert.ok(engine.transport.sessions.size, 'child must be an actual out-of-process iframe');
    await run('child frame input', { ref: await childRef(), text: '子框架文字' });
    await contents.executeJavaScript(`const cover = document.createElement('div'); cover.id='frame-cover'; const rect=document.querySelector('iframe').getBoundingClientRect(); Object.assign(cover.style,{position:'fixed',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px',background:'gray',zIndex:1000});document.body.append(cover);`);
    await run('covered child frame', { ref: await childRef(), text: 'blocked', timeoutMs: 200 }, false);
    assert.equal(await engine.page.frames().find(frame => frame !== engine.page.mainFrame()).$eval('#frame-input', element => element.value), '子框架文字');
    await contents.executeJavaScript('document.querySelector("#frame-cover").remove()');
    await window.webContents.executeJavaScript('Object.assign(document.querySelector("webview").style,{position:"fixed",left:"-10000px",top:"0",width:"1024px",height:"768px",opacity:"0",pointerEvents:"none"});document.querySelector("webview").inert=true');
    await run('background conversation fill', { selector: '#text', text: '后台内容' });
    assert.equal(await contents.executeJavaScript('document.querySelector("#text").value'), '后台内容');
    await run('background controlled input', { selector: '#controlled', text: '后台 React' });
    assert.equal(await contents.executeJavaScript('window.changes.at(-1)'), '后台 React');
    const once = { id: 'same-fill-id', selector: '#controlled', text: 'exactly once' };
    await run('same request first run', once);
    const changesAfterFirst = await contents.executeJavaScript('window.changes.length');
    await run('same request cached run', once);
    assert.equal(await contents.executeJavaScript('window.changes.at(-1)'), 'exactly once');
    assert.equal(await contents.executeJavaScript('window.changes.length'), changesAfterFirst);
    await run('expired fill', { selector: '#text', text: 'expired', expiresAt: Date.now() - 1 }, false);
    assert.equal(await contents.executeJavaScript('document.querySelector("#text").value'), '后台内容');
    const pending = run('cancelled fill', { id: 'cancelled-fill', selector: '#disabled', text: 'cancelled' }, false);
    setTimeout(() => engine.cancel('cancelled-fill'), 100);
    await pending;
    await contents.executeJavaScript('document.querySelector("#disabled").disabled=false');
    assert.equal(await contents.executeJavaScript('document.querySelector("#disabled").value'), 'protected');
    console.log(JSON.stringify({ status: 'NATIVE_BROWSER_FILL_ACCEPTANCE_PASSED', cases: cases.length, pid: process.pid }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await engine?.dispose(); window?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    try { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    finally { app.exit(process.exitCode || 0); }
  }
});
