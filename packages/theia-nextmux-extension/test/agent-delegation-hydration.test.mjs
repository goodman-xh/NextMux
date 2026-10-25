import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAgentDelegationLifecycle,
  createAgentDelegationLedger,
  createAgentTaskContext,
} from '@nextmux/agent-runtime';
import {
  agentDelegationRootIds,
  hydrateAgentDelegationLedger,
} from '../lib/browser/nextmux-agent-delegation-hydration.js';

const rootRunId = 'root-hydration-001';
const sessionId = 'conversation-hydration-001';
const context = createAgentTaskContext({
  workspaceRoot: 'C:\\workspace\\nextmux',
  conversationId: sessionId,
  goal: 'inspect the project',
  parentRunId: 'parent-hydration-001',
  rootRunId,
  depth: 1,
  permissionMode: 'workspace_write',
  allowedToolNames: [],
  selectedMemory: [{
    id: 'private-memory-001',
    kind: 'summary',
    text: 'must not be copied into the renderer recovery projection',
    maxCharacters: 200,
  }],
});

function ledgerWithChild(status = 'completed') {
  let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: 'started',
    parentRunId: 'parent-hydration-001',
    rootRunId,
    childRunId: 'child-hydration-001',
    depth: 1,
    task: 'inspect the project',
    taskContext: context,
  }, new Date(1_000).toISOString());
  if (status === 'running') return ledger;
  return applyAgentDelegationLifecycle(ledger, {
    type: 'failed',
    parentRunId: 'parent-hydration-001',
    rootRunId,
    childRunId: 'child-hydration-001',
    depth: 1,
    task: 'inspect the project',
    taskContext: context,
    error: { code: 'CHILD_FAILED', message: 'child stopped' },
    receipt: { outcome: 'failed', retrySafe: true, unknownSideEffect: false, summary: 'safe to continue' },
  }, new Date(2_000).toISOString());
}

test('restart hydration restores child tabs from the owner-bound ledger without transcript memory', () => {
  const turns = [{ id: 'turn-001', agentRootRunId: rootRunId }];
  const result = hydrateAgentDelegationLedger(turns, ledgerWithChild(), {
    sessionId,
    workspaceRoot: 'C:\\workspace\\nextmux',
    permissionMode: 'workspace_write',
    now: 3_000,
  });
  assert.equal(result.changed, true);
  assert.equal(result.turns[0].childAgents?.length, 1);
  assert.equal(result.turns[0].childAgents?.[0].status, 'error');
  assert.equal(result.turns[0].childAgents?.[0].eventCount, 0);
  assert.deepEqual(result.turns[0].childAgents?.[0].taskContext.selectedMemory, []);
  assert.equal('response' in result.turns[0].childAgents?.[0], false);
});

test('existing event streams and results are preserved while ledger diagnostics reconcile status', () => {
  const existing = {
    id: 'turn-001',
    agentRootRunId: rootRunId,
    childAgents: [{
      childRunId: 'child-hydration-001',
      parentRunId: 'parent-hydration-001',
      rootRunId,
      depth: 1,
      task: 'inspect the project',
      status: 'interrupted',
      events: [{ type: 'assistant_progress', turn: 1, content: 'still visible', origin: 'model', at: new Date(1_500).toISOString() }],
      eventCount: 1,
      firstEventIndex: 0,
      nextEventIndex: 1,
      startedAt: 1_000,
      updatedAt: 1_500,
      taskContext: context,
      result: {
        runId: 'child-result-001', status: 'completed', stopReason: 'completed', finalText: 'keep this result',
        usage: { inputTokens: 1, outputTokens: 1 }, turns: 1, toolCalls: 0,
      },
    }],
  };
  const result = hydrateAgentDelegationLedger([existing], ledgerWithChild(), {
    sessionId,
    workspaceRoot: 'C:\\workspace\\nextmux',
    permissionMode: 'workspace_write',
    now: 3_000,
  });
  const child = result.turns[0].childAgents[0];
  assert.equal(child.status, 'error');
  assert.equal(child.events[0].content, 'still visible');
  assert.equal(child.result.finalText, 'keep this result');
});

test('root lookup is deduplicated and rejects malformed or cross-root records', () => {
  assert.deepEqual(agentDelegationRootIds([
    { id: 'a', agentRootRunId: rootRunId },
    { id: 'b', agentRootRunId: rootRunId },
    { id: 'c', agentRootRunId: 'bad' },
  ]), [rootRunId]);
  const unchanged = hydrateAgentDelegationLedger(
    [{ id: 'turn-001', agentRootRunId: rootRunId }],
    { ...ledgerWithChild(), rootRunId: 'other-root-001' },
    { sessionId, workspaceRoot: 'C:\\workspace\\nextmux', permissionMode: 'workspace_write' },
  );
  assert.equal(unchanged.changed, false);
});

test('cancelled child in authoritative ledger reconciles stale running child snapshot on restart hydration', () => {
  let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: 'started',
    parentRunId: 'parent-hydration-001',
    rootRunId,
    childRunId: 'child-hydration-001',
    depth: 1,
    task: 'inspect the project',
    taskContext: context,
  }, new Date(1_000).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: 'completed',
    parentRunId: 'parent-hydration-001',
    rootRunId,
    childRunId: 'child-hydration-001',
    depth: 1,
    task: 'inspect the project',
    taskContext: context,
    result: {
      runId: 'child-hydration-001',
      status: 'cancelled',
      stopReason: 'cancel_requested',
      finalText: 'Task cancelled by user.',
      receipt: { outcome: 'cancelled', retrySafe: false, unknownSideEffect: true, summary: 'unknown side effect' },
      depth: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      usageKnown: false,
      turns: 1,
      toolCalls: 0,
      resumeCheckpointId: 'resume-child-001',
      recoveryStatus: 'durable',
    },
  }, new Date(2_000).toISOString());

  const staleTurn = {
    id: 'turn-001',
    agentRootRunId: rootRunId,
    childAgents: [{
      childRunId: 'child-hydration-001',
      parentRunId: 'parent-hydration-001',
      rootRunId,
      depth: 1,
      task: 'inspect the project',
      status: 'running',
      events: [{ type: 'model_started', turn: 1, at: new Date(1_200).toISOString() }],
      eventCount: 1,
      firstEventIndex: 0,
      nextEventIndex: 1,
      startedAt: 1_000,
      updatedAt: 1_200,
      taskContext: context,
    }],
  };

  const result = hydrateAgentDelegationLedger([staleTurn], ledger, {
    sessionId,
    workspaceRoot: 'C:\\workspace\\nextmux',
    permissionMode: 'workspace_write',
    now: 3_000,
  });
  assert.equal(result.changed, true);
  assert.equal(result.turns[0].childAgents?.[0].status, 'cancelled');
  assert.equal(result.turns[0].childAgents?.[0].events.length, 1);
});


