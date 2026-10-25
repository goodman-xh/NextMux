import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComicCommand, applyComicEditorEdits, createComicProject, getComicAssetDurationFrames,
  getComicMediaDurationFrames, getComicTimedAssetIds, parseComicProject, serializeComicProject, validateComicProject,
  productionDocumentFromComicProject,
} from "../lib/index.js";
import type { ComicCommand, ComicProject } from "../lib/index.js";

const now = "2026-09-30T00:00:00.000Z";
test("exact frame durations survive millisecond round trips without admitting a genuinely incomplete frame", () => {
  for (const frameRate of [24, 25, 30]) for (const frames of [1, 31, 62, 65, 124, 127, 1000, 18000]) {
    const asset = { kind: "video", durationMs: frames * 1000 / frameRate } as ComicProject["assets"][number];
    assert.equal(getComicAssetDurationFrames(asset, frameRate), frames, `${frameRate} fps, ${frames} frames`);
    assert.equal(getComicAssetDurationFrames({ ...asset, durationMs: asset.durationMs! - 0.001 }, frameRate), Math.max(1, frames - 1));
  }
});
function setup() {
  let counter = 0;
  const idFactory = (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue") => `${prefix}-${String(++counter).padStart(8, "0")}`;
  const options = { now, idFactory };
  let project = createComicProject(options);
  const asset = (id: string, kind: "image" | "video" | "audio" | "music" | "subtitle", durationMs?: number) => ({
    id, kind, uri: `nextmux.media/${id}`, mimeType: "application/octet-stream", byteLength: 10,
    sha256: "a".repeat(64), jobId: "media-job-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", provider: "test", model: "test", source: "imported" as const,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
  const assets = [asset("asset-10000001", "video", 2_501), asset("asset-10000002", "audio", 1_001),
    asset("asset-10000003", "music", 10_001), asset("asset-10000004", "image"), asset("asset-10000005", "video"),
    asset("asset-10000006", "subtitle", 2_001)];
  for (const draft of assets) project = applyComicCommand(project, { type: "asset.import", expectedRevision: project.revision, asset: draft }, options);
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  type Edit = ComicCommand extends infer T ? T extends ComicCommand ? Omit<T, "expectedRevision"> : never : never;
  const apply = (current: ComicProject, command: Edit) => applyComicCommand(current, { ...command, expectedRevision: current.revision } as ComicCommand, options);
  return { project, sceneId, shotId, options, apply, asset };
}

test("split video halves preserve source in/out; both reject a tail beyond the source", () => {
  const { project, sceneId, shotId, apply } = setup();
  const linked = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000001" });
  assert.equal(linked.scenes[0].shots[0].durationFrames, 60, "linking a shorter video fits the shot to full source frames");
  const head = apply(linked, { type: "shot.trim_start", sceneId, shotId, frames: 10 });
  const cut = apply(head, { type: "shot.split", sceneId, shotId, splitAtFrame: 20 });
  const [left, right] = cut.scenes[0].shots;
  assert.deepEqual([left.durationFrames, left.mediaSourceStartFrames?.["asset-10000001"], right.durationFrames, right.mediaSourceStartFrames?.["asset-10000001"]], [20, 10, 30, 30]);
  assert.throws(() => apply(cut, { type: "shot.update", sceneId, shotId: right.id, patch: { durationFrames: 31 } }), /source duration/);
  assert.throws(() => apply(cut, { type: "media.set_start", sceneId, shotId: right.id, assetId: "asset-10000001", startFrame: 31 }), /source duration/);
  assert.equal(apply(cut, { type: "shot.update", sceneId, shotId: left.id, patch: { durationFrames: 50 } }).scenes[0].shots[0].durationFrames, 50, "each half can restore frames within its own source handle");
  for (const boundary of [0, left.durationFrames, left.durationFrames + 1]) assert.throws(() => apply(cut, { type: "shot.split", sceneId, shotId, splitAtFrame: boundary }));
  assert.deepEqual(parseComicProject(serializeComicProject(cut)).project, cut);
});

test("audio has its own bounded out-point without shortening its picture", () => {
  const { project, sceneId, shotId, apply } = setup();
  const linked = apply(project, { type: "media.link", sceneId, shotId, slot: "audio", assetId: "asset-10000002" });
  const shot = linked.scenes[0].shots[0];
  assert.equal(shot.durationFrames, 96);
  assert.equal(getComicMediaDurationFrames(linked, shot, "asset-10000002"), 24, "fractional source frame is never stretched");
  assert.throws(() => apply(linked, { type: "media.set_duration", sceneId, shotId, assetId: "asset-10000002", durationFrames: 25 }), /source duration/);
  assert.throws(() => apply(linked, { type: "media.set_start", sceneId, shotId, assetId: "asset-10000002", startFrame: 24 }), /source duration/);
  const trimmed = apply(linked, { type: "media.set_duration", sceneId, shotId, assetId: "asset-10000002", durationFrames: 12 });
  const split = apply(trimmed, { type: "shot.split", sceneId, shotId, splitAtFrame: 8 });
  const [left, right] = split.scenes[0].shots;
  assert.deepEqual([getComicMediaDurationFrames(split, left, "asset-10000002"), getComicMediaDurationFrames(split, right, "asset-10000002"), right.mediaSourceStartFrames?.["asset-10000002"]], [8, 4, 8]);
  const late = apply(linked, { type: "shot.split", sceneId, shotId, splitAtFrame: 30 });
  assert.equal(late.scenes[0].shots[1].audioAssetId, undefined, "the right half must not replay an exhausted sound");
  assert.equal(late.scenes[0].shots[1].mediaSourceStartFrames, undefined);
  const head = apply(linked, { type: "shot.trim_start", sceneId, shotId, frames: 30 });
  assert.equal(head.scenes[0].shots[0].audioAssetId, undefined);
  const early = apply(trimmed, { type: "shot.trim_start", sceneId, shotId, frames: 4 });
  assert.equal(early.scenes[0].shots[0].mediaDurationFrames?.["asset-10000002"], 8);
  const restored = apply(early, { type: "shot.trim_start", sceneId, shotId, frames: -4 });
  assert.equal(restored.scenes[0].shots[0].mediaDurationFrames?.["asset-10000002"], 12, "head extension preserves the sound out-point");
  assert.deepEqual(parseComicProject(serializeComicProject(split)).project, split);
});

test("still images are source-unbounded; unknown source lengths retain explicit project safety bounds", () => {
  const { project, sceneId, shotId, apply, options } = setup();
  const still = apply(project, { type: "media.link", sceneId, shotId, slot: "visual", assetId: "asset-10000004" });
  assert.equal(apply(still, { type: "shot.update", sceneId, shotId, patch: { durationFrames: 24 * 600 } }).scenes[0].shots[0].durationFrames, 24 * 600);
  assert.equal(getComicAssetDurationFrames(still.assets.find(asset => asset.kind === "image"), 24), undefined);
  const inserted = applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-10000004"], imageSeconds: 120 }], options).project;
  assert.equal(inserted.scenes[0].shots.at(-1)?.durationFrames, 24 * 120, "still imports can exceed the old arbitrary 60-second cap");
  const unknown = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000005" });
  assert.equal(getComicAssetDurationFrames(unknown.assets.find(asset => asset.id === "asset-10000005"), 24), undefined);
  assert.doesNotThrow(() => apply(unknown, { type: "shot.update", sceneId, shotId, patch: { durationFrames: 120 } }));
  for (const durationFrames of [-1, 0, 1.5, NaN, Infinity, 18_001]) assert.throws(() => apply(still, { type: "shot.update", sceneId, shotId, patch: { durationFrames } }));
  for (const imageSeconds of [-1, 0, NaN, Infinity]) assert.throws(() => applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-10000004"], imageSeconds }], options));
  for (const startFrame of [-1, 1.5, NaN, Infinity, 240]) assert.throws(() => applyComicEditorEdits(project, [{ type: "place_audio", assetId: "asset-10000003", role: "music", shots: [{ sceneId, shotId }], startFrame }], options));
});

test("tail trimming drops later cues instead of piling them onto the final frame; moves/deletes ripple", () => {
  const { project, sceneId, shotId, apply } = setup();
  let current = apply(project, { type: "dialogue.replace", sceneId, shotId, cues: [{ text: "crosses", startFrame: 10, durationFrames: 40 }, { text: "later", startFrame: 80, durationFrames: 10 }] });
  current = apply(current, { type: "shot.update", sceneId, shotId, patch: { durationFrames: 30, fadeInFrames: 10, fadeOutFrames: 20 } });
  assert.deepEqual(current.scenes[0].shots[0].dialogueCues.map(cue => [cue.text, cue.startFrame, cue.durationFrames]), [["crosses", 10, 20]]);
  current = apply(current, { type: "shot.duplicate", sceneId, shotId });
  const duplicateId = current.scenes[0].shots[1].id;
  current = apply(current, { type: "shot.move", sceneId, shotId: duplicateId, targetSceneId: sceneId, afterShotId: null });
  assert.equal(current.scenes[0].shots[0].dialogueCues[0].startFrame, 10);
  assert.throws(() => apply(current, { type: "shot.move", sceneId, shotId, targetSceneId: sceneId, afterShotId: shotId }), /after itself/);
  const removed = apply(current, { type: "shot.delete", sceneId, shotId: duplicateId });
  assert.deepEqual(removed.scenes[0].shots.map(shot => [shot.id, shot.durationFrames]), [[shotId, 30]], "ordered shots close the deleted range on every linked track");
  assert.throws(() => apply(current, { type: "dialogue.replace", sceneId, shotId, cues: [{ id: current.scenes[0].shots[0].dialogueCues[0].id, text: "duplicate id" }] }), /duplicate/);
});

test("frame-rate changes rescale fades and source in/out within measured video and audio", () => {
  const { project, sceneId, shotId, apply } = setup();
  let current = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000001" });
  current = apply(current, { type: "shot.trim_start", sceneId, shotId, frames: 12 });
  current = apply(current, { type: "media.link", sceneId, shotId, slot: "audio", assetId: "asset-10000002" });
  current = apply(current, { type: "media.set_duration", sceneId, shotId, assetId: "asset-10000002", durationFrames: 12 });
  current = apply(current, { type: "shot.update", sceneId, shotId, patch: { fadeInFrames: 12, fadeOutFrames: 24 } });
  const rescaled = apply(current, { type: "project.update", patch: { frameRate: 30 } });
  const shot = rescaled.scenes[0].shots[0];
  assert.deepEqual([shot.durationFrames, shot.fadeInFrames, shot.fadeOutFrames, shot.mediaSourceStartFrames?.["asset-10000001"], shot.mediaDurationFrames?.["asset-10000002"]], [60, 15, 30, 15, 15]);
  assert.doesNotThrow(() => validateComicProject(rescaled));
});

test("replacing/applying video resets stale ranges; pending video stays with the original after split", () => {
  const { project, sceneId, shotId, apply, asset } = setup();
  let current = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000001" });
  current = apply(current, { type: "shot.trim_start", sceneId, shotId, frames: 12 });
  current = apply(current, { type: "media.attach", sceneId, shotId, slot: "video", asset: asset("asset-10000007", "video", 1_000), deferToPending: true });
  const split = apply(current, { type: "shot.split", sceneId, shotId, splitAtFrame: 10 });
  assert.equal(split.scenes[0].shots[0].pendingVideoAssetId, "asset-10000007");
  assert.equal(split.scenes[0].shots[1].pendingVideoAssetId, undefined);
  const accepted = apply(current, { type: "shot.apply_pending_video", sceneId, shotId });
  const shot = accepted.scenes[0].shots[0];
  assert.deepEqual([shot.durationFrames, shot.videoAssetId, shot.mediaSourceStartFrames], [24, "asset-10000007", undefined]);
  const relinked = apply(current, { type: "media.attach", sceneId, shotId, slot: "video", asset: asset("asset-10000007", "video", 1_000) });
  assert.equal(relinked.scenes[0].shots[0].mediaSourceStartFrames, undefined, "attach must delete the old map even when there are no remaining starts");
  assert.doesNotThrow(() => serializeComicProject(relinked));
});

test("project validation repairs source overflow from older files and rejects unlinked per-media ranges", () => {
  const { project, sceneId, shotId, apply } = setup();
  const linked = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000001" });
  const corrupt = (patch: object) => ({ ...linked, scenes: [{ ...linked.scenes[0], shots: [{ ...linked.scenes[0].shots[0], ...patch }] }] });
  const opened = (patch: object) => validateComicProject(corrupt(patch)).scenes[0]!.shots[0]!;
  assert.equal(opened({ durationFrames: 61 }).durationFrames, 60, "a stretched video is fitted back to its source");
  assert.deepEqual([opened({ mediaSourceStartFrames: { "asset-10000001": 1 } }).durationFrames, opened({ mediaSourceStartFrames: { "asset-10000001": 1 } }).mediaSourceStartFrames], [59, { "asset-10000001": 1 }]);
  assert.equal(opened({ mediaDurationFrames: { "asset-10000001": 30 } }).mediaDurationFrames, undefined, "the picture length is the shot length");
  assert.throws(() => validateComicProject(corrupt({ mediaDurationFrames: { "asset-10000002": 1 } })), /unlinked/);
  // Edits are still refused rather than repaired.
  assert.throws(() => apply(linked, { type: "shot.update", sceneId, shotId, patch: { durationFrames: 61 } }), /source/);
});

test("a split keeps transitions only at the original outer boundaries and never consumes extra source time", () => {
  const { project, sceneId, shotId, apply } = setup();
  let current = apply(project, { type: "shot.update", sceneId, shotId, patch: { transition: "dissolve", transitionOut: "fade" } });
  const before = productionDocumentFromComicProject(current).timelines[0]!;
  current = apply(current, { type: "shot.split", sceneId, shotId, splitAtFrame: 30 });
  const [left, right] = current.scenes[0].shots;
  assert.deepEqual([left.transitionIn, left.transitionOut, left.transitionOutExplicit, right.transitionIn, right.transitionOut, right.transitionOutExplicit], ["dissolve", "cut", true, "cut", "fade", true]);
  const after = productionDocumentFromComicProject(current).timelines[0]!;
  const endFrame = (timeline: typeof after) => Math.max(...timeline.clips.map(clip => clip.startFrame + clip.durationFrames), 0);
  assert.equal(endFrame(after), endFrame(before));
  assert.equal(after.clips[1]?.startFrame, 30);
  const authoredCut = apply(project, { type: "shot.update", sceneId, shotId, patch: { transitionOut: "cut" } });
  assert.equal(productionDocumentFromComicProject(parseComicProject(serializeComicProject(authoredCut)).project).timelines[0]?.clips[0]?.transitionOut, "cut");
});

test("continuous music, audio and subtitles follow dissolve frame positions and bounded source ranges", () => {
  const { project, sceneId, shotId, apply, options } = setup();
  let current = apply(project, { type: "shot.update", sceneId, shotId, patch: { durationFrames: 48 } });
  current = apply(current, { type: "shot.add", sceneId, shot: { durationFrames: 48, transition: "dissolve" } });
  current = apply(current, { type: "shot.add", sceneId, shot: { durationFrames: 48, transition: "dissolve" } });
  const refs = current.scenes[0].shots.map(shot => ({ sceneId, shotId: shot.id }));
  current = applyComicEditorEdits(current, [{ type: "place_audio", assetId: "asset-10000003", role: "music", shots: refs }], options).project;
  assert.deepEqual(current.scenes[0].shots.map(shot => shot.mediaSourceStartFrames?.["asset-10000003"] ?? 0), [0, 40, 80]);
  const thirdId = refs[2]!.shotId;
  current = apply(current, { type: "media.link", sceneId, shotId: thirdId, slot: "audio", assetId: "asset-10000002" });
  current = apply(current, { type: "media.set_duration", sceneId, shotId: thirdId, assetId: "asset-10000002", durationFrames: 12 });
  current = apply(current, { type: "media.link", sceneId, shotId: thirdId, slot: "subtitle", assetId: "asset-10000006" });
  const production = productionDocumentFromComicProject(current);
  assert.deepEqual(production.audioTracks.filter(track => track.kind === "music").map(track => track.startFrame), [0, 40, 80]);
  assert.equal(production.audioTracks.find(track => track.kind === "dialogue")?.durationFrames, 12);
  const subtitle = production.timelines[0]?.clips.find(clip => clip.kind === "subtitle");
  assert.deepEqual([subtitle?.startFrame, subtitle?.durationFrames, subtitle?.sourceDurationFrames], [80, 48, 48]);
  for (const references of [[refs[1]!, refs[0]!], [refs[0]!, refs[0]!]]) assert.throws(() => applyComicEditorEdits(current, [{ type: "place_audio", assetId: "asset-10000003", role: "music", shots: references }], options), /timeline order/);
  const skipped = applyComicEditorEdits(current, [{ type: "place_audio", assetId: "asset-10000003", role: "music", shots: [refs[0]!, refs[2]!] }], options).project;
  assert.equal(skipped.scenes[0].shots[2]?.mediaSourceStartFrames?.["asset-10000003"], 80, "selecting nonadjacent shots keeps source time through the intervening picture");
});

test("deterministic random edit sequences always remain serializable, frame-valid and source-bounded", () => {
  const { project, sceneId, shotId, apply } = setup();
  let current = apply(project, { type: "media.link", sceneId, shotId, slot: "video", assetId: "asset-10000001" });
  let seed = 0x33e;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let step = 0; step < 350; step++) {
    if (current.scenes[0].shots.length === 0) current = apply(current, { type: "shot.add", sceneId, shot: { durationFrames: 60 } });
    const shots = current.scenes[0].shots, shot = shots[Math.floor(random() * shots.length)];
    const before = serializeComicProject(current);
    try {
      switch (Math.floor(random() * 9)) {
        case 0: current = apply(current, { type: "shot.update", sceneId, shotId: shot.id, patch: { durationFrames: Math.floor(random() * 100) } }); break;
        case 1: current = apply(current, { type: "shot.trim_start", sceneId, shotId: shot.id, frames: Math.floor(random() * 50) - 10 }); break;
        case 2: current = apply(current, { type: "shot.split", sceneId, shotId: shot.id, splitAtFrame: Math.floor(random() * (shot.durationFrames + 1)) }); break;
        case 3: current = apply(current, { type: "shot.duplicate", sceneId, shotId: shot.id }); break;
        case 4: current = apply(current, { type: "shot.delete", sceneId, shotId: shot.id }); break;
        case 5: current = apply(current, { type: "shot.move", sceneId, shotId: shot.id, targetSceneId: sceneId, afterShotId: shots[Math.floor(random() * shots.length)].id }); break;
        case 6: current = apply(current, { type: "media.link", sceneId, shotId: shot.id, slot: "audio", assetId: "asset-10000002" }); break;
        case 7: current = apply(current, { type: "media.set_duration", sceneId, shotId: shot.id, assetId: "asset-10000002", durationFrames: Math.floor(random() * 50) }); break;
        case 8: current = apply(current, { type: "project.update", patch: { frameRate: [24, 25, 30][Math.floor(random() * 3)] as 24 | 25 | 30 } }); break;
      }
    } catch {
      assert.equal(serializeComicProject(current), before, `failed edit ${step} must leave its input untouched`);
    }
    assert.doesNotThrow(() => validateComicProject(current), `edit ${step}`);
    for (const clip of current.scenes[0].shots) {
      assert.ok(clip.durationFrames > 0 && Number.isInteger(clip.durationFrames));
      assert.ok(clip.fadeInFrames + clip.fadeOutFrames <= clip.durationFrames);
      for (const id of getComicTimedAssetIds(clip)) {
        const length = getComicMediaDurationFrames(current, clip, id), source = getComicAssetDurationFrames(current.assets.find(asset => asset.id === id), current.frameRate);
        assert.ok(length > 0 && length <= clip.durationFrames);
        if (source !== undefined) assert.ok((clip.mediaSourceStartFrames?.[id] ?? 0) + length <= source);
      }
    }
    assert.deepEqual(parseComicProject(serializeComicProject(current)).project, validateComicProject(current));
  }
});
