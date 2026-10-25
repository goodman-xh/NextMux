import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConversationPersistenceCommit,
  conversationPersistenceChanges,
  conversationPersistenceNeedsFollowUp,
  createConversationPersistenceBaseline,
} from '../lib/browser/nextmux-conversation-persistence.js';

const session = (id, version = 1) => ({ id, version });

test('conversation persistence only upserts sessions whose immutable record changed', () => {
  const first = session('first');
  const second = session('second');
  const baseline = createConversationPersistenceBaseline([first, second]);
  const updated = session('first', 2);

  const changes = conversationPersistenceChanges([updated, second], baseline);

  assert.deepEqual(changes.upserts, [updated]);
  assert.deepEqual(changes.removedSessionIds, []);
});

test('conversation persistence reports durable removals but ignores create-then-delete records', () => {
  const durable = session('durable');
  const baseline = createConversationPersistenceBaseline([durable]);
  const transient = session('transient');

  assert.deepEqual(conversationPersistenceChanges([durable, transient], baseline).upserts, [transient]);
  assert.deepEqual(conversationPersistenceChanges([durable], baseline), {
    upserts: [],
    removedSessionIds: [],
  });
  assert.deepEqual(conversationPersistenceChanges([], baseline), {
    upserts: [],
    removedSessionIds: ['durable'],
  });
});

test('committing an in-flight snapshot does not hide a newer renderer mutation', () => {
  const original = session('one');
  const submitted = session('one', 2);
  const newer = session('one', 3);
  const baseline = createConversationPersistenceBaseline([original]);
  const submittedChanges = conversationPersistenceChanges([submitted], baseline);

  applyConversationPersistenceCommit(baseline, submittedChanges);

  assert.deepEqual(conversationPersistenceChanges([newer], baseline).upserts, [newer]);
  assert.deepEqual(conversationPersistenceChanges([submitted], baseline).upserts, []);
});

test('a mutation during an async flush schedules one follow-up without retrying unchanged failures', () => {
  assert.equal(conversationPersistenceNeedsFollowUp(8, 7, true, true, true), true);
  assert.equal(conversationPersistenceNeedsFollowUp(7, 7, true, true, true), false);
  assert.equal(conversationPersistenceNeedsFollowUp(8, 7, true, false, true), false);
  assert.equal(conversationPersistenceNeedsFollowUp(8, 7, true, true, false), false);
  assert.equal(conversationPersistenceNeedsFollowUp(8, 7, false, true, true), false);
});
