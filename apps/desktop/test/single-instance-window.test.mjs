import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// One NextMux workbench window: a second launch (desktop shortcut, Dock, taskbar, tray or a
// nextmux:// link) brings back the existing window whether it is visible, minimized or hidden
// to the tray, and never reaches Theia's new-window dispatch while that window exists.
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', { paths: [new URL('../../../packages/theia-nextmux-extension/', import.meta.url).pathname] }));
const sourceUrl = new URL('../../../packages/theia-nextmux-extension/src/electron-main/nextmux-electron-main-module.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxElectronMainApplication');
const method = name => klass.members.find(node => node.name?.getText(file) === name).getText(file).replace(/^\s*(private|protected|public)\s+/, '');

function harness({ existing, showMain = () => false }) {
    const calls = [];
    class Base { async onSecondInstance(...args) { calls.push(['theia-new-window', ...args]); } }
    const showMainWindowKey = Symbol('show-main');
    const app = { [showMainWindowKey]: showMain, focus: options => calls.push(['app.focus', options?.steal === true]) };
    const Harness = new Function('Base', 'app', 'showMainWindowKey', ts.transpile(
        `class Harness extends Base { ${method('focusExistingWorkbenchWindow')} ${method('onSecondInstance')} }; return Harness;`,
        { target: ts.ScriptTarget.ES2022 }))(Base, app, showMainWindowKey);
    const instance = new Harness();
    instance.findExistingWorkbenchWindow = () => existing;
    instance.openUrl = async url => calls.push(['openUrl', url]);
    return { instance, calls };
}

function fakeWindow(state) {
    const calls = [];
    return { calls, state, isDestroyed: () => false, isMinimized: () => state.minimized,
        restore() { state.minimized = false; calls.push('restore'); }, show() { state.visible = true; calls.push('show'); }, focus() { calls.push('focus'); } };
}

for (const [label, state, expected] of [
    ['visible', { visible: true, minimized: false }, ['show', 'focus']],
    ['minimized', { visible: true, minimized: true }, ['restore', 'show', 'focus']],
    ['hidden to the tray', { visible: false, minimized: false }, ['show', 'focus']]
]) {
    test(`a second launch restores the ${label} workbench window and opens no other`, async () => {
        const window = fakeWindow(state);
        const { instance, calls } = harness({ existing: window });
        await instance.onSecondInstance({}, ['NextMux'], '/work', ['NextMux']);
        assert.deepEqual(window.calls, expected);
        assert.equal(window.state.visible, true);
        assert.equal(window.state.minimized, false);
        assert.ok(calls.some(([name, steal]) => name === 'app.focus' && steal), 'the app takes focus from the shortcut / Dock click');
        assert.equal(calls.filter(([name]) => name === 'theia-new-window').length, 0);
    });
}

test('a nextmux:// link is routed to the existing window first, then that window is shown', async () => {
    const window = fakeWindow({ visible: false, minimized: true });
    const { instance, calls } = harness({ existing: window });
    await instance.onSecondInstance({}, ['NextMux'], '/work', ['NextMux', '--open-url', 'nextmux://v1/import?resource=provider']);
    assert.deepEqual(calls[0], ['openUrl', 'nextmux://v1/import?resource=provider']);
    assert.deepEqual(window.calls, ['restore', 'show', 'focus']);
    assert.equal(calls.filter(([name]) => name === 'theia-new-window').length, 0);
});

test('the primary window shown by its own handler counts as existing; only no window at all lets Theia create one', async () => {
    const shownByPrimary = harness({ existing: undefined, showMain: () => true });
    await shownByPrimary.instance.onSecondInstance({}, ['NextMux'], '/work', ['NextMux']);
    assert.equal(shownByPrimary.calls.filter(([name]) => name === 'theia-new-window').length, 0);
    const none = harness({ existing: undefined });
    await none.instance.onSecondInstance({}, ['NextMux'], '/work', ['NextMux']);
    assert.equal(none.calls.filter(([name]) => name === 'theia-new-window').length, 1);
});

test('bootstrap takes the single-instance lock before the workbench starts and never releases it', () => {
    const bootstrap = readFileSync(new URL('../bootstrap.cjs', import.meta.url), 'utf8');
    const lock = bootstrap.indexOf('requestSingleInstanceLock(process.argv)');
    assert.ok(lock > 0 && lock < bootstrap.indexOf("require('./lib/backend/electron-main.js')"));
    assert.doesNotMatch(bootstrap, /releaseSingleInstanceLock/);
});

test('main-workbench classification excludes computer-tab, data overlay, owned-browser, and detached conversation windows', () => {
    const {
        detachedConversationWindowKey,
        isMainWorkbenchWindow,
        findMainWorkbenchWindow,
        focusMainWorkbenchWindow,
    } = require('../main-window-focus.cjs');
    const ownedBrowserKey = Symbol.for('nextmux.owned-browser.isRegistered.v1');
    const ownedContents = { getURL: () => 'file:///app/index.html', isLoading: () => false };
    const previousOwnedPredicate = globalThis[ownedBrowserKey];
    globalThis[ownedBrowserKey] = contents => contents === ownedContents;

    try {
        const makeWin = ({ url = 'file:///app/index.html', loading = false, detached = false, contents } = {}) => ({
            [detachedConversationWindowKey]: detached,
            isDestroyed: () => false,
            isMinimized: () => false,
            restore() {},
            show() {},
            focus() {},
            webContents: contents || { getURL: () => url, isLoading: () => loading }
        });

        const BrowserWindow = { getAllWindows: () => [] };
        const AppClass = new Function('Base', 'BrowserWindow', ts.transpile(
            `class AppClass extends Base { ${method('isWorkbenchWindow')} ${method('findExistingWorkbenchWindow')} }; return AppClass;`,
            { target: ts.ScriptTarget.ES2022 }))(class {}, BrowserWindow);
        const mainApp = new AppClass();
        mainApp.windows = new Map();

        const validMain = makeWin({ url: 'file:///app/lib/frontend/index.html', loading: false });
        const computerTab = makeWin({ url: 'file:///app/computer-tab-window.html' });
        const dataOverlay = makeWin({ url: 'data:text/html,<h1>overlay</h1>' });
        const queryConv = makeWin({ url: 'file:///app/lib/frontend/index.html?nextmuxConversation=s1' });
        const detachedBeforeLoad = makeWin({ url: '', detached: true });
        const detachedLoaded = makeWin({ url: 'file:///app/lib/frontend/index.html', detached: true });
        const ownedWin = makeWin({ contents: ownedContents });
        const emptyWin = makeWin({ url: '' });

        for (const bad of [computerTab, dataOverlay, queryConv, detachedBeforeLoad, detachedLoaded, ownedWin]) {
            assert.equal(isMainWorkbenchWindow(bad, { allowEmptyUrl: true }), false);
            assert.equal(mainApp.isWorkbenchWindow(bad, true), false);
        }
        assert.equal(isMainWorkbenchWindow(validMain), true);
        assert.equal(mainApp.isWorkbenchWindow(validMain), true);
        assert.equal(isMainWorkbenchWindow(emptyWin, { allowEmptyUrl: false }), false);
        assert.equal(isMainWorkbenchWindow(emptyWin, { allowEmptyUrl: true }), true);
        assert.equal(mainApp.isWorkbenchWindow(emptyWin, false), false);
        assert.equal(mainApp.isWorkbenchWindow(emptyWin, true), true);

        const loadingMain = makeWin({ url: 'file:///app/lib/frontend/index.html', loading: true });
        BrowserWindow.getAllWindows = () => [computerTab, loadingMain, validMain];
        assert.equal(findMainWorkbenchWindow(BrowserWindow), validMain, 'prefers finished-loading window over still-loading window');
        assert.equal(mainApp.findExistingWorkbenchWindow(), validMain, 'Theia main app also prefers finished-loading window');

        const fullscreenCalls = [];
        const fullscreenMain = {
            isDestroyed: () => false,
            isMinimized: () => false,
            isFullScreen: () => true,
            restore: () => fullscreenCalls.push('restore'),
            show: () => fullscreenCalls.push('show'),
            focus: () => fullscreenCalls.push('focus'),
            moveTop: () => assert.fail('must never call moveTop'),
            setAlwaysOnTop: () => assert.fail('must never call setAlwaysOnTop'),
            setVisibleOnAllWorkspaces: () => assert.fail('must never call setVisibleOnAllWorkspaces'),
            webContents: { getURL: () => 'file:///app/index.html', isLoading: () => false }
        };
        const focusAppCalls = [];
        const focused = focusMainWorkbenchWindow({
            app: { focus: opts => focusAppCalls.push(opts) },
            BrowserWindow: { getAllWindows: () => [fullscreenMain] },
            platform: 'darwin'
        });
        assert.equal(focused, fullscreenMain);
        assert.deepEqual(fullscreenCalls, ['show', 'focus']);
        assert.deepEqual(focusAppCalls, [{ steal: true }]);
    } finally {
        globalThis[ownedBrowserKey] = previousOwnedPredicate;
    }
});

test('focusExistingWorkbenchWindow returns primary BrowserWindow when showMain handled focus so openDefaultWindow/openWindowWithWorkspace do not duplicate', async () => {
    const primaryWin = fakeWindow({ visible: true, minimized: false });
    const showMainWindowKey = Symbol('show-main');
    const primaryKey = Symbol.for('nextmux.desktop.primary-main-window.v1');
    let superOpenDefault = 0;
    let superOpenWorkspace = 0;
    class Base {
        async openDefaultWindow() { superOpenDefault += 1; return { created: 'default' }; }
        async openWindowWithWorkspace() { superOpenWorkspace += 1; return { created: 'workspace' }; }
    }
    const app = {
        [showMainWindowKey]: () => true,
        [primaryKey]: () => primaryWin,
        focus: () => {}
    };
    const Harness = new Function('Base', 'app', 'showMainWindowKey', ts.transpile(
        `class Harness extends Base { ${method('focusExistingWorkbenchWindow')} ${method('openDefaultWindow')} ${method('openWindowWithWorkspace')} }; return Harness;`,
        { target: ts.ScriptTarget.ES2022 }))(Base, app, showMainWindowKey);
    const instance = new Harness();
    instance.findExistingWorkbenchWindow = () => undefined;
    assert.equal(await instance.openDefaultWindow(), primaryWin);
    assert.equal(await instance.openWindowWithWorkspace('/work'), primaryWin);
    assert.equal(superOpenDefault, 0);
    assert.equal(superOpenWorkspace, 0);
});

test('bootstrap preserves detached conversation window titles while keeping NextMux on the main workbench window', () => {
    const { isDetachedConversationWindow, detachedConversationWindowKey } = require('../main-window-focus.cjs');
    const bootstrap = readFileSync(new URL('../bootstrap.cjs', import.meta.url), 'utf8');
    assert.match(bootstrap, /if\s*\(!isDetachedConversationWindow\(window\)\)\s*window\.setTitle\('NextMux'\);/);
    const mainWin = { isDestroyed: () => false, webContents: { getURL: () => 'file:///app/index.html' } };
    const detachedMarked = { [detachedConversationWindowKey]: true, isDestroyed: () => false, webContents: { getURL: () => 'file:///app/index.html' } };
    const detachedUrl = { isDestroyed: () => false, webContents: { getURL: () => 'file:///app/index.html?nextmuxConversation=123' } };
    assert.equal(isDetachedConversationWindow(mainWin), false);
    assert.equal(isDetachedConversationWindow(detachedMarked), true);
    assert.equal(isDetachedConversationWindow(detachedUrl), true);
});

test('updater reuses one lazy createWindowsApps singleton across pick, describe, and icon IPC handlers', () => {
    const updater = readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');
    const matches = updater.match(/createWindowsApps\(\{/g) || [];
    assert.equal(matches.length, 1, 'createWindowsApps must only be instantiated in the shared lazy getter');
    assert.match(updater, /const getWindowsApps = \(\) => \{/);
    assert.equal((updater.match(/getWindowsApps\(\)\./g) || []).length, 3);
});
