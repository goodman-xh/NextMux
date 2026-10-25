import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { windowsRelatedWindow, windowsWindowRole, createComputerWindowView } = require('../computer-window-view.cjs');
const ts = createRequire(new URL('../../../packages/theia-nextmux-extension/package.json', import.meta.url))('typescript');
const module = { exports: {} };
new Function('exports', 'require', 'module', ts.transpileModule(readFileSync(new URL('../../../packages/theia-nextmux-extension/src/browser/nextmux-conversation-tabs.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module.exports, require, module);
const tabs = module.exports;
const row = (pid, executable, windowId = pid * 10, extra = {}) => ({ pid, executable, windowId, title: executable.split('\\').at(-1), ...extra });
const launcher = row(10, 'C:\\Program Files\\Tencent\\WeGame\\WeGame.exe');
const client = row(11, 'D:\\Riot Games\\League of Legends\\LeagueClientUx.exe');
const game = row(12, 'D:\\Riot Games\\League of Legends\\Game\\League of Legends.exe');

test('launcher/install/ancestry evidence groups chains without title or shared vendor collisions', () => {
  assert.equal(windowsRelatedWindow(launcher, client), true);
  assert.equal(windowsRelatedWindow(client, game), true);
  const steam = row(20, 'C:\\Program Files (x86)\\Steam\\steam.exe');
  assert.equal(windowsRelatedWindow(steam, row(21, 'D:\\Library\\steamapps\\common\\Game\\game.exe')), true);
  assert.equal(windowsRelatedWindow(row(21, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\One\\one.exe'), row(22, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Two\\two.exe')), false);
  for (const name of ['EpicGamesLauncher', 'Battle.net']) {
    const root = row(30, `C:\\Launcher\\${name}.exe`);
    assert.equal(windowsRelatedWindow(root, row(31, 'D:\\Games\\Test\\game.exe', 310, { ancestorPids: [30] })), true);
  }
  assert.equal(windowsRelatedWindow(launcher, row(40, 'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe')), false);
  assert.equal(windowsRelatedWindow(row(40, 'C:\\WeChat\\WeChat.exe'), row(41, 'C:\\Chrome\\chrome.exe', 410, { title: 'WeChat' })), false);
  assert.equal(windowsRelatedWindow(row(40, 'C:\\Users\\Me\\Downloads\\one.exe'), row(41, 'C:\\Users\\Me\\Downloads\\two.exe')), false);
  assert.equal(windowsRelatedWindow(launcher, row(10, 'C:\\Tools\\crashpad_handler.exe')), false);
  assert.deepEqual([launcher, client, game].map(windowsWindowRole), ['launcher', 'client', 'game']);
});

test('frontend honors authoritative family, retains closed history and selects next live window', () => {
  const opened = { ...launcher, app: 'wegame', familyId: 'chain-a', windows: [launcher, client, game].map(item => ({ ...item, app: item.title, role: windowsWindowRole(item), alive: true })) };
  let tab = tabs.appWindowTab(opened, 'win32');
  assert.equal(tabs.isSameTabAppFamily(tab, { app: 'unrelated', familyId: 'chain-a' }), true);
  assert.equal(tabs.isSameTabAppFamily(tab, { app: 'wegame', familyId: 'chain-b' }), false);
  assert.equal(tabs.isSameTabAppFamily(tab, { app: 'chrome', title: 'WeGame' }), false);
  tab = tabs.selectTabWindow(tab, game.pid, game.windowId);
  tab = tabs.removeTabWindow(tab, game.pid, game.windowId);
  assert.deepEqual(tab.windowRef, { pid: client.pid, windowId: client.windowId });
  assert.equal(tab.windows.at(-1).alive, false);
  tab = tabs.selectTabWindow(tab, launcher.pid, launcher.windowId);
  assert.equal(tab.windows.length, 3, 'selection retains closed history');
  assert.equal(tabs.tabWindows(tab).length, 2);
  assert.equal(tabs.isFormalTabWindow({ app: 'gameoverlayui' }), false);
  assert.equal(tabs.isFormalTabWindow({ app: 'browser' }), true);
  const saved = tabs.serializeConversationTabs({ tabs: { c: [{ ...tab, createdAt: 1 }] }, active: {} });
  assert.equal(tabs.parseConversationTabs(saved).tabs.c[0].familyId, undefined, 'process-scoped chain identity never survives a restart');
});

test('main process follows a chain and preserves an unrelated tab, including live fallback data', async () => {
  let rows = [launcher], missing = new Set(); const events = [], calls = [];
  const service = {
    ready: async () => {}, capability: () => ({ canPark: true, sound: true }),
    topWindows: async () => ({ ok: true, windows: rows }),
    windowCapability: async (pid) => ({ ok: !missing.has(pid), canPark: true, ...(missing.has(pid) ? { parkReason: 'window_not_found' } : {}) }),
    park: async (...args) => { calls.push(['park', ...args]); return { ok: true }; },
    unpark: async (...args) => { calls.push(['unpark', ...args]); return { ok: true }; },
    mute: async (...args) => { calls.push(['mute', ...args]); return { ok: true }; },
    shield: async () => ({ ok: true }), restoreDesktops: async () => {}, dispose: async () => {}
  };
  const view = createComputerWindowView({ platform: 'win32', windowsServices: service, onWindowEvent: event => events.push(event) });
  try {
    const first = await view.openInTab('c', launcher.pid, launcher.windowId);
    const chrome = row(40, 'C:\\Chrome\\chrome.exe'); rows = [launcher, chrome];
    const second = await view.openInTab('c', chrome.pid, chrome.windowId);
    assert.notEqual(first.familyId, second.familyId);
    assert.equal(view.canView('c', launcher.pid, launcher.windowId), true);
    rows = [launcher, chrome, game, client];
    await view.snapshot('c', launcher.pid, launcher.windowId);
    const added = events.filter(event => event.type === 'window-added');
    assert.equal(added.length, 2);
    assert.ok(added.every(event => event.familyId === first.familyId));
    assert.deepEqual(added.at(-1).windows.map(item => item.role), ['launcher', 'client', 'game']);
    missing.add(game.pid); rows = [launcher, chrome, client];
    await view.snapshot('c', launcher.pid, launcher.windowId);
    assert.equal(events.find(event => event.type === 'window-closed').windows.at(-1).alive, false);
    assert.equal(view.canView('c', chrome.pid, chrome.windowId), true);
    await view.forget('c', launcher.pid, launcher.windowId, { close: false });
    await view.forget('c', client.pid, client.windowId, { close: false });
    rows.push(row(13, 'C:\\WeGameApps\\League\\LeagueClient.exe'));
    await view.snapshot('c', chrome.pid, chrome.windowId);
    assert.equal(events.filter(event => event.type === 'window-added').length, 2, 'closed chain must stop adopting windows');
  } finally { await view.dispose(); }
});
