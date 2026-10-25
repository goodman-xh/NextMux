#!/usr/bin/env node
import { mkdir, mkdtemp, cp, rm, rename, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assets from './git-runtime-assets.cjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const platform = process.env.NEXTMUX_TARGET_PLATFORM || process.platform;
const architecture = process.env.NEXTMUX_TARGET_ARCH || process.arch;
const targets = process.argv.includes('--all') ? Object.keys(assets.manifest.targets) : [`${platform}-${architecture}`];
const cache = process.env.NEXTMUX_GIT_DOWNLOAD_CACHE || join(root, '.cache/git-runtime');
await mkdir(cache, { recursive: true });
for (const target of targets) {
  const [platform, architecture] = target.split('-'), info = assets.targetInfo(platform, architecture);
  const destination = join(root, 'apps/desktop/build-resources/git-runtime', target);
  try { await assets.verifyGitRuntime(destination, { platform, architecture }); console.log(`Git ${target}: already verified`); continue; } catch { /* prepare or repair the build resource */ }
  const archive = join(cache, info.archive);
  if (await assets.hashFile(archive).catch(() => '') !== info.sha256) {
    const partial = `${archive}.partial-${process.pid}`;
    try {
      await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--proto', '=https', '--location', '--fail', '--silent', '--show-error',
        '--retry', '2', '--connect-timeout', '20', '--max-time', '300', '--output', partial, info.url]);
      if (await assets.hashFile(partial) !== info.sha256) throw Error(`Git archive checksum mismatch: ${target}`);
      await rename(partial, archive);
    } finally { await rm(partial, { force: true }); }
  }
  const temporary = await mkdtemp(join(tmpdir(), 'nextmux-git-'));
  try {
    const extracted = join(temporary, 'extracted'), prepared = join(temporary, 'prepared');
    await mkdir(extracted); await mkdir(prepared);
    const tar = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
    const { stdout } = await run(tar, ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 });
    if (stdout.split(/\r?\n/).some(name => name && (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..')))) throw Error('Unsafe Git archive entry');
    await run(tar, ['-xzf', archive, '-C', extracted]);
    if (platform === 'darwin') {
      // Only the core executable and upload-pack are needed for independent
      // local cloning. Exclude Git LFS, credential managers and their .NET runtime.
      await mkdir(join(prepared, 'bin')); await cp(join(extracted, 'bin/git'), join(prepared, 'bin/git'));
      await mkdir(join(prepared, 'libexec/git-core'), { recursive: true });
      for (const command of ['git', 'git-upload-pack', 'git-pack-objects', 'git-index-pack', 'git-unpack-objects']) {
        await symlink('../../bin/git', join(prepared, 'libexec/git-core', command));
      }
      await mkdir(join(prepared, 'share/git-core/templates'), { recursive: true });
      await cp(join(extracted, 'share/git-core/templates/description'), join(prepared, 'share/git-core/templates/description'));
    } else {
      // MinGit includes the DLLs and shell required by its native executable.
      // Preserve its upstream license files and all dependencies; only omit LFS.
      await cp(extracted, prepared, { recursive: true, dereference: false, verbatimSymlinks: true });
      await rm(join(prepared, info.execPath, 'git-lfs.exe'), { force: true });
    }
    await mkdir(join(prepared, 'licenses'), { recursive: true });
    await cp(join(root, 'docs/oss-intake/dugite-MIT.txt'), join(prepared, 'licenses/dugite-MIT.txt'));
    await cp(join(root, 'docs/oss-intake/git-GPL-2.0.txt'), join(prepared, 'licenses/Git-GPL-2.0.txt'));
    await writeFile(join(prepared, 'SOURCE-PROVENANCE.json'), JSON.stringify({ ...assets.manifest.sourceProvenance,
      upstreamManifest: assets.manifest.upstreamManifest, archive: info.url, archiveSha256: info.sha256,
      note: 'Provenance is not a source offer. Publish the complete corresponding-source archive alongside signed installers.' }, null, 2) + '\n');
    const inventory = await assets.inventory(prepared);
    await writeFile(join(prepared, 'complete.json'), JSON.stringify({ schema: 1, release: assets.manifest.release, platform, architecture,
      archive: info.archive, archiveSha256: info.sha256, ...inventory }, null, 2) + '\n');
    await assets.verifyGitRuntime(prepared, { platform, architecture });
    await mkdir(resolve(destination, '..'), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await cp(prepared, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
    console.log(JSON.stringify({ prepared: true, target, files: Object.keys(inventory.files).length, destination }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
