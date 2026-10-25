import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  compileComfyUiWorkflow,
  MediaCoreError,
  MediaJobStore,
  MediaRuntimeError,
  parseComfyUiWorkflowTemplate,
  probeComfyUi,
  queueComfyUiWorkflow,
  requestGeminiImage,
  requestComfyUiImage,
  requestOpenAICompatibleImage,
  requestOpenRouterImage,
  nearestAspectRatio,
  requestOpenAICompatibleSpeech,
  geminiSpeechVoice,
  relativeMediaUri,
  renderSrt,
  renderVtt,
  renderAss,
  chatMusicPrompt,
  requestChatAudioMusic,
} from "../lib/index.js";

const now = "2026-08-26T06:00:00.000Z";
const connectionId = "official-00000000-0000-4000-8000-000000000001";
const worker = "media-worker-00000001";

test("managed media paths remain valid", () => {
  assert.equal(relativeMediaUri("nextmux.media/output.png", "output"), "nextmux.media/output.png");
});

test("subtitle renderer emits SRT, WebVTT, and ASS without losing cue timing", () => {
  const cues = [{ text: "你好", startFrame: 24, durationFrames: 24, speakerName: "角色" }];
  assert.match(renderVtt(cues, 24), /WEBVTT/);
  assert.match(renderVtt(cues, 24), /00:00:01\.000 --> 00:00:02\.000/);
  assert.match(renderAss(cues, 24), /\[Events\]/);
  assert.match(renderAss(cues, 24), /Dialogue: 0,0:00:01\.00,0:00:02\.00/);
});

function imageRequest(idempotencyKey = "image-request-0001") {
  return {
    idempotencyKey,
    kind: "image" as const,
    projectId: "project-00000001",
    sceneId: "scene-00000001",
    shotId: "shot-00000001",
    input: {
      connectionId,
      model: "image-model",
      prompt: "雨夜码头",
      width: 1024,
      height: 1024,
    },
    cost: { billing: "provider_billed" as const, description: "供应商按实际调用计费" },
  };
}

function videoRequest(idempotencyKey = "video-request-0001") {
  return {
    idempotencyKey,
    kind: "video" as const,
    projectId: "project-00000001",
    sceneId: "scene-00000001",
    shotId: "shot-00000001",
    input: {
      connectionId,
      model: "video-model",
      prompt: "雨夜码头，镜头缓慢推进",
      durationSeconds: 8,
      width: 1920,
      height: 1080,
      referenceAssetUris: ["nextmux.media/characters/hero.png"],
      firstFrameUri: "nextmux.media/frames/first.png",
      requestAudio: true,
      requestSubtitles: false,
    },
    cost: { billing: "provider_billed" as const, description: "供应商按实际视频时长计费" },
  };
}

function musicRequest(idempotencyKey = "music-request-0001") {
  return {
    idempotencyKey,
    kind: "music" as const,
    projectId: "project-00000001",
    sceneId: "scene-00000001",
    shotId: "shot-00000001",
    input: {
      connectionId: "managed:auto:00000000-0000-4000-8000-000000000001",
      model: "music-model",
      prompt: "悬疑、低沉、逐渐增强的背景音乐",
      durationSeconds: 30,
      format: "mp3" as const,
    },
    cost: { billing: "platform_billed" as const, description: "平台托管线路计费" },
  };
}

function checkpoint() {
  return {
    assetId: "asset-00000001",
    assetKind: "image" as const,
    relativeUri: "nextmux.media/media-job-00000000-0000-4000-8000-000000000001.png",
    mimeType: "image/png",
    byteLength: 128,
    sha256: "a".repeat(64),
    provider: "兼容 API",
    model: "image-model",
    prompt: "雨夜码头",
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "nextmux-media-core-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: await MediaJobStore.create({ root }) };
}

test("provider-billed jobs require confirmation and idempotent enqueue returns one job", async t => {
  const { store } = await fixture(t);
  const options = {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  };
  const first = await store.enqueue(imageRequest(), options);
  const repeated = await store.enqueue(imageRequest(), options);
  assert.equal(first.id, repeated.id);
  assert.equal(first.status, "awaiting_confirmation");
  assert.equal((await store.list()).length, 1);
  const confirmed = await store.confirm(first.id, { now: "2026-08-26T06:01:00.000Z" });
  assert.equal(confirmed.status, "queued");
  assert.equal(confirmed.events.at(-1)?.type, "confirmed");
});

test("video jobs preserve generation settings and accept streamed large-file checkpoints", async t => {
  const { root, store } = await fixture(t);
  const created = await store.enqueue(videoRequest(), {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000009",
  });
  assert.equal(created.status, "awaiting_confirmation");
  assert.equal(created.kind, "video");
  assert.deepEqual(created.input, videoRequest().input);
  await store.confirm(created.id, { now });
  await store.claimNext(worker, { now });
  const largeCheckpoint = {
    assetId: "asset-00000009",
    assetKind: "video" as const,
    relativeUri: "nextmux.media/media-job-00000000-0000-4000-8000-000000000009.mp4",
    mimeType: "video/mp4",
    byteLength: 1024 * 1024 * 1024 * 1024,
    sha256: "b".repeat(64),
    provider: "兼容 API",
    model: "video-model",
    prompt: "雨夜码头，镜头缓慢推进",
    mediaEvidence: {
      nativeAudio: true,
      nativeSubtitles: false,
      subtitleCheck: "not_embedded" as const,
      checkedAt: "2026-08-26T06:02:00.000Z",
      checker: "ffmpeg" as const,
    },
  };
  const saved = await store.saveCheckpoint(created.id, worker, largeCheckpoint, { now });
  assert.equal(saved.checkpoint?.byteLength, largeCheckpoint.byteLength);
  const reopened = await MediaJobStore.create({ root });
  assert.deepEqual((await reopened.list())[0]?.checkpoint?.mediaEvidence, largeCheckpoint.mediaEvidence);
});

test("music jobs stay distinct from speech jobs and survive durable queue validation", async t => {
  const { store } = await fixture(t);
  const job = await store.enqueue(musicRequest(), {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000010",
  });
  assert.equal(job.kind, "music");
  assert.equal(job.status, "awaiting_confirmation");
  assert.equal((job.input as { prompt: string }).prompt, "悬疑、低沉、逐渐增强的背景音乐");
});

test("a song keeps its lyrics and the no-vocals choice; bad values are refused", async t => {
  const { store } = await fixture(t);
  const base = musicRequest("music-request-lyrics");
  const job = await store.enqueue({ ...base, input: { ...base.input, lyrics: "[Verse]\n海风吹过灯塔", instrumental: false } }, {
    now, idFactory: () => "media-job-00000000-0000-4000-8000-000000000011",
  });
  assert.equal((job.input as { lyrics?: string }).lyrics, "[Verse]\n海风吹过灯塔");
  assert.equal((job.input as { instrumental?: boolean }).instrumental, false);
  await assert.rejects(store.enqueue({ ...musicRequest("music-request-bad"), input: { ...base.input, instrumental: "yes" } } as never, { now }), /instrumental/);
  await assert.rejects(store.enqueue({ ...musicRequest("music-request-long"), input: { ...base.input, lyrics: "字".repeat(3_501) } } as never, { now }), /lyrics/);
});

test("own-API Lyria: chat completions with audio output, streamed base64 chunks joined into one track", async () => {
  let body: any;
  let headers: Headers | undefined;
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
  const halves = [mp3.slice(0, 7), mp3.slice(7)].map(part => Buffer.from(part).toString("base64"));
  const result = await requestChatAudioMusic({
    endpoint: new URL("https://openrouter.ai/api/v1/chat/completions"), apiKey: "key", model: "google/lyria-3-pro-preview",
    idempotencyKey: "music-own-0001", prompt: "Warm folk, slow", lyrics: "[Chorus]\n灯塔在等你", format: "mp3",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      const events = [
        { choices: [{ delta: { audio: { data: halves[0], transcript: "灯塔" } } }] },
        { choices: [{ delta: { audio: { data: halves[1], transcript: "在等你" } } }] },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(events, { headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.deepEqual(body.modalities, ["text", "audio"]);
  assert.deepEqual(body.audio, { format: "mp3" });
  assert.equal(body.stream, true);
  assert.match(body.messages[0].content, /Use exactly these lyrics[\s\S]*灯塔在等你/);
  assert.equal(headers?.get("authorization"), "Bearer key");
  assert.deepEqual([...result.bytes], [...mp3]);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.lyrics, "灯塔在等你");
  assert.equal(chatMusicPrompt({ prompt: "Piano", lyrics: "ignored", instrumental: true }), "Piano\n\nInstrumental only, no vocals.");
  await assert.rejects(requestChatAudioMusic({ endpoint: new URL("https://x.invalid/v1/chat/completions"), apiKey: "k", model: "m", idempotencyKey: "music-own-0002",
    prompt: "x", format: "mp3", fetchImpl: async () => Response.json({ choices: [{ message: { content: "sorry" } }] }) }), { code: "INVALID_AUDIO_RESPONSE", messageKey: "media.music_service_returned_no_audio" });
});

test("reusing an idempotency key with different input fails closed", async t => {
  const { store } = await fixture(t);
  await store.enqueue(imageRequest(), {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  await assert.rejects(
    store.enqueue({
      ...imageRequest(),
      input: { ...imageRequest().input, prompt: "不同画面" },
    }, { now }),
    (error: unknown) => error instanceof MediaCoreError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("claim, durable checkpoint, and completion preserve provenance", async t => {
  const { root, store } = await fixture(t);
  const created = await store.enqueue({
    ...imageRequest(),
    cost: { billing: "free", description: "测试适配器不计费" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  assert.equal(created.status, "queued");
  const claimed = await store.claimNext(worker, { now: "2026-08-26T06:01:00.000Z" });
  assert.equal(claimed?.status, "running");
  assert.equal(claimed?.attempt, 1);
  const saved = await store.saveCheckpoint(created.id, worker, checkpoint(), {
    now: "2026-08-26T06:02:00.000Z",
  });
  assert.equal(saved.checkpoint?.sha256, "a".repeat(64));
  const complete = await store.complete(created.id, worker, { now: "2026-08-26T06:03:00.000Z" });
  assert.equal(complete.status, "succeeded");
  assert.deepEqual(complete.output, checkpoint());
  assert.equal(JSON.parse(await readFile(join(root, "media-jobs-v1.json"), "utf8")).revision, 4);
});

test("queued cancellation is immediate and running cancellation is cooperative", async t => {
  const { store } = await fixture(t);
  const first = await store.enqueue({
    ...imageRequest("cancel-queued-01"),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  assert.equal((await store.cancel(first.id, { now })).status, "cancelled");
  const second = await store.enqueue({
    ...imageRequest("cancel-running-01"),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000002",
  });
  await store.claimNext(worker, { now });
  const requested = await store.cancel(second.id, { now: "2026-08-26T06:01:00.000Z" });
  assert.equal(requested.status, "running");
  assert.ok(requested.cancelRequestedAt);
  const cancelled = await store.fail(second.id, worker, {
    code: "CANCELLED",
    message: "已取消",
    retryable: false,
  }, { now: "2026-08-26T06:02:00.000Z" });
  assert.equal(cancelled.status, "cancelled");
});

test("queued media jobs can pause and resume durably; running jobs cannot be faked as paused", async t => {
  const { root, store } = await fixture(t);
  const queued = await store.enqueue({
    ...imageRequest("pause-queued-01"),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000011",
  });
  const paused = await store.pause(queued.id, { now: "2026-08-26T06:01:00.000Z" });
  assert.equal(paused.status, "paused");
  assert.equal(paused.events.at(-1)?.type, "paused");
  assert.equal(await store.claimNext(worker, { now: "2026-08-26T06:01:01.000Z" }), undefined);

  const reopened = await MediaJobStore.create({ root });
  assert.equal((await reopened.get(queued.id)).status, "paused");
  assert.deepEqual(await reopened.recoverInterrupted({ now: "2026-08-26T06:01:30.000Z" }), []);
  assert.equal((await reopened.get(queued.id)).status, "paused");
  const resumed = await reopened.resume(queued.id, { now: "2026-08-26T06:02:00.000Z" });
  assert.equal(resumed.status, "queued");
  assert.equal(resumed.events.at(-1)?.type, "resumed");
  const claimed = await reopened.claimNext(worker, { now: "2026-08-26T06:02:01.000Z" });
  assert.equal(claimed?.status, "running");
  await assert.rejects(
    reopened.pause(queued.id, { now: "2026-08-26T06:02:02.000Z" }),
    (error: unknown) => error instanceof MediaCoreError
      && error.code === "JOB_NOT_PAUSABLE"
      && error.messageKey === "media.a_job_submitted_to_the_provider_cannot_be_paused_cancel_it_or_wait_for_completion",
  );

  const pausedAgain = await reopened.enqueue({
    ...imageRequest("pause-cancel-01"),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000012",
  });
  await reopened.pause(pausedAgain.id, { now: "2026-08-26T06:03:00.000Z" });
  assert.equal((await reopened.cancel(pausedAgain.id, { now: "2026-08-26T06:03:01.000Z" })).status, "cancelled");
});

test("checkpointed output cannot be cancelled while project linking is in progress", async t => {
  const { store } = await fixture(t);
  const created = await store.enqueue({
    ...imageRequest("checkpoint-cancel-01"),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  await store.claimNext(worker, { now });
  await store.saveCheckpoint(created.id, worker, checkpoint(), { now });
  await assert.rejects(
    store.cancel(created.id, { now: "2026-08-26T06:02:00.000Z" }),
    (error: unknown) => error instanceof MediaCoreError && error.code === "JOB_NOT_CANCELLABLE",
  );
  assert.equal((await store.complete(created.id, worker, { now })).status, "succeeded");
});

test("restart recovery never repeats an uncheckpointed paid request automatically", async t => {
  const { store } = await fixture(t);
  const raw = await store.enqueue(imageRequest(), {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  await store.confirm(raw.id, { now });
  await store.claimNext(worker, { now });
  await store.releaseWorker(worker, { now: "2026-08-26T06:04:00.000Z" });
  const recovered = await store.recoverInterrupted({ now: "2026-08-26T06:05:00.000Z" });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "interrupted");
  assert.equal(recovered[0].failure?.messageKey, "media.recovery_provider_outcome_unknown");
  assert.equal(await store.claimNext(worker, { now: "2026-08-26T06:06:00.000Z" }), undefined);
  await assert.rejects(
    store.retry(raw.id, { now: "2026-08-26T06:07:00.000Z" }),
    (error: unknown) => error instanceof MediaCoreError && error.code === "JOB_NOT_RETRYABLE",
  );
});

test("a task the provider accepted before a restart is waited for again, not paid for twice", async t => {
  const { store } = await fixture(t);
  const raw = await store.enqueue(imageRequest(), {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000009",
  });
  await store.confirm(raw.id, { now });
  await store.claimNext(worker, { now });
  const noted = await store.saveRemoteTask(raw.id, worker, { taskId: "video_abc", pollUrl: "https://api.example.com/detail?id=video_abc", submittedAt: now }, { now });
  assert.equal(noted.remoteTask?.taskId, "video_abc");
  assert.equal(noted.events.at(-1)?.type, "submitted");
  await store.releaseWorker(worker, { now: "2026-08-26T06:04:00.000Z" });
  const [recovered] = await store.recoverInterrupted({ now: "2026-08-26T06:05:00.000Z" });
  assert.equal(recovered.status, "queued");
  assert.equal(recovered.failure, undefined);
  assert.equal(recovered.events.at(-1)?.note, "resume_remote_task");
  const again = await store.claimNext(worker, { now: "2026-08-26T06:06:00.000Z" });
  assert.equal(again?.id, raw.id, "the same attempt continues: it can be claimed again");
  assert.equal(again?.remoteTask?.taskId, "video_abc");
  await assert.rejects(
    store.saveRemoteTask(raw.id, worker, { taskId: "x", pollUrl: "http://insecure.example.com", submittedAt: now }, { now }),
    (error: unknown) => error instanceof MediaCoreError && error.code === "INVALID_MEDIA_STATE",
  );
});

test("retryable failures preserve provider retry-after hints for automatic backoff", async t => {
  const { store } = await fixture(t);
  const raw = await store.enqueue({
    ...imageRequest(),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  await store.claimNext(worker, { now });
  const failed = await store.fail(raw.id, worker, {
    code: "RATE_LIMITED",
    message: "上游暂时限流",
    retryable: true,
    retryAfterMs: 2_500,
  }, { now: "2026-08-26T06:08:00.000Z" });
  assert.equal(failed.failure?.retryAfterMs, 2_500);
  assert.equal((await store.retry(raw.id, { now: "2026-08-26T06:08:01.000Z" })).status, "queued");
  assert.equal((await store.get(raw.id)).events.at(-1)?.type, "retried");
});

test("checkpointed jobs resume linking without repeating the provider request", async t => {
  const { store } = await fixture(t);
  const raw = await store.enqueue({
    ...imageRequest(),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  await store.claimNext(worker, { now });
  await store.saveCheckpoint(raw.id, worker, checkpoint(), { now });
  await store.releaseWorker(worker, { now: "2026-08-26T06:04:00.000Z" });
  const [recovered] = await store.recoverInterrupted({ now: "2026-08-26T06:05:00.000Z" });
  assert.equal(recovered.status, "queued");
  const resumed = await store.claimNext("media-worker-00000002", { now: "2026-08-26T06:06:00.000Z" });
  assert.equal(resumed?.checkpoint?.relativeUri, checkpoint().relativeUri);
  // Attaching the checkpoint reuses the attempt that produced it (audit 36-11).
  assert.equal(resumed?.attempt, 1);
});

test("concurrent workers can claim a queued job only once", async t => {
  const { root, store } = await fixture(t);
  await store.enqueue({
    ...imageRequest(),
    cost: { billing: "free", description: "本地" },
  }, {
    now,
    idFactory: () => "media-job-00000000-0000-4000-8000-000000000001",
  });
  const other = await MediaJobStore.create({ root });
  const results = await Promise.all([
    store.claimNext("media-worker-00000001", { now }),
    other.claimNext("media-worker-00000002", { now }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await store.get("media-job-00000000-0000-4000-8000-000000000001")).attempt, 1);
});

test("a media queue writer cannot steal a live lock solely because its timestamp is old", async t => {
  const { root, store } = await fixture(t);
  const lockPath = join(root, "media-jobs.lock");
  const owner = await open(lockPath, "wx", 0o600);
  t.after(() => owner.close());
  await owner.writeFile("writer still active", "utf8");
  await owner.sync();
  const old = new Date(Date.now() - 31_000);
  await utimes(lockPath, old, old);
  await assert.rejects(
    store.enqueue({ ...imageRequest("live-lock-request"), cost: { billing: "free", description: "本地" } }, { now }),
    (error: unknown) => error instanceof MediaCoreError && error.code === "MEDIA_QUEUE_BUSY" && error.messageKey.startsWith("media.a_legacy_media_queue_lock_is_active_or_remains"),
  );
  assert.equal(await readFile(lockPath, "utf8"), "writer still active");
});

test("SRT output is frame-accurate and never shows the speaker name", () => {
  const srt = renderSrt([
    { text: "谁在那里？", speakerName: "林澈", startFrame: 25, durationFrames: 50 },
    { text: "别回头。", startFrame: 80, durationFrames: 20 },
  ], 25);
  assert.equal(srt, [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "谁在那里？",
    "",
    "2",
    "00:00:03,200 --> 00:00:04,000",
    "别回头。",
    "",
  ].join("\n"));
});

test("corrupt media state is reported and never rewritten", async t => {
  const { root, store } = await fixture(t);
  const path = join(root, "media-jobs-v1.json");
  await writeFile(path, "{broken", "utf8");
  await assert.rejects(
    store.read(),
    (error: unknown) => error instanceof MediaCoreError && error.code === "MEDIA_STORE_CORRUPT",
  );
  assert.equal(await readFile(path, "utf8"), "{broken");
});

test("compatible image transport requests base64, sends idempotency, and validates the file signature", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  let captured: any;
  const result = await requestOpenAICompatibleImage({
    endpoint: new URL("https://api.example.test/v1/images/generations"),
    apiKey: "secret-key",
    model: "image-model",
    idempotencyKey: "image-transport-0001",
    prompt: "雨夜码头",
    negativePrompt: "文字水印",
    width: 1920,
    height: 1080,
    fetchImpl: async (_input, init) => {
      captured = { body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(captured.body.size, "1536x1024");
  assert.match(captured.body.prompt, /Avoid: 文字水印/);
  assert.equal(captured.headers.get("authorization"), "Bearer secret-key");
  assert.equal(captured.headers.get("idempotency-key"), "image-transport-0001");
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.bytes, png);
});

test("direct media transports preserve HTTP Retry-After metadata on 429", async () => {
  await assert.rejects(
    requestOpenAICompatibleImage({
      endpoint: new URL("https://media.example.test/v1/images"),
      apiKey: "test-key",
      model: "image-model",
      idempotencyKey: "image-rate-limit-0001",
      prompt: "雨夜码头",
      width: 1024,
      height: 1024,
      fetchImpl: async () => new Response("", { status: 429, headers: { "retry-after": "7" } }),
    }),
    (error: unknown) => error instanceof MediaRuntimeError
      && error.code === "RATE_LIMITED"
      && error.retryAfterMs === 7_000,
  );
});

test("image transport rejects URL-only output instead of following an untrusted address", async () => {
  await assert.rejects(
    requestOpenAICompatibleImage({
      endpoint: new URL("https://api.example.test/v1/images/generations"),
      apiKey: "secret-key",
      model: "image-model",
      idempotencyKey: "image-url-only-0001",
      prompt: "码头",
      width: 1024,
      height: 1024,
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ url: "http://127.0.0.1/private" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error: unknown) => error instanceof MediaRuntimeError && error.code === "URL_IMAGE_UNSUPPORTED",
  );
});

test("Gemini image transport uses native authentication and validates inline image data", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
  let captured: any;
  const result = await requestGeminiImage({
    endpoint: new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-image:generateContent"),
    apiKey: "google-key",
    model: "gemini-image",
    idempotencyKey: "gemini-image-0001",
    prompt: "雨夜码头",
    width: 1920,
    height: 1080,
    fetchImpl: async (_input, init) => {
      captured = { body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "完成" }, { inlineData: { mimeType: "image/png", data: Buffer.from(png).toString("base64") } }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(captured.headers.get("x-goog-api-key"), "google-key");
  assert.equal(captured.headers.get("authorization"), null);
  assert.deepEqual(captured.body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(captured.body.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.bytes, png);
});

test("compatible speech transport accepts real WAV bytes and hides upstream response bodies", async () => {
  const wav = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4,
  ]);
  const result = await requestOpenAICompatibleSpeech({
    endpoint: new URL("https://api.example.test/v1/audio/speech"),
    apiKey: "secret-key",
    model: "speech-model",
    idempotencyKey: "speech-transport-0001",
    text: "别回头。",
    voice: "alloy",
    format: "wav",
    fetchImpl: async () => new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } }),
  });
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.extension, "wav");
  await assert.rejects(
    requestOpenAICompatibleSpeech({
      endpoint: new URL("https://api.example.test/v1/audio/speech"),
      apiKey: "secret-key",
      model: "speech-model",
      idempotencyKey: "speech-auth-0001",
      text: "测试",
      voice: "alloy",
      format: "mp3",
      fetchImpl: async () => new Response("secret upstream details", { status: 401 }),
    }),
    (error: unknown) => error instanceof MediaRuntimeError
      && error.code === "AUTH_FAILED"
      && !error.message.includes("secret upstream details"),
  );
});

test("Gemini TTS answers in raw PCM: it is requested as pcm and saved as a playable WAV (round 31 live run)", async () => {
  const pcm = new Uint8Array(4_800).fill(1);
  const formats: string[] = [];
  const gemini = await requestOpenAICompatibleSpeech({
    endpoint: new URL("https://openrouter.ai/api/v1/audio/speech"), apiKey: "secret-key", model: "google/gemini-3.8-flash-tts",
    idempotencyKey: "speech-gemini-pcm-0001", text: "雪夜里的一封信。", voice: "alloy", format: "mp3",
    fetchImpl: async (_input, init) => { const body = JSON.parse(String(init?.body)); formats.push(body.response_format); assert.equal(body.voice, "Kore"); return new Response(pcm, { status: 200, headers: { "content-type": "audio/pcm;rate=24000" } }); },
  });
  assert.deepEqual(formats, ["pcm"]);
  assert.equal(geminiSpeechVoice("alloy"), "Kore");
  assert.equal(geminiSpeechVoice("puck"), "Puck");
  assert.equal(geminiSpeechVoice("unknown-voice"), "Kore");
  assert.equal(gemini.mimeType, "audio/wav");
  assert.equal(String.fromCharCode(...gemini.bytes.slice(0, 4)), "RIFF");
  assert.equal(new DataView(gemini.bytes.buffer).getUint32(24, true), 24_000);
  assert.equal(gemini.bytes.length, 44 + pcm.length);
  // An unknown model's refusal must not silently cause a second paid request.
  const asked: string[] = [];
  await assert.rejects(requestOpenAICompatibleSpeech({
    endpoint: new URL("https://api.example.test/v1/audio/speech"), apiKey: "secret-key", model: "vendor/speech-x",
    idempotencyKey: "speech-pcm-retry-0001", text: "测试", voice: "alloy", format: "mp3",
    fetchImpl: async (_input, init) => {
      const format = JSON.parse(String(init?.body)).response_format; asked.push(format);
      return format === "pcm" ? new Response(pcm, { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'This model only supports response_format="pcm". Got "mp3".' } }), { status: 400 });
    },
  }), { code: "REQUEST_REJECTED" });
  assert.deepEqual(asked, ["mp3"]);
});

const comfyWorkflow = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: 7,
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    },
  },
  "5": {
    class_type: "EmptyLatentImage",
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "old positive" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "old negative" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "NextMux", images: ["8", 0] } },
};

test("ComfyUI workflow compiler binds the standard graph without mutating the template", () => {
  const template = parseComfyUiWorkflowTemplate({
    schemaVersion: 1,
    name: "Storyboard image",
    workflow: comfyWorkflow,
  });
  const compiled = compileComfyUiWorkflow(template, {
    prompt: "雨夜码头",
    negativePrompt: "文字水印",
    width: 1920,
    height: 1080,
    seed: 1234,
  });
  assert.equal(compiled.workflow["6"].inputs.text, "雨夜码头");
  assert.equal(compiled.workflow["7"].inputs.text, "文字水印");
  assert.equal(compiled.workflow["5"].inputs.width, 1920);
  assert.equal(compiled.workflow["5"].inputs.height, 1080);
  assert.equal(compiled.workflow["3"].inputs.seed, 1234);
  assert.equal(compiled.outputNodeId, "9");
  assert.equal(comfyWorkflow["6"].inputs.text, "old positive");
});

test("ComfyUI workflow compiler supports explicit placeholders for custom nodes", () => {
  const template = parseComfyUiWorkflowTemplate({
    schemaVersion: 1,
    name: "Custom graph",
    outputNodeId: "output",
    workflow: {
      prompt: { class_type: "CustomPrompt", inputs: { value: "$NEXTMUX_PROMPT" } },
      canvas: { class_type: "CustomCanvas", inputs: { w: "$NEXTMUX_WIDTH", h: "$NEXTMUX_HEIGHT" } },
      output: { class_type: "PreviewImage", inputs: { images: ["canvas", 0] } },
    },
  });
  const compiled = compileComfyUiWorkflow(template, {
    prompt: "角色立绘",
    width: 1024,
    height: 1536,
    seed: 42,
  });
  assert.equal(compiled.workflow.prompt.inputs.value, "角色立绘");
  assert.equal(compiled.workflow.canvas.inputs.w, 1024);
  assert.equal(compiled.workflow.canvas.inputs.h, 1536);
  assert.equal(compiled.outputNodeId, "output");
});

test("ComfyUI probe reads system and node capabilities without exposing response bodies", async () => {
  const calls: string[] = [];
  const result = await probeComfyUi({
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/system_stats")) {
        return new Response(JSON.stringify({
          system: { comfyui_version: "0.4.0" },
          devices: [{ name: "Test GPU" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ KSampler: {}, SaveImage: {} }), { status: 200 });
    },
  });
  assert.deepEqual(calls, [
    "http://127.0.0.1:8188/system_stats",
    "http://127.0.0.1:8188/object_info",
  ]);
  assert.equal(result.version, "0.4.0");
  assert.equal(result.deviceName, "Test GPU");
  assert.equal(result.nodeCount, 2);
});

test("ComfyUI image execution queues, polls, and downloads a validated image", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);
  const calls: { url: string; method: string; body?: any }[] = [];
  let historyReads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url.endsWith("/prompt")) {
      return new Response(JSON.stringify({ prompt_id: "prompt-0001", number: 1, node_errors: {} }), { status: 200 });
    }
    if (url.endsWith("/history/prompt-0001")) {
      historyReads += 1;
      if (historyReads === 1) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({
        "prompt-0001": {
          status: { completed: true, status_str: "success" },
          outputs: {
            "9": { images: [{ filename: "shot.png", subfolder: "nextmux", type: "output" }] },
          },
        },
      }), { status: 200 });
    }
    if (url.includes("/view?")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const phases: string[] = [];
  const result = await requestComfyUiImage({
    baseUrl: "http://127.0.0.1:8188",
    template: parseComfyUiWorkflowTemplate({ schemaVersion: 1, name: "Storyboard", workflow: comfyWorkflow }),
    prompt: "雨夜码头",
    negativePrompt: "文字水印",
    width: 1024,
    height: 1024,
    seed: 99,
    clientId: "nextmux-client",
    pollIntervalMs: 1,
    fetchImpl,
    onProgress: event => phases.push(event.phase),
  });
  assert.equal(calls[0].url, "http://127.0.0.1:8188/prompt");
  assert.equal(calls[0].body.client_id, "nextmux-client");
  assert.equal(calls[0].body.prompt["6"].inputs.text, "雨夜码头");
  assert.equal(result.promptId, "prompt-0001");
  assert.equal(result.outputNodeId, "9");
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(result.bytes, png);
  assert.deepEqual(phases, ["queueing", "queued", "executing", "downloading", "completed"]);
});

test("ComfyUI cancellation interrupts the active workflow", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const queued = await queueComfyUiWorkflow({
    baseUrl: "http://127.0.0.1:8188",
    workflow: comfyWorkflow,
    clientId: "nextmux-client",
    fetchImpl: async input => {
      calls.push(String(input));
      return new Response(JSON.stringify({ prompt_id: "prompt-cancel", node_errors: {} }), { status: 200 });
    },
  });
  controller.abort();
  await assert.rejects(
    requestComfyUiImage({
      baseUrl: "http://127.0.0.1:8188",
      template: parseComfyUiWorkflowTemplate({ schemaVersion: 1, name: "Storyboard", workflow: comfyWorkflow }),
      prompt: "雨夜码头",
      width: 1024,
      height: 1024,
      signal: controller.signal,
      resumePromptId: queued.promptId,
      pollIntervalMs: 1,
      fetchImpl: async (input, init) => {
        calls.push(String(input));
        if (String(input).endsWith("/interrupt") && init?.method === "POST") return new Response("{}", { status: 200 });
        return new Response("{}", { status: 200 });
      },
    }),
    (error: unknown) => error instanceof MediaRuntimeError && error.code === "CANCELLED",
  );
  assert.ok(calls.includes("http://127.0.0.1:8188/interrupt"));
});

test("OpenRouter image router gets an aspect ratio, not a pixel size, and base64 comes back as a checked image", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  let captured: any;
  const result = await requestOpenRouterImage({
    endpoint: new URL("https://openrouter.ai/api/v1/images"),
    apiKey: "sk-or-secret", model: "bytedance-seed/seedream-5-0-pro", idempotencyKey: "openrouter-image-0001",
    prompt: "雨夜码头", width: 1080, height: 1920,
    fetchImpl: async (input, init) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return Response.json({ created: 1, data: [{ b64_json: Buffer.from(png).toString("base64"), media_type: "image/png" }] });
    },
  });
  assert.equal(captured.url, "https://openrouter.ai/api/v1/images");
  assert.deepEqual(Object.keys(captured.body).sort(), ["aspect_ratio", "model", "prompt"]);
  assert.equal(captured.body.aspect_ratio, "9:16");
  assert.equal(result.mimeType, "image/png");
  assert.equal(nearestAspectRatio(1920, 1080), "16:9");
  assert.equal(nearestAspectRatio(1440, 1080), "4:3");
  assert.equal(nearestAspectRatio(1000, 1000), "1:1");
});

test('recorded managed capacity wait survives released local ownership and reopens the same key without a new attempt budget', async t => {
  const {store}=await fixture(t);
  const original=imageRequest('waiting-image-original-key');original.input.connectionId='managed:fixed:11111111-1111-4111-8111-111111111111';
  const created=await store.enqueue(original,{now});await store.confirm(created.id,{now});const running=await store.claimNext(worker,{now});assert(running);
  await store.setCapacityWaiting(created.id,worker,true,{now});await store.setCapacityWaiting(created.id,worker,false,{now});
  await store.releaseWorker(worker,{now});const [restored]=await store.recoverInterrupted({now});assert.equal(restored.status,'queued');assert.equal(restored.capacityWaitRecorded,true);assert.equal(restored.waitingCapacity,undefined);assert.equal(restored.idempotencyKey,'waiting-image-original-key');assert.equal(restored.attempt,0);
});
