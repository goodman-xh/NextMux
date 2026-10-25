import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AgentDelegationRuntime, AgentToolRegistry, type AgentDelegateOutput } from '../lib/index.js';

// The parent's verified token allowance gates every new child, durable or not; an already completed (paid) child
// result is still returned so crash recovery never strands finished work.
const exhausted = { inputTokens: 0, outputTokens: 0, usageKnown: false, remainingInputTokens: 1_000, remainingOutputTokens: 1_000 };
const binding = () => ({ scopeId: `scope-${randomUUID()}`, admissionId: `admit-${randomUUID()}`, operationId: `op-${randomUUID()}`,
  originalToolCallId: 'delegation-call', logicalParentOperationId: 'parent-task' });

test('a plain delegation is refused before any child work when the parent has no verified allowance', async () => {
  let calls = 0;
  const runtime = new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async () => { calls += 1; return { content: 'done' }; } } });
  await assert.rejects(runtime.handler({ task: 'Check one file' }, { runId: 'parent-plain-0001', remainingTokenBudget: exhausted }),
    { code: 'TOKEN_BUDGET_EXHAUSTED' });
  assert.equal(calls, 0);
});

test('a durable child that already completed is returned even without allowance; a new durable child is refused', async () => {
  const childRunId = `child-${randomUUID()}`;
  const cachedResult = { status: 'completed', runId: childRunId, invocationKey: 'paid-child', finalText: 'Child finished.',
    usage: { inputTokens: 4, outputTokens: 2 }, usageKnown: true } as unknown as AgentDelegateOutput;
  let began = 0;
  const durable = (cached: boolean) => ({ admit: async () => ({ childRunId, invocationKey: 'paid-child', ...(cached ? { cachedResult } : {}),
    begin: async () => { began += 1; }, release: async () => {}, abortBeforeStart: async () => {}, complete: async () => {},
    commitChildCheckpoint: async () => assert.fail('no checkpoint') }) });
  const runtime = (cached: boolean) => new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async () => assert.fail('no new child') }, durable: durable(cached) as never });
  const replay = await runtime(true).handler({ task: 'Finish the report' }, { runId: 'parent-durable-0001', durableCall: binding(), remainingTokenBudget: exhausted });
  assert.equal((replay.modelOutput as AgentDelegateOutput).finalText, 'Child finished.');
  await assert.rejects(runtime(false).handler({ task: 'Finish the report' }, { runId: 'parent-durable-0002', durableCall: binding(), remainingTokenBudget: exhausted }),
    { code: 'TOKEN_BUDGET_EXHAUSTED' });
  assert.equal(began, 0, 'a refused child never begins');
});

test('the delegated task is trimmed before it becomes the child goal', async () => {
  let prompt = '';
  const runtime = new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async request => { prompt = request.messages.at(-1)?.content ?? ''; return { content: 'ok' }; } } });
  await runtime.handler({ task: '   Summarize README   \n' }, { runId: 'parent-trim-0001' });
  assert.equal(prompt.includes('   Summarize README'), false);
  assert.match(prompt, /Summarize README/);
});

test('a follow-up to the same specialist continues its session; an unknown session says it started over', async () => {
  const seen: string[][] = [];
  const runtime = new AgentDelegationRuntime({ tools: new AgentToolRegistry(), allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async request => { seen.push(request.messages.map(message => `${message.role}:${message.content}`)); return { content: `reply ${seen.length}` }; } } });
  const first = (await runtime.handler({ task: 'Review module A' }, { runId: 'parent-session-0001' })).modelOutput as AgentDelegateOutput;
  assert.equal(first.sessionContinued, undefined);
  const second = (await runtime.handler({ task: 'Now also check module B', sessionId: first.runId }, { runId: 'parent-session-0001' })).modelOutput as AgentDelegateOutput;
  assert.equal(second.sessionContinued, true);
  assert.ok(seen[1].some(message => message.includes('Review module A')), 'the earlier task is part of the continued session');
  assert.ok(seen[1].some(message => message === 'assistant:reply 1'), 'and so is the specialist\'s earlier reply');
  assert.match(seen[1].at(-1)!, /Now also check module B/);
  const unknown = (await runtime.handler({ task: 'Continue the review', sessionId: 'child-unknown-0001' }, { runId: 'parent-session-0001' })).modelOutput as AgentDelegateOutput;
  assert.equal(unknown.sessionContinued, false, 'the parent is told the child started over');
  assert.equal(seen[2].some(message => message.includes('Review module A')), false);
});
