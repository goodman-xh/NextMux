import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, lstat, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MediaCoreError, MediaJobStore } from "../lib/index.js";

test("a prior version's live lock inside the queue blocks new writers and cleanup", async t => {
  const sandbox = await mkdtemp(join(tmpdir(), "nextmux-media-legacy-lock-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, "media-jobs", "workspace-hash");
  const store = await MediaJobStore.create({ root });
  await mkdir(join(root, "media-jobs.lock"));
  await assert.rejects(store.withQueueLock(async () => undefined),
    (error: unknown) => error instanceof MediaCoreError && error.code === "MEDIA_QUEUE_BUSY");
});

test("another process can enqueue after a locked queue clear without losing its accepted job", { timeout: 15_000 }, async t => {
  const sandbox = await mkdtemp(join(tmpdir(), "nextmux-media-cross-process-clear-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, "media-jobs", "workspace-hash");
  const store = await MediaJobStore.create({ root });
  const lockPath = join(dirname(root), ".locks", `${basename(root)}.lock`);
  const modulePath = fileURLToPath(new URL("../lib/index.js", import.meta.url));
  const childSource = String.raw`
    (async () => {
      const { MediaJobStore } = require(process.argv[1]);
      const store = await MediaJobStore.create({ root: process.argv[2] });
      process.send({ stage: 'attempting' });
      const job = await store.enqueue({
        idempotencyKey: 'cross-process-after-clear', kind: 'image',
        projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
        input: { connectionId: 'official-00000000-0000-4000-8000-000000000001',
          model: 'offline-fixture', prompt: 'no provider call', width: 1024, height: 1024 },
        cost: { billing: 'provider_billed', description: 'offline, never confirmed' }
      });
      process.send({ stage: 'accepted', id: job.id });
    })().catch(error => {
      process.send({ stage: 'error', message: String(error?.stack || error) });
      process.exitCode = 1;
    });
  `;
  let child: ReturnType<typeof spawn> | undefined;
  let signalAttempted: () => void = () => {};
  let rejectAttempted: (error: Error) => void = () => {};
  const attempted = new Promise<void>((resolve, reject) => {
    signalAttempted = resolve;
    rejectAttempted = reject;
  });
  let resolveAccepted: (value: string) => void = () => {};
  let rejectAccepted: (error: Error) => void = () => {};
  const accepted = new Promise<string>((resolve, reject) => {
    resolveAccepted = resolve;
    rejectAccepted = reject;
  });
  try {
    await store.withQueueLock(async verifyOwnership => {
      child = spawn(process.execPath, ["-e", childSource, modulePath, root], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      child.on("message", (value: unknown) => {
        const message = value as { stage?: string; id?: string; message?: string };
        if (message.stage === "attempting") signalAttempted();
        if (message.stage === "accepted" && message.id) resolveAccepted(message.id);
        if (message.stage === "error") rejectAccepted(new Error(message.message));
      });
      child.on("error", error => { rejectAttempted(error); rejectAccepted(error); });
      child.on("exit", code => {
        if (code !== 0) {
          const error = new Error(`queue writer exited with ${code}`);
          rejectAttempted(error);
          rejectAccepted(error);
        }
      });
      await attempted;
      verifyOwnership();
      assert.equal((await lstat(lockPath)).isDirectory(), true,
        "the active lock must remain outside the workspace queue directory");
      await rm(root, { recursive: true, force: true });
      assert.equal((await lstat(lockPath)).isDirectory(), true,
        "removing a queue must not remove its active lock");
    });
    const jobId = await accepted;
    assert.equal((await store.get(jobId)).id, jobId,
      "a job accepted after the clear must survive in the recreated queue");
  } finally {
    if (child && child.exitCode === null) child.kill();
  }
});
