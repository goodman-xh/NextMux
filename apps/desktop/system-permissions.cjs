'use strict';

// Operating-system permissions in one place: status, the right request call,
// the right settings page for each macOS / Windows version, and on macOS a
// small helper window whose app icon can be dragged into the System Settings
// privacy list (the way Codex, Raycast or CleanShot do it).
//
// macOS 12 Monterey: System Preferences → Security & Privacy → Privacy.
// macOS 13 Ventura and later: System Settings → Privacy & Security.
// macOS 15 Sequoia re-confirms screen recording periodically and needs the
// app to reopen after a new grant.
// Windows 10 and 11: Settings → Privacy (microphone); Windows 11 adds
// a screen-capture page. Desktop apps need no screen or accessibility grant.

const os = require('node:os');
const path = require('node:path');

const KINDS = new Set(['accessibility', 'screen', 'microphone', 'speechRecognition', 'notifications', 'automation',
  'files', 'fullDisk', 'inputMonitoring', 'appManagement', 'localNetwork']);
const MAC_ANCHORS = {
  accessibility: 'Privacy_Accessibility',
  screen: 'Privacy_ScreenCapture',
  microphone: 'Privacy_Microphone',
  automation: 'Privacy_Automation',
  files: 'Privacy_FilesAndFolders',
  fullDisk: 'Privacy_AllFiles',
  inputMonitoring: 'Privacy_ListenEvent',
  speechRecognition: 'Privacy_SpeechRecognition',
  appManagement: 'Privacy_AppBundles',
  localNetwork: 'Privacy_LocalNetwork'
};

function macMajor(getSystemVersion = process.getSystemVersion) {
  const version = typeof getSystemVersion === 'function' ? String(getSystemVersion() || '') : '';
  const major = Number(version.split('.')[0]);
  if (Number.isFinite(major) && major >= 10) return major === 10 ? Number(version.split('.')[1]) / 100 + 10 : major;
  // Darwin 21 = macOS 12, 22 = 13, 23 = 14, 24 = 15, 25 = 26.
  const darwin = Number(os.release().split('.')[0]);
  return darwin >= 25 ? 26 : darwin >= 20 ? darwin - 9 : 11;
}

function windowsBuild() {
  const parts = os.release().split('.');
  return Number(parts[2]) || 0;
}

/** The settings page for a permission on this exact system version. */
function settingsUrl(kind, platform = process.platform, version = platform === 'darwin' ? macMajor() : windowsBuild()) {
  if (!KINDS.has(kind)) return '';
  if (platform === 'darwin') {
    if (kind === 'notifications') {
      // Ventura and later open the app's own notification page when given its bundle id.
      const id = version >= 13 ? bundleIdentifier() : '';
      return version >= 13 ? `x-apple.systempreferences:com.apple.Notifications-Settings.extension${id ? `?id=${encodeURIComponent(id)}` : ''}`
        : 'x-apple.systempreferences:com.apple.preference.notifications';
    }
    const anchor = MAC_ANCHORS[kind];
    if (!anchor) return '';
    if (kind === 'localNetwork' && version < 15) return '';
    // App Management exists from macOS 13 Ventura.
    if (kind === 'appManagement' && version < 13) return '';
    return version >= 13
      ? `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${anchor}`
      : `x-apple.systempreferences:com.apple.preference.security?${anchor}`;
  }
  if (platform === 'win32') {
    if (kind === 'microphone') return 'ms-settings:privacy-microphone';
    if (kind === 'screen') return version >= 22000 ? 'ms-settings:privacy-graphicsCaptureProgrammatic' : 'ms-settings:privacy';
    if (kind === 'files' || kind === 'fullDisk') return 'ms-settings:privacy-broadfilesystemaccess';
    if (kind === 'notifications') return 'ms-settings:notifications';
    if (kind === 'speechRecognition') return 'ms-settings:privacy-speech';
    return 'ms-settings:privacy';
  }
  return '';
}

/** CFBundleIdentifier of the running .app (io.nextmux.desktop installed; Electron's id in development). */
function bundleIdentifier(fs = require('node:fs'), execPath = process.execPath) {
  const bundle = appBundlePath(execPath);
  if (!bundle) return '';
  try {
    const plist = fs.readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8');
    const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] || '';
    return /^[A-Za-z0-9.-]{3,200}$/.test(id) ? id : '';
  } catch { return ''; }
}

/** The .app bundle macOS lists in Privacy & Security (Electron.app in development). */
function appBundlePath(execPath = process.execPath) {
  const index = execPath.lastIndexOf('.app/');
  return index > 0 ? execPath.slice(0, index + 4) : '';
}

function normalizeMediaStatus(value) {
  return ['granted', 'denied', 'restricted', 'not-determined'].includes(value) ? value : 'unknown';
}

/** Full Disk Access cannot be queried; reading the user's TCC database only succeeds with it. */
function fullDiskAccessStatus(fs = require('node:fs'), home = os.homedir()) {
  try {
    fs.closeSync(fs.openSync(path.join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'), 'r'));
    return 'granted';
  } catch (error) {
    return error && (error.code === 'EPERM' || error.code === 'EACCES') ? 'denied' : 'unknown';
  }
}

// Windows lists desktop (unpackaged) apps such as NextMux under one switch, "Let desktop apps access your microphone",
// not by name. Electron's status reads only the device-wide switch, so read the consent store: the device policy (HKLM),
// the user's "Microphone access" and the desktop-apps switch (NonPackaged).
const CONSENT = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
let windowsMicrophoneCache = { at: 0, value: '' };
function windowsMicrophoneStatus(query = registryValue, now = Date.now()) {
  const useCache = query === registryValue;
  if (useCache && now >= windowsMicrophoneCache.at && now - windowsMicrophoneCache.at < 3000 && windowsMicrophoneCache.value) return windowsMicrophoneCache.value;
  const machine = query(`HKLM\\${CONSENT}`), user = query(`HKCU\\${CONSENT}`), desktop = query(`HKCU\\${CONSENT}\\NonPackaged`);
  const value = machine === undefined && user === undefined && desktop === undefined ? 'unknown'
    : /^deny$/i.test(machine || '') ? 'restricted'
    : /^deny$/i.test(user || '') || /^deny$/i.test(desktop || '') ? 'denied'
    : /^allow$/i.test(desktop || '') && (user === undefined || /^allow$/i.test(user)) && (machine === undefined || /^allow$/i.test(machine)) ? 'granted'
    : 'unknown';
  if (useCache) windowsMicrophoneCache = { at: now, value };
  return value;
}
/** A consent store "Value" (Allow / Deny), or undefined when it cannot be read. */
function registryValue(key) {
  try {
    const output = require('node:child_process').execFileSync('reg.exe', ['query', key, '/v', 'Value'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    return /\bValue\s+REG_SZ\s+(\S+)/i.exec(output)?.[1] || '';
  } catch { return undefined; }
}

// NextMux's own pages: the packaged workbench (file:) or a local development server.
function trustedLocalOrigin(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/**
 * Whether the default session lets a page use the microphone (or pick a speaker): dictation in NextMux's own windows.
 * Both the window's page and the frame that asks must be NextMux's, so a site framed inside the workbench (a preview,
 * a mini browser) gets no microphone. The camera is never allowed.
 */
function audioPermissionAllowed({ webContents, permission, origin, mediaType, mediaTypes } = {}) {
  if (!['media', 'audioCapture', 'speaker-selection'].includes(permission)) return false;
  if (mediaType && mediaType !== 'audio') return false;
  if (Array.isArray(mediaTypes) && mediaTypes.includes('video')) return false;
  if (webContents && typeof webContents.getURL === 'function') {
    let page = '';
    try { page = webContents.getURL(); } catch { return false; }
    return trustedLocalOrigin(page) && (!origin || trustedLocalOrigin(origin));
  }
  // A check without a page (a worker, the Permissions API) is judged by its origin alone.
  return !webContents && trustedLocalOrigin(origin);
}

function resolveMicrophonePermissionStatus({ systemPreferences, platform = process.platform, windowsMicrophone = windowsMicrophoneStatus } = {}) {
  let mediaMic = 'unknown';
  try { mediaMic = normalizeMediaStatus(systemPreferences?.getMediaAccessStatus?.('microphone')); } catch { mediaMic = 'unknown'; }
  if (platform === 'darwin') return mediaMic;
  if (platform === 'win32') {
    const microphone = windowsMicrophone();
    if (microphone === 'restricted' || mediaMic === 'restricted') return 'restricted';
    if (microphone === 'denied' || mediaMic === 'denied') return 'denied';
    return microphone === 'unknown' ? 'unknown' : microphone;
  }
  return 'unknown';
}

function permissionStatus({ systemPreferences, platform = process.platform, computerCapability, fullDisk = fullDiskAccessStatus, windowsMicrophone = windowsMicrophoneStatus } = {}) {
  const version = platform === 'darwin' ? macMajor() : platform === 'win32' ? windowsBuild() : 0;
  const media = kind => {
    try { return normalizeMediaStatus(systemPreferences?.getMediaAccessStatus?.(kind)); } catch { return 'unknown'; }
  };
  const items = [];
  if (platform === 'darwin') {
    let trusted = false;
    try { trusted = Boolean(systemPreferences?.isTrustedAccessibilityClient?.(false)); } catch { /* unknown */ }
    // Needed for the core features.
    items.push({ kind: 'accessibility', status: trusted ? 'granted' : 'denied', required: 'computer', draggable: true, essential: true });
    items.push({ kind: 'screen', status: media('screen'), required: 'computer', draggable: true, relaunchAfterGrant: true, essential: true, systemAudio: version >= 14 });
    items.push({ kind: 'microphone', status: resolveMicrophonePermissionStatus({ systemPreferences, platform, windowsMicrophone }), required: 'voice', essential: true });
    items.push({ kind: 'notifications', status: 'unknown', required: 'notify', essential: true });
    // Only when a task asks for it.
    // Speech Recognition is only for the coding voice button (Apple's on-device dictation); macOS asks
    // the first time it is used, so setup does not ask for it up front.
    items.push({ kind: 'speechRecognition', status: 'unknown', required: 'voice' });
    items.push({ kind: 'automation', status: 'unknown', required: 'automation' });
    items.push({ kind: 'files', status: 'unknown', required: 'files' });
    items.push({ kind: 'fullDisk', status: fullDisk(), required: 'files', draggable: true });
    items.push({ kind: 'inputMonitoring', status: 'unknown', required: 'input', draggable: true });
    if (version >= 13) items.push({ kind: 'appManagement', status: 'unknown', required: 'apps', draggable: true });
    if (version >= 15) items.push({ kind: 'localNetwork', status: 'unknown', required: 'network' });
  } else if (platform === 'win32') {
    items.push({ kind: 'microphone', status: resolveMicrophonePermissionStatus({ systemPreferences, platform, windowsMicrophone }), required: 'voice', essential: true });
    items.push({ kind: 'screen', status: 'granted', required: 'computer', essential: true });
    items.push({ kind: 'accessibility', status: computerCapability?.reason === 'worker_install_required' ? 'denied'
      : computerCapability?.available ? 'granted' : 'unknown', required: 'computer', elevation: true, essential: true });
    items.push({ kind: 'notifications', status: 'unknown', required: 'notify', essential: true });
    items.push({ kind: 'files', status: 'unknown', required: 'files' });
  }
  return {
    platform,
    version,
    osRelease: os.release(),
    arch: process.arch,
    computerSupported: platform === 'win32' ? version >= 17763 : platform === 'darwin' ? version >= 13 : false,
    items: items.map(item => ({ ...item, settingsUrl: settingsUrl(item.kind, platform, version) }))
  };
}

// Laid out like the helpers of other Mac apps (PermissionFlow, PermissionPilot, t3code): a row that looks like the
// app in Finder (icon and name) is the thing to drag; the instruction sits below it.
function helperHtml(iconDataUrl, texts, appName = 'NextMux') {
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  // The helper is its own window, so it takes the app's language and reading direction explicitly (audit A19-03).
  const lang = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(String(texts.locale || '')) ? String(texts.locale) : 'en';
  const dir = /^(?:ar|he|fa|ur)(?:-|$)/.test(lang) ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{color-scheme:light dark;--bg:rgba(246,245,243,.97);--ink:#2b272a;--tile:#fff;--line:rgba(0,0,0,.12);--accent:#d24b7a}
@media (prefers-color-scheme:dark){:root{--bg:rgba(36,33,35,.97);--ink:#ece8ea;--tile:rgba(255,255,255,.07);--line:rgba(255,255,255,.14)}}
html,body{margin:0;height:100%;font:13px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;-webkit-user-select:none;user-select:none}
body{display:flex;flex-direction:column;gap:10px;padding:14px 16px 14px;box-sizing:border-box;background:var(--bg);color:var(--ink);border-radius:14px;-webkit-app-region:drag}
.tile{display:flex;align-items:center;gap:10px;padding-block:8px;padding-inline:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--tile);cursor:grab;-webkit-app-region:no-drag;margin-inline-end:28px}
.tile:hover{border-color:var(--accent)}
.tile:active{cursor:grabbing}
.tile img{width:36px;height:36px;flex:none;pointer-events:none}
.tile span{flex:1;font-size:14px;font-weight:600}
.tile i{flex:none;width:18px;height:18px;color:var(--accent);animation:up 1.4s ease-in-out infinite}
@keyframes up{0%,100%{transform:translateY(2px);opacity:.55}50%{transform:translateY(-3px);opacity:1}}
@media (prefers-reduced-motion:reduce){.tile i{animation:none}}
b{display:block;font-size:13px}
p{margin:0;opacity:.72;font-size:12px}
button{position:absolute;top:10px;inset-inline-end:10px;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.6;font-size:15px;line-height:1;cursor:pointer;-webkit-app-region:no-drag}
button:hover{opacity:1;background:rgba(128,128,128,.18)}
</style></head><body>
<div class="tile" id="tile" draggable="true" title="${escape(texts.title)}"><img src="${escape(iconDataUrl)}" alt=""><span>${escape(appName)}</span>
<i aria-hidden="true"><svg viewBox="0 0 18 18" width="18" height="18"><path d="M9 15V4M4.5 8.5 9 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></i></div>
<div><b>${escape(texts.title)}</b><p>${escape(texts.body)}</p></div>
<button id="close" aria-label="${escape(texts.close)}">×</button>
<script>
document.getElementById('tile').addEventListener('dragstart', event => { event.preventDefault(); window.nextmuxPermissionHelper.startDrag(); });
document.getElementById('close').addEventListener('click', () => window.nextmuxPermissionHelper.close());
</script></body></html>`;
}

/** The NextMux logo shown and dragged in the helper (Electron's own icon would show in development). */
function nextmuxIcon({ app, nativeImage, fs = require('node:fs') }) {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(app?.getAppPath?.() || '', 'build-resources', 'icon.png'),
    path.join(__dirname, 'build-resources', 'icon.png')
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image.resize({ width: 128, height: 128, quality: 'best' });
    } catch { /* next */ }
  }
  return undefined;
}

function registerSystemPermissions({ ipcMain, app, systemPreferences, shell, desktopCapturer, BrowserWindow, nativeImage, screen, trustedMainFrame, computer, Notification } = {}) {
  // Every helper window opened, so none can outlive a newer one, a close or a relaunch.
  const helpers = new Set();
  let helperTimer;
  let helperShownAt = 0;
  let generation = 0;
  let bundleForDrag = '';
  let dragIcon;
  const trusted = event => trustedMainFrame(event) && !event.sender.isDestroyed();
  const capability = () => { try { return computer?.capability?.(); } catch { return undefined; } };
  const status = () => permissionStatus({ systemPreferences, computerCapability: capability() });
  const granted = kind => status().items.find(item => item.kind === kind)?.status === 'granted';
  const notify = () => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nextmux:permissions:changed', status());
  };
  const helperOf = sender => [...helpers].find(window => !window.isDestroyed() && window.webContents === sender);
  const closeHelper = () => {
    generation += 1;
    clearInterval(helperTimer);
    helperTimer = undefined;
    for (const window of [...helpers]) {
      helpers.delete(window);
      // destroy, not close: nothing to save, and a close can never be held up during quit or relaunch.
      if (!window.isDestroyed()) window.destroy();
    }
  };

  ipcMain.on('nextmux:permission-helper:drag', event => {
    if (!helperOf(event.sender) || !bundleForDrag) return;
    event.sender.startDrag({ file: bundleForDrag, icon: dragIcon && !dragIcon.isEmpty() ? dragIcon.resize({ width: 64, height: 64 }) : nativeImage.createEmpty() });
  });
  ipcMain.on('nextmux:permission-helper:close', event => { if (helperOf(event.sender)) closeHelper(); });

  async function openHelper(kind, texts) {
    const bundle = appBundlePath();
    if (process.platform !== 'darwin' || !bundle) return false;
    closeHelper();
    const own = generation;
    let icon = nextmuxIcon({ app, nativeImage });
    // Not app.getFileIcon: it crashes Electron 42 for .app bundles (see app-icon.cjs).
    if (!icon) try { icon = await require('./app-icon.cjs').appIcon({ app, nativeImage }, bundle, 128); } catch { icon = nativeImage.createEmpty(); }
    // A second request while this one waited for the icon replaces it.
    if (own !== generation) return false;
    bundleForDrag = bundle;
    dragIcon = icon;
    const area = screen.getPrimaryDisplay().workArea;
    const window = new BrowserWindow({
      width: 360, height: 128, x: Math.round(area.x + area.width / 2 - 180), y: Math.round(area.y + area.height - 180),
      frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: true, show: false, focusable: true,
      webPreferences: { preload: path.join(__dirname, 'permission-helper-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    // Not a document window: it closes without the workbench's save handshake (updater.cjs).
    const coordinator = window[Symbol.for('nextmux.desktop.close-coordinator.v1')];
    if (coordinator) coordinator.managed = true;
    helpers.add(window);
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on('closed', () => {
      helpers.delete(window);
      // Closed some other way (⌘W, the system): the grant check stops with it.
      if (!helpers.size) { clearInterval(helperTimer); helperTimer = undefined; }
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(helperHtml(icon.resize({ width: 72, height: 72, quality: 'best' }).toDataURL(), texts, app?.getName?.() || 'NextMux'))}`).catch(() => undefined);
    if (window.isDestroyed() || own !== generation) { if (!window.isDestroyed()) window.destroy(); return false; }
    window.showInactive();
    helperShownAt = Date.now();
    helperTimer = setInterval(() => {
      if (granted(kind) || Date.now() - helperShownAt > 5 * 60_000) { closeHelper(); notify(); }
    }, 1000);
    return true;
  }

  function cleanupOrphanWindowsMicrophoneKeys() {
    if (process.platform !== 'win32') return;
    try {
      const execFileSync = require('node:child_process').execFileSync;
      const rootKey = `HKCU\\${CONSENT}\\NonPackaged`;
      const output = execFileSync('reg.exe', ['query', rootKey], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      for (const line of output.split(/\r?\n/)) {
        const subkey = line.trim();
        if (!subkey.startsWith('HKEY_') || !/#NextMux[^\\]*\.exe$/i.test(subkey)) continue;
        try {
          const detail = execFileSync('reg.exe', ['query', subkey], { encoding: 'utf8', timeout: 3000, windowsHide: true });
          if (!/\bPersistedInDatabase\b/i.test(detail)) {
            execFileSync('reg.exe', ['delete', subkey, '/f'], { timeout: 3000, windowsHide: true });
          }
        } catch { /* ignore individual subkey failure */ }
      }
    } catch { /* best effort */ }
  }
  cleanupOrphanWindowsMicrophoneKeys();

  ipcMain.handle('nextmux:permissions:status', event => trusted(event) ? status() : undefined);
  ipcMain.handle('nextmux:permissions:open-settings', async (event, kind) => {
    if (!trusted(event) || !KINDS.has(kind)) return false;
    if (process.platform === 'win32' && kind === 'microphone') cleanupOrphanWindowsMicrophoneKeys();
    const url = settingsUrl(kind);
    if (!url) return false;
    try { await shell.openExternal(url); return true; } catch {
      // Older systems ignore unknown anchors; fall back to the privacy root.
      const fallback = process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.preference.security' : 'ms-settings:privacy';
      await shell.openExternal(fallback).catch(() => undefined);
      return true;
    }
  });
  ipcMain.handle('nextmux:permissions:request', async (event, kind, texts) => {
    if (!trusted(event) || !KINDS.has(kind)) return undefined;
    const helperTexts = texts && typeof texts === 'object' ? {
      title: String(texts.title || '').slice(0, 80), body: String(texts.body || '').slice(0, 200), close: String(texts.close || '').slice(0, 40),
      notificationTitle: String(texts.notificationTitle || '').slice(0, 80), notificationBody: String(texts.notificationBody || '').slice(0, 160),
      locale: /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(String(texts.locale || '')) ? String(texts.locale) : 'en'
    } : { title: 'Drag the NextMux icon into the list above', body: 'Drop the icon into the list in System Settings, then switch it on.', close: 'Close' };
    if (process.platform === 'darwin') {
      if (kind === 'microphone') {
        if (systemPreferences.getMediaAccessStatus(kind) === 'not-determined') await systemPreferences.askForMediaAccess(kind).catch(() => false);
        if (systemPreferences.getMediaAccessStatus(kind) !== 'granted') await shell.openExternal(settingsUrl(kind));
        notify();
        return status();
      }
      if (kind === 'accessibility') {
        // First call shows the system prompt and adds NextMux (switched off) to the list.
        const trustedNow = systemPreferences.isTrustedAccessibilityClient(true);
        if (!trustedNow) { await shell.openExternal(settingsUrl(kind)); await openHelper(kind, helperTexts); }
        return status();
      }
      if (kind === 'screen') {
        // Asking for a screen source is what registers the app for Screen Recording.
        if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
          await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
          if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') { await shell.openExternal(settingsUrl(kind)); await openHelper(kind, helperTexts); }
        }
        return status();
      }
      if (kind === 'fullDisk' || kind === 'inputMonitoring' || kind === 'appManagement') {
        // These lists only accept apps added by hand: open the page and offer the drag helper.
        await shell.openExternal(settingsUrl(kind));
        await openHelper(kind, helperTexts);
        return status();
      }
      if (kind === 'notifications') {
        // The first notification registers NextMux in Notification settings.
        try { if (Notification?.isSupported?.()) new Notification({ title: helperTexts.notificationTitle || 'NextMux', body: helperTexts.notificationBody || '', silent: true }).show(); } catch { /* optional */ }
        // Give macOS a moment to register the app so its entry exists when the page opens.
        await new Promise(resolve => setTimeout(resolve, 700));
        await shell.openExternal(settingsUrl(kind));
        return status();
      }
      await shell.openExternal(settingsUrl(kind));
      return status();
    }
    if (process.platform === 'win32') {
      if (kind === 'accessibility' && computer?.requestPermission) { await computer.requestPermission(); notify(); return status(); }
      if (kind === 'microphone') cleanupOrphanWindowsMicrophoneKeys();
      const url = settingsUrl(kind);
      if (url) await shell.openExternal(url);
      windowsMicrophoneCache = { at: 0, value: '' };
      return status();
    }
    return status();
  });
  ipcMain.handle('nextmux:permissions:relaunch', event => {
    if (!trusted(event)) return false;
    closeHelper();
    app.relaunch();
    app.quit();
    return true;
  });
  // Returning to the app is when a user has usually just flipped a switch. The helper has done its job then
  // (Screen Recording reports its grant only after a relaunch, so waiting for the grant would keep it up).
  app.on('browser-window-focus', (_event, window) => {
    if (helpers.has(window)) return;
    windowsMicrophoneCache = { at: 0, value: '' };
    if (helpers.size && Date.now() - helperShownAt > 1500) closeHelper();
    notify();
  });
  app.on('before-quit', closeHelper);
  app.on('will-quit', closeHelper);
  return { status, closeHelper };
}

module.exports = { registerSystemPermissions, permissionStatus, resolveMicrophonePermissionStatus, audioPermissionAllowed, settingsUrl, appBundlePath, macMajor, fullDiskAccessStatus, windowsMicrophoneStatus };
