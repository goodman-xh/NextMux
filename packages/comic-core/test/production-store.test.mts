import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ComicProductionStore, applyComicCommand, createComicProject, preserveComicProductionVersions, productionDocumentFromComicProject } from "../lib/index.js";

function document(revision = 0) {
  const now = "2026-09-12T00:00:00.000Z";
  return {
    schemaVersion: 1 as const,
    id: "production-00000001",
    projectId: "project-00000001",
    revision,
    title: "测试漫剧",
    episodes: [], scenes: [], shots: [], characters: [], assets: [],
    audioTracks: [], subtitleTracks: [], timelines: [], renderJobs: [], providerProfiles: [],
    createdAt: now,
    updatedAt: now,
  };
}

test("production sidecar is atomic, revision guarded, and restart-readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-production-"));
  try {
    const store = await ComicProductionStore.create({ workspaceRoot: root });
    assert.equal((await store.read()).exists, false);
    const saved = await store.write(document());
    assert.equal(saved.document?.revision, 0);
    assert.equal((await store.read()).document?.title, "测试漫剧");
    await assert.rejects(
      () => store.write(document(1), 1),
      error => error instanceof Error && "code" in error && error.code === "REVISION_CONFLICT",
    );
    const next = await store.write({ ...document(1), updatedAt: "2026-09-12T00:00:01.000Z" }, 0);
    assert.equal(next.document?.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an active production sidecar writer past the stale threshold keeps its lock", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-production-live-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstStore = await ComicProductionStore.create({ workspaceRoot: root });
  const secondStore = await ComicProductionStore.create({ workspaceRoot: root });
  await firstStore.write(document());
  const originalRead = firstStore.read.bind(firstStore);
  let entered!: () => void;
  const holding = new Promise<void>(resolve => { entered = resolve; });
  firstStore.read = async () => {
    entered();
    await new Promise(resolve => setTimeout(resolve, 35_000));
    return originalRead();
  };
  const first = firstStore.write(document(1), 0);
  await holding;
  await new Promise(resolve => setTimeout(resolve, 31_100));
  const second = secondStore.write(document(2), 1);
  let race: string;
  try {
    race = await Promise.race([
      second.then(() => "second-writer-entered"),
      new Promise<string>(resolve => setTimeout(() => resolve("lock-held"), 800)),
    ]);
  } finally {
    await Promise.allSettled([first, second]);
  }
  assert.equal(race, "lock-held", "a live writer must not lose its lock after 30 seconds");
  assert.equal((await originalRead()).document?.revision, 2);
});

test("storyboard projection persists a selectable episode and frame-accurate timeline", () => {
  const project = createComicProject({ title: "连续剧", starter: "storyboard" });
  const production = productionDocumentFromComicProject(project);
  assert.equal(production.episodes.length, 1);
  assert.equal(production.timelines.length, 1);
  assert.equal(production.episodes[0].timelineId, production.timelines[0].id);
  assert.equal(production.timelines[0].clips.length, project.scenes[0].shots.length);
  assert.equal(production.timelines[0].clips[0]?.startFrame, 0);
});

test("split shots share time-based media and project the source in-point", () => {
  let project = createComicProject({ title: "可裁剪成片" });
  const sceneId = project.scenes[0]!.id;
  const shotId = project.scenes[0]!.shots[0]!.id;
  project = applyComicCommand(project, {
    type: "shot.update",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    patch: { durationFrames: 240 },
  });
  project = applyComicCommand(project, {
    type: "media.attach",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    slot: "video",
    asset: {
      id: "asset-00000001",
      kind: "video",
      uri: "nextmux.media/source.mp4",
      mimeType: "video/mp4",
      byteLength: 10,
      sha256: "a".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000001",
      provider: "relay",
      model: "video-model",
    },
  });
  project = applyComicCommand(project, {
    type: "shot.split",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    splitAtFrame: 120,
  });
  const right = project.scenes[0]!.shots[1]!;
  assert.equal(right.videoAssetId, "asset-00000001");
  assert.equal(right.mediaSourceStartFrames?.["asset-00000001"], 120);
  const production = productionDocumentFromComicProject(project);
  const rightClip = production.timelines[0]!.clips.find(clip => clip.shotId === right.id);
  assert.equal(rightClip?.sourceStartFrame, 120);
});

test("production projection keeps dialogue, music, and effects on separate tracks", () => {
  const now = "2026-09-12T00:00:00.000Z";
  let project = createComicProject({ title: "带音轨的漫剧", now, idFactory: (() => {
    let sequence = 0;
    return (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue") => `${prefix}-${String(++sequence).padStart(8, "0")}`;
  })() });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  for (const [slot, id, kind] of [
    ["audio", "asset-00000101", "audio"],
    ["music", "asset-00000102", "music"],
    ["effect", "asset-00000103", "effect"],
  ] as const) {
    project = applyComicCommand(project, {
      type: "media.attach",
      expectedRevision: project.revision,
      sceneId,
      shotId,
      slot,
      asset: {
        id,
        kind,
        uri: `nextmux.media/${id}.wav`,
        mimeType: "audio/wav",
        byteLength: 10,
        sha256: (id.endsWith("101") ? "a" : id.endsWith("102") ? "b" : "c").repeat(64),
        jobId: `media-job-00000000-0000-4000-8000-${String(id).slice(-3).padStart(12, "0")}`,
        provider: "relay",
        model: `${kind}-model`,
      },
    }, { now });
  }
  const production = productionDocumentFromComicProject(project);
  assert.equal(production.audioTracks.length, 3);
  assert.deepEqual(production.audioTracks.map(track => track.kind), ["dialogue", "music", "effect"]);
  assert.equal(production.timelines[0]?.audioTrackIds.length, 3);
});

test("production projection keeps the user script and analysis alongside storyboard data", () => {
  const project = createComicProject({ title: "带剧本的漫剧", starter: "empty" });
  const production = productionDocumentFromComicProject(project, {
    script: {
      text: "第 1 集：开场\n甲：开始",
      language: "zh-CN",
      version: 1,
      updatedAt: project.updatedAt,
      source: "user",
    },
    scriptAnalysis: {
      version: 1,
      status: "ready",
      episodes: [{ number: 1, title: "开场", summary: "", sourceStartLine: 1, sourceEndLine: 2 }],
      scenePlans: [{ episodeNumber: 1, order: 0, title: "车站", summary: "", location: "车站", timeOfDay: "夜晚", characterNames: ["甲"], sourceStartLine: 2, sourceEndLine: 3 }],
      characterNames: ["甲"],
      updatedAt: project.updatedAt,
    },
  });
  assert.equal(production.script?.text, "第 1 集：开场\n甲：开始");
  assert.deepEqual(production.scriptAnalysis?.characterNames, ["甲"]);
  assert.equal(production.scriptAnalysis?.scenePlans[0]?.location, "车站");
});

test("production projection preserves unchanged entity versions and increments only changed entities", () => {
  const project = createComicProject({ title: "版本测试" });
  const first = productionDocumentFromComicProject(project);
  const changedProject = applyComicCommand(project, {
    type: "shot.update",
    expectedRevision: project.revision,
    sceneId: project.scenes[0].id,
    shotId: project.scenes[0].shots[0].id,
    patch: { description: "只修改当前镜头" },
  });
  const second = preserveComicProductionVersions(productionDocumentFromComicProject(changedProject), first);
  assert.equal(second.episodes[0]?.version, first.episodes[0]?.version);
  assert.equal(second.scenes[0]?.version, first.scenes[0]?.version);
  assert.equal(second.shots[0]?.version, (first.shots[0]?.version || 0) + 1);
  assert.equal(second.shots[0]?.description, "只修改当前镜头");
});

test("script episode plans become selectable production episodes", () => {
  const project = createComicProject({ title: "多集漫剧", starter: "empty" });
  const production = productionDocumentFromComicProject(project, {
    script: { text: "第 1 集\n第 2 集", language: "zh-CN", version: 1, updatedAt: project.updatedAt, source: "user" },
    scriptAnalysis: {
      version: 1,
      status: "ready",
      episodes: [
        { number: 1, title: "开场", summary: "", sourceStartLine: 1, sourceEndLine: 1 },
        { number: 2, title: "转折", summary: "", sourceStartLine: 2, sourceEndLine: 2 },
      ],
      scenePlans: [],
      characterNames: [],
      updatedAt: project.updatedAt,
    },
  });
  assert.deepEqual(production.episodes.map(episode => episode.title), ["开场", "转折"]);
  assert.equal(production.episodes[1]?.sceneIds.length, 0);
});

test("scene episode ownership projects scenes and shots into the matching episode", () => {
  let project = createComicProject({ title: "分集归属", starter: "empty" });
  project = applyComicCommand(project, {
    type: "scene.add",
    expectedRevision: project.revision,
    scene: { episodeNumber: 2, title: "第二集场景" },
  });
  const sceneId = project.scenes[0]!.id;
  project = applyComicCommand(project, {
    type: "shot.add",
    expectedRevision: project.revision,
    sceneId,
    shot: { title: "第二集镜头", visualPrompt: "" },
  });
  const production = productionDocumentFromComicProject(project, {
    scriptAnalysis: {
      version: 1,
      status: "ready",
      episodes: [
        { number: 1, title: "第一集", summary: "", sourceStartLine: 1, sourceEndLine: 1 },
        { number: 2, title: "第二集", summary: "", sourceStartLine: 2, sourceEndLine: 2 },
      ],
      scenePlans: [],
      characterNames: [],
      updatedAt: project.updatedAt,
    },
  });
  assert.deepEqual(production.episodes.map(episode => episode.sceneIds.length), [0, 1]);
  assert.equal(production.scenes[0]?.episodeId, production.episodes[1]?.id);
  assert.equal(production.shots[0]?.episodeId, production.episodes[1]?.id);
});

test("multi-episode audio and subtitle tracks stay attached to their episode timeline", () => {
  let project = createComicProject({ title: "多集音轨归属", starter: "empty" });
  project = applyComicCommand(project, {
    type: "scene.add",
    expectedRevision: project.revision,
    scene: { episodeNumber: 1, title: "第一集场景" },
  });
  project = applyComicCommand(project, {
    type: "scene.add",
    expectedRevision: project.revision,
    scene: { episodeNumber: 2, title: "第二集场景" },
  });
  const firstScene = project.scenes[0]!;
  const secondScene = project.scenes[1]!;
  project = applyComicCommand(project, {
    type: "shot.add",
    expectedRevision: project.revision,
    sceneId: firstScene.id,
    shot: { title: "第一集镜头", visualPrompt: "第一集画面" },
    cues: [{ text: "第一集对白", startFrame: 0, durationFrames: 24 }],
  });
  project = applyComicCommand(project, {
    type: "shot.add",
    expectedRevision: project.revision,
    sceneId: secondScene.id,
    shot: { title: "第二集镜头", visualPrompt: "第二集画面" },
    cues: [{ text: "第二集对白", startFrame: 0, durationFrames: 24 }],
  });
  const firstShot = project.scenes[0]!.shots[0]!;
  const secondShot = project.scenes[1]!.shots[0]!;
  for (const [sceneId, shotId, slot, suffix] of [
    [firstScene.id, firstShot.id, "audio", "1"],
    [secondScene.id, secondShot.id, "audio", "2"],
  ] as const) {
    project = applyComicCommand(project, {
      type: "media.attach",
      expectedRevision: project.revision,
      sceneId,
      shotId,
      slot,
      asset: {
        id: `asset-0000000${suffix}`,
        kind: "audio",
        uri: `nextmux.media/audio-${suffix}.wav`,
        mimeType: "audio/wav",
        byteLength: 10,
        sha256: suffix.repeat(64),
        jobId: `media-job-00000000-0000-4000-8000-00000000000${suffix}`,
        provider: "relay",
        model: "tts-model",
      },
    });
  }
  const production = productionDocumentFromComicProject(project, {
    scriptAnalysis: {
      version: 1,
      status: "ready",
      episodes: [
        { number: 1, title: "第一集", summary: "", sourceStartLine: 1, sourceEndLine: 1 },
        { number: 2, title: "第二集", summary: "", sourceStartLine: 2, sourceEndLine: 2 },
      ],
      scenePlans: [],
      characterNames: [],
      updatedAt: project.updatedAt,
    },
  });
  assert.deepEqual(production.audioTracks.map(track => track.episodeId), [
    production.episodes[0]!.id,
    production.episodes[1]!.id,
  ]);
  assert.deepEqual(production.timelines.map(timeline => timeline.audioTrackIds.length), [1, 1]);
  assert.deepEqual(production.subtitleTracks.map(track => track.episodeId), [
    production.episodes[0]!.id,
    production.episodes[1]!.id,
  ]);
  assert.deepEqual(production.timelines.map(timeline => timeline.subtitleTrackIds.length), [1, 1]);
});

test("desk episodes become the production episodes, each with its own scenes (so each exports on its own)", async () => {
  const { applyComicScripts, applyComicAdaptation, parseComicScripts, parseComicAdaptation } = await import("../lib/index.js");
  let n = 0;
  const idFactory = (prefix: string) => `${prefix}-${String(++n).padStart(8, "0")}-aaaa-bbbb-cccc-000000000000`;
  const now = "2026-09-27T10:00:00.000Z";
  let project = applyComicScripts(createComicProject({ title: "灯塔来信", now, idFactory }), parseComicScripts({ episodes: [
    { number: 1, title: "来信", script: "电台 · 夜\n苏念：你好。" }, { number: 2, title: "八音盒", script: "灯塔 · 夜\n顾星河：给你。" },
  ] }), { now, idFactory });
  const shot = (title: string) => ({ title, durationSeconds: 6, characters: [], action: title, visualPrompt: title, dialogue: [] });
  for (const number of [1, 2]) {
    project = applyComicAdaptation(project, parseComicAdaptation({ episodes: [{ number, title: `第${number}集`, scenes: [{ title: "场", location: "灯塔", timeOfDay: "夜", shots: [shot(`镜头${number}`)] }] }] }), { mode: "episode", now, idFactory }).project;
  }
  // The older text analysis saw a single episode.
  const document = productionDocumentFromComicProject(project, { scriptAnalysis: { episodes: [{ number: 1, title: "全文", summary: "", sourceStartLine: 1, sourceEndLine: 9 }] } as never });
  assert.deepEqual(document.episodes.map(item => [item.number, item.title]), [[1, "来信"], [2, "八音盒"]]);
  const scenesOf = (number: number) => project.scenes.filter(scene => scene.episodeNumber === number).map(scene => scene.id);
  assert.deepEqual(document.episodes[0]!.sceneIds, scenesOf(1));
  assert.deepEqual(document.episodes[1]!.sceneIds, scenesOf(2));
});
