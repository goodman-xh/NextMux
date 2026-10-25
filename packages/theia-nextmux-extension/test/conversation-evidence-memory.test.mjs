import assert from 'node:assert/strict';
import test from 'node:test';
import { completedConversationHistory, compactedConversationHistory, inheritConversationTurnsThroughMessage, withoutReplayedContextNote } from '../lib/browser/nextmux-conversation-branch.js';
import { createAiSdkModelClient } from '../../model-runtime/lib/index.js';

const at = '2026-09-23T00:00:00.000Z';
const turn = {
    id: 'one', prompt: 'Fix this issue', response: 'Final answer', stage: 'complete',
    events: [
        { type: 'model_started', turn: 1, at },
        { type: 'provider_reasoning', turn: 1, itemId: 'reason-1', visibility: 'visible', status: 'streaming', content: 'Analyze', at },
        { type: 'provider_reasoning', turn: 1, itemId: 'reason-1', visibility: 'visible', status: 'complete', content: 'Analyzed the cache invalidation cause', at },
        { type: 'provider_reasoning', turn: 1, itemId: 'private', visibility: 'hidden', content: 'HIDDEN_TRACE', at },
        { type: 'assistant_delta', turn: 1, delta: 'The key evidence is ', at },
        { type: 'assistant_delta', turn: 1, delta: 'in cache.ts.', at },
        { type: 'model_completed', turn: 1, toolCallCount: 1, at },
        { type: 'tool_output', callId: 'call-test', toolName: 'process.start', source: 'builtin', stream: 'stdout', chunk: '17 tests passed\nCache invalidation regression passed\n外部命令原文', sequence: 1, at },
        { type: 'tool_completed', callId: 'call-test', toolName: 'process.start', ok: true, status: 'completed', durationMs: 10,
            summary: { title: 'Tests completed', commandLine: 'pnpm test', details: ['LEGACY_UI_DETAIL_旧界面详情'],
                attachments: [{ dataBase64: 'ATTACHMENT_BYTES' }], providerState: { signature: 'PRIVATE_SIGNATURE' } }, at },
        { type: 'assistant_progress', turn: 1, origin: 'runtime', content: 'Tests completed', at },
        { type: 'model_started', turn: 2, at },
        { type: 'assistant_delta', turn: 2, delta: 'Final answer', at },
        { type: 'model_completed', turn: 2, toolCallCount: 0, at },
    ],
};

test('completed history carries visible evidence into either manually selected model without provider-private state', async () => {
    const before = JSON.stringify(turn), messages = completedConversationHistory([turn]);
    const bodies = [];
    for (const model of ['old-model', 'new-model']) {
        const client = createAiSdkModelClient({ providerId: 'custom_openai', protocol: 'openai_chat_completions', model,
            apiKey: 'synthetic', baseUrl: 'https://provider.test/v1', fetchImpl: async (_input, init) => {
                bodies.push(JSON.parse(String(init.body)));
                return new Response(`data: ${JSON.stringify({ id: 'test', model, choices: [{ index: 0, delta: { content: 'Okay' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'content-type': 'text/event-stream' } });
            } });
        await client.complete({ messages: [...messages, { role: 'user', content: 'Continue' }], tools: [] });
    }
    for (const body of bodies) {
        const serialized = JSON.stringify(body.messages);
        for (const evidence of ['Analyzed the cache invalidation cause', 'The key evidence is in cache.ts.', '17 tests passed', 'Cache invalidation regression passed', '外部命令原文']) assert.ok(serialized.includes(evidence), evidence);
        assert.equal(serialized.split('Final answer').length - 1, 1);
        assert.equal(serialized.split('Analyzed the cache invalidation cause').length - 1, 1);
        assert.doesNotMatch(serialized, /HIDDEN_TRACE|ATTACHMENT_BYTES|PRIVATE_SIGNATURE|providerState|tool_calls|LEGACY_UI_DETAIL|旧界面详情/);
    }
    assert.deepEqual(bodies[0].messages, bodies[1].messages);
    assert.equal(JSON.stringify(turn), before);
});

test('older-turn compaction retains bounded evidence without replaying a complete event log', () => {
    const events = [
        { type: 'tool_output', callId: 'proof', toolName: 'test', stream: 'stderr', chunk: 'UNRESOLVED_FAILURE: expected 1, got 2', at },
        { type: 'tool_completed', callId: 'proof', toolName: 'test', ok: false, status: 'failed', durationMs: 10,
            summary: { title: 'OLD_FAILURE_TITLE', details: ['OLD_FAILURE_DETAIL_旧界面错误'] },
            failure: { code: 'TEST_ASSERTION_FAILED', message: 'OLD_FAILURE_PROSE_旧错误说明' }, at }
    ];
    const source = Array.from({ length: 30 }, (_, index) => ({ id: String(index), prompt: 'Question', response: 'Conclusion', stage: 'complete', events }));
    const history = compactedConversationHistory(source);
    assert.match(history[0].content, /UNRESOLVED_FAILURE/);
    assert.match(history[0].content, /TEST_ASSERTION_FAILED/);
    assert.doesNotMatch(history[0].content, /OLD_FAILURE_|旧界面错误|旧错误说明/);
    assert.ok(history.length <= 24);
    assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 150_000);
    const huge = { ...turn, events: Array.from({ length: 1000 }, (_, index) => ({ ...events[1], callId: String(index),
        summary: { title: 'Tool result', details: ['x'.repeat(20_000), 'data:image/png;base64,' + 'A'.repeat(20_000)] } })) };
    const serialized = JSON.stringify(completedConversationHistory([huge]));
    assert.ok(serialized.length < 25_000);
    assert.doesNotMatch(serialized, /data:image|A{100}/);
    assert.match(serialized, /truncated|omitted/i);
});

test('prompt-only branches never carry the replaced reply evidence; unanswered turns invent no reasoning', () => {
    const branch = inheritConversationTurnsThroughMessage([turn], turn.id, 'user');
    assert.deepEqual(completedConversationHistory(branch), [{ role: 'user', content: turn.prompt }]);
    assert.deepEqual(completedConversationHistory([{ ...turn, events: [] }]), [{ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.response }]);
});

test('failed empty replies retain both user prompts before a new model without duplicating the running prompt', () => {
    const source = [
        { id: 'failed-1', prompt: 'Remember the phrase amber-river-47.', response: '', stage: 'error' },
        { id: 'failed-2', prompt: 'The first request still applies.', response: '', stage: 'error' },
        { id: 'current', prompt: 'What phrase did I give first?', response: '', stage: 'running' }
    ];
    const before = JSON.stringify(source);
    for (const project of [completedConversationHistory, compactedConversationHistory]) {
        assert.deepEqual(project(source), source.slice(0, 2).map(item => ({ role: 'user', content: item.prompt })));
        const input = [...project(source), { role: 'user', content: source[2].prompt }];
        assert.equal(input.filter(item => item.content === source[2].prompt).length, 1);
    }
    assert.equal(JSON.stringify(source), before);
});

test('interrupted turns retain public partial text, completed tools and unknown unfinished side effects', () => {
    for (const stage of ['error', 'cancelled', 'paused']) {
        const source = { id: stage, prompt: 'Update the report once', response: 'The report header was saved.', stage, events: [
            { type: 'model_started', turn: 1, at },
            { type: 'assistant_progress', turn: 1, origin: 'model', content: 'Checking the remaining section.', at },
            { type: 'assistant_progress', turn: 1, content: 'Legacy public progress remains visible.', at },
            { type: 'tool_started', callId: 'saved', toolName: 'workspace.write_file', summary: { title: 'Save report header' }, at },
            { type: 'tool_output', callId: 'saved', toolName: 'workspace.write_file', stream: 'stdout', chunk: 'REPORT_HEADER_SAVED: report.md', at },
            { type: 'tool_completed', callId: 'saved', toolName: 'workspace.write_file', status: 'succeeded', ok: true,
                summary: { title: 'OLD_HEADER_TITLE', details: ['OLD_HEADER_DETAIL_旧界面详情'] }, at },
            { type: 'tool_started', callId: 'pending', toolName: 'workspace.apply_patch', summary: { title: 'OLD_PATCH_TITLE', details: ['OLD_PATCH_DETAIL_旧界面详情'],
                arguments: { private: 'PRIVATE_ARGUMENTS' } }, at },
            { type: 'tool_output', callId: 'pending', toolName: 'workspace.apply_patch', stream: 'stdout', chunk: 'PATCH_WAS_STARTED\nPUBLIC_PARTIAL_TOOL_OUTPUT', at },
            { type: 'tool_process_started', callId: 'background', toolName: 'process.start', processId: 'p1', commandLine: 'node local-job.mjs', interactive: false, at },
            { type: 'tool_completed', callId: 'background', toolName: 'process.start', status: 'succeeded', ok: true,
                summary: { title: 'Background process accepted' }, at },
            { type: 'tool_output', callId: 'background', toolName: 'process.start', stream: 'stdout', chunk: 'BACKGROUND_PARTIAL_OUTPUT', at },
            { type: 'assistant_delta', turn: 1, delta: 'There is an unfinished visible sentence', at },
            { type: 'provider_reasoning', visibility: 'hidden', content: 'PRIVATE_REASONING', at },
            { type: 'provider_reasoning', content: 'UNMARKED_REASONING', at }
        ] };
        const history = completedConversationHistory([source]), serialized = JSON.stringify(history);
        // The request keeps its text first; the reply's tool evidence rides with it, never inside the reply a model would imitate.
        assert.ok(history[0].content.startsWith(source.prompt));
        assert.equal(history[1].role, 'assistant');
        assert.doesNotMatch(history[1].content, /REPORT_HEADER_SAVED|do not run them again/);
        for (const fact of ['The report header was saved.', 'Checking the remaining section.', 'REPORT_HEADER_SAVED', 'PATCH_WAS_STARTED',
            'Legacy public progress remains visible.', 'PUBLIC_PARTIAL_TOOL_OUTPUT', 'BACKGROUND_PARTIAL_OUTPUT', 'node local-job.mjs',
            'There is an unfinished visible sentence']) assert.ok(serialized.includes(fact), `${stage}: ${fact}`);
        assert.match(serialized, /result unknown/);
        assert.match(serialized, /verify before (?:retrying|repeating)/);
        assert.match(serialized, new RegExp(`Prior turn ${stage}`));
        assert.doesNotMatch(serialized, /PRIVATE_ARGUMENTS|PRIVATE_REASONING|UNMARKED_REASONING|OLD_HEADER_|OLD_PATCH_|旧界面详情|tool_calls|\"role\":\"tool\"/);
    }
});

test('a process exit receipt resolves its unknown state without fabricating a successful command', () => {
    const source = { id: 'stopped-process', prompt: 'Run the local check', response: '', stage: 'cancelled', events: [
        { type: 'tool_started', callId: 'check', toolName: 'process.start', at },
        { type: 'tool_process_started', callId: 'check', toolName: 'process.start', processId: 'p1', commandLine: 'node check.mjs', at },
        { type: 'tool_completed', callId: 'check', toolName: 'process.start', status: 'succeeded', ok: true, summary: { title: 'Started check' }, at },
        { type: 'tool_process_exited', callId: 'check', toolName: 'process.start', processId: 'p1', exitCode: null, signal: 'SIGINT', at }
    ] };
    const serialized = JSON.stringify(completedConversationHistory([source]));
    assert.match(serialized, /SIGINT/);
    assert.doesNotMatch(serialized, /result unknown|exit=0/);
});

test('older interrupted turns remain in bounded compacted memory and prompt-only branches exclude their work', () => {
    const interrupted = { id: 'old-failure', prompt: 'amber-river-47 is the original phrase', response: '', stage: 'error', events: [
        { type: 'tool_started', callId: 'unknown', toolName: 'workspace.write_file', summary: { title: 'OLD_PENDING_TITLE', details: ['OLD_PENDING_DETAIL_旧进度'] }, at },
        { type: 'tool_output', callId: 'unknown', toolName: 'workspace.write_file', stream: 'stdout', chunk: 'Original write was started', at }
    ] };
    const source = [interrupted, ...Array.from({ length: 15 }, (_, index) => ({ id: `recent-${index}`, prompt: `Recent question ${index}`, response: 'Recent answer', stage: 'complete' }))];
    const history = compactedConversationHistory(source);
    assert.match(history[0].content, /amber-river-47/);
    assert.match(history[0].content, /Original write was started/);
    assert.doesNotMatch(history[0].content, /OLD_PENDING_|旧进度/);
    assert.match(history[0].content, /result unknown/);
    const branch = inheritConversationTurnsThroughMessage([interrupted], interrupted.id, 'user');
    assert.deepEqual(compactedConversationHistory(branch), [{ role: 'user', content: interrupted.prompt }]);
});

test('terminal prompt-only turns and interrupted evidence stay within the existing transport budgets', () => {
    assert.deepEqual(completedConversationHistory([{ id: 'empty', prompt: 'Keep this request', response: '', stage: 'complete' }]),
        [{ role: 'user', content: 'Keep this request' }]);
    const source = Array.from({ length: 300 }, (_, index) => ({ id: String(index), prompt: `User ${index} ${'p'.repeat(30_000)}`,
        response: index % 2 ? 'r'.repeat(30_000) : '', stage: index % 2 ? 'cancelled' : 'error',
        events: Array.from({ length: 40 }, (_, call) => ({ type: 'tool_started', callId: String(call), toolName: 'workspace.write_file',
            summary: { title: `Potential write ${call}`, details: ['d'.repeat(2_000)] }, at })) }));
    for (const history of [completedConversationHistory(source, 500), compactedConversationHistory(source)]) {
        assert.ok(history.length <= 24);
        assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 150_000);
        assert.match(JSON.stringify(history), /result unknown/);
    }
    assert.deepEqual(completedConversationHistory([{ ...source[0], stage: 'running' }, { ...source[1], stage: 'idle' }]), []);
});

test('turns that do not fit the recent character budget move to older memory instead of disappearing', () => {
    const source = Array.from({ length: 11 }, (_, index) => ({ id: String(index), prompt: `PROMPT_MARKER_${index} ${'p'.repeat(25_000)}`,
        response: `RESPONSE_MARKER_${index} ${'r'.repeat(25_000)}`, stage: index % 2 ? 'error' : 'cancelled' }));
    const history = compactedConversationHistory(source), serialized = JSON.stringify(history);
    for (const item of source) assert.ok(serialized.includes(`PROMPT_MARKER_${item.id}`), `Missing historical user ${item.id}`);
    assert.ok(history.length <= 24);
    assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 150_000);
});

test('late background output after many other completions cannot invent a missing tool receipt', () => {
    const source = { id: 'long-background', prompt: 'Observe the local job', response: '', stage: 'cancelled', events: [
        { type: 'tool_started', callId: 'background', toolName: 'process.start', at },
        { type: 'tool_process_started', callId: 'background', toolName: 'process.start', processId: 'p1', commandLine: 'node local-job.mjs', at },
        { type: 'tool_completed', callId: 'background', toolName: 'process.start', status: 'succeeded', ok: true, summary: { title: 'Launch accepted' }, at },
        ...Array.from({ length: 40 }, (_, index) => ({ type: 'tool_completed', callId: `other-${index}`, toolName: 'workspace.read_file',
            status: 'succeeded', ok: true, summary: { title: `File ${index} read` }, at })),
        { type: 'tool_output', callId: 'background', toolName: 'process.start', stream: 'stdout', chunk: 'Final local job output', at },
        { type: 'tool_process_exited', callId: 'background', toolName: 'process.start', processId: 'p1', exitCode: 0, signal: null, at }
    ] };
    const serialized = JSON.stringify(completedConversationHistory([source]));
    assert.match(serialized, /exit=0/);
    assert.match(serialized, /Final local job output/);
    assert.doesNotMatch(serialized, /result unknown|completion not recorded/);
});

test('a context note a model copied into its answer is hidden and never sent back', () => {
    const copied = '计算器已在标签中打开。\n\nPrior visible progress and tool evidence (context only; do not re-execute):\n接下来将调用工具。\n[tabs.open_app: succeeded] · 在标签中打开应用';
    assert.equal(withoutReplayedContextNote(copied), '计算器已在标签中打开。');
    assert.equal(withoutReplayedContextNote('[Context for the reply that follows: progress and tool results it already produced (do not run them again):\nx]'), '');
    assert.equal(withoutReplayedContextNote('An answer that mentions Prior visible progress in prose.'), 'An answer that mentions Prior visible progress in prose.');
    const history = completedConversationHistory([{ ...turn, response: copied }]);
    const assistant = history.find(message => message.role === 'assistant');
    assert.equal(assistant.content, '计算器已在标签中打开。');
    assert.equal(JSON.stringify(history).split('Prior visible progress').length - 1, 0);
});
