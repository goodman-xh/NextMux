'use strict';

/**
 * Where NextMux keeps its data (conversations, their workspaces, checkpoints, media, catalogs …), apart from the
 * install directory as desktop apps do (VS Code, Cursor, Codex: the OS's per-user data folder):
 * - default: the backend's per-user folder (macOS ~/Library/Application Support/NextMux, Windows %LOCALAPPDATA%\NextMux);
 * - portable (the Windows portable build, electron-builder sets PORTABLE_EXECUTABLE_DIR): a "NextMux Data" folder next to
 *   the .exe, like VS Code's portable `data` folder, so the data travels with the program;
 * - custom: a folder the user chose in Settings → 本地数据 (e.g. another drive). The choice is a pointer file in the
 *   Electron user-data folder, which never moves.
 * A move happens at the next launch, before the backend starts: copy, verify every file, switch, then move the old copies
 * to the Trash (never deleted outright). If anything fails the old location stays in use.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const POINTER = 'nextmux-data-location-v1.json';
/** Electron / Theia files that live in the same folder as NextMux data on macOS; they never move. */
const ELECTRON_ENTRIES = new Set(['blob_storage', 'shared_proto_db', 'databases', 'databases-journal', 'optimization_guide_model_store', 'segmentation_platform', 'config.json', 'window-state.json', 'app-plugins', 'app-plugin-receipts',
  'nextmux-update-target-v1.json', POINTER, 'logs', 'crashpad', 'dictionaries']);

function defaultDataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const base = platform === 'win32' ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(base, 'NextMux');
}

/** NextMux's own entries in a data folder: lower-case names the backend creates, never Chromium's profile files. */
function isDataEntry(name) {
  return /^[a-z0-9][a-z0-9._-]*$/.test(name) && !ELECTRON_ENTRIES.has(name) && !name.startsWith('.') && !/^nextmux old data/i.test(name);
}

function readPointer(userData) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userData, POINTER), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function writePointer(userData, value) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, POINTER);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function usableDirectory(target) {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
    return fs.statSync(target).isDirectory();
  } catch { return false; }
}

/** A folder that already holds data: never created here, so an offline drive is not mistaken for an empty profile. */
function existingDirectory(target) {
  try {
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
    return fs.statSync(target).isDirectory();
  } catch { return false; }
}

/**
 * Decide the data folder before anything reads it. Sets `NEXTMUX_DESKTOP_STATE_DIR` for the backend (forked later, it
 * inherits the environment) and, for the portable build, Electron's user-data folder too.
 */
function resolveDataLocation({ app, env = process.env, platform = process.platform } = {}) {
  const portable = platform === 'win32' ? env.PORTABLE_EXECUTABLE_DIR : undefined;
  if (portable && path.isAbsolute(portable)) {
    const root = path.join(portable, 'NextMux Data');
    const profile = path.join(root, 'electron');
    if (usableDirectory(profile)) {
      app?.setPath('userData', profile);
      app?.setPath('sessionData', profile);
      if (!env.NEXTMUX_DESKTOP_STATE_DIR) env.NEXTMUX_DESKTOP_STATE_DIR = path.join(root, 'data');
      return { mode: 'portable', root: env.NEXTMUX_DESKTOP_STATE_DIR };
    }
    // Portable data that exists but cannot be written is never silently swapped for another profile (that would look
    // like being signed out and split the user's data). A first run from read-only media keeps the normal location.
    if (fs.existsSync(root)) throw Object.assign(new Error(`Portable profile unavailable: ${profile}`), { code: 'portable_profile_unavailable', path: profile });
  }
  // A launch that set the folder itself (development, tests) is left alone.
  if (env.NEXTMUX_DESKTOP_STATE_DIR) return { mode: 'override', root: env.NEXTMUX_DESKTOP_STATE_DIR };
  const userData = app?.getPath('userData');
  const pointer = userData ? readPointer(userData) : {};
  if (typeof pointer.path === 'string' && path.isAbsolute(pointer.path)) {
    if (existingDirectory(pointer.path)) {
      env.NEXTMUX_DESKTOP_STATE_DIR = pointer.path;
      return { mode: 'custom', root: pointer.path, pending: pointer.pending };
    }
    // The chosen folder is missing (an unplugged drive, an unmounted share): ask, never
    // recreate it empty or fall back silently (audit DS-01). No move runs meanwhile.
    return { mode: 'custom_unavailable', root: pointer.path };
  }
  return { mode: 'default', root: defaultDataRoot({ platform, env }), pending: pointer.pending };
}

/** Why a folder cannot take NextMux's data, or undefined when it can. */
function checkTarget(target, current, { freeBytes, neededBytes } = {}) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return 'not_absolute';
  const to = path.resolve(target), from = path.resolve(current);
  if (to === from) return 'same_folder';
  const inside = (child, parent) => path.relative(parent, child) && !path.relative(parent, child).startsWith('..') && !path.isAbsolute(path.relative(parent, child));
  if (inside(to, from) || inside(from, to)) return 'nested_folder';
  try {
    if (fs.existsSync(to) && fs.readdirSync(to).some(name => !name.startsWith('.'))) return 'not_empty';
  } catch { return 'not_writable'; }
  if (!usableDirectory(to)) return 'not_writable';
  if (Number.isFinite(freeBytes) && Number.isFinite(neededBytes) && freeBytes < neededBytes * 1.1 + 512 * 1024 * 1024) return 'not_enough_space';
  return undefined;
}

async function walk(root, relative = '', links = []) {
  const out = [];
  const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, name, links));
    else if (entry.isFile()) out.push(name);
    else if (entry.isSymbolicLink()) links.push(name);
  }
  return out;
}

/**
 * Links are copied as links. One keeps working only if it points inside what is
 * moved (relative) or outside the old folder altogether (absolute); anything else
 * would dangle once the old folder is gone, so the move is refused (audit DS-03).
 */
async function verifyLink(from, to, name, link) {
  const source = path.join(from, name, link), copy = path.join(to, name, link);
  const [target, copied] = await Promise.all([fsp.readlink(source), fsp.readlink(copy)]);
  if (target !== copied) throw Object.assign(new Error(`verify failed: ${path.join(name, link)}`), { code: 'verify_failed' });
  const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const resolved = path.resolve(path.dirname(source), target);
  const keeps = path.isAbsolute(target) ? !inside(resolved, from) : inside(resolved, path.join(from, name));
  if (!keeps) throw Object.assign(new Error(`link would break: ${path.join(name, link)}`), { code: 'unsupported_link' });
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const handle = await fsp.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Object.assign(new Error(`verify failed: ${file}`), { code: 'verify_failed' });
    let bytes = 0;
    // Read every byte through a bounded buffer. A head/tail sample can accept
    // a damaged middle of a large video, then switch the app to that copy.
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const [after, named] = await Promise.all([handle.stat(), fsp.lstat(file)]);
    if (!named.isFile() || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino
      || bytes !== before.size || after.size !== before.size || named.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.mtimeMs !== before.mtimeMs || named.ctimeMs !== before.ctimeMs) {
      throw Object.assign(new Error(`verify failed: ${file}`), { code: 'verify_failed' });
    }
    return { size: bytes, hash: hash.digest('hex') };
  } finally { await handle.close(); }
}

/** The NextMux entries of a data folder and their total size. */
async function measure(root) {
  const names = fs.existsSync(root) ? fs.readdirSync(root).filter(isDataEntry) : [];
  let bytes = 0, files = 0;
  for (const name of names) {
    const full = path.join(root, name);
    const stat = fs.lstatSync(full);
    if (stat.isFile()) { bytes += stat.size; files++; continue; }
    for (const file of await walk(full)) { bytes += fs.statSync(path.join(full, file)).size; files++; }
  }
  return { names, bytes, files };
}

/** Copy NextMux's entries to the new folder and verify every file (size and SHA-256). */
async function copyVerified(from, to, onProgress = () => undefined, { created = [] } = {}) {
  const { names, bytes, files } = await measure(from);
  let done = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const name of names) {
    if (fs.existsSync(path.join(to, name))) throw Object.assign(new Error(`exists: ${name}`), { code: 'not_empty' });
    created.push(name);
    await fsp.cp(path.join(from, name), path.join(to, name), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    onProgress({ phase: 'copy', done: ++done, total: names.length });
  }
  let checked = 0;
  for (const name of names) {
    const source = path.join(from, name);
    const links = [];
    const list = fs.lstatSync(source).isFile() ? [''] : await walk(source, '', links);
    for (const link of links) await verifyLink(from, to, name, link);
    for (const file of list) {
      const a = path.join(source, file), b = path.join(to, name, file);
      const [sourceDigest, destinationDigest] = await Promise.all([sha256(a), sha256(b)]);
      if (sourceDigest.size !== destinationDigest.size || sourceDigest.hash !== destinationDigest.hash) throw Object.assign(new Error(`verify failed: ${path.join(name, file)}`), { code: 'verify_failed' });
      if (++checked % 200 === 0) onProgress({ phase: 'verify', done: checked, total: files });
    }
  }
  onProgress({ phase: 'verify', done: files, total: files });
  return { names, bytes, files };
}

/**
 * The move the user asked for, run at launch before the backend starts. Returns the folder to use now. On failure the
 * pointer keeps the old folder and records the error for Settings; half-copied files in the new folder are moved to the Trash.
 */
async function performPendingMove({ app, shell, env = process.env, platform = process.platform, home = os.homedir(), onProgress = () => undefined } = {}) {
  const userData = app.getPath('userData');
  const pointer = readPointer(userData);
  const pending = pointer.pending;
  if (!pending || typeof pending.from !== 'string' || typeof pending.to !== 'string') return undefined;
  const { from, to } = pending;
  const toDefault = path.resolve(to) === path.resolve(defaultDataRoot({ platform, env, home }));
  const created = [];
  let copied;
  try {
    // An unavailable source (an offline drive) would copy as zero files and look like a finished move (audit DS-01).
    if (!existingDirectory(from)) throw Object.assign(new Error('source_unavailable'), { code: 'source_unavailable' });
    const reason = checkTarget(to, from);
    if (reason && !(toDefault && reason === 'not_empty')) throw Object.assign(new Error(reason), { code: reason });
    copied = await copyVerified(from, to, onProgress, { created });
    // Switch first, so a crash after this point never leaves NextMux reading a half-emptied folder.
    writePointer(userData, { ...(toDefault ? {} : { path: to }), lastMove: { from, to, at: Date.now(), files: copied.files, bytes: copied.bytes } });
    env.NEXTMUX_DESKTOP_STATE_DIR = to;
  } catch (error) {
    // Only what this move copied goes to the Trash; the old folder is untouched and stays in use.
    if (created.length) {
      try {
        const holder = path.join(to, `NextMux incomplete copy ${Date.now()}`);
        fs.mkdirSync(holder);
        for (const name of created) if (fs.existsSync(path.join(to, name))) fs.renameSync(path.join(to, name), path.join(holder, name));
        await shell?.trashItem(holder).catch(() => undefined);
      } catch { /* the error below still keeps the old folder in use */ }
    }
    writePointer(userData, { ...(typeof pointer.path === 'string' ? { path: pointer.path } : {}), lastError: { code: String(error?.code || 'move_failed'), at: Date.now(), from, to } });
    return { ok: false, root: from, error: String(error?.code || 'move_failed') };
  }
  // From here the verified new folder is the data. Tidying the old folder may fail
  // (a file in use, a rename race) without undoing the move: rolling back would
  // strand whatever was already set aside (audit DS-02). Leftovers are reported.
  const holder = path.join(from, `NextMux old data ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '.')}`);
  let trashed = false;
  try {
    fs.mkdirSync(holder);
    for (const name of copied.names) if (fs.existsSync(path.join(from, name))) fs.renameSync(path.join(from, name), path.join(holder, name));
    trashed = await shell?.trashItem(holder).then(() => true, () => false);
  } catch { /* the old copies stay where they are; the new folder is already in use */ }
  const remaining = copied.names.filter(name => fs.existsSync(path.join(from, name)));
  writePointer(userData, { ...(toDefault ? {} : { path: to }), lastMove: { from, to, at: Date.now(), files: copied.files, bytes: copied.bytes,
    ...(trashed && !remaining.length ? {} : { leftover: trashed ? from : holder }) } });
  return { ok: true, root: to, trashed };
}

module.exports = { POINTER, defaultDataRoot, isDataEntry, readPointer, writePointer, resolveDataLocation, checkTarget, measure, copyVerified, performPendingMove };

/** The progress window's words, in the app language the user had when they asked for the move. */
const MOVE_TEXT = {
  'zh-CN': ['正在移动 NextMux 数据', '正在复制', '正在校验文件', '完成前请不要关闭电脑'],
  'zh-TW': ['正在移動 NextMux 資料', '正在複製', '正在校驗檔案', '完成前請不要關閉電腦'],
  en: ['Moving NextMux data', 'Copying', 'Checking files', 'Please keep the computer on until this finishes'],
  ja: ['NextMux のデータを移動しています', 'コピー中', 'ファイルを確認中', '完了するまでコンピュータの電源を切らないでください'],
  ko: ['NextMux 데이터를 옮기는 중', '복사 중', '파일 확인 중', '끝날 때까지 컴퓨터를 끄지 마세요'],
  es: ['Moviendo los datos de NextMux', 'Copiando', 'Comprobando archivos', 'No apagues el equipo hasta que termine'],
  fr: ['Déplacement des données NextMux', 'Copie', 'Vérification des fichiers', 'Laissez l’ordinateur allumé jusqu’à la fin'],
  de: ['NextMux-Daten werden verschoben', 'Kopieren', 'Dateien werden geprüft', 'Bitte den Computer bis zum Ende eingeschaltet lassen'],
  'pt-BR': ['Movendo os dados do NextMux', 'Copiando', 'Conferindo arquivos', 'Mantenha o computador ligado até terminar'],
  ru: ['Перенос данных NextMux', 'Копирование', 'Проверка файлов', 'Не выключайте компьютер до завершения'],
  ar: ['جارٍ نقل بيانات NextMux', 'جارٍ النسخ', 'جارٍ التحقق من الملفات', 'أبقِ الحاسوب قيد التشغيل حتى ينتهي النقل'],
  hi: ['NextMux डेटा ले जाया जा रहा है', 'कॉपी हो रहा है', 'फ़ाइलें जाँची जा रही हैं', 'पूरा होने तक कंप्यूटर बंद न करें']
};

/** The prompt when the chosen data folder is missing at launch: [message, detail, retry, use default, quit]. */
const UNAVAILABLE_TEXT = {
  'zh-CN': ['找不到 NextMux 的数据文件夹', '数据文件夹“{path}”当前不可用。如果它在外置硬盘或网络位置，请连接后重试。改用默认文件夹不会删除或移动原来的数据。', '重试', '改用默认文件夹', '退出'],
  'zh-TW': ['找不到 NextMux 的資料夾', '資料夾「{path}」目前無法使用。如果它在外接硬碟或網路位置，請連接後重試。改用預設資料夾不會刪除或移動原本的資料。', '重試', '改用預設資料夾', '結束'],
  en: ['NextMux can’t find its data folder', 'The data folder “{path}” isn’t available. If it’s on an external drive or a network location, connect it and try again. Using the default folder doesn’t delete or move the original data.', 'Try Again', 'Use Default Folder', 'Quit'],
  ja: ['NextMux のデータフォルダが見つかりません', 'データフォルダ「{path}」を利用できません。外付けドライブやネットワーク上にある場合は、接続してからもう一度お試しください。既定のフォルダを使っても元のデータは削除・移動されません。', '再試行', '既定のフォルダを使う', '終了'],
  ko: ['NextMux 데이터 폴더를 찾을 수 없습니다', '데이터 폴더 “{path}”을(를) 사용할 수 없습니다. 외장 드라이브나 네트워크 위치에 있다면 연결한 뒤 다시 시도하세요. 기본 폴더를 사용해도 원래 데이터는 삭제되거나 이동되지 않습니다.', '다시 시도', '기본 폴더 사용', '종료'],
  es: ['NextMux no encuentra su carpeta de datos', 'La carpeta de datos «{path}» no está disponible. Si está en un disco externo o en una ubicación de red, conéctala y vuelve a intentarlo. Usar la carpeta predeterminada no borra ni mueve los datos originales.', 'Reintentar', 'Usar la carpeta predeterminada', 'Salir'],
  fr: ['NextMux ne trouve pas son dossier de données', 'Le dossier de données « {path} » n’est pas disponible. S’il se trouve sur un disque externe ou un emplacement réseau, connectez-le puis réessayez. Utiliser le dossier par défaut ne supprime ni ne déplace les données d’origine.', 'Réessayer', 'Utiliser le dossier par défaut', 'Quitter'],
  de: ['NextMux findet seinen Datenordner nicht', 'Der Datenordner „{path}“ ist nicht verfügbar. Liegt er auf einem externen Laufwerk oder im Netzwerk, verbinde ihn und versuche es erneut. Der Standardordner löscht oder verschiebt die ursprünglichen Daten nicht.', 'Erneut versuchen', 'Standardordner verwenden', 'Beenden'],
  'pt-BR': ['O NextMux não encontra sua pasta de dados', 'A pasta de dados “{path}” não está disponível. Se ela estiver em um disco externo ou na rede, conecte-a e tente de novo. Usar a pasta padrão não apaga nem move os dados originais.', 'Tentar de novo', 'Usar a pasta padrão', 'Sair'],
  ru: ['NextMux не находит папку с данными', 'Папка с данными «{path}» недоступна. Если она на внешнем диске или в сети, подключите её и повторите попытку. Папка по умолчанию не удаляет и не перемещает исходные данные.', 'Повторить', 'Использовать папку по умолчанию', 'Выйти'],
  ar: ['يتعذّر على NextMux العثور على مجلد البيانات', 'مجلد البيانات «{path}» غير متاح. إذا كان على قرص خارجي أو موقع شبكة، فاتصل به ثم أعد المحاولة. استخدام المجلد الافتراضي لا يحذف البيانات الأصلية ولا ينقلها.', 'إعادة المحاولة', 'استخدام المجلد الافتراضي', 'إنهاء'],
  hi: ['NextMux को अपना डेटा फ़ोल्डर नहीं मिल रहा', 'डेटा फ़ोल्डर “{path}” उपलब्ध नहीं है। अगर यह बाहरी ड्राइव या नेटवर्क पर है, तो उसे जोड़कर फिर कोशिश करें। डिफ़ॉल्ट फ़ोल्डर इस्तेमाल करने से मूल डेटा न हटता है, न खिसकता है।', 'फिर कोशिश करें', 'डिफ़ॉल्ट फ़ोल्डर इस्तेमाल करें', 'बंद करें']
};

function appLocale(value) {
  const locale = String(value || 'en');
  if (/^zh[-_](?:tw|hk|mo)|^zh[-_]hant/i.test(locale)) return 'zh-TW';
  if (/^zh/i.test(locale)) return 'zh-CN';
  if (/^pt/i.test(locale)) return 'pt-BR';
  const base = locale.split(/[-_]/)[0].toLowerCase();
  return Object.hasOwn(UNAVAILABLE_TEXT, base) ? base : 'en';
}

/**
 * The chosen data folder is missing at launch. Retry (after reconnecting it),
 * use the default folder for now (the pointer forgets the missing folder; its
 * data is untouched), or quit. Returns 'retry', 'default' or 'quit'.
 */
async function chooseForUnavailableData({ app, dialog, root }) {
  const [message, detail, retry, useDefault, quit] = UNAVAILABLE_TEXT[appLocale(app.getLocale?.())];
  const { response } = await dialog.showMessageBox({ type: 'warning', message, detail: detail.replace('{path}', root), buttons: [retry, useDefault, quit], defaultId: 0, cancelId: 2, noLink: true });
  if (response !== 1) return response === 0 ? 'retry' : 'quit';
  writePointer(app.getPath('userData'), { lastError: { code: 'custom_unavailable', at: Date.now(), from: root } });
  return 'default';
}

/** A small window that shows the move's progress before the workbench opens. */
function moveProgressWindow({ BrowserWindow, locale }) {
  const [title, copying, checking, keepOn] = MOVE_TEXT[locale] || MOVE_TEXT.en;
  const window = new BrowserWindow({ width: 440, height: 170, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false,
    title: 'NextMux', backgroundColor: '#1f1f1f', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:22px 26px;font:13px -apple-system,Segoe UI,system-ui,sans-serif;background:#1f1f1f;color:#eee" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<div style="font-size:15px;font-weight:600;margin-bottom:12px">${title}</div><div id="s" style="color:#bbb;margin-bottom:10px">${copying}…</div>
<div style="height:6px;border-radius:3px;background:#3a3a3a;overflow:hidden"><div id="b" style="height:100%;width:0;background:#e0e0e0;transition:width .2s"></div></div>
<div style="color:#888;margin-top:12px;font-size:12px">${keepOn}</div></body>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => window.show(), () => undefined);
  return {
    update: ({ phase, done, total }) => {
      if (window.isDestroyed()) return;
      const label = `${phase === 'verify' ? checking : copying}… ${done}/${total}`;
      const width = total ? Math.round((phase === 'verify' ? 50 : 0) + done / total * 50) : 0;
      void window.webContents.executeJavaScript(`document.getElementById('s').textContent=${JSON.stringify(label)};document.getElementById('b').style.width='${width}%';`).catch(() => undefined);
    },
    close: () => { if (!window.isDestroyed()) window.destroy(); }
  };
}

/**
 * Settings → 本地数据: where the data is, choosing a new folder, and asking for the move (done at the next launch).
 * Every call must come from NextMux's own page.
 */
function registerDataLocation({ ipcMain, app, dialog, shell, trustedMainFrame, resolved, platform = process.platform, env = process.env }) {
  const current = () => env.NEXTMUX_DESKTOP_STATE_DIR || defaultDataRoot({ platform, env });
  ipcMain.handle('nextmux:data-location:get', event => {
    if (!trustedMainFrame(event)) return undefined;
    const pointer = readPointer(app.getPath('userData'));
    return { mode: resolved.mode, root: current(), defaultRoot: defaultDataRoot({ platform, env }),
      ...(pointer.pending ? { pending: pointer.pending.to } : {}), ...(pointer.lastMove ? { lastMove: pointer.lastMove } : {}), ...(pointer.lastError ? { lastError: pointer.lastError } : {}) };
  });
  ipcMain.handle('nextmux:data-location:choose', async event => {
    if (!trustedMainFrame(event)) return undefined;
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled || !result.filePaths[0] ? undefined : path.join(result.filePaths[0], fs.readdirSync(result.filePaths[0]).some(name => !name.startsWith('.')) ? 'NextMux' : '');
  });
  ipcMain.handle('nextmux:data-location:move', async (event, target, locale) => {
    if (!trustedMainFrame(event)) return { ok: false, error: 'untrusted' };
    if (resolved.mode === 'portable' || resolved.mode === 'override') return { ok: false, error: resolved.mode };
    const from = current();
    const to = target === 'default' ? defaultDataRoot({ platform, env }) : target;
    const { bytes } = await measure(from);
    let freeBytes;
    try { const parent = fs.existsSync(to) ? to : path.dirname(to); const stat = fs.statfsSync(parent); freeBytes = stat.bavail * stat.bsize; } catch { /* checked again when copying */ }
    const reason = checkTarget(to, from, { freeBytes, neededBytes: bytes });
    if (reason && !(target === 'default' && reason === 'not_empty')) return { ok: false, error: reason };
    const pointer = readPointer(app.getPath('userData'));
    writePointer(app.getPath('userData'), { ...(typeof pointer.path === 'string' ? { path: pointer.path } : {}),
      pending: { from, to, locale: typeof locale === 'string' && Object.hasOwn(MOVE_TEXT, locale) ? locale : 'en', requestedAt: Date.now() } });
    // Restart through the normal quit (unsaved work is asked about); the move runs before the next start.
    setTimeout(() => { app.relaunch(); app.quit(); }, 300);
    return { ok: true, bytes };
  });
  ipcMain.handle('nextmux:data-location:reveal', event => {
    if (!trustedMainFrame(event)) return false;
    return shell.openPath(current()).then(error => !error, () => false);
  });
}

module.exports.MOVE_TEXT = MOVE_TEXT;
module.exports.UNAVAILABLE_TEXT = UNAVAILABLE_TEXT;
module.exports.chooseForUnavailableData = chooseForUnavailableData;
module.exports.moveProgressWindow = moveProgressWindow;
module.exports.registerDataLocation = registerDataLocation;
