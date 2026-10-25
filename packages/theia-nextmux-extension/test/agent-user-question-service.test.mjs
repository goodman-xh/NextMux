import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentUserInputBroker } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { AgentEventBuffer } from '../lib/node/nextmux-agent-event-buffer.js';

class QuestionService extends NextMuxPlatformServiceImpl {
  seed(runId, taskId) {
    const controller = new AbortController();
    const events = new AgentEventBuffer({ maximumEntries: 32, maximumWeight: 32_768 });
    const userInput = new AgentUserInputBroker({ runId, taskId, onEvent: event => events.append(event, 256) });
    const job = { runId, controller, events, userInput, pendingMessages: [], children: new Map(), startedAt: Date.now(), updatedAt: Date.now(), status: 'running', cancelRequested: false };
    this.agentJobs.set(runId, job);
    return job;
  }
}

test('actual question RPC and snapshots isolate the waiter from normal messages, tasks and runs', async t => {
  const service = new QuestionService();
  const first = service.seed('agent-question-first', 'conversation-one');
  const second = service.seed('agent-question-second', 'conversation-two');
  t.after(() => { first.controller.abort(); second.controller.abort(); });
  const waiting = first.userInput.request({ prompt: 'Choose', options: [{ id: 'yes', label: 'Yes' }] }, first.controller.signal);
  let snapshot = await service.getAgentRunSnapshot(first.runId);
  const question = snapshot.pendingQuestion;
  assert.ok(question);
  assert.equal(snapshot.status, 'running');
  const message = await service.sendAgentRunMessage(first.runId, 'This is a future task, not an answer');
  assert.equal(message.accepted, false);
  assert.equal(message.disposition, 'follow_up');
  assert.deepEqual(first.pendingMessages, []);
  assert.equal(first.userInput.pendingQuestion.questionId, question.questionId);
  await assert.rejects(service.answerAgentRunQuestion({ ...question, runId: second.runId, text: 'wrong run' }), { code: 'USER_QUESTION_OWNER_MISMATCH' });
  await assert.rejects(service.answerAgentRunQuestion({ ...question, taskId: 'conversation-two', text: 'wrong task' }), { code: 'USER_QUESTION_OWNER_MISMATCH' });
  assert.deepEqual(await service.answerAgentRunQuestion({ ...question, text: 'Custom answer' }), { accepted: true });
  assert.deepEqual(await waiting, { status: 'answered', answer: { text: 'Custom answer' } });
  first.status = 'completed';
  assert.deepEqual(await service.answerAgentRunQuestion({ ...question, text: 'Custom answer' }), { accepted: true, replayed: true });
  await assert.rejects(service.answerAgentRunQuestion({ ...question, text: 'Changed answer' }), { code: 'USER_ANSWER_CONFLICT' });
  snapshot = await service.getAgentRunSnapshot(first.runId);
  assert.equal(snapshot.pendingQuestion, undefined);
  assert.equal(snapshot.events.filter(event => event.type === 'user_input_resolved').length, 1);
});

test('cancelling or restarting the owning run rejects old answers without consuming queued directions', async t => {
  const service = new QuestionService();
  const job = service.seed('agent-question-cancel', 'conversation-one');
  t.after(() => job.controller.abort());
  const queued = { id: 'message-existing', content: 'existing direction', createdAt: new Date().toISOString() };
  job.pendingMessages.push(queued);
  const waiting = job.userInput.request({ prompt: 'Choose' }, job.controller.signal);
  const question = job.userInput.pendingQuestion;
  await service.cancelAgentRun(job.runId);
  assert.deepEqual(await waiting, { status: 'cancelled' });
  assert.deepEqual(job.pendingMessages, [queued]);
  await assert.rejects(service.answerAgentRunQuestion({ ...question, text: 'too late' }), { code: 'USER_QUESTION_STALE' });
  const restarted = new QuestionService();
  await assert.rejects(restarted.answerAgentRunQuestion({ ...question, text: 'old process' }), { code: 'USER_QUESTION_STALE' });
});
