import assert from 'node:assert/strict';
import test from 'node:test';
import {
    boundedTimelineScrollTop,
    timelineWheelDelta
} from '../lib/browser/nextmux-thread-timeline.js';

test('timeline wheel units are normalized against the timeline viewport', () => {
    assert.equal(timelineWheelDelta(12, 0, 300), 12);
    assert.equal(timelineWheelDelta(3, 1, 300), 54);
    assert.equal(timelineWheelDelta(2, 2, 300), 600);
});

test('timeline scrolling is bounded without forwarding motion to the conversation', () => {
    assert.equal(boundedTimelineScrollTop({ scrollTop: 25, scrollHeight: 200, clientHeight: 80 }, 40), 65);
    assert.equal(boundedTimelineScrollTop({ scrollTop: 115, scrollHeight: 200, clientHeight: 80 }, 40), 120);
    assert.equal(boundedTimelineScrollTop({ scrollTop: 5, scrollHeight: 200, clientHeight: 80 }, -40), 0);
    assert.equal(boundedTimelineScrollTop({ scrollTop: 0, scrollHeight: 40, clientHeight: 80 }, 40), 0);
});
