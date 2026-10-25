import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { summarizeAgentTaskProgress } from '../lib/browser/nextmux-agent-activity.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';

const at = '2026-09-19T12:00:00.000Z';
const events = [
    { type: 'tool_completed', callId: 'write', toolName: 'workspace.write_file', ok: true, durationMs: 1, at,
        summary: { title: 'write', resource: { kind: 'file', path: 'direct.ts', action: 'updated' } } },
    { type: 'tool_completed', callId: 'command', toolName: 'process.run', ok: false, durationMs: 1, at,
        summary: { title: 'command failed after writes', changedPaths: ['command.ts', 'direct.ts'], checkpointIds: ['cp-command', 'cp-direct'] } },
    { type: 'tool_completed', callId: 'command', toolName: 'process.run', ok: true, durationMs: 1, at,
        summary: { title: 'later resumed command', changedPaths: ['resumed.ts'], checkpointIds: ['cp-resumed'] } },
];

test('live changed-file count includes failed command writes, de-duplicates paths, and retains reused call-id evidence', () => {
    assert.equal(summarizeAgentTaskProgress(events, [{ path: 'command.ts' }], true).changedFileCount, 3);
});

test('completed summary counts the same command changes even if its process failed', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = widget.members.find(node => node.name?.getText(parsed) === 'completedAgentSummary').getText(parsed);
    const executable = ts.transpileModule(`class SummaryHarness { ${method} }; globalThis.SummaryHarness = SummaryHarness;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({ toolActivitySucceeded: ok => ok, runningTaskText: (_locale, _key, values) => values });
    vm.runInContext(executable, context);
    const result = new context.SummaryHarness().completedAgentSummary(events, [{ path: 'command.ts' }]);
    assert.equal(result.files, 3); assert.equal(result.operations, 2);
});

test('history retains command changed paths and every checkpoint reference beyond preview limits', () => {
    const checkpointIds = Array.from({ length: 150 }, (_, index) => `cp-${index}`);
    const event = { ...events[1], summary: { ...events[1].summary, checkpointIds, changedPaths: ['command.ts', 'direct.ts', 'command.ts'] } };
    const input = [{ id: 'owner', workspacePath: '/workspace', title: 'owner', createdAt: 1, updatedAt: 2,
        turns: [{ id: 'turn', createdAt: 1, prompt: 'edit', response: '', error: '', events: [event] }] }];
    const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror(input))).sessions[0].turns[0].events[0];
    assert.equal(restored.ok, false);
    assert.deepEqual(restored.summary.checkpointIds, checkpointIds);
    assert.deepEqual(restored.summary.changedPaths, ['command.ts', 'direct.ts']);
    assert.equal(summarizeAgentTaskProgress([restored], [], false).changedFileCount, 2);
});
