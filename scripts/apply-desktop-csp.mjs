#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = join(root, 'apps', 'desktop');
const require = createRequire(join(desktopRoot, 'package.json'));
const { strictContentSecurityPolicy } = require('./desktop-runtime-config.cjs');

// The pages Electron actually loads and packages are the copies in lib/frontend (Theia copies them there before
// bundling); src-gen is kept in step so a later copy cannot bring back a page without the policy.
const htmlFiles = [
  join(desktopRoot, 'lib', 'frontend', 'index.html'),
  join(desktopRoot, 'lib', 'frontend', 'secondary-window.html'),
  join(desktopRoot, 'src-gen', 'frontend', 'index.html'),
  join(desktopRoot, 'src-gen', 'frontend', 'secondary-window.html'),
];

export function applyContentSecurityPolicyToHtml(source, policy) {
  if (typeof source !== 'string' || !/<head(?:\s[^>]*)?>/i.test(source)) {
    throw new Error('Generated frontend has no <head>');
  }
  const withoutExistingPolicy = source.replace(
    /^[ \t]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\r?\n?/gim,
    ''
  );
  const escapedPolicy = policy.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const indentation = /^([ \t]*)<meta\s+charset=/im.exec(withoutExistingPolicy)?.[1] || '  ';
  const policyTag = `${indentation}<meta http-equiv="Content-Security-Policy" content="${escapedPolicy}">`;
  return withoutExistingPolicy.replace(/<head(?:\s[^>]*)?>/i, match => `${match}\n${policyTag}`);
}

export async function applyDesktopPagePolicy() {
  for (const pathname of htmlFiles) {
    const source = await readFile(pathname, 'utf8');
    let output;
    try {
      output = applyContentSecurityPolicyToHtml(source, strictContentSecurityPolicy);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}: ${pathname}`);
    }
    await writeFile(pathname, output, 'utf8');
    console.log(`Applied production CSP to ${pathname}`);
  }
}

export async function applyDesktopProductionPolicy() {
  await applyDesktopPagePolicy();

  const desktopPackage = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const targetPlatform = process.env.NEXTMUX_QUALIFICATION_PLATFORM || process.platform;
  const targetArchitecture = process.env.NEXTMUX_QUALIFICATION_ARCH || process.arch;
  const isWindowsArm64 = targetPlatform === 'win32' && targetArchitecture === 'arm64';
  const windowsArm64Ffmpeg = isWindowsArm64
    ? JSON.parse(await readFile(join(desktopRoot, 'native', 'ffmpeg', 'win32-arm64', 'PROVENANCE.json'), 'utf8'))
    : undefined;
  const nativeRuntimeManifest = {
    schemaVersion: 1,
    generatedBy: 'scripts/apply-desktop-csp.mjs',
    platform: targetPlatform,
    architecture: targetArchitecture,
    electron: desktopPackage.devDependencies.electron,
    nodePty: `node-pty@${desktopPackage.dependencies['node-pty']}`,
    parcelWatcher: desktopPackage.dependencies['@parcel/watcher'],
    ripgrep: desktopPackage.dependencies['@vscode/ripgrep'],
    ffmpeg: windowsArm64Ffmpeg ? {
      source: 'pinned-native-resource',
      executable: 'native/ffmpeg/ffmpeg.exe',
      licensePath: 'native/ffmpeg/LICENSE.txt',
      provenancePath: 'native/ffmpeg/PROVENANCE.json',
      ...windowsArm64Ffmpeg,
    } : {
      source: '@ffmpeg-installer/ffmpeg',
      packageVersion: desktopPackage.dependencies['@ffmpeg-installer/ffmpeg'],
    },
  };
  const manifestPath = join(desktopRoot, 'lib', 'native-runtime-manifest.json');
  await mkdir(join(desktopRoot, 'lib'), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(nativeRuntimeManifest, undefined, 2)}\n`, 'utf8');
  console.log(`Wrote native runtime provenance to ${manifestPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // --pages-only: development builds run under the same page policy as releases, without release manifests.
  if (process.argv.includes('--pages-only')) await applyDesktopPagePolicy();
  else await applyDesktopProductionPolicy();
}
