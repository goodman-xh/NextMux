import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import assets from '../../../scripts/git-runtime-assets.cjs';
const require = createRequire(import.meta.url);

for (const target of Object.keys(assets.manifest.targets)) test(`build gate verifies ${target}, detects corruption and wrong architecture`, async t => {
  const [platform, architecture] = target.split('-'), info = assets.targetInfo(platform, architecture);
  const root = await mkdtemp(join(tmpdir(), 'nm-git-assets-')); t.after(() => rm(root, { recursive: true, force: true }));
  const header = Buffer.alloc(128);
  if (platform === 'darwin') { header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(architecture === 'arm64' ? 0x0100000c : 0x01000007, 4); }
  else { header.writeUInt16LE(0x5a4d); header.writeUInt32LE(64, 60); header.writeUInt32LE(0x4550, 64); header.writeUInt16LE(architecture === 'arm64' ? 0xaa64 : 0x8664, 68); }
  for (const file of new Set([info.binary, info.coreBinary, `${info.execPath}/${platform === 'win32' ? 'git.exe' : 'git'}`,
    info.uploadPack, 'share/git-core/templates/description', 'licenses/Git-GPL-2.0.txt', 'licenses/dugite-MIT.txt', 'SOURCE-PROVENANCE.json'])) {
    await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), file === info.binary || file === info.coreBinary ? header : 'fixture');
  }
  await writeFile(join(root, 'complete.json'), JSON.stringify({ schema: 1, release: assets.manifest.release, platform, architecture,
    archive: info.archive, archiveSha256: info.sha256, ...await assets.inventory(root) }));
  assert.equal((await assets.verifyGitRuntime(root, { platform, architecture })).target, target);
  await writeFile(join(root, 'licenses/dugite-MIT.txt'), 'corrupt');
  await assert.rejects(assets.verifyGitRuntime(root, { platform, architecture }), /integrity mismatch/);
  await assert.rejects(assets.verifyGitRuntime(root, { platform, architecture, packaged: true }), /integrity mismatch/);
  await assert.rejects(assets.inspectArchitecture(join(root, info.binary), platform, architecture === 'x64' ? 'arm64' : 'x64'), /architecture mismatch/);
});

test('prepared native core Git forks a repository when PATH contains no system Git', async t => {
  const resourcesPath = new URL('../build-resources/', import.meta.url).pathname;
  const target = `${process.platform}-${process.arch}`;
  if (!(target in assets.manifest.targets)) return t.skip('Host target has no supported bundle');
  try { await access(join(resourcesPath, 'git-runtime', target, 'complete.json')); }
  catch { if (process.env.CI) throw Error('Prepare the host Git bundle before release integration tests'); return t.skip('Run prepare-git-runtime.mjs to execute native bundle integration'); }
  await assets.verifyGitRuntime(join(resourcesPath, 'git-runtime', target), { platform: process.platform, architecture: process.arch });
  const { resolveForkGitRuntime } = require('../../../packages/agent-runtime/lib/git-runtime.js');
  const git = await resolveForkGitRuntime({ resourcesPath, packaged: true, environment: { PATH: '/nonexistent' } });
  const run = promisify(execFile);
  const base = await mkdtemp(join(tmpdir(), 'nm-bundled-git-')); t.after(() => rm(base, { recursive: true, force: true }));
  const source = join(base, 'source'), child = join(base, 'child');
  const invoke = args => run(git.binary, args, { env: git.env, windowsHide: true });
  await invoke(['init', source]); await writeFile(join(source, 'file.txt'), 'before');
  await invoke(['-C', source, 'add', '.']);
  await invoke(['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
  await invoke(['clone', '--no-local', '--no-checkout', source, child]);
  await invoke(['-C', child, 'reset', '--hard', 'HEAD']);
  assert.equal(await readFile(join(child, 'file.txt'), 'utf8'), 'before');
  assert.equal((await invoke(['--version'])).stdout.trim(), 'git version 2.53.0' + (process.platform === 'win32' ? '.windows.4' : ''));
});
