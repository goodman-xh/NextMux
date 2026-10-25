'use strict';

// While the AI controls the computer, every display shows a glowing gradient frame and a
// small status pill — the way other desktop agents make it obvious that the AI is at work
// (Claude uses its orange, Codex tints its cursor from the wallpaper); ours is NextMux's
// magenta → violet.
// The windows never take focus or clicks and ask the system to keep them out of screen
// capture, so the AI's own screenshots stay clean. The driver's agent cursor (a second
// pointer labelled "NextMux", or "NextMux-N" for later conversations) is drawn by the driver and stays as it is.

// The frame (and the global Esc it holds) fades this soon after the AI's last action, so it never lingers once a turn
// has stopped acting; the next action brings it straight back.
const IDLE_HIDE_MS = 4_000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function overlayPage({ status, labels, pillTop, hint = '' }) {
  const label = labels.length ? ` · ${labels.map(escapeHtml).join(' · ')}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;-webkit-user-select:none;user-select:none}
@property --nm-angle{syntax:'<angle>';inherits:false;initial-value:0deg}
.frame{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 30px 8px rgba(209,74,121,.42),inset 0 0 110px 30px rgba(123,92,255,.18);animation:nm-breathe 2.8s ease-in-out infinite}
.frame::before,.frame::after{content:"";position:absolute;inset:0;background:conic-gradient(from var(--nm-angle),#d14a79,#ff7ab6,#8b5cf6,#5b3df5,#b86bff,#d14a79);animation:nm-spin 6s linear infinite}
.frame::before{padding:4px;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;filter:drop-shadow(0 0 8px rgba(209,74,121,.9))}
/* A soft band that fades inward from all four edges. */
.frame::after{opacity:.55;-webkit-mask:linear-gradient(to right,#000,transparent 44px,transparent calc(100% - 44px),#000),linear-gradient(to bottom,#000,transparent 44px,transparent calc(100% - 44px),#000);
mask:linear-gradient(to right,#000,transparent 44px,transparent calc(100% - 44px),#000),linear-gradient(to bottom,#000,transparent 44px,transparent calc(100% - 44px),#000);-webkit-mask-composite:source-over;mask-composite:add}
.pill{position:fixed;top:${Math.max(6, Math.round(pillTop))}px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:7px 15px 7px 11px;border-radius:999px;color:#fff;
background:rgba(20,16,32,.84);box-shadow:0 10px 28px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.14);font-size:12.5px;font-weight:600;white-space:nowrap;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.dot{width:8px;height:8px;border-radius:50%;background:#ff4f9a;animation:nm-pulse 1.4s ease-out infinite}
.brand{font-weight:800;background:linear-gradient(90deg,#ff8cc0,#c7a6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.hint{color:rgba(255,255,255,.62);font-weight:500}
@keyframes nm-spin{to{--nm-angle:360deg}}
@keyframes nm-breathe{50%{opacity:.72}}
@keyframes nm-pulse{0%{box-shadow:0 0 0 0 rgba(255,79,154,.7)}100%{box-shadow:0 0 0 10px rgba(255,79,154,0)}}
@media (prefers-reduced-motion:reduce){.frame,.frame::before,.frame::after,.dot{animation:none}}
</style></head><body><div class="frame"></div><div class="pill"><span class="dot"></span><span class="brand">NextMux</span><span>${escapeHtml(status)}${label}</span>${hint ? `<span class="hint">· ${escapeHtml(hint)}</span>` : ''}</div></body></html>`;
}

/**
 * @param {{ BrowserWindow: any, screen: () => any, app?: any, idleHideMs?: number, onActiveChange?: (active: boolean) => void }} options
 */
function createComputerOverlay({ BrowserWindow, screen, app, idleHideMs = IDLE_HIDE_MS, onActiveChange } = {}) {
  const windows = new Map();
  const active = new Map();
  let idleTimer;
  let shownKey = '';
  let displayListener;
  // The pill says how to stop: Esc stops the AI's control (registerComputerAutomation holds Esc while the frame shows).
  const messages = {
    'zh-CN': ['正在控制电脑', '按 Esc 退出控制'], 'zh-TW': ['正在控制電腦', '按 Esc 結束控制'],
    en: ['is using your computer', 'press Esc to stop'],
    ja: ['コンピューターを操作中', 'Esc キーで操作を終了'], ko: ['컴퓨터를 제어하는 중', 'Esc 키를 눌러 제어 종료'],
    es: ['está controlando tu equipo', 'pulsa Esc para detenerlo'], fr: ['contrôle votre ordinateur', 'appuyez sur Échap pour arrêter'],
    de: ['steuert deinen Computer', 'Esc drücken zum Beenden'], 'pt-BR': ['está controlando seu computador', 'pressione Esc para parar'],
    ru: ['управляет компьютером', 'нажмите Esc, чтобы остановить'], ar: ['يتحكم في جهازك', 'اضغط Esc للإيقاف'],
    hi: ['आपका कंप्यूटर नियंत्रित कर रहा है', 'रोकने के लिए Esc दबाएँ']
  };
  const locale = () => {
    const value = String(app?.[Symbol.for('nextmux.desktop.app-locale.v1')] || app?.getPreferredSystemLanguages?.()?.[0] || app?.getLocale?.() || 'en');
    if (/^zh/i.test(value)) return /hant|tw|hk|mo/i.test(value) ? 'zh-TW' : 'zh-CN';
    return /^pt/i.test(value) ? 'pt-BR' : value.split(/[-_]/)[0].toLowerCase();
  };
  const status = () => (messages[locale()] || messages.en)[0];
  const hint = () => (messages[locale()] || messages.en)[1];

  const hideAll = () => {
    for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
    windows.clear();
    shownKey = '';
    if (displayListener) {
      try { const displays = screen(); displays.removeListener('display-added', displayListener); displays.removeListener('display-removed', displayListener); displays.removeListener('display-metrics-changed', displayListener); } catch { /* app quitting */ }
      displayListener = undefined;
    }
  };

  const showAll = () => {
    if (!BrowserWindow || !screen) return;
    let displays;
    try { displays = screen().getAllDisplays(); } catch { return; }
    // The pill names no session: the driver's "NextMux-N" session names only keep conversations apart.
    const labels = [];
    const key = JSON.stringify([locale(), labels, displays.map(display => [display.id, display.bounds, display.workArea])]);
    if (key === shownKey) return;
    shownKey = key;
    const seen = new Set();
    for (const display of displays) {
      seen.add(display.id);
      let window = windows.get(display.id);
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({
          ...display.bounds, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
          hasShadow: false, alwaysOnTop: true, show: false, enableLargerThanScreen: true, fullscreenable: false, backgroundColor: '#00000000',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
        });
        window.setIgnoreMouseEvents(true);
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
        // Keep the frame out of screenshots and recordings where the system allows it.
        window.setContentProtection?.(true);
        windows.set(display.id, window);
      } else {
        window.setBounds(display.bounds);
      }
      const pillTop = display.workArea.y - display.bounds.y + 10;
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayPage({ status: status(), labels, pillTop, hint: hint() }))}`)
        .then(() => { if (!window.isDestroyed() && active.size) window.showInactive(); }, () => undefined);
    }
    for (const [id, window] of windows) if (!seen.has(id)) { if (!window.isDestroyed()) window.destroy(); windows.delete(id); }
    if (!displayListener) {
      displayListener = () => { shownKey = ''; if (active.size) showAll(); };
      try { const displays = screen(); displays.on('display-added', displayListener); displays.on('display-removed', displayListener); displays.on('display-metrics-changed', displayListener); } catch { /* not ready */ }
    }
  };

  let reported = false;
  const sync = () => {
    if (active.size) showAll(); else hideAll();
    if (reported !== active.size > 0) { reported = active.size > 0; try { onActiveChange?.(reported); } catch { /* the listener is optional */ } }
  };
  app?.on?.('nextmux-locale-changed', sync);

  return {
    /** The AI acted for this conversation: show (or keep) the frame; it fades after a quiet spell. */
    activity(conversationId, label) {
      active.set(conversationId, label || '');
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleTimer = undefined; active.clear(); sync(); }, idleHideMs);
      idleTimer.unref?.();
      sync();
    },
    /** The conversation's control session ended. */
    end(conversationId) {
      active.delete(conversationId);
      if (!active.size && idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
      sync();
    },
    active: () => active.size > 0,
    conversations: () => [...active.keys()],
    dispose() {
      app?.removeListener?.('nextmux-locale-changed', sync);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      active.clear();
      sync();
    }
  };
}

module.exports = { createComputerOverlay, overlayPage, IDLE_HIDE_MS };
