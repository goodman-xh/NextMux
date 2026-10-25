'use strict';

// The live view of an app window in its conversation's tab (the tabs above the conversation), and where that
// window lives while the AI works in it.
//
// Live view: the renderer shows the window through the system's own window capture (ScreenCaptureKit on macOS,
// Windows Graphics Capture on Windows) with getDisplayMedia. This module answers that request with exactly the
// window the conversation observed: no picker, no screen, no other window.
//
// Placement (macOS): with "tab only", a window the AI works in moves to a virtual display that is not one of the
// user's screens (native/display/NextMuxDisplayHelper.m), so it is seen only in the tab while the AI keeps
// acting on it in the background. "Show on desktop" brings it back to the user's screen. Windows uses a background
// virtual desktop when supported; its input driver posts directly to each target window.
//
// The tab's mouse and sound switches are off by default. Off, the user cannot click the window through the tab by
// accident, and the app is silent (macOS: a muting Core Audio tap in the helper; Windows: the app's volume-mixer
// mute). On, clicks and scrolls in the tab reach the window, and the app plays sound as usual.

const { spawn: spawnProcess, execFile: execFileProcess } = require('node:child_process');
const { existsSync, readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { join, win32: winPath } = require('node:path');
const { release, tmpdir } = require('node:os');

const HELPER_READY_MS = 8_000;
const HELPER_REPLY_MS = 6_000;
// The virtual display is removed a while after the last window left it.
const HELPER_IDLE_MS = 60_000;
const ARM_MS = 10_000;
const MAX_VIEWABLE = 64;
// Windows mutes only audio sessions that exist; the next look at the window mutes new ones, at most this often.
const WINDOWS_MUTE_REFRESH_MS = 30_000;

const windowKey = (pid, windowId) => `${pid}:${windowId}`;
const validWindow = (pid, windowId) => Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(windowId) && windowId > 0;
/**
 * The install folder that identifies a Windows app family: Program Files\X, ProgramData\X, AppData\Local\Programs\X,
 * AppData\(Local|Roaming)\X, WindowsApps\X, or two levels below a drive root (C:\WeGameApps\英雄联盟). A launcher and
 * the app or game it starts usually share it. System folders have no family. Lower-case, with a trailing backslash.
 */
function windowsAppRoot(file) {
  if (typeof file !== 'string' || !/^[a-z]:\\/i.test(file)) return '';
  const parts = winPath.dirname(file).split('\\').filter(Boolean);
  const lower = parts.map(part => part.toLowerCase());
  if (lower[1] === 'windows') return '';
  if (['desktop', 'downloads', 'documents', 'temp', 'tmp', 'tools', 'programs'].includes(lower.at(-1))) return '';
  let depth;
  const apps = lower.indexOf('windowsapps');
  const data = lower.indexOf('appdata');
  const steam = lower.indexOf('steamapps');
  if (steam >= 0 && lower[steam + 1] === 'common') depth = steam + 3;
  else if (apps >= 0) depth = apps + 2;
  else if (['program files', 'program files (x86)', 'programdata'].includes(lower[1])) depth = 3;
  else if (lower[1] === 'users' && data >= 0) depth = lower[data + 1] === 'local' && lower[data + 2] === 'programs' ? data + 4 : data + 3;
  else if (lower[1] === 'users') depth = parts.length;
  else depth = 3;
  if (parts.length < depth || depth < 2) return '';
  return `${lower.slice(0, Math.min(depth, parts.length)).join('\\')}\\`;
}

// Executable identity is authoritative; titles are presentation, never grouping evidence.
const WINDOWS_LAUNCHER_FAMILIES = [
  { id: 'riot', launchers: ['wegame', 'riotclientservices', 'riotclientux'], install: /^[a-z]:\\wegameapps\\/i, clients: ['leagueclient', 'leagueclientux'], games: ['league of legends'] },
  { id: 'steam', launchers: ['steam'], install: /\\steamapps\\common\\/i, clients: [], games: [] },
  { id: 'battle.net', launchers: ['battle.net', 'battle.net launcher'], clients: [], games: [] },
  { id: 'epic', launchers: ['epicgameslauncher'], clients: [], games: [] }
];
const WINDOW_HELPERS = new Set([ 'crossproxy', 'teniodl', 'tphelper', 'taslogin', 'sguard64', 'sguardsvc64',
  'cef_frame_render', 'crashpad_handler', 'wegamehelper', 'riotclientcrashhandler', 'pallas', 'gameoverlayui', 'steamwebhelper',
  'crashreporter', 'werfault', 'textinputhost', 'ctfmon', 'applicationframehost']);
const windowsProgram = file => winPath.basename(String(file || '')).replace(/\.exe$/i, '').toLowerCase();
function windowsWindowRole(row) {
  const program = windowsProgram(row.executable);
  for (const family of WINDOWS_LAUNCHER_FAMILIES) {
    if (family.launchers.includes(program)) return 'launcher';
    if (family.clients.includes(program)) return 'client';
    if (family.games.includes(program)) return 'game';
  }
  return (row.ancestors || []).some(file => WINDOWS_LAUNCHER_FAMILIES.some(family => family.launchers.includes(windowsProgram(file)))) ? 'game' : 'app';
}
function windowsRelatedWindow(source, candidate) {
  const name = windowsProgram(candidate.executable), origin = windowsProgram(source.executable);
  if (WINDOW_HELPERS.has(name) || WINDOW_HELPERS.has(origin)) return false;
  if (source.pid === candidate.pid) return true;
  if ((candidate.ancestorPids || []).includes(source.pid) || (source.ancestorPids || []).includes(candidate.pid)) return true;
  const executable = String(source.executable || '').toLowerCase();
  if (executable && (candidate.ancestors || []).some(file => String(file).toLowerCase() === executable)) return true;
  if (WINDOWS_LAUNCHER_FAMILIES.some(family => [...family.launchers, ...family.clients, ...family.games].includes(origin)
    && [...family.launchers, ...family.clients, ...family.games].includes(name))) return true;
  if (WINDOWS_LAUNCHER_FAMILIES.some(family => family.launchers.includes(origin) && family.install?.test(String(candidate.executable || '')))) return true;
  const root = windowsAppRoot(executable), nextRoot = windowsAppRoot(candidate.executable);
  // Shared vendor directories (Tencent, Microsoft) alone cannot combine independent products.
  if (!root || root !== nextRoot || /\\(?:tencent|microsoft|google|electronic arts|epic games)\\$/.test(root)) return false;
  return true;
}

function defaultHelperPath(app) {
  return app?.isPackaged
    ? join(process.resourcesPath, 'display', 'NextMuxDisplayHelper')
    : join(__dirname, 'native', 'display', 'macos', 'NextMuxDisplayHelper');
}

/**
 * @param {{ platform?: string, app?: any, desktopCapturer?: any, webContentsFromFrame?: (frame: any) => any,
 *   helperPath?: string, spawn?: typeof spawnProcess, execFile?: typeof execFileProcess, idleMs?: number, helperReplyMs?: number }} options
 */
function createComputerWindowView({ platform = process.platform, app, desktopCapturer, webContentsFromFrame, helperPath, incognito,
  spawn = spawnProcess, execFile = execFileProcess, idleMs = HELPER_IDLE_MS, helperReplyMs = HELPER_REPLY_MS, onWindowEvent, windowsServices: suppliedWindowsServices } = {}) {
  const helperFile = helperPath || defaultHelperPath(app);
  // conversation → windows it observed (only those can be viewed or moved for it).
  const viewable = new Map();
  // Stop admitting reads/input while a close waits for native input to drain,
  // without losing the records needed to return/mute/close that exact window.
  const suspended = new Map();
  const selectedKeys = (conversationId, pid, windowId) => pid === undefined && windowId === undefined
    ? [...(viewable.get(conversationId) || [])] : validWindow(pid, windowId) ? [windowKey(pid, windowId)] : undefined;
  // webContents id → the one window source its next getDisplayMedia call gets.
  const armed = new Map();
  const revokeCaptures = (conversationId, keys) => {
    for (const [senderId, pending] of armed) if ((conversationId === undefined || pending.conversationId === conversationId)
      && keys.has(windowKey(pending.pid, pending.windowId))) armed.delete(senderId);
  };
  // window key → conversation, for windows on the virtual display.
  const parked = new Map();
  // Windows the user brought to the desktop: the AI's next look does not send them back to the tab.
  const onDesktop = new Set();
  let preference = platform === 'darwin' ? 'tab' : 'desktop';
  let explicitPreference;
  // Windows whose sound the user turned on, and apps (pid) NextMux muted with the windows that keep them muted.
  const soundOn = new Set();
  const mutedApps = new Map();
  const windowsMutedAt = new Map();
  // Apps shown in tabs (pid → conversations): their later windows, child processes and launched apps join the tabs.
  const followedApps = new Map();
  // Apps NextMux started to show in a tab, with the apps they started (pid → conversations). The default "desktop"
  // choice returns them to the desktop; "quit" quits them when their last tab closes or NextMux quits.
  // Apps the user already had open always return to the desktop.
  const launchedApps = new Map();
  let closeBehavior = 'desktop';
  // Windows shown in tabs (opened there or joined their app's tab) and those whose tab's 键鼠 switch is on. A tab
  // window on the desktop with the switch off is locked against the user's own clicks and typing (helper "shield").
  const tabWindows = new Set();
  const userInputOn = new Set();
  const NO_SHIELD = JSON.stringify({ windows: [], pids: [] });
  let shieldSent = NO_SHIELD;
  let shieldCount = 0;
  // Restarts after the helper ended unexpectedly (a crash): its mutes, parked windows and lock are put back.
  const helperRestarts = [];
  // A tab's app that quit (or crashed) is noticed within a few seconds on both platforms, so its tab shows
  // "disconnected" and may be opened again; the check runs only while tabs hold windows.
  let livenessTimer;
  const LIVENESS_MS = 5_000;
  // Private folder for plugin frames (raw pixels written by the helper), removed on dispose.
  let frameDirectory;
  let helper;
  let idleTimer;
  // Finish each window's release handshake before its next operation; other windows remain independent.
  const inputQueues = new Map();
  let inputCleanupFailed = false;
  let activeInputs = 0;
  let disposed = false;

  const closedWindows = new Set();
  const windowCapabilities = new Map();
  const windowFamilies = new Map();
  const ownRoot = windowsAppRoot(process.execPath);
  const familyKeyFromExecutables = (executables, fallbackPid) => {
    const roots = (Array.isArray(executables) ? executables : []).filter(item => typeof item === 'string').map(windowsAppRoot).filter(root => root && root !== ownRoot);
    if (roots.some(item => /\\wegame\\$/i.test(item) || /^[a-z]:\\wegameapps\\/i.test(item))) return 'wegame';
    return roots[0] || `pid:${fallbackPid}`;
  };
  const desktopGroupKey = (conversationId, pid, windowId) => {
    const key = windowKey(pid, windowId);
    const family = windowFamilies.get(key) || `pid:${pid}`;
    return `${conversationId || 'default'}:${family}`;
  };
  const launchedWindows = new Map(); // A launched Windows window is closed by HWND, never by a guessed new process.
  const audioPids = new Map(); // UWP's content process, not its shared ApplicationFrameHost.
  let shieldQueue = Promise.resolve({ ok: true });
  const windowsServices = platform === 'win32' ? suppliedWindowsServices || require('./computer-services-windows.cjs').createWindowsServices({
    spawn, onEvent: message => inputBlocked(message),
    onExit: () => {
      shieldSent = ''; windowsMutedAt.clear();
      const now = Date.now();
      while (helperRestarts.length && now - helperRestarts[0] > 60_000) helperRestarts.shift();
      if (!disposed && helperRestarts.length < 3 && (tabWindows.size || mutedApps.size)) {
        helperRestarts.push(now);
        setTimeout(() => { if (!disposed) void (async () => {
          await windowsServices.ready();
          for (const pid of mutedApps.keys()) await windowsServices.mute(pid, true);
          for (const [key, conversationId] of [...parked.entries()]) {
            const [pid, windowId] = key.split(':').map(Number);
            if (!onDesktop.has(key) && owns(conversationId, pid, windowId)) {
              await windowsServices.park?.(pid, windowId, desktopGroupKey(conversationId, pid, windowId)).catch(() => undefined);
            }
          }
          await syncShield();
        })().catch(() => undefined); }, 500).unref?.();
      }
    }
  }) : undefined;
  const nativeCapabilities = () => windowsServices?.capability() || {};
  const probeWindow = async (pid, windowId) => {
    if (!windowsServices) return;
    await windowsServices.ready();
    if (nativeCapabilities().canPark === true && !explicitPreference) preference = 'tab';
    const reply = await windowsServices.windowCapability(pid, windowId);
    const windowCanPark = reply.canPark === true || (reply.canPark === undefined && nativeCapabilities().canPark === true && reply.ok !== false && !reply.parkReason && !reply.error);
    windowCapabilities.set(windowKey(pid, windowId), {
      canPark: windowCanPark,
      ...(windowCanPark ? {} : { parkReason: reply.parkReason || reply.error || 'foreground_input_required' })
    });
  };
  const canPark = () => platform === 'darwin' && existsSync(helperFile)
    || platform === 'win32' && nativeCapabilities().canPark === true;
  // Core Audio process taps arrived in macOS 14.2 (Darwin 23.2).
  const darwinVersion = () => release().split('.').map(Number);
  const canMute = () => platform === 'win32' && nativeCapabilities().sound === true
    || platform === 'darwin' && existsSync(helperFile) && (darwinVersion()[0] > 23 || darwinVersion()[0] === 23 && darwinVersion()[1] >= 2);
  const capability = () => ({
    live: ['darwin', 'win32'].includes(platform) && Boolean(desktopCapturer),
    park: canPark(),
    pointer: canPark() || platform === 'win32',
    sound: canMute(),
    lock: platform === 'win32' ? nativeCapabilities().lock === true : canPark(),
    keyHold: canPark() || platform === 'win32',
    chords: canPark() || platform === 'win32',
    modifierKeys: canPark() || platform === 'win32',
    pointerMove: canPark() || platform === 'win32',
    ocr: platform === 'win32' ? nativeCapabilities().ocr === true : canPark() && darwinVersion()[0] >= 23,
    ...(platform === 'win32' ? { ocrLanguages: nativeCapabilities().ocrLanguages || [], ...(canPark() ? {} : { parkReason: 'foreground_input_required' }) } : {}),
    preference: canPark() ? (explicitPreference || 'tab') : 'desktop'
  });

  const owns = (conversationId, pid, windowId) => !disposed && viewable.get(conversationId)?.has(windowKey(pid, windowId)) === true
    && suspended.get(conversationId)?.has(windowKey(pid, windowId)) !== true;
  const unsuspend = (conversationId, key) => {
    const paused = suspended.get(conversationId);
    paused?.delete(key);
    if (paused && !paused.size) suspended.delete(conversationId);
  };
  const revokeCapture = (conversationId, pid, windowId) => {
    const keys = selectedKeys(conversationId, pid, windowId);
    if (!keys) return false;
    const owned = keys.filter(key => viewable.get(conversationId)?.has(key));
    if (owned.length) {
      let paused = suspended.get(conversationId);
      if (!paused) { paused = new Set(); suspended.set(conversationId, paused); }
      for (const key of owned) paused.add(key);
    }
    revokeCaptures(conversationId, new Set(keys));
    return true;
  };
  const allow = (conversationId, pid, windowId) => {
    let windows = viewable.get(conversationId);
    if (!windows) { windows = new Set(); viewable.set(conversationId, windows); }
    const key = windowKey(pid, windowId);
    windows.add(key); unsuspend(conversationId, key);
    if (windows.size > MAX_VIEWABLE) {
      const oldest = windows.values().next().value;
      windows.delete(oldest); unsuspend(conversationId, oldest);
    }
  };
  // Automatic joins (a launcher's later window) never give a window another conversation already shows: each
  // conversation drives its own windows, so concurrent runs cannot click into one another's app.
  const ownedElsewhere = (conversationId, pid, windowId) => {
    const key = windowKey(pid, windowId);
    for (const [other, windows] of viewable) if (other !== conversationId && windows.has(key)) return true;
    return false;
  };

  const stopHelper = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    const current = helper; helper = undefined;
    if (current) { try { current.child.stdin.end(); } catch { /* already gone */ } }
    parked.clear();
    shieldSent = NO_SHIELD; shieldCount = 0;
    if (platform === 'darwin') mutedApps.clear();
  };
  const scheduleIdleStop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (!helper || activeInputs || parked.size || mutedApps.size || followedApps.size || shieldCount) return;
    idleTimer = setTimeout(() => { idleTimer = undefined; if (!activeInputs && !parked.size && !mutedApps.size && !followedApps.size && !shieldCount) stopHelper(); }, idleMs);
    idleTimer.unref?.();
  };

  const startHelper = () => {
    if (helper) return helper.ready;
    let child;
    try { child = spawn(helperFile, [], { stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { return Promise.reject(Object.assign(Error('display_helper_unavailable'), { code: 'display_helper_unavailable' })); }
    const state = { child, pending: new Map(), nextId: 1, buffer: '', ended: false };
    helper = state;
    state.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(Error('display_helper_timeout'), { code: 'display_helper_timeout' })), HELPER_READY_MS);
      timer.unref?.();
      state.settle = (error, value) => { clearTimeout(timer); if (error) reject(error); else resolve(value); };
    });
    state.ready.catch(() => { if (helper === state) stopHelper(); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      state.buffer += chunk;
      if (state.buffer.length > 1_000_000) state.buffer = '';
      let index;
      while ((index = state.buffer.indexOf('\n')) >= 0) {
        const line = state.buffer.slice(0, index); state.buffer = state.buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.type === 'ready') state.settle(undefined, message);
        else if (message?.type === 'window' || message?.type === 'window-closed') { try { followEvent(message); } catch { /* presentation only */ } }
        else if (message?.type === 'input-blocked') { try { inputBlocked(message); } catch { /* presentation only */ } }
        else if (message?.type === 'error') state.settle(Object.assign(Error(String(message.error || 'display_helper_failed')), { code: String(message.error || 'display_helper_failed') }));
        else if (message?.type === 'reply' && state.pending.has(message.id)) { state.pending.get(message.id)(message); state.pending.delete(message.id); }
      }
    });
    const ended = () => {
      state.ended = true;
      state.settle?.(Object.assign(Error('display_helper_exited'), { code: 'display_helper_exited' }));
      for (const resolve of state.pending.values()) resolve({ ok: false, error: 'display_helper_exited' });
      state.pending.clear();
      // macOS returns the windows of a removed display to a real screen by itself.
      // A tap's mute ends with the helper too.
      if (helper === state) {
        // Not stopped by NextMux: the helper crashed. Its mutes, parked windows and lock went with it; put them back.
        const lostParked = [...parked], lostMuted = platform === 'darwin' ? [...mutedApps] : [];
        helper = undefined; parked.clear(); if (platform === 'darwin') mutedApps.clear();
        shieldSent = NO_SHIELD;
        const now = Date.now();
        while (helperRestarts.length && now - helperRestarts[0] > 60_000) helperRestarts.shift();
        if (!disposed && helperRestarts.length < 3 && (lostParked.length || lostMuted.length || shieldCount)) {
          helperRestarts.push(now);
          setTimeout(() => { if (!disposed) void recoverHelper(lostParked, lostMuted); }, 500).unref?.();
        }
      }
    };
    child.on('exit', ended);
    child.on('error', ended);
    child.stdin.on('error', () => undefined);
    return state.ready;
  };

  const sendHelper = (state, id, op, fields = {}, signal) => {
    if (!state || state.ended || state.child.stdin.writableEnded) return Promise.resolve({ ok: false, error: 'display_helper_exited' });
    return new Promise(resolve => {
      const abort = () => settle({ ok: false, error: 'computer_input_cancelled' });
      const settle = reply => { clearTimeout(timer); signal?.removeEventListener('abort', abort); state.pending.delete(id); resolve(reply); };
      const timer = setTimeout(() => settle({ ok: false, error: 'display_helper_timeout' }), helperReplyMs);
      timer.unref?.();
      state.pending.set(id, settle);
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        state.child.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`, error => {
          if (error) settle({ ok: false, error: 'display_helper_write_failed' });
        });
      } catch { settle({ ok: false, error: 'display_helper_write_failed' }); }
    });
  };

  const helperCall = async (op, fields = {}) => {
    await startHelper();
    const state = helper;
    return sendHelper(state, state ? String(state.nextId++) : '', op, fields);
  };

  const inputCall = (conversationId, op, fields, signal) => {
    const dispatch = async () => {
      await startHelper();
      if (signal?.aborted) return { ok: false, error: 'computer_input_cancelled' };
      if (disposed || !owns(conversationId, fields.pid, fields.windowId)) return { ok: false, error: 'window_not_viewable' };
      const state = helper;
      if (!state) return { ok: false, error: 'display_helper_exited' };
      const id = String(state.nextId++);
      const reply = await sendHelper(state, id, op, { ...fields, scope: conversationId, deadlineMs: Date.now() + helperReplyMs }, signal);
      if (!reply.ok) {
        let cleanupState = state;
        let released = await sendHelper(state, String(state.nextId++), 'releaseInputs', { targetId: id });
        if (!released.ok && state.ended) {
          // A crashed process cannot retain its event stack. The replacement
          // sends only releases for this request, before accepting new input.
          try {
            await startHelper();
            const replacement = helper;
            cleanupState = replacement;
            released = await sendHelper(replacement, replacement ? String(replacement.nextId++) : '', 'releaseInputs',
              { targetId: id, recovery: true, input: { op, ...fields } });
          } catch { released = { ok: false }; }
        }
        if (!released.ok) {
          inputCleanupFailed = true;
          // EOF also cancels the native input loop and runs its release stack.
          try { cleanupState?.child.stdin.end(); } catch { /* already closed */ }
          return { ok: false, error: 'input_cleanup_failed' };
        }
      }
      return reply;
    };
    const queueKey = windowKey(fields.pid, fields.windowId);
    const run = (inputQueues.get(queueKey) || Promise.resolve()).then(async () => {
      if (signal?.aborted) return { ok: false, error: 'computer_input_cancelled' };
      if (inputCleanupFailed) return { ok: false, error: 'input_cleanup_failed' };
      if (disposed || !owns(conversationId, fields.pid, fields.windowId)) return { ok: false, error: 'window_not_viewable' };
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
      activeInputs += 1;
      try { return await dispatch(); }
      finally { activeInputs -= 1; }
    });
    const tail = run.catch(() => undefined).finally(() => { if (inputQueues.get(queueKey) === tail) inputQueues.delete(queueKey); });
    inputQueues.set(queueKey, tail);
    return run;
  };

  const park = async (conversationId, pid, windowId) => {
    const key = windowKey(pid, windowId);
    if (platform === 'win32' && canPark() && typeof windowsServices?.park === 'function') {
      const cap = windowCapabilities.get(key);
      if (cap && cap.canPark === false) return { ok: false, error: 'park_unsupported', placement: 'desktop', ...cap };
      const reply = await windowsServices.park(pid, windowId, desktopGroupKey(conversationId, pid, windowId)).catch(error => ({ ok: false, error: error?.code || 'park_failed' }));
      if (reply.ok) {
        parked.set(key, conversationId);
        return { ok: true, placement: 'tab' };
      }
      return { ok: false, error: String(reply.error || 'park_failed'), placement: 'desktop' };
    }
    if (!canPark()) return { ok: false, error: 'park_unsupported', ...(platform === 'win32' ? { placement: 'desktop', ...(windowCapabilities.get(key) || { canPark: false, parkReason: 'foreground_input_required' }) } : {}) };
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    const reply = await helperCall('park', { pid, windowId }).catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
    if (reply.ok) parked.set(key, conversationId);
    scheduleIdleStop();
    return reply.ok ? { ok: true, placement: 'tab' } : { ok: false, error: String(reply.error || 'park_failed') };
  };

  const activateWindows = windowId => new Promise(resolve => {
    // Fixed script; the only value is the validated window handle number.
    const script = `$ErrorActionPreference='Stop'; Add-Type -Namespace NextMux -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h); [DllImport("user32.dll")] public static extern void SwitchToThisWindow(System.IntPtr h, bool fAltTab); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);'; $h=[System.IntPtr]::new([long]${Number(windowId)}); if (-not [NextMux.Win]::IsWindow($h)) { exit 3 }; if ([NextMux.Win]::IsIconic($h)) { [void][NextMux.Win]::ShowWindowAsync($h, 9) }; [NextMux.Win]::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero); [void][NextMux.Win]::BringWindowToTop($h); if (-not [NextMux.Win]::SetForegroundWindow($h)) { [NextMux.Win]::SwitchToThisWindow($h, $true) }`;
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 8192 },
      error => resolve(error ? { ok: false, error: 'activate_failed' } : { ok: true, placement: 'desktop' }));
  });

  /** A tab window's switches as they are now (the one source of truth for every page showing it). */
  const stateOf = (pid, windowId) => {
    const key = windowKey(pid, windowId);
    const defaultWinCap = canPark() ? { canPark: true } : { canPark: false, parkReason: 'foreground_input_required' };
    return { ok: true, alive: processAlive(pid) && (platform !== 'win32' || !closedWindows.has(key) && (!audioPids.has(key) || processAlive(audioPids.get(key)))), placement: parked.has(key) ? 'tab' : 'desktop',
      sound: platform === 'win32' ? !mutedApps.has(audioPids.get(key) || pid) : !canMute() || soundOn.has(key) || !mutedApps.get(pid)?.has(key),
      keyboardMouse: userInputOn.has(key), ...(platform === 'win32' ? { ...(windowCapabilities.get(key) || defaultWinCap),
        lock: nativeCapabilities().lock === true, soundScope: 'process' } : {}) };
  };
  /** Tell every conversation showing the window that a switch changed, whoever changed it (the user, the AI, a plugin). */
  const emitState = (pid, windowId) => {
    const key = windowKey(pid, windowId);
    const state = stateOf(pid, windowId);
    for (const [conversationId, windows] of viewable) if (windows.has(key)) onWindowEvent?.({ type: 'state', conversationId, pid, windowId,
      placement: state.placement, sound: state.sound, keyboardMouse: state.keyboardMouse });
  };
  const mutePending = new Set();
  let workbenchHidden = false;
  const workbenchParked = new Map();
  const trackMute = promise => {
    const pending = Promise.resolve(promise).finally(() => mutePending.delete(pending));
    mutePending.add(pending);
    return pending;
  };
  const muteQueues = new Map();
  const applyMute = (pid, mute) => {
    const run = (muteQueues.get(pid) || Promise.resolve()).then(async () => {
      if (!canMute()) return { ok: false, error: 'sound_unsupported' };
      if (platform === 'win32') return windowsServices.mute(pid, mute);
      const reply = await helperCall('mute', { pid, muted: mute }).catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
      scheduleIdleStop();
      return reply.ok ? { ok: true } : { ok: false, error: String(reply.error || 'sound_failed') };
    });
    const tail = run.catch(() => undefined).finally(() => { if (muteQueues.get(pid) === tail) muteQueues.delete(pid); });
    muteQueues.set(pid, tail);
    return run;
  };
  /** Mute the window's app unless the user turned its sound on; an app stays muted while any such window is shown. */
  const muteForWindow = async (pid, windowId) => {
    const key = windowKey(pid, windowId);
    if (platform === 'win32') {
      if (!tabWindows.has(key)) return;
      await windowsServices.ready();
      if (!tabWindows.has(key) || disposed) return;
      pid = audioPids.get(key) || pid;
    }
    if (!canMute() || soundOn.has(key) || disposed) return;
    let holders = mutedApps.get(pid);
    const fresh = !holders || !holders.size;
    if (!holders) { holders = new Set(); mutedApps.set(pid, holders); }
    holders.add(key);
    if (workbenchHidden) return;
    const stale = platform === 'win32' && Date.now() - (windowsMutedAt.get(pid) || 0) > WINDOWS_MUTE_REFRESH_MS;
    if (!fresh && !stale) return;
    if (platform === 'win32') windowsMutedAt.set(pid, Date.now());
    const result = await trackMute(applyMute(pid, true));
    if (!result.ok && fresh) { mutedApps.delete(pid); windowsMutedAt.delete(pid); }
  };
  const releaseMute = async (pid, windowId) => {
    const key = windowKey(pid, windowId);
    if (platform === 'win32') pid = audioPids.get(key) || pid;
    const holders = mutedApps.get(pid);
    if (!holders?.delete(key) || holders.size) return;
    windowsMutedAt.delete(pid);
    if (platform === 'darwin' && (!helper || helper.ended || inputCleanupFailed)) { mutedApps.delete(pid); return; }
    const restore = async (attempt = 0) => {
      if (holders.size || mutedApps.get(pid) !== holders) return;
      const result = await trackMute(applyMute(pid, false)).catch(() => ({ ok: false }));
      if (result.ok && !holders.size && mutedApps.get(pid) === holders) mutedApps.delete(pid);
      else if (!result.ok && !disposed && attempt < 3) {
        const timer = setTimeout(() => { void restore(attempt + 1); }, 1000); timer.unref?.();
      }
    };
    await restore();
  };

  const processAlive = pid => {
    try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
  };
  /** A tab window whose app is gone: every conversation showing it hears so, and its state is dropped. */
  const windowGone = (pid, windowId) => {
    const key = windowKey(pid, windowId);
    revokeCaptures(undefined, new Set([key]));
    if (platform === 'win32') {
      closedWindows.add(key);
      for (const chains of windowsFollows.values()) for (const chain of chains.values()) {
        const member = chain.members.get(key); if (member) member.alive = false;
      }
    }
    for (const [conversationId, windows] of viewable) if (windows.has(key)) onWindowEvent?.({ type: 'window-closed', conversationId, pid, windowId, ...(platform === 'win32' ? chainContract(chainFor(conversationId, pid, windowId)) : {}) });
    tabWindows.delete(key); userInputOn.delete(key); parked.delete(key); workbenchParked.delete(key); soundOn.delete(key); onDesktop.delete(key); windowFamilies.delete(key);
    if (platform === 'win32') {
      void releaseMute(pid, windowId).finally(() => { audioPids.delete(key); windowCapabilities.delete(key); launchedWindows.delete(key); });
    } else {
      void releaseMute(pid, windowId).catch(() => undefined).finally(scheduleIdleStop);
    }
    syncShield();
  };
  const scheduleLiveness = () => {
    if (livenessTimer || disposed || !tabWindows.size) return;
    livenessTimer = setInterval(() => {
      if (disposed || !tabWindows.size) { clearInterval(livenessTimer); livenessTimer = undefined; return; }
      for (const key of [...tabWindows]) {
        const [pid, windowId] = key.split(':').map(Number);
        if (!processAlive(pid) || platform === 'win32' && audioPids.has(key) && !processAlive(audioPids.get(key))) windowGone(pid, windowId);
        else if (platform === 'win32') void windowsServices.windowCapability(pid, windowId).then(reply => {
          if (!disposed && tabWindows.has(key) && reply.parkReason === 'window_not_found') windowGone(pid, windowId);
        }).catch(() => undefined);
      }
    }, LIVENESS_MS);
    livenessTimer.unref?.();
  };

  /**
   * The 键鼠 switch only decides whether the user may drive the window through the tab. A window that is on the
   * desktop always takes the user's own mouse and keyboard there, so no desktop shield is installed; this only
   * releases a shield an earlier version may have left.
   */
  const syncShield = () => {
    if (platform === 'win32') {
      if (disposed) return shieldQueue;
      const windows = [];
      const signature = JSON.stringify(windows);
      if (signature === shieldSent) return shieldQueue;
      shieldSent = signature;
      shieldQueue = shieldQueue.then(() => disposed ? { ok: false, error: 'view_disposed' } : windowsServices.shield({ windows }))
        .catch(() => ({ ok: false, error: 'lock_unavailable' })).then(reply => { if (!reply.ok && shieldSent === signature) shieldSent = ''; return reply; });
      return shieldQueue;
    }
    if (platform !== 'darwin' || !canPark() || disposed) return;
    const targets = { windows: [], pids: [] };
    const signature = JSON.stringify(targets);
    if (signature === shieldSent) return;
    shieldSent = signature;
    shieldCount = 0;
    if (!helper) return;
    void helperCall('shield', targets).then(reply => { if (!reply?.ok) shieldSent = ''; }, () => { shieldSent = ''; })
      .finally(scheduleIdleStop);
  };
  const inputBlocked = message => {
    const windowId = Number(message.windowId), pid = Number(message.pid);
    const key = [...tabWindows].find(item => windowId > 0 ? item.endsWith(`:${windowId}`) : item.startsWith(`${pid}:`));
    if (!key) return;
    const [p, w] = key.split(':').map(Number);
    for (const [conversationId, windows] of viewable) if (windows.has(key)) onWindowEvent?.({ type: 'input-blocked', conversationId, pid: p, windowId: w });
  };
  const recoverHelper = async (lostParked, lostMuted) => {
    for (const [pid, holders] of lostMuted) {
      mutedApps.set(pid, holders);
      const result = await applyMute(pid, true).catch(() => ({ ok: false }));
      if (!result.ok) mutedApps.delete(pid);
    }
    for (const [key, conversationId] of lostParked) {
      const [pid, windowId] = key.split(':').map(Number);
      if (!onDesktop.has(key) && owns(conversationId, pid, windowId)) await park(conversationId, pid, windowId).catch(() => undefined);
    }
    syncFollowed();
    syncShield();
  };

  const syncFollowed = () => {
    if (platform !== 'darwin' || !existsSync(helperFile) || (!followedApps.size && !helper)) return;
    void helperCall('watch', { roots: [...followedApps.keys()] }).catch(() => undefined).finally(scheduleIdleStop);
  };
  const follow = (conversationId, pid) => {
    let conversations = followedApps.get(pid);
    if (!conversations) { conversations = new Set(); followedApps.set(pid, conversations); }
    const fresh = !conversations.has(conversationId);
    conversations.add(conversationId);
    if (fresh) syncFollowed();
  };
  const unfollow = (conversationId, pid) => {
    const conversations = followedApps.get(pid);
    if (!conversations?.delete(conversationId)) return;
    if (!conversations.size) followedApps.delete(pid);
    syncFollowed();
  };
  // Windows: many apps start through a launcher (WeGame → League of Legends) or open their real window from another
  // process. A new top-level window whose program lives in the same install folder as a conversation's tab app (or
  // the executable that was launched for it) gets a tab of its own in that conversation.
  const windowsFollows = new Map(); // conversationId -> independent launcher chains
  let windowsFollowTimer, windowsFollowBusy = false;
  const topWindows = async () => {
    const reply = await windowsServices.topWindows().catch(() => undefined);
    return reply?.ok && Array.isArray(reply.windows) ? reply.windows : undefined;
  };
  const chainFor = (conversationId, pid, windowId) => [...(windowsFollows.get(conversationId)?.values() || [])]
    .find(chain => chain.members.has(windowKey(pid, windowId)));
  const chainContract = chain => chain ? { familyId: chain.id, root: chain.root,
    windows: [...chain.members.values()].sort((a, b) => ({ launcher: 1, client: 2, app: 2, game: 3 }[a.role] - { launcher: 1, client: 2, app: 2, game: 3 }[b.role]))
      .map(({ pid, windowId, app, title, role, alive }) => ({ pid, windowId, app, title, role, alive })) } : {};
  const addChainMember = (chain, row) => {
    const key = windowKey(Number(row.pid), Number(row.windowId));
    const prior = chain.members.get(key);
    chain.members.set(key, { ...row, pid: Number(row.pid), windowId: Number(row.windowId), app: windowsProgram(row.executable),
      title: String(row.title || '').slice(0, 200), role: windowsWindowRole(row), alive: true, ...(prior ? { role: prior.role } : {}) });
    windowFamilies.set(key, chain.id);
  };
  const pollWindowsFollows = async () => {
    if (windowsFollowBusy || disposed || !windowsServices || !windowsFollows.size) return;
    windowsFollowBusy = true;
    try {
      const rows = await topWindows();
      if (!rows || disposed) return;
      const visible = new Set(rows.map(row => windowKey(Number(row.pid), Number(row.windowId))));
      for (const [conversationId, chains] of windowsFollows) {
        for (const row of rows) {
          const pid = Number(row.pid), windowId = Number(row.windowId), key = windowKey(pid, windowId);
          if (!validWindow(pid, windowId) || WINDOW_HELPERS.has(windowsProgram(row.executable))) continue;
          const existing = chainFor(conversationId, pid, windowId);
          if (existing) { addChainMember(existing, row); continue; }
          if (ownedElsewhere(conversationId, pid, windowId)) continue;
          const matches = [...chains.values()].filter(chain => [...chain.members.values()].some(member => windowsRelatedWindow(member, row)));
          if (matches.length !== 1) continue; // Ambiguous ancestry must not steal another app's tab.
          const chain = matches[0];
          if (chain.baseline.has(key)) continue;
          addChainMember(chain, row);
          allow(conversationId, pid, windowId); tabWindows.add(key); closedWindows.delete(key);
          if (chain.launched) launchedWindows.set(key, conversationId);
          const familyParked = [...chain.members.keys()].some(member => parked.has(member));
          const familyOnDesktop = [...chain.members.keys()].some(member => onDesktop.has(member));
          await probeWindow(pid, windowId).catch(() => undefined);
          if (disposed || !owns(conversationId, pid, windowId)) continue;
          scheduleLiveness();
          if ((familyParked || (canPark() && preference === 'tab' && !familyOnDesktop)) && !onDesktop.has(key)) await park(conversationId, pid, windowId).catch(() => undefined);
          await muteForWindow(pid, windowId).catch(() => undefined);
          onWindowEvent?.({ type: 'window-added', conversationId, pid, windowId, app: windowsProgram(row.executable), title: String(row.title || '').slice(0, 200),
            ...chainContract(chain), placement: parked.has(key) ? 'tab' : 'desktop' });
        }
        // Do not infer closure from enumeration alone: minimized/cloaked windows may be omitted.
        for (const chain of chains.values()) for (const member of chain.members.values()) {
          if (member.alive && !visible.has(windowKey(member.pid, member.windowId))) {
            const cap = await windowsServices.windowCapability(member.pid, member.windowId).catch(() => undefined);
            if (cap?.parkReason === 'window_not_found') windowGone(member.pid, member.windowId);
          }
        }
      }
    } finally { windowsFollowBusy = false; }
  };
  const followWindows = async (conversationId, pid, windowId, executables, launched = false) => {
    if (platform !== 'win32' || !windowsServices || disposed) return;
    const rows = await topWindows() || [];
    if (disposed || !owns(conversationId, pid, windowId)) return;
    const row = rows.find(row => Number(row.windowId) === windowId && Number(row.pid) === pid)
      || { pid, windowId, executable: executables[0] || '', title: '' };
    let chains = windowsFollows.get(conversationId);
    if (!chains) { chains = new Map(); windowsFollows.set(conversationId, chains); }
    let chain = chainFor(conversationId, pid, windowId);
    if (!chain) {
      const matches = [...chains.values()].filter(item => [...item.members.values()].some(member => windowsRelatedWindow(member, row)));
      chain = matches.length === 1 ? matches[0] : undefined;
    }
    if (!chain) {
      const id = `${conversationId}:${pid}:${windowId}`;
      chain = { id, root: pid, launched, members: new Map(), baseline: new Set(rows.filter(item => !windowsRelatedWindow(row, item))
        .map(item => windowKey(Number(item.pid), Number(item.windowId)))) };
      chains.set(id, chain);
    }
    addChainMember(chain, row);
    if (!windowsFollowTimer) { windowsFollowTimer = setInterval(() => { void pollWindowsFollows().catch(() => undefined); }, 1000); windowsFollowTimer.unref?.(); }
    return chainContract(chain);
  };
  const unfollowWindows = conversationId => {
    windowsFollows.delete(conversationId);
    if (!windowsFollows.size && windowsFollowTimer) { clearInterval(windowsFollowTimer); windowsFollowTimer = undefined; }
  };
  // A new window of an app shown in tabs: it goes where its app's tab is (off the screens with "tab only") and stays
  // quiet like it, and each conversation that shows the app gets a tab for it.
  const followEvent = message => {
    const pid = Number(message.pid), windowId = Number(message.windowId), root = Number(message.root);
    if (!validWindow(pid, windowId)) return;
    if (message.type === 'window-closed') {
      windowGone(pid, windowId);
      return;
    }
    for (const conversationId of followedApps.get(root) || []) {
      if (ownedElsewhere(conversationId, pid, windowId)) continue;
      allow(conversationId, pid, windowId);
      tabWindows.add(windowKey(pid, windowId));
      scheduleLiveness();
      if (pid !== root && launchedApps.get(root)?.has(conversationId)) markLaunched(pid, conversationId);
      const rootParked = [...parked.keys()].some(key => key.startsWith(`${root}:`) && parked.get(key) === conversationId);
      void (async () => {
        if (rootParked && !onDesktop.has(windowKey(pid, windowId))) await park(conversationId, pid, windowId).catch(() => undefined);
        await muteForWindow(pid, windowId).catch(() => undefined);
        syncShield();
        onWindowEvent?.({ type: 'window-added', conversationId, root, pid, windowId, title: String(message.title || '').slice(0, 200), app: String(message.app || '').slice(0, 120),
          placement: parked.has(windowKey(pid, windowId)) ? 'tab' : 'desktop' });
      })();
    }
  };

  const markLaunched = (pid, conversationId) => {
    let conversations = launchedApps.get(pid);
    if (!conversations) { conversations = new Set(); launchedApps.set(pid, conversations); }
    conversations.add(conversationId);
    if (launchedApps.size > 256) launchedApps.delete(launchedApps.keys().next().value);
  };
  const shownAnywhere = pid => [...viewable.values()].some(windows => [...windows].some(key => key.startsWith(`${pid}:`)));
  // As ⌘Q or closing its main window does: the app may still ask to save, and stays open if the user cancels.
  const quitApp = async pid => {
    if (platform === 'darwin') {
      if (!existsSync(helperFile)) return { ok: false, error: 'display_helper_unavailable' };
      return helperCall('quit', { pid }).catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
    }
    if (platform !== 'win32') return { ok: false, error: 'quit_unsupported' };
    return new Promise(resolve => {
      // Fixed script; the only value is the validated process number.
      const script = `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }`;
      const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 8192 },
        error => resolve(error ? { ok: false, error: 'quit_failed' } : { ok: true }));
    });
  };

  const toDesktop = async (pid, windowId, activate, hostWindow = 0) => {
    const key = windowKey(pid, windowId);
    if (platform === 'darwin') {
      if (!parked.has(key) && !activate) return { ok: true, placement: 'desktop' };
      if (!existsSync(helperFile)) return { ok: false, error: 'display_helper_unavailable' };
      const reply = await helperCall('unpark', { pid, windowId, activate: Boolean(activate) }).catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
      if (reply.ok) parked.delete(key);
      scheduleIdleStop();
      return reply.ok ? { ok: true, placement: 'desktop' } : { ok: false, error: String(reply.error || 'unpark_failed') };
    }
    if (platform === 'win32') {
      if ((parked.has(key) || canPark()) && typeof windowsServices?.unpark === 'function') {
        const reply = await windowsServices.unpark(pid, windowId, hostWindow, Boolean(activate)).catch(error => ({ ok: false, error: error?.code || 'unpark_failed' }));
        if (reply.ok) {
          parked.delete(key);
          return { ok: true, placement: 'desktop' };
        }
        if (parked.has(key)) return { ok: false, error: String(reply.error || 'unpark_failed') };
      }
      if (activate) return activateWindows(windowId);
    }
    return { ok: true, placement: 'desktop' };
  };

  return {
    capability,
    async ready() {
      if (windowsServices) {
        await windowsServices.ready();
        if (nativeCapabilities().canPark === true && !explicitPreference) preference = 'tab';
      }
      return capability();
    },
    /** "tab" (only in the conversation's tab; macOS/Windows) or "desktop" (the window stays on the user's screen). */
    setPreference(value) {
      if (value === 'tab' || value === 'desktop') {
        explicitPreference = value;
        preference = value;
      }
      return capability();
    },
    /**
     * The tab's 键鼠 switch: on, the user may click and type in the window through the tab; off (the default), only
     * the AI and plugins drive it through the tab. A window on the desktop always takes the user's own input there.
     */
    setUserInput(conversationId, pid, windowId, on) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      const key = windowKey(pid, windowId);
      tabWindows.add(key);
      if (on) userInputOn.add(key); else userInputOn.delete(key);
      void syncShield();
      emitState(pid, windowId);
      return { ok: true, on: userInputOn.has(key), locks: false };
    },
    userInput: (pid, windowId) => userInputOn.has(windowKey(pid, windowId)),
    /** What a tab window's switches are now: where it shows, whether its sound and the user's keyboard & mouse are on, and whether its app still runs. */
    windowState(conversationId, pid, windowId) {
      if (platform === 'win32' && windowsFollows.has(conversationId)) void pollWindowsFollows().catch(() => undefined);
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      return stateOf(pid, windowId);
    },
    /** "desktop" (default) returns tab apps to the desktop; "quit" exits apps NextMux opened after their last tab closes or NextMux quits. */
    setCloseBehavior(value) {
      if (value === 'quit' || value === 'desktop') closeBehavior = value;
      return closeBehavior;
    },
    /** The conversation observed this window: it may now view and move it, and its app goes quiet (sound off). */
    grant(conversationId, pid, windowId) {
      if (!validWindow(pid, windowId)) return;
      allow(conversationId, pid, windowId);
      if (platform !== 'win32' || tabWindows.has(windowKey(pid, windowId))) void muteForWindow(pid, windowId).catch(() => undefined);
    },
    canView: (conversationId, pid, windowId) => validWindow(pid, windowId) && owns(conversationId, pid, windowId),
    hasWindows: conversationId => Boolean(viewable.get(conversationId)?.size),
    windowsForProcess: pid => [...viewable].flatMap(([conversationId, windows]) => [...windows]
      .filter(key => Number(key.split(':')[0]) === pid || audioPids.get(key) === pid)
      .map(key => { const [windowPid, windowId] = key.split(':').map(Number); return { conversationId, pid: windowPid, windowId }; })),
    revokeCapture,
    /** The tab's sound switch. */
    async setSound(conversationId, pid, windowId, on) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      if (!canMute()) return { ok: false, error: 'sound_unsupported' };
      const key = windowKey(pid, windowId);
      if (on) {
        soundOn.add(key);
        if (soundOn.size > 256) soundOn.delete(soundOn.values().next().value);
        await releaseMute(pid, windowId);
        emitState(pid, windowId);
        return { ok: true, sound: platform === 'win32' ? !mutedApps.has(audioPids.get(key) || pid) : true,
          ...(platform === 'win32' ? { soundScope: 'process' } : {}) };
      }
      soundOn.delete(key);
      await muteForWindow(pid, windowId);
      emitState(pid, windowId);
      return mutedApps.get(platform === 'win32' ? audioPids.get(key) || pid : pid)?.has(key) ? { ok: true, sound: false } : { ok: false, error: 'sound_permission_required' };
    },
    /**
     * tabs.screenshot: the tab window's own picture from the system's window capture, so it works for any app, games
     * and canvas apps included (no accessibility tree needed).
     */
    async snapshot(conversationId, pid, windowId, maxSize = 1280) {
      if (platform === 'win32' && windowsFollows.has(conversationId)) await pollWindowsFollows().catch(() => undefined);
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      const size = Math.max(256, Math.min(2048, Math.round(Number(maxSize) || 1280)));
      if (platform === 'win32' && typeof windowsServices?.captureWindow === 'function') {
        const captured = await windowsServices.captureWindow(pid, windowId, size);
        if (!owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
        if (captured.ok) return captured;
        if (!captured.fallback) return { ok: false, error: String(captured.error || 'window_not_capturable') };
      }
      if (!desktopCapturer) return { ok: false, error: 'live_view_unsupported' };
      let sources;
      try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: size, height: size }, fetchWindowIcons: false }); }
      catch { return { ok: false, error: 'capture_permission_required' }; }
      if (!owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      const image = sources.find(item => typeof item?.id === 'string' && item.id.startsWith(`window:${windowId}:`))?.thumbnail;
      if (!image || image.isEmpty?.()) return { ok: false, error: 'window_not_capturable' };
      const { width, height } = image.getSize();
      return { ok: true, mimeType: 'image/jpeg', data: image.toJPEG(82).toString('base64'), width, height };
    },
    /**
     * A skill plugin's picture of the tab window: raw 32-bit BGRA pixels (with the row stride). macOS 14+ takes it
     * with ScreenCaptureKit in the display helper (tens of milliseconds, only this window); elsewhere the system
     * window capture's thumbnail is used.
     */
    async frame(conversationId, pid, windowId, maxWidth = 1024) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      let privateLease;
      try { privateLease = incognito?.acquire(conversationId); } catch { return { ok: false, error: 'incognito_session_closed' }; }
      try {
      const width = Math.max(160, Math.min(2048, Math.round(Number(maxWidth) || 1024)));
      if (canPark() && darwinVersion()[0] >= 23) {
        if (!privateLease) frameDirectory ??= mkdtempSync(join(tmpdir(), 'nextmux-frames-'));
        const path = join(privateLease ? privateLease.directory() : frameDirectory, `${windowId}.bgra`);
        const reply = await helperCall('frame', { windowId, maxWidth: width, path }).catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
        scheduleIdleStop();
        if (reply.ok) {
          try {
            const data = await readFile(path);
            if (!owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
            if (data.length >= reply.stride * reply.height) return { ok: true, width: reply.width, height: reply.height, stride: reply.stride, data, path, ...(privateLease ? { incognitoConversationId: conversationId } : {}) };
          } catch { /* fall back to the system capture */ }
        } else if (reply.error === 'capture_permission_required') return { ok: false, error: reply.error };
      }
      if (platform === 'win32' && typeof windowsServices?.captureFrame === 'function') {
        const captured = await windowsServices.captureFrame(pid, windowId, width);
        if (!owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
        if (captured.ok) return { ...captured, ...(privateLease ? { incognitoConversationId: conversationId } : {}) };
        if (!captured.fallback) return { ok: false, error: String(captured.error || 'window_not_capturable') };
      }
      if (!desktopCapturer) return { ok: false, error: 'live_view_unsupported' };
      let sources;
      try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width, height: width }, fetchWindowIcons: false }); }
      catch { return { ok: false, error: 'capture_permission_required' }; }
      if (!owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      const image = sources.find(item => typeof item?.id === 'string' && item.id.startsWith(`window:${windowId}:`))?.thumbnail;
      if (!image || image.isEmpty?.()) return { ok: false, error: 'window_not_capturable' };
      const size = image.getSize();
      return { ok: true, width: size.width, height: size.height, stride: size.width * 4, data: image.toBitmap() };
      } finally { privateLease?.release(); }
    },
    /** Text in parts of the last helper frame (fractions of the window), for plugins' "text" signals (macOS). */
    async recognizeText(frame, rects, languages) {
      let privateLease;
      try { if (frame?.incognitoConversationId) privateLease = incognito?.acquire(frame.incognitoConversationId); } catch { return { ok: false, error: 'incognito_session_closed' }; }
      try {
      if (windowsServices) return windowsServices.recognizeText(frame, rects, languages);
      if (!frame?.path || !Array.isArray(rects) || !rects.length) return { ok: false, error: 'ocr_unsupported' };
      const reply = await helperCall('ocr', { path: frame.path, width: frame.width, height: frame.height, rects: rects.slice(0, 16),
        ...(Array.isArray(languages) && languages.length ? { languages: languages.slice(0, 4) } : {}) })
        .catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
      scheduleIdleStop();
      return reply.ok && Array.isArray(reply.texts) ? {
        ok: true,
        texts: reply.texts.map(text => String(text || '').slice(0, 500)),
        ...(Array.isArray(reply.boxes) ? { boxes: reply.boxes.slice(0, rects.length) } : {})
      } : { ok: false, error: String(reply.error || 'ocr_failed') };
      } finally { privateLease?.release(); }
    },
    /** tabs.key / tabs.type (macOS): real key events for the tab's app. Windows goes through the driver. */
    async keys(conversationId, pid, windowId, input) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      if (!canPark()) return { ok: false, error: 'keys_unsupported' };
      const text = typeof input?.text === 'string' ? input.text.slice(0, 2000) : '';
      const key = typeof input?.key === 'string' ? input.key.slice(0, 24) : '';
      const keys = input?.keys;
      if ([Boolean(text), Boolean(key), keys !== undefined].filter(Boolean).length !== 1
        || keys !== undefined && (!Array.isArray(keys) || keys.length < 1 || keys.length > 4
          || keys.some(value => typeof value !== 'string' || !value.length || value.length > 24))
        || input?.holdMs !== undefined && (!Number.isFinite(input.holdMs) || !Number.isInteger(input.holdMs))) return { ok: false, error: 'computer_input_invalid' };
      const modifiers = Array.isArray(input?.modifiers) ? input.modifiers.filter(item => typeof item === 'string').slice(0, 4) : [];
      const keepFront = { delivery: 'semantic' };
      const reply = await inputCall(conversationId, 'keys', text ? { pid, windowId, text, ...keepFront } : { pid, windowId,
        ...(keys ? { keys: [...keys] } : { key }), modifiers, holdMs: Math.max(0, Math.min(3000, input?.holdMs ?? 0)), ...keepFront }, input?.signal)
        .catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
      scheduleIdleStop();
      return reply.ok ? { ok: true, ...(reply.delivery ? { delivery: reply.delivery } : {}), ...(reply.effect ? { effect: reply.effect } : {}) } : { ok: false, error: String(reply.error || 'keys_failed') };
    },
    /** The tab's mouse (macOS): click, scroll or drag at fractions of its window. */
    async pointer(conversationId, pid, windowId, input) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      if (!canPark()) return { ok: false, error: 'pointer_unsupported' };
      const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
      const drag = input?.kind === 'drag';
      if (!['click', 'doubleClick', 'scroll', 'drag', 'move'].includes(input?.kind)
        || (drag ? !fraction(input.from?.x) || !fraction(input.from?.y) || !fraction(input.to?.x) || !fraction(input.to?.y)
          || input.durationMs !== undefined && (!Number.isInteger(input.durationMs) || input.durationMs < 50 || input.durationMs > 2000)
          : !fraction(input.x) || !fraction(input.y))
        || input?.button !== undefined && !['left', 'right'].includes(input.button)
        || drag && input.button === 'right'
        || input.kind === 'scroll' && !['up', 'down', 'left', 'right'].includes(input.direction)) return { ok: false, error: 'computer_input_invalid' };
      const reply = await inputCall(conversationId, 'pointer', { pid, windowId, kind: input.kind, delivery: 'semantic',
        ...(drag ? { from: { x: input.from.x, y: input.from.y }, to: { x: input.to.x, y: input.to.y }, durationMs: input.durationMs ?? 300 }
          : { x: input.x, y: input.y, ...(input.button !== undefined ? { button: input.button } : {}) }),
        ...(input.kind === 'scroll' ? { direction: input.direction, amount: Math.max(1, Math.min(10, Math.round(Number(input.amount) || 3))) } : {}) }, input?.signal)
        .catch(error => ({ ok: false, error: error?.code || 'display_helper_failed' }));
      scheduleIdleStop();
      return reply.ok ? { ok: true, ...(reply.delivery ? { delivery: reply.delivery } : {}), ...(reply.effect ? { effect: reply.effect } : {}) } : { ok: false, error: String(reply.error || 'pointer_failed') };
    },
    /**
     * An app window the AI opened in a tab: the conversation may view it, it goes off the user's screens when their
     * last choice was "tab only" (macOS/Windows), and its app is muted until the tab's sound switch is on.
     */
    async openInTab(conversationId, pid, windowId, { launched = false, appPid, sharedHost = false, executables = [] } = {}) {
      if (!validWindow(pid, windowId)) return { placement: 'desktop' };
      const key = windowKey(pid, windowId);
      if (ownedElsewhere(conversationId, pid, windowId)) return { ok: false, error: 'computer_window_owned' };
      const freshTabWindow = !tabWindows.has(key);
      allow(conversationId, pid, windowId);
      tabWindows.add(key);
      if (tabWindows.size > 512) tabWindows.delete(tabWindows.values().next().value);
      if (freshTabWindow) soundOn.delete(key);
      if (platform === 'win32') {
        windowFamilies.set(key, familyKeyFromExecutables(executables, pid));
        await followWindows(conversationId, pid, windowId, (Array.isArray(executables) ? executables : []).filter(item => typeof item === 'string'), Boolean(launched)).catch(() => undefined);
      }
      if (launched) {
        // A newly visible HWND can belong to an existing tray app or shared
        // host. Launch discovery cannot prove ownership of that whole process.
        if (platform === 'win32') launchedWindows.set(key, conversationId);
        else markLaunched(pid, conversationId);
      }
      if (platform === 'win32') {
        closedWindows.delete(key);
        if (Number.isSafeInteger(appPid) && appPid > 0) audioPids.set(key, appPid);
        await probeWindow(pid, windowId);
      }
      await muteForWindow(pid, windowId).catch(() => undefined);
      follow(conversationId, pid);
      if (canPark() && preference === 'tab' && !onDesktop.has(key) && !parked.has(key)) await park(conversationId, pid, windowId).catch(() => undefined);
      syncShield();
      scheduleLiveness();
      if (platform === 'win32') await shieldQueue;
      return { placement: parked.has(key) ? 'tab' : 'desktop', ...(platform === 'win32' ? { ...windowCapabilities.get(key), ...chainContract(chainFor(conversationId, pid, windowId)) } : {}) };
    },
    isParked: (pid, windowId) => parked.has(windowKey(pid, windowId)),
    /** The AI acted on a tab's window: an app it launches in the next minute (a game from a launcher) joins the tabs. */
    touch(pid) {
      if (platform === 'darwin' && followedApps.has(pid) && helper) void helperCall('touch', { pid }).catch(() => undefined);
    },
    /** Let this renderer's next getDisplayMedia call capture the window (for ten seconds). */
    async arm(senderId, conversationId, pid, windowId) {
      // Starting another request always replaces the previous grant, including
      // failures. Mark it before enumeration so a slower old request cannot win.
      armed.delete(senderId);
      if (disposed || !validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      if (!desktopCapturer || !['darwin', 'win32'].includes(platform)) return { ok: false, error: 'live_view_unsupported' };
      if (platform === 'win32' && parked.has(windowKey(pid, windowId)) && typeof windowsServices?.captureWindow === 'function') {
        const state = stateOf(pid, windowId);
        return { ok: true, placement: state.placement, sound: state.sound };
      }
      const pending = { conversationId, pid, windowId, expiresAt: Date.now() + ARM_MS };
      armed.set(senderId, pending);
      let sources;
      try { sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }); }
      catch {
        if (armed.get(senderId) === pending) armed.delete(senderId);
        return { ok: false, error: 'capture_permission_required' };
      }
      if (disposed || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      if (armed.get(senderId) !== pending) return { ok: false, error: 'capture_superseded' };
      const source = sources.find(item => typeof item?.id === 'string' && item.id.startsWith(`window:${windowId}:`));
      if (!source) {
        armed.delete(senderId);
        if (platform === 'win32' && typeof windowsServices?.captureWindow === 'function') {
          const cap = await windowsServices.windowCapability?.(pid, windowId).catch(() => undefined);
          if (cap && cap.parkReason !== 'window_not_found' && owns(conversationId, pid, windowId)) {
            const state = stateOf(pid, windowId);
            return { ok: true, placement: state.placement, sound: state.sound };
          }
        }
        return { ok: false, error: 'window_not_capturable' };
      }
      pending.source = source;
      pending.expiresAt = Date.now() + ARM_MS;
      // One rule for the sound switch: on Windows the muted process is the content process, not the window host (audit A20-07).
      const state = stateOf(pid, windowId);
      return { ok: true, placement: state.placement, sound: state.sound };
    },
    /** session.setDisplayMediaRequestHandler: only an armed request gets a window, and only that one. */
    handleDisplayMediaRequest(request, callback) {
      let contents;
      try { contents = webContentsFromFrame?.(request?.frame); } catch { contents = undefined; }
      // An embedded frame shares webContents with the workbench, but does not
      // inherit the main frame's one-use grant (or consume it on rejection).
      if (!request?.frame || !contents || contents.isDestroyed?.() || request.frame.parent
        || contents.mainFrame && contents.mainFrame !== request.frame) { callback({}); return; }
      const pending = contents ? armed.get(contents.id) : undefined;
      if (contents) armed.delete(contents.id);
      if (disposed || !pending?.source || pending.expiresAt < Date.now() || request?.videoRequested !== true
        || !owns(pending.conversationId, pending.pid, pending.windowId)) { callback({}); return; }
      callback({ video: pending.source });
    },
    /** The user's choice in the tab: show the window on the desktop (optionally in front) or back in the tab only. */
    async place(conversationId, pid, windowId, placement, { activate = false, hostWindow = 0 } = {}) {
      if (!validWindow(pid, windowId) || !owns(conversationId, pid, windowId)) return { ok: false, error: 'window_not_viewable' };
      const key = windowKey(pid, windowId);
      if (placement === 'tab') {
        onDesktop.delete(key);
        workbenchParked.delete(key);
        const parkedResult = await park(conversationId, pid, windowId);
        syncShield();
        emitState(pid, windowId);
        return parkedResult;
      }
      if (placement !== 'desktop') return { ok: false, error: 'placement_invalid' };
      onDesktop.add(key);
      workbenchParked.delete(key);
      if (onDesktop.size > 256) onDesktop.delete(onDesktop.values().next().value);
      const shown = await toDesktop(pid, windowId, activate, hostWindow);
      syncShield();
      emitState(pid, windowId);
      return shown;
    },
    /**
     * The tab closed (or its conversation went away): its windows go back to the desktop by default. With "quit",
     * an app NextMux opened for the tab then quits once no tab shows it any more; existing apps always stay open.
     */
    async forget(conversationId, pid, windowId, { close = true, restoreDesktops = true } = {}) {
      if (pid === undefined && windowId === undefined) unfollowWindows(conversationId);
      const windows = viewable.get(conversationId);
      const selected = selectedKeys(conversationId, pid, windowId);
      if (!selected) return false;
      const keys = selected.filter(key => windows?.has(key));
      revokeCapture(conversationId, pid, windowId);
      // macOS view input has its own queue, separate from the automation SDK.
      // Native release acknowledgements must precede moving or closing a target.
      await Promise.allSettled(keys.map(key => inputQueues.get(key)).filter(Boolean));
      const released = new Set();
      await Promise.allSettled(keys.map(async key => {
        windows?.delete(key);
        unsuspend(conversationId, key);
        if (![...viewable.values()].some(other => other.has(key))) { tabWindows.delete(key); userInputOn.delete(key); }
        const [p, w] = key.split(':').map(Number);
        // Return the window before a normal close so any save confirmation appears on the user's desktop.
        if (parked.get(key) === conversationId) await toDesktop(p, w, false);
        if (platform !== 'win32' || ![...viewable.values()].some(other => other.has(key))) {
          await releaseMute(p, w);
          if (platform === 'win32' && launchedWindows.has(key)) {
            launchedWindows.delete(key);
            if (close && closeBehavior === 'quit') await windowsServices.call('closeWindow', { pid: p, windowId: w });
          }
          if (platform === 'win32') { audioPids.delete(key); windowCapabilities.delete(key); closedWindows.delete(key); soundOn.delete(key); onDesktop.delete(key); windowFamilies.delete(key); workbenchParked.delete(key); }
        }
        // The app stops being followed once none of its windows is shown for this conversation.
        if (![...(windows || [])].some(other => other.startsWith(`${p}:`))) { unfollow(conversationId, p); released.add(p); }
      }));
      if (restoreDesktops && platform === 'win32' && !parked.size && typeof windowsServices?.restoreDesktops === 'function') {
        await windowsServices.restoreDesktops().catch(() => undefined);
      }
      if (windows && !windows.size) viewable.delete(conversationId);
      const chains = windowsFollows.get(conversationId);
      if (chains) {
        for (const [id, chain] of chains) {
          if (![...chain.members.keys()].some(key => windows?.has(key) && tabWindows.has(key))) chains.delete(id);
        }
        if (!chains.size) unfollowWindows(conversationId);
      }
      if (pid === undefined && windowId === undefined) unfollowWindows(conversationId);
      syncShield();
      await Promise.allSettled([...released].map(async p => {
        const conversations = launchedApps.get(p);
        if (!conversations?.delete(conversationId)) return;
        if (conversations.size) return;
        launchedApps.delete(p);
        if (close && closeBehavior === 'quit' && !shownAnywhere(p)) await quitApp(p);
      }));
      scheduleIdleStop();
      return true;
    },
    async terminate(conversationId, pid, windowId) {
      const key = windowKey(pid, windowId);
      if (disposed || !validWindow(pid, windowId) || viewable.get(conversationId)?.has(key) !== true) {
        return { ok: false, error: 'window_not_viewable' };
      }
      const audioPid = audioPids.get(key) || 0;
      if (platform === 'win32') {
        parked.delete(key);
        workbenchParked.delete(key);
      }
      // Keep a terminating window off the desktop until its process is gone; cleanup below then removes its desktop.
      await this.forget(conversationId, pid, windowId, { close: true, restoreDesktops: false });
      if (platform === 'win32') {
        if (typeof windowsServices?.terminateProcess === 'function') {
          await windowsServices.terminateProcess(pid, windowId, audioPid).catch(() => undefined);
        } else if (typeof windowsServices?.call === 'function') {
          await windowsServices.call('terminateProcess', { pid, windowId, ...(audioPid ? { audioPid } : {}) }).catch(() => undefined);
        }
        if (!parked.size && typeof windowsServices?.restoreDesktops === 'function') {
          await windowsServices.restoreDesktops().catch(() => undefined);
        }
        return { ok: true };
      }
      if (platform === 'darwin') {
        await quitApp(pid).catch(() => undefined);
        try { process.kill(pid, 0); process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
        return { ok: true };
      }
      try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
      return { ok: true };
    },
    async setWorkbenchVisible(visible) {
      const nextHidden = visible === false;
      if (workbenchHidden === nextHidden || disposed) return;
      workbenchHidden = nextHidden;
      if (nextHidden) {
        windowsMutedAt.clear();
        await Promise.allSettled([...mutedApps.keys()].map(pid => {
          if (platform === 'darwin' && (!helper || helper.ended || inputCleanupFailed)) return Promise.resolve();
          return trackMute(applyMute(pid, false));
        }));
        if (platform === 'darwin' || platform === 'win32') {
          for (const [key, conversationId] of parked.entries()) workbenchParked.set(key, conversationId);
          await Promise.allSettled([...parked.keys()].map(key => { const [p, w] = key.split(':').map(Number); return toDesktop(p, w, false); }));
          if (platform === 'win32' && typeof windowsServices?.restoreDesktops === 'function') {
            await windowsServices.restoreDesktops().catch(() => undefined);
          }
        }
      } else {
        await Promise.allSettled([...mutedApps.entries()].map(([pid, holders]) => {
          if (!holders?.size || [...holders].every(key => soundOn.has(key))) return Promise.resolve();
          if (platform === 'win32') windowsMutedAt.set(pid, Date.now());
          return trackMute(applyMute(pid, true));
        }));
        if ((platform === 'darwin' || platform === 'win32') && workbenchParked.size > 0) {
          const entries = [...workbenchParked.entries()];
          workbenchParked.clear();
          for (const [key, conversationId] of entries) {
            const [pid, windowId] = key.split(':').map(Number);
            if (owns(conversationId, pid, windowId) && !onDesktop.has(key)) {
              await park(conversationId, pid, windowId).catch(() => undefined);
              emitState(pid, windowId);
            }
          }
        }
      }
    },
    async dispose() {
      disposed = true;
      armed.clear();
      if (livenessTimer) { clearInterval(livenessTimer); livenessTimer = undefined; }
      if (windowsFollowTimer) { clearInterval(windowsFollowTimer); windowsFollowTimer = undefined; }
      windowsFollows.clear();
      await Promise.allSettled([...inputQueues.values()]);
      if (mutePending.size) await Promise.allSettled([...mutePending]);
      // Windows keeps a mixer mute after NextMux quits; macOS taps also unmute before helper teardown.
      if (platform === 'win32') await Promise.allSettled([...mutedApps.keys()].map(pid => applyMute(pid, false)));
      else if (platform === 'darwin' && helper && !helper.ended && !inputCleanupFailed) {
        await Promise.allSettled([...mutedApps.keys()].map(pid => applyMute(pid, false)));
      }
      mutedApps.clear();
      followedApps.clear();
      // Every window goes back to the desktop first, so an app that asks to save shows that question where the user sees it.
      const quitting = closeBehavior === 'quit' ? [...launchedApps.keys()] : [];
      launchedApps.clear();
      workbenchParked.clear();
      await Promise.allSettled([...parked.keys()].map(key => { const [p, w] = key.split(':').map(Number); return toDesktop(p, w, false); }));
      if (platform === 'win32' && typeof windowsServices?.restoreDesktops === 'function') {
        await windowsServices.restoreDesktops().catch(() => undefined);
      }
      await Promise.allSettled(quitting.map(quitApp));
      stopHelper();
      if (windowsServices) {
        await shieldQueue;
        if (closeBehavior === 'quit') await Promise.allSettled([...launchedWindows.keys()].map(key => { const [pid, windowId] = key.split(':').map(Number); return windowsServices.call('closeWindow', { pid, windowId }); }));
        launchedWindows.clear();
        await windowsServices.dispose();
      }
      audioPids.clear(); windowCapabilities.clear(); closedWindows.clear(); windowFamilies.clear();
      if (frameDirectory) { try { rmSync(frameDirectory, { recursive: true, force: true }); } catch { /* temporary folder */ } frameDirectory = undefined; }
      armed.clear(); viewable.clear(); suspended.clear(); onDesktop.clear();
    }
  };
}

module.exports = { createComputerWindowView, HELPER_IDLE_MS, windowsAppRoot, windowsRelatedWindow, windowsWindowRole };
