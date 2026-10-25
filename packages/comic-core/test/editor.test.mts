import assert from "node:assert/strict";
import test from "node:test";

import {
  applyComicCommand,
  applyComicEditorEdits,
  createComicProject,
  parseComicProject,
  serializeComicProject,
  validateComicProject,
} from "../lib/index.js";

function deterministicIds() {
  let sequence = 0;
  return (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue") =>
    `${prefix}-${String(++sequence).padStart(8, "0")}`;
}

const now = "2026-09-25T00:00:00.000Z";
const sha = (digit: string) => digit.repeat(64);
const job = (digit: string) => `media-job-${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;

/** A project with one empty scene and a library of imported media. */
function library() {
  const ids = deterministicIds();
  let project = createComicProject({ title: "剪辑", now, idFactory: ids, starter: "empty" });
  const imports = [
    { id: "asset-00000101", kind: "image" as const, uri: "nextmux.media/imports/a.png", mimeType: "image/png", model: "雨夜街头.png", width: 1920, height: 1080 },
    { id: "asset-00000102", kind: "video" as const, uri: "nextmux.media/imports/b.mp4", mimeType: "video/mp4", model: "追逐.mp4", durationMs: 2_500, width: 1280, height: 720 },
    { id: "asset-00000103", kind: "music" as const, uri: "nextmux.media/imports/c.mp3", mimeType: "audio/mpeg", model: "配乐.mp3", durationMs: 5_000 },
  ];
  imports.forEach((asset, index) => {
    project = applyComicCommand(project, {
      type: "asset.import", expectedRevision: project.revision,
      asset: { ...asset, byteLength: 1_000 + index, sha256: sha(String(index + 1)), jobId: job(String(index + 1)), provider: "本机导入", source: "imported" },
    }, { now, idFactory: ids });
  });
  return { project, ids };
}

test("a project remembers its kind; old projects are novels", () => {
  const image = createComicProject({ title: "图片", projectKind: "image", now, idFactory: deterministicIds() });
  assert.equal(image.projectKind, "image");
  assert.equal(parseComicProject(serializeComicProject(image)).project.projectKind, "image");
  const novel = createComicProject({ title: "小说", projectKind: "novel", now, idFactory: deterministicIds() });
  assert.equal("projectKind" in novel, false, "novel is the default and is not written");
  assert.throws(() => createComicProject({ projectKind: "podcast" as never, now, idFactory: deterministicIds() }), /Project kind/);
});

test("imported images and videos become shots in order, sized from their measured length", () => {
  const { project, ids } = library();
  assert.equal(project.scenes.length, 0);
  const result = applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-00000101", "asset-00000102"], episodeNumber: 1 }], { now, idFactory: ids });
  const scene = result.project.scenes[0];
  assert.equal(scene.title, "场景 1", "an empty episode gets a scene with a localizable default title");
  assert.deepEqual(scene.titleDefault, { kind: "scene", locale: "zh-CN", index: 1 });
  assert.equal(result.project.title, "剪辑", "the user-authored project title stays unchanged");
  assert.deepEqual(scene.shots.map(shot => [shot.title, shot.durationFrames, shot.visualAssetId, shot.videoAssetId]),
    [["雨夜街头", 72, "asset-00000101", undefined], ["追逐", 60, undefined, "asset-00000102"]]);
  assert.deepEqual(result.createdShotIds, scene.shots.map(shot => shot.id));
  assert.equal(result.project.revision, project.revision + 5, "scene + two shots + two links, written once by the caller");

  // A prompt per picture becomes the shot's picture prompt (image-to-video projects).
  const prompted = applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-00000101"], prompts: ["她回头微笑，发丝被风吹起"] }], { now, idFactory: ids });
  assert.equal(prompted.project.scenes[0].shots[0].visualPrompt, "她回头微笑，发丝被风吹起");

  // Inserting after the first clip lands between the two.
  const again = applyComicEditorEdits(result.project, [{ type: "insert_clips", assetIds: ["asset-00000101"], sceneId: scene.id, afterShotId: scene.shots[0].id, imageSeconds: 2 }], { now, idFactory: ids });
  assert.deepEqual(again.project.scenes[0].shots.map(shot => shot.durationFrames), [72, 48, 60]);
  assert.throws(() => applyComicEditorEdits(result.project, [{ type: "insert_clips", assetIds: ["asset-00000103"] }], { now, idFactory: ids }), /Only images and videos/);
});

test("music plays on across the following shots and stops when the file ends; a voice line takes one shot", () => {
  const { project, ids } = library();
  const clips = applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-00000101", "asset-00000101", "asset-00000101"] }], { now, idFactory: ids });
  const scene = clips.project.scenes[0];
  const shots = scene.shots.map(shot => ({ sceneId: scene.id, shotId: shot.id }));
  const music = applyComicEditorEdits(clips.project, [{ type: "place_audio", assetId: "asset-00000103", role: "music", shots }], { now, idFactory: ids }).project;
  const placed = music.scenes[0].shots;
  // 5 s of music over three 3 s shots: the first two, the second starting 3 s (72 frames) in.
  assert.deepEqual(placed.map(shot => shot.musicAssetIds || []), [["asset-00000103"], ["asset-00000103"], []]);
  assert.deepEqual(placed.map(shot => shot.mediaSourceStartFrames?.["asset-00000103"] || 0), [0, 72, 0]);

  // The same file as a voice line: a library entry of the voice kind, linked to one shot only.
  const voiced = applyComicEditorEdits(music, [{ type: "place_audio", assetId: "asset-00000103", role: "audio", shots }], { now, idFactory: ids }).project;
  const voice = voiced.assets.find(asset => asset.kind === "audio")!;
  assert.equal(voice.uri, "nextmux.media/imports/c.mp3");
  assert.equal(voice.durationMs, 5_000);
  assert.deepEqual(voiced.scenes[0].shots.map(shot => shot.audioAssetId), [voice.id, undefined, undefined]);
  // Reusing it again does not add another library entry.
  const twice = applyComicEditorEdits(voiced, [{ type: "place_audio", assetId: "asset-00000103", role: "audio", shots: shots.slice(1) }], { now, idFactory: ids }).project;
  assert.equal(twice.assets.filter(asset => asset.kind === "audio").length, 1);
});

test("trim, duplicate, detach and start points keep media in sync and survive a save", () => {
  const { project, ids } = library();
  let current = applyComicEditorEdits(project, [{ type: "insert_clips", assetIds: ["asset-00000102"] }], { now, idFactory: ids }).project;
  const scene = current.scenes[0];
  const shot = scene.shots[0];
  current = applyComicCommand(current, { type: "dialogue.replace", expectedRevision: current.revision, sceneId: scene.id, shotId: shot.id,
    cues: [{ text: "别跑！", startFrame: 6, durationFrames: 24 }, { text: "……", startFrame: 40, durationFrames: 10 }] }, { now, idFactory: ids });
  current = applyComicCommand(current, { type: "shot.update", expectedRevision: current.revision, sceneId: scene.id, shotId: shot.id, patch: { mediaFit: "cover" } }, { now, idFactory: ids });

  // Cut 12 frames off the head: the clip now starts 12 frames into the file, dialogue moves up.
  const trimmed = applyComicCommand(current, { type: "shot.trim_start", expectedRevision: current.revision, sceneId: scene.id, shotId: shot.id, frames: 12 }, { now, idFactory: ids });
  const cut = trimmed.scenes[0].shots[0];
  assert.equal(cut.durationFrames, 48);
  assert.equal(cut.mediaSourceStartFrames?.["asset-00000102"], 12);
  assert.deepEqual(cut.dialogueCues.map(cue => [cue.text, cue.startFrame, cue.durationFrames]), [["别跑！", 0, 18], ["……", 28, 10]]);
  // Restoring cannot go before the start of the file.
  const restored = applyComicCommand(trimmed, { type: "shot.trim_start", expectedRevision: trimmed.revision, sceneId: scene.id, shotId: shot.id, frames: -30 }, { now, idFactory: ids });
  assert.equal(restored.scenes[0].shots[0].durationFrames, 60);
  assert.equal(restored.scenes[0].shots[0].mediaSourceStartFrames, undefined);
  assert.throws(() => applyComicCommand(trimmed, { type: "shot.trim_start", expectedRevision: trimmed.revision, sceneId: scene.id, shotId: shot.id, frames: 48 }, { now, idFactory: ids }), /at least one frame|between one frame/);

  const duplicated = applyComicCommand(trimmed, { type: "shot.duplicate", expectedRevision: trimmed.revision, sceneId: scene.id, shotId: shot.id }, { now, idFactory: ids });
  const [original, copy] = duplicated.scenes[0].shots;
  assert.equal(copy.title, "追逐（副本）");
  assert.equal(copy.videoAssetId, original.videoAssetId);
  assert.equal(copy.mediaFit, "cover");
  assert.deepEqual(copy.mediaSourceStartFrames, original.mediaSourceStartFrames);
  assert.ok(copy.dialogueCues.every(cue => !original.dialogueCues.some(item => item.id === cue.id)), "dialogue IDs are new");

  assert.throws(() => applyComicCommand(duplicated, { type: "media.set_start", expectedRevision: duplicated.revision, sceneId: scene.id, shotId: copy.id, assetId: "asset-00000102", startFrame: 30 }, { now, idFactory: ids }), /source duration/);
  const started = applyComicCommand(duplicated, { type: "media.set_start", expectedRevision: duplicated.revision, sceneId: scene.id, shotId: copy.id, assetId: "asset-00000102", startFrame: 6 }, { now, idFactory: ids });
  assert.equal(started.scenes[0].shots[1].mediaSourceStartFrames?.["asset-00000102"], 6);
  const detached = applyComicCommand(started, { type: "media.detach", expectedRevision: started.revision, sceneId: scene.id, shotId: copy.id, slot: "video" }, { now, idFactory: ids });
  assert.equal(detached.scenes[0].shots[1].videoAssetId, undefined);
  assert.equal(detached.scenes[0].shots[1].mediaSourceStartFrames, undefined, "the in-point goes with the media");
  assert.ok(detached.assets.some(asset => asset.id === "asset-00000102"), "the library keeps the file");
  assert.throws(() => applyComicCommand(detached, { type: "media.link", expectedRevision: detached.revision, sceneId: scene.id, shotId: copy.id, slot: "visual", assetId: "asset-00000102" }, { now, idFactory: ids }), /cannot be attached/);

  const reloaded = parseComicProject(serializeComicProject(detached)).project;
  assert.deepEqual(validateComicProject(reloaded).scenes[0].shots[0].mediaFit, "cover");
  assert.equal(reloaded.assets.find(asset => asset.id === "asset-00000102")?.durationMs, 2_500);
  assert.equal(reloaded.assets.find(asset => asset.id === "asset-00000101")?.width, 1920);
});

test("a music project keeps its song settings; choosing a version makes it the song's only track and length", () => {
  const ids = deterministicIds();
  let project = createComicProject({ title: "灯塔之歌", projectKind: "music", now, idFactory: ids, starter: "empty" });
  project = applyComicCommand(project, { type: "project.update", expectedRevision: project.revision,
    patch: { music: { lyrics: "[Verse]\n海风吹过灯塔\n[Chorus]\n我在等你", instrumental: false, genre: "folk", mood: "healing", tempo: "slow", vocals: "female",
      language: "zh", style: "acoustic guitar", length: "full", format: "mp3" } } }, { now, idFactory: ids });
  project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision, scene: { title: "歌曲" } }, { now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  if (!project.scenes[0].shots.length) project = applyComicCommand(project, { type: "shot.add", expectedRevision: project.revision, sceneId }, { now, idFactory: ids });
  for (const [index, id] of ["asset-00000201", "asset-00000202"].entries()) {
    project = applyComicCommand(project, { type: "asset.import", expectedRevision: project.revision, asset: { id, kind: "music", uri: `nextmux.media/music/${id}.mp3`, mimeType: "audio/mpeg",
      byteLength: 1_000, sha256: sha(String(index + 1)), jobId: job(String(index + 1)), provider: "Lyria", model: "google/lyria-3-pro-preview", source: "generated" } }, { now, idFactory: ids });
  }
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, { type: "media.link", expectedRevision: project.revision, sceneId, shotId, slot: "music", assetId: "asset-00000201" }, { now, idFactory: ids });
  project = applyComicCommand(project, { type: "music.select", expectedRevision: project.revision, assetId: "asset-00000202", durationFrames: 24 * 150 }, { now, idFactory: ids });
  const song = project.scenes[0].shots[0];
  assert.deepEqual(song.musicAssetIds, ["asset-00000202"], "one version plays: the chosen one");
  assert.equal(song.durationFrames, 24 * 150);
  assert.equal(project.music?.selectedAssetId, "asset-00000202");
  const reloaded = parseComicProject(serializeComicProject(project)).project;
  assert.equal(reloaded.projectKind, "music");
  assert.equal(reloaded.music?.lyrics, "[Verse]\n海风吹过灯塔\n[Chorus]\n我在等你");
  assert.equal(reloaded.music?.selectedAssetId, "asset-00000202");
  assert.doesNotThrow(() => validateComicProject(reloaded));
  assert.throws(() => applyComicCommand(project, { type: "music.select", expectedRevision: project.revision, assetId: "asset-99999999" }, { now }), /not in this project/);
  assert.throws(() => applyComicCommand(project, { type: "project.update", expectedRevision: project.revision, patch: { music: { ...project.music!, length: "long" as never } } }, { now }), /full or clip/);
  assert.throws(() => applyComicCommand(project, { type: "project.update", expectedRevision: project.revision, patch: { music: { ...project.music!, lyrics: "字".repeat(3_501) } } }, { now }), /lyrics/);
});

test("a chat folder is its own project kind", () => {
  const chat = createComicProject({ title: "对话", projectKind: "chat", now, idFactory: deterministicIds() });
  assert.equal(chat.projectKind, "chat");
  assert.equal(parseComicProject(serializeComicProject(chat)).project.projectKind, "chat");
});

test("发送到剪辑: a sound goes on its own track after the last one, over an empty shot when none is left", () => {
  const { project, ids } = library();
  const voice = applyComicCommand(project, {
    type: "asset.import", expectedRevision: project.revision,
    asset: { id: "asset-00000104", kind: "audio", uri: "nextmux.media/imports/d.mp3", mimeType: "audio/mpeg", model: "旁白.mp3", durationMs: 1_500,
      byteLength: 900, sha256: sha("4"), jobId: job("4"), provider: "本机导入", source: "imported" },
  }, { now, idFactory: ids });
  // No picture yet: the music gets an empty shot as long as itself.
  const alone = applyComicEditorEdits(voice, [{ type: "append_audio", assetId: "asset-00000103", role: "music" }], { now, idFactory: ids });
  const empty = alone.project.scenes[0].shots[0];
  assert.deepEqual([empty.durationFrames, empty.musicAssetIds, empty.visualAssetId, empty.videoAssetId], [120, ["asset-00000103"], undefined, undefined]);
  assert.deepEqual(alone.createdShotIds, [empty.id]);

  // Two pictures: music starts under the first, the voice line under the first, the next voice line under the second.
  const clips = applyComicEditorEdits(voice, [{ type: "insert_clips", assetIds: ["asset-00000101", "asset-00000102"] }], { now, idFactory: ids }).project;
  const music = applyComicEditorEdits(clips, [{ type: "append_audio", assetId: "asset-00000103", role: "music" }], { now, idFactory: ids });
  assert.deepEqual(music.project.scenes[0].shots.map(shot => shot.musicAssetIds), [["asset-00000103"], ["asset-00000103"]], "music keeps playing under the next shot");
  assert.deepEqual(music.createdShotIds, []);
  const first = applyComicEditorEdits(music.project, [{ type: "append_audio", assetId: "asset-00000104", role: "audio" }], { now, idFactory: ids }).project;
  const second = applyComicEditorEdits(first, [{ type: "append_audio", assetId: "asset-00000104", role: "audio" }], { now, idFactory: ids });
  assert.deepEqual(second.project.scenes[0].shots.map(shot => shot.audioAssetId), ["asset-00000104", "asset-00000104"]);
  // The track is full: a third line adds an empty 1.5 s shot at the end.
  const third = applyComicEditorEdits(second.project, [{ type: "append_audio", assetId: "asset-00000104", role: "audio" }], { now, idFactory: ids });
  const shots = third.project.scenes[0].shots;
  assert.equal(shots.length, 3);
  assert.deepEqual([shots[2].durationFrames, shots[2].audioAssetId], [36, "asset-00000104"]);
  // The music track is full too; a second piece starts after it on a new empty shot.
  const more = applyComicEditorEdits(third.project, [{ type: "append_audio", assetId: "asset-00000103", role: "music" }], { now, idFactory: ids });
  assert.equal(more.project.scenes[0].shots.length, 3, "the voice's empty shot still had no music, so the second piece starts there");
  assert.deepEqual(more.project.scenes[0].shots[2].musicAssetIds, ["asset-00000103"]);
  assert.throws(() => applyComicEditorEdits(voice, [{ type: "append_audio", assetId: "asset-00000101", role: "music" }], { now, idFactory: ids }), /Only audio/);
  assert.throws(() => applyComicEditorEdits(voice, [{ type: "append_audio", assetId: "asset-00000103", role: "subtitle" as never }], { now, idFactory: ids }), /voice, music or effect/);
});
