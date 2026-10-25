'use strict';

const { execFile: nodeExecFile } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join, win32 } = require('node:path');
const { tmpdir } = require('node:os');
const failure = code => Object.assign(new Error(code), { code });
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLocaleLowerCase() === right.toLocaleLowerCase();

function createWindowsApps({ execFile = nodeExecFile, app, nativeImage, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let cache, cachedAt = 0, pendingList;
  async function call(request, signal) {
    signal?.throwIfAborted();
    const directory = mkdtempSync(join(tmpdir(), 'nextmux-apps-'));
    try {
      for (const file of ['windows-apps.ps1', 'windows-apps-native.cs']) writeFileSync(join(directory, file), readFileSync(join(__dirname, file)), { mode: 0o600 });
      const stdout = await new Promise((resolve, reject) => execFile(win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'windows-apps.ps1')],
        { windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, signal,
          env: { ...process.env, NEXTMUX_WINDOWS_APPS_REQUEST: JSON.stringify(request) } },
        (error, text) => error ? reject(failure(signal?.aborted ? 'cancelled' : 'windows_app_query_failed')) : resolve(text)));
      try { return JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim()); } catch { throw failure('windows_app_reply_invalid'); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  async function list({ signal, refresh = false } = {}) {
    signal?.throwIfAborted();
    if (!refresh && cache && Date.now() - cachedAt < 600000) return cache.map(item => ({ ...item }));
    if (!refresh && pendingList && !signal) return (await pendingList).map(item => ({ ...item }));
    const run = (async () => {
      try {
        const rows = await call({ action: 'discover' }, signal);
        if (!Array.isArray(rows)) throw failure('windows_app_reply_invalid');
        cache = rows.filter(row => typeof row?.name === 'string' && typeof row.appId === 'string' && row.appId.length > 0 && row.appId.length <= 512)
          .map(row => ({ name: row.name, appId: row.appId, executable: String(row.executable || ''), shortcut: String(row.shortcut || ''),
            logo: String(row.logo || ''), packaged: row.packaged === true, packageFamilyName: String(row.packageFamilyName || '') }));
        cachedAt = Date.now();
        return cache;
      } finally {
        if (pendingList === run) pendingList = undefined;
      }
    })();
    if (!signal) pendingList = run;
    return (await run).map(item => ({ ...item }));
  }
  const windows = async signal => {
    const rows = await call({ action: 'windows' }, signal);
    if (!Array.isArray(rows)) throw failure('windows_app_reply_invalid');
    return rows.filter(row => Number.isSafeInteger(row?.pid) && row.pid > 0 && Number.isSafeInteger(row.windowId) && row.windowId > 0 && Array.isArray(row.processes));
  };
  const processes = async signal => {
    const rows = await call({ action: 'processes' }, signal);
    if (!Array.isArray(rows)) throw failure('windows_app_reply_invalid');
    return rows.filter(row => Number.isSafeInteger(row?.pid) && row.pid > 0);
  };
  // Process-only detection requires an exact app identity; sharing an installation directory is insufficient.
  const matchRunningProcess = (record, process) => Boolean(record.appId) && equal(record.appId, process.appId)
    || !record.packaged && Boolean(record.executable) && equal(record.executable, process.executable);
  const appRoot = executable => {
    if (!executable) return '';
    const dir = win32.dirname(executable);
    const parent = win32.basename(win32.dirname(dir));
    if (/^(program files|program files \(x86\)|programs)$/i.test(parent)) return `${dir.toLocaleLowerCase()}\\`;
    return '';
  };
  const isTransientLauncher = executable => typeof executable === 'string' && (
    /\\wegamelauncher\\launcher\.exe$/i.test(executable)
    || /\\tenprotect\\taslogin\.exe$/i.test(executable)
    || /\\(pallas|crossproxy|teniodl|tphelper|sguard64|sguardsvc64|cef_frame_render|crashpad_handler|wegamehelper|riotclientcrashhandler)\.exe$/i.test(executable)
  );
  // An empty AUMID says nothing about identity: two unregistered programs must not match on it (audit A20-01).
  const matchProcess = (record, process) => Boolean(record.appId) && !isTransientLauncher(process.executable) && equal(record.appId, process.appId)
    || !record.packaged && Boolean(record.executable) && !isTransientLauncher(process.executable) && (
      equal(record.executable, process.executable)
      || Boolean(appRoot(record.executable)) && typeof process.executable === 'string' && process.executable.toLocaleLowerCase().startsWith(appRoot(record.executable))
      || (/\\wegamelauncher\\launcher\.exe$/i.test(record.executable) || /\\wegame\\wegame\.exe$/i.test(record.executable))
        && typeof process.executable === 'string' && (/\\wegame\\/i.test(process.executable) || /^[a-z]:\\wegameapps\\/i.test(process.executable))
    );
  function resolve(selector, records) {
    const byId = records.find(row => equal(row.appId, selector));
    if (byId) return byId;
    const stem = selector.replace(/\.exe$/i, '');
    if (!stem) throw failure('computer_app_required');
    const names = row => [row.name, row.appId, row.executable, row.shortcut, win32.basename(row.executable), win32.basename(row.executable, '.exe')];
    const exact = records.filter(row => names(row).some(value => value && (equal(value, selector) || equal(value, stem))));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      const byExactName = exact.filter(row => equal(row.name, selector) || equal(row.name, stem));
      if (byExactName.length === 1) return byExactName[0];
      throw failure('computer_app_ambiguous');
    }
    const partial = records.filter(row => [row.name, row.appId, win32.basename(row.executable).replace(/\.exe$/i, '')]
      .some(value => value.toLocaleLowerCase().includes(stem.toLocaleLowerCase())));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw failure('computer_app_ambiguous');
    const aliases = {
      '计算器': ['calculator', 'microsoft.windowscalculator_8wekyb3d8bbwe!app', 'calc'],
      'calculator': ['计算器', 'microsoft.windowscalculator_8wekyb3d8bbwe!app', 'calc'],
      'calc': ['计算器', 'calculator', 'microsoft.windowscalculator_8wekyb3d8bbwe!app'],
      '记事本': ['notepad', 'microsoft.windowsnotepad_8wekyb3d8bbwe!app'],
      'notepad': ['记事本', 'microsoft.windowsnotepad_8wekyb3d8bbwe!app'],
      '画图': ['paint', 'mspaint', 'microsoft.paint_8wekyb3d8bbwe!app'],
      'paint': ['画图', 'mspaint', 'microsoft.paint_8wekyb3d8bbwe!app'],
      'mspaint': ['画图', 'paint', 'microsoft.paint_8wekyb3d8bbwe!app'],
      '命令提示符': ['command prompt', 'cmd'],
      'cmd': ['命令提示符', 'command prompt'],
      '终端': ['windows terminal', 'terminal', 'microsoft.windowsterminal_8wekyb3d8bbwe!app', 'wt'],
      'windows terminal': ['终端', 'microsoft.windowsterminal_8wekyb3d8bbwe!app', 'wt'],
      '设置': ['settings', 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'],
      'settings': ['设置', 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'],
      '微信': ['wechat', 'weixin'],
      'wechat': ['微信', 'weixin']
    }[stem.toLocaleLowerCase()];
    if (aliases) {
      for (const alias of aliases) {
        const aliasExact = records.filter(row => names(row).some(value => value && equal(value, alias)));
        if (aliasExact.length === 1) return aliasExact[0];
      }
      for (const alias of aliases) {
        const aliasPartial = records.filter(row => [row.name, row.appId, win32.basename(row.executable).replace(/\.exe$/i, '')]
          .some(value => value.toLocaleLowerCase().includes(alias)));
        if (aliasPartial.length === 1) return aliasPartial[0];
      }
    }
    if (win32.isAbsolute(selector) && /\.(exe|lnk)$/i.test(selector)) return { name: win32.basename(selector).replace(/\.(exe|lnk)$/i, ''), executable: /\.exe$/i.test(selector) ? selector : '', shortcut: /\.lnk$/i.test(selector) ? selector : '', appId: '' };
    throw failure('computer_app_not_found');
  }
  const findWindow = (record, rows) => rows.find(row => row.processes.some(process => matchProcess(record, process)));
  // Largest matching window: a launcher's splash is small, its main window large.
  const largestWindow = (record, rows) => rows.filter(row => row.processes.some(process => matchProcess(record, process)))
    .reduce((best, row) => !best || (Number(row.width) || 0) * (Number(row.height) || 0) > (Number(best.width) || 0) * (Number(best.height) || 0) ? row : best, undefined);
  const programOf = file => typeof file === 'string' && file ? win32.basename(file).replace(/\.exe$/i, '') : '';
  const describeOpened = (record, window, launched) => {
    const process = window.processes.find(process => matchProcess(record, process));
    const programs = [...new Set([programOf(process.executable), programOf(record.executable)].filter(Boolean))];
    return { pid: window.pid, appPid: process.pid, windowId: window.windowId, app: record.name, appId: record.appId || win32.basename(record.executable, '.exe'),
      title: String(window.title || '').slice(0, 200), launched, sharedHost: process.pid !== window.pid,
      ...(programs.length ? { program: programs[0], programs } : {}),
      ...(record.executable ? { executable: record.executable } : {}),
      ...(process.executable ? { windowExecutable: process.executable } : {}),
      ...(process.pid !== window.pid ? { launchReason: 'shared_window_host' } : {}) };
  };
  /** taken(pid, windowId): a window another conversation's tab already has — never handed out again; a new instance is started instead. */
  async function open(selector, { signal, taken = () => false, onlyIfRunning = false, probeOnly = false, checkOrOpen = false, restartIfRunning = false, restart } = {}) {
    if (typeof selector !== 'string' || !selector.trim()) throw failure('computer_app_required');
    const record = resolve(selector.trim(), await list({ signal }));
    if (!record.executable && record.shortcut) {
      const link = await call({ action: 'resolveShortcut', path: record.shortcut }, signal);
      record.executable = String(link.executable || '');
      record.appId ||= String(link.appId || '');
    }
    const free = rows => rows.filter(row => !taken(row.pid, row.windowId));
    let before = await windows(signal);
    const matching = before.filter(row => row.processes.some(process => matchProcess(record, process)));
    const runningProcesses = probeOnly || checkOrOpen || restartIfRunning
      ? (await processes(signal)).filter(process => matchRunningProcess(record, process)) : [];
    const wasRunning = matching.length > 0 || runningProcesses.length > 0;
    if (probeOnly || (checkOrOpen && wasRunning && !restartIfRunning)) return {
      running: wasRunning, ...(checkOrOpen && wasRunning ? { requiresRestart: true } : {}), app: record.name, appId: record.appId
    };
    if (restartIfRunning && wasRunning) {
      if (matching.some(row => taken(row.pid, row.windowId))) throw failure('computer_window_owned');
      if (typeof restart !== 'function') throw failure('computer_app_restart_failed');
      // The app's child process owns packaged windows; ApplicationFrameHost can host unrelated apps.
      await restart([...matching.map(row => describeOpened(record, row, false)), ...runningProcesses.map(process => ({ pid: process.pid, appPid: process.pid }))]);
      before = await windows(signal);
      if (findWindow(record, before) || (await processes(signal)).some(process => matchRunningProcess(record, process))) throw failure('computer_app_restart_failed');
    }
    const previous = findWindow(record, free(before));
    if (previous) return describeOpened(record, previous, false);
    if (onlyIfRunning) throw failure(findWindow(record, before) ? 'computer_window_owned' : 'app_not_running');
    await call({ action: 'launch', appId: record.appId, path: record.shortcut || record.executable }, signal);
    // A freshly launched app may first show a splash or loader window that closes within seconds (WeGame's launcher,
    // updaters). Bind its largest window once that window has stayed for settlePolls polls in a row.
    const isLauncher = /wegame|launcher|riotclient|steam|epicgames|battle\.net/i.test(`${record.name} ${record.appId} ${record.executable}`);
    const settlePolls = isLauncher ? 4 : 2;
    let candidate, stable = 0, settling = 0, rows = before;
    for (let attempt = 0; attempt < 40;) {
      signal?.throwIfAborted();
      rows = await windows(signal);
      const window = largestWindow(record, free(rows));
      if (window) {
        stable = candidate?.windowId === window.windowId ? stable + 1 : 0;
        candidate = window;
        if (stable >= settlePolls || ++settling > 40) return describeOpened(record, candidate, true);
      } else {
        candidate = undefined; stable = 0;
        attempt++;
      }
      await sleep(250);
    }
    // A single-instance app only brought its one window (another conversation's) forward.
    throw failure(findWindow(record, rows) ? 'computer_window_owned' : 'app_window_unavailable');
  }
  async function icon(record) {
    try {
      const image = record.packaged && record.logo ? nativeImage?.createFromPath(record.logo)
        : await app?.getFileIcon(record.executable || record.shortcut, { size: 'normal' });
      return image && !image.isEmpty() ? image.resize({ width: 32, height: 32 }) : undefined;
    } catch { return undefined; }
  }
  async function pick({ Menu, owner } = {}) {
    const records = (await list({ refresh: true })).sort((a, b) => a.name.localeCompare(b.name));
    if (!records.length) throw failure('computer_apps_unavailable');
    const items = await Promise.all(records.map(async record => ({ record, image: await icon(record) })));
    return new Promise(resolve => {
      const menu = Menu.buildFromTemplate(items.map(({ record, image }) => ({ label: record.name.replace(/&/g, '&&'), ...(image ? { icon: image } : {}), click: () => resolve({
        name: record.name.slice(0, 80), id: record.appId, path: record.executable || record.shortcut, icon: image?.toDataURL() || '', packaged: record.packaged }) })));
      menu.popup({ window: owner, callback: () => resolve(undefined) });
    });
  }
  /** An .exe or .lnk dragged in: its Start menu entry when it has one (the id tabs.open_app matches), else the file. */
  async function describe(file) {
    if (typeof file !== 'string' || !win32.isAbsolute(file) || !/\.(exe|lnk)$/i.test(file)) return undefined;
    const records = await list({ refresh: true }).catch(() => []);
    const record = records.find(row => [row.executable, row.shortcut].some(value => value && equal(value, file)))
      || { name: win32.basename(file).replace(/\.(exe|lnk)$/i, ''), executable: /\.exe$/i.test(file) ? file : '', shortcut: /\.lnk$/i.test(file) ? file : '', appId: '' };
    const image = await icon(record);
    return { name: record.name.slice(0, 80), id: (record.appId || win32.basename(record.executable || record.shortcut).replace(/\.(exe|lnk)$/i, '')).slice(0, 160),
      path: record.executable || record.shortcut, icon: image?.toDataURL() || '', packaged: record.packaged };
  }
  /** The icon of the app with this id (a Start menu app id or program name). */
  async function iconForId(id) {
    const records = await list().catch(() => []);
    const record = records.find(row => equal(row.appId, id) || row.executable && equal(win32.basename(row.executable).replace(/\.exe$/i, ''), id) || equal(row.name, id));
    return record ? (await icon(record))?.toDataURL() || '' : '';
  }
  async function identify(pid, windowId) {
    const rows = await windows();
    const row = rows.find(row => row.pid === pid && row.windowId === windowId);
    const process = row?.processes.find(process => process.pid !== pid && process.appId) || row?.processes.find(process => process.pid === pid);
    return { program: win32.basename(process?.executable || '').replace(/\.exe$/i, ''), appId: process?.appId || '' };
  }
  async function listApps({ signal } = {}) {
    const records = await list({ signal }); const snapshot = await windows(signal);
    const rows = records.map(record => {
      const row = findWindow(record, snapshot);
      return { ...record, launch_path: record.executable || record.shortcut, running: Boolean(row), ...(row ? { pid: row.pid, windowId: row.windowId } : {}) };
    });
    for (const row of snapshot) if (!records.some(record => findWindow(record, [row]))) {
      const process = row.processes.find(process => process.pid !== row.pid && process.appId) || row.processes.find(process => process.pid === row.pid);
      if (process?.executable && !/^qwen-cua-driver(?:-uia)?\.exe$/i.test(win32.basename(process.executable))) rows.push({ name: win32.basename(process.executable, '.exe'), appId: process.appId || '', launch_path: process.executable,
        pid: row.pid, appPid: process.pid, windowId: row.windowId, running: true });
    }
    return rows;
  }
  return { list, listApps, open, windows, identify, icon, pick, describe, iconForId, call };
}
module.exports = { createWindowsApps };
