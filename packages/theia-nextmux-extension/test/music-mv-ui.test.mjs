import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { MusicMvView, musicMvActiveIndex, musicMvVideoTime, musicMvAcceptsTap } from '../lib/browser/nextmux-music-mv.js';
import { MusicOutputView } from '../lib/browser/nextmux-music-studio.js';
import { musicMvCopy, musicMvText } from '../lib/browser/nextmux-music-mv-locale.js';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const noop = () => {};
const props = {
    locale: 'zh-CN', songUrl: '/song.wav', ratio: '16:9', durationMs: 30_000, alignment: 'estimated',
    lines: [{ id: 'line-1', text: '一行原创歌词', sectionIndex: 0, sectionTitle: 'Verse', startMs: 0, endMs: 30_000, alignment: 'estimated' }],
    segments: [{ id: 'segment-1', sectionIndex: 0, sectionTitle: 'Verse', startMs: 0, endMs: 30_000, lineIds: ['line-1'], prompt: 'Evening lights', source: 'ai-video' }],
    videoModel: React.createElement('div', null, 'Synthetic video model'), modelName: 'Synthetic video model',
    confirmationKey: 'synthetic-quote', estimateForSegments: ids => `$${ids.length.toFixed(2)}`, canGenerate: true,
    onAlign: noop, onTap: noop, onNudge: noop, onSegmentPrompt: noop, onSegmentSource: noop, onImport: noop, onGenerate: noop, onRebuild: noop, onNext: noop
};

test('every MV label covers all twelve desktop languages without fallback or unresolved placeholders', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const [key, labels] of Object.entries(musicMvCopy)) {
            assert.equal(labels.length, 12, key);
            const text = musicMvText(locale, key, { n: 3, text: 'Fixture', ratio: '16:9' });
            assert.ok(text.trim(), `${locale}.${key}`);
            assert.doesNotMatch(text, /\{\w+\}/, `${locale}.${key}`);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u, `${locale}.${key}`);
        }
    }
});

test('preview clock switches exactly at a cut and shows no caption in lyric gaps or after the song', () => {
    const ranges = [{ startMs: 0, endMs: 1_000 }, { startMs: 1_000, endMs: 2_000 }, { startMs: 3_000, endMs: 4_000 }];
    assert.equal(musicMvActiveIndex(ranges, 999), 0);
    assert.equal(musicMvActiveIndex(ranges, 1_000), 1);
    assert.equal(musicMvActiveIndex(ranges, 2_500), -1);
    assert.equal(musicMvActiveIndex(ranges, 4_000), -1);
    assert.equal(musicMvActiveIndex([], 0), -1);
});

test('a short silent visual loops from its section start and seeking uses the same offset', () => {
    assert.equal(musicMvVideoTime(8_500, 3_000, 4), 1.5);
    assert.equal(musicMvVideoTime(3_000, 3_000, 4), 0);
    assert.equal(musicMvVideoTime(2_000, 3_000, 4), 0);
    assert.equal(musicMvVideoTime(8_500, 3_000, Number.NaN), 5.5);
});

test('beat tapping ignores held keys, IME composition and text inputs', () => {
    assert.equal(musicMvAcceptsTap(' ', false, false, false), true);
    assert.equal(musicMvAcceptsTap(' ', true, false, false), false);
    assert.equal(musicMvAcceptsTap(' ', false, true, false), false);
    assert.equal(musicMvAcceptsTap(' ', false, false, true), false);
    assert.equal(musicMvAcceptsTap('Enter', false, false, false), false);
});

test('MV screen renders timed lines, source choices and exact model/cost data without invoking generation', () => {
    let generated = 0;
    const html = renderToStaticMarkup(React.createElement(MusicMvView, { ...props, onGenerate: () => generated++ }));
    assert.match(html, /一行原创歌词/);
    assert.match(html, /0:00.0/);
    assert.match(html, /本机自动对齐/);
    assert.match(html, /估算/);
    assert.match(html, /value="ai-video"/);
    assert.match(html, /value="upload-image"/);
    assert.match(html, /value="upload-video"/);
    assert.match(html, /\$1\.00/);
    assert.equal(generated, 0);
});

test('MV export needs complete visual sections but does not need an album cover', () => {
    const output = { locale: 'zh-CN', coverModel: null, drawingCover: false, ratio: '16:9', format: 'mp3', hasSong: true,
        hasMv: true, mvReady: true, busy: false, exporting: false,
        onGenerateCover: noop, onImportCover: noop, onExportAudio: noop, onExportVideo: noop };
    const ready = renderToStaticMarkup(React.createElement(MusicOutputView, output));
    assert.match(ready, /字幕直接烧录到画面/);
    assert.match(ready, /<button type="button" class="nmx-primary-button">导出视频<\/button>/);
    const incomplete = renderToStaticMarkup(React.createElement(MusicOutputView, { ...output, mvReady: false, coverUrl: '/cover.png' }));
    assert.match(incomplete, /<button type="button" class="nmx-primary-button" disabled="" title="请先完成或上传所有 MV 分段画面。">导出视频<\/button>/);
});
