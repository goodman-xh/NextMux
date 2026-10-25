import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { completedNarrationSourceIndexes, finalTextAlreadyInActivity } from '../lib/browser/nextmux-agent-activity.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { stabilizeStreamingMarkdownTail } from '../lib/browser/nextmux-conversation-stream.js';
import { codeFenceTitle, codeLanguageLabel, renderConversationMarkdownUnsanitized } from '../lib/browser/nextmux-conversation-markdown.js';
import { mergeConsecutiveUserMessages } from '../lib/browser/nextmux-conversation-branch.js';
import { composeAgentInstructions, READ_ONLY_PLAN_MODE_INSTRUCTIONS } from '../lib/node/nextmux-agent-instructions.js';

// A reply cut off by the output limit, or one whose stream dropped, continues in place (agent-runtime runner.ts):
// its text is one answer, never narration plus a second answer, and it streams as one block.
const at = '2026-10-21T12:00:00.000Z';
const started = (turn, continuation) => ({ type: 'model_started', turn, ...(continuation ? { continuation } : {}), at });
const delta = (turn, text) => ({ type: 'assistant_delta', turn, delta: text, at });
const completed = (turn, toolCallCount = 0) => ({ type: 'model_completed', turn, toolCallCount, at });
const texts = projection => projection.items.filter(item => item.kind === 'text').map(item => item.text);

test('a continued reply is one answer, not narration followed by a second answer', () => {
    const continued = [started(1), delta(1, 'Part one '), completed(1), started(2, 'output_limit'), delta(2, 'and part two.'), completed(2)];
    assert.deepEqual([...completedNarrationSourceIndexes(continued)], []);
    assert.equal(finalTextAlreadyInActivity(continued, 'Part one and part two.'), false);
    // A resumed run that continues a kept partial reply joins it as well.
    const resumed = [started(1), delta(1, '第一部分，'), { type: 'backend_selected', backendId: 'b', attempt: 1, at }, started(1, 'stream_resume'), delta(1, '第二部分。'), completed(1)];
    assert.deepEqual([...completedNarrationSourceIndexes(resumed)], []);
});

test('a new model request or a tool call still ends the earlier prose', () => {
    const fresh = [started(1), delta(1, 'Draft'), completed(1), started(2), delta(2, 'Answer'), completed(2)];
    assert.deepEqual([...completedNarrationSourceIndexes(fresh)], [1]);
    const tool = [started(1), delta(1, 'Reading the file.'), completed(1, 1),
        { type: 'tool_started', turn: 1, callId: 'c1', toolName: 'fs.read_file', at }, started(2, 'output_limit'), delta(2, 'Done.')];
    assert.deepEqual([...completedNarrationSourceIndexes(tool)], [1]);
    const resumedFresh = [started(1), delta(1, 'Old text'), { type: 'backend_selected', backendId: 'b', attempt: 1, at }, started(1), delta(1, 'New text')];
    assert.deepEqual([...completedNarrationSourceIndexes(resumedFresh)], [1], 'a resume that starts over ends the old text');
});

test('streaming text joins across an output-limit continuation and across retries of a dropped stream', () => {
    const lengthEvents = [started(1), delta(1, 'The migration keeps every row and '), completed(1), started(2, 'output_limit'), delta(2, 'rebuilds the index.')];
    assert.deepEqual(texts(projectConversationStream({ locale: 'en', events: lengthEvents, running: true })),
        ['The migration keeps every row and rebuilds the index.']);
    const dropped = [started(1), delta(1, 'Hello world, '),
        { type: 'model_attempt_completed', turn: 1, attempt: 1, outcome: 'failed', startedAt: at, at, durationMs: 10, retryScheduled: true,
            failure: { code: 'INCOMPLETE_STREAM', stage: 'stream', category: 'network', reason: 'stream ended', retryable: true, retrySafe: false } },
        { type: 'model_retry_scheduled', turn: 1, attempt: 1, delayMs: 1000, reason: 'INCOMPLETE_STREAM', at },
        delta(1, 'how are you?')];
    const projection = projectConversationStream({ locale: 'en', events: dropped, running: true });
    assert.deepEqual(texts(projection), ['Hello world, how are you?']);
    assert.equal(projection.items.some(item => item.kind === 'row' && (item.activity === 'retry' || item.activity === 'model-attempt')), false,
        'the recovered retry no longer splits the answer');
});

test('without a continuation, text of a new request still starts its own block', () => {
    const events = [started(1), delta(1, 'First reply.'), completed(1), started(2), delta(2, 'Second reply.')];
    assert.deepEqual(texts(projectConversationStream({ locale: 'en', events, running: true })), ['First reply.', 'Second reply.']);
    const tool = [started(1), delta(1, 'Checking.'), completed(1, 1), { type: 'tool_started', turn: 1, callId: 'c1', toolName: 'fs.read_file', at },
        { type: 'tool_completed', turn: 1, callId: 'c1', toolName: 'fs.read_file', ok: true, summary: { title: 'Read a.ts' }, at },
        started(2, 'output_limit'), delta(2, 'Done.')];
    assert.equal(texts(projectConversationStream({ locale: 'en', events: tool, running: true })).length, 2);
});

test('saved conversations keep the continuation marker so a reload shows the same single block', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-conversation-history.ts', import.meta.url), 'utf8');
    assert.match(source, /case 'model_started':[\s\S]{0,420}continuation: value\.continuation/);
});

test('in-flight stream retry and continuation resume never flash retry, disconnect, or resumed rows while prose is open', () => {
    const midRetry = [
        started(1),
        delta(1, 'Streaming partial sentence '),
        { type: 'model_attempt_completed', turn: 1, attempt: 1, outcome: 'failed', startedAt: at, at, durationMs: 10, retryScheduled: true,
            failure: { code: 'INCOMPLETE_STREAM', stage: 'stream', category: 'network', reason: 'stream ended', retryable: true, retrySafe: false } },
        { type: 'model_retry_scheduled', turn: 1, attempt: 1, delayMs: 1000, reason: 'INCOMPLETE_STREAM', at }
    ];
    const retryProjection = projectConversationStream({ locale: 'zh-CN', events: midRetry, running: true });
    assert.deepEqual(retryProjection.items.map(item => item.kind), ['text']);

    const midResume = [
        started(1),
        delta(1, '第一部分，'),
        { type: 'backend_selected', backendId: 'b', attempt: 1, at },
        started(1, 'stream_resume')
    ];
    const resumeProjection = projectConversationStream({ locale: 'zh-CN', events: midResume, running: true });
    assert.deepEqual(resumeProjection.items.map(item => item.kind), ['text']);
});

test('stabilizeStreamingMarkdownTail and codeFenceTitle prevent raw fence flicker and format fence filenames', () => {
    assert.equal(stabilizeStreamingMarkdownTail('Here is code:\n```typescript'), 'Here is code:');
    assert.equal(stabilizeStreamingMarkdownTail('Here is code:\n```typescript\nconst x = 1;'), 'Here is code:\n```typescript\nconst x = 1;');
    assert.equal(stabilizeStreamingMarkdownTail('Use `npm run build'), 'Use `npm run build`');
    assert.equal(codeFenceTitle('ts src/index.ts'), 'src/index.ts');
    assert.equal(codeLanguageLabel('ts src/index.ts'), 'TypeScript · src/index.ts');
    assert.equal(codeLanguageLabel('python title="main.py"'), 'Python · main.py');
    assert.equal(codeLanguageLabel('ts'), 'TypeScript');
    assert.equal(codeLanguageLabel('mermaid'), 'Mermaid');
    assert.equal(codeLanguageLabel('mmd flow.mmd'), 'Mermaid · flow.mmd');

    const alertEn = renderConversationMarkdownUnsanitized('> [!NOTE]\n> Keep this in mind.', 'en');
    assert.match(alertEn, /<blockquote[^>]*class="[^"]*nmx-md-alert is-note"[^>]*data-alert="note"/);
    assert.match(alertEn, /<span class="nmx-md-alert-title"><i class="codicon codicon-info" aria-hidden="true"><\/i><span>Note<\/span><\/span>Keep this in mind\./);

    const alertZh = renderConversationMarkdownUnsanitized('> [!WARNING]\n> 请注意备份数据。', 'zh-CN');
    assert.match(alertZh, /<blockquote[^>]*class="[^"]*nmx-md-alert is-warning"[^>]*data-alert="warning"/);
    assert.match(alertZh, /<span class="nmx-md-alert-title"><i class="codicon codicon-warning" aria-hidden="true"><\/i><span>警告<\/span><\/span>请注意备份数据。/);
});

test('mergeConsecutiveUserMessages and composeAgentInstructions read_only mode work as expected', () => {
    const merged = mergeConsecutiveUserMessages([
        { role: 'user', content: 'Summary memory' },
        { role: 'user', content: 'First recent turn' },
        { role: 'assistant', content: 'Reply' }
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].content, 'Summary memory\n\nFirst recent turn');

    assert.equal(composeAgentInstructions('BASE', '', ''), 'BASE');
    const readOnly = composeAgentInstructions('BASE', '', '', { permissionMode: 'read_only' });
    assert.ok(readOnly.includes(READ_ONLY_PLAN_MODE_INSTRUCTIONS));
});
