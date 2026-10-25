'use strict';
// An application's icon as a nativeImage. On macOS, Electron 42's app.getFileIcon crashes the whole app (a CHECK on a
// thread-pool worker) for .app bundles, so the icon is read from the bundle's .icns and converted by /usr/bin/sips in
// a separate process: a failure there costs the icon, never NextMux. Windows keeps app.getFileIcon.
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { mkdtemp, readFile, rm, access } = require('node:fs/promises');

const run = (command, args) => new Promise(resolve => {
  execFile(command, args, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
    const value = error ? '' : String(stdout).trim();
    resolve(value && value !== '(null)' ? value : '');
  });
});

/** The bundle's icon file (Contents/Resources/<CFBundleIconFile>.icns), or '' when it has none. */
async function bundleIconFile(bundle) {
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const names = [await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist]),
    await run('/usr/bin/plutil', ['-extract', 'CFBundleIconName', 'raw', '-o', '-', plist]), 'AppIcon'];
  for (const name of names) {
    if (!name || /[\\/]/.test(name)) continue;
    const file = path.join(bundle, 'Contents', 'Resources', name.endsWith('.icns') ? name : `${name}.icns`);
    try { await access(file); return file; } catch { /* try the next name */ }
  }
  return '';
}

// The icon Finder shows (NSWorkspace iconForFile), written as PNG by a separate osascript process. It covers what a
// bundle's .icns misses: iPad apps running on Mac (a Wrapper/ bundle without Contents/Resources) and apps whose icon
// lives only in an asset catalog.
const WORKSPACE_ICON_SCRIPT = `function run(argv) {
  ObjC.import('AppKit');
  const image = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(argv[1], true);
  return 'ok';
}`;

async function workspaceIcon({ nativeImage }, file, edge) {
  let dir;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'nextmux-icon-'));
    const out = path.join(dir, 'icon.png');
    if (await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WORKSPACE_ICON_SCRIPT, file, out]) !== 'ok') return nativeImage.createEmpty();
    const image = nativeImage.createFromBuffer(await readFile(out));
    return image.isEmpty() ? image : image.resize({ width: edge, height: edge, quality: 'best' });
  } catch {
    return nativeImage.createEmpty();
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The app's icon, `size` pixels square; an empty image when it can't be read. */
async function appIcon({ app, nativeImage }, file, size = 64) {
  const edge = Math.max(16, Math.min(512, Math.round(size)));
  if (process.platform !== 'darwin') {
    try { return (await app.getFileIcon(file, { size: 'large' })).resize({ width: edge, height: edge }); } catch { return nativeImage.createEmpty(); }
  }
  if (!/\.app\/?$/i.test(file)) return nativeImage.createEmpty();
  const icns = await bundleIconFile(file);
  if (!icns) return workspaceIcon({ nativeImage }, file, edge);
  let dir;
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'nextmux-icon-'));
    const out = path.join(dir, 'icon.png');
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(edge), icns, '--out', out]);
    const image = nativeImage.createFromBuffer(await readFile(out));
    if (!image.isEmpty()) return image.resize({ width: edge, height: edge, quality: 'best' });
  } catch {
    /* fall back to the Finder icon below */
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return workspaceIcon({ nativeImage }, file, edge);
}

module.exports = { appIcon, bundleIconFile };
