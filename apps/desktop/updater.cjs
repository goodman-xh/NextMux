'use strict';

const { app, BrowserWindow, autoUpdater: nativeUpdater, ipcMain, net, session, webContents, shell, systemPreferences, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { autoUpdater } = require('electron-updater');

app.setName('NextMux');
if (process.platform === 'win32') app.setAppUserModelId('io.nextmux.desktop');

const intervalMilliseconds = 6 * 60 * 60 * 1000;
const downloadPage = 'https://nextmux.app/download';
const updatePlatform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
const updateFeed = `https://nextmux.app/updates/${updatePlatform}/${process.arch}`;
const updateOrigin = 'https://nextmux.app';
const prereleaseChannel = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(app.getVersion())?.[1];
const updateChannel = prereleaseChannel || 'latest';
const updateVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const closePreparationTimeoutMs = 5_000;
let checkPromise;
let downloadPromise;
let availableVersion;
let downloadedInfo;
let preparationTimer;
let activeReleaseTarget;
let nextmuxTray;
// Native surfaces follow the renderer app language; system language is only the initial default.
const appLocaleKey = Symbol.for('nextmux.desktop.app-locale.v1');
let refreshTrayMenu = () => undefined;
const trayLabels = {
  'zh-CN': ['打开界面', '关闭 NextMux'], 'zh-TW': ['開啟介面', '關閉 NextMux'], en: ['Open window', 'Quit NextMux'],
  ja: ['ウインドウを開く', 'NextMux を終了'], ko: ['창 열기', 'NextMux 종료'], es: ['Abrir ventana', 'Salir de NextMux'],
  fr: ['Ouvrir la fenêtre', 'Quitter NextMux'], de: ['Fenster öffnen', 'NextMux beenden'], 'pt-BR': ['Abrir janela', 'Sair do NextMux'],
  ru: ['Открыть окно', 'Выйти из NextMux'], ar: ['فتح النافذة', 'إنهاء NextMux'], hi: ['विंडो खोलें', 'NextMux बंद करें']
};
function trayMenuLabels() {
  let language = 'en';
  try { language = app[appLocaleKey] || (typeof app.getPreferredSystemLanguages === 'function' && app.getPreferredSystemLanguages()[0]) || app.getLocale() || 'en'; } catch { /* default */ }
  const tag = String(language).toLowerCase();
  if (tag.startsWith('zh')) return trayLabels[/hant|tw|hk|mo/.test(tag) ? 'zh-TW' : 'zh-CN'];
  if (tag.startsWith('pt')) return trayLabels['pt-BR'];
  return trayLabels[tag.split(/[-_]/)[0]] || trayLabels.en;
}
const closePreparations = new WeakMap();
const closeCoordinatorKey = Symbol.for('nextmux.desktop.close-coordinator.v1');
const showMainWindowKey = Symbol.for('nextmux.desktop.show-main.v1');
const isQuittingKey = Symbol.for('nextmux.desktop.is-quitting.v1');
let state = {
  revision: 0,
  phase: 'idle',
  currentVersion: app.getVersion(),
  version: app.getVersion(),
  progress: 0,
  packaged: app.isPackaged,
  portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  checkedAt: 0,
  nextCheckAt: 0,
};

function updateError(code) {
  return Object.assign(new Error(code), { code });
}

function semverParts(value) {
  if (!updateVersionPattern.test(value)) return undefined;
  const coreAndPrerelease = value.split('+')[0];
  const separator = coreAndPrerelease.indexOf('-');
  const core = separator < 0 ? coreAndPrerelease : coreAndPrerelease.slice(0, separator);
  const prerelease = separator < 0 ? '' : coreAndPrerelease.slice(separator + 1);
  const numbers = core.split('.').map(Number);
  if (numbers.some(number => !Number.isSafeInteger(number))) return undefined;
  return { numbers, prerelease: prerelease ? prerelease.split('.') : [] };
}

function compareVersions(left, right) {
  const a = semverParts(left), b = semverParts(right);
  if (!a || !b) throw updateError('UPDATE_TARGET_INVALID_VERSION');
  for (let index = 0; index < 3; index += 1) if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined || b.prerelease[index] === undefined) return a.prerelease[index] === undefined ? -1 : 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]), bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return Number(a.prerelease[index]) < Number(b.prerelease[index]) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1;
  }
  return 0;
}

function releaseChannel(version) {
  const normalized = String(version || '');
  return normalized.includes('-') ? normalized.slice(normalized.indexOf('-') + 1).split('.')[0] : 'latest';
}

function expectedManifestName(channel) {
  return `${channel}${updatePlatform === 'macos' ? '-mac' : ''}.yml`;
}

function parseReleaseTarget(payload) {
  const target = payload?.target;
  if (payload?.ok !== true || payload.platform !== updatePlatform || payload.arch !== process.arch) {
    throw updateError('UPDATE_TARGET_SCOPE_MISMATCH');
  }
  if (target === null) return null;
  const expectedFeedPath = `/updates/releases/v${target?.version}/${updatePlatform}/${process.arch}`;
  if (!target || target.schemaVersion !== 1 || target.platform !== updatePlatform || target.arch !== process.arch
    || payload.channel !== target.channel
    || target.channel !== releaseChannel(target.version)
    || !updateVersionPattern.test(target.version) || !Number.isSafeInteger(target.revision) || target.revision < 1
    || target.manifestName !== expectedManifestName(target.channel) || target.feedPath !== expectedFeedPath
    || target.integrity !== 'sha512' || target.platformSignatureRequired !== true
    || typeof target.manifestSha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(target.manifestSha512)
    || !target.artifact || !/^[0-9A-Za-z][0-9A-Za-z._+()-]{0,199}$/.test(target.artifact.fileName || '')
    || !/^[A-Za-z0-9+/]{86}==$/.test(target.artifact.sha512 || '')
    || !Number.isSafeInteger(target.artifact.size) || target.artifact.size <= 0
    || !target.evidence || target.evidence.fileName !== 'release-attestation.json'
    || !/^[A-Za-z0-9+/]{86}==$/.test(target.evidence.sha512 || '')
    || !['authenticode', 'developer-id-notarized'].includes(target.evidence.signatureKind)
    || !/^[0-9a-f]{40}$/i.test(target.evidence.commit || '')
    || !Array.isArray(target.downgradeFrom) || target.downgradeFrom.length > 32
    || target.downgradeFrom.some(version => typeof version !== 'string' || !updateVersionPattern.test(version))) {
    throw updateError('UPDATE_TARGET_INVALID');
  }
  return { ...target, downgradeFrom: [...new Set(target.downgradeFrom)] };
}

function targetStatePath() {
  try { return path.join(app.getPath('userData'), 'nextmux-update-target-v1.json'); }
  catch { return ''; }
}

function readTargetFloor() {
  const pathname = targetStatePath();
  if (!pathname) return null;
  try {
    const value = JSON.parse(readFileSync(pathname, 'utf8'));
    return value?.schemaVersion === 1 && value.platform === updatePlatform && value.arch === process.arch
      && value.channel === releaseChannel(value.version)
      && Number.isSafeInteger(value.revision) && value.revision > 0 && updateVersionPattern.test(value.version) ? value : null;
  } catch { return null; }
}

function persistTargetFloor(target) {
  const pathname = targetStatePath();
  if (!pathname) return false;
  const temporary = `${pathname}.tmp`;
  try {
    mkdirSync(path.dirname(pathname), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, platform: updatePlatform, arch: process.arch,
      channel: target.channel, revision: target.revision, version: target.version, manifestSha512: target.manifestSha512,
      evidenceSha512: target.evidence.sha512 })}\n`, { mode: 0o600 });
    renameSync(temporary, pathname);
    return true;
  } catch {
    try { unlinkSync(temporary); } catch { /* Nothing was staged. */ }
    return false;
  }
}

/**
 * One small update document: `{ status, text }` (text only for 200). The same
 * deadline covers the headers and the body, which is read with a byte limit: a
 * server that stalls mid-body must not leave the check "checking" for good (audit DS-05).
 */
async function platformFetch(url, maximum) {
  if (typeof net?.fetch !== 'function') return undefined;
  const Controller = globalThis.AbortController;
  const controller = typeof Controller === 'function' ? new Controller() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), 10_000) : undefined;
  timer?.unref?.();
  try {
    const response = await net.fetch(url, { method: 'GET', cache: 'no-store', redirect: 'error',
      headers: { accept: 'application/json, text/yaml' }, ...(controller ? { signal: controller.signal } : {}) });
    if (response.status !== 200) {
      await response.body?.cancel?.().catch?.(() => undefined);
      return { status: response.status };
    }
    return { status: 200, text: await boundedText(response, maximum) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boundedText(response, maximum) {
  const announced = Number(response.headers?.get?.('content-length') || 0);
  if (announced > maximum) throw updateError('UPDATE_TARGET_TOO_LARGE');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (text.length > maximum) throw updateError('UPDATE_TARGET_TOO_LARGE');
    return text;
  }
  const decoder = new TextDecoder();
  let size = 0, text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maximum) { await reader.cancel().catch(() => undefined); throw updateError('UPDATE_TARGET_TOO_LARGE'); }
    text += decoder.decode(value, { stream: true });
  }
}

function verifyTargetManifest(source, target) {
  if (createHash('sha512').update(source).digest('base64') !== target.manifestSha512) throw updateError('UPDATE_TARGET_MANIFEST_MISMATCH');
  const version = /^version:\s*['"]?([^\s'"]+)['"]?\s*$/m.exec(source)?.[1];
  if (version !== target.version || !/^\s+sha512:\s*[A-Za-z0-9+/]{86}==\s*$/m.test(source)) throw updateError('UPDATE_TARGET_MANIFEST_INVALID');
  const files = [...source.matchAll(/^\s*-\s+url:\s*['"]?([^\s'"]+)['"]?\s*\n\s+sha512:\s*['"]?([A-Za-z0-9+/]{86}==)['"]?\s*\n\s+size:\s*(\d+)\s*$/gm)]
    .map(match => ({ fileName: match[1], sha512: match[2], size: Number(match[3]) }));
  const escapedVersion = target.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expected = updatePlatform === 'windows'
    ? new RegExp(`^NextMux-${escapedVersion}-${process.arch}-setup\\.exe$`)
    : new RegExp(`^NextMux-${escapedVersion}-${process.arch}\\.zip$`);
  if (files.length !== 1 || !expected.test(files[0].fileName)
    || files[0].fileName !== target.artifact.fileName || files[0].sha512 !== target.artifact.sha512
    || files[0].size !== target.artifact.size) throw updateError('UPDATE_TARGET_ARCH_MISMATCH');
}

function verifyUpdateInfo(info) {
  if (!activeReleaseTarget) return true;
  const files = Array.isArray(info?.files) ? info.files : [];
  return files.length === 1 && files[0]?.url === activeReleaseTarget.artifact.fileName
    && files[0]?.sha512 === activeReleaseTarget.artifact.sha512
    && Number(files[0]?.size) === activeReleaseTarget.artifact.size;
}

function verifyTargetEvidence(source, target) {
  if (createHash('sha512').update(source).digest('base64') !== target.evidence.sha512) throw updateError('UPDATE_TARGET_EVIDENCE_MISMATCH');
  let value;
  try { value = JSON.parse(source); } catch { throw updateError('UPDATE_TARGET_EVIDENCE_INVALID'); }
  const kind = updatePlatform === 'windows' ? 'authenticode' : 'developer-id-notarized';
  if (value?.schemaVersion !== 1 || value.version !== target.version || value.platform !== updatePlatform
    || value.arch !== process.arch || value.channel !== target.channel || value.commit !== target.evidence.commit
    || value.manifest?.fileName !== target.manifestName || value.manifest?.sha512 !== target.manifestSha512
    || value.artifact?.fileName !== target.artifact.fileName || value.artifact?.size !== target.artifact.size
    || value.artifact?.sha512 !== target.artifact.sha512 || !/^[0-9a-f]{64}$/i.test(value.artifact?.sha256 || '')
    || value.nativeSignature?.status !== 'verified' || value.nativeSignature?.kind !== kind
    || kind !== target.evidence.signatureKind || !/^[0-9a-f]{64}$/i.test(value.nativeSignature?.evidenceSha256 || '')) {
    throw updateError('UPDATE_TARGET_EVIDENCE_INVALID');
  }
}

async function configureUpdateTarget() {
  activeReleaseTarget = undefined;
  autoUpdater.allowDowngrade = false;
  const query = new URL('/api/releases/target', updateOrigin);
  query.searchParams.set('platform', updatePlatform);
  query.searchParams.set('arch', process.arch);
  query.searchParams.set('channel', updateChannel);
  let response;
  try { response = await platformFetch(query.toString(), 16 * 1024); }
  catch (error) { throw error?.code === 'UPDATE_TARGET_TOO_LARGE' ? error : updateError('UPDATE_TARGET_UNAVAILABLE'); }
  if (!response || response.status === 404 || response.status >= 500) throw updateError('UPDATE_TARGET_UNAVAILABLE');
  if (response.status !== 200) throw updateError('UPDATE_TARGET_REQUEST_REJECTED');
  let payload;
  try { payload = JSON.parse(response.text); }
  catch { throw updateError('UPDATE_TARGET_INVALID'); }
  const target = parseReleaseTarget(payload);
  if (!target) return { kind: 'current', target: null };
  const floor = readTargetFloor();
  if (floor && (target.revision < floor.revision || target.revision === floor.revision
    && (target.version !== floor.version || target.manifestSha512 !== floor.manifestSha512
      || target.evidence.sha512 !== floor.evidenceSha512))) throw updateError('UPDATE_TARGET_REPLAYED');
  const direction = compareVersions(target.version, app.getVersion());
  if (direction < 0 && !target.downgradeFrom.includes(app.getVersion())) throw updateError('UPDATE_DOWNGRADE_NOT_AUTHORIZED');
  const feedUrl = `${updateOrigin}${target.feedPath}`;
  const manifestResponse = await platformFetch(`${feedUrl}/${target.manifestName}`, 64 * 1024)
    .catch(error => { throw error?.code === 'UPDATE_TARGET_TOO_LARGE' ? error : updateError('UPDATE_TARGET_MANIFEST_UNAVAILABLE'); });
  if (!manifestResponse || manifestResponse.status !== 200) throw updateError('UPDATE_TARGET_MANIFEST_UNAVAILABLE');
  verifyTargetManifest(manifestResponse.text, target);
  const evidenceResponse = await platformFetch(`${feedUrl}/${target.evidence.fileName}`, 32 * 1024)
    .catch(error => { throw error?.code === 'UPDATE_TARGET_TOO_LARGE' ? error : updateError('UPDATE_TARGET_EVIDENCE_UNAVAILABLE'); });
  if (!evidenceResponse || evidenceResponse.status !== 200) throw updateError('UPDATE_TARGET_EVIDENCE_UNAVAILABLE');
  verifyTargetEvidence(evidenceResponse.text, target);
  if (!persistTargetFloor(target)) throw updateError('UPDATE_TARGET_STATE_UNWRITABLE');
  activeReleaseTarget = target;
  if (direction === 0) return { kind: 'current', target };
  autoUpdater.channel = target.channel;
  autoUpdater.allowPrerelease = target.channel !== 'latest';
  autoUpdater.allowDowngrade = direction < 0;
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, channel: target.channel });
  return { kind: 'target', target, direction: direction < 0 ? 'downgrade' : 'upgrade' };
}

function publicState() {
  return { ...state };
}

function trustedMainFrame(event) {
  if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame) return false;
  try {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || event.sender.isDestroyed() || window.webContents !== event.sender) return false;
    // Only the app's own pages, which Electron loads from files. Any server on this computer (localhost) is not
    // the app, even when its path looks like one of the app's pages (audit A22-01).
    return new URL(event.sender.getURL()).protocol === 'file:';
  } catch {
    return false;
  }
}

require('./native-dictation.cjs').registerNativeDictation({ app, BrowserWindow, ipcMain, trustedMainFrame });

/**
 * Theia registers its own IPC channels after this module loads. The ones that reach the system (open a URI or file,
 * reveal a path, read or write the clipboard, hand out the backend security token, open developer tools, and the
 * RPC connection itself) get the same checks as NextMux's own channels: only the app's own window main frame, and
 * for opening, the same targets as `nextmux:external:open` / `nextmux:path:open` (audit B12-01).
 */
function loopbackEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
function systemOpenAllowed(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') return true;
    return url.protocol === 'file:' && Boolean(safeLocalOpenTarget(require('node:url').fileURLToPath(url)));
  } catch { return false; }
}
const inheritedChannelGuards = new Map([
  ['GetSecurityToken', { sync: true, allow: event => trustedMainFrame(event) }],
  ['AttachSecurityToken', { allow: (event, endpoint) => trustedMainFrame(event) && loopbackEndpoint(endpoint) }],
  ['OpenWithSystemApp', { allow: (event, uri) => trustedMainFrame(event) && systemOpenAllowed(uri) }],
  ['ShowItemInFolder', { allow: (event, fsPath) => trustedMainFrame(event) && typeof fsPath === 'string' && path.isAbsolute(fsPath) }],
  ['ReadClipboard', { sync: true, allow: event => trustedMainFrame(event) }],
  ['WriteClipboard', { allow: event => trustedMainFrame(event) }],
  ['ToggleDevtools', { allow: event => trustedMainFrame(event) }],
  ['OpenDevtoolsForWindow', { allow: event => trustedMainFrame(event) }],
  ['IpcConnection', { allow: event => trustedMainFrame(event) }],
]);
if (typeof ipcMain.on === 'function' && typeof ipcMain.handle === 'function') {
  const ipcOn = ipcMain.on.bind(ipcMain);
  const ipcHandle = ipcMain.handle.bind(ipcMain);
  const guardedListeners = new WeakMap();
  ipcMain.on = (channel, listener) => {
    const guard = inheritedChannelGuards.get(channel);
    if (!guard || typeof listener !== 'function') return ipcOn(channel, listener);
    const guarded = (event, ...args) => {
      if (guard.allow(event, ...args)) return listener(event, ...args);
      if (guard.sync) event.returnValue = null;
      return undefined;
    };
    guardedListeners.set(listener, guarded);
    return ipcOn(channel, guarded);
  };
  if (typeof ipcMain.removeListener === 'function') {
    // Theia removes its listeners by the function it passed in.
    const ipcRemove = ipcMain.removeListener.bind(ipcMain);
    ipcMain.off = ipcMain.removeListener = (channel, listener) => ipcRemove(channel, guardedListeners.get(listener) || listener);
  }
  ipcMain.handle = (channel, listener) => {
    const guard = inheritedChannelGuards.get(channel);
    // Theia's preload closes a native context menu with send('ClosePopup', handle) while its main process only
    // handles an invoke, and expects OpenPopup to return that handle: bridge both, so disposing a menu closes it
    // (audit B12-03).
    if (channel === 'OpenPopup' && typeof listener === 'function') {
      const original = listener;
      listener = async (event, menuId, ...rest) => { await original(event, menuId, ...rest); return menuId; };
    }
    if (channel === 'ClosePopup' && typeof listener === 'function' && typeof ipcOn === 'function') {
      ipcOn('ClosePopup', (event, handle) => { try { if (!guard || guard.allow(event, handle)) listener(event, handle); } catch { /* the menu already closed */ } });
    }
    if (!guard || typeof listener !== 'function') return ipcHandle(channel, listener);
    return ipcHandle(channel, (event, ...args) => {
      if (!guard.allow(event, ...args)) throw new Error('Refused');
      return listener(event, ...args);
    });
  };
}

function safeBrowserUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function publish(phase, detail = {}) {
  state = { ...state, ...detail, phase, revision: state.revision + 1 };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try { window.webContents.send('nextmux:update-state', publicState()); }
      catch { /* A closing renderer must not turn a valid update into a failure. */ }
    }
  }
}

function updateInProgress() {
  return Boolean(downloadPromise) || state.phase === 'downloading' || state.phase === 'ready';
}

function updateFailed(error, fallbackCode = 'UPDATE_FAILED') {
  if (state.phase === 'ready') return;
  // Squirrel has no public cancellation/request-id boundary for a staged ZIP.
  // Do not start a new attempt in this process and misattribute a late event.
  const restartRequired = state.restartRequired || process.platform === 'darwin' && Boolean(downloadedInfo || state.preparing);
  if (restartRequired) availableVersion = undefined;
  clearTimeout(preparationTimer);
  preparationTimer = undefined;
  downloadedInfo = undefined;
  publish(availableVersion ? 'available' : 'error', {
    preparing: false,
    restartRequired,
    ...(!availableVersion ? { targetRevision: undefined, updateDirection: undefined, rollbackAuthorized: false } : {}),
    errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : fallbackCode,
    checkedAt: Date.now(), nextCheckAt: Date.now() + intervalMilliseconds,
  });
}

async function checkForUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) {
    publish('unsupported', {
      reason: process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'development',
      checkedAt: Date.now(),
      nextCheckAt: 0,
    });
    return null;
  }
  if (updateInProgress() || state.restartRequired) return null;
  if (checkPromise) return checkPromise;
  publish('checking', { errorCode: undefined });
  checkPromise = Promise.resolve().then(async () => {
    const configured = await configureUpdateTarget();
    if (configured.kind === 'current') {
      availableVersion = undefined;
      publish('current', { version: app.getVersion(), progress: 0, preparing: false,
        targetRevision: configured.target?.revision, updateDirection: 'current', rollbackAuthorized: false,
        checkedAt: Date.now(), nextCheckAt: Date.now() + intervalMilliseconds, errorCode: undefined });
      return null;
    }
    return autoUpdater.checkForUpdates();
  }).catch(error => {
    if (!updateInProgress()) updateFailed(error, 'UPDATE_CHECK_FAILED');
    return null;
  }).finally(() => { checkPromise = undefined; });
  return checkPromise;
}

function downloadUpdate() {
  if (state.restartRequired) return false;
  if (updateInProgress()) return true;
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE || checkPromise
    || state.phase !== 'available' || !availableVersion) return false;
  if (compareVersions(availableVersion, app.getVersion()) < 0
    && (!activeReleaseTarget || activeReleaseTarget.version !== availableVersion
      || !activeReleaseTarget.downgradeFrom.includes(app.getVersion()) || !autoUpdater.allowDowngrade)) return false;
  downloadedInfo = undefined;
  // Set the flight before publishing or calling the SDK: synchronous events or
  // a second renderer cannot dispatch a second download.
  downloadPromise = Promise.resolve().then(() => autoUpdater.downloadUpdate()).then(() => {
    if (state.phase === 'downloading' && !downloadedInfo) updateFailed(undefined, 'UPDATE_NOT_PREPARED');
  }).catch(error => updateFailed(error, 'UPDATE_DOWNLOAD_FAILED'))
    .finally(() => { downloadPromise = undefined; });
  publish('downloading', { version: availableVersion, progress: 0, transferred: 0, total: 0, preparing: false, errorCode: undefined });
  return true;
}

function updateReady() {
  if (state.phase !== 'downloading' || downloadedInfo?.version !== availableVersion) return;
  clearTimeout(preparationTimer);
  preparationTimer = undefined;
  publish('ready', { version: availableVersion, progress: 100, preparing: false, errorCode: undefined });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoRunAppAfterInstall = false;
// electron-builder names prerelease manifests after the first prerelease
// identifier (for example alpha.yml / alpha-mac.yml). Pin the updater to the
// same channel instead of silently requesting latest.yml for an alpha build.
autoUpdater.channel = updateChannel;
autoUpdater.allowPrerelease = updateChannel !== 'latest';
// Live and third-party feed semantics never authorize a downgrade. A validated,
// revision-bound platform target can enable it for one exact current version.
autoUpdater.allowDowngrade = false;
autoUpdater.setFeedURL({ provider: 'generic', url: updateFeed, channel: updateChannel });
autoUpdater.fullChangelog = false;
autoUpdater.disableWebInstaller = true;
autoUpdater.on('checking-for-update', () => {
  if (checkPromise && !updateInProgress()) publish('checking', { errorCode: undefined });
});
autoUpdater.on('update-available', info => {
  if (!checkPromise || updateInProgress()) return;
  if (activeReleaseTarget && info.version !== activeReleaseTarget.version) {
    updateFailed(updateError('UPDATE_TARGET_VERSION_MISMATCH'));
    return;
  }
  if (activeReleaseTarget && !verifyUpdateInfo(info)) {
    updateFailed(updateError('UPDATE_TARGET_ARTIFACT_MISMATCH'));
    return;
  }
  const direction = compareVersions(info.version, app.getVersion());
  if (direction < 0 && (!activeReleaseTarget || activeReleaseTarget.version !== info.version
    || !activeReleaseTarget.downgradeFrom.includes(app.getVersion()) || !autoUpdater.allowDowngrade)) {
    updateFailed(updateError('UPDATE_DOWNGRADE_NOT_AUTHORIZED'));
    return;
  }
  availableVersion = info.version;
  publish('available', { version: info.version, progress: 0, preparing: false,
    targetRevision: activeReleaseTarget?.revision,
    updateDirection: direction < 0 ? 'downgrade' : 'upgrade',
    rollbackAuthorized: Boolean(activeReleaseTarget && autoUpdater.allowDowngrade),
    checkedAt: Date.now(), nextCheckAt: Date.now() + intervalMilliseconds, errorCode: undefined });
});
autoUpdater.on('update-not-available', () => {
  if (!checkPromise || updateInProgress()) return;
  if (activeReleaseTarget && activeReleaseTarget.version !== app.getVersion()) {
    updateFailed(updateError('UPDATE_TARGET_NOT_AVAILABLE'));
    return;
  }
  availableVersion = undefined;
  publish('current', { version: app.getVersion(), progress: 0, preparing: false,
    targetRevision: activeReleaseTarget?.revision,
    updateDirection: 'current', rollbackAuthorized: false,
    checkedAt: Date.now(), nextCheckAt: Date.now() + intervalMilliseconds, errorCode: undefined });
});
autoUpdater.on('download-progress', progress => {
  if (!downloadPromise || state.phase !== 'downloading' || state.preparing) return;
  const bounded = value => Number.isFinite(value) && value >= 0 ? value : 0;
  publish('downloading', { progress: Math.min(100, Math.floor(bounded(progress.percent))),
    transferred: bounded(progress.transferred), total: bounded(progress.total) });
});
autoUpdater.on('update-downloaded', info => {
  if (!downloadPromise || state.phase !== 'downloading' || info.version !== availableVersion
    || activeReleaseTarget && info.version !== activeReleaseTarget.version) return;
  downloadedInfo = info;
  if (process.platform !== 'darwin') { updateReady(); return; }
  // MacUpdater emits this event before Squirrel verifies/stages its local ZIP.
  // Wait for the native completion; 100% downloaded is not yet ready to install.
  publish('downloading', { progress: 100, preparing: true });
  preparationTimer = setTimeout(() => updateFailed(undefined, 'UPDATE_PREPARATION_TIMEOUT'), 10 * 60_000);
  preparationTimer.unref?.();
});
if (process.platform === 'darwin') nativeUpdater.on('update-downloaded', updateReady);
autoUpdater.on('error', error => {
  if (checkPromise || downloadPromise || state.preparing) updateFailed(error);
});

ipcMain.handle('nextmux:app:locale', (event, locale) => {
  if (!trustedMainFrame(event) || typeof locale !== 'string' || !Object.hasOwn(trayLabels, locale)) return false;
  if (app[appLocaleKey] !== locale) {
    app[appLocaleKey] = locale;
    refreshTrayMenu();
    app.emit('nextmux-locale-changed', locale);
  }
  return true;
});

ipcMain.handle('nextmux:update:get', event => trustedMainFrame(event) ? publicState() : false);
ipcMain.handle('nextmux:update:check', event => {
  if (!trustedMainFrame(event)) return false;
  return checkForUpdates().then(() => publicState());
});
ipcMain.handle('nextmux:update:download', event => trustedMainFrame(event) && downloadUpdate());
ipcMain.handle('nextmux:update:install', event => {
  if (!trustedMainFrame(event) || state.phase !== 'ready') return false;
  // Never launch an installer before the existing window save/veto handshake.
  // The updater's normal on-quit hook installs only after a successful quit.
  setImmediate(() => app.quit());
  return true;
});
ipcMain.handle('nextmux:update:download-page', async event => {
  if (!trustedMainFrame(event)) return false;
  await shell.openExternal(downloadPage);
  return true;
});
ipcMain.handle('nextmux:external:open', async (event, value) => {
  if (!trustedMainFrame(event)) return false;
  if (typeof value !== 'string' || value.length > 4096) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  await shell.openExternal(url.toString(), { activate: true });
  return true;
});
// Opening with the system launches executables, so only folders and ordinary documents may go through this bridge.
const launchableExtensions = /\.(?:app|command|tool|terminal|workflow|action|scpt|scptd|applescript|osascript|sh|bash|zsh|csh|fish|py|pl|rb|jar|pkg|mpkg|dmg|prefpane|kext|webloc|inetloc|fileloc|url|lnk|exe|msi|msix|appx|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|scr|reg|desktop|appimage|run)$/i;
function safeLocalOpenTarget(value) {
  const lexical = path.normalize(value);
  // A network (UNC) path would make the system connect to that host when opened.
  if (process.platform === 'win32' && /^[\\/]{2}/.test(lexical)) return undefined;
  if (lexical.split(path.sep).some(part => launchableExtensions.test(part))) return undefined;
  try {
    // Judge and open what the path really is: a plainly named link to an app bundle
    // or script must not pass as a document (audit DS-04).
    const target = realpathSync(lexical);
    if (target.split(path.sep).some(part => launchableExtensions.test(part))) return undefined;
    const stats = statSync(target);
    if (stats.isDirectory()) return target;
    if (!stats.isFile()) return undefined;
    if (process.platform !== 'win32' && (stats.mode & 0o111) !== 0) return undefined;
    return target;
  } catch {
    return undefined;
  }
}
ipcMain.handle('nextmux:path:open', async (event, value) => {
  if (!trustedMainFrame(event)) return false;
  if (typeof value !== 'string' || value.length > 32768 || !path.isAbsolute(value)) return false;
  const target = safeLocalOpenTarget(value);
  return target ? (await shell.openPath(target)) === '' : false;
});
// Deleting a comic project, one of its conversations or a character-library entry moves it to the system Trash
// (Recycle Bin on Windows), where it can be restored; NextMux never erases these outright. Only one of those is
// accepted: a comic project folder holds nextmux.comic.json (not a conversation folder: that is the user's own folder); a conversation is nextmux.chats/chat-<uuid>.json
// inside such a folder; a library character is a bundle folder inside comic-character-library; a free canvas is its folder
// in the project's nextmux.canvases, and only while the project's canvas registry marks that canvas as being deleted.
function trashableFolder(value) {
  if (typeof value !== 'string' || value.length > 32768 || !path.isAbsolute(value) || value.includes('\0')) return undefined;
  try {
    const target = require('node:fs').realpathSync(value);
    const info = statSync(target);
    if (info.isFile()) {
      const folder = path.dirname(target);
      return /^chat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(path.basename(target)) && path.basename(folder) === 'nextmux.chats'
        && existsSync(path.join(path.dirname(folder), 'nextmux.comic.json')) ? target : undefined;
    }
    if (!info.isDirectory() || target === path.parse(target).root || target === app.getPath('home')) return undefined;
    if (existsSync(path.join(target, 'nextmux.comic.json'))) {
      // A conversation folder (对话模式) is a folder the user picked, with their own files in it: never trashed whole.
      try { if (JSON.parse(require('node:fs').readFileSync(path.join(target, 'nextmux.comic.json'), 'utf8'))?.projectKind === 'chat') return undefined; } catch { return undefined; }
      return target;
    }
    if (path.basename(path.dirname(target)) === 'comic-character-library' && /^bundle-[0-9a-f-]{36}$/i.test(path.basename(target))
      && existsSync(path.join(target, 'bundle.json'))) return target;
    if (path.basename(path.dirname(target)) === 'nextmux.canvases') {
      const project = path.dirname(path.dirname(target)), id = path.basename(target);
      if (!existsSync(path.join(project, 'nextmux.comic.json'))) return undefined;
      const registry = JSON.parse(require('node:fs').readFileSync(path.join(project, 'nextmux.canvases.json'), 'utf8'));
      const entry = Array.isArray(registry?.canvases) ? registry.canvases.find(item => item?.id === id) : undefined;
      return entry?.kind === 'free' && entry.deletionPending === true && !entry.deletedAt ? target : undefined;
    }
  } catch { /* missing or unreadable */ }
  return undefined;
}
ipcMain.handle('nextmux:path:trash', async (event, value) => {
  if (!trustedMainFrame(event)) return false;
  const target = trashableFolder(value);
  if (!target) return false;
  await shell.trashItem(target);
  return true;
});
// 应用操控: the user picks one app for the next request. The picker opens where apps live (Applications on macOS,
// the Start menu's programs on Windows); the app's own name and icon come from the system.
let windowsAppsInstance;
const getWindowsApps = () => {
  if (!windowsAppsInstance) {
    windowsAppsInstance = require('./windows-apps.cjs').createWindowsApps({ app, nativeImage });
    if (typeof app.once === 'function') {
      app.once('will-quit', () => {
        windowsAppsInstance?.dispose?.();
        windowsAppsInstance?.cleanup?.();
      });
    }
  }
  return windowsAppsInstance;
};
ipcMain.handle('nextmux:app:pick', async (event, title) => {
  if (!trustedMainFrame(event)) return undefined;
  const owner = BrowserWindow.fromWebContents(event.sender);
  const mac = process.platform === 'darwin', windows = process.platform === 'win32';
  if (windows) return getWindowsApps().pick({ Menu, owner });
  if (!mac) return undefined;
  const picked = await dialog.showOpenDialog(owner, {
    title: typeof title === 'string' ? title.slice(0, 80) : undefined, defaultPath: '/Applications', properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['app'] }]
  });
  const file = picked.canceled ? undefined : picked.filePaths[0];
  return file ? require('./app-describe.cjs').describeMacApplication({ app, nativeImage }, file) : undefined;
});
// An app dragged onto the composer (Finder or the Dock on macOS; Explorer or the Start menu on Windows): the same
// description as a picked one, or undefined when the path is not an app.
ipcMain.handle('nextmux:app:describe', async (event, file) => {
  if (!trustedMainFrame(event) || typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096) return undefined;
  if (process.platform === 'darwin') return require('./app-describe.cjs').describeMacApplication({ app, nativeImage }, file);
  if (process.platform === 'win32' && /\.(exe|lnk)$/i.test(file)) return getWindowsApps().describe(file);
  return undefined;
});
// The icon of an app a sent message used (the message keeps only its name and id).
ipcMain.handle('nextmux:app:icon', async (event, id) => {
  if (!trustedMainFrame(event) || typeof id !== 'string' || !id || id.length > 160) return '';
  try {
    if (process.platform === 'darwin') {
      const bundle = await require('./app-describe.cjs').macApplicationPath(id);
      if (!bundle) return '';
      const image = await require('./app-icon.cjs').appIcon({ app, nativeImage }, bundle, 64);
      return image.isEmpty() ? '' : image.toDataURL();
    }
    if (process.platform === 'win32') return (await getWindowsApps().iconForId(id)) || '';
  } catch { /* no icon */ }
  return '';
});
ipcMain.handle('nextmux:microphone:settings', async event => {
  if (!trustedMainFrame(event)) return false;
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:privacy-microphone');
    return true;
  }
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    return true;
  }
  return false;
});
const microphonePermissionState = (status, requested = false) => ({
  status,
  requested,
  restartRequired: process.platform === 'darwin' && (status === 'denied' || status === 'restricted'),
  platform: process.platform,
  osRelease: os.release(),
  arch: process.arch,
  scope: process.platform === 'win32' ? 'desktop-apps' : process.platform === 'darwin' ? 'application' : 'unsupported'
});
const resolveMicrophonePermissionStatus = options => {
  try { return require('./system-permissions.cjs').resolveMicrophonePermissionStatus(options); }
  catch {
    const status = options?.systemPreferences?.getMediaAccessStatus?.('microphone');
    return typeof status === 'string' && status ? status : 'unknown';
  }
};
ipcMain.handle('nextmux:microphone:status', event => {
  if (!trustedMainFrame(event)) return undefined;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return microphonePermissionState('unknown');
  }
  return microphonePermissionState(resolveMicrophonePermissionStatus({ systemPreferences, platform: process.platform }));
});
ipcMain.handle('nextmux:microphone:permission', async event => {
  if (!trustedMainFrame(event)) return undefined;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return microphonePermissionState('unknown');
  }
  let status = resolveMicrophonePermissionStatus({ systemPreferences, platform: process.platform });
  let requested = false;
  if (process.platform === 'darwin' && status === 'not-determined') {
    requested = true;
    const granted = await systemPreferences.askForMediaAccess('microphone');
    status = granted ? 'granted' : resolveMicrophonePermissionStatus({ systemPreferences, platform: process.platform });
  }
  return microphonePermissionState(status, requested);
});
ipcMain.handle('nextmux:cache:clear', async event => {
  if (!trustedMainFrame(event)) throw new Error('NEXTMUX_UNTRUSTED_FRAME');
  // “Network cache” covers the workbench and the built-in browser partition.
  await Promise.all([session.defaultSession, session.fromPartition('persist:nextmux-browser')].map(target => target.clearCache()));
  return { cleared: true, at: Date.now() };
});
ipcMain.handle('nextmux:cache:size', async event => {
  if (!trustedMainFrame(event)) throw new Error('NEXTMUX_UNTRUSTED_FRAME');
  const sizes = await Promise.all([session.defaultSession, session.fromPartition('persist:nextmux-browser')]
    .map(target => target.getCacheSize().catch(() => 0)));
  return sizes.reduce((total, size) => total + (Number.isFinite(size) && size > 0 ? size : 0), 0);
});
function matchingClosePreparation(event, token) {
  if (!trustedMainFrame(event) || typeof token !== 'string') return undefined;
  const window = BrowserWindow.fromWebContents(event.sender);
  const state = window && closePreparations.get(window);
  if (!window || window.isDestroyed() || event.sender.isDestroyed() || !state
      || event.sender !== window.webContents || state.frame !== event.senderFrame
      || token !== state.token || state.approved) return undefined;
  return { window, state };
}

function cancelClosePreparation(window, reason, expectedState) {
  const state = closePreparations.get(window);
  if (!state || expectedState && state !== expectedState) return;
  clearTimeout(state.timer);
  closePreparations.delete(window);
  state.resolve?.(undefined);
  if (reason && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    try { window.webContents.send('nextmux:prepare-close:cancelled', state.token, reason); }
    catch { /* A disappearing renderer cannot acknowledge saved state. */ }
  }
}

// Only a workbench page answers the save handshake. A small page the main process built itself (the permission
// helper, the computer-use frame, a progress window) has nothing to save; holding its close would also cancel quit
// and relaunch, since Electron gives up quitting when any window refuses to close.
function takesPartInCloseHandshake(window) {
  try {
    const url = window.webContents.getURL();
    return !/^(data|about):/i.test(url);
  } catch { return false; }
}

function offerClosePreparation(window, coordinated = false) {
  const existing = closePreparations.get(window);
  if (existing) return existing.promise;
  if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(undefined);
  const token = randomUUID();
  const state = { token, frame: window.webContents.mainFrame, begun: false, approved: false, timer: undefined, coordinated };
  state.promise = new Promise(resolve => { state.resolve = resolve; });
  state.timer = setTimeout(() => cancelClosePreparation(window, 'timeout', state), closePreparationTimeoutMs);
  state.timer.unref?.();
  closePreparations.set(window, state);
  try { window.webContents.send('nextmux:prepare-close', token); }
  catch { cancelClosePreparation(window, 'failed', state); }
  return state.promise;
}

ipcMain.handle('nextmux:application-is-quitting', event => {
  return Boolean(trustedMainFrame(event) && typeof app[isQuittingKey] === 'function' && app[isQuittingKey]());
});
ipcMain.handle('nextmux:prepare-close:begin', (event, token) => {
  const match = matchingClosePreparation(event, token);
  if (!match) return false;
  match.state.begun = true;
  return true;
});
ipcMain.handle('nextmux:prepare-close:complete', (event, token, outcome) => {
  const match = matchingClosePreparation(event, token);
  if (!match || !match.state.begun || outcome !== 'saved' && outcome !== 'failed') return false;
  const { window, state } = match;
  if (outcome === 'failed') {
    cancelClosePreparation(window, 'failed', state);
    return true;
  }
  clearTimeout(state.timer);
  state.approved = true;
  if (state.coordinated) {
    // The Theia window awaits this receipt before its own veto/cleanup flow.
    // Never start a competing window.close from an IPC callback.
    state.resolve(state.token);
    return true;
  }
  try { window.close(); }
  catch {
    cancelClosePreparation(window, 'failed', state);
    return false;
  }
  return true;
});

app.whenReady().then(() => {
  // Keep the process alive when the workbench window is closed. The tray is
  // the lightweight reopen/quit entry point on macOS and Windows.
  const showWorkbench = () => {
    const isQuitting = app[isQuittingKey];
    if (typeof isQuitting === 'function' && isQuitting() === true) return;
    if (require('./main-window-focus.cjs').focusMainWorkbenchWindow({ app, BrowserWindow, platform: process.platform })) return;
    // The primary workbench is normally still alive but hidden after
    // Command+W.  Keep the legacy activation fallback for startup fixtures,
    // but avoid recursively dispatching the real Dock handler.
    if (typeof app.listenerCount !== 'function' || app.listenerCount('activate') === 0) app.emit('activate');
    return false;
  };
  try {
    // Dock activation must bring back the hidden workbench after Command+W.
    app.on('activate', showWorkbench);
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    if (process.platform === 'darwin' && app.dock && typeof app.dock.setIcon === 'function') {
      // PNG first: nativeImage cannot read .icns (it returns an empty image), which left the
      // development build with Electron's own Dock icon. The first picture that loads wins.
      const dockImage = [
        path.join(process.resourcesPath || '', 'icon.png'),
        path.join(app.getAppPath(), 'build-resources', 'icon.png'),
        path.join(process.resourcesPath || '', 'icon.icns'),
        path.join(app.getAppPath(), 'build-resources', 'icon.icns')
      ].filter(candidate => candidate && existsSync(candidate))
        .map(candidate => nativeImage.createFromPath(candidate))
        .find(image => !image.isEmpty());
      if (dockImage) app.dock.setIcon(dockImage);
    }
    // macOS menu bar: the colour NextMux logo as an 18 pt PNG (a tiny PNG, not
    // an SVG data URL, which some runtimes turn into an empty or grey item).
    const iconPath = [...(process.platform === 'darwin' ? [
      path.join(process.resourcesPath || '', 'tray-logo.png'),
      path.join(app.getAppPath(), 'build-resources', 'tray-logo.png')
    ] : []),
      path.join(app.getAppPath(), 'build-resources', iconName),
      path.join(process.resourcesPath || '', iconName),
      path.join(process.resourcesPath || '', 'icon.icns')
    ].find(candidate => candidate && existsSync(candidate)) || '';
    let image = nativeImage.createFromPath(iconPath);
    // macOS: an 18 pt tray-logo.png with tray-logo@2x.png beside it (loaded
    // automatically on Retina), never resized. It is the colour logo, not a
    // monochrome template, so the menu bar shows the same logo as the app.
    // Windows still uses a compact 16px image.
    if (!image.isEmpty() && process.platform !== 'darwin') image = image.resize({ width: 16, height: 16 });
    nextmuxTray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    if (process.platform === 'darwin' && !image.isEmpty()) nextmuxTray.setIgnoreDoubleClickEvents(true);
    if (process.platform === 'darwin' && !image.isEmpty()) nextmuxTray.setImage(image);
    nextmuxTray.setToolTip('NextMux');
    refreshTrayMenu = () => {
      const [openLabel, quitLabel] = trayMenuLabels();
      nextmuxTray.setContextMenu(Menu.buildFromTemplate([
        { label: openLabel, click: showWorkbench },
        { type: 'separator' },
        { label: quitLabel, click: () => app.quit() }
      ]));
    };
    refreshTrayMenu();
    nextmuxTray.on('click', showWorkbench);
  } catch (error) {
    // Keep startup resilient, but leave a diagnostic in development builds so
    // a missing status item cannot be mistaken for a renderer/UI failure.
    if (!app.isPackaged) console.error('[NextMux] tray unavailable', error);
  }
  // Dictation only: NextMux's own pages may use the microphone; a framed site, the camera and everything else may not.
  const { audioPermissionAllowed } = require('./system-permissions.cjs');
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => audioPermissionAllowed({
    webContents, permission, origin: details?.securityOrigin || details?.requestingUrl || requestingOrigin, mediaType: details?.mediaType }));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(audioPermissionAllowed({
    webContents, permission, origin: details?.securityOrigin || details?.requestingUrl || '', mediaTypes: details?.mediaTypes })));
  const browserSession = session.fromPartition('persist:nextmux-browser');
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.on('will-download', event => event.preventDefault());
  const firstCheck = setTimeout(() => void checkForUpdates(), 15_000);
  firstCheck.unref?.();
  const timer = setInterval(() => void checkForUpdates(), intervalMilliseconds);
  timer.unref?.();
});

const TOP_LAYER_ANSWER_MS = 600;
async function closeTopLayerOrWindow(window, returnToTerminal) {
  if (window.isDestroyed()) return;
  const terminalCheck = returnToTerminal ? "document.activeElement && document.activeElement.closest && document.activeElement.closest('.xterm') ? 'terminal' : " : '';
  let answer = false;
  try {
    answer = await Promise.race([
      window.webContents.executeJavaScript(`${terminalCheck}(typeof window.__nextmuxCloseTopLayer === 'function' && window.__nextmuxCloseTopLayer() === true)`, true),
      new Promise(resolve => setTimeout(() => resolve(false), TOP_LAYER_ANSWER_MS)),
    ]);
  } catch { answer = false; }
  if (answer === 'terminal') { returnToTerminal(); return; }
  if (answer !== true && !window.isDestroyed()) window.close();
}

app.on('browser-window-created', (_event, window) => {
  // Main-process-only bridge, installed before Theia constructs its wrapper.
  // It is not exposed to webContents or to a renderer IPC caller.
  const coordinator = {
    managed: false,
    prepare: () => offerClosePreparation(window, true),
    isApproved: token => {
      const state = closePreparations.get(window);
      return Boolean(state?.approved && state.token === token && state.frame === window.webContents.mainFrame);
    },
    cancel: token => {
      const state = closePreparations.get(window);
      if (state?.token === token) cancelClosePreparation(window, 'failed', state);
    },
    cancelPending: () => cancelClosePreparation(window, 'failed')
  };
  Object.defineProperty(window, closeCoordinatorKey, { value: coordinator });
  // A NextMux window only ever shows the app's own pages (files) or its small built-in pages (data:). Web pages
  // open in the in-app browser (a webview) or the system browser, never as a window with the desktop bridge.
  window.webContents.on('will-navigate', navigation => {
    if (!/^file:/i.test(String(navigation?.url || ''))) navigation.preventDefault();
  });
  window.webContents.on('did-start-navigation', (details, legacyUrl, _inPlace, legacyMainFrame) => {
    const url = String(details?.url ?? legacyUrl ?? '');
    const mainFrame = typeof details?.isMainFrame === 'boolean' ? details.isMainFrame : legacyMainFrame;
    if (mainFrame && url && !/^(?:file|data|about|devtools|chrome-error):/i.test(url) && !window.isDestroyed()) {
      window.webContents.stop();
      window.destroy();
    }
  });
  let replayingCloseKey = false;
  window.webContents.on('before-input-event', (event, input) => {
    const mac = process.platform === 'darwin';
    // Only the plain shortcut: Ctrl+Alt+W / Ctrl+Shift+W belong to whatever has focus (audit A20-02).
    const closeKey = input.type === 'keyDown' && input.key.toLowerCase() === 'w' && !input.alt && !input.shift
      && (mac ? input.meta && !input.control : input.control && !input.meta);
    if (!closeKey) return;
    if (replayingCloseKey) { replayingCloseKey = false; return; }
    event.preventDefault();
    // ⌘W closes what is in front first (a full-screen player, an enlarged picture), and only then the window.
    // The page answers within a moment; a page that cannot answer never keeps the window open. On Windows/Linux a
    // focused terminal keeps Ctrl+W (delete word), so the key is handed back to it unchanged.
    closeTopLayerOrWindow(window, mac ? undefined : () => {
      if (window.isDestroyed()) return;
      replayingCloseKey = true;
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers: ['control'] });
    });
  });
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== 'persist:nextmux-browser' || !safeBrowserUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });
  window.on('close', event => {
    if (coordinator.managed || !takesPartInCloseHandshake(window)) return;
    const existing = closePreparations.get(window);
    if (existing?.approved) {
      if (existing.consumed) { event.preventDefault(); return; }
      // Keep the consumed nonce until this close either finishes or is clearly
      // vetoed. A consumed receipt cannot approve another close, and a veto
      // must also release the renderer's saved/frozen state.
      existing.consumed = true;
      queueMicrotask(() => {
        if (event.defaultPrevented) cancelClosePreparation(window, 'failed', existing);
      });
      return;
    }
    event.preventDefault();
    if (existing) return;
    // Silence is not proof of an empty or saved document. Leave the window and
    // any in-memory content intact; only a fresh user close creates another nonce.
    void offerClosePreparation(window);
  });
  window.webContents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
    const mainFrame = typeof details?.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
    const sameDocument = typeof details?.isSameDocument === 'boolean' ? details.isSameDocument : isInPlace;
    if (mainFrame && !sameDocument) cancelClosePreparation(window, 'navigated');
  });
  window.webContents.on('render-process-gone', () => cancelClosePreparation(window, 'navigated'));
  window.webContents.on('will-prevent-unload', event => {
    const state = closePreparations.get(window);
    if (!state?.consumed) return;
    queueMicrotask(() => {
      // Electron inverts this event: preventDefault ignores the page's veto.
      // Wait for the other synchronous listeners before deciding it was blocked.
      if (!event.defaultPrevented) cancelClosePreparation(window, 'failed', state);
    });
  });
  window.webContents.once('destroyed', () => cancelClosePreparation(window));
  window.once('closed', () => cancelClosePreparation(window));
  window.on('app-command', (commandEvent, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return;
    commandEvent.preventDefault();
    window.webContents.send('nextmux:navigation-command', command === 'browser-backward' ? 'back' : 'forward');
  });
});

app.on('window-all-closed', () => {
  // Closing the workbench is reversible; use the tray menu's Quit action to
  // terminate the background process and its pending recovery jobs.
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  const blockUnsafeNavigation = (event, url) => {
    if (!safeBrowserUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', blockUnsafeNavigation);
  contents.on('will-redirect', blockUnsafeNavigation);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

module.exports = { checkForUpdates, getUpdateState: publicState, trustedMainFrame };
