import assert from 'node:assert/strict';
import test from 'node:test';
import { rebaseAgentRunCheckpoint } from '../lib/index.js';
import { buildAgentContinuityMemory } from '../lib/context-memory.js';
import type { AgentModelMessage } from '../lib/types.js';

const marker = 'NEXTMUX_CONTINUITY_V1\n';
const progress = (count: number): AgentModelMessage[] => Array.from({ length: count }, (_, i) => ({
  role: 'assistant', content: `Progress ${i}: ${'ordinary implementation progress '.repeat(20)}`,
}));
function observation(id: string, path: string, content: string): AgentModelMessage[] {
  return [{ role: 'assistant', content: '', toolCalls: [{ id, name: 'workspace.read_file', arguments: { path } }] },
    { role: 'tool', toolCallId: id, content: JSON.stringify({ ok: true, output: { path, sha256: `sha-${id}`, content } }) }];
}

test('narrative progress cannot displace earlier file evidence, including after repeated compression', () => {
  let memory = buildAgentContinuityMemory([
    ...observation('read-auth', 'src/auth.ts', 'export const callback="/v2/oauth/LONG_LIVED_EVIDENCE_AUTH_CALLBACK";'),
    ...progress(20),
  ], undefined);
  for (let cycle = 0; cycle < 8; cycle++) {
    const parsed = JSON.parse(memory.content.slice(marker.length));
    assert.match(parsed.findings.join('\n'), /LONG_LIVED_EVIDENCE_AUTH_CALLBACK/);
    assert.match(parsed.files.join('\n'), /src\/auth.ts/);
    assert.ok(parsed.reports.every((report: string) => report.startsWith('Assistant report (not independent verification):')));
    assert.ok(memory.content.length <= 16000);
    memory = buildAgentContinuityMemory([memory, ...progress(40)], undefined);
  }
});

test('legacy V1 reports migrate without becoming independent verification', () => {
  const old: AgentModelMessage = { role: 'user', content: marker + JSON.stringify({
    goals: ['Do not change authentication'], findings: [
      'workspace.read_file read-old: ok=true\narguments={"path":"auth.ts"}\nresult=callback=/v2/oauth',
      'Assistant report (not independent verification): All tests passed',
    ], files: ['auth.ts sha256=old'], checks: [], failures: ['process.run old-check: ok=true exitCode=1\nFAIL callback'], pending: ['Ship the callback fix'],
  }) + '\n' };
  const result = buildAgentContinuityMemory([old, ...progress(20)], undefined);
  const memory = JSON.parse(result.content.slice(marker.length));
  assert.match(memory.findings.join('\n'), /callback=\/v2\/oauth/);
  assert.doesNotMatch(memory.findings.join('\n'), /All tests passed/);
  assert.match(memory.failures.join('\n'), /exitCode=1/);
  assert.match(memory.goals.join('\n'), /Do not change authentication/);
  assert.match(memory.pending.join('\n'), /Ship the callback fix/);
  assert.equal(old.content.includes('omitted'), false);
});

test('bounded memory retains evidence sections and explicitly carries forward omissions', () => {
  const messages: AgentModelMessage[] = [
    { role: 'user', content: 'CURRENT_GOAL: fix callback; preserve billing.' },
    ...Array.from({ length: 24 }, (_, i) => observation(`read-${i}`, `src/${i}.ts`, `fact-${i} ` + 'code " \\ '.repeat(180))).flat(),
    { role: 'assistant', content: '', toolCalls: [{ id: 'check', name: 'process.run', arguments: { command: 'node', args: ['--test'] } }] },
    { role: 'tool', toolCallId: 'check', content: JSON.stringify({ ok: true, output: { exitCode: 1, stdout: 'FAIL callback routing' } }) },
    ...progress(40),
  ];
  const plan = [{ id: 'fix', title: 'Finish callback fix', status: 'in_progress' as const }];
  const first = buildAgentContinuityMemory(messages, plan, 4000);
  const a = JSON.parse(first.content.slice(marker.length));
  assert.ok(first.content.length <= 4000);
  assert.match(a.goals.join('\n'), /CURRENT_GOAL/);
  assert.match(a.failures.join('\n'), /FAIL callback routing/);
  assert.match(a.pending.join('\n'), /Finish callback fix/);
  assert.ok(a.findings.length > 0);
  assert.ok(a.omitted.findings > 0);
  const second = buildAgentContinuityMemory([first], plan, 4000);
  const b = JSON.parse(second.content.slice(marker.length));
  assert.ok(b.omitted.findings >= a.omitted.findings);
  assert.match(b.note, /Historical evidence/);
  assert.ok(messages.length > 60);
});

test('large escaped output obeys the serialized memory budget', () => {
  for (const budget of [300, 358, 600, 1600, 4000, 16000]) {
    const result = buildAgentContinuityMemory([
      ...observation('huge', 'src/huge.ts', '\\"\n'.repeat(5000)), ...progress(30),
    ], undefined, budget);
    assert.ok(result.content.length <= budget, `${result.content.length} exceeds ${budget}`);
    assert.doesNotThrow(() => JSON.parse(result.content.slice(marker.length)));
  }
});

test('a current task status replaces the stale status in prior memory', () => {
  const original = buildAgentContinuityMemory([], [{ id: 'fix', title: 'Fix callback', status: 'in_progress' }]);
  const updated = buildAgentContinuityMemory([original], [{ id: 'fix', title: 'Fix callback', status: 'completed' }]);
  const memory = JSON.parse(updated.content.slice(marker.length));
  assert.deepEqual(memory.pending, []);
  assert.match(memory.findings.join('\n'), /Plan fix \[completed\]/);
  assert.doesNotMatch(updated.content, /Plan fix \[in_progress\]/);
});

test('continuity pairs each tool result with its preceding call when a later segment reuses the ID', () => {
  // A rebase keeps earlier messages and starts a fresh seenToolCallIds set.
  // Providers may therefore reuse the same call ID in a later segment.
  const rebased = rebaseAgentRunCheckpoint({
    version: 1,
    runId: 'run-old-segment', nextTurn: 2, segment: 1,
    messages: [
      { role: 'user', content: 'Preserve both file observations' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-reused', name: 'workspace.read_file', arguments: { path: 'src/old.ts' } }] },
      { role: 'tool', toolCallId: 'call-reused', content: JSON.stringify({ ok: true, output: { content: 'OLD_FILE_FACT' } }) },
    ],
    seenToolCallIds: ['call-reused'], usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 1,
    repeatedToolBatchTurns: 0,
    createdAt: new Date(0).toISOString(),
  }, { runId: 'run-new-segment', direction: 'Continue reading the next file' });
  assert.deepEqual(rebased.seenToolCallIds, []);
  const messages: AgentModelMessage[] = [
    ...rebased.messages,
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-reused', name: 'workspace.read_file', arguments: { path: 'src/new.ts' } }] },
    { role: 'tool', toolCallId: 'call-reused', content: JSON.stringify({ ok: true, output: { content: 'NEW_FILE_FACT' } }) },
  ];
  const first = buildAgentContinuityMemory(messages, undefined, 4000);
  const memory = JSON.parse(first.content.slice(marker.length));
  assert.deepEqual(memory.files, [
    'workspace.read_file call-reused: src/old.ts',
    'workspace.read_file call-reused: src/new.ts',
  ]);
  assert.match(memory.findings[0], /arguments=\{"path":"src\/old\.ts"\}[\s\S]*OLD_FILE_FACT/);
  assert.match(memory.findings[1], /arguments=\{"path":"src\/new\.ts"\}[\s\S]*NEW_FILE_FACT/);
  const second = JSON.parse(buildAgentContinuityMemory([first], undefined, 4000).content.slice(marker.length));
  assert.deepEqual(second.files, memory.files);
  assert.deepEqual(second.findings, memory.findings);
});
