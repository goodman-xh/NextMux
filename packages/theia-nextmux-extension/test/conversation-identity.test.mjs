import assert from 'node:assert/strict';
import test from 'node:test';
import { compactConversationId } from '../lib/browser/nextmux-conversation-identity.js';

test('conversation IDs remain distinguishable without exposing an unreadable full UUID in the action row', () => {
    assert.equal(compactConversationId('5f32dc11-96d9-46f8-a2b5-be3f64ef63a9'), '5f32dc11…63a9');
    assert.equal(compactConversationId('queue-owner-b-1788021025661'), 'queue-ow…5661');
    assert.equal(compactConversationId('short-id'), 'short-id');
    assert.equal(compactConversationId('   '), '—');
});
