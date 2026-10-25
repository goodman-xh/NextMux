import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { access, mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentToolRegistry, WorkspaceToolRuntime, beginHostWorkspaceWrite } from '../lib/index.js';

// A running command's checkpoint is a whole-workspace diff. Writes by another
// window's tools or by the editor meanwhile are not the command's, and
// restoring the command must not revert or delete them (audit C35-01).
async function fixture(t: TestContext) {
  // tmpdir() is a symlink on macOS (/var → /private/var): the editor reports
  // the unresolved path and the runtime works on the real one.
  const unresolved = await mkdtemp(join(tmpdir(), 'nm-command-attribution-'));
  const base = await realpath(unresolved);
  const workspace = join(base, 'workspace');
  await mkdir(workspace);
  const runtimes: WorkspaceToolRuntime[] = [];
  t.after(async () => { await Promise.allSettled(runtimes.map(runtime => runtime.dispose())); await rm(base, { recursive: true, force: true }); });
  const open = async (runId: string) => {
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access' });
    runtimes.push(runtime);
    const registry = new AgentToolRegistry();
    runtime.registerTools(registry);
    let call = 0;
    const execute = async (name: string, args: Record<string, unknown>) => {
      const result = await registry.execute({ id: `${runId}-${++call}`, name, arguments: args }, 'full_access', { runId });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      return result as typeof result & { output: Record<string, unknown>; summary: { changedPaths?: string[] } };
    };
    return { runtime, execute };
  };
  return { workspace, editorWorkspace: join(unresolved, 'workspace'), open };
}

const idle = (script = '') => ({ command: process.execPath, args: ['-e', `${script}setInterval(() => {}, 1000)`], tty: false });
async function waitFor(path: string) {
  for (let i = 0; i < 200; i++) { try { await access(path); return; } catch { await new Promise(done => setTimeout(done, 25)); } }
  throw new Error(`timed out waiting for ${path}`);
}
async function restoreAll(runtime: WorkspaceToolRuntime) {
  const ids = runtime.getCreatedCheckpointIds();
  if (ids.length) await runtime.restoreCheckpointChain([...ids].reverse());
}

test('another window\'s tool edit during a command is not the command\'s', { timeout: 20000 }, async t => {
  const { workspace, open } = await fixture(t);
  const a = await open('window-a'), b = await open('window-b');
  const started = await a.execute('process.start', idle());
  await b.execute('workspace.write_file', { path: 'from-b.txt', content: 'keep me' });
  const stopped = await a.execute('process.terminate', { processId: started.output.processId });
  assert.deepEqual(stopped.summary.changedPaths ?? [], []);
  await restoreAll(a.runtime);
  assert.equal(await readFile(join(workspace, 'from-b.txt'), 'utf8'), 'keep me');
});

test('an editor save, create and folder delete during a command survive restoring it', { timeout: 20000 }, async t => {
  const { workspace, editorWorkspace, open } = await fixture(t);
  await mkdir(join(workspace, 'old'));
  await writeFile(join(workspace, 'old', 'notes.txt'), 'old notes');
  await writeFile(join(workspace, 'draft.txt'), 'v1');
  const a = await open('editor-run');
  const started = await a.execute('process.start', idle());
  const save = async (path: string, write: () => Promise<void>, tree = false) => {
    const end = await beginHostWorkspaceWrite([join(editorWorkspace, path)], { tree });
    try { await write(); } finally { await end(); }
  };
  await save('draft.txt', () => writeFile(join(workspace, 'draft.txt'), 'v2 saved in the editor'));
  await save('new.txt', () => writeFile(join(workspace, 'new.txt'), 'created in the editor'));
  await save('old', () => rm(join(workspace, 'old'), { recursive: true }), true);
  const stopped = await a.execute('process.terminate', { processId: started.output.processId });
  assert.deepEqual(stopped.summary.changedPaths ?? [], []);
  await restoreAll(a.runtime);
  assert.equal(await readFile(join(workspace, 'draft.txt'), 'utf8'), 'v2 saved in the editor');
  assert.equal(await readFile(join(workspace, 'new.txt'), 'utf8'), 'created in the editor');
  await assert.rejects(access(join(workspace, 'old', 'notes.txt')));
});

test('the command\'s own writes are still checkpointed, including a file the editor saved earlier', { timeout: 20000 }, async t => {
  const { workspace, editorWorkspace, open } = await fixture(t);
  await writeFile(join(workspace, 'shared.txt'), 'original');
  const a = await open('command-writes');
  const started = await a.execute('process.start', idle());
  const end = await beginHostWorkspaceWrite([join(editorWorkspace, 'shared.txt')]);
  await writeFile(join(workspace, 'shared.txt'), 'editor');
  await end();
  await a.execute('process.terminate', { processId: started.output.processId });
  // A second command then rewrites the same file and creates one.
  const command = await a.execute('process.start', idle(
    "require('fs').writeFileSync('shared.txt','command');require('fs').writeFileSync('built.txt','artifact');"));
  await waitFor(join(workspace, 'built.txt'));
  const stopped = await a.execute('process.terminate', { processId: command.output.processId });
  assert.deepEqual([...(stopped.summary.changedPaths ?? [])].sort(), ['built.txt', 'shared.txt']);
  await a.runtime.restoreCheckpointChain([...(stopped as unknown as { summary: { checkpointIds: string[] } }).summary.checkpointIds].reverse());
  assert.equal(await readFile(join(workspace, 'shared.txt'), 'utf8'), 'editor', 'restoring the command returns to the editor\'s save');
  await assert.rejects(access(join(workspace, 'built.txt')));
});

test('a file the editor removed while the command rewrote it stays the command\'s change', { timeout: 20000 }, async t => {
  const { workspace, editorWorkspace, open } = await fixture(t);
  await writeFile(join(workspace, 'log.txt'), 'start');
  const a = await open('conflict');
  const started = await a.execute('process.start', idle());
  const end = await beginHostWorkspaceWrite([join(editorWorkspace, 'log.txt')]);
  await unlink(join(workspace, 'log.txt'));
  await end();
  // The command writes the path after the editor removed it: different content, so it is claimed.
  await writeFile(join(workspace, 'log.txt'), 'command output');
  const stopped = await a.execute('process.terminate', { processId: started.output.processId });
  assert.deepEqual(stopped.summary.changedPaths ?? [], ['log.txt']);
});
