import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const log = require('../lib/browser/nextmux-agent-command-log.js');

const at = '2026-09-25T10:00:00Z';
const run = (callId, commandLine, output, exitCode = 0) => [
    { type: 'tool_started', callId, toolName: 'process.run', source: 'builtin', summary: { commandLine }, at },
    { type: 'tool_process_started', callId, toolName: 'process.run', source: 'builtin', processId: `p-${callId}`, commandLine, interactive: false, at },
    { type: 'tool_output', callId, toolName: 'process.run', source: 'builtin', stream: 'stdout', chunk: output, sequence: 1, at },
    { type: 'tool_process_exited', callId, toolName: 'process.run', source: 'builtin', processId: `p-${callId}`, exitCode, signal: null, at },
    { type: 'tool_completed', callId, toolName: 'process.run', ok: true, status: 'succeeded', summary: {}, durationMs: 5, at }
];

test('every command the AI ran is collected per conversation, in order, with its exit state', () => {
    const turns = [
        { id: 't1', running: false, events: [...run('a', 'npm test', 'ok\n'), { type: 'tool_started', callId: 'r', toolName: 'file.read', source: 'builtin', at }] },
        { id: 't2', running: false, events: run('b', 'git status', 'dirty\n', 1) }
    ];
    const entries = log.conversationAgentCommands(turns);
    assert.deepEqual(entries.map(entry => [entry.commandLine, entry.state, entry.exitCode]), [['npm test', 'completed', 0], ['git status', 'failed', 1]]);
    const transcript = log.agentCommandTranscript('zh-CN', entries);
    assert.match(transcript, /npm test.*\r\nok\n.*退出码 0/s);
    assert.match(transcript, /git status.*dirty\n\u001b\[31m退出码 1/s);
});

test('a command still running has no exit line, and a running turn is never cached as settled', () => {
    const events = run('a', 'npm run dev', 'ready\n').slice(0, 3);
    const running = log.agentCommandEntries('t', events, true);
    assert.equal(running[0].state, 'running');
    assert.doesNotMatch(log.agentCommandTranscript('en', running), /exit/);
    assert.equal(log.hasRunningAgentCommand(events), true);
    assert.equal(log.hasRunningAgentCommand(run('b', 'ls', '')), false);
    assert.equal(log.agentCommandEntries('t', events, false)[0].state, 'stopped', 'an unfinished command of a settled turn was stopped');
});

test('the transcript only grows at the end while output streams, so the xterm can append', () => {
    const events = run('a', 'make', 'step 1\n').slice(0, 3);
    const before = log.agentCommandTranscript('en', log.agentCommandEntries('t', events, true));
    const after = log.agentCommandTranscript('en', log.agentCommandEntries('t', [...events,
        { type: 'tool_output', callId: 'a', toolName: 'process.run', source: 'builtin', stream: 'stdout', chunk: 'step 2\n', sequence: 2, at }], true));
    assert.ok(after.startsWith(before));
});

test('huge outputs and long histories are bounded', () => {
    const big = log.agentCommandEntries('t', run('a', 'cat big.log', 'x'.repeat(log.AGENT_COMMAND_OUTPUT_LIMIT * 2)), false);
    assert.equal(big[0].output.length, log.AGENT_COMMAND_OUTPUT_LIMIT);
    assert.match(log.agentCommandTranscript('en', big), /output truncated/);
    const many = Array.from({ length: log.AGENT_COMMAND_LOG_LIMIT + 5 }, (_, index) => ({ id: `t${index}`, running: false, events: run(`c${index}`, `echo ${index}`, '') }));
    const entries = log.conversationAgentCommands(many);
    assert.equal(entries.length, log.AGENT_COMMAND_LOG_LIMIT);
    assert.equal(entries.at(-1).commandLine, `echo ${log.AGENT_COMMAND_LOG_LIMIT + 4}`);
});

test('control characters in a command line cannot rewrite the terminal', () => {
    const entries = log.agentCommandEntries('t', run('a', 'echo hi\u001b[2J', ''), false);
    assert.doesNotMatch(log.agentCommandTranscript('en', entries).split('\r\n')[0], /\u001b\[2J/);
});
