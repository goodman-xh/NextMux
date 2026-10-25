'use strict';

const path = require('node:path');
const { focusMainWorkbenchWindow, isMainWorkbenchWindow } = require('./main-window-focus.cjs');

const IPC_TAKE_PENDING = 'nextmux:deep-link:take-pending';
const IPC_DEEP_LINK = 'nextmux:deep-link';
const IPC_DELIVERED = 'nextmux:deep-link:delivered';
const IPC_DEEP_LINK_DELIVERED = IPC_DELIVERED;
const MAX_PENDING_DEEP_LINKS = 16;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// "Apply to NextMux" links from relay websites, in CC Switch's shape (nextmux-provider-import.ts).
// Only these parameters are forwarded; config blobs and usage scripts are dropped, never run.
const PROVIDER_IMPORT_KEYS = ['resource', 'app', 'name', 'remark', 'provider', 'label', 'endpoint', 'baseUrl', 'apiKey', 'homepage', 'model', 'sonnetModel', 'opusModel', 'haikuModel', 'notes'];

function parseProviderImport(url) {
  if (url.hostname !== 'v1' || url.pathname !== '/import') return undefined;
  if (url.username || url.password || url.port || url.hash) return undefined;
  if (url.searchParams.get('resource') !== 'provider') return undefined;
  const kept = new URLSearchParams();
  for (const key of PROVIDER_IMPORT_KEYS) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) return undefined;
    if (values.length === 1) {
      if (values[0].length > 8192 || /[\u0000-\u001f\u007f]/.test(values[0])) return undefined;
      kept.set(key, values[0]);
    }
  }
  const canonical = `nextmux://v1/import?${kept.toString()}`;
  return canonical.length <= 16384 ? { kind: 'provider-import', url: canonical } : undefined;
}

function parseNextMuxDeepLink(value) {
  if (typeof value !== 'string' || value.length > 16384 || value.includes('\0')) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol === 'nextmux:' && url.hostname === 'v1') return parseProviderImport(url);
  if (value.length > 2048) return undefined;
  if (url.protocol !== 'nextmux:' || url.hostname !== 'device-link' || url.pathname !== '/complete') return undefined;
  if (url.username || url.password || url.port || url.hash) return undefined;
  if ([...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('nonce').length !== 1) return undefined;
  const nonce = url.searchParams.get('nonce') || '';
  if (!NONCE_PATTERN.test(nonce)) return undefined;
  const canonicalUrl = `nextmux://device-link/complete?nonce=${nonce}`;
  if (url.toString() !== canonicalUrl) return undefined;
  return { kind: 'device-link-complete', nonce, url: canonicalUrl };
}

function registerProtocolClient(app, options) {
  if (app.isPackaged) return app.setAsDefaultProtocolClient('nextmux');
  // An explicitly isolated source launch must not replace the installed app's
  // system protocol handler. Keep its broker active for direct callbacks.
  const argv = options.argv || process.argv;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') break;
    if (typeof argument !== 'string') continue;
    for (const name of ['--user-data-dir', '--electronUserData']) {
      const value = argument === name ? argv[index + 1]
        : argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : undefined;
      if (typeof value === 'string' && value.trim() && !value.startsWith('-') && !value.includes('\0')) return false;
    }
  }
  const entryPath = path.resolve(options.entryPath || options.argv?.[1] || process.argv[1] || 'bootstrap.cjs');
  return app.setAsDefaultProtocolClient('nextmux', options.execPath || process.execPath, [entryPath]);
}

function installNextMuxDeepLinks(electron, options = {}) {
  const { app, BrowserWindow, ipcMain } = electron;
  const pending = new Map();

  const windows = () => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
  // Links (a provider import can carry an API key) go only to the main workbench window, and only its main frame may
  // take or acknowledge the queue (audit B12-02).
  const appWindow = window => isMainWorkbenchWindow(window);
  const trustedSender = options.trustedSender || (event => {
    if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame) return false;
    const window = BrowserWindow.fromWebContents?.(event.sender);
    return Boolean(window && !window.isDestroyed() && window.webContents === event.sender && appWindow(window));
  });
  const focusWindow = () => {
    focusMainWorkbenchWindow({ app, BrowserWindow, platform: options.platform || process.platform });
  };
  const accept = value => {
    const parsed = parseNextMuxDeepLink(value);
    if (!parsed) return false;
    if (pending.has(parsed.url)) pending.delete(parsed.url);
    pending.set(parsed.url, parsed.url);
    while (pending.size > MAX_PENDING_DEEP_LINKS) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      pending.delete(oldest);
    }
    for (const window of windows().filter(appWindow)) window.webContents.send(IPC_DEEP_LINK, parsed.url);
    return true;
  };
  const acceptCommandLine = commandLine => {
    let accepted = false;
    for (const argument of Array.isArray(commandLine) ? commandLine : []) accepted = accept(argument) || accepted;
    return accepted;
  };

  registerProtocolClient(app, {
    ...options,
    argv: options.argv || process.argv,
    execPath: options.execPath || process.execPath,
  });
  ipcMain.handle(IPC_TAKE_PENDING, event => {
    if (!trustedSender(event)) return [];
    const values = [...pending.values()];
    pending.clear();
    return values;
  });
  ipcMain.handle(IPC_DELIVERED, (event, url) => {
    if (!trustedSender(event) || typeof url !== 'string' || !url) return false;
    pending.delete(url);
    return true;
  });
  app.on('second-instance', (_event, commandLine, _workingDirectory, originalArgv) => {
    // The Electron lock prevents a second window from being created.  Bring
    // the existing window back even when the second launch carries no deep
    // link (or an invalid argument); otherwise a double-click appears to do
    // nothing when the first window is minimized or behind another window.
    const acceptedCommandLine = acceptCommandLine(commandLine);
    const acceptedOriginalArgv = acceptCommandLine(originalArgv);
    const scheduled = [commandLine, originalArgv].some(args => Array.isArray(args) && args.includes('--nextmux-scheduled'));
    // The scheduler is an unattended wake-up, not an explicit app activation.
    // A genuine account callback still opens its UI even if both are present.
    if (scheduled && !acceptedCommandLine && !acceptedOriginalArgv) return;
    focusWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (accept(url)) focusWindow();
  });
  acceptCommandLine(options.argv || process.argv);

  return Object.freeze({ accept, takePending: () => {
    const values = [...pending.values()];
    pending.clear();
    return values;
  } });
}

module.exports = {
  IPC_DEEP_LINK,
  IPC_DEEP_LINK_DELIVERED,
  IPC_DELIVERED,
  IPC_TAKE_PENDING,
  installNextMuxDeepLinks,
  parseNextMuxDeepLink,
  registerProtocolClient,
};
