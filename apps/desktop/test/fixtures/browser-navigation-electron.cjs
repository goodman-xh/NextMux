'use strict';
// Only a disposable local page/profile and hidden Electron guest are used.
// Actual application and Theia handler bodies are loaded by the shared helper.
const electron = require('electron');
const { app, BrowserWindow, screen, webContents } = electron;
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const http = require('node:http');
const { GuestAutomation } = require('../../browser-automation.cjs');
const { loadNavigationHandlers } = require('./browser-navigation-handlers.cjs');
const directory = mkdtempSync(join(tmpdir(), 'nm-browser-navigation-'));
app.setPath('userData', join(directory, 'profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
let mode = 'theia', server, window, engine, sequence = 0;
const cases = [], hits = [];
app.whenReady().then(async () => {
  try {
    const handlers = loadNavigationHandlers(electron);
    app.on('web-contents-created', handlers.updater);
    app.on('web-contents-created', (event, contents) => handlers[mode].onWebContentsCreated(event, contents));
    server = http.createServer((request, response) => {
      hits.push(request.url); response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (request.url === '/next') return response.end('<!doctype html><title>Navigation destination</title><h1>Destination loaded</h1>');
      response.end('<!doctype html><title>Navigation fixture</title><a id="link" href="/next">Learn more</a><a id="popup" target="_blank" href="/popup">Popup</a><button id="button">Local action</button><script>document.addEventListener("click",e=>{window.lastClickTrusted=e.isTrusted;window.clicks=(window.clicks||0)+1;});</script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const createGuest = async () => {
      window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, webviewTag: true } });
      const attached = new Promise(resolve => window.webContents.once('did-attach-webview', (_event, guest) => resolve(guest)));
      await window.loadURL(`data:text/html,${encodeURIComponent(`<webview src="${url}" style="width:100%;height:650px" partition="persist:nextmux-browser"></webview>`)}`);
      const contents = await attached;
      if (contents.isLoading()) await new Promise(resolve => contents.once('did-stop-loading', resolve));
      engine = await GuestAutomation.create(contents); return contents;
    };
    const run = async selector => engine.run({ id: `navigation-${++sequence}`, action: 'click', selector, expiresAt: Date.now() + 10000 });
    let contents = await createGuest();
    const cursor = screen.getCursorScreenPoint();
    let result = await run('#link');
    assert.equal(result.ok, true); assert.equal(result.data.navigation.status, 'blocked');
    assert.equal(contents.getURL(), url); assert.equal(await contents.executeJavaScript('window.lastClickTrusted'), true);
    assert.equal(hits.includes('/next'), false, 'legacy veto occurs before the target request');
    assert.deepEqual(screen.getCursorScreenPoint(), cursor);
    cases.push({ name: 'actual Theia veto after trusted guest click', navigation: result.data.navigation.status, targetRequested: false });
    await engine.dispose(); engine = undefined; window.destroy(); window = undefined;
    mode = 'nextmux'; contents = await createGuest();
    result = await run('#button');
    assert.equal(result.ok, true); assert.equal(result.data.navigation.status, 'not-observed');
    cases.push({ name: 'button without navigation', navigation: result.data.navigation.status });
    const guestCount = webContents.getAllWebContents().length;
    result = await run('#popup');
    assert.equal(result.ok, true); assert.equal(contents.getURL(), url);
    assert.equal(webContents.getAllWebContents().length, guestCount); assert.equal(hits.includes('/popup'), false);
    cases.push({ name: 'target blank stays denied', newWindow: false, targetRequested: false });
    result = await run('#link');
    assert.equal(result.ok, true, result.message);
    assert.equal(result.data.navigation.status, 'committed');
    assert.equal(result.data.navigation.url, `${url}next`); assert.equal(contents.getURL(), `${url}next`);
    assert.equal(result.data.snapshot.title, 'Navigation destination'); assert.equal(hits.filter(path => path === '/next').length, 1);
    assert.equal(window.isVisible(), false); assert.equal(window.isFocused(), false); assert.deepEqual(screen.getCursorScreenPoint(), cursor);
    cases.push({ name: 'dedicated guest navigation', navigation: result.data.navigation.status, title: result.data.snapshot.title,
      requests: 1, nativeWindowActivated: false, physicalPointerMoved: false });
    console.log(JSON.stringify({ status: 'passed', electron: process.versions.electron, cases }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    await engine?.dispose(); window?.destroy(); if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
});
