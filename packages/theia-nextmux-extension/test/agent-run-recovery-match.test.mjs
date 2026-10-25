import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(new URL('../lib/node/nextmux-agent-run-journal.js', import.meta.url));
function actualModule(name) {
    const source = readFileSync(new URL('../src/node/' + name + '.ts', import.meta.url), 'utf8'), module = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, module, module.exports);
    return module.exports;
}
const { matchingInterruptedRootRunId, exactRecoveryToolCallIds, sameRecoveryToolCallIds, sameRecoveryWorkspace } = actualModule('nextmux-agent-run-recovery-match');
const { AgentRunJournalStore } = actualModule('nextmux-agent-run-journal');
const oldRun = 'agent-original-root', hostRun = 'agent-continuation-host';
const ids = Array.from({ length: 24 }, (_, index) => 'call-owned-' + index);
const hint = { conversationId: 'conversation-owned', workspaceRoot: '/fixture/owned', logicalRootRunId: oldRun, toolCallIds: ids };
function candidate() {
    const owner = { workspaceRoot: hint.workspaceRoot, conversationId: hint.conversationId, rootRunId: hostRun, depth: 0 };
    return { journal: { schemaVersion: 1, runId: hostRun, owner, workbench: 'coding', permissionMode: 'workspace_write', state: 'running', checkpointId: 'resume-11111111-1111-4111-8111-111111111111', createdAt: 1, updatedAt: 2 },
        journalToolCallIds: [...ids], checkpointOwner: { ...owner }, checkpoint: { runId: hostRun, seenToolCallIds: [...ids, 'internal-plan-1', 'internal-plan-2'],
            taskContext: { workspaceRoot: hint.workspaceRoot, conversationId: hint.conversationId, rootRunId: oldRun, depth: 0 } } };
}
test('exact logical root and24 journal calls recover one26-seen continuation host, never the stale zero-tool root', () => {
    const stale = candidate(); stale.journal.runId = oldRun; stale.journal.owner.rootRunId = oldRun; stale.checkpointOwner.rootRunId = oldRun; stale.checkpoint.runId = oldRun; stale.journalToolCallIds = []; stale.checkpoint.seenToolCallIds = [];
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [stale, candidate()]), hostRun);
});
for (const [name, mutate] of [
    ['different logical root', c => { c.checkpoint.taskContext.rootRunId = 'agent-other-logical-root'; }],
    ['foreign conversation', c => { c.journal.owner.conversationId = 'conversation-foreign'; }],
    ['different workspace', c => { c.checkpointOwner.workspaceRoot = '/fixture/foreign'; }],
    ['different bindings identity', c => { c.journal.owner.workspaceBindingsKey = 'a'.repeat(64); c.checkpointOwner.workspaceBindingsKey = 'b'.repeat(64); }],
    ['child continuation', c => { c.journal.childContinuation = {}; c.journal.owner.depth = 1; }],
    ['checkpoint owner has another host', c => { c.checkpointOwner.rootRunId = oldRun; }],
    ['checkpoint payload has another host', c => { c.checkpoint.runId = oldRun; }],
    ['missing journal call', c => { c.journalToolCallIds.pop(); }],
    ['extra journal call', c => { c.journalToolCallIds.push('call-from-another-turn'); }],
    ['missing checkpoint replay guard', c => { c.checkpoint.seenToolCallIds.shift(); }]
]) test('continuation matching refuses ' + name, () => { const c = candidate(); mutate(c); assert.equal(matchingInterruptedRootRunId(oldRun, hint, [c]), undefined); });
test('two exact host candidates remain ambiguous regardless of timestamps', () => {
    const a = candidate(), b = candidate(); b.journal.runId = 'agent-second-host'; b.journal.owner.rootRunId = b.journal.runId; b.checkpointOwner.rootRunId = b.journal.runId; b.checkpoint.runId = b.journal.runId; b.journal.updatedAt = 999999;
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [a, b]), undefined);
});
function abandonedStartCandidate() {
    const value = candidate();
    value.journalToolCallIds.push('call-abandoned');
    value.journalEvents = [...ids.map(callId => ({ type: 'tool_completed', callId })), { type: 'tool_started', callId: 'call-abandoned' }];
    return value;
}
test('checkpoint-covered calls identify one host with a later abandoned start without treating it as settled', () => {
    const value = abandonedStartCandidate();
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [value]), hostRun);
    assert.equal(value.checkpoint.seenToolCallIds.includes('call-abandoned'), false);
    assert.equal(value.journalEvents.at(-1).type, 'tool_started');
});
test('an uncheckpointed completion, process acceptance, output or duplicate start cannot be inferred as an abandoned start', () => {
    for (const type of ['tool_completed', 'tool_process_started', 'tool_process_exited', 'tool_output', 'tool_started']) {
        const value = abandonedStartCandidate(); value.journalEvents.push({ type, callId: 'call-abandoned' });
        assert.equal(matchingInterruptedRootRunId(oldRun, hint, [value]), undefined, type);
    }
});
test('abandoned starts must follow the last explicitly checkpoint-covered journal event', () => {
    const value = abandonedStartCandidate(); value.journalEvents.unshift(value.journalEvents.pop());
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [value]), undefined);
    value.journalEvents = [{ type: 'tool_started', callId: 'call-abandoned' }];
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [value]), undefined);
});
test('checkpoint-aware matching still requires the exact persisted lineage and every abandoned start observation', () => {
    for (const mutate of [value => value.checkpoint.seenToolCallIds.push('call-abandoned'),
        value => value.journalEvents.pop(), value => value.journalToolCallIds.push('call-unobserved'),
        value => { value.checkpoint.taskContext.rootRunId = 'agent-another-logical-root'; }]) {
        const value = abandonedStartCandidate(); mutate(value);
        assert.equal(matchingInterruptedRootRunId(oldRun, hint, [value]), undefined);
    }
});
test('two exact continuation boundaries with abandoned starts remain ambiguous', () => {
    const a = abandonedStartCandidate(), b = abandonedStartCandidate();
    b.journal.runId = 'agent-second-abandoned-host'; b.journal.owner.rootRunId = b.journal.runId;
    b.checkpointOwner.rootRunId = b.journal.runId; b.checkpoint.runId = b.journal.runId;
    assert.equal(matchingInterruptedRootRunId(oldRun, hint, [a, b]), undefined);
});

test('empty, duplicated or malformed tool IDs cannot authorize continuation guessing', () => {
    for (const value of [[], ['duplicate', 'duplicate'], [''], ['call\u0000invalid'], Array(8193).fill('call')]) assert.equal(exactRecoveryToolCallIds(value), undefined);
    assert.equal(matchingInterruptedRootRunId(oldRun, { ...hint, toolCallIds: [] }, [candidate()]), undefined);
});
test('root journal enumeration filters owner metadata and never loads foreign event logs or chooses by age', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-recovery-match-')); t.after(() => rm(root, { recursive: true, force: true }));
    const store = new AgentRunJournalStore(join(root, 'journals')), owned = candidate().journal;
    await store.save(owned); await store.save({ ...owned, updatedAt: 5 });
    await store.save({ ...owned, runId: 'agent-foreign-host', owner: { ...owned.owner, conversationId: 'foreign', rootRunId: 'agent-foreign-host' }, updatedAt: 999 });
    const records = await store.ownedRootRecords({ conversationId: hint.conversationId, workspaceRoot: hint.workspaceRoot });
    assert.deepEqual(records.map(record => record.runId), [hostRun]); assert.equal(records[0].updatedAt, 5);
});

function snapshotClass() {
    const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('platform.ts', source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
    const method = cls.members.find(node => node.name?.getText(ast) === 'getAgentRunSnapshot').getText(ast);
    class PlatformRequestError extends Error { constructor(code, message) { super(message); this.code = code; } }
    return new Function('PlatformRequestError', ts.transpile(`class Service { ${method} } return Service;`, { target: ts.ScriptTarget.ES2022 }))(PlatformRequestError);
}
test('actual getSnapshot matches the continuation before consulting an existing stale journal and keeps old three-argument calls unchanged', async () => {
    const Service = snapshotClass(), value = new Service(), lookups = [];
    value.validateAgentRunId = value => value; value.pruneAgentJobs = () => {}; value.agentJobs = new Map();
    value.matchingInterruptedAgentHostRun = async (id, owner) => { lookups.push('match:' + id); assert.equal(owner, hint); return hostRun; };
    value.recoveredAgentJobSnapshot = async id => { lookups.push('recover:' + id); return { runId: id, status: 'interrupted' }; };
    assert.equal((await value.getAgentRunSnapshot(oldRun, 0, 0, hint)).runId, hostRun);
    assert.deepEqual(lookups, ['match:' + oldRun, 'recover:' + hostRun]);
    lookups.length = 0; assert.equal((await value.getAgentRunSnapshot(oldRun, 0, 0)).runId, oldRun); assert.deepEqual(lookups, ['recover:' + oldRun]);
    value.matchingInterruptedAgentHostRun = async () => { throw new Error('no exact owned continuation'); }; lookups.length = 0;
    await assert.rejects(value.getAgentRunSnapshot(oldRun, 0, 0, hint)); assert.deepEqual(lookups, [], 'failure cannot fall back to the earlier checkpoint');
});

test('actual backend compatibility method binds persisted turn, real workspace, journal events and owned state-store checkpoint', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-owned-host-match-')); t.after(() => rm(root, { recursive: true, force: true }));
    const { createAgentTaskContext } = require('@nextmux/agent-runtime');
    const { AgentRunStateStore, AgentRunStateStoreError } = require('../node/nextmux-agent-run-state-store.js');
    const { resolveAgentWorkspaces } = actualModule('nextmux-agent-workspaces');
    const journal = new AgentRunJournalStore(join(root, 'journals'));
    const stateStore = new AgentRunStateStore(join(root, 'checkpoints'));
    const owner = { workspaceRoot: root, conversationId: hint.conversationId, rootRunId: hostRun, depth: 0 };
    const checkpointId = await stateStore.save({ version: 1, runId: hostRun, nextTurn: 27, segment: 1,
        messages: [{ role: 'user', content: 'isolated fixture task' }], seenToolCallIds: [...ids, 'plan-1', 'plan-2'],
        usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 26, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString(),
        taskContext: createAgentTaskContext({ workspaceRoot: root, conversationId: hint.conversationId, rootRunId: oldRun, depth: 0,
            goal: 'isolated fixture task', allowedToolNames: [], permissionMode: 'workspace_write' }) }, owner);
    await journal.save({ ...candidate().journal, owner, checkpointId, createdAt: Date.now(), updatedAt: Date.now() });
    const events = ids.map(callId => ({ type: 'tool_completed', callId, toolName: 'workspace.read_file', ok: true,
        status: 'succeeded', summary: { title: 'Read fixture', details: [] }, durationMs: 1, at: new Date().toISOString() }));
    for (const event of events) await journal.appendEvent(hostRun, event);
    const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('platform.ts', source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
    const method = cls.members.find(node => node.name?.getText(ast) === 'matchingInterruptedAgentHostRun').getText(ast);
    class PlatformRequestError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const Service = new Function('PlatformRequestError', 'exactRecoveryToolCallIds', 'sameRecoveryToolCallIds', 'matchingInterruptedRootRunId', 'sameRecoveryWorkspace',
        'isAbsolute', 'resolve', 'resolveAgentWorkspaces', 'AgentRunStateStore', 'AgentRunStateStoreError',
        ts.transpile(`class Service { ${method} } return Service;`, { target: ts.ScriptTarget.ES2022 }))(
            PlatformRequestError, exactRecoveryToolCallIds, sameRecoveryToolCallIds, matchingInterruptedRootRunId, sameRecoveryWorkspace,
            isAbsolute, require('node:path').resolve, resolveAgentWorkspaces, AgentRunStateStore, AgentRunStateStoreError);
    const service = new Service();
    service.validateAgentRunId = value => value;
    const session = { workspacePath: root, turns: [{ stage: 'running', agentRootRunId: oldRun, permissionMode: 'workspace_write', events }] };
    service.readConversationHistorySession = async id => id === hint.conversationId ? session : undefined;
    service.agentRunJournalStore = () => journal; service.agentCheckpointRoot = () => join(root, 'checkpoints');
    const ownedHint = { ...hint, workspaceRoot: root };
    assert.equal(await service.matchingInterruptedAgentHostRun(oldRun, ownedHint), hostRun);
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, { ...ownedHint, toolCallIds: ids.slice(1) }), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, { ...ownedHint, conversationId: 'foreign' }), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, { ...ownedHint, workspaceRoot: join(root, 'foreign') }), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    session.turns.unshift({ agentRootRunId: oldRun, stage: 'complete' });
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, ownedHint), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    session.turns.shift();
    const selections = [{ id: 'owned-binding', path: root, permissionMode: 'workspace_write' }];
    const boundScope = await resolveAgentWorkspaces(root, selections, 'workspace_write');
    const boundHost = 'agent-bound-continuation';
    const boundOwner = { ...owner, rootRunId: boundHost, workspaceRoot: boundScope.workspaceRoot, workspaceBindingsKey: boundScope.workspaceBindingsKey };
    const original = await stateStore.load(checkpointId);
    const boundCheckpoint = await stateStore.save({ ...original, runId: boundHost,
        taskContext: { ...original.taskContext, workspaceRoot: boundScope.workspaceRoot } }, boundOwner);
    await journal.save({ ...candidate().journal, runId: boundHost, owner: boundOwner, checkpointId: boundCheckpoint, createdAt: Date.now(), updatedAt: Date.now() });
    for (const event of events) await journal.appendEvent(boundHost, event);
    session.workspaceBindings = [{ id: 'owned-binding', path: root, permission: 'workspace_write' }];
    assert.equal(await service.matchingInterruptedAgentHostRun(oldRun, { ...ownedHint, workspaceRoot: boundScope.workspaceRoot }), boundHost);
    session.workspaceBindings[0].permission = 'read_only';
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, { ...ownedHint, workspaceRoot: boundScope.workspaceRoot }), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    session.workspaceBindings = [];
    session.turns[0].stage = 'error';
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, ownedHint), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    session.turns[0].failure = { code: 'MODEL_REQUEST_FAILED' };
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, ownedHint), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    await journal.appendEvent(hostRun, { type: 'tool_started', callId: 'call-abandoned', toolName: 'process.start', source: 'builtin', at: new Date().toISOString() });
    session.turns[0].failure = { code: 'AGENT_RUN_NOT_RECOVERABLE' };
    assert.equal(await service.matchingInterruptedAgentHostRun(oldRun, ownedHint), hostRun);
    session.turns[0].agentHostRunId = hostRun;
    await assert.rejects(service.matchingInterruptedAgentHostRun(hostRun, ownedHint), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');
    delete session.turns[0].agentHostRunId;
    await journal.appendEvent(hostRun, { type: 'tool_completed', callId: 'call-abandoned', toolName: 'process.start', source: 'builtin', ok: true, status: 'succeeded', summary: { title: 'Fixture process acceptance', details: [] }, durationMs: 1, at: new Date().toISOString() });
    await assert.rejects(service.matchingInterruptedAgentHostRun(oldRun, ownedHint), error => error.code === 'AGENT_RUN_NOT_RECOVERABLE');

});
