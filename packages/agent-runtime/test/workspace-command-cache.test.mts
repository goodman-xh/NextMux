import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentToolRegistry } from '../lib/registry.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';
import { MultiWorkspaceToolRuntime } from '../lib/multi-workspace-tools.js';

async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-command-cache-')));
  const root = join(base, 'root'), checkpoints = join(base, 'checkpoints'); await mkdir(root);
  await writeFile(join(root, 'file.txt'), 'initial');
  // This must use an immutable disk object instead of the small-file memory cache.
  await writeFile(join(root, 'large.bin'), Buffer.alloc(128 * 1024, 7));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, root, checkpoints };
}
async function snapshotDirectory(checkpoints: string) {
  const parent = join(checkpoints, '.pending-commands');
  const dirs = await readdir(parent); assert.equal(dirs.length, 1);
  return join(parent, dirs[0]);
}
function commands(runtime: WorkspaceToolRuntime | MultiWorkspaceToolRuntime) {
  const registry = new AgentToolRegistry(); runtime.registerTools(registry); let seq = 0;
  return (code: string) => registry.execute({ id: `cache-${++seq}`, name: 'process.run', arguments: {
    command: process.execPath, args: ['-e', code],
  } }, 'full_access', { runId: 'cache-run' });
}

test('successive real commands retain small and disk snapshot objects until runtime disposal', async t => {
  const f = await fixture(t); const runtime = await WorkspaceToolRuntime.create({ ...f, workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  t.after(() => runtime.dispose()); const command = commands(runtime);
  assert.equal((await command('console.log("first")')).ok, true);
  const directory = await snapshotDirectory(f.checkpoints);
  const first = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'));
  assert.equal(first.phase, 'idle');
  const objects = await Promise.all(first.files.map(async (file: any) => ({ name: `${file.sha256}.bin`, info: await stat(join(directory, `${file.sha256}.bin`)) })));
  const diskObjects = await readdir(join(directory, 'objects'));
  assert.equal(diskObjects.length, 1); const largeObject = join(directory, 'objects', diskObjects[0]); const diskBefore = await stat(largeObject);
  assert.equal((await command('console.log("second")')).ok, true);
  const second = JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'));
  assert.equal(second.phase, 'idle'); assert.notEqual(second.generation, first.generation);
  for (const object of objects) { const current = await stat(join(directory, object.name)); assert.equal(current.ino, object.info.ino); assert.equal(current.mtimeMs, object.info.mtimeMs); }
  assert.equal((await stat(largeObject)).ino, diskBefore.ino);
  assert.equal((await stat(largeObject)).mtimeMs, diskBefore.mtimeMs);
  assert.deepEqual(runtime.getCreatedCheckpointIds(), []);
  await runtime.dispose(); await assert.rejects(stat(directory), { code: 'ENOENT' });
});

test('warm cache still captures intervening changes and restores the true pre-command file', async t => {
  const f = await fixture(t); const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  t.after(() => runtime.dispose()); const command = commands(runtime);
  assert.equal((await command('console.log("warm")')).ok, true);
  await writeFile(join(f.root, 'file.txt'), 'external edit between commands');
  const result = await command('require("node:fs").writeFileSync("file.txt","AI edit")');
  assert.equal(result.ok, true); const ids = runtime.getCreatedCheckpointIds(); assert.equal(ids.length, 1);
  const diff = await runtime.getCheckpointDiff(ids[0], true);
  assert.equal(diff.beforeContent, 'external edit between commands'); assert.equal(diff.afterContent, 'AI edit');
  await runtime.restoreCheckpoint(ids[0]); assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'external edit between commands');
});

for (const phase of ['idle', 'active', 'legacy'] as const) test(`dead-owner ${phase} manifest distinguishes completed cache from interrupted commands`, async t => {
  const f = await fixture(t);
  const lib = join(import.meta.dirname, '../lib/workspace-tools.js'), registry = join(import.meta.dirname, '../lib/registry.js');
  const script = `const {WorkspaceToolRuntime}=require(${JSON.stringify(lib)}); const {AgentToolRegistry}=require(${JSON.stringify(registry)});const fs=require('node:fs/promises'),path=require('node:path');(async()=>{const runtime=await WorkspaceToolRuntime.create({workspaceRoot:${JSON.stringify(f.root)},checkpointRoot:${JSON.stringify(f.checkpoints)},permissionMode:'full_access'});
    if(${JSON.stringify(phase)}==='idle'){const r=new AgentToolRegistry();runtime.registerTools(r);const result=await r.execute({id:'noop',name:'process.run',arguments:{command:process.execPath,args:['-e','console.log("ok")']}},'full_access',{runId:'dead-owner'});if(!result.ok)throw Error(JSON.stringify(result.error));}
    else{await runtime.prepareObservedCommand('owned-external-command',{runId:'dead-owner'});await fs.writeFile(${JSON.stringify(join(f.root, 'file.txt'))},'unfinished AI edit');if(${JSON.stringify(phase)}==='legacy'){const parent=path.join(${JSON.stringify(f.checkpoints)},'.pending-commands');const dir=(await fs.readdir(parent))[0];const p=path.join(parent,dir,'snapshot.json'),m=JSON.parse(await fs.readFile(p,'utf8'));delete m.phase;await fs.writeFile(p,JSON.stringify(m));}}
    process.exit(0);})().catch(e=>{console.error(e);process.exit(2)});`;
  await promisify(execFile)(process.execPath, ['-e', script], { timeout: 10000 });
  if (phase === 'idle') await writeFile(join(f.root, 'file.txt'), 'later user edit');
  const recovered = await WorkspaceToolRuntime.create({ workspaceRoot: f.root, checkpointRoot: f.checkpoints, permissionMode: 'full_access' });
  t.after(() => recovered.dispose());
  assert.deepEqual(recovered.getCheckpointWarnings(), []);
  if (phase === 'idle') { assert.deepEqual(recovered.getCreatedCheckpointIds(), []); assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'later user edit'); assert.deepEqual(await readdir(join(f.checkpoints, '.pending-commands')), []); }
  else { assert.equal(recovered.getCreatedCheckpointIds().length, 1); await recovered.restoreCheckpoint(recovered.getCreatedCheckpointIds()[0]); assert.equal(await readFile(join(f.root, 'file.txt'), 'utf8'), 'initial'); }
});

test('multi-workspace external command observation keeps each warm cache and original checkpoint ownership', async t => {
  const f = await fixture(t); const other = join(f.base, 'other'); await mkdir(other); await writeFile(join(other, 'other.txt'), 'other-before');
  const runtime = await MultiWorkspaceToolRuntime.create({ permissionMode: 'full_access', primaryBindingId: 'a', bindings: [
    { id: 'a', path: f.root, permissionMode: 'full_access' }, { id: 'b', path: other, permissionMode: 'full_access' }],
    checkpointRootForWorkspace: root => root === f.root ? f.checkpoints : join(f.base, 'other-checkpoints') });
  t.after(() => runtime.dispose()); const command = commands(runtime);
  assert.equal((await command('console.log("warm all roots")')).ok, true);
  for (const store of [f.checkpoints, join(f.base, 'other-checkpoints')]) assert.equal(JSON.parse(await readFile(join(await snapshotDirectory(store), 'snapshot.json'), 'utf8')).phase, 'idle');
  const result = await command(`require('node:fs').writeFileSync(${JSON.stringify(join(other, 'other.txt'))},'other-AI')`);
  assert.equal(result.ok, true); const groups = runtime.getWorkspaceCheckpointGroups(); assert.deepEqual(groups.map(g => g.checkpointIds.length), [0, 1]);
  assert.equal((await runtime.getCheckpointDiff(groups[1].checkpointIds[0], true)).beforeContent, 'other-before');
});
