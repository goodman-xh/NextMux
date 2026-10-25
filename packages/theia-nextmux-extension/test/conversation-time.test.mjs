import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationTimeLabel, formatConversationTime } from '../lib/browser/nextmux-conversation-time.js';

const now = Date.UTC(2026, 7, 29, 8, 0, 0);

test('relative conversation times follow the selected interface locale', () => {
    assert.equal(formatConversationTime('en', now - 2 * 60_000, now), '2 minutes ago');
    assert.equal(formatConversationTime('zh-CN', now - 2 * 60_000, now), '2分钟前');
    assert.equal(formatConversationTime('ja', now - 2 * 60_000, now), '2 分前');
    assert.equal(formatConversationTime('en', now - 10_000, now), 'now');
    assert.equal(formatConversationTime('zh-CN', now - 10_000, now), '刚刚');
    assert.equal(formatConversationTime('zh-TW', now - 10_000, now), '剛剛');
});

test('conversation timing labels localize chrome without touching the title', () => {
    assert.equal(conversationTimeLabel('en', 'started', now - 60_000, now), 'Conversation started: 1 minute ago');
    assert.equal(conversationTimeLabel('zh-CN', 'latest', now - 60_000, now), '最近一条于: 1分钟前');
});
