'use strict';

// Internal rendering child must bypass normal workbench, data-location and single-instance startup.
if (process.env.NEXTMUX_COMIC_VISUAL_WORKER === '1') {
  require('./comic-visual-renderer.cjs');
  return;
}

for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') {
    stream.on('error', () => undefined);
  }
}

const electron = require('electron');

// Development launches use Electron's own binary, whose default macOS
// application name is simply “Electron”. Set the product identity before any
// Theia modules create a window so the custom app is discoverable as NextMux
// (and cannot be mistaken for Electron's stock default_app screen).
electron.app.setName('NextMux');
// Where NextMux keeps its data (apart from the install folder): portable, the user's chosen folder, or the default.
// Decided before anything reads it; the backend inherits NEXTMUX_DESKTOP_STATE_DIR (data-location.cjs).
const dataLocation = require('./data-location.cjs');
let resolvedDataLocation;
try { resolvedDataLocation = dataLocation.resolveDataLocation({ app: electron.app }); }
catch (error) {
  if (error?.code !== 'portable_profile_unavailable') throw error;
  // Explain instead of crashing with a raw main-process error; nothing has been written anywhere else.
  electron.dialog.showErrorBox('NextMux', `NextMux cannot write its portable data folder:\n${error.path}\n\n`
    + 'Move NextMux to a folder you can write to, or make this drive writable, then start it again. Your data in that folder is unchanged.\n\n'
    + `NextMux 无法写入便携数据文件夹：\n${error.path}\n\n请把 NextMux 移到可写入的位置，或解除该磁盘的只读状态后重新打开。该文件夹中的数据未被改动。`);
  electron.app.exit(1);
  // CommonJS module scope: stop here, nothing below may start with an undecided data folder.
  return;
}
if (typeof electron.app?.requestSingleInstanceLock === 'function' && !electron.app.requestSingleInstanceLock(process.argv)) {
  electron.app.exit(0);
  return;
}
// Theia derives a native window title from the opened workspace (for example
// “NextMux - 33”).  NextMux is the product identity, so keep every workbench
// and detached conversation window branded consistently across macOS and
// Windows while still allowing the renderer to update its document title.
const { isDetachedConversationWindow } = require('./main-window-focus.cjs');
electron.app.on('browser-window-created', (_event, window) => {
  window.on('page-title-updated', event => {
    event.preventDefault();
    if (!isDetachedConversationWindow(window)) window.setTitle('NextMux');
  });
  window.setTitle('NextMux');
  // Main-window size adapts to the display work area before creation; see
  // packages/theia-nextmux-extension/src/electron-main/nextmux-window-bounds.ts.
});
// Curated MCP presets use the same prepared payloads and Electron's Node in
// development and packaged builds. A GUI-launched npx can otherwise resolve an
// older system Node (Playwright requires Node >= 20). User commands stay intact.
process.env.NEXTMUX_PACKAGED_RUNTIME = electron.app.isPackaged ? '1' : '0';
process.env.NEXTMUX_RESOURCES_PATH = electron.app.isPackaged
  ? process.resourcesPath : require('node:path').join(__dirname, 'build-resources');
if (process.platform === 'win32') {
  electron.app.setAppUserModelId?.('io.nextmux.desktop');
  if (typeof electron.app?.commandLine?.appendSwitch === 'function') {
    const existing = typeof electron.app.commandLine.getSwitchValue === 'function'
      ? electron.app.commandLine.getSwitchValue('disable-features') : '';
    const features = new Set(String(existing || '').split(',').map(item => item.trim()).filter(Boolean));
    features.add('WebRtcAllowWgcWindowCapturer');
    features.add('WebRtcAllowWgcScreenCapturer');
    electron.app.commandLine.appendSwitch('disable-features', [...features].join(','));
  }
}

require('./deep-link.cjs').installNextMuxDeepLinks(electron);
const updater = require('./updater.cjs');
const { GuestAutomation, registerBrowserAutomation } = require('./browser-automation.cjs');
const { createOwnedBrowserRegistry, isRegisteredOwnedBrowserContents } = require('./owned-browser-registry.cjs');
const ownedBrowserRegistry = createOwnedBrowserRegistry({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  BaseWindow: electron.BaseWindow,
  WebContentsView: electron.WebContentsView,
  session: electron.session,
  GuestAutomation,
  trustedMainFrame: updater.trustedMainFrame
});
// Theia runs in this same main process; renderer JavaScript cannot access it.
// Install once, read-only, before Theia creates any web contents. A partition
// name or contents type never grants this exception.
Object.defineProperty(globalThis, Symbol.for('nextmux.owned-browser.isRegistered.v1'), {
  value: isRegisteredOwnedBrowserContents, configurable: false, writable: false, enumerable: false
});
require('./owned-browser-ipc.cjs').registerOwnedBrowserIpc({ ipcMain: electron.ipcMain, registry: ownedBrowserRegistry });
electron.app.once('will-quit', () => { void ownedBrowserRegistry.dispose(); });
registerBrowserAutomation({
  ipcMain: electron.ipcMain,
  webContents: electron.webContents,
  session: electron.session,
  trustedMainFrame: updater.trustedMainFrame,
  ownedRegistry: ownedBrowserRegistry
});
const computerAutomation = require('./computer-automation.cjs').registerComputerAutomation({
  ipcMain: electron.ipcMain,
  app: electron.app,
  systemPreferences: electron.systemPreferences,
  trustedMainFrame: updater.trustedMainFrame,
  // The glowing screen frame while the AI controls the computer (created after app ready).
  BrowserWindow: electron.BrowserWindow,
  screen: () => electron.screen,
  // The live view of the window the AI works in, shown in the conversation's tab (computer-window-view.cjs).
  desktopCapturer: electron.desktopCapturer,
  session: () => electron.session,
  webContents: electron.webContents,
  // Skill plugins: picking packages, the Trash, the global stop shortcut, decoding their PNG images.
  shell: electron.shell,
  dialog: electron.dialog,
  globalShortcut: electron.globalShortcut,
  nativeImage: electron.nativeImage
});
electron.app.whenReady().then(() => require('./system-permissions.cjs').registerSystemPermissions({
  ipcMain: electron.ipcMain,
  app: electron.app,
  systemPreferences: electron.systemPreferences,
  shell: electron.shell,
  desktopCapturer: electron.desktopCapturer,
  BrowserWindow: electron.BrowserWindow,
  nativeImage: electron.nativeImage,
  screen: electron.screen,
  trustedMainFrame: updater.trustedMainFrame,
  computer: computerAutomation,
  Notification: electron.Notification
}));
electron.app.whenReady().then(() => require('./system-notifications.cjs').registerSystemNotifications({
  ipcMain: electron.ipcMain,
  Notification: electron.Notification,
  BrowserWindow: electron.BrowserWindow,
  app: electron.app,
  trustedMainFrame: updater.trustedMainFrame
}));
electron.app.whenReady().then(() => dataLocation.registerDataLocation({ ipcMain: electron.ipcMain, app: electron.app, dialog: electron.dialog,
  shell: electron.shell, trustedMainFrame: updater.trustedMainFrame, resolved: resolvedDataLocation }));
// A data move the user asked for runs before the workbench and its backend start, with a small progress window.
if (resolvedDataLocation.mode === 'custom_unavailable') {
  // The chosen data folder is missing (offline drive): ask before anything reads or creates it.
  electron.app.whenReady().then(async () => {
    const choice = await dataLocation.chooseForUnavailableData({ app: electron.app, dialog: electron.dialog, root: resolvedDataLocation.root }).catch(() => 'quit');
    if (choice === 'default') {
      // Settings shows the folder now in use as the default one.
      Object.assign(resolvedDataLocation, { mode: 'default', root: dataLocation.defaultDataRoot() });
      require('./lib/backend/electron-main.js');
      return;
    }
    if (choice === 'retry') electron.app.relaunch();
    electron.app.exit(0);
  });
} else if (resolvedDataLocation.pending && !electron.app.requestSingleInstanceLock(process.argv)) {
  // The data move runs in the one instance that holds the lock (the workbench asks for the same lock later and keeps
  // it). A second launch during the move would otherwise start on the old folder while the first empties it.
  electron.app.exit(0);
} else if (resolvedDataLocation.pending) {
  electron.app.whenReady().then(async () => {
    const progress = dataLocation.moveProgressWindow({ BrowserWindow: electron.BrowserWindow, locale: resolvedDataLocation.pending.locale });
    try {
      const moved = await dataLocation.performPendingMove({ app: electron.app, shell: electron.shell, onProgress: progress.update });
      // Settings shows where the data is now (default or a chosen folder), not where it was before the move.
      if (moved?.ok) Object.assign(resolvedDataLocation, { mode: require('node:path').resolve(moved.root) === require('node:path').resolve(dataLocation.defaultDataRoot()) ? 'default' : 'custom', root: moved.root });
    }
    finally { progress.close(); require('./lib/backend/electron-main.js'); }
  });
} else {
  require('./lib/backend/electron-main.js');
}
