import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MediaCoreError, MediaJobStore } from "../lib/index.js";

const binding = "a".repeat(64);
const worker = "media-worker-00000001";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const nodeRequire = createRequire(import.meta.url);
const fsPromises = nodeRequire("node:fs/promises") as { chmod: (...args: unknown[]) => Promise<void> };
const lockfile = nodeRequire("proper-lockfile") as { lock: (...args: unknown[]) => Promise<() => Promise<void>> };
const image = (key: string, billing: "free" | "provider_billed" = "provider_billed") => ({
  idempotencyKey: key, kind: "image" as const,
  projectId: "project-00000001", sceneId: "scene-00000001", shotId: "shot-00000001",
  input: { connectionId: "official-00000000-0000-4000-8000-000000000001", model: "offline-image",
    prompt: `offline fixture ${key}`, width: 1024, height: 1024 },
  cost: { billing, description: "offline fixture; never contacts a provider" },
});
const isCode = (code: string) => (error: unknown): boolean => error instanceof MediaCoreError && error.code === code;

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const sandbox = await mkdtemp(join(tmpdir(), "nextmux-media-history-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const source = await MediaJobStore.create({ root: join(sandbox, "source", "media-jobs", binding) });
  const targetRoot = join(sandbox, "target", "media-jobs", binding);
  const target = await MediaJobStore.create({ root: targetRoot });
  const backups = join(sandbox, "backups");
  await mkdir(backups);
  return { sandbox, source, target, targetRoot, backups };
}

async function terminalSource(store: MediaJobStore) {
  const cancelled = await store.enqueue(image("history-cancelled"));
  await store.cancel(cancelled.id);

  const failedRequest = image("history-failed");
  const failed = await store.enqueue(failedRequest);
  await store.confirm(failed.id);
  assert.equal((await store.claimNext(worker))?.id, failed.id);
  await store.fail(failed.id, worker, { code: "TEMPORARY", message: "provider unavailable", retryable: true });

  const succeeded = await store.enqueue(image("history-succeeded"));
  await store.confirm(succeeded.id);
  assert.equal((await store.claimNext(worker))?.id, succeeded.id);
  await store.saveCheckpoint(succeeded.id, worker, {
    assetId: "asset-00000001", assetKind: "image", relativeUri: "nextmux.media/offline.png",
    mimeType: "image/png", byteLength: 1, sha256: "b".repeat(64), provider: "offline", model: "offline-image",
  });
  await store.complete(succeeded.id, worker);
  return { cancelled, failed, failedRequest, succeeded };
}

test("only definite terminal records round-trip as read-only history with preserved deduplication", async t => {
  const { source, target, targetRoot, backups } = await fixture(t);
  const terminal = await terminalSource(source);
  const unknown = await source.enqueue(image("history-unknown"));
  await source.confirm(unknown.id);
  assert.equal((await source.claimNext(worker))?.id, unknown.id);
  await source.fail(unknown.id, worker, { code: "MEDIA_OUTCOME_UNKNOWN", message: "billing is unresolved", retryable: false });
  const running = await source.enqueue(image("history-running"));
  await source.confirm(running.id);
  assert.equal((await source.claimNext(worker))?.id, running.id);
  const queued = await source.enqueue(image("history-queued", "free"));
  const paused = await source.enqueue(image("history-paused", "free"));
  await source.pause(paused.id);
  const awaiting = await source.enqueue(image("history-awaiting"));

  const exported = await source.exportTerminalHistory(backups, binding);
  const archive = JSON.parse(await readFile(exported.file, "utf8"));
  assert.equal(archive.manifest.assetsIncluded, false, "backups contain records, never generated assets");
  assert.deepEqual(new Set(archive.jobs.map((job: { id: string }) => job.id)),
    new Set([terminal.cancelled.id, terminal.failed.id, terminal.succeeded.id]));
  for (const excluded of [unknown, running, queued, paused, awaiting]) {
    assert.equal(archive.jobs.some((job: { id: string }) => job.id === excluded.id), false);
  }
  assert.equal(exported.jobs, 3);
  const restored = await target.importTerminalHistory(exported.file, binding);
  assert.equal(restored.jobs, 3);
  assert.deepEqual(new Set((await target.read()).jobs.map(job => job.id)),
    new Set([terminal.cancelled.id, terminal.failed.id, terminal.succeeded.id]));
  assert.equal((await target.get(terminal.failed.id)).archivedIdempotencyDigest, hash(terminal.failed.idempotencyKey));
  assert.equal(JSON.stringify(archive).includes(terminal.failed.idempotencyKey), false);
  assert.equal((await target.enqueue(terminal.failedRequest)).id, terminal.failed.id,
    "the old key must deduplicate rather than submit a second paid request");
  await assert.rejects(target.enqueue({ ...terminal.failedRequest,
    input: { ...terminal.failedRequest.input, prompt: "different paid request" } }), isCode("IDEMPOTENCY_CONFLICT"));
  assert.equal(await target.claimNext(worker), undefined, "restoration must not start work");
  for (const job of (await target.read()).jobs) {
    assert.equal(job.restoredHistoryOnly, true);
    await assert.rejects(target.retry(job.id), isCode("JOB_HISTORY_ONLY"));
    await assert.rejects(target.regenerate(job.id), isCode("JOB_HISTORY_ONLY"));
  }

  const reopened = await MediaJobStore.create({ root: targetRoot });
  for (const job of (await reopened.read()).jobs) {
    assert.equal(job.restoredHistoryOnly, true);
    await assert.rejects(reopened.retry(job.id), isCode("JOB_HISTORY_ONLY"));
    await assert.rejects(reopened.regenerate(job.id), isCode("JOB_HISTORY_ONLY"));
  }
  assert.equal((await reopened.enqueue(terminal.failedRequest)).id, terminal.failed.id);
  assert.equal(await reopened.claimNext(worker), undefined);
});

test("workspace mismatch, tampering, and oversized archives fail before changing the target", async t => {
  const { source, target, backups } = await fixture(t);
  await terminalSource(source);
  const exported = await source.exportTerminalHistory(backups, binding);
  await assert.rejects(target.importTerminalHistory(exported.file, "c".repeat(64)), isCode("MEDIA_HISTORY_WORKSPACE_MISMATCH"));
  assert.equal((await target.read()).jobs.length, 0);

  const corruptPath = join(backups, "corrupt.nmxmedia");
  const archive = JSON.parse(await readFile(exported.file, "utf8"));
  archive.jobs[0].billing = "free";
  await writeFile(corruptPath, JSON.stringify(archive));
  await assert.rejects(target.importTerminalHistory(corruptPath, binding), isCode("MEDIA_HISTORY_ARCHIVE_INVALID"));
  assert.equal((await target.read()).jobs.length, 0);

  const forgedPath = join(backups, "forged.nmxmedia");
  archive.jobs[0].status = "queued";
  const jobsJson = JSON.stringify(archive.jobs);
  archive.manifest.jobsBytes = Buffer.byteLength(jobsJson);
  archive.manifest.jobsSha256 = hash(jobsJson);
  const { contentSha256: _old, ...unsigned } = archive.manifest;
  archive.manifest.contentSha256 = hash(JSON.stringify(unsigned));
  await writeFile(forgedPath, JSON.stringify(archive));
  await assert.rejects(target.importTerminalHistory(forgedPath, binding), isCode("MEDIA_HISTORY_ARCHIVE_INVALID"));
  assert.equal((await target.read()).jobs.length, 0);

  const oversizedPath = join(backups, "oversized.nmxmedia");
  await writeFile(oversizedPath, "x".repeat(17 * 1024 * 1024));
  await assert.rejects(target.importTerminalHistory(oversizedPath, binding), isCode("MEDIA_HISTORY_ARCHIVE_INVALID"));
  assert.equal((await target.read()).jobs.length, 0);
});

test("archive projection excludes provider links, authorization hints, uploads, output paths, and provider errors", async t => {
  const { source, target, backups } = await fixture(t);
  const request = {
    idempotencyKey: "history-sensitive-video", kind: "video" as const,
    projectId: "project-00000001", sceneId: "scene-00000001", shotId: "shot-00000001",
    input: { connectionId: "managed:fixed:00000000-0000-4000-8000-000000000001",
      keyPriceQuoteId: `kq1_${"a".repeat(64)}`, model: "offline-video", prompt: "USER_PROMPT_REVIEW_123",
      durationSeconds: 5, width: 1024, height: 1024,
      sourceVideoUri: "nextmux.media/SOURCE_PATH_REVIEW_123.mp4" },
    cost: { billing: "platform_billed" as const, description: "platform cost" },
  };
  const job = await source.enqueue(request);
  await source.confirm(job.id);
  assert.equal((await source.claimNext(worker))?.id, job.id);
  await source.saveRemoteTask(job.id, worker, { taskId: "REMOTE_TASK_REVIEW_123",
    pollUrl: "https://provider.example/poll?token=SIGNED_POLL_REVIEW_123",
    resultUrl: "https://provider.example/result?token=SIGNED_RESULT_REVIEW_123",
    submittedAt: new Date().toISOString() });
  await source.saveReferenceUpload(job.id, worker, { scope: "c".repeat(64), id: "UPLOAD_TOKEN_REVIEW_123" });
  await source.saveCheckpoint(job.id, worker, {
    assetId: "asset-00000001", assetKind: "video", relativeUri: "nextmux.media/OUTPUT_PATH_REVIEW_123.mp4",
    mimeType: "video/mp4", byteLength: 1, sha256: "b".repeat(64), provider: "offline", model: "offline-video",
    prompt: "CHECKPOINT_PROMPT_REVIEW_123", providerEvidence: { providerRequestId: "PROVIDER_REQUEST_REVIEW_123" },
  });
  await source.complete(job.id, worker);
  const exported = await source.exportTerminalHistory(backups, binding);
  const raw = await readFile(exported.file, "utf8");
  const secrets = ["SIGNED_POLL_REVIEW_123", "SIGNED_RESULT_REVIEW_123", "REMOTE_TASK_REVIEW_123",
    "UPLOAD_TOKEN_REVIEW_123", `kq1_${"a".repeat(64)}`, "SOURCE_PATH_REVIEW_123", "OUTPUT_PATH_REVIEW_123",
    "PROVIDER_REQUEST_REVIEW_123", "CHECKPOINT_PROMPT_REVIEW_123", "USER_PROMPT_REVIEW_123", request.idempotencyKey];
  for (const secret of secrets) {
    assert.equal(raw.includes(secret), false, `${secret} must not leave the live media queue`);
  }
  await target.importTerminalHistory(exported.file, binding);
  const restored = await target.get(job.id);
  assert.equal(restored.restoredHistoryOnly, true);
  assert.equal(restored.output, undefined);
  assert.equal(restored.remoteTask, undefined);
  assert.equal(restored.referenceUploads, undefined);
  for (const secret of secrets) {
    assert.equal(JSON.stringify(await target.read()).includes(secret), false, `${secret} must not re-enter the live queue`);
  }
});

test("restore serializes on the existing queue lock and refuses a nonempty destination", async t => {
  const { source, target, backups } = await fixture(t);
  await terminalSource(source);
  const exported = await source.exportTerminalHistory(backups, binding);
  const pending = await target.enqueue(image("already-pending"));
  const original = await target.read();
  await assert.rejects(target.importTerminalHistory(exported.file, binding), isCode("MEDIA_HISTORY_NOT_EMPTY"));
  assert.deepEqual(await target.read(), original, "a rejected import must preserve pending work exactly");
  assert.equal((await target.get(pending.id)).status, "awaiting_confirmation");

  const empty = await MediaJobStore.create({ root: join(backups, "fresh-target") });
  let completed = false;
  let importing: Promise<unknown> | undefined;
  await empty.withQueueLock(async () => {
    importing = empty.importTerminalHistory(exported.file, binding).then(value => { completed = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(completed, false, "restore must wait for the queue-wide writer lock");
  });
  await importing;
  assert.equal((await empty.read()).jobs.length, 3);
});

test("a post-rename permission failure cannot make a committed import report failure", async t => {
  const { source, target, backups } = await fixture(t);
  await terminalSource(source);
  const archive = await source.exportTerminalHistory(backups, binding);
  const original = fsPromises.chmod;
  fsPromises.chmod = async () => { throw new Error("injected chmod failure"); };
  try {
    const result = await target.importTerminalHistory(archive.file, binding);
    assert.equal(result.jobs, 3);
  } finally {
    fsPromises.chmod = original;
  }
  assert.equal((await target.read()).jobs.length, 3);
});

test("a lock release failure after commit cannot falsely report an uncommitted import", async t => {
  const { source, target, backups } = await fixture(t);
  await terminalSource(source);
  const archive = await source.exportTerminalHistory(backups, binding);
  const original = lockfile.lock;
  lockfile.lock = async (...args: unknown[]) => {
    const release = await original(...args);
    return async () => { await release(); throw new Error("injected post-commit release failure"); };
  };
  let reportedError: unknown;
  try {
    const result = await target.importTerminalHistory(archive.file, binding);
    assert.equal(result.jobs, 3);
  } catch (error) {
    reportedError = error;
  } finally {
    lockfile.lock = original;
  }
  assert.equal((await target.read()).jobs.length, 3);
  assert.equal(reportedError, undefined, "committed history must not be reported as rejected");
});

test("two thousand imported history records do not consume active queue capacity", async t => {
  const { source, target, backups } = await fixture(t);
  const job = await source.enqueue(image("bulk-history-base"));
  await source.cancel(job.id);
  const state = await source.read();
  const jobs = Array.from({ length: 2_000 }, (_, index) => ({
    ...state.jobs[0], id: `media-job-${randomUUID()}`, idempotencyKey: `bulk-history-key-${index}`,
    createdAt: "2099-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z",
    completedAt: "2099-01-01T00:00:00.000Z",
  }));
  await writeFile(join(source.root, "media-jobs-v1.json"), JSON.stringify({ ...state, jobs }));
  const exported = await source.exportTerminalHistory(backups, binding);
  assert.equal(exported.jobs, 2_000);
  await target.importTerminalHistory(exported.file, binding);
  assert.equal((await target.read()).jobs.length, 2_000);
  const fresh = await target.enqueue(image("bulk-new-paid"));
  assert.equal(fresh.status, "awaiting_confirmation");
  assert.equal((await target.read()).jobs.length, 2_001);
  assert.equal((await target.list(100))[0].id, fresh.id, "new paid work must remain visible ahead of imported history");

  const archive = JSON.parse(await readFile(exported.file, "utf8"));
  archive.jobs.push({ ...archive.jobs[0], id: `media-job-${randomUUID()}` });
  const jobsJson = JSON.stringify(archive.jobs);
  archive.manifest.jobsCount = archive.jobs.length;
  archive.manifest.jobsBytes = Buffer.byteLength(jobsJson);
  archive.manifest.jobsSha256 = hash(jobsJson);
  const { contentSha256: _old, ...unsigned } = archive.manifest;
  archive.manifest.contentSha256 = hash(JSON.stringify(unsigned));
  const excessive = join(backups, "too-many.nmxmedia");
  await writeFile(excessive, JSON.stringify(archive));
  const empty = await MediaJobStore.create({ root: join(backups, "empty-target") });
  await assert.rejects(empty.importTerminalHistory(excessive, binding), isCode("MEDIA_HISTORY_ARCHIVE_INVALID"));
  assert.equal((await empty.read()).jobs.length, 0);
});
