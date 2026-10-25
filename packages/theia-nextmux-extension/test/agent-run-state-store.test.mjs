import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyAgentDelegationLifecycle,
  createAgentDelegationLedger,
  createAgentTaskContext,
  recordAgentDelegationUsage,
} from '@nextmux/agent-runtime';

import {
  AGENT_RUN_STATE_MAX_BYTES,
  AgentRunStateStore,
  AgentRunStateStoreError,
} from '../lib/node/nextmux-agent-run-state-store.js';
import { hydrateAgentDelegationLedger } from '../lib/browser/nextmux-agent-delegation-hydration.js';

const checkpoint = {
  version: 1,
  runId: 'run-state-source-0001',
  nextTurn: 7,
  segment: 1,
  messages: [
    { role: 'user', content: 'private source context' },
    { role: 'assistant', content: 'work in progress' },
  ],
  seenToolCallIds: [],
  usage: { inputTokens: 17, outputTokens: 5 },
  toolCalls: 0,
  repeatedToolBatchTurns: 0,
  createdAt: new Date().toISOString(),
};

test('agent run state is persisted atomically behind an opaque identifier', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-run-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root);
  const id = await store.save(checkpoint);
  assert.match(id, /^resume-[0-9a-f-]{36}$/);
  assert.deepEqual(await store.load(id), checkpoint);
  const directory = join(root, 'run-state');
  assert.equal((await lstat(directory)).isDirectory(), true);
  assert.equal((await readFile(join(directory, `${id}.json`), 'utf8')).includes('private source context'), true);
  assert.deepEqual((await readdir(directory)).filter(item => item.includes('.tmp-')), []);
});

test('agent run state rejects traversal, corruption, oversize data, and symlink targets', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-run-state-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root);
  await assert.rejects(() => store.load('../outside'), error => error instanceof AgentRunStateStoreError && error.code === 'INVALID_RUN_STATE_ID');
  const directory = join(root, 'run-state');
  await mkdir(directory, { recursive: true });
  const corruptId = 'resume-00000000-0000-4000-8000-000000000001';
  await writeFile(join(directory, `${corruptId}.json`), '{broken', 'utf8');
  await assert.rejects(() => store.load(corruptId), error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_CORRUPT');

  const huge = { ...checkpoint, messages: [{ role: 'user', content: 'x'.repeat(AGENT_RUN_STATE_MAX_BYTES) }] };
  await assert.rejects(() => store.save(huge), error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_TOO_LARGE');

  const target = join(root, 'outside.json');
  await writeFile(target, JSON.stringify({ schemaVersion: 1 }), 'utf8');
  const symlinkId = 'resume-00000000-0000-4000-8000-000000000002';
  try {
    await (await import('node:fs/promises')).symlink(target, join(directory, `${symlinkId}.json`), 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.diagnostic('Windows does not allow symlink creation for this test user.');
      return;
    }
    throw error;
  }
  await assert.rejects(() => store.load(symlinkId), error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_UNSAFE');
});

test('new resumable state is bound to its conversation and workspace while legacy state remains readable', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-run-state-owner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root);
  const id = await store.save(checkpoint, {
    workspaceRoot: root,
    conversationId: 'conversation-owner-001',
    rootRunId: 'run-owner-001',
    depth: 0,
  });

  const record = await store.loadRecord(id, {
    expectedOwner: { workspaceRoot: root, conversationId: 'conversation-owner-001' },
  });
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.owner?.conversationId, 'conversation-owner-001');
  assert.deepEqual(record.checkpoint, checkpoint);
  await assert.rejects(
    () => store.load(id, { expectedOwner: { workspaceRoot: root, conversationId: 'conversation-owner-002' } }),
    error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_OWNER_MISMATCH'
  );
  await assert.rejects(
    () => store.load(id, { expectedOwner: { workspaceRoot: join(root, 'other'), conversationId: 'conversation-owner-001' } }),
    error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_OWNER_MISMATCH'
  );

  const legacyId = await store.save(checkpoint);
  assert.deepEqual(await store.load(legacyId, {
    expectedOwner: { workspaceRoot: root, conversationId: 'legacy-owner' },
  }), checkpoint);
});

test('root continuations cannot consume child checkpoints, while matching child lineage can', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-run-state-lineage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root);
  const id = await store.save(checkpoint, {
    workspaceRoot: root,
    conversationId: 'conversation-lineage-001',
    parentRunId: 'parent-lineage-001',
    rootRunId: 'root-lineage-001',
    depth: 1,
  });

  await assert.rejects(
    () => store.load(id, {
      expectedOwner: {
        workspaceRoot: root,
        conversationId: 'conversation-lineage-001',
        scope: 'root',
      },
    }),
    error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_OWNER_MISMATCH',
  );
  assert.deepEqual(await store.load(id, {
    expectedOwner: {
      workspaceRoot: root,
      conversationId: 'conversation-lineage-001',
      scope: 'child',
      parentRunId: 'parent-lineage-001',
      rootRunId: 'root-lineage-001',
      depth: 1,
    },
  }), checkpoint);
  await assert.rejects(
    () => store.load(id, {
      expectedOwner: {
        workspaceRoot: root,
        conversationId: 'conversation-lineage-001',
        scope: 'child',
        parentRunId: 'another-parent-001',
      },
    }),
    error => error instanceof AgentRunStateStoreError && error.code === 'RUN_STATE_OWNER_MISMATCH',
  );
});

test('delegation ledger is an owner-bound, overwrite-safe diagnostic projection', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-delegation-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root);
  const rootRunId = 'agent-ledger-root-001';
  const owner = {
    workspaceRoot: root,
    conversationId: 'conversation-ledger-store-001',
    rootRunId,
    depth: 0,
  };
  const first = recordAgentDelegationUsage(
    createAgentDelegationLedger(rootRunId, new Date(0).toISOString()),
    { inputTokens: 30, outputTokens: 10 },
    true,
    new Date(500).toISOString(),
  );
  await store.saveDelegationLedger(first, owner);
  const loaded = await store.loadDelegationLedger(rootRunId, {
    expectedOwner: { ...owner, scope: 'root' },
  });
  assert.equal(loaded.rootRunId, rootRunId);
  assert.deepEqual(loaded.ledger.children, []);
  assert.deepEqual(loaded.ledger.usage, { inputTokens: 30, outputTokens: 10, usageKnown: true });
  assert.equal(loaded.owner.conversationId, owner.conversationId);

  const second = { ...first, updatedAt: new Date(1_000).toISOString() };
  await store.saveDelegationLedger(second, owner);
  assert.equal((await store.loadDelegationLedger(rootRunId)).updatedAt, second.updatedAt);
  await assert.rejects(
    () => store.loadDelegationLedger(rootRunId, {
      expectedOwner: { workspaceRoot: root, conversationId: 'conversation-other-001', scope: 'root' },
    }),
    error => error instanceof AgentRunStateStoreError && error.code === 'DELEGATION_LEDGER_OWNER_MISMATCH',
  );
  const files = await readdir(join(root, 'run-state'));
  assert.equal(files.filter(file => file.endsWith('.json')).length, 1);
  assert.equal(files.some(file => file.includes('.tmp-')), false);
});

test('a hard-terminated host leaves a durable running child that restart hydration marks interrupted', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-delegation-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rootRunId = 'agent-crash-root-001';
  const conversationId = 'conversation-crash-001';
  const storeUrl = new URL('../lib/node/nextmux-agent-run-state-store.js', import.meta.url).href;
  const childSource = `
    import { AgentRunStateStore } from ${JSON.stringify(storeUrl)};
    import { applyAgentDelegationLifecycle, createAgentDelegationLedger, createAgentTaskContext } from '@nextmux/agent-runtime';
    const root = ${JSON.stringify(root)};
    const rootRunId = ${JSON.stringify(rootRunId)};
    const conversationId = ${JSON.stringify(conversationId)};
    const context = createAgentTaskContext({ workspaceRoot: root, conversationId, goal: 'crash recovery' });
    let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
    ledger = applyAgentDelegationLifecycle(ledger, {
      type: 'started', parentRunId: 'agent-crash-parent-001', rootRunId,
      childRunId: 'agent-crash-child-001', depth: 1, task: 'recover child', taskContext: context
    }, new Date(1_000).toISOString());
    const store = new AgentRunStateStore(root);
    await store.saveDelegationLedger(ledger, { workspaceRoot: root, conversationId, rootRunId, depth: 0 });
    process.stdout.write('LEDGER_READY\\n');
    setInterval(() => undefined, 1_000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child did not persist ledger: ${stderr}`)), 5_000);
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.includes('LEDGER_READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (code !== null && !stdout.includes('LEDGER_READY')) {
        clearTimeout(timer);
        reject(new Error(`child exited before persistence (${code}): ${stderr}`));
      }
    });
  });
  await ready;
  child.kill('SIGKILL');
  if (child.exitCode === null) {
    await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
  }

  const store = new AgentRunStateStore(root);
  const loaded = await store.loadDelegationLedger(rootRunId, {
    expectedOwner: { workspaceRoot: root, conversationId, scope: 'root', rootRunId, depth: 0 },
  });
  assert.equal(loaded.ledger.children[0].status, 'running');
  const hydrated = hydrateAgentDelegationLedger(
    [{ id: 'turn-crash-001', agentRootRunId: rootRunId }],
    loaded.ledger,
    { sessionId: conversationId, workspaceRoot: root, permissionMode: 'workspace_write', now: 3_000 },
  );
  assert.equal(hydrated.changed, true);
  assert.equal(hydrated.turns[0].childAgents[0].status, 'interrupted');
  assert.equal(hydrated.turns[0].childAgents[0].error?.resumable, false);
});

test('concurrent ledger writers merge distinct child diagnostics instead of losing one writer', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-delegation-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rootRunId = 'agent-race-root-001';
  const conversationId = 'conversation-race-001';
  const storeUrl = new URL('../lib/node/nextmux-agent-run-state-store.js', import.meta.url).href;
  const childSource = `
    import { AgentRunStateStore } from ${JSON.stringify(storeUrl)};
    import { applyAgentDelegationLifecycle, createAgentDelegationLedger, createAgentTaskContext } from '@nextmux/agent-runtime';
    const root = ${JSON.stringify(root)};
    const rootRunId = ${JSON.stringify(rootRunId)};
    const conversationId = ${JSON.stringify(conversationId)};
    const childRunId = process.argv[1];
    const context = createAgentTaskContext({ workspaceRoot: root, conversationId, goal: childRunId });
    let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
    ledger = applyAgentDelegationLifecycle(ledger, {
      type: 'started', parentRunId: 'agent-race-parent-001', rootRunId,
      childRunId, depth: 1, task: childRunId, taskContext: context
    }, new Date(childRunId.endsWith('a') ? 1_000 : 2_000).toISOString());
    const store = new AgentRunStateStore(root);
    await Promise.all([
      new Promise(resolve => setTimeout(resolve, childRunId.endsWith('a') ? 20 : 0)),
      new Promise(resolve => setTimeout(resolve, childRunId.endsWith('a') ? 20 : 0)),
    ]);
    await store.saveDelegationLedger(ledger, { workspaceRoot: root, conversationId, rootRunId, depth: 0 });
    process.stdout.write('DONE\\n');
  `;
  const children = ['agent-race-child-a', 'agent-race-child-b'].map(childRunId => spawn(
    process.execPath,
    ['--input-type=module', '-e', childSource, childRunId],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  ));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const outputs = children.map(child => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `child exited ${code}`)));
  }));
  await Promise.all(outputs);
  const store = new AgentRunStateStore(root);
  const loaded = await store.loadDelegationLedger(rootRunId, {
    expectedOwner: { workspaceRoot: root, conversationId, scope: 'root', rootRunId, depth: 0 },
  });
  assert.deepEqual(loaded.ledger.children.map(child => child.childRunId).sort(), [
    'agent-race-child-a', 'agent-race-child-b',
  ]);
});
