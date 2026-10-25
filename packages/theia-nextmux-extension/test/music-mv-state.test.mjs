import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateMusicLyrics, estimateMusicMvCost, splitMusicMvSegments } from '@nextmux/comic-core/music-mv';
import {
    musicMvConfirmationKey, musicMvCurrent, musicMvRequestSeconds, musicMvSegmentCurrent, retainMusicMvMedia
} from '../lib/browser/nextmux-music-mv-state.js';

const lyrics = '[Verse]\n海风吹过\n[Chorus]\n你会回来';
function fixture() {
    const lines = estimateMusicLyrics(lyrics, 60_000);
    const mv = { songAssetId: 'asset-00000001', lyrics, durationMs: 60_000, alignment: 'estimated', lines,
        segments: splitMusicMvSegments(lines, 60_000, 'folk') };
    return { lyrics, instrumental: false, genre: 'folk', mood: '', tempo: '', vocals: '', language: 'zh', style: '', length: 'full', format: 'mp3', selectedAssetId: mv.songAssetId, mv };
}

test('MV freshness binds the selected song, exact authored lyrics and measured duration', () => {
    const settings = fixture();
    assert.equal(musicMvCurrent(settings, 60_000), true);
    assert.equal(musicMvCurrent(settings, 60_050), true, 'one frame of browser duration rounding is harmless');
    for (const [changed, duration] of [
        [{ ...settings, mv: undefined }, 60_000],
        [{ ...settings, selectedAssetId: 'asset-00000002' }, 60_000],
        [{ ...settings, lyrics: `${lyrics}！` }, 60_000],
        [{ ...settings, instrumental: true }, 60_000],
        [settings, 60_051], [settings, NaN],
    ]) assert.equal(musicMvCurrent(changed, duration), false);
});

test('instrumental MV keeps the saved lyrics but validates against its empty sung-lyrics snapshot', () => {
    const settings = fixture();
    const instrumental = { ...settings, instrumental: true, mv: { ...settings.mv, lyrics: '', lines: [] } };
    assert.equal(musicMvCurrent(instrumental, 60_000), true);
    assert.equal(musicMvCurrent({ ...instrumental, instrumental: false }, 60_000), false);
    assert.equal(instrumental.lyrics, lyrics, 'the instrumental toggle must not erase user-authored words');
});

test('late asynchronous segment results reject song, lyric, boundary, prompt and source changes', () => {
    const settings = fixture();
    const expected = structuredClone(settings.mv);
    const segment = expected.segments[0];
    assert.equal(musicMvSegmentCurrent(settings, expected, segment), true);
    const changeSegment = patch => ({ ...settings, mv: { ...settings.mv, segments: settings.mv.segments.map((item, index) => index ? item : { ...item, ...patch }) } });
    const cases = [
        undefined, { ...settings, mv: undefined },
        { ...settings, selectedAssetId: 'asset-00000002' },
        { ...settings, lyrics: `${lyrics}！` },
        { ...settings, instrumental: true },
        { ...settings, mv: { ...settings.mv, songAssetId: 'asset-00000002' } },
        { ...settings, mv: { ...settings.mv, lyrics: 'new song lyrics' } },
        { ...settings, mv: { ...settings.mv, durationMs: 59_000 } },
        { ...settings, mv: { ...settings.mv, segments: settings.mv.segments.slice(1) } },
        changeSegment({ startMs: 1 }), changeSegment({ endMs: segment.endMs - 1 }),
        changeSegment({ prompt: 'a new scene' }), changeSegment({ source: 'upload-image' }),
    ];
    for (const changed of cases) assert.equal(musicMvSegmentCurrent(changed, expected, segment), false);
});

test('saving an own job association or completing another segment does not invalidate the pending segment', () => {
    const settings = fixture();
    const expected = structuredClone(settings.mv);
    const segment = expected.segments[0];
    const changed = { ...settings, mv: { ...settings.mv, segments: settings.mv.segments.map((item, index) => index === 0
        ? { ...item, jobId: 'media-job-11111111-1111-1111-1111-111111111111' }
        : { ...item, assetId: 'asset-00000003' }) } };
    assert.equal(musicMvSegmentCurrent(changed, expected, segment), true);
});

test('realigned sections retain uploaded visuals, edited prompts and their own job associations', () => {
    const settings = fixture();
    const previous = settings.mv.segments.map((segment, index) => ({ ...segment, prompt: `edited ${index}`,
        source: index === 0 ? 'upload-image' : index === 1 ? 'upload-video' : 'ai-video',
        assetId: `asset-${String(index + 10).padStart(8, '0')}`, jobId: `media-job-${String(index + 1).repeat(8)}-1111-1111-1111-111111111111` }));
    const before = structuredClone(previous);
    const lines = settings.mv.lines.map((line, index) => index === 0 ? { ...line, endMs: 24_000 } : { ...line, startMs: 24_000 });
    const split = splitMusicMvSegments(lines, 60_000, 'new style');
    const retained = retainMusicMvMedia(split, previous);
    assert.equal(retained.length, 3, 'first section shrinks from two clips to one');
    assert.deepEqual(retained.map(segment => [segment.sectionIndex, segment.source, segment.assetId, segment.prompt]), [
        [0, 'upload-image', previous[0].assetId, 'edited 0'],
        [1, 'ai-video', previous[2].assetId, 'edited 2'],
        [1, 'ai-video', previous[3].assetId, 'edited 3'],
    ]);
    assert.equal(retained[1].jobId, previous[2].jobId, 'the chorus keeps its own job even when segment IDs move');
    assert.deepEqual(retained.map(segment => [segment.startMs, segment.endMs, segment.lineIds]), split.map(segment => [segment.startMs, segment.endMs, segment.lineIds]));
    assert.deepEqual(previous, before, 'saved previous data is never mutated');
});

test('newly added sections start with fresh AI prompts and no inherited media', () => {
    const settings = fixture();
    const fresh = { ...settings.mv.segments[0], id: 'segment-new', sectionIndex: 2, prompt: 'new outro' };
    const retained = retainMusicMvMedia([fresh], settings.mv.segments.map(segment => ({ ...segment, assetId: 'asset-00000055' })));
    assert.deepEqual(retained, [fresh]);
});

test('generation confirmation expires when its model, billing quote, selected source or inputs change', () => {
    const { mv } = fixture();
    const route = { id: 'provider-fixture', model: 'veo-3.1', quote: 'quote-fixture', width: 1920, height: 1080, price: { currency: 'USD', videoSecondMicros: 50_000 } };
    const key = musicMvConfirmationKey(mv, route);
    assert.equal(musicMvConfirmationKey(structuredClone(mv), structuredClone(route)), key);
    for (const patch of [{ id: 'another-provider' }, { model: 'sora-2' }, { quote: 'new-quote' }, { width: 1080 }, { height: 720 }, { price: { currency: 'USD', videoSecondMicros: 60_000 } }]) {
        assert.notEqual(musicMvConfirmationKey(mv, { ...route, ...patch }), key);
    }
    for (const patch of [{ songAssetId: 'asset-00000002' }, { durationMs: 59_000 }, { segments: mv.segments.slice(1) }]) {
        assert.notEqual(musicMvConfirmationKey({ ...mv, ...patch }, route), key);
    }
    for (const patch of [{ source: 'upload-image' }, { prompt: 'new prompt' }, { startMs: 1 }, { endMs: 20_000 }, { jobId: 'media-job-newly-queued' }]) {
        const changed = { ...mv, segments: mv.segments.map((segment, index) => index === 0 ? { ...segment, ...patch } : segment) };
        assert.notEqual(musicMvConfirmationKey(changed, route), key);
    }
    const completed = { ...mv, segments: mv.segments.map(segment => ({ ...segment, assetId: 'asset-00000055' })) };
    assert.equal(musicMvConfirmationKey(completed, route), key, 'a finished visual does not change the already confirmed generation request');
});

test('MV duration requests use supported model clip sizes and honour high-resolution restrictions', () => {
    const segment = seconds => ({ startMs: 10_000, endMs: 10_000 + seconds * 1_000 });
    assert.equal(musicMvRequestSeconds(segment(4), 'veo-3.1'), 4);
    assert.equal(musicMvRequestSeconds(segment(4.001), 'veo-3.1'), 6);
    assert.equal(musicMvRequestSeconds(segment(4), 'veo-3.1', true), 8);
    assert.equal(musicMvRequestSeconds(segment(25), 'veo-3.1'), 8, 'short generated clips loop across long MV segments');
    assert.equal(musicMvRequestSeconds(segment(25), 'seedance-2.5'), 25);
    assert.equal(musicMvRequestSeconds(segment(7), 'sora-2'), 8);
    assert.equal(musicMvRequestSeconds(segment(25), 'sora-2'), 12);
    assert.equal(musicMvRequestSeconds(segment(7.1), 'unknown-fixture-model'), 8);
    assert.equal(musicMvRequestSeconds(segment(25), 'unknown-fixture-model'), 25);
});

test('cost confirmation counts actual generated seconds while uploaded visuals cost no requests', () => {
    const segments = [
        { source: 'ai-video', startMs: 0, endMs: 25_000 },
        { source: 'upload-image', startMs: 25_000, endMs: 50_000 },
        { source: 'upload-video', startMs: 50_000, endMs: 75_000 },
        { source: 'ai-video', startMs: 75_000, endMs: 100_000 },
    ];
    const requestedSeconds = segments.filter(segment => segment.source === 'ai-video').map(segment => musicMvRequestSeconds(segment, 'veo-3.1'));
    assert.deepEqual(requestedSeconds, [8, 8]);
    assert.deepEqual(estimateMusicMvCost(segments, { perSecond: 0.05, requestedSeconds }), { segmentCount: 2, durationSeconds: 16, totalCost: 0.8 });
});
