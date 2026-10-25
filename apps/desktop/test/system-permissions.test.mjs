import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { settingsUrl, appBundlePath, permissionStatus, resolveMicrophonePermissionStatus, windowsMicrophoneStatus, registerSystemPermissions, audioPermissionAllowed } = require('../system-permissions.cjs');

test('each permission opens the settings page that exists on that macOS / Windows version', () => {
    // macOS 12 Monterey: System Preferences; 13 Ventura and later: System Settings.
    assert.equal(settingsUrl('accessibility', 'darwin', 12), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    assert.equal(settingsUrl('accessibility', 'darwin', 13), 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility');
    assert.equal(settingsUrl('screen', 'darwin', 15), 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture');
    assert.equal(settingsUrl('microphone', 'darwin', 26), 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone');
    // Local Network privacy exists from macOS 15.
    assert.equal(settingsUrl('localNetwork', 'darwin', 14), '');
    assert.match(settingsUrl('localNetwork', 'darwin', 15), /Privacy_LocalNetwork$/);
    // Windows 10 has no screen-capture page; Windows 11 (build 22000+) does.
    assert.equal(settingsUrl('screen', 'win32', 19045), 'ms-settings:privacy');
    assert.equal(settingsUrl('screen', 'win32', 22631), 'ms-settings:privacy-graphicsCaptureProgrammatic');
    assert.equal(settingsUrl('microphone', 'win32', 19045), 'ms-settings:privacy-microphone');
    assert.equal(settingsUrl('camera', 'darwin', 15), '');
    assert.equal(settingsUrl('camera', 'win32', 22631), '');
    assert.equal(settingsUrl('accessibility', 'linux', 0), '');
});

test('the draggable item is the .app bundle macOS lists in Privacy & Security', () => {
    assert.equal(appBundlePath('/Applications/NextMux.app/Contents/MacOS/NextMux'), '/Applications/NextMux.app');
    assert.equal(appBundlePath('/Users/a/nm/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), '/Users/a/nm/node_modules/electron/dist/Electron.app');
    assert.equal(appBundlePath('C:\\Program Files\\NextMux\\NextMux.exe'), '');
});

test('status reports real grants and never claims an unknown permission is granted', () => {
    const prefs = { isTrustedAccessibilityClient: () => false, getMediaAccessStatus: kind => kind === 'microphone' ? 'granted' : 'not-determined' };
    const mac = permissionStatus({ systemPreferences: prefs, platform: 'darwin' });
    const byKind = Object.fromEntries(mac.items.map(item => [item.kind, item]));
    assert.equal(byKind.accessibility.status, 'denied');
    assert.equal(byKind.accessibility.draggable, true);
    assert.equal(byKind.screen.status, 'not-determined');
    assert.equal(byKind.screen.relaunchAfterGrant, true);
    assert.equal(byKind.microphone.status, 'granted');
    assert.equal(byKind.automation.status, 'unknown');
    assert.equal(byKind.camera, undefined);
    assert.ok(mac.items.every(item => typeof item.settingsUrl === 'string'));
    const win = permissionStatus({ systemPreferences: { getMediaAccessStatus: () => 'denied' }, platform: 'win32', computerCapability: { available: false, reason: 'worker_install_required' } });
    const winKinds = Object.fromEntries(win.items.map(item => [item.kind, item]));
    assert.equal(winKinds.microphone.status, 'denied');
    assert.equal(winKinds.accessibility.status, 'denied');
    assert.equal(winKinds.accessibility.elevation, true);
    assert.equal(winKinds.screen.status, 'granted', 'Windows desktop apps need no screen-capture grant');
    assert.equal(winKinds.camera, undefined);

    // Partial/unreadable Windows registry read without NonPackaged=Allow is unknown, never granted
    let t0 = 100_000;
    assert.equal(windowsMicrophoneStatus(key => key.startsWith('HKLM') ? 'Allow' : undefined, t0 += 10_000), 'unknown');
    assert.equal(windowsMicrophoneStatus(key => key.endsWith('NonPackaged') ? 'Allow' : 'Allow', t0 += 10_000), 'granted');
    assert.equal(windowsMicrophoneStatus(key => key.endsWith('NonPackaged') ? 'Deny' : 'Allow', t0 += 10_000), 'denied');
    assert.equal(windowsMicrophoneStatus(key => key.startsWith('HKLM') ? 'Deny' : 'Allow', t0 += 10_000), 'restricted');
    assert.equal(resolveMicrophonePermissionStatus({
        systemPreferences: { getMediaAccessStatus: () => 'restricted' },
        platform: 'win32',
        windowsMicrophone: () => 'granted'
    }), 'restricted');
    assert.equal(resolveMicrophonePermissionStatus({
        systemPreferences: { getMediaAccessStatus: () => 'granted' },
        platform: 'win32',
        windowsMicrophone: () => 'unknown'
    }), 'unknown');
});

test('only the trusted main frame may query or request permissions', async () => {
    const handlers = new Map();
    const opened = [];
    registerSystemPermissions({
        ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeAllListeners() {} },
        app: { on() {}, relaunch() {}, quit() {} },
        systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true },
        shell: { openExternal: async url => { opened.push(url); } },
        desktopCapturer: { getSources: async () => [] },
        BrowserWindow: { getAllWindows: () => [] },
        nativeImage: { createEmpty: () => ({ isEmpty: () => true }) },
        screen: {},
        trustedMainFrame: event => event.trusted === true
    });
    const untrusted = { trusted: false, sender: { isDestroyed: () => false } };
    const trusted = { trusted: true, sender: { isDestroyed: () => false } };
    assert.equal(await handlers.get('nextmux:permissions:status')(untrusted), undefined);
    assert.equal(await handlers.get('nextmux:permissions:open-settings')(untrusted, 'microphone'), false);
    assert.equal(await handlers.get('nextmux:permissions:open-settings')(trusted, 'bogus'), false);
    assert.equal(await handlers.get('nextmux:permissions:open-settings')(trusted, 'camera'), false);
    assert.ok((await handlers.get('nextmux:permissions:status')(trusted)).items);
    assert.equal(opened.length, 0);
});

test('the full macOS permission list maps to the right panes, and Windows to its pages', () => {
    assert.match(settingsUrl('fullDisk', 'darwin', 14), /Privacy_AllFiles$/);
    assert.match(settingsUrl('files', 'darwin', 14), /Privacy_FilesAndFolders$/);
    assert.match(settingsUrl('inputMonitoring', 'darwin', 13), /Privacy_ListenEvent$/);
    assert.match(settingsUrl('speechRecognition', 'darwin', 12), /com\.apple\.preference\.security\?Privacy_SpeechRecognition$/);
    assert.match(settingsUrl('appManagement', 'darwin', 13), /Privacy_AppBundles$/);
    assert.equal(settingsUrl('appManagement', 'darwin', 12), '', 'App Management starts with macOS 13');
    assert.equal(settingsUrl('notifications', 'darwin', 13), 'x-apple.systempreferences:com.apple.Notifications-Settings.extension');
    assert.equal(settingsUrl('notifications', 'darwin', 12), 'x-apple.systempreferences:com.apple.preference.notifications');
    assert.equal(settingsUrl('notifications', 'win32', 22631), 'ms-settings:notifications');
    assert.equal(settingsUrl('speechRecognition', 'win32', 19045), 'ms-settings:privacy-speech');
});

test('essential and on-demand permissions are separated; Full Disk Access is probed, not guessed', () => {
    const prefs = { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' };
    const mac = permissionStatus({ systemPreferences: prefs, platform: 'darwin', fullDisk: () => 'denied' });
    const essential = mac.items.filter(item => item.essential).map(item => item.kind);
    assert.deepEqual(essential, ['accessibility', 'screen', 'microphone', 'notifications']);
    const byKind = Object.fromEntries(mac.items.map(item => [item.kind, item]));
    assert.equal(byKind.fullDisk.status, 'denied');
    assert.equal(byKind.camera, undefined);
    assert.ok(!byKind.notifications.status || byKind.notifications.status !== 'granted', 'notification permission is never claimed');
});

test('the drag helper shows the NextMux logo, closes with ×, on return to NextMux and before relaunch, and never piles up', { skip: process.platform !== 'darwin' }, async () => {
    const execPath = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '/Applications/NextMux.app/Contents/MacOS/NextMux', configurable: true, writable: true });
    try {
        const on = new Map(); const handlers = new Map(); const appListeners = new Map(); const calls = [];
        const windows = [];
        const coordinatorKey = Symbol.for('nextmux.desktop.close-coordinator.v1');
        class FakeWindow {
            constructor() {
                this.destroyed = false; this.shown = false; this.listeners = new Map();
                this[coordinatorKey] = { managed: false };
                this.webContents = { on() {}, setWindowOpenHandler() {}, startDrag: options => calls.push(['drag', options.file]) };
                windows.push(this);
            }
            static getAllWindows() { return windows.filter(window => !window.destroyed); }
            setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
            on(name, listener) { this.listeners.set(name, listener); }
            async loadURL(url) { this.url = url; await new Promise(resolve => setTimeout(resolve, 5)); }
            showInactive() { this.shown = true; }
            isDestroyed() { return this.destroyed; }
            close() { throw new Error('close() would wait for a save handshake; the helper is destroyed'); }
            destroy() { this.destroyed = true; this.listeners.get('closed')?.(); }
        }
        const loaded = [];
        const image = { isEmpty: () => false, resize() { return this; }, toDataURL: () => 'data:image/png;base64,TkVYVE1VWA==' };
        const api = registerSystemPermissions({
            ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => on.set(name, fn), removeAllListeners() {} },
            app: { on: (name, fn) => appListeners.set(name, fn), relaunch: () => calls.push(['relaunch']), quit: () => calls.push(['quit']),
                getAppPath: () => new URL('..', import.meta.url).pathname },
            systemPreferences: { isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => 'denied', askForMediaAccess: async () => false },
            shell: { openExternal: async () => undefined },
            desktopCapturer: { getSources: async () => [] },
            BrowserWindow: FakeWindow,
            nativeImage: { createEmpty: () => ({ isEmpty: () => true }), createFromPath: file => { loaded.push(file); return image; } },
            screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
            trustedMainFrame: () => true
        });
        const trusted = { sender: { isDestroyed: () => false } };
        const live = () => windows.filter(window => !window.destroyed);
        // Two quick requests: only the newer helper stays.
        await Promise.all([handlers.get('nextmux:permissions:request')(trusted, 'fullDisk'), handlers.get('nextmux:permissions:request')(trusted, 'screen')]);
        assert.equal(live().length, 1);
        assert.match(loaded[0], /build-resources\/icon\.png$/, 'our logo, not the bundle (Electron in development)');
        assert.equal(live()[0][coordinatorKey].managed, true);
        on.get('nextmux:permission-helper:drag')({ sender: live()[0].webContents });
        assert.deepEqual(calls.at(-1), ['drag', '/Applications/NextMux.app']);
        // × from another page does nothing; from the helper it closes it.
        on.get('nextmux:permission-helper:close')({ sender: {} });
        assert.equal(live().length, 1);
        on.get('nextmux:permission-helper:close')({ sender: live()[0].webContents });
        assert.equal(live().length, 0);
        // Coming back to NextMux after dragging closes it (Screen Recording only reports the grant after a relaunch).
        await handlers.get('nextmux:permissions:request')(trusted, 'screen');
        appListeners.get('browser-window-focus')({}, live()[0]);
        assert.equal(live().length, 1, 'focusing the helper itself keeps it');
        const now = Date.now;
        Date.now = () => now() + 2000;
        try { appListeners.get('browser-window-focus')({}, { id: 'workbench' }); } finally { Date.now = now; }
        assert.equal(live().length, 0);
        // Restart closes the helper first, then relaunches and quits.
        await handlers.get('nextmux:permissions:request')(trusted, 'screen');
        assert.equal(await handlers.get('nextmux:permissions:relaunch')(trusted), true);
        assert.equal(live().length, 0);
        assert.deepEqual(calls.slice(-2), [['relaunch'], ['quit']]);
        api.closeHelper();
    } finally {
        Object.defineProperty(process, 'execPath', { value: execPath, configurable: true, writable: true });
    }
});

test('only NextMux\'s own pages get the microphone; a site framed inside the workbench and the camera never do', () => {
    const page = url => ({ getURL: () => url });
    const workbench = page('file:///Applications/NextMux.app/Contents/Resources/app/lib/frontend/index.html');
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'media', origin: 'file:///', mediaType: 'audio' }), true);
    assert.equal(audioPermissionAllowed({ webContents: page('http://localhost:3000/'), permission: 'media', mediaTypes: ['audio'] }), true);
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'speaker-selection' }), true);
    // A cross-origin frame inside the trusted window asks: refused.
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'media', origin: 'https://example.com', mediaType: 'audio' }), false);
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'media', origin: 'null', mediaTypes: ['audio'] }), false);
    // The camera, other permissions and foreign pages: refused.
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'media', mediaType: 'video' }), false);
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'media', mediaTypes: ['audio', 'video'] }), false);
    assert.equal(audioPermissionAllowed({ webContents: workbench, permission: 'geolocation' }), false);
    assert.equal(audioPermissionAllowed({ webContents: page('https://example.com/'), permission: 'media', origin: 'file:///' }), false);
    // Without a page, the origin decides.
    assert.equal(audioPermissionAllowed({ webContents: null, permission: 'media', origin: 'file:///' }), true);
    assert.equal(audioPermissionAllowed({ webContents: null, permission: 'media', origin: 'https://example.com' }), false);
    assert.equal(audioPermissionAllowed({ webContents: { getURL() { throw new Error('destroyed'); } }, permission: 'media' }), false);
});
