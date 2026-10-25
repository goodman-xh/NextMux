import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComicAdaptation,
  applyComicScripts,
  createComicProject,
  normalizeComicAdaptSettings,
  parseComicAdaptation,
  parseComicProject,
  parseComicScripts,
  serializeComicProject,
  timedDialogue,
  untimedDialogueFixes,
} from "../lib/index.js";
import { ComicHierarchyError, comicCharacterLookInstructions, comicCharacterMentions, comicEpisodeShotInstructions, comicLengthPlan, comicScriptInstructions, comicSettingsBrief, comicTextLanguage, parseComicCharacterLook } from "../lib/adaptation-brief.js";

let counter = 0;
const idFactory = (prefix: string) => `${prefix}-${String(++counter).padStart(8, "0")}-aaaa-bbbb-cccc-000000000000`;
const now = "2026-09-26T10:00:00.000Z";

const scripts = {
  title: "故乡",
  styleBible: "Chinese ink-wash animation, muted grey-yellow palette, 1920s rural China",
  characters: [
    { name: "迅哥儿", role: "叙述者", appearance: "middle-aged man, thin face", costume: "dark blue changpao", voice: "low, tired" },
    { name: "闰土", role: "童年好友", appearance: "weathered farmer, deep wrinkles", costume: "thin cotton jacket, felt hat" },
  ],
  episodes: [
    { number: 2, title: "重逢", script: "老屋 · 日\n闰土：老爷！……" },
    { number: 1, title: "归乡", script: "河面 · 深冬\n[冷风] 乌篷船缓缓前行。" },
  ],
};

const shots = (episode: number, lines: string[]) => ({
  episodes: [{ number: episode, title: `第${episode}集`, scenes: [{ title: "场", location: "老屋", timeOfDay: "日", shots: lines.map(line => ({
    title: line, durationSeconds: 6, characters: ["闰土"], action: line, visualPrompt: `A shot: ${line}`, dialogue: [{ speaker: "闰土", text: line }],
  })) }] }],
});

test("scripts become the bible, the characters and ordered, editable episode scripts saved with the project", () => {
  const settings = normalizeComicAdaptSettings({ episodes: 2, episodeSeconds: 60, style: "ink", costume: "民国长衫" });
  const project = applyComicScripts(createComicProject({ title: "未命名漫剧", now, idFactory }), parseComicScripts(scripts), { now, idFactory, adaptSettings: settings });
  assert.equal(project.title, "故乡");
  assert.equal(project.styleBible, scripts.styleBible);
  assert.deepEqual(project.episodes?.map(item => item.number), [1, 2]);
  assert.deepEqual(project.characters.map(item => item.name), ["迅哥儿", "闰土"]);
  assert.equal(project.adaptSettings?.costume, "民国长衫");
  const reloaded = parseComicProject(serializeComicProject(project)).project;
  assert.deepEqual(reloaded.episodes, project.episodes);
  assert.deepEqual(reloaded.adaptSettings, settings);
  assert.throws(() => parseComicScripts({ episodes: [] }), /no episode scripts/);
});

test("an episode storyboarded again replaces only its own scenes and stays in episode order", () => {
  let project = applyComicScripts(createComicProject({ title: "故乡", now, idFactory }), parseComicScripts(scripts), { now, idFactory });
  project = applyComicAdaptation(project, parseComicAdaptation(shots(2, ["二一", "二二"])), { mode: "episode", now, idFactory }).project;
  project = applyComicAdaptation(project, parseComicAdaptation(shots(1, ["一一"])), { mode: "episode", now, idFactory }).project;
  assert.deepEqual(project.scenes.map(scene => scene.episodeNumber), [1, 2]);
  project = applyComicAdaptation(project, parseComicAdaptation(shots(1, ["一新", "一新二"])), { mode: "episode", now, idFactory }).project;
  assert.deepEqual(project.scenes.map(scene => scene.episodeNumber), [1, 2]);
  assert.deepEqual(project.scenes.map(scene => scene.shots.map(shot => shot.title)), [["一新", "一新二"], ["二一", "二二"]]);
  assert.equal(project.characters.length, 2);
  assert.ok(project.scenes[0].shots[0].dialogueCues[0].speakerCharacterId);
});

test("the briefs carry every setting, the continuity rules and the model's clip lengths", () => {
  const settings = normalizeComicAdaptSettings({ episodes: 3, episodeSeconds: 90, style: "wasteland", look: "live", lighting: "逆光剪影", pacing: "fast", sound: "narration" });
  const brief = comicScriptInstructions({ settings, language: "Chinese", aspectRatio: "16:9" });
  assert.match(brief, /exactly 3, each about 90 seconds/);
  assert.match(brief, /Post-apocalyptic wasteland/);
  assert.match(brief, /Real human actors/);
  assert.match(brief, /"逆光剪影"/);
  assert.match(brief, /opens where the previous one ended/);
  assert.match(brief, /comic\.write_scripts/);
  assert.match(comicSettingsBrief(normalizeComicAdaptSettings({})), /Derive the visual style from the text itself/);
  const shotBrief = comicEpisodeShotInstructions({
    settings, episode: { number: 2, title: "重逢", script: "老屋 · 日" }, previousEnding: "船到了。", styleBible: "ink", characters: [{ name: "闰土", appearance: "farmer" }],
    maxShotSeconds: 8, clipSeconds: [4, 6, 8], aspectRatio: "16:9", language: "Chinese",
  });
  assert.match(shotBrief, /one of 4, 6, 8 seconds/);
  assert.match(shotBrief, /船到了。/);
  assert.match(shotBrief, /number: 2/);
  assert.match(shotBrief, /Narrator/);
});

test("shot lengths never exceed the model's longest clip and add up to the episode's target", async () => {
  const { fitShotDurations } = await import("../lib/adaptation-brief.js");
  const veo = fitShotDurations([5, 7, 9, 12, 6, 6, 8, 10], [4, 6, 8], 60);
  assert.ok(veo.every(value => value >= 2 && value <= 8), String(veo));
  assert.equal(veo.reduce((sum, value) => sum + value, 0), 60);
  const short = fitShotDurations([3, 3, 3], [4, 6, 8], 60);
  assert.deepEqual(short, [8, 8, 8], "too few shots cannot be stretched past the longest clip");
  assert.equal(fitShotDurations([20, 20, 20], [], 30).reduce((sum, value) => sum + value, 0), 30);
  assert.deepEqual(fitShotDurations([7, 7], [5, 10]), [7, 7], "no target: only clamped");
});

test("scene headings are read from an episode script, not its lines or sound cues", async () => {
  const { comicScriptSceneHeadings } = await import("../lib/adaptation-brief.js");
  const script = "城市街道 · 傍晚·暴雨\n\n[暴雨声、车流声]\n\n霓虹被雨幕晕成粉蓝两色。\n\n晚风咖啡馆内 · 傍晚·雨\n\n陈屿：这杯我请。\n\n晚风咖啡馆天台 · 雨后·黄昏\n\n林晚把头发别到耳后。";
  assert.deepEqual(comicScriptSceneHeadings(script), ["城市街道 · 傍晚·暴雨", "晚风咖啡馆内 · 傍晚·雨", "晚风咖啡馆天台 · 雨后·黄昏"]);
  assert.deepEqual(comicScriptSceneHeadings("INT. CAFE - NIGHT\nChen: Hi.\nEXT. ROOF - DUSK"), ["INT. CAFE - NIGHT", "EXT. ROOF - DUSK"]);
});

test("the story's length decides whether the adaptation condenses, expands or keeps it, with the numbers", () => {
  const settings = { episodes: 2, episodeSeconds: 60, perspective: "default", style: "default", look: "default", costume: "default", lighting: "default", pacing: "default", sound: "default" };
  const short = "海".repeat(300);
  assert.deepEqual({ ...comicLengthPlan(short, 2, 60), factor: undefined }, { mode: "expand", sourceSeconds: 50, targetSeconds: 120, factor: undefined, units: 300, unit: "characters", severity: "ok", perEpisodeUnits: 150 });
  assert.equal(comicLengthPlan("海".repeat(6000), 1, 60).mode, "condense");
  assert.equal(comicLengthPlan("海".repeat(700), 2, 60).mode, "keep");
  assert.equal(comicLengthPlan(Array.from({ length: 600 }, () => "sea").join(" "), 1, 60).unit, "words");
  const sparse = comicLengthPlan("海".repeat(300), 5, 60);
  assert.deepEqual([sparse.mode, sparse.severity, sparse.perEpisodeUnits], ["expand", "severe", 60]);
  const crowded = comicLengthPlan("海".repeat(20_000), 1, 60);
  assert.deepEqual([crowded.mode, crowded.severity, crowded.perEpisodeUnits], ["condense", "severe", 20_000]);
  const fitting = comicLengthPlan("海".repeat(700), 2, 60);
  assert.deepEqual([fitting.mode, fitting.severity, fitting.perEpisodeUnits], ["keep", "ok", 350]);
  assert.equal(comicLengthPlan("海".repeat(300), 1, 150).severity, "severe", "3× is the expansion boundary");
  assert.equal(comicLengthPlan("海".repeat(600), 1, 20).severity, "severe", "20% is the condensation boundary");
  const english = comicLengthPlan(Array.from({ length: 600 }, () => "sea").join(" "), 3, 60);
  assert.deepEqual([english.unit, english.units, english.perEpisodeUnits], ["words", 600, 200]);
  const brief = comicScriptInstructions({ settings, language: "Chinese", aspectRatio: "16:9", sourceText: short });
  assert.match(brief, /The story is about 300 characters; told as written it fills about 50 seconds of screen, and the series has 120 seconds \(2 × 60\)\. So EXPAND it about 2\.4×/);
  assert.match(comicScriptInstructions({ settings, language: "Chinese", aspectRatio: "16:9", sourceText: "海".repeat(9000) }), /So CONDENSE it to about 8%/);
});

test("one character's look brief reuses the casting rules and applies the series look and quoted request", () => {
  const settings = normalizeComicAdaptSettings({ style: "ink", look: "anime", costume: "hanfu" });
  const instructions = comicCharacterLookInstructions({ character: { name: "阿岚", aliases: ["兰儿"], appearance: "adult, long dark hair", costume: "blue robe", personality: "reserved" },
    styleBible: "Muted indigo ink-wash", settings, mentions: "兰儿解开头绳。", note: "更年轻一点，短发", language: "Simplified Chinese" });
  const seriesBrief = comicScriptInstructions({ settings, language: "Simplified Chinese", aspectRatio: "9:16" });
  const castingRule = seriesBrief.match(/4\. characters:.*Invent none the story does not need\./)?.[0];
  assert.ok(castingRule);
  assert.ok(instructions.includes(castingRule));
  assert.match(instructions, /same person and the same age unless the user's request/);
  assert.match(instructions, /Muted indigo ink-wash/);
  assert.match(instructions, /Chinese ink-wash painting/);
  assert.match(instructions, /Anime characters/);
  assert.match(instructions, /Traditional Chinese period costume/);
  assert.match(instructions, /兰儿解开头绳/);
  assert.match(instructions, /quoted request.*"更年轻一点，短发"/);
  assert.match(instructions, /Return only JSON \{appearance, costume\}/);
});

test("character mentions include aliases in story order, respect the limit and fall back to the story opening", () => {
  const story = "序章无人出现。\n阿岚走进院子。\n旁人走开。\n\n兰儿摘下发簪。\n结尾无人出现。";
  assert.equal(comicCharacterMentions(story, ["阿岚", "兰儿"]), "阿岚走进院子。\n兰儿摘下发簪。");
  assert.equal(comicCharacterMentions(story, ["阿岚", "兰儿"], 10), "阿岚走进院子。");
  assert.equal(comicCharacterMentions(story, ["不存在"], 4), story.slice(0, 4));
  assert.equal(comicCharacterMentions("阿岚说了很长的一句话。", ["阿岚"], 4), "阿岚说了");
});

test("character look parser accepts objects and fenced JSON, but rejects missing or overlong fields", () => {
  assert.deepEqual(parseComicCharacterLook({ appearance: "  short dark hair  ", costume: " blue cotton coat " }),
    { appearance: "short dark hair", costume: "blue cotton coat" });
  assert.deepEqual(parseComicCharacterLook('```json\n{"appearance":"short hair","costume":"linen robe"}\n```'),
    { appearance: "short hair", costume: "linen robe" });
  for (const invalid of ["not JSON", [], { appearance: "  ", costume: "robe" }, { appearance: "face" },
    { appearance: "a".repeat(1201), costume: "robe" }, { appearance: "face", costume: "c".repeat(601) }]) {
    assert.throws(() => parseComicCharacterLook(invalid), ComicHierarchyError);
  }
});

test("a multi-shot video model gets scene-sized shots and no 20-second cap", () => {
  const settings = { episodes: 1, episodeSeconds: 60, perspective: "default", style: "default", look: "default", costume: "default", lighting: "default", pacing: "default", sound: "default" };
  const base = { settings, episode: { number: 1, title: "t", script: "港口 · 夜\n苏念：你好。" }, styleBible: "", characters: [], aspectRatio: "16:9", language: "Chinese" };
  const lengths = Array.from({ length: 27 }, (_, index) => index + 4);
  const multi = comicEpisodeShotInstructions({ ...base, maxShotSeconds: 30, clipSeconds: lengths, multiShot: true });
  assert.match(multi, /one of 4, 5, 6,[^.]*29, 30 seconds/);
  assert.match(multi, /several camera set-ups in one clip/);
  assert.doesNotMatch(multi, /one continuous action from one camera set-up/);
  const single = comicEpisodeShotInstructions({ ...base, maxShotSeconds: 8, clipSeconds: [4, 6, 8] });
  assert.match(single, /one continuous action from one camera set-up/);
  assert.match(single, /whoever speaks a line in the shot is on screen and named there/);
  assert.doesNotMatch(single, /No text, captions, logos or watermarks/);
});

test("a shot's lines are timed one after another in the order written, never all at frame 0", () => {
  const lines = [{ speaker: "顾星河", text: "你终于来了。" }, { speaker: "苏念", text: "你就是给电台写信的人？" }];
  const timed = timedDialogue(lines, 12 * 24, 24);
  assert.deepEqual(timed.map(item => item.line.speaker), ["顾星河", "苏念"]);
  assert.ok(timed[0].startFrame > 0 && timed[0].startFrame + timed[0].durationFrames <= timed[1].startFrame, JSON.stringify(timed));
  assert.ok(timed[1].startFrame + timed[1].durationFrames <= 12 * 24);
  // Too much to say for the shot: squeezed to fit, still in order.
  const long = timedDialogue([{ text: "一".repeat(60) }, { text: "二".repeat(60) }], 5 * 24, 24);
  assert.ok(long[0].startFrame < long[1].startFrame && long[1].startFrame + long[1].durationFrames <= 5 * 24, JSON.stringify(long));
});

test("lines saved untimed (all at frame 0) are put back in script order and timed", () => {
  let project = applyComicScripts(createComicProject({ title: "故乡", now, idFactory }), parseComicScripts(scripts), { now, idFactory });
  project = applyComicAdaptation(project, parseComicAdaptation({ episodes: [{ number: 2, title: "重逢", scenes: [{ title: "场", location: "老屋", timeOfDay: "日", shots: [{
    title: "重逢", durationSeconds: 12, characters: ["闰土"], action: "重逢", visualPrompt: "A shot", dialogue: [{ speaker: "闰土", text: "老爷！……" }, { speaker: "迅哥儿", text: "闰土哥，你来了？" }],
  }] }] }] }), { mode: "episode", now, idFactory }).project;
  const scene = project.scenes.find(item => item.episodeNumber === 2)!;
  const shot = scene.shots[0]!;
  // As older builds saved them: every line from frame 0 to the end, in random order.
  const untimed = { ...project, episodes: project.episodes!.map(item => item.number === 2 ? { ...item, script: "老屋 · 日\n闰土：老爷！……\n迅哥儿：闰土哥，你来了？" } : item),
    scenes: project.scenes.map(item => item.id !== scene.id ? item : { ...item, shots: [{ ...shot, dialogueCues: [...shot.dialogueCues].reverse().map(cue => ({ ...cue, startFrame: 0, durationFrames: shot.durationFrames })) }] }) };
  const fixes = untimedDialogueFixes(untimed);
  assert.equal(fixes.length, 1);
  assert.deepEqual(fixes[0]!.cues.map(cue => cue.text), ["老爷！……", "闰土哥，你来了？"]);
  assert.ok(fixes[0]!.cues[0]!.startFrame! + fixes[0]!.cues[0]!.durationFrames! <= fixes[0]!.cues[1]!.startFrame!, JSON.stringify(fixes[0]!.cues));
  // Freshly adapted shots are already timed and in order.
  assert.equal(untimedDialogueFixes(project).length, 0);
  assert.deepEqual(shot.dialogueCues.map(cue => cue.text), ["老爷！……", "闰土哥，你来了？"]);
});

test("the adaptation answers in the story's own language, not the app's", () => {
  assert.equal(comicTextLanguage("海湾小镇的夜很安静，只有夜航电台的灯还亮着。", "English"), "Simplified Chinese");
  assert.equal(comicTextLanguage("這是我們的故事，他說會來。", "English"), "Traditional Chinese");
  assert.equal(comicTextLanguage("灯台からの手紙が届いたのは、夏の終わりだった。", "English"), "Japanese");
  assert.equal(comicTextLanguage("등대에서 온 편지는 여름이 끝날 무렵 도착했다.", "Simplified Chinese"), "Korean");
  assert.equal(comicTextLanguage("The letter from the lighthouse came at the end of summer.", "Spanish"), "Spanish");
  const zh = comicEpisodeShotInstructions({ settings: normalizeComicAdaptSettings({}), episode: { number: 1, title: "来信", script: "灯塔 · 夜\n苏念：你好。" }, styleBible: "", characters: [], maxShotSeconds: 30, multiShot: true, aspectRatio: "16:9", language: "Simplified Chinese" });
  assert.match(zh, /镜头1（0–5 秒）/);
  assert.doesNotMatch(zh, /Shot 1 \(0/);
});

test("a sequel adds episodes after the last one and leaves the written and storyboarded ones untouched", () => {
  let project = applyComicScripts(createComicProject({ title: "故乡", now, idFactory }), parseComicScripts(scripts), { now, idFactory });
  project = applyComicAdaptation(project, parseComicAdaptation(shots(1, ["一一"])), { mode: "episode", now, idFactory }).project;
  project = applyComicAdaptation(project, parseComicAdaptation(shots(2, ["二一"])), { mode: "episode", now, idFactory }).project;
  const filmed = project.scenes.map(scene => scene.id);
  // The model numbers its sequel 1–2 again; the sequel is still episodes 3–4.
  const sequel = parseComicScripts({
    title: "别的名字", styleBible: "a different look",
    characters: [{ name: "闰土", appearance: "changed" }, { name: "水生", role: "闰土之子", appearance: "thin boy" }],
    episodes: [{ number: 1, title: "离乡", script: "船 · 夜\n水生：……" }, { number: 2, title: "希望", script: "河面 · 晨\n……" }],
  });
  const next = applyComicScripts(project, sequel, { mode: "append", now, idFactory });
  assert.deepEqual(next.episodes?.map(episode => [episode.number, episode.title]), [[1, "归乡"], [2, "重逢"], [3, "离乡"], [4, "希望"]]);
  assert.deepEqual(next.episodes?.slice(0, 2), project.episodes, "the written episodes are unchanged");
  assert.deepEqual(next.scenes.map(scene => scene.id), filmed, "their storyboards stay");
  assert.equal(next.styleBible, project.styleBible, "the series keeps the look it was filmed with");
  assert.equal(next.title, "故乡");
  assert.equal(next.characters.find(character => character.name === "闰土")?.appearance, project.characters.find(character => character.name === "闰土")?.appearance, "existing characters keep their look");
  assert.ok(next.characters.some(character => character.name === "水生"), "new characters join");
});

test("rewriting the whole series drops the storyboards of episodes that no longer exist", () => {
  let project = applyComicScripts(createComicProject({ title: "故乡", now, idFactory }), parseComicScripts(scripts), { now, idFactory });
  project = applyComicAdaptation(project, parseComicAdaptation(shots(1, ["一一"])), { mode: "episode", now, idFactory }).project;
  project = applyComicAdaptation(project, parseComicAdaptation(shots(2, ["二一"])), { mode: "episode", now, idFactory }).project;
  const shorter = applyComicScripts(project, parseComicScripts({ ...scripts, episodes: [{ number: 1, title: "归乡", script: "河面 · 深冬\n……" }] }), { now, idFactory });
  assert.deepEqual(shorter.episodes?.map(episode => episode.number), [1]);
  // Episode 2's shots would otherwise still be filmed and land in episode 1 of the editor and export.
  assert.deepEqual(shorter.scenes.map(scene => scene.episodeNumber), [1]);
});

test("the sequel brief numbers on from the last episode and asks for mode append", () => {
  const settings = normalizeComicAdaptSettings({ episodes: 2, episodeSeconds: 60 });
  const brief = comicScriptInstructions({ settings, language: "Simplified Chinese", aspectRatio: "9:16",
    sequel: { styleBible: "ink wash", episodes: [{ number: 1, title: "归乡" }, { number: 2, title: "重逢" }], lastEnding: "闰土：老爷！" } });
  assert.match(brief, /SEQUEL/);
  assert.match(brief, /numbered 3 to 4/);
  assert.match(brief, /mode "append"/);
  assert.match(brief, /闰土：老爷！/);
  assert.doesNotMatch(comicScriptInstructions({ settings, language: "English", aspectRatio: "16:9" }), /SEQUEL|mode "append"/);
});
