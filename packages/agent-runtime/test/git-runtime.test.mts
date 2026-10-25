import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveForkGitRuntime } from '../lib/git-runtime.js';

test('development uses system Git, packaged application refuses a missing bundle', async () => {
  const runtime = await resolveForkGitRuntime({ environment: { PATH: '/system/bin', GIT_DIR: '/wrong', git_work_tree: '/wrong' }, packaged: false });
  assert.equal(runtime.bundled, false); assert.equal(runtime.env.GIT_DIR, undefined); assert.equal(runtime.env.git_work_tree, undefined);
  assert.equal(runtime.env.GIT_CONFIG_NOSYSTEM, '1');
  await assert.rejects(resolveForkGitRuntime({ packaged: true, environment: {} }), { code: 'GIT_RUNTIME_MISSING' });
});

for (const platform of ['darwin', 'win32'] as const) for (const architecture of ['x64', 'arm64']) {
  test(`bundled Git selects ${platform}-${architecture} and isolates its execution environment`, async t => {
    const resources = await mkdtemp(join(tmpdir(), 'nm-git-runtime-'));
    t.after(() => rm(resources, { recursive: true, force: true }));
    const root = join(resources, 'git-runtime', `${platform}-${architecture}`);
    const sub = architecture === 'arm64' ? 'clangarm64' : 'mingw64';
    const bin = join(root, platform === 'win32' ? 'cmd' : 'bin');
    const core = platform === 'win32' ? join(root, sub, 'libexec/git-core') : join(root, 'libexec/git-core');
    await mkdir(bin, { recursive: true }); await mkdir(core, { recursive: true });
    await writeFile(join(bin, platform === 'win32' ? 'git.exe' : 'git'), '', { mode: 0o755 });
    await writeFile(join(root, 'complete.json'), JSON.stringify({ schema: 1, release: 'v2.53.0-4', platform, architecture }));
    const result = await resolveForkGitRuntime({ resourcesPath: resources, packaged: true, platform, architecture,
      environment: { Path: 'original', GIT_EXEC_PATH: '/evil', GIT_INDEX_FILE: '/evil' } });
    assert.equal(result.bundled, true); assert.equal(result.env.GIT_EXEC_PATH, core); assert.equal(result.env.GIT_INDEX_FILE, undefined);
    if (platform === 'win32') { assert.equal(result.env.Path, undefined); assert.ok(result.env.PATH?.startsWith(join(root, sub, 'bin'))); }
    else assert.equal(result.env.GIT_TEMPLATE_DIR, join(root, 'share/git-core/templates'));
    await writeFile(join(root, 'complete.json'), JSON.stringify({ schema: 1, release: 'v2.53.0-4', platform, architecture: 'wrong' }));
    await assert.rejects(resolveForkGitRuntime({ resourcesPath: resources, packaged: true, platform, architecture }), { code: 'GIT_RUNTIME_MISSING' });
  });
}

test('an installed executable redirected outside the bundle is refused', async t => {
  const resources = await mkdtemp(join(tmpdir(), 'nm-git-runtime-'));
  t.after(() => rm(resources, { recursive: true, force: true }));
  const root = join(resources, 'git-runtime/darwin-arm64');
  await mkdir(join(root, 'bin'), { recursive: true }); await mkdir(join(root, 'libexec/git-core'), { recursive: true });
  await writeFile(join(root, 'complete.json'), JSON.stringify({ schema: 1, release: 'v2.53.0-4', platform: 'darwin', architecture: 'arm64' }));
  const outside = join(resources, 'other'); await writeFile(outside, '', { mode: 0o755 });
  await symlink(outside, join(root, 'bin/git'));
  await assert.rejects(resolveForkGitRuntime({ resourcesPath: resources, packaged: true, platform: 'darwin', architecture: 'arm64' }), { code: 'GIT_RUNTIME_MISSING' });
});
