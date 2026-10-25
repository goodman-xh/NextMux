'use strict';

/**
 * Native "task finished" notifications (Notification Center on macOS, Action
 * Center toast on Windows). The renderer decides when a notification is due;
 * this module only validates, shows, and routes the click back to the window
 * that asked, so the user lands on the conversation that finished.
 */
const MAX_TITLE = 120;
const MAX_BODY = 240;

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
}

function registerSystemNotifications({ ipcMain, Notification, BrowserWindow, app, trustedMainFrame, platform = process.platform } = {}) {
  const trusted = event => trustedMainFrame(event) && !event.sender.isDestroyed();
  // Keep references so notifications are not garbage-collected before click.
  const live = new Set();
  if (platform === 'win32' && app?.setAppUserModelId) {
    // Match the installer shortcut and the bootstrap/updater identity; registering a different ID here
    // overrides the ready process's identity and can detach its toasts from the installed Windows app.
    try { app.setAppUserModelId('io.nextmux.desktop'); } catch { /* optional */ }
  }
  ipcMain.handle('nextmux:notify:supported', event => trusted(event) && Boolean(Notification?.isSupported?.()));
  ipcMain.handle('nextmux:notify:show', (event, request) => {
    if (!trusted(event) || !Notification?.isSupported?.() || !request || typeof request !== 'object') return false;
    const title = clean(request.title, MAX_TITLE);
    const body = clean(request.body, MAX_BODY);
    const target = clean(request.target, 200);
    if (!title) return false;
    const sender = event.sender;
    const notification = new Notification({ title, body, silent: Boolean(request.silent) });
    live.add(notification);
    const release = () => live.delete(notification);
    notification.on('click', () => {
      release();
      const window = BrowserWindow.fromWebContents(sender);
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
      if (!sender.isDestroyed()) sender.send('nextmux:notify:click', target);
    });
    notification.on('close', release);
    notification.on('failed', release);
    notification.show();
    setTimeout(release, 10 * 60_000).unref?.();
    return true;
  });
}

module.exports = { registerSystemNotifications, clean };
