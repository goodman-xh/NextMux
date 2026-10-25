import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { CitationList, ArchivedChildCitations, answerCitations, citationText } from '../lib/browser/nextmux-citations.js';
import { normalizeArchivedChildResults } from '../lib/common/nextmux-citation-display.js';
import { createConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { inheritConversationTurnsThroughMessage } from '../lib/browser/nextmux-conversation-branch.js';

const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const safe = { url: 'https://example.test/source', title: 'A source' };
const render = (citations, locale = 'en') => renderToStaticMarkup(React.createElement(CitationList, { citations, locale }));

test('real source component renders 12 locales, visible destination, safe anchors and bounded lists', () => {
    for (const locale of locales) {
        const html = render([safe], locale);
        assert.ok(html.includes(citationText(locale, 'sources'))); assert.ok(html.includes(citationText(locale, 'open')));
        assert.ok(html.includes('https://example.test/source')); assert.match(html, /rel="noopener noreferrer"/);
        assert.match(html, /referrerPolicy="no-referrer"/i); assert.match(html, /dir="ltr"/);
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
    assert.equal((render(Array.from({ length: 60 }, (_, i) => ({ url: `https://example.test/${i}` }))).match(/<a /g) || []).length, 24);
    assert.equal(render([]), '');
});

test('explicit links cannot execute scripts or render title HTML and never fetch or navigate on render', () => {
    const html = render([{ url: 'javascript:alert(1)' }, { url: 'file:///etc/passwd' }, { url: 'https://user:password@example.test' },
        { url: 'https://example.test/%0aheader' }, { ...safe, title: '<img src=x onerror=alert(1)>', providerState: 'PRIVATE_STATE', body: 'PRIVATE_BODY' }]);
    assert.equal((html.match(/<a /g) || []).length, 1);
    assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|javascript:|file:\/|PRIVATE_STATE|PRIVATE_BODY|password/);
    const opened = [];
    const component = CitationList({ locale: 'en', citations: [safe], onOpen: url => opened.push(url) });
    assert.deepEqual(opened, []);
    const link = component.props.children[1].props.children[0].props.children;
    let prevented = false; link.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.deepEqual(opened, [safe.url]);
});

test('a new answer without sources never inherits previous sources, and prompt-only branches strip them', () => {
    const turn = { id: 'a', prompt: 'Question', response: 'Answer', stage: 'complete', createdAt: 1, citations: [safe] };
    assert.deepEqual(answerCitations(turn), [safe]);
    assert.deepEqual(answerCitations(turn, {}), []);
    assert.deepEqual(answerCitations(turn, { citations: [{ url: 'https://other.test/current' }] }), [{ url: 'https://other.test/current' }]);
    const branch = inheritConversationTurnsThroughMessage([turn], 'a', 'user')[0];
    assert.equal(branch.citations, undefined); assert.deepEqual(answerCitations(branch), []);
    assert.deepEqual(answerCitations({ citations: [{ url: 'https://different.test/turn' }] }), [{ url: 'https://different.test/turn' }]);
});

test('history keeps only URL/title per turn and per model event, never arbitrary provider metadata', () => {
    const source = { ...safe, providerState: { token: 'PRIVATE_STATE' }, extra: 'PRIVATE_EXTRA' };
    const mirror = createConversationHistoryMirror([{ id: 's', workspacePath: '', title: 'History', createdAt: 1, updatedAt: 1, turns: [
        { id: 'a', prompt: 'A', response: 'Answer', citations: [source], events: [{ type: 'model_completed', turn: 1, toolCallCount: 0, at: 'now', citations: [source] }] },
        { id: 'b', prompt: 'B', response: 'Different answer' },
        { id: 'c', prompt: 'C', response: '', branchUserOnly: true, citations: [source] }
    ] }]);
    const turns = mirror.sessions[0].turns;
    assert.deepEqual(turns[0].citations, [safe]); assert.deepEqual(turns[0].events[0].citations, [safe]);
    assert.equal(turns[1].citations, undefined); assert.equal(turns[2].citations, undefined);
    assert.doesNotMatch(JSON.stringify(mirror), /PRIVATE/);
});

test('desktop binds sources to exact live session/turn and clears them for checkpoint continuation', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /const live = this\.activeAgentSessionId === codingSession\?\.id && this\.activeAgentTurnId === turn\.id;/);
    assert.match(source, /const liveResult = live \? result : undefined;/);
    assert.match(source, /const citations = answerCitations\(turn, liveResult\);/);
    assert.match(source, /stage: 'running', error: '', failure: undefined, createdAt: resumedCreatedAt, completedAt: undefined, citations: undefined/);
    assert.match(source, /citations: normalizeModelCitations\(run\.agentResult\.citations\)/);
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-answer-citations > ol\s*\{[^}]*max-height: 192px;[^}]*overflow: auto;/);
    assert.match(css, /\.nmx-citation-title, \.nmx-citation-url[^}]*overflow-wrap: anywhere/);
});

test('archived child sources remain separate, bounded, inert excerpts with prompt-only branch isolation', () => {
    const child = { childId: `archive-${'a'.repeat(32)}`, task: '<child task>', finalText: 'Answer '.repeat(4000), citations: [safe], privateState: 'PRIVATE' };
    const normalized = normalizeArchivedChildResults([child, child, { ...child, childId: 'live-run' }]);
    assert.equal(normalized.length, 1); assert.equal(normalized[0].truncated, true); assert.equal(normalized[0].finalText.length, 20_000);
    assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE/);
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(ArchivedChildCitations, { locale, results: normalized }));
        assert.match(html, /<details class="nmx-archived-child-citations"/); assert.doesNotMatch(html, /<details[^>]* open|<child task>/);
        assert.match(html, /https:\/\/example.test\/source/);
    }
    const turn = { id: 'a', prompt: 'Question', response: 'Parent answer', stage: 'complete', createdAt: 1, archivedChildResults: normalized };
    const mirror = createConversationHistoryMirror([{ id: 's', turns: [turn], createdAt: 1, updatedAt: 1 }]);
    assert.deepEqual(mirror.sessions[0].turns[0].archivedChildResults, normalized);
    assert.equal(mirror.sessions[0].turns[0].citations, undefined);
    const branch = inheritConversationTurnsThroughMessage([turn], 'a', 'user')[0];
    assert.equal(branch.archivedChildResults, undefined);
    const bounded = normalizeArchivedChildResults(Array.from({ length: 40 }, (_, i) => ({ ...child, childId: `archive-${i.toString(16).padStart(32, '0')}`,
        citations: Array.from({ length: 30 }, (_, n) => ({ url: `https://example.test/${n}` })) })));
    assert.equal(bounded.length, 32); assert.equal(bounded[0].citations.length, 24);
});
