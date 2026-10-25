import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GOAL_SPEND_BUDGET_MICROS, GOAL_TOKEN_BUDGET, extendedGoalBudget, goalBudgetExhausted, goalBudgetLimits, goalSpend, goalTurnDecision, turnRunSpend
} from '../lib/browser/nextmux-goal-runner.js';

// A goal's automatic turns stop at a spending limit (Codex's per-goal budget): platform charges in USD micros, or tokens
// for a route the provider bills directly. Continuing grants as much again.
const platform = (runId, chargedMicros, inputTokens = 1_000, outputTokens = 200) => ({ runId, billing: { kind: 'platform', chargedMicros, requestCount: 1 },
    usage: { inputTokens, outputTokens } });
const blocks = () => false;

test('a run is counted once, and a resumed run adds to the turn it continued', () => {
    const first = turnRunSpend(undefined, platform('run-1', 300_000));
    assert.deepEqual(first, { micros: 300_000, tokens: 1_200, runId: 'run-1', runMicros: 300_000, runTokens: 1_200 });
    // The same run reported again (a repeated completion) replaces its own share instead of adding it twice.
    assert.deepEqual(turnRunSpend(first, platform('run-1', 350_000)), { micros: 350_000, tokens: 1_200, runId: 'run-1', runMicros: 350_000, runTokens: 1_200 });
    // A resumed run of the same turn adds to what the interrupted run spent.
    assert.equal(turnRunSpend(first, platform('run-2', 100_000)).micros, 400_000);
    // A provider billing the user directly costs the platform nothing; its tokens still count.
    assert.deepEqual(turnRunSpend(undefined, { runId: 'byok', billing: { kind: 'provider_direct', chargedMicros: 0, requestCount: 1 }, usage: { inputTokens: 5, outputTokens: 5 } }),
        { micros: 0, tokens: 10, runId: 'byok', runMicros: 0, runTokens: 10 });
    assert.equal(turnRunSpend(undefined, { runId: 'free', usage: { inputTokens: 0, outputTokens: 0 } }), undefined);
    assert.equal(turnRunSpend(undefined, { runId: '', usage: { inputTokens: 9, outputTokens: 9 } }), undefined);
});

test('only the goal\'s own automatic turns since it was set count against its limit', () => {
    const spend = micros => ({ micros, tokens: 10, runId: 'r', runMicros: micros, runTokens: 10 });
    const turns = [
        { stage: 'complete', goalPresentationOrigin: 'automatic-v1', createdAt: 50, spend: spend(9_000_000) },
        { stage: 'complete', goalPresentationOrigin: 'user', createdAt: 150, spend: spend(5_000_000) },
        { stage: 'complete', goalPresentationOrigin: 'automatic-v1', createdAt: 200, spend: spend(4_000_000) },
        { stage: 'complete', goalPresentationOrigin: 'automatic-v1', createdAt: 300, spend: { micros: 'x', tokens: -5 } }
    ];
    assert.deepEqual(goalSpend({ createdAt: 100 }, turns), { micros: 4_000_000, tokens: 10 });
    assert.deepEqual(goalBudgetLimits({ createdAt: 100 }), { micros: GOAL_SPEND_BUDGET_MICROS, tokens: GOAL_TOKEN_BUDGET });
    assert.equal(goalBudgetExhausted({ createdAt: 100 }, turns), false);
    assert.equal(goalBudgetExhausted({ createdAt: 100, budgetMicros: 4_000_000 }, turns), true);
    assert.equal(goalBudgetExhausted({ createdAt: 100, budgetTokens: 10 }, turns), true);
});

test('a goal at its limit pauses where it would have continued; completing or blocking still settles it', () => {
    const working = { stage: 'complete', response: 'Still working.', events: [{ type: 'tool_completed' }] };
    assert.deepEqual(goalTurnDecision([working], blocks, undefined, 1), { kind: 'continue', retry: false });
    assert.deepEqual(goalTurnDecision([working], blocks, undefined, 1, true), { kind: 'pause', reason: 'budget' });
    const failed = { stage: 'error', failure: { kind: 'network', retryable: true, retrySafe: true } };
    assert.deepEqual(goalTurnDecision([failed], blocks, undefined, 1, true), { kind: 'pause', reason: 'budget' });
    const done = { stage: 'complete', response: 'All verified.\n[GOAL_COMPLETE]' };
    assert.deepEqual(goalTurnDecision([done], blocks, undefined, 1, true), { kind: 'complete' });
    const blocked = { stage: 'complete', response: 'Needs credentials.\n[GOAL_BLOCKED]' };
    assert.deepEqual(goalTurnDecision([blocked], blocks, undefined, 1, true), { kind: 'pause', reason: 'blocked' });
});

test('continuing a goal stopped on its budget grants as much again on top of what it spent', () => {
    const turns = [{ stage: 'complete', goalPresentationOrigin: 'automatic-v1', createdAt: 10,
        spend: { micros: 10_400_000, tokens: 3_000_000, runId: 'r', runMicros: 0, runTokens: 0 } }];
    const goal = { createdAt: 1 };
    assert.equal(goalBudgetExhausted(goal, turns), true);
    const raised = extendedGoalBudget(goal, turns);
    assert.deepEqual(raised, { budgetMicros: 10_400_000 + GOAL_SPEND_BUDGET_MICROS, budgetTokens: 3_000_000 + GOAL_TOKEN_BUDGET });
    assert.equal(goalBudgetExhausted({ ...goal, ...raised }, turns), false);
});
