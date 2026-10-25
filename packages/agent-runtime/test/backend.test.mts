import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

import {
  AgentToolRegistry,
  AcpAgentBackend,
  AgentBackendCapabilityError,
  BuiltinAgentBackend,
  AgentRunPauseError,
  createToolRegistryAcpHost,
  type AcpAgentHost,
  type AgentRunEvent,
  WorkspaceToolRuntime,
} from "../lib/index.js";

test("builtin backend advertises and forwards the cumulative token budget", async () => {
  const tools = new AgentToolRegistry();
  let capturedMaxOutputTokens: number | undefined;
  const backend = new BuiltinAgentBackend({
    model: {
      async complete(request) {
        capturedMaxOutputTokens = request.maxOutputTokens;
        return {
          content: "bounded completion",
          usage: { inputTokens: 1, outputTokens: 2 },
        };
      },
    },
    tools,
  });

  const result = await backend.run({
    prompt: "complete within the budget",
    workspaceRoot: process.cwd(),
    permissionMode: "read_only",
    tokenBudget: { maxOutputTokens: 8 },
    runId: "builtin-budget-test-001",
  });

  assert.equal(backend.capabilities.tokenBudget, true);
  assert.equal(capturedMaxOutputTokens, 8);
  assert.equal(result.tokenBudget?.usageKnown, true);
  assert.equal(result.tokenBudget?.remainingOutputTokens, 6);
});

test("ACP backend fails closed when a caller requests an unsupported token budget", async t => {
  const { workspace } = await workspaceFixture(t);
  const backend = new AcpAgentBackend({
    id: "fixture-acp-budget-rejected",
    command: process.execPath,
    args: [fixtureAgent],
  });

  await assert.rejects(
    backend.run({
      prompt: "must be rejected before spawning",
      workspaceRoot: workspace,
      permissionMode: "read_only",
      tokenBudget: { maxInputTokens: 10 },
    }),
    error => error instanceof AgentBackendCapabilityError
      && /does not support cumulative token budgets/i.test(error.message),
  );
});

const fixtureAgent = fileURLToPath(new URL("./fixtures/acp-agent.mjs", import.meta.url));

test("ACP projects old image/audio identity as text and sends current media to its agent", async t => {
  const { workspace } = await workspaceFixture(t);
  const image = { kind: 'image' as const, name: 'current.png', mimeType: 'image/png' as const, dataBase64: 'YQ==' };
  const audio = { kind: 'file' as const, name: 'current.wav', mimeType: 'audio/wav', dataBase64: 'Yg==', media: { durationSeconds: 2 } };
  const backend = new AcpAgentBackend({ id: 'fixture-acp-media-context', command: process.execPath, args: [fixtureAgent] });
  const result = await backend.run({ prompt: 'MEDIA_CONTEXT_FIXTURE', workspaceRoot: workspace, permissionMode: 'read_only',
    attachments: [image, audio], history: Array.from({ length: 30 }, (_, index) => ({ role: 'user', content: `Old task ${index}`,
      attachments: [{ ...image, name: `old-${index}.png` }, { ...audio, name: `old-${index}.wav` }] })) });
  assert.equal(result.status, 'completed');
  const output = JSON.parse(result.finalText);
  assert.equal(output.images, 1);
  assert.equal(output.audio, 1);
  assert.match(output.context, /attachment\(image\).*old-0.png.*bytes=1/);
  assert.match(output.context, /attachment\(file\).*old-29.wav.*bytes=1.*2s/);
  assert.doesNotMatch(output.context, /YQ==|Yg==/);
});

async function workspaceFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "nextmux-acp-backend-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspace };
}

async function settleWithin<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
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

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessExit(pid: number, milliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (processIsRunning(pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(processIsRunning(pid), false, `process ${pid} is still running`);
}

async function readPidWithin(path: string, milliseconds = 2_000): Promise<number> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch { /* The process has not written its PID yet. */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`process did not publish a PID within ${milliseconds}ms`);
}

test("ACP backend streams agent progress and bridges permissions, files, attachments, and terminals", async t => {
  const { root, workspace } = await workspaceFixture(t);
  const pidFile = join(root, "agent.pid");
  await writeFile(join(workspace, "input.txt"), "hello from ACP\n", "utf8");

  const calls: string[] = [];
  const host: AcpAgentHost = {
    async requestPermission(request) {
      calls.push(`permission:${request.toolCall.toolCallId}`);
      return { outcome: { outcome: "selected", optionId: "allow-once" } };
    },
    async readTextFile(request) {
      calls.push(`read:${request.path}`);
      return { content: await readFile(request.path, "utf8") };
    },
    async writeTextFile(request) {
      calls.push(`write:${request.path}`);
      await writeFile(request.path, request.content, "utf8");
      return {};
    },
    terminal: {
      async create(request) {
        calls.push(`terminal:create:${request.command}`);
        return { terminalId: "fixture-terminal" };
      },
      async output() {
        calls.push("terminal:output");
        return { output: "v-fixture", truncated: false, exitStatus: { exitCode: 0 } };
      },
      async waitForExit() {
        calls.push("terminal:wait");
        return { exitCode: 0 };
      },
      async release() {
        calls.push("terminal:release");
        return {};
      },
      async kill() {
        calls.push("terminal:kill");
        return {};
      },
    },
  };

  const backend = new AcpAgentBackend({
    id: "fixture-acp",
    command: process.execPath,
    args: [fixtureAgent],
    env: {
      ACP_TEST_PID_FILE: pidFile,
      ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href,
    },
    host,
    shutdownGraceMs: 500,
  });
  const events: AgentRunEvent[] = [];
  const result = await backend.run({
    prompt: "Run the ACP integration fixture",
    attachments: [
      { kind: "text", name: "notes.txt", content: "attached context" },
      { kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" },
    ],
    workspaceRoot: workspace,
    permissionMode: "full_access",
    onEvent: event => void events.push(event),
  });

  assert.equal(result.status, "completed");
  assert.match(result.finalText, /Done: hello from ACP; v-fixture; images=1; resources=1/);
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 5 });
  assert.equal(result.toolCalls, 3);
  assert.equal(events.some(event => event.type === "assistant_progress" && /Inspecting/.test(event.content)), true);
  const plan = events.find(event => event.type === "task_plan_updated");
  assert.deepEqual(plan?.type === "task_plan_updated" ? plan.steps : undefined, [{
    id: "acp-plan-4",
    title: "Read, write, and verify through the ACP host",
    status: "in_progress",
  }]);
  assert.equal(plan?.type === "task_plan_updated"
    ? plan.steps.some(step => /读取|找到|退出码|rg/.test(step.title))
    : true, false);
  assert.equal(events.some(event => event.type === "tool_started" && event.source === "acp"), true);
  assert.equal(events.some(event => event.type === "tool_completed" && event.ok), true);
  assert.equal(calls.some(call => call === "permission:write-output"), true);
  assert.equal(calls.some(call => call.startsWith("read:")), true);
  assert.equal(calls.some(call => call.startsWith("write:")), true);
  assert.deepEqual(calls.filter(call => call.startsWith("terminal:")), [
    `terminal:create:${process.execPath}`,
    "terminal:wait",
    "terminal:output",
    "terminal:release",
  ]);
  assert.equal(await readFile(join(workspace, "output.txt"), "utf8"), "copied:hello from ACP\n");
  assert.match(await readFile(pidFile, "utf8"), /^\d+$/);
});

test("production ACP host reuses bounded workspace tools, checkpoints, and supervised terminals", async t => {
  const { root, workspace } = await workspaceFixture(t);
  await writeFile(join(workspace, "input.txt"), "registry host\n", "utf8");
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: workspace,
    checkpointRoot: join(root, "checkpoints"),
    permissionMode: "full_access",
  });
  const tools = new AgentToolRegistry();
  runtime.registerTools(tools);
  const host = createToolRegistryAcpHost({ tools });
  const backend = new AcpAgentBackend({
    id: "fixture-acp-registry-host",
    command: process.execPath,
    args: [fixtureAgent],
    env: { ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href },
    host,
    shutdownGraceMs: 500,
  });
  const result = await backend.run({
    prompt: "Exercise the production ACP host bridge",
    workspaceRoot: workspace,
    permissionMode: "full_access",
  });

  assert.equal(result.status, "completed");
  assert.match(result.finalText, /Done: registry host; v\d+\.\d+\.\d+; images=0; resources=0/);
  assert.equal(await readFile(join(workspace, "output.txt"), "utf8"), "copied:registry host\n");
  assert.equal(result.toolCalls, 3);
  assert.equal(result.events.some(event => event.type === "tool_completed"
    && event.summary.checkpointId), true);
});

test("ACP backend cooperatively cancels a prompt and terminates its child process", async t => {
  const { root, workspace } = await workspaceFixture(t);
  const pidFile = join(root, "cancel-agent.pid");
  const controller = new AbortController();
  const backend = new AcpAgentBackend({
    id: "fixture-acp-cancel",
    command: process.execPath,
    args: [fixtureAgent],
    env: {
      ACP_TEST_PID_FILE: pidFile,
      ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href,
    },
    shutdownGraceMs: 500,
  });

  const result = await backend.run({
    prompt: "WAIT_FOR_CANCEL",
    workspaceRoot: workspace,
    permissionMode: "read_only",
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "assistant_progress" && event.content.includes("waiting")) {
        controller.abort();
      }
    },
  });

  assert.equal(result.status, "cancelled");
  assert.match(result.finalText, /waiting for cancellation/);
  const pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0));
});

test("ACP cancellation force-stops an unresponsive agent and its process tree within a bound", async t => {
  const { root, workspace } = await workspaceFixture(t);
  const pidFile = join(root, "stubborn-agent.pid");
  const grandchildPidFile = join(root, "stubborn-agent-child.pid");
  const controller = new AbortController();
  const backend = new AcpAgentBackend({
    id: "fixture-acp-stubborn-cancel",
    command: process.execPath,
    args: [fixtureAgent],
    env: {
      ACP_TEST_PID_FILE: pidFile,
      ACP_TEST_GRANDCHILD_PID_FILE: grandchildPidFile,
      ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href,
    },
    shutdownGraceMs: 250,
  });
  const cleanupPids: number[] = [];
  t.after(async () => {
    for (const path of [pidFile, grandchildPidFile]) {
      try {
        const pid = Number(await readFile(path, "utf8"));
        if (Number.isSafeInteger(pid) && pid > 0 && processIsRunning(pid)) process.kill(pid, "SIGKILL");
      } catch { /* The backend already removed the process. */ }
    }
  });

  const startedAt = Date.now();
  const result = await settleWithin(backend.run({
    prompt: "WAIT_FOREVER",
    workspaceRoot: workspace,
    permissionMode: "read_only",
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "assistant_progress" && event.content.includes("waiting forever")) {
        controller.abort();
      }
    },
  }), 5_000);
  const parentPid = Number(await readFile(pidFile, "utf8"));
  const grandchildPid = Number(await readFile(grandchildPidFile, "utf8"));
  cleanupPids.push(parentPid, grandchildPid);

  assert.equal(result.status, "cancelled");
  assert.match(result.finalText, /waiting forever until force-stopped/);
  assert.ok(Date.now() - startedAt < 5_000, "forced cancellation must remain bounded");
  await Promise.all(cleanupPids.map(pid => waitForProcessExit(pid)));
});

test("ACP host terminal stop kills a stubborn process tree and retains its exit result until release", async t => {
  const { root, workspace } = await workspaceFixture(t);
  const parentPidFile = join(root, "stubborn-terminal.pid");
  const grandchildPidFile = join(root, "stubborn-terminal-child.pid");
  const host = createToolRegistryAcpHost({
    tools: new AgentToolRegistry(),
    terminalShutdownGraceMs: 250,
  });
  t.after(() => host.dispose());
  const source = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid));`,
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000);\"], { stdio: 'ignore' });",
    `writeFileSync(${JSON.stringify(grandchildPidFile)}, String(child.pid));`,
    "process.on('SIGTERM', () => undefined);",
    "setInterval(() => undefined, 1000);",
  ].join("\n");
  const context = {
    runId: "run-acp-terminal-tree-001",
    workspaceRoot: workspace,
    permissionMode: "full_access" as const,
  };
  const sessionId = "session-acp-terminal-tree-001";
  const terminal = host.terminal;
  assert.ok(terminal);
  const created = await terminal.create({
    sessionId,
    command: process.execPath,
    args: ["-e", source],
  }, context);
  const parentPid = await readPidWithin(parentPidFile);
  const grandchildPid = await readPidWithin(grandchildPidFile);
  t.after(() => {
    for (const pid of [parentPid, grandchildPid]) {
      if (processIsRunning(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* The process already exited. */ }
      }
    }
  });

  await settleWithin(terminal.kill({ sessionId, terminalId: created.terminalId }, context), 3_000);
  await Promise.all([waitForProcessExit(parentPid), waitForProcessExit(grandchildPid)]);
  const exit = await settleWithin(
    terminal.waitForExit({ sessionId, terminalId: created.terminalId }, context),
    1_000,
  );
  assert.ok(exit.exitCode !== null || exit.signal !== null, "the stopped terminal keeps an auditable exit status");
  await terminal.release({ sessionId, terminalId: created.terminalId }, context);
  await assert.rejects(terminal.output({ sessionId, terminalId: created.terminalId }, context), /Unknown ACP terminal/);
});

test("ACP backend preserves a host pause as a distinct intent", async t => {
  const { workspace } = await workspaceFixture(t);
  const controller = new AbortController();
  const backend = new AcpAgentBackend({
    id: "fixture-acp-pause",
    command: process.execPath,
    args: [fixtureAgent],
    env: { ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href },
    shutdownGraceMs: 500,
  });

  const result = await backend.run({
    prompt: "WAIT_FOR_CANCEL",
    workspaceRoot: workspace,
    permissionMode: "read_only",
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "assistant_progress" && event.content.includes("waiting")) {
        controller.abort(new AgentRunPauseError());
      }
    },
  });

  assert.equal(result.status, "paused");
  assert.equal(result.stopReason, "pause_requested");
  assert.match(result.finalText, /waiting for cancellation/);
});

test("ACP backend closes every started tool when the agent returns without a terminal update", async t => {
  const { workspace } = await workspaceFixture(t);
  const backend = new AcpAgentBackend({
    id: "fixture-acp-open-tool",
    command: process.execPath,
    args: [fixtureAgent],
    env: { ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href },
    shutdownGraceMs: 500,
  });

  const result = await backend.run({
    prompt: "COMPLETE_WITH_OPEN_TOOL",
    workspaceRoot: workspace,
    permissionMode: "read_only",
  });
  const started = result.events.filter(event => event.type === "tool_started" && event.callId === "left-open");
  const completed = result.events.filter(event => event.type === "tool_completed" && event.callId === "left-open");

  assert.equal(started.length, 1);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.type === "tool_completed" ? completed[0].status : undefined, "failed");
});

test("ACP backend rejects unsupported image input instead of silently dropping it", async t => {
  const { workspace } = await workspaceFixture(t);
  const noImageAgent = join(dirname(fixtureAgent), "acp-agent-no-image.mjs");
  const backend = new AcpAgentBackend({
    id: "fixture-acp-no-image",
    command: process.execPath,
    args: [noImageAgent],
    env: { ACP_TEST_WORKSPACE_URL: pathToFileURL(`${workspace}/`).href },
  });

  await assert.rejects(
    backend.run({
      prompt: "inspect image",
      attachments: [{ kind: "image", name: "pixel.png", mimeType: "image/png", dataBase64: "AA==" }],
      workspaceRoot: workspace,
      permissionMode: "read_only",
    }),
    /does not support image prompt content/i,
  );
});

test("ACP tool host auto-prunes exited terminals at capacity, rejects symlink path escape, and reassembles multi-page reads with optimistic sha256 reuse (D1-18, D1-19, D9-01)", async t => {
  const { root, workspace } = await workspaceFixture(t);
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: workspace,
    checkpointRoot: join(root, "checkpoints"),
    permissionMode: "full_access",
    limits: { maxOutputChars: 120 },
  });
  t.after(() => runtime.dispose());
  const tools = new AgentToolRegistry();
  runtime.registerTools(tools);
  const host = createToolRegistryAcpHost({ tools, maximumTerminals: 1 });
  t.after(() => host.dispose());

  const context = {
    runId: "run-acp-host-edge",
    workspaceRoot: workspace,
    permissionMode: "full_access" as const,
  };
  const sessionId = "session-acp-host-edge";

  // 1. Multi-page readTextFile without limit reassembles full file and caches sha256 for subsequent writeTextFile.
  const longLines = Array.from({ length: 20 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}-${"x".repeat(10)}`).join("\n");
  await writeFile(join(workspace, "large.txt"), longLines, "utf8");
  const readRes = await host.readTextFile!({ sessionId, path: join(workspace, "large.txt") }, context);
  assert.equal(readRes.content, longLines);

  await host.writeTextFile!({ sessionId, path: join(workspace, "large.txt"), content: "updated-via-acp\n" }, context);
  assert.equal(await readFile(join(workspace, "large.txt"), "utf8"), "updated-via-acp\n");

  // 2. Reject symlink escaping workspace root.
  const outsideFile = join(root, "outside-secret.txt");
  await writeFile(outsideFile, "secret", "utf8");
  await symlink(outsideFile, join(workspace, "escape-link.txt"));
  await assert.rejects(
    host.readTextFile!({ sessionId, path: join(workspace, "escape-link.txt") }, context),
    /inside the current workspace/,
  );

  // 3. Auto-prune exited terminal when maximumTerminals (1) is reached.
  const t1 = await host.terminal!.create({ sessionId, command: process.execPath, args: ["-e", "process.exit(0)"] }, context);
  await host.terminal!.waitForExit({ sessionId, terminalId: t1.terminalId }, context);
  const t2 = await host.terminal!.create({ sessionId, command: process.execPath, args: ["-e", "process.exit(0)"] }, context);
  assert.notEqual(t2.terminalId, t1.terminalId);
  await host.terminal!.waitForExit({ sessionId, terminalId: t2.terminalId }, context);
});
