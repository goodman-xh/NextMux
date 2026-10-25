import assert from 'node:assert/strict';
import test from 'node:test';
import { compactedConversationHistory, historyIndexOfTurnRequest } from '../lib/browser/nextmux-conversation-branch.js';

// The conversation note rides in the user message of the turn that last delivered it. Each request finds that message
// in the history built for it; when the turn is gone (summarized), the note and its images are delivered again.
const turn = (id, prompt, extra = {}) => ({ id, prompt, response: `reply to ${id}`, stage: 'complete', ...extra });
const history = turns => compactedConversationHistory(turns, { recentTurns: 10, mergeConsecutiveUser: true });

test('the delivering request is found even with notes after it, which a whole-message comparison misses', () => {
    const turns = [
        turn('t1', 'Fix the login form'),
        turn('t2', 'Use the note above', { relayFeedback: 'down',
            steeringMessages: [{ id: 's1', content: 'also keep the old API', status: 'applied' }] }),
        turn('t3', 'Run the tests')
    ];
    const messages = history(turns);
    const index = historyIndexOfTurnRequest(messages, turns, 't2');
    assert.ok(index >= 0);
    assert.ok(messages[index].content.startsWith('Use the note above\n\n'));
    // The message carries the steering direction and the feedback note, so it is not the request alone.
    assert.notEqual(messages[index].content.trim(), 'Use the note above');
});

test('a short request asked again later is told apart from the turn that delivered the note', () => {
    const turns = [turn('t1', 'Start the migration'), turn('t2', '继续'), turn('t3', 'Check the logs'), turn('t4', '继续')];
    const messages = history(turns);
    const first = historyIndexOfTurnRequest(messages, turns, 't2');
    const second = historyIndexOfTurnRequest(messages, turns, 't4');
    assert.equal(messages[first].content, '继续');
    assert.ok(first < second, 'the earlier 继续 is the earlier message');
    assert.equal(messages.filter(message => message.role === 'user' && message.content === '继续').length, 2);
    // A prefix match would have taken a later "ok then…" message for a turn that said "ok".
    const okTurns = [turn('t1', 'ok'), turn('t2', 'ok then, deploy it')];
    const okMessages = history(okTurns);
    assert.equal(okMessages[historyIndexOfTurnRequest(okMessages, okTurns, 't1')].content, 'ok');
});

test('the first verbatim request behind the memory is found, and a summarized one reads as gone', () => {
    const turns = Array.from({ length: 14 }, (_, index) => turn(`t${index}`, `Request number ${index}`));
    const messages = history(turns);
    assert.ok(messages[0].content.startsWith('Earlier conversation memory'));
    // The memory and the first verbatim request are merged into one user message, joined by a blank line.
    const first = Number(/\n\nRequest number (\d+)\n\n|\n\nRequest number (\d+)$/.exec(messages[0].content)?.slice(1).find(Boolean));
    assert.ok(first > 0);
    assert.equal(historyIndexOfTurnRequest(messages, turns, `t${first}`), 0);
    // The turn before it is only a line of the memory now.
    assert.ok(messages[0].content.includes(`user: Request number ${first - 1}`));
    assert.equal(historyIndexOfTurnRequest(messages, turns, `t${first - 1}`), -1);
    assert.equal(historyIndexOfTurnRequest(messages, turns, 't0'), -1);
    assert.equal(historyIndexOfTurnRequest(messages, turns, 'missing'), -1);
});

test('a turn left out of the context is not found, and a left-out repeat does not shift the count', () => {
    const turns = [turn('t1', 'Draft the email'), turn('t2', 'Draft the email', { excludedFromContext: true }), turn('t3', 'Send it')];
    const messages = history(turns);
    assert.equal(historyIndexOfTurnRequest(messages, turns, 't2'), -1);
    assert.equal(messages[historyIndexOfTurnRequest(messages, turns, 't1')].content, 'Draft the email');
});
