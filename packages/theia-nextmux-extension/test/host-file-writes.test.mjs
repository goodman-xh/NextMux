import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { NextMuxDiskFileSystemProvider } = require('../lib/node/nextmux-host-file-writes.js');
const { AgentToolRegistry, WorkspaceToolRuntime } = require('@nextmux/agent-runtime');
const URI = require('@theia/core/lib/common/uri').default;

// Editor saves, explorer renames and deletes reach disk through this provider.
// A command running meanwhile must not claim them (audit C35-01).
test('editor writes through the Theia disk provider are not claimed by a running agent command', { timeout: 20000 }, async t => {
    const unresolved = await mkdtemp(join(tmpdir(), 'nm-host-writes-'));
    const base = await realpath(unresolved);
    const workspace = join(base, 'workspace');
    await mkdir(join(workspace, 'folder'), { recursive: true });
    await writeFile(join(workspace, 'folder', 'a.txt'), 'a');
    await writeFile(join(workspace, 'draft.md'), 'v1');
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access' });
    t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
    const registry = new AgentToolRegistry();
    runtime.registerTools(registry);
    let call = 0;
    const execute = async (name, args) => {
        const result = await registry.execute({ id: `host-${++call}`, name, arguments: args }, 'full_access', { runId: 'host-writes' });
        assert.equal(result.ok, true, JSON.stringify(result.error));
        return result;
    };
    const provider = new NextMuxDiskFileSystemProvider();
    const uri = path => URI.fromFilePath(join(unresolved, 'workspace', path));
    const started = await execute('process.start', { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], tty: false });
    await provider.writeFile(uri('draft.md'), new TextEncoder().encode('v2 from the editor'), { create: true, overwrite: true, unlock: false, atomic: false });
    const fd = await provider.open(uri('streamed.md'), { create: true, unlock: false });
    await provider.write(fd, 0, new TextEncoder().encode('buffered save'), 0, 13);
    await provider.close(fd);
    await provider.rename(uri('folder'), uri('renamed'), { overwrite: false });
    const stopped = await execute('process.terminate', { processId: started.output.processId });
    assert.deepEqual(stopped.summary.changedPaths ?? [], []);
    const ids = runtime.getCreatedCheckpointIds();
    if (ids.length) await runtime.restoreCheckpointChain([...ids].reverse());
    assert.equal(await readFile(join(workspace, 'draft.md'), 'utf8'), 'v2 from the editor');
    assert.equal(await readFile(join(workspace, 'streamed.md'), 'utf8'), 'buffered save');
    assert.equal(await readFile(join(workspace, 'renamed', 'a.txt'), 'utf8'), 'a');
    await assert.rejects(access(join(workspace, 'folder')));
});
