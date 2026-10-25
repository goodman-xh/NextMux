import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Build-only: the macOS helper that hosts the AI's app windows on a virtual display so they show only in the
// conversation tab (apps/desktop/native/display/NextMuxDisplayHelper.m, used by computer-window-view.cjs),
// plus a universal (arm64 + x86_64) replacement for trash's legacy x86_64-only macos-trash binary so macOS
// Tahoe 26 never warns about an incompatible Intel-only component.
if (process.platform === 'darwin') {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error || new Error(`${command} exited ${result.status}`);
  };
  // An x64 Node under Rosetta would run the universal Xcode tools translated; use their native slice.
  const translated = process.arch === 'x64' && spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).stdout?.trim() === '1';
  const xcrun = args => translated ? run('/usr/bin/arch', ['-arm64', 'xcrun', ...args]) : run('xcrun', args);
  const directory = path.join(root, 'apps/desktop/native/display/macos');
  mkdirSync(directory, { recursive: true });
  const source = path.join(root, 'apps/desktop/native/display/NextMuxDisplayHelper.m');
  const outputs = ['arm64', 'x86_64'].map(arch => {
    const target = path.join(directory, `NextMuxDisplayHelper-${arch}`);
    xcrun(['clang', '-fobjc-arc', '-O2', '-Wall', '-Werror', '-Wno-unused-parameter', '-target', `${arch}-apple-macos12.0`,
      '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', '-framework', 'CoreAudio',
      // Frames for skill plugins (macOS 14+, weak so macOS 12–13 still start) and text recognition.
      '-weak_framework', 'ScreenCaptureKit', '-framework', 'Vision', '-framework', 'CoreVideo', source, '-o', target]);
    return target;
  });
  xcrun(['lipo', '-create', ...outputs, '-output', path.join(directory, 'NextMuxDisplayHelper')]);

  const trashDirectory = path.join(root, 'apps/desktop/native/trash/macos');
  mkdirSync(trashDirectory, { recursive: true });
  const trashSource = path.join(root, 'apps/desktop/native/trash/macos-trash.m');
  const trashOutputs = ['arm64', 'x86_64'].map(arch => {
    const target = path.join(trashDirectory, `macos-trash-${arch}`);
    xcrun(['clang', '-fobjc-arc', '-O2', '-Wall', '-Werror', '-target', `${arch}-apple-macos12.0`,
      '-framework', 'Foundation', trashSource, '-o', target]);
    return target;
  });
  const universalTrash = path.join(trashDirectory, 'macos-trash');
  xcrun(['lipo', '-create', ...trashOutputs, '-output', universalTrash]);
  chmodSync(universalTrash, 0o755);

  const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
  const trashPkg = desktopRequire.resolve('trash/package.json');
  const targets = [
    path.join(path.dirname(trashPkg), 'lib/macos-trash'),
    path.join(root, 'apps/desktop/lib/backend/macos-trash'),
  ];
  for (const target of targets) {
    if (existsSync(path.dirname(target))) {
      copyFileSync(universalTrash, target);
      chmodSync(target, 0o755);
    }
  }
  console.log('Built macOS arm64/x64 display and trash helpers.');
}

