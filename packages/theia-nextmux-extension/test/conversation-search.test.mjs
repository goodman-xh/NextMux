import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationIndex } from '../lib/node/nextmux-conversation-index.js';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';

import {
  conversationHistorySearchRecords,
  conversationMessageModelProjection,
  CONVERSATION_ACTIVITY_TEXT_LIMIT,
  CONVERSATION_ACTIVITY_ENTRY_LIMIT,
  searchConversationHistoryRecords,
} from '../lib/node/nextmux-conversation-search.js';

const session = (id, turns) => ({
  id,
  workspacePath: '/workspace/project',
  title: `Conversation ${id}`,
  turns,
  createdAt: 1,
  updatedAt: 10,
});
const turn = (id, prompt, response = '') => ({
  id,
  userMessageId: `${id}-user-message`,
  assistantMessageId: `${id}-assistant-message`,
  prompt, response, error: '', createdAt: 2, completedAt: 3,
});

test('assistant responses, text parts and streamed activity return the conversation and matching snippet', () => {
  const value = session('assistant-content', [{
    ...turn('answer', 'unrelated question', 'Final response: amberquartz.'),
    outputParts: [{ type: 'text', text: 'Text part: cobaltfern.' },
      { type: 'image', asset: { url: 'ignoredasset' } }],
    events: [
      { type: 'assistant_delta', turn: 1, delta: 'Streamed silver' },
      { type: 'assistant_delta', turn: 1, delta: 'willow answer.' },
      { type: 'assistant_progress', content: 'Progress: violetcedar.' },
      { type: 'tool_output', callId: 'tool', stream: 'stdout', chunk: 'Tool: golden' },
      { type: 'tool_output', callId: 'tool', stream: 'stdout', chunk: 'maple.' },
      { type: 'tool_completed', summary: { title: 'Completed copperbirch', details: ['Detail jadepine'] } },
    ],
  }]);
  const records = conversationHistorySearchRecords([value]);
  const index = new ConversationIndex(':memory:');
  try {
    index.begin(); index.upsert(value); index.commit('generation');
    assert.equal(records[0].messages.length, 2);
    assert.equal(records[0].messages[1].response, value.turns[0].response);
    for (const keyword of ['amberquartz', 'cobaltfern', 'silverwillow', 'violetcedar', 'goldenmaple', 'copperbirch', 'jadepine']) {
      for (const candidates of [records, index.searchRecords({ query: keyword })]) {
        const result = searchConversationHistoryRecords(candidates, { query: keyword });
        assert.equal(result.matches[0]?.conversationId, value.id, keyword);
        assert.equal(result.matches[0]?.messageId, 'answer-assistant-message', keyword);
        assert.ok(result.matches[0]?.snippet.includes(keyword), keyword);
      }
    }
    assert.deepEqual(searchConversationHistoryRecords(records, { query: 'ignoredasset' }).matches, []);
  } finally { index.close(); }
});

test('empty, non-text and redundant activities preserve the exact legacy message shape and model projection', () => {
  const original = turn('answer', 'question', 'Same answer');
  const baseline = conversationHistorySearchRecords([session('same', [original])]);
  for (const extra of [
    { outputParts: [null, { type: 'image', text: 'not prose' }], events: [null, { type: 'provider_reasoning', text: 'hidden' }] },
    { outputParts: [{ type: 'text', text: 'Same answer' }], events: [
      { type: 'assistant_delta', delta: 'Same ' }, { type: 'assistant_delta', delta: 'answer' },
      { type: 'assistant_progress', content: 'Same answer' }] },
  ]) {
    assert.deepEqual(conversationHistorySearchRecords([session('same', [{ ...original, ...extra }])]), baseline);
  }
  const [record] = conversationHistorySearchRecords([session('same', [{ ...original,
    outputParts: [{ type: 'text', text: 'Extra assistant prose' }] }])]);
  assert.equal(record.messages.length, 2);
  assert.deepEqual(conversationMessageModelProjection(record.messages[1]), conversationMessageModelProjection(baseline[0].messages[1]));
});

test('activity extraction bounds inspected entries, text and direct search input', () => {
  let partReads = 0, eventReads = 0, detailReads = 0;
  const parts = new Array(1_000_000);
  const events = new Array(1_000_000);
  const details = new Array(1_000_000);
  for (let i = 0; i < CONVERSATION_ACTIVITY_ENTRY_LIMIT; i++) {
    Object.defineProperty(parts, i, { get() { partReads++; return { type: 'image' }; } });
    Object.defineProperty(events, i, { get() { eventReads++; return { type: 'tool_completed', summary: { details } }; } });
  }
  for (let i = 0; i < 32; i++) Object.defineProperty(details, i, { get() { detailReads++; return ''; } });
  for (const array of [parts, events]) Object.defineProperty(array, CONVERSATION_ACTIVITY_ENTRY_LIMIT,
    { get() { throw Error('unbounded entry scan'); } });
  Object.defineProperty(details, 32, { get() { throw Error('unbounded detail scan'); } });
  const [empty] = conversationHistorySearchRecords([session('bounded', [{ ...turn('answer', ''), outputParts: parts, events }])]);
  assert.equal(Object.hasOwn(empty.messages[1], 'activityText'), false);
  assert.equal(partReads, CONVERSATION_ACTIVITY_ENTRY_LIMIT);
  assert.equal(eventReads, CONVERSATION_ACTIVITY_ENTRY_LIMIT);
  assert.ok(detailReads <= 32 * CONVERSATION_ACTIVITY_ENTRY_LIMIT);

  const huge = 'x'.repeat(2 * 1024 * 1024);
  const [record] = conversationHistorySearchRecords([session('bounded', [{ ...turn('answer', ''),
    outputParts: [{ type: 'text', text: `partkeyword ${huge}` }], events: [
      { type: 'tool_output', chunk: `toolkeyword ${huge}` },
      { type: 'assistant_delta', delta: `streamkeyword ${huge}` },
    ] }])]);
  assert.ok(record.messages[1].activityText.length <= CONVERSATION_ACTIVITY_TEXT_LIMIT);
  for (const keyword of ['partkeyword', 'toolkeyword', 'streamkeyword']) {
    assert.ok(searchConversationHistoryRecords([record], { query: keyword }).matches[0].snippet.includes(keyword));
  }
  const unchecked = { ...record, messages: [{ ...record.messages[1], activityText: `${huge}unboundedtail` }] };
  assert.deepEqual(searchConversationHistoryRecords([unchecked], { query: 'unboundedtail' }).matches, []);
});

test('large tool payloads have constant derived SQLite size and bounded indexed prose', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-search-bounds-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sizes = [];
  for (const megabytes of [1, 32]) {
    const path = join(root, `index-${megabytes}.sqlite`);
    const index = new ConversationIndex(path);
    const chunk = `toolneedle ${'工具 output '.repeat(megabytes * 1024 * 1024 / 10)}`;
    const start = performance.now();
    try {
      index.begin();
      index.upsert(session('bounded-disk', [{ ...turn('answer', 'question', 'answer'),
        events: [{ type: 'tool_output', chunk }] }]));
      index.commit('generation');
      const [record] = index.searchRecords({ query: 'toolneedle' });
      assert.ok(record.messages[1].activityText.length <= 4096);
      assert.ok(searchConversationHistoryRecords([record], { query: 'toolneedle' }).matches[0].snippet.includes('toolneedle'));
      const stored = index.db.prepare('SELECT length(search_record) AS size FROM sessions').get();
      const indexed = index.db.prepare('SELECT length(text) AS size FROM search_text').get();
      assert.ok(stored.size < 6000);
      assert.ok(indexed.size < 6000);
    } finally { index.close(); }
    sizes.push((await stat(path)).size);
    t.diagnostic(JSON.stringify({ megabytes, elapsedMs: Math.round(performance.now() - start), sqliteBytes: sizes.at(-1) }));
  }
  assert.equal(sizes[0], sizes[1], 'tool payload growth must not increase derived index size');
  assert.ok(sizes[1] < 256 * 1024);
});

test('activity indexing upgrades existing v3 projections once without rewriting durable history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-search-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = session('upgrade', [{ ...turn('answer', 'question'), outputParts: [{ type: 'text', text: 'migrationneedle' }] }]);
  await new ConversationStore(root).save([value]);
  const manifestBytes = await readFile(join(root, 'manifest-v1.json'));
  const manifest = JSON.parse(manifestBytes);
  const bodyPath = join(root, manifest.sessions[0].file);
  const bodyBytes = await readFile(bodyPath);
  const old = new ConversationIndex(join(root, 'index-v1.sqlite'));
  try {
    old.db.exec("DELETE FROM metadata WHERE key = 'activity_search_version'; DELETE FROM search_text;");
    assert.equal(old.generation(), undefined);
    assert.equal(old.db.prepare("SELECT value FROM metadata WHERE key = 'summary_version'").get().value, '3');
  } finally { old.close(); }
  let bodyReads = 0;
  for (let i = 0; i < 2; i++) {
    const reader = new ConversationStore(root);
    const read = reader.readFile;
    reader.readFile = async (path, ...args) => {
      if (String(path) === bodyPath) bodyReads++;
      return read(path, ...args);
    };
    assert.equal((await reader.search({ query: 'migrationneedle' })).matches[0]?.conversationId, value.id);
    assert.equal(bodyReads, 1, 'only the first search rebuilds the old projection');
  }
  assert.deepEqual(await readFile(join(root, 'manifest-v1.json')), manifestBytes);
  assert.deepEqual(await readFile(bodyPath), bodyBytes);
});

test('durable conversation search keeps every old message instead of the last 500', () => {
  const turns = Array.from({ length: 2_000 }, (_, index) => turn(
    `turn-${index}`,
    index === 10 ? 'needle from the beginning of history' : `prompt-${index}`,
    `response-${index}`
  ));

  const records = conversationHistorySearchRecords([session('conversation-one', turns)]);
  const result = searchConversationHistoryRecords(records, { query: 'needle beginning', limit: 20 });

  assert.equal(records[0].messages.length, 4_000);
  assert.equal(result.matches[0].conversationId, 'conversation-one');
  assert.equal(result.matches[0].turnId, 'turn-10');
  assert.equal(result.matches[0].kind, 'content');
});

test('stable conversation/message locators find exact old messages and steering ids', () => {
  const records = conversationHistorySearchRecords([session('conversation-one', [{
    ...turn('turn-old', 'old prompt'),
    steeringMessages: [{ id: 'steering-old', content: 'adjust direction', createdAt: new Date(4).toISOString() }],
  }])]);

  assert.equal(searchConversationHistoryRecords(records, {
    query: 'nextmux://conversation/conversation-one/message/turn-old-user-message',
  }).matches[0].turnId, 'turn-old');
  assert.equal(searchConversationHistoryRecords(records, {
    conversationId: 'conversation-one', messageId: 'turn-old-assistant-message',
  }).matches[0].messageId, 'turn-old-assistant-message');
  assert.equal(searchConversationHistoryRecords(records, {
    conversationId: 'conversation-one', messageId: 'steering-old',
  }).matches[0].messageId, 'steering-old');
});

test('legacy turn locators remain readable while new records expose distinct real message ids', () => {
  const records = conversationHistorySearchRecords([session('conversation-one', [
    { id: 'legacy-turn', prompt: 'legacy', response: 'reply', error: '', createdAt: 2 },
  ])]);

  assert.deepEqual(records[0].messages.map(message => message.id), [
    'legacy-turn:user', 'legacy-turn:assistant',
  ]);
  assert.equal(searchConversationHistoryRecords(records, {
    query: 'nextmux://conversation/conversation-one/message/legacy-turn',
  }).matches[0].turnId, 'legacy-turn');
});

test('branch ancestry ids stay in the durable search index', () => {
  const records = conversationHistorySearchRecords([{
    ...session('branch', [turn('branch-turn', 'continue')]),
    sourceConversationId: 'source-conversation-id',
    sourceMessageId: 'source-message-id',
  }]);

  assert.equal(records[0].sourceConversationId, 'source-conversation-id');
  assert.equal(records[0].sourceMessageId, 'source-message-id');
  assert.equal(searchConversationHistoryRecords(records, { query: 'source-message-id' }).matches[0].conversationId, 'branch');
});

test('malformed durable records are ignored without truncating healthy records', () => {
  const records = conversationHistorySearchRecords([
    null,
    { id: '', title: 'bad', workspacePath: '', turns: [], createdAt: 0, updatedAt: 0 },
    session('healthy', [turn('healthy-turn', 'healthy text')]),
  ]);

  assert.deepEqual(records.map(record => record.id), ['healthy']);
});

test('search records retain bounded runtime semantics separately from authored text and UI errors', () => {
  const records = conversationHistorySearchRecords([session('semantic', [{
    ...turn('runtime', '用户问题', '本地化系统结束消息'), error: '界面错误',
    stopReason: 'pause_requested', finalMessage: { origin: 'runtime', stopReason: 'pause_requested',
      params: { count: 2, nested: { private: true }, bad: Infinity } },
    failure: { code: 'MODEL_TIMEOUT', kind: 'model_timeout', message: '界面错误' },
  }, {
    ...turn('authored', '用户问题', '模型自己撰写的中文回复'), stopReason: '未知状态',
    finalMessage: { origin: 'model', stopReason: 'pause_requested' }, failure: { code: '中文状态码', kind: 'failed' },
  }])]);
  const [user, runtime, authoredUser, authored] = records[0].messages;
  assert.equal(user.finalMessage, undefined);
  assert.equal(user.stopReason, undefined);
  assert.equal(authoredUser.failure, undefined);
  assert.equal(runtime.response, '本地化系统结束消息');
  assert.equal(runtime.error, '界面错误');
  assert.deepEqual(runtime.finalMessage, { origin: 'runtime', stopReason: 'pause_requested', params: { count: 2 } });
  assert.equal(runtime.stopReason, 'pause_requested');
  assert.deepEqual(runtime.failure, { code: 'MODEL_TIMEOUT', kind: 'model_timeout' });
  assert.equal(authored.response, '模型自己撰写的中文回复');
  assert.equal(authored.finalMessage, undefined);
  assert.equal(authored.stopReason, undefined);
  assert.equal(authored.failure, undefined);
});
