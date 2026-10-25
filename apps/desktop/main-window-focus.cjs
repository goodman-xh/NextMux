'use strict';

const detachedConversationWindowKey = Symbol.for('nextmux.conversation-window.detached.v1');
const showMainWindowKey = Symbol.for('nextmux.desktop.show-main.v1');
const primaryMainWindowKey = Symbol.for('nextmux.desktop.primary-main-window.v1');
const isQuittingKey = Symbol.for('nextmux.desktop.is-quitting.v1');
const ownedBrowserRegisteredKey = Symbol.for('nextmux.owned-browser.isRegistered.v1');

function isDetachedConversationWindow(window) {
  if (!window || typeof window.isDestroyed === 'function' && window.isDestroyed()) return false;
  if (window[detachedConversationWindowKey] === true) return true;
  try {
    const rawUrl = window.webContents?.getURL?.() || '';
    return Boolean(rawUrl && new URL(rawUrl).searchParams.has('nextmuxConversation'));
  } catch {
    return false;
  }
}

function isMainWorkbenchWindow(window, options = false) {
  const allowEmptyUrl = typeof options === 'boolean' ? options : Boolean(options?.allowEmptyUrl);
  if (!window || typeof window.isDestroyed === 'function' && window.isDestroyed()) return false;
  if (window[detachedConversationWindowKey] === true) return false;
  try {
    const contents = window.webContents;
    if (!contents || typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return false;
    const isOwnedBrowser = globalThis[ownedBrowserRegisteredKey];
    if (typeof isOwnedBrowser === 'function' && isOwnedBrowser(contents)) return false;
    const rawUrl = String(contents.getURL?.() || '');
    if (!rawUrl) return allowEmptyUrl;
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return false;
    if (!parsed.pathname.endsWith('/index.html')) return false;
    return !parsed.searchParams.has('nextmuxConversation');
  } catch {
    return false;
  }
}

function findMainWorkbenchWindow(BrowserWindow, options = false) {
  const allowEmptyUrl = typeof options === 'boolean' ? options : Boolean(options?.allowEmptyUrl);
  const candidates = Array.isArray(options?.candidates)
    ? options.candidates
    : typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : [];
  for (const candidate of candidates) {
    if (isMainWorkbenchWindow(candidate, false) && !candidate.webContents?.isLoading?.()) return candidate;
  }
  for (const candidate of candidates) {
    if (isMainWorkbenchWindow(candidate, false)) return candidate;
  }
  if (allowEmptyUrl) {
    for (const candidate of candidates) {
      if (isMainWorkbenchWindow(candidate, true)) return candidate;
    }
  }
  return undefined;
}

function focusMainWorkbenchWindow({ app, BrowserWindow, platform = process.platform } = {}) {
  if (typeof app?.[isQuittingKey] === 'function' && app[isQuittingKey]() === true) return undefined;
  if (typeof app?.[showMainWindowKey] === 'function' && app[showMainWindowKey]() === true) {
    if (platform === 'darwin') app?.focus?.({ steal: true });
    const primary = typeof app?.[primaryMainWindowKey] === 'function' ? app[primaryMainWindowKey]() : undefined;
    return primary && !primary.isDestroyed?.() ? primary : true;
  }
  const window = findMainWorkbenchWindow(BrowserWindow);
  if (!window) return undefined;
  if (window.isMinimized?.()) window.restore?.();
  window.show?.();
  window.focus?.();
  if (platform === 'darwin') app?.focus?.({ steal: true });
  return window;
}

module.exports = {
  detachedConversationWindowKey,
  findMainWorkbenchWindow,
  focusMainWorkbenchWindow,
  isDetachedConversationWindow,
  isMainWorkbenchWindow,
  isQuittingKey,
  primaryMainWindowKey,
  showMainWindowKey,
};
