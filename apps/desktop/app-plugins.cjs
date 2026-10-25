'use strict';

const diagnostic = (code, path = '', params = {}) => ({ code, path, params });
const errorDiagnostics = error => error.diagnostics || [error.diagnostic || diagnostic(error.code || 'plugin.invalid')];
const pluginFileLabels = {"en": "NextMux plugin", "zh-CN": "NextMux 插件", "zh-TW": "NextMux 外掛", "ja": "NextMux プラグイン", "ko": "NextMux 플러그인", "es": "Plugin de NextMux", "fr": "Plugin NextMux", "de": "NextMux-Plugin", "pt-BR": "Plugin NextMux", "ru": "Плагин NextMux", "ar": "إضافة NextMux", "hi": "NextMux प्लगइन"};

// Skill plugins (技能插件) in the main process: the installed plugins (userData/app-plugins) and the runs.
//
// A run drives one conversation tab's app window with one plugin: every tick it takes a picture of the window
// (computer-window-view.cjs → frame), reads the plugin's signals (app-plugin-core.cjs), fires a reflex or, on the
// decision cadence, asks the chosen decision model which action to take, and sends that action as real input to
// that window only. Decision models are called by the NextMux backend (it holds the keys and the platform
// credential): the request goes to the run's page, which forwards it and returns the answer here.
//
// Nothing a plugin contains is executed: plugins are JSON and PNG files (see app-plugin-core.cjs).

const { join, basename, dirname, isAbsolute, normalize } = require('node:path');
const { createRequire } = require('node:module');
// Packaged apps keep model-runtime beside this file; pnpm development resolves it through the extension.
// Resolution must stay lazy: a damaged optional plugin runtime must not prevent computer registration.
let decisionAdapter;
function loadDecisionAdapter() {
  if (decisionAdapter) return decisionAdapter;
  try { decisionAdapter = require('@nextmux/model-runtime/decision-adapter'); }
  catch {
    try { decisionAdapter = createRequire(require.resolve('@nextmux/theia-extension/package.json'))('@nextmux/model-runtime/decision-adapter'); }
    catch { return undefined; }
  }
  if (typeof decisionAdapter?.decisionPluginCompatibility !== 'function' || typeof decisionAdapter?.isTevDecisionModel !== 'function') {
    decisionAdapter = undefined;
  }
  return decisionAdapter;
}
const decisionPluginCompatibility = (model, decisions) => {
  const adapter = loadDecisionAdapter();
  return adapter ? adapter.decisionPluginCompatibility(model, decisions) : 'plugin_runtime_unavailable';
};
const platformKey = (key, platform) => key === 'primary' ? platform === 'darwin' ? 'cmd' : 'ctrl' : key === 'return' ? 'enter' : key;
const isTevDecisionModel = model => loadDecisionAdapter()?.isTevDecisionModel(model) === true;
const { readFile, writeFile, mkdir, rename, readdir, stat, lstat, rm } = require('node:fs/promises');
const { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, randomUUID, verify: verifySignature } = require('node:crypto');
const { execFile } = require('node:child_process');
const core = require('./app-plugin-core.cjs');
const zipAdapter = require('./app-plugin-zip.cjs');

const identifier = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const pluginId = value => typeof value === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9-]+$/.test(value) && value.length <= 100;
const PENDING_MS = 10 * 60_000;
const DECISION_MARGIN_MS = 2_000;
const MAX_REQUESTS = 1000;
const MAX_RUNS = 8;
const STATUS_EVERY_MS = 250;
const EVENT_REPEAT_MS = 30_000;
const GLOBAL_MAX_ACTIONS_PER_MINUTE = 600;

/** The model a plugin asks: the NextMux platform, the user's OpenRouter key, or a decision server on this computer. */
const MODEL_ID = /^[~A-Za-z0-9][\w.:/~@-]{0,159}$/;
const localOnly = value => {
  // Only this computer: a local model server never receives frames from elsewhere.
  let url;
  try { url = new URL(String(value || '')); } catch { return undefined; }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return undefined;
  return `${url.protocol}//${url.host}`;
};
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/** The backend has already classified/redacted this evidence; carry only its presentation fields over IPC. */
const modelFailureSnapshot = value => {
  if (!value || typeof value !== 'object' || !/^[a-z_]{1,64}$/.test(value.kind || '')) return undefined;
  const snapshot = { kind: value.kind, detail: text(value.detail, 16384) };
  for (const field of ['code', 'parameter', 'providerReason']) {
    if (typeof value[field] === 'string') snapshot[field] = text(value[field], field === 'providerReason' ? 600 : 200);
  }
  if (['own_api', 'relay', 'local'].includes(value.source)) snapshot.source = value.source;
  for (const field of ['httpStatus', 'retryAfterSeconds', 'retryCount', 'relaySwitchCount']) {
    if (Number.isSafeInteger(value[field]) && value[field] >= 0) snapshot[field] = Math.min(value[field], 86400);
  }
  return snapshot;
};

/**
 * A plugin's decision model: a relay merchant's model on the platform ("nextmux"), one of the user's own API
 * connections ("connection", by id — the key stays in the backend), or a server on this computer ("local": a
 * decision server, Ollama or an OpenAI-compatible chat server). Anything else (including the old "openrouter"
 * source) is dropped, and the plugin asks for a model again.
 */
function normalizeModel(value) {
  if (!value || typeof value !== 'object' || !['nextmux', 'connection', 'local'].includes(value.source)) return undefined;
  const model = typeof value.model === 'string' ? value.model.trim().slice(0, 160) : '';
  if (!MODEL_ID.test(model)) return undefined;
  const result = { source: value.source, model, images: value.source === 'local' && !isTevDecisionModel(model) && value.images === true };
  if (value.source === 'local') {
    result.endpoint = localOnly(value.endpoint);
    if (!result.endpoint) return undefined;
    result.protocol = ['systemone', 'ollama', 'openai'].includes(value.protocol) ? value.protocol : 'systemone';
  }
  if (value.source === 'connection') {
    if (typeof value.connectionId !== 'string' || !/^[\w-]{1,120}$/.test(value.connectionId)) return undefined;
    result.connectionId = value.connectionId;
    if (text(value.connectionLabel, 80)) result.connectionLabel = text(value.connectionLabel, 80);
  }
  if (value.source === 'nextmux' && typeof value.offeringId === 'string' && /^[\w-]{1,120}$/.test(value.offeringId)) {
    result.offeringId = value.offeringId;
    if (text(value.merchant, 80)) result.merchant = text(value.merchant, 80);
  }
  if (text(value.label, 120)) result.label = text(value.label, 120);
  for (const field of ['inputPricePerMillion', 'outputPricePerMillion', 'cachedInputPricePerMillion', 'cacheWritePricePerMillion']) {
    if (Number.isFinite(value[field]) && value[field] >= 0) result[field] = value[field];
  }
  return result;
}

function normalizeVision(value) {
  if (!value || typeof value !== 'object' || !['connection', 'local'].includes(value.source)) return undefined;
  const model = typeof value.model === 'string' ? value.model.trim().slice(0, 160) : '';
  if (!MODEL_ID.test(model)) return undefined;
  if (value.source === 'connection') {
    if (typeof value.connectionId !== 'string' || !/^[\w-]{1,120}$/.test(value.connectionId)) return undefined;
    const prices = {};
    for (const field of ['inputPricePerMillion', 'outputPricePerMillion', 'cachedInputPricePerMillion', 'cacheWritePricePerMillion']) {
      if (Number.isFinite(value[field]) && value[field] >= 0) prices[field] = value[field];
    }
    return { source: 'connection', model, connectionId: value.connectionId, ...prices, ...(text(value.connectionLabel, 80) ? { connectionLabel: text(value.connectionLabel, 80) } : {}) };
  }
  const endpoint = localOnly(value.endpoint);
  return endpoint ? { source: 'local', model, endpoint, protocol: value.protocol === 'ollama' ? 'ollama' : 'openai' } : undefined;
}

/** The app behind a window: its bundle id (macOS) or program name (Windows), to check a plugin is made for it. */
function appIdentity(pid, platform, windowId) {
  if (platform === 'win32') return require('./windows-apps.cjs').createWindowsApps().identify(pid, windowId).catch(() => ({}));
  return new Promise(resolve => {
    if (platform === 'darwin') {
      execFile('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 3000 }, (error, stdout) => {
        const path = String(stdout || '').trim();
        const bundle = /^(.*?\.app)\//.exec(path)?.[1];
        if (error || !bundle) { resolve({ program: basename(path) }); return; }
        execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')], { timeout: 3000 },
          (plistError, id) => resolve({ bundleId: plistError ? '' : String(id || '').trim(), program: basename(path) }));
      });
      return;
    }
    resolve({});
  });
}

const appName = value => String(value || '').trim().toLowerCase();
const executableName = value => appName(value).split(/[\\/]/).at(-1).replace(/\.(exe|app)$/i, '');

function appMatches(manifest, identity, title, platform, windowTitle) {
  const current = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : '';
  const ids = [identity.bundleId, identity.program, identity.appId, identity.aumid, identity.executablePath].map(appName).filter(Boolean);
  const titles = [title, windowTitle, identity.title, identity.windowTitle].map(appName).filter(Boolean);
  return manifest.apps.some(app => {
    if (app.platform !== current) return false;
    // Preserve the older RE2 title constraint, independently of the new literal title aliases.
    if (app.title && ![title, windowTitle, identity.title, identity.windowTitle].some(value => core.pluginPattern(app.title).test(String(value || '')))) return false;
    const program = executableName(app.program);
    const names = [app.bundleId, app.program].map(appName).filter(Boolean);
    if (ids.some(id => names.includes(id) || program && executableName(id) === program)) return true;
    if (current === 'windows' && program.length >= 2 && ids.some(id => !/[\\/]/.test(id) && /[!_]/.test(id) && id.split(/[!_]/, 1)[0].includes(program))) return true;
    const needles = [app.titleIncludes, app.name, program.length >= 2 ? program : ''].map(appName).filter(Boolean);
    return needles.some(needle => titles.some(value => value.includes(needle)));
  });
}

/** Windows' scoped driver supports taps; holds, modifiers and chords require explicit driver capabilities. */
function inputCompatibility(manifest, platform, capabilities = {}) {
  const errors = [];
  if (platform !== 'win32' && platform !== 'darwin') return ['computer_input_unsupported'];
  for (const [id, action] of Object.entries(manifest.actions)) for (const [index, step] of action.steps.entries()) {
    if ((step.move !== undefined || step.area !== undefined || step.fromDecision !== undefined) && capabilities.pointerMove !== true) errors.push(`${id}[${index}]: computer_pointer_move_unsupported`);
  }
  if (platform === 'win32') for (const [id, action] of Object.entries(manifest.actions)) {
    for (const [index, step] of action.steps.entries()) {
      const error = (step.keys?.length > 1 || step.modifiers?.length > 0) && capabilities.chords !== true ? 'computer_key_chord_unsupported'
        : /^(cmd|ctrl|alt|shift|primary)$/.test(step.key || '') && capabilities.modifierKeys !== true ? 'computer_modifier_key_unsupported'
          : step.holdMs > 0 && (step.key || step.keys) && capabilities.keyHold !== true ? 'computer_key_hold_unsupported' : '';
      if (error) errors.push(`${id}[${index}]: ${error}`);
    }
  }
  return errors;
}

// Paid marketplace plugins (付费插件) install and run only with a license the platform signed for the buyer:
// Ed25519 over "nextmux-app-plugin-license/1\n<plugin>\n<user>\n<issued>\n<expires>" with the same review key as
// package signatures (the private key exists only on the platform). A license lasts 7 days and is renewed online.
const PLUGIN_SIGNING_PUBLIC_KEY = 'vGC9odCEhI6f5eJWD/jsmNKN7Z9EF5Yi+HuIgdGy50I=';
const licenseOf = value => value && typeof value === 'object' && typeof value.userId === 'string' && typeof value.pluginId === 'string' && typeof value.signature === 'string'
  ? { userId: value.userId.slice(0, 120), pluginId: value.pluginId.slice(0, 100), issuedAt: Number(value.issuedAt) || 0, expiresAt: Number(value.expiresAt) || 0, signature: value.signature.slice(0, 200) } : undefined;
const licenseValid = (license, id, now = Date.now(), publicKey = PLUGIN_SIGNING_PUBLIC_KEY) => {
  try {
    if (!license || license.pluginId !== id || !(license.expiresAt > now) || !(license.issuedAt <= now + 300_000)) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
    return verifySignature(null, Buffer.from(`nextmux-app-plugin-license/1\n${license.pluginId}\n${license.userId}\n${license.issuedAt}\n${license.expiresAt}`, 'utf8'), key, Buffer.from(license.signature, 'base64'));
  } catch { return false; }
};

/**
 * A bought plugin is kept encrypted on disk (付费插件不可拷贝): its files are one AES-256-GCM blob, and the blob's key is
 * sealed with the operating system's keychain for this user on this computer (Electron safeStorage: macOS Keychain,
 * Windows DPAPI). A copy of the folder is unreadable on any other computer or account; the app decrypts it in memory.
 */
const SEALED_PACKAGE = 'package.nmxsealed';
const SEALED_KEY = 'package.key';
const sealFiles = (files, secure) => {
  const key = randomBytes(32), iv = randomBytes(12);
  const body = Buffer.from(JSON.stringify([...files].map(([name, data]) => [name, data.toString('base64')])), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(body), cipher.final()]);
  return { blob: Buffer.concat([Buffer.from('NMXS1'), iv, cipher.getAuthTag(), sealed]), key: secure.encryptString(key.toString('base64')) };
};
const openSealed = (blob, sealedKey, secure) => {
  if (blob.subarray(0, 5).toString() !== 'NMXS1') throw Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') });
  let key;
  try { key = Buffer.from(secure.decryptString(sealedKey), 'base64'); }
  catch { throw Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') }); }
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(5, 17));
  decipher.setAuthTag(blob.subarray(17, 33));
  const body = Buffer.concat([decipher.update(blob.subarray(33)), decipher.final()]);
  return new Map(JSON.parse(body.toString('utf8')).map(([name, data]) => [name, Buffer.from(data, 'base64')]));
};

/** The content fingerprint the marketplace records per version (same inputs and hashing as the platform). */
const fingerprintOf = (manifest, files) => {
  const inputs = core.contentFingerprintInputs(manifest, files);
  const sha = data => createHash('sha256').update(data).digest('hex');
  return { behavior: sha(Buffer.from(inputs.behavior, 'utf8')), images: inputs.images.length ? sha(Buffer.from(inputs.images.map(sha).sort().join('\n'), 'utf8')) : '' };
};

// Source and review are independent of a cryptographic verification result.
const trustOf = record => {
  const source = record?.dev ? 'development' : record?.fromMarket || record?.source === 'marketplace' ? 'marketplace' : 'local-file';
  const market = source === 'marketplace';
  return { source,
    reviewStatus: market ? ['approved', 'pending', 'rejected'].includes(record.reviewStatus) ? record.reviewStatus : 'approved' : 'unreviewed',
    signaturePresent: market && (record?.signaturePresent === true || record?.verified === true),
    signatureVerified: market && (record?.signatureVerified === true || record?.verified === true)
  };
};

/**
 * A PNG whose header claims a huge canvas is refused before native decoding:
 * the package byte limit does not bound the decoded bitmap.
 */
const PNG_MAX_SIDE = 4096;
const pngWithinDecodeLimit = bytes => !(Buffer.isBuffer(bytes) && bytes.length >= 24 && bytes.toString('latin1', 12, 16) === 'IHDR'
  && (bytes.readUInt32BE(16) > PNG_MAX_SIDE || bytes.readUInt32BE(20) > PNG_MAX_SIDE));
const pngClaimedPixels = bytes => Buffer.isBuffer(bytes) && bytes.length >= 24 && bytes.toString('latin1', 12, 16) === 'IHDR'
  ? bytes.readUInt32BE(16) * bytes.readUInt32BE(20) : 0;

/** One digest for a plugin's files: its trust marks belong to exactly these bytes. */
const contentDigest = files => {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) hash.update(`${name}\0${createHash('sha256').update(files.get(name)).digest('hex')}\n`);
  return hash.digest('hex');
};

const priced = model => !model || model.source === 'local' || model.source === 'nextmux'
  || Number.isFinite(model.inputPricePerMillion) && Number.isFinite(model.outputPricePerMillion);

/**
 * @param {{ ipcMain: any, app: any, shell: any, dialog: any, BrowserWindow: any, globalShortcut?: any, nativeImage: any,
 *   view: any, trusted: (event: any) => boolean, platform?: string,
 *   input: { keys: Function, pointer: Function } }} options
 */
function registerAppPlugins({ ipcMain, app, shell, dialog, BrowserWindow, globalShortcut, nativeImage, view, trusted, incognito, platform = process.platform, input, identify = appIdentity,
  secureStorage = (() => { try { return require('electron').safeStorage; } catch { return undefined; } })(), licensePublicKey = PLUGIN_SIGNING_PUBLIC_KEY }) {
  const secure = () => secureStorage && secureStorage.isEncryptionAvailable() ? secureStorage : undefined;
  const licensed = (license, id) => licenseValid(license, id, Date.now(), licensePublicKey);
  const root = join(app.getPath('userData'), 'app-plugins');
  const installedRoot = join(root, 'installed');
  const logsRoot = join(root, 'logs');
  const statePath = join(root, 'state.json');
  let state = { plugins: {} };
  let loaded;
  const pending = new Map();            // install token → { files, manifest, expires }
  const cache = new Map();              // plugin id → { manifest, templates, folder, files }
  const runs = new Map();               // run id → run
  const installing = new Set();
  const activeStaging = new Set();
  const decisions = new Map();          // request id → { resolve, timer }
  let shortcut = '';

  const load = () => loaded ??= (async () => {
    try { const value = JSON.parse(await readFile(statePath, 'utf8')); if (value?.plugins && typeof value.plugins === 'object' && !Array.isArray(value.plugins)) state = { plugins: value.plugins }; } catch { /* first use */ }
    // A model or vision choice this version can't use (an older source) is dropped: the plugin asks again.
    let migrated = false;
    for (const [id, record] of Object.entries(state.plugins)) {
      if (!pluginId(id) || !record || typeof record !== 'object' || Array.isArray(record)) { delete state.plugins[id]; migrated = true; continue; }
      if (record.enabled !== true) { record.enabled = true; migrated = true; }
      if (record.model) { const model = normalizeModel(record.model); if (model) record.model = model; else delete record.model; }
      if (record.vision) { const vision = normalizeVision(record.vision); if (vision) record.vision = vision; else delete record.vision; }
    }
    if (migrated) await save().catch(() => undefined);
  })();
  // Saves run one after another, each from a fresh snapshot and its own temporary file: two installs saving at
  // once no longer rename the same temporary away from each other (audit B16-05).
  let saving = Promise.resolve();
  const save = () => {
    const next = saving.catch(() => undefined).then(async () => {
      await mkdir(root, { recursive: true });
      const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(temporary, statePath);
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    saving = next;
    return next;
  };

  /** Every file of a plugin folder (the same names and limits as a package). */
  const readFolder = async folder => {
    const folderInfo = await lstat(folder);
    if (folderInfo.isSymbolicLink() || !folderInfo.isDirectory()) throw Object.assign(new Error('package_path'), { code: 'package_path' });
    // A bought plugin's sealed package opens only with this computer's keychain (a copied folder stays locked).
    const readSealedFile = async (name, maxBytes) => {
      const filename = join(folder, name);
      const info = await lstat(filename).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (!info) return undefined;
      if (info.isSymbolicLink() || !info.isFile()) throw Object.assign(new Error('package_link'), { code: 'package_link' });
      if (info.size > maxBytes) throw Object.assign(new Error('package_file_size'), { code: 'package_file_size' });
      return readFile(filename);
    };
    // Base64-encoded package entries can be larger than the compressed upload, but remain bounded.
    const sealed = await readSealedFile(SEALED_PACKAGE, 64 * 1024 * 1024 + 128 * 1024);
    if (sealed) {
      const storage = secure();
      const sealedKey = await readSealedFile(SEALED_KEY, 16 * 1024);
      if (!storage || !sealedKey) throw Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') });
      try { return openSealed(sealed, sealedKey, storage); }
      catch (error) { throw error.code ? error : Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') }); }
    }
    const files = new Map();
    const walk = async (directory, prefix, depth) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw Object.assign(new Error('package_link'), { code: 'package_link', diagnostic: diagnostic('package_link', relative) });
        if (entry.isDirectory()) { if (depth === 0 && ['templates', 'examples', 'tests'].includes(entry.name)) await walk(join(directory, entry.name), relative, 1); continue; }
        if (!entry.isFile()) throw Object.assign(new Error('package_path'), { code: 'package_path' });
        if (files.size >= core.LIMITS.files) throw Object.assign(new Error('package_files'), { code: 'package_files', diagnostic: diagnostic('package_files', relative, { max: core.LIMITS.files }) });
        const info = await stat(join(directory, entry.name));
        if (info.size > core.LIMITS.fileBytes) throw Object.assign(new Error(`package_file_size: ${relative}`), { code: 'package_file_size', diagnostic: diagnostic('package_file_size', relative, { max: core.LIMITS.fileBytes }) });
        if (core.allowedFile(relative) || relative === 'manifest.json') files.set(relative, await readFile(join(directory, entry.name)));
      }
    };
    await walk(folder, '', 0);
    if (files.has('manifest.json')) {
      if (files.has('plugin.json')) throw Object.assign(new Error('package_duplicate'), { code: 'package_duplicate' });
      files.set('plugin.json', files.get('manifest.json'));
      files.delete('manifest.json');
    }
    if (!files.has('plugin.json')) throw Object.assign(new Error('package_manifest_missing'), { code: 'package_manifest_missing', diagnostic: diagnostic('package_manifest_missing', 'plugin.json') });
    return files;
  };

  const validateFiles = files => {
    if (!files.has('plugin.json')) return { ok: false, errors: ['package_manifest_missing'], diagnostics: [diagnostic('package_manifest_missing')] };
    let raw;
    try { raw = JSON.parse(files.get('plugin.json').toString('utf8')); } catch { return { ok: false, errors: ['plugin.json: not valid JSON'], diagnostics: [diagnostic('plugin.json', 'plugin.json')] }; }
    const checked = core.validateManifest(raw, { files: new Set(files.keys()) });
    if (checked.ok && checked.manifest.minNextMux && core.compareVersions(checked.manifest.minNextMux, app.getVersion()) > 0) {
      return { ok: false, errors: [`minNextMux: needs NextMux ${checked.manifest.minNextMux} or later`], diagnostics: [diagnostic('plugin.version', 'minNextMux', { version: checked.manifest.minNextMux })] };
    }
    return checked;
  };

  // All of a plugin's decoded template pictures together stay within this many pixels (64 MB of BGRA); pictures
  // past it are left out, which the plugin sees as a template that is never found (audit B16-02).
  const TEMPLATE_PIXEL_BUDGET = 16 * 1024 * 1024;
  const decodeImages = (files, manifest) => {
    const templates = new Map();
    const skippedImages = new Set();
    let pixels = 0;
    for (const signal of manifest.perception.signals) {
      if (signal.type !== 'template') continue;
      if (templates.has(signal.image)) continue;
      const bytes = files.get(signal.image);
      if (!pngWithinDecodeLimit(bytes) || pixels + pngClaimedPixels(bytes) > TEMPLATE_PIXEL_BUDGET) {
        skippedImages.add(signal.image);
        continue;
      }
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) {
        skippedImages.add(signal.image);
        continue;
      }
      const size = image.getSize();
      if (pixels + size.width * size.height > TEMPLATE_PIXEL_BUDGET) {
        skippedImages.add(signal.image);
        continue;
      }
      pixels += size.width * size.height;
      templates.set(signal.image, { width: size.width, height: size.height, stride: size.width * 4, data: image.toBitmap() });
    }
    if (skippedImages.size > 0) {
      const warnings = [...skippedImages].map(img => `template image "${img}" exceeded the ${TEMPLATE_PIXEL_BUDGET}-pixel budget or failed to decode and was skipped`);
      Object.defineProperty(templates, 'warnings', { value: warnings, enumerable: false });
      try { console.warn(`[app-plugins] ${manifest.id || 'plugin'}: ${warnings.join('; ')}`); } catch { /* ignore */ }
    }
    return templates;
  };

  const iconOf = files => {
    const icon = files.get('icon.png');
    if (!icon || !pngWithinDecodeLimit(icon)) return '';
    try { const image = nativeImage.createFromBuffer(icon); return image.isEmpty() ? '' : image.resize({ width: 64, height: 64 }).toDataURL(); } catch { return ''; }
  };

  const pluginFolder = id => state.plugins[id]?.dev ? state.plugins[id].dev : join(installedRoot, id);
  const renameWithRetry = async (fromPath, toPath) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rename(fromPath, toPath);
        return;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw lastError;
  };

  const recoverBackupIfMissing = async targetDir => {
    if (await stat(targetDir).then(() => true, () => false)) return false;
    const parent = dirname(targetDir);
    const prefix = `${basename(targetDir)}.bak-`;
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
    const backups = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
      .map(entry => entry.name)
      .sort()
      .reverse();
    if (!backups.length) return false;
    await renameWithRetry(join(parent, backups[0]), targetDir);
    return true;
  };

  const swapDirectoryWithBackup = async (stageDir, targetDir, keepBackup = false) => {
    await recoverBackupIfMissing(targetDir).catch(() => undefined);
    const hadTarget = await stat(targetDir).then(() => true, () => false);
    const backupDir = hadTarget ? `${targetDir}.bak-${Date.now()}-${randomUUID().slice(0, 8)}` : '';
    if (hadTarget) {
      await renameWithRetry(targetDir, backupDir);
    }
    try {
      await renameWithRetry(stageDir, targetDir);
    } catch (error) {
      if (hadTarget) {
        try {
          await renameWithRetry(backupDir, targetDir);
        } catch (rollbackError) {
          if (error && typeof error === 'object') {
            error.backupDir = backupDir;
            error.rollbackError = rollbackError;
          }
        }
      }
      throw error;
    }
    if (hadTarget && !keepBackup) {
      await Promise.resolve(shell?.trashItem?.(backupDir)).catch(() => rm(backupDir, { recursive: true, force: true }).catch(() => undefined));
    }
    return backupDir;
  };

  /**
   * A bought plugin installed before packages were sealed still sits in plain files: seal it now, with its license
   * checked, and swap it in atomically (the plain copy goes to the Trash). Without keychain storage it is not used
   * until reinstalled (audit B17-03).
   */
  const sealLegacyPaidInstall = async (id, folder) => {
    const record = state.plugins[id];
    // A developer's own folder is never touched.
    if (!record?.paid || record.dev) return;
    if (await stat(join(folder, SEALED_PACKAGE)).then(() => true, () => false)) return;
    if (!licensed(record.license, id)) throw Object.assign(new Error('plugin_purchase_required'), { code: 'plugin_purchase_required' });
    const storage = secure();
    if (!storage) throw Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') });
    const files = await readFolder(folder);
    const staging = join(installedRoot, `.${id}.${randomUUID()}`);
    activeStaging.add(staging);
    try {
      await mkdir(staging, { recursive: true });
      const sealed = sealFiles(files, storage);
      await writeFile(join(staging, SEALED_PACKAGE), sealed.blob, { mode: 0o600 });
      await writeFile(join(staging, SEALED_KEY), sealed.key, { mode: 0o600 });
      await swapDirectoryWithBackup(staging, folder);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw Object.assign(new Error('package_locked'), { code: 'package_locked', diagnostic: diagnostic('package_locked') });
    } finally { activeStaging.delete(staging); }
  };

  const loadPlugin = async (id, fresh = false) => {
    if (!fresh && cache.has(id)) return cache.get(id);
    const folder = pluginFolder(id);
    if (!state.plugins[id]?.dev) await recoverBackupIfMissing(folder).catch(() => undefined);
    await sealLegacyPaidInstall(id, folder);
    const files = await readFolder(folder);
    const checked = validateFiles(files);
    if (!checked.ok) throw Object.assign(new Error(checked.errors.join('\n')), { code: 'plugin_invalid', errors: checked.errors, diagnostics: checked.diagnostics });
    if (checked.manifest.id !== id) throw Object.assign(new Error('package_identity_mismatch'), { code: 'package_identity_mismatch' });
    const entry = { manifest: checked.manifest, templates: decodeImages(files, checked.manifest), folder, files, digest: contentDigest(files) };
    cache.set(id, entry);
    return entry;
  };

  /**
   * Source and signature marks hold only for the files they were recorded with. After
   * a replacement whose state write failed, the new files read as an unverified local
   * file (audit DS-08). A record from before digests were kept adopts them once.
   */
  const trustFor = (record, digest) => {
    if (record.dev) return trustOf(record);
    if (record.contentDigest === undefined) { record.contentDigest = digest; void save().catch(() => undefined); }
    return record.contentDigest === digest ? trustOf(record) : trustOf({});
  };

  const parseCommentLines = rawText => String(rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:[-*+]\s+|\d+\.\s+)/, '').trim().slice(0, 500))
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .slice(0, 2000);

  const isPathParam = def => def && (def.type === 'path' || def.type === 'directory');
  const normalizeFolderPath = value => {
    const norm = normalize(value);
    if (norm.length > 1 && /[\\/]+$/.test(norm) && !/^[A-Za-z]:[\\/]$/.test(norm)) {
      return norm.replace(/[\\/]+$/, '');
    }
    return norm;
  };
  const validatePathParamValue = async value => {
    if (value === null || value === '') return { ok: true, value: '' };
    if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !isAbsolute(value) || !core.normalizePathParam(value)) {
      return { ok: false, error: 'param_path_invalid' };
    }
    const normalized = normalizeFolderPath(value);
    if (!normalized || normalized.length > 4096 || normalized.includes('\0') || !isAbsolute(normalized)) {
      return { ok: false, error: 'param_path_invalid' };
    }
    try {
      const info = await stat(normalized);
      if (!info.isDirectory()) return { ok: false, error: 'param_path_invalid' };
    } catch {
      return { ok: false, error: 'param_path_invalid' };
    }
    return { ok: true, value: normalized };
  };

  const resolveParams = (manifest, storedParams) => {
    const out = {};
    const raw = storedParams && typeof storedParams === 'object' ? storedParams : {};
    for (const def of manifest.params || []) {
      const val = raw[def.id];
      if (def.type === 'boolean') {
        out[def.id] = typeof val === 'boolean' ? val : def.default;
      } else if (def.type === 'number') {
        const num = typeof val === 'number' && Number.isFinite(val) ? val : typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val)) ? Number(val) : def.default;
        out[def.id] = Math.min(def.max, Math.max(def.min, num));
      } else if (def.type === 'select') {
        const str = typeof val === 'string' ? val : def.default;
        out[def.id] = def.options?.some(opt => opt.value === str) ? str : def.default;
      } else if (def.type === 'file') {
        if (val && typeof val === 'object' && Array.isArray(val.lines)) {
          const lines = val.lines.map(line => String(line || '').trim().slice(0, 500)).filter(Boolean).slice(0, 2000);
          out[def.id] = { path: String(val.path || '').slice(0, 500), name: String(val.name || basename(String(val.path || ''))).slice(0, 120), count: lines.length, lines, value: lines[0] || '' };
        } else if (typeof val === 'string' && val.trim()) {
          const lines = parseCommentLines(val);
          out[def.id] = { path: '', name: 'inline.txt', count: lines.length, lines, value: lines[0] || '' };
        } else {
          out[def.id] = { path: '', name: '', count: 0, lines: [], value: '' };
        }
      } else if (isPathParam(def)) {
        if (val === null || val === '') {
          out[def.id] = '';
        } else if (typeof val === 'string' && !val.includes('\0') && val.length <= 4096 && isAbsolute(val)) {
          out[def.id] = normalizeFolderPath(val);
        } else if (!(def.id in raw) && typeof def.default === 'string' && def.default && !def.default.includes('\0') && def.default.length <= 4096 && isAbsolute(def.default)) {
          out[def.id] = normalizeFolderPath(def.default);
        } else {
          out[def.id] = '';
        }
      } else {
        out[def.id] = typeof val === 'string' ? val.slice(0, 500) : def.default;
      }
    }
    return out;
  };

  const publicParams = params => {
    if (!params || typeof params !== 'object') return {};
    return Object.fromEntries(Object.entries(params).map(([key, value]) => [
      key,
      value && typeof value === 'object' && Array.isArray(value.lines)
        ? { path: value.path || '', name: value.name || '', count: value.count ?? value.lines.length, preview: value.lines.slice(0, 3) }
        : value
    ]));
  };

  const hydrateParamInput = async (manifest, currentParams, incomingParams) => {
    const merged = { ...(currentParams && typeof currentParams === 'object' ? currentParams : {}) };
    if (incomingParams && typeof incomingParams === 'object') {
      for (const def of manifest.params || []) {
        if (!(def.id in incomingParams)) continue;
        const incoming = incomingParams[def.id];
        if (isPathParam(def)) {
          const checked = await validatePathParamValue(incoming);
          if (!checked.ok) {
            const err = new Error(checked.error);
            err.code = checked.error;
            throw err;
          }
          merged[def.id] = checked.value;
          continue;
        }
        if (def.type === 'file' && typeof incoming === 'string' && incoming.trim()) {
          const candidatePath = incoming.trim();
          if (/\.(txt|md)$/i.test(candidatePath) && !candidatePath.includes('\n')) {
            try {
              const info = await stat(candidatePath);
              if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
              const rawText = await readFile(candidatePath, 'utf8');
              const lines = parseCommentLines(rawText);
              merged[def.id] = { path: candidatePath, name: basename(candidatePath), count: lines.length, lines };
              continue;
            } catch { /* treat as inline text if not a readable file path */ }
          }
        }
        merged[def.id] = incoming;
      }
    }
    return resolveParams(manifest, merged);
  };

  const describe = async (id, locale) => {
    const record = state.plugins[id];
    try {
      const { manifest, files, digest } = await loadPlugin(id);
      const trust = trustFor(record, digest);
      const resolvedParams = resolveParams(manifest, record.params);
      const needsModel = manifest.decisions.length > 0;
      const compatibilityError = needsModel && !loadDecisionAdapter() ? 'plugin_runtime_unavailable'
        : record.model ? decisionPluginCompatibility(record.model, manifest.decisions) : '';
      return { id, ok: true, summary: core.manifestSummary(manifest, locale), presets: manifest.presets, params: publicParams(resolvedParams), modelSummary: core.modelSummary(manifest), enabled: true, model: record.model || null, vision: record.vision || null,
        dev: Boolean(record.dev), folder: record.dev || '', installedAt: record.installedAt || 0, icon: iconOf(files), ...trust, verified: trust.signatureVerified,
        ...(record.paid ? { paid: true, licenseExpiresAt: record.license?.expiresAt || 0, licenseUserId: record.license?.userId || '' } : {}),
        ...(record.fromMarket ? {} : { fingerprint: fingerprintOf(manifest, files) }),
        readme: files.get('README.md')?.toString('utf8').slice(0, 20_000) || '', tests: manifest.tests.length,
        ready: (!needsModel || Boolean(record.model)) && !compatibilityError && !inputCompatibility(manifest, platform, input.capabilities).length && (manifest.perception.vision !== 'required' || record.model?.images === true || Boolean(record.vision)),
        ...(compatibilityError ? { modelCompatibilityError: compatibilityError } : {}),
        budgetEnforceable: priced(record.model) && priced(record.vision), inputErrors: inputCompatibility(manifest, platform, input.capabilities),
        running: [...runs.values()].filter(run => run.pluginId === id && !run.ended).map(run => run.id) };
    } catch (error) {
      return { id, ok: false, errors: error.errors || [String(error.code || error.message)], diagnostics: errorDiagnostics(error), dev: Boolean(record.dev), folder: record.dev || '', enabled: true, model: record.model || null };
    }
  };

  const ownerOf = event => BrowserWindow.fromWebContents(event.sender);
  const send = (run, message) => { if (!run.owner.isDestroyed()) run.owner.send('nextmux:plugins:event', message); };

  // --------------------------------------------------------------------------------------------------------------
  // Installed plugins

  ipcMain.handle('nextmux:plugins:list', async (event, locale) => {
    if (!trusted(event)) return [];
    await load();
    return Promise.all(Object.keys(state.plugins).map(id => describe(id, typeof locale === 'string' ? locale : 'en')));
  });

  // Remove only proven failed installs. Paid/keychain failures, live runs, user folders and run receipts
  // are not disposable; billing and recovery evidence must survive a failed upload.
  const purgeBrokenInstalls = async source => {
    for (const [token, entry] of pending) if (source !== undefined && entry.inspectionSource === source || entry.expires < Date.now()) pending.delete(token);
    let changed = false;
    const entries = await readdir(installedRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const match = /^\.(.+)\.[a-f0-9-]{36}$/.exec(entry.name);
      if (entry.isDirectory() && match && pluginId(match[1]) && !installing.has(match[1]) && !activeStaging.has(join(installedRoot, entry.name))) {
        await rm(join(installedRoot, entry.name), { recursive: true, force: true });
      }
    }
    const ids = new Set([...Object.keys(state.plugins), ...entries.filter(entry => entry.isDirectory() && pluginId(entry.name)).map(entry => entry.name)]);
    for (const id of ids) {
      if (!pluginId(id) || installing.has(id) || [...runs.values()].some(run => run.pluginId === id && !run.ended)) continue;
      const record = state.plugins[id];
      if (record?.paid) continue;
      const folder = record?.dev || join(installedRoot, id);
      // Only leftovers of an unfinished install are removed: a recorded plugin whose folder is gone or never got a
      // manifest, or a folder without any record (an interrupted install) that does not validate. A recorded plugin
      // that merely fails today's validation (an older format, a hand-edited file) stays listed with its errors so
      // the user decides; an unrelated failed upload must never delete it.
      let broken = false;
      try {
        if (!record?.dev) await recoverBackupIfMissing(folder);
        const files = await readFolder(folder);
        if (!record) { const checked = validateFiles(files); broken = !checked.ok || checked.manifest.id !== id; }
      } catch (error) {
        broken = ['ENOENT', 'package_manifest_missing'].includes(error.code) || !record && /^package_/.test(String(error.code || ''));
      }
      if (!broken) continue;
      if (!record?.dev) await rm(folder, { recursive: true, force: true });
      delete state.plugins[id];
      cache.delete(id);
      for (const [token, entry] of pending) if (entry.manifest.id === id) pending.delete(token);
      changed = true;
    }
    if (changed) await save();
  };
  const invalidUpload = async (error, source) => {
    let cleanupFailed = false;
    try { await purgeBrokenInstalls(source); } catch { cleanupFailed = true; }
    const code = typeof error?.code === 'string' && /^(?:package_|plugin[._])/.test(error.code) ? error.code : 'package_read_failed';
    const diagnostics = error.diagnostics || [error.diagnostic || diagnostic(code)];
    if (code === 'plugin_invalid' && !diagnostics.some(item => ['plugin_invalid', 'plugin.json', 'package_manifest_missing'].includes(item.code))) diagnostics.unshift(diagnostic(code));
    return { ok: false, error: code, errors: error.errors || [code], diagnostics, ...(cleanupFailed ? { cleanupFailed: true } : {}) };
  };

  /** Checks a package and keeps it for the install confirmation (install with the token). */
  const inspectFiles = async (files, locale, label, origin, source) => {
    const checked = validateFiles(files);
    if (!checked.ok) return { ...await invalidUpload({ code: 'plugin_invalid', ...checked }, source), file: label };
    // A marketplace download must be the plugin and version the user chose there.
    if (origin && (checked.manifest.id !== origin.id || checked.manifest.version !== origin.version)) return { ok: false, errors: ['package_identity_mismatch'], diagnostics: [diagnostic('package_identity_mismatch')], file: label };
    const token = randomUUID();
    const trust = trustOf(origin ? { ...origin, fromMarket: true } : {});
    for (const [key, value] of pending) if (value.expires < Date.now() || source !== undefined && value.inspectionSource === source) pending.delete(key);
    // Only a bounded number of install confirmations may retain decoded packages in memory.
    while (pending.size >= 8) pending.delete(pending.keys().next().value);
    const license = licenseOf(origin?.license);
    pending.set(token, { files, manifest: checked.manifest, inspectionSource: source, expires: Date.now() + PENDING_MS, ...trust, ...(origin ? { verified: origin.verified === true, fromMarket: true } : {}),
      ...(origin?.paid === true ? { paid: true, ...(license ? { license } : {}) } : {}) });
    const existing = state.plugins[checked.manifest.id];
    let installedVersion = '';
    if (existing && !existing.dev) { try { installedVersion = (await loadPlugin(checked.manifest.id)).manifest.version; } catch { /* broken install is replaced */ } }
    return { ok: true, token, file: label, summary: core.manifestSummary(checked.manifest, typeof locale === 'string' ? locale : 'en'), icon: iconOf(files),
      fingerprint: fingerprintOf(checked.manifest, files),
      readme: files.get('README.md')?.toString('utf8').slice(0, 20_000) || '', installedVersion,
      downgrade: Boolean(installedVersion) && core.compareVersions(checked.manifest.version, installedVersion) < 0, ...trust,
      ...(origin ? { fromMarket: true, verified: origin.verified === true } : {}) };
  };

  /** Picks a .nmxplugin and checks it; nothing is installed until the user confirms (install with the token). */
  ipcMain.handle('nextmux:plugins:inspect', async (event, locale, title, directPath) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted' };
    await load();
    const picked = typeof directPath === 'string' && directPath.trim() ? { filePaths: [directPath.trim()] }
      : await dialog.showOpenDialog(ownerOf(event), { title: typeof title === 'string' ? title.slice(0, 80) : undefined, properties: ['openFile'],
        filters: [{ name: pluginFileLabels[app[Symbol.for('nextmux.desktop.app-locale.v1')] || locale] || pluginFileLabels.en, extensions: ['nmxplugin', 'zip', 'jevplugin', 'gz', 'tgz', 'json'] }] });
    const file = picked.canceled ? undefined : picked.filePaths[0];
    if (!file) return { ok: false, cancelled: true };
    let files;
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw Object.assign(new Error('package_link'), { code: 'package_link' });
      if (info.isDirectory()) files = await readFolder(file);
      else if (['plugin.json', 'manifest.json'].includes(basename(file))) files = await readFolder(dirname(file));
      else {
        if (!/\.(?:nmxplugin|zip|jevplugin|tar\.gz|tgz)$/i.test(file)) throw Object.assign(new Error('package_format_unsupported'), { code: 'package_format_unsupported' });
        if (!info.isFile()) throw Object.assign(new Error('package_path'), { code: 'package_path' });
        if (info.size > core.LIMITS.packageBytes) throw Object.assign(new Error('package_size'), { code: 'package_size' });
        files = await zipAdapter.readArchive(await readFile(file), file);
      }
    } catch (error) { return invalidUpload(error, file); }
    return inspectFiles(files, locale, basename(file), undefined, file);
  });

  /** A package downloaded from the marketplace (digest and review signature already checked by the backend). */
  ipcMain.handle('nextmux:plugins:inspect-bytes', async (event, locale, dataBase64, origin) => {
    if (!trusted(event) || typeof dataBase64 !== 'string' || dataBase64.length > core.LIMITS.packageBytes * 1.4
      || !origin || !pluginId(origin.id) || typeof origin.version !== 'string') return { ok: false, errors: ['request_invalid'], diagnostics: [diagnostic('request_invalid')] };
    await load();
    let files;
    try { files = zipAdapter.readZip(Buffer.from(dataBase64, 'base64')); } catch (error) { return invalidUpload(error, `market:${origin.id}`); }
    // A bought plugin keeps its paid mark and license through to the install (sealed storage, license check).
    return inspectFiles(files, locale, `${origin.id} ${origin.version}`, { id: origin.id, version: origin.version, ...trustOf({ ...origin, fromMarket: true }), verified: origin.signatureVerified === true || origin.verified === true,
      ...(origin.paid === true ? { paid: true, license: origin.license } : {}) }, `market:${origin.id}`);
  });

  ipcMain.handle('nextmux:plugins:install', async (event, token, gate) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted' };
    await load();
    const entry = typeof token === 'string' ? pending.get(token) : undefined;
    const id = entry?.manifest.id;
    // The app checked the marketplace for this id (a copied file of a paid plugin is recognised by its id).
    const paid = entry?.paid === true || gate?.paid === true;
    const license = licensed(entry?.license, id) ? entry.license : licenseOf(gate?.license);
    if (entry && paid && !licensed(license, id)) return { ok: false, error: 'plugin_purchase_required' };
    pending.delete(token);
    if (!entry || entry.expires < Date.now()) return { ok: false, error: 'install_expired' };
    if (installing.has(id) || [...runs.values()].some(run => run.pluginId === id && !run.ended)) return { ok: false, error: 'plugin_running' };
    if (!state.plugins[id] && Object.keys(state.plugins).length >= 100) return { ok: false, error: 'too_many_plugins' };
    const target = join(installedRoot, id);
    const staging = join(installedRoot, `.${id}.${randomUUID()}`);
    // A bought plugin is stored sealed to this computer's keychain; without one it is not installed at all.
    const storage = paid ? secure() : undefined;
    if (paid && !storage) return { ok: false, error: 'secure_storage_unavailable' };
    installing.add(id);
    activeStaging.add(staging);
    const previous = state.plugins[id];
    let backupDir = '', swapped = false;
    try {
      await mkdir(staging, { recursive: true });
      if (storage) {
        const sealed = sealFiles(entry.files, storage);
        await writeFile(join(staging, SEALED_PACKAGE), sealed.blob, { mode: 0o600 });
        await writeFile(join(staging, SEALED_KEY), sealed.key, { mode: 0o600 });
      } else for (const [name, data] of entry.files) {
        await mkdir(dirname(join(staging, name)), { recursive: true });
        await writeFile(join(staging, name), data, { mode: 0o644 });
      }
      // Keep the old version until both the new directory and its state record are durable.
      backupDir = await swapDirectoryWithBackup(staging, target, true);
      swapped = true;
      state.plugins[id] = { enabled: true, installedAt: Date.now(), ...trustOf(entry), contentDigest: contentDigest(entry.files), ...(previous?.model ? { model: previous.model } : {}), ...(previous?.vision ? { vision: previous.vision } : {}), ...(previous?.params ? { params: previous.params } : {}),
        ...(entry.fromMarket ? { fromMarket: true, verified: entry.verified === true } : {}), ...(paid ? { paid: true, license } : {}) };
      await save();
      cache.delete(id);
      if (backupDir) await Promise.resolve(shell?.trashItem?.(backupDir)).catch(() => rm(backupDir, { recursive: true, force: true }).catch(() => undefined));
      return { ok: true, id };
    } catch (error) {
      if (previous) state.plugins[id] = previous; else delete state.plugins[id];
      cache.delete(id);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (swapped) {
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
        if (backupDir) await renameWithRetry(backupDir, target).catch(() => undefined);
      }
      await recoverBackupIfMissing(target).catch(() => undefined);
      return { ok: false, error: 'install_failed', ...(backupDir || error?.backupDir ? { backupDir: backupDir || error.backupDir } : {}) };
    } finally { installing.delete(id); activeStaging.delete(staging); }
  });

  /** Developer mode: a plugin folder used in place, reloaded on request. */
  ipcMain.handle('nextmux:plugins:add-folder', async (event, title, directFolder) => {
    if (!trusted(event)) return { ok: false, error: 'untrusted' };
    await load();
    let folder = typeof directFolder === 'string' && directFolder.trim() ? directFolder.trim() : undefined;
    if (!folder) {
      const picked = await dialog.showOpenDialog(ownerOf(event), { title: typeof title === 'string' ? title.slice(0, 80) : undefined, properties: ['openDirectory'] });
      folder = picked.canceled ? undefined : picked.filePaths[0];
    }
    if (!folder) return { ok: false, cancelled: true };
    let files;
    try { files = await readFolder(folder); } catch (error) { return invalidUpload(error, folder); }
    const checked = validateFiles(files);
    if (!checked.ok) return invalidUpload({ code: 'plugin_invalid', ...checked }, folder);
    const id = checked.manifest.id;
    if (installing.has(id)) return { ok: false, error: 'plugin_running' };
    if (state.plugins[id] && state.plugins[id].paid) return { ok: false, errors: [`${id} is installed already; uninstall it to load it from a folder`], diagnostics: [diagnostic('plugin.installed', '', { id })] };
    installing.add(id);
    try {
      const previous = state.plugins[id];
      if (previous && !previous.dev) {
        for (const run of runs.values()) if (run.pluginId === id && !run.ended) await stopRun(run, 'uninstalled');
      }
      state.plugins[id] = { ...(previous || {}), enabled: true, dev: folder, installedAt: Date.now() };
      try { await save(); }
      catch {
        if (previous) state.plugins[id] = previous; else delete state.plugins[id];
        return { ok: false, error: 'install_failed' };
      }
      cache.delete(id);
      if (previous && !previous.dev) { try { await shell.trashItem(join(installedRoot, id)); } catch { /* preserve the old recovery copy */ } }
      return { ok: true, id };
    } finally { installing.delete(id); }
  });

  ipcMain.handle('nextmux:plugins:reload', async (event, id) => {
    if (!trusted(event) || !pluginId(id)) return { ok: false };
    await load();
    if (!state.plugins[id]) return { ok: false, error: 'plugin_missing' };
    try {
      const reloaded = await loadPlugin(id, true);
      for (const run of runs.values()) if (!run.ended && run.pluginId === id) {
        invalidate(run);
        run.manifest = reloaded.manifest;
        run.templates = reloaded.templates;
        run.params = resolveParams(reloaded.manifest, state.plugins[id]?.params);
        run.decidedAt.clear();
        resetPerception(run);
        emitStatus(run, true);
      }
      return { ok: true };
    } catch (error) { return { ok: false, errors: error.errors || [String(error.message)], diagnostics: errorDiagnostics(error) }; }
  });

  ipcMain.handle('nextmux:plugins:uninstall', async (event, id) => {
    if (!trusted(event) || !pluginId(id)) return { ok: false };
    await load();
    const record = state.plugins[id];
    if (!record) return { ok: false, error: 'plugin_missing' };
    if (installing.has(id)) return { ok: false, error: 'plugin_running' };
    for (const run of runs.values()) if (run.pluginId === id && !run.ended) await stopRun(run, 'uninstalled');
    // A developer's folder is theirs: it is only forgotten. An installed plugin goes to the Trash.
    if (!record.dev) {
      const folder = join(installedRoot, id);
      try { await shell.trashItem(folder); } catch { await rm(folder, { recursive: true, force: true }).catch(() => undefined); }
      // The record is the only way to find the folder again: keep it while the files are still on disk.
      if (require('node:fs').existsSync(folder)) return { ok: false, error: 'uninstall_failed' };
    }
    delete state.plugins[id];
    cache.delete(id);
    await save();
    return { ok: true };
  });

  /**
   * Which live runs a parameter change reaches. With runId/tabId/conversationId only the matching runs of this plugin
   * change; `scope: 'defaults'` changes only the saved defaults; otherwise every live run takes the edited options.
   */
  const paramTargets = (id, options) => {
    const scope = options && typeof options === 'object' ? options : {};
    const filters = ['runId', 'tabId', 'conversationId'].filter(key => typeof scope[key] === 'string' && scope[key]);
    const live = scope.scope === 'defaults' ? [] : [...runs.values()].filter(run => !run.ended && run.pluginId === id
      && filters.every(key => run[key === 'runId' ? 'id' : key] === scope[key]));
    return { runs: live, targeted: filters.length > 0, persist: scope.scope === 'defaults' || scope.ephemeral !== true };
  };

  /** A replaced item/comment file starts again from its first line. */
  const restartFileCursors = (run, edited) => {
    for (const def of run.manifest.params || []) if (def.type === 'file' && Object.hasOwn(edited, def.id)) run.paramCursor.set(def.id, 0);
  };

  /** Picks or loads a local .txt / .md file or directory path for a plugin parameter. */
  ipcMain.handle('nextmux:plugins:pick-param-file', async (event, id, paramId, directFilePath, options) => {
    if (!trusted(event) || !pluginId(id) || typeof paramId !== 'string' || !/^[a-z0-9_]{1,32}$/.test(paramId)) return { ok: false, error: 'request_invalid' };
    if (directFilePath && typeof directFilePath === 'object' && options === undefined) {
      options = directFilePath;
      directFilePath = undefined;
    }
    await load();
    const record = state.plugins[id];
    if (!record) return { ok: false, error: 'plugin_missing' };
    let plugin;
    try { plugin = await loadPlugin(id); } catch { return { ok: false, error: 'plugin_invalid' }; }
    const def = (plugin.manifest.params || []).find(item => item.id === paramId && (item.type === 'file' || isPathParam(item)));
    if (!def) return { ok: false, error: 'param_not_found' };
    if (isPathParam(def)) {
      let folder = typeof directFilePath === 'string' && directFilePath.trim() ? directFilePath.trim() : undefined;
      // Never treat a button/parameter label as a path: only an existing absolute directory skips the native folder picker.
      if (folder && !(!folder.includes('\0') && folder.length <= 4096 && isAbsolute(folder) && await stat(folder).then(info => info.isDirectory(), () => false))) {
        folder = undefined;
      }
      if (!folder) {
        const picked = await dialog.showOpenDialog(ownerOf(event), {
          title: core.localize(def.label, 'zh-CN') || paramId,
          properties: ['openDirectory', 'createDirectory']
        });
        if (picked?.canceled || !picked?.filePaths?.length || picked.filePaths[0] === undefined || picked.filePaths[0] === '') {
          return { ok: true, cancelled: true };
        }
        folder = picked.filePaths[0];
      }
      const checked = await validatePathParamValue(folder);
      if (!checked.ok) return { ok: false, error: checked.error };
      const value = checked.value;
      const target = paramTargets(id, options);
      if (target.persist) record.params = resolveParams(plugin.manifest, { ...(record.params || {}), [paramId]: value });
      for (const run of target.runs) {
        run.rawParams = { ...(run.rawParams || record.params || {}), [paramId]: value };
        run.params = resolveParams(run.manifest, run.rawParams);
        emitStatus(run, true);
      }
      if (target.persist) await save();
      const params = publicParams(resolveParams(plugin.manifest, target.runs[0]?.rawParams || record.params));
      return { ok: true, paramId, path: value, param: value, params };
    }
    let file = typeof directFilePath === 'string' && directFilePath.trim() ? directFilePath.trim() : undefined;
    // Older callers passed a button label instead of a path: only an existing absolute file skips the picker.
    if (file && !(isAbsolute(file) && await stat(file).then(info => info.isFile(), () => false))) file = undefined;
    if (!file) {
      const extensions = (def.accept || ['.txt', '.md']).map(ext => ext.replace(/^\./, '')).filter(Boolean);
      const picked = await dialog.showOpenDialog(ownerOf(event), {
        title: core.localize(def.label, 'zh-CN') || paramId,
        properties: ['openFile'],
        filters: [{ name: `Text / Markdown (${(def.accept || ['.txt', '.md']).join(', ')})`, extensions: extensions.length ? extensions : ['txt', 'md'] }]
      });
      file = picked.canceled ? undefined : picked.filePaths[0];
      if (!file) return { ok: false, cancelled: true };
    }
    let rawText;
    try {
      const info = await stat(file);
      if (!info.isFile()) return { ok: false, error: 'file_read_failed' };
      if (info.size > 2 * 1024 * 1024) return { ok: false, error: 'file_too_large' };
      rawText = await readFile(file, 'utf8');
    } catch { return { ok: false, error: 'file_read_failed' }; }
    const lines = parseCommentLines(rawText);
    const value = { path: file, name: basename(file), count: lines.length, lines };
    const target = paramTargets(id, options);
    if (target.persist) record.params = { ...(record.params || {}), [paramId]: value };
    for (const run of target.runs) {
      run.rawParams = { ...(run.rawParams || record.params || {}), [paramId]: value };
      run.params = resolveParams(run.manifest, run.rawParams);
      run.paramCursor.set(paramId, 0);
      emitStatus(run, true);
    }
    if (target.persist) await save();
    const params = publicParams(resolveParams(plugin.manifest, target.runs[0]?.rawParams || record.params));
    const fileSummary = { path: file, name: basename(file), count: lines.length, preview: lines.slice(0, 5) };
    return { ok: true, paramId, file: fileSummary, param: params[paramId], params };
  });

  ipcMain.handle('nextmux:app-plugins:pick-folder', async (event, initialPath) => {
    if (!trusted(event)) return { canceled: true, path: '' };
    const defaultPath = typeof initialPath === 'string' && initialPath.trim() && !initialPath.includes('\0') && initialPath.trim().length <= 4096 && isAbsolute(initialPath.trim())
      ? normalizeFolderPath(initialPath.trim()) : undefined;
    const picked = await dialog.showOpenDialog(ownerOf(event), {
      properties: ['openDirectory', 'createDirectory'],
      ...(defaultPath ? { defaultPath } : {})
    });
    const rawFolder = picked?.canceled ? '' : String(picked?.filePaths?.[0] || '');
    const folder = rawFolder && !rawFolder.includes('\0') && rawFolder.length <= 4096 && isAbsolute(rawFolder) ? normalizeFolderPath(rawFolder) : '';
    return { canceled: !folder, path: folder };
  });

  ipcMain.handle('nextmux:plugins:configure', async (event, id, settings) => {
    if (!trusted(event) || !pluginId(id) || !settings || typeof settings !== 'object') return { ok: false };
    await load();
    const record = state.plugins[id];
    if (!record) return { ok: false, error: 'plugin_missing' };
    // Validate the entire update before changing the saved selection.
    const model = 'model' in settings ? settings.model === null ? undefined : normalizeModel(settings.model) : record.model;
    if ('model' in settings && settings.model !== null && !model) return { ok: false, error: 'model_invalid' };
    const vision = 'vision' in settings ? settings.vision === null ? undefined : normalizeVision(settings.vision) : record.vision;
    if ('vision' in settings && settings.vision !== null && !vision) return { ok: false, error: 'vision_invalid' };
    // Legacy enable/disable requests are accepted but installed plugins always remain enabled.
    record.enabled = true;
    if ('model' in settings) { if (model) record.model = model; else delete record.model; }
    if ('vision' in settings) {
      // A vision model that describes the screen for a text-only decision model: OpenRouter or a local server.
      if (vision) record.vision = vision; else delete record.vision;
    }
    let configuredParams;
    if (settings.params && typeof settings.params === 'object') {
      let manifest;
      try { ({ manifest } = await loadPlugin(id)); } catch { return { ok: false, error: 'plugin_invalid' }; }
      try {
        const target = paramTargets(id, settings);
        const defaults = target.persist ? await hydrateParamInput(manifest, record.params, settings.params) : record.params;
        const nextRuns = [];
        for (const run of target.runs) {
          // A reached run takes only the edited options; its other per-tab choices stay.
          const nextRaw = await hydrateParamInput(run.manifest, run.rawParams || record.params, settings.params);
          nextRuns.push([run, nextRaw]);
        }
        for (const [run, nextRaw] of nextRuns) {
          run.rawParams = nextRaw;
          run.params = resolveParams(run.manifest, run.rawParams);
          restartFileCursors(run, settings.params);
          emitStatus(run, true);
        }
        record.params = defaults;
        configuredParams = publicParams(resolveParams(manifest, target.runs[0]?.rawParams || record.params));
      } catch (error) {
        return { ok: false, error: error?.code || 'plugin_file_invalid' };
      }
    }
    if ('model' in settings || 'vision' in settings) for (const run of runs.values()) {
      if (run.ended || run.pluginId !== id || !record.model || decisionPluginCompatibility(record.model, run.manifest.decisions)) continue;
      run.model = record.model;
      run.visionModel = record.vision || null;
      run.costSources = { decide: priced(record.model), describe: priced(record.vision) };
      run.costUnknown = run.unknownReceipt || Object.values(run.costSources).some(value => !value);
      invalidate(run);
      run.decidedAt.clear();
      run.visionAt = 0;
      run.vision = '';
      emitStatus(run, true);
    }
    await save();
    return configuredParams ? { ok: true, params: configuredParams } : { ok: true };
  });

  /** Replay tests: each saved frame read like a live one; the readings and reflex compared to the expectations. */
  ipcMain.handle('nextmux:plugins:test', async (event, id) => {
    if (!trusted(event) || !pluginId(id)) return { ok: false };
    await load();
    if (!state.plugins[id]) return { ok: false, error: 'plugin_missing' };
    let plugin;
    try { plugin = await loadPlugin(id, true); } catch (error) { return { ok: false, errors: error.errors || [String(error.message)], diagnostics: errorDiagnostics(error) }; }
    const results = [];
    for (const file of plugin.manifest.tests) {
      let test;
      try { test = JSON.parse(plugin.files.get(file).toString('utf8')); } catch { results.push({ name: file, ok: false, failures: ['not valid JSON'], diagnostics: [diagnostic('plugin.json', file)] }); continue; }
      const framePath = typeof test.frame === 'string' ? join('tests', test.frame).replace(/\\/g, '/').split('/').reduce((parts, part) => part === '..' ? parts.slice(0, -1) : [...parts, part], []).join('/') : '';
      const png = plugin.files.get(framePath);
      const image = png ? nativeImage.createFromBuffer(png) : undefined;
      if (!image || image.isEmpty()) { results.push({ name: test.name || file, ok: false, failures: [`frame ${test.frame} not found in the package`], diagnostics: [diagnostic('plugin.missing_file', 'frame', { file: String(test.frame || '') })] }); continue; }
      const size = image.getSize();
      const frame = { width: size.width, height: size.height, stride: size.width * 4, data: image.toBitmap() };
      const signals = core.perceive(frame, plugin.manifest, plugin.templates, {});
      results.push(core.checkReplay(plugin.manifest, test, signals, { params: resolveParams(plugin.manifest, test.params) }));
    }
    return { ok: true, results };
  });

  // --------------------------------------------------------------------------------------------------------------
  // Runs

  const updateShortcut = () => {
    if (!globalShortcut) return;
    const active = [...runs.values()].some(run => !run.ended);
    const accelerator = platform === 'darwin' ? 'Control+Alt+Command+.' : 'Control+Alt+Shift+.';
    if (active && !shortcut) {
      try { if (globalShortcut.register(accelerator, () => { for (const run of runs.values()) if (!run.ended) void stopRun(run, 'stop_shortcut'); })) shortcut = accelerator; } catch { /* taken by another app */ }
    } else if (!active && shortcut) {
      try { globalShortcut.unregister(shortcut); } catch { /* already gone */ }
      shortcut = '';
    }
  };

  const snapshotOf = run => ({
    runId: run.id, conversationId: run.conversationId, tabId: run.tabId, pid: run.pid, windowId: run.windowId,
    pluginId: run.pluginId, name: run.name, goal: run.goal, presets: run.manifest.presets, params: publicParams(run.params),
    startedAt: run.startedAt, elapsedMs: (run.endedAt || Date.now()) - run.startedAt, costUsd: Math.round(run.cost * 1e6) / 1e6,
    costStatus: run.costUnknown ? 'unknown' : 'known', budgetEnforceable: !run.costUnknown,
    requests: run.requestCount, maxRequests: run.maxRequests,
    maxCostUsd: run.maxCostUsd, maxMinutes: Math.round(run.maxMs / 60000), dryRun: run.dryRun, paused: run.paused, ended: Boolean(run.ended), reason: run.ended || '',
    actions: run.actionCount, decisions: run.decisionCount, lastAction: run.history.at(-1) || null, history: run.history.slice(-20), lastDecision: run.lastDecision || null,
    signals: run.lastSignals ? Object.fromEntries(Object.entries(run.lastSignals).map(([key, value]) => [key, value && typeof value === 'object'
      ? { found: value.found, count: value.count, x: value.x, y: value.y, ...(value.text ? { text: value.text } : {}) } : value])) : {},
    events: run.events.slice(-20), error: run.lastError || '',
    ...(run.lastModelError && run.lastModelErrorCode === run.lastError ? { readableError: run.lastModelError } : {})
  });

  const overlayOf = run => run.manifest.perception.signals.map(signal => {
    const value = run.lastSignals?.[signal.id];
    return { id: signal.id, type: signal.type, rect: signal.rect || null, points: signal.points || null,
      value: value && typeof value === 'object' ? { found: value.found, count: value.count, items: value.items?.slice(0, 5) } : value ?? null };
  });

  const emitStatus = (run, force = false) => {
    const now = Date.now();
    if (!force && now - run.statusAt < STATUS_EVERY_MS) return;
    run.statusAt = now;
    send(run, { type: 'status', ...snapshotOf(run), ...(run.dryRun || run.overlay ? { overlay: overlayOf(run) } : {}) });
  };

  const log = (run, entry) => {
    run.log.push({ at: Date.now(), ...entry });
    if (run.log.length > 500) run.log.splice(0, run.log.length - 500);
  };

  const saveRun = async run => {
    if (incognito?.has(run.conversationId)) return; // Private run text stays in memory only.
    // Serialize writes so a late cost receipt cannot be overwritten by the end snapshot.
    run.saving = (run.saving || Promise.resolve()).then(async () => {
      try {
        await mkdir(logsRoot, { recursive: true });
        await writeFile(join(logsRoot, `${run.id}.json`), JSON.stringify({ ...snapshotOf(run), log: run.log }, null, 1), { mode: 0o600 });
      } catch { /* the log is a convenience */ }
    });
    await run.saving;
  };

  const cancelRequest = (run, requestId, request, reason) => {
    if (request.cancelled) return;
    request.cancelled = true;
    clearTimeout(request.timer);
    send(run, { type: 'cancel', requestId, runId: run.id });
    request.resolve({ ok: false, error: reason });
    // Keep a bounded receipt slot: a fetch can finish billing concurrently with cancellation.
    request.timer = setTimeout(() => decisions.delete(requestId), PENDING_MS);
    request.timer.unref?.();
  };
  const invalidate = run => {
    run.generation++;
    run.inputController.abort();
    run.inputController = new AbortController();
    run.held.clear();
    run.decisionTargets.clear();
    for (const [id, request] of decisions) if (request.runId === run.id) cancelRequest(run, id, request, 'decision_cancelled');
  };
  // A different window or signal definition cannot reuse the previous frame's readings or cadence.
  const resetPerception = run => {
    run.text.clear();
    run.textAt.clear();
    run.memory = {};
    run.lastSignals = undefined;
    run.vision = '';
    run.visionAt = 0;
  };
  const pauseRun = run => { run.paused = true; invalidate(run); };
  const active = (run, generation) => !run.ended && !run.paused && run.generation === generation;

  const endRun = async (run, reason) => {
    if (run.ended) return;
    run.ended = reason;
    run.endedAt = Date.now();
    invalidate(run);
    if (run.ownerDestroyed) run.owner.removeListener?.('destroyed', run.ownerDestroyed);
    run.ownerDestroyed = undefined;
    clearTimeout(run.timer);
    log(run, { kind: 'ended', reason });
    send(run, { type: 'ended', ...snapshotOf(run) });
    updateShortcut();
    await saveRun(run);
    // Finished runs stay visible for a while so the conversation can read how they ended.
    setTimeout(() => runs.delete(run.id), 10 * 60_000).unref?.();
  };
  const stopRun = (run, reason) => endRun(run, reason);

  const reportEvent = (run, id, message, { pause = false, stop = false } = {}) => {
    const now = Date.now();
    if (now - (run.eventAt.get(id) || 0) < EVENT_REPEAT_MS) return;
    run.eventAt.set(id, now);
    const definition = run.manifest.events.find(item => item.id === id);
    const modelMessage = definition ? core.modelText(definition.message) || `Plugin event: ${id}` : message;
    const event = { id, message, modelMessage, pause, stop, at: now };
    run.events.push(event);
    if (run.events.length > 100) run.events.shift();
    log(run, { kind: 'event', id, message });
    send(run, { type: 'event', runId: run.id, conversationId: run.conversationId, tabId: run.tabId, pluginId: run.pluginId, name: run.name, handOff: run.handOff, ...event });
    if (stop) void endRun(run, `event:${id}`);
    else if (pause) { pauseRun(run); emitStatus(run, true); }
  };

  const since = run => action => { const at = run.lastActionAt.get(action); return at === undefined ? Infinity : Date.now() - at; };
  const count = run => (action, ms) => { const from = Date.now() - ms; return run.history.filter(item => item.action === action && item.at >= from).length; };
  const context = (run, signals) => ({ signals, params: run.params, now: Date.now(), held: run.held, since: since(run), count: count(run) });

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const resolveStepPoint = (run, target) => {
    let point = target;
    if (typeof point === 'string' && point.startsWith('signal:')) {
      const found = run.lastSignals?.[point.slice(7)];
      if (!found?.found) return undefined;
      point = [found.x, found.y];
    }
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return undefined;
    const inside = run.manifest.input.pointer.some(({ rect: [x, y, width, height] }) =>
      point[0] >= x && point[0] <= x + width && point[1] >= y && point[1] <= y + height);
    if (!inside) return null;
    return point;
  };
  const pointerTarget = (run, step) => {
    let point = step.move;
    const area = run.manifest.input.pointer.find(item => item.id === step.area);
    if (step.fromDecision) {
      const target = run.decisionTargets.get(step.fromDecision);
      if (!target || Date.now() - target.at > target.maxAgeMs) return undefined;
      point = target.point;
    } else if (area) point = [area.rect[0] + area.rect[2] / 2, area.rect[1] + area.rect[3] / 2];
    if (typeof point === 'string') {
      const signal = run.lastSignals?.[point.slice(7)];
      point = signal?.found ? [signal.x, signal.y] : undefined;
    }
    const inside = rect => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
      && point[0] >= rect[0] && point[0] <= rect[0] + rect[2] && point[1] >= rect[1] && point[1] <= rect[1] + rect[3];
    if (!run.manifest.input.pointer.some(item => inside(item.rect)) || area && !inside(area.rect)) return undefined;
    return point;
  };
  /** Sends one action's steps to the tab's window (or, in a dry run, only records it). */
  const perform = async (run, actionId, by, generation = run.generation) => {
    const action = run.manifest.actions[actionId];
    if (!action || !active(run, generation)) return false;
    const now = Date.now();
    if (action.cooldownMs && now - (run.lastActionAt.get(actionId) ?? -Infinity) < action.cooldownMs) return false;
    const perMinute = Math.min(run.manifest.input.maxActionsPerMinute, GLOBAL_MAX_ACTIONS_PER_MINUTE);
    run.recent = run.recent.filter(at => now - at < 60_000);
    if (run.recent.length >= perMinute) { run.lastError = 'rate_limited'; return false; }
    run.recent.push(now);
    run.busy = true;
    try {
      if (!run.dryRun) {
        const keepFront = run.mode === 'foreground';
        for (const step of action.steps) {
          if (!active(run, generation)) return false;
          let result = { ok: true };
          const aim = step.move !== undefined || step.area !== undefined || step.fromDecision !== undefined;
          if (aim) {
            const point = pointerTarget(run, step);
            if (!point) { run.lastError = 'pointer_target_unavailable'; return false; }
            result = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: 'move', x: point[0], y: point[1], keepFront, signal: run.inputController.signal });
            if (!active(run, generation)) return false;
          }
          // A failed hover never casts. There is no timer or second tick between a successful move and its key.
          if (!result?.ok || step.move !== undefined) { /* handled below */ }
          else if (step.wait !== undefined) await sleep(step.wait);
          else if (step.key !== undefined) result = await input.keys(run.conversationId, run.ownerId, run.pid, run.windowId, { key: platformKey(step.key, platform), modifiers: (step.modifiers || []).map(key => platformKey(key, platform)), ...(step.holdMs !== undefined ? { holdMs: step.holdMs } : {}), keepFront, signal: run.inputController.signal });
          else if (step.keys !== undefined) result = await input.keys(run.conversationId, run.ownerId, run.pid, run.windowId, { keys: step.keys.map(key => platformKey(key, platform)), ...(step.modifiers?.length ? { modifiers: step.modifiers.map(key => platformKey(key, platform)) } : {}), ...(step.holdMs !== undefined ? { holdMs: step.holdMs } : {}), keepFront, signal: run.inputController.signal });
          else if (step.click !== undefined) {
            const point = resolveStepPoint(run, step.click);
            if (point === undefined) return false;
            if (point === null) { run.lastError = 'pointer_outside_declared_area'; return false; }
            result = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: step.count === 2 ? 'doubleClick' : 'click', x: point[0], y: point[1], button: step.button, keepFront, signal: run.inputController.signal });
          } else if (step.drag !== undefined) {
            result = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: 'drag', from: { x: step.drag[0][0], y: step.drag[0][1] }, to: { x: step.drag[1][0], y: step.drag[1][1] }, durationMs: step.durationMs, keepFront, signal: run.inputController.signal });
          } else if (step.text !== undefined) {
            let textValue = String(step.text || '');
            const lineMatch = /^\{\{\s*line:([a-z0-9_]{1,32})\s*\}\}$/.exec(textValue);
            const paramMatch = /^\{\{\s*param:([a-z0-9_]{1,32})\s*\}\}$/.exec(textValue);
            let nextLineCursor = null;
            let maxTextLength = 500;
            const resolveParamText = paramId => {
              const def = (run.manifest.params || []).find(item => item.id === paramId);
              if (isPathParam(def)) maxTextLength = 4096;
              const rawVal = run.params?.[paramId];
              if (isPathParam(def)) return typeof rawVal === 'string' ? rawVal : '';
              return typeof rawVal === 'string' ? rawVal : rawVal && typeof rawVal === 'object' && typeof rawVal.value === 'string' ? rawVal.value : String(rawVal ?? '');
            };
            if (lineMatch) {
              const paramId = lineMatch[1];
              const fileParam = run.params?.[paramId];
              const lines = Array.isArray(fileParam?.lines) ? fileParam.lines : [];
              if (!lines.length) { run.lastError = 'param_file_empty'; log(run, { kind: 'input_failed', action: actionId, error: run.lastError }); emitStatus(run, true); return false; }
              const idx = (run.paramCursor.get(paramId) || 0) % lines.length;
              nextLineCursor = { paramId, next: idx + 1 };
              textValue = lines[idx];
            } else if (paramMatch) {
              textValue = resolveParamText(paramMatch[1]);
            } else if (/\{\{\s*param:[a-z0-9_]{1,32}\s*\}\}/.test(textValue)) {
              textValue = textValue.replace(/\{\{\s*param:([a-z0-9_]{1,32})\s*\}\}/g, (_all, paramId) => resolveParamText(paramId));
            }
            textValue = textValue.trim().slice(0, maxTextLength);
            if (!textValue) { run.lastError = 'text_empty'; log(run, { kind: 'input_failed', action: actionId, error: run.lastError }); emitStatus(run, true); return false; }
            if (step.at !== undefined) {
              const atPoint = resolveStepPoint(run, step.at);
              if (atPoint === undefined) return false;
              if (atPoint === null) { run.lastError = 'pointer_outside_declared_area'; return false; }
              result = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: 'click', x: atPoint[0], y: atPoint[1], button: 'left', keepFront, signal: run.inputController.signal });
              if (!active(run, generation)) return false;
              if (result?.ok) {
                await sleep(360);
                if (!active(run, generation)) return false;
              }
            }
            if (result?.ok) {
              result = await input.keys(run.conversationId, run.ownerId, run.pid, run.windowId, { text: textValue, keepFront, signal: run.inputController.signal });
              if (!active(run, generation)) return false;
            }
            if (result?.ok && (step.submitAt !== undefined || step.submit === true)) {
              await sleep(220);
              if (!active(run, generation)) return false;
              let submitted = false;
              if (step.submitAt !== undefined) {
                const submitPoint = resolveStepPoint(run, step.submitAt);
                if (submitPoint === null) { run.lastError = 'pointer_outside_declared_area'; return false; }
                if (Array.isArray(submitPoint)) {
                  const subRes = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: 'click', x: submitPoint[0], y: submitPoint[1], button: 'left', keepFront, signal: run.inputController.signal });
                  if (!active(run, generation)) return false;
                  submitted = Boolean(subRes?.ok);
                  if (!submitted && step.submit !== true) result = subRes;
                } else if (step.submit !== true) {
                  return false;
                }
              }
              if (!submitted && step.submit === true) {
                result = await input.keys(run.conversationId, run.ownerId, run.pid, run.windowId, { key: 'enter', modifiers: [], keepFront, signal: run.inputController.signal });
                if (!active(run, generation)) return false;
              }
            }
            if (result?.ok && nextLineCursor) {
              run.paramCursor.set(nextLineCursor.paramId, nextLineCursor.next);
            }
          } else if (step.scroll !== undefined) {
            const point = resolveStepPoint(run, step.scroll);
            if (point === undefined) return false;
            if (point === null) { run.lastError = 'pointer_outside_declared_area'; return false; }
            result = await input.pointer(run.conversationId, run.ownerId, run.pid, run.windowId, { kind: 'scroll', x: point[0], y: point[1], direction: step.direction, amount: step.amount || 3, keepFront, signal: run.inputController.signal });
          }
          if (!active(run, generation)) return false;
          if (!result?.ok) {
            run.inputFailures++;
            run.lastError = String(result?.error || 'input_failed');
            log(run, { kind: 'input_failed', action: actionId, error: run.lastError });
            if (run.inputFailures >= 5) void endRun(run, 'input_failed');
            return false;
          }
        }
        run.inputFailures = 0;
      }
      if (!active(run, generation)) return false;
      run.lastActionAt.set(actionId, Date.now());
      for (const reflex of run.manifest.reflexes) {
        if (reflex.do === actionId) {
          const prefix = `${reflex.when}#`;
          for (const key of run.held.keys()) {
            if (typeof key === 'string' && key.startsWith(prefix)) run.held.delete(key);
          }
        }
      }
      run.history.push({ action: actionId, at: Date.now(), by });
      if (run.history.length > 200) run.history.shift();
      run.actionCount++;
      log(run, { kind: 'action', action: actionId, by, dryRun: run.dryRun });
      return true;
    } finally { run.busy = false; }
  };

  /** Asks the decision model through the run's page, which calls the backend (keys stay there). */
  const askModel = (run, message) => new Promise(resolve => {
    if (!active(run, run.generation) || run.owner.isDestroyed()) { resolve({ ok: false, error: 'decision_cancelled' }); return; }
    if (run.requestCount >= run.maxRequests) { void endRun(run, 'request_limit'); resolve({ ok: false, error: 'request_limit' }); return; }
    run.requestCount++;
    const requestId = randomUUID();
    const model = message.model || message.vision;
    const timeout = model.source === 'local' && (message.type === 'describe' || model.protocol !== 'systemone') ? 30_000
      : message.type === 'describe' ? 20_000 : 10_000;
    const deadlineAt = Date.now() + timeout;
    const request = { resolve, runId: run.id, owner: run.owner.id, model, kind: message.type, deadlineAt };
    request.timer = setTimeout(() => cancelRequest(run, requestId, request, 'decision_timeout'), timeout + DECISION_MARGIN_MS);
    decisions.set(requestId, request);
    log(run, { kind: 'request', requestId, type: message.type, deadlineAt });
    send(run, { ...message, requestId, runId: run.id, deadlineAt });
  });

  const frameImage = (frame, maxWidth = 768) => {
    try {
      const image = nativeImage.createFromBitmap(frame.data, { width: frame.width, height: frame.height });
      const scaled = frame.width > maxWidth ? image.resize({ width: maxWidth }) : image;
      return `data:image/jpeg;base64,${scaled.toJPEG(72).toString('base64')}`;
    } catch { return ''; }
  };

  const decide = async (run, due, signals, frame) => {
    const generation = run.generation;
    run.pending = true;
    const now = Date.now();
    for (const decision of due) run.decidedAt.set(decision.id, now);
    try {
      const stateText = core.renderState(run.manifest, { goal: run.goal, signals, params: run.params, history: run.history, vision: run.vision, locale: run.locale });
      const questions = core.buildQuestions(run.manifest, due, run.locale);
      const images = run.model.images && run.manifest.perception.vision !== 'none' && frame ? [frameImage(frame)].filter(Boolean) : [];
      const result = await askModel(run, { type: 'decide', model: run.model, state: stateText, questions, images });
      if (!active(run, generation)) return;
      run.decisionCount++;
      if (!result?.ok) {
        run.decisionFailures++;
        run.lastError = String(result?.error || 'decision_failed');
        run.lastModelError = modelFailureSnapshot(result?.readableError);
        run.lastModelErrorCode = run.lastError;
        run.lastModelErrorOrigin = 'decision';
        log(run, { kind: 'decision_failed', error: run.lastError });
        if (run.decisionFailures === 3) reportEvent(run, 'decision_failed', `The decision model failed 3 times (${run.lastError}).`, { pause: true });
        return;
      }
      run.decisionFailures = 0;
      if (run.lastModelErrorCode === run.lastError && run.lastModelErrorOrigin === 'decision') {
        run.lastError = ''; run.lastModelError = undefined;
      }
      const answers = core.readAnswers(result.payload, due);
      // Jev returns finite choices; plugins map those choices to declared points locally.
      // Store all heads first so an action can aim using another head from this response.
      for (const decision of due) {
        run.decisionTargets.delete(decision.id);
        const answer = answers[decision.id];
        if (decision.type === 'choice' && answer && answer.confidence >= decision.minConfidence && decision.targets?.[answer.choice] !== undefined) {
          run.decisionTargets.set(decision.id, { point: decision.targets[answer.choice], at: Date.now(), maxAgeMs: decision.everyMs * 2 });
        }
      }
      for (const decision of due) {
        if (!active(run, generation)) return;
        const answer = answers[decision.id];
        log(run, { kind: 'decision', id: decision.id, answer: answer || null, ms: result.latencyMs });
        if (decision.type === 'choice') {
          run.lastDecision = { id: decision.id, choice: answer?.choice || '', confidence: answer?.confidence ?? 0, at: Date.now(), latencyMs: result.latencyMs || 0 };
          const action = answer && answer.confidence >= decision.minConfidence ? answer.choice : decision.fallback;
          if (action && !run.busy) await perform(run, action, 'decision', generation);
        } else if (decision.type === 'yesno') {
          if (answer && decision.report !== undefined && answer.yes >= decision.report) reportEvent(run, `decision:${decision.id}`, `${decision.question} (${Math.round(answer.yes * 100)}%)`);
        } else if (answer && decision.report !== undefined && decision.levels.indexOf(answer.choice) >= decision.levels.indexOf(decision.report)) {
          reportEvent(run, `decision:${decision.id}`, `${decision.question} → ${answer.choice}`);
        }
      }
    } finally { run.pending = false; }
  };

  const describeScreen = async (run, frame) => {
    const generation = run.generation;
    run.visionAt = Date.now();
    const result = await askModel(run, { type: 'describe', vision: run.visionModel, image: frameImage(frame, 1024), hints: run.manifest.perception.visionHints });
    if (!active(run, generation)) return;
    if (result?.ok && typeof result.text === 'string') {
      run.vision = result.text.slice(0, 600);
      if (run.lastModelErrorOrigin === 'vision' && run.lastModelErrorCode === run.lastError) {
        run.lastError = ''; run.lastModelError = undefined;
      }
    } else if (!result?.ok) {
      run.vision = '';
      run.lastError = String(result?.error || 'vision_failed');
      run.lastModelError = modelFailureSnapshot(result?.readableError);
      run.lastModelErrorCode = run.lastError;
      run.lastModelErrorOrigin = 'vision';
      log(run, { kind: 'vision_failed', error: run.lastError });
      emitStatus(run, true);
    }
  };

  const tick = async run => {
    if (run.ended) return;
    const started = Date.now();
    try {
      if (started - run.startedAt >= run.maxMs) { await endRun(run, 'time_limit'); return; }
      if (run.maxCostUsd && run.cost >= run.maxCostUsd) { await endRun(run, 'cost_limit'); return; }
      if (!run.paused) {
        const generation = run.generation;
        const frameWidth = Math.max(1280, Math.min(2048, run.manifest.display?.width || 1280));
        const frame = await view.frame(run.conversationId, run.pid, run.windowId, frameWidth);
        if (!active(run, generation)) return;
        if (!frame?.ok) {
          run.frameFailures++;
          run.lastError = String(frame?.error || 'frame_failed');
          if (run.frameFailures >= 12) { await endRun(run, frame?.error === 'window_not_viewable' ? 'window_closed' : 'window_unavailable'); return; }
        } else {
          run.frameFailures = 0;
          const signals = core.perceive(frame, run.manifest, run.templates, run.memory);
          // Text is read at its own pace (recognition takes 30–120 ms) and kept between reads.
          const dueText = run.manifest.perception.signals.filter(signal => signal.type === 'text' && started - (run.textAt.get(signal.id) || 0) >= signal.everyMs);
          if (dueText.length && view.recognizeText) {
            for (const signal of dueText) run.textAt.set(signal.id, started);
            // One recognition call per language setting and at most 16 regions (the native reader's limit): a
            // signal is never read in another signal's language or silently dropped past the 16th (audit B16-04).
            const batches = new Map();
            for (const signal of dueText) {
              const key = JSON.stringify(signal.languages || []);
              const list = batches.get(key) || [];
              if (!list.length || list.at(-1).length >= 16) list.push([]);
              list.at(-1).push(signal);
              batches.set(key, list);
            }
            for (const group of [...batches.values()].flat()) {
              const uniqueRects = [];
              const rectIndexBySignal = [];
              for (const signal of group) {
                const rKey = signal.rect.join(',');
                let rIdx = uniqueRects.findIndex(item => item.key === rKey);
                if (rIdx < 0) {
                  rIdx = uniqueRects.length;
                  uniqueRects.push({ key: rKey, rect: signal.rect });
                }
                rectIndexBySignal.push(rIdx);
              }
              const read = await view.recognizeText(frame, uniqueRects.map(item => item.rect), group[0].languages);
              if (!active(run, generation)) return;
              // A region without a result keeps its last reading instead of turning into an empty text.
              if (read?.ok) group.forEach((signal, index) => {
                const rIdx = rectIndexBySignal[index];
                if (typeof read.texts?.[rIdx] === 'string') {
                  run.text.set(signal.id, core.readText(signal, read.texts[rIdx], read.boxes?.[rIdx]));
                }
              });
            }
          }
          for (const signal of run.manifest.perception.signals) if (signal.type === 'text') signals[signal.id] = run.text.get(signal.id) ?? null;
          run.lastSignals = signals;
          const ctx = context(run, signals);
          if (run.manifest.limits.compiledStop && core.truthy(core.evaluate(run.manifest.limits.compiledStop, ctx))) { await endRun(run, 'stop_condition'); return; }
          for (const event of run.manifest.events) {
            if (core.truthy(core.evaluate(event.compiled, ctx))) reportEvent(run, event.id, core.localize(event.message, run.locale), event);
            if (run.ended) return;
          }
          if (!run.paused) {
            // A reflex is immediate and never waits for a model; the decision cadence continues in the background.
            const reflex = !run.busy && run.manifest.reflexes.find(item => core.truthy(core.evaluate(item.compiled, ctx))
              && !(run.manifest.actions[item.do].cooldownMs && Date.now() - (run.lastActionAt.get(item.do) ?? -Infinity) < run.manifest.actions[item.do].cooldownMs));
            if (reflex) await perform(run, reflex.do, 'reflex');
            else if (!run.pending && run.model) {
              // A plugin that needs the screen described decides only with a current description: none yet, or the
              // last one failed, means no action instead of acting blind (audit A14-03).
              const blind = run.manifest.perception.vision === 'required' && run.visionModel && !run.vision;
              const due = blind ? [] : run.manifest.decisions.filter(decision => Date.now() - (run.decidedAt.get(decision.id) || 0) >= decision.everyMs);
              if (due.length) void decide(run, due, signals, frame);
            }
            if (run.visionModel && !run.visionPending && Date.now() - run.visionAt >= run.manifest.perception.visionEveryMs) {
              run.visionPending = true;
              void describeScreen(run, frame).finally(() => { run.visionPending = false; });
            }
          }
        }
      }
      emitStatus(run);
    } catch (error) {
      run.lastError = String(error?.code || error?.message || 'tick_failed').slice(0, 120);
      log(run, { kind: 'error', error: run.lastError });
    } finally {
      if (!run.ended) run.timer = setTimeout(() => void tick(run), Math.max(10, run.manifest.perception.tickMs - (Date.now() - started)));
    }
  };

  ipcMain.handle('nextmux:plugins:start', async (event, request) => {
    if (!trusted(event) || !request || typeof request !== 'object') return { ok: false, error: 'untrusted' };
    await load();
    const { conversationId, tabId } = request;
    const pid = Number(request.pid), windowId = Number(request.windowId);
    if (!identifier(conversationId) || typeof tabId !== 'string' || !tabId || tabId.length > 200 || !pluginId(request.pluginId)) return { ok: false, error: 'request_invalid' };
    if (!view?.canView(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
    const record = state.plugins[request.pluginId];
    if (!record) return { ok: false, error: 'plugin_missing' };
    if (installing.has(request.pluginId)) return { ok: false, error: 'plugin_running' };
    // A paid plugin runs only with a valid license (renewed by the app before it expires). The app also reports when
    // it found that a locally added plugin's id is sold in the marketplace.
    if (request.gate?.paid === true && !record.paid) { record.paid = true; await save(); }
    if (record.paid) {
      const fresh = licenseOf(request.gate?.license);
      // The newest license the app just fetched for the signed-in account replaces the stored one (another account's too).
      if (licensed(fresh, request.pluginId) && (fresh.userId !== record.license?.userId || fresh.expiresAt > (record.license?.expiresAt || 0))) { record.license = fresh; await save(); }
      if (!licensed(record.license, request.pluginId)) return { ok: false, error: 'plugin_purchase_required' };
    }
    if ([...runs.values()].some(run => !run.ended && run.pid === pid && run.windowId === windowId)) return { ok: false, error: 'plugin_already_running' };
    if ([...runs.values()].filter(run => !run.ended).length >= MAX_RUNS) return { ok: false, error: 'too_many_runs' };
    let plugin;
    try { plugin = await loadPlugin(request.pluginId); } catch (error) { return { ok: false, error: 'plugin_invalid', errors: error.errors, diagnostics: errorDiagnostics(error) }; }
    const { manifest } = plugin;
    const needsModel = manifest.decisions.length > 0;
    if (needsModel && !loadDecisionAdapter()) return { ok: false, error: 'plugin_runtime_unavailable' };
    if (needsModel && !record.model) return { ok: false, error: 'plugin_model_required' };
    const modelCompatibilityError = record.model ? decisionPluginCompatibility(record.model, manifest.decisions) : '';
    if (modelCompatibilityError) return { ok: false, error: modelCompatibilityError };
    const capabilityErrors = inputCompatibility(manifest, platform, input.capabilities);
    if (capabilityErrors.length) return { ok: false, error: capabilityErrors[0].split(': ').at(-1), errors: capabilityErrors };
    if (manifest.perception.vision === 'required' && !record.model?.images && !record.vision) return { ok: false, error: 'plugin_vision_model_required' };
    if (request.params && typeof request.params === 'object') {
      try {
        record.params = await hydrateParamInput(manifest, record.params, request.params);
      } catch (error) {
        return { ok: false, error: error?.code || 'plugin_file_invalid' };
      }
      await save();
    }
    const runParams = resolveParams(manifest, record.params);
    const identity = await identify(pid, platform, windowId);
    if (event.sender.isDestroyed()) return { ok: false, error: 'page_closed' };
    if (!view?.canView(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
    if ([...runs.values()].some(run => !run.ended && run.pid === pid && run.windowId === windowId)) return { ok: false, error: 'plugin_already_running' };
    if (!appMatches(manifest, identity, request.title, platform, request.windowTitle)) return { ok: false, error: 'plugin_app_mismatch', app: identity.bundleId || identity.program || identity.appId || '' };
    // Games only take keys when in front; an app that takes background input keeps the user's focus.
    const modes = platform === 'win32' && manifest.input.modes.length === 1 && manifest.input.modes[0] === 'background'
      ? ['foreground'] : manifest.input.modes;
    if (platform === 'win32' && manifest.perception.signals.some(signal => signal.type === 'text') && typeof view.ready === 'function') {
      const capabilities = await view.ready();
      if (!capabilities.ocr) return { ok: false, error: 'ocr_language_unavailable', ocrLanguages: capabilities.ocrLanguages || [] };
    }
    // Only a mode the plugin declares and this computer can run: there is no VM
    // runner here, so a VM-only plugin never falls back to the host app (audit DS-07).
    const runnable = modes.filter(item => item === 'foreground' || item === 'background' && platform !== 'win32');
    if (!runnable.length) return { ok: false, error: 'plugin_input_mode_unsupported' };
    const mode = runnable.includes(request.mode) ? request.mode : runnable.includes('background') ? 'background' : 'foreground';
    // The plugin may have been replaced or removed while the app was identified (audit DS-09).
    if (state.plugins[request.pluginId] !== record) return { ok: false, error: 'plugin_missing' };
    // Everything the awaits above could have changed is checked again here, with no await between this check and
    // the run being registered: the page, the window, another run on it and the run limit (audit B16-03).
    if (event.sender.isDestroyed()) return { ok: false, error: 'page_closed' };
    if (!view?.canView(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
    if ([...runs.values()].some(run => !run.ended && run.pid === pid && run.windowId === windowId)) return { ok: false, error: 'plugin_already_running' };
    if ([...runs.values()].filter(run => !run.ended).length >= MAX_RUNS) return { ok: false, error: 'too_many_runs' };
    if (record.paid && !licensed(record.license, request.pluginId)) return { ok: false, error: 'plugin_purchase_required' };
    if (needsModel && !record.model) return { ok: false, error: 'plugin_model_required' };
    const currentModelCompatibilityError = record.model ? decisionPluginCompatibility(record.model, manifest.decisions) : '';
    if (currentModelCompatibilityError) return { ok: false, error: currentModelCompatibilityError };
    if (manifest.perception.vision === 'required' && !record.model?.images && !record.vision) return { ok: false, error: 'plugin_vision_model_required' };
    const maxMinutes = Math.max(1, Math.min(manifest.limits.maxRunMinutes, Number(request.maxMinutes) || manifest.limits.maxRunMinutes));
    const maxCostUsd = Number.isFinite(Number(request.maxCostUsd)) && Number(request.maxCostUsd) > 0 ? Math.min(100, Number(request.maxCostUsd)) : 1;
    const locale = typeof request.locale === 'string' && core.LOCALES.includes(request.locale) ? request.locale : 'en';
    const run = {
      id: `run-${randomUUID()}`, conversationId, tabId, pid, windowId, pluginId: manifest.id, name: core.localize(manifest.name, locale), manifest,
      templates: plugin.templates, params: runParams, rawParams: record.params, paramCursor: new Map(), model: record.model || null, visionModel: record.vision || null, locale, mode,
      goal: typeof request.goal === 'string' && request.goal.trim() ? request.goal.trim().slice(0, 400) : manifest.goals.default,
      dryRun: request.dryRun === true, overlay: request.overlay === true, handOff: request.handOff !== false,
      owner: event.sender, ownerId: event.sender.id, startedAt: Date.now(), maxMs: maxMinutes * 60_000, maxCostUsd, cost: 0,
      generation: 0, inputController: new AbortController(), costUnknown: !priced(record.model) || !priced(record.vision), requestCount: 0,
      costSources: { decide: priced(record.model), describe: priced(record.vision) }, unknownReceipt: false,
      maxRequests: Number.isInteger(request.maxRequests) && request.maxRequests > 0 ? Math.min(MAX_REQUESTS, request.maxRequests) : MAX_REQUESTS,
      history: [], lastActionAt: new Map(), decidedAt: new Map(), decisionTargets: new Map(), held: new Map(), memory: {}, text: new Map(), textAt: new Map(), eventAt: new Map(),
      events: [], log: [], recent: [], actionCount: 0, decisionCount: 0, frameFailures: 0, inputFailures: 0, decisionFailures: 0,
      pending: false, busy: false, paused: false, ended: '', statusAt: 0, visionAt: 0, vision: '', visionPending: false
    };
    if (incognito?.closed(conversationId)) return { ok: false, error: 'incognito_session_closed' };
    runs.set(run.id, run);
    log(run, { kind: 'started', goal: run.goal, dryRun: run.dryRun, mode, model: run.model?.model || 'reflex-only' });
    updateShortcut();
    run.ownerDestroyed = () => {
      if ([...decisions.values()].some(request => request.runId === run.id && request.model.source !== 'local')) {
        run.costUnknown = run.unknownReceipt = true;
        log(run, { kind: 'unsettled_cost', reason: 'page_closed' });
      }
      if (!run.ended) void endRun(run, 'page_closed');
    };
    event.sender.once('destroyed', run.ownerDestroyed);
    void tick(run);
    return { ok: true, runId: run.id, mode, maxMinutes, maxCostUsd, stopShortcut: shortcut || '' };
  });

  const ownRun = (event, runId) => {
    const run = typeof runId === 'string' ? runs.get(runId) : undefined;
    return run && run.ownerId === event.sender.id ? run : undefined;
  };
  ipcMain.handle('nextmux:plugins:command', async (event, runId, command) => {
    const run = trusted(event) ? ownRun(event, runId) : undefined;
    if (!run || run.ended) return { ok: false, error: 'run_missing' };
    const hasGoal = typeof command?.goal === 'string' && Boolean(command.goal.trim());
    if (hasGoal) {
      run.goal = command.goal.trim().slice(0, 400);
      log(run, { kind: 'goal', goal: run.goal });
      invalidate(run);
      run.decidedAt.clear();
    }
    if (command?.params && typeof command.params === 'object') {
      const record = state.plugins[run.pluginId];
      // A tab's edit starts from that run's own options, so another tab's later edits never leak into it.
      let nextParams;
      try {
        nextParams = await hydrateParamInput(run.manifest, run.rawParams || run.params, command.params);
      } catch (error) {
        return { ok: false, error: error?.code || 'plugin_file_invalid' };
      }
      run.rawParams = nextParams;
      run.params = nextParams;
      restartFileCursors(run, command.params);
      if (record) {
        // Only the edited options become the saved choice; the other saved defaults stay as they were.
        const edited = Object.fromEntries(Object.entries(nextParams).filter(([key]) => Object.hasOwn(command.params, key)));
        record.params = resolveParams(run.manifest, { ...(record.params || {}), ...edited });
        await save();
      }
    }
    if (command?.resume === true || hasGoal) { run.paused = false; run.decisionFailures = 0; run.decidedAt.clear(); }
    if (command?.pause === true) pauseRun(run);
    if (typeof command?.overlay === 'boolean') run.overlay = command.overlay;
    emitStatus(run, true);
    return { ok: true, ...snapshotOf(run) };
  });
  ipcMain.handle('nextmux:plugins:status', (event, runId) => {
    const run = trusted(event) ? ownRun(event, runId) : undefined;
    return run ? { ok: true, ...snapshotOf(run) } : { ok: false, error: 'run_missing' };
  });
  ipcMain.handle('nextmux:plugins:stop', async (event, runId) => {
    const run = trusted(event) ? ownRun(event, runId) : undefined;
    if (!run) return { ok: false, error: 'run_missing' };
    await endRun(run, 'stopped');
    return { ok: true, ...snapshotOf(run) };
  });
  ipcMain.handle('nextmux:plugins:runs', event => trusted(event)
    ? [...runs.values()].filter(run => run.ownerId === event.sender.id).map(snapshotOf) : []);
  ipcMain.handle('nextmux:plugins:answer', (event, requestId, result) => {
    if (!trusted(event) || typeof requestId !== 'string') return false;
    const request = decisions.get(requestId);
    if (!request || request.owner !== event.sender.id) return false;
    const run = runs.get(request.runId);
    if (run && !request.cancelled && Date.now() > request.deadlineAt) cancelRequest(run, requestId, request, 'decision_timeout');
    decisions.delete(requestId);
    clearTimeout(request.timer);
    if (run) {
      const known = Number.isFinite(result?.costUsd) && result.costUsd >= 0;
      if (known) {
        run.cost += result.costUsd;
        // A cancelled old route can still be billed, but it cannot price a newly selected route.
        if (request.model === (request.kind === 'decide' ? run.model : run.visionModel)) run.costSources[request.kind] = true;
      }
      if (result?.costStatus === 'unknown' || result?.ok && !known && request.model.source !== 'local') run.unknownReceipt = true;
      run.costUnknown = run.unknownReceipt || Object.values(run.costSources).some(value => !value);
      log(run, { kind: 'cost', requestId, late: Boolean(request.cancelled), costUsd: result?.costUsd, costStatus: result?.costStatus });
      emitStatus(run, true);
      if (run.ended) void saveRun(run);
      else if (run.maxCostUsd && run.cost >= run.maxCostUsd) void endRun(run, 'cost_limit');
    }
    request.resolve(result && typeof result === 'object' ? result : { ok: false, error: 'decision_failed' });
    return true;
  });

  return {
    /** Human input is informational: it never takes control of a run or of the input switch. */
    onUserIntervention(pid, windowId, reason = 'user_input') {
      for (const run of runs.values()) if (!run.ended && run.pid === Number(pid) && run.windowId === Number(windowId)) {
        reportEvent(run, reason, String(run.locale).startsWith('zh') ? '键鼠已开启，你可随时介入操作，插件将继续运行'
          : 'Keyboard & mouse active: you can intervene at any time while the plugin continues running.', { pause: false, stop: false });
        emitStatus(run, true);
      }
    },
    /** A launcher acquired its real window: discard old-window work and continue on the new one. */
    rebindWindow(conversationId, oldPid, oldWindowId, newPid, newWindowId, title) {
      const pid = Number(newPid), windowId = Number(newWindowId);
      if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0) return false;
      const run = [...runs.values()].find(item => !item.ended && item.conversationId === conversationId
        && item.pid === Number(oldPid) && item.windowId === Number(oldWindowId));
      if (!run || [...runs.values()].some(item => item !== run && !item.ended && item.pid === pid && item.windowId === windowId)) return false;
      if (run.pid === pid && run.windowId === windowId) return true;
      invalidate(run);
      run.pid = pid;
      run.windowId = windowId;
      run.decidedAt.clear();
      resetPerception(run);
      log(run, { kind: 'window_rebound', pid, windowId, title: text(title, 200) });
      emitStatus(run, true);
      return true;
    },
    /** A tab's window closed or its tab went away: its run stops. */
    stopForWindow(pid, windowId, reason = 'window_closed') { for (const run of runs.values()) if (!run.ended && run.pid === pid && run.windowId === windowId) void endRun(run, reason); },
    async stopForConversations(ids) {
      const selected = new Set(ids);
      await Promise.all([...runs.values()].filter(run => selected.has(run.conversationId)).map(run => endRun(run, 'exit_incognito')));
    },
    running(pid, windowId) { return [...runs.values()].some(run => !run.ended && run.pid === pid && run.windowId === windowId); },
    async dispose() { await Promise.allSettled([...runs.values()].map(run => endRun(run, 'quit'))); updateShortcut(); }
  };
}

module.exports = { registerAppPlugins, normalizeModel, normalizeVision, appMatches, inputCompatibility, licenseValid, sealFiles, openSealed, fingerprintOf };
