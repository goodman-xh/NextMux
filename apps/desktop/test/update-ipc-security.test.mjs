import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'nextmux-updater-tests-'));
let fixtureNumber = 0;
test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function manifest(version, platform, arch) {
  const file = platform === 'win32' ? `NextMux-${version}-${arch}-setup.exe` : `NextMux-${version}-${arch}.zip`;
  return `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: ${createHash('sha512').update('artifact').digest('base64')}\n    size: 8\npath: ${file}\n`;
}

function targetResponse(version, platform, arch, options = {}) {
  const releasePlatform = platform === 'darwin' ? 'macos' : 'windows';
  const channel = options.channel || 'latest';
  const source = options.manifest || manifest(version, platform, arch);
  const artifact = {
    fileName: platform === 'win32' ? `NextMux-${version}-${arch}-setup.exe` : `NextMux-${version}-${arch}.zip`,
    sha512: createHash('sha512').update('artifact').digest('base64'), size: 8,
  };
  const evidenceSource = JSON.stringify({
    schemaVersion: 1, version, platform: releasePlatform, arch, channel, commit: 'a'.repeat(40),
    generatedAt: '2026-09-06T00:00:00.000Z',
    manifest: { fileName: `${channel}${releasePlatform === 'macos' ? '-mac' : ''}.yml`,
      size: Buffer.byteLength(source), sha512: createHash('sha512').update(source).digest('base64') },
    artifact: { ...artifact, sha256: createHash('sha256').update('artifact').digest('hex') },
    nativeSignature: { status: 'verified', kind: platform === 'win32' ? 'authenticode' : 'developer-id-notarized',
      evidenceSha256: createHash('sha256').update('signing report').digest('hex') },
  });
  return {
    source, evidenceSource,
    payload: {
      ok: true, platform: releasePlatform, arch, channel,
      target: {
        schemaVersion: 1, platform: releasePlatform, arch, channel, version,
        revision: options.revision || 1,
        downgradeFrom: options.downgradeFrom || [],
        manifestSha512: options.manifestSha512 || createHash('sha512').update(source).digest('base64'),
        manifestName: `${channel}${releasePlatform === 'macos' ? '-mac' : ''}.yml`,
        feedPath: `/updates/releases/v${version}/${releasePlatform}/${arch}`,
        integrity: 'sha512', platformSignatureRequired: true,
        artifact,
        evidence: { fileName: 'release-attestation.json', sha512: createHash('sha512').update(evidenceSource).digest('base64'),
          signatureKind: platform === 'win32' ? 'authenticode' : 'developer-id-notarized', commit: 'a'.repeat(40) },
      },
    },
  };
}

// Execute the complete production module; only Electron and the updater are
// substitutes. No native windows, installs, timers, network or user data.
function fixture(platform = 'darwin', arch = 'arm64', options = {}) {
  const handlers = new Map(), windows = [], immediate = [], downloads = [], timers = new Set();
  const userData = path.join(fixtureRoot, String(++fixtureNumber));
  if (options.floor) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'nextmux-update-target-v1.json'), JSON.stringify(options.floor));
  }
  const updateVersion = options.updateVersion || '1.2.5';
  const effectiveTarget = options.target === undefined ? targetResponse(updateVersion, platform, arch) : options.target;
  const updateFiles = options.updateFiles || (effectiveTarget?.payload?.target ? [{
    url: effectiveTarget.payload.target.artifact.fileName,
    sha512: effectiveTarget.payload.target.artifact.sha512,
    size: effectiveTarget.payload.target.artifact.size,
  }] : undefined);
  const calls = { checks: 0, downloads: 0, installs: 0, quits: 0, microphoneStatus: 0, microphonePermission: 0,
    settings: [], feeds: [], fetches: [], trashed: [] };
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setAppUserModelId() {}, getVersion: () => options.currentVersion || '1.2.4', getPath: () => userData, isPackaged: true,
    whenReady: () => new Promise(() => {}),
    quit: () => { calls.quits++; },
  });
  const nativeUpdater = new EventEmitter();
  const autoUpdater = Object.assign(new EventEmitter(), {
    setFeedURL(value) { calls.feeds.push(value); },
    checkForUpdates: async () => { calls.checks++; autoUpdater.emit('checking-for-update');
      if (options.noUpdate) { autoUpdater.emit('update-not-available', { version: options.currentVersion || '1.2.4' }); return null; }
      autoUpdater.emit('update-available', { version: updateVersion, ...(updateFiles ? { files: updateFiles } : {}) });
      return { updateInfo: { version: updateVersion } }; },
    downloadUpdate: () => { calls.downloads++; return new Promise((resolve, reject) => downloads.push({ resolve, reject })); },
    quitAndInstall: () => { calls.installs++; },
  });
  const BrowserWindow = {
    getAllWindows: () => windows,
    fromWebContents: contents => windows.find(window => window.webContents === contents),
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, URL,
    process: { platform, arch, env: {} },
    require(name) {
      if (name === 'electron') return { app, BrowserWindow, autoUpdater: nativeUpdater, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        net: { fetch: async url => {
          calls.fetches.push(url);
          if (!effectiveTarget) return { status: options.targetStatus || 404, headers: { get: () => null }, text: async () => '' };
          if (url.includes('/api/releases/target?')) return { status: options.targetStatus || 200, headers: { get: () => null },
            text: async () => JSON.stringify(effectiveTarget.payload) };
          if (url.endsWith('/release-attestation.json')) return { status: options.evidenceStatus || 200, headers: { get: () => null },
            text: async () => effectiveTarget.evidenceSource };
          return { status: options.manifestStatus || 200, headers: { get: () => null }, text: async () => effectiveTarget.source };
        } },
        Notification: class { constructor() { throw new Error('No native update notification'); } }, session: {},
        shell: { openExternal: async url => { calls.settings.push(url); }, trashItem: async item => { calls.trashed.push(item); } },
        systemPreferences: { getMediaAccessStatus: () => { calls.microphoneStatus++; return 'not-determined'; },
          askForMediaAccess: async () => { calls.microphonePermission++; return true; } } };
      if (name === 'electron-updater') return { autoUpdater };
      if (name === './native-dictation.cjs') return { registerNativeDictation: options =>
        createRequire(import.meta.url)('../native-dictation.cjs').registerNativeDictation({ ...options, platform, resourcesPath: '/fixture', exists: () => false }) };
      if (name === 'node:path') return path;
      if (name === 'node:os') return { release: () => 'fixture' };
      if (name === 'node:crypto') return { createHash, randomUUID };
      if (name === 'node:fs') return createRequire(import.meta.url)('node:fs');
      throw new Error(`Unexpected dependency: ${name}`);
    },
    setImmediate: callback => immediate.push(callback),
    setTimeout(callback) { const timer = { callback, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval() { throw new Error('No timer in this fixture'); },
  }, { filename: 'actual-updater.cjs' });
  function sender(url = 'file:///fixture/index.html', owned = true) {
    const contents = { mainFrame: {}, getURL: () => url, isDestroyed: () => false, send() {} };
    if (owned) windows.push({ webContents: contents, isDestroyed: () => false });
    return contents;
  }
  const event = contents => ({ sender: contents, senderFrame: contents.mainFrame });
  const invoke = (name, event) => handlers.get(`nextmux:update:${name}`)(event);
  async function begin() {
    const owned = event(sender());
    await invoke('check', owned);
    assert.equal(invoke('download', owned), true);
    await flush();
    return owned;
  }
  return { autoUpdater, nativeUpdater, calls, immediate, windows, sender, event, downloads, timers, begin, invoke,
    app, setLocale: (event, locale) => handlers.get('nextmux:app:locale')(event, locale),
    microphone: (name, event) => handlers.get(`nextmux:microphone:${name}`)(event),
    trash: (event, value) => handlers.get('nextmux:path:trash')(event, value),
    ready: async () => { await begin(); autoUpdater.emit('update-downloaded', { version: updateVersion });
      nativeUpdater.emit('update-downloaded'); downloads.at(-1).resolve([]); await flush(); },
    state: () => module.exports.getUpdateState(),
    snapshot: () => JSON.stringify(module.exports.getUpdateState()),
  };
}
async function flush() { for (let n = 0; n < 10; n++) await Promise.resolve(); }

test('microphone permission/settings IPC reject missing, child, unowned and external frames before any OS effect', async () => {
  const f = fixture();
  const owned = f.sender();
  for (const event of [undefined, {}, { sender: owned }, { sender: owned, senderFrame: {} }, f.event(f.sender('https://untrusted.invalid/index.html')),
    f.event(f.sender('file:///fixture/index.html', false))]) {
    assert.equal(await f.microphone('settings', event), false);
    assert.equal(await f.microphone('status', event), undefined);
    assert.equal(await f.microphone('permission', event), undefined);
  }
  assert.equal(f.calls.microphoneStatus, 0); assert.equal(f.calls.microphonePermission, 0); assert.deepEqual(f.calls.settings, []);
});

for (const platform of ['darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
  test(`owned main frame retains explicit microphone permission/settings on ${platform}/${arch}`, async () => {
    const f = fixture(platform, arch), event = f.event(f.sender());
    const initial = await f.microphone('status', event); assert.equal(initial.platform, platform); assert.equal(initial.arch, arch);
    const requested = await f.microphone('permission', event);
    assert.equal(requested.requested, platform === 'darwin'); assert.equal(f.calls.microphonePermission, platform === 'darwin' ? 1 : 0);
    assert.equal(await f.microphone('settings', event), true);
    assert.deepEqual(f.calls.settings, [platform === 'darwin' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' : 'ms-settings:privacy-microphone']);
  });
}

test('Trash accepts a free canvas folder only while its registry marks it as being deleted', async () => {
  const f = fixture(), event = f.event(f.sender());
  const project = mkdtempSync(path.join(fixtureRoot, 'project-'));
  const canvasId = 'canvas-0f4c2a8e-1b2d-4e5f-8a9b-0c1d2e3f4a5b', folder = path.join(project, 'nextmux.canvases', canvasId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'nextmux.canvas.json'), '{}');
  const registry = deletionPending => writeFileSync(path.join(project, 'nextmux.canvases.json'), JSON.stringify({ schemaVersion: 1, canvases: [
    { id: 'canvas-main', kind: 'main' }, { id: canvasId, kind: 'free', deletionPending }] }));
  registry(true);
  assert.equal(await f.trash(event, folder), false, 'not inside a comic project');
  writeFileSync(path.join(project, 'nextmux.comic.json'), JSON.stringify({ projectKind: 'comic' }));
  registry(false);
  assert.equal(await f.trash(event, folder), false, 'deletion not prepared');
  registry(true);
  assert.equal(await f.trash(f.event(f.sender('https://untrusted.invalid/index.html')), folder), false);
  assert.equal(await f.trash(event, path.join(project, 'nextmux.canvases')), false);
  assert.equal(await f.trash(event, folder), true);
  assert.deepEqual(f.calls.trashed, [realpathSync(folder)]);
});

test('ordinary update feeds cannot authorize downgrades', () => {
  const f = fixture();
  assert.equal(f.autoUpdater.allowDowngrade, false);
  assert.equal(f.autoUpdater.autoDownload, false);
  assert.equal(f.autoUpdater.autoRunAppAfterInstall, false);
  assert.equal(f.autoUpdater.autoInstallOnAppQuit, true);
});

test('an administrator target can authorize one exact signed rollback scope', async () => {
  const target = targetResponse('1.2.3', 'darwin', 'arm64', { revision: 9, downgradeFrom: ['1.2.4'] });
  const f = fixture('darwin', 'arm64', { target, updateVersion: '1.2.3' });
  const event = f.event(f.sender());
  const state = await f.invoke('check', event);
  assert.equal(state.phase, 'available');
  assert.equal(state.version, '1.2.3');
  assert.equal(state.updateDirection, 'downgrade');
  assert.equal(state.targetRevision, 9);
  assert.equal(state.rollbackAuthorized, true);
  assert.equal(f.autoUpdater.allowDowngrade, true);
  assert.equal(f.calls.feeds.at(-1).provider, 'generic');
  assert.equal(f.calls.feeds.at(-1).url, 'https://nextmux.app/updates/releases/v1.2.3/macos/arm64');
  assert.equal(f.calls.feeds.at(-1).channel, 'latest');
  assert.equal(f.invoke('download', event), true);
  await flush();
  assert.equal(f.calls.downloads, 1);
  f.downloads[0].reject(new Error('synthetic failure'));
  await flush();
});

test('an administrator target can move an installed prerelease onto a stable channel', async () => {
  const target = targetResponse('1.2.5', 'darwin', 'arm64', { revision: 10, channel: 'latest' });
  const f = fixture('darwin', 'arm64', { currentVersion: '1.2.4-alpha.5', target, updateVersion: '1.2.5' });
  const state = await f.invoke('check', f.event(f.sender()));
  assert.equal(state.phase, 'available');
  assert.equal(state.version, '1.2.5');
  assert.equal(f.calls.feeds.at(-1).channel, 'latest');
  assert.equal(f.calls.fetches.some(url => url.endsWith('/latest-mac.yml')), true);
  const floor = JSON.parse(readFileSync(path.join(fixtureRoot, String(fixtureNumber), 'nextmux-update-target-v1.json'), 'utf8'));
  assert.equal(floor.channel, 'latest');
});

test('a prerelease client follows the exact alpha archive selected by the four-target pointer', async () => {
  const currentVersion = '0.1.0-alpha.5', version = '0.1.0-alpha.4';
  const target = targetResponse(version, 'win32', 'arm64', { channel: 'alpha', revision: 12, downgradeFrom: [currentVersion] });
  const f = fixture('win32', 'arm64', { currentVersion, updateVersion: version, target });
  const state = await f.invoke('check', f.event(f.sender()));
  assert.equal(state.phase, 'available');
  assert.equal(state.updateDirection, 'downgrade');
  assert.equal(f.autoUpdater.channel, 'alpha');
  assert.equal(f.calls.feeds.at(-1).url, 'https://nextmux.app/updates/releases/v0.1.0-alpha.4/windows/arm64');
});

test('older versions are rejected without exact administrator authorization', async () => {
  for (const target of [false, targetResponse('1.2.3', 'darwin', 'arm64')]) {
    const f = fixture('darwin', 'arm64', { target, updateVersion: '1.2.3' });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'error');
    assert.equal(state.errorCode, target ? 'UPDATE_DOWNGRADE_NOT_AUTHORIZED' : 'UPDATE_TARGET_UNAVAILABLE');
    assert.equal(f.autoUpdater.allowDowngrade, false);
    assert.equal(f.calls.downloads, 0);
  }
});

test('packaged clients do not bypass a missing or failed release target through the live feed', async () => {
  for (const targetStatus of [404, 503]) {
    const f = fixture('win32', 'x64', { target: false, targetStatus });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'error');
    assert.equal(state.errorCode, 'UPDATE_TARGET_UNAVAILABLE');
    assert.equal(f.calls.checks, 0);
  }
  const empty = targetResponse('1.2.5', 'win32', 'x64');
  empty.payload.target = null;
  const f = fixture('win32', 'x64', { target: empty });
  const state = await f.invoke('check', f.event(f.sender()));
  assert.equal(state.phase, 'current');
  assert.equal(f.calls.checks, 0);
});

test('an unmet administrator target cannot be reported as the current version', async () => {
  const f = fixture('darwin', 'x64', { target: targetResponse('1.2.5', 'darwin', 'x64'), noUpdate: true });
  const state = await f.invoke('check', f.event(f.sender()));
  assert.equal(state.phase, 'error');
  assert.equal(state.errorCode, 'UPDATE_TARGET_NOT_AVAILABLE');
});

test('a release target is bound to OS, architecture, manifest digest and updater result', async () => {
  const cases = [];
  const wrongScope = targetResponse('1.2.5', 'darwin', 'arm64');
  wrongScope.payload.arch = 'x64';
  cases.push([wrongScope, '1.2.5', 'UPDATE_TARGET_SCOPE_MISMATCH']);
  const wrongDigest = targetResponse('1.2.5', 'darwin', 'arm64');
  wrongDigest.payload.target.manifestSha512 = createHash('sha512').update('different').digest('base64');
  cases.push([wrongDigest, '1.2.5', 'UPDATE_TARGET_MANIFEST_MISMATCH']);
  cases.push([targetResponse('1.2.5', 'darwin', 'arm64'), '1.2.6', 'UPDATE_TARGET_VERSION_MISMATCH']);
  for (const [target, updateVersion, errorCode] of cases) {
    const f = fixture('darwin', 'arm64', { target, updateVersion });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'error');
    assert.equal(state.errorCode, errorCode);
    assert.equal(f.calls.downloads, 0);
  }
});

test('tampered signing evidence and ambiguous updater artifacts fail closed', async () => {
  const tamperedEvidence = targetResponse('1.2.5', 'darwin', 'arm64');
  tamperedEvidence.evidenceSource = tamperedEvidence.evidenceSource.replace('"verified"', '"forged"');
  const ambiguous = targetResponse('1.2.5', 'win32', 'x64');
  const expected = ambiguous.payload.target.artifact;
  for (const [platform, arch, target, options, errorCode] of [
    ['darwin', 'arm64', tamperedEvidence, {}, 'UPDATE_TARGET_EVIDENCE_MISMATCH'],
    ['win32', 'x64', ambiguous, { updateFiles: [
      { url: 'Evil-x64.exe', sha512: expected.sha512, size: expected.size }, expected,
    ] }, 'UPDATE_TARGET_ARTIFACT_MISMATCH'],
  ]) {
    const f = fixture(platform, arch, { target, ...options });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'error');
    assert.equal(state.errorCode, errorCode);
    assert.equal(f.calls.downloads, 0);
  }
});

test('a previously observed target revision cannot be replayed or changed in place', async () => {
  const target = targetResponse('1.2.5', 'win32', 'x64', { revision: 9 });
  const baseFloor = { schemaVersion: 1, platform: 'windows', arch: 'x64', channel: 'latest',
    revision: 10, version: '1.2.5', manifestSha512: target.payload.target.manifestSha512 };
  for (const floor of [baseFloor, { ...baseFloor, revision: 9, version: '1.2.6' }]) {
    const f = fixture('win32', 'x64', { target, floor });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'error');
    assert.equal(state.errorCode, 'UPDATE_TARGET_REPLAYED');
    assert.equal(f.calls.checks, 0);
  }
});

for (const [platform, releasePlatform] of [['win32', 'windows'], ['darwin', 'macos']]) for (const arch of ['x64', 'arm64']) {
  test(`administrator targets pin the immutable ${releasePlatform}/${arch} archive`, async () => {
    const target = targetResponse('1.2.5', platform, arch, { revision: 7 });
    const f = fixture(platform, arch, { target });
    const state = await f.invoke('check', f.event(f.sender()));
    assert.equal(state.phase, 'available');
    assert.equal(state.updateDirection, 'upgrade');
    assert.equal(f.autoUpdater.allowDowngrade, false);
    assert.equal(f.calls.feeds.at(-1).url, `https://nextmux.app/updates/releases/v1.2.5/${releasePlatform}/${arch}`);
  });
}

for (const url of ['file:///fixture/index.html']) {
  test(`owned application main frame retains get/check/ready-install access: ${url}`, async () => {
    const f = fixture(), event = f.event(f.sender(url));
    assert.equal(f.invoke('get', event).currentVersion, '1.2.4');
    assert.equal(await f.invoke('install', event), false, 'an authorized frame still cannot install before ready');
    assert.equal((await f.invoke('check', event)).currentVersion, '1.2.4');
    assert.equal(f.calls.checks, 1);
    await f.ready();
    assert.equal(f.invoke('install', event), true);
    assert.equal(f.calls.installs, 0, 'installation is deferred, not synchronous');
    assert.equal(f.immediate.length, 1);
    f.immediate.shift()();
    assert.equal(f.calls.installs, 0, 'never start installation before the normal quit/save handshake');
    assert.equal(f.calls.quits, 1);
  });
}

const rejectedEvents = {
  'missing event': () => undefined,
  'missing sender': () => ({ senderFrame: {} }),
  'missing senderFrame': f => ({ sender: f.sender() }),
  'missing both frame identities': f => { const sender = f.sender(); delete sender.mainFrame; return { sender }; },
  'null frame identities': f => { const sender = f.sender(); sender.mainFrame = null; return { sender, senderFrame: null }; },
  'child frame': f => ({ sender: f.sender(), senderFrame: {} }),
  'external main frame': f => f.event(f.sender('https://example.com/')),
  'loopback hostname lookalike': f => f.event(f.sender('https://localhost.example.com/')),
  'non-HTTP loopback frame': f => f.event(f.sender('ftp://localhost/index.html')),
  'unowned file webContents': f => f.event(f.sender('file:///fixture/index.html', false)),
  'unowned loopback webContents': f => f.event(f.sender('http://localhost:3000/', false)),
  // Another server on this computer is not the app, even with the app page's path (audit A22-01).
  'owned localhost page': f => f.event(f.sender('http://localhost:3000/index.html')),
  'owned 127.0.0.1 page': f => f.event(f.sender('http://127.0.0.1:54321/lib/frontend/secondary-window.html')),
  'owned [::1] page': f => f.event(f.sender('http://[::1]:3000/index.html')),
  'destroyed window': f => { const sender = f.sender(); f.windows[0].isDestroyed = () => true; return f.event(sender); },
  'destroyed webContents': f => { const sender = f.sender(); sender.isDestroyed = () => true; return f.event(sender); },
  'unreadable URL': f => { const sender = f.sender(); sender.getURL = () => { throw new Error('detached'); }; return f.event(sender); },
  'stale frame after navigation': f => { const sender = f.sender(), event = f.event(sender); sender.mainFrame = {}; return event; },
};
for (const [name, createEvent] of Object.entries(rejectedEvents)) {
  test(`get/check/install reject ${name} without effects`, async () => {
    const f = fixture(), event = createEvent(f);
    await f.ready();
    const before = f.snapshot();
    const beforeCalls = { ...f.calls };
    for (const operation of ['get', 'check', 'download', 'install']) assert.equal(await f.invoke(operation, event), false, operation);
    assert.equal(f.snapshot(), before, 'untrusted IPC cannot change update state');
    assert.deepEqual(f.calls, beforeCalls);
    assert.equal(f.immediate.length, 0, 'untrusted IPC cannot schedule installation');
  });
}

test('checking publishes available without a download; one explicit click starts one shared flight', async () => {
  const f = fixture(), event = f.event(f.sender());
  assert.equal(f.invoke('download', event), false);
  const first = f.invoke('check', event), second = f.invoke('check', event);
  await Promise.all([first, second]);
  assert.equal(f.calls.checks, 1);
  assert.equal(f.calls.downloads, 0);
  assert.equal(f.state().phase, 'available');
  assert.equal(f.invoke('download', event), true);
  assert.equal(f.invoke('download', event), true);
  await flush();
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.state().phase, 'downloading');
  assert.equal(f.calls.quits, 0);
  f.downloads[0].reject(new Error('synthetic failure')); await flush();
});

test('progress uses real bounded samples and checks cannot erase a pending download', async () => {
  const f = fixture(), event = await f.begin();
  f.autoUpdater.emit('download-progress', { percent: 49.9, transferred: 499, total: 1000 });
  assert.equal(f.state().progress, 49);
  assert.equal(f.state().transferred, 499);
  assert.equal(f.state().total, 1000);
  const before = f.snapshot();
  await f.invoke('check', event);
  f.autoUpdater.emit('checking-for-update');
  f.autoUpdater.emit('update-not-available', { version: '1.2.4' });
  f.autoUpdater.emit('update-available', { version: '9.9.9' });
  assert.equal(f.snapshot(), before);
  assert.equal(f.calls.checks, 1);
  f.autoUpdater.emit('download-progress', { percent: Infinity, transferred: NaN, total: -1 });
  assert.equal(f.state().progress, 0); assert.equal(f.state().transferred, 0); assert.equal(f.state().total, 0);
  f.downloads[0].reject(new Error('synthetic failure')); await flush();
});

test('download failure never retries itself; an explicit retry uses a new single flight', async () => {
  const f = fixture(), event = await f.begin();
  f.autoUpdater.emit('error', { code: 'DOWNLOAD_CONNECTION_FAILED' });
  f.downloads[0].reject(new Error('private diagnostic must not enter the UI')); await flush();
  assert.equal(f.state().phase, 'available');
  assert.ok(f.state().errorCode);
  assert.doesNotMatch(f.snapshot(), /private diagnostic/);
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.invoke('download', event), true); assert.equal(f.invoke('download', event), true); await flush();
  assert.equal(f.calls.downloads, 2);
  assert.equal(f.state().progress, 0); assert.equal(f.state().errorCode, undefined);
  f.downloads[1].reject(new Error('synthetic failure')); await flush();
});

test('Mac waits for native staging, not just its earlier ZIP-downloaded event', async () => {
  const f = fixture(), event = await f.begin();
  f.autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  assert.equal(f.state().preparing, false, 'a mismatched artifact cannot mark the approved download ready');
  f.autoUpdater.emit('update-downloaded', { version: '1.2.5' });
  f.downloads[0].resolve([]); await flush();
  assert.equal(f.state().phase, 'downloading'); assert.equal(f.state().progress, 100); assert.equal(f.state().preparing, true);
  assert.equal(f.timers.size, 1);
  assert.equal(f.invoke('install', event), false);
  await f.invoke('check', event); assert.equal(f.calls.checks, 1);
  assert.equal(f.invoke('download', event), true); assert.equal(f.calls.downloads, 1);
  f.nativeUpdater.emit('update-downloaded');
  assert.equal(f.state().phase, 'ready'); assert.equal(f.state().preparing, false); assert.equal(f.timers.size, 0);
  assert.equal(f.calls.quits, 0); assert.equal(f.calls.installs, 0);
});

test('Windows is ready on its verified download event without waiting for a Mac native event', async () => {
  const f = fixture('win32'); await f.begin();
  f.autoUpdater.emit('update-downloaded', { version: '1.2.5' });
  assert.equal(f.state().phase, 'ready'); assert.equal(f.timers.size, 0);
  f.downloads[0].resolve([]); await flush();
  assert.equal(f.calls.quits, 0); assert.equal(f.calls.installs, 0);
});

test('ready is stable across automatic checks, delayed progress, failures and duplicate native events', async () => {
  const f = fixture(); await f.ready(); const before = f.snapshot(), checks = f.calls.checks;
  await f.invoke('check', f.event(f.sender()));
  f.autoUpdater.emit('checking-for-update');
  f.autoUpdater.emit('update-not-available', { version: '1.2.4' });
  f.autoUpdater.emit('update-available', { version: '9.9.9' });
  f.autoUpdater.emit('download-progress', { percent: 20 });
  f.autoUpdater.emit('error', new Error('late'));
  f.nativeUpdater.emit('update-downloaded');
  assert.equal(f.snapshot(), before); assert.equal(f.calls.checks, checks);
});

test('Mac preparation times out visibly and late progress cannot pretend preparation succeeded', async () => {
  const f = fixture(); const event = await f.begin();
  f.autoUpdater.emit('update-downloaded', { version: '1.2.5' });
  f.downloads[0].resolve([]); await flush();
  [...f.timers][0].callback();
  assert.equal(f.state().phase, 'error'); assert.equal(f.state().restartRequired, true); assert.equal(f.state().errorCode, 'UPDATE_PREPARATION_TIMEOUT');
  const before = f.snapshot();
  f.autoUpdater.emit('download-progress', { percent: 100 }); f.nativeUpdater.emit('update-downloaded');
  assert.equal(f.invoke('download', event), false); await f.invoke('check', event);
  assert.equal(f.snapshot(), before); assert.equal(f.calls.downloads, 1);
});

test('a download resolving without its verified completion is not reported ready', async () => {
  const f = fixture('win32'); await f.begin(); f.downloads[0].resolve([]); await flush();
  assert.equal(f.state().phase, 'available'); assert.equal(f.state().errorCode, 'UPDATE_NOT_PREPARED');
  assert.equal(f.calls.quits, 0);
});

test('the installed updater quit hook installs silently only after a successful normal quit', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const installed = readFileSync(require.resolve('electron-updater/out/BaseUpdater'), 'utf8');
  const method = installed.match(/^    addQuitHandler\(\) \{[\s\S]*?^    \}/m)?.[0];
  assert.ok(method, 'exercise the installed SDK hook, not a rewritten approximation');
  let onQuit; const installs = [];
  const updater = Object.assign(Function(`return ({${method}})`)(), {
    autoInstallOnAppQuit: true, quitHandlerAdded: false, quitAndInstallCalled: false,
    app: { onQuit: callback => { onQuit = callback; } }, _logger: { info() {} },
    install: (...args) => installs.push(args),
  });
  updater.addQuitHandler();
  assert.equal(installs.length, 0, 'preparation or a vetoed close does not fire the quit hook');
  onQuit(1); assert.equal(installs.length, 0);
  onQuit(0); assert.deepEqual(installs, [[true, false]], 'silent installation never forces an application restart');
});


test('native app locale accepts only a trusted renderer and a supported app language', () => {
  const f = fixture();
  const key = Symbol.for('nextmux.desktop.app-locale.v1');
  let changes = 0;
  f.app.on('nextmux-locale-changed', () => changes++);
  const owned = f.event(f.sender());
  assert.equal(f.setLocale(owned, 'zh-TW'), true);
  assert.equal(f.app[key], 'zh-TW');
  assert.equal(changes, 1);
  assert.equal(f.setLocale(owned, 'zh-TW'), true);
  assert.equal(changes, 1, 'unchanged locale does not rebuild native surfaces');
  assert.equal(f.setLocale(f.event(f.sender('https://untrusted.example', false)), 'ja'), false);
  assert.equal(f.setLocale(owned, 'xx'), false);
  assert.equal(f.app[key], 'zh-TW');
  assert.equal(f.setLocale(owned, 'ja'), true);
  assert.equal(f.app[key], 'ja');
});
