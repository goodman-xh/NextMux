import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test, { type TestContext } from "node:test";

import {
  AgentToolError,
  AgentToolRegistry,
  AgentRunInterruptedError,
  AgentRunner,
  rebaseAgentRunCheckpoint,
  retryAgentRunCheckpoint,
  ToolExecutionLedger,
  WorkspaceToolRuntime,
  AgentVerificationTracker,
  type AgentToolCall,
  type AgentToolDescriptor,
  type ToolExecutionResult,
} from "../lib/index.js";

test("host batches distinguish intentional effects while replaying the same batch once", async t => {
  const { registry } = await fixture(t);
  let effects = 0;
  registry.register({ ...writeDescriptor, name: "test.batch_effect", executionKind: "side_effect" }, async () => ({
    modelOutput: { effect: ++effects }, summary: { title: "effect" },
  }));
  const call = { id: "first-call", name: "test.batch_effect", arguments: { value: 1 } };
  const context = { runId: "run-batch-20260919", executionScopeId: "scope-batch-20260919", executionId: "batch-one" };
  assert.equal((await registry.execute(call, "full_access", context)).ledger?.replayed, false);
  assert.equal((await registry.execute({ ...call, id: "recovered-call" }, "full_access", context)).ledger?.replayed, true);
  assert.equal(effects, 1);
  assert.equal((await registry.execute({ ...call, id: "new-intent" }, "full_access", { ...context, executionId: "batch-two" })).ledger?.replayed, false);
  assert.equal(effects, 2);
  const recovered = { ...context, executionId: "recovery-first", replayPreviousEffects: true };
  assert.equal((await registry.execute({ ...call, id: "recovery-alias" }, "full_access", recovered)).ledger?.replayed, true);
  assert.equal(effects, 2);
  assert.equal((await registry.execute({ ...call, id: "after-recovery" }, "full_access", { ...context, executionId: "recovery-next" })).ledger?.replayed, false);
  assert.equal(effects, 3, "recovery matching must end before later explicit batches");
});

test("a recovered run hands back an effect the model never saw once, even after a read in between (B01-02)", async t => {
  const { registry } = await fixture(t);
  let effects = 0;
  registry.register({ ...writeDescriptor, name: "test.crash_effect", executionKind: "side_effect" }, async () => ({
    modelOutput: { effect: ++effects }, summary: { title: "effect" },
  }));
  const call = { id: "before-crash", name: "test.crash_effect", arguments: { value: 1 } };
  const context = { runId: "run-crash-20260929", executionScopeId: "scope-crash-20260929", executionId: "batch-one" };
  await registry.execute(call, "full_access", context);
  assert.equal(effects, 1);
  // The checkpoint was saved before this result reached the conversation: the model never saw "before-crash".
  const seen = new Set<string>(["an-older-call"]);
  const later = { ...context, executionId: "recovery-second-batch", recoveredSeenCallIds: seen };
  assert.equal((await registry.execute({ ...call, id: "repeat-after-read" }, "full_access", later)).ledger?.replayed, true);
  assert.equal(effects, 1, "the committed effect is handed back, not run again");
  assert.equal((await registry.execute({ ...call, id: "deliberate-rerun" }, "full_access", { ...later, executionId: "recovery-third-batch" })).ledger?.replayed, false);
  assert.equal(effects, 2, "after one hand-back an identical call runs normally");
  const seenBefore = { ...context, executionId: "recovery-fourth-batch", recoveredSeenCallIds: new Set<string>(["before-crash", "deliberate-rerun"]) };
  assert.equal((await registry.execute({ ...call, id: "seen-rerun" }, "full_access", seenBefore)).ledger?.replayed, false);
  assert.equal(effects, 3, "an effect the model already saw is never withheld");
});

test("an unknown effect remains blocked across new host batches", async t => {
  const { registry } = await fixture(t);
  let effects = 0;
  registry.register({ ...writeDescriptor, name: "test.unknown_batch", executionKind: "side_effect" }, async () => {
    effects++;
    throw new AgentToolError("CANCELLED", "Effect outcome cannot be established");
  });
  const call = { id: "unknown-first", name: "test.unknown_batch", arguments: { value: 1 } };
  const context = { runId: "run-batch-unknown", executionScopeId: "scope-batch-unknown", executionId: "batch-one" };
  assert.equal((await registry.execute(call, "full_access", context)).ledger?.state, "unknown");
  const retry = await registry.execute({ ...call, id: "unknown-new-id" }, "full_access", { ...context, executionId: "batch-two" });
  assert.equal(retry.error?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.equal(effects, 1);
});

test("the real workspace runner reruns an identical test command after an edit and retains the failure", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-check-rerun-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "value.json"), "true");
  await writeFile(join(workspace, "value.test.cjs"),
    "const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');test('value must be true',()=>assert.equal(JSON.parse(fs.readFileSync('value.json','utf8')),true));");
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: join(root, "checkpoints"), permissionMode: "full_access" });
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  const command = { command: process.execPath, args: ["--test", "value.test.cjs"] };
  let calls = 0;
  let firstExit: unknown, rerunExit: unknown;
  const result = await new AgentRunner({ tools: registry, permissionMode: "full_access", model: {
    async complete(request) {
      for (const message of request.messages.filter(message => message.role === "tool")) {
        if (message.toolCallId === "first-test") firstExit = JSON.parse(message.content).output.exitCode;
        if (message.toolCallId === "second-test") rerunExit = JSON.parse(message.content).output.exitCode;
      }
      calls++;
      if (calls === 1) return { toolCalls: [{ id: "first-test", name: "process.run", arguments: command }] };
      if (calls === 2) return { toolCalls: [{ id: "break-value", name: "workspace.write_file", arguments: {
        path: "value.json", content: "false", expectedSha256: createHash("sha256").update("true").digest("hex"),
      } }] };
      if (calls === 3) return { toolCalls: [{ id: "second-test", name: "process.run", arguments: command }] };
      return { content: "The current test fails." };
    },
  } }).run({ prompt: "Run the test, change the value, and rerun the same test", runId: "run-real-check-rerun" });
  assert.equal(firstExit, 0);
  assert.equal(rerunExit, 1, "the second command must execute against the changed file");
  assert.equal(result.verification?.status, "failed");
  assert.equal(await readFile(join(workspace, "value.json"), "utf8"), "false");
});

test("recovered successful evidence never certifies a later workspace revision", async t => {
  const { registry } = await fixture(t);
  registry.register({ ...writeDescriptor, name: "process.run" }, async () => ({
    modelOutput: { exitCode: 0 }, summary: { title: "test passed", commandLine: "node --test" },
  }));
  const call = { id: "check-before-edit", name: "process.run", arguments: { command: "node", args: ["--test"] } };
  const context = { runId: "run-evidence-replay", executionScopeId: "scope-evidence-replay", executionId: "batch-one" };
  const tracker = new AgentVerificationTracker();
  tracker.observe(call, await registry.execute(call, "full_access", context));
  tracker.observe({ id: "file-changed", name: "workspace.write_file", arguments: {} }, {
    ok: true, output: {}, summary: { title: "file changed", changedPaths: ["value.json"] },
  });
  const replayCall = { ...call, id: "recovered-check" };
  const replay = await registry.execute(replayCall, "full_access", { ...context, executionId: "recovered-batch", replayPreviousEffects: true });
  assert.equal(replay.ledger?.replayed, true);
  tracker.observe(replayCall, replay);
  assert.equal(tracker.snapshot().status, "unverified");
  const restoredBeforeEdit = new AgentVerificationTracker();
  const recoveredEdit = { ok: true, output: {}, summary: { title: "previous edit", changedPaths: ["value.json"] },
    ledger: { fingerprint: "a".repeat(64), state: "committed" as const, replayed: true } };
  restoredBeforeEdit.observe({ id: "recovered-edit", name: "workspace.write_file", arguments: {} }, recoveredEdit);
  assert.equal(restoredBeforeEdit.snapshot().status, "unverified");
  const revision = restoredBeforeEdit.snapshot().revision;
  restoredBeforeEdit.observe({ id: "recovered-edit-again", name: "workspace.write_file", arguments: {} }, recoveredEdit);
  assert.equal(restoredBeforeEdit.snapshot().revision, revision, "the same recovered edit must not advance revision again");
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "nextmux-tool-ledger-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journalPath = join(root, "tool-executions.ndjson");
  const ledger = await ToolExecutionLedger.open({ journalPath });
  const registry = new AgentToolRegistry({ executionLedger: ledger });
  return { root, journalPath, ledger, registry };
}

const writeDescriptor: AgentToolDescriptor = {
  name: "workspace.write_file",
  description: "test write",
  inputSchema: { type: "object" },
  requiredPermission: "workspace_write",
  source: "builtin",
};

async function execute(
  registry: AgentToolRegistry,
  call: AgentToolCall,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  return registry.execute(call, "full_access", {
    runId: "run-ledger-test-001",
    executionScopeId: "scope-ledger-test-001",
    signal,
  });
}

async function settleWithin<T>(promise: Promise<T>, milliseconds = 1_500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`operation did not settle within ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("abort settles a never-resolving read without creating an uncertain ledger entry", async t => {
  const { registry, journalPath } = await fixture(t);
  let handlers = 0;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  registry.register({
    name: "mcp.read_forever",
    description: "never-resolving read",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "mcp",
    executionKind: "read",
  }, async () => {
    handlers += 1;
    markStarted();
    return new Promise<never>(() => undefined);
  });

  const controller = new AbortController();
  const pending = execute(registry, {
    id: "never-read-001",
    name: "mcp.read_forever",
    arguments: { query: "status" },
  }, controller.signal);
  await settleWithin(started);
  controller.abort();
  const result = await settleWithin(pending);

  assert.equal(result.error?.code, "CANCELLED");
  assert.equal(result.ledger, undefined, "a declared read has no possible effect to mark unknown");
  assert.equal(handlers, 1);
  await assert.rejects(readFile(journalPath, "utf8"), { code: "ENOENT" });
});

test("abort marks a started never-resolving side effect unknown and permanently blocks replay", async t => {
  const { registry, journalPath } = await fixture(t);
  let effects = 0;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  registry.register({
    ...writeDescriptor,
    name: "test.never_settling_effect",
    executionKind: "side_effect",
  }, async () => {
    effects += 1;
    markStarted();
    return new Promise<never>(() => undefined);
  });

  const call = {
    id: "never-effect-001",
    name: "test.never_settling_effect",
    arguments: { path: "src/effect.ts", content: "effect" },
  } as const;
  const controller = new AbortController();
  const pending = execute(registry, call, controller.signal);
  await settleWithin(started);
  controller.abort();
  const cancelled = await settleWithin(pending);

  assert.equal(cancelled.error?.code, "CANCELLED");
  assert.equal(cancelled.ledger?.state, "unknown");
  assert.equal(cancelled.ledger?.replayed, false);
  const retried = await settleWithin(execute(registry, { ...call, id: "never-effect-002" }));
  assert.equal(retried.error?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.equal(retried.ledger?.state, "unknown");
  assert.equal(retried.ledger?.replayed, true);
  assert.equal(effects, 1, "an operation with an unknown outcome must never be invoked again");
  const journal = await readFile(journalPath, "utf8");
  assert.match(journal, /"state":"running"/);
  assert.match(journal, /"state":"unknown"/);
  assert.match(journal, /"reason":"CANCELLED"/);
});

test("committed workspace effects are reused across synonymous call IDs", async t => {
  const { registry, journalPath } = await fixture(t);
  let writes = 0;
  registry.register(writeDescriptor, async input => {
    writes += 1;
    return {
      modelOutput: { writeNumber: writes, input },
      summary: { title: "wrote file" },
    };
  });

  const first = await execute(registry, {
    id: "provider-call-a",
    name: "workspace.write_file",
    arguments: {
      path: "./src\\alpha.ts",
      content: "export const alpha = 1;\n",
      expectedSha256: "a".repeat(64),
    },
  });
  const retried = await execute(registry, {
    id: "provider-call-b",
    name: "workspace.write_file",
    arguments: {
      content: "export const alpha = 1;\n",
      expectedSha256: "b".repeat(64),
      path: "src/alpha.ts",
    },
  });

  assert.equal(first.ok, true);
  assert.equal(retried.ok, true);
  assert.equal(writes, 1);
  assert.deepEqual(retried.output, first.output);
  assert.equal(retried.ledger?.replayed, true);
  assert.equal(retried.ledger?.state, "committed");
  const journal = await readFile(journalPath, "utf8");
  assert.match(journal, /"state":"prepared"/);
  assert.match(journal, /"state":"running"/);
  assert.match(journal, /"state":"committed"/);
  assert.doesNotMatch(journal, /provider-call-b/);
});

test("read operations remain safely retryable", async t => {
  const { registry } = await fixture(t);
  let reads = 0;
  registry.register({
    name: "workspace.read_file",
    description: "test read",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({
    modelOutput: { readNumber: ++reads },
    summary: { title: "read file" },
  }));

  const first = await execute(registry, { id: "read-a", name: "workspace.read_file", arguments: { path: "a.ts" } });
  const second = await execute(registry, { id: "read-b", name: "workspace.read_file", arguments: { path: "a.ts" } });

  assert.equal(reads, 2);
  assert.deepEqual(first.output, { readNumber: 1 });
  assert.deepEqual(second.output, { readNumber: 2 });
  assert.equal(second.ledger, undefined);
});

test("MCP tools fail safe as side effects unless explicitly declared read-only", async t => {
  const { registry } = await fixture(t);
  let mutations = 0;
  registry.register({
    name: "mcp.issue.create",
    description: "create an issue",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "mcp",
  }, async () => ({ modelOutput: { issue: ++mutations }, summary: { title: "created issue" } }));

  const first = await execute(registry, {
    id: "mcp-a",
    name: "mcp.issue.create",
    arguments: { fields: { title: "One", labels: ["bug"] } },
  });
  const second = await execute(registry, {
    id: "mcp-b",
    name: "mcp.issue.create",
    arguments: { fields: { labels: ["bug"], title: "One" } },
  });

  assert.equal(mutations, 1);
  assert.deepEqual(second.output, first.output);
  assert.equal(second.ledger?.replayed, true);
});

test("a proven precondition failure enters failed state and remains retryable", async t => {
  const { registry } = await fixture(t);
  let attempts = 0;
  registry.register(writeDescriptor, async () => {
    attempts += 1;
    if (attempts === 1) throw new AgentToolError("STALE_WRITE", "refresh the read hash");
    return { modelOutput: { committed: true }, summary: { title: "committed" } };
  });

  const failed = await execute(registry, {
    id: "precondition-a",
    name: "workspace.write_file",
    arguments: { path: "src/precondition.ts", content: "next" },
  });
  const retried = await execute(registry, {
    id: "precondition-b",
    name: "workspace.write_file",
    arguments: { content: "next", path: "src/precondition.ts" },
  });

  assert.equal(failed.error?.code, "STALE_WRITE");
  assert.equal(failed.ledger?.state, "failed");
  assert.equal(retried.ok, true);
  assert.equal(retried.ledger?.state, "committed");
  assert.equal(attempts, 2);
});

test("concurrent runtime processes serialize one logical effect", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-tool-ledger-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journalPath = join(root, "tool-executions.ndjson");
  const effectPath = join(root, "effect.txt");
  const barrierPath = join(root, "go");
  const runtimeUrl = new URL("../lib/index.js", import.meta.url).href;
  const childSource = `
    import { appendFile, readFile, writeFile } from "node:fs/promises";
    import { AgentToolRegistry, ToolExecutionLedger } from ${JSON.stringify(runtimeUrl)};
    const id = process.argv[1];
    const ledger = await ToolExecutionLedger.open({ journalPath: ${JSON.stringify(journalPath)} });
    const registry = new AgentToolRegistry({ executionLedger: ledger });
    registry.register(${JSON.stringify(writeDescriptor)}, async () => {
      await appendFile(${JSON.stringify(effectPath)}, "effect\\n", "utf8");
      await new Promise(resolve => setTimeout(resolve, 150));
      return { modelOutput: { committed: true }, summary: { title: "committed" } };
    });
    await writeFile(${JSON.stringify(join(root, "ready-"))} + id, "ready", "utf8");
    while (true) {
      try { await readFile(${JSON.stringify(barrierPath)}); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const result = await registry.execute({ id, name: "workspace.write_file", arguments: { path: "src/race.ts", content: "race" } }, "full_access", {
      runId: "run-ledger-race-" + id,
      executionScopeId: "scope-ledger-race-001",
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const children = ["race-a", "race-b"].map(id => spawn(
    process.execPath,
    ["--input-type=module", "-e", childSource, id],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  ));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const outputPromises = children.map(child => new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `child exited ${code}`)));
  }));
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all(["race-a", "race-b"].map(id => readFile(join(root, `ready-${id}`))));
      break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await writeFile(barrierPath, "go", "utf8");
  const outputs = await Promise.all(outputPromises);

  assert.equal(await readFile(effectPath, "utf8"), "effect\n");
  const results = outputs.map(output => JSON.parse(output) as ToolExecutionResult);
  assert.equal(results.every(result => result.ok), true);
  assert.deepEqual(results.map(result => result.ledger?.replayed).sort(), [false, true]);
});

test("a crash after an effect starts recovers as unknown and is never replayed", async t => {
  const root = await mkdtemp(join(tmpdir(), "nextmux-tool-ledger-crash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journalPath = join(root, "tool-executions.ndjson");
  const effectPath = join(root, "effect.txt");
  const runtimeUrl = new URL("../lib/index.js", import.meta.url).href;
  const childSource = `
    import { appendFile } from "node:fs/promises";
    import { AgentToolRegistry, ToolExecutionLedger } from ${JSON.stringify(runtimeUrl)};
    const ledger = await ToolExecutionLedger.open({ journalPath: ${JSON.stringify(journalPath)} });
    const registry = new AgentToolRegistry({ executionLedger: ledger });
    registry.register(${JSON.stringify(writeDescriptor)}, async () => {
      await appendFile(${JSON.stringify(effectPath)}, "effect\\n", "utf8");
      await new Promise(() => undefined);
    });
    void registry.execute({ id: "crashing-call", name: "workspace.write_file", arguments: { path: "src/a.ts", content: "a" } }, "full_access", {
      runId: "run-ledger-crash-001",
      executionScopeId: "scope-ledger-crash-001",
    });
    setInterval(() => undefined, 1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(effectPath, "utf8")).includes("effect")) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(await readFile(effectPath, "utf8"), "effect\n");
  child.kill("SIGKILL");
  if (child.exitCode === null) {
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });
  }

  const recovered = await ToolExecutionLedger.open({ journalPath });
  const registry = new AgentToolRegistry({ executionLedger: recovered });
  registry.register(writeDescriptor, async () => {
    await appendFile(effectPath, "replayed\n", "utf8");
    return { modelOutput: {}, summary: { title: "replayed" } };
  });
  const result = await registry.execute({
    id: "new-provider-call-after-crash",
    name: "workspace.write_file",
    arguments: { content: "a", path: "src/a.ts" },
  }, "full_access", {
    runId: "run-ledger-crash-002",
    executionScopeId: "scope-ledger-crash-001",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.equal(result.ledger?.state, "unknown");
  assert.equal(await readFile(effectPath, "utf8"), "effect\n");
  assert.match(await readFile(journalPath, "utf8"), /"state":"unknown"/);
});

test("cancellation before start is retryable, but cancellation after an effect starts is unknown", async t => {
  const { registry } = await fixture(t);
  let effects = 0;
  registry.register(writeDescriptor, async (_input, context) => {
    effects += 1;
    await new Promise<void>(resolve => context.signal?.addEventListener("abort", () => resolve(), { once: true }));
    throw new AgentToolError("CANCELLED", "cancelled after effect");
  });

  const beforeStart = new AbortController();
  beforeStart.abort();
  const cancelledBefore = await execute(registry, {
    id: "cancel-before",
    name: "workspace.write_file",
    arguments: { path: "src/b.ts", content: "b" },
  }, beforeStart.signal);
  assert.equal(cancelledBefore.error?.code, "CANCELLED");
  assert.equal(effects, 0);

  const during = new AbortController();
  const pending = execute(registry, {
    id: "cancel-during",
    name: "workspace.write_file",
    arguments: { path: "src/b.ts", content: "b" },
  }, during.signal);
  while (effects === 0) await new Promise(resolve => setTimeout(resolve, 5));
  during.abort();
  const cancelledDuring = await pending;
  assert.equal(cancelledDuring.error?.code, "CANCELLED");
  assert.equal(cancelledDuring.ledger?.state, "unknown");
  assert.equal(cancelledDuring.ledger?.replayed, false);

  const retried = await execute(registry, {
    id: "cancel-retry-new-call-id",
    name: "workspace.write_file",
    arguments: { content: "b", path: "./src/b.ts" },
  });
  assert.equal(retried.ok, false);
  assert.equal(retried.error?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.equal(effects, 1);
});

test("checkpoint recovery preserves the ledger scope when a model uses a synonymous new call ID", async t => {
  const { registry } = await fixture(t);
  let effects = 0;
  registry.register({ ...writeDescriptor, name: "test.side_effect", executionKind: "side_effect" }, async () => ({
    modelOutput: { effect: ++effects },
    summary: { title: "effect committed" },
  }));
  let firstModelCalls = 0;
  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(new AgentRunner({
    tools: registry,
    permissionMode: "full_access",
    model: {
      async complete() {
        firstModelCalls += 1;
        if (firstModelCalls === 1) {
          return { toolCalls: [{ id: "original-id", name: "test.side_effect", arguments: { value: 1 } }] };
        }
        throw Object.assign(new Error("model disconnected"), { code: "CONNECTION_FAILED" });
      },
    },
  }).run({ prompt: "commit once", runId: "run-ledger-checkpoint-001" }), error => {
    interruption = error as AgentRunInterruptedError;
    return interruption instanceof AgentRunInterruptedError;
  });

  let resumedCalls = 0;
  const resumed = await new AgentRunner({
    tools: registry,
    permissionMode: "full_access",
    model: {
      async complete() {
        resumedCalls += 1;
        return resumedCalls === 1
          ? { toolCalls: [{ id: "synonymous-new-id", name: "test.side_effect", arguments: { value: 1 } }] }
          : { content: "done without replay" };
      },
    },
  }).run({
    prompt: "commit once",
    runId: "run-ledger-checkpoint-002",
    checkpoint: retryAgentRunCheckpoint(interruption!.checkpoint, "run-ledger-checkpoint-002"),
  });

  assert.equal(resumed.status, "completed");
  assert.equal(resumed.finalText, "done without replay");
  assert.equal(effects, 1);
});

test("manual cross-model continuation preserves committed and unknown side-effect decisions", async t => {
  const { registry } = await fixture(t);
  let committedEffects = 0;
  let unknownEffects = 0;
  registry.register({ ...writeDescriptor, name: "test.committed_effect", executionKind: "side_effect" }, async () => ({
    modelOutput: { effect: ++committedEffects },
    summary: { title: "effect committed" },
  }));
  registry.register({ ...writeDescriptor, name: "test.unknown_effect", executionKind: "side_effect" }, async (_input, context) => {
    unknownEffects += 1;
    await new Promise<void>(resolve => context.signal?.addEventListener("abort", () => resolve(), { once: true }));
    throw new AgentToolError("CANCELLED", "effect outcome is unknown");
  });

  const committedCall = {
    id: "model-a-committed",
    name: "test.committed_effect",
    arguments: { path: "src/model-switch.ts", content: "committed" },
  } as const;
  const unknownCall = {
    id: "model-a-unknown",
    name: "test.unknown_effect",
    arguments: { path: "src/model-switch.ts", content: "unknown" },
  } as const;
  assert.equal((await execute(registry, committedCall)).ok, true);
  const controller = new AbortController();
  const unknownPending = execute(registry, unknownCall, controller.signal);
  while (unknownEffects === 0) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  assert.equal((await unknownPending).ledger?.state, "unknown");

  const resumed = rebaseAgentRunCheckpoint({
    version: 1,
    runId: "run-model-a-before-cancel",
    executionScopeId: "scope-ledger-test-001",
    nextTurn: 2,
    segment: 1,
    messages: [{ role: "user", content: "continue with another model" }],
    seenToolCallIds: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    toolCalls: 2,
    repeatedToolBatchTurns: 0,
    createdAt: new Date().toISOString(),
  }, {
    runId: "run-model-b-after-cancel",
    direction: "Continue with the newly selected model",
  });
  const resumedContext = {
    runId: resumed.runId,
    executionScopeId: resumed.executionScopeId,
  };
  const committedReplay = await registry.execute(
    { ...committedCall, id: "model-b-committed" }, "full_access", resumedContext,
  );
  const unknownReplay = await registry.execute(
    { ...unknownCall, id: "model-b-unknown" }, "full_access", resumedContext,
  );

  assert.equal(resumed.executionScopeId, "scope-ledger-test-001");
  assert.equal(committedReplay.ledger?.state, "committed");
  assert.equal(committedReplay.ledger?.replayed, true);
  assert.equal(unknownReplay.error?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.equal(unknownReplay.ledger?.replayed, true);
  assert.equal(committedEffects, 1);
  assert.equal(unknownEffects, 1);
});
