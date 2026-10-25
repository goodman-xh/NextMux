import { modelFailure, modelFailureSource } from '../lib/browser/nextmux-model-errors.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import activity from '../lib/browser/nextmux-agent-activity.js';
import { goalTurnPresentation } from '../lib/browser/nextmux-goal-presentation.js';
import { withoutReplayedContextNote } from '../lib/browser/nextmux-conversation-branch.js';
import { projectConversationStream, activityToolVisual } from '../lib/browser/nextmux-conversation-stream-model.js';
import { ConversationStream, StreamNotice, StreamStatusRow } from '../lib/browser/nextmux-conversation-stream.js';
import { conversationStreamText } from '../lib/browser/nextmux-conversation-stream-locale.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { agentOutcomeText } from '../lib/browser/nextmux-agent-outcome-locale.js';

import { computerPermissionNames } from '../lib/browser/nextmux-computer-permission-wait.js';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react'), { renderToStaticMarkup } = core('react-dom/server');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file);
const workbench = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'renderCodingWorkbench');
const initializers = new Map(), branches = new Map();
function visit(node) {
    if (ts.isVariableDeclaration(node) && ['recordedActivityEvents', 'originalRawResponse', 'publicTurn', 'activityEvents', 'errorActivityEvents', 'cancelledActivityEvents'].includes(node.name.getText(file))) {
        initializers.set(node.name.getText(file), node.initializer.getText(file));
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression)) {
        const left = node.expression.left.getText(file);
        for (const stage of ['running', 'error', 'cancelled']) if (left === `stage === '${stage}'`) branches.set(stage, node.expression.getText(file));
    }
    ts.forEachChild(node, visit);
}
visit(workbench);
assert.equal(initializers.size, 6); assert.equal(branches.size, 3);
// Compile the actual turn projection and stage branches, not a fixture that
// reimplements the error rule. The activity renderer is production code too.
const dependencies = { modelFailure, modelFailureSource, React, goalTurnPresentation, withoutReplayedContextNote, ...activity, runningTaskText, localizeDesktopSurface, agentOutcomeText,
    projectConversationStream, ConversationStream, StreamNotice, StreamStatusRow, conversationStreamText, activityToolVisual, computerPermissionNames };
const Fixture = new Function(...Object.keys(dependencies), ts.transpile(`class Fixture {
    ${['renderModelFailureAction', 'renderAgentActivity', 'agentActivityToolVisual', 'agentActivityFallbackTitle', 'runningAgentTitle'].map(method).join('\n')}
    renderTurn(turn, stage, live = false, liveResult) {
        const failure = turn.failure, error = turn.error, manualResumeStrategy = undefined;
        const workspace = '/fixture', displayError = stage === 'error' ? '连接中断，请稍后重试。' : '', displayErrorDetail = undefined;
        turn = { prompt: '', response: '', ...turn };
        const recordedActivityEvents = ${initializers.get('recordedActivityEvents')};
        const originalRawResponse = ${initializers.get('originalRawResponse')};
        const publicTurn = ${initializers.get('publicTurn')};
        const activityEvents = ${initializers.get('activityEvents')};
        const errorActivityEvents = ${initializers.get('errorActivityEvents')};
        const cancelledActivityEvents = ${initializers.get('cancelledActivityEvents')};
        return <>${[...branches.values()].map(expression => `{${expression}}`).join('\n')}</>;
    }
}; return Fixture;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }))(...Object.values(dependencies));

function fixture() {
    return Object.assign(new Fixture(), { desktopLocale: 'zh-CN', liveAgentEvents: [], handleAssistantContentClick() {},
        renderThreadText: value => value, renderAgentCommandTerminal: () => null, renderSteeringActivity: () => null, resolvedDesktopTheme: () => 'dark',
        renderAssistantResponse: value => React.createElement('div', { className: 'nmx-assistant-markdown' }, value) });
}
const at = n => `2026-09-23T12:00:${String(n).padStart(2, '0')}.000Z`;
const events = [
    { type: 'model_started', turn: 1, at: at(0) },
    { type: 'assistant_delta', turn: 1, delta: '我先查看文件。', at: at(1) },
    { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(2) },
    { type: 'tool_completed', callId: 'read', toolName: 'workspace.read', ok: true,
        summary: { title: '已读取文件', details: [], resource: { kind: 'file', action: 'read', path: '/fixture/baseline.txt' } }, at: at(3) },
    { type: 'model_started', turn: 2, at: at(4) },
    { type: 'provider_reasoning', turn: 2, itemId: 'visible', content: '已经核对文件中的内容。', visibility: 'visible', status: 'streaming', at: at(5) },
    { type: 'provider_reasoning', turn: 2, itemId: 'private', content: 'PRIVATE_REASONING', visibility: 'hidden', status: 'complete', at: at(5) },
    { type: 'assistant_delta', turn: 2, delta: '读取结果已确认，接下来', at: at(6) },
];
const failure = [
    { type: 'model_phase', phase: 'failed', turn: 2, at: at(7) },
    { type: 'model_attempt_completed', turn: 2, attempt: 1, outcome: 'failed', retryScheduled: false,
        failure: { code: 'UND_ERR_SOCKET', requestId: 'private-request' }, at: at(8) },
    { type: 'model_retry_scheduled', turn: 2, attempt: 1, reason: 'UND_ERR_SOCKET', delayMs: 1, at: at(9) },
];

test('streamed text, visible thinking and completed tools survive a terminal connection failure in the real renderer', () => {
    const view = fixture(), liveTurn = { id: 'turn', events };
    const live = renderToStaticMarkup(view.renderTurn(liveTurn, 'running'));
    assert.match(live, /读取结果已确认，接下来/); assert.match(live, /nmx-stream-text is-streaming/);
    const stoppedTurn = { ...liveTurn, events: [...events, ...failure] }, saved = JSON.stringify(stoppedTurn.events);
    const stopped = renderToStaticMarkup(view.renderTurn(stoppedTurn, 'error'));
    for (const text of ['我先查看文件。', 'baseline.txt', '已经核对文件中的内容。', '读取结果已确认，接下来']) assert.ok(stopped.includes(text), text);
    assert.doesNotMatch(stopped, /UND_ERR_SOCKET|private-request|PRIVATE_REASONING|nmx-stream-caret|is-streaming/);
    assert.equal((stopped.match(/连接中断，请稍后重试。/g) || []).length, 1);
    assert.ok(stopped.indexOf('读取结果已确认，接下来') < stopped.indexOf('连接中断，请稍后重试。'), 'the error follows already produced output');
    assert.equal(JSON.stringify(stoppedTurn.events), saved, 'presentation never removes persisted diagnostic events');
    assert.equal(renderToStaticMarkup(fixture().renderTurn(stoppedTurn, 'error')), stopped, 'revisiting a failed turn retains the same transcript');
    // Only a failure happening now interrupts a screen reader; history stays quiet.
    assert.match(stopped, /class="nmx-stream-notice is-error" role="status"/);
    assert.match(renderToStaticMarkup(view.renderTurn(stoppedTurn, 'error', true)), /class="nmx-stream-notice is-error" role="alert"/);
});

test('failed turns retain result-snapshot output and useful tool errors without repeating journal chunks', () => {
    const view = fixture();
    const toolError = { type: 'tool_completed', callId: 'missing', toolName: 'workspace.read', ok: false,
        summary: { title: '读取文件失败', details: ['文件不存在'], resource: { kind: 'file', action: 'read', path: '/fixture/missing.txt' } }, at: at(7) };
    const turn = { id: 'turn', events: events.slice(0, 4) };
    const html = renderToStaticMarkup(view.renderTurn(turn, 'error', true, { events: [...events, toolError, ...failure] }));
    assert.equal((html.match(/我先查看文件。/g) || []).length, 1);
    assert.match(html, /读取结果已确认，接下来/); assert.match(html, /读取文件失败/);
    assert.doesNotMatch(html, /UND_ERR_SOCKET/);
    // The useful tool error stays in the row's collapsed details (shown on click).
    const row = projectConversationStream({ locale: 'zh-CN', events: [toolError], running: false }).items[0];
    assert.equal(row.tone, 'failed'); assert.equal(row.details.text, '文件不存在');
});

test('computer failures use the same localized label in live and completed views while keeping diagnostics in details', () => {
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) for (const [status, ok, sourceTitle, expectedKey] of [
        ['failed', false, 'computer_operation_failed', '电脑操作未完成'],
        ['failed', false, 'COMPUTER_SNAPSHOT_STALE', '电脑操作未完成'],
        ['timed_out', false, 'computer_operation_failed', '电脑操作未完成'],
        ['failed', false, '填写应用控件', '电脑操作未完成'],
        ['cancelled', false, 'cancelled', '电脑操作已取消。'],
    ]) {
        const view = fixture(); view.desktopLocale = locale;
        const event = { type: 'tool_completed', callId: 'native-computer', toolName: 'computer.set_value', ok, status,
            summary: { title: sourceTitle, details: [sourceTitle, 'Window checked'] }, at: at(7) };
        const before = JSON.stringify(event), expected = localizeDesktopSurface(locale, expectedKey);
        assert.equal(view.runningAgentTitle([event]), expected);
        const row = projectConversationStream({ locale, events: [event], running: false }).items[0];
        const summary = [row.title, row.target, row.chip].filter(Boolean).join(' ');
        assert.ok(summary.includes(expected) || row.title === activity.toolCompletionTitle(locale, event), `${locale}/${status}: ${summary}`);
        if (sourceTitle !== 'cancelled') assert.ok(!summary.includes(sourceTitle), 'diagnostic code and successful action labels cannot replace failure state');
        assert.equal(row.details.text.split(sourceTitle).length - 1, 1, 'diagnostic title is retained once in expanded details');
        assert.match(row.details.text, /Window checked/);
        assert.equal(row.tone, status === 'cancelled' ? 'stopped' : 'failed');
        assert.equal(JSON.stringify(event), before, 'the durable record remains unchanged');
    }
});

test('computer presentation does not reinterpret successful actions, file names or unrelated tool summaries', () => {
    const view = fixture();
    for (const [toolName, ok, title] of [
        ['computer.set_value', true, '填写应用控件'],
        ['workspace.read', false, 'computer_operation_failed.txt'],
        ['workspace.read', false, 'my_file_name'],
        ['mcp.custom.action', false, '请先登录服务'],
    ]) {
        const event = { type: 'tool_completed', callId: 'operation', toolName, ok,
            summary: { title }, at: at(7) };
        assert.equal(activity.toolCompletionTitle('zh-CN', event), title);
        assert.equal(view.runningAgentTitle([event]), title);
    }
});

test('user cancellation keeps the existing stopped transcript and never gains a connection failure', () => {
    const aborted = { type: 'model_attempt_completed', turn: 2, attempt: 1, outcome: 'failed', retryScheduled: false,
        failure: { code: 'ABORTERROR', stage: 'unknown', category: 'unknown' }, at: at(8) };
    const journal = [...events, aborted], saved = JSON.stringify(journal);
    const html = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: journal, stopReason: 'cancel_requested' }, 'cancelled'));
    assert.match(html, /我先查看文件。/); assert.match(html, /baseline.txt/); assert.match(html, /读取结果已确认，接下来/);
    assert.doesNotMatch(html, /连接中断|模型调用未完成|ABORTERROR|nmx-stream-caret|is-streaming/);
    assert.equal(JSON.stringify(journal), saved, 'expected cancellation remains in the diagnostic journal');
    const live = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: journal }, 'cancelled', true, { stopReason: 'cancel_requested' }));
    assert.doesNotMatch(live, /模型调用未完成|ABORTERROR/);
    const unconfirmed = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: journal }, 'cancelled'));
    // Raw codes stay in the journal (capacity-reasons-metadata); the localized row is the visible evidence.
    assert.match(unconfirmed, /模型调用未完成/, 'an abort without user cancellation evidence must not be silently dismissed');
    assert.doesNotMatch(unconfirmed, /ABORTERROR/);
});

test('user cancellation suppresses only the final known abort, never an earlier or differently classified provider failure', () => {
    const attempt = (code, category = 'unknown', stage = 'unknown') => ({ type: 'model_attempt_completed', turn: 2, attempt: 1, outcome: 'failed', retryScheduled: false,
        failure: { code, category, stage }, at: at(8) });
    for (const last of [attempt('UND_ERR_SOCKET', 'network', 'stream'), attempt('ABORTERROR', 'upstream', 'response'), attempt('TIMEOUT', 'timeout', 'connection')]) {
        const html = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: [...events, last], stopReason: 'cancel_requested' }, 'cancelled'));
        assert.match(html, /模型调用未完成/); assert.ok(!html.includes(last.failure.code));
    }
    for (const last of [attempt('CANCELLED', 'cancelled', 'cancelled'), attempt('ABORT_ERR'), attempt('ABORTERROR')]) {
        const previous = { ...attempt('UND_ERR_SOCKET', 'network', 'stream'), at: at(7) };
        const html = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: [...events, previous, last], stopReason: 'cancel_requested' }, 'cancelled'));
        // Only the earlier socket failure keeps its row; the final user abort is dropped.
        assert.equal((html.match(/模型调用未完成/g) || []).length, 1);
    }
    const retrying = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: [...events,
        { ...attempt('ABORTERROR'), retryScheduled: true }], stopReason: 'cancel_requested' }, 'cancelled'));
    assert.match(retrying, /模型连接未完成，正在重试/, 'stopping during a scheduled retry must not erase its preceding failure');
    const priorAbort = { ...attempt('ABORTERROR'), at: at(7) };
    const completed = { ...attempt('MODEL_OK'), outcome: 'succeeded' };
    const toolStop = renderToStaticMarkup(fixture().renderTurn({ id: 'cancelled', events: [...events, priorAbort, completed], stopReason: 'cancel_requested' }, 'cancelled'));
    assert.match(toolStop, /模型调用未完成/, 'a later successful model call prevents a tool-phase cancellation hiding older evidence');
});

test('confirmed AX uncertainty has a localized pending-confirmation label, never fabricated success or definite failure', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const view = fixture(); view.desktopLocale = locale;
        const event = { type: 'tool_completed', callId: 'ax-click', toolName: 'computer.click', ok: false, status: 'failed',
            failure: { code: 'COMPUTER_AX_ACTION_UNCONFIRMED', message: 'computer_ax_action_unconfirmed' },
            summary: { title: 'computer_ax_action_unconfirmed。先查看最新界面。' }, at: at(7) };
        const expected = localizeDesktopSurface(locale, '操作结果待确认');
        if (locale !== 'zh-CN') assert.notEqual(expected, '操作结果待确认', `${locale} has a translation`);
        assert.equal(view.runningAgentTitle([event]), expected);
        const row = projectConversationStream({ locale, events: [event], running: false }).items[0];
        const summary = [row.title, row.target, row.chip].filter(Boolean).join(' ');
        assert.ok(summary.includes(expected), `${locale}: ${summary}`); assert.doesNotMatch(summary, /computer_ax_action_unconfirmed/);
        assert.ok(!summary.includes(localizeDesktopSurface(locale, '电脑操作未完成')));
        assert.match(row.details.text, /computer_ax_action_unconfirmed/, 'the code remains available in expanded diagnostics');
        assert.equal(activity.toolCompletionTitle(locale, { ...event, ok: true, status: 'succeeded', summary: { title: '点击应用控件' } }), '点击应用控件');
        assert.equal(activity.toolCompletionTitle(locale, { ...event, status: 'cancelled' }), localizeDesktopSurface(locale, '电脑操作已取消。'));
        assert.equal(activity.toolCompletionTitle(locale, { ...event, toolName: 'custom.tool' }), event.summary.title);
    }
});


test('actual streamed goal renderer hides only its control footer and restores later authored text', () => {
    const prompt = '执行持续目标：Read the file.\n完成后请验证结果；若尚未完成继续处理，完成时在最后一行输出 [GOAL_COMPLETE]。';
    const turn = { id: 'goal', prompt, goalPresentationOrigin: 'automatic-v1', events: [
        { type: 'model_started', turn: 1, at: at(0) },
        { type: 'assistant_delta', turn: 1, delta: 'Current file verified.\n[GOAL_COMPLETE]', at: at(1) }
    ] };
    const view = fixture();
    const html = renderToStaticMarkup(view.renderTurn(turn, 'running'));
    assert.match(html, /Current file verified/); assert.doesNotMatch(html, /GOAL_COMPLETE/);
    const continued = { ...turn, events: [...turn.events, { type: 'assistant_delta', turn: 1, delta: '\nAdditional actual text.', at: at(2) }] };
    assert.match(renderToStaticMarkup(view.renderTurn(continued, 'running')), /GOAL_COMPLETE/);
    assert.match(renderToStaticMarkup(view.renderTurn({ ...turn, goalPresentationOrigin: 'user' }, 'running')), /GOAL_COMPLETE/);
    assert.match(turn.events[1].delta, /GOAL_COMPLETE/);
});
