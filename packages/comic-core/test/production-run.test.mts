import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { MediaJobStore } from "../../media-core/lib/index.js";
import { applyComicCommand, COMIC_PRODUCTION_RUN_FILE, ComicProductionRunCoordinator, ComicProductionRunStore, createComicProject } from "../lib/index.js";

const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const uuid = () => `official-${randomUUID()}`;

function wavTone(): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    bytes.writeInt16LE(Math.round(8_000 * Math.sin(2 * Math.PI * 330 * index / sampleRate)), 44 + index * 2);
  }
  return bytes;
}

test("approved comic production run queues image and speech once across enqueue crash and restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "nextmux.media"), { recursive: true });
  const queue = await MediaJobStore.create({ root: join(root, "queue") });
  let project = createComicProject({ title: "合成剧本", starter: "empty", frameRate: 24,
    canvas: { aspectRatio: "16:9", width: 320, height: 180 } });
  let analysisApplications = 0;
  let enqueues = 0;
  let confirmations = 0;
  let failAfterFirstEnqueue = true;
  const approval = {
    approvalId: "approval-local-test-001", approvedAt: new Date().toISOString(), maxEstimatedCostMicros: 3_000_000,
    routes: [
      { kind: "image" as const, connectionId: uuid(), model: "fake-image", billing: "provider_billed" as const,
        estimatedCostMicros: 1_000_000, description: "隔离假供应商画面" },
      { kind: "speech" as const, connectionId: uuid(), model: "fake-speech", billing: "provider_billed" as const,
        estimatedCostMicros: 1_000_000, description: "隔离假供应商配音", voice: "alloy" },
    ],
  };
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: analysisApplications > 0 }; },
    async applyAnalysis(expectedRevision: number) {
      assert.equal(expectedRevision, project.revision);
      analysisApplications += 1;
      project = applyComicCommand(project, { type: "character.add", expectedRevision: project.revision,
        character: { name: "甲" } });
      project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision,
        scene: { title: "车站", episodeNumber: 1 } });
      project = applyComicCommand(project, { type: "shot.add", expectedRevision: project.revision,
        sceneId: project.scenes[0].id, shot: { title: "相遇", visualPrompt: "车站相遇", durationFrames: 24 },
        cues: [{ text: "你好。", speakerCharacterId: project.characters[0].id, startFrame: 0, durationFrames: 24 }] });
      return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true };
    },
    async authorize(value: typeof approval, tasks: readonly { estimatedCostMicros: number }[]) {
      assert.equal(value.approvalId, approval.approvalId);
      assert.ok(tasks.reduce((sum, item) => sum + item.estimatedCostMicros, 0) <= value.maxEstimatedCostMicros);
    },
    async enqueueMediaJob(request: Parameters<MediaJobStore["enqueue"]>[0]) {
      enqueues += 1;
      const job = await queue.enqueue(request);
      if (failAfterFirstEnqueue) {
        failAfterFirstEnqueue = false;
        throw new Error("injected crash after durable enqueue before run link");
      }
      return job;
    },
    async confirmMediaJob(id: string, value: typeof approval) {
      assert.equal(value.approvalId, approval.approvalId);
      confirmations += 1;
      return queue.confirm(id);
    },
    async getMediaJob(id: string) { return queue.get(id); },
  };
  const store = await ComicProductionRunStore.create(join(root, "run-state"));
  const request = { requestKey: "desktop-run-test-001", workspaceId: "workspace-local-test", projectId: project.id,
    scriptVersion: 1, authorization: approval };
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).start(request), /injected crash/);
  const interrupted = (await store.read()).runs[0];
  assert.equal(interrupted.status, "needs_attention");
  assert.equal(interrupted.lastError, "Comic media production needs attention");
  assert.equal(interrupted.lastErrorInfo?.messageKey, "comic.production_waiting");
  assert.equal(interrupted.lastErrorInfo?.domain, "comic");
  assert.match(interrupted.lastErrorInfo?.detail ?? "", /injected crash/);
  assert.equal(interrupted.tasks.length, 2);
  assert.equal(interrupted.tasks[0].jobId, undefined);
  assert.equal((await queue.read()).jobs.length, 1, "first paid job was durably queued but not yet linked");

  const restartedStore = await ComicProductionRunStore.create(join(root, "run-state"));
  const resumed = await new ComicProductionRunCoordinator(restartedStore, ports).advance(interrupted.id);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.lastErrorInfo, undefined, "a successful resume clears stale diagnostic metadata");
  assert.equal(resumed.tasks.length, 2);
  assert.deepEqual(resumed.tasks.map(task => task.request.kind), ["image", "speech"]);
  assert.equal((await queue.read()).jobs.length, 2, "replayed idempotency key must not duplicate the first job");
  assert.equal(analysisApplications, 1, "analysis is not applied twice on restart");
  assert.equal(confirmations, 2, "each paid job is released only under the approved plan");
  assert.equal(enqueues, 3, "one enqueue call was safely replayed after the injected crash");
  assert.deepEqual((await queue.read()).jobs.map(job => job.status).sort(), ["queued", "queued"]);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const wav = wavTone();
  for (let index = 0; index < resumed.tasks.length; index += 1) {
    const workerId = `media-worker-${randomUUID()}`;
    const job = await queue.claimNext(workerId);
    assert.ok(job);
    const task = resumed.tasks.find(candidate => candidate.jobId === job.id);
    assert.ok(task);
    const bytes = task.request.kind === "image" ? png : wav;
    const uri = `nextmux.media/${task.request.kind}.${task.request.kind === "image" ? "png" : "wav"}`;
    await writeFile(join(workspace, uri), bytes);
    const checkpoint = { assetId: `asset-${randomUUID()}`, assetKind: task.request.kind === "image" ? "image" as const : "audio" as const,
      relativeUri: uri, mimeType: task.request.kind === "image" ? "image/png" : "audio/wav", byteLength: bytes.length,
      sha256: digest(bytes), provider: "isolated fake provider", model: task.request.kind === "image" ? "fake-image" : "fake-speech" };
    await queue.saveCheckpoint(job.id, workerId, checkpoint);
    project = applyComicCommand(project, { type: "media.attach", expectedRevision: project.revision,
      sceneId: task.request.sceneId, shotId: task.request.shotId, slot: task.request.kind === "image" ? "visual" : "audio",
      asset: { id: checkpoint.assetId, kind: checkpoint.assetKind, uri, mimeType: checkpoint.mimeType,
        byteLength: checkpoint.byteLength, sha256: checkpoint.sha256, jobId: job.id, provider: checkpoint.provider,
        model: checkpoint.model } });
    await queue.complete(job.id, workerId);
  }
  assert.ok((await readFile(join(workspace, "nextmux.media/speech.wav"))).equals(wav));
  const finished = await new ComicProductionRunCoordinator(restartedStore, ports).advance(interrupted.id);
  assert.equal(finished.status, "media_ready");
  assert.equal(finished.tasks.every(task => task.status === "succeeded"), true);
  assert.equal((await queue.read()).jobs.length, 2);
  assert.equal((await new ComicProductionRunCoordinator(restartedStore, ports).start(request)).id, finished.id);
  await assert.rejects(restartedStore.start({ ...request, projectId: "project-other" }), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_RUN_IDEMPOTENCY_CONFLICT");

  project = applyComicCommand(project, { type: "media.detach", expectedRevision: project.revision,
    sceneId: resumed.tasks[0].request.sceneId, shotId: resumed.tasks[0].request.shotId, slot: "visual" });
  const staleAdvance = await new ComicProductionRunCoordinator(restartedStore, ports).advance(finished.id)
    .then(result => result.status, error => error.code);
  const staleRestart = await new ComicProductionRunCoordinator(restartedStore, ports).start(request)
    .then(result => result.status, error => error.code);
  assert.deepEqual([staleAdvance, staleRestart], ["PRODUCTION_MEDIA_MISSING", "PRODUCTION_MEDIA_MISSING"],
    "both a manual resume and idempotent restart must inspect the current storyboard");
  await assert.rejects(new ComicProductionRunCoordinator(restartedStore, ports).advance(finished.id), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_MEDIA_MISSING");
  assert.equal((await restartedStore.get(finished.id)).status, "needs_attention");
  assert.equal((await queue.read()).jobs.length, 2, "asset removal must not resubmit an already accepted paid job");
});

test("production run with insufficient budget does not enqueue or confirm paid media", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let project = createComicProject({ title: "预算门槛", starter: "storyboard" });
  project = applyComicCommand(project, { type: "dialogue.replace", expectedRevision: project.revision,
    sceneId: project.scenes[0].id, shotId: project.scenes[0].shots[0].id,
    cues: [{ text: "预算前不调用", startFrame: 0, durationFrames: 24 }] });
  let providerCalls = 0;
  const routes = [
    { kind: "image" as const, connectionId: uuid(), model: "fake-image", billing: "provider_billed" as const,
      estimatedCostMicros: 2_000_000, description: "fake image" },
    { kind: "speech" as const, connectionId: uuid(), model: "fake-speech", billing: "provider_billed" as const,
      estimatedCostMicros: 2_000_000, description: "fake speech" },
  ];
  const store = await ComicProductionRunStore.create(join(root, "state"));
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async applyAnalysis() { assert.fail("storyboard already exists"); return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async authorize() { providerCalls += 1; },
    async enqueueMediaJob() { providerCalls += 1; throw Error("must not enqueue"); },
    async confirmMediaJob() { providerCalls += 1; throw Error("must not confirm"); },
    async getMediaJob() { providerCalls += 1; throw Error("must not probe"); },
  };
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).start({ requestKey: "budget-test-run", workspaceId: "workspace-test",
    projectId: project.id, scriptVersion: 1,
    authorization: { approvalId: "approval-too-small", approvedAt: new Date().toISOString(),
      maxEstimatedCostMicros: 3_000_000, routes } }), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_BUDGET_EXCEEDED");
  assert.equal(providerCalls, 0);
  assert.equal((await store.read()).runs[0].status, "needs_attention");
});

test("a run with pre-existing media loses ready status when its only asset is detached", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-existing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  let project = createComicProject({ title: "已有素材", starter: "storyboard" });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  project = applyComicCommand(project, { type: "media.attach", expectedRevision: project.revision,
    sceneId, shotId, slot: "visual", asset: { id: `asset-${randomUUID()}`, kind: "image",
      uri: "nextmux.media/already.png", mimeType: "image/png", byteLength: png.length, sha256: digest(png),
      jobId: `media-job-${randomUUID()}`, provider: "isolated local import", model: "fixture" } });
  let queueCalls = 0;
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async applyAnalysis() { assert.fail("storyboard already exists"); return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async authorize() {},
    async enqueueMediaJob() { queueCalls += 1; throw Error("existing media should not queue"); },
    async confirmMediaJob() { queueCalls += 1; throw Error("existing media should not confirm"); },
    async getMediaJob() { queueCalls += 1; throw Error("existing media should not probe"); },
  };
  const coordinator = new ComicProductionRunCoordinator(store, ports);
  const request = { requestKey: "existing-asset", workspaceId: "existing-workspace", projectId: project.id,
    scriptVersion: 1, authorization: { approvalId: "existing-approval", approvedAt: new Date().toISOString(),
      maxEstimatedCostMicros: 0, routes: [] } };
  const ready = await coordinator.start(request);
  assert.equal(ready.status, "media_ready");
  assert.equal(ready.tasks.length, 0);
  project = applyComicCommand(project, { type: "media.detach", expectedRevision: project.revision,
    sceneId, shotId, slot: "visual" });
  await assert.rejects(coordinator.advance(ready.id), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_MEDIA_MISSING");
  assert.equal((await store.get(ready.id)).status, "needs_attention");
  assert.equal(queueCalls, 0);
});

test("an edit after planning cannot enqueue a stale paid image prompt", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let project = createComicProject({ title: "可编辑分镜", starter: "storyboard" });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, { type: "shot.update", expectedRevision: project.revision,
    sceneId, shotId, patch: { visualPrompt: "旧画面描述" } });
  let enqueueCalls = 0;
  const store = await ComicProductionRunStore.create(join(root, "state"));
  const approval = { approvalId: "approval-stale-test", approvedAt: new Date().toISOString(),
    maxEstimatedCostMicros: 1_000_000, routes: [{ kind: "image" as const, connectionId: uuid(),
      model: "fake-image", billing: "provider_billed" as const,
      estimatedCostMicros: 1_000_000, description: "isolated quote" }] };
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async applyAnalysis() { assert.fail("storyboard already exists"); return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async authorize() {
      if (project.scenes[0].shots[0].visualPrompt === "旧画面描述") {
        project = applyComicCommand(project, { type: "shot.update", expectedRevision: project.revision,
          sceneId, shotId, patch: { visualPrompt: "用户新画面描述" } });
      }
    },
    async enqueueMediaJob() { enqueueCalls += 1; throw Error("stale paid request was sent"); },
    async confirmMediaJob() { assert.fail("must not confirm"); throw Error("unexpected confirm"); },
    async getMediaJob() { assert.fail("must not probe"); throw Error("unexpected probe"); },
  };
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).start({ requestKey: "stale-prompt-test",
    workspaceId: "workspace-stale", projectId: project.id, scriptVersion: 1, authorization: approval }), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_SOURCE_CHANGED");
  assert.equal(enqueueCalls, 0);
});

test("an edited shot cannot release an already queued paid request after restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-confirm-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let project = createComicProject({ title: "确认前再次核对", starter: "storyboard" });
  const sceneId = project.scenes[0].id;
  const shotId = project.scenes[0].shots[0].id;
  project = applyComicCommand(project, { type: "shot.update", expectedRevision: project.revision,
    sceneId, shotId, patch: { visualPrompt: "旧画面" } });
  const store = await ComicProductionRunStore.create(join(root, "state"));
  let failFirstProbe = true;
  let confirmations = 0;
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async applyAnalysis() { assert.fail("analysis already applied"); return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async authorize() {},
    async enqueueMediaJob() { return { id: "fake-job-awaiting-confirmation", status: "awaiting_confirmation" as const }; },
    async getMediaJob(id: string) {
      if (failFirstProbe) { failFirstProbe = false; throw Error("injected restart before paid confirmation"); }
      return { id, status: "awaiting_confirmation" as const };
    },
    async confirmMediaJob(id: string) { confirmations += 1; return { id, status: "queued" as const }; },
  };
  const authorization = { approvalId: "approval-current-source", approvedAt: new Date().toISOString(),
    maxEstimatedCostMicros: 1_000_000, routes: [{ kind: "image" as const, connectionId: uuid(),
      model: "fake-image", billing: "provider_billed" as const, estimatedCostMicros: 1_000_000,
      description: "isolated paid route" }] };
  const request = { requestKey: "confirm-current-source", workspaceId: "workspace-confirm-source",
    projectId: project.id, scriptVersion: 1, authorization };
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).start(request), /injected restart/);
  const run = (await store.read()).runs[0];
  assert.equal(run.tasks[0].jobId, "fake-job-awaiting-confirmation");
  project = applyComicCommand(project, { type: "shot.update", expectedRevision: project.revision,
    sceneId, shotId, patch: { visualPrompt: "用户更新的画面" } });
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).advance(run.id), error =>
    error instanceof Error && "code" in error && error.code === "PRODUCTION_SOURCE_CHANGED");
  assert.equal(confirmations, 0, "outdated paid input must stay unconfirmed");
});

test("an active writer past the old stale threshold keeps exclusive ownership", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storeA = await ComicProductionRunStore.create(root);
  const storeB = await ComicProductionRunStore.create(root);
  const authorization = { approvalId: "approval-lock-test", approvedAt: new Date().toISOString(),
    maxEstimatedCostMicros: 0, routes: [] };
  const request = { requestKey: "lock-test-original", workspaceId: "workspace-lock", projectId: "project-lock",
    scriptVersion: 1, authorization };
  const run = await storeA.start(request);
  let entered!: () => void;
  const holding = new Promise<void>(resolve => { entered = resolve; });
  const first = storeA.update(run.id, async current => {
    entered();
    await delay(35_000);
    return { ...current, status: "running" };
  });
  await holding;
  await delay(31_100);
  const second = storeB.start({ ...request, requestKey: "lock-test-second" });
  let raced: string;
  try {
    raced = await Promise.race([second.then(() => "second-writer-entered"), delay(800).then(() => "lock-held")]);
  } finally {
    await Promise.allSettled([first, second]);
  }
  assert.equal(raced, "lock-held", "the second writer must not unlink the live first writer's lock");
  const state = await storeA.read();
  assert.equal(state.runs.length, 2);
  assert.equal(state.runs.find(candidate => candidate.id === run.id)?.status, "running");
});

test("concurrent starts of one run apply analysis once and preserve one media plan", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storeA = await ComicProductionRunStore.create(root);
  const storeB = await ComicProductionRunStore.create(root);
  let project = createComicProject({ title: "并发启动", starter: "empty" });
  let applications = 0;
  let enqueues = 0;
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: applications > 0 }; },
    async applyAnalysis(expectedRevision: number) {
      await delay(100);
      assert.equal(expectedRevision, project.revision, "analysis uses optimistic project revision");
      applications += 1;
      project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision,
        scene: { title: "雨夜", episodeNumber: 1 } });
      project = applyComicCommand(project, { type: "shot.add", expectedRevision: project.revision,
        sceneId: project.scenes[0].id, shot: { title: "等待", visualPrompt: "雨夜车站", durationFrames: 24 } });
      return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true };
    },
    async authorize() {},
    async enqueueMediaJob() { enqueues += 1; return { id: "fake-job-concurrent", status: "queued" as const }; },
    async confirmMediaJob() { assert.fail("free confirmation not expected"); return { id: "unexpected", status: "queued" as const }; },
    async getMediaJob() { return { id: "fake-job-concurrent", status: "queued" as const }; },
  };
  const authorization = { approvalId: "approval-concurrent", approvedAt: new Date().toISOString(),
    maxEstimatedCostMicros: 0, routes: [{ kind: "image" as const, connectionId: "comfyui:local",
      model: "fake-local-image", billing: "free" as const, estimatedCostMicros: 0, description: "isolated" }] };
  const request = { requestKey: "same-start-key", workspaceId: "same-workspace", projectId: project.id,
    scriptVersion: 1, authorization };
  const [first, second] = await Promise.all([
    new ComicProductionRunCoordinator(storeA, ports).start(request),
    new ComicProductionRunCoordinator(storeB, ports).start(request),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(applications, 1);
  assert.equal(enqueues, 1);
  assert.equal((await storeA.read()).runs.length, 1);
});

test("production run state rejects corrupt JSON and final-component symlink without replacing it", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  const pathname = join(root, COMIC_PRODUCTION_RUN_FILE);
  await writeFile(pathname, "{broken-json", "utf8");
  await assert.rejects(store.read(), error => error instanceof Error && "code" in error && error.code === "PRODUCTION_RUN_CORRUPT");
  await assert.rejects(store.start({ requestKey: "cannot-overwrite-corrupt", workspaceId: "w", projectId: "p",
    scriptVersion: 1, authorization: { approvalId: "a", approvedAt: new Date().toISOString(), maxEstimatedCostMicros: 0, routes: [] } }));
  assert.equal(await readFile(pathname, "utf8"), "{broken-json");
  await unlink(pathname);
  const outside = join(root, "outside.json");
  await writeFile(outside, JSON.stringify({ schemaVersion: 1, revision: 0, runs: [] }));
  await symlink(outside, pathname);
  await assert.rejects(store.read(), error => error instanceof Error && "code" in error && error.code === "PRODUCTION_RUN_CORRUPT");
  assert.equal((await readFile(outside, "utf8")).includes("schemaVersion"), true);
});

test("production run store rejects a replaced root directory", async t => {
  const parent = await mkdtemp(join(tmpdir(), "nextmux-comic-run-root-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "trusted");
  const store = await ComicProductionRunStore.create(root);
  await rename(root, join(parent, "moved"));
  await mkdir(root);
  await assert.rejects(store.read(), error => error instanceof Error && "code" in error && error.code === "PRODUCTION_RUN_ROOT_CHANGED");
});

test("production authorization rejects billing routes the host cannot execute", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  const base = { workspaceId: "workspace-route", projectId: "project-route", scriptVersion: 1 };
  for (const [index, route] of [
    { kind: "speech" as const, connectionId: "comfyui:local", model: "fake", billing: "free" as const,
      estimatedCostMicros: 0, description: "not a speech route" },
    { kind: "image" as const, connectionId: uuid(), model: "fake", billing: "free" as const,
      estimatedCostMicros: 0, description: "official is paid" },
    { kind: "image" as const, connectionId: `managed:auto:${randomUUID()}`, model: "fake", billing: "provider_billed" as const,
      estimatedCostMicros: 1, description: "managed is platform billed" },
  ].entries()) {
    await assert.rejects(store.start({ ...base, requestKey: `invalid-route-${index}`,
      authorization: { approvalId: `approval-route-${index}`, approvedAt: new Date().toISOString(),
        maxEstimatedCostMicros: 1, routes: [route] } }), error =>
      error instanceof Error && "code" in error && error.code === "INVALID_PRODUCTION_AUTHORIZATION");
  }
  assert.equal((await store.read()).runs.length, 0);
});

test("a failed media job leaves the run needing attention while other approved jobs advance", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  let project = createComicProject({ title: "失败边界", starter: "storyboard" });
  project = applyComicCommand(project, { type: "dialogue.replace", expectedRevision: project.revision,
    sceneId: project.scenes[0].id, shotId: project.scenes[0].shots[0].id,
    cues: [{ text: "仍可单独配音", startFrame: 0, durationFrames: 24 }] });
  const enqueued: string[] = [];
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async applyAnalysis() { assert.fail("storyboard already exists"); return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
    async authorize() {},
    async enqueueMediaJob(request: { kind: string }) {
      enqueued.push(request.kind);
      return { id: `fake-${request.kind}`, status: "queued" as const };
    },
    async confirmMediaJob() { assert.fail("fake queue does not await confirmation"); return { id: "unexpected", status: "queued" as const }; },
    async getMediaJob(id: string) { return { id, status: id === "fake-image" ? "failed" as const : "queued" as const }; },
  };
  const result = await new ComicProductionRunCoordinator(store, ports).start({
    requestKey: "failed-image-run", workspaceId: "workspace-failure", projectId: project.id, scriptVersion: 1,
    authorization: { approvalId: "approval-failure", approvedAt: new Date().toISOString(),
      maxEstimatedCostMicros: 1, routes: [
        { kind: "image", connectionId: "comfyui:local", model: "fake-local-image", billing: "free",
          estimatedCostMicros: 0, description: "isolated local" },
        { kind: "speech", connectionId: uuid(), model: "fake-speech", billing: "provider_billed",
          estimatedCostMicros: 1, description: "isolated provider" },
      ] },
  });
  assert.deepEqual(enqueued, ["image", "speech"]);
  assert.deepEqual(result.tasks.map(task => task.status), ["failed", "queued"]);
  assert.equal(result.status, "needs_attention");
});

test("a partial applied analysis is reconciled before planning or queuing media", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  let project = createComicProject({ title: "部分分镜", starter: "empty" });
  project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision,
    scene: { title: "已经保存的场景", episodeNumber: 1 } });
  let analysisApplied = false;
  let applications = 0;
  let enqueues = 0;
  const ports = {
    async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied }; },
    async applyAnalysis(expectedRevision: number) {
      assert.equal(expectedRevision, project.revision);
      applications += 1;
      project = applyComicCommand(project, { type: "shot.add", expectedRevision: project.revision,
        sceneId: project.scenes[0].id, shot: { title: "缺失镜头", visualPrompt: "雨夜等待", durationFrames: 24 } });
      analysisApplied = true;
      return { project, scriptVersion: 1, analysisReady: true, analysisApplied };
    },
    async authorize() {},
    async enqueueMediaJob() { enqueues += 1; return { id: "fake-job-partial", status: "queued" as const }; },
    async confirmMediaJob() { assert.fail("free route does not confirm"); return { id: "unexpected", status: "queued" as const }; },
    async getMediaJob() { return { id: "fake-job-partial", status: "queued" as const }; },
  };
  const result = await new ComicProductionRunCoordinator(store, ports).start({
    requestKey: "partial-analysis-test", workspaceId: "workspace-partial", projectId: project.id, scriptVersion: 1,
    authorization: { approvalId: "approval-partial", approvedAt: new Date().toISOString(),
      maxEstimatedCostMicros: 0, routes: [{ kind: "image", connectionId: "comfyui:local", model: "fake-local-image",
        billing: "free", estimatedCostMicros: 0, description: "isolated" }] },
  });
  assert.equal(applications, 1);
  assert.equal(enqueues, 1);
  assert.equal(result.tasks.length, 1);
});

test("an unreconciled partial analysis cannot enqueue media", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-run-incomplete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  let project = createComicProject({ title: "仍未完整", starter: "empty" });
  project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision,
    scene: { title: "只保存了场景", episodeNumber: 1 } });
  let enqueues = 0;
  const state = () => ({ project, scriptVersion: 1, analysisReady: true, analysisApplied: false });
  const ports = {
    async loadProject() { return state(); },
    async applyAnalysis() { return state(); },
    async authorize() { assert.fail("incomplete project cannot be authorized"); },
    async enqueueMediaJob() { enqueues += 1; throw Error("incomplete project was enqueued"); },
    async confirmMediaJob() { assert.fail("incomplete project cannot confirm"); return { id: "unexpected", status: "queued" as const }; },
    async getMediaJob() { assert.fail("incomplete project cannot probe"); return { id: "unexpected", status: "queued" as const }; },
  };
  await assert.rejects(new ComicProductionRunCoordinator(store, ports).start({
    requestKey: "incomplete-analysis-test", workspaceId: "workspace-incomplete", projectId: project.id, scriptVersion: 1,
    authorization: { approvalId: "approval-incomplete", approvedAt: new Date().toISOString(),
      maxEstimatedCostMicros: 0, routes: [{ kind: "image", connectionId: "comfyui:local", model: "fake-local-image",
        billing: "free", estimatedCostMicros: 0, description: "isolated" }] },
  }), error => error instanceof Error && "code" in error && error.code === "PRODUCTION_ANALYSIS_INCOMPLETE");
  assert.equal(enqueues, 0);
});

test("an interrupted media job is retried under its own record at most three times; a paid one with an unknown outcome is not", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-comic-interrupted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let project = createComicProject({ title: "中断重试", starter: "empty", frameRate: 24,
    canvas: { aspectRatio: "16:9", width: 320, height: 180 } });
  project = applyComicCommand(project, { type: "scene.add", expectedRevision: project.revision,
    scene: { title: "车站", episodeNumber: 1 } });
  project = applyComicCommand(project, { type: "shot.add", expectedRevision: project.revision,
    sceneId: project.scenes[0].id, shot: { title: "相遇", visualPrompt: "车站相遇", durationFrames: 24 } });
  const setup = async (name: string, route: { connectionId: string; billing: "free" | "provider_billed"; estimatedCostMicros: number }) => {
    const queue = await MediaJobStore.create({ root: join(root, `${name}-queue`) });
    const approval = { approvalId: `approval-${name}-test-001`, approvedAt: new Date().toISOString(), maxEstimatedCostMicros: route.estimatedCostMicros,
      routes: [{ kind: "image" as const, model: "fake-image", description: "隔离假供应商画面", ...route }] };
    const calls = { enqueues: 0, retries: 0 };
    const ports = {
      async loadProject() { return { project, scriptVersion: 1, analysisReady: true, analysisApplied: true }; },
      async applyAnalysis(): Promise<never> { throw new Error("analysis is already applied"); },
      async authorize(value: typeof approval) { assert.equal(value.approvalId, approval.approvalId); },
      async enqueueMediaJob(request: Parameters<MediaJobStore["enqueue"]>[0]) { calls.enqueues += 1; return queue.enqueue(request); },
      async confirmMediaJob(id: string) { return queue.confirm(id); },
      async getMediaJob(id: string) { return queue.get(id); },
      // As a host adapter over MediaJobStore.retry: a job that may not be retried comes back unchanged.
      async retryMediaJob(id: string) {
        calls.retries += 1;
        try { return await queue.retry(id); } catch (error) {
          if (["JOB_NOT_RETRYABLE", "ATTEMPT_LIMIT", "JOB_HISTORY_ONLY"].includes((error as { code?: string }).code ?? "")) return queue.get(id);
          throw error;
        }
      },
    };
    const coordinator = new ComicProductionRunCoordinator(await ComicProductionRunStore.create(join(root, `${name}-runs`)), ports);
    const run = await coordinator.start({ requestKey: `desktop-run-${name}-001`, workspaceId: "workspace-local-test", projectId: project.id,
      scriptVersion: 1, authorization: approval });
    const interrupt = async () => {
      const workerId = `media-worker-${randomUUID()}`;
      assert.ok(await queue.claimNext(workerId), "a queued job is claimed");
      await queue.releaseWorker(workerId);
      const [recovered] = await queue.recoverInterrupted();
      assert.equal(recovered?.status, "interrupted");
    };
    return { queue, calls, run, interrupt, advance: () => coordinator.advance(run.id) };
  };

  const free = await setup("free", { connectionId: "comfyui:local", billing: "free", estimatedCostMicros: 0 });
  const jobId = free.run.tasks[0].jobId;
  assert.ok(jobId);
  for (const expected of [1, 2]) {
    await free.interrupt();
    const advanced = await free.advance();
    assert.equal(free.calls.retries, expected);
    assert.equal(advanced.tasks[0].interruptedRetries, expected);
    assert.equal(advanced.tasks[0].jobId, jobId, "the same media record is retried");
    assert.equal(advanced.tasks[0].status, "queued");
    assert.equal((await free.queue.get(jobId)).status, "queued");
  }
  // The third interruption uses the job's last attempt: the retry is refused and the task waits for the user.
  await free.interrupt();
  const exhausted = await free.advance();
  assert.equal(exhausted.tasks[0].status, "failed");
  assert.equal(exhausted.status, "needs_attention");
  assert.equal(exhausted.tasks[0].interruptedRetries, 3);
  await free.advance();
  assert.equal(free.calls.retries, 3, "no automatic retry after the third");
  assert.equal(free.calls.enqueues, 1, "the request is never submitted as a new job");
  assert.equal((await free.queue.read()).jobs.length, 1);

  // A paid request interrupted while the provider may have accepted it is never repeated automatically.
  const paid = await setup("paid", { connectionId: uuid(), billing: "provider_billed", estimatedCostMicros: 1_000_000 });
  await paid.interrupt();
  const held = await paid.advance();
  assert.equal(held.tasks[0].status, "failed");
  assert.equal(paid.calls.enqueues, 1);
  assert.equal((await paid.queue.read()).jobs.length, 1);
  const paidJob = await paid.queue.get(held.tasks[0].jobId!);
  assert.equal(paidJob.status, "interrupted");
  assert.equal(paidJob.failure?.retryable, false);
});
