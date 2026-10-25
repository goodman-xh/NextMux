import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { managedAgentUsage } from '../lib/node/nextmux-managed-agent-usage.js';

test('managed agent budgets use context counters independently of billable counters', () => {
  const response = { usage: { inputTokens: 5, outputTokens: 26, usageKnown: true }, contextUsageKnown: true, contextUsage: { inputTokens: 71, outputTokens: 83 } };
  assert.deepEqual(managedAgentUsage(response), { usage: { inputTokens: 71, outputTokens: 83 }, usageKnown: true });
  assert.deepEqual(response.usage, { inputTokens: 5, outputTokens: 26, usageKnown: true });
  assert.match(readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8'), /\.\.\.managedAgentUsage\(gateway\.response\)/);
});

test('missing or malformed separate context counters remain unknown, never substituted by billing', () => {
  const usage = { inputTokens: 5, outputTokens: 26, usageKnown: true };
  for (const fields of [
    { contextUsageKnown: false }, { contextUsageKnown: true },
    { contextUsageKnown: true, contextUsage: { inputTokens: -1, outputTokens: 3 } },
    { contextUsageKnown: true, contextUsage: { inputTokens: 2, outputTokens: 3.5 } },
    { contextUsageKnown: true, contextUsage: { inputTokens: '2', outputTokens: 3 } },
    { contextUsage: { inputTokens: 2, outputTokens: 3 } },
  ]) assert.deepEqual(managedAgentUsage({ usage, ...fields }), { usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: false });
});

test('existing providers retain validated usage semantics including known zero', () => {
  assert.deepEqual(managedAgentUsage({ usage: { inputTokens: 0, outputTokens: 0, usageKnown: true } }), { usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: true });
  assert.equal(managedAgentUsage({ usage: { inputTokens: 3, outputTokens: 1, usageKnown: true } }).usageKnown, true);
  assert.equal(managedAgentUsage({ usage: { inputTokens: 3, outputTokens: 1, usageKnown: false } }).usageKnown, false);
});
