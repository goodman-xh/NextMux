import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComicCommand, applyComicEditorEdits, createComicProject, getComicAssetDurationFrames,
  getComicMediaDurationFrames, parseComicProject, serializeComicProject, validateComicProject,
} from "../lib/index.js";
import type { ComicCommand, ComicGeneratedAssetDraft, ComicProject } from "../lib/index.js";

const now = "2026-09-30T00:00:00.000Z";
function fixture() {
  let counter = 0;
  const options = { now, idFactory: (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue") => `${prefix}-${String(++counter).padStart(8, "0")}` };
  const project = createComicProject(options), sceneId = project.scenes[0]!.id, shotId = project.scenes[0]!.shots[0]!.id;
  type Edit = ComicCommand extends infer T ? T extends ComicCommand ? Omit<T, "expectedRevision"> : never : never;
  const apply = (current: ComicProject, command: Edit) => applyComicCommand(current, { ...command, expectedRevision: current.revision } as ComicCommand, options);
  const asset = (kind: "video" | "music", streamStartMs?: number): ComicGeneratedAssetDraft => ({
    id: `asset-${kind === "video" ? "10000001" : "10000002"}`, kind, uri: `nextmux.media/${kind}.mp4`,
    mimeType: kind === "video" ? "video/mp4" : "audio/mp4", byteLength: 1_000, sha256: "a".repeat(64),
    jobId: "media-job-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", provider: "test", model: "test", durationMs: 2_000,
    ...(streamStartMs === undefined ? {} : { streamStartMs }),
  });
  return { project, sceneId, shotId, apply, asset, options };
}

test("generated video stream origins persist without consuming source handles on split or frame-rate edits", () => {
  const { project, sceneId, shotId, apply, asset } = fixture();
  const delayed = asset("video", 500);
  let current = apply(project, { type: "media.attach", sceneId, shotId, slot: "video", asset: delayed });
  assert.equal(current.scenes[0]!.shots[0]!.durationFrames, 48, "2 seconds of pictures remain 48 frames even when their container start is delayed");
  current = apply(current, { type: "shot.split", sceneId, shotId, splitAtFrame: 24 });
  const [left, right] = current.scenes[0]!.shots;
  assert.deepEqual([left!.durationFrames, right!.durationFrames, right!.mediaSourceStartFrames?.[delayed.id]], [24, 24, 24]);
  assert.equal(getComicAssetDurationFrames(current.assets[0], 24), 48);
  assert.equal(getComicMediaDurationFrames(current, right!, delayed.id), 24);
  assert.equal(current.assets[0]?.streamStartMs, 500);
  assert.deepEqual(parseComicProject(serializeComicProject(current)).project, current);
  current = apply(current, { type: "project.update", patch: { frameRate: 30 } });
  assert.equal(current.assets[0]?.streamStartMs, 500, "container milliseconds do not scale with project frames");
  assert.equal(current.scenes[0]!.shots[1]!.mediaSourceStartFrames?.[delayed.id], 30);
  const { streamStartMs: _origin, ...replayedOutput } = delayed;
  const reattached = apply(current, { type: "media.attach", sceneId, shotId, slot: "video", asset: replayedOutput });
  assert.equal(reattached.assets[0]?.streamStartMs, 500, "idempotent checkpoints retain existing measured metadata even when the replay omits it");
});

test("imported audio stream origin survives codec, duplication and reuse as another audio role", () => {
  const { project, sceneId, shotId, apply, asset, options } = fixture();
  const delayed = { ...asset("music", 750), source: "imported" as const };
  const imported = apply(project, { type: "asset.import", asset: delayed });
  const voiced = applyComicEditorEdits(imported, [{ type: "place_audio", assetId: delayed.id, role: "audio", shots: [{ sceneId, shotId }] }], options).project;
  const voice = voiced.assets.find(candidate => candidate.kind === "audio")!;
  assert.equal(voice.streamStartMs, 750);
  assert.equal(voice.durationMs, 2_000);
  const duplicated = apply(voiced, { type: "shot.duplicate", sceneId, shotId });
  assert.deepEqual(parseComicProject(serializeComicProject(duplicated)).project, duplicated);
  assert.equal(getComicMediaDurationFrames(duplicated, duplicated.scenes[0]!.shots[1]!, voice.id), 48);
  const legacy = apply(project, { type: "asset.import", asset: asset("video") });
  assert.equal("streamStartMs" in parseComicProject(serializeComicProject(legacy)).project.assets[0]!, false, "older zero-origin assets need no schema migration or invented metadata");
  const zero = apply(project, { type: "asset.import", asset: asset("video", 0) });
  assert.equal(parseComicProject(serializeComicProject(zero)).project.assets[0]?.streamStartMs, 0);
});

test("stream origin metadata rejects negative, fractional and non-finite times at command and JSON boundaries", () => {
  const { project, sceneId, shotId, apply, asset } = fixture();
  const imported = apply(project, { type: "asset.import", asset: asset("video", 500) });
  for (const streamStartMs of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "500" as never]) {
    assert.throws(() => apply(project, { type: "asset.import", asset: asset("video", streamStartMs) }), /streamStartMs/);
    assert.throws(() => apply(project, { type: "media.attach", sceneId, shotId, slot: "video", asset: asset("video", streamStartMs) }), /streamStartMs/);
    assert.throws(() => validateComicProject({ ...imported, assets: [{ ...imported.assets[0], streamStartMs }] }), /streamStartMs/);
  }
});

test("a file saved before source bounds were enforced opens repaired instead of failing", () => {
  const { project, sceneId, shotId, apply, asset } = fixture();
  let current = apply(project, { type: "media.attach", sceneId, shotId, slot: "video", asset: asset("video") });
  current = apply(current, { type: "asset.import", asset: { ...asset("music"), source: "imported" as const } });
  current = apply(current, { type: "media.link", sceneId, shotId, slot: "music", assetId: "asset-10000002" });
  const saved = JSON.parse(serializeComicProject(current));
  const shot = saved.scenes[0].shots[0];
  // The old trim bug: a 2-second video stretched to 5 seconds, with a cue and fade in the frozen tail.
  shot.durationFrames = 120;
  shot.fadeOutFrames = 30;
  shot.dialogueCues = [{ id: "dialogue-00000099", text: "尾部台词", startFrame: 100, durationFrames: 10 }];
  // A music bed whose source ran out long ago.
  shot.mediaSourceStartFrames = { "asset-10000002": 60 };
  const opened = parseComicProject(JSON.stringify(saved)).project.scenes[0]!.shots[0]!;
  assert.equal(opened.durationFrames, 48, "the picture is fitted to its 2-second source");
  assert.ok(opened.fadeOutFrames <= 48);
  assert.deepEqual(opened.dialogueCues, [], "a cue that only existed in the frozen tail is dropped");
  assert.equal(opened.musicAssetIds, undefined, "a sound whose range has run out is unlinked");
  assert.equal(opened.videoAssetId, "asset-10000001");
  const reopened = parseComicProject(serializeComicProject({ ...current, scenes: [{ ...current.scenes[0]!, shots: [opened] }] })).project;
  assert.equal(reopened.scenes[0]!.shots[0]!.durationFrames, 48, "the repaired shot is stable");
});
