import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AgentDurableOperationStore } from '../lib/node/nextmux-agent-durable-operation-store.js';

const fingerprint = value => createHash('sha256').update(value).digest('hex');
const owner = root => ({ workspaceRoot: root, conversationId: 'durable-store-test-owner', executionScopeId: 'scope-durable-store-fixture' });
const binding = scopeId => ({ scopeId, admissionId: 'admit-' + randomUUID(), operationId: 'op-' + randomUUID(),
  originalToolCallId: 'original-stable-call', logicalParentOperationId: scopeId });
async function directory(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-durable-store-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function started(store, account) {
  const admitted = binding(account.executionScopeId);
  const prepared = await store.admit(account, admitted, fingerprint('original request'), fingerprint('original route'));
  return { admitted, operation: await store.begin(account, prepared.operationId, prepared.revision) };
}

test('unknown operation blocks changed tasks/new IDs and another owner cannot hydrate it', async t => {
  const root = await directory(t), account = owner(root), store = new AgentDurableOperationStore(root);
  const { admitted, operation } = await started(store, account);
  await assert.rejects(store.admit(account, admitted, fingerprint('original request'), fingerprint('original route')),
    error => error.code === 'DURABLE_OPERATION_UNKNOWN');
  await assert.rejects(store.admit(account, binding(account.executionScopeId), fingerprint('changed task'), fingerprint('changed route')),
    error => error.code === 'DURABLE_SCOPE_UNKNOWN');
  await assert.rejects(store.loadResult({ ...account, conversationId: 'other-owner' }, operation),
    error => error.code === 'DURABLE_RESULT_UNAVAILABLE');
});

test('trusted retry is revision-bound and retains original 17/4 unknown usage exactly once', async t => {
  const root = await directory(t), account = owner(root), store = new AgentDurableOperationStore(root);
  let { operation } = await started(store, account);
  operation = await store.complete(account, operation.operationId, operation.revision, { runId: operation.childRunId,
    status: 'paused', finalText: 'Original interrupted result', usage: { inputTokens: 17, outputTokens: 4 }, usageKnown: false });
  const originalChild = operation.childRunId, oldRevision = operation.revision;
  operation = await store.retryWithAuthorization(account, operation.operationId, oldRevision,
    fingerprint('original request'), fingerprint('confirmed route'));
  assert.notEqual(operation.childRunId, originalChild);
  assert.equal(operation.usage, undefined);
  assert.equal(operation.resultRef, undefined);
  await assert.rejects(store.retryWithAuthorization(account, operation.operationId, oldRevision,
    fingerprint('original request'), fingerprint('confirmed route')), error => error.code === 'DURABLE_RETRY_STALE');
  operation = await store.begin(account, operation.operationId, operation.revision);
  // A second attempt had no completed receipt; its unknown quantity must not inherit attempt one's 17/4.
  operation = await store.retryWithAuthorization(account, operation.operationId, operation.revision,
    fingerprint('original request'), fingerprint('second confirmed route'));
  assert.deepEqual(store.accounting(operation), { usage: { inputTokens: 17, outputTokens: 4 }, usageKnown: false });
  operation = await store.begin(account, operation.operationId, operation.revision);
  operation = await store.complete(account, operation.operationId, operation.revision, { runId: operation.childRunId,
    status: 'completed', finalText: 'Original final result', usage: { inputTokens: 5, outputTokens: 2 }, usageKnown: true });
  assert.deepEqual(store.accounting(operation), { usage: { inputTokens: 22, outputTokens: 6 }, usageKnown: false });
  assert.deepEqual((await store.loadResult(account, operation)).usage, { inputTokens: 5, outputTokens: 2 });
  assert.equal(new Set(operation.attempts.map(attempt => attempt.id)).size, operation.attempts.length);
  await assert.rejects(store.admit(account, binding(account.executionScopeId), fingerprint('new task'), fingerprint('new route')),
    error => error.code === 'DURABLE_SCOPE_UNKNOWN');
});

test('SQLite transaction and execution leases survive a real lock-internal SIGKILL without stale-lock deletion', { timeout: 15000 }, async t => {
  const root = await directory(t), account = owner(root), operationId = 'op-' + randomUUID();
  const checkpoint = { version: 3, runId: 'durable-lock-test-run', executionScopeId: account.executionScopeId,
    nextTurn: 1, segment: 1, messages: [{ role: 'user', content: 'Synthetic lock fixture' }], seenToolCallIds: [],
    usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: true, toolCalls: 0, repeatedToolBatchTurns: 0,
    accountedOperationIds: [], createdAt: new Date().toISOString() };
  const modulePath = fileURLToPath(new URL('../lib/node/nextmux-agent-durable-operation-store.js', import.meta.url));
  const childCode = `const {AgentDurableOperationStore:S}=require(${JSON.stringify(modulePath)});const account=${JSON.stringify(account)},checkpoint=${JSON.stringify(checkpoint)};
    (async()=>{const s=new S(${JSON.stringify(root)},async point=>{if(point==='after_index_directory_sync'){setInterval(()=>{},1000);process.stdout.write('DURABLE_LOCKS_HELD\\n');await new Promise(()=>{});}});
    await s.acquireExecutionLease(account,${JSON.stringify(operationId)});await s.commitCheckpoint(account,checkpoint,'resume-11111111-1111-4111-8111-111111111111',0);})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const child = spawn(process.execPath, ['--input-type=commonjs', '-e', childCode], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('DURABLE_LOCKS_HELD')) resolve(); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Child exited before the owned lock window: ${code}; ${stderr}`)));
  });
  const store = new AgentDurableOperationStore(root);
  await assert.rejects(store.commitCheckpoint(account, checkpoint, 'resume-' + randomUUID(), 1), error => error.code === 'DURABLE_SCOPE_LOCKED');
  await assert.rejects(store.acquireExecutionLease(account, operationId), error => error.code === 'DURABLE_SCOPE_LOCKED');
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(child.kill('SIGKILL'), true);
  assert.equal((await exited).signal, 'SIGKILL');
  assert.equal((await store.loadHead(account)).revision, 1);
  const ack = await store.commitCheckpoint(account, checkpoint, 'resume-' + randomUUID(), 1);
  assert.equal(ack.revision, 2);
  const release = await store.acquireExecutionLease(account, operationId);
  release();
});
