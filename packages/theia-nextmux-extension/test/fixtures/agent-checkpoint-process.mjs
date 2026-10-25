import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { NextMuxPlatformServiceImpl } from '../../lib/node/nextmux-platform-service.js';
import { AgentRunStateStore } from '../../lib/node/nextmux-agent-run-state-store.js';

class RunningFixture extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
  executeAgentRun(_request, execution) {
    return new Promise(resolve => {
      const finish = () => resolve({
        runId: execution.runId, status: 'cancelled', stopReason: 'cancel_requested',
        finalText: '', events: [], usage: { inputTokens: 0, outputTokens: 0 },
        turns: 0, toolCalls: 0, developmentOnly: false,
        billing: { kind: 'provider_direct', chargedMicros: 0, requestCount: 0 },
        failoverCount: 0, changes: [],
        route: { kind: 'official_connection', routeId: 'official:test', providerName: 'test', modelFamily: 'test', model: 'test' },
      });
      if (execution.signal.aborted) finish();
      else execution.signal.addEventListener('abort', finish, { once: true });
    });
  }
}

const [profile, workspaceRoot, derivedWorkspaceRoot] = process.argv.slice(2);
const service = new RunningFixture(profile);
const conversationId = randomUUID();
const request = {
  route: { kind: 'official_connection', connectionId: 'connection-test-001' },
  workbench: 'coding', prompt: 'test', workspaceRoot, conversationId,
  permissionMode: 'workspace_write',
};

try {
  const { runId } = await service.startAgentRun(request);
  const checkpointWorkspace = derivedWorkspaceRoot || workspaceRoot;
  const derivedLease = derivedWorkspaceRoot
    ? await service.acquireAgentCheckpointRunLeases([derivedWorkspaceRoot]) : undefined;
  const store = new AgentRunStateStore(service.agentCheckpointRoot(checkpointWorkspace));
  await mkdir(service.agentCheckpointRoot(checkpointWorkspace), { recursive: true });
  const checkpointId = await store.save({
    version: 1, runId, nextTurn: 1, segment: 1,
    messages: [{ role: 'user', content: 'cross-process-checkpoint-sentinel' }],
    seenToolCallIds: [], usage: { inputTokens: 1, outputTokens: 0 },
    toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString(),
  }, { workspaceRoot: checkpointWorkspace, conversationId, rootRunId: runId, depth: 0 });
  process.stdout.write(`${JSON.stringify({ type: 'ready', checkpointId, path: join(service.agentCheckpointRoot(checkpointWorkspace), 'run-state', `${checkpointId}.json`) })}\n`);
  process.stdin.resume();
  process.stdin.once('data', async () => {
    try {
      await service.cancelAgentRun(runId);
      await service.agentJobs.get(runId)?.completion;
      await derivedLease?.release();
      process.stdout.write(`${JSON.stringify({ type: 'stopped' })}\n`);
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    }
  });
} catch (error) {
  if (error?.code) {
    process.stdout.write(`${JSON.stringify({ type: 'rejected', code: error.code })}\n`);
    process.exitCode = 0;
  } else {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
