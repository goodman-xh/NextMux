import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventBuffer } from '../lib/node/nextmux-agent-event-buffer.js';

test('agent event cursors remain absolute when old live output is evicted', () => {
    const buffer = new AgentEventBuffer({ maximumEntries: 3, maximumWeight: 100 });
    buffer.append({ value: 'one' }, 10);
    buffer.append({ value: 'two' }, 10);
    buffer.append({ value: 'three' }, 10);
    buffer.append({ value: 'four' }, 10);

    assert.deepEqual(buffer.snapshot(0), {
        events: [{ value: 'two' }, { value: 'three' }, { value: 'four' }],
        firstEventIndex: 1,
        nextEventIndex: 4
    });
    assert.deepEqual(buffer.snapshot(3), {
        events: [{ value: 'four' }],
        firstEventIndex: 1,
        nextEventIndex: 4
    });
});

test('long polling wakes as soon as a live event is appended', async () => {
    const buffer = new AgentEventBuffer({ maximumEntries: 8, maximumWeight: 1_000 });
    const startedAt = Date.now();
    const waiting = buffer.waitForChange(0, 1_000, () => true);
    setTimeout(() => buffer.append({ value: 'live-log-line' }, 20), 25);

    await waiting;
    assert.ok(Date.now() - startedAt < 500, 'append should wake the waiter instead of waiting for the poll timeout');
    assert.deepEqual(buffer.snapshot(0).events, [{ value: 'live-log-line' }]);
});

test('terminal state changes wake long polling even without another event', async () => {
    const buffer = new AgentEventBuffer({ maximumEntries: 8, maximumWeight: 1_000 });
    const startedAt = Date.now();
    const waiting = buffer.waitForChange(0, 1_000, () => true);
    setTimeout(() => buffer.wake(), 25);

    await waiting;
    assert.ok(Date.now() - startedAt < 500);
    assert.deepEqual(buffer.snapshot(0).events, []);
});
