import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Source loading isolates this review from concurrent package builds in the shared tree.
const source = await readFile(new URL('../src/browser/nextmux-media-surface-reviewed.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const { reviewedMediaSurfaceText, MEDIA_SURFACE_REVIEWED, MEDIA_SURFACE_LOCALES, MEDIA_FORMAT_TOKENS } = exports;
const audit = await readFile(new URL('../../../docs/LANGUAGE_AUDIT_2026-09-28.md', import.meta.url), 'utf8');
const section = audit.slice(audit.indexOf('### 中文候选（104个节点）'), audit.indexOf('### 英文直接节点（39个原始命中）'));
const candidates = section.split('\n').filter(line => line.includes('| WP3 |')).map(line => ({ number: Number(line.split('|')[1]), text: line.split('|')[3].trim() }));

test('all 54 WP3 appendix E nodes have explicitly reviewed text in all twelve locales', () => {
    assert.equal(candidates.length, 54);
    assert.equal(new Set(candidates.map(row => row.text)).size, 39);
    assert.deepEqual(MEDIA_SURFACE_LOCALES, ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']);
    for (const candidate of candidates) {
        const row = MEDIA_SURFACE_REVIEWED[candidate.text];
        assert.ok(row, `${candidate.number}: ${candidate.text}`);
        assert.equal(row.length, 12);
        for (const [index, locale] of MEDIA_SURFACE_LOCALES.entries()) {
            assert.ok(Object.hasOwn(row, index) && row[index].trim(), `${candidate.number}/${locale}: explicit entry, not fallback`);
            assert.equal(reviewedMediaSurfaceText(locale, candidate.text), row[index]);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(row[index], /\p{Script=Han}/u, `${candidate.number}/${locale}`);
        }
    }
    assert.equal(reviewedMediaSurfaceText('unknown', '字幕'), undefined, 'unsupported locale is not counted as authored coverage');
});

test('legitimate shared characters in Traditional Chinese and Japanese are retained deliberately', () => {
    for (const text of ['字幕', '秒', '音效', '淡入', '淡出', '格式', '音量（0–2）']) assert.equal(reviewedMediaSurfaceText('zh-TW', text), text);
    for (const text of ['字幕', '秒', '音量（0–2）', '保存中…']) assert.equal(reviewedMediaSurfaceText('ja', text), text);
});

test('review fixes untranslated Arabic and wrong-meaning labels beyond script checks', () => {
    const cases = [
        ['ar', '已生成', 'تم الإنشاء'], ['es', '添加', 'Añadir'], ['de', '添加', 'Hinzufügen'], ['pt-BR', '添加', 'Adicionar'],
        ['es', '草稿', 'Borrador'], ['fr', '草稿', 'Brouillon'], ['de', '草稿', 'Entwurf'],
        ['ja', '配音', '吹き替え'], ['ko', '配音', '더빙'], ['ru', '排除提示', 'Негативный промпт'],
        ['ja', '已生成', '生成済み'], ['ja', '片', '動画']
    ];
    for (const [locale, source, expected] of cases) assert.equal(reviewedMediaSurfaceText(locale, source), expected);
});

test('seconds and dimensions stay numeric while labels use the locale and keep format identifiers unchanged', () => {
    for (const locale of MEDIA_SURFACE_LOCALES) {
        for (const token of MEDIA_FORMAT_TOKENS) assert.equal(reviewedMediaSurfaceText(locale, token), undefined, token);
        assert.ok(reviewedMediaSurfaceText(locale, '2.50 秒').startsWith('2.50 '));
        assert.ok(reviewedMediaSurfaceText(locale, '12 秒 · 1920 × 1080').endsWith(' · 1920 × 1080'));
        const audio = reviewedMediaSurfaceText(locale, '5 秒 · 音频将作为独立轨道保存');
        assert.ok(audio.startsWith('5 '));
        assert.ok(audio.endsWith(reviewedMediaSurfaceText(locale, '音频将作为独立轨道保存')));
        assert.ok(reviewedMediaSurfaceText(locale, 'Voice ID'));
    }
    assert.equal(reviewedMediaSurfaceText('ja', '5 秒 · 音频将作为独立轨道保存'), '5 秒 · 音声は独立したトラックとして保存されます');
    assert.equal(reviewedMediaSurfaceText('es', ' 12 秒 '), ' 12 s ');
});

test('reviewed surface matching never modifies story, dialogue, titles, or unknown prose', () => {
    for (const locale of MEDIA_SURFACE_LOCALES) for (const value of ['她等了 5 秒。', 'My title: 字幕', '声音：你来了。', 'Voice ID: character-owned-text', '雨夜 / 清晨 / 自定义情节', 'Una frase escrita por el usuario']) {
        assert.equal(reviewedMediaSurfaceText(locale, value), undefined);
    }
});
