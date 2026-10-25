import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MediaCoreError, MediaJobStore } from "../lib/index.js";

function waitForChild(child: ChildProcess, stage: string): Promise<{ stage: string; verdict?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`child did not reach ${stage}`)); }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`child exited at ${stage}: ${code}`)); };
    const onMessage = (value: unknown) => {
      const message = value as { stage?: string; verdict?: string; message?: string };
      if (message?.stage === "error") { cleanup(); reject(new Error(message.message)); }
      else if (message?.stage === stage) { cleanup(); resolve(message as { stage: string; verdict?: string }); }
    };
    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

test("a former queue lock owner cannot commit or release a replacement process's lock", { timeout: 20_000 }, async () => {
  // Keep this isolated temporary fixture for inspection; no real profile or user data is touched.
  const sandbox = await mkdtemp(join(tmpdir(), "nextmux-media-lock-ownership-"));
  const root = join(sandbox, "media-jobs", "workspace-a");
  const lockPath = join(dirname(root), ".locks", "workspace-a.lock");
  const store = await MediaJobStore.create({ root });
  const modulePath = fileURLToPath(new URL("../lib/index.js", import.meta.url));
  const childSource = String.raw`
    (async () => {
      const { MediaJobStore } = require(process.argv[1]);
      const store = await MediaJobStore.create({ root: process.argv[2] });
      await store.withQueueLock(async verifyOwnership => {
        process.send({ stage: 'entered' });
        await new Promise(resolve => process.once('message', resolve));
        let verdict = 'accepted';
        try { verifyOwnership(); } catch (error) { verdict = error.code || error.message; }
        process.send({ stage: 'verdict', verdict });
      });
      process.disconnect();
    })().catch(error => { process.send({ stage: 'error', message: String(error.stack || error) }); process.exitCode = 1; });
  `;
  let child: ChildProcess | undefined;
  let oldOwnerContinued = false;
  let oldOwnerError: unknown;
  try {
    try {
      await store.withQueueLock(async verifyOwnership => {
        // This models an external stale-lock takeover. Preserve the old directory rather than deleting it.
        await rename(lockPath, `${lockPath}.preserved`);
        child = spawn(process.execPath, ["-e", childSource, modulePath, root], {
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        await waitForChild(child, "entered");
        verifyOwnership();
        oldOwnerContinued = true;
      });
    } catch (error) { oldOwnerError = error; }
    assert.ok(child);
    const newOwnerLockSurvived = Boolean(await lstat(lockPath).catch(() => undefined));
    const verdict = waitForChild(child, "verdict");
    child.send("finish");
    const newOwner = await verdict;
    assert.equal(oldOwnerContinued, false, "the former owner must stop before committing");
    assert.ok(oldOwnerError instanceof MediaCoreError && oldOwnerError.code === "MEDIA_LOCK_FAILED");
    assert.equal(newOwnerLockSurvived, true, "former owner release must preserve the new process's lock");
    assert.equal(newOwner.verdict, "accepted");
  } finally {
    if (child && child.exitCode === null) child.kill();
  }
});
