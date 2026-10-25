import assert from "node:assert/strict";
import test from "node:test";
import { applyComicAdaptation, characterSheetLabels, comicAdaptationInstructions, createComicProject, parseComicAdaptation } from "../lib/index.js";

let counter = 0;
const idFactory = (prefix: string) => `${prefix}-${String(++counter).padStart(8, "0")}-aaaa-bbbb-cccc-000000000000`;

const sample = {
  title: "雨夜归人",
  styleBible: "Cinematic 2D anime, muted teal and amber palette, 1990s Hong Kong",
  characters: [
    { name: "林雨", role: "女主", appearance: "25-year-old woman, oval face, long straight black hair", costume: "beige trench coat, red scarf", voice: "soft alto, calm" },
    { name: "阿杰", appearance: "30-year-old man, short hair, stubble", costume: "black leather jacket" },
  ],
  episodes: [{ number: 1, title: "重逢", scenes: [{ title: "车站", location: "旧火车站", timeOfDay: "夜", shots: [
    { title: "雨中等待", durationSeconds: 6, shotSize: "wide", cameraMotion: "push_in", characters: ["林雨"], action: "林雨在站台等车", visualPrompt: "A woman waits on a rainy platform at night", dialogue: [{ speaker: "林雨", text: "他会来吗？" }], sound: "雨声，远处汽笛", mood: "期待" },
    { title: "相遇", durationSeconds: 30, shotSize: "bogus", cameraMotion: null, characters: ["林雨", "阿杰", "路人"], action: "阿杰出现", visualPrompt: "x".repeat(9_000), dialogue: [{ speaker: "路人甲", text: "借过" }] },
  ] }] }],
};

test("a model adaptation becomes an editable storyboard with consistent characters", () => {
  const adaptation = parseComicAdaptation(sample);
  assert.equal(adaptation.episodes[0].scenes[0].shots[1].durationSeconds, 20, "over-long shots are clamped");
  assert.equal(adaptation.episodes[0].scenes[0].shots[1].shotSize, "medium", "unknown enums fall back");
  assert.equal(adaptation.episodes[0].scenes[0].shots[1].visualPrompt.length, 8_000, "over-long prompts are trimmed, not rejected");
  const project = createComicProject({ starter: "storyboard", idFactory, now: "2026-09-25T00:00:00.000Z" });
  const result = applyComicAdaptation(project, adaptation, { mode: "replace", idFactory, now: "2026-09-25T00:00:00.000Z" });
  assert.equal(result.shots, 2);
  assert.equal(result.project.title, "雨夜归人");
  assert.equal(result.project.characters.length, 2);
  assert.equal(result.project.scenes.length, 1, "replace removes the starter storyboard");
  const scene = result.project.scenes[0];
  assert.equal(scene.episodeNumber, 1);
  assert.equal(scene.shots.length, 2, "the placeholder shot of a new scene is replaced");
  const [first, second] = scene.shots;
  assert.match(first.visualPrompt, /Characters — 林雨: 25-year-old woman/);
  assert.match(first.visualPrompt, /Costume: beige trench coat/);
  assert.match(first.visualPrompt, /Style — Cinematic 2D anime/);
  assert.match(first.description, /Sound: 雨声/);
  assert.equal(first.durationFrames, 6 * result.project.frameRate);
  assert.equal(first.dialogueCues[0].speakerCharacterId, result.project.characters[0].id);
  assert.equal(second.dialogueCues[0].speakerCharacterId, undefined);
  assert.match(second.dialogueCues[0].text, /^路人甲：借过$/, "unknown speakers keep their name in the line");
  assert.ok(result.project.revision > project.revision);
});

test("characters already in the project keep their appearance; append keeps existing scenes", () => {
  const project = createComicProject({ title: "续集", starter: "empty", idFactory, now: "2026-09-25T00:00:00.000Z" });
  const withCharacter = applyComicAdaptation(project, parseComicAdaptation({ characters: [{ name: "林雨", appearance: "library look" }], episodes: [{ number: 1, scenes: [{ title: "A", shots: [{ title: "s", durationSeconds: 4, action: "a", visualPrompt: "p" }] }] }] }), { mode: "append", idFactory }).project;
  const next = applyComicAdaptation(withCharacter, parseComicAdaptation(sample), { mode: "append", idFactory }).project;
  assert.equal(next.characters.filter(item => item.name === "林雨").length, 1);
  assert.equal(next.characters.find(item => item.name === "林雨")!.appearance, "library look");
  assert.equal(next.scenes.length, 2);
});

test("empty or malformed adaptations are rejected before touching the project", () => {
  assert.throws(() => parseComicAdaptation({ characters: [], episodes: [] }), /no shots/);
  assert.throws(() => parseComicAdaptation({ characters: "x", episodes: [] }), /must be a list/);
  assert.throws(() => parseComicAdaptation({ characters: [], episodes: [{ scenes: [{ shots: [{ title: "a", visualPrompt: "" }] }] }] }), /invalid length/);
});

test("the adaptation brief names the model limits and the tool contract", () => {
  const brief = comicAdaptationInstructions({ maxShotSeconds: 8, aspectRatio: "16:9", language: "简体中文", knownCharacters: [{ name: "林雨", appearance: "long black hair" }] });
  assert.match(brief, /3–8 seconds/);
  assert.match(brief, /comic\.apply_adaptation/);
  assert.match(brief, /林雨: long black hair/);
});

test("topic brief places the user's own files first and asks for searchable picture prompts when stock is used", async () => {
  const { comicTopicInstructions } = await import("../lib/adaptation-brief.js");
  const brief = comicTopicInstructions({ topic: "海边城市的一天", seconds: 60, maxShotSeconds: 6, aspectRatio: "9:16", language: "Chinese", narrator: "旁白",
    materials: [{ name: "日出海边.jpg", kind: "image" }, { name: "骑行\n片段.mp4", kind: "video" }], stockSearch: true });
  assert.match(brief, /first 2 shots show them in this order/);
  assert.match(brief, /1\. image "日出海边\.jpg"; 2\. video "骑行 片段\.mp4"/);
  assert.match(brief, /8\. Pictures may come from free stock photo and video libraries/);
  assert.match(brief, /searchTerms as an array of 3–6 English search words/);
  const plain = comicTopicInstructions({ topic: "x", seconds: 30, maxShotSeconds: 6, aspectRatio: "16:9", language: "English", narrator: "Narrator" });
  assert.doesNotMatch(plain, /own files|Pictures may come from free/);
  assert.match(plain, /searchTerms as an array of 3–6 English search words/);
});

test("a target length condenses the whole adaptation to fit", () => {
  const brief = comicAdaptationInstructions({ maxShotSeconds: 8, aspectRatio: "16:9", language: "Chinese", targetTotalSeconds: 60 });
  assert.match(brief, /about 60 seconds in total — about 10 shots/);
  assert.doesNotMatch(comicAdaptationInstructions({ maxShotSeconds: 8, aspectRatio: "16:9", language: "Chinese" }), /seconds in total/);
});

test("character sheet labels follow the language the look is written in (round 33: a Chinese card read 'Costume:')", () => {
  assert.deepEqual(characterSheetLabels("齐肩银白短发，脸上有淡淡雀斑 褪色的红色雨衣"), { costume: "服装：", personality: "性格：" });
  assert.deepEqual(characterSheetLabels("齊肩銀白短髮，臉上有雀斑"), { costume: "服裝：", personality: "性格：" });
  assert.deepEqual(characterSheetLabels("銀髪のショートヘア、そばかす"), { costume: "衣装：", personality: "性格：" });
  assert.deepEqual(characterSheetLabels("은발 단발, 주근깨"), { costume: "의상: ", personality: "성격: " });
  assert.deepEqual(characterSheetLabels("Silver bob, freckles"), { costume: "Costume: ", personality: "Personality: " });
});
