import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { localizedRuntimeActivity, localizedRuntimeToolTitle, runtimeActivityKinds } from '../lib/browser/nextmux-runtime-title-locale.js';
import { runtimeFinalText, normalizeRuntimeFinalMessage } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { completedConversationHistory, inheritConversationTurnsThroughMessage } from '../lib/browser/nextmux-conversation-branch.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const at = '2026-09-28T00:00:00.000Z';
const stopReasons = ['completed', 'pause_requested', 'cancel_requested', 'context_window_exceeded', 'media_context_compaction_required',
    'turn_limit_reached', 'tool_call_limit_reached', 'repeated_tool_calls', 'input_token_limit_reached', 'output_token_limit_reached',
    'token_usage_unknown', 'user_input_cancelled', 'user_input_expired', 'empty_response'];

test('every new activity kind is rendered from semantics in all 12 languages', () => {
    for (const kind of [...runtimeActivityKinds, 'tool.error', 'tool.execution_unknown', 'tool.started', 'tool.completed', 'agent.delegate']) {
        const summary = { kind, title: 'DO NOT SHOW 旧标题', params: { count: 3, sequence: 7, symbolCount: 5, running: true,
            incomplete: true, requiresMerge: true, status: 'completed', code: 'PERMISSION_DENIED' } };
        for (const locale of locales) {
            const rendered = localizedRuntimeActivity(locale, summary);
            assert.ok(rendered?.title, `${locale}:${kind}`);
            assert.doesNotMatch(JSON.stringify(rendered), /DO NOT SHOW|旧标题|undefined|\{\w+\}/);
            if (locale !== 'en') assert.notEqual(rendered.title, localizedRuntimeActivity('en', summary).title, `${locale}:${kind}`);
        }
    }
    assert.deepEqual(localizedRuntimeActivity('en', { kind: 'workspace.search_text', params: { count: 3, incomplete: true } }), {
        title: 'Search · Text', details: ['3 matches', 'Search coverage is incomplete; narrow the directory and search again.']
    });
    assert.equal(localizedRuntimeActivity('ja', { kind: 'skill.load', params: { name: '我的用户技能' } }).title, '読み取り · スキル: 我的用户技能',
        'user-owned names are registered language exceptions');
    assert.equal(localizedRuntimeToolTitle('fr', '读取项目记忆'), 'Lire la mémoire du projet', 'legacy journals still render');
});

test('stream failure and generic detail rows use semantic data instead of display diagnostics', () => {
    const events = [
        { type: 'tool_completed', callId: 'search', toolName: 'workspace.search_text', ok: true, at,
            summary: { kind: 'workspace.search_text', title: '中文不该泄漏', params: { count: 2, incomplete: true } } },
        { type: 'tool_completed', callId: 'failed', toolName: 'workspace.read_file', ok: false, at,
            summary: { kind: 'tool.error', title: 'Read target is not a file', params: { code: 'NOT_A_FILE' } } }
    ];
    for (const locale of locales) {
        const projected = projectConversationStream({ locale, events, running: false });
        assert.doesNotMatch(JSON.stringify(projected), /中文不该泄漏|Read target is not a file/);
        assert.match(JSON.stringify(projected), /NOT_A_FILE/);
    }
});

test('nonempty runtime stops localize in all 12 languages while authored responses stay untouched', () => {
    for (const stopReason of stopReasons) {
        const result = { finalText: 'A nonempty runtime fallback.', stopReason, finalMessage: { origin: 'runtime', stopReason, params: { maximum: 3 } } };
        for (const locale of locales) {
            const rendered = runtimeFinalText(locale, result);
            assert.ok(rendered, `${locale}:${stopReason}`);
            assert.notEqual(rendered, result.finalText);
            if (locale !== 'en') assert.notEqual(rendered, runtimeFinalText('en', result), `${locale}:${stopReason}`);
        }
    }
    assert.equal(runtimeFinalText('ja', { stopReason: 'pause_requested', finalText: '这是模型自己写的回答。' }), undefined);
    assert.equal(runtimeFinalText('ja', { stopReason: 'pause_requested', finalText: 'Task paused while I wait for the API key. I found a failing test in parser.ts.' }), undefined);
    assert.equal(runtimeFinalText('ja', { stopReason: 'context_window_exceeded', finalText: 'I found a failing test in parser.ts.' }), undefined);
    assert.equal(runtimeFinalText('en', { stopReason: 'pause_requested', finalText: '任务已暂停。' }), 'Task paused · ready to continue');
    assert.equal(normalizeRuntimeFinalMessage({ origin: 'model', stopReason: 'pause_requested' }), undefined);
    assert.equal(normalizeRuntimeFinalMessage({ origin: 'runtime', stopReason: 'injected' }), undefined);
});

test('history roundtrip preserves semantic activities and runtime final provenance and reprojects English to the model', () => {
    const finalMessage = { origin: 'runtime', stopReason: 'input_token_limit_reached', params: { maximum: 100 } };
    const turn = { id: 't1', prompt: '用户原文', response: '已达到输入令牌预算，未再发送请求。', stage: 'paused', createdAt: 1,
        error: '', finalMessage, stopReason: finalMessage.stopReason, events: [{ type: 'tool_completed', at,
            callId: 'c', toolName: 'tool.search', ok: true, summary: { kind: 'tool.search', params: { count: 2 }, title: '中文旧标题' } }] };
    const original = { id: 'session', workspacePath: '/w', title: '用户名称', createdAt: 1, updatedAt: 2, turns: [turn] };
    const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([original]))).sessions[0].turns[0];
    assert.deepEqual(restored.finalMessage, finalMessage);
    assert.deepEqual(restored.events[0].summary.params, { count: 2 });
    assert.equal(restored.events[0].summary.kind, 'tool.search');
    restored.events.push({ type: 'tool_completed', at, callId: 'old', toolName: 'comic.get_project', ok: false,
        summary: { title: '读取漫画项目', details: ['工程修订 3'] }, failure: { code: 'TOOL_FAILED', message: '中文系统失败' } });
    restored.events.push({ type: 'tool_started', at, callId: 'pending', toolName: 'nextmux.list_schedules', summary: { title: '读取项目计划', details: ['3 项计划'] } });
    const messages = completedConversationHistory([restored]);
    assert.ok(messages.find(message => message.role === 'user').content.startsWith('用户原文'));
    const modelText = messages.filter(message => message.role === 'assistant').map(message => message.content).join('\n');
    assert.match(modelText, /input-token budget/);
    assert.doesNotMatch(modelText, /已达到|中文旧标题|工程修订|中文系统失败|读取项目计划|项计划/);
    assert.equal(inheritConversationTurnsThroughMessage([restored], 't1', 'user')[0].finalMessage, undefined);
});

test('live, history, child and comic displays share semantic rendering at the edge', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /runtimeFinalText\(this\.desktopLocale, active\.result\)/);
    assert.match(widget, /finalMessage: liveResult\?\.finalMessage \|\| turn\.finalMessage/);
    assert.match(widget, /toolEvents\.slice\(-2\)\.map\(event => toolCompletionTitle\(this\.desktopLocale, event\)\)/);
    assert.match(widget, /bridge\.setAppLocale\?\.\(this\.desktopLocale\)/);
    assert.match(widget, /setAppLocale\?\.\(next\)/);
});
