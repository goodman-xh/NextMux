import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentBackendRouter,
  AgentBackendUnavailableError,
  UnsafeBackendFailoverError,
  type AgentBackend,
  type AgentBackendRunRequest,
  type AgentRunEvent,
  type AgentRunResult,
} from "../lib/index.js";

const capabilities = {
  streaming: true,
  cancellation: true,
  sessionResume: true,
  permissions: true,
  filesystem: true,
  terminal: true,
  mcp: true,
} as const;

function result(runId: string, finalText: string, events: readonly AgentRunEvent[] = []): AgentRunResult {
  return {
    runId,
    status: "completed",
    stopReason: "completed",
    finalText,
    events,
    usage: { inputTokens: 1, outputTokens: 1 },
    turns: 1,
    toolCalls: 0,
  };
}

function backend(id: string, run: AgentBackend["run"], tokenBudget = false): AgentBackend {
  return {
    id,
    capabilities: tokenBudget ? { ...capabilities, tokenBudget: true } : capabilities,
    run,
  };
}

function request(onEvent?: (event: AgentRunEvent) => void): AgentBackendRunRequest {
  return {
    prompt: "route this task",
    workspaceRoot: "C:\\workspace",
    permissionMode: "workspace_write",
    onEvent,
  };
}

test("router skips an unsupported backend and selects the next capable candidate", async () => {
  let unsupportedRuns = 0;
  const selected = backend("selected", async run => result(run.runId!, "selected"));
  const router = new AgentBackendRouter({
    candidates: [
      {
        backend: backend("unsupported", async run => {
          unsupportedRuns += 1;
          return result(run.runId!, "wrong");
        }),
        supports: () => ({ supported: false, reason: "image input unavailable" }),
      },
      { backend: selected },
    ],
  });

  const events: AgentRunEvent[] = [];
  const routed = await router.run(request(event => events.push(event)));

  assert.equal(unsupportedRuns, 0);
  assert.equal(routed.finalText, "selected");
  assert.equal(events.some(event => event.type === "backend_selected" && event.backendId === "selected"), true);
});

test("router never sends a bounded request to a backend without budget enforcement", async () => {
  let unboundedRuns = 0;
  const unbounded = backend("unbounded", async run => {
    unboundedRuns += 1;
    return result(run.runId!, "must not run");
  });
  const bounded = backend("bounded", async run => result(run.runId!, "bounded"), true);
  const router = new AgentBackendRouter({
    candidates: [
      { backend: unbounded, priority: 100 },
      { backend: bounded, priority: 10 },
    ],
  });

  const routed = await router.run({
    ...request(),
    tokenBudget: { maxOutputTokens: 16 },
  });

  assert.equal(unboundedRuns, 0);
  assert.equal(routed.finalText, "bounded");
  assert.equal(routed.runId.length >= 8, true);
});

test("router safely falls back before user-visible output and preserves one run id", async () => {
  const runIds: string[] = [];
  const first = backend("primary", async run => {
    runIds.push(run.runId!);
    await run.onEvent?.({ type: "model_started", turn: 1, at: new Date().toISOString() });
    throw new AgentBackendUnavailableError("primary timed out");
  });
  const second = backend("fallback", async run => {
    runIds.push(run.runId!);
    const progress = { type: "assistant_progress", turn: 1, content: "Using fallback", at: new Date().toISOString() } as const;
    await run.onEvent?.(progress);
    return result(run.runId!, "done", [progress]);
  });
  const events: AgentRunEvent[] = [];
  const router = new AgentBackendRouter({ candidates: [{ backend: first }, { backend: second }] });

  const routed = await router.run(request(event => events.push(event)));

  assert.equal(routed.finalText, "done");
  assert.equal(runIds.length, 2);
  assert.equal(runIds[0], runIds[1]);
  assert.equal(routed.runId, runIds[0]);
  assert.equal(events.some(event => event.type === "backend_fallback" && event.fromBackendId === "primary" && event.toBackendId === "fallback"), true);
});

test("router never changes backend after assistant output has become visible", async () => {
  let fallbackRuns = 0;
  const primary = backend("primary", async run => {
    await run.onEvent?.({ type: "assistant_progress", turn: 1, content: "I started", at: new Date().toISOString() });
    throw new AgentBackendUnavailableError("stream disconnected");
  });
  const fallback = backend("fallback", async run => {
    fallbackRuns += 1;
    return result(run.runId!, "must not run");
  });
  const router = new AgentBackendRouter({ candidates: [{ backend: primary }, { backend: fallback }] });

  await assert.rejects(router.run(request()), UnsafeBackendFailoverError);
  assert.equal(fallbackRuns, 0);
});

test("router never changes backend after a tool may have produced side effects", async () => {
  let fallbackRuns = 0;
  const primary = backend("primary", async run => {
    await run.onEvent?.({
      type: "tool_started",
      callId: "write-1",
      toolName: "workspace.apply_patch",
      source: "builtin",
      at: new Date().toISOString(),
    });
    throw new AgentBackendUnavailableError("agent process exited");
  });
  const fallback = backend("fallback", async run => {
    fallbackRuns += 1;
    return result(run.runId!, "must not run");
  });
  const router = new AgentBackendRouter({ candidates: [{ backend: primary }, { backend: fallback }] });

  await assert.rejects(router.run(request()), UnsafeBackendFailoverError);
  assert.equal(fallbackRuns, 0);
});

test("retryable failures put a backend into cooldown instead of round-robin rotation", async () => {
  let primaryRuns = 0;
  let fallbackRuns = 0;
  const primary = backend("primary", async run => {
    primaryRuns += 1;
    throw new AgentBackendUnavailableError("temporarily offline");
  });
  const fallback = backend("fallback", async run => {
    fallbackRuns += 1;
    return result(run.runId!, `fallback-${fallbackRuns}`);
  });
  const router = new AgentBackendRouter({
    candidates: [{ backend: primary, priority: 100 }, { backend: fallback, priority: 10 }],
    cooldownMs: 60_000,
  });

  assert.equal((await router.run(request())).finalText, "fallback-1");
  assert.equal((await router.run(request())).finalText, "fallback-2");
  assert.equal(primaryRuns, 1);
  assert.equal(fallbackRuns, 2);
});

test("an explicit backend selection overrides priority and disables fallback by default", async () => {
  let highPriorityRuns = 0;
  const highPriority = backend("builtin", async run => {
    highPriorityRuns += 1;
    return result(run.runId!, "builtin");
  });
  const selected = backend("acp:goose", async () => {
    throw new AgentBackendUnavailableError("selected runtime unavailable");
  });
  const router = new AgentBackendRouter({
    candidates: [{ backend: highPriority, priority: 100 }, { backend: selected, priority: 10 }],
  });

  await assert.rejects(router.run({ ...request(), preferredBackendId: "acp:goose" }), /selected runtime unavailable/);
  assert.equal(highPriorityRuns, 0);
});

test("explicit backend fallback remains capability ordered and only runs before output", async () => {
  const runs: string[] = [];
  const builtin = backend("builtin", async run => {
    runs.push("builtin");
    return result(run.runId!, "builtin");
  });
  const selected = backend("acp:goose", async run => {
    runs.push("acp:goose");
    await run.onEvent?.({ type: "model_started", turn: 1, at: new Date().toISOString() });
    throw new AgentBackendUnavailableError("not started");
  });
  const router = new AgentBackendRouter({
    candidates: [{ backend: builtin, priority: 100 }, { backend: selected, priority: 10 }],
  });

  const routed = await router.run({
    ...request(),
    preferredBackendId: "acp:goose",
    allowBackendFallback: true,
  });
  assert.equal(routed.finalText, "builtin");
  assert.deepEqual(runs, ["acp:goose", "builtin"]);
});
