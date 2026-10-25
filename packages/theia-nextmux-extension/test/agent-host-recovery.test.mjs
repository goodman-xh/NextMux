import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map();
function visit(node) { if (ts.isMethodDeclaration(node) && ['persistAcceptedAgentHost', 'reconcileInterruptedAgentRun'].includes(node.name.getText(ast))) methods.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.size, 2);
const Harness = new Function('normalizeDesktopFailure', 'desktopFailureMessage', 'appendAgentActivityEvents', ts.transpile(`class Harness { ${[...methods.values()].join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))((_locale, failure) => ({ ...failure }), (_locale, failure) => failure.message, (prior, incoming) => [...prior, ...incoming]);
function fixture(root = 'logical-old') {
  const host = new Harness(), turn = { id: 'turn', stage: 'running', ...(root ? { agentRootRunId: root } : {}) };
  host.codingSessions = [{ id: 'session', turns: [turn] }]; host.flushes = 0;
  host.updateCodingTurn = (sessionId, turnId, patch) => { assert.equal(sessionId, 'session'); assert.equal(turnId, 'turn'); Object.assign(turn, patch); };
  host.flushConversationHistory = async () => { host.flushes++; };
  return { host, turn, run: { activeAgentRunId: 'accepted-new', agentPollGeneration: 5 } };
}
test('a resumed host is durably recorded while the logical child-agent root stays unchanged', async () => {
  const f = fixture(); await f.host.persistAcceptedAgentHost('session', 'turn', 'accepted-new', 5, f.run);
  assert.equal(f.turn.agentHostRunId, 'accepted-new'); assert.equal(f.turn.agentRootRunId, 'logical-old'); assert.equal(f.host.flushes, 1);
});
test('a first accepted job records both identities before polling can continue', async () => {
  const f = fixture(''); let release, flushed = false;
  f.host.flushConversationHistory = () => new Promise(resolve => { release = () => { flushed = true; resolve(); }; });
  let settled = false; const pending = f.host.persistAcceptedAgentHost('session', 'turn', 'accepted-new', 5, f.run).then(() => { settled = true; });
  assert.equal(f.turn.agentRootRunId, 'accepted-new'); assert.equal(f.turn.agentHostRunId, 'accepted-new'); assert.equal(settled, false);
  release(); await pending; assert.equal(flushed, true); assert.equal(settled, true);
});
test('late accepted replies cannot replace another generation, job, or latest turn', async () => {
  for (const changed of ['generation', 'job', 'latest', 'stopped']) {
    const f = fixture();
    if (changed === 'generation') f.run.agentPollGeneration = 6;
    if (changed === 'job') f.run.activeAgentRunId = 'different';
    if (changed === 'latest') f.host.codingSessions[0].turns.push({ id: 'replacement', stage: 'running' });
    if (changed === 'stopped') f.turn.stage = 'cancelled';
    await f.host.persistAcceptedAgentHost('session', 'turn', 'accepted-new', 5, f.run);
    assert.equal(f.turn.agentHostRunId, undefined); assert.equal(f.host.flushes, 0); assert.equal(f.turn.agentRootRunId, 'logical-old');
  }
});

function recoveryFixture() {
  const f = fixture(); f.host.desktopLocale = 'en'; f.host.activeCodingSessionId = 'session'; f.host.activeThreadTurnId = 'turn';
  f.host.codingSessions[0].workspacePath = '/fixture';
  f.turn.events = [{ type: 'tool_started', callId: 'call-owned' }, { type: 'tool_completed', callId: 'call-owned' }];
  f.host.conversationAgentRuns = new Map([['session', { agentStage: 'running', activeAgentRunId: '', submitting: false }]]);
  f.host.requeueUnreadDirections = () => {}; f.host.update = () => {}; f.host.recordManagedPriceEvents = () => {};
  f.rpc = [];
  f.snapshot = { runId: 'accepted-new', status: 'interrupted', events: [], pendingMessages: [], error: { code: 'AGENT_RUN_INTERRUPTED', message: 'Interrupted', resumable: true, resumeCheckpointId: 'latest-checkpoint' } };
  f.host.platformService = { async getAgentRunSnapshot(...args) { f.rpc.push(args); return f.snapshot; } };
  return f;
}
test('a restored spinner resolves through exact owned recovery rather than blocking its own reconciliation', async () => {
  const f = recoveryFixture(); await f.host.reconcileInterruptedAgentRun('session');
  assert.deepEqual(f.rpc, [['logical-old', 0, 0, { conversationId: 'session', workspaceRoot: '/fixture', logicalRootRunId: 'logical-old', toolCallIds: ['call-owned'] }]]);
  assert.equal(f.turn.stage, 'error'); assert.equal(f.turn.agentHostRunId, 'accepted-new'); assert.equal(f.turn.resumeCheckpointId, 'latest-checkpoint');
  assert.equal(f.turn.agentRootRunId, 'logical-old'); assert.equal(f.host.agentStage, 'error'); assert.equal(f.host.flushes, 1);
});
test('an explicitly stored host uses the existing direct snapshot path, preserving its logical root', async () => {
  const f = recoveryFixture(); f.turn.agentHostRunId = 'accepted-new'; await f.host.reconcileInterruptedAgentRun('session');
  assert.deepEqual(f.rpc, [['accepted-new', 0, 0, undefined]]); assert.equal(f.turn.agentRootRunId, 'logical-old');
});
test('a previously rejected legacy recovery can be rechecked without retrying another model error', async () => {
  const f = recoveryFixture(); f.turn.stage = 'error'; f.turn.failure = { code: 'AGENT_RUN_NOT_RECOVERABLE', resumable: false };
  await f.host.reconcileInterruptedAgentRun('session');
  assert.equal(f.rpc.length, 1); assert.equal(f.turn.agentHostRunId, 'accepted-new'); assert.equal(f.turn.resumeCheckpointId, 'latest-checkpoint');
  for (const code of ['PLATFORM_REQUEST_FAILED', 'MODEL_REQUEST_FAILED', 'AGENT_RUN_INTERRUPTED']) {
    const unrelated = recoveryFixture(); unrelated.turn.stage = 'error'; unrelated.turn.failure = { code };
    await unrelated.host.reconcileInterruptedAgentRun('session'); assert.equal(unrelated.rpc.length, 0);
  }
});
test('a journaled but unsettled tool start is preserved without manufacturing a result or repeating settled events', async () => {
  const f = recoveryFixture(); f.snapshot.events = [
    { type: 'tool_started', callId: 'call-owned' }, { type: 'tool_completed', callId: 'call-owned', ok: true },
    { type: 'tool_started', callId: 'unsettled-call', toolName: 'process.start' }
  ];
  await f.host.reconcileInterruptedAgentRun('session');
  assert.equal(f.turn.events.length, 3); assert.equal(f.turn.events.at(-1).callId, 'unsettled-call');
  assert.equal(f.turn.events.filter(event => event.callId === 'unsettled-call' && event.type === 'tool_completed').length, 0);
  assert.equal(f.turn.failure.resumable, true); assert.equal(f.rpc.length, 1);
});
test('real renderer preparation or live ownership is never reconciled as an orphaned history spinner', async () => {
  for (const key of ['submitting', 'activeAgentRunId', 'agentStartController']) {
    const f = recoveryFixture(); f.host.conversationAgentRuns.get('session')[key] = key === 'activeAgentRunId' ? 'live-job' : true;
    await f.host.reconcileInterruptedAgentRun('session'); assert.equal(f.rpc.length, 0); assert.equal(f.turn.stage, 'running');
  }
});
test('a late recovered snapshot cannot overwrite a newly accepted host for the same turn', async () => {
  const f = recoveryFixture(); let release;
  f.host.platformService.getAgentRunSnapshot = () => new Promise(resolve => { release = resolve; });
  const pending = f.host.reconcileInterruptedAgentRun('session');
  f.host.codingSessions[0].turns[0] = { ...f.turn, agentHostRunId: 'newer-live-host' };
  release(f.snapshot); await pending;
  assert.equal(f.host.codingSessions[0].turns[0].agentHostRunId, 'newer-live-host'); assert.equal(f.host.codingSessions[0].turns[0].stage, 'running'); assert.equal(f.host.flushes, 0);
});
test('late recovery cannot replace a newer failure or a newly claimed live run', async () => {
  for (const change of ['failure', 'live']) {
    const f = recoveryFixture(); f.turn.stage = 'error'; f.turn.failure = { code: 'AGENT_RUN_NOT_RECOVERABLE' };
    let release; f.host.platformService.getAgentRunSnapshot = () => new Promise(resolve => { release = resolve; });
    const pending = f.host.reconcileInterruptedAgentRun('session');
    if (change === 'failure') f.turn.failure = { code: 'WALLET_BALANCE_INSUFFICIENT' };
    else f.host.conversationAgentRuns.get('session').submitting = true;
    release(f.snapshot); await pending; assert.equal(f.turn.agentHostRunId, undefined); assert.equal(f.host.flushes, 0);
  }
});
