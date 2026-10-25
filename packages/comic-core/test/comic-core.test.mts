import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyComicCommand,
  createComicCharacterBundle,
  ComicCoreError,
  ComicProjectStore,
  COMIC_PROJECT_FILE,
  createComicProject,
  formatComicTimecode,
  parseComicProject,
  productionDocumentFromComicProject,
  serializeComicProject,
  summarizeComicProject,
  validateComicProject,
  validateComicCharacterBundle,
} from "../lib/index.js";

function deterministicIds() {
  let sequence = 0;
  return (prefix: "project" | "character" | "asset" | "scene" | "shot" | "dialogue") =>
    `${prefix}-${String(++sequence).padStart(8, "0")}`;
}

const now = "2026-08-26T00:00:00.000Z";

test("new storyboard has a versioned scene and frame-accurate starter shot", () => {
  const project = createComicProject({ title: "雾港来信", now, idFactory: deterministicIds() });
  assert.equal(project.schemaVersion, 2);
  assert.equal(project.revision, 0);
  assert.equal(project.scenes.length, 1);
  assert.equal(project.scenes[0].shots[0].durationFrames, 96);
  assert.deepEqual(summarizeComicProject(project), {
    sceneCount: 1,
    shotCount: 1,
    durationFrames: 96,
    durationSeconds: 4,
  });
  assert.equal(formatComicTimecode(96, 24), "00:00:04:00");
});

test("commands are immutable, revision guarded, and update only the addressed shot", () => {
  const ids = deterministicIds();
  const original = createComicProject({ now, idFactory: ids });
  const scene = original.scenes[0];
  const shot = scene.shots[0];
  const updated = applyComicCommand(original, {
    type: "shot.update",
    expectedRevision: 0,
    sceneId: scene.id,
    shotId: shot.id,
    patch: { title: "码头远景", durationFrames: 120, cameraMotion: "push_in" },
  }, { now: "2026-08-26T00:01:00.000Z", idFactory: ids });
  assert.equal(original.scenes[0].shots[0].title, "镜头 1");
  assert.equal(updated.revision, 1);
  assert.equal(updated.scenes[0].shots[0].title, "码头远景");
  assert.equal(updated.scenes[0].shots[0].cameraMotion, "push_in");
  assert.throws(
    () => applyComicCommand(updated, {
      type: "shot.delete",
      expectedRevision: 0,
      sceneId: scene.id,
      shotId: shot.id,
    }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "REVISION_CONFLICT",
  );
});

test("splitting a shot is atomic, preserves total duration, and re-bases dialogue", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "shot.update",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    patch: { durationFrames: 240 },
  }, { now, idFactory: ids });
  project = applyComicCommand(project, {
    type: "dialogue.replace",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    cues: [{ text: "你好，欢迎来到雾港。", startFrame: 48, durationFrames: 144 }],
  }, { now, idFactory: ids });
  const split = applyComicCommand(project, {
    type: "shot.split",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    splitAtFrame: 120,
  }, { now, idFactory: ids });
  const shots = split.scenes[0].shots;
  assert.equal(shots.length, 2);
  assert.notEqual(shots[0].id, shots[1].id);
  assert.equal(shots[0].durationFrames + shots[1].durationFrames, 240);
  assert.equal(shots[0].dialogueCues[0].startFrame, 48);
  assert.equal(shots[0].dialogueCues[0].durationFrames, 72);
  assert.equal(shots[1].dialogueCues[0].startFrame, 0);
  assert.equal(shots[1].dialogueCues[0].durationFrames, 72);
  assert.equal(shots[0].dialogueCues[0].text, "你好，欢迎来到雾港。");
  assert.equal(shots[1].dialogueCues[0].text, "你好，欢迎来到雾港。");
  assert.equal(shots[1].dialogueCues[0].continuationOfCueId, shots[0].dialogueCues[0].id);
  assert.equal(shots[1].mediaSourceStartFrames, undefined);
  assert.equal(split.revision, project.revision + 1);
});

test("shot timing controls are validated and survive serialization defaults", () => {
  const ids = deterministicIds();
  const project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  const updated = applyComicCommand(project, {
    type: "shot.update",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    patch: {
      durationFrames: 120,
      transitionIn: "fade",
      transitionOut: "dissolve",
      volume: 1.25,
      fadeInFrames: 12,
      fadeOutFrames: 24,
    },
  }, { now, idFactory: ids });
  const roundTrip = parseComicProject(serializeComicProject(updated)).project;
  const shot = roundTrip.scenes[0].shots[0];
  assert.equal(shot.transitionIn, "fade");
  assert.equal(shot.transitionOut, "dissolve");
  assert.equal(shot.volume, 1.25);
  assert.equal(shot.fadeInFrames, 12);
  assert.equal(shot.fadeOutFrames, 24);
  assert.throws(() => applyComicCommand(updated, {
    type: "shot.update",
    expectedRevision: updated.revision,
    sceneId,
    shotId,
    patch: { fadeInFrames: 100, fadeOutFrames: 30 },
  }), error => error instanceof ComicCoreError && error.code === "INVALID_PROJECT");
});

test("changing frame rate preserves wall-clock shot and dialogue timing", () => {
  const ids = deterministicIds();
  let project = createComicProject({ frameRate: 24, now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "dialogue.replace",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    cues: [{ text: "雾里有人吗？", startFrame: 24, durationFrames: 48 }],
  }, { now, idFactory: ids });
  project = applyComicCommand(project, {
    type: "project.update",
    expectedRevision: project.revision,
    patch: { frameRate: 30 },
  }, { now, idFactory: ids });
  const shot = project.scenes[0].shots[0];
  assert.equal(shot.durationFrames, 120);
  assert.equal(shot.dialogueCues[0].startFrame, 30);
  assert.equal(shot.dialogueCues[0].durationFrames, 60);
});

test("character deletion keeps dialogue text while removing the stale speaker reference", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  project = applyComicCommand(project, {
    type: "character.add",
    expectedRevision: project.revision,
    character: { name: "林澈", appearance: "黑色风衣" },
  }, { now, idFactory: ids });
  const characterId = project.characters[0].id;
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "dialogue.replace",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    cues: [{ speakerCharacterId: characterId, text: "谁在那里？" }],
  }, { now, idFactory: ids });
  project = applyComicCommand(project, {
    type: "character.delete",
    expectedRevision: project.revision,
    characterId,
  }, { now, idFactory: ids });
  assert.equal(project.characters.length, 0);
  assert.equal(project.scenes[0].shots[0].dialogueCues[0].text, "谁在那里？");
  assert.equal(project.scenes[0].shots[0].dialogueCues[0].speakerCharacterId, undefined);
});

test("shots move between scenes without duplication", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sourceSceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "scene.add",
    expectedRevision: project.revision,
    scene: { title: "仓库" },
  }, { now, idFactory: ids });
  const targetSceneId = project.scenes[1].id;
  project = applyComicCommand(project, {
    type: "shot.move",
    expectedRevision: project.revision,
    sceneId: sourceSceneId,
    shotId,
    targetSceneId,
  }, { now, idFactory: ids });
  assert.equal(project.scenes[0].shots.length, 0);
  assert.deepEqual(project.scenes[1].shots.map(shot => shot.id), [shotId]);
});

test("null placement moves a shot to the beginning of the same scene", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const firstShotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "shot.add",
    expectedRevision: project.revision,
    sceneId,
    shot: { title: "第二镜头" },
  }, { now, idFactory: ids });
  const secondShotId = project.scenes[0].shots[1].id;
  project = applyComicCommand(project, {
    type: "shot.move",
    expectedRevision: project.revision,
    sceneId,
    shotId: secondShotId,
    targetSceneId: sceneId,
    afterShotId: null,
  }, { now, idFactory: ids });
  assert.deepEqual(project.scenes[0].shots.map(shot => shot.id), [secondShotId, firstShotId]);
});

test("serialization normalizes data and rejects broken references or canvas ratios", () => {
  const project = createComicProject({ now, idFactory: deterministicIds() });
  const roundTrip = parseComicProject(serializeComicProject(project)).project;
  assert.deepEqual(roundTrip, project);
  assert.throws(
    () => validateComicProject({ ...project, canvas: { aspectRatio: "16:9", width: 1080, height: 1920 } }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "INVALID_CANVAS",
  );
  const bad = structuredClone(project) as any;
  bad.scenes[0].shots[0].visualAssetId = "asset-00000099";
  assert.throws(
    () => validateComicProject(bad),
    (error: unknown) => error instanceof ComicCoreError && error.code === "INVALID_REFERENCE",
  );
});

test("legacy second-based storyboard migrates to the current frame schema", () => {
  const migrated = parseComicProject(JSON.stringify({
    title: "旧分镜",
    frameRate: 25,
    scenes: [{
      title: "码头",
      shots: [{
        title: "雨夜远景",
        durationSeconds: 2.4,
        visualPrompt: "冷色港口",
        dialogue: "快走。",
      }],
    }],
  }), { now, idFactory: deterministicIds() });
  assert.equal(migrated.migratedFrom, 0);
  assert.equal(migrated.project.frameRate, 25);
  assert.equal(migrated.project.scenes[0].shots[0].durationFrames, 60);
  assert.equal(migrated.project.scenes[0].shots[0].dialogueCues[0].text, "快走。");
});

test("schema 1 projects migrate without inventing media references", () => {
  const current = createComicProject({ now, idFactory: deterministicIds() });
  const old = structuredClone(current) as any;
  old.schemaVersion = 1;
  const migrated = parseComicProject(old);
  assert.equal(migrated.migratedFrom, 1);
  assert.equal(migrated.project.schemaVersion, 2);
  assert.equal(migrated.project.scenes[0].shots[0].audioAssetId, undefined);
});

test("generated media is provenance-tracked and attached only to the matching slot", () => {
  const ids = deterministicIds();
  const original = createComicProject({ now, idFactory: ids });
  const sceneId = original.scenes[0].id;
  const shotId = original.scenes[0].shots[0].id;
  const attached = applyComicCommand(original, {
    type: "media.attach",
    expectedRevision: original.revision,
    sceneId,
    shotId,
    slot: "visual",
    asset: {
      id: "asset-00000099",
      kind: "image",
      uri: "nextmux.media/media-job-00000000-0000-4000-8000-000000000099.png",
      mimeType: "image/png",
      byteLength: 128,
      sha256: "a".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000099",
      prompt: "冷色雨夜码头",
      provider: "兼容 API",
      model: "image-model",
    },
  }, { now, idFactory: ids });
  assert.equal(attached.assets.length, 1);
  assert.equal(attached.assets[0].sha256, "a".repeat(64));
  assert.equal(attached.scenes[0].shots[0].visualAssetId, "asset-00000099");
  assert.equal(attached.scenes[0].shots[0].status, "generated");
  assert.throws(
    () => applyComicCommand(original, {
      type: "media.attach",
      expectedRevision: original.revision,
      sceneId,
      shotId,
      slot: "audio",
      asset: {
        id: "asset-00000100",
        kind: "image",
        uri: "nextmux.media/media-job-00000000-0000-4000-8000-000000000100.png",
        mimeType: "image/png",
        byteLength: 128,
        sha256: "b".repeat(64),
        jobId: "media-job-00000000-0000-4000-8000-000000000100",
        provider: "兼容 API",
        model: "image-model",
      },
    }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "ASSET_SLOT_MISMATCH",
  );
});

test("replacing a single-shot asset keeps the old version and links the new version", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  const attach = (id: string, hash: string) => {
    project = applyComicCommand(project, {
      type: "media.attach",
      expectedRevision: project.revision,
      sceneId,
      shotId,
      slot: "visual",
      asset: {
        id,
        kind: "image",
        uri: `nextmux.media/${id}.png`,
        mimeType: "image/png",
        byteLength: 128,
        sha256: hash.repeat(64),
        jobId: `media-job-00000000-0000-4000-8000-0000000000${id.slice(-2)}`,
        provider: "relay",
        model: "image-model",
      },
    }, { now, idFactory: ids });
  };
  attach("asset-00000110", "a");
  attach("asset-00000111", "b");
  assert.equal(project.assets.length, 2);
  assert.equal(project.assets[1]?.sourceAssetId, "asset-00000110");
  assert.equal(project.scenes[0].shots[0].visualAssetId, "asset-00000111");
});

test("media asset source is validated at the command boundary", () => {
  const ids = deterministicIds();
  const project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  assert.throws(
    () => applyComicCommand(project, {
      type: "media.attach", expectedRevision: project.revision, sceneId, shotId, slot: "visual",
      asset: {
        id: "asset-00000109", kind: "image", uri: "nextmux.media/invalid.png", mimeType: "image/png", byteLength: 1,
        sha256: "a".repeat(64), jobId: "media-job-00000000-0000-4000-8000-000000000109",
        provider: "relay", model: "image-model", source: "unexpected" as never,
      },
    }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "INVALID_ASSET_SOURCE",
  );
});

test("edited video stays pending until the user explicitly applies the new version", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  const video = (id: string, hash: string) => ({
    id,
    kind: "video" as const,
    uri: `nextmux.media/${id}.mp4`,
    mimeType: "video/mp4",
    byteLength: 256,
    sha256: hash.repeat(64),
    jobId: `media-job-00000000-0000-4000-8000-000000000${id.slice(-3)}`,
    provider: "relay",
    model: "video-model",
  });
  project = applyComicCommand(project, { type: "media.attach", expectedRevision: project.revision, sceneId, shotId, slot: "video", asset: video("asset-00000130", "a") });
  project = applyComicCommand(project, { type: "media.attach", expectedRevision: project.revision, sceneId, shotId, slot: "video", deferToPending: true, asset: video("asset-00000131", "b") });
  assert.equal(project.scenes[0].shots[0].videoAssetId, "asset-00000130");
  assert.equal(project.scenes[0].shots[0].pendingVideoAssetId, "asset-00000131");
  assert.equal(project.assets.find(asset => asset.id === "asset-00000131")?.sourceAssetId, "asset-00000130");
  project = applyComicCommand(project, { type: "shot.apply_pending_video", expectedRevision: project.revision, sceneId, shotId });
  assert.equal(project.scenes[0].shots[0].videoAssetId, "asset-00000131");
  assert.equal(project.scenes[0].shots[0].pendingVideoAssetId, undefined);
});

test("discarding an edited video clears the pending slot without deleting history", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "media.attach", expectedRevision: project.revision, sceneId, shotId, slot: "video", deferToPending: true,
    asset: {
      id: "asset-00000132", kind: "video", uri: "nextmux.media/asset-00000132.mp4", mimeType: "video/mp4", byteLength: 256,
      sha256: "c".repeat(64), jobId: "media-job-00000000-0000-4000-8000-000000000132", provider: "relay", model: "video-model"
    }
  });
  project = applyComicCommand(project, { type: "shot.discard_pending_video", expectedRevision: project.revision, sceneId, shotId });
  assert.equal(project.scenes[0].shots[0].videoAssetId, undefined);
  assert.equal(project.scenes[0].shots[0].pendingVideoAssetId, undefined);
  assert.equal(project.assets.some(asset => asset.id === "asset-00000132"), true);
});

test("character identity metadata validates image references and survives production projection", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "media.attach",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    slot: "visual",
    asset: {
      id: "asset-00000120",
      kind: "image",
      uri: "nextmux.media/character-reference.png",
      mimeType: "image/png",
      byteLength: 128,
      sha256: "c".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000120",
      provider: "relay",
      model: "image-model",
    },
  });
  project = applyComicCommand(project, {
    type: "character.add",
    expectedRevision: project.revision,
    character: {
      name: "林澈",
      appearance: "黑色风衣",
      identityVersion: "林澈-v1",
      referenceAssetIds: ["asset-00000120"],
      authorizationRef: "user-approved-character-1",
    },
  });
  const character = project.characters[0]!;
  assert.deepEqual(character.referenceAssetIds, ["asset-00000120"]);
  const production = productionDocumentFromComicProject(project);
  assert.equal(production.characters[0]?.identityVersion, "林澈-v1");
  assert.deepEqual(production.characters[0]?.referenceAssetIds, ["asset-00000120"]);
  assert.equal(production.characters[0]?.authorizationRef, "user-approved-character-1");
  assert.throws(
    () => applyComicCommand(project, {
      type: "character.update",
      expectedRevision: project.revision,
      characterId: character.id,
      patch: { referenceAssetIds: ["asset-00000121"] },
    }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "INVALID_REFERENCE",
  );
});

test("character bundles require explicit authorization and preserve source provenance", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "media.attach", expectedRevision: project.revision, sceneId, shotId, slot: "visual",
    asset: {
      id: "asset-00000140", kind: "image", uri: "nextmux.media/character-reference.png", mimeType: "image/png", byteLength: 128,
      sha256: "d".repeat(64), jobId: "media-job-00000000-0000-4000-8000-000000000140", provider: "relay", model: "image-model"
    }
  });
  project = applyComicCommand(project, {
    type: "character.add", expectedRevision: project.revision,
    character: { name: "林澈", appearance: "黑发、深色外套", referenceAssetIds: ["asset-00000140"] }
  });
  const character = project.characters[0];
  assert.throws(() => createComicCharacterBundle(project, character.id, "", { bundleId: "bundle-00000140", now }), /authorizationRef/);
  const bundle = createComicCharacterBundle(project, character.id, "user-approved-140", { bundleId: "bundle-00000140", now });
  assert.equal(bundle.sourceProjectId, project.id);
  assert.equal(bundle.sourceCharacterId, character.id);
  assert.equal(bundle.character.authorizationRef, "user-approved-140");
  assert.equal(bundle.referenceAssets[0]?.id, "asset-00000140");
  assert.equal(validateComicCharacterBundle(bundle).bundleId, "bundle-00000140");
});

test("music and effects attach as independent background tracks without replacing dialogue or video", () => {
  const ids = deterministicIds();
  let project = createComicProject({ now, idFactory: ids });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, {
    type: "media.attach",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    slot: "audio",
    asset: {
      id: "asset-00000101",
      kind: "audio",
      uri: "nextmux.media/dialogue.wav",
      mimeType: "audio/wav",
      byteLength: 128,
      sha256: "d".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000101",
      provider: "relay",
      model: "tts",
    },
  });
  project = applyComicCommand(project, {
    type: "media.attach",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    slot: "music",
    asset: {
      id: "asset-00000102",
      kind: "music",
      uri: "nextmux.media/music.mp3",
      mimeType: "audio/mpeg",
      byteLength: 256,
      sha256: "b".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000102",
      provider: "relay",
      model: "music-model",
    },
  });
  project = applyComicCommand(project, {
    type: "media.attach",
    expectedRevision: project.revision,
    sceneId,
    shotId,
    slot: "effect",
    asset: {
      id: "asset-00000103",
      kind: "effect",
      uri: "nextmux.media/door.wav",
      mimeType: "audio/wav",
      byteLength: 96,
      sha256: "c".repeat(64),
      jobId: "media-job-00000000-0000-4000-8000-000000000103",
      provider: "relay",
      model: "effect-model",
    },
  });
  const shot = project.scenes[0].shots[0];
  assert.equal(shot.audioAssetId, "asset-00000101");
  assert.deepEqual(shot.musicAssetIds, ["asset-00000102"]);
  assert.deepEqual(shot.effectAssetIds, ["asset-00000103"]);
  assert.deepEqual(project.assets.map(asset => asset.kind), ["audio", "music", "effect"]);
  const restored = parseComicProject(serializeComicProject(project)).project;
  assert.deepEqual(restored.scenes[0]?.shots[0]?.musicAssetIds, ["asset-00000102"]);
  assert.deepEqual(restored.scenes[0]?.shots[0]?.effectAssetIds, ["asset-00000103"]);
});

test("future schemas fail closed instead of being destructively rewritten", () => {
  assert.throws(
    () => parseComicProject({ schemaVersion: 99, title: "future" }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "UNSUPPORTED_SCHEMA",
  );
});

test("project store writes atomically, keeps recovery history outside the workspace, and detects stale edits", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-store-"));
  const workspace = join(root, "workspace");
  const history = join(root, "history");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ids = deterministicIds();
  const store = await ComicProjectStore.create({ workspaceRoot: workspace, historyRoot: history });
  const initial = await store.initialize({ title: "本地工程", now, idFactory: ids });
  assert.equal(initial.project?.revision, 0);
  assert.equal(JSON.parse(await readFile(join(workspace, COMIC_PROJECT_FILE), "utf8")).title, "本地工程");
  const sceneId = initial.project!.scenes[0].id;
  const shotId = initial.project!.scenes[0].shots[0].id;
  const changed = await store.apply({
    type: "shot.update",
    expectedRevision: 0,
    sceneId,
    shotId,
    patch: { title: "已保存镜头" },
  }, { now: "2026-08-26T00:02:00.000Z", idFactory: ids });
  assert.equal(changed.project?.revision, 1);
  assert.equal(changed.project?.scenes[0].shots[0].title, "已保存镜头");
  assert.equal((await readdir(history)).filter(name => name.endsWith(".json")).length, 1);
  await assert.rejects(
    store.apply({
      type: "shot.delete",
      expectedRevision: 0,
      sceneId,
      shotId,
    }),
    (error: unknown) => error instanceof ComicCoreError && error.code === "REVISION_CONFLICT",
  );
});

test("concurrent saves with one expected revision serialize and only one can win", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-race-"));
  const workspace = join(root, "workspace");
  const history = join(root, "history");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ids = deterministicIds();
  const storeA = await ComicProjectStore.create({ workspaceRoot: workspace, historyRoot: history });
  const storeB = await ComicProjectStore.create({ workspaceRoot: workspace, historyRoot: history });
  const initial = await storeA.initialize({ now, idFactory: ids });
  const sceneId = initial.project!.scenes[0].id;
  const results = await Promise.allSettled([
    storeA.apply({
      type: "scene.update",
      expectedRevision: 0,
      sceneId,
      patch: { title: "窗口 A" },
    }, { now, idFactory: ids }),
    storeB.apply({
      type: "scene.update",
      expectedRevision: 0,
      sceneId,
      patch: { title: "窗口 B" },
    }, { now, idFactory: ids }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(failure.reason instanceof ComicCoreError);
  assert.equal(failure.reason.code, "REVISION_CONFLICT");
  assert.equal((await storeA.read()).project?.revision, 1);
});

test("a live project-store lock is not stolen solely because its timestamp is old", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-live-lock-"));
  const workspace = join(root, "workspace"), history = join(root, "history");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProjectStore.create({ workspaceRoot: workspace, historyRoot: history });
  const initial = await store.initialize({ now, idFactory: deterministicIds() });
  const lockPath = join(history, "write.lock");
  const owner = await open(lockPath, "wx", 0o600);
  try {
    const old = new Date(Date.now() - 31_000);
    await utimes(lockPath, old, old);
    await assert.rejects(store.apply({ type: "scene.update", expectedRevision: initial.project!.revision,
      sceneId: initial.project!.scenes[0].id, patch: { title: "should not be written" } }));
    assert.equal((await store.read()).project?.revision, initial.project?.revision);
    assert.ok((await readdir(history)).includes("write.lock"), "the live owner's lock must remain");
  } finally {
    await owner.close();
  }
});

test("a corrupt project file is reported and never silently replaced", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-corrupt-"));
  const workspace = join(root, "workspace");
  const history = join(root, "history");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pathname = join(workspace, COMIC_PROJECT_FILE);
  await writeFile(pathname, "{not-json", "utf8");
  const store = await ComicProjectStore.create({ workspaceRoot: workspace, historyRoot: history });
  await assert.rejects(
    store.read(),
    (error: unknown) => error instanceof ComicCoreError && error.code === "INVALID_JSON",
  );
  assert.equal(await readFile(pathname, "utf8"), "{not-json");
});
