import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationMessageTime, latestConversationMessageTime } from '../lib/browser/nextmux-conversation-message-time.js';

const now = Date.UTC(2026, 9, 16, 12);
const hour = 3_600_000;
const turn = { createdAt: now - 6 * hour, completedAt: now - 5 * hour };

test('renaming, drafting, model settings and goal updates never become a message time', () => {
    for (const updatedAt of [now - 3 * hour, now, now + hour]) {
        assert.equal(latestConversationMessageTime({ turns: [turn], createdAt: now - 8 * hour, updatedAt }), now - 5 * hour);
    }
});

test('header-only sidebar and hydrated transcript use the same final message timestamp', () => {
    const header = { historyLoaded: false, turns: [], latestTurn: turn, updatedAt: now };
    const hydrated = { ...header, historyLoaded: true, turns: [turn] };
    assert.equal(latestConversationMessageTime(header), conversationMessageTime(hydrated.turns.at(-1)));
    assert.equal(latestConversationMessageTime(header), latestConversationMessageTime(hydrated));
});

test('empty or cleared histories do not inherit stale latestTurn or metadata timestamps', () => {
    assert.equal(latestConversationMessageTime({ turns: [], latestTurn: turn, updatedAt: now }), undefined);
    assert.equal(latestConversationMessageTime({ historyLoaded: false, turns: [], updatedAt: now }), undefined);
});

test('running and user-only branch messages use their own creation time', () => {
    assert.equal(conversationMessageTime({ createdAt: now }), now);
    assert.equal(conversationMessageTime({ ...turn, branchUserOnly: true }), turn.createdAt);
});

test('the final displayed turn is authoritative even for imported out-of-order timestamps', () => {
    assert.equal(latestConversationMessageTime({ turns: [{ createdAt: now }, turn] }), turn.completedAt);
    assert.equal(conversationMessageTime({ createdAt: now, completedAt: now - hour }), now);
    assert.equal(conversationMessageTime({ createdAt: NaN, completedAt: Infinity }), undefined);
});
