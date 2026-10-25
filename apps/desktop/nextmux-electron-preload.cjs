'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

require('@theia/core/lib/electron-browser/preload').preload();
require('@theia/filesystem/lib/electron-browser/preload').preload();

const isCloseToken = token => typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
const closeReasons = new Set(['timeout', 'failed', 'navigated']);
const notifyClose = (callback, args, failure) => {
  // A renderer callback can throw synchronously or reject after an await.
  // Neither path is permission to close, and neither may leak an unhandled rejection.
  Promise.resolve().then(() => callback(...args)).catch(failure || (() => undefined)).catch(() => undefined);
};

const prefix = 'nextmux:owned-browser:';
const ownedBrowser = Object.freeze({
  create: (owner, url) => ipcRenderer.invoke(prefix + 'create', owner, url),
  state: owner => ipcRenderer.invoke(prefix + 'state', owner),
  preview: owner => ipcRenderer.invoke(prefix + 'preview', owner),
  action: (owner, request) => ipcRenderer.invoke(prefix + 'action', owner, request),
  cancel: (owner, id) => ipcRenderer.invoke(prefix + 'cancel', owner, id),
  navigate: (owner, navigation) => ipcRenderer.invoke(prefix + 'navigate', owner, navigation),
  takeover: (owner, bounds) => ipcRenderer.invoke(prefix + 'takeover', owner, bounds),
  release: owner => ipcRenderer.invoke(prefix + 'release', owner),
  resize: (owner, bounds) => ipcRenderer.invoke(prefix + 'resize', owner, bounds),
  close: owner => ipcRenderer.invoke(prefix + 'close', owner)
});

contextBridge.exposeInMainWorld('nextmuxDesktop', Object.freeze({
  ownedBrowser,
  setAppLocale: locale => ipcRenderer.invoke('nextmux:app:locale', locale),
  // Where NextMux keeps its data (Settings → 本地数据): read, choose a folder, ask for the move (runs at the next launch).
  getDataLocation: () => ipcRenderer.invoke('nextmux:data-location:get'),
  chooseDataLocation: () => ipcRenderer.invoke('nextmux:data-location:choose'),
  moveDataLocation: (target, locale) => ipcRenderer.invoke('nextmux:data-location:move', target, locale),
  revealDataLocation: () => ipcRenderer.invoke('nextmux:data-location:reveal'),
  getConversationWindowState: () => ipcRenderer.invoke('nextmux:conversation:state'),
  reportConversationSyncDiagnostic: payload => ipcRenderer.invoke('nextmux:conversation:sync-diagnostic', payload),
  publishConversationWindows: (deltas, removed) => ipcRenderer.invoke('nextmux:conversation:publish', deltas, removed),
  openConversationWindows: (ids, origin) => ipcRenderer.invoke('nextmux:conversation:open', ids, origin),
  focusConversationWindow: id => ipcRenderer.invoke('nextmux:conversation:focus', id),
  tileConversationWindows: ids => ipcRenderer.invoke('nextmux:conversation:tile', ids),
  revealConversationInMain: (id, fileUri) => ipcRenderer.invoke('nextmux:conversation:reveal-in-main', id, fileUri),
  moveConversationWindowDisplay: id => ipcRenderer.invoke('nextmux:conversation:move-display', id),
  getConversationDisplayInfo: () => ipcRenderer.invoke('nextmux:conversation:display-info'),
  reclaimConversationWindows: sessionId => ipcRenderer.invoke('nextmux:conversation:reclaim', sessionId),
  setConversationWindowRunning: (sessionId, running) => ipcRenderer.invoke('nextmux:conversation:running', sessionId, running),
  flushConversationWindows: () => ipcRenderer.invoke('nextmux:conversation:flush'),
  acknowledgeConversationWindowFlush: (id, saved) => ipcRenderer.invoke('nextmux:conversation:flushed', id, saved),
  releaseConversationWindow: () => ipcRenderer.invoke('nextmux:conversation:release'),
  claimConversationRun: (id, release = false) => ipcRenderer.invoke('nextmux:conversation:claim', id, release),
  closeDesktopWindow: () => ipcRenderer.invoke('nextmux:window:close'),
  minimizeDesktopWindow: () => ipcRenderer.invoke('nextmux:window:minimize'),
  zoomDesktopWindow: () => ipcRenderer.invoke('nextmux:window:zoom'),
  showMainWindow: () => ipcRenderer.invoke('nextmux:window:show-main'),
  setModalChrome: open => ipcRenderer.invoke('nextmux:window:modal-chrome', open === true),
  // macOS major version (26 = Tahoe) for window-button styling calibrated per release.
  macosMajor: typeof process !== 'undefined' && process.platform === 'darwin' && typeof process.getSystemVersion === 'function'
    ? Number(String(process.getSystemVersion()).split('.')[0]) || 0 : 0,
  getWindowFocusState: () => ipcRenderer.invoke('nextmux:window:focus-state'),
  onWindowFocusChange: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:window:focus', listener);
    return () => ipcRenderer.off('nextmux:window:focus', listener);
  },
  onConversationWindowEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:conversation:event', listener);
    return () => ipcRenderer.off('nextmux:conversation:event', listener);
  },
  onConversationWindowHighlight: callback => {
    const listener = () => callback();
    ipcRenderer.on('nextmux:conversation:highlight', listener);
    return () => ipcRenderer.off('nextmux:conversation:highlight', listener);
  },
  getUpdateState: () => ipcRenderer.invoke('nextmux:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('nextmux:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('nextmux:update:download'),
  installUpdate: () => ipcRenderer.invoke('nextmux:update:install'),
  openDownloadPage: () => ipcRenderer.invoke('nextmux:update:download-page'),
  openExternal: url => ipcRenderer.invoke('nextmux:external:open', url),
  performBrowserAction: (guestId, request) => ipcRenderer.invoke('nextmux:browser:action', guestId, request),
  cancelBrowserAction: (guestId, requestId) => ipcRenderer.invoke('nextmux:browser:cancel', guestId, requestId),
  releaseBrowserAutomation: conversationId => ipcRenderer.invoke('nextmux:browser:release', conversationId),
  getComputerCapability: () => ipcRenderer.invoke('nextmux:computer:capability'),
  requestComputerPermission: () => ipcRenderer.invoke('nextmux:computer:permission'),
  performComputerAction: request => ipcRenderer.invoke('nextmux:computer:action', request),
  cancelComputerAction: (conversationId, requestId) => ipcRenderer.invoke('nextmux:computer:cancel', conversationId, requestId),
  releaseComputerSession: conversationId => ipcRenderer.invoke('nextmux:computer:release', conversationId),
  getComputerViewCapability: () => ipcRenderer.invoke('nextmux:computer:view:capability'),
  setComputerViewPreference: value => ipcRenderer.invoke('nextmux:computer:view:preference', value),
  startComputerWindowView: (conversationId, pid, windowId) => ipcRenderer.invoke('nextmux:computer:view:start', conversationId, pid, windowId),
  placeComputerWindow: (conversationId, pid, windowId, placement, activate) => ipcRenderer.invoke('nextmux:computer:view:place', conversationId, pid, windowId, placement, activate),
  forgetComputerWindow: (conversationId, pid, windowId, close) => ipcRenderer.invoke('nextmux:computer:view:forget', conversationId, pid, windowId, ...(close === false ? [false] : [])),
  terminateComputerWindow: (conversationId, pid, windowId) => ipcRenderer.invoke('nextmux:computer:window-terminate', conversationId, pid, windowId),
  openComputerTabWindow: request => ipcRenderer.invoke('nextmux:computer:tab-window:open', request),
  closeComputerTabWindow: (conversationId, tabId, merge) => ipcRenderer.invoke('nextmux:computer:tab-window:close', conversationId, tabId, merge === true),
  focusComputerTabWindow: (conversationId, tabId) => ipcRenderer.invoke('nextmux:computer:tab-window:focus', conversationId, tabId),
  onComputerTabWindowEvent: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:computer:tab-window:event', listener);
    return () => ipcRenderer.off('nextmux:computer:tab-window:event', listener);
  },
  onComputerTabEvent: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:computer:tab-event', listener);
    return () => ipcRenderer.off('nextmux:computer:tab-event', listener);
  },
  openAppInTab: (conversationId, selector, options) => ipcRenderer.invoke('nextmux:computer:view:open-app', conversationId, selector, options),
  // Skill plugins (技能插件, app-plugins.cjs).
  listAppPlugins: locale => ipcRenderer.invoke('nextmux:plugins:list', locale),
  inspectAppPlugin: (locale, title) => ipcRenderer.invoke('nextmux:plugins:inspect', locale, title),
  inspectAppPluginBytes: (locale, dataBase64, origin) => ipcRenderer.invoke('nextmux:plugins:inspect-bytes', locale, dataBase64, origin),
  installAppPlugin: (token, gate) => ipcRenderer.invoke('nextmux:plugins:install', token, gate),
  addAppPluginFolder: (title, folderPath) => ipcRenderer.invoke('nextmux:plugins:add-folder', title, folderPath),
  reloadAppPlugin: id => ipcRenderer.invoke('nextmux:plugins:reload', id),
  uninstallAppPlugin: id => ipcRenderer.invoke('nextmux:plugins:uninstall', id),
  configureAppPlugin: (id, settings) => ipcRenderer.invoke('nextmux:plugins:configure', id, settings),
  pickAppPluginParamFile: (id, paramId, filePath, options) => ipcRenderer.invoke('nextmux:plugins:pick-param-file', id, paramId, filePath, options),
  pickAppPluginFolder: initialPath => ipcRenderer.invoke('nextmux:app-plugins:pick-folder', typeof initialPath === 'string' && !initialPath.includes('\0') ? initialPath.slice(0, 4096) : undefined),
  testAppPlugin: id => ipcRenderer.invoke('nextmux:plugins:test', id),
  startAppPlugin: request => ipcRenderer.invoke('nextmux:plugins:start', request),
  commandAppPlugin: (runId, command) => ipcRenderer.invoke('nextmux:plugins:command', runId, command),
  appPluginStatus: runId => ipcRenderer.invoke('nextmux:plugins:status', runId),
  stopAppPlugin: runId => ipcRenderer.invoke('nextmux:plugins:stop', runId),
  appPluginRuns: () => ipcRenderer.invoke('nextmux:plugins:runs'),
  answerAppPlugin: (requestId, result) => ipcRenderer.invoke('nextmux:plugins:answer', requestId, result),
  onAppPluginEvent: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:plugins:event', listener);
    return () => ipcRenderer.off('nextmux:plugins:event', listener);
  },
  // tabs.screenshot says source 'agent' (refused after the user's Esc); the tab's live picture sends none.
  computerWindowSnapshot: (conversationId, pid, windowId, maxSize, options) => ipcRenderer.invoke('nextmux:computer:view:snapshot', conversationId, pid, windowId, maxSize,
    options?.source === 'agent' || options?.source === 'user' ? { source: options.source } : undefined),
  computerWindowKeys: (conversationId, input) => ipcRenderer.invoke('nextmux:computer:view:keys', conversationId, input),
  setComputerWindowUserInput: (conversationId, pid, windowId, on) => ipcRenderer.invoke('nextmux:computer:view:user-input', conversationId, pid, windowId, on === true),
  computerWindowState: (conversationId, pid, windowId) => ipcRenderer.invoke('nextmux:computer:view:state', conversationId, pid, windowId),
  computerWindowPointer: (conversationId, input) => ipcRenderer.invoke('nextmux:computer:view:pointer', conversationId, input),
  // Esc ends desktop control for the rest of that conversation's turn; a new user turn or 恢复控制 lifts it.
  clearComputerUserEsc: conversationId => ipcRenderer.invoke('nextmux:computer:clear-user-esc', conversationId),
  setComputerWindowSound: (conversationId, pid, windowId, on) => ipcRenderer.invoke('nextmux:computer:view:sound', conversationId, pid, windowId, on),
  renewAutomationLeases: conversationIds => Promise.all([ipcRenderer.invoke('nextmux:computer:keepalive', conversationIds),
    ipcRenderer.invoke('nextmux:browser:keepalive', conversationIds)]).then(() => true),
  openLocalPath: path => ipcRenderer.invoke('nextmux:path:open', path),
  trashFolder: path => ipcRenderer.invoke('nextmux:path:trash', path),
  pickApplication: title => ipcRenderer.invoke('nextmux:app:pick', title),
  describeApplication: file => ipcRenderer.invoke('nextmux:app:describe', file),
  applicationIcon: id => ipcRenderer.invoke('nextmux:app:icon', id),
  setComputerTabCloseBehavior: value => ipcRenderer.invoke('nextmux:computer:view:close-behavior', value),
  getSystemPermissions: () => ipcRenderer.invoke('nextmux:permissions:status'),
  requestSystemPermission: (kind, texts) => ipcRenderer.invoke('nextmux:permissions:request', kind, texts),
  openPermissionSettings: kind => ipcRenderer.invoke('nextmux:permissions:open-settings', kind),
  relaunchApp: () => ipcRenderer.invoke('nextmux:permissions:relaunch'),
  onSystemPermissionsChanged: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:permissions:changed', listener);
    return () => ipcRenderer.off('nextmux:permissions:changed', listener);
  },
  systemNotificationsSupported: () => ipcRenderer.invoke('nextmux:notify:supported'),
  showSystemNotification: request => ipcRenderer.invoke('nextmux:notify:show', request),
  onSystemNotificationClick: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, target) => callback(typeof target === 'string' ? target : '');
    ipcRenderer.on('nextmux:notify:click', listener);
    return () => ipcRenderer.off('nextmux:notify:click', listener);
  },
  openMicrophoneSettings: () => ipcRenderer.invoke('nextmux:microphone:settings'),
  getMicrophonePermission: () => ipcRenderer.invoke('nextmux:microphone:status'),
  requestMicrophonePermission: () => ipcRenderer.invoke('nextmux:microphone:permission'),
  getSpeechCapability: locale => ipcRenderer.invoke('nextmux:speech:capability', locale),
  startSpeech: request => ipcRenderer.invoke('nextmux:speech:start', request),
  finishSpeech: id => ipcRenderer.invoke('nextmux:speech:finish', id),
  cancelSpeech: id => ipcRenderer.invoke('nextmux:speech:cancel', id),
  onSpeechEvent: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:speech:event', listener);
    return () => ipcRenderer.off('nextmux:speech:event', listener);
  },
  clearCache: () => ipcRenderer.invoke('nextmux:cache:clear'),
  getCacheSize: () => ipcRenderer.invoke('nextmux:cache:size').then(size => typeof size === 'number' && size >= 0 ? size : 0),
  takePendingDeepLinks: () => ipcRenderer.invoke('nextmux:deep-link:take-pending'),
  getPathForFile: file => webUtils.getPathForFile(file),
  onUpdateState: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('nextmux:update-state', listener);
    return () => ipcRenderer.off('nextmux:update-state', listener);
  },
  onNavigationCommand: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, direction) => {
      if (direction === 'back' || direction === 'forward') callback(direction);
    };
    ipcRenderer.on('nextmux:navigation-command', listener);
    return () => ipcRenderer.off('nextmux:navigation-command', listener);
  },
  onPrepareClose: callback => {
    if (typeof callback !== 'function') return () => undefined;
    let disposed = false;
    const listener = (_event, token) => {
      if (isCloseToken(token)) notifyClose(value => !disposed && callback(value), [token], () => ipcRenderer.invoke('nextmux:prepare-close:complete', token, 'failed'));
    };
    ipcRenderer.on('nextmux:prepare-close', listener);
    return () => { disposed = true; ipcRenderer.off('nextmux:prepare-close', listener); };
  },
  registerIncognitoConversation: request => ipcRenderer.invoke('nextmux:incognito:register', request).then(value => value === true),
  setIncognitoConversationMode: request => ipcRenderer.invoke('nextmux:incognito:mode', request).then(value => value === true),
  finishIncognitoConversations: ids => ipcRenderer.invoke('nextmux:incognito:finish', ids).then(value => value === true),
  isApplicationQuitting: () => ipcRenderer.invoke('nextmux:application-is-quitting').then(value => value === true),
  beginPrepareClose: token => isCloseToken(token)
    ? ipcRenderer.invoke('nextmux:prepare-close:begin', token).then(value => value === true) : Promise.resolve(false),
  completePrepareClose: (token, outcome) => isCloseToken(token) && (outcome === 'saved' || outcome === 'failed')
    ? ipcRenderer.invoke('nextmux:prepare-close:complete', token, outcome).then(value => value === true) : Promise.resolve(false),
  // Quit: the main process asks whether a task is running (and for the dialog text in the UI language).
  onQuitCheck: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, nonce) => {
      if (typeof nonce !== 'string' || nonce.length > 64) return;
      let reply = { running: false };
      try { reply = callback() || reply; } catch { /* report not running */ }
      ipcRenderer.send('nextmux:quit-check:reply', nonce, reply);
    };
    ipcRenderer.on('nextmux:quit-check', listener);
    return () => ipcRenderer.off('nextmux:quit-check', listener);
  },
  confirmRunningQuit: texts => {
    const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
    return texts && text(texts.title, 200) && text(texts.body, 600) && text(texts.quit, 80) && text(texts.stay, 80)
      ? ipcRenderer.invoke('nextmux:window:confirm-running-quit', { title: texts.title, body: texts.body, quit: texts.quit, stay: texts.stay }).then(value => value === true)
      : Promise.resolve(false);
  },
  onQuitConfirmed: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = () => callback();
    ipcRenderer.on('nextmux:quit-confirmed', listener);
    return () => ipcRenderer.off('nextmux:quit-confirmed', listener);
  },
  onPrepareCloseCancelled: callback => {
    if (typeof callback !== 'function') return () => undefined;
    let disposed = false;
    const listener = (_event, token, reason) => {
      if (isCloseToken(token) && closeReasons.has(reason)) notifyClose((value, cause) => !disposed && callback(value, cause), [token, reason]);
    };
    ipcRenderer.on('nextmux:prepare-close:cancelled', listener);
    return () => { disposed = true; ipcRenderer.off('nextmux:prepare-close:cancelled', listener); };
  },
  onDeepLink: callback => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, value) => {
      if (typeof value !== 'string') return;
      callback(value);
      // Handled live: the main process drops it from the queue a reload or another window would otherwise replay.
      void ipcRenderer.invoke('nextmux:deep-link:delivered', value).catch(() => undefined);
    };
    ipcRenderer.on('nextmux:deep-link', listener);
    return () => ipcRenderer.off('nextmux:deep-link', listener);
  },
}));
