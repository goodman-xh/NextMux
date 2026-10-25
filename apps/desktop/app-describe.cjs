'use strict';
// 应用操控: what the composer needs to know about an app the user picked or dragged in — the name they see, the id
// tabs.open_app matches exactly (bundle id on macOS, program name on Windows) and its icon as a data URL.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { access } = require('node:fs/promises');
const { appIcon } = require('./app-icon.cjs');

// Asynchronous, so a slow Spotlight never freezes the window.
const read = (command, args) => new Promise(resolve => execFile(command, args, { encoding: 'utf8', timeout: 3000 }, (error, stdout) => {
  const value = error ? '' : String(stdout).trim();
  resolve(value && value !== '(null)' ? value : '');
}));

/** A macOS .app bundle (including an iPad app running on Mac). */
async function describeMacApplication({ app, nativeImage }, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.app\/?$/i.test(file)) return undefined;
  const bundle = file.replace(/\/+$/, '');
  try { await access(bundle); } catch { return undefined; }
  let name = path.basename(bundle).replace(/\.app$/i, '');
  // The name the user sees in Finder (计算器, not Calculator.app).
  name = (await read('/usr/bin/mdls', ['-raw', '-name', 'kMDItemDisplayName', bundle])).replace(/\.app$/i, '') || name;
  const id = await read('/usr/bin/mdls', ['-raw', '-name', 'kMDItemCFBundleIdentifier', bundle])
    || await read('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')]) || name;
  // Never app.getFileIcon on macOS: it crashes Electron 42 for .app bundles (see app-icon.cjs).
  const image = await appIcon({ app, nativeImage }, bundle, 64);
  return { name: name.slice(0, 80), id: id.slice(0, 160), path: bundle, icon: image.isEmpty() ? '' : image.toDataURL() };
}

/** Where the app with this bundle id is installed, or '' (Spotlight, then Launch Services). */
async function macApplicationPath(bundleId) {
  if (typeof bundleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(bundleId)) return '';
  const found = (await read('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`])).split('\n').find(line => /\.app$/i.test(line.trim()));
  if (found) return found.trim();
  return read('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
    `function run(argv){ObjC.import('AppKit');const url=$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(argv[0]);return url.isNil()?'':ObjC.unwrap(url.path)}`, bundleId]);
}

module.exports = { describeMacApplication, macApplicationPath };
