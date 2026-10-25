import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { AgentRunInterruptedError, AgentToolError, inspectModelErrorSignal } from '@nextmux/agent-runtime';
import { OfficialModelError, classifyModelError } from '@nextmux/model-runtime';
import { isPriceAuthorizationError } from '../lib/common/nextmux-price-quote.js';
import { AgentRunStateStore, AgentRunStateStoreError } from '../lib/node/nextmux-agent-run-state-store.js';
import { normalizeDesktopFailure } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { agentManualResumeStrategy } from '../lib/browser/nextmux-agent-task-queue.js';
import { autoResumeDecision } from '../lib/browser/nextmux-agent-activity.js';
const source = readFileSync(process.env.NEXTMUX_CLASSIFIER_TEST_SOURCE || new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('platform.ts', source, ts.ScriptTarget.Latest, true);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const resumable = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ResumableAgentRunError');
const pendingIdentity = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'pendingManagedReceiptIdentity');
const method = name => service.members.find(node => node.name?.getText(ast) === name).getText(ast);
// The RPC base constructor is a metadata seam; the production resumable class,
// classifier and cleanup method run unchanged, with actual model diagnosis and
// actual atomic checkpoint persistence. No provider or start RPC is invoked.
class PlatformRequestError extends Error { constructor(code, message, status, retryAfterMs, data = {}) { super(message); Object.assign(this, { code, status, retryAfterMs, data }); } }
const { Harness, Resumable } = new Function('PlatformRequestError', 'AgentRunInterruptedError', 'AgentToolError', 'AgentRunStateStoreError',
  'classifyModelError', 'inspectModelErrorSignal', 'isPriceAuthorizationError', ts.transpile(`
  ${resumable.getText(ast)}
  ${pendingIdentity.getText(ast)}
  class Harness { ${method('classifyStableAgentRunError')} ${method('stableAgentRunError')} ${method('clearAgentJobRecovery')} }
  return { Harness, Resumable: ResumableAgentRunError };
`, { target: ts.ScriptTarget.ES2022 }))(PlatformRequestError, AgentRunInterruptedError, AgentToolError, AgentRunStateStoreError,
  classifyModelError, inspectModelErrorSignal, isPriceAuthorizationError);
const cp = 'resume-11111111-1111-4111-8111-111111111111';
function interrupted(code = 'REQUEST_REJECTED', status = 402, message = 'Insufficient credits', checkpoint = cp) {
  const readableError = classifyModelError({ error: { code: status, message }, httpStatus: status });
  const failure = new AgentRunInterruptedError(new OfficialModelError(code, message, { httpStatus: status, readableError }), {}, []).failure;
  return new Resumable(code, message, checkpoint, failure);
}
test('a trusted quota-rejected safe boundary keeps its opaque checkpoint for manual action only', () => {
  const result = new Harness().classifyStableAgentRunError(interrupted());
  assert.equal(result.readableError.kind, 'provider_quota_exhausted');
  assert.equal(result.httpStatus, 402); assert.equal(result.resumeCheckpointId, cp);
  assert.equal(result.kind, 'waiting_user'); assert.equal(result.resumable, true);
  assert.equal(result.retryable, false); assert.equal(result.retrySafe, false);
});
for (const [kind, status, message] of [['auth_invalid', 401, 'Invalid API key'], ['auth_missing', 400, 'API key is missing']])
  test('a trusted REQUEST_REJECTED ' + kind + ' keeps context without automatic retry', () => {
    const result = new Harness().classifyStableAgentRunError(interrupted('REQUEST_REJECTED', status, message));
    assert.equal(result.readableError.kind, kind); assert.equal(result.kind, 'waiting_user');
    assert.equal(result.resumeCheckpointId, cp); assert.equal(result.resumable, true);
    assert.equal(result.retryable, false); assert.equal(result.retrySafe, false);
  });
for (const [code, kind, status, message] of [
  ['PROVIDER_QUOTA_LIMIT', 'provider_quota_exhausted', 402, 'Insufficient credits'],
  ['PROVIDER_CREDENTIAL_REQUIRED', 'auth_missing', 400, 'API key is missing']
]) test('trusted provider diagnosis preserves context independently of error code ' + code, () => {
  const result = new Harness().classifyStableAgentRunError(interrupted(code, status, message));
  assert.equal(result.readableError.kind, kind); assert.equal(result.kind, 'waiting_user');
  assert.equal(result.resumeCheckpointId, cp); assert.equal(result.resumable, true);
  assert.equal(result.retryable, false); assert.equal(result.retrySafe, false);
});
test('raw or interrupted errors cannot invent a checkpoint by adding a public property', () => {
  for (const error of [Object.assign(new OfficialModelError('REQUEST_REJECTED', 'Insufficient credits', { httpStatus: 402 }), { resumeCheckpointId: cp }),
    new AgentRunInterruptedError(new OfficialModelError('REQUEST_REJECTED', 'Insufficient credits', { httpStatus: 402 }), {}, [])]) {
    const result = new Harness().classifyStableAgentRunError(error);
    assert.equal(result.resumable, false); assert.equal(result.resumeCheckpointId, undefined);
  }
});
test('wallet refusal preserves an existing safe checkpoint but cannot create one for a fresh rejection', () => {
  const result = new Harness().classifyStableAgentRunError(interrupted('WALLET_BALANCE_INSUFFICIENT'));
  assert.equal(result.kind, 'waiting_user'); assert.equal(result.resumeCheckpointId, cp);
  assert.equal(result.resumable, true); assert.equal(result.retryable, false); assert.equal(result.retrySafe, false);
  const noCp = new Harness().classifyStableAgentRunError(new PlatformRequestError('WALLET_BALANCE_INSUFFICIENT', 'Insufficient balance', 402));
  assert.equal(noCp.resumable, false); assert.equal(noCp.resumeCheckpointId, undefined);
});
test('unknown billing and expired original-response replay remain blocked despite a private checkpoint', () => {
  for (const code of ['BILLING_TRANSPORT_UNKNOWN', 'BILLING_FINALIZATION_PENDING', 'RESPONSE_REPLAY_EXPIRED']) {
    const result = new Harness().classifyStableAgentRunError(interrupted(code));
    assert.equal(result.kind, 'waiting_user'); assert.equal(result.resumable, false);
    assert.equal(result.resumeCheckpointId, undefined); assert.equal(result.retryable, false); assert.equal(result.retrySafe, false);
  }
});
test('price authorization, privacy refusal and unrelated invalid requests retain their existing gates', () => {
  for (const code of ['PRICE_QUOTE_CHANGED', 'ROUTE_PRIVACY_UNAVAILABLE', 'REQUEST_REJECTED']) {
    const result = new Harness().classifyStableAgentRunError(interrupted(code, 400, 'Invalid parameter'));
    assert.equal(result.resumable, false); assert.equal(result.resumeCheckpointId, undefined); assert.equal(result.retryable, false);
  }
});
test('actual cleanup keeps the latest closed transcript after quota failure and never starts a model', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-quota-checkpoint-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new AgentRunStateStore(root), owner = { workspaceRoot: root, conversationId: 'conversation-owned', rootRunId: 'agent-owned-host', depth: 0 };
  const latest = { version: 1, runId: 'agent-owned-host', nextTurn: 34, segment: 1, messages: [
    { role: 'user', content: 'Isolated local fixture' }, { role: 'assistant', content: '', toolCalls: [{ id: 'call-completed-work', name: 'workspace.write_file', arguments: { path: 'fixture.txt' } }] },
    { role: 'tool', toolCallId: 'call-completed-work', content: 'Already completed; do not replay' }],
    seenToolCallIds: ['call-completed-work'], usage: { inputTokens: 100, outputTokens: 30 }, toolCalls: 33,
    repeatedToolBatchTurns: 0, createdAt: new Date().toISOString() };
  const saved = await store.save(latest, owner), failure = new Harness().classifyStableAgentRunError(interrupted('REQUEST_REJECTED', 402, 'Insufficient credits', saved));
  let journalRemoved = 0;
  const job = { runId: 'agent-owned-host', recoveryCheckpointId: saved, recoveryCheckpointStore: store, recoveryJournal: { async remove(id) { assert.equal(id, job.runId); journalRemoved++; } } };
  await new Harness().clearAgentJobRecovery(job, failure.resumeCheckpointId);
  const retained = await store.loadRecord(saved, { expectedOwner: owner });
  assert.equal(retained.checkpoint.toolCalls, 33); assert.deepEqual(retained.checkpoint.messages, latest.messages);
  assert.equal(journalRemoved, 1); assert.equal(failure.resumable, true);
});
for (const code of ['UNRELATED_PROVIDER_REJECTION', 'BILLING_TRANSPORT_UNKNOWN'])
  test('the unified wrapper retains private context without authorizing continuation for ' + code, async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-blocked-context-')); t.after(() => rm(root, { recursive: true, force: true }));
    const store = new AgentRunStateStore(root), owner = { workspaceRoot: root, conversationId: 'conversation-owned', rootRunId: 'agent-owned-host', depth: 0 };
    const latest = { version: 1, runId: 'agent-owned-host', nextTurn: 34, segment: 1,
      messages: [{ role: 'user', content: 'Retain closed context; do not dispatch' }], seenToolCallIds: [],
      usage: { inputTokens: 100, outputTokens: 30 }, toolCalls: 33, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString() };
    const saved = await store.save(latest, owner), failure = new Harness().stableAgentRunError(interrupted(code, 400, 'Unknown provider outcome', saved));
    assert.equal(failure.resumeCheckpointId, saved); assert.equal(failure.resumable, false); assert.equal(failure.retryable, false);
    const normalized = normalizeDesktopFailure('en', failure);
    assert.equal(normalized.resumeCheckpointId, saved); assert.equal(normalized.resumable, false);
    assert.equal(agentManualResumeStrategy({ stage: 'error', resumeCheckpointId: saved, failure: normalized }), undefined);
    assert.equal(autoResumeDecision({ failureKind: normalized.kind, retrySafe: normalized.retrySafe, attempt: 0, maximum: 5 }).action, 'stop');
    const job = { runId: owner.rootRunId, recoveryCheckpointId: saved, recoveryCheckpointStore: store, recoveryJournal: { async remove() {} } };
    await new Harness().clearAgentJobRecovery(job, failure.resumeCheckpointId);
    assert.equal((await store.loadRecord(saved, { expectedOwner: owner })).checkpoint.toolCalls, 33);
  });
