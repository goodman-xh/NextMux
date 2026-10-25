'use strict';

// Reuse Qwen's typed ComputerUse facade and EmbeddedCuaDriverHost. NM owns only
// admission, conversation/window ownership and its existing Electron IPC boundary.
const { existsSync, readFileSync, statSync, realpathSync } = require('node:fs');
const { join, isAbsolute, normalize } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { release } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const VERSION = '0.20.9';
// A conversation that stops calling computer tools must not keep the native
// driver (and its accessibility/screen observers) alive. The renderer's
// run-end release is the primary path. This lease is only the fallback for
// runs that end without it (renderer crash, lost handoff): it is long, and the
// renderer renews it (`nextmux:computer:keepalive`) while the conversation's
// run is active, so a model thinking for minutes between observe and click
// keeps its snapshot, element tokens and window claim.
const SESSION_IDLE_RELEASE_MS = 15 * 60_000;
const actions = {
  listApps: [], listWindows: ['pid', 'onScreenOnly'], openApp: ['selector'],
  observeWindow: ['pid', 'windowId', 'includeScreenshot', 'disableDiff', 'maxTextChars', 'maxElements', 'maxDepth'],
  verifyState: ['pid', 'windowId', 'expect', 'timeoutMs', 'stableSamples'],
  click: ['pid', 'windowId', 'elementToken', 'x', 'y', 'button', 'count'],
  doubleClick: ['pid', 'windowId', 'elementToken', 'x', 'y'],
  rightClick: ['pid', 'windowId', 'elementToken', 'x', 'y', 'modifier'],
  scroll: ['pid', 'windowId', 'elementToken', 'x', 'y', 'direction', 'by', 'amount'],
  drag: ['pid', 'windowId', 'fromX', 'fromY', 'toX', 'toY', 'durationMs', 'steps', 'button', 'modifier'],
  setValue: ['pid', 'windowId', 'elementToken', 'value'],
  typeText: ['pid', 'windowId', 'elementToken', 'text', 'delayMs'],
  pressKey: ['pid', 'windowId', 'elementToken', 'key', 'modifiers'],
  hotkey: ['pid', 'windowId', 'elementToken', 'keys']
};
const reads = new Set(['listApps', 'listWindows', 'observeWindow', 'verifyState']);
const identifier = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const fail = code => { throw Object.assign(Error(code), { code }); };
// Qwen 0.20.9 exposes both ComputerUseError.code and UniFFI
// DriverError.tag/inner. Keep only typed facts; messages, reasons and raw
// result bodies may contain application text and must not leave this boundary.
const driverErrorCodes = Object.freeze({
  Configuration: 'computer_driver_configuration', InvalidArguments: 'computer_driver_invalid_arguments',
  Transport: 'computer_driver_transport', Protocol: 'computer_driver_protocol', Tool: 'computer_driver_tool',
  Shutdown: 'computer_driver_shutdown', RuntimeAlreadyExists: 'computer_driver_runtime_exists',
  Worker: 'computer_driver_worker', Remote: 'computer_driver_remote', ActionInterrupted: 'computer_action_interrupted'
});
const stableCode = value => typeof value === 'string' && /^[a-z_\d]{1,100}$/i.test(value) ? value : undefined;
const abortReason = code => Object.assign(new Error(code), { name: 'AbortError', code });
const priorityAbortCodes = new Set(['interrupted_by_user_esc', 'computer_window_closed']);
const extractPriorityCode = value => {
  if (!value) return undefined;
  if (typeof value === 'string') return priorityAbortCodes.has(value) ? value : undefined;
  if (typeof value === 'object') {
    for (const candidate of [
      value.code, value.message,
      value.reason?.code, value.reason?.message,
      value.cause?.code, value.cause?.message,
      value.details?.cause?.code, value.details?.cause?.message,
      value.inner?.errorCode, value.inner?.reason, value.inner?.message
    ]) {
      if (typeof candidate === 'string' && priorityAbortCodes.has(candidate)) return candidate;
    }
  }
  return undefined;
};
const isUserSource = input => input?.source === 'user' || (input?.source === undefined && input?.restore !== true);
// Only the AI's own control is refused after the user's Esc: the user's input never is, and a plugin run is paused by
// Esc through its own takeover path (its user resumes it explicitly).
const isAgentInput = input => input?.source === 'agent' || (input?.source === undefined && input?.restore === true);
// Only an explicit model or plugin action lights the "NextMux is controlling the computer" frame and counts as recent
// activity. The user's own clicks, a tab's live picture, passive checks and legacy calls without a source never do, so
// opening a past conversation or touching an app in its tab cannot look like the AI taking over (UI-TARS Desktop and
// Anthropic's computer-use reference show the indicator only for agent actions).
const showsAutomationActivity = input => input?.source === 'agent' || input?.source === 'plugin';
// A conversation that acted within this window of the frame is the one Esc stops.
const ESC_RECENT_ACTIVITY_MS = 2_000;
const typedDriverError = error => Object.hasOwn(driverErrorCodes, error?.tag) ? error
  : Object.hasOwn(driverErrorCodes, error?.details?.cause?.tag) ? error.details.cause : undefined;
const safeCode = (error, signal) => {
  const priority = (signal?.aborted ? extractPriorityCode(signal.reason) : undefined) || extractPriorityCode(error);
  if (priority) return priority;
  const driver = typedDriverError(error);
  const direct = stableCode(error?.code) || stableCode(error?.cause?.code) || (signal?.aborted ? stableCode(signal.reason?.code) : undefined);
  if (direct && !['abort_err', 'aborted', 'err_aborted'].includes(direct.toLowerCase())) return direct;
  return (driver?.tag === 'Tool' ? stableCode(driver.inner?.errorCode) : undefined)
    || (driver ? driverErrorCodes[driver.tag] : undefined)
    || (error?.name === 'AbortError' ? 'cancelled' : 'computer_operation_failed');
};
function computerFailure(request, error, phase = 'host', platform, signal) {
  const driver = typedDriverError(error);
  const diagnostic = { phase, source: driver ? 'driver' : error?.name === 'ComputerUseError' ? 'computer_use' : 'host' };
  if (driver) diagnostic.driverTag = driver.tag;
  // ActionCompletion is the SDK enum: NotStarted=0, Completed=1, Unknown=2.
  // Completed describes native dispatch, not a verified application result.
  if (driver?.tag === 'ActionInterrupted' && [0, 1, 2].includes(driver.inner?.completion)) {
    diagnostic.completion = ['not_started', 'completed', 'unknown'][driver.inner.completion];
  }
  const operation = error?.details?.operation;
  if (operation && typeof operation === 'object') {
    const facts = Object.fromEntries(['dispatched', 'committed', 'cancellationRequested']
      .filter(key => typeof operation[key] === 'boolean').map(key => [key, operation[key]]));
    if (Object.keys(facts).length) diagnostic.operation = facts;
  }
  // Qwen 0.20.9 drops the native code from this exact AXPress error. Apple
  // documents that CannotComplete may occur after the action took effect.
  // Classify only this verified SDK branch; never turn it into success/retry.
  const axUnconfirmed = platform === 'darwin' && phase === 'native_call' && request?.action === 'click'
    && error?.name === 'ComputerUseError' && error.code === undefined
    && error.message === 'AX action failed: AXUIElementPerformAction(AXPress) returned -25204'
    && operation?.dispatched === true && operation.cancellationRequested === false;
  if (axUnconfirmed) { diagnostic.nativeCode = -25204; diagnostic.nativeAction = 'AXPress'; }
  const code = axUnconfirmed ? 'computer_ax_action_unconfirmed' : safeCode(error, signal);
  if (Object.hasOwn(actions, request?.action) && !reads.has(request.action)) diagnostic.nextAction = 'observe_before_action';
  return {
    requestId: typeof request === 'string' ? request : typeof request?.id === 'string' ? request.id : '',
    ok: false,
    error: code,
    ...(code === 'interrupted_by_user_esc' ? { userInterrupted: true } : {}),
    diagnostic
  };
}

const publicValue = value => value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const macAppPath = value => {
  if (typeof value !== 'string' || !isAbsolute(value)) return undefined;
  try { return realpathSync(value); } catch { return normalize(value).replace(/\/+$/, ''); }
};

// Public predicates use the Rust JSON schema. The installed 0.20.9 UniFFI
// records instead read camelCase JS fields; passing snake_case through drops
// these values silently (a label-only selector then becomes invalid).
function sdkVerificationPredicates(expect) {
  const rename = (value, from, to) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, from)) return value;
    const { [from]: field, ...rest } = value;
    return { ...rest, [to]: field };
  };
  if (!Array.isArray(expect)) return expect;
  return expect.map(predicate => {
    if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) return predicate;
    const next = { ...predicate };
    if (predicate.element && typeof predicate.element === 'object' && !Array.isArray(predicate.element)) {
      next.element = { ...rename(predicate.element, 'value_equals', 'valueEquals'),
        selector: rename(predicate.element.selector, 'label_contains', 'labelContains') };
    }
    if (predicate.window && typeof predicate.window === 'object' && !Array.isArray(predicate.window) && predicate.window.bounds) {
      next.window = { ...predicate.window, bounds: rename(predicate.window.bounds, 'tolerance_px', 'tolerancePx') };
    }
    return next;
  });
}

function parseObservedElements(rawElements) {
  const tokens = new Set();
  const elements = new Map();
  for (const element of Array.isArray(rawElements) ? rawElements : []) {
    const token = element?.element_token ?? element?.elementToken ?? element?.token ?? element?.id;
    if (typeof token !== 'string' || !token) continue;
    tokens.add(token);
    const box = (element.frame && typeof element.frame === 'object') ? element.frame
      : (element.bounds && typeof element.bounds === 'object') ? element.bounds
        : (element.rect && typeof element.rect === 'object') ? element.rect : element;
    const x = Number(box?.x), y = Number(box?.y);
    const width = Number(box?.width ?? box?.w), height = Number(box?.height ?? box?.h);
    const label = typeof element.label === 'string' ? element.label
      : typeof element.name === 'string' ? element.name
        : typeof element.title === 'string' ? element.title : undefined;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
      elements.set(token, {
        x, y, width, height,
        ...(typeof element.role === 'string' ? { role: element.role } : {}),
        ...(label !== undefined ? { label } : {})
      });
    }
  }
  return { tokens, elements };
}

function resolveElementPoint(observation, token, platform) {
  const element = observation?.elements?.get?.(token);
  if (!element || !Number.isFinite(element.x) || !Number.isFinite(element.y)
    || !Number.isFinite(element.width) || !Number.isFinite(element.height)
    || element.width <= 0 || element.height <= 0) {
    fail('computer_element_unlocatable');
  }
  const size = platform === 'win32'
    ? (observation?.fallbackScreenshotSize || observation?.screenshotSize)
    : observation?.screenshotSize;
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    fail('computer_element_unlocatable');
  }
  const context = observation?.context;
  if (context?.screenshotFrameValid === false) fail('computer_element_unlocatable');
  const bounds = context?.windowBounds;
  const originX = bounds !== undefined ? Number(bounds?.x) : 0;
  const originY = bounds !== undefined ? Number(bounds?.y) : 0;
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) fail('computer_element_unlocatable');
  if (bounds !== undefined && ((bounds?.width !== undefined && (!Number.isFinite(Number(bounds.width)) || Number(bounds.width) <= 0))
    || (bounds?.height !== undefined && (!Number.isFinite(Number(bounds.height)) || Number(bounds.height) <= 0)))) {
    fail('computer_element_unlocatable');
  }
  const scale = context?.screenshotScale !== undefined
    ? Number(context.screenshotScale)
    : (Number(bounds?.width) > 0 ? size.width / Number(bounds.width) : 1);
  if (!Number.isFinite(scale) || scale <= 0) fail('computer_element_unlocatable');
  const px = (element.x + element.width / 2 - originX) * scale;
  const py = (element.y + element.height / 2 - originY) * scale;
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= size.width || py >= size.height) {
    fail('computer_element_unlocatable');
  }
  return { x: px, y: py, size };
}

class ComputerAutomation {
  constructor({ app, systemPreferences, platform = process.platform, architecture = process.arch, sdkLoader, resourcesPath, idleReleaseMs = SESSION_IDLE_RELEASE_MS, overlay, view, windowsInput, windowsApps, launchMacApp, isBuiltinProcess, killProcess = (pid, signal) => process.kill(pid, signal) } = {}) {
    this.app = app; this.preferences = systemPreferences; this.platform = platform; this.architecture = architecture;
    // Screen frame shown while the AI controls the computer (computer-overlay.cjs); optional.
    this.overlay = overlay;
    // Live window view in the conversation's tab and the window's placement (computer-window-view.cjs); optional.
    this.view = view;
    this.windowsInput = windowsInput;
    this.windowsApps = windowsApps;
    this.killProcess = killProcess;
    this.isBuiltinProcess = isBuiltinProcess || (pid => pid === process.pid);
    this.launchMacApp = launchMacApp || ((path, signal) => promisify(execFile)('/usr/bin/open', ['-g', '-a', path], { signal, timeout: 10000, maxBuffer: 8192 }));
    this.tabControllers = new Map();
    this.userEscInterrupted = new Set();
    this.closedWindows = new Set();
    this.activeConversations = new Map();
    this.activityAt = new Map();
    // "NextMux-N" per conversation for the life of this process: the driver's cursor badge and the frame's pill.
    this.sessionLabels = new Map();
    // Keys NextMux itself is sending (the AI, a plugin, the tab's keyboard): Esc from them is not the user's stop.
    this.syntheticKeys = 0; this.syntheticKeyAt = 0;
    this.idleReleaseMs = Math.max(1, Number(idleReleaseMs) || SESSION_IDLE_RELEASE_MS);
    this.runtimeRoot = join(resourcesPath || (app?.isPackaged ? process.resourcesPath : join(__dirname, 'build-resources')), 'computer-runtime', `${platform}-${architecture}`);
    this.sdkLoader = sdkLoader; this.sessions = new Map(); this.windows = new Map(); this.operations = new Map();
    // The pinned Windows SDK caches screenshot resizing by PID, not HWND.
    this.windowsScreenshotTargets = new Map();
    this.host = undefined; this.loading = undefined; this.foregroundQueue = Promise.resolve(); this.closed = false; this.generation = 0;
    this.hostShutdowns = new WeakMap(); this.stoppingHosts = new Set(); this.failedHosts = new Set();
    this.pendingLoads = new Set(); this.closingClients = new Set();
  }
  nativeInput() { return this.windowsInput ??= require('./computer-input-windows.cjs').createWindowsInput(); }
  installedApps() { return this.windowsApps ??= require('./windows-apps.cjs').createWindowsApps(); }
  capability() {
    const base = { platform: this.platform, version: VERSION, delivery: ['darwin', 'win32'].includes(this.platform) ? 'background' : 'unsupported' };
    if (!['darwin', 'win32'].includes(this.platform) || !['x64', 'arm64'].includes(this.architecture)
      || (this.platform === 'darwin' && Number(release().split('.')[0]) < 22)) return { ...base, available: false, reason: 'unsupported_system' };
    if (!this.sdkLoader) {
      try {
        const record = JSON.parse(readFileSync(join(this.runtimeRoot, 'complete.json'), 'utf8').replace(/^\uFEFF/, ''));
        const binary = this.platform === 'win32' ? 'qwen-cua-driver.exe' : 'qwen-cua-driver';
        if (record.version !== VERSION || !record.files?.[binary]
          || !Object.keys(record.files).every(file => !/[\\/]/.test(file) && existsSync(join(this.runtimeRoot, file)))) throw Error();
      } catch { return { ...base, available: false, reason: 'runtime_missing' }; }
    }
    if (this.platform === 'darwin' && this.preferences
      && (!this.preferences.isTrustedAccessibilityClient(false) || this.preferences.getMediaAccessStatus('screen') !== 'granted')) {
      return { ...base, available: false, reason: 'permission_required' };
    }
    return { ...base, available: true };
  }
  async requestPermission() {
    if (this.permissionPending) return this.permissionPending;
    this.permissionPending = this.acquirePermission().finally(() => { this.permissionPending = undefined; });
    return this.permissionPending;
  }
  async acquirePermission() {
    if (this.platform !== 'darwin') return this.capability();
    if (this.capability().reason === 'runtime_missing' || this.capability().reason === 'unsupported_system') return this.capability();
    await this.app?.whenReady();
    process.env.QWEN_CUA_SDK_NATIVE_DIR = this.runtimeRoot;
    const permission = await import('@qwen-code/cua-sdk/electron');
    permission.requestMacOSPermissions();
    // Native grants are re-evaluated from a fresh driver generation.
    await this.reset();
    return this.capability();
  }
  windowsWorkerReady() {
    try {
      const expected = JSON.parse(readFileSync(join(this.runtimeRoot, 'complete.json'), 'utf8').replace(/^\uFEFF/, '')).files?.['qwen-cua-driver-uia.exe'];
      const path = join(process.env.ProgramFiles || '', 'Qwen', 'CuaDriver', VERSION, 'qwen-cua-driver-uia.exe');
      const stat = statSync(path);
      const fingerprint = `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${expected}`;
      if (fingerprint === this.workerFingerprint) return true;
      if (!/^[a-f\d]{64}$/i.test(expected || '') || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) return false;
      this.workerFingerprint = fingerprint; return true;
    } catch { return false; }
  }
  async load() {
    if (this.closed) fail('computer_host_closed');
    if (!this.loading) {
      const generation = this.generation;
      const loading = (async () => {
      // A prior stop failure leaves a live native handle. Retry its
      // idempotent stop before admitting a new driver generation.
      if (this.failedHosts.size) {
        await Promise.allSettled([...this.failedHosts].map(host => this.stopHost(host)));
        if (this.failedHosts.size) fail('computer_driver_shutdown_incomplete');
      }
      const capability = this.capability();
      if (!capability.available) fail(capability.reason);
      if (this.sdkLoader) {
        const sdk = await this.sdkLoader();
        if (generation !== this.generation || this.closed) fail('computer_host_closed');
        return sdk;
      }
      await this.app?.whenReady();
      process.env.QWEN_CUA_SDK_NATIVE_DIR = this.runtimeRoot;
      if (this.platform === 'win32') {
        const worker = this.windowsWorkerReady()
          ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Qwen', 'CuaDriver', VERSION, 'qwen-cua-driver-uia.exe')
          : join(this.runtimeRoot, 'qwen-cua-driver-uia.exe');
        process.env.QWEN_CUA_UIACCESS_WORKER_PATH = this.ensureWindowsGuiBinary(worker, 'qwen-cua-driver-uia.exe');
      }
      const [sdk, facade] = await Promise.all([import('@qwen-code/cua-sdk'), import('@qwen-code/cua-sdk/computer-use')]);
      if (generation !== this.generation || this.closed) fail('computer_host_closed');
      let binary = join(this.runtimeRoot, this.platform === 'win32' ? 'qwen-cua-driver.exe' : 'qwen-cua-driver');
      if (this.platform === 'win32') binary = this.ensureWindowsGuiBinary(binary);
      const host = new sdk.EmbeddedCuaDriverHost(binary, 'io.nextmux.desktop');
      this.host = host;
      let connection;
      try { connection = await host.start(); }
      catch (error) { if (this.host === host) this.host = undefined; await this.stopHost(host); throw error; }
      if (generation !== this.generation || this.closed || this.host !== host) {
        await this.stopHost(host); fail('computer_host_closed');
      }
      const exited = () => { if (this.host === host && generation === this.generation) this.invalidateGeneration(host); };
      void host.waitForExit(connection.generation).then(exited, exited);
      // The AI cursor's badge shows the session's public label: the first conversation's is
      // "NextMux", later ones "NextMux-2", "NextMux-3"…; labels are never reused while the process
      // runs, so no conversation can pick up another one's session state.
      return { create: (conversationId, signal) => facade.ComputerUse.connect({ socketPath: connection.socketPath,
        session: this.sessionLabel(conversationId), signal }) };
      })().catch(error => { if (this.loading === loading) this.loading = undefined; throw error; })
        .finally(() => { this.pendingLoads.delete(loading); });
      this.loading = loading; this.pendingLoads.add(loading);
    }
    return this.loading;
  }
  ensureWindowsGuiBinary(binaryPath, name = 'qwen-cua-driver.exe') {
    try {
      const pe = readFileSync(binaryPath);
      const record = JSON.parse(readFileSync(join(this.runtimeRoot, 'complete.json'), 'utf8').replace(/^\uFEFF/, ''));
      const expected = record.files?.[name];
      // GUI conversion belongs to the target build, before its final hash is recorded.
      // Never mutate an installed binary or execute an unverified shared temporary copy.
      if (record.version !== VERSION || record.platform !== 'win32' || record.architecture !== this.architecture
        || !/^[a-f\d]{64}$/i.test(expected || '') || createHash('sha256').update(pe).digest('hex') !== expected.toLowerCase()
        || pe.length < 64 || pe.readUInt16LE(0) !== 0x5a4d) throw Error();
      const peOffset = pe.readUInt32LE(0x3c);
      if (peOffset < 64 || peOffset > pe.length - 24 || pe.readUInt32LE(peOffset) !== 0x00004550) throw Error();
      const machine = this.architecture === 'arm64' ? 0xaa64 : this.architecture === 'x64' ? 0x8664 : 0;
      const optionalBytes = pe.readUInt16LE(peOffset + 20);
      if (!machine || pe.readUInt16LE(peOffset + 4) !== machine || optionalBytes < 112
        || optionalBytes > pe.length - peOffset - 24 || pe.readUInt16LE(peOffset + 24) !== 0x20b) throw Error();
      const subsystemOffset = peOffset + 24 + 68;
      if (pe.readUInt16LE(subsystemOffset) !== 2) throw Error();
      return binaryPath;
    } catch { fail('computer_runtime_invalid'); }
  }
  sessionLabel(conversationId) {
    if (!this.sessionLabels.has(conversationId)) this.sessionLabels.set(conversationId, this.sessionLabels.size ? `NextMux-${this.sessionLabels.size + 1}` : 'NextMux');
    return this.sessionLabels.get(conversationId);
  }
  stopHost(host) {
    if (!host) return Promise.resolve();
    let stopping = this.hostShutdowns.get(host);
    if (!stopping) {
      // waitForExit retains the native host. Explicit stop ends that waiter;
      // dropping only the JS reference cannot reliably end the child process.
      // The SDK says stop() is idempotent. Keep its handle when stop fails so
      // shutdown can retry; destroying the handle first loses that option.
      stopping = Promise.resolve().then(() => host.stop()).then(() => {
        this.failedHosts.delete(host);
        try { host.uniffiDestroy(); } catch { /* The child was already stopped. */ }
      }, () => {
        this.failedHosts.add(host);
        fail('computer_driver_shutdown_incomplete');
      }).finally(() => { this.hostShutdowns.delete(host); this.stoppingHosts.delete(stopping); });
      this.hostShutdowns.set(host, stopping); this.stoppingHosts.add(stopping);
    }
    return stopping;
  }
  async stopIdleHost() {
    if (this.sessions.size || (!this.host && !this.loading)) return;
    const host = this.host;
    // Detach before awaiting stop: a new conversation may start immediately and
    // the old host's exit notification must not invalidate its replacement.
    this.generation += 1; this.host = undefined; this.loading = undefined; this.windowsScreenshotTargets.clear();
    await this.stopHost(host);
  }
  closeSessionClient(session) {
    if (!session.ready) return Promise.resolve();
    if (!session.clientClosing) {
      const closing = session.ready.then(client => client?.close?.(), () => undefined)
        .catch(() => fail('computer_session_close_failed'))
        .finally(() => { this.closingClients.delete(closing); });
      session.clientClosing = closing; this.closingClients.add(closing);
    }
    return session.clientClosing;
  }
  invalidateGeneration(host = this.host) {
    if (host !== this.host) return;
    this.generation += 1; this.loading = undefined; this.host = undefined;
    for (const operation of this.operations.values()) operation.controller.abort();
    for (const session of this.sessions.values()) { this.clearIdleRelease(session); void this.closeSessionClient(session).catch(() => undefined); }
    for (const conversationId of this.sessions.keys()) { try { this.overlay?.end(conversationId); } catch { /* cosmetic */ } }
    this.sessions.clear(); this.windows.clear(); this.windowsScreenshotTargets.clear();
    void this.stopHost(host).catch(() => undefined);
  }
  async session(conversationId, owner, signal, needsClient = true) {
    let session = this.sessions.get(conversationId);
    if (session && session.owner !== owner) fail('computer_session_owned');
    if (session?.closing) {
      if (session.stoppedByUser) {
        await session.closing.catch(() => undefined);
        session = this.sessions.get(conversationId);
      } else {
        fail('computer_session_closed');
      }
    }
    if (!session) {
      if (this.sessions.size >= 16) fail('computer_session_limit');
      session = { owner, ready: undefined, observations: new Map(), forgetting: new Map(), completed: new Map(), seen: new Set(), queue: Promise.resolve(), active: 0 };
      this.sessions.set(conversationId, session);
      this.scheduleIdleRelease(conversationId, session);
    }
    if (needsClient && !session.ready) {
      const generation = this.generation;
      const ready = this.load().then(async sdk => {
        signal.throwIfAborted();
        if (generation !== this.generation || this.sessions.get(conversationId) !== session) fail('computer_session_closed');
        const client = await sdk.create(conversationId, signal);
        if (generation !== this.generation || this.sessions.get(conversationId) !== session) {
          await Promise.resolve().then(() => client.close()).catch(() => undefined);
          fail('computer_session_closed');
        }
        return client;
      });
      session.ready = ready;
      void ready.catch(async () => {
        if (this.sessions.get(conversationId) !== session) return;
        this.sessions.delete(conversationId);
        await this.stopIdleHost();
      }).catch(() => undefined);
    }
    if (needsClient) await session.ready;
    signal.throwIfAborted();
    if (this.sessions.get(conversationId) !== session) fail('computer_session_closed');
    return session;
  }
  rememberActivity(conversationId, owner) {
    if (identifier(conversationId)) {
      this.activeConversations.set(conversationId, owner ?? this.sessions.get(conversationId)?.owner ?? this.activeConversations.get(conversationId));
      this.activityAt.set(conversationId, Date.now());
    }
  }
  staleOrClosedCode(conversationId, windowKey) {
    return this.closedWindows.has(`${conversationId}:${windowKey}`) ? 'computer_window_closed' : 'computer_snapshot_stale';
  }
  clearUserEsc(conversationId) {
    if (!identifier(conversationId)) return false;
    return this.userEscInterrupted.delete(conversationId);
  }
  async run(request, owner) {
    const id = request?.id;
    try {
      if (identifier(request?.conversationId) && this.userEscInterrupted.has(request.conversationId)) {
        return computerFailure(request, abortReason('interrupted_by_user_esc'), 'host', this.platform);
      }
      if (!identifier(id) || !identifier(request.conversationId) || !Object.hasOwn(actions, request.action)
        || !Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now() || request.expiresAt > Date.now() + 180000) fail('computer_request_invalid');
      const input = request.input || {};
      if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 64000
        || Object.keys(input).some(key => key !== 'snapshotId' && !actions[request.action].includes(key))) fail('computer_input_invalid');
      // A webview in NextMux belongs to this host process. Never route model
      // input to our own desktop window: browser.* targets its isolated guest
      // and cannot paste into whichever application the user is working in.
      if (!reads.has(request.action) && this.isBuiltinProcess(input.pid)) fail('computer_builtin_surface_requires_browser');
      const key = `${owner}:${request.conversationId}:${id}`;
      const digest = createHash('sha256').update(JSON.stringify([request.action, input])).digest('hex');
      if (this.operations.has(key)) {
        const pending = this.operations.get(key);
        if (pending.digest !== digest) fail('computer_request_id_conflict');
        return pending.promise;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.expiresAt - Date.now());
      const operation = { controller, digest, conversationId: request.conversationId, owner,
        windowKey: Number.isSafeInteger(input.pid) && Number.isSafeInteger(input.windowId) ? `${input.pid}:${input.windowId}` : undefined };
      operation.promise = this.execute(request, input, owner, controller.signal, digest).catch(error => computerFailure(request, error, 'host', this.platform, controller.signal))
        .finally(() => { clearTimeout(timeout); if (this.operations.get(key) === operation) this.operations.delete(key); });
      this.operations.set(key, operation);
      return operation.promise;
    } catch (error) { return computerFailure(request, error, 'host', this.platform); }
  }
  async execute(request, input, owner, signal, digest) {
    const needsClient = this.platform !== 'win32' || Boolean(this.sdkLoader)
      || !['listApps', 'openApp', 'pressKey', 'hotkey', 'typeText'].includes(request.action);
    const session = await this.session(request.conversationId, owner, signal, needsClient);
    session.active += 1; this.clearIdleRelease(session);
    this.rememberActivity(request.conversationId, owner);
    try { this.overlay?.activity(request.conversationId, this.sessionLabel(request.conversationId)); } catch { /* the frame is cosmetic */ }
    try {
      const run = () => this.executeSession(session, request, input, signal, digest);
      const result = input.pid && input.windowId ? this.queueWindow(session, `${input.pid}:${input.windowId}`, run) : session.queue.then(run);
      if (!input.pid || !input.windowId) session.queue = result.catch(() => undefined);
      return await result;
    } finally {
      session.active -= 1;
      this.scheduleIdleRelease(request.conversationId, session);
    }
  }
  queueWindow(session, key, action) {
    session.windowQueues ??= new Map();
    const run = (session.windowQueues.get(key) || Promise.resolve()).then(action);
    const tail = run.catch(() => undefined).finally(() => { if (session.windowQueues.get(key) === tail) session.windowQueues.delete(key); });
    session.windowQueues.set(key, tail);
    return run;
  }
  clearIdleRelease(session) {
    if (session?.idleTimer) clearTimeout(session.idleTimer);
    if (session) session.idleTimer = undefined;
  }
  scheduleIdleRelease(conversationId, session) {
    this.clearIdleRelease(session);
    if (session.active || session.closing || this.closed || this.sessions.get(conversationId) !== session) return;
    session.idleTimer = setTimeout(() => {
      session.idleTimer = undefined;
      if (session.active || session.closing || this.sessions.get(conversationId) !== session) return;
      void this.release(conversationId, session.owner).catch(() => undefined);
    }, this.idleReleaseMs);
    // Lease maintenance must never keep the main process alive by itself.
    session.idleTimer.unref?.();
  }
  /** Renderer keepalive while these conversations have an active run. */
  renew(conversationIds, owner) {
    let renewed = 0;
    for (const conversationId of conversationIds) {
      const session = this.sessions.get(conversationId);
      if (!session || session.owner !== owner || session.closing) continue;
      this.scheduleIdleRelease(conversationId, session); renewed += 1;
    }
    return renewed;
  }
  async macAppHandle(client, selector, signal) {
    const aliasBundleId = {
      '计算器': 'com.apple.calculator', 'calculator': 'com.apple.calculator',
      '备忘录': 'com.apple.notes', 'notes': 'com.apple.notes',
      '文本编辑': 'com.apple.textedit', 'textedit': 'com.apple.textedit',
      '日历': 'com.apple.iCal', 'calendar': 'com.apple.iCal',
      '提醒事项': 'com.apple.reminders', 'reminders': 'com.apple.reminders',
      '终端': 'com.apple.Terminal', 'terminal': 'com.apple.Terminal',
      '系统设置': 'com.apple.systempreferences', '系统偏好设置': 'com.apple.systempreferences',
      '预览': 'com.apple.Preview', 'preview': 'com.apple.Preview',
      '访达': 'com.apple.finder', 'finder': 'com.apple.finder',
      '微信': 'com.tencent.xinWeChat', 'wechat': 'com.tencent.xinWeChat',
      '音乐': 'com.apple.Music', '播客': 'com.apple.podcasts', '股市': 'com.apple.stocks',
      '天气': 'com.apple.weather', '地图': 'com.apple.Maps', '邮件': 'com.apple.mail',
      '信息': 'com.apple.MobileSMS', '通讯录': 'com.apple.AddressBook', '照片': 'com.apple.Photos',
      '活动监视器': 'com.apple.ActivityMonitor', '快捷指令': 'com.apple.shortcuts', '词典': 'com.apple.Dictionary'
    }[String(selector || '').trim().toLowerCase()];
    try { return await client.getApp(selector, { signal }); }
    catch (error) {
      if (this.platform === 'darwin' && aliasBundleId && aliasBundleId.toLowerCase() !== String(selector || '').trim().toLowerCase()
        && ['app_not_running', 'app_not_found'].includes(error?.code)) {
        try { return await client.getApp(aliasBundleId, { signal }); }
        catch (aliasError) {
          // Only another discovery miss may fall through. Cancellation,
          // ambiguity and transport failures must keep their actual outcome.
          if (!['app_not_running', 'app_not_found'].includes(aliasError?.code)) throw aliasError;
        }
      }
      // getState launches *discovered* stopped apps. A new .app outside the
      // native inventory fails in getApp before any launch has been sent.
      // Only an explicit existing application path may use LaunchServices;
      // names/IDs, ambiguous selection, and post-dispatch errors never retry.
      const path = selector.trim().replace(/\/+$/, '');
      if (this.platform !== 'darwin' || error?.code !== 'app_not_running'
        || !isAbsolute(path) || !/\.app$/i.test(path)) throw error;
      let directory = false;
      try { directory = statSync(path).isDirectory(); } catch { /* retain the original discovery failure */ }
      if (!directory) throw error;
      signal.throwIfAborted();
      await this.launchMacApp(path, signal);
      // Launch exactly once. Only repeat read-only discovery while macOS
      // registers the process; an unknown launch result is never replayed.
      const deadline = Date.now() + 2000;
      while (true) {
        signal.throwIfAborted();
        try { return await client.getApp(path, { signal }); }
        catch (readError) {
          if (readError?.code !== 'app_not_running' || Date.now() >= deadline) throw readError;
          await delay(50, undefined, { signal });
        }
      }
    }
  }
  async executeSession(session, request, input, signal, digest) {
    signal.throwIfAborted();
    if (this.sessions.get(request.conversationId) !== session) fail('computer_session_closed');
    const client = session.ready ? await session.ready : undefined;
    if (!reads.has(request.action) && session.seen.has(request.id)) {
      const prior = session.completed.get(request.id);
      if (!prior || prior.digest !== digest) fail('computer_request_already_dispatched');
      return prior.result;
    }
    const params = Object.fromEntries(actions[request.action].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
    if (request.action === 'verifyState') params.expect = sdkVerificationPredicates(params.expect);
    const needsWindow = !['listApps', 'listWindows', 'openApp'].includes(request.action);
    let windowKey, priorObservation;
    if (needsWindow) {
      if (!Number.isInteger(params.pid) || params.pid <= 0 || !Number.isInteger(params.windowId) || params.windowId < 0) fail('computer_window_required');
      windowKey = `${params.pid}:${params.windowId}`;
      if (this.closedWindows.has(`${request.conversationId}:${windowKey}`) || session.forgetting.has(windowKey)) {
        fail(this.staleOrClosedCode(request.conversationId, windowKey));
      }
      const claimed = this.windows.get(windowKey);
      if (claimed && claimed !== request.conversationId) fail('computer_window_owned');
      if (request.action !== 'observeWindow') {
        const observed = session.observations.get(windowKey);
        if (!observed || input.snapshotId !== observed.id) fail(this.staleOrClosedCode(request.conversationId, windowKey));
        if (params.elementToken && !observed.tokens.has(params.elementToken)) fail('computer_element_stale');
        priorObservation = observed;
      }
      this.windows.set(windowKey, request.conversationId);
    }
    if (request.action === 'observeWindow') {
      // NM sends observations independently. Do not expose diffs that would drop
      // unchanged AX tokens while claiming the snapshot still represents a window.
      params.disableDiff = true;
      params.maxTextChars = Math.max(512, Math.min(Number(params.maxTextChars) || 12000, 48000));
      params.maxElements = Math.max(1, Math.min(Number(params.maxElements) || 500, 2000));
      params.maxDepth = Math.max(1, Math.min(Number(params.maxDepth) || 12, 30));
    }
    if (request.action === 'openApp' && (typeof params.selector !== 'string' || !params.selector.trim() || params.selector.length > 256)) fail('computer_app_required');
    const invoke = async () => {
      signal.throwIfAborted();
      if (this.sessions.get(request.conversationId) !== session) fail('computer_session_closed');
      if (windowKey && this.windows.get(windowKey) !== request.conversationId) fail('computer_window_owned');
      if (windowKey && (this.closedWindows.has(`${request.conversationId}:${windowKey}`) || session.forgetting.has(windowKey))) {
        fail(this.staleOrClosedCode(request.conversationId, windowKey));
      }
      let focusClick;
      if (params.elementToken && ['click', 'doubleClick', 'rightClick', 'scroll'].includes(request.action)
        && (params.x === undefined || params.y === undefined)) {
        const resolved = resolveElementPoint(priorObservation, params.elementToken, this.platform);
        params.x = resolved.x;
        params.y = resolved.y;
      } else if (params.elementToken && ['typeText', 'pressKey', 'hotkey'].includes(request.action)) {
        const resolved = resolveElementPoint(priorObservation, params.elementToken, this.platform);
        focusClick = { kind: 'click', x: resolved.x / resolved.size.width, y: resolved.y / resolved.size.height, button: 'left' };
      }
      if (this.platform === 'win32' && (['click', 'doubleClick', 'rightClick', 'drag', 'scroll'].includes(request.action) || Boolean(focusClick))
        && this.windowsScreenshotTargets.get(params.pid) !== windowKey) fail('computer_snapshot_stale');
      if (!reads.has(request.action)) {
        try { this.view?.touch?.(params.pid); } catch { /* presentation only */ }
        // Mark immediately before dispatch. Aborted/uncertain writes must never
        // reuse an old observation or be silently dispatched again.
        session.seen.add(request.id);
        if (windowKey) session.observations.delete(windowKey);
      }
      if (request.action === 'listApps') return this.platform === 'win32' ? this.installedApps().listApps({ signal }) : client.listApps({ signal });
      if (request.action === 'openApp') {
        if (this.platform === 'win32') return this.installedApps().open(params.selector, { signal });
        const app = await this.macAppHandle(client, params.selector, signal);
        return app.getState({ signal, includeScreenshot: false });
      }
      if (this.platform === 'win32' && request.action === 'observeWindow') {
        this.windowsScreenshotTargets.delete(params.pid);
        let observed;
        try {
          observed = await client.observeWindow({ ...params, signal });
        } catch (error) {
          if (safeCode(error) === 'uiaccess_worker_unavailable' && typeof this.view?.snapshot === 'function') {
            const hadView = this.view.canView?.(request.conversationId, params.pid, params.windowId) === true;
            if (!hadView) this.view.grant?.(request.conversationId, params.pid, params.windowId);
            let snap;
            try {
              snap = await this.view.snapshot(request.conversationId, params.pid, params.windowId, 1280);
            } finally {
              if (!hadView) await this.view.forget?.(request.conversationId, params.pid, params.windowId, { close: false }).catch(() => undefined);
            }
            if (snap?.ok && typeof snap.data === 'string' && snap.data.length > 0) {
              const width = Number(snap.width) || 1280, height = Number(snap.height) || 720;
              observed = {
                pid: params.pid,
                windowId: params.windowId,
                elements: [],
                screenshot: { width, height, images: [{ mimeType: snap.mimeType || 'image/jpeg', dataBase64: snap.data }] },
                fallbackScreenshotSize: { width, height }
              };
            } else throw error;
          } else throw error;
        }
        signal.throwIfAborted();
        if (this.sessions.get(request.conversationId) !== session) fail('computer_session_closed');
        if (observed?.screenshot?.images?.length || observed?.screenshot?.width > 0) this.windowsScreenshotTargets.set(params.pid, windowKey);
        return observed;
      }
      if (this.platform === 'win32' && ['pressKey', 'hotkey', 'typeText'].includes(request.action)) {
        return this.sendingKeys(async () => {
          if (focusClick) await this.nativeInput().post({ pid: params.pid, windowId: params.windowId, signal, ...focusClick });
          return this.nativeInput().post({ pid: params.pid, windowId: params.windowId, signal,
            ...(request.action === 'typeText' ? { kind: 'text', text: params.text } : { kind: 'key', ...(request.action === 'hotkey' ? { keys: params.keys } : { key: params.key }), modifiers: params.modifiers, holdMs: params.holdMs }) });
        });
      }
      const pointerInput = size => {
        const point = (x, y) => {
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size.width || y >= size.height) fail('computer_input_invalid');
          return { x: x / size.width, y: y / size.height };
        };
        if (params.modifier?.length || params.count > 2 || params.by && params.by !== 'line') fail('background_unsupported');
        if (request.action === 'drag') return { kind: 'drag', from: point(params.fromX, params.fromY), to: point(params.toX, params.toY), durationMs: params.durationMs, button: params.button || 'left' };
        return { kind: request.action === 'doubleClick' || params.count === 2 ? 'doubleClick' : request.action === 'rightClick' ? 'click' : request.action,
          ...point(params.x, params.y), button: request.action === 'rightClick' ? 'right' : params.button || 'left', direction: params.direction, amount: params.amount };
      };
      if (this.platform === 'win32' && ['click', 'doubleClick', 'rightClick', 'drag', 'scroll'].includes(request.action)
        && (priorObservation?.fallbackScreenshotSize || priorObservation?.screenshotSize)) {
        return this.nativeInput().post({ pid: params.pid, windowId: params.windowId, signal,
          ...pointerInput(priorObservation.fallbackScreenshotSize || priorObservation.screenshotSize) });
      }
      if (!reads.has(request.action) && request.action !== 'setValue') {
        if (this.platform !== 'darwin' || !this.view) fail('background_unsupported');
        this.view.grant?.(request.conversationId, params.pid, params.windowId);
        let result;
        if (['typeText', 'pressKey', 'hotkey'].includes(request.action)) {
          result = await this.sendingKeys(async () => {
            if (focusClick) {
              const clicked = await this.view.pointer(request.conversationId, params.pid, params.windowId, { signal, ...focusClick });
              if (!clicked?.ok) fail((signal?.aborted && extractPriorityCode(signal.reason)) || clicked?.error || 'background_unsupported');
            }
            return this.view.keys(request.conversationId, params.pid, params.windowId, {
              ...(request.action === 'typeText' ? { text: params.text } : request.action === 'hotkey' ? { keys: params.keys } : { key: params.key, modifiers: params.modifiers }), ...(params.holdMs !== undefined ? { holdMs: params.holdMs } : {}), signal });
          });
        } else {
          const size = priorObservation?.screenshotSize;
          if (!size) fail('background_unsupported');
          result = await this.view.pointer(request.conversationId, params.pid, params.windowId, { signal,
            ...pointerInput(size) });
        }
        if (!result?.ok) fail((signal?.aborted && extractPriorityCode(signal.reason)) || result?.error || 'background_unsupported');
        return result;
      }
      const call = () => client[request.action]({ ...params, signal,
        ...(!reads.has(request.action) && request.action !== 'setValue' ? { deliveryMode: 'background' } : {}) });
      return ['pressKey', 'hotkey', 'typeText', 'setValue'].includes(request.action) ? this.sendingKeys(call) : call();
    };
    // Preserve SDK screenshot serialization and non-replay ordering. All writes
    // use background delivery; an unsupported/uncertain action is never escalated.
    let output;
    try {
      output = this.platform === 'win32' && request.action === 'observeWindow'
        ? await this.serializeForeground(invoke) : await invoke();
      if (signal.aborted && extractPriorityCode(signal.reason)) throw signal.reason;
    } catch (error) { return computerFailure(request, error, 'native_call', this.platform, signal); }
    if (reads.has(request.action)) signal.throwIfAborted();
    if (this.sessions.get(request.conversationId) !== session) fail('computer_session_closed');
    if (windowKey && reads.has(request.action)
      && (session.forgetting.has(windowKey) || this.windows.get(windowKey) !== request.conversationId)) fail(this.staleOrClosedCode(request.conversationId, windowKey));
    const images = output?.screenshot?.images?.filter(image => typeof image.dataBase64 === 'string' && image.dataBase64.length <= 16000000
      && ['image/png', 'image/jpeg'].includes(image.mimeType)).map(image => ({ mimeType: image.mimeType, data: image.dataBase64 }));
    const value = output && !Array.isArray(output) ? { ...output } : output;
    if (!reads.has(request.action) && signal.aborted && value && !Array.isArray(value)) value.cancellationRequested = true;
    if (value?.screenshot) delete value.screenshot;
    if (value?.fallbackScreenshotSize) delete value.fallbackScreenshotSize;
    if (request.action === 'observeWindow') {
      this.closedWindows.delete(`${request.conversationId}:${windowKey}`);
      const snapshotId = randomUUID();
      const { tokens, elements } = parseObservedElements(output?.elements);
      const rawCtx = output?.context && typeof output.context === 'object' ? output.context : undefined;
      const rawBounds = rawCtx?.windowBounds !== undefined ? rawCtx.windowBounds : output?.window?.bounds;
      const rawScale = rawCtx?.screenshotScale !== undefined ? rawCtx.screenshotScale : output?.screenshotScale;
      const rawValid = rawCtx?.screenshotFrameValid !== undefined ? rawCtx.screenshotFrameValid : output?.screenshotFrameValid;
      const context = (rawBounds !== undefined || rawScale !== undefined || rawValid !== undefined)
        ? {
            ...(rawBounds && typeof rawBounds === 'object'
              ? { windowBounds: { x: Number(rawBounds.x), y: Number(rawBounds.y), width: Number(rawBounds.width), height: Number(rawBounds.height) } }
              : rawBounds !== undefined ? { windowBounds: rawBounds } : {}),
            ...(rawScale !== undefined ? { screenshotScale: Number(rawScale) } : {}),
            ...(rawValid !== undefined ? { screenshotFrameValid: rawValid } : {})
          }
        : undefined;
      session.observations.set(windowKey, {
        id: snapshotId,
        tokens,
        elements,
        ...(context ? { context } : {}),
        ...(output?.screenshot?.width > 0 && output?.screenshot?.height > 0 ? { screenshotSize: { width: output.screenshot.width, height: output.screenshot.height } } : {}),
        ...(output?.fallbackScreenshotSize ? { fallbackScreenshotSize: output.fallbackScreenshotSize } : {})
      });
      value.snapshotId = snapshotId;
    }
    let publicOutput;
    try { publicOutput = publicValue(value); }
    catch (error) { return computerFailure(request, error, 'result_encoding'); }
    const result = { requestId: request.id, ok: true, output: publicOutput, ...(images?.length ? { images } : {}) };
    if (!reads.has(request.action)) {
      session.completed.set(request.id, { digest, result });
      if (session.completed.size > 128) session.completed.delete(session.completed.keys().next().value);
    }
    return result;
  }
  async captureView(conversationId, arg1, arg2, arg3, arg4, arg5) {
    let owner, pid, windowId, maxSize, source;
    if (arg1 && typeof arg1 === 'object') {
      ({ owner, pid, windowId, maxSize, source } = arg1);
    } else if (arg2 && typeof arg2 === 'object' && (arg2.pid !== undefined || arg2.windowId !== undefined)) {
      owner = arg1;
      ({ pid, windowId, maxSize, source } = arg2);
    } else if (typeof arg4 === 'number') {
      owner = arg1; pid = arg2; windowId = arg3; maxSize = arg4;
      source = typeof arg5 === 'string' ? arg5 : arg5?.source;
    } else {
      pid = arg1; windowId = arg2;
      if (typeof arg3 === 'object' && arg3 !== null) {
        maxSize = arg3.maxSize; source = arg3.source; owner = arg3.owner;
      } else if (typeof arg3 === 'string') {
        source = arg3;
      } else {
        maxSize = arg3;
        source = typeof arg4 === 'string' ? arg4 : arg4?.source;
        owner = typeof arg4 === 'object' && arg4 !== null ? arg4.owner : undefined;
      }
    }
    if (!identifier(conversationId)) return { ok: false, error: 'computer_request_invalid' };
    // A snapshot without a source is the tab's own live picture for the user.
    if (source === 'agent' && this.userEscInterrupted.has(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    const p = Number(pid), w = Number(windowId);
    if (Number.isSafeInteger(p) && p > 0 && Number.isSafeInteger(w) && w > 0 && this.closedWindows.has(`${conversationId}:${p}:${w}`)) {
      return { ok: false, error: 'computer_window_closed' };
    }
    if (!this.view?.snapshot) return { ok: false, error: 'live_view_unsupported' };
    if (showsAutomationActivity({ source })) {
      this.rememberActivity(conversationId, owner);
      try { this.overlay?.activity(conversationId, this.sessionLabel(conversationId)); } catch { /* cosmetic */ }
    }
    return this.view.snapshot(conversationId, p, w, maxSize);
  }
  /**
   * The user's own mouse in the window's tab on Windows (its "鼠标" switch is on; macOS uses the display helper,
   * computer-window-view.cjs). The native input helper resolves x/y fractions
   * against the current physical window frame, so the
   * tab's scaling never matters. This is the user, not the AI: no snapshot is needed, but the AI's snapshot of the
   * window is dropped, because what it saw may have changed.
   */
  async userPointer(conversationId, owner, input) {
    if (input === undefined && owner && typeof owner === 'object') {
      input = owner;
      owner = this.sessions.get(conversationId)?.owner ?? this.activeConversations.get(conversationId) ?? 1;
    }
    if (identifier(conversationId) && isAgentInput(input) && this.userEscInterrupted.has(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    const { pid, windowId, kind } = input || {};
    const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const drag = kind === 'drag';
    const durationMs = input?.durationMs ?? 300;
    if (!identifier(conversationId) || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0
      || !['click', 'doubleClick', 'scroll', 'drag', 'move'].includes(kind)
      || (drag ? !fraction(input.from?.x) || !fraction(input.from?.y) || !fraction(input.to?.x) || !fraction(input.to?.y)
        || !Number.isInteger(durationMs) || durationMs < 50 || durationMs > 2000 : !fraction(input.x) || !fraction(input.y))
      || (input.button !== undefined && !['left', 'right'].includes(input.button))
      || (drag && input.button === 'right')
      || (kind === 'scroll' && !['up', 'down', 'left', 'right'].includes(input.direction))) return { ok: false, error: 'computer_input_invalid' };
    // Both native adapters keep pointer movement scoped to the requested window.
    const windowKey = `${pid}:${windowId}`;
    if (this.closedWindows.has(`${conversationId}:${windowKey}`)) return { ok: false, error: 'computer_window_closed' };
    const claimed = this.windows.get(windowKey);
    if (claimed && claimed !== conversationId) return { ok: false, error: 'computer_window_owned' };
    if (showsAutomationActivity(input)) {
      this.rememberActivity(conversationId, owner);
      try { this.overlay?.activity(conversationId, this.sessionLabel(conversationId)); } catch { /* cosmetic */ }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const signal = input?.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    this.tabControllers.set(controller, { conversationId, owner, controller, windowKey });
    try {
      const session = await this.session(conversationId, owner, signal, false);
      session.active += 1; this.clearIdleRelease(session);
      try {
        const delivery = 'background';
        const run = this.queueWindow(session, windowKey, async () => {
          const owned = () => {
            signal.throwIfAborted();
            if (this.sessions.get(conversationId) !== session) fail('computer_session_closed');
            if (this.closedWindows.has(`${conversationId}:${windowKey}`) || session.forgetting.has(windowKey)) {
              fail(this.staleOrClosedCode(conversationId, windowKey));
            }
            if (this.windows.has(windowKey) && this.windows.get(windowKey) !== conversationId) fail('computer_window_owned');
            if (this.isBuiltinProcess(pid)) fail('computer_builtin_surface_requires_browser');
          };
          owned();
          session.observations.delete(windowKey);
          // Renderer/model/plugin delivery flags cannot authorize global HID input.
          // Posted Windows messages and window-scoped AX have no foreground retry.
          if (this.platform === 'win32') {
            await this.nativeInput().post({ pid, windowId, signal, kind,
              ...(drag ? { from: input.from, to: input.to, durationMs } : { x: input.x, y: input.y }),
              button: input.button ?? 'left', direction: input.direction, amount: input.amount });
            return;
          }
          if (!this.view?.pointer) fail('background_unsupported');
          this.view.grant?.(conversationId, pid, windowId);
          const result = await this.view.pointer(conversationId, pid, windowId, { ...input, signal, delivery: 'semantic' });
          if (!result?.ok) fail((signal?.aborted && extractPriorityCode(signal.reason)) || result?.error || 'background_unsupported');
          return result;
        });
        const output = await run;
        if (controller.signal.aborted && extractPriorityCode(controller.signal.reason)) throw controller.signal.reason;
        return { ok: true, delivery, ...(output?.effect ? { effect: output.effect } : {}) };
      } finally {
        session.active -= 1;
        this.scheduleIdleRelease(conversationId, session);
      }
    } catch (error) {
      const code = safeCode(error, controller.signal);
      return { ok: false, error: code, ...(code === 'interrupted_by_user_esc' ? { userInterrupted: true } : {}) };
    } finally { clearTimeout(timeout); this.tabControllers.delete(controller); }
  }
  /** Tabs address their owned window through scoped AX or posted messages. */
  async userKeys(conversationId, owner, input) {
    if (input === undefined && owner && typeof owner === 'object') {
      input = owner;
      owner = this.sessions.get(conversationId)?.owner ?? this.activeConversations.get(conversationId) ?? 1;
    }
    if (identifier(conversationId) && isAgentInput(input) && this.userEscInterrupted.has(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    const { pid, windowId } = input || {};
    const text = typeof input?.text === 'string' && input.text.length > 0;
    const key = typeof input?.key === 'string' && input.key.length > 0;
    const keys = Array.isArray(input?.keys) && input.keys.length > 0 && input.keys.length <= 4
      && input.keys.every(item => typeof item === 'string' && item.length > 0 && item.length <= 24);
    if (!identifier(conversationId) || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0
      || Number(text) + Number(key) + Number(keys) !== 1 || (input.keys !== undefined && !keys)
      || (key && input.key.length > 24) || (text && input.text.length > 2000)
      || (input.holdMs !== undefined && (!Number.isInteger(input.holdMs) || input.holdMs < 0 || input.holdMs > 3000))
      || (input.modifiers !== undefined && (!Array.isArray(input.modifiers) || input.modifiers.length > 4
        || !input.modifiers.every(item => typeof item === 'string' && /^(?:(?:left|right)?(?:ctrl|control|alt|option|shift|cmd|command|meta|win)|[lr](?:ctrl|control|alt|shift|win))$/i.test(item))))
      || (text && (input.holdMs !== undefined || input.modifiers?.length))) return { ok: false, error: 'computer_input_invalid' };
    const mainKey = keys ? input.keys[0] : input.key;
    const windowKey = `${pid}:${windowId}`;
    if (this.closedWindows.has(`${conversationId}:${windowKey}`)) return { ok: false, error: 'computer_window_closed' };
    const claimed = this.windows.get(windowKey);
    if (claimed && claimed !== conversationId) return { ok: false, error: 'computer_window_owned' };
    const userOriginated = isUserSource(input);
    if (userOriginated) this.syntheticKeyAt = 0;
    if (showsAutomationActivity(input)) {
      this.rememberActivity(conversationId, owner);
      try { this.overlay?.activity(conversationId, this.sessionLabel(conversationId)); } catch { /* cosmetic */ }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const signal = input?.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    this.tabControllers.set(controller, { conversationId, owner, controller, windowKey });
    try {
      const session = await this.session(conversationId, owner, signal, false);
      session.active += 1; this.clearIdleRelease(session);
      try {
        const delivery = 'background';
        const run = this.queueWindow(session, windowKey, async () => {
          signal.throwIfAborted();
          if (this.sessions.get(conversationId) !== session) fail('computer_session_closed');
          if (this.closedWindows.has(`${conversationId}:${windowKey}`) || session.forgetting.has(windowKey)) {
            fail(this.staleOrClosedCode(conversationId, windowKey));
          }
          if (this.windows.has(windowKey) && this.windows.get(windowKey) !== conversationId) fail('computer_window_owned');
          if (this.isBuiltinProcess(pid)) fail('computer_builtin_surface_requires_browser');
          session.observations.delete(windowKey);
          const dispatch = async () => {
            if (this.platform === 'win32') {
              await this.nativeInput().post({ pid, windowId, signal,
                ...(text ? { kind: 'text', text: input.text } : {
                  kind: 'key',
                  ...(keys ? { keys: [...input.keys] } : { key: mainKey }),
                  ...(input.modifiers?.length ? { modifiers: [...input.modifiers] } : {}),
                  ...(input.holdMs > 0 ? { holdMs: input.holdMs } : {})
                }) });
              return;
            }
            if (!this.view?.keys) fail('background_unsupported');
            this.view.grant?.(conversationId, pid, windowId);
            const result = await this.view.keys(conversationId, pid, windowId, { ...input, signal, delivery: 'semantic' });
            if (!result?.ok) fail((signal?.aborted && extractPriorityCode(signal.reason)) || result?.error || 'background_unsupported');
            return result;
          };
          return userOriginated ? dispatch() : this.sendingKeys(dispatch);
        });
        const output = await run;
        if (controller.signal.aborted && extractPriorityCode(controller.signal.reason)) throw controller.signal.reason;
        return { ok: true, delivery, ...(output?.effect ? { effect: output.effect } : {}) };
      } finally {
        session.active -= 1;
        this.scheduleIdleRelease(conversationId, session);
      }
    } catch (error) {
      const code = safeCode(error, controller.signal);
      return { ok: false, error: code, ...(code === 'interrupted_by_user_esc' ? { userInterrupted: true } : {}) };
    } finally { clearTimeout(timeout); this.tabControllers.delete(controller); }
  }
  /**
   * tabs.open_app: launch or find an app for a conversation's tab and hand back its main window, claimed for that
   * conversation. The view module then keeps it in the tab (computer-window-view.cjs).
   */
  async stopAppForReopen(conversationId, targets, signal) {
    const pids = [...new Set(targets.map(target => target.appPid || target.pid))];
    const keys = [
      ...[...this.windows].filter(([key]) => pids.includes(Number(key.split(':')[0]))
        || targets.some(target => key === `${target.pid}:${target.windowId}`)),
      ...pids.flatMap(pid => (this.view?.windowsForProcess?.(pid) || []).map(target => [`${target.pid}:${target.windowId}`, target.conversationId]))
    ];
    // Resolve and validate every target before sending any signal. Never stop NextMux or another conversation's app.
    if (pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0 || this.isBuiltinProcess(pid))) fail('computer_builtin_surface_requires_browser');
    if (keys.some(([, owner]) => owner !== conversationId)) fail('computer_window_owned');
    for (const [key] of keys) {
      const [pid, windowId] = key.split(':').map(Number);
      this.view?.revokeCapture?.(conversationId, pid, windowId);
      await this.view?.forget?.(conversationId, pid, windowId, { close: false });
      this.sessions.get(conversationId)?.observations.delete(key);
    }
    for (const pid of pids) {
      signal.throwIfAborted();
      try { this.killProcess(pid, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') fail('computer_app_restart_failed'); }
    }
    for (const pid of pids) {
      let exited = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        signal.throwIfAborted();
        try { this.killProcess(pid, 0); } catch (error) {
          if (error?.code !== 'ESRCH') fail('computer_app_restart_failed');
          exited = true; break;
        }
        await delay(50, undefined, { signal });
      }
      if (!exited) fail('computer_app_restart_failed');
    }
    for (const [key] of keys) if (this.windows.get(key) === conversationId) this.windows.delete(key);
  }
  async openAppInTab(conversationId, owner, selector, options = {}) {
    if (typeof owner === 'string' && (selector === undefined || typeof selector === 'object')) {
      options = selector || {};
      selector = owner;
      owner = this.sessions.get(conversationId)?.owner ?? this.activeConversations.get(conversationId) ?? 1;
    }
    const { onlyIfRunning = false, probeOnly = false, checkOrOpen = false, restartIfRunning = false } = options;
    const source = ['agent', 'plugin', 'user', 'passive'].includes(options.source) ? options.source : undefined;
    // After Esc only the AI's (and a legacy, sourceless) open is refused; the user reopening their own tab never is.
    if (identifier(conversationId) && source !== 'user' && source !== 'passive' && this.userEscInterrupted.has(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    if (!identifier(conversationId) || typeof selector !== 'string' || !selector.trim() || selector.length > 256) return { ok: false, error: 'computer_app_required' };
    // The frame is for the model or a plugin actually opening an app: never for a check whether it still runs, a probe,
    // or the user's own Reopen.
    if (showsAutomationActivity({ source }) && !onlyIfRunning && !probeOnly) {
      this.rememberActivity(conversationId, owner);
      try { this.overlay?.activity(conversationId, this.sessionLabel(conversationId)); } catch { /* cosmetic */ }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40_000);
    const signal = controller.signal;
    const inputLease = { conversationId, owner, controller };
    this.tabControllers.set(controller, inputLease);
    try {
      const session = await this.session(conversationId, owner, signal, this.platform !== 'win32' || Boolean(this.sdkLoader));
      session.active += 1; this.clearIdleRelease(session);
      try {
        const run = session.queue.then(async () => {
          signal.throwIfAborted();
          if (this.sessions.get(conversationId) !== session || session.closing) fail('computer_session_closed');
          const client = session.ready ? await session.ready : undefined;
          if (this.platform === 'win32') {
            // Another conversation's window of the same app is never handed over: this conversation gets its own instance.
            const taken = (pid, windowId) => { const owner = this.windows.get(`${pid}:${windowId}`); return Boolean(owner && owner !== conversationId); };
            const opened = await this.serializeForeground(() => this.installedApps().open(selector, { signal, taken, onlyIfRunning, probeOnly, checkOrOpen, restartIfRunning,
              restart: targets => this.stopAppForReopen(conversationId, targets, signal) }));
            signal.throwIfAborted();
            if (this.sessions.get(conversationId) !== session) fail('computer_session_closed');
            if (probeOnly || opened.requiresRestart) return opened;
            const key = `${opened.pid}:${opened.windowId}`;
            if (session.forgetting.has(key)) fail(this.staleOrClosedCode(conversationId, key));
            if (this.windows.has(key) && this.windows.get(key) !== conversationId) fail('computer_window_owned');
            this.windows.set(key, conversationId);
            this.closedWindows.delete(`${conversationId}:${key}`);
            return opened;
          }
          // Models say "Calculator" or "WeChat"; the system may list it as 计算器 or 微信. Match the name, the bundle id
          // or the app's file name, then address it by its bundle id.
          const wanted = selector.trim().toLowerCase();
          const aliasBundleId = {
            '计算器': 'com.apple.calculator', 'calculator': 'com.apple.calculator',
            '备忘录': 'com.apple.notes', 'notes': 'com.apple.notes',
            '文本编辑': 'com.apple.textedit', 'textedit': 'com.apple.textedit',
            '日历': 'com.apple.ical', 'calendar': 'com.apple.ical',
            '提醒事项': 'com.apple.reminders', 'reminders': 'com.apple.reminders',
            '终端': 'com.apple.terminal', 'terminal': 'com.apple.terminal',
            '系统设置': 'com.apple.systempreferences', '系统偏好设置': 'com.apple.systempreferences',
            '预览': 'com.apple.preview', 'preview': 'com.apple.preview',
            '访达': 'com.apple.finder', 'finder': 'com.apple.finder',
            '微信': 'com.tencent.xinwechat', 'wechat': 'com.tencent.xinwechat',
            '音乐': 'com.apple.music', '播客': 'com.apple.podcasts', '股市': 'com.apple.stocks',
            '天气': 'com.apple.weather', '地图': 'com.apple.maps', '邮件': 'com.apple.mail',
            '信息': 'com.apple.mobilesms', '通讯录': 'com.apple.addressbook', '照片': 'com.apple.photos',
            '活动监视器': 'com.apple.activitymonitor', '快捷指令': 'com.apple.shortcuts', '词典': 'com.apple.dictionary'
          }[wanted];
          const names = item => [item.name, item.bundle_id, typeof item.launch_path === 'string' ? item.launch_path.split(/[\\/]/).pop().replace(/\.(app|exe)$/i, '') : '']
            .filter(value => typeof value === 'string' && value).map(value => value.toLowerCase());
          const listed = await client.listApps({ signal });
          const path = macAppPath(selector.trim());
          const unique = candidates => {
            if (candidates.length > 1) fail('computer_app_ambiguous');
            return candidates[0];
          };
          const match = path ? unique(listed.filter(item => macAppPath(item.launch_path) === path))
            : unique(listed.filter(item => names(item).includes(wanted)))
              || (aliasBundleId && unique(listed.filter(item => names(item).includes(aliasBundleId))))
              || unique(listed.filter(item => names(item).some(value => value.includes(wanted))));
          // Whether the user already had the app open: only an app NextMux starts here may later quit with its tab.
          const same = item => match?.launch_path ? macAppPath(item.launch_path) === macAppPath(match.launch_path)
            : match?.bundle_id ? String(item.bundle_id || '').toLowerCase() === match.bundle_id.toLowerCase() : Boolean(match) && item.name === match.name;
          const runningBefore = listed.filter(item => item.running !== false && Number.isSafeInteger(item.pid) && item.pid > 0 && same(item));
          const wasRunning = runningBefore.length > 0;
          if (probeOnly || (checkOrOpen && wasRunning && !restartIfRunning)) return {
            running: wasRunning, ...(checkOrOpen && wasRunning ? { requiresRestart: true } : {}),
            app: String(match?.name || selector).slice(0, 120), appId: String(match?.bundle_id || '').slice(0, 160)
          };
          if (!wasRunning && onlyIfRunning) fail('app_not_running');
          if (restartIfRunning && wasRunning) await this.stopAppForReopen(conversationId, runningBefore, signal);
          const app = await this.macAppHandle(client, match?.launch_path || match?.bundle_id || match?.name || selector.trim(), signal);
          // Launches the app when it is not running yet.
          const state = await app.getState({ signal, includeScreenshot: false });
          const running = (await client.listApps({ signal })).find(item => item.running !== false
            && (match ? same(item) : path ? macAppPath(item.launch_path) === path
              : aliasBundleId ? String(item.bundle_id || '').toLowerCase() === aliasBundleId : item.name === app.name));
          if (!Number.isSafeInteger(running?.pid) || running.pid <= 0) fail('computer_app_not_running');
          const windows = await client.listWindows({ pid: running.pid, onScreenOnly: false, appContext: true, signal });
          const id = item => item.window_id ?? item.windowId;
          // A window another conversation's tab has stays with it; this conversation takes another window of the app.
          const free = item => { const owner = this.windows.get(`${running.pid}:${id(item)}`); return !owner || owner === conversationId; };
          // Off-screen windows (closed documents kept by the app, hidden panels) and untitled child popovers come after real titled windows.
          const offscreen = item => item.is_on_screen === false || item.isOnScreen === false ? 1 : 0;
          const untitled = item => String(item.title || '').trim() ? 0 : 1;
          const hasTitled = windows.some(item => Number.isSafeInteger(id(item)) && (item.layer ?? 0) === 0 && item.bounds?.width > 80 && item.bounds?.height > 80 && !untitled(item));
          const candidates = windows.filter(item => Number.isSafeInteger(id(item)) && (item.layer ?? 0) === 0 && item.bounds?.width > 80 && item.bounds?.height > 80 && (!hasTitled || !untitled(item)));
          const window = candidates.find(item => item.is_app_target === true && free(item) && !offscreen(item))
            || candidates.filter(free).sort((a, b) => offscreen(a) - offscreen(b) || untitled(a) - untitled(b) || (a.z_index ?? 0) - (b.z_index ?? 0))[0];
          if (!window) fail(candidates.some(item => !free(item)) ? 'computer_window_owned' : 'app_window_unavailable');
          signal.throwIfAborted();
          if (this.sessions.get(conversationId) !== session || session.closing) fail('computer_session_closed');
          const key = `${running.pid}:${id(window)}`;
          if (session.forgetting.has(key)) fail(this.staleOrClosedCode(conversationId, key));
          const claimed = this.windows.get(key);
          if (claimed && claimed !== conversationId) fail('computer_window_owned');
          this.windows.set(key, conversationId);
          this.closedWindows.delete(`${conversationId}:${key}`);
          const program = typeof running.launch_path === 'string' ? running.launch_path.split(/[\\/]/).pop().replace(/\.(app|exe)$/i, '') : '';
          return { pid: running.pid, windowId: id(window), app: String(app.name || selector).slice(0, 120), title: String(window.title || state?.window || '').slice(0, 200),
            appId: String(match?.bundle_id || running.bundle_id || program || '').slice(0, 160), launched: !wasRunning || restartIfRunning };
        });
        session.queue = run.catch(() => undefined);
        const output = await run;
        if (signal.aborted && extractPriorityCode(signal.reason)) throw signal.reason;
        return { ok: true, ...output };
      } finally {
        session.active -= 1;
        this.scheduleIdleRelease(conversationId, session);
      }
    } catch (error) {
      const code = safeCode(error, signal);
      return { ok: false, error: code, ...(code === 'interrupted_by_user_esc' ? { userInterrupted: true } : {}) };
    } finally { clearTimeout(timeout); this.tabControllers.delete(controller); }
  }
  forgetWindow(conversationId, pid, windowId, reason) {
    if ((pid !== undefined || windowId !== undefined)
      && (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0 || !Number.isSafeInteger(Number(windowId)) || Number(windowId) <= 0)) return Promise.resolve(false);
    const keys = pid !== undefined && windowId !== undefined ? [`${Number(pid)}:${Number(windowId)}`]
      : [...this.windows].filter(([, ownerConversation]) => conversationId && ownerConversation === conversationId).map(([key]) => key);
    const abortErr = reason === 'computer_window_closed' ? abortReason('computer_window_closed') : undefined;
    return Promise.all(keys.map(key => {
      const claimed = this.windows.get(key);
      if (conversationId && claimed && claimed !== conversationId) return;
      const targetConversation = claimed || conversationId;
      if (reason === 'computer_window_closed' && targetConversation) {
        this.closedWindows.add(`${targetConversation}:${key}`);
      }
      const session = this.sessions.get(targetConversation);
      session?.observations.delete(key);
      const targetPid = Number(key.split(':')[0]);
      if (this.windowsScreenshotTargets.get(targetPid) === key) this.windowsScreenshotTargets.delete(targetPid);
      for (const operation of [...this.operations.values(), ...this.tabControllers.values()]) {
        if (operation.conversationId === targetConversation && operation.windowKey === key) {
          if (abortErr) operation.controller.abort(abortErr);
          else operation.controller.abort();
        }
      }
      if (session?.forgetting.has(key)) return session.forgetting.get(key);
      const remove = () => {
        if (session && this.sessions.get(targetConversation) !== session) return;
        if (this.windows.get(key) === claimed) this.windows.delete(key);
      };
      if (!session?.active) { remove(); return; }
      // Keep ownership until native work has unwound, but immediately revoke
      // its snapshot. A new conversation must not race a late mouse/key event.
      const pending = Promise.allSettled([session.queue, ...(session.windowQueues?.values() || [])]).then(() => {
        remove(); session.observations.delete(key); session.forgetting.delete(key);
      });
      session.forgetting.set(key, pending);
      return pending;
    }));
  }
  /** Runs a key-sending action; userStopKey() ignores Esc while it runs and just after. */
  async sendingKeys(action) {
    this.syntheticKeys += 1;
    try { return await action(); } finally { this.syntheticKeys -= 1; this.syntheticKeyAt = Date.now(); }
  }
  /** True when an Esc now comes from the user's keyboard, not from keys NextMux is sending. */
  userStopKey(now = Date.now()) { return this.syntheticKeys === 0 && now - this.syntheticKeyAt > 800; }
  /** The user pressed Esc while the AI controls the computer: end every control session. */
  stopAllForUser() {
    const reason = abortReason('interrupted_by_user_esc');
    const conversations = new Map();
    for (const [conversationId, session] of this.sessions) {
      conversations.set(conversationId, session.owner);
    }
    for (const operation of this.operations.values()) {
      if (operation.conversationId && !conversations.has(operation.conversationId)) {
        conversations.set(operation.conversationId, operation.owner);
      }
    }
    for (const lease of this.tabControllers.values()) {
      if (lease.conversationId && !conversations.has(lease.conversationId)) {
        conversations.set(lease.conversationId, lease.owner);
      }
    }
    for (const conversationId of this.overlay?.conversations?.() || []) {
      if (conversationId && !conversations.has(conversationId)) {
        conversations.set(conversationId, this.activeConversations.get(conversationId));
      }
    }
    const now = Date.now();
    for (const [conversationId, owner] of this.activeConversations) {
      if (conversationId && !conversations.has(conversationId) && now - (this.activityAt.get(conversationId) || 0) <= ESC_RECENT_ACTIVITY_MS) {
        conversations.set(conversationId, owner);
      }
    }
    const stopped = [];
    for (const [conversationId, owner] of conversations) {
      this.userEscInterrupted.add(conversationId);
      for (const operation of this.operations.values()) {
        if (operation.conversationId === conversationId) operation.controller.abort(reason);
      }
      for (const lease of this.tabControllers.values()) {
        if (lease.conversationId === conversationId) lease.controller.abort(reason);
      }
      stopped.push({ conversationId, owner });
      if (this.sessions.has(conversationId)) {
        const activeSession = this.sessions.get(conversationId);
        if (activeSession) activeSession.stoppedByUser = true;
        void this.release(conversationId, owner).catch(() => undefined);
      } else {
        for (const [key, claimed] of this.windows) if (claimed === conversationId) this.windows.delete(key);
      }
    }
    this.activeConversations.clear();
    this.activityAt.clear();
    try { for (const { conversationId } of stopped) this.overlay?.end(conversationId); } catch { /* cosmetic */ }
    return stopped;
  }
  serializeForeground(action) {
    const result = this.foregroundQueue.then(action, action); this.foregroundQueue = result.catch(() => undefined); return result;
  }
  cancel(conversationId, requestId, owner) {
    const operation = this.operations.get(`${owner}:${conversationId}:${requestId}`);
    if (!operation) return false; operation.controller.abort(); return true;
  }
  async release(conversationId, owner) {
    if (owner === undefined) owner = this.sessions.get(conversationId)?.owner;
    const session = this.sessions.get(conversationId);
    // Releasing a conversation always takes its frame down at once, also when its session already closed; only a live
    // session another page owns keeps it (that page's AI is still acting).
    if (!session || session.owner === owner) { try { this.overlay?.end(conversationId); } catch { /* cosmetic */ } }
    if (!session || session.owner !== owner) {
      if (!session) for (const [key, conversation] of this.windows) if (conversation === conversationId) this.windows.delete(key);
      return false;
    }
    if (session.closing) { await session.closing; return true; }
    this.clearIdleRelease(session);
    session.closing = (async () => {
      const pending = [];
      for (const lease of this.tabControllers.values()) if (lease.conversationId === conversationId && lease.owner === owner) lease.controller.abort();
      pending.push(session.queue, ...(session.windowQueues?.values() || []));
      for (const [key, operation] of this.operations) if (key.startsWith(`${owner}:${conversationId}:`)) {
        operation.controller.abort(); pending.push(operation.promise);
      }
      // Keep the window lease until dispatched native work reaches its terminal
      // result. Otherwise the next conversation could race a late input event.
      await Promise.allSettled(pending);
      try { await this.closeSessionClient(session); }
      catch {
        // ComputerUse.close() is one-shot. If it fails, retire the whole
        // shared host rather than leaving an unclosable session alongside a
        // different conversation's still-live native connection.
        const host = this.host;
        this.invalidateGeneration(host);
        await this.stopHost(host);
        fail('computer_session_close_failed');
      }
      if (this.sessions.get(conversationId) === session) {
        this.sessions.delete(conversationId);
        for (const [key, conversation] of this.windows) if (conversation === conversationId) this.windows.delete(key);
        try { this.overlay?.end(conversationId); } catch { /* cosmetic */ }
        await this.stopIdleHost();
      }
    })();
    const closing = session.closing;
    try { await closing; return true; }
    finally { if (this.sessions.get(conversationId) === session && session.closing === closing) session.closing = undefined; }
  }
  async reset() {
    // Invalidation detaches public references immediately, but an old native
    // startup or client close can still be settling. Join those owned tasks too;
    // loads started by a newer generation after reset begins are not included.
    const pendingLoads = [...this.pendingLoads], closingClients = [...this.closingClients];
    this.generation += 1;
    this.windowsScreenshotTargets.clear();
    const hosts = new Set(this.failedHosts);
    if (this.host) hosts.add(this.host);
    this.host = undefined; this.loading = undefined;
    // Stop first: a hung connection attempt must not hold application shutdown.
    const stopped = Promise.allSettled([...hosts].map(host => this.stopHost(host)));
    await Promise.allSettled([...this.sessions].map(([id, session]) => this.release(id, session.owner)));
    await Promise.allSettled(pendingLoads);
    await Promise.allSettled([...closingClients, ...this.closingClients]);
    await stopped;
    await Promise.allSettled([...this.stoppingHosts]);
    if (this.failedHosts.size) fail('computer_driver_shutdown_incomplete');
  }
  async dispose() {
    this.closed = true;
    try { this.overlay?.dispose(); } catch { /* cosmetic */ }
    if (this.platform === 'win32') {
      await this.reset();
      if (this.windowsInput) await this.windowsInput.dispose();
      await this.view?.dispose();
      return;
    }
    // Windows on the virtual display go back to where they were before the driver stops.
    try { await this.view?.dispose(); } catch { /* macOS returns them itself when the display goes */ }
    await this.reset();
    if (this.windowsInput) await this.windowsInput.dispose();
  }
}

function registerComputerAutomation({ ipcMain, app, systemPreferences, trustedMainFrame, automation, BrowserWindow, screen, desktopCapturer, session, webContents, shell, dialog, globalShortcut, nativeImage } = {}) {
  // Esc stops the AI's control while its frame shows (the frame's pill says so). Esc is only held then, and an Esc that
  // NextMux itself sends (the AI's or a plugin's keys, the tab's keyboard) is ignored.
  let escapeHeld = false;
  const conversationSenders = new Map();
  const onEscape = () => {
    if (engine?.userStopKey && !engine.userStopKey()) return;
    for (const key of engine?.windows?.keys?.() || []) {
      const [pid, windowId] = key.split(':').map(Number);
      plugins?.onUserIntervention?.(pid, windowId, 'user_takeover');
    }
    const stopped = new Map();
    for (const item of engine?.stopAllForUser?.() || []) {
      if (item?.conversationId) stopped.set(item.conversationId, item.owner);
    }
    for (const conversationId of overlay?.conversations?.() || []) {
      try { overlay?.end?.(conversationId); } catch { /* cosmetic */ }
      engine?.userEscInterrupted?.add?.(conversationId);
      if (!stopped.has(conversationId)) stopped.set(conversationId, engine?.activeConversations?.get?.(conversationId));
    }
    for (const [conversationId, owner] of stopped) {
      const page = (owner !== undefined ? webContents?.fromId?.(owner) : undefined)
        || tabOwners.get(conversationId)
        || conversationSenders.get(conversationId);
      if (page && !page.isDestroyed()) page.send('nextmux:computer:tab-event', { type: 'user-stop', reason: 'escape_key', conversationId, pid: 0, windowId: 0 });
    }
  };
  const holdEscape = active => {
    if (!globalShortcut || active === escapeHeld) return;
    try {
      if (active) escapeHeld = globalShortcut.register('Escape', onEscape) === true;
      else { globalShortcut.unregister('Escape'); escapeHeld = false; }
    } catch { escapeHeld = false; /* another app holds Esc */ }
  };
  const overlay = (BrowserWindow && screen) || globalShortcut ? require('./computer-overlay.cjs').createComputerOverlay({ BrowserWindow, screen, app, onActiveChange: holdEscape }) : undefined;
  // The page that owns each conversation's tabs, told about windows its tab apps open later.
  const tabOwners = new Map();
  const tabClosures = new Map();
  // A followed app can open ordinary extra windows. Only move a plugin when its
  // old window actually closes and exactly one same-conversation successor exists.
  const pluginWindowCandidates = new Map();
  const forgetPluginWindowCandidates = (conversationId, pid, windowId, includeRoot = false) => {
    for (const [key, candidate] of pluginWindowCandidates) {
      if (candidate.conversationId === conversationId && (pid === undefined
        || (candidate.pid === Number(pid) && candidate.windowId === Number(windowId))
        || (includeRoot && candidate.root === Number(pid)))) pluginWindowCandidates.delete(key);
    }
  };
  const incognito = require('./incognito-native.cjs').createIncognitoNativeRegistry();
  const view = desktopCapturer ? require('./computer-window-view.cjs').createComputerWindowView({ app, desktopCapturer, incognito,
    webContentsFromFrame: frame => frame ? webContents?.fromFrame(frame) : undefined,
    onWindowEvent: event => {
      if (event.type === 'window-added' && event.conversationId && Number.isSafeInteger(event.pid) && Number.isSafeInteger(event.windowId)) {
        // A window belongs to one conversation at a time; a later-opened window never moves away from the one that claimed it.
        const key = `${event.pid}:${event.windowId}`;
        if (!engine?.windows?.has?.(key)) engine?.windows?.set?.(key, event.conversationId);
        const root = Number(event.root);
        if (Number.isSafeInteger(root) && root > 0 && engine?.windows?.get?.(key) === event.conversationId
          && [...engine.windows].some(([source, conversationId]) => {
            const [pid, windowId] = source.split(':').map(Number);
            return conversationId === event.conversationId && pid === root && source !== key && plugins?.running?.(pid, windowId);
          })) pluginWindowCandidates.set(key, { ...event, root });
      }
      if (event.type === 'window-closed') {
        forgetPluginWindowCandidates(event.conversationId, event.pid, event.windowId);
        const candidates = [...pluginWindowCandidates.values()].filter(candidate => candidate.conversationId === event.conversationId
          && candidate.root === event.pid && engine?.windows?.get?.(`${candidate.pid}:${candidate.windowId}`) === event.conversationId
          && view?.canView?.(event.conversationId, candidate.pid, candidate.windowId));
        if (candidates.length === 1 && !plugins?.running?.(candidates[0].pid, candidates[0].windowId)) {
          const next = candidates[0];
          plugins?.rebindWindow?.(event.conversationId, event.pid, event.windowId, next.pid, next.windowId, next.title);
        }
        forgetPluginWindowCandidates(event.conversationId, event.pid, event.windowId, true);
        plugins?.stopForWindow(event.pid, event.windowId, 'window_closed');
        engine?.forgetWindow?.(event.conversationId, event.pid, event.windowId, 'computer_window_closed');
      }
      const owner = tabOwners.get(event.conversationId);
      if (owner && !owner.isDestroyed()) owner.send('nextmux:computer:tab-event', event);
    } }) : undefined;
  const engine = automation || new ComputerAutomation({ app, systemPreferences, overlay, view,
    isBuiltinProcess: pid => pid === process.pid || (webContents?.getAllWebContents?.() || []).some(contents => {
      try { return !contents.isDestroyed() && contents.getOSProcessId() === pid; } catch { return false; }
    }) });
  if (automation && !automation.overlay && overlay) automation.overlay = overlay;
  if (automation && !automation.view && view) automation.view = view;
  // Recover owned desktop/audio leases even when the user never opens the tabs UI after a crash.
  if (process.platform === 'win32' && view) void Promise.resolve(app?.whenReady?.()).then(() => view.ready?.()).catch(() => undefined);
  // The app's pages never ask for a screen share; the one getDisplayMedia they make is the tab's live window view.
  if (view && session) app?.whenReady().then(() => session().defaultSession.setDisplayMediaRequestHandler((request, callback) => view.handleDisplayMediaRequest(request, callback),
    { useSystemPicker: false })).catch(() => undefined);
  const owners = new Set();
  const trusted = event => trustedMainFrame(event) && !event.sender.isDestroyed();
  const ownsConversation = (event, conversationId) => {
    const tabOwner = tabOwners.get(conversationId), sessionOwner = engine.sessions?.get(conversationId)?.owner;
    return (!tabOwner || tabOwner.isDestroyed() || tabOwner === event.sender)
      && (sessionOwner === undefined || sessionOwner === event.sender.id);
  };
  const trustedTab = (event, conversationId) => trusted(event) && identifier(conversationId) && ownsConversation(event, conversationId);
  const watchOwner = (sender, conversationId) => {
    const owner = sender.id;
    if (identifier(conversationId)) conversationSenders.set(conversationId, sender);
    if (owners.has(owner)) return;
    owners.add(owner);
    sender.once?.('destroyed', () => {
      owners.delete(owner);
      for (const [id, page] of conversationSenders) if (page === sender) conversationSenders.delete(id);
      for (const [id, session] of engine.sessions || []) if (session.owner === owner) void engine.release(id, owner).catch(() => undefined);
      for (const [id, tabOwner] of tabOwners) if (tabOwner === sender) {
        tabOwners.delete(id);
        forgetPluginWindowCandidates(id);
        void plugins?.stopForConversations([id]);
        const closing = Promise.all([tabClosures.get(id), engine.release(id, owner), engine.forgetWindow?.(id)])
          .then(() => view?.forget(id, undefined, undefined, { close: false }))
          .catch(() => undefined)
          .finally(() => { if (tabClosures.get(id) === closing) tabClosures.delete(id); });
        tabClosures.set(id, closing);
      }
    });
  };
  // Skill plugins (技能插件): installed plugins and their runs on tab windows (app-plugins.cjs), set up below.
  let plugins;
  ipcMain.handle('nextmux:incognito:register', (event, request) => trusted(event)
    && app?.[Symbol.for('nextmux.desktop.is-quitting.v1')]?.() !== true && incognito.register(request, event.sender.id));
  ipcMain.handle('nextmux:incognito:mode', (event, request) => trusted(event)
    && app?.[Symbol.for('nextmux.desktop.is-quitting.v1')]?.() !== true && incognito.setMode(request, event.sender.id));
  ipcMain.handle('nextmux:incognito:finish', (event, ids) => trusted(event) ? incognito.finish(ids, event.sender.id, async selected => {
    await plugins?.stopForConversations(selected);
    await Promise.all(selected.map(async id => {
      forgetPluginWindowCandidates(id);
      await engine.release(id, incognito.owner(id));
      await engine.forgetWindow?.(id);
      await view?.forget(id);
      tabOwners.delete(id);
      conversationSenders.delete(id);
    }));
  }, { applicationQuit: app?.[Symbol.for('nextmux.desktop.is-quitting.v1')]?.() === true }) : false);
  ipcMain.handle('nextmux:computer:capability', event => trusted(event) ? engine.capability() : { available: false, reason: 'permission_required' });
  ipcMain.handle('nextmux:computer:permission', event => trusted(event) ? engine.requestPermission() : false);
  ipcMain.handle('nextmux:computer:action', (event, request) => {
    if (!trusted(event) || !ownsConversation(event, request?.conversationId) || incognito.closed(request?.conversationId)) return { requestId: request?.id || '', ok: false, error: 'computer_untrusted_sender' };
    const owner = event.sender.id;
    watchOwner(event.sender, request?.conversationId);
    return engine.run(request, owner);
  });
  ipcMain.handle('nextmux:computer:cancel', (event, conversationId, requestId) => trusted(event) && engine.cancel(conversationId, requestId, event.sender.id));
  ipcMain.handle('nextmux:computer:release', (event, conversationId) => trusted(event) ? engine.release(conversationId, event.sender.id) : false);
  ipcMain.handle('nextmux:computer:clear-user-esc', (event, conversationId) => trustedTab(event, conversationId) ? Boolean(engine.clearUserEsc?.(conversationId)) : false);
  const windowArgs = (pid, windowId) => [Number(pid), Number(windowId)];
  const pointerInput = input => ({ kind: input?.kind, x: Number(input?.x), y: Number(input?.y),
    direction: input?.direction, amount: Number(input?.amount), button: input?.button,
    from: input?.from && { x: Number(input.from.x), y: Number(input.from.y) },
    to: input?.to && { x: Number(input.to.x), y: Number(input.to.y) },
    durationMs: input?.durationMs === undefined ? undefined : Number(input.durationMs),
    ...(input?.whole === true ? { whole: true } : {}),
    ...(input?.restore === true ? { restore: true } : {}),
    ...(['auto', 'background', 'foreground'].includes(input?.delivery) ? { delivery: input.delivery } : {}),
    ...(['agent', 'user', 'plugin'].includes(input?.source) ? { source: input.source } : {}) });
  // Only the human's own input in the tab is a takeover: never the AI's calls or a plugin's (audit F9).
  const isUserTakeover = (input, pid, windowId) => input?.source !== 'agent' && input?.source !== 'plugin'
    && (isUserSource(input) || view?.userInput?.(pid, windowId) === true);
  // All tab/plugin input uses the same strict window route. Native view input
  // must never become a hidden fallback after SDK rejection or uncertainty.
  const tabPointer = (conversationId, owner, pid, windowId, pointer) => {
    if (isAgentInput(pointer) && engine.userEscInterrupted?.has?.(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    if (showsAutomationActivity(pointer)) {
      engine.rememberActivity?.(conversationId, owner);
      overlay?.activity(conversationId, engine.sessionLabel?.(conversationId));
    }
    return engine.userPointer(conversationId, owner, { ...pointer, pid, windowId, delivery: pointer?.delivery || 'background' });
  };
  const tabKeys = (conversationId, owner, pid, windowId, keys) => {
    if (isAgentInput(keys) && engine.userEscInterrupted?.has?.(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    if (showsAutomationActivity(keys)) {
      engine.rememberActivity?.(conversationId, owner);
      overlay?.activity(conversationId, engine.sessionLabel?.(conversationId));
    }
    return engine.userKeys(conversationId, owner, { ...keys, pid, windowId, delivery: keys?.delivery || 'background' });
  };
  ipcMain.handle('nextmux:computer:view:capability', event => trusted(event) && view ? (view.ready ? view.ready() : view.capability()) : { live: false, park: false, preference: 'desktop' });
  ipcMain.handle('nextmux:computer:view:preference', async (event, value) => {
    if (!trusted(event) || !view) return { live: false, park: false, preference: 'desktop' };
    view.setPreference(value);
    return view.ready ? view.ready() : view.capability();
  });
  // Settings → tool permissions: apps NextMux opened for tabs quit with their tab / NextMux ("quit"), or go back ("desktop").
  ipcMain.handle('nextmux:computer:view:close-behavior', (event, value) => trusted(event) && view ? view.setCloseBehavior(value) : 'desktop');
  ipcMain.handle('nextmux:computer:view:start', (event, conversationId, pid, windowId) => trustedTab(event, conversationId) && view
    ? view.arm(event.sender.id, conversationId, ...windowArgs(pid, windowId)) : { ok: false, error: 'live_view_unsupported' });
  const nativeWindowHandleNumber = sender => {
    try {
      const buf = BrowserWindow?.fromWebContents?.(sender)?.getNativeWindowHandle?.();
      if (!Buffer.isBuffer(buf)) return 0;
      return buf.length >= 8 ? Number(buf.readBigInt64LE(0)) : buf.length >= 4 ? buf.readInt32LE(0) : 0;
    } catch { return 0; }
  };
  ipcMain.handle('nextmux:computer:view:place', (event, conversationId, pid, windowId, placement, activate) => trustedTab(event, conversationId) && view
    ? view.place(conversationId, ...windowArgs(pid, windowId), placement, { activate: activate === true, hostWindow: nativeWindowHandleNumber(event.sender) }) : { ok: false, error: 'live_view_unsupported' });
  // The tab's mouse shares the strict window-scoped route with model input.
  ipcMain.handle('nextmux:computer:view:pointer', (event, conversationId, input) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'window_not_viewable' };
    watchOwner(event.sender, conversationId);
    const pointer = pointerInput(input);
    if (isAgentInput(pointer) && engine.userEscInterrupted?.has?.(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    const pid = Number(input?.pid), windowId = Number(input?.windowId);
    if (!view.canView(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
    if (isUserTakeover(input, pid, windowId)) plugins?.onUserIntervention?.(pid, windowId, 'user_takeover');
    return tabPointer(conversationId, event.sender.id, pid, windowId, pointer);
  });
  // tabs.open_app: the engine finds the app's window, the view keeps it in the tab (off the desktop on macOS/Windows, per the
  // user's last choice) and quiet until the tab's sound switch is turned on.
  ipcMain.handle('nextmux:computer:view:open-app', async (event, conversationId, selector, options) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'live_view_unsupported' };
    await tabClosures.get(conversationId);
    if (!trustedTab(event, conversationId)) return { ok: false, error: 'computer_session_closed' };
    if (incognito.closed(conversationId)) return { ok: false, error: 'incognito_session_closed' };
    const source = ['agent', 'plugin', 'user', 'passive'].includes(options?.source) ? options.source : undefined;
    if (source !== 'user' && source !== 'passive' && engine.userEscInterrupted?.has?.(conversationId)) return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    watchOwner(event.sender, conversationId);
    const opened = await engine.openAppInTab(conversationId, event.sender.id, selector, { onlyIfRunning: options?.onlyIfRunning === true,
      probeOnly: options?.probeOnly === true, checkOrOpen: options?.checkOrOpen === true, restartIfRunning: options?.restartIfRunning === true,
      ...(source ? { source } : {}) });
    if (!opened.ok || options?.probeOnly === true || opened.requiresRestart) return opened;
    if (event.sender.isDestroyed()) { await engine.release(conversationId, event.sender.id); return { ok: false, error: 'computer_session_closed' }; }
    if (incognito.closed(conversationId)) { await engine.release(conversationId, event.sender.id); return { ok: false, error: 'incognito_session_closed' }; }
    tabOwners.set(conversationId, event.sender);
    const placement = await view.openInTab(conversationId, opened.pid, opened.windowId, { launched: opened.launched === true, appPid: opened.appPid, sharedHost: opened.sharedHost,
      executables: [opened.executable, opened.windowExecutable].filter(item => typeof item === 'string' && item) });
    if (event.sender.isDestroyed() || incognito.closed(conversationId)) {
      await engine.release(conversationId, event.sender.id);
      await view.forget(conversationId);
      tabOwners.delete(conversationId);
      return { ok: false, error: 'computer_session_closed' };
    }
    return { ...opened, ...placement };
  });
  // A tab dragged out of the strip into a window of its own (computer-tab-window.cjs).
  if (view && BrowserWindow && screen) {
    const tabWindows = require('./computer-tab-window.cjs').registerComputerTabWindows({ ipcMain, BrowserWindow, screen, view, trusted, ownsConversation,
      pointer: (conversationId, owner, pid, windowId, input) => {
        const pointer = pointerInput(input);
        plugins?.onUserIntervention?.(Number(pid), Number(windowId), 'user_takeover');
        return tabPointer(conversationId, owner, pid, windowId, { ...pointer, source: 'user', restore: true, ...(pointer.kind === 'drag' ? {} : { delivery: 'auto' }) });
      },
      keys: (conversationId, owner, pid, windowId, keys) => {
        plugins?.onUserIntervention?.(Number(pid), Number(windowId), 'user_takeover');
        return tabKeys(conversationId, owner, pid, windowId, { ...keys, source: 'user', restore: true, delivery: 'auto' });
      } });
    // The single quit coordinator calls this only after confirmation and every
    // workbench save/close veto have passed. before-quit can still be cancelled.
    if (app) app[Symbol.for('nextmux.desktop.quit-tab-cleanup.v1')] = () => tabWindows.closeAll();
  }
  if (view && shell && dialog && nativeImage) {
    plugins = require('./app-plugins.cjs').registerAppPlugins({ ipcMain, app, shell, dialog, BrowserWindow, globalShortcut, nativeImage, view, trusted, incognito, platform: engine.platform,
      // The same input path as the tab's own keys and clicks: the display helper on macOS, the driver on Windows.
      input: {
        // The native Windows driver supports holds, chords, standalone modifiers, and pointer hover via Post.
        capabilities: engine.platform === 'win32' && typeof engine.nativeInput === 'function' || engine.platform === 'darwin' && view?.capability?.().pointer
          ? { keyHold: true, chords: true, modifierKeys: true, pointerMove: true } : { keyHold: false, chords: false, modifierKeys: false, pointerMove: false },
        // keepFront/delivery are not an authorization to inject system events.
        keys: (conversationId, owner, pid, windowId, keys) => tabKeys(conversationId, owner, pid, windowId,
          { ...keys, source: 'plugin', delivery: 'background' }),
        pointer: (conversationId, owner, pid, windowId, input) => tabPointer(conversationId, owner, pid, windowId,
          { ...pointerInput(input), source: 'plugin', signal: input?.signal, whole: true, delivery: 'background' })
      } });
  }
  // The AI's own control of its tabs (tabs.screenshot / tabs.key / tabs.type; clicks and scrolls use the pointer
  // channel): apart from computer.*, which works on the user's desktop.
  ipcMain.handle('nextmux:computer:view:snapshot', (event, conversationId, pid, windowId, maxSize, options) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'live_view_unsupported' };
    watchOwner(event.sender, conversationId);
    const source = ['agent', 'user', 'plugin'].includes(options?.source) ? options.source : undefined;
    // A snapshot without a source is the tab's live picture for the user; tabs.screenshot says 'agent'.
    if (source === 'agent' && engine.userEscInterrupted?.has?.(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    if (showsAutomationActivity({ source })) {
      engine.rememberActivity?.(conversationId, event.sender.id);
      overlay?.activity(conversationId, engine.sessionLabel?.(conversationId));
    }
    return typeof engine.captureView === 'function'
      ? engine.captureView(conversationId, event.sender.id, ...windowArgs(pid, windowId), maxSize, { source })
      : view.snapshot(conversationId, ...windowArgs(pid, windowId), maxSize);
  });
  ipcMain.handle('nextmux:computer:view:keys', (event, conversationId, input) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'window_not_viewable' };
    watchOwner(event.sender, conversationId);
    const keys = { text: input?.text, key: input?.key, keys: input?.keys, modifiers: input?.modifiers,
      holdMs: input?.holdMs === undefined ? undefined : Number(input.holdMs), ...(input?.restore === true ? { restore: true } : {}),
      ...(['auto', 'background', 'foreground'].includes(input?.delivery) ? { delivery: input.delivery } : {}),
      ...(['agent', 'user', 'plugin'].includes(input?.source) ? { source: input.source } : {}) };
    if (isAgentInput(keys) && engine.userEscInterrupted?.has?.(conversationId)) {
      return { ok: false, error: 'interrupted_by_user_esc', userInterrupted: true };
    }
    const pid = Number(input?.pid), windowId = Number(input?.windowId);
    if (!view.canView(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
    if (isUserTakeover(input, pid, windowId)) plugins?.onUserIntervention?.(pid, windowId, 'user_takeover');
    return tabKeys(conversationId, event.sender.id, pid, windowId, keys);
  });
  ipcMain.handle('nextmux:computer:view:state', (event, conversationId, pid, windowId) => trustedTab(event, conversationId) && view
    ? view.windowState(conversationId, ...windowArgs(pid, windowId)) : { ok: false, error: 'live_view_unsupported' });
  // The tab's 键鼠 switch (off by default): whether the user may drive the window, in the tab or on the desktop.
  ipcMain.handle('nextmux:computer:view:user-input', (event, conversationId, pid, windowId, on) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'live_view_unsupported' };
    const result = view.setUserInput(conversationId, ...windowArgs(pid, windowId), on === true);
    if (on === true && view.canView(conversationId, Number(pid), Number(windowId))) plugins?.onUserIntervention?.(Number(pid), Number(windowId), 'user_input');
    return result;
  });
  ipcMain.handle('nextmux:computer:view:sound', (event, conversationId, pid, windowId, on) => trustedTab(event, conversationId) && view
    ? view.setSound(conversationId, ...windowArgs(pid, windowId), on === true) : { ok: false, error: 'live_view_unsupported' });
  ipcMain.handle('nextmux:computer:view:forget', (event, conversationId, pid, windowId, close) => {
    if (!trustedTab(event, conversationId) || !view) return false;
    if ((pid !== undefined || windowId !== undefined)
      && (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0 || !Number.isSafeInteger(Number(windowId)) || Number(windowId) <= 0)) return false;
    // A closed tab ends the plugin run on its window.
    if (pid !== undefined) plugins?.stopForWindow(Number(pid), Number(windowId), 'tab_closed');
    else void plugins?.stopForConversations([conversationId]);
    forgetPluginWindowCandidates(conversationId, pid, windowId, true);
    view.revokeCapture?.(conversationId, ...(pid === undefined ? [] : windowArgs(pid, windowId)));
    const drained = engine.forgetWindow?.(conversationId, pid, windowId, close !== false ? 'computer_window_closed' : undefined);
    const cleanup = Promise.resolve(drained).then(() => view.forget(conversationId, ...(pid === undefined ? [] : windowArgs(pid, windowId)), ...(close === false ? [{ close: false }] : [])));
    const closing = Promise.all([tabClosures.get(conversationId), cleanup]).then(() => {
      if (view.hasWindows?.(conversationId) === false && tabOwners.get(conversationId) === event.sender) tabOwners.delete(conversationId);
      return true;
    }).finally(() => { if (tabClosures.get(conversationId) === closing) tabClosures.delete(conversationId); });
    tabClosures.set(conversationId, closing);
    return closing;
  });
  ipcMain.handle('nextmux:computer:window-terminate', async (event, conversationId, pid, windowId) => {
    if (!trustedTab(event, conversationId) || !view) return { ok: false, error: 'window_not_viewable' };
    if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0 || !Number.isSafeInteger(Number(windowId)) || Number(windowId) <= 0) {
      return { ok: false, error: 'window_not_viewable' };
    }
    const [p, w] = windowArgs(pid, windowId);
    plugins?.stopForWindow(p, w, 'tab_closed');
    forgetPluginWindowCandidates(conversationId, p, w, true);
    view.revokeCapture?.(conversationId, p, w);
    await Promise.resolve(engine.forgetWindow?.(conversationId, p, w, 'computer_window_closed')).catch(() => undefined);
    return typeof view.terminate === 'function' ? view.terminate(conversationId, p, w) : { ok: false, error: 'live_view_unsupported' };
  });
  ipcMain.handle('nextmux:computer:keepalive', (event, conversationIds) => trusted(event) && Array.isArray(conversationIds) && conversationIds.length <= 64
    ? engine.renew(conversationIds.filter(identifier), event.sender.id) : 0);
  if (app && view) app[Symbol.for('nextmux.desktop.visibility-changed.v1')] = visible => view.setWorkbenchVisible?.(visible);
  // Electron does not await a promise returned by will-quit listeners. The
  // native host's stop and socket teardown must finish before the main process
  // exits, after the workbench has already passed its close/save vetoes.
  let quitDrain, quitReady = false;
  app?.on('will-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    if (quitDrain) return;
    quitDrain = Promise.resolve().then(() => Promise.allSettled([...tabClosures.values()])).then(() => plugins?.dispose()).then(() => engine.dispose()).then(() => {
      quitReady = true;
      // Electron can ignore a reentrant quit while the previous will-quit
      // dispatch is still unwinding, especially after it closed a window.
      // Resume on the next event-loop turn after native teardown completes.
      setImmediate(() => app.quit());
    }, () => {
      // Keep the application alive so a subsequent quit can retry cleanup.
      // Native errors may contain private window contents; log no raw detail.
      quitDrain = undefined;
      console.error('[nextmux] computer driver shutdown did not complete');
    });
  });
  return engine;
}
module.exports = { ComputerAutomation, registerComputerAutomation, computerFailure, computerActionFields: Object.freeze(Object.fromEntries(Object.entries(actions).map(([key, value]) => [key, Object.freeze([...value])])))};
