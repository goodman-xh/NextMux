import { formatModelError } from '@nextmux/model-runtime/errors';
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectConversationStream, conversationErrorText, conversationErrorDetail, activityToolVisual } from '../lib/browser/nextmux-conversation-stream-model.js';
import { markdownStreamBlocks, stabilizeStreamingMarkdownTail, diffLines } from '../lib/browser/nextmux-conversation-stream.js';
import { conversationStreamLocales, conversationStreamText } from '../lib/browser/nextmux-conversation-stream-locale.js';
import { browserActivityPhrase, browserToolIdentity } from '../lib/browser/nextmux-browser-activity-locale.js';
import { BrowserRefNames, browserActivitySummary } from '../lib/common/nextmux-browser-activity-summary.js';
import { NEXTMUX_DESKTOP_LOCALES } from '../lib/browser/nextmux-locale.js';
import { localizedRuntimeActivity } from '../lib/browser/nextmux-runtime-title-locale.js';

const locales = NEXTMUX_DESKTOP_LOCALES.map(([locale]) => locale);
const at = n => `2026-09-24T00:00:${String(n).padStart(2, '0')}.000Z`;
const rows = projection => projection.items.filter(item => item.kind === 'row');

test('expanded failed tool details show a safe localized reason while preserving the recorded diagnostic', () => {
    // Structure and diagnostic from the actual failed click in the comprehensive QA session.
    const failedClick = { type: 'tool_completed', callId: 'call_41b86c6e017c48389dd80d21cdd0fc43', toolName: 'browser.click', ok: false,
        status: 'failed', durationMs: 585, at: '2026-10-08T12:24:49.111Z',
        summary: { title: 'The specified tab does not belong to this conversation or has been closed.', kind: 'tool.error',
            params: { code: 'BROWSER_TOOL_FAILED', toolName: 'browser.click' } },
        failure: { code: 'BROWSER_TOOL_FAILED', message: 'The specified tab does not belong to this conversation or has been closed.' } };
    for (const locale of locales) for (const toolName of ['browser.click', 'computer.click', 'custom.safe_probe']) {
        const event = { ...failedClick, toolName, summary: { ...failedClick.summary, params: { ...failedClick.summary.params, toolName } } };
        const before = structuredClone(event);
        const expected = localizedRuntimeActivity(locale, event.summary).title;
        const [row] = rows(projectConversationStream({ locale, events: [event], running: false }));
        assert.equal(row.details.kind, 'text', `${locale} ${toolName}`);
        assert.equal(row.details.text, expected, `${locale} ${toolName}: safe reason is visible`);
        assert.doesNotMatch(JSON.stringify({ title: row.title, tooltip: row.tooltip, details: row.details }), /BROWSER_TOOL_FAILED|specified tab/);
        assert.deepEqual(event, before, `${locale} ${toolName}: internal diagnostics are unchanged`);
    }
});

test('successful browser details keep the explicit page name and link', () => {
    const event = { type: 'tool_completed', callId: 'browser-success', toolName: 'browser.open', ok: true, status: 'succeeded', durationMs: 1, at: at(0),
        summary: { kind: 'browser.open', title: 'Opened Example', target: 'Example', details: ['Explicit page title'],
            resource: { kind: 'browser', url: 'https://example.com/', title: 'Example' } } };
    const [row] = rows(projectConversationStream({ locale: 'zh-CN', events: [event], running: false }));
    assert.equal(row.target, 'Example');
    assert.equal(row.details.kind, 'link');
    assert.equal(row.details.url, 'https://example.com/');
    assert.equal(row.details.text, 'Explicit page title');
});

test('every stream and browser string exists in all 12 locales', () => {
    const keys = Object.keys(conversationStreamLocales.en);
    for (const locale of locales) {
        assert.deepEqual(Object.keys(conversationStreamLocales[locale]).sort(), [...keys].sort(), locale);
        for (const key of keys) assert.ok(conversationStreamLocales[locale][key].trim(), `${locale}.${key}`);
        for (const action of ['open', 'open_external', 'snapshot', 'click', 'fill', 'fill_form', 'select', 'upload', 'drag', 'hover', 'wait', 'press',
            'script', 'screenshot', 'close', 'back', 'forward', 'reload', 'resize', 'console', 'network', 'tabs', 'activate', 'dialog']) {
            for (const state of ['running', 'completed', 'failed']) {
                const phrase = browserActivityPhrase(locale, action, state, 'Sign in');
                assert.ok(phrase.text.trim() && !/\{[qt]\}/.test(phrase.text), `${locale} ${action} ${state}`);
                assert.doesNotMatch(phrase.text, /\b(?:click|fill|select_option|browser_)\b/, `${locale} ${action}: no raw action identifiers`);
                assert.ok(!/\{[qt]\}/.test(browserActivityPhrase(locale, action, state).text), `${locale} ${action} without target`);
            }
        }
    }
    assert.equal(conversationStreamText('en', 'compactedMeta', { before: 64, after: 20 }), '64 → 20 messages');
});

test('browser tools are identified only by registered names', () => {
    assert.deepEqual(browserToolIdentity('browser.navigate'), { action: 'open' });
    assert.deepEqual(browserToolIdentity('mcp.playwright.browser_select_option_1234abcd'), { action: 'select', service: 'playwright' });
    for (const name of ['browser_click', 'my.browser_snapshot', 'mcp.playwright.custom', 'browser.unknown']) assert.equal(browserToolIdentity(name), undefined, name);
    assert.equal(browserActivityPhrase('ar', 'click', 'completed', 'دخول').text, 'نقر على «دخول»');
    assert.equal(browserActivityPhrase('hi', 'fill', 'running', 'Email').text, 'Email में टाइप कर रहा है');
    assert.equal(browserActivityPhrase('ko', 'select', 'completed', '한국').text, '“한국” 선택함');
});

test('the node summary names the clicked element from the latest snapshot and never records typed text', () => {
    const names = new BrowserRefNames();
    const snapshot = { url: 'https://www.example.com/login', title: 'Log in', elements: [
        { ref: 's1e1', role: 'textbox', name: 'Email' }, { ref: 's1e2', role: 'button', name: '  Sign\n in ' }] };
    const read = browserActivitySummary({ action: 'snapshot', data: snapshot }, names, 'c:tab');
    assert.deepEqual(read.resource, { kind: 'browser', url: 'https://www.example.com/login', title: 'Log in' });
    const fill = browserActivitySummary({ action: 'fill', ref: 's1e1', data: { snapshot: { ...snapshot, elements: [] } } }, names, 'c:tab');
    assert.equal(fill.target, 'Email');
    assert.doesNotMatch(JSON.stringify(fill), /hunter2/);
    // The previous fill replaced the snapshot; a stale ref has no name.
    assert.equal(browserActivitySummary({ action: 'click', ref: 's1e2' }, names, 'c:tab').target, undefined);
    browserActivitySummary({ action: 'snapshot', data: snapshot }, names, 'c:tab');
    assert.equal(browserActivitySummary({ action: 'click', ref: 's1e2' }, names, 'c:tab').target, 'Sign in');
    assert.equal(browserActivitySummary({ action: 'select', values: ['CN', 'US'] }, names, 'c:tab').target, 'CN, US');
    assert.equal(browserActivitySummary({ action: 'upload', paths: ['/w/a/report.pdf'] }, names, 'c:tab').target, 'report.pdf');
    assert.equal(browserActivitySummary({ action: 'open', url: 'https://nextmux.app/' }, names, 'c:tab').resource.url, 'https://nextmux.app/');
    assert.equal(browserActivitySummary({ action: 'open', url: 'javascript:alert(1)' }, names, 'c:tab').resource, undefined);
    assert.doesNotMatch(browserActivitySummary({ action: 'back' }, names, 'c:tab').title, /back|浏览器：/);
});

test('the stream keeps journal order and updates operations where they started', () => {
    const events = [
        { type: 'model_started', turn: 1, at: at(0) },
        { type: 'tool_started', callId: 'a', toolName: 'workspace.read_file', source: 'builtin', at: at(1),
            summary: { title: '读取 src/a.ts', resource: { kind: 'file', path: 'src/a.ts', action: 'read' } } },
        { type: 'assistant_delta', turn: 1, delta: 'Reading.', at: at(2) },
        { type: 'tool_completed', callId: 'a', toolName: 'workspace.read_file', ok: true, status: 'succeeded', durationMs: 1, at: at(3),
            summary: { title: '读取 src/a.ts', resource: { kind: 'file', path: 'src/a.ts', action: 'read', startLine: 3, endLine: 9 } } },
        { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(4) },
        { type: 'tool_completed', callId: 'b', toolName: 'workspace.search_text', ok: true, status: 'succeeded', durationMs: 1, at: at(5), summary: { title: '搜索“resume”' } },
        { type: 'tool_completed', callId: 'c', toolName: 'workspace.list_files', ok: true, status: 'succeeded', durationMs: 1, at: at(6), summary: { title: '查看项目文件' } },
        { type: 'context_compaction_started', turn: 2, segment: 1, at: at(7) }
    ];
    const live = projectConversationStream({ locale: 'en', events, running: true });
    assert.deepEqual(live.items.map(item => item.kind === 'row' ? item.activity : item.kind), ['file-read', 'text', 'search', 'read', 'context-compaction']);
    const [read, , search, list, compacting] = live.items;
    assert.equal(read.title, 'Read'); assert.equal(read.target, 'a.ts'); assert.equal(read.meta, 'L3–9');
    assert.equal(search.title, 'Searched'); assert.equal(search.target, 'resume', 'runtime Chinese title keeps only its object');
    assert.equal(list.title, 'Explored'); assert.equal(list.target, undefined);
    assert.equal(compacting.title, 'Compacting context'); assert.equal(compacting.shimmer, true);
    const done = projectConversationStream({ locale: 'en', events: [...events,
        { type: 'context_compaction_completed', turn: 2, segment: 1, messagesBefore: 30, messagesAfter: 8, at: at(8) }], running: false, terminalState: 'complete' });
    const compacted = rows(done).at(-1);
    assert.equal(compacted.key, compacting.key, 'the compaction row keeps its identity so the label cross-fades');
    assert.equal(compacted.title, 'Context compacted'); assert.equal(compacted.meta, undefined);
});

test('stream projection cache hits never read the journal again', () => {
    let rejectReads = false;
    const events = new Proxy([{ type: 'context_compaction_completed', turn: 1, segment: 1, messagesBefore: 95, messagesAfter: 38, at: at(0) }], {
        get(target, property, receiver) {
            assert.equal(rejectReads, false, `cached projection read events.${String(property)}`);
            return Reflect.get(target, property, receiver);
        }
    });
    const input = { locale: 'zh-CN', events, running: false };
    const projection = projectConversationStream(input);
    assert.equal(rows(projection)[0].title, '上下文已自动压缩');
    assert.equal(rows(projection)[0].meta, undefined);
    rejectReads = true;
    for (let index = 0; index < 100; index++) assert.equal(projectConversationStream({ ...input }), projection);
});

test('stream projection cache invalidates presentation inputs and retains at most eight variants', () => {
    const events = [{ type: 'assistant_delta', turn: 1, delta: 'Hello', at: at(2) }];
    const steering = { id: 's1', status: 'pending', content: 'Continue', createdAt: at(1) };
    const change = { checkpointId: 'cp1', path: 'a.ts', additions: 1, deletions: 0 };
    const input = { locale: 'en', events, running: false, steeringMessages: [steering], changes: [change] };
    const projection = projectConversationStream(input);
    assert.equal(projectConversationStream({ ...input, steeringMessages: [steering], changes: [change] }), projection);
    assert.equal(projectConversationStream({ ...input, steeringMessages: [{ ...steering }], changes: [{ ...change }] }), projection,
        'equivalent cloned input records reuse their cached projection');
    const variants = [
        { locale: 'zh-CN' }, { running: true }, { preserveAssistantDeltas: true }, { terminalState: 'stopped' },
        { systemPermissionWait: 'Screen Recording' },
        ...[{ id: 's2' }, { status: 'applied' }, { content: 'Stop' }, { createdAt: at(3) }]
            .map(value => ({ steeringMessages: [{ ...steering, ...value }] })),
        ...[{ checkpointId: 'cp2' }, { path: 'b.ts' }, { additions: 2 }, { deletions: 1 }]
            .map(value => ({ changes: [{ ...change, ...value }] }))
    ];
    for (const variant of variants) assert.notEqual(projectConversationStream({ ...input, ...variant }), projection);
    assert.notEqual(projectConversationStream({ ...input, events: [...events] }), projection);
    const colonContent = projectConversationStream({ ...input, steeringMessages: [{ ...steering, status: 'pending', content: 'applied:Continue' }] });
    const colonStatus = projectConversationStream({ ...input, steeringMessages: [{ ...steering, status: 'pending:applied', content: 'Continue' }] });
    assert.notEqual(colonContent, colonStatus, 'field separators in user content cannot collide with the cache key');

    const boundedInput = { locale: 'en', events: [], running: true };
    const variantsByWait = Array.from({ length: 8 }, (_, index) => ({ ...boundedInput, systemPermissionWait: `permission ${index}` }));
    const projections = variantsByWait.map(projectConversationStream);
    assert.equal(projectConversationStream(variantsByWait[0]), projections[0], 'all eight keys fit in the cache');
    projectConversationStream({ ...boundedInput, systemPermissionWait: 'permission 8' });
    assert.equal(projectConversationStream(variantsByWait[7]), projections[7]);
    assert.notEqual(projectConversationStream(variantsByWait[0]), projections[0], 'the ninth key evicts the oldest variant');
});

test('stream cache refreshes delayed patch details and steering insertion times', () => {
    const events = [{ type: 'tool_completed', callId: 'e', toolName: 'workspace.apply_patch', ok: true, status: 'succeeded', durationMs: 1, at: at(2),
        summary: { title: '修改 src/a.ts', checkpointId: 'cp1', resource: { kind: 'file', path: '/w/src/a.ts', action: 'updated' } } }];
    const change = { checkpointId: 'cp1', path: 'src/a.ts', additions: 1, deletions: 1 };
    const steering = { id: 's1', content: 'Continue', createdAt: at(1) };
    const input = { locale: 'en', events, running: false, changes: [change], steeringMessages: [steering] };
    const before = projectConversationStream(input);
    assert.equal(rows(before)[0].details, undefined);
    assert.deepEqual(before.items.map(item => item.kind), ['steering', 'row']);
    change.patch = '-old\n+new';
    const patched = projectConversationStream(input);
    assert.equal(rows(patched)[0].details.patch, change.patch);
    assert.equal(projectConversationStream(input), patched);
    assert.equal(projectConversationStream({ ...input, changes: [{ ...change }] }), patched,
        'equivalent cloned patches retain their cache hit without serializing the patch');
    const replaced = projectConversationStream({ ...input, changes: [{ ...change, patch: '-old\n+replacement' }] });
    assert.equal(rows(replaced)[0].details.patch, '-old\n+replacement');
    assert.notEqual(replaced, patched);
    change.binary = true;
    const binary = projectConversationStream(input);
    assert.equal(rows(binary)[0].details, undefined);
    assert.equal(rows(binary)[0].additions, undefined);
    change.truncated = true;
    assert.notEqual(projectConversationStream(input), binary);
    const reordered = projectConversationStream({ ...input, steeringMessages: [{ ...steering, createdAt: at(3) }] });
    assert.deepEqual(reordered.items.map(item => item.kind), ['row', 'steering']);
});

test('commands recover summary output only without streamed output or a process exit', () => {
    const commandLine = 'npm test';
    const completed = { type: 'tool_completed', callId: 'p', toolName: 'process.run', ok: true, status: 'succeeded', durationMs: 1, at: at(3),
        summary: { title: `运行 ${commandLine}`, commandLine, details: [commandLine, 'first line', '  indented output', commandLine] } };
    const project = events => rows(projectConversationStream({ locale: 'en', events, running: false }))[0].details.output;
    assert.equal(project([completed]), 'first line\r\n  indented output');
    assert.equal(project([{ ...completed, summary: { ...completed.summary, commandLine: undefined } }]), 'first line\r\n  indented output', 'legacy command titles also suppress the repeated command');
    assert.equal(project([{ ...completed, summary: { ...completed.summary, details: [commandLine] } }]), '');
    assert.equal(project([{ ...completed, summary: { ...completed.summary, details: undefined } }]), '');
    const output = { type: 'tool_output', callId: 'p', toolName: 'process.run', source: 'builtin', stream: 'stdout', chunk: 'streamed\n', sequence: 1, at: at(1) };
    assert.equal(project([output, completed]), 'streamed\n');
    assert.equal(project([{ ...output, chunk: '' }, completed]), 'first line\r\n  indented output');
    const exited = { type: 'tool_process_exited', callId: 'p', toolName: 'process.run', source: 'builtin', exitCode: 0, signal: null, at: at(2) };
    assert.match(project([exited, completed]), /Process exited with code 0/);
    assert.doesNotMatch(project([exited, completed]), /first line|indented output/);
    assert.match(project([output, exited, completed]), /^streamed\n.*Process exited with code 0/);
});

test('edits carry compact diff counts and the patch as collapsed details', () => {
    const event = { type: 'tool_completed', callId: 'e', toolName: 'workspace.apply_patch', ok: true, status: 'succeeded', durationMs: 1, at: at(1),
        summary: { title: '修改 src/a.ts', checkpointId: 'cp1', resource: { kind: 'file', path: '/w/src/a.ts', action: 'updated' } } };
    const [row] = rows(projectConversationStream({ locale: 'zh-CN', events: [event], running: false,
        changes: [{ checkpointId: 'cp1', path: 'src/a.ts', additions: 4, deletions: 2, patch: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n' }] }));
    assert.equal(row.title, '已编辑'); assert.equal(row.target, 'a.ts');
    assert.equal(row.additions, 4); assert.equal(row.deletions, 2);
    assert.equal(row.details.kind, 'diff'); assert.equal(row.restoreCheckpointId, 'cp1');
    assert.equal(row.open.kind, 'file');
    assert.deepEqual(diffLines(row.details.patch).map(line => line.kind), ['hunk', 'del', 'add']);
});

test('commands, sub-agents, approvals, retries and resumes are concise rows', () => {
    const events = [
        { type: 'backend_selected', backendId: 'a', attempt: 1, at: at(0) },
        { type: 'tool_started', callId: 'p', toolName: 'process.run', source: 'builtin', at: at(1), summary: { title: '运行 npm test', commandLine: 'npm test' } },
        { type: 'tool_output', callId: 'p', toolName: 'process.run', source: 'builtin', stream: 'stdout', chunk: 'ok\n', sequence: 1, at: at(2) },
        { type: 'tool_completed', callId: 'p', toolName: 'process.run', ok: false, status: 'failed', durationMs: 1, at: at(3),
            summary: { title: '运行 npm test', commandLine: 'npm test', outcome: 'failed' } },
        { type: 'tool_completed', callId: 'g', toolName: 'agent.delegate', ok: true, status: 'succeeded', durationMs: 1, at: at(4), summary: { title: 'Audit the diff' } },
        { type: 'user_input_requested', at: at(5), question: { kind: 'permission', questionId: 'q', runId: 'r', taskId: 't', prompt: 'Allow?', options: [], allowFreeText: false,
            createdAt: at(5), expiresAt: at(59), approval: { toolName: 'process.run', scope: 'unsandboxed_command', target: 'git push' } } },
        { type: 'model_retry_scheduled', turn: 2, attempt: 2, delayMs: 1000, reason: 'socket', at: at(6) },
        { type: 'backend_selected', backendId: 'a', attempt: 1, at: at(7) }
    ];
    const live = rows(projectConversationStream({ locale: 'en', events, running: true }));
    assert.deepEqual(live.map(row => row.activity), ['command', 'agent', 'permission', 'retry', 'resumed']);
    // A failed command reads "Run npm test · failed" with the error icon, never "Ran" (audit DK-C5).
    assert.equal(live[0].title, 'Run'); assert.equal(live[0].target, 'npm test'); assert.equal(live[0].chip, 'failed');
    assert.equal(live[0].icon, 'error'); assert.equal(live[0].tone, 'failed');
    assert.equal(live[0].details.kind, 'terminal'); assert.match(live[0].details.output, /ok/);
    assert.equal(live[1].title, 'Sub-agent finished'); assert.equal(live[1].target, 'Audit the diff');
    assert.equal(live[2].title, 'Waiting for approval'); assert.equal(live[2].target, 'git push'); assert.equal(live[2].shimmer, true);
    assert.equal(live[3].meta, 'attempt 2');
    const resolved = rows(projectConversationStream({ locale: 'en', running: false, events: [...events.slice(0, 6),
        { type: 'user_input_resolved', questionId: 'q', runId: 'r', taskId: 't', status: 'answered', answer: { optionId: 'deny', optionLabel: 'Deny' }, at: at(6) }] }));
    const approval = resolved.filter(row => row.activity === 'permission');
    assert.equal(approval.length, 1, 'a resolved approval is one row, updated in place');
    assert.equal(approval[0].title, 'Not approved'); assert.equal(approval[0].target, 'git push');
    // A fallback is not a resume.
    const fallback = rows(projectConversationStream({ locale: 'en', running: false, events: [events[1],
        { type: 'backend_fallback', fromBackendId: 'a', toBackendId: 'b', reason: 'x', at: at(2) }, { type: 'backend_selected', backendId: 'b', attempt: 2, at: at(3) }] }));
    assert.deepEqual(fallback.map(row => row.activity), ['command', 'fallback']);
});

test('failed turns show one short sentence in the user language, never codes or raw provider text', () => {
    assert.equal(conversationErrorText('en', { code: 'WALLET_BALANCE_INSUFFICIENT', status: 402, message: 'x' }), formatModelError({ code: 'WALLET_BALANCE_INSUFFICIENT', status: 402, message: 'x' }, 'en').text);
    for (const raw of ['{"error":{"code":"upstream_error"}}', 'Error: socket hang up at TLSSocket.onClose (node:_tls_wrap:1)',
        'HTTP 500 Internal Server Error', 'UPSTREAM_PROTOCOL_ERROR occurred', 'x'.repeat(400), 'ECONNABORTED while reading']) {
        for (const locale of locales) {
            const text = conversationErrorText(locale, { code: 'SOMETHING_ELSE', message: raw });
            assert.doesNotMatch(text, /[{}]|UPSTREAM_|HTTP 500|node:_tls|ECONN/, `${locale}: ${raw}`);
            assert.ok(text.length <= 180);
        }
    }
    assert.equal(conversationErrorText('zh-CN', { message: '浏览器操作失败' }), '浏览器操作失败', 'a short sentence already in the user language is kept');
    // Ordinary words must never look like codes (case-sensitive patterns), and
    // every Latin-script locale keeps a plain Latin sentence.
    for (const locale of ['en', 'de', 'es', 'fr', 'pt-BR']) for (const sentence of ['Please check your email address.', 'The file could not be saved.', 'Error handling was skipped for this step.']) {
        assert.equal(conversationErrorText(locale, { code: 'SOMETHING_ELSE', message: sentence }), sentence, `${locale}: ${sentence}`);
        assert.ok(conversationErrorDetail(locale, { code: 'SOMETHING_ELSE', message: sentence }).includes(sentence));
    }
    for (const locale of ['en', 'de', 'zh-CN']) for (const raw of ['ECONNRESET', 'read ECONNRESET', '{"error":{"type":"rate_limit_exceeded"}}', 'rate_limit_exceeded',
        'TypeError: Cannot read properties of undefined', 'at fetchModel (/app/lib/runner.js:120:5)', 'See https://status.example.com for details',
        'Request failed with status 503', 'Error: upstream closed']) {
        const text = conversationErrorText(locale, { code: 'SOMETHING_ELSE', message: raw });
        assert.doesNotMatch(text, /ECONNRESET|rate_limit_exceeded|TypeError|fetchModel|https:|status 503/, `${locale} explains: ${raw}`);
        assert.equal(conversationErrorDetail(locale, { code: 'SOMETHING_ELSE', message: raw }), formatModelError({ code: 'SOMETHING_ELSE', message: raw }, locale).detail, 'provider details stay available as the notice tooltip');
    }
});

test('markdown stream blocks split only at safe top-level boundaries', () => {
    assert.deepEqual(markdownStreamBlocks('One.\n\nTwo.'), ['One.', 'Two.']);
    assert.deepEqual(markdownStreamBlocks('```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.'), ['```js\nconst a = 1;\n\nconst b = 2;\n```', 'After.']);
    assert.deepEqual(markdownStreamBlocks('- a\n\n- b\n\n  more\n\nEnd'), ['- a\n\n- b\n\n  more', 'End']);
    assert.deepEqual(markdownStreamBlocks('See [x].\n\n[x]: https://example.com'), ['See [x].\n\n[x]: https://example.com']);
    assert.deepEqual(markdownStreamBlocks('Open fence\n\n```\nstill streaming'), ['Open fence', '```\nstill streaming']);
    // Display math blocks with blank lines stay in one block
    assert.deepEqual(markdownStreamBlocks('$$\na = 1\n\nb = 2\n$$\n\nNext.'), ['$$\na = 1\n\nb = 2\n$$', 'Next.']);
    // Reference-like syntax inside fenced code does not defeat block splitting
    assert.deepEqual(markdownStreamBlocks('```yaml\n[section]: value\n```\n\nNext paragraph.'), ['```yaml\n[section]: value\n```', 'Next paragraph.']);
    // Stabilize streaming tail: escaped backticks and unclosed strong emphasis
    assert.equal(stabilizeStreamingMarkdownTail('Literal \\` backtick and `open code'), 'Literal \\` backtick and `open code`');
    assert.equal(stabilizeStreamingMarkdownTail('Streaming **bold text'), 'Streaming **bold text**');
});

test('inline <think> blocks in assistant_delta project as expandable reasoning rows', () => {
    const streamingProj = projectConversationStream({
        locale: 'zh-CN',
        running: true,
        events: [
            { type: 'model_phase', turn: 1, phase: 'thinking', at: at(1) },
            { type: 'assistant_delta', turn: 1, delta: '<think>分析问题步骤一\n步骤二', at: at(2) }
        ]
    });
    assert.equal(streamingProj.items.length, 1);
    assert.equal(streamingProj.items[0].kind, 'row');
    assert.equal(streamingProj.items[0].activity, 'reasoning');
    assert.equal(streamingProj.items[0].tone, 'running');
    assert.equal(streamingProj.items[0].title, '正在思考');
    assert.equal(streamingProj.items[0].details?.kind, 'markdown');

    const completedProj = projectConversationStream({
        locale: 'zh-CN',
        running: true,
        events: [
            { type: 'assistant_delta', turn: 1, delta: '<think>分析问题步骤一</think>\n最终结论内容', at: at(2) }
        ]
    });
    assert.equal(completedProj.items.length, 2);
    assert.equal(completedProj.items[0].kind, 'row');
    assert.equal(completedProj.items[0].activity, 'reasoning');
    assert.equal(completedProj.items[0].tone, 'done');
    assert.equal(completedProj.items[0].title, '已思考');
    assert.equal(completedProj.items[1].kind, 'text');
    assert.equal(completedProj.items[1].text, '最终结论内容');
});

test('activity visuals stay semantic across tool sources', () => {
    assert.equal(activityToolVisual('computer.click').kind, 'computer');
    assert.equal(activityToolVisual('mcp.github.search').kind, 'mcp');
    assert.equal(activityToolVisual('skill.run', 'skill').kind, 'skill');
    assert.equal(activityToolVisual('workspace.search_text').kind, 'search');
    assert.equal(activityToolVisual('process.wait').kind, 'waiting');
});
