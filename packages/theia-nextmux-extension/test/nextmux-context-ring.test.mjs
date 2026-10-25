import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { contextRingText } from '../lib/browser/nextmux-context-ring-locale.js';
import { compactedConversationHistory } from '../lib/browser/nextmux-conversation-branch.js';
import { estimateTextTokens } from '../lib/common/nextmux-large-document.js';
import { contextWindowTokenLabel, effectiveContextWindowTokens, modelContextWindowTokens } from '../lib/common/nextmux-context-budget.js';

// The context ring's compaction is a one-shot action (like /compact): it turns for 550 ms, then the ring is idle again
// with the lower figure. These tests run the widget's own methods, extracted from the source.
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const member = name => {
    const found = widget.members.find(node => (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(ast) === name);
    assert.ok(found, `NextMuxDesktopWidget.${name} exists`);
    return found.getText(ast);
};
const members = ['compactNextRunSessionIds', 'compactingSessionIds', 'compactedSessionTurnCounts', 'compactingTimers', 'contextRingCache',
    'renderComposerContextRing', 'completeComposerContextCompaction', 'codingConversationHistory'].map(member);
const deps = { React, contextRingText, compactedConversationHistory, estimateTextTokens, contextWindowTokenLabel, effectiveContextWindowTokens, modelContextWindowTokens };
const Harness = new Function(...Object.keys(deps), ts.transpileModule(`class Harness { ${members.join('\n')} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText)(...Object.values(deps));

const turn = (index, size = 6_000) => ({ id: `turn-${index}`, prompt: `Question ${index} ${'q'.repeat(size)}`, response: `Answer ${index} ${'a'.repeat(size)}`,
    stage: 'complete', createdAt: index, completedAt: index });
const session = (count = 8) => ({ id: 'session-a', turns: Array.from({ length: count }, (_, index) => turn(index)) });

function fixture() {
    const harness = Object.assign(new Harness(), { desktopLocale: 'zh-CN', prompt: '', renders: 0 });
    harness.update = () => { harness.renders += 1; };
    return harness;
}
function descendants(element) {
    if (!React.isValidElement(element)) return [];
    return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}
function ring(harness, conversation) {
    const element = harness.renderComposerContextRing(conversation, undefined);
    const button = descendants(element).find(node => node.type === 'button');
    const html = renderToStaticMarkup(element);
    return { element, button, html, percent: Number(/上下文 (\d+)%/.exec(button.props['aria-label'])[1]) };
}
const historyCharacters = (harness, conversation) => harness.codingConversationHistory(conversation)
    .reduce((sum, message) => sum + String(message.content).length, 0);

test('an unstarted conversation renders no context ring, and started conversations exclude static system instructions from the budget', () => {
    const harness = fixture();
    assert.equal(harness.renderComposerContextRing(undefined, undefined), null);
    assert.equal(harness.renderComposerContextRing(session(0), undefined), null);
    const active = ring(harness, session(2));
    assert.doesNotMatch(active.html, /系统与工具指令|指令|System & tool instructions/);
    assert.match(active.html, /对话记录/);
});

const enableTimers = t => {
    try { t.mock.timers.enable({ apis: ['setTimeout'] }); } catch { t.mock.timers.enable(['setTimeout']); }
};

test('a click compacts once: the ring turns for 550 ms, then shows the lower figure with its idle look', t => {
    enableTimers(t);
    const harness = fixture(), conversation = session();
    const idle = ring(harness, conversation);
    assert.match(idle.html, /class="nmx-context-ring-anchor"/);
    assert.doesNotMatch(idle.html, /aria-pressed|aria-busy|is-compact/);
    assert.match(idle.html, /<p>点击压缩上下文<\/p>/);
    assert.match(idle.html, new RegExp(`上下文已使用 ${idle.percent}% · [0-9.]+K / 128K tokens`));

    idle.button.props.onClick();
    assert.equal(harness.compactingSessionIds.has('session-a'), true);
    const turning = ring(harness, conversation);
    assert.match(turning.html, /class="nmx-context-ring-anchor is-compacting"/);
    assert.match(turning.html, /aria-busy="true"/);
    assert.match(turning.html, /<p>正在压缩上下文…<\/p>/);
    assert.equal(turning.percent, idle.percent, 'the figure changes when the turn ends, not while it runs');

    t.mock.timers.tick(549);
    assert.equal(harness.compactingSessionIds.has('session-a'), true);
    t.mock.timers.tick(1);
    assert.equal(harness.compactingSessionIds.has('session-a'), false);
    assert.equal(harness.compactNextRunSessionIds.has('session-a'), true);
    assert.equal(harness.compactedSessionTurnCounts.get('session-a'), 8);
    assert.equal(harness.compactingTimers.size, 0);

    const done = ring(harness, conversation);
    assert.match(done.html, /class="nmx-context-ring-anchor"/, 'back to the idle look: no pending, pressed or accent state');
    assert.doesNotMatch(done.html, /aria-pressed|aria-busy|is-compact/);
    assert.match(done.html, /<p>点击压缩上下文<\/p>/, 'the idle hint invites the next compaction');
    assert.ok(done.percent < idle.percent, `the compacted figure is lower (${idle.percent}% → ${done.percent}%)`);
});

test('clicking again never cancels: it turns again and moves the watermark to the turns there are now', t => {
    enableTimers(t);
    const harness = fixture(), conversation = session();
    ring(harness, conversation).button.props.onClick();
    t.mock.timers.tick(550);
    const compacted = ring(harness, conversation);

    // The same turns: the click replays the turn and keeps the compaction.
    compacted.button.props.onClick();
    const replaying = ring(harness, conversation);
    assert.match(replaying.html, /is-compacting/);
    assert.equal(harness.compactNextRunSessionIds.has('session-a'), true, 'a second click never deletes the compaction');
    assert.equal(replaying.percent, compacted.percent, 'nor does the figure jump back up while the ring turns');
    replaying.button.props.onClick();
    t.mock.timers.tick(550);
    assert.equal(harness.renders, 4, 'a click during the turn is the same request: one start and one end per compaction');
    const again = ring(harness, conversation);
    assert.equal(again.percent, compacted.percent);
    assert.equal(harness.compactedSessionTurnCounts.get('session-a'), 8);
    assert.doesNotMatch(again.html, /aria-pressed|is-compact/);

    // Two more turns later, a click compacts up to them.
    const longer = { ...conversation, turns: [...conversation.turns, turn(8), turn(9)] };
    const grown = ring(harness, longer);
    grown.button.props.onClick();
    t.mock.timers.tick(550);
    assert.equal(harness.compactedSessionTurnCounts.get('session-a'), 10);
    assert.ok(ring(harness, longer).percent < grown.percent);
});

test('a compacted conversation keeps sending its compacted history while the ring turns again', t => {
    enableTimers(t);
    const harness = fixture(), conversation = session();
    const full = historyCharacters(harness, conversation);
    ring(harness, conversation).button.props.onClick();
    assert.equal(historyCharacters(harness, conversation), full, 'the watermark lands when the turn ends');
    t.mock.timers.tick(550);
    const compacted = historyCharacters(harness, conversation);
    assert.ok(compacted < full, 'older turns are summarized from the next message on');
    ring(harness, conversation).button.props.onClick();
    assert.equal(historyCharacters(harness, conversation), compacted, 'a repeated compaction never sends the full history meanwhile');
});

test('the ring has no pending or pressed look, and its turn is exactly one 550 ms rotation', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    const polish = readFileSync(new URL('../src/browser/style/nextmux-shell-polish.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css + polish, /is-compact-pending/);
    assert.match(css, /\.nmx-context-ring-anchor\.is-compacting \.nmx-context-ring-button svg \{\s*animation: nmx-context-ring-spin 550ms [^;]* 1;/);
    assert.doesNotMatch(css, /\.is-compacting \.nmx-context-ring-value/, 'the gauge itself turns; no spinner arc to jump back from');
    assert.ok(css.includes('.nmx-context-ring-anchor.is-compacting .nmx-context-ring-button svg { animation: none; }'), 'reduced motion keeps the accent state without the turn');
    const method = member('renderComposerContextRing');
    assert.match(method, /, 550\)\)/, 'the widget holds is-compacting for the same 550 ms');
    assert.doesNotMatch(method + member('completeComposerContextCompaction'), /aria-pressed|compactNextRunSessionIds\.delete|compactedSessionTurnCounts\??\.delete/);
});
