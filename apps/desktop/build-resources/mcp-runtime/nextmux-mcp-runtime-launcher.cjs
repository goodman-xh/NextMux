'use strict';

// This tiny launcher is shipped with the app. The actual MCP payloads are
// architecture-specific release inputs under mcp-runtime/runtimes/<id>/.
// stdout remains reserved for MCP JSON-RPC.
//
// Playwright needs a Chromium-family browser. Installers no longer carry their
// own ~400 MB Chromium: the launcher uses one that is shipped (development and
// qualification builds), else the Chrome / Edge / Brave / Chromium already on
// the computer, else — only then, once — Playwright's own installer puts its
// pinned Chromium into NextMux's data folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function dataRoot() {
  if (process.env.NEXTMUX_DESKTOP_STATE_DIR) return path.resolve(process.env.NEXTMUX_DESKTOP_STATE_DIR);
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'NextMux');
}

function installedBrowser() {
  const home = os.homedir();
  // NEXTMUX_MCP_SYSTEM_BROWSERS replaces the standard locations (tests, managed machines).
  const candidates = process.env.NEXTMUX_MCP_SYSTEM_BROWSERS !== undefined
    ? process.env.NEXTMUX_MCP_SYSTEM_BROWSERS.split(path.delimiter).filter(Boolean)
    : process.platform === 'darwin' ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ] : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } });
}

const root = process.env.NEXTMUX_MCP_RUNTIME_ROOT || __dirname;
const presetIndex = process.argv.indexOf('--preset');
const preset = process.env.NEXTMUX_MCP_PRESET || (presetIndex >= 0 ? process.argv[presetIndex + 1] : undefined);
const payloadArgs = presetIndex >= 0 ? process.argv.slice(presetIndex + 2) : [];
const manifestPath = path.join(root, 'manifest.json');
function fail(message) {
  process.stderr.write(`[NextMux MCP] ${message}\n`);
  process.exitCode = 78;
}
if (!preset) fail('MCP preset is missing.');
else {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest?.runtimes?.[preset]?.entry;
    if (typeof entry !== 'string' || !entry) throw new Error('preset is not declared');
    const payload = path.resolve(root, entry);
    if (!payload.startsWith(`${root}${path.sep}`) || !fs.existsSync(payload)) throw new Error('payload is not shipped');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (preset === 'playwright') {
      // An explicitly selected Chrome/Edge/CDP/extension/config remains untouched;
      // otherwise pick a browser as described at the top of this file.
      const browserOptions = ['--browser', '--executable-path', '--cdp-endpoint', '--endpoint', '--extension', '--config'];
      const hasBrowserOption = payloadArgs.some(arg => browserOptions.some(option => arg === option || arg.startsWith(`${option}=`)))
        || ['PLAYWRIGHT_MCP_BROWSER', 'PLAYWRIGHT_MCP_EXECUTABLE_PATH', 'PLAYWRIGHT_MCP_CDP_ENDPOINT', 'PLAYWRIGHT_MCP_ENDPOINT',
          'PLAYWRIGHT_MCP_EXTENSION', 'PLAYWRIGHT_MCP_CONFIG'].some(name => env[name]);
      if (!hasBrowserOption) {
        const packageRoot = path.join(root, 'runtimes', 'playwright', 'package', 'node_modules');
        const locate = browsers => {
          process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
          const playwright = path.join(packageRoot, 'playwright-core');
          delete require.cache[require.resolve(playwright)];
          const executable = require(playwright).chromium.executablePath();
          return fs.existsSync(executable) ? executable : undefined;
        };
        const shipped = locate(path.join(root, 'runtimes', 'playwright', 'browsers'));
        if (shipped) {
          env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
          env.PLAYWRIGHT_MCP_EXECUTABLE_PATH = shipped;
        } else {
          const system = installedBrowser();
          if (system) env.PLAYWRIGHT_MCP_EXECUTABLE_PATH = system;
          else {
            const cache = path.join(dataRoot(), 'mcp-browsers');
            let downloaded = locate(cache);
            if (!downloaded) {
              process.stderr.write('[NextMux MCP] No Chrome or Edge found; downloading the Chromium build Playwright uses (once)…\n');
              // The installer's own output must not reach stdout (MCP JSON-RPC).
              const install = spawnSync(process.execPath, [path.join(packageRoot, 'playwright-core', 'cli.js'), 'install', 'chromium', '--no-shell'], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: cache }, stdio: ['ignore', 2, 2], timeout: 15 * 60_000,
              });
              downloaded = install.status === 0 ? locate(cache) : undefined;
            }
            if (!downloaded) throw new Error('no Chromium-family browser is available: install Google Chrome or Microsoft Edge, or choose one with --browser / --executable-path');
            env.PLAYWRIGHT_BROWSERS_PATH = cache;
            env.PLAYWRIGHT_MCP_EXECUTABLE_PATH = downloaded;
          }
        }
      }
    }
    // Packaged Win11 ARM64 uses one declared CFT x64 browser sidecar; explicit user connections stay intact.
    if (process.platform === 'win32' && preset === 'chrome-devtools') {
      const explicit = ['--executablePath', '--executable-path', '--browserUrl', '--browser-url', '--wsEndpoint', '--ws-endpoint',
        '--channel', '--autoConnect', '--auto-connect', '--cdp-endpoint', '-e', '-u', '-w'];
      const hasConnection = payloadArgs.some(arg => explicit.some(flag => arg === flag || arg.startsWith(`${flag}=`)
        || (flag.length === 2 && arg.startsWith(flag) && arg.length > 2)));
      if (!hasConnection) {
        const browser = path.resolve(root, '..', 'browser-runtime', 'chrome-win64', 'chrome.exe');
        if (!fs.existsSync(browser) || !fs.statSync(browser).isFile()) throw new Error('packaged Chrome for Testing sidecar is unavailable');
        payloadArgs.unshift('--executablePath', browser);
      }
    }
    const child = spawn(process.execPath, [payload, ...payloadArgs], {
      stdio: 'inherit',
      env,
    });
    child.once('error', error => { process.stderr.write(`[NextMux MCP] ${error.message}\n`); process.exitCode = 78; });
    child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
  } catch (error) { fail(error instanceof Error ? error.message : 'payload unavailable'); }
}
