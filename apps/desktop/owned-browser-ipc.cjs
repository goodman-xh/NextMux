'use strict';

// Separate namespace: legacy nextmux:browser:release is a debugger lease release,
// whereas owned-browser:release explicitly moves the page back to its hidden host.
const methods = Object.freeze(['create', 'state', 'preview', 'action', 'cancel', 'navigate', 'takeover', 'release', 'resize', 'close']);
const prefix = 'nextmux:owned-browser:';
function registerOwnedBrowserIpc({ ipcMain, registry }) {
  for (const method of methods) ipcMain.handle(prefix + method, async (event, ...args) => {
    // Never accept an event/frame/WebContents from renderer JSON. The registry
    // verifies the original Electron event at every invocation.
    try {
      if (args.length > 2) throw Object.assign(Error('The browser request is invalid.'), { code: 'BROWSER_REQUEST_INVALID' });
      return await registry[method](event, ...args);
    } catch (cause) {
      // Electron serializes Error.message, not arbitrary Error.code fields.
      // Use a restricted machine-readable prefix without returning a stack.
      const code = /^BROWSER_[A-Z_]{1,64}$/.test(cause?.code || '') ? cause.code : 'BROWSER_TOOL_FAILED';
      const message = String(cause?.message || 'The browser operation failed.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400);
      throw Error(`[${code}] ${message}`);
    }
  });
  return () => { for (const method of methods) ipcMain.removeHandler(prefix + method); };
}
function createOwnedBrowserPreload(ipcRenderer) {
  const invoke = method => (...args) => ipcRenderer.invoke(prefix + method, ...args);
  return Object.freeze(Object.fromEntries(methods.map(method => [method, invoke(method)])));
}
module.exports = { registerOwnedBrowserIpc, createOwnedBrowserPreload };
