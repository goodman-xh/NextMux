import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeAgentEventPollSnapshot } from '../lib/browser/nextmux-agent-event-poll.js';

const at = '2026-08-31T00:00:00.000Z';

test('a truncated backend journal preserves visible activity and reports one localized recoverable gap', () => {
  const visible = [{
    type: 'assistant_progress', turn: 1, content: '正在读取项目。', origin: 'model', at
  }];
  const retained = [{
    type: 'tool_completed', callId: 'typecheck', toolName: 'process.run', ok: false,
    summary: { title: 'typecheck failed', details: ['exit code 1'] }, durationMs: 20, at
  }];

  const first = mergeAgentEventPollSnapshot(visible, 2, {
    events: retained,
    firstEventIndex: 7,
    nextEventIndex: 8,
    updatedAt: Date.parse(at)
  }, 'zh-CN');

  assert.equal(first.gapDetected, true);
  assert.equal(first.cursor, 8);
  assert.equal(first.events[0], visible[0], 'already-rendered activity must retain identity and order');
  assert.equal(first.events.at(-1), retained[0], 'retained failure records must remain visible');
  assert.equal(first.events.filter(event => event.type === 'assistant_progress'
    && event.origin === 'runtime'
    && /较早.*执行记录.*压缩.*恢复/.test(event.content)).length, 1);

  const repeated = mergeAgentEventPollSnapshot(first.events, 2, {
    events: retained,
    firstEventIndex: 7,
    nextEventIndex: 8,
    updatedAt: Date.parse(at)
  }, 'zh-CN');
  assert.equal(repeated.events.length, first.events.length, 'the same journal gap must be idempotent');
});

test('an empty truncated window still advances the cursor and does not become a tool or queue record', () => {
  const result = mergeAgentEventPollSnapshot([], 3, {
    events: [],
    firstEventIndex: 9,
    nextEventIndex: 9,
    updatedAt: Date.parse(at)
  }, 'en');

  assert.equal(result.cursor, 9);
  assert.equal(result.gapDetected, true);
  assert.deepEqual(result.events.map(event => event.type), ['assistant_progress']);
  assert.match(result.events[0].content, /Earlier execution records were compacted.*recovered/i);
});

test('continuous and stale snapshots append normally without regressing the cursor', () => {
  const incoming = [{ type: 'assistant_progress', turn: 2, content: 'Running tests.', origin: 'model', at }];
  const continuous = mergeAgentEventPollSnapshot([], 4, {
    events: incoming,
    firstEventIndex: 0,
    nextEventIndex: 5,
    updatedAt: Date.parse(at)
  }, 'en');
  assert.equal(continuous.gapDetected, false);
  assert.equal(continuous.cursor, 5);
  assert.deepEqual(continuous.events, incoming);

  const stale = mergeAgentEventPollSnapshot(continuous.events, 5, {
    events: [],
    firstEventIndex: 0,
    nextEventIndex: 4,
    updatedAt: Date.parse(at)
  }, 'en');
  assert.equal(stale.cursor, 5);
  assert.equal(stale.events, continuous.events);
});
