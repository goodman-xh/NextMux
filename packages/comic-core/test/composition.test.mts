import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComicCommand, applyComicEditorEdits, createComicProject, parseComicProject, serializeComicProject, summarizeComicProject } from '../lib/index.js';
import { applyComicCompositionOperation as edit, comicCompositionDurationFrames, evaluateComicCompositionClip as sampleClip,
  resolveComicComposition, sampleComicComposition, splitComicCompositionClip, trimComicCompositionClip, resizeComicCompositionClip, evaluateComicCompositionProperty, validateComicComposition,
  comicCompositionClipPermissions, comicCompositionTextLines, setComicCompositionFade,
  type ComicComposition, type ComicCompositionClip, type ComicCompositionEasing } from '../lib/composition.js';
import { validateCanvasTimeline, restoreCanvasTimeline } from '../lib/canvas-timeline.js';

const now = '2026-10-04T00:00:00.000Z';
function project() {
  let count = 0;
  const idFactory = (prefix: string): string => `${prefix}-${String(++count).padStart(8, '0')}`;
  let p = createComicProject({ title: 'Multitrack', starter: 'empty', frameRate: 30, now, idFactory });
  for (const [i, kind] of ['video', 'image', 'music', 'audio', 'subtitle'].entries()) p = applyComicCommand(p, {
    type: 'asset.import', expectedRevision: p.revision, asset: { id: `asset-0000010${i}`, kind: kind as any,
      uri: `nextmux.media/imports/${i}.${kind === 'image' ? 'png' : kind === 'subtitle' ? 'srt' : 'mp4'}`,
      mimeType: kind === 'image' ? 'image/png' : kind === 'subtitle' ? 'application/x-subrip' : kind === 'video' ? 'video/mp4' : 'audio/mp4',
      source: 'imported', provider: 'local', model: 'source', byteLength: 1000, sha256: `${i + 1}`.repeat(64),
      jobId: `media-job-${`${i + 1}`.repeat(8)}-${`${i + 1}`.repeat(4)}-${`${i + 1}`.repeat(4)}-${`${i + 1}`.repeat(4)}-${`${i + 1}`.repeat(12)}`,
      ...(kind === 'image' || kind === 'subtitle' ? {} : { durationMs: 10_000 }) },
  }, { now, idFactory });
  return { p, idFactory };
}
function base(): ComicComposition {
  return { schemaVersion: 1, tracks: [{ id: 'picture', title: 'Picture', kind: 'video' }, { id: 'audio', title: 'Music', kind: 'audio' }, { id: 'text', title: 'Titles', kind: 'text' }],
    clips: [{ id: 'video', trackId: 'picture', kind: 'video', assetId: 'asset-00000100', from: 0, durationFrames: 120, sourceStartFrames: 30 },
      { id: 'music', trackId: 'audio', kind: 'audio', assetId: 'asset-00000102', from: 45, durationFrames: 210, sourceStartFrames: 60 },
      { id: 'title', trackId: 'text', kind: 'text', purpose: 'title', text: 'A title', from: 10, durationFrames: 50, sourceStartFrames: 0 }] };
}

test('independent tracks preserve overlapping starts, source offsets, gaps and the real tail', () => {
  const { p } = project(), comp = validateComicComposition(base(), p);
  assert.equal(comicCompositionDurationFrames(comp), 255);
  assert.deepEqual(sampleComicComposition(comp, 50).map(s => [s.clip.id, s.localFrame, s.sourceFrame]), [['video', 50, 80], ['music', 5, 65], ['title', 40, 40]]);
  assert.equal(sampleComicComposition(comp, 255).length, 0);
  const moved = edit(comp, { type: 'clip.move', clipId: 'video', from: 400 }, p);
  assert.equal(comicCompositionDurationFrames(moved), 520);
  assert.equal(sampleComicComposition(moved, 300).length, 0, 'a black gap is legal without a fake picture');
  assert.equal(comp.clips[0].from, 0, 'edits are immutable');
});

test('track paint order, hiding, muting and solo are separate from instant gain', () => {
  const { p } = project();
  let comp = edit(base(), { type: 'track.update', trackId: 'picture', patch: { hidden: true, volume: .4 } }, p);
  let samples = sampleComicComposition(comp, 50);
  assert.equal(samples[0].visible, false); assert.equal(samples[0].audible, true);
  comp = edit(comp, { type: 'track.update', trackId: 'audio', patch: { muted: true, solo: true } }, p);
  samples = sampleComicComposition(comp, 50);
  assert.ok(samples.every(s => !s.visible && !s.audible));
  comp = edit(base(), { type: 'clip.update', clipId: 'video', patch: { transform: { opacity: 0 }, volume: 0 } }, p);
  const video = sampleComicComposition(comp, 50)[0];
  assert.equal(video.visible, true); assert.equal(video.audible, true);
  assert.equal(video.opacity, 0); assert.equal(video.volume, 0);
});

test('source bounds, duplicate identities, integer frames, track kind and keyframe limits are validated', () => {
  const { p } = project();
  for (const patch of [{ sourceStartFrames: 290 }, { from: -1 }, { durationFrames: 1.5 }, { from: Infinity }, { transform: { scale: 0 } }])
    assert.throws(() => edit(base(), { type: 'clip.update', clipId: 'video', patch }, p));
  assert.throws(() => edit(base(), { type: 'clip.add', clip: base().clips[0] }, p), /duplicate/);
  assert.throws(() => edit(base(), { type: 'clip.move', clipId: 'video', trackId: 'audio', from: 0 }, p), /kind/);
  assert.throws(() => edit(base(), { type: 'keyframe.set', clipId: 'video', keyframe: { property: 'opacity', frame: 121, value: 1, easing: 'linear' } }, p));
  assert.throws(() => validateComicComposition({ ...base(), clips: Array(10001).fill(base().clips[0]) }, p), /limit/);
});

test('locked tracks cannot be bypassed by replace, split, removal, move or simultaneous unlock', () => {
  const { p } = project(), locked = edit(base(), { type: 'track.update', trackId: 'picture', patch: { locked: true } }, p);
  for (const operation of [
    { type: 'clip.remove', clipId: 'video' }, { type: 'clip.split', clipId: 'video', atFrame: 30, rightId: 'right' },
    { type: 'track.remove', trackId: 'picture' }, { type: 'track.move', trackId: 'picture', index: 1 },
    { type: 'replace', composition: { ...base(), clips: base().clips.slice(1) } },
  ] as const) assert.throws(() => edit(locked, operation, p), { code: 'TRACK_LOCKED' });
  assert.doesNotThrow(() => edit(locked, { type: 'track.update', trackId: 'picture', patch: { locked: false } }, p));
  assert.doesNotThrow(() => edit(locked, { type: 'clip.move', clipId: 'music', from: 10 }, p));
  assert.doesNotThrow(() => edit(locked, { type: 'track.move', trackId: 'audio', index: 0 }, p), 'another track can cross a locked one');
  assert.doesNotThrow(() => edit(locked, { type: 'track.update', trackId: 'picture', patch: { hidden: true, muted: true, solo: true, volume: .5 } }, p));
});

test('resizing can recover source head and extend the tail without resetting remaining keyframes', () => {
  const { p } = project();
  const clip: ComicCompositionClip = { ...base().clips[0], from: 60, keyframes: [
    { property: 'x', frame: 0, value: 0, easing: 'easeIn' }, { property: 'x', frame: 120, value: 100, easing: 'linear' }], fadeInFrames: 15 };
  const cropped = trimComicCompositionClip(clip, 10, 100), recovered = resizeComicCompositionClip(cropped, -5, 100);
  assert.equal(recovered.from, 65); assert.equal(recovered.sourceStartFrames, 35); assert.equal(recovered.durationFrames, 105);
  for (let frame = 5; frame < 95; frame++) assert.ok(Math.abs(evaluateComicCompositionProperty(recovered, 'x', frame) - evaluateComicCompositionProperty(cropped, 'x', frame - 5)) < 1e-9);
  assert.equal(evaluateComicCompositionProperty(recovered, 'x', 0), evaluateComicCompositionProperty(cropped, 'x', 0));
  const comp: ComicComposition = { ...base(), clips: [clip] };
  assert.doesNotThrow(() => edit(comp, { type: 'clip.trim', clipId: clip.id, startFrame: -20, endFrame: 160 }, p));
  assert.throws(() => edit(comp, { type: 'clip.trim', clipId: clip.id, startFrame: -31, endFrame: 160 }, p), /range/);
  assert.throws(() => edit(comp, { type: 'clip.trim', clipId: clip.id, startFrame: 0, endFrame: 290 }, p), /source media/);
});

for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'] as const) test(`split and repeated trim preserve ${easing} animation and fade sample-by-sample`, () => {
  const clip: ComicCompositionClip = { ...base().clips[0], durationFrames: 120, fadeInFrames: 40, fadeOutFrames: 30,
    audioFadeInFrames: 20, audioFadeOutFrames: 45,
    keyframes: [{ property: 'x', frame: 0, value: -100, easing }, { property: 'x', frame: 100, value: 200, easing: 'linear' },
      { property: 'opacity', frame: 0, value: .2, easing }, { property: 'opacity', frame: 120, value: 1, easing: 'linear' }] };
  const [left, right] = splitComicCompositionClip(clip, 37, 'right');
  assert.equal(right.from, 37); assert.equal(right.sourceStartFrames, 67);
  for (let frame = 0; frame < 120; frame++) {
    const expected = sampleClip(clip, frame), actual = frame < 37 ? sampleClip(left, frame) : sampleClip(right, frame - 37);
    for (const property of ['x', 'opacity', 'volume'] as const) assert.ok(Math.abs(expected[property] - actual[property]) < 1e-9, `${property} changed at frame ${frame}`);
  }
  const cropped = trimComicCompositionClip(trimComicCompositionClip(clip, 7, 115), 13, 88);
  for (let frame = 0; frame < cropped.durationFrames; frame++) {
    const expected = sampleClip(clip, frame + 20), actual = sampleClip(cropped, frame);
    for (const property of ['x', 'opacity', 'volume'] as const) assert.ok(Math.abs(expected[property] - actual[property]) < 1e-9);
  }
});

test('keyframe editing and track/clip operations are genuine reusable immutable commands', () => {
  const { p } = project(); let comp = base();
  comp = edit(comp, { type: 'track.add', track: { id: 'overlay', kind: 'video', title: 'Overlay' }, index: 1 }, p);
  comp = edit(comp, { type: 'clip.duplicate', clipId: 'video', id: 'copy', trackId: 'overlay', from: 10 }, p);
  comp = edit(comp, { type: 'keyframe.set', clipId: 'copy', keyframe: { property: 'x', frame: 0, value: 15, easing: 'hold' } }, p);
  assert.equal(sampleClip(comp.clips.at(-1)!, 10).x, 15);
  comp = edit(comp, { type: 'keyframe.remove', clipId: 'copy', property: 'x', frame: 0 }, p);
  assert.equal(sampleClip(comp.clips.at(-1)!, 10).x, 0);
  comp = edit(comp, { type: 'track.remove', trackId: 'overlay' }, p);
  assert.ok(!comp.clips.some(c => c.id === 'copy'));
});

test('legacy migration is deterministic and preserves dissolve overlap, replacement voice, music, subtitles and image motion', () => {
  let { p, idFactory } = project();
  p = applyComicEditorEdits(p, [{ type: 'insert_clips', assetIds: ['asset-00000100', 'asset-00000101'], imageSeconds: 3 }], { now, idFactory }).project;
  const sceneId = p.scenes[0].id, first = p.scenes[0].shots[0].id, second = p.scenes[0].shots[1].id;
  const command = (c: any): void => { p = applyComicCommand(p, { ...c, expectedRevision: p.revision }, { now, idFactory }); };
  command({ type: 'shot.update', sceneId, shotId: first, patch: { durationFrames: 120, transitionIn: 'cut', transitionOut: 'dissolve', volume: .6, fadeInFrames: 9, fadeOutFrames: 0 } });
  command({ type: 'shot.update', sceneId, shotId: second, patch: { transitionIn: 'dissolve', transitionOut: 'cut', cameraMotion: 'pan_left', fadeInFrames: 0, fadeOutFrames: 0 } });
  command({ type: 'media.link', sceneId, shotId: first, slot: 'audio', assetId: 'asset-00000103' });
  command({ type: 'media.link', sceneId, shotId: first, slot: 'music', assetId: 'asset-00000102' });
  command({ type: 'media.set_start', sceneId, shotId: first, assetId: 'asset-00000102', startFrame: 30 });
  command({ type: 'dialogue.replace', sceneId, shotId: first, cues: [{ text: 'Hello', startFrame: 12, durationFrames: 36 }] });
  const snapshot = JSON.stringify(p), a = resolveComicComposition(p), b = resolveComicComposition(p);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(p), snapshot); assert.equal(p.composition, undefined);
  const pictures = a.clips.filter(c => c.trackId === 'legacy-picture');
  assert.equal(pictures[0].nativeAudio, false);
  assert.equal(pictures[1].from, 109); assert.equal(comicCompositionDurationFrames(a), 199);
  assert.equal(sampleClip(pictures[1], 0).opacity, 0); assert.equal(sampleClip(pictures[1], 11).opacity, 1);
  assert.equal(sampleClip(pictures[0], 115).opacity, 1, 'outgoing picture must not be faded twice');
  assert.ok(Math.abs(sampleClip(pictures[1], 0).x + p.canvas.width * .06) < 1e-9);
  assert.ok(Math.abs(sampleClip(pictures[1], 89).x - p.canvas.width * .06) < 1e-9);
  assert.equal(a.clips.find(c => c.trackId === 'legacy-music')?.sourceStartFrames, 30);
  assert.equal(a.clips.find(c => c.kind === 'text')?.purpose, 'subtitle');
  assert.deepEqual(a.tracks.map(track => [track.id, track.title]), [
    ['legacy-picture', 'Video'], ['legacy-voice', 'Voice'], ['legacy-music', 'Music'], ['legacy-subtitle', 'Subtitles']
  ], 'only unused legacy effects are omitted; occupied tracks keep their stable identities and names');
  assert.doesNotThrow(() => validateComicComposition(a, p));
});

test('only first-read legacy migration omits empty tracks; saved user and ASR tracks remain unchanged', () => {
  let { p, idFactory } = project();
  const empty = resolveComicComposition(p);
  assert.deepEqual(empty.tracks, [{ id: 'legacy-picture', title: 'Video', kind: 'video' }]);
  assert.equal(empty.clips.length, 0, 'empty legacy project remains ready to insert its first clip');
  p = applyComicEditorEdits(p, [{ type: 'insert_clips', assetIds: ['asset-00000101'] }], { now, idFactory }).project;
  const migrated = resolveComicComposition(p);
  assert.deepEqual(migrated.tracks.map(track => track.id), ['legacy-picture'], 'a still does not create unused audio or subtitle rows');
  const saved: ComicComposition = { ...migrated, tracks: [...migrated.tracks,
    { id: 'user-empty-music', kind: 'audio', title: 'My music' },
    { id: 'asr-subtitles', kind: 'text', title: 'Recognized subtitles' }
  ], clips: [...migrated.clips, { id: 'asr-cue', trackId: 'asr-subtitles', kind: 'text', purpose: 'subtitle', text: 'Keep this caption',
    from: 0, durationFrames: 30, sourceStartFrames: 0 }] };
  const validated = validateComicComposition(saved, p);
  const restored = parseComicProject(serializeComicProject({ ...p, composition: validated })).project;
  assert.strictEqual(resolveComicComposition(restored), restored.composition, 'persisted compositions bypass migration');
  assert.deepEqual(resolveComicComposition(restored), saved, 'empty user tracks, ASR name and cue all survive codec and reopening');
});

test('missing legacy picture remains explicit while a user-created black gap is valid', () => {
  let { p, idFactory } = project();
  p = applyComicCommand(p, { type: 'scene.add', expectedRevision: p.revision }, { now, idFactory });
  p = applyComicCommand(p, { type: 'shot.add', expectedRevision: p.revision, sceneId: p.scenes[0].id }, { now, idFactory });
  const comp = resolveComicComposition(p);
  assert.equal(comp.clips[0].kind, 'empty'); assert.equal(comp.clips[0].missing, true);
  assert.doesNotThrow(() => validateComicComposition(comp, p));
  assert.doesNotThrow(() => validateComicComposition({ schemaVersion: 1, tracks: [], clips: [] }, p));
});

test('first edit persists composition and codec/revision/restore retain composition-only assets', () => {
  const { p } = project(), result = applyComicEditorEdits(p, [{ type: 'composition', operation: { type: 'replace', composition: base() } }], { now }).project;
  assert.equal(result.revision, p.revision + 1); assert.equal(p.composition, undefined);
  const loaded = parseComicProject(serializeComicProject(result)).project;
  assert.deepEqual(loaded.composition, result.composition);
  assert.equal(summarizeComicProject(loaded).durationFrames, 255);
  const doc = validateCanvasTimeline({ schemaVersion: 1, id: 'timeline-00000001', projectId: p.id, sourceCanvasId: 'canvas-00000001', sourceCanvasRevision: 0,
    revision: loaded.revision, title: 'Test', sources: [], createdAt: now, updatedAt: now, project: { ...loaded, id: 'project-00000001' } });
  assert.equal(doc.project.assets.length, 2, 'only video and music are referenced; text is inline');
  assert.deepEqual(doc.project.assets.map(a => a.id), ['asset-00000100', 'asset-00000102']);
  const restored = restoreCanvasTimeline(doc, doc.project, now);
  assert.deepEqual(restored.project.composition, doc.project.composition);
  assert.equal(restored.revision, doc.revision + 1);
  assert.throws(() => applyComicEditorEdits(loaded, [{ type: 'insert_clips', assetIds: ['asset-00000101'] }], { now }), { code: 'COMPOSITION_EDIT_REQUIRED' });
});

test('resetting a fade on a trimmed clip uses its current edge and preserves every other fade', () => {
  const { p } = project();
  const original: ComicCompositionClip = { ...base().clips[0], fadeInFrames: 40, fadeOutFrames: 20, audioFadeInFrames: 45, audioFadeOutFrames: 30 };
  const cropped = trimComicCompositionClip(original, 20, 90);
  const fadeIn = setComicCompositionFade(cropped, 'fadeInFrames', 10);
  assert.equal(sampleClip(fadeIn, 0).opacity, 0); assert.equal(sampleClip(fadeIn, 5).opacity, .5); assert.equal(sampleClip(fadeIn, 10).opacity, 1);
  for (let frame = 0; frame < cropped.durationFrames; frame++) assert.equal(sampleClip(fadeIn, frame).volume, sampleClip(cropped, frame).volume);
  const audioOut = setComicCompositionFade(fadeIn, 'audioFadeOutFrames', 10);
  assert.equal(sampleClip(audioOut, 65).volume, .5); assert.equal(sampleClip(audioOut, 70).volume, 0);
  assert.equal(sampleClip(audioOut, 5).opacity, .5);
  assert.doesNotThrow(() => validateComicComposition({ ...base(), clips: [audioOut] }, p));
  const [left, right] = splitComicCompositionClip(audioOut, 33, 'fade-right');
  for (let frame = 0; frame < audioOut.durationFrames; frame++) assert.deepEqual(sampleClip(frame < 33 ? left : right, frame < 33 ? frame : frame - 33), sampleClip(audioOut, frame));
});

test('permissions prepare matches playback without evaluating every other clip or its instantaneous opacity', () => {
  const { p } = project(); let comp = base();
  comp = edit(comp, { type: 'track.update', trackId: 'picture', patch: { hidden: true } }, p);
  assert.deepEqual(comicCompositionClipPermissions(comp, comp.clips[0]), { visible: false, audible: true });
  comp = edit(comp, { type: 'track.update', trackId: 'picture', patch: { muted: true } }, p);
  assert.deepEqual(comicCompositionClipPermissions(comp, comp.clips[0]), { visible: false, audible: false });
  for (const clip of comp.clips) {
    const permissions = comicCompositionClipPermissions(comp, clip), sample = sampleComicComposition(comp, clip.from).find(sample => sample.clip.id === clip.id)!;
    assert.deepEqual(permissions, { visible: sample.visible, audible: sample.audible });
  }
  assert.deepEqual(comicCompositionClipPermissions(comp, { ...comp.clips[0], trackId: 'unknown' }), { visible: false, audible: false });
});

test('shared text layout keeps explicit blank lines, wraps both CJK and English, and never splits an emoji grapheme', () => {
  assert.equal(comicCompositionTextLines('A\n\nB', 20, 500), 'A\n\nB');
  assert.equal(comicCompositionTextLines('测试文字换行', 20, 96), '测试文字\n换行');
  const english = comicCompositionTextLines('This is a simple caption with words', 20, 180);
  assert.ok(english.includes('\n')); assert.equal(english.replace(/\s+/g, ' '), 'This is a simple caption with words');
  const family = '👨‍👩‍👧‍👦', wrapped = comicCompositionTextLines(`${family}${family}${family}`, 20, 56);
  assert.deepEqual(wrapped.split('\n'), [family, family, family]);
  assert.equal(comicCompositionTextLines('测试文字换行', 20, 96), '测试文字\n换行', 'cached layout is identical');
});

test('legacy simultaneous fades and dissolve preserve the original opaque RGB crossfade, including black bars', () => {
  const incoming: ComicCompositionClip = { ...base().clips[0], id: 'incoming', legacyFadeToBlack: true,
    envelope: { durationFrames: 120, offsetFrames: 0, fadeInFrames: 20, fadeOutFrames: 0, dissolveInFrames: 10 } };
  const outgoing: ComicCompositionClip = { ...base().clips[0], legacyFadeToBlack: true,
    envelope: { durationFrames: 120, offsetFrames: 0, fadeInFrames: 0, fadeOutFrames: 30, dissolveOutFrames: 10 } };
  const red = [1, 0, 0], blue = [0, 0, 1];
  for (let frame = 0; frame <= 10; frame++) {
    const a = sampleClip(outgoing, 110 + frame), b = sampleClip(incoming, frame), weight = frame / 10;
    assert.equal(a.opacity, 1, 'outgoing remains opaque before crossfade');
    assert.equal(b.opacity, weight);
    for (let channel = 0; channel < 3; channel++) {
      const actual = blue[channel] * b.brightness * b.opacity + red[channel] * a.brightness * (1 - b.opacity);
      const expected = weight * blue[channel] * frame / 20 + (1 - weight) * red[channel] * (10 - frame) / 30;
      assert.ok(Math.abs(actual - expected) < 1e-12, `RGB channel ${channel} at frame ${frame}`);
    }
    const incomingBlackBar = 0 * b.brightness * b.opacity + a.brightness * (1 - b.opacity);
    assert.equal(incomingBlackBar, a.brightness * (1 - weight), 'black bars fade the outgoing image instead of becoming a transparent hole');
  }
  const modern = sampleClip({ ...incoming, legacyFadeToBlack: undefined }, 5);
  assert.equal(modern.brightness, 1); assert.equal(modern.opacity, .125, 'new layers still fade transparently');
  const [left, right] = splitComicCompositionClip(incoming, 7, 'incoming-right');
  for (let frame = 0; frame < 120; frame++) assert.deepEqual(sampleClip(frame < 7 ? left : right, frame < 7 ? frame : frame - 7), sampleClip(incoming, frame));
});

test('legacy embedded video subtitles are an explicit source-range clip and deleting them remains deleted', () => {
  let { p, idFactory } = project();
  p = applyComicEditorEdits(p, [{ type: 'insert_clips', assetIds: ['asset-00000100'] }], { now, idFactory }).project;
  const scene = p.scenes[0], shot = scene.shots[0];
  p = applyComicCommand(p, { type: 'shot.trim_start', expectedRevision: p.revision, sceneId: scene.id, shotId: shot.id, frames: 35 }, { now, idFactory });
  const migrated = resolveComicComposition(p), caption = migrated.clips.find(clip => clip.kind === 'text')!;
  assert.equal(caption.assetId, 'asset-00000100'); assert.equal(caption.purpose, 'subtitle');
  assert.equal(caption.sourceStartFrames, 35); assert.equal(caption.durationFrames, 265);
  assert.equal(caption.captionSourceClipId, migrated.clips.find(clip => clip.kind === 'video')?.id);
  assert.doesNotThrow(() => validateComicComposition(migrated, p));
  const removed = edit(migrated, { type: 'clip.remove', clipId: caption.id }, p);
  assert.ok(!resolveComicComposition({ ...p, composition: removed }).clips.some(clip => clip.kind === 'text'));
  assert.throws(() => edit(migrated, { type: 'clip.update', clipId: caption.id, patch: { durationFrames: 266 } }, p), /source media/);
  const withDialogue = applyComicCommand(p, { type: 'dialogue.replace', expectedRevision: p.revision, sceneId: scene.id, shotId: shot.id,
    cues: [{ text: 'Authored caption', startFrame: 0, durationFrames: 30 }] }, { now, idFactory });
  assert.equal(resolveComicComposition(withDialogue).clips.filter(clip => clip.kind === 'text').length, 1, 'authored dialogue suppresses duplicate embedded captions');
  assert.equal(resolveComicComposition(withDialogue).clips.find(clip => clip.kind === 'text')?.text, 'Authored caption');
});
