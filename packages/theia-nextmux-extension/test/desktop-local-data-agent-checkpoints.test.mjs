import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ActiveAgentFixture extends NextMuxPlatformServiceImpl {
  constructor(dataRoot) { super(); this.dataRoot = dataRoot; }
  nextmuxDataRoot() { return this.dataRoot; }
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
  completion(runId) { return this.agentJobs.get(runId)?.completion; }
}

class PausedClearFixture extends ActiveAgentFixture {
  constructor(dataRoot) {
    super(dataRoot);
    this.entered = new Promise(resolve => { this.signalEntered = resolve; });
    this.released = new Promise(resolve => { this.release = resolve; });
  }
  async removeLocalDataTree(target) {
    this.signalEntered();
    await this.released;
    return super.removeLocalDataTree(target);
  }
}

class DirectAgentFixture extends ActiveAgentFixture {
  constructor(dataRoot) {
    super(dataRoot);
    this.entered = new Promise(resolve => { this.signalEntered = resolve; });
    this.released = new Promise(resolve => { this.release = resolve; });
  }
  async executeAgentRun(request, execution) {
    if (execution) return super.executeAgentRun(request, execution);
    this.signalEntered();
    await this.released;
    return { status: 'completed', events: [], finalText: '', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

const request = workspaceRoot => ({
  route: { kind: 'official_connection', connectionId: 'connection-test-001' },
  workbench: 'coding', prompt: 'test', workspaceRoot, conversationId: randomUUID(),
  permissionMode: 'workspace_write',
});

test('clearing agent checkpoints is refused while an agent owns that workspace', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-active-checkpoint-clear-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const service = new ActiveAgentFixture(join(sandbox, 'profile'));
  await mkdir(workspaceRoot);
  const { runId } = await service.startAgentRun(request(workspaceRoot));
  const checkpoint = join(service.agentCheckpointRoot(workspaceRoot), 'keep-while-running');
  await mkdir(service.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(checkpoint, 'resume state');

  await assert.rejects(
    service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] }),
    { code: 'LOCAL_DATA_BUSY' },
  );
  assert.equal(await readFile(checkpoint, 'utf8'), 'resume state');

  await service.cancelAgentRun(runId);
  await service.completion(runId);
  const cleared = await service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] });
  assert.equal(cleared.entries.find(entry => entry.category === 'agent_checkpoints')?.files, 0);
});

test('clearing a secondary root is refused while a multi-root agent owns it', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-secondary-checkpoint-clear-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const primary = join(sandbox, 'primary'), secondary = join(sandbox, 'secondary');
  const service = new ActiveAgentFixture(join(sandbox, 'profile'));
  await Promise.all([mkdir(primary), mkdir(secondary)]);
  const { runId } = await service.startAgentRun({
    ...request(primary),
    workspaceBindings: [
      { id: 'primary', path: primary, permissionMode: 'workspace_write' },
      { id: 'secondary', path: secondary, permissionMode: 'workspace_write' },
    ],
  });
  const checkpoint = join(service.agentCheckpointRoot(secondary), 'keep-while-running');
  await mkdir(service.agentCheckpointRoot(secondary), { recursive: true });
  await writeFile(checkpoint, 'secondary resume state');

  await assert.rejects(
    service.clearDesktopLocalData({ workspaceRoot: secondary, categories: ['agent_checkpoints'] }),
    { code: 'LOCAL_DATA_BUSY' },
  );
  assert.equal(await readFile(checkpoint, 'utf8'), 'secondary resume state');
  await service.cancelAgentRun(runId);
  await service.completion(runId);
});

test('starting an agent is refused until checkpoint clearing has finished', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-checkpoint-clear-race-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const service = new PausedClearFixture(join(sandbox, 'profile'));
  await mkdir(workspaceRoot);
  await mkdir(service.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(join(service.agentCheckpointRoot(workspaceRoot), 'old-checkpoint'), 'old');

  const clearing = service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] });
  await service.entered;
  try {
    await assert.rejects(service.startAgentRun(request(workspaceRoot)), { code: 'PROJECT_BUSY' });
  } finally {
    service.release();
  }
  await clearing;
  const { runId } = await service.startAgentRun(request(workspaceRoot));
  await service.cancelAgentRun(runId);
  await service.completion(runId);
});

test('checkpoint clearing blocks a private-conversation run without an explicit workspace root', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-private-checkpoint-clear-race-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const service = new PausedClearFixture(join(sandbox, 'profile'));
  const conversationId = randomUUID();
  const workspaceRoot = await service.getConversationWorkspace(conversationId);
  await mkdir(service.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(join(service.agentCheckpointRoot(workspaceRoot), 'old-checkpoint'), 'old');

  const clearing = service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] });
  await service.entered;
  const attempted = await service.startAgentRun({ ...request(undefined), conversationId })
    .then(async ({ runId }) => {
      await service.cancelAgentRun(runId);
      await service.completion(runId);
      return { code: 'ACCEPTED' };
    }, error => error);
  service.release();
  await clearing;
  assert.equal(attempted.code, 'PROJECT_BUSY');
});

test('direct agent RPC also protects its implicit private workspace while running', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-direct-agent-checkpoint-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const service = new DirectAgentFixture(join(sandbox, 'profile'));
  const conversationId = randomUUID();
  const workspaceRoot = await service.getConversationWorkspace(conversationId);
  const checkpoint = join(service.agentCheckpointRoot(workspaceRoot), 'keep-while-running');
  await mkdir(service.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(checkpoint, 'direct run resume state');

  const running = service.runAgent({ ...request(undefined), conversationId });
  await service.entered;
  try {
    await assert.rejects(
      service.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] }),
      { code: 'LOCAL_DATA_BUSY' },
    );
    assert.equal(await readFile(checkpoint, 'utf8'), 'direct run resume state');
  } finally {
    service.release();
    await running;
  }
});

test('another backend connection cannot clear a running agent checkpoint', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-cross-connection-checkpoint-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const profile = join(sandbox, 'profile');
  const a = new ActiveAgentFixture(profile), b = new ActiveAgentFixture(profile);
  await mkdir(workspaceRoot);
  const { runId } = await a.startAgentRun(request(workspaceRoot));
  const checkpoint = join(a.agentCheckpointRoot(workspaceRoot), 'keep-across-connections');
  await mkdir(a.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(checkpoint, 'running checkpoint');
  try {
    await assert.rejects(b.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] }),
      { code: 'LOCAL_DATA_BUSY' });
    await assert.rejects(b.deleteProjectConversationHistory(workspaceRoot), { code: 'PROJECT_BUSY' });
    assert.equal(await readFile(checkpoint, 'utf8'), 'running checkpoint');
  } finally {
    await a.cancelAgentRun(runId);
    await a.completion(runId);
  }
});

test('checkpoint clearing in one connection blocks a new agent in another', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-cross-connection-clear-race-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const profile = join(sandbox, 'profile');
  const clearingService = new PausedClearFixture(profile), runningService = new ActiveAgentFixture(profile);
  await mkdir(workspaceRoot);
  await mkdir(clearingService.agentCheckpointRoot(workspaceRoot), { recursive: true });
  await writeFile(join(clearingService.agentCheckpointRoot(workspaceRoot), 'old'), 'old');
  const clearing = clearingService.clearDesktopLocalData({ workspaceRoot, categories: ['agent_checkpoints'] });
  await clearingService.entered;
  try {
    const result = await runningService.startAgentRun(request(workspaceRoot)).then(async ({ runId }) => {
      await runningService.cancelAgentRun(runId);
      await runningService.completion(runId);
      return { code: 'ACCEPTED' };
    }, error => error);
    assert.equal(result.code, 'PROJECT_BUSY');
  } finally {
    clearingService.release();
    await clearing;
  }
});

test('project history deletion in one connection blocks a new agent in another', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-cross-connection-project-delete-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const workspaceRoot = join(sandbox, 'project');
  const profile = join(sandbox, 'profile');
  const deletingService = new ActiveAgentFixture(profile), runningService = new ActiveAgentFixture(profile);
  await mkdir(workspaceRoot);
  const entered = new Promise(resolve => { deletingService.signalDeleteEntered = resolve; });
  const released = new Promise(resolve => { deletingService.releaseDelete = resolve; });
  const store = deletingService.conversationStore();
  const original = store.deleteProject.bind(store);
  store.deleteProject = async path => {
    deletingService.signalDeleteEntered();
    await released;
    return original(path);
  };
  const deleting = deletingService.deleteProjectConversationHistory(workspaceRoot);
  await entered;
  try {
    await assert.rejects(runningService.startAgentRun(request(workspaceRoot)), { code: 'PROJECT_BUSY' });
  } finally {
    deletingService.releaseDelete();
    await deleting;
  }
});
