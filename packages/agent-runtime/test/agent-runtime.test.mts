import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  AGENT_DELEGATE_TOOL_NAME,
  AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD,
  AgentDelegationRuntime,
  applyAgentDelegationLifecycle,
  createAgentChildReceipt,
  createAgentDelegationLedger,
  AgentRunInterruptedError,
  AgentRunPauseError,
  AgentRunner,
  rebaseAgentRunCheckpoint,
  retryAgentRunCheckpoint,
  AgentToolError,
  AgentToolRegistry,
  rebaseWorkspaceCheckpointStore,
  WorkspaceToolRuntime,
  type AgentModelClient,
  type AgentModelRequest,
  type AgentPermissionMode,
  type AgentDelegateOutput,
  type AgentDelegationLifecycle,
  type AgentRunCheckpoint,
  type AgentRunEvent,
  type AgentRunStatus,
  type ManagedProcessRegistryLike,
  type ManagedProcessSessionLike,
  type ManagedProcessSnapshot,
  type ToolExecutionResult,
  agentTaskContextInstruction,
  childAgentTaskContext,
  createAgentTaskContext,
  normalizeAgentDelegationLedger,
  recordAgentDelegationUsage,
  isLowLevelTaskPlanTitle,
} from "../lib/index.js";
import { formatProcessCommandLine } from "../lib/process-command-line.js";

type LiveTaskPlanSource = Extract<AgentRunEvent, { readonly type: "task_plan_updated" }>["source"];
const liveTaskPlanSourceIsExactlyModel: [LiveTaskPlanSource] extends ["model"]
  ? ["model"] extends [LiveTaskPlanSource] ? true : false
  : false = true;

test("live task-plan source is model-only at the public type boundary", () => {
  assert.equal(liveTaskPlanSourceIsExactlyModel, true);
});

test("explicit continuation rebases a validated checkpoint with a fresh safety budget", () => {
  const resumed = rebaseAgentRunCheckpoint({
    version: 1,
    runId: "run-checkpoint-source-001",
    executionScopeId: "scope-checkpoint-source-001",
    nextTurn: 129,
    segment: 4,
    messages: [
      { role: "user", content: "Implement the original task" },
      {
        role: "assistant",
        content: "I reached the safety boundary after inspecting the repository.",
        providerState: { kind: "provider-context", responseId: "response-001" },
      },
    ],
    seenToolCallIds: ["old-tool-call-001"],
    usage: { inputTokens: 9_999, outputTokens: 888 },
    tokenBudget: {
      maxInputTokens: 20_000,
      maxOutputTokens: 2_000,
      inputTokens: 9_999,
      outputTokens: 888,
      usageKnown: true,
      remainingInputTokens: 10_001,
      remainingOutputTokens: 1_112,
    },
    toolCalls: 128,
    previousToolBatchSignature: "old-batch",
    previousToolResultSignature: "old-result",
    repeatedToolBatchTurns: 3,
    createdAt: new Date(0).toISOString(),
  }, {
    runId: "run-checkpoint-resumed-002",
    direction: "Continue from the preserved state and finish the tests.",
  });

  assert.equal(resumed.runId, "run-checkpoint-resumed-002");
  assert.equal(resumed.executionScopeId, "scope-checkpoint-source-001");
  assert.equal(resumed.nextTurn, 1);
  assert.equal(resumed.segment, 1);
  assert.equal(resumed.toolCalls, 0);
  assert.deepEqual(resumed.usage, { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(resumed.tokenBudget, {
    maxInputTokens: 20_000,
    maxOutputTokens: 2_000,
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: true,
    remainingInputTokens: 20_000,
    remainingOutputTokens: 2_000,
  });
  assert.deepEqual(resumed.seenToolCallIds, []);
  assert.equal(resumed.previousToolBatchSignature, undefined);
  assert.equal(resumed.previousToolResultSignature, undefined);
  assert.equal(resumed.repeatedToolBatchTurns, 0);
  assert.deepEqual(resumed.messages.slice(-2), [
    {
      role: "assistant",
      content: "I reached the safety boundary after inspecting the repository.",
      providerState: { kind: "provider-context", responseId: "response-001" },
    },
    { role: "user", content: "Continue from the preserved state and finish the tests." },
  ]);
  assert.notEqual(resumed.createdAt, new Date(0).toISOString());
});

test("checkpoint continuation rejects corrupt state and invalid continuation input", () => {
  const valid = {
    version: 1 as const,
    runId: "run-checkpoint-source-003",
    nextTurn: 2,
    segment: 1,
    messages: [{ role: "user" as const, content: "task" }],
    seenToolCallIds: [],
    usage: { inputTokens: 1, outputTokens: 0 },
    toolCalls: 0,
    repeatedToolBatchTurns: 0,
    createdAt: new Date().toISOString(),
  };
  assert.throws(
    () => rebaseAgentRunCheckpoint({ ...valid, nextTurn: 0 }, {
      runId: "run-checkpoint-resumed-004",
      direction: "continue",
    }),
    error => error instanceof AgentToolError && error.code === "INVALID_CHECKPOINT",
  );
  assert.throws(
    () => rebaseAgentRunCheckpoint(valid, { runId: "bad", direction: "continue" }),
    error => error instanceof AgentToolError && error.code === "INVALID_RUN_ID",
  );
  assert.throws(
    () => rebaseAgentRunCheckpoint(valid, { runId: "run-checkpoint-resumed-005", direction: "   " }),
    error => error instanceof AgentToolError && error.code === "INVALID_PROMPT",
  );
});

test("checkpoint retry repairs the legacy final tool-budget tail without accepting middle corruption", () => {
  const legacy = {
    version: 1 as const,
    runId: "run-legacy-budget-tail-001",
    nextTurn: 3,
    segment: 1,
    messages: [
      { role: "user" as const, content: "task" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          { id: "legacy-ran", name: "test.one", arguments: {} },
          { id: "legacy-skipped", name: "test.two", arguments: {} },
        ],
      },
      { role: "tool" as const, toolCallId: "legacy-ran", content: "{\"ok\":true}" },
    ],
    seenToolCallIds: ["legacy-ran"],
    usage: { inputTokens: 1, outputTokens: 1 },
    toolCalls: 1,
    repeatedToolBatchTurns: 1,
    createdAt: new Date().toISOString(),
  };

  const repaired = retryAgentRunCheckpoint(legacy, "run-legacy-budget-tail-002");
  assert.deepEqual(repaired.messages.slice(-2).map(message => message.toolCallId), ["legacy-ran", "legacy-skipped"]);
  assert.match(repaired.messages.at(-1)?.content || "", /TOOL_CALL_LIMIT_REACHED/);
  assert.deepEqual(repaired.seenToolCallIds, ["legacy-ran", "legacy-skipped"]);

  assert.throws(() => retryAgentRunCheckpoint({
    ...legacy,
    messages: [
      ...legacy.messages,
      { role: "user" as const, content: "corrupt middle group" },
    ],
  }, "run-legacy-budget-tail-003"), error => error instanceof AgentToolError && error.code === "INVALID_CHECKPOINT");
});

interface Fixture {
  readonly root: string;
  readonly workspace: string;
  readonly checkpoints: string;
  readonly runtime: WorkspaceToolRuntime;
  readonly registry: AgentToolRegistry;
}

async function fixture(t: TestContext, permissionMode: AgentPermissionMode = "workspace_write"): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "nextmux-agent-runtime-"));
  const workspace = join(root, "workspace");
  const checkpoints = join(root, "checkpoints");
  await mkdir(workspace);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: workspace, checkpointRoot: checkpoints, permissionMode });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, workspace, checkpoints, runtime, registry };
}

async function execute(
  registry: AgentToolRegistry,
  permissionMode: AgentPermissionMode,
  name: string,
  args: unknown,
  id = "call-00000001",
): Promise<ToolExecutionResult> {
  return registry.execute({ id, name, arguments: args }, permissionMode, { runId: "run-00000001" });
}

test("registry advertises only tools permitted by the selected mode", async t => {
  const { registry } = await fixture(t, "read_only");
  assert.deepEqual(registry.descriptors("read_only").map(tool => tool.name), [
    "workspace.list_files",
    "workspace.project_map",
    "workspace.read_file",
    "workspace.search_text",
  ]);
  assert.equal(registry.descriptors("workspace_write").some(tool => tool.name === "workspace.write_file"), true);
  assert.equal(registry.descriptors("workspace_write").some(tool => tool.name === "process.run"), true);
  assert.equal(registry.descriptors("full_access").some(tool => tool.name === "process.run"), true);
  assert.throws(
    () => registry.register(registry.descriptors("read_only")[0], async () => ({ modelOutput: {}, summary: { title: "x" } })),
    error => error instanceof AgentToolError && error.code === "DUPLICATE_TOOL",
  );
});

test("registry can remove a generic tool before a specialized workbench starts", async t => {
  const { registry } = await fixture(t);
  assert.equal(registry.descriptor("workspace.write_file")?.name, "workspace.write_file");
  assert.equal(registry.unregister("workspace.write_file"), true);
  assert.equal(registry.unregister("workspace.write_file"), false);
  assert.equal(registry.descriptor("workspace.write_file"), undefined);
  assert.equal(
    registry.descriptors("full_access").some(tool => tool.name === "workspace.write_file"),
    false,
  );
  const removed = await execute(registry, "full_access", "workspace.write_file", {
    path: "nextmux.comic.json",
    content: "{}",
  });
  assert.equal(removed.error?.code, "TOOL_NOT_FOUND");
});

test("list, read, and literal search are bounded and deterministic", async t => {
  const { workspace, registry } = await fixture(t);
  await mkdir(join(workspace, "src"));
  await mkdir(join(workspace, "node_modules"));
  await writeFile(join(workspace, "src", "alpha.ts"), "export const alpha = 'needle';\n", "utf8");
  await writeFile(join(workspace, "src", "beta.ts"), "// NEEDLE\n", "utf8");
  await writeFile(join(workspace, "node_modules", "ignored.js"), "needle\n", "utf8");

  const listed = await execute(registry, "read_only", "workspace.list_files", { path: ".", maxDepth: 3 });
  assert.equal(listed.ok, true);
  const entries = (listed.output as { entries: { path: string }[] }).entries.map(entry => entry.path);
  assert.deepEqual(entries, ["src", "src/alpha.ts", "src/beta.ts"]);

  const read = await execute(registry, "read_only", "workspace.read_file", { path: "src/alpha.ts" });
  assert.equal(read.ok, true);
  assert.equal((read.output as { content: string }).content.includes("needle"), true);
  assert.match((read.output as { sha256: string }).sha256, /^[a-f0-9]{64}$/);

  const searched = await execute(registry, "read_only", "workspace.search_text", { query: "needle" });
  assert.equal(searched.ok, true);
  const matches = (searched.output as { matches: { path: string }[] }).matches;
  assert.deepEqual(matches.map(match => match.path), ["src/alpha.ts", "src/beta.ts"]);
});

test("workspace root tools accept omitted, empty, and whitespace paths", async t => {
  const { workspace, registry } = await fixture(t, "full_access");
  await writeFile(join(workspace, "root.txt"), "root needle\n", "utf8");

  for (const path of [undefined, "", "   "]) {
    const listed = await execute(registry, "read_only", "workspace.list_files", { path, maxDepth: 99, limit: 99_999 });
    assert.equal(listed.ok, true);
    assert.deepEqual(
      (listed.output as { entries: { path: string }[] }).entries.map(entry => entry.path),
      ["root.txt"],
    );

    const searched = await execute(registry, "read_only", "workspace.search_text", { query: "needle", path, limit: 99_999 });
    assert.equal(searched.ok, true);
    assert.deepEqual(
      (searched.output as { matches: { path: string }[] }).matches.map(match => match.path),
      ["root.txt"],
    );
  }

  const processResult = await execute(registry, "full_access", "process.run", {
    command: process.execPath,
    args: ["-e", "console.log(process.cwd())"],
    cwd: "",
  });
  assert.equal(processResult.ok, true);
  assert.equal((processResult.output as { stdout: string }).stdout.trim(), await realpath(workspace));
});

test("read ranges clamp an oversized end line instead of failing discovery", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  await writeFile(join(workspace, "short.txt"), "one\ntwo\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", {
    path: "short.txt",
    startLine: 1,
    endLine: 10_000,
  });
  assert.equal(read.ok, true);
  assert.equal((read.output as { content: string }).content, "one\ntwo\n");
  assert.equal((read.output as { endLine: number }).endLine, 3);
});

test("workspace-contained absolute paths work without permitting external paths or symlink escapes", async t => {
  const { root, workspace, registry } = await fixture(t, "full_access");
  const canonical = await realpath(workspace);
  await writeFile(join(canonical, "inside.txt"), "inside", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: join(canonical, "inside.txt") });
  assert.equal(read.ok, true);
  assert.equal((read.output as { path: string }).path, "inside.txt");
  assert.equal(read.summary.resource?.kind === "file" && read.summary.resource.path, await realpath(join(canonical, "inside.txt")));
  const result = await execute(registry, "full_access", "process.run", { command: "pwd", cwd: canonical });
  assert.equal(result.ok, true);
  assert.equal((result.output as { stdout: string }).stdout.trim(), canonical);
  const outside = await execute(registry, "read_only", "workspace.read_file", { path: join(await realpath(root), "outside.txt") });
  assert.equal(outside.error?.code, "PATH_OUTSIDE_WORKSPACE");
  const internal = await execute(registry, "read_only", "workspace.read_file", { path: join(canonical, ".nextmux", "state.json") });
  assert.equal(internal.error?.code, "INTERNAL_PATH");
  const write = await execute(registry, "workspace_write", "workspace.write_file", {
    path: join(canonical, "created.txt"), content: "new", expectedSha256: null,
  }, "call-absolute-create");
  assert.equal(write.ok, true);
  assert.equal(await readFile(join(canonical, "created.txt"), "utf8"), "new");
});

test("a bounded range of a large text file returns exact lines and a whole-file hash", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  const text = `${"前文 line ".repeat(20)}\r\n`.repeat(10_000) + "selected 中文\r\nnext line\r\n";
  await writeFile(join(workspace, "large.txt"), text);
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "large.txt", startLine: 10_001, endLine: 50_000 });
  assert.equal(read.ok, true);
  assert.deepEqual(read.output, {
    path: "large.txt", content: "selected 中文\nnext line\n", startLine: 10_001, endLine: 10_003, totalLines: 10_003,
    sha256: createHash("sha256").update(text).digest("hex"), truncated: false,
  });
  assert.deepEqual(read.summary.resource, {
    kind: "file", path: await realpath(join(workspace, "large.txt")), action: "read", startLine: 10_001, endLine: 10_003,
  });
  const unbounded = await execute(registry, "read_only", "workspace.read_file", { path: "large.txt" });
  assert.equal(unbounded.error?.code, "FILE_TOO_LARGE");
  assert.match(unbounded.error?.message || "", /startLine\/endLine/);
});

test("large ranges retain output limits and normalize CRLF across stream boundaries", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  const text = "x".repeat(65_535) + "\r\n" + "y".repeat(1_100_000) + "\r\nlast";
  await writeFile(join(workspace, "long-lines.txt"), text);
  const first = await execute(registry, "read_only", "workspace.read_file", { path: "long-lines.txt", startLine: 1, endLine: 1 });
  assert.equal(first.ok, true);
  assert.equal((first.output as { content: string }).content, "x".repeat(65_535));
  const second = await execute(registry, "read_only", "workspace.read_file", { path: "long-lines.txt", startLine: 2, endLine: 2 });
  assert.equal(second.ok, true);
  assert.equal((second.output as { content: string }).content, "y".repeat(80_000));
  assert.equal((second.output as { truncated: boolean }).truncated, true);
  const last = await execute(registry, "read_only", "workspace.read_file", { path: "long-lines.txt", startLine: 3 });
  assert.equal((last.output as { content: string }).content, "last");
});

test("large ranged reads still reject binary and invalid UTF-8 outside the selected range", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  for (const [name, suffix, code] of [["binary", 0, "BINARY_FILE"], ["invalid", 0xff, "INVALID_UTF8"]] as const) {
    await writeFile(join(workspace, `${name}.txt`), Buffer.concat([Buffer.from("first\n" + "a".repeat(1_100_000)), Buffer.from([suffix])]));
    const result = await execute(registry, "read_only", "workspace.read_file", { path: `${name}.txt`, startLine: 1, endLine: 1 });
    assert.equal(result.error?.code, code);
  }
});

test("path traversal, internal state access, and cross-workspace symlinks are blocked", async t => {
  const { root, workspace, registry } = await fixture(t);
  await writeFile(join(root, "outside.txt"), "outside", "utf8");
  const traversal = await execute(registry, "read_only", "workspace.read_file", { path: "../outside.txt" });
  assert.equal(traversal.error?.code, "PATH_OUTSIDE_WORKSPACE");
  const internal = await execute(registry, "read_only", "workspace.read_file", { path: ".nextmux/state.json" });
  assert.equal(internal.error?.code, "INTERNAL_PATH");

  try {
    await symlink(join(root, "outside.txt"), join(workspace, "outside-link.txt"), "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.diagnostic("Symlink creation is not permitted on this Windows runner; lexical escape checks still ran.");
      return;
    }
    throw error;
  }
  const linked = await execute(registry, "read_only", "workspace.read_file", { path: "outside-link.txt" });
  assert.equal(linked.error?.code, "SYMLINK_ESCAPE");
});

test("writes require an exact read hash and create conflict-aware rollback checkpoints", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const pathname = join(workspace, "config.txt");
  await writeFile(pathname, "before\n", "utf8");
  const stale = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "config.txt",
    content: "after\n",
    expectedSha256: "0".repeat(64),
  });
  assert.equal(stale.error?.code, "STALE_WRITE");
  assert.equal(await readFile(pathname, "utf8"), "before\n");

  const read = await execute(registry, "read_only", "workspace.read_file", { path: "config.txt" });
  assert.deepEqual(read.summary.resource, {
    kind: "file",
    path: await realpath(pathname),
    action: "read",
    startLine: 1,
    endLine: 2,
  });
  const written = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "config.txt",
    content: "after\n",
    expectedSha256: (read.output as { sha256: string }).sha256,
  });
  assert.equal(written.ok, true);
  assert.deepEqual(written.summary.resource, {
    kind: "file",
    path: "config.txt",
    action: "updated",
    startLine: 1,
    endLine: 1,
  });
  const checkpointId = written.summary.checkpointId!;
  assert.equal(await readFile(pathname, "utf8"), "after\n");

  await writeFile(pathname, "user changed again\n", "utf8");
  await assert.rejects(
    runtime.restoreCheckpoint(checkpointId),
    error => error instanceof AgentToolError && error.code === "ROLLBACK_CONFLICT",
  );
  await runtime.restoreCheckpoint(checkpointId, true);
  assert.equal(await readFile(pathname, "utf8"), "before\n");
});

test("workspace patches are atomic, hash-guarded, and checkpointed", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const pathname = join(workspace, "patch-me.txt");
  await writeFile(pathname, "first\nsecond\nthird\n", "utf8");
  assert.equal(registry.descriptor("workspace.apply_patch")?.requiredPermission, "workspace_write");

  const read = await execute(registry, "read_only", "workspace.read_file", { path: "patch-me.txt" });
  const expectedSha256 = (read.output as { sha256: string }).sha256;
  const patch = [
    "--- a/patch-me.txt",
    "+++ b/patch-me.txt",
    "@@ -1,3 +1,4 @@",
    " first",
    "-second",
    "+changed",
    "+inserted",
    " third",
    "",
  ].join("\n");
  const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "patch-me.txt",
    patch,
    expectedSha256,
  });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.summary.resource, {
    kind: "file",
    path: "patch-me.txt",
    action: "updated",
    startLine: 2,
    endLine: 3,
  });
  assert.equal(await readFile(pathname, "utf8"), "first\nchanged\ninserted\nthird\n");
  assert.match(String((applied.output as { sha256: string }).sha256), /^[a-f0-9]{64}$/);

  const synonymousRetry = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "patch-me.txt",
    patch,
    expectedSha256,
  });
  assert.equal(synonymousRetry.ok, true);
  assert.equal(synonymousRetry.ledger?.state, "committed");
  assert.equal(synonymousRetry.ledger?.replayed, true);
  assert.deepEqual(synonymousRetry.output, applied.output);
  assert.equal(await readFile(pathname, "utf8"), "first\nchanged\ninserted\nthird\n");

  await runtime.restoreCheckpoint(applied.summary.checkpointId!);
  assert.equal(await readFile(pathname, "utf8"), "first\nsecond\nthird\n");
});

test("an already-applied patch is an auditable successful no-op, not a tool failure", async t => {
  const { workspace, registry } = await fixture(t);
  const pathname = join(workspace, "already-done.txt");
  await writeFile(pathname, "desired\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "already-done.txt" });
  const noOpPatch = [
    "--- a/already-done.txt",
    "+++ b/already-done.txt",
    "@@ -1 +1 @@",
    "-desired",
    "+desired",
    "",
  ].join("\n");
  const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "already-done.txt",
    patch: noOpPatch,
    expectedSha256: (read.output as { sha256: string }).sha256,
  });
  assert.equal(applied.ok, true);
  assert.equal((applied.output as { changed: boolean }).changed, false);
  assert.equal(applied.summary.checkpointId, undefined);
  assert.equal(await readFile(pathname, "utf8"), "desired\n");
});

test("workspace patches accept the common apply_patch envelope and repair inaccurate hunk counts", async t => {
  const { workspace, registry } = await fixture(t);
  const pathname = join(workspace, "wrapped-patch.txt");
  await writeFile(pathname, "alpha\nbeta\ngamma\ndelta\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "wrapped-patch.txt" });
  const patch = [
    "*** Begin Patch",
    "*** Update File: wrapped-patch.txt",
    // Deliberately inaccurate counts mirror model-produced patches rejected by `diff`.
    "@@ -1,99 +1,88 @@",
    " alpha",
    "-beta",
    "+changed",
    " gamma",
    "*** End Patch",
  ].join("\n");

  const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "wrapped-patch.txt",
    patch,
    expectedSha256: (read.output as { sha256: string }).sha256,
  });

  assert.equal(applied.ok, true);
  assert.equal(await readFile(pathname, "utf8"), "alpha\nchanged\ngamma\ndelta\n");
});

test("workspace patches accept an envelope header without its colon and a first hunk without @@ (round 31 live run)", async t => {
  const { workspace, registry } = await fixture(t);
  const pathname = join(workspace, "README.md");
  await writeFile(pathname, "# QA\n\nA tiny module.\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "README.md" });
  const patch = ["*** Begin Patch", "*** Update File README.md", " A tiny module.", "+", "+Run tests with: npm test", "*** End of File", "*** End Patch"].join("\n");
  const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "README.md", patch, expectedSha256: (read.output as { sha256: string }).sha256,
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.error));
  assert.equal(await readFile(pathname, "utf8"), "# QA\n\nA tiny module.\n\nRun tests with: npm test\n");
});

test("a bare *** Update File header patches the tool's own target path (round 33 live run)", async t => {
  const { workspace, registry } = await fixture(t);
  const pathname = join(workspace, "calc.js");
  await writeFile(pathname, "function add(a, b) { return a - b; }\nmodule.exports = { add };\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "calc.js" });
  for (const header of ["*** Update File", "*** Update File:"]) {
    const patch = ["*** Begin Patch", header, "@@", "-function add(a, b) { return a - b; }", "+function add(a, b) { return a + b; }", "*** End Patch"].join("\n");
    const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
      path: "calc.js", patch, expectedSha256: (read.output as { sha256: string }).sha256,
    });
    assert.equal(applied.ok, true, JSON.stringify(applied.error));
    assert.equal(await readFile(pathname, "utf8"), "function add(a, b) { return a + b; }\nmodule.exports = { add };\n");
    await writeFile(pathname, "function add(a, b) { return a - b; }\nmodule.exports = { add };\n", "utf8");
  }
});

test("workspace patches reject an envelope that names a different target", async t => {
  const { workspace, registry } = await fixture(t);
  const pathname = join(workspace, "target.txt");
  await writeFile(pathname, "before\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "target.txt" });
  const applied = await execute(registry, "workspace_write", "workspace.apply_patch", {
    path: "target.txt",
    patch: [
      "*** Begin Patch",
      "*** Update File: another.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "*** End Patch",
    ].join("\n"),
    expectedSha256: (read.output as { sha256: string }).sha256,
  });

  assert.equal(applied.error?.code, "PATCH_INVALID");
  assert.equal(await readFile(pathname, "utf8"), "before\n");
});

test("a checkpoint chain rewinds repeated writes as one validated operation", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const pathname = join(workspace, "timeline.txt");
  await writeFile(pathname, "turn-59\n", "utf8");

  const firstRead = await execute(registry, "read_only", "workspace.read_file", { path: "timeline.txt" });
  const firstWrite = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "timeline.txt",
    content: "turn-60\n",
    expectedSha256: (firstRead.output as { sha256: string }).sha256,
  }, "call-00000002");
  const secondRead = await execute(registry, "read_only", "workspace.read_file", { path: "timeline.txt" });
  const secondWrite = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "timeline.txt",
    content: "turn-100\n",
    expectedSha256: (secondRead.output as { sha256: string }).sha256,
  }, "call-00000003");

  const restored = await runtime.restoreCheckpointChain([
    secondWrite.summary.checkpointId!,
    firstWrite.summary.checkpointId!,
  ]);
  assert.deepEqual(restored.map(item => item.checkpointId), [
    secondWrite.summary.checkpointId,
    firstWrite.summary.checkpointId,
  ]);
  assert.equal(await readFile(pathname, "utf8"), "turn-59\n");
});

test("checkpoint diffs preserve the generated content and line totals", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const pathname = join(workspace, "story.txt");
  await writeFile(pathname, "first\nsecond\n", "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "story.txt" });
  const written = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "story.txt",
    content: "first\nchanged\nthird\n",
    expectedSha256: (read.output as { sha256: string }).sha256,
  });
  const diff = await runtime.getCheckpointDiff(written.summary.checkpointId!);
  assert.equal(diff.path, "story.txt");
  assert.equal(diff.kind, "modified");
  assert.equal(diff.binary, false);
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 1);
  assert.equal(diff.startLine, 2);
  assert.equal(diff.endLine, 3);
  assert.match(diff.patch, /\+changed/);
  assert.match(diff.patch, /-second/);
});

test("history content remains complete when the display patch exceeds its truncation limit", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const before = "a".repeat(520_000) + "\nBEFORE_END\n";
  const after = "b".repeat(520_000) + "\nAFTER_END\n";
  await writeFile(join(workspace, "large-history.txt"), before, "utf8");
  const read = await execute(registry, "read_only", "workspace.read_file", { path: "large-history.txt" });
  const written = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "large-history.txt", content: after,
    expectedSha256: (read.output as { sha256: string }).sha256,
  });
  assert.equal(written.ok, true);
  const diff = await runtime.getCheckpointDiff(written.summary.checkpointId!, true);
  assert.equal(diff.truncated, true);
  assert.equal(diff.patch.length, 500_000);
  assert.equal(diff.beforeContent, before);
  assert.equal(diff.afterContent, after);
});

test("new files can be rolled back without exposing checkpoint internals to tools", async t => {
  const { workspace, runtime, registry } = await fixture(t);
  const written = await execute(registry, "workspace_write", "workspace.write_file", {
    path: "nested/new.txt",
    content: "created\n",
    expectedSha256: null,
  });
  assert.equal(written.ok, true);
  assert.deepEqual(written.summary.resource, {
    kind: "file",
    path: "nested/new.txt",
    action: "created",
    startLine: 1,
    endLine: 1,
  });
  assert.equal(await readFile(join(workspace, "nested", "new.txt"), "utf8"), "created\n");
  await runtime.restoreCheckpoint(written.summary.checkpointId!);
  await assert.rejects(readFile(join(workspace, "nested", "new.txt"), "utf8"), { code: "ENOENT" });
});

test("write and process tools remain unavailable below their permission level", async t => {
  const { registry } = await fixture(t, "read_only");
  const write = await execute(registry, "read_only", "workspace.write_file", { path: "x.txt", content: "x" });
  assert.equal(write.error?.code, "PERMISSION_DENIED");
  const processResult = await execute(registry, "workspace_write", "process.run", { command: process.execPath });
  assert.equal(processResult.error?.code, "PERMISSION_DENIED");
});

test("full-access process execution uses argument arrays and returns bounded output", async t => {
  const { registry } = await fixture(t, "full_access");
  const result = await execute(registry, "full_access", "process.run", {
    command: process.execPath,
    args: ["-e", "console.log('agent-process-ok')"],
    timeoutMs: 10_000,
  });
  assert.equal(result.ok, true);
  assert.equal((result.output as { exitCode: number }).exitCode, 0);
  assert.match((result.output as { stdout: string }).stdout, /agent-process-ok/);
  assert.equal(result.summary.outcome, "succeeded");
  assert.equal(result.summary.commandLine, formatProcessCommandLine(process.execPath, ["-e", "console.log('agent-process-ok')"]));
});

test("workspace process tools honor a host-native process registry and treat its PTY stream as stdout", async t => {
  const root = mkdtempSync(join(tmpdir(), "nextmux-agent-injected-terminal-"));
  const workspace = join(root, "workspace");
  const checkpoints = join(root, "checkpoints");
  await mkdir(workspace);
  let started = false;
  let disposed = false;
  const snapshot: ManagedProcessSnapshot = {
    processId: "proc-00000000-0000-4000-8000-000000000001",
    chunks: [{ sequence: 1, stream: "pty", text: "shared-theia-terminal\n" }],
    firstAvailableSequence: 1,
    nextSequence: 1,
    latestSequence: 1,
    hasMore: false,
    retainedCharacters: 22,
    outputCharacterLimit: 80_000,
    running: false,
    tty: true,
    exitCode: 0,
    signal: null,
    truncated: false,
  };
  const session: ManagedProcessSessionLike = {
    processId: snapshot.processId,
    running: false,
    tty: true,
    async ready() {},
    async waitForExit() { return snapshot; },
    async read() { return snapshot; },
    snapshot() { return snapshot; },
    async write() {},
    async closeStdin() {},
    resize() {},
    async terminate() { return false; },
  };
  const processRegistry: ManagedProcessRegistryLike = {
    async start(options) {
      started = true;
      await options.callbacks?.onStarted?.(session.processId);
      await options.callbacks?.onOutput?.(session.processId, snapshot.chunks[0]);
      await options.callbacks?.onExited?.(session.processId, 0, null);
      return session;
    },
    get: processId => processId === session.processId ? session : undefined,
    release: processId => processId === session.processId,
    async dispose() { disposed = true; },
  };
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: workspace,
    checkpointRoot: checkpoints,
    permissionMode: "full_access",
    processRegistry,
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const result = await execute(registry, "full_access", "process.run", { command: "node", args: ["server.js"] });
  assert.equal(started, true);
  assert.equal(result.ok, true);
  assert.match((result.output as { stdout: string }).stdout, /shared-theia-terminal/);
  await runtime.dispose();
  assert.equal(disposed, true);
});

test("process.run streams stdout and stderr before returning the complete model result", async t => {
  const { registry } = await fixture(t, "full_access");
  const chunks: { stream: "stdout" | "stderr" | "pty"; text: string }[] = [];
  let settled = false;
  let resolveFirstOutput!: () => void;
  const firstOutput = new Promise<void>(resolve => { resolveFirstOutput = resolve; });
  const running = registry.execute({
    id: "call-process-live-output",
    name: "process.run",
    arguments: {
      command: process.execPath,
      args: ["-e", "process.stdout.write('first\\n'); setTimeout(() => process.stderr.write('second\\n'), 800)"],
      timeoutMs: 10_000,
    },
  }, "full_access", {
    runId: "run-process-live-output",
    onOutput: output => { chunks.push(output); resolveFirstOutput(); },
  }).finally(() => { settled = true; });

  await Promise.race([
    firstOutput,
    new Promise((_, reject) => setTimeout(() => reject(new Error("first output was not streamed")), 2_000)),
  ]);
  assert.equal(settled, false, "the process should still be running when its first output is visible");
  assert.equal(chunks.some(chunk => chunk.stream === "stdout" && chunk.text.includes("first")), true);

  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(chunks.some(chunk => chunk.stream === "stderr" && chunk.text.includes("second")), true);
  assert.match((result.output as { stdout: string }).stdout, /first/);
  assert.match((result.output as { stderr: string }).stderr, /second/);
});

test("runner emits ordered live process output while returning the same output to the model", async t => {
  const { registry } = await fixture(t, "full_access");
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "full_access",
    model: {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) return {
          content: "正在观察实时终端输出。",
          toolCalls: [{
            id: "process-live-event",
            name: "process.run",
            arguments: {
              command: process.execPath,
              args: ["-e", "process.stdout.write('live-one\\n'); setTimeout(() => process.stderr.write('live-two\\n'), 80)"],
            },
          }],
        };
        assert.match(request.messages.at(-1)?.content ?? "", /live-one/);
        assert.match(request.messages.at(-1)?.content ?? "", /live-two/);
        return { content: "实时日志已经读取完成。" };
      },
    },
  }).run({ prompt: "watch logs", runId: "run-process-live-event-001" });

  const startedIndex = result.events.findIndex(event => event.type === "tool_started" && event.callId === "process-live-event");
  const outputEvents = result.events.filter(event => event.type === "tool_output" && event.callId === "process-live-event");
  const completedIndex = result.events.findIndex(event => event.type === "tool_completed" && event.callId === "process-live-event");
  assert.equal(outputEvents.some(event => event.type === "tool_output" && event.stream === "stdout" && event.chunk.includes("live-one")), true);
  assert.equal(outputEvents.some(event => event.type === "tool_output" && event.stream === "stderr" && event.chunk.includes("live-two")), true);
  assert.equal(outputEvents.every((event, index) => event.type === "tool_output" && event.sequence === index + 1), true);
  assert.ok(startedIndex >= 0 && completedIndex > startedIndex);
  assert.ok(result.events.findIndex(event => event.type === "tool_output") > startedIndex);
  const lastOutputIndex = result.events.reduce(
    (lastIndex, event, index) => event.type === "tool_output" ? index : lastIndex,
    -1,
  );
  assert.ok(lastOutputIndex < completedIndex);
});

test("process.start and process.read expose only fresh long-running output after a sequence cursor", async t => {
  const { registry } = await fixture(t, "full_access");
  const started = await execute(registry, "full_access", "process.start", {
    command: process.execPath,
    args: ["-e", "process.stdout.write('phase-one\\n'); setTimeout(() => process.stdout.write('phase-two\\n'), 700); setTimeout(() => process.exit(0), 1000)"],
    tty: false,
    timeoutMs: 10_000,
  });
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string }).processId;
  assert.match(processId, /^proc-[0-9a-f-]{36}$/i);

  const first = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: 0,
    waitMs: 2_000,
  }, "call-process-read-first");
  assert.equal(first.ok, true);
  const firstSnapshot = first.output as {
    chunks: readonly { sequence: number; text: string }[];
    nextSequence: number;
    running: boolean;
  };
  assert.match(firstSnapshot.chunks.map(chunk => chunk.text).join(""), /phase-one/);
  assert.doesNotMatch(firstSnapshot.chunks.map(chunk => chunk.text).join(""), /phase-two/);

  const second = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: firstSnapshot.nextSequence,
    waitMs: 2_000,
  }, "call-process-read-second");
  assert.equal(second.ok, true);
  const secondSnapshot = second.output as {
    chunks: readonly { sequence: number; text: string }[];
    nextSequence: number;
  };
  const freshOutput = secondSnapshot.chunks.map(chunk => chunk.text).join("");
  assert.match(freshOutput, /phase-two/);
  assert.doesNotMatch(freshOutput, /phase-one/);
  assert.ok(secondSnapshot.nextSequence > firstSnapshot.nextSequence);
});

test("process.start can launch the user-selected terminal profile without accepting a renderer path", async t => {
  const root = mkdtempSync(join(tmpdir(), "nextmux-agent-terminal-profile-"));
  const workspace = join(root, "workspace");
  const checkpoints = join(root, "checkpoints");
  await mkdir(workspace);
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: workspace,
    checkpointRoot: checkpoints,
    permissionMode: "full_access",
    terminalProfile: {
      id: "selected-shell",
      label: "Selected shell",
      shellPath: process.execPath,
      shellArgs: ["-e", "process.stdout.write('selected-profile-live:' + process.env.NEXTMUX_PROFILE_MARKER + '\\n'); setTimeout(() => process.exit(0), 100)"],
      env: { NEXTMUX_PROFILE_MARKER: "profile-env-ok" },
    },
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const started = await execute(registry, "full_access", "process.start", {
    useTerminalProfile: true,
    tty: false,
    timeoutMs: 5_000,
  }, "start-selected-profile");
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string }).processId;
  const read = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: 0,
    waitMs: 1_000,
    maxCharacters: 8_192,
  }, "read-selected-profile");
  assert.match((read.output as { chunks: readonly { text: string }[] }).chunks.map(chunk => chunk.text).join(""), /selected-profile-live:profile-env-ok/);
  assert.match(registry.descriptor("process.start")?.description || "", /Selected shell/);
  assert.match(registry.descriptor("process.run")?.description || "", /user-selected terminal profile/i);
  assert.doesNotMatch(registry.descriptor("process.run")?.description || "", /powershell\.exe\/cmd\.exe/i);
});

test("selected terminal profiles preserve cross-platform login, temp, SSH-agent, and XDG environment", async t => {
  const root = mkdtempSync(join(tmpdir(), "nextmux-agent-terminal-env-"));
  const workspace = join(root, "workspace");
  const checkpoints = join(root, "checkpoints");
  await mkdir(workspace);
  const expected = {
    USER: "nextmux-user",
    LOGNAME: "nextmux-login",
    TMPDIR: "/tmp/nextmux-terminal",
    SSH_AUTH_SOCK: "/tmp/nextmux-agent.sock",
    SSH_AGENT_PID: "4242",
    XDG_CONFIG_HOME: "/tmp/nextmux-xdg/config",
    XDG_CACHE_HOME: "/tmp/nextmux-xdg/cache",
    XDG_DATA_HOME: "/tmp/nextmux-xdg/data",
    XDG_STATE_HOME: "/tmp/nextmux-xdg/state",
    XDG_RUNTIME_DIR: "/tmp/nextmux-xdg/runtime",
  } as const;
  const previous = Object.fromEntries(Object.keys(expected).map(name => [name, process.env[name]]));
  Object.assign(process.env, expected);
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: workspace,
    checkpointRoot: checkpoints,
    permissionMode: "full_access",
    terminalProfile: {
      id: "selected-shell-environment",
      label: "Selected shell environment",
      shellPath: process.execPath,
      shellArgs: ["-e", `process.stdout.write('NEXTMUX_ENV=' + JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(expected))}.map(name => [name, process.env[name]]))))`],
    },
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const started = await execute(registry, "full_access", "process.start", {
    useTerminalProfile: true,
    tty: false,
    timeoutMs: 5_000,
  }, "start-selected-profile-environment");
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string }).processId;
  const read = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: 0,
    waitMs: 1_000,
    maxCharacters: 16_384,
  }, "read-selected-profile-environment");
  const output = (read.output as { chunks: readonly { text: string }[] }).chunks.map(chunk => chunk.text).join("");
  const serialized = output.match(/NEXTMUX_ENV=(\{.*\})/)?.[1];
  assert.ok(serialized, `missing environment marker in ${JSON.stringify(output)}`);
  assert.deepEqual(JSON.parse(serialized), expected);
});

test("process.write feeds a managed process without coupling stdin to the model request", async t => {
  const { registry } = await fixture(t, "full_access");
  const started = await execute(registry, "full_access", "process.start", {
    command: process.execPath,
    args: ["-e", "process.stdin.once('data', value => { process.stdout.write('echo:' + value); process.exit(0); }); process.stdin.resume()"],
    pipeStdin: true,
    tty: false,
    timeoutMs: 10_000,
  });
  const processId = (started.output as { processId: string }).processId;
  const written = await execute(registry, "full_access", "process.write", {
    processId,
    data: "hello-terminal\\n",
  }, "call-process-write");
  assert.equal(written.ok, true);

  const read = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: 0,
    waitMs: 2_000,
  }, "call-process-read-echo");
  assert.equal(read.ok, true);
  assert.match((read.output as { chunks: readonly { text: string }[] }).chunks.map(chunk => chunk.text).join(""), /echo:hello-terminal/);
});

test("process.start can use a real PTY whose terminal input and output remain live", async t => {
  const { registry } = await fixture(t, "full_access");
  const shell = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : process.env.SHELL || "/bin/sh";
  const started = await execute(registry, "full_access", "process.start", {
    command: shell,
    args: [],
    tty: true,
    columns: 100,
    rows: 30,
    timeoutMs: 10_000,
  }, "call-start-pty-shell");
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string; tty: boolean }).processId;
  assert.equal((started.output as { tty: boolean }).tty, true);

  const lineEnding = process.platform === "win32" ? "\r\n" : "\n";
  const written = await execute(registry, "full_access", "process.write", {
    processId,
    data: `echo NEXTMUX_PTY_LIVE${lineEnding}`,
  }, "call-write-pty-shell");
  assert.equal(written.ok, true);

  let cursor = 0;
  let output = "";
  let running = true;
  const outputDeadline = Date.now() + 8_000;
  let attempt = 0;
  while (Date.now() < outputDeadline && !output.includes("NEXTMUX_PTY_LIVE")) {
    const read = await execute(registry, "full_access", "process.read", {
      processId,
      afterSequence: cursor,
      waitMs: 1_000,
    }, `call-read-pty-shell-${attempt}`);
    attempt += 1;
    assert.equal(read.ok, true);
    const snapshot = read.output as {
      chunks: readonly { sequence: number; stream: string; text: string }[];
      nextSequence: number;
      running: boolean;
      tty: boolean;
    };
    assert.equal(snapshot.tty, true);
    assert.equal(snapshot.chunks.every(chunk => chunk.stream === "pty"), true);
    output += snapshot.chunks.map(chunk => chunk.text).join("");
    cursor = snapshot.nextSequence;
    running = snapshot.running;
  }
  assert.match(output, /NEXTMUX_PTY_LIVE/);
  assert.equal(running, true, "the interactive shell must remain live after the first command");

  const exited = await execute(registry, "full_access", "process.write", {
    processId,
    data: `exit${lineEnding}`,
  }, "call-exit-pty-shell");
  assert.equal(exited.ok, true);
  const exitDeadline = Date.now() + 8_000;
  while (Date.now() < exitDeadline && running) {
    const read = await execute(registry, "full_access", "process.read", {
      processId,
      afterSequence: cursor,
      waitMs: 1_000,
    }, `call-read-pty-exit-${attempt}`);
    attempt += 1;
    assert.equal(read.ok, true);
    const snapshot = read.output as {
      chunks: readonly { sequence: number; stream: string; text: string }[];
      nextSequence: number;
      running: boolean;
      tty: boolean;
    };
    assert.equal(snapshot.tty, true);
    assert.equal(snapshot.chunks.every(chunk => chunk.stream === "pty"), true);
    output += snapshot.chunks.map(chunk => chunk.text).join("");
    cursor = snapshot.nextSequence;
    running = snapshot.running;
  }
  assert.equal(running, false, `PTY still running after ${attempt} reads: ${JSON.stringify(output)}`);
});

test("a copied checkpoint store can be rebound to an independent workspace", async t => {
  const source = await fixture(t);
  const targetWorkspace = join(source.root, "branch-workspace");
  const targetCheckpoints = join(source.root, "branch-checkpoints");
  await mkdir(targetWorkspace);
  await mkdir(targetCheckpoints);
  const sourcePath = join(source.workspace, "timeline.txt");
  await writeFile(sourcePath, "turn-59\n", "utf8");

  const initial = await execute(source.registry, "read_only", "workspace.read_file", { path: "timeline.txt" });
  const written = await execute(source.registry, "workspace_write", "workspace.write_file", {
    path: "timeline.txt",
    content: "turn-60\n",
    expectedSha256: (initial.output as { sha256: string }).sha256,
  }, "call-branch-checkpoint-01");

  await cp(source.workspace, targetWorkspace, { recursive: true, force: true });
  await cp(source.checkpoints, targetCheckpoints, { recursive: true, force: true });
  const rebound = await rebaseWorkspaceCheckpointStore({
    checkpointRoot: targetCheckpoints,
    sourceWorkspaceRoot: source.workspace,
    targetWorkspaceRoot: targetWorkspace,
  });
  assert.equal(rebound.manifestsRebased, 1);

  const targetRuntime = await WorkspaceToolRuntime.create({
    workspaceRoot: targetWorkspace,
    checkpointRoot: targetCheckpoints,
    permissionMode: "workspace_write",
  });
  t.after(() => targetRuntime.dispose());
  await targetRuntime.restoreCheckpointChain([written.summary.checkpointId!]);

  assert.equal(await readFile(join(targetWorkspace, "timeline.txt"), "utf8"), "turn-59\n");
  assert.equal(await readFile(sourcePath, "utf8"), "turn-60\n");
});

test("aborting process.read cancels its long-poll promptly and returns no later snapshot", async t => {
  const { registry } = await fixture(t, "full_access");
  const started = await execute(registry, "full_access", "process.start", {
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    // A real PTY can legitimately emit a delayed startup repaint after the
    // catch-up snapshot, which would satisfy the read before cancellation and
    // make this cancellation-only assertion nondeterministic. Pipe mode keeps
    // the process silent while exercising the same long-poll/AbortSignal path.
    tty: false,
    timeoutMs: 10_000,
  }, "start-abortable-process-read");
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string }).processId;
  await new Promise(resolve => setTimeout(resolve, 100));
  const caughtUp = await execute(registry, "full_access", "process.read", {
    processId,
    afterSequence: 0,
    waitMs: 0,
  }, "catch-up-before-abortable-process-read");
  const cursor = (caughtUp.output as { latestSequence: number }).latestSequence;
  const controller = new AbortController();
  const startedAt = Date.now();
  const reading = registry.execute({
    id: "abort-process-read",
    name: "process.read",
    arguments: { processId, afterSequence: cursor, waitMs: 2_000 },
  }, "full_access", { runId: "run-abort-process-read", signal: controller.signal });
  setTimeout(() => controller.abort(), 50);

  const result = await reading;
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "CANCELLED");
  assert.equal(Date.now() - startedAt < 500, true);
});

test("one long-lived default PTY streams sustained logs, resizes, and advances one lossless cursor", async t => {
  const { runtime, registry } = await fixture(t, "full_access");
  const source = [
    "process.stdin.setEncoding('utf8');",
    "const reportSize=()=>process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\\n`);",
    "reportSize();",
    "let phase=0; const logs=setInterval(()=>{ phase+=1; process.stdout.write(`LIVE_PHASE_${phase}\\n`); if(phase===20) clearInterval(logs); },25);",
    "process.stdin.on('data',value=>{ if(value.includes('report')) reportSize(); if(value.includes('stop')) process.exit(0); });",
    "setInterval(()=>{},1000);",
  ].join("\n");
  const started = await execute(registry, "full_access", "process.start", {
    command: process.execPath,
    args: ["-e", source],
    columns: 88,
    rows: 24,
    timeoutMs: 10_000,
  }, "start-sustained-default-pty");
  assert.equal(started.ok, true);
  const startOutput = started.output as {
    processId: string;
    tty: boolean;
    outputCharacterLimit: number;
  };
  assert.equal(startOutput.tty, true, "process.start must default to a real PTY");
  assert.equal(startOutput.outputCharacterLimit > 0, true);

  let cursor = 0;
  let output = "";
  let running = true;
  const sequences: number[] = [];
  for (let attempt = 0; attempt < 40 && !output.includes("LIVE_PHASE_20"); attempt += 1) {
    const read = await execute(registry, "full_access", "process.read", {
      processId: startOutput.processId,
      afterSequence: cursor,
      maxCharacters: 4_096,
      waitMs: 500,
    }, `read-sustained-default-pty-${attempt}`);
    assert.equal(read.ok, true);
    const snapshot = read.output as {
      chunks: readonly { sequence: number; stream: string; text: string }[];
      nextSequence: number;
      latestSequence: number;
      hasMore: boolean;
      running: boolean;
    };
    assert.equal(snapshot.chunks.every(chunk => chunk.stream === "pty"), true);
    output += snapshot.chunks.map(chunk => chunk.text).join("");
    sequences.push(...snapshot.chunks.map(chunk => chunk.sequence));
    assert.equal(snapshot.nextSequence >= cursor, true);
    assert.equal(snapshot.latestSequence >= snapshot.nextSequence, true);
    cursor = snapshot.nextSequence;
    running = snapshot.running;
  }
  assert.equal(running, true, "the PTY must remain live after sustained log production");
  for (let phase = 1; phase <= 20; phase += 1) {
    assert.equal((output.match(new RegExp(`LIVE_PHASE_${phase}(?!\\d)`, "g")) || []).length, 1);
  }
  assert.deepEqual(sequences, [...new Set(sequences)], "cursor reads must not replay a sequence");

  assert.deepEqual(runtime.resizeManagedProcess(startOutput.processId, 101, 37), { resized: true });
  const lineEnding = process.platform === "win32" ? "\r\n" : "\n";
  const reported = await execute(registry, "full_access", "process.write", {
    processId: startOutput.processId,
    data: `report${lineEnding}`,
  }, "write-resize-report-to-default-pty");
  assert.equal(reported.ok, true);
  const resizeObserved = (): boolean => process.platform === "win32"
    ? output.includes("\u001b[8;37;101t")
    : output.includes("SIZE:101x37");
  for (let attempt = 0; attempt < 10 && !resizeObserved(); attempt += 1) {
    const read = await execute(registry, "full_access", "process.read", {
      processId: startOutput.processId,
      afterSequence: cursor,
      waitMs: 500,
    }, `read-resize-report-from-default-pty-${attempt}`);
    const snapshot = read.output as {
      chunks: readonly { sequence: number; text: string }[];
      nextSequence: number;
    };
    output += snapshot.chunks.map(chunk => chunk.text).join("");
    sequences.push(...snapshot.chunks.map(chunk => chunk.sequence));
    cursor = snapshot.nextSequence;
  }
  if (process.platform === "win32") {
    assert.match(output, /\u001b\[8;37;101t/, "ConPTY must publish its resize control sequence to the shared stream");
  } else {
    assert.match(output, /SIZE:101x37/);
  }

  const stopped = await execute(registry, "full_access", "process.terminate", {
    processId: startOutput.processId,
  }, "terminate-sustained-default-pty");
  assert.equal(stopped.ok, true);
  assert.equal((stopped.output as { running: boolean }).running, false);
  assert.equal((stopped.output as { terminationReason: string }).terminationReason, "requested");
});

test("the model can follow a live process cursor and receives every delayed log phase", async t => {
  const { registry } = await fixture(t, "full_access");
  let modelCalls = 0;
  let processId = "";
  let nextSequence = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "full_access",
    model: {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) return {
          content: "正在启动持续日志并读取实时进度。",
          toolCalls: [{
            id: "start-live-log-session",
            name: "process.start",
            arguments: {
              command: process.execPath,
              args: ["-e", "process.stdout.write('ready\\n'); setTimeout(() => process.stdout.write('finished\\n'), 700); setTimeout(() => process.exit(0), 900)"],
              tty: false,
              timeoutMs: 10_000,
            },
          }],
        };
        const toolResult = JSON.parse(request.messages.at(-1)?.content || "null") as {
          ok: boolean;
          output: { processId?: string; nextSequence?: number; chunks?: readonly { text: string }[] };
        };
        if (modelCalls === 2) {
          processId = toolResult.output.processId || "";
          assert.match(processId, /^proc-/);
          return {
            content: "进程已经启动，正在读取第一段日志。",
            toolCalls: [{
              id: "read-live-log-ready",
              name: "process.read",
              arguments: { processId, afterSequence: 0, waitMs: 2_000 },
            }],
          };
        }
        if (modelCalls === 3) {
          assert.match(toolResult.output.chunks?.map(chunk => chunk.text).join("") || "", /ready/);
          nextSequence = toolResult.output.nextSequence || 0;
          return {
            content: "已看到启动日志，正在等待下一段新日志。",
            toolCalls: [{
              id: "read-live-log-finished",
              name: "process.read",
              arguments: { processId, afterSequence: nextSequence, waitMs: 2_000 },
            }],
          };
        }
        const latest = toolResult.output.chunks?.map(chunk => chunk.text).join("") || "";
        assert.match(latest, /finished/);
        assert.doesNotMatch(latest, /ready/);
        return { content: "已按顺序实时读取 ready 和 finished 两段日志。" };
      },
    },
  }).run({ prompt: "持续观察日志直到完成", runId: "run-managed-live-log-session-001" });

  assert.equal(result.finalText, "已按顺序实时读取 ready 和 finished 两段日志。");
  assert.equal(modelCalls, 4);
});

test("disposing the workspace runtime terminates every outstanding managed process", async t => {
  const { runtime, registry } = await fixture(t, "full_access");
  let resolveExited!: () => void;
  const exited = new Promise<void>(resolve => { resolveExited = resolve; });
  const started = await registry.execute({
    id: "start-process-for-dispose",
    name: "process.start",
    arguments: {
      command: process.execPath,
      args: ["-e", "setInterval(() => process.stdout.write('alive\\n'), 100)"],
      tty: false,
      timeoutMs: 30_000,
    },
  }, "full_access", {
    runId: "run-process-for-dispose",
    onProcessExited: () => resolveExited(),
  });
  assert.equal(started.ok, true);

  await runtime.dispose();
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error("managed process was not terminated during dispose")), 3_000)),
  ]);
});

test("process.run records a non-zero command exit as a failed command outcome", async t => {
  const { registry } = await fixture(t, "full_access");
  const result = await execute(registry, "full_access", "process.run", {
    command: process.execPath,
    args: ["-e", "process.stderr.write('expected failure'); process.exit(7)"],
    timeoutMs: 10_000,
  });

  assert.equal(result.ok, true, "the process tool itself completed and returned a result");
  assert.equal((result.output as { exitCode: number }).exitCode, 7);
  assert.equal(result.summary.outcome, "failed");
  assert.equal(result.summary.commandLine, formatProcessCommandLine(process.execPath, ["-e", "process.stderr.write('expected failure'); process.exit(7)"]));
});

test("agent activity preserves a failed command outcome without treating the tool transport as broken", async t => {
  const { registry } = await fixture(t, "full_access");
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "full_access",
    model: {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: "正在运行预期失败的诊断命令。",
            toolCalls: [{
              id: "process-non-zero-activity",
              name: "process.run",
              arguments: { command: process.execPath, args: ["-e", "process.exit(3)"] },
            }],
          };
        }
        assert.match(request.messages.at(-1)?.content ?? "", /\"exitCode\":3/);
        return { content: "命令失败已记录，诊断完成。" };
      },
    },
  }).run({ prompt: "run diagnostic", runId: "run-command-outcome-activity-001" });

  const completed = result.events.find(event => event.type === "tool_completed");
  assert.equal(completed?.type === "tool_completed" ? completed.ok : undefined, true);
  assert.equal(completed?.type === "tool_completed" ? completed.status : undefined, "failed");
  assert.equal(completed?.type === "tool_completed" ? completed.summary.outcome : undefined, "failed");
  assert.equal(result.events.some(event => event.type === "assistant_progress"
    && event.origin === "runtime" && event.content.includes("The operation failed")), true);
});

test("a tool failure has an explicit failed completion while the model can recover and summarize", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.recoverable_failure",
    description: "Fail once so the model can recover",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    throw new AgentToolError("TOOL_BROKEN", "The requested operation failed");
  });
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { toolCalls: [{ id: "recoverable-failure-1", name: "test.recoverable_failure", arguments: {} }] };
        }
        assert.match(request.messages.at(-1)?.content ?? "", /TOOL_BROKEN/);
        return { content: "The tool failure was handled and no success was fabricated." };
      },
    },
  }).run({ prompt: "handle a tool failure", runId: "run-tool-failure-state-001" });

  const completed = result.events.find(event => event.type === "tool_completed");
  assert.equal(completed?.type === "tool_completed" ? completed.status : undefined, "failed");
  assert.deepEqual(completed?.type === "tool_completed" ? completed.failure : undefined, {
    code: "TOOL_BROKEN",
    message: "The requested operation failed",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, "completed");
  assert.equal(result.finalText, "The tool failure was handled and no success was fabricated.");
});

test("process.run supports a portable pwd alias without spawning a missing Windows executable", async t => {
  const { workspace, registry } = await fixture(t, "full_access");
  const result = await execute(registry, "full_access", "process.run", { command: "pwd" });
  assert.equal(result.ok, true);
  assert.equal((result.output as { exitCode: number }).exitCode, 0);
  assert.equal((result.output as { stdout: string }).stdout.trim(), await realpath(workspace));
});

test("Windows process execution resolves PATHEXT command shims without enabling shell mode", {
  skip: process.platform !== "win32",
}, async t => {
  const { workspace, registry } = await fixture(t, "full_access");
  const bin = join(workspace, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "nextmux-process-shim.cmd"), [
    "@echo off",
    "echo nextmux-command-shim-ok",
    "echo argument=[%~1]",
  ].join("\r\n"), "utf8");

  const previousPath = process.env.PATH;
  const previousPathExt = process.env.PATHEXT;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.PATHEXT = previousPathExt?.toUpperCase().includes(".CMD")
    ? previousPathExt
    : `.CMD${delimiter}${previousPathExt ?? ""}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = previousPathExt;
  });

  const result = await execute(registry, "full_access", "process.run", {
    command: "nextmux-process-shim",
    args: ["alpha beta"],
    timeoutMs: 10_000,
  });
  assert.equal(result.ok, true);
  assert.equal((result.output as { exitCode: number }).exitCode, 0);
  assert.match((result.output as { stdout: string }).stdout, /nextmux-command-shim-ok/);
  assert.match((result.output as { stdout: string }).stdout, /argument=\[alpha beta\]/);
});

test("cancelling process.run terminates the complete child process tree", async t => {
  const { workspace, registry } = await fixture(t, "full_access");
  const leakedMarker = join(workspace, "grandchild-survived.txt");
  const grandchildSource = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(leakedMarker)}, 'leaked'), 900)`;
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' });`,
    "process.stdout.write('grandchild-started\\n');",
    "setTimeout(() => {}, 30000);",
  ].join("\n");
  const controller = new AbortController();
  let childStarted = false;
  const running = registry.execute({
    id: "call-cancel-process-tree",
    name: "process.run",
    arguments: { command: process.execPath, args: ["-e", parentSource], timeoutMs: 10_000 },
  }, "full_access", { runId: "run-cancel-process-tree", signal: controller.signal,
    onOutput: output => {
      if (output.text.includes('grandchild-started')) { childStarted = true; controller.abort(); }
    },
  });
  const result = await running;
  assert.equal(childStarted, true, "cancel only after the descendant exists, independent of process startup latency");
  assert.equal(result.ok, true, "the process tool transport returns the preserved terminated snapshot");
  assert.equal(result.summary.terminationReason, "cancelled");
  assert.equal((result.output as { terminationReason?: string }).terminationReason, "cancelled");
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1_100));
  await assert.rejects(readFile(leakedMarker, "utf8"), { code: "ENOENT" });
});

test("agent loop executes model-selected tools while UI events contain summaries only", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  await writeFile(join(workspace, "secret.txt"), "private-file-body\n", "utf8");
  const canonical = await realpath(join(workspace, "secret.txt"));
  const requests: AgentModelRequest[] = [];
  const model: AgentModelClient = {
    async complete(request) {
      requests.push(request);
      if (requests.length === 1) {
        assert.equal(request.tools.some(tool => tool.name === "workspace.write_file"), false);
        assert.match(request.instructions ?? "", /progress sentence/i);
        assert.doesNotMatch(request.instructions ?? "", /you are NextMux/i,
          "the desktop host must not override the selected model's identity");
        assert.match(request.instructions ?? "", /user-selected terminal profile/i);
        assert.doesNotMatch(request.instructions ?? "", /powershell\.exe\/cmd\.exe/i,
          "platform-neutral agent instructions must not force Windows shells on macOS");
        return {
          content: "正在读取 secret.txt，确认文件内容。",
          toolCalls: [{ id: "read-call-1", name: "workspace.read_file", arguments: { path: "secret.txt" } }],
          usage: { inputTokens: 10, outputTokens: 2 },
        };
      }
      assert.equal(request.messages.at(-1)?.role, "tool");
      assert.match(request.messages.at(-1)?.content ?? "", /private-file-body/);
      return { content: "文件检查完成。", usage: { inputTokens: 8, outputTokens: 5 } };
    },
  };
  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only", reasoningEffort: "xhigh" })
    .run({ prompt: "读取文件", runId: "run-agent-loop-001" });
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "文件检查完成。");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 7 });
  assert.equal(JSON.stringify(result.events).includes("private-file-body"), false);
  const progress = result.events.find(event => event.type === "assistant_progress");
  assert.equal(progress?.type === "assistant_progress" ? progress.content : undefined, "正在读取 secret.txt，确认文件内容。");
  assert.equal(progress?.type === "assistant_progress" ? progress.origin : undefined, "model");
  assert.equal(result.events.some(event => event.type === "assistant_progress"
    && event.origin === "runtime"
    && event.content === "Read secret.txt. Continuing from the result."), true);
  const started = result.events.find(event => event.type === "tool_started");
  assert.equal(started?.type === "tool_started" ? started.summary?.title : undefined, "Read secret.txt");
  assert.deepEqual(started?.type === "tool_started" ? started.summary?.resource : undefined, {
    kind: "file",
    path: "secret.txt",
    action: "read",
    startLine: 1,
  });
  const completed = result.events.find(event => event.type === "tool_completed");
  assert.deepEqual(completed?.type === "tool_completed" ? completed.summary.resource : undefined, {
    kind: "file", path: canonical, action: "read", startLine: 1, endLine: 2,
  });
  assert.equal(requests.every(request => request.reasoningEffort === "xhigh"), true);
});

test("successful read events preserve long canonical paths with spaces while failed targets stay unresolved", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  const segments = Array.from({ length: 6 }, (_, index) => `folder ${index}  ${"x".repeat(80)}`);
  const directory = join(workspace, ...segments);
  await mkdir(directory, { recursive: true });
  const relativePath = join(...segments, "sk-1234567890abcdefghijkl  notes.txt");
  await writeFile(join(workspace, relativePath), "read content\n");
  const canonical = await realpath(join(workspace, relativePath));
  assert.ok(canonical.length > 500);
  let turns = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "read_only", model: {
    async complete() {
      if (turns++ === 0) return { toolCalls: [
        { id: "canonical-read", name: "workspace.read_file", arguments: { path: relativePath } },
        { id: "missing-read", name: "workspace.read_file", arguments: { path: "missing.txt" } },
      ] };
      return { content: "Read checked." };
    },
  } }).run({ prompt: "Read the files", runId: "run-canonical-read-001" });
  const completed = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "canonical-read");
  assert.equal(completed?.ok, true);
  assert.equal(completed?.summary.resource?.kind === "file" && completed.summary.resource.path, canonical);
  const started = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_started" }> =>
    event.type === "tool_started" && event.callId === "canonical-read");
  assert.ok(started?.summary?.resource?.kind === "file");
  assert.equal(started.summary.resource.path, relativePath);
  const failed = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "missing-read");
  assert.equal(failed?.ok, false);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.summary.resource?.kind === "file" && failed.summary.resource.path, "missing.txt");
  assert.equal(failed?.failure?.code, "PATH_NOT_FOUND");
});

test("file resource summaries preserve exact bounded POSIX and Windows paths and reject malformed identities", async () => {
  const paths = [
    "/folder  with spaces/sk-1234567890abcdefghijkl.txt ",
    String.raw`C:\Users\Folder  Name\sk-1234567890abcdefghijkl.txt`,
    String.raw`\\server\shared folder\notes.txt`,
    `/${"a".repeat(4095)}`,
    `/${"a".repeat(4096)}`,
    "/file\0name", "/file\rname", "/file\nname", "",
  ];
  const registry = new AgentToolRegistry();
  registry.register({ name: "test.file_resource", description: "Return file identities", inputSchema: { type: "object" },
    requiredPermission: "read_only", source: "builtin" }, async input => ({ modelOutput: {}, summary: {
    title: "File observation", resource: { kind: "file", path: paths[(input as { index: number }).index], action: "read" },
  } }));
  let turns = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "read_only", model: {
    async complete() {
      if (turns++ === 0) return { toolCalls: paths.map((_, index) => ({
        id: `path-identity-${index}`, name: "test.file_resource", arguments: { index },
      })) };
      return { content: "File identities checked." };
    },
  } }).run({ prompt: "Check file identities", runId: "run-file-identities-001" });
  for (const [index, path] of paths.entries()) {
    const completed = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
      event.type === "tool_completed" && event.callId === `path-identity-${index}`);
    assert.equal(completed?.ok, true);
    assert.deepEqual(completed?.summary.resource, index < 4 ? { kind: "file", path, action: "read" } : undefined);
  }
});

test("file invocation links never use display truncation or replace a rejected explicit target", async () => {
  const paths = [`directory  with spaces/${"x".repeat(600)}.txt `, "x".repeat(4097), "invalid\npath", "valid-input.txt"];
  const registry = new AgentToolRegistry();
  registry.register({ name: "workspace.read_file", description: "Read fixture files", inputSchema: { type: "object" },
    requiredPermission: "read_only", source: "builtin" }, async input => {
    if ((input as { path: string }).path !== "valid-input.txt") throw new AgentToolError("PATH_NOT_FOUND", "Missing fixture");
    return { modelOutput: {}, summary: { title: "Read fixture", resource: { kind: "file", path: "x".repeat(4097), action: "read" } } };
  });
  let turns = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "read_only", model: {
    async complete() {
      return turns++ === 0 ? { toolCalls: paths.map((path, index) => ({ id: `raw-file-${index}`, name: "workspace.read_file", arguments: { path } })) }
        : { content: "Checked links." };
    },
  } }).run({ prompt: "Check file links", runId: "run-file-invocation-001" });
  for (const [index, path] of paths.entries()) {
    const started = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_started" }> => event.type === "tool_started" && event.callId === `raw-file-${index}`);
    const completed = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> => event.type === "tool_completed" && event.callId === `raw-file-${index}`);
    assert.equal(started?.summary?.resource?.kind === "file" ? started.summary.resource.path : undefined, index === 0 || index === 3 ? path : undefined);
    assert.equal(completed?.summary.resource?.kind === "file" ? completed.summary.resource.path : undefined, index === 0 ? path : undefined);
    assert.ok((started?.summary?.title.length || 0) <= 260, 'display title remains bounded');
  }
});

test("generic models publish a structured task plan without polluting the tool activity stream", async () => {
  const registry = new AgentToolRegistry();
  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      assert.equal(request.tools.some(tool => tool.name === "task.update_plan"), true);
      assert.match(request.instructions ?? "", /structured task plan/i);
      if (modelCalls === 1) {
        return {
          content: "我先建立计划，再开始执行。",
          toolCalls: [{
            id: "task-plan-1",
            name: "task.update_plan",
            arguments: {
              steps: [
                { id: "baseline", title: "建立基线", status: "completed" },
                { id: "implementation", title: "实现结构化计划", status: "in_progress" },
                { id: "verification", title: "运行真实验证", status: "pending" },
              ],
            },
          }],
        };
      }
      assert.equal(request.messages.at(-1)?.role, "tool");
      assert.match(request.messages.at(-1)?.content ?? "", /implementation/);
      return { content: "计划已建立。" };
    },
  };

  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "完成一个非平凡任务", runId: "run-structured-plan-001" });

  assert.equal(result.status, "completed");
  const plan = result.events.find(event => event.type === "task_plan_updated");
  assert.deepEqual(plan?.type === "task_plan_updated" ? plan.steps : undefined, [
    { id: "baseline", title: "建立基线", status: "completed" },
    { id: "implementation", title: "实现结构化计划", status: "in_progress" },
    { id: "verification", title: "运行真实验证", status: "pending" },
  ]);
  assert.equal(plan?.type === "task_plan_updated" ? plan.source : undefined, "model");
  assert.equal(result.events.some(event => (event.type === "tool_started" || event.type === "tool_completed")
    && event.toolName === "task.update_plan"), false);
});

test("a simple task emits runtime progress without fabricating a task plan", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  await writeFile(join(workspace, "fallback.txt"), "fallback\n", "utf8");
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? { content: "", toolCalls: [{ id: "fallback-read", name: "workspace.read_file", arguments: { path: "fallback.txt" } }] }
          : { content: "检查完成。" };
      },
    },
  }).run({ prompt: "read fallback", runId: "run-runtime-progress-origin-001" });

  const fallback = result.events.find(event => event.type === "assistant_progress" && event.content.startsWith("Next operations:"));
  assert.equal(fallback?.type === "assistant_progress" ? fallback.origin : undefined, "runtime");
  const plans = result.events.filter(event => event.type === "task_plan_updated");
  assert.equal(plans.length, 0, "a one-shot read must not fabricate a task queue");
});

test("multi-step tool work without task.update_plan does not fabricate a task plan", async t => {
  const { workspace, registry } = await fixture(t, "read_only");
  await writeFile(join(workspace, "one.txt"), "one\n", "utf8");
  await writeFile(join(workspace, "two.txt"), "two\n", "utf8");
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? { content: "", toolCalls: [
            { id: "multi-read-1", name: "workspace.read_file", arguments: { path: "one.txt" } },
            { id: "multi-read-2", name: "workspace.read_file", arguments: { path: "two.txt" } },
          ] }
          : { content: "两个文件均已检查。" };
      },
    },
  }).run({ prompt: "检查两个文件并汇总结果", runId: "run-runtime-fallback-multi-001" });

  assert.equal(result.events.some(event => event.type === "task_plan_updated"), false);
});

test("a multi-step prompt without task.update_plan does not publish a plan before or after the model response", async () => {
  const events: AgentRunEvent[] = [];
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(),
    permissionMode: "read_only",
    onEvent: event => { events.push(event); },
    model: {
      async complete() {
        return { content: "两个文件均已检查并完成汇总。" };
      },
    },
  }).run({ prompt: "检查两个文件并汇总结果", runId: "run-runtime-plan-before-response-001" });

  assert.equal(result.status, "completed");
  assert.ok(events.some(event => event.type === "model_started"));
  assert.ok(events.some(event => event.type === "model_completed"));
  assert.equal(events.some(event => event.type === "task_plan_updated"), false);
});

test("unplanned work keeps interruption checkpoints and retries free of synthetic plans", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.plan_checkpoint_boundary",
    description: "Create a safe checkpoint boundary",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { boundary: true }, summary: { title: "checkpoint boundary" } }));

  let calls = 0;
  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(
    new AgentRunner({
      tools: registry,
      permissionMode: "read_only",
      model: {
        async complete() {
          calls += 1;
          if (calls === 1) return {
            toolCalls: [{ id: "plan-checkpoint-boundary-001", name: "test.plan_checkpoint_boundary", arguments: {} }],
          };
          throw Object.assign(new Error("connection lost after the tool boundary"), {
            code: "CONNECTION_FAILED",
            retrySafe: true,
            retryable: true,
          });
        },
      },
    }).run({
      prompt: "检查两个文件并汇总结果",
      runId: "run-runtime-plan-checkpoint-001",
    }),
    error => {
      interruption = error as AgentRunInterruptedError;
      return interruption instanceof AgentRunInterruptedError;
    },
  );

  assert.equal(interruption?.checkpoint.taskPlan, undefined);
  assert.equal(interruption?.checkpoint.taskPlanSource, undefined);

  const legacyRuntimeCheckpoint: AgentRunCheckpoint = {
    ...interruption!.checkpoint,
    taskPlan: [{ id: "legacy-runtime", title: "Synthetic legacy runtime plan", status: "in_progress" }],
    taskPlanSource: "runtime",
  };
  const migratedLegacyCheckpoint = retryAgentRunCheckpoint(
    legacyRuntimeCheckpoint,
    "run-runtime-plan-checkpoint-002",
  );
  assert.equal(migratedLegacyCheckpoint.taskPlanSource, "runtime");
  const resumedEvents: AgentRunEvent[] = [];
  const resumed = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    onEvent: event => { resumedEvents.push(event); },
    model: { async complete() { return { content: "已从检查点继续并完成汇总。" }; } },
  }).run({
    prompt: "继续",
    runId: "run-runtime-plan-checkpoint-002",
    checkpoint: migratedLegacyCheckpoint,
  });

  assert.equal(resumed.status, "completed");
  assert.equal(resumedEvents.some(event => event.type === "task_plan_updated"), false);
});

test("the runner rejects raw tool transcripts as task-plan rows before emitting durable plan state", async () => {
  assert.equal(isLowLevelTaskPlanTitle("rg 退出码 0"), true);
  assert.equal(isLowLevelTaskPlanTitle("读取 packages/example.ts"), true);
  assert.equal(isLowLevelTaskPlanTitle("完成模型兼容性验证"), false);

  const registry = new AgentToolRegistry();
  let calls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete(request) {
        calls += 1;
        if (calls === 1) return {
          toolCalls: [{
            id: "raw-plan-001",
            name: "task.update_plan",
            arguments: {
              steps: [
                { id: "raw-rg", title: "rg 退出码 0", status: "completed" },
                { id: "raw-read", title: "读取 packages/example.ts", status: "in_progress" },
              ],
            },
          }],
        };
        assert.match(request.messages.at(-1)?.content ?? "", /raw tool activity/i);
        return { content: "已改为高层任务计划。" };
      },
    },
  }).run({ prompt: "检查计划", runId: "run-plan-transcript-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.events.some(event => event.type === "task_plan_updated"), false);
  assert.equal(calls, 2);
});

test("context compaction keeps the current task scope and structured plan ahead of old conversation history", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.compaction_progress",
    description: "Return distinct progress for compaction coverage",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async args => {
    const step = (args as { step: number }).step;
    return { modelOutput: { step }, summary: { title: `compaction progress ${step}` } };
  });

  const marker = "CURRENT_SCOPE_MARKER_KEEP_TASK_TERMINAL_20260830";
  const prompt = `只处理任务终端，不要转去处理历史需求。${"范围约束。".repeat(120)}${marker}`;
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `OLD_UNRELATED_TASK_${index}: 历史消息，不得成为当前任务。`,
  }));
  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      if (modelCalls === 18) {
        assert.equal(request.messages[0]?.role, "user");
        assert.match(request.messages[0]?.content ?? "", /CURRENT TASK SCOPE/);
        assert.match(request.messages[0]?.content ?? "", new RegExp(marker));
        assert.match(request.messages[0]?.content ?? "", /保持任务终端和手动 Shell 分离/);
        assert.doesNotMatch(request.messages[0]?.content ?? "", /OLD_UNRELATED_TASK_0/);
        return { content: "任务范围保持正确。" };
      }
      const calls = modelCalls === 1 ? [{
        id: "compaction-plan",
        name: "task.update_plan",
        arguments: { steps: [
          { id: "baseline", title: "确认任务终端边界", status: "completed" },
          { id: "implementation", title: "保持任务终端和手动 Shell 分离", status: "in_progress" },
          { id: "verification", title: "验证压缩后范围不漂移", status: "pending" },
        ] },
      }] : [];
      return {
        toolCalls: [...calls, {
          id: `compaction-progress-${modelCalls}`,
          name: "test.compaction_progress",
          arguments: { step: modelCalls },
        }],
      };
    },
  };

  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    maxTurns: 17,
    maxTotalTurns: 18,
  }).run({ prompt, history, runId: "run-compaction-scope-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "任务范围保持正确。");
  assert.equal(result.events.some(event => event.type === "context_compaction_completed"), true);
});

test("direction messages are consumed once after a tool batch and before the next model call", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.safe_boundary",
    description: "Create a safe boundary",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { ready: true }, summary: { title: "boundary" } }));
  const pending = [{ id: "message-steer-0001", content: "Use the smaller implementation", createdAt: "2026-08-28T08:00:00.000Z" }];
  let takeCalls = 0;
  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      if (modelCalls === 1) {
        assert.equal(request.messages.some(message => message.content === pending[0]?.content), false);
        return { toolCalls: [{ id: "safe-boundary-1", name: "test.safe_boundary", arguments: {} }] };
      }
      assert.deepEqual(request.messages.slice(-2).map(message => [message.role, message.content]), [
        ["tool", '{"ok":true,"output":{"ready":true}}'],
        ["user", "Use the smaller implementation"],
      ]);
      return { content: "updated direction applied" };
    },
  };
  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    takeSteeringMessages: () => {
      takeCalls += 1;
      return pending.splice(0);
    },
  }).run({ prompt: "start", runId: "run-steering-apply-001" });
  assert.equal(result.status, "completed");
  assert.equal(takeCalls, 2, "the queue is checked after the tool boundary and once more before final completion");
  assert.equal(result.events.filter(event => event.type === "steering_applied").length, 1);
});

test("a queued direction arriving with the final model response automatically continues the same run", async () => {
  const registry = new AgentToolRegistry();
  const queued = [{
    id: "message-final-boundary-001",
    content: "Also verify the queued requirement",
    createdAt: "2026-08-31T08:00:00.000Z",
  }];
  let modelCalls = 0;
  let queueChecks = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    takeSteeringMessages: () => {
      queueChecks += 1;
      return queueChecks === 1 ? queued.splice(0) : [];
    },
    model: {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) return { content: "The original request is complete." };
        assert.deepEqual(request.messages.slice(-2).map(message => [message.role, message.content]), [
          ["assistant", "The original request is complete."],
          ["user", "Also verify the queued requirement"],
        ]);
        return { content: "The original and queued requirements are complete." };
      },
    },
  }).run({ prompt: "finish the task", runId: "run-final-boundary-queue-001" });

  assert.equal(modelCalls, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "The original and queued requirements are complete.");
  assert.equal(result.events.filter(event => event.type === "steering_applied").length, 1);
});

test("cancellation before the next safe boundary does not consume direction messages", async () => {
  const registry = new AgentToolRegistry();
  const controller = new AbortController();
  registry.register({
    name: "test.cancel_boundary",
    description: "Cancel before the next model boundary",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    controller.abort();
    return { modelOutput: { cancelled: true }, summary: { title: "cancelled" } };
  });
  let consumed = 0;
  const model: AgentModelClient = {
    async complete() {
      return { toolCalls: [{ id: "cancel-boundary-1", name: "test.cancel_boundary", arguments: {} }] };
    },
  };
  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    takeSteeringMessages: () => {
      consumed += 1;
      return [{ id: "message-steer-cancel", content: "must remain pending", createdAt: "2026-08-28T08:00:00.000Z" }];
    },
  }).run({ prompt: "start", runId: "run-steering-cancel-001", signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.stopReason, "cancel_requested");
  assert.equal(consumed, 0);
  assert.equal(result.events.some(event => event.type === "steering_applied"), false);
});

test("cancellation prevents every later tool in an already returned batch from starting", async () => {
  const registry = new AgentToolRegistry();
  const controller = new AbortController();
  let laterExecutions = 0;
  registry.register({
    name: "test.abort_batch",
    description: "Abort the current batch",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    controller.abort();
    return { modelOutput: { cancelled: true }, summary: { title: "abort batch" } };
  });
  registry.register({
    name: "test.must_not_start",
    description: "Must never start after cancellation",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    laterExecutions += 1;
    return { modelOutput: { unsafe: true }, summary: { title: "unexpected" } };
  });
  const result = await new AgentRunner({
    model: {
      async complete() {
        return { toolCalls: [
          { id: "abort-batch-1", name: "test.abort_batch", arguments: {} },
          { id: "abort-batch-2", name: "test.must_not_start", arguments: {} },
        ] };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "start", runId: "run-batch-cancel-001", signal: controller.signal });

  assert.equal(result.status, "cancelled");
  assert.equal(laterExecutions, 0);
  assert.equal(result.events.some(event => event.type === "tool_started" && event.toolName === "test.must_not_start"), false);
});

test("pausing is resumable, is distinct from cancellation, and never starts the rest of the tool batch", async () => {
  const registry = new AgentToolRegistry();
  const controller = new AbortController();
  let firstExecutions = 0;
  let laterExecutions = 0;
  registry.register({
    name: "test.pause_batch",
    description: "Pause the current run at a safe boundary",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    firstExecutions += 1;
    controller.abort(new AgentRunPauseError());
    return { modelOutput: { paused: true }, summary: { title: "pause batch" } };
  });
  registry.register({
    name: "test.must_wait_for_resume",
    description: "Must not start after pause",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    laterExecutions += 1;
    return { modelOutput: { unsafe: true }, summary: { title: "unexpected" } };
  });

  const paused = await new AgentRunner({
    model: {
      async complete() {
        return { toolCalls: [
          { id: "pause-batch-1", name: "test.pause_batch", arguments: {} },
          { id: "pause-batch-2", name: "test.must_wait_for_resume", arguments: {} },
        ] };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "pause safely", runId: "run-pause-batch-001", signal: controller.signal });

  assert.equal(paused.status, "paused");
  assert.equal(paused.stopReason, "pause_requested");
  assert.ok(paused.checkpoint);
  assert.equal(firstExecutions, 1);
  assert.equal(laterExecutions, 0);
  assert.equal(paused.events.some(event => event.type === "tool_started" && event.toolName === "test.must_wait_for_resume"), false);

  const resumed = await new AgentRunner({
    model: {
      async complete(request) {
        assert.equal(request.messages.some(message => message.toolCallId === "pause-batch-1"), true);
        assert.equal(request.messages.some(message => message.toolCallId === "pause-batch-2"), true);
        return { content: "Resumed from the preserved checkpoint without replaying tools." };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({
    prompt: "resume safely",
    runId: "run-pause-batch-002",
    checkpoint: retryAgentRunCheckpoint(paused.checkpoint!, "run-pause-batch-002"),
  });

  assert.equal(resumed.status, "completed");
  assert.equal(resumed.finalText, "Resumed from the preserved checkpoint without replaying tools.");
  assert.equal(firstExecutions, 1);
  assert.equal(laterExecutions, 0);
});

test("agent forwards validated attachments without duplicating them onto tool messages", async t => {
  const { registry } = await fixture(t, "read_only");
  const requests: AgentModelRequest[] = [];
  const model: AgentModelClient = {
    async complete(request) {
      requests.push(request);
      if (requests.length === 1) {
        return {
          toolCalls: [{ id: "list-attachment-test", name: "workspace.list_files", arguments: {} }],
        };
      }
      return { content: "done" };
    },
  };
  await new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
    prompt: "inspect",
    runId: "run-attachment-001",
    attachments: [
      { kind: "text", name: "notes.txt", content: "attachment body" },
      { kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" },
    ],
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].messages[0].attachments?.map(attachment => attachment.name), ["notes.txt", "pixel.png"]);
  assert.deepEqual(requests[1].messages[0].attachments?.map(attachment => attachment.name), ["notes.txt", "pixel.png"]);
  assert.equal(requests[1].messages.filter(message => message.role !== "user").some(message => message.attachments?.length), false);
});

test("agent expands positioned text attachments at their inline references before the model call", async t => {
  const { registry } = await fixture(t, "read_only");
  let captured: AgentModelRequest | undefined;
  const model: AgentModelClient = {
    async complete(request) {
      captured = request;
      return { content: "done" };
    },
  };
  await new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
    prompt: "First [[paste-a]]\nMiddle [[paste-b]]\nEnd",
    runId: "run-positioned-paste-001",
    attachments: [
      { kind: "text", name: "a.txt", content: "alpha body", inlineReference: "[[paste-a]]" },
      { kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" },
      { kind: "text", name: "b.txt", content: "beta body", inlineReference: "[[paste-b]]" },
    ],
  });

  assert.equal(
    captured?.messages[0].content,
    "First <file name=\"a.txt\">\nalpha body\n</file>\nMiddle <file name=\"b.txt\">\nbeta body\n</file>\nEnd",
  );
  assert.deepEqual(captured?.messages[0].attachments, [
    { kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" },
  ]);
});

test("agent accepts up to twenty bounded attachments and rejects the twenty-first", async t => {
  const { registry } = await fixture(t, "read_only");
  let captured: AgentModelRequest | undefined;
  const model: AgentModelClient = {
    async complete(request) {
      captured = request;
      return { content: "received" };
    },
  };
  const attachments = Array.from({ length: 20 }, (_, index) => ({
    kind: "text" as const,
    name: `paste-${index + 1}.txt`,
    content: `part ${index + 1}`,
  }));

  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
    prompt: "inspect every pasted section",
    runId: "run-twenty-attachments-001",
    attachments,
  });
  assert.equal(result.status, "completed");
  assert.equal(captured?.messages.at(-1)?.attachments?.length, 20);

  await assert.rejects(
    new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
      prompt: "too many",
      runId: "run-twenty-one-attachments-001",
      attachments: [...attachments, { kind: "text", name: "paste-21.txt", content: "part 21" }],
    }),
    error => error instanceof AgentToolError && error.code === "INVALID_ATTACHMENTS",
  );
});

test("an attachment can be sent without synthetic visible prompt text", async t => {
  const { registry } = await fixture(t, "read_only");
  let captured: AgentModelRequest | undefined;
  const model: AgentModelClient = {
    async complete(request) {
      captured = request;
      return { content: "image received" };
    },
  };
  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
    prompt: "",
    runId: "run-attachment-only-001",
    attachments: [{ kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" }],
  });
  assert.equal(result.status, "completed");
  assert.equal(captured?.messages.at(-1)?.content, "");
  assert.equal(captured?.messages.at(-1)?.attachments?.[0]?.name, "pixel.png");
});

test("agent preserves bounded conversation history before the new user turn", async t => {
  const { registry } = await fixture(t, "read_only");
  let captured: AgentModelRequest | undefined;
  const model: AgentModelClient = {
    async complete(request) {
      captured = request;
      return { content: "continued" };
    },
  };
  await new AgentRunner({ model, tools: registry, permissionMode: "read_only" }).run({
    prompt: "current question",
    runId: "run-history-001",
    history: [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ],
  });
  assert.deepEqual(captured?.messages.map(message => [message.role, message.content]), [
    ["user", "previous question"],
    ["assistant", "previous answer"],
    ["user", "current question"],
  ]);
});

test("concurrency-safe tools use a bounded pool and preserve result order", async () => {
  const registry = new AgentToolRegistry();
  let active = 0;
  let maximumActive = 0;
  for (const name of ["one", "two", "three"]) {
    registry.register({
      name: `test.${name}`,
      description: name,
      inputSchema: { type: "object" },
      requiredPermission: "read_only",
      source: "builtin",
      concurrencySafe: true,
    }, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active -= 1;
      return { modelOutput: { name }, summary: { title: name } };
    });
  }
  let turn = 0;
  const model: AgentModelClient = {
    async complete(request) {
      turn += 1;
      if (turn === 1) {
        return { toolCalls: ["one", "two", "three"].map(name => ({
          id: `call-${name}`,
          name: `test.${name}`,
          arguments: {},
        })) };
      }
      assert.deepEqual(request.messages.filter(message => message.role === "tool").map(message => message.toolCallId), [
        "call-one",
        "call-two",
        "call-three",
      ]);
      return { content: "done" };
    },
  };
  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    maxParallelToolCalls: 2,
  }).run({ prompt: "parallel", runId: "run-parallel-001" });
  assert.equal(result.status, "completed");
  assert.equal(maximumActive, 2);
});

test("browser tool summaries preserve a safe clickable resource through completion", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.browser_open",
    description: "Open a browser page",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { opened: true }, summary: { title: "browser tool completed" } }));
  registry.register({
    name: "test.api_call",
    description: "Call an HTTP API",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { ok: true }, summary: { title: "api call completed" } }));
  registry.register({
    name: "test.web_search",
    description: "Search the web and return links as data",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { results: [] }, summary: { title: "web search completed" } }));
  registry.register({
    name: "test.site_open",
    description: "Open a site page",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { opened: true }, summary: { title: "site tool completed" } }));
  registry.register({
    name: "test.browser_search",
    description: "Search from a browser and return links as data",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { results: [] }, summary: { title: "browser search completed" } }));

  let modelCalls = 0;
  const result = await new AgentRunner({
    model: {
      async complete() {
        modelCalls += 1;
        if (modelCalls === 1) return {
          toolCalls: [
            { id: "browser-resource-call", name: "test.browser_open", arguments: { url: "https://example.test/docs" } },
            { id: "api-resource-call", name: "test.api_call", arguments: { url: "https://api.example.test/v1" } },
            { id: "search-resource-call", name: "test.web_search", arguments: { url: "https://example.test/result" } },
            { id: "site-resource-call", name: "test.site_open", arguments: { uri: "https://example.test/site?signature=token-value&view=full" } },
            { id: "browser-search-call", name: "test.browser_search", arguments: { url: "https://example.test/search" } },
            { id: "unsafe-resource-call", name: "test.browser_open", arguments: { url: "javascript:alert(1)" } },
            { id: "credentialed-resource-call", name: "test.browser_open", arguments: { url: "https://user:password@example.test/private" } },
          ],
        };
        return { content: "done" };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "open the docs", runId: "run-browser-resource-001" });

  const started = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_started" }> =>
    event.type === "tool_started" && event.callId === "browser-resource-call");
  const completed = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "browser-resource-call");
  const apiCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "api-resource-call");
  const searchCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "search-resource-call");
  const siteCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "site-resource-call");
  const browserSearchCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "browser-search-call");
  const unsafeCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "unsafe-resource-call");
  const credentialedCompleted = result.events.find((event): event is Extract<AgentRunEvent, { type: "tool_completed" }> =>
    event.type === "tool_completed" && event.callId === "credentialed-resource-call");
  assert.deepEqual(started?.summary?.resource, { kind: "browser", url: "https://example.test/docs" });
  assert.deepEqual(completed?.summary.resource, { kind: "browser", url: "https://example.test/docs" });
  assert.equal(apiCompleted?.summary.resource, undefined, "ordinary API URLs must not become browser activities");
  assert.equal(searchCompleted?.summary.resource, undefined, "web search result URLs are data, not navigation");
  assert.deepEqual(siteCompleted?.summary.resource, { kind: "browser", url: "https://example.test/site?signature=token-value&view=full" });
  assert.equal(browserSearchCompleted?.summary.resource, undefined, "browser search URLs are result data, not navigation");
  assert.equal(unsafeCompleted?.summary.resource, undefined, "non-http URLs must never become browser activities");
  assert.equal(credentialedCompleted?.summary.resource, undefined, "URLs containing embedded credentials must not be opened automatically");
});

test("browser interaction summaries carry the human target but never typed text", async () => {
  const registry = new AgentToolRegistry();
  for (const name of ["mcp.playwright.browser_click", "mcp.playwright.browser_type"]) registry.register({
    name, description: "Playwright-compatible browser step", inputSchema: { type: "object" }, requiredPermission: "read_only", source: "mcp",
  }, async () => ({ modelOutput: { ok: true }, summary: { title: "MCP：playwright / step" } }));
  registry.register({
    name: "browser.click", description: "Built-in browser click", inputSchema: { type: "object" }, requiredPermission: "read_only", source: "builtin",
  }, async () => ({ modelOutput: { ok: true }, summary: { title: "浏览器操作", target: "  Sign\n in  " } }));
  let modelCalls = 0;
  const result = await new AgentRunner({
    model: {
      async complete() {
        modelCalls += 1;
        if (modelCalls === 1) return { toolCalls: [
          { id: "click", name: "mcp.playwright.browser_click", arguments: { element: "Sign in button", ref: "e12" } },
          { id: "type", name: "mcp.playwright.browser_type", arguments: { element: "Password field", ref: "e13", text: "hunter2-secret" } },
          { id: "builtin", name: "browser.click", arguments: { ref: "s1e2" } },
        ] };
        return { content: "done" };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "sign in", runId: "run-browser-target-001" });
  const summary = (callId: string, type: "tool_started" | "tool_completed") => (result.events.find(event =>
    event.type === type && event.callId === callId) as { summary?: { target?: string } } | undefined)?.summary;
  assert.equal(summary("click", "tool_started")?.target, "Sign in button");
  assert.equal(summary("click", "tool_completed")?.target, "Sign in button", "the invocation target survives a textual handler summary");
  assert.equal(summary("type", "tool_completed")?.target, "Password field");
  assert.equal(summary("builtin", "tool_completed")?.target, "Sign in", "handler targets are bounded single-line text");
  assert.doesNotMatch(JSON.stringify(result.events), /hunter2-secret/, "typed text never enters the activity trace");
});

test("only known Playwright MCP arguments become browser activity targets; other browser_* arguments never leak", async () => {
  const registry = new AgentToolRegistry();
  const names = ["mcp.vault.browser_login", "mcp.other.browser_press_key", "mcp.playwright.browser_press_key", "mcp.playwright.browser_drag",
    "mcp.playwright.browser_fill_form", "mcp.playwright.browser_select_option_1234abcd", "browser_hover"];
  for (const name of names) registry.register({
    name, description: "browser-named tool", inputSchema: { type: "object" }, requiredPermission: "read_only", source: "mcp",
  }, async () => ({ modelOutput: { ok: true }, summary: { title: "MCP step" } }));
  let modelCalls = 0;
  const result = await new AgentRunner({
    model: {
      async complete() {
        modelCalls += 1;
        if (modelCalls === 1) return { toolCalls: [
          { id: "vault", name: "mcp.vault.browser_login", arguments: { key: "sk-live-SECRET-1", element: "SECRET-element-2" } },
          { id: "secret-key", name: "mcp.other.browser_press_key", arguments: { key: "sk-live-SECRET-3" } },
          { id: "enter", name: "mcp.playwright.browser_press_key", arguments: { key: "Control+Enter" } },
          { id: "drag", name: "mcp.playwright.browser_drag", arguments: { startElement: "Card A", endElement: "Done column", startRef: "e1", endRef: "e2" } },
          { id: "form", name: "mcp.playwright.browser_fill_form", arguments: { fields: [{ name: "Password", value: "SECRET-4" }] } },
          { id: "select", name: "mcp.playwright.browser_select_option_1234abcd", arguments: { element: "Country", values: ["SECRET-5"] } },
          { id: "hover", name: "browser_hover", arguments: { element: "Help icon" } },
        ] };
        return { content: "done" };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "use the page", runId: "run-browser-target-allowlist-001" });
  const target = (callId: string) => (result.events.find(event =>
    event.type === "tool_started" && event.callId === callId) as { summary?: { target?: string } } | undefined)?.summary?.target;
  assert.equal(target("vault"), undefined);
  assert.equal(target("secret-key"), undefined, "a key argument that is not a key name is never displayed");
  assert.equal(target("enter"), "Control+Enter");
  assert.equal(target("drag"), "Card A → Done column");
  assert.equal(target("form"), undefined);
  assert.equal(target("select"), "Country");
  assert.equal(target("hover"), "Help icon");
  assert.doesNotMatch(JSON.stringify(result.events), /SECRET/, "no argument of an unknown or value-carrying browser tool enters the trace");
});

test("a model can issue a production-sized tool batch without aborting the task", async () => {
  const registry = new AgentToolRegistry();
  const executed: number[] = [];
  registry.register({
    name: "test.batch_item",
    description: "Execute one item in a bounded batch",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
    concurrencySafe: true,
  }, async args => {
    const index = Number((args as { index: number }).index);
    executed.push(index);
    return { modelOutput: { index }, summary: { title: `item ${index}` } };
  });
  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          toolCalls: Array.from({ length: 20 }, (_, index) => ({
            id: `batch-call-${String(index).padStart(2, "0")}`,
            name: "test.batch_item",
            arguments: { index },
          })),
        };
      }
      assert.equal(request.messages.filter(message => message.role === "tool").length, 20);
      return { content: "batch complete" };
    },
  };

  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "run the batch", runId: "run-production-batch-001" });
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "batch complete");
  assert.deepEqual([...executed].sort((left, right) => left - right), Array.from({ length: 20 }, (_, index) => index));
});

test("agent rejects duplicate tool-call identifiers instead of executing twice", async t => {
  const { registry } = await fixture(t, "read_only");
  let turn = 0;
  const model: AgentModelClient = {
    async complete() {
      turn += 1;
      return { toolCalls: [{ id: "duplicate-id", name: "workspace.list_files", arguments: {} }] };
    },
  };
  await assert.rejects(
    new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
      .run({ prompt: "loop", runId: "run-duplicate-001" }),
    error => error instanceof AgentRunInterruptedError && error.code === "DUPLICATE_TOOL_CALL"
      && error.failure.retrySafe === false && error.checkpoint.toolCalls === 1
      && error.checkpoint.seenToolCallIds.includes('duplicate-id'),
  );
  assert.equal(turn, 2);
});

test("tool-call budget checkpoints keep every assistant call paired for automatic continuation", async () => {
  const registry = new AgentToolRegistry();
  const executed: string[] = [];
  registry.register({
    name: "test.budget_pair",
    description: "Record one budgeted call",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async input => {
    const value = String((input as { value?: string }).value || "");
    executed.push(value);
    return { modelOutput: { value }, summary: { title: value } };
  });
  const model: AgentModelClient = {
    async complete() {
      return {
        toolCalls: ["first", "second"].map(value => ({
          id: `budget-${value}`,
          name: "test.budget_pair",
          arguments: { value },
        })),
      };
    },
  };

  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    maxToolCalls: 1,
  }).run({ prompt: "respect the tool budget", runId: "run-tool-budget-pair-001" });

  assert.equal(result.status, "limit_reached");
  assert.equal(result.stopReason, "tool_call_limit_reached");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(executed, ["first"]);
  const retried = retryAgentRunCheckpoint(result.checkpoint!, "run-tool-budget-pair-002");
  const tail = retried.messages.slice(-3);
  assert.equal(tail[0].role, "assistant");
  assert.deepEqual(tail.slice(1).map(message => message.toolCallId), ["budget-first", "budget-second"]);
  assert.match(tail[2].content, /TOOL_CALL_LIMIT_REACHED/);
});

test("explicit input token budgets stop before dispatch and persist the remaining budget", async () => {
  const registry = new AgentToolRegistry();
  let modelCalls = 0;
  const result = await new AgentRunner({
    model: {
      async complete() {
        modelCalls += 1;
        return { content: "must not dispatch" };
      },
    },
    tools: registry,
    permissionMode: "read_only",
    tokenBudget: { maxInputTokens: 4, maxOutputTokens: 20 },
  }).run({
    prompt: "This deliberately verbose prompt must be rejected by the input budget before the provider request.",
    runId: "run-input-token-budget-001",
  });

  assert.equal(modelCalls, 0);
  assert.equal(result.status, "limit_reached");
  assert.equal(result.stopReason, "input_token_limit_reached");
  assert.equal(result.tokenBudget?.maxInputTokens, 4);
  assert.equal(result.tokenBudget?.remainingInputTokens, 4);
  assert.ok(result.checkpoint?.tokenBudget);
});

test("output token budgets pass a provider ceiling and never execute an unverified tool batch", async () => {
  const registry = new AgentToolRegistry();
  let executed = 0;
  let capturedMaxOutputTokens: number | undefined;
  registry.register({
    name: "test.budgeted_side_effect",
    description: "A side effect that must not run after the output ceiling is consumed",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    executed += 1;
    return { modelOutput: { executed: true }, summary: { title: "side effect" } };
  });
  const result = await new AgentRunner({
    model: {
      async complete(request) {
        capturedMaxOutputTokens = request.maxOutputTokens;
        return {
          toolCalls: [{ id: "budgeted-side-effect-001", name: "test.budgeted_side_effect", arguments: {} }],
          usage: { inputTokens: 1, outputTokens: 5 },
        };
      },
    },
    tools: registry,
    permissionMode: "read_only",
    tokenBudget: { maxInputTokens: 100_000, maxOutputTokens: 4 },
  }).run({ prompt: "check the output ceiling", runId: "run-output-token-budget-001" });

  assert.equal(capturedMaxOutputTokens, 4);
  assert.equal(executed, 0);
  assert.equal(result.status, "limit_reached");
  assert.equal(result.stopReason, "output_token_limit_reached");
  assert.ok(result.checkpoint);
});

test("default agent runner completes ten distinct tool rounds before returning text on turn eleven", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.progress",
    description: "Return distinct progress for each step",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async args => {
    const step = (args as { step: number }).step;
    return {
      modelOutput: { result: `progress-result-${step}` },
      summary: { title: `progress ${step}` },
    };
  });

  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      if (modelCalls > 1) {
        assert.equal(request.messages.at(-1)?.role, "tool");
        assert.match(request.messages.at(-1)?.content ?? "", new RegExp(`progress-result-${modelCalls - 1}`));
      }
      if (modelCalls <= 10) {
        return {
          toolCalls: [{
            id: `progress-call-${modelCalls}`,
            name: "test.progress",
            arguments: { step: modelCalls },
          }],
        };
      }
      return { content: "all progress completed" };
    },
  };

  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "make progress", runId: "run-ten-progress-rounds-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "all progress completed");
  assert.equal(result.turns, 11);
  assert.equal(result.toolCalls, 10);
  assert.equal(modelCalls, 11);
});

test("the total model-turn ceiling reports a turn limit rather than cancellation or tool failure", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.turn_limit_progress",
    description: "Make one unique unit of progress",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async input => ({ modelOutput: input, summary: { title: "turn progress" } }));
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    maxTurns: 1,
    maxTotalTurns: 2,
    model: {
      async complete() {
        modelCalls += 1;
        return { toolCalls: [{
          id: `turn-limit-${modelCalls}`,
          name: "test.turn_limit_progress",
          arguments: { turn: modelCalls },
        }] };
      },
    },
  }).run({ prompt: "continue past the turn ceiling", runId: "run-turn-limit-state-001" });

  assert.equal(result.status, "limit_reached");
  assert.equal(result.stopReason, "turn_limit_reached");
  assert.ok(result.checkpoint);
  assert.equal(result.turns, 2);
});

test("the same call repeated gets a loop notice after three and pauses only after eight, even when call identifiers differ", async () => {
  const registry = new AgentToolRegistry();
  let executions = 0;
  registry.register({
    name: "test.repeat",
    description: "Return an identical result",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    executions += 1;
    return {
      modelOutput: { result: "unchanged" },
      summary: { title: "repeat" },
    };
  });

  let modelCalls = 0;
  const notices: number[] = [];
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      if (/Runtime loop notice/.test(String(request.messages.at(-1)?.content ?? ""))) notices.push(modelCalls);
      return {
        toolCalls: [{
          id: `repeat-call-${modelCalls}`,
          name: "test.repeat",
          arguments: { value: "same" },
        }],
      };
    },
  };

  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "repeat forever", runId: "run-repeat-detection-001" });

  assert.equal(result.status, "limit_reached");
  assert.equal(result.stopReason, "repeated_tool_calls");
  assert.equal(result.finalText, "Repeated tool calls detected; the task is paused.");
  assert.equal(result.finalMessage?.stopReason, "repeated_tool_calls");
  assert.equal(result.turns, 8);
  assert.equal(result.toolCalls, 8);
  assert.equal(modelCalls, 8);
  assert.equal(executions, 8);
  assert.deepEqual(notices, [4, 5, 6, 7, 8], "after the third repeat the model is told to change approach");
});

test("agent retries stable transient provider error codes and records the retry", async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  const model: AgentModelClient = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("upstream temporarily unavailable; Authorization: Bearer secret-token-value"), {
          code: "UPSTREAM_UNAVAILABLE",
          retrySafe: true,
          retryable: true,
          stage: "response",
          category: "upstream",
          status: 503,
          requestId: "req-safe-123",
          attemptId: "provider-attempt-7",
          publicMessage: "upstream temporarily unavailable",
        });
      }
      return { content: "recovered" };
    },
  };

  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "retry once", runId: "run-transient-retry-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "recovered");
  assert.equal(calls, 2);
  assert.deepEqual(result.events.filter(event => event.type === "model_retry_scheduled").map(event => ({
    attempt: event.type === "model_retry_scheduled" ? event.attempt : 0,
    reason: event.type === "model_retry_scheduled" ? event.reason : "",
  })), [{ attempt: 1, reason: "HTTP 503" }]);
  const attempts = result.events.filter(event => event.type === "model_attempt_completed");
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(event => event.type === "model_attempt_completed" ? {
    attempt: event.attempt,
    outcome: event.outcome,
    failure: event.failure,
  } : undefined), [
    {
      attempt: 1,
      outcome: "failed",
      failure: {
        code: "UPSTREAM_UNAVAILABLE",
        stage: "response",
        category: "upstream",
        reason: "upstream temporarily unavailable",
        retryable: true,
        retrySafe: true,
        httpStatus: 503,
        requestId: "req-safe-123",
        providerAttemptId: "provider-attempt-7",
      },
    },
    { attempt: 2, outcome: "succeeded", failure: undefined },
  ]);
  assert.equal(Object.isFrozen(attempts[0]), true);
  assert.equal(attempts[0].type === "model_attempt_completed" && attempts[0].failure
    ? Object.isFrozen(attempts[0].failure) : false, true);
  assert.doesNotMatch(JSON.stringify(attempts), /secret-token-value|Authorization/i);
});

test("a reply that keeps dropping mid-stream continues in place, then keeps its shown text in a resumable checkpoint", async () => {
  const registry = new AgentToolRegistry();
  const events: AgentRunEvent[] = [];
  const requests: { role: string; content: string }[][] = [];
  let calls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      calls += 1;
      requests.push(request.messages.map(message => ({ role: message.role, content: message.content })));
      await request.onTextDelta?.("正在检查");
      await request.onTextDelta?.("文件…");
      throw Object.assign(new Error("upstream temporarily unavailable"), {
        code: "UPSTREAM_UNAVAILABLE",
        retrySafe: true,
        retryable: true,
      });
    },
  };

  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(
    new AgentRunner({ model, tools: registry, permissionMode: "read_only", onEvent: event => { events.push(event); } })
      .run({ prompt: "stream then fail", runId: "run-stream-no-retry-001" }),
    error => { interruption = error as AgentRunInterruptedError; return (error as { code?: string }).code === "UPSTREAM_UNAVAILABLE"; },
  );

  // Each new attempt continued the shown reply; its repeat of the same words was never shown again.
  assert.equal(calls, 4);
  assert.equal(events.filter(event => event.type === "model_retry_scheduled").length, 3);
  assert.deepEqual(requests[1].slice(-2).map(message => message.role), ["assistant", "user"]);
  assert.equal(requests[1].at(-2)?.content, "正在检查文件…");
  assert.match(requests[1].at(-1)?.content ?? "", /interrupted mid-stream/);
  assert.equal(events.filter(event => event.type === "assistant_delta")
    .map(event => event.type === "assistant_delta" ? event.delta : "").join(""), "正在检查文件…");
  assert.equal(interruption?.failure.retrySafe, true);
  assert.deepEqual(interruption?.checkpoint.messages.slice(-2).map(message => [message.role, message.content.slice(0, 40)]),
    [["assistant", "正在检查文件…"], ["user", "Runtime notice: Your reply was interrupt"]]);
  assert.equal(interruption?.checkpoint.nextTurn, 2);
});

test("a wrapped 429 retry-limit error keeps the run resumable without replaying the request", async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(
    new AgentRunner({
      model: {
        async complete() {
          calls += 1;
          throw new Error(
            "exceeded retry limit, last status: 429 Too Many Requests, request id: wrapped-429-request-001",
          );
        },
      },
      tools: registry,
      permissionMode: "read_only",
    }).run({ prompt: "recover from a provider limit", runId: "run-wrapped-429-001" }),
    error => {
      interruption = error as AgentRunInterruptedError;
      return interruption instanceof AgentRunInterruptedError
        && interruption.failure.code === "RATE_LIMITED"
        && interruption.failure.category === "rate_limit"
        && interruption.failure.httpStatus === 429
        && interruption.failure.requestId === "wrapped-429-request-001"
        && interruption.failure.retryable === true
        && interruption.failure.retrySafe === false;
    },
  );
  assert.equal(calls, 1);
  assert.equal(interruption?.events.some(event => event.type === "model_retry_scheduled"), false);
  assert.equal(interruption?.checkpoint.nextTurn, 1);
});

test("a bounded run fails closed when a provider error has no verifiable usage", async () => {
  const registry = new AgentToolRegistry();
  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(
    new AgentRunner({
      model: {
        async complete() {
          throw Object.assign(new Error("provider connection ended before usage was returned"), {
            code: "CONNECTION_FAILED",
            retryable: true,
            retrySafe: false,
          });
        },
      },
      tools: registry,
      permissionMode: "read_only",
      tokenBudget: { maxInputTokens: 100_000, maxOutputTokens: 100 },
    }).run({ prompt: "keep the budget safe", runId: "run-budget-unknown-001" }),
    error => {
      interruption = error as AgentRunInterruptedError;
      return interruption instanceof AgentRunInterruptedError;
    },
  );

  assert.equal(interruption?.checkpoint.tokenBudget?.usageKnown, false);

  let resumedCalls = 0;
  const resumed = await new AgentRunner({
    model: {
      async complete() {
        resumedCalls += 1;
        return { content: "must not retry an unverified request" };
      },
    },
    tools: registry,
    permissionMode: "read_only",
    tokenBudget: { maxInputTokens: 100_000, maxOutputTokens: 100 },
  }).run({
    prompt: "continue",
    runId: "run-budget-unknown-002",
    checkpoint: retryAgentRunCheckpoint(interruption!.checkpoint, "run-budget-unknown-002"),
  });

  assert.equal(resumed.status, "limit_reached");
  assert.equal(resumed.stopReason, "token_usage_unknown");
  assert.equal(resumedCalls, 0);
});

test("provider lifecycle callbacks become observable phases without leaking hidden reasoning", async () => {
  const registry = new AgentToolRegistry();
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete(request) {
        await request.onProviderEvent?.({ type: "response.started", attemptId: "provider-phase-1" });
        await request.onProviderEvent?.({ type: "reasoning.delta", delta: "private chain of thought", visibility: "hidden" });
        await request.onProviderEvent?.({ type: "provider_reasoning", visibility: "hidden", status: "streaming", content: "private chain of thought" });
        await request.onProviderEvent?.({ type: "content.started", itemId: "content-phase-1" });
        await request.onTextDelta?.("answer");
        await request.onProviderEvent?.({ type: "content.delta", itemId: "content-phase-1", delta: "answer" });
        return { content: "answer" };
      },
    },
  }).run({ prompt: "show lifecycle", runId: "run-provider-phase-001" });

  assert.deepEqual(result.events.filter(event => event.type === "model_phase").map(event =>
    event.type === "model_phase" ? event.phase : ""), ["thinking", "responding"]);
  assert.equal(result.events.some(event => event.type === "provider_reasoning"), false);
  assert.equal(result.events.filter(event => event.type === "assistant_delta")
    .map(event => event.type === "assistant_delta" ? event.delta : "").join(""), "answer");
});

test("receipt waiting emits one settlement phase without replaying text or calling the model again", async () => {
  let calls = 0;
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only",
    model: { async complete(request) {
      calls++;
      await request.onTextDelta?.("original");
      await request.onProviderEvent?.({ type: "billing.pending" });
      await request.onProviderEvent?.({ type: "billing.pending" });
      await request.onProviderEvent?.({ type: "billing.completed" });
      return { content: "original", usage: { inputTokens: 1, outputTokens: 1 } };
    } },
  }).run({ prompt: "fixture", runId: "run-billing-phase-001" });
  assert.equal(calls, 1);
  assert.deepEqual(result.events.filter(event => event.type === "model_phase").map(event => event.phase), ["settling"]);
  assert.equal(result.events.filter(event => event.type === "assistant_delta").map(event => event.delta).join(""), "original");
  assert.equal(result.status, "completed");
});

test("a model deadline produces a resumable model-timeout interruption instead of cancellation", async () => {
  const registry = new AgentToolRegistry();
  let interruption: AgentRunInterruptedError | undefined;
  const startedAt = Date.now();
  await assert.rejects(
    new AgentRunner({
      tools: registry,
      permissionMode: "read_only",
      modelTimeoutMs: 25,
      model: {
        async complete(request) {
          request.signal?.addEventListener("abort", () => {
            void request.onTextDelta?.("late text after timeout");
          }, { once: true });
          return new Promise<never>(() => undefined);
        },
      },
    }).run({ prompt: "enforce the model deadline", runId: "run-model-timeout-001" }),
    error => {
      interruption = error as AgentRunInterruptedError;
      return interruption instanceof AgentRunInterruptedError
        && interruption.code === "MODEL_TIMEOUT"
        && interruption.status === "model_timeout"
        && interruption.failure.category === "timeout";
    },
  );

  assert.ok(Date.now() - startedAt < 1_000, "the runtime deadline must not wait for an adapter that ignores abort");
  assert.equal(interruption?.checkpoint.nextTurn, 1);
  assert.equal(interruption?.events.some(event => event.type === "model_attempt_completed"
    && event.outcome === "failed" && event.failure?.category === "timeout"), true);
  assert.equal(interruption?.events.some(event => event.type === "assistant_delta"), false);
});

test("an omitted model deadline allows a long provider attempt until it completes", async () => {
  const startedAt = Date.now();
  const result = await new AgentRunner({
    tools: new AgentToolRegistry(),
    permissionMode: "read_only",
    model: {
      async complete() {
        await new Promise(resolve => setTimeout(resolve, 40));
        return { content: "long attempt completed" };
      },
    },
  }).run({ prompt: "keep the provider attempt alive", runId: "run-model-no-deadline-001" });

  assert.equal(result.status, "completed");
  assert.ok(Date.now() - startedAt >= 30, "the default must not apply the old 5 minute-style deadline");
});

test("streamed final text remains the stable natural-language result when the adapter omits aggregate content", async () => {
  const registry = new AgentToolRegistry();
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    model: {
      async complete(request) {
        await request.onTextDelta?.("修改已完成，");
        await request.onTextDelta?.("测试也已通过。");
        return {};
      },
    },
  }).run({ prompt: "finish and summarize", runId: "run-stream-final-summary-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "修改已完成，测试也已通过。");
  assert.equal(result.events.filter(event => event.type === "assistant_delta")
    .map(event => event.type === "assistant_delta" ? event.delta : "").join(""), result.finalText);
});

test("runner publishes crash checkpoints only at complete model-message boundaries", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.boundary_read",
    description: "Read one value",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { value: 1 }, summary: { title: "read" } }));
  const checkpoints: AgentRunCheckpoint[] = [];
  let modelCalls = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: "read_only",
    onCheckpoint: checkpoint => { checkpoints.push(checkpoint); },
    model: {
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? { toolCalls: [{ id: "boundary-call-001", name: "test.boundary_read", arguments: {} }] }
          : { content: "done" };
      },
    },
  }).run({ prompt: "read safely", runId: "run-safe-boundary-001" });

  assert.equal(result.status, "completed");
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].nextTurn, 1);
  assert.equal(checkpoints[0].messages.at(-1)?.role, "user");
  assert.equal(checkpoints[1].nextTurn, 2);
  assert.equal(checkpoints[1].messages.at(-1)?.role, "tool");
  assert.equal(checkpoints[1].messages.at(-1)?.toolCallId, "boundary-call-001");
});

test("agent does not retry provider authentication failures", async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  const model: AgentModelClient = {
    async complete() {
      calls += 1;
      throw Object.assign(new Error("authentication failed"), { code: "AUTH_FAILED" });
    },
  };

  await assert.rejects(
    new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
      .run({ prompt: "do not retry", runId: "run-auth-no-retry-001" }),
    error => (error as { code?: string }).code === "AUTH_FAILED",
  );
  assert.equal(calls, 1);
});

test("a model interruption after a completed tool resumes from the exact checkpoint without repeating the tool", async () => {
  const registry = new AgentToolRegistry();
  let toolExecutions = 0;
  registry.register({
    name: "test.once",
    description: "Perform one observable operation",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    toolExecutions += 1;
    return { modelOutput: { value: "preserved-result" }, summary: { title: "one operation" } };
  });

  let initialModelCalls = 0;
  const interruptedModel: AgentModelClient = {
    async complete() {
      initialModelCalls += 1;
      if (initialModelCalls === 1) {
        return { toolCalls: [{ id: "call-once-before-interruption", name: "test.once", arguments: {} }] };
      }
      throw Object.assign(new Error("official model connection temporarily unavailable"), {
        code: "CONNECTION_FAILED",
        retrySafe: true,
        retryable: true,
      });
    },
  };

  let interruption: AgentRunInterruptedError | undefined;
  await assert.rejects(
    new AgentRunner({ model: interruptedModel, tools: registry, permissionMode: "read_only" })
      .run({ prompt: "perform the operation and summarize", runId: "run-checkpoint-interruption-001" }),
    error => {
      assert.equal(error instanceof AgentRunInterruptedError, true);
      interruption = error as AgentRunInterruptedError;
      return true;
    },
  );

  assert.equal(toolExecutions, 1);
  assert.equal(initialModelCalls, 2, "a retry-safe transport failure still cannot replay after a tool side effect");
  assert.equal(interruption?.code, "CONNECTION_FAILED");
  assert.equal(interruption?.checkpoint.nextTurn, 2);
  assert.deepEqual(interruption?.checkpoint.seenToolCallIds, ["call-once-before-interruption"]);
  assert.equal(interruption?.checkpoint.messages.at(-1)?.role, "tool");
  assert.match(interruption?.checkpoint.messages.at(-1)?.content ?? "", /preserved-result/);

  let resumedRequest: AgentModelRequest | undefined;
  const resumed = await new AgentRunner({
    model: {
      async complete(request) {
        resumedRequest = request;
        return { content: "The preserved operation was verified and the task is complete." };
      },
    },
    tools: registry,
    permissionMode: "read_only",
  }).run({
    prompt: "retry",
    runId: "run-checkpoint-interruption-002",
    checkpoint: retryAgentRunCheckpoint(interruption!.checkpoint, "run-checkpoint-interruption-002"),
  });

  assert.equal(resumed.status, "completed");
  assert.equal(toolExecutions, 1, "completed side effects must not run twice after automatic recovery");
  assert.equal(resumedRequest?.messages.at(-1)?.role, "tool");
  assert.match(resumedRequest?.messages.at(-1)?.content ?? "", /preserved-result/);
});

test("delegation performs a real child model run with a narrower tool allowlist", async () => {
  const registry = new AgentToolRegistry();
  let readExecutions = 0;
  let writeExecutions = 0;
  registry.register({
    name: "test.read",
    description: "read",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    readExecutions += 1;
    return { modelOutput: { value: "child-data" }, summary: { title: "read" } };
  });
  registry.register({
    name: "test.write",
    description: "write",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    writeExecutions += 1;
    return { modelOutput: { written: true }, summary: { title: "write" } };
  });

  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      modelCalls += 1;
      const firstUser = request.messages.find(message => message.role === "user")?.content;
      const toolMessages = request.messages.filter(message => message.role === "tool");
      if (firstUser === "parent task" && !toolMessages.length) {
        assert.equal(request.tools.some(tool => tool.name === AGENT_DELEGATE_TOOL_NAME), true);
        return {
          toolCalls: [{
            id: "delegate-child-1",
            name: AGENT_DELEGATE_TOOL_NAME,
            arguments: { task: "child task", tools: ["test.read"], permissionMode: "full_access" },
          }],
          usage: { inputTokens: 10, outputTokens: 2 },
        };
      }
      if (firstUser === "child task" && !toolMessages.length) {
        assert.deepEqual(request.tools.map(tool => tool.name), ["test.read"]);
        return {
          toolCalls: [
            { id: "child-read-1", name: "test.read", arguments: {} },
            { id: "child-write-1", name: "test.write", arguments: {} },
          ],
          usage: { inputTokens: 7, outputTokens: 3 },
        };
      }
      if (firstUser === "child task") {
        assert.match(toolMessages[0]?.content ?? "", /child-data/);
        assert.match(toolMessages[1]?.content ?? "", /TOOL_NOT_ALLOWED/);
        return { content: "child complete", usage: { inputTokens: 5, outputTokens: 4 } };
      }
      const delegated = JSON.parse(toolMessages[0]?.content ?? "{}") as {
        output?: AgentDelegateOutput;
      };
      assert.equal(delegated.output?.finalText, "child complete");
      assert.equal(delegated.output?.receipt.outcome, "completed");
      assert.equal(delegated.output?.receipt.retrySafe, true);
      return { content: "parent complete", usage: { inputTokens: 6, outputTokens: 3 } };
    },
  };
  new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "full_access",
    allowedToolNames: ["test.read", "test.write"],
    maxDepth: 1,
  }).register();

  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
  }).run({ prompt: "parent task", runId: "run-delegation-root-001" });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "parent complete");
  assert.equal(modelCalls, 4);
  assert.equal(readExecutions, 1);
  assert.equal(writeExecutions, 0);
  assert.deepEqual(result.usage, { inputTokens: 28, outputTokens: 12 });
});

test("delegated children can use the parent-owned question channel", async () => {
  const registry = new AgentToolRegistry();
  let asked = 0;
  const model: AgentModelClient = {
    async complete(request) {
      const firstUser = request.messages.find(message => message.role === "user")?.content;
      const toolMessages = request.messages.filter(message => message.role === "tool");
      if (firstUser === "parent question task" && !toolMessages.length) {
        return { toolCalls: [{ id: "delegate-question-child", name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: "child ask" } }] };
      }
      if (firstUser === "child ask" && !toolMessages.length) {
        return { toolCalls: [{ id: "child-question", name: "task.request_user_input", arguments: { prompt: "Choose a color", options: [{ id: "blue", label: "Blue" }] } }] };
      }
      if (firstUser === "child ask") {
        assert.match(toolMessages[0]?.content ?? "", /answered/);
        return { content: "child received answer" };
      }
      return { content: "parent received child" };
    },
  };
  new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
    maxDepth: 1,
  }).register();
  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    requestUserInput: async question => {
      asked += 1;
      assert.equal(question.prompt, "Choose a color");
      return { status: "answered", answer: { optionId: "blue", optionLabel: "Blue" } };
    },
  }).run({ prompt: "parent question task", runId: "run-delegated-question-001" });
  assert.equal(result.status, "completed");
  assert.equal(asked, 1);
  assert.equal(result.finalText, "parent received child");
});

test("delegation receipts are bounded and fail closed for unknown side effects", () => {
  const completed = createAgentChildReceipt({ status: "completed" });
  assert.deepEqual(completed, {
    outcome: "completed",
    retrySafe: true,
    unknownSideEffect: false,
    summary: "Child task completed",
  });

  const partial = createAgentChildReceipt({ status: "limit_reached", checkpointAvailable: true });
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.retrySafe, true);

  const unknown = createAgentChildReceipt({
    status: "failed",
    events: [{
      type: "tool_completed",
      callId: "unknown-effect-call",
      toolName: "workspace.write_file",
      ok: false,
      status: "failed",
      summary: { title: "write" },
      failure: {
        code: "TOOL_EXECUTION_UNKNOWN",
        message: "The handler stopped after the effect began; Authorization: Bearer sk-secret-child-123456789",
      },
      durationMs: 2,
      at: new Date(0).toISOString(),
    }],
  });
  assert.equal(unknown.outcome, "unknown");
  assert.equal(unknown.retrySafe, false);
  assert.equal(unknown.unknownSideEffect, true);
  assert.equal(unknown.failure?.code, "TOOL_EXECUTION_UNKNOWN");
  assert.doesNotMatch(unknown.failure?.message || "", /sk-secret-child/);
});

test("delegated children receive bounded project context without parent conversation history", async () => {
  const registry = new AgentToolRegistry();
  let observedToolContext: string | undefined;
  registry.register({
    name: "test.read",
    description: "read",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async (_input, context) => {
    observedToolContext = context.taskContext?.workspaceRoot;
    return { modelOutput: { value: "context-ok" }, summary: { title: "read" } };
  });
  for (const name of ["nextmux.search_conversations", "nextmux.get_conversation_message"]) {
    registry.register({
      name,
      description: "global history lookup",
      inputSchema: { type: "object" },
      requiredPermission: "read_only",
      source: "builtin",
    }, async () => ({ modelOutput: { value: "must-not-run" }, summary: { title: name } }));
  }
  const lifecycle: AgentDelegationLifecycle[] = [];
  let childRequest: AgentModelRequest | undefined;
  let childToolNames: readonly string[] | undefined;
  const model: AgentModelClient = {
    async complete(request) {
      const userMessages = request.messages.filter(message => message.role === "user");
      const latestUser = userMessages.at(-1)?.content;
      const toolMessages = request.messages.filter(message => message.role === "tool");
      if (latestUser === "parent task" && !toolMessages.length) {
        return {
          toolCalls: [{
            id: "delegate-context-1",
            name: AGENT_DELEGATE_TOOL_NAME,
            arguments: { task: "child task" },
          }],
        };
      }
      if (latestUser !== "child task") {
        return { content: "parent complete" };
      }
      childRequest = request;
      childToolNames = request.tools.map(tool => tool.name);
      if (request.messages.some(message => message.content.includes("PRIVATE_PARENT_HISTORY"))) {
        throw new Error("parent history leaked into child request");
      }
      if (!request.messages.some(message => message.content === "child task")) {
        throw new Error("child task was not sent");
      }
      if (!request.messages.some(message => message.role === "tool")) {
        return { toolCalls: [{ id: "child-read-context", name: "test.read", arguments: {} }] };
      }
      return { content: "child context complete" };
    },
  };
  new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: ["test.read", "nextmux.search_conversations", "nextmux.get_conversation_message"],
    onLifecycle: event => { lifecycle.push(event); },
  }).register();
  const taskContext = createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    conversationId: "conversation-context-001",
    goal: "Inspect the terminal and summarize the result",
    constraints: ["Do not modify files"],
    relevantPaths: ["packages/agent-runtime/src/delegation.ts"],
    recentOperations: ["read package.json"],
    selectedMemory: [{
      id: "approved-summary-001",
      kind: "summary",
      text: "The terminal contract is already verified; inspect only the remaining failure.",
      sourceRunId: "run-context-root-001",
      maxCharacters: 2000,
    }],
    rootRunId: "run-context-root-001",
    depth: 0,
    permissionMode: "read_only",
    allowedToolNames: ["test.read", "nextmux.search_conversations", "nextmux.get_conversation_message"],
  });
  const result = await new AgentRunner({
    model,
    tools: registry,
    permissionMode: "read_only",
    taskContext,
  }).run({
    prompt: "parent task",
    history: [{ role: "user", content: "PRIVATE_PARENT_HISTORY" }],
    runId: "run-context-root-001",
  });

  assert.equal(result.status, "completed");
  assert.equal(observedToolContext, "C:\\workspace\\nextmux");
  assert.match(childRequest?.instructions || "", /C:\\workspace\\nextmux/);
  assert.match(childRequest?.instructions || "", /Inspect the terminal/);
  assert.match(childRequest?.instructions || "", /terminal contract is already verified/);
  assert.equal(childRequest?.messages.some(message => message.content.includes("PRIVATE_PARENT_HISTORY")), false);
  assert.deepEqual(childToolNames, ["test.read"]);
  const started = lifecycle[0];
  const completed = lifecycle.at(-1);
  assert.equal(started?.type, "started");
  assert.equal(completed?.type, "completed");
  assert.equal(started?.childRunId, completed?.childRunId);
});

test("selected task memory is bounded, explicit, and inherited without importing a transcript", () => {
  const parent = createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    conversationId: "conversation-memory-001",
    goal: "parent goal",
    selectedMemory: [{
      id: "file-summary-001",
      kind: "file_ref",
      ref: "src/app.ts#L10-L20",
      text: "The selected implementation owns the request boundary.",
      maxCharacters: 64,
    }],
  });
  const child = childAgentTaskContext(parent, {
    goal: "child goal",
    parentRunId: "parent-memory-001",
  });

  assert.equal(child.selectedMemory.length, 1);
  assert.equal(child.selectedMemory[0]?.id, "file-summary-001");
  assert.equal(child.selectedMemory[0]?.maxCharacters, 64);
  const instruction = agentTaskContextInstruction(child);
  assert.match(instruction, /selectedMemory \(explicit bounded items only\)/);
  assert.match(instruction, /request boundary/);
  assert.doesNotMatch(instruction, /PRIVATE_PARENT_HISTORY/);

  assert.throws(() => createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    goal: "invalid memory",
    selectedMemory: [{ id: "bad-memory", kind: "summary", maxCharacters: 0, text: "x" }],
  }), error => error instanceof AgentToolError && error.code === "INVALID_TASK_CONTEXT");
  assert.throws(() => createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    goal: "invalid memory",
    selectedMemory: Array.from({ length: 7 }, (_, index) => ({
      id: `large-memory-${index}`,
      kind: "summary" as const,
      maxCharacters: 4_000,
      text: "x".repeat(4_000),
    })),
  }), error => error instanceof AgentToolError && error.code === "INVALID_TASK_CONTEXT");
});

test("delegation ledger keeps bounded lineage diagnostics without retaining child transcripts", () => {
  const rootRunId = "root-ledger-001";
  const taskContext = createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    conversationId: "conversation-ledger-001",
    goal: "parent goal",
    selectedMemory: [{
      id: "selected-file-001",
      kind: "file_ref",
      ref: "src/app.ts#L1-L4",
      text: "approved context",
      maxCharacters: 128,
    }],
  });
  let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: "started",
    parentRunId: "parent-ledger-001",
    rootRunId,
    childRunId: "child-ledger-001",
    depth: 1,
    task: "inspect the selected file",
    taskContext,
  }, new Date(1_000).toISOString());
  for (let index = 0; index < AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD + 20; index += 1) {
    ledger = applyAgentDelegationLifecycle(ledger, {
      type: "event",
      parentRunId: "parent-ledger-001",
      rootRunId,
      childRunId: "child-ledger-001",
      depth: 1,
      event: {
        type: "assistant_delta",
        turn: 1,
        delta: `PRIVATE_TRANSCRIPT_${index}`,
        at: new Date(2_000 + index).toISOString(),
      },
    });
  }
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: "failed",
    parentRunId: "parent-ledger-001",
    rootRunId,
    childRunId: "child-ledger-001",
    depth: 1,
    task: "inspect the selected file",
    taskContext,
    error: { code: "CHILD_FAILED", message: "Authorization: Bearer sk-ledger-secret-123456789" },
    receipt: {
      outcome: "failed",
      retrySafe: false,
      unknownSideEffect: false,
      summary: "child failed after inspection",
      failure: { code: "CHILD_FAILED", message: "Authorization: Bearer sk-ledger-secret-123456789" },
    },
  }, new Date(10_000).toISOString());

  const child = ledger.children[0];
  assert.equal(child?.status, "failed");
  assert.equal(child?.eventCount, AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD);
  assert.equal(child?.lastEventType, "assistant_delta");
  assert.equal(child?.taskContext?.selectedMemory[0]?.text, "approved context");
  assert.doesNotMatch(JSON.stringify(ledger), /PRIVATE_TRANSCRIPT/);
  assert.doesNotMatch(JSON.stringify(ledger), /sk-ledger-secret/);
  assert.equal(applyAgentDelegationLifecycle(ledger, {
    type: "event",
    parentRunId: "other-parent-001",
    rootRunId: "other-root-001",
    childRunId: "child-ledger-001",
    depth: 1,
    event: { type: "model_started", turn: 1, at: new Date(20_000).toISOString() },
  }).updatedAt, ledger.updatedAt);

  const normalized = normalizeAgentDelegationLedger(JSON.parse(JSON.stringify(ledger)));
  assert.equal(normalized?.children.length, 1);
  assert.equal(normalized?.children[0]?.receipt?.failure?.message, "Child operation failed (CHILD_FAILED)");
});

test("delegation ledger records one authoritative root aggregate without double-counting child usage", () => {
  const rootRunId = "root-usage-ledger-001";
  const taskContext = createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    conversationId: "conversation-usage-ledger-001",
    goal: "aggregate usage",
  });
  let ledger = createAgentDelegationLedger(rootRunId, new Date(0).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: "started",
    parentRunId: "parent-usage-ledger-001",
    rootRunId,
    childRunId: "child-usage-ledger-001",
    depth: 1,
    task: "child aggregate",
    taskContext,
  }, new Date(1_000).toISOString());
  ledger = applyAgentDelegationLifecycle(ledger, {
    type: "completed",
    parentRunId: "parent-usage-ledger-001",
    rootRunId,
    childRunId: "child-usage-ledger-001",
    depth: 1,
    task: "child aggregate",
    taskContext,
    result: {
      runId: "child-result-usage-001",
      status: "completed",
      stopReason: "completed",
      finalText: "done",
      receipt: createAgentChildReceipt({ status: "completed" }),
      depth: 1,
      usage: { inputTokens: 12, outputTokens: 4 },
      turns: 2,
      toolCalls: 1,
    },
  }, new Date(2_000).toISOString());
  assert.deepEqual(ledger.children[0]?.usage, { inputTokens: 12, outputTokens: 4, usageKnown: true });

  // The root result already includes the child.  Persisting it as the single
  // aggregate prevents a later UI/billing consumer from adding 12/4 again.
  ledger = recordAgentDelegationUsage(ledger, { inputTokens: 30, outputTokens: 10 }, true, new Date(3_000).toISOString());
  assert.deepEqual(ledger.usage, { inputTokens: 30, outputTokens: 10, usageKnown: true });
  ledger = recordAgentDelegationUsage(ledger, { inputTokens: 20, outputTokens: 8 }, false, new Date(4_000).toISOString());
  assert.deepEqual(ledger.usage, { inputTokens: 30, outputTokens: 10, usageKnown: false });
  const normalized = normalizeAgentDelegationLedger(JSON.parse(JSON.stringify(ledger)));
  assert.deepEqual(normalized?.usage, ledger.usage);
  assert.deepEqual(normalized?.children[0]?.usage, ledger.children[0]?.usage);
});

test("delegation memoryIds explicitly narrows approved context and fails closed for unavailable ids", async () => {
  const registry = new AgentToolRegistry();
  const parentContext = createAgentTaskContext({
    workspaceRoot: "C:\\workspace\\nextmux",
    conversationId: "conversation-memory-selector-001",
    goal: "parent selector goal",
    selectedMemory: [
      { id: "memory-one", kind: "summary", text: "FIRST_APPROVED_MEMORY", maxCharacters: 100 },
      { id: "memory-two", kind: "summary", text: "SECOND_APPROVED_MEMORY", maxCharacters: 100 },
    ],
  });
  let instruction = "";
  const runtime = new AgentDelegationRuntime({
    model: {
      async complete(request) {
        instruction = request.instructions || "";
        return { content: "selected" };
      },
    },
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
  });
  runtime.register();
  const selected = await registry.execute({
    id: "delegate-memory-selector",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "use one memory", memoryIds: ["memory-two"] },
  }, "read_only", {
    runId: "parent-memory-selector-001",
    workspaceRoot: parentContext.workspaceRoot,
    taskContext: parentContext,
  });
  assert.equal(selected.ok, true);
  assert.match(instruction, /SECOND_APPROVED_MEMORY/);
  assert.doesNotMatch(instruction, /FIRST_APPROVED_MEMORY/);

  const empty = await registry.execute({
    id: "delegate-memory-empty",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "use no memory", memoryIds: [] },
  }, "read_only", {
    runId: "parent-memory-selector-002",
    workspaceRoot: parentContext.workspaceRoot,
    taskContext: parentContext,
  });
  assert.equal(empty.ok, true);
  assert.doesNotMatch(instruction, /SECOND_APPROVED_MEMORY/);

  const missing = await registry.execute({
    id: "delegate-memory-missing",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "use missing memory", memoryIds: ["memory-missing"] },
  }, "read_only", {
    runId: "parent-memory-selector-003",
    workspaceRoot: parentContext.workspaceRoot,
    taskContext: parentContext,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "MEMORY_REFERENCE_UNAVAILABLE");
});

test("delegation cannot elevate the parent permission mode", async () => {
  const registry = new AgentToolRegistry();
  let executions = 0;
  registry.register({
    name: "test.process",
    description: "process",
    inputSchema: { type: "object" },
    requiredPermission: "full_access",
    source: "builtin",
  }, async () => {
    executions += 1;
    return { modelOutput: {}, summary: { title: "process" } };
  });
  let childTurn = 0;
  const model: AgentModelClient = {
    async complete(request) {
      childTurn += 1;
      if (childTurn === 1) {
        assert.equal(request.tools.some(tool => tool.name === "test.process"), false);
        return { toolCalls: [{ id: "forbidden-process", name: "test.process", arguments: {} }] };
      }
      assert.match(request.messages.at(-1)?.content ?? "", /PERMISSION_DENIED/);
      return { content: "permission contained" };
    },
  };
  const runtime = new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "full_access",
    allowedToolNames: ["test.process"],
  });
  runtime.register();
  const delegated = await registry.execute({
    id: "delegate-permission",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "try process", permissionMode: "full_access" },
  }, "read_only", { runId: "run-delegate-permission" });
  assert.equal(delegated.ok, true);
  assert.equal((delegated.output as AgentDelegateOutput).finalText, "permission contained");
  assert.equal(executions, 0);
});

test("delegation is cancellable while the child model is running", async () => {
  const registry = new AgentToolRegistry();
  const model: AgentModelClient = {
    async complete(request) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        request.signal?.addEventListener("abort", onAbort, { once: true });
        if (request.signal?.aborted) onAbort();
      });
      return { content: "unreachable" };
    },
  };
  const runtime = new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
  });
  runtime.register();
  const controller = new AbortController();
  const pending = registry.execute({
    id: "delegate-cancel",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "wait" },
  }, "read_only", { runId: "run-delegate-cancel", signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal((result.output as AgentDelegateOutput).status, "cancelled");
});

test("delegation depth is bounded and the delegate tool disappears at the final level", async () => {
  const registry = new AgentToolRegistry();
  let childRequests = 0;
  const model: AgentModelClient = {
    async complete(request) {
      childRequests += 1;
      assert.equal(request.tools.some(tool => tool.name === AGENT_DELEGATE_TOOL_NAME), false);
      return { content: "depth one complete" };
    },
  };
  const runtime = new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
    maxDepth: 1,
  });
  runtime.register();
  const first = await registry.execute({
    id: "delegate-depth-first",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "depth one" },
  }, "read_only", { runId: "run-delegate-depth", delegationDepth: 0 });
  assert.equal(first.ok, true);
  assert.equal(childRequests, 1);

  const blocked = await registry.execute({
    id: "delegate-depth-blocked",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "too deep" },
  }, "read_only", {
    runId: "run-delegate-depth",
    delegationDepth: 1,
    allowedToolNames: [AGENT_DELEGATE_TOOL_NAME],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error?.code, "DELEGATION_DEPTH_LIMIT");
  assert.equal(childRequests, 1);
});

test("delegation enforces its child turn and tool-call budgets", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.tick",
    description: "tick",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { tick: true }, summary: { title: "tick" } }));
  let modelCalls = 0;
  const model: AgentModelClient = {
    async complete() {
      modelCalls += 1;
      return { toolCalls: [{ id: `tick-${modelCalls}`, name: "test.tick", arguments: {} }] };
    },
  };
  const runtime = new AgentDelegationRuntime({
    model,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: ["test.tick"],
    maxTurns: 2,
    maxToolCalls: 2,
  });
  runtime.register();
  const delegated = await registry.execute({
    id: "delegate-budget",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "keep ticking", maxTurns: 2 },
  }, "read_only", { runId: "run-delegate-budget" });
  const output = delegated.output as AgentDelegateOutput;
  assert.equal(output.status, "limit_reached");
  assert.equal(output.turns, 2);
  assert.equal(output.toolCalls, 2);
  assert.equal(modelCalls, 2);

  const invalid = await registry.execute({
    id: "delegate-budget-invalid",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "too many turns", maxTurns: 3 },
  }, "read_only", { runId: "run-delegate-budget" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, "INVALID_DELEGATION_INPUT");
});

test("delegated token budgets narrow the child and block unverified tool execution", async () => {
  const registry = new AgentToolRegistry();
  let executions = 0;
  registry.register({
    name: "test.budgeted_child_tool",
    description: "child side effect",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => {
    executions += 1;
    return { modelOutput: { executed: true }, summary: { title: "child side effect" } };
  });
  let receivedCeiling: number | undefined;
  const runtime = new AgentDelegationRuntime({
    model: {
      async complete(request) {
        receivedCeiling = request.maxOutputTokens;
        return {
          toolCalls: [{ id: "budgeted-child-call-1", name: "test.budgeted_child_tool", arguments: {} }],
          usage: { inputTokens: 2, outputTokens: 5 },
        };
      },
    },
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: ["test.budgeted_child_tool"],
  });
  runtime.register();

  const delegated = await registry.execute({
    id: "delegate-token-budget",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: {
      task: "run the bounded child",
      maxInputTokens: 100_000,
      maxOutputTokens: 4,
    },
  }, "read_only", { runId: "run-delegate-token-budget" });

  assert.equal(delegated.ok, true);
  const output = delegated.output as AgentDelegateOutput;
  assert.equal(receivedCeiling, 4);
  assert.equal(executions, 0);
  assert.equal(output.status, "limit_reached");
  assert.equal(output.stopReason, "output_token_limit_reached");
  assert.equal(output.receipt.outcome, "partial");
  assert.equal(output.tokenBudget?.remainingOutputTokens, 0);
});

test("delegation persists a bounded child checkpoint and returns only its opaque handle", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.tick",
    description: "tick",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { tick: true }, summary: { title: "tick" } }));

  let persisted: {
    checkpoint: Parameters<NonNullable<ConstructorParameters<typeof AgentDelegationRuntime>[0]["persistCheckpoint"]>>[0];
    metadata: Parameters<NonNullable<ConstructorParameters<typeof AgentDelegationRuntime>[0]["persistCheckpoint"]>>[1];
  } | undefined;
  const lifecycle: AgentDelegationLifecycle[] = [];
  const runtime = new AgentDelegationRuntime({
    model: {
      async complete() {
        return { toolCalls: [{ id: "checkpoint-tick-1", name: "test.tick", arguments: {} }] };
      },
    },
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: ["test.tick"],
    maxTurns: 1,
    maxToolCalls: 2,
    onLifecycle: event => { lifecycle.push(event); },
    persistCheckpoint: async (checkpoint, metadata) => {
      persisted = { checkpoint, metadata };
      return "resume-child-handle-001";
    },
  });
  runtime.register();

  const delegated = await registry.execute({
    id: "delegate-checkpoint",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "persist this child state", maxTurns: 1 },
  }, "read_only", {
    runId: "parent-checkpoint-001",
    workspaceRoot: "C:\\workspace\\nextmux",
    taskContext: createAgentTaskContext({
      workspaceRoot: "C:\\workspace\\nextmux",
      conversationId: "conversation-checkpoint-001",
      goal: "parent goal",
      constraints: ["keep the child bounded"],
      relevantPaths: ["packages/agent-runtime/src/delegation.ts"],
      recentOperations: ["read package.json"],
      rootRunId: "root-checkpoint-001",
      depth: 0,
      permissionMode: "read_only",
      allowedToolNames: ["test.tick"],
    }),
  });

  assert.equal(delegated.ok, true);
  const output = delegated.output as AgentDelegateOutput;
  assert.equal(output.status, "limit_reached");
  assert.equal(output.receipt.outcome, "partial");
  assert.equal(output.receipt.retrySafe, true);
  assert.equal(output.stopReason, "turn_limit_reached");
  assert.equal(output.resumeCheckpointId, "resume-child-handle-001");
  assert.equal(output.checkpointError, undefined);
  assert.ok(persisted);
  assert.equal(persisted.metadata.parentRunId, "parent-checkpoint-001");
  assert.equal(persisted.metadata.rootRunId, "root-checkpoint-001");
  assert.equal(persisted.metadata.depth, 1);
  assert.equal(persisted.metadata.status, "limit_reached");
  assert.equal(persisted.metadata.stopReason, "turn_limit_reached");
  assert.equal(persisted.metadata.taskContext.conversationId, "conversation-checkpoint-001");
  assert.match(persisted.checkpoint.runId, /^child-/);
  assert.equal(lifecycle.at(-1)?.type, "completed");
  assert.equal((lifecycle.at(-1) as Extract<AgentDelegationLifecycle, { type: "completed" }>).resumeCheckpointId,
    "resume-child-handle-001");
});

test("completed delegated children retain a private continuation checkpoint", async () => {
  const registry = new AgentToolRegistry();
  let persisted: AgentRunCheckpoint | undefined;
  const childModel: AgentModelClient = {
    async complete(request) {
      if (request.messages.some(message => message.role === "assistant" && message.content === "child answer")) {
        assert.equal(request.messages.at(-1)?.content, "continue inside the child");
        return { content: "child follow-up answer" };
      }
      assert.equal(request.messages.at(-1)?.content, "child with memory");
      return { content: "child answer" };
    },
  };
  const runtime = new AgentDelegationRuntime({
    model: childModel,
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
    persistCheckpoint: async checkpoint => {
      persisted = checkpoint;
      return "resume-completed-child-001";
    },
  });
  runtime.register();

  const delegated = await registry.execute({
    id: "delegate-completed-child",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "child with memory" },
  }, "read_only", { runId: "parent-completed-child" });

  assert.equal(delegated.ok, true);
  const output = delegated.output as AgentDelegateOutput;
  assert.equal(output.status, "completed");
  assert.equal(output.resumeCheckpointId, "resume-completed-child-001");
  assert.ok(persisted);
  assert.deepEqual(persisted?.messages.slice(-2), [
    { role: "user", content: "child with memory" },
    { role: "assistant", content: "child answer" },
  ]);

  const continued = await new AgentRunner({
    model: childModel,
    tools: registry,
    permissionMode: "read_only",
  }).run({
    prompt: "continue inside the child",
    checkpoint: rebaseAgentRunCheckpoint(persisted!, {
      runId: "child-continuation-001",
      direction: "continue inside the child",
    }),
  });
  assert.equal(continued.finalText, "child follow-up answer");
});

test("delegation persists an interrupted child checkpoint without turning it into a false success", async () => {
  const registry = new AgentToolRegistry();
  const lifecycle: AgentDelegationLifecycle[] = [];
  let persistedStatus: AgentRunStatus | "running" | "failed" | undefined;
  let persistedRunId: string | undefined;
  const runtime = new AgentDelegationRuntime({
    model: {
      async complete() {
        const error = Object.assign(new Error("upstream stopped before a response; Authorization: Bearer sk-secret-child-123456789"), {
          code: "UPSTREAM_FAILED",
          retryable: false,
          retrySafe: false,
        });
        throw error;
      },
    },
    tools: registry,
    maxPermissionMode: "read_only",
    allowedToolNames: [],
    onLifecycle: event => { lifecycle.push(event); },
    persistCheckpoint: async (checkpoint, metadata) => {
      persistedStatus = metadata.status;
      persistedRunId = checkpoint.runId;
      return "resume-failed-child-001";
    },
  });
  runtime.register();

  const delegated = await registry.execute({
    id: "delegate-interrupted-checkpoint",
    name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: "preserve the interrupted child" },
  }, "read_only", { runId: "parent-interrupted-001" });

  assert.equal(delegated.ok, false);
  assert.equal(delegated.error?.childReceipt?.outcome, "failed");
  assert.equal(delegated.error?.childReceipt?.retrySafe, false);
  assert.equal(persistedStatus, "failed");
  assert.match(persistedRunId ?? "", /^child-/);
  const failed = lifecycle.at(-1);
  assert.equal(failed?.type, "failed");
  assert.equal((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).resumeCheckpointId,
    "resume-failed-child-001");
  assert.ok((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).checkpoint);
  assert.equal((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).error.code, "UPSTREAM_FAILED");
  assert.equal((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).receipt.outcome, "failed");
  assert.equal((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).receipt.retrySafe, false);
  assert.doesNotMatch((failed as Extract<AgentDelegationLifecycle, { type: "failed" }>).error.message, /sk-secret-child/);
});

test("a malformed tool call is asked again once nothing was shown or run, and its paid usage still counts", async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  const model: AgentModelClient = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("The model produced a malformed tool call"), {
          code: "upstream_tool_call_malformed", providerAccepted: true, usageKnown: true, status: 502,
          usage: { inputTokens: 4777, outputTokens: 163 },
        });
      }
      return { content: "recovered", usage: { inputTokens: 4777, outputTokens: 20 }, usageKnown: true };
    },
  };
  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "call a tool", runId: "run-malformed-tool-call-001" });
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "recovered");
  assert.equal(calls, 2);
  assert.deepEqual(result.events.filter(event => event.type === "model_retry_scheduled").map(event => event.type === "model_retry_scheduled" ? event.reason : ""), ["MALFORMED_TOOL_CALL"]);
  assert.equal(result.usage?.inputTokens, 4777 * 2, "the failed attempt was billed and is counted");
});

test("a malformed tool call after visible text is not asked again", async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  const model: AgentModelClient = {
    async complete() {
      calls += 1;
      throw Object.assign(new Error("The model produced a malformed tool call"), {
        code: "upstream_tool_call_malformed", providerAccepted: true, usageKnown: true, partial: { content: "Let me read", toolCalls: [] },
      });
    },
  };
  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "call a tool", runId: "run-malformed-tool-call-002" }).catch(error => ({ status: "thrown", error }));
  assert.equal(calls, 1);
  assert.notEqual((result as { status: string }).status, "completed");
});

test("cancelling mid-stream flushes held partial text into events, finalText, and checkpoint messages", async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "test.read",
    description: "Read file",
    inputSchema: { type: "object" },
    requiredPermission: "read_only",
    source: "builtin",
  }, async () => ({ modelOutput: { ok: true }, summary: { title: "read" } }));
  const controller = new AbortController();
  const model: AgentModelClient = {
    async complete(request) {
      await request.onTextDelta?.("Partial streamed answer before stop.");
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError", code: "CANCELLED" });
    },
  };
  const result = await new AgentRunner({ model, tools: registry, permissionMode: "read_only" })
    .run({ prompt: "explain this", runId: "run-cancel-partial-stream-001", signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.stopReason, "cancel_requested");
  assert.equal(result.finalText, "Partial streamed answer before stop.");
  assert.deepEqual(result.finalMessage, { origin: "runtime", stopReason: "cancel_requested" });
  assert.equal(
    result.events.filter(event => event.type === "assistant_delta").map(event => event.delta).join(""),
    "Partial streamed answer before stop.",
  );
  assert.deepEqual(result.checkpoint?.messages.at(-1), {
    role: "assistant",
    content: "Partial streamed answer before stop.",
  });
});
