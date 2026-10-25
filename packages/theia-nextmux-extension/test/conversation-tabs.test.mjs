import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tabs = require('../lib/browser/nextmux-conversation-tabs.js');

test('tabs belong to one conversation and never leak into another', () => {
    let state = tabs.emptyConversationTabs();
    state = tabs.openVisualTab(state, 'a', { id: 'app:safari', kind: 'local-desktop', title: 'Safari', target: 'Safari', status: 'connected', createdAt: 1 });
    assert.equal(tabs.visualTabsFor(state, 'a').length, 1);
    assert.equal(tabs.visualTabsFor(state, 'b').length, 0);
    assert.equal(tabs.activeTabFor(state, 'a'), 'app:safari');
    assert.equal(tabs.activeTabFor(state, 'b'), tabs.CONVERSATION_TAB_ID);
});

test('a tab is opened on purpose for one app window and named after the app', () => {
    const tab = tabs.appWindowTab({ pid: 42, windowId: 7, app: 'WeChat', title: '微信' }, 'darwin');
    assert.deepEqual(tab, {
        id: 'window:42:7',
        kind: 'local-desktop',
        title: 'WeChat',
        target: '微信',
        platform: 'macos',
        status: 'connected',
        windowRef: { pid: 42, windowId: 7 },
        windows: [{ pid: 42, windowId: 7, app: 'WeChat', title: '微信', alive: true }]
    });
    assert.equal(tabs.appWindowTabId(42, 7), tab.id);
    assert.equal(tabs.appWindowTab({ pid: 9, windowId: 3, app: ' ' }, 'win32').title, 'PID 9');
});

test('working on the user\'s desktop never opens a tab; a look at a tab\'s window refreshes its last frame', () => {
    assert.equal(tabs.computerTabRefresh('openApp', { selector: 'Notes' }, { ok: true }), undefined, 'computer.open_app does not create tabs');
    assert.equal(tabs.computerTabRefresh('click', { pid: 1, windowId: 1 }, { ok: true }), undefined);
    assert.equal(tabs.computerTabRefresh('observeWindow', { pid: 1, windowId: 1 }, { ok: false }), undefined);
    assert.deepEqual(tabs.computerTabRefresh('observeWindow', { pid: 42, windowId: 7 }, { ok: true, images: [{ mimeType: 'image/png', data: 'AAAA' }] }),
        { pid: 42, windowId: 7, frameUrl: 'data:image/png;base64,AAAA' });
    assert.deepEqual(tabs.computerTabRefresh('observeWindow', { pid: 42, windowId: 7 }, { ok: true, images: [{ mimeType: 'image/gif', data: 'AAAA' }] }), { pid: 42, windowId: 7 });
    assert.equal(tabs.computerTabRefresh('observeWindow', { pid: 42, windowId: 0 }, { ok: true }), undefined);
});

test('persisted tabs drop frames and come back disconnected', () => {
    let state = tabs.openVisualTab(tabs.emptyConversationTabs(), 'a',
        { id: 'app:x', kind: 'local-desktop', title: 'X', target: 'X', status: 'connected', frameUrl: 'data:image/png;base64,AA', createdAt: 1 });
    const restored = tabs.parseConversationTabs(tabs.serializeConversationTabs(state));
    assert.equal(restored.tabs.a[0].status, 'disconnected');
    assert.equal(restored.tabs.a[0].frameUrl, undefined);
    // Process and window numbers mean nothing after a restart: the live view is never restored from disk.
    state = tabs.openVisualTab(state, 'a', { id: 'app:x', kind: 'local-desktop', title: 'X', target: 'X', status: 'connected', windowRef: { pid: 5, windowId: 6 }, createdAt: 1 });
    assert.doesNotMatch(tabs.serializeConversationTabs(state), /windowRef/);
    const forged = JSON.stringify({ version: 1, tabs: { a: [{ id: 'app:y', kind: 'local-desktop', title: 'Y', target: 'Y', status: 'connected', windowRef: { pid: 1, windowId: 2 } }] }, active: {} });
    assert.equal(tabs.parseConversationTabs(forged).tabs.a[0].windowRef, undefined);
});

test('a tab says what kind of app it holds, so "message Xu" with two messaging apps open is asked about', () => {
    for (const title of ['WeChat', '微信', 'QQ', 'Telegram', 'Slack', '飞书', '钉钉 · 工作台', 'Microsoft Teams']) assert.equal(tabs.appTabKind(title), 'messaging', title);
    for (const title of ['Calculator', '计算器', 'Finder', '访达']) assert.equal(tabs.appTabKind(title), 'other', title);
    for (const title of ['QQ音乐', '网易云音乐', 'Spotify', '音乐']) assert.equal(tabs.appTabKind(title), 'music', title);
    for (const title of ['Steam', 'QQ游戏', 'WeGame', '冒险岛Online游戏']) assert.equal(tabs.appTabKind(title), 'game', title);
    for (const title of ['腾讯视频', '哔哩哔哩HD', 'YouTube']) assert.equal(tabs.appTabKind(title), 'video', title);
    for (const title of ['腾讯会议', 'zoom.us']) assert.equal(tabs.appTabKind(title), 'meeting', title);
    for (const title of ['支付宝', '招商银行', '股市']) assert.equal(tabs.appTabKind(title), 'finance', title);
    for (const title of ['Microsoft Word', 'WPS Office', '备忘录']) assert.equal(tabs.appTabKind(title), 'documents', title);
    assert.equal(tabs.appTabKind('QQ邮箱'), 'email');
    assert.equal(tabs.appTabKind('QQ浏览器'), 'browser');
    assert.equal(tabs.appTabKind('Mail'), 'email');
    assert.equal(tabs.appTabKind('Google Chrome'), 'browser');
});

test('appTabIdentity extracts exe basenames, programs and titles so Windows launcher and desktop tabs match plugins', () => {
    const { pluginsForApp } = require('../lib/browser/nextmux-app-plugins-view.js');
    const tab = tabs.appWindowTab({
        pid: 1200, windowId: 88, app: '英雄联盟WeGame版', title: 'WeGame',
        appId: 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe',
        programs: ['browser', 'launcher']
    }, 'win32');
    const identity = tabs.appTabIdentity(tab);
    assert.ok(identity.includes('launcher'));
    assert.ok(identity.includes('browser'));
    assert.ok(identity.includes('wegame'));
    const plugins = [
        { id: 'com.example.wegame', ok: true, enabled: true, summary: { id: 'com.example.wegame', name: 'WeGame Helper', version: '1.0.0', apps: [{ platform: 'windows', program: 'wegame' }] } },
        { id: 'com.example.notepad', ok: true, enabled: true, summary: { id: 'com.example.notepad', name: 'Notepad Helper', version: '1.0.0', apps: [{ platform: 'windows', program: 'notepad' }] } }
    ];
    assert.deepEqual(pluginsForApp(plugins, identity, 'win32').map(p => p.id), ['com.example.wegame']);
});

test('multi-window app flow (WeGame -> LeagueClientUx -> League of Legends) stays in one tab, shows the latest formal window, and switches via dropdown', () => {
    assert.equal(tabs.isFormalTabWindow({ app: 'cef_frame_render', title: 'WeGame Popup' }), false);
    assert.equal(tabs.isFormalTabWindow({ app: 'pallas', title: 'WeGame Helper' }), false);
    assert.equal(tabs.isFormalTabWindow({ app: 'WeGame', title: 'WeGame' }), true);
    assert.equal(tabs.isFormalTabWindow({ app: 'LeagueClientUx', title: 'League of Legends' }), true);
    assert.equal(tabs.isFormalTabWindow({ app: 'League of Legends', title: 'League of Legends (TM) Client' }), true);

    const base = {
        ...tabs.appWindowTab({ pid: 3420, windowId: 4590396, app: '英雄联盟WeGame版', title: 'WeGame', appId: 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe', programs: ['wegame'] }, 'win32'),
        createdAt: 100
    };
    let tab = tabs.attachTabWindow(base, { pid: 3420, windowId: 4590396, app: 'WeGame', title: 'WeGame' }, true);
    assert.equal(tab.id, 'window:3420:4590396');
    assert.deepEqual(tab.windowRef, { pid: 3420, windowId: 4590396 });
    assert.equal(tabs.tabWindows(tab).length, 1);

    // Client lobby opens -> attaches to the same tab and becomes the active displayed window
    tab = tabs.attachTabWindow(tab, { pid: 20852, windowId: 1510622, app: 'LeagueClientUx', title: 'League of Legends', followed: true }, true);
    assert.equal(tab.id, 'window:3420:4590396', 'tab id remains the single tab');
    assert.deepEqual(tab.windowRef, { pid: 20852, windowId: 1510622 }, 'latest formal window (LeagueClientUx) is displayed');
    assert.equal(tab.target, 'League of Legends');
    assert.equal(tabs.tabWindows(tab).length, 2);

    // In-game client opens -> attaches to the same tab and becomes the active displayed window (最后一个正式的窗口)
    tab = tabs.attachTabWindow(tab, { pid: 3332, windowId: 6294172, app: 'League of Legends', title: 'League of Legends (TM) Client', followed: true }, true);
    assert.equal(tab.id, 'window:3420:4590396');
    assert.deepEqual(tab.windowRef, { pid: 3332, windowId: 6294172 }, 'latest formal window (League of Legends (TM) Client) is displayed');
    assert.equal(tab.target, 'League of Legends (TM) Client');
    assert.equal(tabs.tabWindows(tab).length, 3);

    // User selects LeagueClientUx from the dropdown next to "实时"
    const switched = tabs.selectTabWindow(tab, 20852, 1510622);
    assert.deepEqual(switched.windowRef, { pid: 20852, windowId: 1510622 });
    assert.equal(switched.target, 'League of Legends');
    assert.equal(tabs.tabWindows(switched).length, 3);

    // Match ends and in-game window (3332:6294172) closes -> falls back to LeagueClientUx (20852:1510622) while staying connected
    const afterGameExit = tabs.removeTabWindow(tab, 3332, 6294172);
    assert.equal(afterGameExit.status, 'connected');
    assert.deepEqual(afterGameExit.windowRef, { pid: 20852, windowId: 1510622 });
    assert.equal(afterGameExit.target, 'League of Legends');
    assert.equal(tabs.tabWindows(afterGameExit).length, 2);

    // findConversationTabByTarget resolves any window inside the single tab
    assert.equal(tabs.findConversationTabByTarget([tab], 'window:3332:6294172')?.id, 'window:3420:4590396');
    assert.equal(tabs.findConversationTabByTarget([tab], undefined, 20852, 1510622)?.id, 'window:3420:4590396');
    assert.equal(tabs.findConversationTabByTarget([tab], undefined, 3420, undefined)?.id, 'window:3420:4590396');

    // WeGame -> LeagueClientUx -> League of Legends belong to the same tab app family, whereas independent apps (Grok Bot) do not
    assert.equal(tabs.isSameTabAppFamily(tab, { app: 'LeagueClientUx', title: 'League of Legends' }), true);
    assert.equal(tabs.isSameTabAppFamily(tab, { app: 'League of Legends', title: 'League of Legends (TM) Client' }), true);
    assert.equal(tabs.isSameTabAppFamily(tab, { app: '英雄联盟WeGame版', title: 'WeGame', appId: 'C:\\WeGameApps\\英雄联盟\\WeGameLauncher\\launcher.exe' }), true);
    assert.equal(tabs.isSameTabAppFamily(tab, { app: 'Grok Bot', title: 'Grok Bot', appId: 'com.grokbot.desktop', programs: ['browser', 'Grok Bot'] }), false);
});


