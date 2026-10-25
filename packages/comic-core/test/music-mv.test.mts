import assert from "node:assert/strict";
import test from "node:test";
import {
  ComicCoreError, alignMusicLyrics, applyComicCommand, createComicProject, estimateMusicLyrics, estimateMusicMvCost,
  generateMusicLyricsAss, musicMvSettings, musicSettings, nudgeMusicLyricLine, parseComicProject,
  parseMusicLyrics, serializeComicProject, setMusicLyricStart, splitMusicMvSegments,
} from "../lib/index.js";

const lyrics = "[Verse]\n海风吹过\n我在等你\n\n[Chorus]\n星光陪伴着你";
function mv(text = lyrics, durationMs = 60_001) {
  const lines = estimateMusicLyrics(text, durationMs);
  return { lyrics: text, songAssetId: "asset-00000001", durationMs, alignment: "estimated" as const,
    lines, segments: splitMusicMvSegments(lines, durationMs, "folk, warm") };
}

test("lyric parsing preserves authored words, repeated sections and blank paragraphs", () => {
  const parsed = parseMusicLyrics("[Verse]\r\n海风，吹过！\r\n等你\r\n\r\n新一段\n【副歌】\n同一句\n[Chorus]\n同一句");
  assert.deepEqual(parsed.map(line => [line.id, line.sectionIndex, line.sectionTitle, line.text]), [
    ["line-1", 0, "Verse", "海风，吹过！"], ["line-2", 0, "Verse", "等你"],
    ["line-3", 1, "Verse", "新一段"], ["line-4", 2, "副歌", "同一句"], ["line-5", 3, "Chorus", "同一句"],
  ]);
});

test("estimated timing uses character weights, covers all milliseconds and declares its uncertainty", () => {
  const lines = estimateMusicLyrics("[Verse]\n春风\n\n[Chorus]\n春风吹又生啊", 8_001);
  assert.deepEqual(lines.map(line => [line.startMs, line.endMs]), [[0, 2_000], [2_000, 8_001]]);
  assert.ok(lines.every(line => line.alignment === "estimated"));
  assert.deepEqual(estimateMusicLyrics("[Instrumental]", 30_000), []);
  for (const duration of [NaN, Infinity, 0, -5, 3_600_001]) assert.throws(() => estimateMusicLyrics(lyrics, duration), ComicCoreError);
  assert.throws(() => estimateMusicLyrics("一\n二", 1), /too short/);
});

test("recognition aligns original Chinese lyrics and punctuation without replacing authored text", () => {
  const result = alignMusicLyrics("[Verse]\n海风，吹过！\n我在等你。", 10_000, [
    { text: "海风吹过", startMs: 1_000, endMs: 4_000 },
    { text: "我在等你", startMs: 5_000, endMs: 9_000 },
  ]);
  assert.equal(result.alignment, "recognized");
  assert.equal(result.matchedLineCount, 2);
  assert.deepEqual(result.lines.map(line => [line.text, line.startMs, line.endMs]), [["海风，吹过！", 1_000, 4_000], ["我在等你。", 5_000, 9_000]]);
  assert.ok(result.lines.every(line => line.alignment === "recognized"));
});

test("recognition retains repeated choruses in temporal order and tolerates an imperfect word", () => {
  const result = alignMusicLyrics("[Chorus]\n我在等你回来\n[Chorus]\n我在等你回来", 20_000, [
    { text: "我在等妳回来", startMs: 2_000, endMs: 7_000 },
    { text: "我在等你回来", startMs: 12_000, endMs: 18_000 },
  ]);
  assert.equal(result.matchedLineCount, 2);
  assert.deepEqual(result.lines.map(line => [line.startMs, line.endMs]), [[2_000, 7_000], [12_000, 18_000]]);
  assert.equal(result.lines[0]!.text, "我在等你回来");
});

test("unrecognized lyric lines are proportionally estimated between confident timing anchors", () => {
  const result = alignMusicLyrics("海风吹过\n等待黎明\n你会回来", 12_000, [
    { text: "海风吹过", startMs: 1_000, endMs: 3_000 },
    { text: "你会回来", startMs: 9_000, endMs: 11_000 },
  ]);
  assert.equal(result.matchedLineCount, 2);
  assert.deepEqual(result.lines.map(line => [line.startMs, line.endMs, line.alignment]), [[1_000, 3_000, "recognized"], [3_000, 9_000, "estimated"], [9_000, 11_000, "recognized"]]);
});

test("empty, unrelated or invalid recognition is an explicit estimated fallback", () => {
  for (const transcript of [[], [{ text: "abcdef", startMs: 0, endMs: 5_000 }], [{ text: "海风吹过", startMs: NaN, endMs: Infinity }]]) {
    const result = alignMusicLyrics(lyrics, 30_000, transcript);
    assert.equal(result.alignment, "estimated");
    assert.equal(result.matchedLineCount, 0);
    assert.deepEqual(result.lines, estimateMusicLyrics(lyrics, 30_000));
  }
});

test("tap alignment cannot reverse lines or run outside the song and leaves the source untouched", () => {
  const lines = estimateMusicLyrics("一\n二\n三", 9_000);
  const tapped = setMusicLyricStart(lines, "line-2", 4_500, 9_000);
  assert.deepEqual(tapped.map(line => [line.startMs, line.endMs]), [[0, 4_500], [4_500, 6_750], [6_750, 9_000]]);
  assert.equal(tapped[1]!.alignment, "tapped");
  assert.equal(lines[0]!.endMs, 3_000);
  for (const time of [-100, 100_000]) {
    const result = setMusicLyricStart(lines, "line-2", time, 9_000);
    assert.ok(result.every((line, index) => line.startMs >= 0 && line.endMs > line.startMs && line.endMs <= 9_000 && (!index || line.startMs >= result[index - 1]!.endMs)));
  }
  assert.equal(setMusicLyricStart(lines, "line-2", NaN, 9_000), lines);
  assert.equal(setMusicLyricStart(lines, "missing", 1_000, 9_000), lines);
});

test("a late vocal entrance can pass the next estimate while protecting an already tapped future line", () => {
  const lines = estimateMusicLyrics("一\n二\n三\n四", 20_000);
  const tapped = setMusicLyricStart(lines, "line-1", 8_000, 20_000);
  assert.equal(tapped[0]!.startMs, 8_000, "the old next estimate at 5 s must not clamp this tap");
  assert.deepEqual(tapped.map(line => [line.startMs, line.endMs]), [[8_000, 11_000], [11_000, 14_000], [14_000, 17_000], [17_000, 20_000]]);
  const locked = lines.map((line, index) => index === 3 ? { ...line, alignment: "tapped" as const } : line);
  const limited = setMusicLyricStart(locked, "line-1", 8_000, 20_000);
  assert.equal(limited[0]!.startMs, 8_000);
  assert.equal(limited[3]!.startMs, 15_000);
  assert.equal(limited[3]!.alignment, "tapped");
  assert.equal(limited[2]!.endMs, 15_000);
});

test("100 ms micro-adjustment is bounded and recorded as manual timing", () => {
  const lines = estimateMusicLyrics("一\n二\n三", 9_000);
  const earlier = nudgeMusicLyricLine(lines, "line-2", -100, 9_000);
  assert.equal(earlier[1]!.startMs, 2_900);
  assert.equal(earlier[1]!.endMs, 5_900);
  assert.equal(earlier[0]!.endMs, 2_900);
  assert.equal(earlier[1]!.alignment, "manual");
  const later = nudgeMusicLyricLine(lines, "line-2", 100, 9_000);
  assert.equal(later[1]!.startMs, 3_100);
  assert.equal(later[1]!.endMs, 6_100);
  assert.equal(later[2]!.startMs, 6_100);
  assert.equal(nudgeMusicLyricLine(lines, "line-1", -100, 9_000)[0]!.startMs, 0);
  assert.equal(nudgeMusicLyricLine(lines, "line-1", Infinity, 9_000), lines);
});

test("nudging against a manually tapped next line preserves that explicit start point", () => {
  const lines = estimateMusicLyrics("一\n二\n三", 9_000).map((line, index) => index === 2 ? { ...line, alignment: "tapped" as const } : line);
  const nudged = nudgeMusicLyricLine(lines, "line-2", 100, 9_000);
  assert.deepEqual([nudged[1]!.startMs, nudged[1]!.endMs], [3_100, 6_000]);
  assert.deepEqual(nudged[2], lines[2]);
  const far = nudgeMusicLyricLine(lines, "line-2", 10_000, 9_000);
  assert.equal(far[1]!.endMs, 6_000);
  assert.ok(far[1]!.startMs < far[1]!.endMs);
});

test("MV segment splitting keeps paragraph boundaries and splits every long paragraph at 25 s", () => {
  const lines = estimateMusicLyrics("[Verse]\n一\n二\n[Chorus]\n三", 90_000);
  const segments = splitMusicMvSegments(lines, 90_000, "dreamy folk");
  assert.equal(segments.length, 5);
  assert.deepEqual(segments.map(segment => [segment.sectionTitle, segment.startMs, segment.endMs]), [
    ["Verse", 0, 20_000], ["Verse", 20_000, 40_000], ["Verse", 40_000, 60_000], ["Chorus", 60_000, 75_000], ["Chorus", 75_000, 90_000],
  ]);
  assert.ok(segments.every(segment => segment.endMs - segment.startMs <= 25_000 && segment.source === "ai-video" && segment.prompt.includes("dreamy folk")));
  assert.deepEqual(segments[1]!.lineIds, ["line-1", "line-2"]);
  assert.deepEqual(segments[3]!.lineIds, ["line-3"], "the planning stage keeps the authored lyric association");
  assert.equal(lines.find(line => line.id === segments[3]!.lineIds[0])!.text, "三");
  assert.ok(!segments[3]!.prompt.includes("三"), "the initial visual prompt does not paste raw lyrics on screen");
});

test("instrumental and uneven-length segment timelines cover the full song without gaps", () => {
  for (const duration of [1, 25_000, 25_001, 60_001, 3_600_000]) {
    const segments = splitMusicMvSegments([], duration, "instrumental");
    assert.equal(segments[0]!.startMs, 0);
    assert.equal(segments.at(-1)!.endMs, duration);
    assert.ok(segments.every((segment, index) => Number.isInteger(segment.startMs) && Number.isInteger(segment.endMs) && segment.endMs > segment.startMs && segment.endMs - segment.startMs <= 25_000 && (!index || segment.startMs === segments[index - 1]!.endMs)));
  }
  assert.throws(() => splitMusicMvSegments([], 60_000, "", 25_001), ComicCoreError);
});

test("cost estimates count only AI clips and use the exact rounded model request lengths", () => {
  const segments = [
    { source: "ai-video" as const, startMs: 0, endMs: 12_100 },
    { source: "upload-image" as const, startMs: 12_100, endMs: 25_000 },
    { source: "ai-video" as const, startMs: 25_000, endMs: 44_000 },
  ];
  assert.deepEqual(estimateMusicMvCost(segments, { perSecond: 0.05, perRequest: 0.2 }), { segmentCount: 2, durationSeconds: 32, totalCost: 2 });
  assert.deepEqual(estimateMusicMvCost(segments, { perSecond: 0.05, perRequest: 0.2, requestedSeconds: [8, 10] }), { segmentCount: 2, durationSeconds: 18, totalCost: 1.3 });
  assert.equal(estimateMusicMvCost(segments, { perSecond: 0 }).totalCost, 0);
  for (const prices of [{}, { perSecond: -1 }, { perRequest: Infinity }, { perSecond: 1, requestedSeconds: [8] }]) assert.equal(estimateMusicMvCost(segments, prices).totalCost, undefined);
  assert.equal(estimateMusicMvCost([], {}).totalCost, 0);
});

test("ASS subtitles retain Chinese, use absolute song timing and neutralize override/event injection", () => {
  const output = generateMusicLyricsAss([
    { text: "海风，吹过！", startMs: 1_230, endMs: 4_560 },
    { text: "{\\pos(0,0)}\\N\nDialogue: injected", startMs: 5_000, endMs: 9_000 },
  ], { width: 1080, height: 1920, fontName: "PingFang SC" });
  assert.match(output, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(output, /Style: Lyrics,PingFang SC,49,/);
  assert.match(output, /Dialogue: 0,0:00:01\.23,0:00:04\.56,Lyrics,,0,0,0,,海风，吹过！/);
  assert.equal(output.match(/^Dialogue:/gm)?.length, 2);
  assert.ok(output.includes("｛＼pos(0,0)｝＼N\\NDialogue: injected"));
  assert.ok(!output.includes("{\\pos"));
  assert.equal(generateMusicLyricsAss([{ text: "", startMs: 0, endMs: 1 }]).match(/^Dialogue:/gm), null);
});

test("ASS time rounding cannot produce a zero-length cue and unsafe font names cannot add headers", () => {
  const output = generateMusicLyricsAss([{ text: "字", startMs: 3_599_999, endMs: 3_600_000 }], { fontName: "Noto,\nInjected\0" });
  assert.match(output, /Dialogue: 0,1:00:00\.00,1:00:00\.01,/);
  assert.ok(output.includes("Style: Lyrics,NotoInjected,"));
});

test("MV settings survive project serialization and old music projects need no migration", () => {
  const settings = musicSettings({ lyrics, mv: mv() }, "music");
  assert.deepEqual(settings.mv, mv());
  const project = createComicProject({ title: "MV", projectKind: "music", starter: "empty" });
  const saved = applyComicCommand(project, { type: "project.update", expectedRevision: project.revision, patch: { music: settings } });
  assert.deepEqual(parseComicProject(serializeComicProject(saved)).project.music?.mv, mv());
  assert.equal(musicSettings({ lyrics }, "music").mv, undefined);
});

test("persisted MV validation rejects unsafe times, overlaps, identifiers, sources and broken coverage", () => {
  const valid = mv();
  const invalid = [
    { ...valid, durationMs: NaN }, { ...valid, durationMs: 0 }, { ...valid, alignment: "guess" },
    { ...valid, lines: [{ ...valid.lines[0], startMs: -1 }] },
    { ...valid, lines: [{ ...valid.lines[0], endMs: 0 }] },
    { ...valid, lines: [{ ...valid.lines[0], startMs: 0.5 }] },
    { ...valid, lines: [valid.lines[0], { ...valid.lines[1], startMs: 0 }] },
    { ...valid, lines: [valid.lines[0], { ...valid.lines[1], id: valid.lines[0]!.id }] },
    { ...valid, lines: [{ ...valid.lines[0], alignment: "maybe" }] },
    { ...valid, segments: [{ ...valid.segments[0], startMs: 1 }] },
    { ...valid, segments: [{ ...valid.segments[0], endMs: 25_001 }] },
    { ...valid, segments: [{ ...valid.segments[0], lineIds: ["unknown"] }] },
    { ...valid, segments: [{ ...valid.segments[0], source: "url" }] },
    { ...valid, segments: [{ ...valid.segments[0], assetId: "../../file" }] },
    { ...valid, segments: [{ ...valid.segments[0], jobId: "bad-id" }] },
  ];
  for (const value of invalid) assert.throws(() => musicMvSettings(value, "music.mv"), /must|invalid|cannot|unknown|supported|duplicate/);
});
