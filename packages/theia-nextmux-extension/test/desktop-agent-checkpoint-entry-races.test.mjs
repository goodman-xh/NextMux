import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const fixturePath = fileURLToPath(new URL('./fixtures/agent-checkpoint-entry-process.mjs', import.meta.url));

class ClearingFixture extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

function startFixture(mode, profile, workspaceRoot) {
  const child = spawn(process.execPath, [fixturePath, mode, profile, workspaceRoot], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const entered = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`fixture timed out: ${stderr}`)), 30_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(output.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${stderr}`)); });
  });
  return { child, entered, stderr: () => stderr };
}

async function finishFixture(fixture) {
  const exited = once(fixture.child, 'exit');
  fixture.child.stdin.end('continue\n');
  const timer = setTimeout(() => fixture.child.kill('SIGKILL'), 10_000);
  try {
    const [code] = await exited;
    assert.equal(code, 0, fixture.stderr());
  } finally { clearTimeout(timer); }
}

for (const [mode, label] of [
  ['child', 'child workspace runtime construction'],
  ['read', 'read-only checkpoint preview runtime construction'],
]) {
  test(`${label} blocks another process from clearing its checkpoint root`, async t => {
    const sandbox = await mkdtemp(join(tmpdir(), `nextmux-${mode}-checkpoint-entry-`));
    const profile = join(sandbox, 'profile');
    const sourceRoot = join(sandbox, 'source');
    let fixture;
    t.after(async () => {
      if (fixture?.child.exitCode === null && fixture.child.signalCode === null) {
        const exited = once(fixture.child, 'exit');
        fixture.child.kill('SIGKILL');
        await exited;
      }
      await rm(sandbox, { recursive: true, force: true });
    });
    await mkdir(sourceRoot);
    await writeFile(join(sourceRoot, 'example.txt'), 'temporary-fixture-only');
    fixture = startFixture(mode, profile, sourceRoot);
    const entered = await fixture.entered;
    assert.equal(entered.type, 'entered');
    assert.equal(await readFile(entered.sentinel, 'utf8'), 'temporary-fixture-only');

    const service = new ClearingFixture(profile);
    await assert.rejects(
      service.clearDesktopLocalData({ workspaceRoot: entered.workspaceRoot, categories: ['agent_checkpoints'] }),
      { code: 'LOCAL_DATA_BUSY' },
    );
    assert.equal(await readFile(entered.sentinel, 'utf8'), 'temporary-fixture-only');
    await finishFixture(fixture);
    const state = await service.clearDesktopLocalData({ workspaceRoot: entered.workspaceRoot, categories: ['agent_checkpoints'] });
    assert.equal(state.entries.find(entry => entry.category === 'agent_checkpoints')?.files, 0);
  });
}

test('failed child runtime construction releases its acquired checkpoint lease immediately', async () => {
  const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  let callback;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'prepareWorkspace') callback = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, 'the production delegation callback must be present');
  const childCheckpointLeases = [];
  let releases = 0;
  const lease = { assertOwned() {}, async release() { releases++; } };
  const delegatedWorkspaces = {
    async prepare(input) {
      await input.beforeRuntimeCreate('/temporary/child');
      throw new Error('runtime constructor failed after admission');
    },
  };
  const transpiled = ts.transpileModule(`const callback = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const service = { async acquireAgentCheckpointRunLeases() { return lease; } };
  const prepare = new Function('delegatedWorkspaces', 'stateConversationId', 'delegationRootRunId',
    'workspaceRoot', 'request', 'childCheckpointLeases', `${transpiled}\nreturn callback;`).call(service,
    delegatedWorkspaces, 'conversation-test', 'run-test', '/temporary/source', { skills: [] }, childCheckpointLeases,
  );
  await assert.rejects(prepare({}),
    /runtime constructor failed after admission/);
  assert.equal(releases, 1);
  assert.deepEqual(childCheckpointLeases, []);
});
