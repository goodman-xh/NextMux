import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getComicDissolveOverlaps, resolveComicShotFades, resolveComicShotTransitions } from '@nextmux/comic-core/pipeline';
import { getComicAssetDurationFrames, getComicMediaDurationFrames } from '@nextmux/comic-core/media-timing';

// Exercise the actual host projection without booting the desktop shell.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let method;
function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'comicCutClips') method = node;
    ts.forEachChild(node, visit);
}
visit(file);
assert.ok(method);
const values = { getComicDissolveOverlaps, resolveComicShotFades, resolveComicShotTransitions, getComicAssetDurationFrames, getComicMediaDurationFrames };
const Harness = new Function(...Object.keys(values), ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`,
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(values));
const shot = (id, durationFrames, extra = {}) => ({ id, title: id, durationFrames, dialogueCues: [], cameraMotion: 'static',
    transition: 'cut', transitionIn: 'cut', transitionOut: 'cut', transitionOutExplicit: true, fadeInFrames: 0, fadeOutFrames: 0, volume: 1, ...extra });
function projectClips(shots, assets = []) {
    const scenes = [{ id: 'scene', shots }];
    const host = new Harness();
    Object.assign(host, { mediaState: { jobs: [] }, comicTimelineDocument: () => undefined, comicScenesForActiveEpisode: () => scenes, comicMediaUrl: uri => uri });
    return host.comicCutClips({ frameRate: 24, scenes, assets, characters: [] });
}

test('editor projection uses the same dissolve time as the render timeline, including short middle shots', () => {
    const clips = projectClips([shot('a', 24, { transitionOut: 'dissolve' }), shot('b', 10, { transition: 'dissolve' }),
        shot('c', 24, { transition: 'dissolve' })]);
    assert.deepEqual(clips.map(clip => Math.round(clip.start * 24)), [0, 16, 25]);
    assert.deepEqual(clips.map(clip => Math.round((clip.dissolveIn || 0) * 24)), [0, 8, 1]);
    assert.equal(Math.round((clips.at(-1).start + clips.at(-1).duration) * 24), 49);
});

test('preview and trim controls receive bounded source and independent audio out-points', () => {
    const assets = [{ id: 'video', kind: 'video', status: 'ready', durationMs: 2000, streamStartMs: 5000, uri: 'video.mp4' },
        { id: 'voice', kind: 'audio', status: 'ready', durationMs: 1000, streamStartMs: 500, uri: 'voice.wav' }];
    const [clip] = projectClips([shot('a', 36, { videoAssetId: 'video', audioAssetId: 'voice',
        mediaSourceStartFrames: { video: 12, voice: 6 }, mediaDurationFrames: { voice: 12 } })], assets);
    assert.equal(clip.videoStart, 0.5);
    assert.equal(clip.videoOrigin, 5);
    assert.equal(clip.videoLength, 2);
    assert.equal(clip.audio[0].start, 0.25);
    assert.equal(clip.audio[0].origin, 0.5);
    assert.equal(clip.audio[0].length, 0.5);
});

test('explicit cuts stay cuts and one-frame default fades stay within the shot', () => {
    const [cut] = projectClips([shot('a', 24)]);
    assert.equal(cut.transitionIn, 'cut');
    assert.equal(cut.transitionOut, 'cut');
    assert.equal(cut.fadeIn, undefined);
    const [short] = projectClips([shot('a', 1, { transition: 'fade', transitionOut: 'fade', fadeInFrames: undefined, fadeOutFrames: undefined })]);
    assert.equal(short.fadeIn, 1 / 24);
    assert.equal(short.fadeOut, undefined);
});
