'use strict';

// A conversation tab dragged out of the tab strip, the way a browser tab is: it leaves the strip and becomes a window
// of its own, with its own one-tab strip and the same live app window and switches (computer-window-view.cjs).
// Dragging that tab back onto the conversation's strip merges it again; closing the window (or its tab) closes the
// tab, as a browser does. The page can only reach its own tab's window; it gets no other NextMux bridge.

const { join } = require('node:path');

const identifier = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const MAX_WINDOWS = 8;

/**
 * @param {{ ipcMain: any, BrowserWindow: any, screen: () => any, view: any, trusted: (event: any) => boolean,
 *   pointer: (conversationId: string, owner: number, pid: number, windowId: number, input: any) => Promise<any>,
 *   keys?: Function, ownsConversation?: (event: any, conversationId: string) => boolean }} options
 */
function registerComputerTabWindows({ ipcMain, BrowserWindow, screen, view, trusted, pointer, keys, ownsConversation = () => true }) {
  const entries = new Map();
  const keyOf = (conversationId, tabId) => `${conversationId}\n${tabId}`;
  const parentOwns = entry => !entry.parent.isDestroyed() && ownsConversation({ sender: entry.parent, senderFrame: entry.parent.mainFrame }, entry.conversationId);
  const own = event => [...entries.values()].find(entry => !entry.window.isDestroyed() && entry.window.webContents === event.sender
    && event.senderFrame === event.sender.mainFrame && parentOwns(entry));
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

  ipcMain.handle('nextmux:computer:tab-window:open', (event, request) => {
    if (!trusted(event) || !request || typeof request !== 'object') return false;
    const { conversationId, tabId } = request;
    const pid = Number(request.pid), windowId = Number(request.windowId);
    if (!identifier(conversationId) || !ownsConversation(event, conversationId) || typeof tabId !== 'string' || !tabId || tabId.length > 200 || !view.canView(conversationId, pid, windowId)) return false;
    const key = keyOf(conversationId, tabId);
    const existing = entries.get(key);
    // The workbench asking now becomes the tab's owner: close and input events go to a window that is still there,
    // not to the one that first opened the tab (audit B19-06).
    if (existing && !existing.window.isDestroyed()) {
      if (existing.pid !== pid || existing.windowId !== windowId) return false;
      existing.parent = event.sender; existing.window.show(); existing.window.focus(); return true;
    }
    if (entries.size >= MAX_WINDOWS) return false;
    const labels = request.labels && typeof request.labels === 'object' ? Object.fromEntries(Object.entries(request.labels)
      .filter(([name, value]) => /^[a-zA-Z]{1,24}$/.test(name) && typeof value === 'string').slice(0, 32).map(([name, value]) => [name, value.slice(0, 200)])) : {};
    const title = text(request.title, 120) || 'NextMux';
    // Open where the tab was dropped, kept on that display.
    let bounds = { width: 960, height: 680 };
    try {
      const point = { x: Math.round(Number(request.point?.x) || 0), y: Math.round(Number(request.point?.y) || 0) };
      const area = screen().getDisplayNearestPoint(point).workArea;
      // Scaled to the display's work area, within the window's own minimum (audit A07-07).
      const width = Math.max(Math.min(420, area.width), Math.min(bounds.width, Math.round(area.width * 0.9)));
      const height = Math.max(Math.min(300, area.height), Math.min(bounds.height, Math.round(area.height * 0.9)));
      bounds = { width, height, x: Math.max(area.x, Math.min(point.x - 160, area.x + area.width - width)), y: Math.max(area.y, Math.min(point.y - 20, area.y + area.height - height)) };
    } catch { /* centred by the system */ }
    // A tab bar in place of the title bar, as in a browser window.
    const window = new BrowserWindow({ ...bounds, minWidth: Math.min(420, bounds.width), minHeight: Math.min(300, bounds.height), title, show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } } : {}),
      backgroundColor: request.theme === 'light' ? '#f5f5f7' : '#1b1b1d',
      webPreferences: { preload: join(__dirname, 'computer-tab-window-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
    window.setMenuBarVisibility?.(false);
    // Not a document window: nothing to save, so it closes without the workbench's save handshake (updater.cjs).
    const coordinator = window[Symbol.for('nextmux.desktop.close-coordinator.v1')];
    if (coordinator) coordinator.managed = true;
    const entry = { window, conversationId, tabId, pid, windowId, parent: event.sender };
    entries.set(key, entry);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', navigation => navigation.preventDefault());
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
    window.on('page-title-updated', titleEvent => titleEvent.preventDefault());
    window.on('closed', () => {
      if (entries.get(key) === entry) entries.delete(key);
      // Quitting keeps the conversation's tabs as they are.
      if (!entry.preserveTab && parentOwns(entry)) entry.parent.send('nextmux:computer:tab-window:event', { type: 'closed', conversationId, tabId, merged: entry.merged === true });
    });
    void window.loadFile(join(__dirname, 'computer-tab-window.html'), {
      query: { title, platform: process.platform, theme: request.theme === 'light' ? 'light' : 'dark', dir: request.dir === 'rtl' ? 'rtl' : 'ltr', labels: JSON.stringify(labels),
        canPark: view.capability().park ? '1' : '0', canPoint: view.capability().pointer ? '1' : '0', canMute: view.capability().sound ? '1' : '0' }
    }).catch(() => { if (!window.isDestroyed()) window.destroy(); });
    return true;
  });
  // The tab dropped back onto the conversation's strip (merge), or closed from the app window.
  ipcMain.handle('nextmux:computer:tab-window:close', (event, conversationId, tabId, merge) => {
    if (!trusted(event) || !ownsConversation(event, conversationId)) return false;
    const entry = entries.get(keyOf(conversationId, tabId));
    if (!entry || entry.window.isDestroyed()) return false;
    entry.merged = merge === true;
    entry.window.close();
    return true;
  });
  ipcMain.handle('nextmux:computer:tab-window:focus', (event, conversationId, tabId) => {
    if (!trusted(event) || !ownsConversation(event, conversationId)) return false;
    const entry = entries.get(keyOf(conversationId, tabId));
    if (!entry || entry.window.isDestroyed()) return false;
    entry.window.show(); entry.window.focus();
    return true;
  });

  // The tab window itself: only its own tab.
  ipcMain.handle('nextmux:tab-window:start', event => {
    const entry = own(event);
    return entry ? view.arm(event.sender.id, entry.conversationId, entry.pid, entry.windowId) : { ok: false, error: 'window_not_viewable' };
  });
  ipcMain.handle('nextmux:tab-window:pointer', (event, input) => {
    const entry = own(event);
    return entry ? pointer(entry.conversationId, entry.parent.id, entry.pid, entry.windowId, input) : { ok: false, error: 'window_not_viewable' };
  });
  ipcMain.handle('nextmux:tab-window:sound', (event, on) => {
    const entry = own(event);
    return entry ? view.setSound(entry.conversationId, entry.pid, entry.windowId, on === true) : { ok: false, error: 'window_not_viewable' };
  });
  ipcMain.handle('nextmux:tab-window:user-input', (event, on) => {
    const entry = own(event);
    if (!entry) return { ok: false, error: 'window_not_viewable' };
    return typeof on === 'boolean' ? view.setUserInput(entry.conversationId, entry.pid, entry.windowId, on) : { ok: true, on: view.userInput(entry.pid, entry.windowId) };
  });
  ipcMain.handle('nextmux:tab-window:keys', (event, input) => {
    const entry = own(event);
    if (!entry || !keys) return { ok: false, error: 'window_not_viewable' };
    return keys(entry.conversationId, entry.parent.id, entry.pid, entry.windowId, { text: input?.text, key: input?.key, modifiers: input?.modifiers });
  });
  ipcMain.handle('nextmux:tab-window:place', (event, placement) => {
    const entry = own(event);
    return entry ? view.place(entry.conversationId, entry.pid, entry.windowId, placement, { activate: placement === 'desktop' }) : { ok: false, error: 'window_not_viewable' };
  });
  // The window's own tab closed: like closing a browser window's last tab.
  ipcMain.handle('nextmux:tab-window:close-tab', event => {
    const entry = own(event);
    if (entry && !entry.window.isDestroyed()) entry.window.close();
    return Boolean(entry);
  });
  // The drag that carries this tab back to the conversation's strip.
  ipcMain.handle('nextmux:tab-window:identity', event => {
    const entry = own(event);
    return entry ? { conversationId: entry.conversationId, tabId: entry.tabId } : undefined;
  });

  return {
    closeAll() {
      for (const entry of entries.values()) if (!entry.window.isDestroyed()) {
        // Scope suppression to the windows being cleaned up; a retry or a
        // later window must retain its normal close/merge notifications.
        entry.preserveTab = true;
        entry.window.destroy();
      }
      entries.clear();
    }
  };
}

module.exports = { registerComputerTabWindows };
