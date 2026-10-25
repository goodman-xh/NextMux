import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import ts from 'typescript';
import './helpers/platform-service-source-loader.mjs';

// The preloader compiles current TS in memory; no generated lib/ files are changed.
const { NextMuxPlatformServiceImpl } = await import('../lib/node/nextmux-platform-service.js');

const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');

test('agent runtime exposes a permissioned local conversation creation tool', () => {
  assert.match(source, /name: 'nextmux\.create_conversation'/);
  assert.match(source, /requiredPermission: 'workspace_write'/);
  assert.match(source, /executionKind: 'side_effect'/);
  assert.match(source, /idempotencyKey: \{ type: 'string'/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /CONVERSATION_IDEMPOTENCY_CONFLICT/);
  assert.match(source, /idempotent: true/);
  assert.match(source, /this\.patchConversationHistory\(\{ upserts: \[\{/);
  assert.match(source, /workspacePath: workspaceRoot/);
});

test('model tool call is locally executable and idempotent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-create-conversation-'));
  const workspace = join(root, 'project');
  const state = join(root, 'state');
  await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true }));

  class FixtureService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return state; }
    register(registry, workspaceRoot) { return this.registerConversationTools(registry, workspaceRoot); }
  }
  const service = new FixtureService();
  const registry = new AgentToolRegistry();
  service.register(registry, workspace);
  assert.ok(registry.descriptors('full_access').some(tool => tool.name === 'nextmux.create_conversation'));
  const call = (id, args, permission = 'workspace_write') => registry.execute({ id, name: 'nextmux.create_conversation', arguments: args }, permission, { runId: 'create-conversation-test' });
  const first = await call('create-1', { title: '模型创建的对话', idempotencyKey: 'retry-1' });
  const second = await call('create-2', { title: '模型创建的对话', idempotencyKey: 'retry-1' }, 'full_access');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.output.conversationId, second.output.conversationId);
  assert.equal(second.output.idempotent, true);
  const conflict = await call('create-3', { title: '另一个标题', idempotencyKey: 'retry-1' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'CONVERSATION_IDEMPOTENCY_CONFLICT');
});

test('model conversation tool retains normal history after a legacy disabled-history preference', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-create-conversation-privacy-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true }));

  class FixtureService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    register(registry) { this.registerConversationTools(registry, workspace); }
  }
  const service = new FixtureService();
  const registry = new AgentToolRegistry();
  service.register(registry);
  const settings = await service.getPrivacySettings();
  // Normal history is now always enabled; private conversations use the separate
  // incognito flow. A legacy false preference is normalized by the public API.
  const normalized = await service.savePrivacySettings({ ...settings, saveConversationHistory: false });
  assert.equal(normalized.saveConversationHistory, true);
  const execute = () => registry.execute({ id: 'privacy-off-create', name: 'nextmux.create_conversation',
    arguments: { title: 'Normal conversation', idempotencyKey: 'privacy-off' } }, 'workspace_write', { runId: 'create-conversation-privacy-test' });
  const allowed = await execute();
  assert.equal(allowed.ok, true);
  const sessions = (await service.loadConversationHistory()).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, allowed.output.conversationId);
});

async function dispatchFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-create-conversation-prompt-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const runningSessions = [];
  class FixtureService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'state'); }
    register(context) { this.registerConversationTools(registry, workspace, context); }
    async startAgentRun(request) {
      requests.push(request);
      runningSessions.push(await this.readConversationHistorySession(request.conversationId));
      const runId = `created-conversation-run-${requests.length}`;
      this.agentJobs.set(runId, {
        completion: Promise.resolve(),
        result: {
          status: 'completed', finalText: '已在新对话完成任务',
          route: { modelFamily: 'Fixture model', providerName: 'Fixture provider' },
          turns: 1, toolCalls: 0, usage: { inputTokens: 12, outputTokens: 8 },
          stopReason: 'completed', events: []
        }
      });
      return { runId };
    }
  }
  const service = new FixtureService();
  const registry = new AgentToolRegistry();
  const call = (args, permission = 'workspace_write') => registry.execute({
    id: `create-prompt-${requests.length}`, name: 'nextmux.create_conversation', arguments: args
  }, permission, { runId: 'parent-conversation-run' });
  return { service, registry, workspace, requests, runningSessions, call };
}

function parentRequest(workspaceRoot, route) {
  return {
    conversationId: 'parent-conversation', workbench: 'coding', workspaceRoot,
    route, prompt: '原对话的任务', history: [{ role: 'user', content: '原对话记录' }],
    permissionMode: 'full_access', maxTurns: 7,
    queuedRequestId: 'parent-queued-request', startToken: 'parent-start-token',
    issuedAt: 123, resumeCheckpointId: 'parent-checkpoint',
    childContinuation: { childRunId: 'parent-child' }
  };
}

for (const [name, route, routeId] of [
  ['official', { kind: 'official_connection', connectionId: 'official-connection', model: 'fixture/model' },
    'official:official-connection:fixture%2Fmodel'],
  ['managed fixed', { kind: 'managed_gateway', conversationId: 'parent-conversation', route: { mode: 'fixed', offeringId: 'offering-1' } },
    'managed:fixed:offering-1'],
  ['managed automatic', { kind: 'managed_gateway', conversationId: 'parent-conversation', route: { mode: 'auto', registryModelId: 'model-1' } },
    'managed:auto:model-1']
]) {
  test(`create_conversation prompt dispatches one ${name} turn in the owning workspace`, async t => {
    const f = await dispatchFixture(t);
    const request = parentRequest(f.workspace, route);
    const original = structuredClone(request);
    f.service.register({ request, permissionMode: 'workspace_write', signal: new AbortController().signal });
    const descriptor = f.registry.descriptors('workspace_write').find(tool => tool.name === 'nextmux.create_conversation');
    assert.deepEqual(descriptor.inputSchema.properties.prompt, { type: 'string', minLength: 1, maxLength: 40000 });
    assert.deepEqual(descriptor.inputSchema.required, ['title']);

    const result = await f.call({ title: '新任务', prompt: '  检查当前项目并报告结果\n', idempotencyKey: 'initial-turn' });
    assert.equal(result.ok, true);
    assert.equal(f.requests.length, 1);
    const dispatched = f.requests[0];
    const id = result.output.conversationId;
    assert.notEqual(id, request.conversationId);
    assert.equal(dispatched.conversationId, id);
    assert.equal(dispatched.workspaceRoot, f.workspace);
    assert.equal(result.output.workspacePath, f.workspace);
    assert.equal(dispatched.prompt, '检查当前项目并报告结果');
    assert.equal(dispatched.permissionMode, 'workspace_write');
    assert.equal(dispatched.workbench, 'coding');
    assert.equal(dispatched.maxTurns, request.maxTurns);
    assert.deepEqual(dispatched.history, []);
    for (const field of ['queuedRequestId', 'startToken', 'issuedAt', 'resumeCheckpointId', 'childContinuation']) {
      assert.equal(dispatched[field], undefined, `${field} must not resume the parent run`);
    }
    assert.deepEqual(dispatched.route, route.kind === 'managed_gateway' ? { ...route, conversationId: id } : route);
    assert.deepEqual(request, original, 'dispatch must preserve the parent request');

    const running = f.runningSessions[0];
    assert.equal(running.id, id);
    assert.equal(running.workspacePath, f.workspace);
    assert.equal(running.turns.length, 1);
    assert.equal(running.turns[0].stage, 'running');
    assert.equal(running.turns[0].prompt, dispatched.prompt);
    assert.equal(running.turns[0].routeId, routeId);
    const saved = await f.service.readConversationHistorySession(id);
    assert.equal(saved.turns.length, 1);
    assert.equal(saved.turns[0].id, result.output.messageId);
    assert.equal(saved.turns[0].stage, 'complete');
    assert.equal(saved.turns[0].response, '已在新对话完成任务');
    assert.equal(result.output.status, 'completed');
    assert.equal(result.output.response, saved.turns[0].response);
    assert.equal(result.output.runId, 'created-conversation-run-1');
  });
}

test('create_conversation dispatch uses the registered workspace and does not rerun an idempotent prompt', async t => {
  const f = await dispatchFixture(t);
  const request = parentRequest(join(f.workspace, 'unrelated-parent-folder'), {
    kind: 'official_connection', connectionId: 'official-connection', model: 'fixture'
  });
  f.service.register({ request, permissionMode: 'workspace_write' });
  const args = { title: '幂等任务', prompt: '执行一次', idempotencyKey: 'same-prompt' };
  const first = await f.call(args);
  const second = await f.call(args);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].workspaceRoot, f.workspace);
  assert.equal(second.output.conversationId, first.output.conversationId);
  assert.equal(second.output.messageId, first.output.messageId);
  assert.equal(second.output.idempotent, true);
  assert.equal(second.output.response, first.output.response);
});

test('create_conversation without a nonblank prompt creates no turn and starts no run', async t => {
  const f = await dispatchFixture(t);
  f.service.register({ request: parentRequest(f.workspace, {
    kind: 'official_connection', connectionId: 'official-connection', model: 'fixture'
  }), permissionMode: 'workspace_write' });
  for (const [name, args] of [['omitted', {}], ['blank', { prompt: ' \n\t ' }]]) {
    const result = await f.call({ title: `空对话 ${name}`, ...args });
    assert.equal(result.ok, true);
    assert.equal(result.output.workspacePath, f.workspace);
    assert.equal(result.output.messageId, undefined);
    const saved = await f.service.readConversationHistorySession(result.output.conversationId);
    assert.deepEqual(saved.turns, []);
  }
  assert.deepEqual(f.requests, []);
});

test('create_conversation prompt without dispatch context is saved as queued without executing', async t => {
  const f = await dispatchFixture(t);
  f.service.register();
  const result = await f.call({ title: '等待执行', prompt: '稍后执行此任务' });
  assert.equal(result.ok, true);
  assert.equal(result.output.status, 'queued');
  assert.equal(result.output.runId, undefined);
  assert.deepEqual(f.requests, []);
  const saved = await f.service.readConversationHistorySession(result.output.conversationId);
  assert.equal(saved.workspacePath, f.workspace);
  assert.equal(saved.turns.length, 1);
  assert.equal(saved.turns[0].id, result.output.messageId);
  assert.equal(saved.turns[0].prompt, '稍后执行此任务');
  assert.equal(saved.turns[0].response, '');
});

test('root agent registration forwards its request, workspace, effective permission and cancellation signal', () => {
  const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
  let registration;
  function visit(node) {
    if (ts.isIfStatement(node) && ts.isExpressionStatement(node.thenStatement)) {
      const call = node.thenStatement.expression;
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
        && call.expression.name.text === 'registerConversationTools') registration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(registration, 'root conversation registration must be present');
  const register = new Function('childContinuation', 'tools', 'workspaceRoot', 'request', 'effectivePermissionMode', 'execution',
    ts.transpile(registration.getText(file), { target: ts.ScriptTarget.ES2022 }));
  const calls = [];
  const owner = { registerConversationTools: (...args) => calls.push(args) };
  const registry = new AgentToolRegistry();
  const request = { conversationId: 'parent', workspaceRoot: '/owning-project' };
  const signal = new AbortController().signal;
  register.call(owner, undefined, registry, '/owning-project', request, 'workspace_write', { signal });
  assert.deepEqual(calls, [[registry, '/owning-project', { request, permissionMode: 'workspace_write', signal }]]);
  register.call(owner, { childRunId: 'child' }, registry, '/child-project', request, 'workspace_write', { signal });
  assert.equal(calls.length, 1, 'child continuations cannot create root conversations');
});
