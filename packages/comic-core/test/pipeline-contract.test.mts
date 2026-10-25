import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityStatus,
  analyzeComicScript,
  applyComicPlaybackCommand,
  buildComicTimeline,
  classifyComicVoiceCommand,
  ComicVoiceSessionController,
  fallbackForCapability,
  parseComicVoiceCommand,
  supportedCapabilities,
  userVisibleRenderKind,
} from "../lib/index.js";

const profile = {
  providerId: "relay-example",
  modelId: "video-model",
  protocol: "async-video",
  updatedAt: "2026-09-12T00:00:00.000Z",
  capabilities: [
    { capability: "image_to_video", status: "supported", source: "live_probe" },
    { capability: "reference_to_video", status: "supported", source: "provider_metadata" },
    { capability: "async_poll", status: "supported", source: "provider_metadata" },
    { capability: "cancel", status: "unsupported", source: "live_probe", reason: "provider has no cancellation endpoint" },
    { capability: "tts", status: "supported", source: "live_probe" },
  ] as const,
};

test("capability profile is conservative and exposes only proven abilities", () => {
  assert.deepEqual(supportedCapabilities(profile), ["image_to_video", "reference_to_video", "async_poll", "tts"]);
  assert.equal(capabilityStatus(profile, "cancel"), "unsupported");
  assert.equal(capabilityStatus(profile, "native_audio"), "unknown");
});

test("capability fallbacks do not pretend that TTS is subtitle recognition", () => {
  assert.deepEqual(fallbackForCapability(profile, "native_audio"), ["tts"]);
  assert.deepEqual(fallbackForCapability(profile, "native_subtitle"), []);
  assert.deepEqual(fallbackForCapability({ ...profile, capabilities: [...profile.capabilities, { capability: "transcription", status: "supported", source: "live_probe" }] }, "native_subtitle"), ["transcription"]);
});

test("only high-level media work appears in the user queue", () => {
  assert.equal(userVisibleRenderKind("script_analysis"), "解析剧本");
  assert.equal(userVisibleRenderKind("video_generation"), "生成视频");
  assert.equal(userVisibleRenderKind("asset_generation"), "生成素材");
  assert.equal(userVisibleRenderKind("timeline_render"), "合成成片");
  assert.equal(userVisibleRenderKind("shot_edit"), "执行编辑");
});

test("voice playback commands are deterministic and do not create media jobs", () => {
  assert.deepEqual(parseComicVoiceCommand("跳到第二集五分三十秒"), {
    type: "seek_time",
    episodeNumber: 2,
    seconds: 330,
  });
  assert.deepEqual(parseComicVoiceCommand("播放第 2 集的第 5 分 30 秒"), {
    type: "seek_time",
    episodeNumber: 2,
    seconds: 330,
  });
  assert.deepEqual(parseComicVoiceCommand("跳到第2集的5分30秒"), {
    type: "seek_time",
    episodeNumber: 2,
    seconds: 330,
  });
  assert.deepEqual(parseComicVoiceCommand("后退十秒"), { type: "rewind", seconds: 10 });
  assert.deepEqual(parseComicVoiceCommand("跳转到第三集"), { type: "seek_episode", episodeNumber: 3 });
  assert.deepEqual(parseComicVoiceCommand("go to episode 3 5 minutes 30 seconds"), { type: "seek_time", episodeNumber: 3, seconds: 330 });
  assert.deepEqual(parseComicVoiceCommand("go to 5 minutes 30 seconds"), { type: "seek_time", seconds: 330 });
  assert.deepEqual(parseComicVoiceCommand("go to episode 3"), { type: "seek_episode", episodeNumber: 3 });
  assert.deepEqual(parseComicVoiceCommand("rewind 10 seconds"), { type: "rewind", seconds: 10 });
  assert.deepEqual(parseComicVoiceCommand("定位到第二集的第三个镜头"), { type: "locate_shot", episodeNumber: 2, shotNumber: 3 });
  assert.deepEqual(parseComicVoiceCommand("go to episode 2 shot 3"), { type: "locate_shot", episodeNumber: 2, shotNumber: 3 });
  assert.deepEqual(parseComicVoiceCommand("重新合成成片"), { type: "rerender_timeline" });
  assert.deepEqual(parseComicVoiceCommand("把从10秒到12秒这一段改成夜景"), {
    type: "edit_segment",
    instruction: "把从10秒到12秒这一段改成夜景",
    startSeconds: 10,
    endSeconds: 12,
  });
  const command = parseComicVoiceCommand("暂停");
  assert.deepEqual(command && classifyComicVoiceCommand(command, { projectId: "project-00000001" }), {
    kind: "playback",
    command: { type: "pause" },
    applied: true,
  });
});

test("voice edit commands require confirmation before paid media work", () => {
  const command = parseComicVoiceCommand("把当前镜头重新生成");
  assert.ok(command);
  const result = classifyComicVoiceCommand(command, { projectId: "project-00000001" });
  assert.equal(result.kind, "media_job");
  if (result.kind === "media_job") assert.equal(result.requiresConfirmation, true);
});

test("local playback commands change only player state and stay within duration", () => {
  const state = { episodeNumber: 1, currentSeconds: 10, durationSeconds: 30, playing: false, speed: 1 };
  assert.deepEqual(applyComicPlaybackCommand(state, { type: "play" }), { ...state, playing: true });
  assert.equal(applyComicPlaybackCommand(state, { type: "rewind", seconds: 20 }).currentSeconds, 0);
  assert.equal(applyComicPlaybackCommand(state, { type: "forward", seconds: 99 }).currentSeconds, 30);
  assert.deepEqual(applyComicPlaybackCommand(state, { type: "seek_time", episodeNumber: 2, seconds: 7 }), {
    ...state, episodeNumber: 2, currentSeconds: 7, playing: true
  });
});

test("voice session controller supports interruption, correction, and continuous state transitions", () => {
  let tick = 0;
  const voice = new ComicVoiceSessionController({ id: "comic-voice-test", now: () => `t${++tick}` });
  assert.equal(voice.session.state, "idle");
  voice.startListening();
  voice.appendTranscript("播放第三集");
  assert.equal(voice.session.transcript, "播放第三集");
  const command = parseComicVoiceCommand(voice.session.transcript);
  assert.deepEqual(command, { type: "seek_episode", episodeNumber: 3 });
  voice.acceptCommand(command!);
  voice.beginSpeaking();
  assert.equal(voice.session.state, "speaking");
  assert.equal(voice.interrupt().state, "listening");
  assert.equal(voice.session.interrupted, true);
  voice.appendTranscript("不对，播放第二集");
  assert.equal(voice.session.transcript, "不对，播放第二集");
  assert.equal(voice.stop().state, "idle");
  assert.equal(voice.session.transcript, "");
});

test("timeline builder keeps storyboard order and frame-accurate offsets", () => {
  const episode = { id: "episode-00000001", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z", projectId: "project-00000001", number: 1, title: "第一集", summary: "", sceneIds: ["scene-00000001", "scene-00000002"], status: "draft" as const };
  const scenes = [
    { id: "scene-00000002", version: 1, createdAt: episode.createdAt, updatedAt: episode.updatedAt, episodeId: episode.id, order: 1, title: "二", summary: "", location: "", timeOfDay: "", shotIds: ["shot-00000002"] },
    { id: "scene-00000001", version: 1, createdAt: episode.createdAt, updatedAt: episode.updatedAt, episodeId: episode.id, order: 0, title: "一", summary: "", location: "", timeOfDay: "", shotIds: ["shot-00000001"] },
  ];
  const shots = [
    { id: "shot-00000002", version: 1, createdAt: episode.createdAt, updatedAt: episode.updatedAt, episodeId: episode.id, sceneId: "scene-00000002", order: 0, title: "二", description: "", durationFrames: 30, visualPrompt: "", negativePrompt: "", referenceAssetIds: [], status: "draft" as const },
    { id: "shot-00000001", version: 1, createdAt: episode.createdAt, updatedAt: episode.updatedAt, episodeId: episode.id, sceneId: "scene-00000001", order: 0, title: "一", description: "", durationFrames: 48, visualPrompt: "", negativePrompt: "", referenceAssetIds: [], status: "draft" as const },
  ];
  const timeline = buildComicTimeline(episode.projectId, episode, scenes, shots, { frameRate: 24, width: 1920, height: 1080, now: episode.updatedAt });
  assert.deepEqual(timeline.clips.map(clip => [clip.shotId, clip.startFrame]), [["shot-00000001", 0], ["shot-00000002", 40]]);
});

test("script analysis keeps explicit episode boundaries without inventing scenes", () => {
  const analysis = analyzeComicScript("第 1 集：相遇\n甲：你好\n\n第 2 集：回声\n乙：再见", "2026-09-12T00:00:00.000Z");
  assert.deepEqual(analysis.episodes.map(episode => [episode.number, episode.title]), [[1, "相遇"], [2, "回声"]]);
  assert.deepEqual(analysis.characterNames, ["甲", "乙"]);
  assert.equal(analysis.episodes[0]?.sourceEndLine, 3);
  assert.deepEqual(analyzeComicScript("  ", "2026-09-12T00:00:00.000Z").episodes, []);
  assert.equal(analyzeComicScript("雨夜，少年走进车站。", "2026-09-12T00:00:00.000Z").episodes[0]?.summary, "雨夜，少年走进车站。");
});

test("script analysis records only explicit scene headings for later generation", () => {
  const analysis = analyzeComicScript([
    "第 1 集：相遇",
    "场景 1：车站 | 夜晚",
    "甲：你来了。",
    "场景 2：月台",
    "乙：我一直在等。",
  ].join("\n"), "2026-09-12T00:00:00.000Z");
  assert.deepEqual(analysis.scenePlans.map(scene => [scene.order, scene.title, scene.timeOfDay]), [
    [0, "车站 | 夜晚", "夜晚"],
    [1, "月台", ""],
  ]);
  assert.deepEqual(analysis.scenePlans[0]?.characterNames, ["甲"]);
  assert.deepEqual(analyzeComicScript("第 1 集\n甲：只有对白，没有场景标题", "2026-09-12T00:00:00.000Z").scenePlans, []);
});
