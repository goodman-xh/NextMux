import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceToolRuntime } from '../lib/index.js';
import { SNAPSHOT_MAX_BYTES } from '../lib/workspace-snapshot.js';

const run = promisify(execFile);
const lib = resolve(import.meta.dirname, '../lib/index.js');
const transactions = resolve(import.meta.dirname, '../lib/checkpoint-transaction.js');
async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-restore-crash-')));
  for (const name of ['a', 'b']) { await mkdir(join(base, name)); await writeFile(join(base, name, 'file.txt'), `${name}0`); }
  t.after(async () => { await rm(base, { recursive: true, force: true }); }); return base;
}
async function crash(base: string, committed: boolean) {
  const code = `
    const { WorkspaceToolRuntime } = require(${JSON.stringify(lib)});
    const { runCheckpointRestoreTransactions } = require(${JSON.stringify(transactions)});
    const { createHash } = require('node:crypto');
    const { join } = require('node:path');
    (async () => {
      const base = ${JSON.stringify(base)};
      const groups = [];
      for (const name of ['a', 'b']) {
        const runtime = await WorkspaceToolRuntime.create({workspaceRoot:join(base,name),checkpointRoot:join(base,name+'-store'),permissionMode:'full_access'});
        const [id] = await runtime.applyReviewedChanges([{path:'file.txt',beforeSha256:createHash('sha256').update(name+'0').digest('hex'),content:Buffer.from(name+'1')}], {runId:'crash-'+name,callId:'crash-call-'+name});
        groups.push({runtime,id});
      }
      await runCheckpointRestoreTransactions(groups.map((group,index) => async () => {
        const prepared = await group.runtime.prepareCheckpointRestore([group.id], {recordVersions:true});
        return {...prepared,
          apply: async () => { if (!${committed} && index === 1) process.kill(process.pid,'SIGKILL'); return prepared.apply(); },
          finalize: async () => { if (${committed} && index === 1) throw new Error('simulated cleanup failure'); return prepared.finalize(); }
        };
      }));
      process.kill(process.pid,'SIGKILL');
    })().catch(error => {console.error(error);process.exit(3)});
  `;
  try { await run(process.execPath, ['-e', code], { timeout: 15_000 }); assert.fail('child should be killed'); }
  catch (error) { assert.equal((error as { signal?: string }).signal, 'SIGKILL', String(error)); }
}

test('reopening one root compensates all roots after a process is killed between writes', async t => {
  const base = await fixture(t); await crash(base, false);
  assert.equal(await readFile(join(base, 'a/file.txt'), 'utf8'), 'a0');
  assert.equal(await readFile(join(base, 'b/file.txt'), 'utf8'), 'b1');
  const runtime = await WorkspaceToolRuntime.create({workspaceRoot:join(base,'a'),checkpointRoot:join(base,'a-store'),permissionMode:'full_access'});
  assert.equal((await runtime.listFileVersions({path:'file.txt'})).versions.some(item => item.operation === 'message_restore'), false);
  await runtime.dispose();
  assert.equal(await readFile(join(base, 'a/file.txt'), 'utf8'), 'a1');
  assert.equal(await readFile(join(base, 'b/file.txt'), 'utf8'), 'b1');
  for (const name of ['a','b']) assert.equal((await readdir(join(base,name+'-store'))).some(file => file.startsWith('.restore-')), false);
});

test('a committed group with interrupted cleanup stays restored when reopened', async t => {
  const base = await fixture(t); await crash(base, true);
  const runtime = await WorkspaceToolRuntime.create({workspaceRoot:join(base,'b'),checkpointRoot:join(base,'b-store'),permissionMode:'full_access'});
  assert.equal((await runtime.listFileVersions({path:'file.txt'})).versions.filter(item => item.operation === 'message_restore').length, 1);
  await runtime.dispose();
  assert.equal(await readFile(join(base,'a/file.txt'),'utf8'),'a0');
  assert.equal(await readFile(join(base,'b/file.txt'),'utf8'),'b0');
  for (const name of ['a','b']) assert.equal((await readdir(join(base,name+'-store'))).some(file => file.startsWith('.restore-')), false);
});

test('a manual edit after a crash is preserved and compensation evidence remains', async t => {
  const base = await fixture(t); await crash(base, false);
  await writeFile(join(base,'a/file.txt'),'manual edit');
  await assert.rejects(WorkspaceToolRuntime.create({workspaceRoot:join(base,'a'),checkpointRoot:join(base,'a-store'),permissionMode:'full_access'}), {code:'ROLLBACK_CONFLICT'});
  assert.equal(await readFile(join(base,'a/file.txt'),'utf8'),'manual edit');
  assert.equal(await readFile(join(base,'b/file.txt'),'utf8'),'b1');
  assert.equal((await readdir(join(base,'a-store'))).some(file => file.startsWith('.restore-')), true);
});

test('recovery rejects a forged oversized journal before touching live files', async t => {
  const base = await fixture(t); await crash(base, false);
  const store = join(base, 'a-store');
  const restoreDirectory = (await readdir(store)).find(name => name.startsWith('.restore-'))!;
  const recoveryPath = join(store, restoreDirectory, 'recovery.json');
  const recovery = JSON.parse(await readFile(recoveryPath, 'utf8'));
  recovery.files[0].size = SNAPSHOT_MAX_BYTES + 1;
  await writeFile(recoveryPath, JSON.stringify(recovery));
  await assert.rejects(
    WorkspaceToolRuntime.create({ workspaceRoot: join(base, 'a'), checkpointRoot: store, permissionMode: 'full_access' }),
    { code: 'INVALID_CHECKPOINT' },
  );
  assert.equal(await readFile(join(base, 'a/file.txt'), 'utf8'), 'a0');
});

test('a committed timeline restore interrupted before history publication recovers the same version once', async t => {
  const base = await fixture(t);
  const code = `
    const fs = require('node:fs/promises');
    const { WorkspaceToolRuntime } = require(${JSON.stringify(lib)});
    const { createHash } = require('node:crypto');
    const { join } = require('node:path');
    (async () => {
      const base = ${JSON.stringify(base)};
      const runtime = await WorkspaceToolRuntime.create({workspaceRoot:join(base,'a'),checkpointRoot:join(base,'a-store'),permissionMode:'full_access'});
      const [id] = await runtime.applyReviewedChanges([{path:'file.txt',beforeSha256:createHash('sha256').update('a0').digest('hex'),content:Buffer.from('a1')}], {runId:'crash-timeline',callId:'setup'});
      const rename = fs.rename;
      fs.rename = async (...args) => {
        await rename(...args);
        if (String(args[1]).includes('.restore-group-') && String(args[1]).endsWith('.json')) {
          const journal = JSON.parse(await fs.readFile(args[1],'utf8'));
          if (journal.phase === 'committed') process.kill(process.pid,'SIGKILL');
        }
      };
      await runtime.restoreFileVersion({checkpointId:id,side:'before',expectedSha256:createHash('sha256').update('a1').digest('hex'),conversationId:'10000000-0000-0000-0000-000000000001'});
      process.exit(9);
    })().catch(error => {console.error(error);process.exit(3)});
  `;
  try { await run(process.execPath, ['-e', code], { timeout: 15_000 }); assert.fail('child should be killed'); }
  catch (error) { assert.equal((error as { signal?: string }).signal, 'SIGKILL', String(error)); }
  assert.equal(await readFile(join(base,'a/file.txt'),'utf8'),'a0');
  const runtime = await WorkspaceToolRuntime.create({workspaceRoot:join(base,'a'),checkpointRoot:join(base,'a-store'),permissionMode:'full_access'});
  const versions = await runtime.listFileVersions({path:'file.txt'});
  assert.equal(versions.versions.filter(item => item.operation === 'timeline_restore').length,1);
  assert.equal((await readdir(join(base,'a-store'))).some(name => name.startsWith('inverse-') || name.startsWith('.restore-')),false);
  await runtime.dispose();
});
