import assert from 'node:assert/strict';
import test from 'node:test';
import { finalTextAlreadyInActivity, activityWithSteeringMessages, completedNarrationSourceIndexes } from '../lib/browser/nextmux-agent-activity.js';

const at = n => `2026-09-19T12:00:${String(n).padStart(2, '0')}.000Z`;
const message = { id: 'direction-1', content: '先修工具', createdAt: at(3) };

test('steering acknowledgement is placed after existing output and before later output', () => {
    const events = [
        { type: 'model_started', turn: 1, at: at(1) },
        { type: 'assistant_delta', turn: 1, delta: '正在检查。', at: at(2) },
        { type: 'assistant_delta', turn: 1, delta: '继续。', at: at(4) },
    ];
    const journal = activityWithSteeringMessages(events, [message]);
    assert.deepEqual(journal.map(event => event.type), ['model_started', 'assistant_delta', 'steering_accepted', 'assistant_delta']);
    assert.equal(events.length, 3, 'never mutate durable history');
    assert.equal(journal[2].message.id, message.id);
    assert.deepEqual(activityWithSteeringMessages(journal, [message]), journal, 'later polling does not duplicate the bubble');
});

test('persisted acceptance stays in its original journal position when applied later', () => {
    const events = [
        { type: 'assistant_delta', turn: 1, delta: '之前的回复', at: at(2) },
        { type: 'steering_accepted', message, at: at(3) },
        { type: 'assistant_delta', turn: 1, delta: '正在完成当前工具', at: at(4) },
        { type: 'steering_applied', message, turn: 2, at: at(5) },
    ];
    assert.equal(activityWithSteeringMessages(events, [{ ...message, status: 'applied' }]), events);
});

test('resuming with model turn numbers starting at one does not duplicate the final reply', () => {
    const events = [
        { type: 'model_started', turn: 1, at: at(1) },
        { type: 'assistant_delta', turn: 1, delta: '先读文件', at: at(2) },
        { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(3) },
        { type: 'backend_selected', backendId: 'restored-run', attempt: 1, at: at(4) },
        { type: 'model_started', turn: 1, at: at(5) },
        { type: 'assistant_delta', turn: 1, delta: '完成了', at: at(6) },
        { type: 'model_completed', turn: 1, toolCallCount: 0, at: at(7) },
    ];
    assert.deepEqual([...completedNarrationSourceIndexes(events)], [1]);
});

test('interrupted prose survives when the resumed run starts', () => {
    const events = [
        { type: 'model_started', turn: 2, at: at(1) },
        { type: 'assistant_delta', turn: 2, delta: '已检查的结果', at: at(2) },
        { type: 'backend_selected', backendId: 'resume', attempt: 1, at: at(4) },
        { type: 'model_started', turn: 1, at: at(5) },
        { type: 'assistant_delta', turn: 1, delta: '最终结果', at: at(6) },
    ];
    assert.deepEqual([...completedNarrationSourceIndexes(events)], [1]);
});


test('pause result echo is detected only for the last visible model segment', () => {
    const events = [
        { type: 'model_started', turn: 1, at: at(1) },
        { type: 'assistant_delta', turn: 1, delta: '正在读取文件。', at: at(2) },
        { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(3) },
    ];
    assert.equal(finalTextAlreadyInActivity(events, '正在读取文件。'), true);
    assert.equal(finalTextAlreadyInActivity(events, '读取已经完成。'), false);
    const final = [...events,
        { type: 'model_started', turn: 2, at: at(4) },
        { type: 'assistant_delta', turn: 2, delta: '读取已经完成。', at: at(5) },
        { type: 'model_completed', turn: 2, toolCallCount: 0, at: at(6) },
    ];
    assert.equal(finalTextAlreadyInActivity(final, '读取已经完成。'), false);
});
