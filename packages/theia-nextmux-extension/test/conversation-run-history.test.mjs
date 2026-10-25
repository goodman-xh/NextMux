import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationRunHistoryDetail, conversationRunHistoryPage } from '../lib/node/nextmux-conversation-run-history.js';

test('run history projects persisted turns without exposing branch-only placeholders', () => {
  const session = {
    id: 'conversation-1',
    turns: [
      { id: 'turn-complete', createdAt: 10, completedAt: 20, stage: 'complete', events: [{ type: 'model_delta', text: 'ok' }] },
      { id: 'turn-paused', createdAt: 30, stage: 'paused', events: [] },
      { id: 'branch-placeholder', createdAt: 40, stage: 'complete', branchUserOnly: true }
    ]
  };
  const page = conversationRunHistoryPage(session, 'conversation-1', undefined, 20);
  assert.deepEqual(page.runs.map(run => [run.runId, run.status]), [
    ['turn-paused', 'paused'],
    ['turn-complete', 'completed']
  ]);
  assert.equal(conversationRunHistoryPage(session, 'other-conversation').runs.length, 0);
  const detail = conversationRunHistoryDetail(session, 'conversation-1', 'turn-complete');
  assert.equal(detail?.events[0].type, 'model_delta');
  assert.equal(conversationRunHistoryDetail(session, 'conversation-1', 'branch-placeholder'), undefined);
});
