import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contextRingLocales, contextRingText } from '../lib/browser/nextmux-context-ring-locale.js';

test('the context ring offers a one-shot compaction in every locale, with no pending or cancel wording', () => {
    assert.equal(contextRingLocales.length, 12);
    const toggleWords = /cancel|取消|キャンセル|취소|cancelar|annuler|abbrechen|отмен|إلغاء|रद्द|again|再次|もう一度|다시|queue|排队|pending|待/i;
    for (const locale of contextRingLocales) {
        const hint = contextRingText(locale, 'compactHint'), compacting = contextRingText(locale, 'compacting'), compacted = contextRingText(locale, 'compacted');
        assert.ok(hint && !hint.endsWith('…'), `${locale}: the idle hint invites a click`);
        assert.doesNotMatch(`${hint} ${compacting}`, toggleWords, `${locale}: compaction is an action, not a toggle`);
        assert.ok(compacting.endsWith('…'), `${locale}: compacting reads as in progress`);
        assert.ok(compacted && !compacted.endsWith('…') && compacted !== compacting, `${locale}: compacted reads as done`);
        const title = contextRingText(locale, 'title', { percent: 42, used: '54K', window: '128K' });
        assert.ok(title.includes('42') && title.includes('54K') && title.includes('128K') && !/\{\w+\}/.test(title), `${locale}: ${title}`);
        if (locale !== 'en') {
            assert.notEqual(compacting, contextRingText('en', 'compacting'), `${locale} is translated`);
            assert.notEqual(hint, contextRingText('en', 'compactHint'), `${locale} hint is translated`);
        }
    }
    const localeSource = readFileSync(new URL('../src/browser/nextmux-context-ring-locale.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(localeSource, /compactPending|compactCancel/, 'the toggle-era texts are gone, not just blank');
    assert.equal(contextRingText('zh-CN', 'compactHint'), '点击压缩上下文');
    assert.equal(contextRingText('zh-CN', 'compacting'), '正在压缩上下文…');
    assert.equal(contextRingText('zh-CN', 'compacted'), '已压缩上下文');
    assert.equal(contextRingText('en', 'compactHint'), 'Click to compact context');
    assert.equal(contextRingText('en', 'compacting'), 'Compacting context…');
    assert.equal(contextRingText('en', 'compacted'), 'Context compacted');
    assert.equal(contextRingText('zh-CN', 'title', { percent: 42, used: '54K', window: '128K' }), '上下文已使用 42% · 54K / 128K tokens');
    assert.equal(contextRingText('en', 'title', { percent: 42, used: '54K', window: '128K' }), 'Context used: 42% · 54K / 128K tokens');
});

test('a blank ring footnote leaves no divider or gap behind', () => {
    const css = readFileSync(new URL('../src/browser/style/nextmux-shell-polish.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-context-ring-popover > p:empty \{ display: none; \}/);
    assert.match(css, /\.nmx-context-ring-popover > dl:has\(\+ p:empty\) \{ margin-bottom: 0; \}/);
});
