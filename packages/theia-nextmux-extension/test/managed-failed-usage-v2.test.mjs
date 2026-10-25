import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { canRecoverBilling } from '../lib/node/nextmux-billing-recovery.js';
import { ManagedGatewayChargeTotal } from '../lib/node/nextmux-managed-agent-usage.js';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const settled = (overrides = {}) => ({ code: 'upstream_response_invalid', message: 'The model request did not complete', status: 502,
  requestId: id, providerAccepted: true, usageKnown: true, settled: true, recoveryMode: 'none', chargedMicros: 700, currency: 'USD', ...overrides });
const pending = () => ({ code: 'billing_finalization_pending', requestId: id, recoveryMode: 'billing_only', durableEvidence: true, status: 503 });
const ndjson = rows => new Response(rows.map(row => JSON.stringify(row)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
class Service extends NextMuxPlatformServiceImpl {
  constructor(t) {
    super();
    this.root = realpathSync(mkdtempSync(join(tmpdir(), 'nextmux-failed-usage-')));
    t.after(() => rmSync(this.root, { recursive: true, force: true }));
    this.baseUrl = 'https://failed-usage-fixture.invalid';
    this.mediaDeliveryAccountId = 'fixture-user';
  }
  nextmuxDataRoot() { return this.root; }
  async getPrivacySettings() { return {}; }
  async deviceId() { return 'fixture-device-0000001'; }
  managedSessionPool() { return undefined; }
  stream(callbacks = {}) { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'model' }, { messages: [], tools: [], workbench: 'coding' }, 'stable-failed-request', undefined, callbacks); }
  consume(response, callbacks = {}) { return this.consumeManagedGatewayStream(response, callbacks); }
  classify(error) { return this.stableAgentRunError(error); }
}

for (const amount of [0, 700]) test(`settled streaming failure preserves partial output and ${amount} charge without starting receipt recovery`, async t => {
  const service = new Service(t), urls = [], deltas = [], events = [];
  service.networkFetch = async url => {
    urls.push(new URL(url).pathname);
    return ndjson([
      { type: 'response.started', taskId: id }, { type: 'content.delta', taskId: id, delta: 'already generated' },
      { type: 'response.failed', taskId: id, recoveryMode: 'billing_only', partial: true, usageKnown: true, error: { code: 'upstream_response_invalid' } },
      { type: 'error', taskId: id, error: settled({ chargedMicros: amount }) },
    ]);
  };
  await assert.rejects(service.stream({ onTextDelta: text => deltas.push(text), onProviderEvent: event => events.push(event.type) }), error => {
    assert.equal(error.code, 'upstream_response_invalid'); assert.equal(error.status, 502);
    assert.equal(error.partial, true); assert.equal(error.retrySafe, false); assert.equal(error.resumable, false);
    assert.equal(error.requestId, id); assert.equal(error.settled, true); assert.equal(error.usageKnown, true);
    assert.equal(error.billingPending, false); assert.equal(error.recoveryMode, 'none');
    assert.equal(error.chargedMicros, amount); assert.equal(error.currency, 'USD');
    assert.equal(canRecoverBilling(error), false);
    assert.notEqual(service.classify(error).readableError.kind, 'billing_review_required');
    return true;
  });
  assert.deepEqual(urls, ['/api/gateway/responses']); assert.deepEqual(deltas, ['already generated']);
  assert.ok(events.includes('response.failed') && events.includes('billing.completed')); assert.ok(!events.includes('billing.pending'));
});

test('a pending failed receipt that settles stops polling and keeps its original failure and partial state', async t => {
  const service = new Service(t), urls = [], events = [];
  service.networkFetch = async url => {
    urls.push(new URL(url).pathname);
    if (urls.length === 1) return ndjson([{ type: 'content.delta', delta: 'partial' }, { type: 'error', error: pending() }]);
    return Response.json({ code: 'upstream_response_invalid', message: 'The model request did not complete', details: settled() }, { status: 502 });
  };
  await assert.rejects(service.stream({ onProviderEvent: event => events.push(event.type) }), error => {
    assert.equal(error.code, 'upstream_response_invalid'); assert.equal(error.requestId, id); assert.equal(error.partial, true);
    assert.equal(error.settled, true); assert.equal(error.chargedMicros, 700); assert.equal(error.recoveryMode, 'none');
    assert.equal(error.retrySafe, false); assert.notEqual(service.classify(error).readableError.kind, 'billing_review_required');
    return true;
  });
  assert.deepEqual(urls, ['/api/gateway/responses', `/api/gateway/responses/${id}/recover`]);
  assert.ok(events.includes('billing.pending') && events.includes('billing.completed'));
});

test('receipt identity, known usage, amount and currency must all validate before billing review can end', async t => {
  for (const change of [{ requestId: otherId }, { usageKnown: false }, { chargedMicros: -1 }, { chargedMicros: '700' }, { currency: 'usd' }, { settled: undefined }]) {
    const service = new Service(t); let calls = 0;
    service.networkFetch = async () => ++calls === 1 ? ndjson([{ type: 'error', error: pending() }])
      : Response.json({ code: 'upstream_response_invalid', details: settled(change) }, { status: 502 });
    await assert.rejects(service.stream(), error => {
      assert.equal(error.code, 'BILLING_RECOVERY_UNAVAILABLE'); assert.equal(error.requestId, id);
      assert.equal(error.recoveryMode, 'billing_review'); assert.notEqual(error.settled, true); assert.equal(error.retrySafe, false);
      return true;
    });
    assert.equal(calls, 2, 'invalid receipts cannot trigger a new inference');
  }
});

test('a settled stream receipt belonging to another task cannot clear the original task', async t => {
  const service = new Service(t);
  await assert.rejects(service.consume(ndjson([{ type: 'response.started', taskId: id }, { type: 'error', taskId: id, error: settled({ requestId: otherId }) }])), error => {
    assert.equal(error.code, 'BILLING_RECEIPT_MISMATCH'); assert.equal(error.requestId, id); assert.equal(error.recoveryMode, 'billing_review');
    assert.notEqual(error.settled, true); assert.equal(error.retrySafe, false); return true;
  });
});

test('conversation charge totals deduplicate server request receipts and count separately used calls', () => {
  const total = new ManagedGatewayChargeTotal();
  total.record(id, 700, 'USD'); total.record(id, 700, 'USD'); total.record(otherId, 300, 'USD');
  total.record(id, 999, 'USD'); total.record('zero-receipt', 0, 'USD');
  assert.equal(total.chargedMicros, 1000); assert.equal(total.requestCount, 3); assert.equal(total.currency, 'USD');
  for (const invalid of [undefined, NaN, -1, '700', Number.MAX_SAFE_INTEGER + 1]) total.record('unknown', invalid, 'USD');
  total.record('bad-currency', 100, 'usd'); total.record('', 100, 'USD');
  assert.equal(total.chargedMicros, 1000); assert.equal(total.requestCount, 3);
});

test('the actual managed agent failure callback includes settled charges once without converting failure to success', async t => {
  const service = new Service(t); let receiptError;
  await assert.rejects(service.consume(ndjson([{ type: 'error', error: settled() }])), error => { receiptError = error; return true; });
  const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true), candidates = [];
  const visit = node => {
    if (ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements.some(statement =>
      ts.isVariableStatement(statement) && statement.getText(file) === 'const attemptId = `managed-${randomUUID()}`;')) candidates.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(candidates.length, 1);
  const factory = new Function('PlatformRequestError', 'randomUUID', 'managedBilling', 'normalizeModelSwitchPolicyForDispatch',
    'estimateManagedGatewayInputTokens', 'messagesWithToolImages', 'localManagedOutputMessages', 'queuedModelRequestWasRejected', ts.transpile(`
    const execution = {}, request = { workbench: 'coding' }, managedRoute = {}, initialSwitchPolicy = {}, conversationId = 'synthetic';
    const stateConversationId = 'synthetic', backendRunId = 'run'; let modelCalled = false, pendingManagedReceipt;
    const managedRequestIds = [], RELAY_FEEDBACK_MAX_REQUEST_IDS = 100;
    const isRelayFeedbackRequestId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
    return ${candidates[0].getText(file)};
  `, { target: ts.ScriptTarget.ES2022 }));
  const total = new ManagedGatewayChargeTotal(), events = [];
  const complete = factory.call({ contextLimitsForRequest: () => ({}), localConversationDataRoot: () => '/synthetic',
    completeManagedGatewayWithEvents: async () => { throw receiptError; } },
    receiptError.constructor, randomUUID, total, () => ({}), () => 1, messages => messages.map(message => ({ message })),
    async (_root, _owner, messages) => messages, () => false);
  for (let index = 0; index < 2; index++) await assert.rejects(complete({ messages: [], tools: [], instructions: '', onProviderEvent: event => events.push(event) }), error => error === receiptError);
  assert.equal(total.chargedMicros, 700); assert.equal(total.requestCount, 1);
  assert.ok(events.every(event => event.type === 'response.failed'));
});

test('a real builtin agent failure reaches the desktop snapshot and the conversation failure billing label', async t => {
  const { mkdtemp, mkdir, realpath, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { normalizeDesktopFailure } = await import('../lib/browser/nextmux-agent-outcome-locale.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-failed-usage-agent-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'workspace'); await mkdir(workspaceRoot);
  class AgentService extends Service {
    constructor() { super(t); this.computerTools = { register() {} }; this.mcpServerManager = { getServerNames: async () => [] };
      this.skillEnvironment = { getConfigDirUri: async () => pathToFileURL(root).href }; }
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getTerminalRuntime() { return { supportStatus: 'supported', defaultProfileId: 'fixture', profiles: [{ id: 'fixture', label: 'Fixture', shellPath: '/bin/sh', shellArgs: [] }] }; }
    async ensureContextMetadata() {}
    contextLimitsForRequest() { return {}; }
    async githubAgentAccount() {}
    registerConversationTools() {}
    registerBrowserTools() {}
    async registerSkills() {}
    communitySkillsInstallRoot() { return join(root, 'skills'); }
    async agentRunInstructions() { return 'Answer the synthetic test request. Do not use tools.'; }
    completion(runId) { return this.agentJobs.get(runId).completion; }
  }
  const service = new AgentService(); let calls = 0;
  service.networkFetch = async url => {
    if (new URL(url).pathname === '/api/gateway/task-authority/enrollment') return Response.json({ ok: true, protocol: 'task-authority-v1', userId: 'fixture-user', enabled: false });
    assert.equal(new URL(url).pathname, '/api/gateway/responses'); calls++;
    return ndjson([{ type: 'response.started', taskId: id }, { type: 'content.delta', taskId: id, delta: 'already generated' },
      { type: 'response.failed', taskId: id, partial: true, recoveryMode: 'billing_only', error: { code: 'upstream_response_invalid' } },
      { type: 'error', taskId: id, error: settled() }]);
  };
  const { runId } = await service.startAgentRun({ route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'model' } },
    workspaceRoot, conversationId: randomUUID(), workbench: 'coding', permissionMode: 'read_only', prompt: 'Synthetic test' });
  await service.completion(runId);
  const snapshot = await service.getAgentRunSnapshot(runId);
  assert.equal(calls, 1, JSON.stringify(snapshot)); assert.ok(snapshot.error, JSON.stringify(snapshot)); assert.notEqual(snapshot.status, 'completed');
  assert.equal(snapshot.error.code, 'UPSTREAM_RESPONSE_INVALID'); assert.equal(snapshot.error.retrySafe, false);
  assert.deepEqual(snapshot.error.billing, { kind: 'platform', currency: 'USD', chargedMicros: 700, requestCount: 1 });
  assert.ok(snapshot.events.some(event => event.type === 'assistant_delta' && event.delta.includes('already generated')));
  const failure = normalizeDesktopFailure('en', snapshot.error);
  assert.deepEqual(failure.billing, snapshot.error.billing);
  // Execute the real renderer failure patch and label methods with an inert
  // turn sink. No browser, supplier request, or user's conversation is opened.
  const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true), updates = [], methods = new Map();
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'updateCodingTurn'
      && node.arguments[2]?.getText(file).includes('terminalFailure.billing')) updates.push(node.arguments[2]);
    if (ts.isMethodDeclaration(node) && ['platformAgentBillingLabel', 'formatMoneyMicros'].includes(node.name.getText(file))) methods.set(node.name.getText(file), node);
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(updates.length, 1);
  const compileMethod = name => new Function(ts.transpile(`return function${methods.get(name).getText(file).replace(/^protected\s+[A-Za-z]+/, '')};`, { target: ts.ScriptTarget.ES2022 }))();
  const view = { desktopLocale: 'en', liveAgentEvents: snapshot.events, liveAgentChildren: [], agentError: failure.message,
    formatMoneyMicros: compileMethod('formatMoneyMicros'), platformAgentBillingLabel: compileMethod('platformAgentBillingLabel') };
  // The patch also carries the failed reply's relay request IDs (a local of the failure path); none here.
  const patch = new Function('terminalFailure', 'run', 'errorRequestIds', ts.transpile(`return (${updates[0].getText(file)});`, { target: ts.ScriptTarget.ES2022 })).call(view, failure, view, []);
  const savedTurn = { id: 'turn', ...patch };
  assert.equal(savedTurn.stage, 'error'); assert.equal(savedTurn.billingLabel, '$0.0007 · 1 次模型请求');
  assert.deepEqual(savedTurn.failure.billing, snapshot.error.billing);
  assert.ok(savedTurn.events.some(event => event.type === 'assistant_delta'));
  const { ConversationStore } = await import('../lib/node/nextmux-conversation-store.js');
  const historyRoot = join(root, 'conversation-history');
  await new ConversationStore(historyRoot).save([{ id: 'billing-history', workspacePath: workspaceRoot, title: 'Synthetic billing', pinned: false,
    createdAt: 1, updatedAt: Date.now(), turns: [{ prompt: 'Synthetic test', response: '', createdAt: 1, permissionMode: 'read_only',
      routeLabel: '', executionLabel: '', usageLabel: '', ...savedTurn }] }]);
  const restored = await new ConversationStore(historyRoot).load();
  assert.equal(restored.sessions[0].turns[0].billingLabel, savedTurn.billingLabel);
  assert.deepEqual(restored.sessions[0].turns[0].failure.billing, snapshot.error.billing);
});
