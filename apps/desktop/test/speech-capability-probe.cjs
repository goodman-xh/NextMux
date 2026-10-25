'use strict';

// Read-only Electron capability probe: no recognition start, microphone access,
// language-pack installation, application profile or external requests.
const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const unsafeAvailabilityProbe = process.argv.includes('--unsafe-check-on-device');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'nextmux-speech-capability-')));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(?:data|file):/.test(details.url) });
  });
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const timeout = setTimeout(() => app.exit(2), 8000);
  window.webContents.on('render-process-gone', (_event, details) => {
    console.log(JSON.stringify({ electron: process.versions.electron, platform: process.platform, arch: process.arch, rendererExit: details.reason }));
    clearTimeout(timeout); app.exit(3);
  });
  try {
    await window.loadURL('data:text/html,<meta charset="utf-8"><title>Speech capability probe</title>');
    const result = await window.webContents.executeJavaScript(`(async () => {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) return { recognition: false };
      const recognition = new Recognition();
      const result = { recognition: true, processLocally: 'processLocally' in recognition,
        available: typeof Recognition.available, install: typeof Recognition.install };
      if (${unsafeAvailabilityProbe} && result.processLocally && typeof Recognition.available === 'function') {
        for (const lang of ['zh-CN', 'en-US']) {
          try { result[lang] = await Promise.race([Recognition.available({ langs: [lang], processLocally: true }),
            new Promise(resolve => setTimeout(() => resolve('timed-out'), 2000))]); }
          catch (error) { result[lang] = error.name; }
        }
      }
      return result;
    })()`);
    console.log(JSON.stringify({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, ...result }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { clearTimeout(timeout); if (!window.isDestroyed()) window.destroy(); app.quit(); }
});
