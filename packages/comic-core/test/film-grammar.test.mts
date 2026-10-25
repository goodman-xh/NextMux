import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComicCommand, createComicProject, parseComicProject, serializeComicProject,
  productionDocumentFromComicProject, createComicCharacterBundle, validateComicCharacterBundle,
  resolveComicShotTransitions,
} from "../lib/index.js";
import { comicTitleWithDefault, localizeComicProjectDefaults } from "../lib/default-titles.js";
import type { ComicCommand } from "../lib/types.js";

const now = "2026-09-28T00:00:00.000Z";
function fixture(locale = "en") {
  let sequence = 0;
  const options = { now, locale, idFactory: (prefix: string) => `${prefix}-${String(++sequence).padStart(8, "0")}` };
  let project = createComicProject(options);
  const apply = (command: Omit<ComicCommand, "expectedRevision"> | Record<string, unknown>) =>
    project = applyComicCommand(project, { ...command, expectedRevision: project.revision } as ComicCommand, options);
  return { get project() { return project; }, apply, options };
}

test("film grammar, aliases, set plates and dialogue tone survive persistence and production projection", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  f.apply({ type: "character.add", character: { name: "阿土", aliases: ["闰土", "Runtu"] } });
  const character = f.project.characters[0]!;
  f.apply({ type: "asset.import", asset: { id: "asset-setplate1", kind: "image", source: "imported", uri: "nextmux.media/set.png",
    mimeType: "image/png", byteLength: 42, sha256: "a".repeat(64), jobId: "media-job-00000000-0000-0000-0000-000000000000", provider: "local", model: "set.png" } });
  f.apply({ type: "scene.update", sceneId, patch: { setPlateAssetId: "asset-setplate1" } });
  f.apply({ type: "shot.update", sceneId, shotId, patch: {
    cameraMotion: "orbit", cameraAngle: "over_the_shoulder", lens: { focalLength: "telephoto", depthOfField: "shallow" },
    transition: "dissolve", beats: [{ startSeconds: 0, endSeconds: 2, action: "Walk to the window" }, { startSeconds: 2, endSeconds: 4, action: "Stop" }],
    searchTerms: ["rain", "city", "window"], continuousTakeId: "window-take",
  }, cues: [{ text: "你回来了。", tone: "relieved", speakerCharacterId: character.id }] });
  f.apply({ type: "project.update", patch: { continuousShotsShareFrames: true } });
  const reloaded = parseComicProject(serializeComicProject(f.project)).project;
  const shot = reloaded.scenes[0]!.shots[0]!;
  assert.equal(shot.cameraMotion, "orbit");
  assert.equal(shot.cameraAngle, "over_the_shoulder");
  assert.deepEqual(shot.lens, { focalLength: "telephoto", depthOfField: "shallow" });
  assert.equal(shot.dialogueCues[0]!.tone, "relieved");
  assert.equal(shot.dialogueCues[0]!.text, "你回来了。");
  assert.deepEqual(shot.searchTerms, ["rain", "city", "window"]);
  assert.equal(shot.beats?.[1]?.endSeconds, 4);
  assert.equal(reloaded.continuousShotsShareFrames, true);
  assert.deepEqual(reloaded.characters[0]!.aliases, ["闰土", "Runtu"]);
  const production = productionDocumentFromComicProject(reloaded);
  assert.equal(production.timelines[0]!.clips[0]!.transitionIn, "dissolve");
  assert.ok(production.shots[0]!.referenceAssetIds.includes("asset-setplate1"));
  assert.deepEqual(production.shots[0]!.beats, shot.beats);
  const bundle = validateComicCharacterBundle(createComicCharacterBundle(reloaded, character.id, "authored", { bundleId: "bundle-00000001", now }));
  assert.deepEqual(bundle.character.aliases, ["闰土", "Runtu"]);
});

test("each of the six additional camera motions is accepted; unknown motions remain rejected", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  for (const cameraMotion of ["orbit", "crane_up", "crane_down", "dolly_zoom", "aerial", "follow"]) {
    f.apply({ type: "shot.update", sceneId, shotId, patch: { cameraMotion } });
    assert.equal(parseComicProject(serializeComicProject(f.project)).project.scenes[0]!.shots[0]!.cameraMotion, cameraMotion);
  }
  assert.throws(() => f.apply({ type: "shot.update", sceneId, shotId, patch: { cameraMotion: "spin_and_zoom" } }), /not supported/);
});

test("new fields reject malformed persisted data and commands without changing the project", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  for (const patch of [
    { cameraAngle: "sideways" }, { lens: { focalLength: "wide", depthOfField: "unknown" } },
    { beats: [{ startSeconds: 3, endSeconds: 6, action: "Run" }] },
    { beats: [{ startSeconds: 0, endSeconds: 3, action: "Run" }, { startSeconds: 2, endSeconds: 4, action: "Stop" }] },
    { beats: [{ startSeconds: 2, endSeconds: 2, action: "Stop" }] },
    { searchTerms: ["下雨", "城市", "街道"] }, { searchTerms: ["rain"] },
  ]) assert.throws(() => f.apply({ type: "shot.update", sceneId, shotId, patch }));
  assert.equal(f.project.revision, 0);
  assert.throws(() => f.apply({ type: "scene.update", sceneId, patch: { setPlateAssetId: "asset-missing1" } }), /image/);
  assert.throws(() => f.apply({ type: "project.update", patch: { continuousShotsShareFrames: "true" } }), /true or false/);
  const invalid = { ...f.project, scenes: f.project.scenes.map(scene => ({ ...scene, setPlateAssetId: "asset-missing1" })) };
  assert.throws(() => parseComicProject(invalid), /image/);
});

test("legacy schema 2 loads unchanged without film grammar or automatic title inference", () => {
  const original = createComicProject({ title: "未命名漫剧", now });
  const legacy = JSON.parse(JSON.stringify(original));
  delete legacy.titleDefault;
  for (const scene of legacy.scenes) {
    delete scene.titleDefault;
    for (const shot of scene.shots) delete shot.titleDefault;
  }
  const parsed = parseComicProject(legacy).project;
  assert.equal(parsed.continuousShotsShareFrames, undefined);
  assert.equal(parsed.scenes[0]!.shots[0]!.cameraAngle, undefined);
  assert.equal(localizeComicProjectDefaults(parsed, "en").title, "未命名漫剧");
});

test("default titles follow all twelve locales and renaming clears their provenance", () => {
  const f = fixture("fr");
  assert.equal(f.project.title, "Bande dessinée sans titre");
  assert.equal(f.project.scenes[0]!.title, "Scène 1");
  assert.equal(f.project.scenes[0]!.shots[0]!.title, "Plan 1");
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de", "pt-BR", "ru", "ar", "hi"]) {
    const localized = localizeComicProjectDefaults(f.project, locale);
    assert.equal(localized.title, comicTitleWithDefault("project", locale).title);
    assert.equal(localized.scenes[0]!.shots[0]!.title, comicTitleWithDefault("shot", locale, 1).title);
    assert.equal(localized.revision, f.project.revision);
    assert.equal(parseComicProject(serializeComicProject(localized)).project.titleDefault?.locale, locale);
  }
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  f.apply({ type: "project.update", patch: { title: "My story" } });
  f.apply({ type: "scene.update", sceneId, patch: { title: "The platform" } });
  f.apply({ type: "shot.update", sceneId, shotId, patch: { title: "Arrival" } });
  const localized = localizeComicProjectDefaults(f.project, "zh-CN");
  assert.equal(localized.titleDefault, undefined);
  assert.equal(localized.scenes[0]!.titleDefault, undefined);
  assert.equal(localized.scenes[0]!.shots[0]!.titleDefault, undefined);
  assert.equal(localized.scenes[0]!.shots[0]!.title, "Arrival");
});

test("copy suffixes translate while preserving user titles and inherited default titles", () => {
  const f = fixture("en");
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  f.apply({ type: "shot.duplicate", sceneId, shotId });
  assert.equal(f.project.scenes[0]!.shots[1]!.title, "Shot 1 (copy)");
  assert.equal(localizeComicProjectDefaults(f.project, "ja").scenes[0]!.shots[1]!.title, "ショット 1（コピー）");
  f.apply({ type: "shot.update", sceneId, shotId, patch: { title: "Named by author" } });
  f.apply({ type: "shot.duplicate", sceneId, shotId });
  assert.equal(localizeComicProjectDefaults(f.project, "de").scenes[0]!.shots[1]!.title, "Named by author (Kopie)");
});

test("split and trim operations keep timed beats inside each shot and rebase their times", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  f.apply({ type: "shot.update", sceneId, shotId, patch: { beats: [
    { startSeconds: 0, endSeconds: 3, action: "Walk" }, { startSeconds: 3, endSeconds: 4, action: "Stop" },
  ] } });
  f.apply({ type: "shot.split", sceneId, shotId, splitAtFrame: 48 });
  const [left, right] = f.project.scenes[0]!.shots;
  assert.deepEqual(left!.beats, [{ startSeconds: 0, endSeconds: 2, action: "Walk" }]);
  assert.deepEqual(right!.beats, [{ startSeconds: 0, endSeconds: 1, action: "Walk" }, { startSeconds: 1, endSeconds: 2, action: "Stop" }]);
  f.apply({ type: "shot.trim_start", sceneId, shotId: right!.id, frames: 12 });
  assert.deepEqual(f.project.scenes[0]!.shots[1]!.beats, [{ startSeconds: 0, endSeconds: .5, action: "Walk" }, { startSeconds: .5, endSeconds: 1.5, action: "Stop" }]);
  assert.doesNotThrow(() => serializeComicProject(f.project));
});

test("explicit cuts survive projection and absent legacy transitions retain positional defaults", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id;
  f.apply({ type: "shot.add", sceneId });
  f.apply({ type: "scene.add", scene: { episodeNumber: 1 } });
  const otherSceneId = f.project.scenes[1]!.id;
  f.apply({ type: "shot.add", sceneId: otherSceneId });
  let timeline = productionDocumentFromComicProject(f.project).timelines[0]!;
  assert.deepEqual(timeline.clips.map(clip => clip.transitionIn), ["cut", "cut", "cut"]);
  assert.deepEqual(timeline.clips.map(clip => clip.transitionOut), ["cut", "cut", "cut"]);
  assert.deepEqual(resolveComicShotTransitions({}, { firstInEpisode: true, lastInEpisode: true, acrossScenes: false }), { transitionIn: "fade", transitionOut: "fade" });
  assert.deepEqual(resolveComicShotTransitions({}, { firstInEpisode: false, lastInEpisode: false, acrossScenes: true }), { transitionIn: "dissolve", transitionOut: "cut" });
  f.apply({ type: "shot.update", sceneId: otherSceneId, shotId: f.project.scenes[1]!.shots[0]!.id, patch: { transition: "cut" } });
  timeline = productionDocumentFromComicProject(f.project).timelines[0]!;
  assert.equal(timeline.clips[2]!.transitionIn, "cut");
});

test("episode source ranges and default provenance persist, and editing an episode title stops localization", () => {
  const f = fixture();
  f.apply({ type: "project.update", patch: { episodes: [{ number: 1, ...comicTitleWithDefault("episode", "en", 1), script: "A room.",
    sourceRange: { start: 0, end: 500 }, outline: "Arrival", ending: "The door opens" }] } });
  const reloaded = parseComicProject(serializeComicProject(f.project)).project;
  assert.deepEqual(reloaded.episodes?.[0]?.sourceRange, { start: 0, end: 500 });
  assert.deepEqual(productionDocumentFromComicProject(reloaded).episodes[0]?.titleDefault, reloaded.episodes?.[0]?.titleDefault);
  assert.equal(localizeComicProjectDefaults(reloaded, "fr").episodes?.[0]?.title, "Épisode 1");
  f.apply({ type: "project.update", patch: { episodes: [{ ...reloaded.episodes![0]!, title: "The letter" }] } });
  assert.equal(f.project.episodes?.[0]?.titleDefault, undefined);
  assert.equal(localizeComicProjectDefaults(f.project, "fr").episodes?.[0]?.title, "The letter");
});

test("MV treatment, singer portrait and performance shots survive validation without changing lyrics", () => {
  const f = fixture();
  f.apply({ type: "asset.import", asset: { id: "asset-singer001", kind: "image", source: "imported", uri: "nextmux.media/singer.png",
    mimeType: "image/png", byteLength: 42, sha256: "b".repeat(64), jobId: "media-job-00000000-0000-0000-0000-000000000001", provider: "local", model: "singer.png" } });
  const mv = {
    lyrics: "归来", durationMs: 8_000, alignment: "manual",
    treatment: { protagonist: "A singer at the harbor", palette: ["navy", "amber", "ivory"], recurringImages: ["paper lantern"] },
    singerPortraitAssetId: "asset-singer001",
    lines: [{ id: "line_1", sectionIndex: 0, sectionTitle: "Verse", text: "归来", startMs: 0, endMs: 8_000 }],
    segments: [{ id: "segment_1", sectionIndex: 0, sectionTitle: "Verse", startMs: 0, endMs: 8_000, lineIds: ["line_1"],
      prompt: "The singer stands beneath a lantern", source: "ai-video", performance: true }],
  };
  f.apply({ type: "project.update", patch: { music: { lyrics: "归来", instrumental: false, genre: "folk", mood: "warm", tempo: "slow",
    vocals: "alto", language: "zh", style: "acoustic", length: "full", format: "wav", mv } } });
  const reloaded = parseComicProject(serializeComicProject(f.project)).project;
  assert.deepEqual(reloaded.music?.mv?.treatment, mv.treatment);
  assert.equal(reloaded.music?.mv?.singerPortraitAssetId, "asset-singer001");
  assert.equal(reloaded.music?.mv?.segments[0]?.performance, true);
  assert.equal(reloaded.music?.mv?.lines[0]?.text, "归来");
  assert.throws(() => parseComicProject({ ...reloaded, assets: [] }), /singer portrait/);
});

test("null clears optional shot grammar across JSON while omitted patch fields preserve saved values", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  const authored = { cameraAngle: "low", lens: { focalLength: "telephoto", depthOfField: "shallow" }, transition: "dissolve" };
  f.apply({ type: "shot.update", sceneId, shotId, patch: authored });
  f.apply({ type: "shot.update", sceneId, shotId, patch: { description: "Unrelated edit" } });
  assert.equal(f.project.scenes[0]!.shots[0]!.cameraAngle, "low");
  assert.deepEqual(f.project.scenes[0]!.shots[0]!.lens, authored.lens);
  assert.equal(f.project.scenes[0]!.shots[0]!.transition, "dissolve");
  f.apply(JSON.parse(JSON.stringify({ type: "shot.update", sceneId, shotId, patch: { cameraAngle: null, lens: null, transition: null, transitionIn: "fade" } })));
  const restored = parseComicProject(serializeComicProject(f.project)).project;
  const shot = restored.scenes[0]!.shots[0]!;
  assert.equal(shot.cameraAngle, undefined);
  assert.equal(shot.lens, undefined);
  assert.equal(shot.transition, undefined);
  assert.equal(shot.transitionIn, "cut", "clearing the grammar preset stores an explicit cut");
  assert.equal(productionDocumentFromComicProject(restored).timelines[0]!.clips[0]!.transitionIn, "cut", "an episode boundary must not override the stored cut");
});

test("explicit new transitions and legacy manual incoming transitions still override automatic rules", () => {
  const f = fixture();
  const sceneId = f.project.scenes[0]!.id, shotId = f.project.scenes[0]!.shots[0]!.id;
  f.apply({ type: "shot.update", sceneId, shotId, patch: { transitionIn: "cut" } });
  assert.equal(productionDocumentFromComicProject(f.project).timelines[0]!.clips[0]!.transitionIn, "cut");
  f.apply({ type: "shot.update", sceneId, shotId, patch: { transition: "dissolve", transitionIn: "cut" } });
  assert.equal(f.project.scenes[0]!.shots[0]!.transitionIn, "dissolve");
  assert.equal(productionDocumentFromComicProject(f.project).timelines[0]!.clips[0]!.transitionIn, "dissolve");
  f.apply({ type: "shot.update", sceneId, shotId, patch: { transitionIn: "fade" } });
  assert.equal(f.project.scenes[0]!.shots[0]!.transition, "fade", "legacy-only callers retain explicit control");
});
