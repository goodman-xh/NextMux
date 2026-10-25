import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_COUNCIL_ROLE_IDS,
  AGENT_DELEGATE_TOOL_NAME,
  AgentDelegationRuntime,
  AgentToolRegistry,
  applyAgentDelegationLifecycle,
  buildCouncilLeadInstructions,
  buildCouncilSpecialistInstructions,
  computeChildInvocationKey,
  createAgentDelegationLedger,
  createAgentTaskContext,
  normalizeAgentDelegationLedger,
  resolveAgentCouncilSlot,
  type AgentCouncilSlotSpec,
  type AgentDelegationLifecycle,
  type AgentModelClient,
} from "../lib/index.js";

const sampleSlots: readonly AgentCouncilSlotSpec[] = [
  {
    slotId: "slot-1",
    modelId: "claude-opus-4-6",
    modelLabel: "Claude Opus 4.6",
    roles: ["lead"],
  },
  {
    slotId: "slot-2",
    modelId: "gpt-5.4",
    modelLabel: "GPT-5.4",
    roles: ["architecture", "backend"],
  },
  {
    slotId: "slot-3",
    modelId: "gemini-3.1-pro",
    modelLabel: "Gemini 3.1 Pro",
    roles: ["ui_design", "frontend", "generalist"],
  },
];

test("resolveAgentCouncilSlot routes by explicit slotId, role match, generalist fallback, and random fallback", () => {
  assert.equal(AGENT_COUNCIL_ROLE_IDS.length, 8);

  const explicit = resolveAgentCouncilSlot(sampleSlots, "architecture", "slot-3", 0);
  assert.ok(explicit);
  assert.equal(explicit.slotId, "slot-3");
  assert.equal(explicit.routeSource, "explicit_slot");

  const matched = resolveAgentCouncilSlot(sampleSlots, "architecture", undefined, 0);
  assert.ok(matched);
  assert.equal(matched.slotId, "slot-2");
  assert.equal(matched.routeSource, "role_match");

  const fallbackGeneralist = resolveAgentCouncilSlot(sampleSlots, "security", undefined, 1);
  assert.ok(fallbackGeneralist);
  assert.equal(fallbackGeneralist.slotId, "slot-3");
  assert.equal(fallbackGeneralist.routeSource, "generalist_fallback");

  const noGeneralistSlots: readonly AgentCouncilSlotSpec[] = [
    { slotId: "slot-1", modelId: "m1", modelLabel: "M1", roles: ["lead"] },
    { slotId: "slot-2", modelId: "m2", modelLabel: "M2", roles: ["architecture"] },
    { slotId: "slot-3", modelId: "m3", modelLabel: "M3", roles: ["ui_design"] },
  ];
  const randomFallback0 = resolveAgentCouncilSlot(noGeneralistSlots, "qa", undefined, 0);
  const randomFallback1 = resolveAgentCouncilSlot(noGeneralistSlots, "qa", undefined, 1);
  assert.ok(randomFallback0);
  assert.ok(randomFallback1);
  assert.equal(randomFallback0.routeSource, "random_fallback");
  assert.equal(randomFallback0.slotId, "slot-2");
  assert.equal(randomFallback1.slotId, "slot-3");
});

test("computeChildInvocationKey preserves exact request text in completed-call identities", () => {
  const keyA = computeChildInvocationKey({
    parentRunId: "run-parent-1",
    configRevision: 2,
    slotId: "slot-2",
    role: "architecture",
    task: "Design the database schema",
  });
  const keyB = computeChildInvocationKey({
    parentRunId: "run-parent-1",
    configRevision: 2,
    slotId: "slot-2",
    role: "architecture",
    task: "  Design   the database schema ",
  });
  const keyDifferentRevision = computeChildInvocationKey({
    parentRunId: "run-parent-1",
    configRevision: 3,
    slotId: "slot-2",
    role: "architecture",
    task: "Design the database schema",
  });
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^inv-[0-9a-f]{64}$/);
  assert.notEqual(keyA, keyDifferentRevision);
});

test("AgentDelegationRuntime routes Council Mode specialist calls, records ledger metadata, and replays cached ChildInvocation", async () => {
  const tools = new AgentToolRegistry();
  tools.register(
    {
      name: "workspace.read_file",
      description: "Read file",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      requiredPermission: "read_only",
      source: "builtin",
    },
    async () => ({ modelOutput: { ok: true }, summary: { title: "Read file" } })
  );

  let defaultModelCalls = 0;
  let specialistModelCalls = 0;
  let capturedSystemPrompt = "";

  const defaultModel: AgentModelClient = {
    async complete() {
      defaultModelCalls += 1;
      return {
        content: "default model output",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };

  const specialistModel: AgentModelClient = {
    async complete(request) {
      specialistModelCalls += 1;
      capturedSystemPrompt = request.instructions || "";
      return {
        content: "specialist architecture blueprint",
        usage: { inputTokens: 24, outputTokens: 18 },
      };
    },
  };

  const lifecycles: AgentDelegationLifecycle[] = [];
  const completedInvocations = new Map<string, import("../lib/index.js").AgentDelegateOutput>();

  const runtime = new AgentDelegationRuntime({
    model: defaultModel,
    tools,
    maxPermissionMode: "read_only",
    allowedToolNames: ["workspace.read_file"],
    onLifecycle: event => {
      lifecycles.push(event);
      if (event.type === "completed" && event.invocationKey) {
        completedInvocations.set(event.invocationKey, event.result);
      }
    },
    resolveChildExecution: request => {
      const decision = resolveAgentCouncilSlot(
        sampleSlots,
        request.input.role,
        request.input.slotId,
        request.dispatchIndex
      );
      if (!decision) return undefined;
      const invocationKey = computeChildInvocationKey({
        parentRunId: request.parentRunId,
        configRevision: 1,
        slotId: decision.slotId,
        role: decision.role,
        task: request.input.task,
      });
      const cachedResult = completedInvocations.get(invocationKey);
      return {
        model: specialistModel,
        instructions: buildCouncilSpecialistInstructions(decision, request.input.acceptanceCriteria),
        role: decision.role,
        slotId: decision.slotId,
        modelId: decision.modelId,
        modelLabel: decision.modelLabel,
        routeSource: decision.routeSource,
        invocationKey,
        ...(cachedResult ? { cachedResult } : {}),
      };
    },
  });
  runtime.register();

  const parentTaskContext = createAgentTaskContext({
    conversationId: "conv-main",
    rootRunId: "run-root-1",
    goal: "Build Council Mode",
    permissionMode: "read_only",
    allowedToolNames: ["workspace.read_file", AGENT_DELEGATE_TOOL_NAME],
  });

  const firstCall = await runtime.handler(
    {
      task: "Design the state machine for sub-conversations",
      role: "architecture",
      acceptanceCriteria: ["Must define 10s timer transitions", "Must preserve viewed lock"],
      tools: [],
    },
    {
      runId: "run-root-1",
      rootRunId: "run-root-1",
      permissionMode: "read_only",
      allowedToolNames: ["workspace.read_file"],
      taskContext: parentTaskContext,
    }
  );

  assert.equal(defaultModelCalls, 0);
  assert.equal(specialistModelCalls, 1);
  assert.match(capturedSystemPrompt, /方案与调研/);
  assert.match(capturedSystemPrompt, /Must define 10s timer transitions/);

  const firstOutput = firstCall.modelOutput as import("../lib/index.js").AgentDelegateOutput;
  assert.equal(firstOutput.role, "planning");
  assert.equal(firstOutput.slotId, "slot-2");
  assert.equal(firstOutput.modelId, "gpt-5.4");
  assert.equal(firstOutput.modelLabel, "GPT-5.4");
  assert.equal(firstOutput.routeSource, "role_match");
  assert.ok(firstOutput.invocationKey);

  // Second identical invocation replays from completedInvocations without calling specialistModel again
  const secondCall = await runtime.handler(
    {
      task: "Design the state machine for sub-conversations",
      role: "architecture",
      acceptanceCriteria: ["Must define 10s timer transitions", "Must preserve viewed lock"],
      tools: [],
    },
    {
      runId: "run-root-1",
      rootRunId: "run-root-1",
      permissionMode: "read_only",
      allowedToolNames: ["workspace.read_file"],
      taskContext: parentTaskContext,
    }
  );
  assert.equal(specialistModelCalls, 1);
  const secondOutput = secondCall.modelOutput as import("../lib/index.js").AgentDelegateOutput;
  assert.equal(secondOutput.finalText, "specialist architecture blueprint");
  assert.equal(secondOutput.invocationKey, firstOutput.invocationKey);

  // Verify ledger persistence and normalization preserve Council Mode fields
  let ledger = createAgentDelegationLedger("run-root-1");
  for (const event of lifecycles) {
    ledger = applyAgentDelegationLifecycle(ledger, event);
  }
  const normalized = normalizeAgentDelegationLedger(JSON.parse(JSON.stringify(ledger)));
  assert.ok(normalized);
  assert.equal(normalized.children.length, 1);
  assert.equal(secondOutput.runId, firstOutput.runId);
  assert.strictEqual(secondOutput.receipt, firstOutput.receipt);
  assert.equal(normalized.children[0].role, "planning");
  const historical = JSON.parse(JSON.stringify(ledger));
  historical.children[0].role = "architecture";
  assert.equal(normalizeAgentDelegationLedger(historical)?.children[0].role, "architecture", "historical execution role is preserved without rewriting");
  assert.equal(normalized.children[0].slotId, "slot-2");
  assert.equal(normalized.children[0].modelId, "gpt-5.4");
  assert.equal(normalized.children[0].modelLabel, "GPT-5.4");
  assert.equal(normalized.children[0].routeSource, "role_match");
  assert.equal(normalized.children[0].invocationKey, firstOutput.invocationKey);

  const leadPrompt = buildCouncilLeadInstructions(sampleSlots);
  assert.match(leadPrompt, /臭皮匠模式/);
  assert.match(leadPrompt, /GPT-5.4/);
  assert.match(leadPrompt, /Gemini 3.1 Pro/);
});

test("the lead dispatches its configured specialists first, in dependency order, and answers alone in the main conversation", () => {
  const leadPrompt = buildCouncilLeadInstructions(sampleSlots);
  // Legacy IDs (architecture, ui_design) read as the roles they became; the lead is never a role to dispatch.
  assert.match(leadPrompt, /Dispatch First \(开局先派发\).*\(configured: `planning`, `backend`, `frontend`, `generalist`\)/);
  assert.match(leadPrompt, /before long reading, analysis, or synthesis, so each role starts within seconds/);
  assert.match(leadPrompt, /Calls run one after another in the order you issue them, so order them by dependency/);
  assert.match(leadPrompt, /You alone answer in the main conversation; specialists work in their own role sub-conversations/);
  assert.doesNotMatch(leadPrompt, /configured: [^)]*`(lead|architecture|ui_design)`/);
  assert.doesNotMatch(buildCouncilLeadInstructions(sampleSlots, { disableSubagents: false }), /subagent|子智能体|子代理/i,
    "allowing subagents still writes no subagent rule");
});

test("executeCouncilSpecialistWithIsolation isolates specialist timeout/failure and AgentCouncilDispatcher routes around failed slots", async () => {
  const { AgentCouncilDispatcher, executeCouncilSpecialistWithIsolation } = await import("../lib/index.js");
  const poolSlots: readonly AgentCouncilSlotSpec[] = [
    { slotId: "lead", modelId: "claude-opus-4-6", roles: ["lead"] },
    { slotId: "backend-a", modelId: "deepseek-r1", modelLabel: "DeepSeek R1", roles: ["backend"] },
    { slotId: "backend-b", modelId: "gpt-5.4", modelLabel: "GPT-5.4", roles: ["backend", "generalist"] },
  ];
  const dispatcher = new AgentCouncilDispatcher(poolSlots);
  const decisionA = dispatcher.resolve("backend", undefined, "req-a")!;
  assert.equal(decisionA.slotId, "backend-a");

  const decisionB = dispatcher.resolve("backend", undefined, "req-b")!;
  assert.equal(decisionB.slotId, "backend-b");

  const results = await Promise.all([
    executeCouncilSpecialistWithIsolation({
      decision: decisionA,
      dispatcher,
      timeoutMs: 30,
      execute: async signal =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    }),
    executeCouncilSpecialistWithIsolation({
      decision: decisionB,
      dispatcher,
      timeoutMs: 500,
      execute: async () => "backend-b succeeded cleanly",
    }),
  ]);

  assert.equal(results[0].ok, false);
  if (!results[0].ok) {
    assert.equal(results[0].error.timedOut, true);
    assert.equal(results[0].error.code, "COUNCIL_SPECIALIST_TIMEOUT");
    assert.match(results[0].fallbackNote, /Do not retry this failed slot/);
  }
  assert.equal(results[1].ok, true);
  if (results[1].ok) {
    assert.equal(results[1].value, "backend-b succeeded cleanly");
  }
  assert.equal(dispatcher.isSlotFailed("backend-a"), true);
  assert.equal(dispatcher.isSlotFailed("backend-b"), false);

  // Subsequent dispatch for the same role skips the failed backend-a slot and routes to healthy backend-b
  const decisionC = dispatcher.resolve("backend", undefined, "req-c")!;
  assert.equal(decisionC.slotId, "backend-b");
});


test("a delegated role the team does not have is reported, not silently given to the generalist", async () => {
  const { resolveAgentCouncilRoleId } = await import("../lib/index.js");
  assert.equal(resolveAgentCouncilRoleId("UI-Design"), "frontend", "case and separators are not a different role");
  assert.equal(resolveAgentCouncilRoleId("testing"), "qa");
  assert.equal(resolveAgentCouncilRoleId("security_review"), "review");
  assert.equal(resolveAgentCouncilRoleId("devops"), "delivery");
  assert.equal(resolveAgentCouncilRoleId("astrologer"), undefined);
  // Through the real delegate tool: the call fails before any child model runs, and says which roles exist.
  const { AgentDelegationRuntime, AgentToolRegistry } = await import("../lib/index.js");
  const tools = new AgentToolRegistry();
  let childCalls = 0;
  new AgentDelegationRuntime({ tools, maxDepth: 1, allowedToolNames: [], maxPermissionMode: "read_only",
    model: { async complete() { childCalls += 1; return { content: "done" }; } } }).register();
  const refused = await tools.execute({ id: "role", name: "agent.delegate", arguments: { task: "Review the payment flow", role: "astrologer", tools: [] } }, "read_only", { runId: "role-parent" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.code, "INVALID_DELEGATION_INPUT");
  assert.match(refused.error?.message || "", /Unknown role "astrologer"\. Use one of: lead, planning, frontend, backend, qa, review, delivery, generalist\./);
  assert.equal(childCalls, 0, "no child was started");
  const accepted = await tools.execute({ id: "role-ok", name: "agent.delegate", arguments: { task: "Test the checkout", role: "Testing", tools: [] } }, "read_only", { runId: "role-parent-2" });
  assert.equal(accepted.ok, true, "a synonym resolves to its role");
  assert.equal(childCalls, 1);
});
