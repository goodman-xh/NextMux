import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry, AgentToolError, AgentDelegationRuntime, AGENT_DELEGATE_TOOL_NAME,
  AcpAgentBackend, AgentBackendRouter, BuiltinAgentBackend, createAgentTaskContext,
  rebaseAgentRunCheckpoint, retryAgentRunCheckpoint, validatedToolPolicy,
  type AgentSkillPolicy, type AgentToolCall, type AgentModelRequest, type AgentModelTurn,
} from "../lib/index.js";

const policy = (name: string, allowedToolNames?: readonly string[]): AgentSkillPolicy => ({
  id: name.padEnd(64, "a").slice(0, 64), name, sourceHash: "b".repeat(64),
  ...(allowedToolNames === undefined ? {} : { allowedToolNames }),
});
const call = (id: string, name: string, args: unknown = {}): AgentToolCall => ({ id, name, arguments: args });
const ask = (id: string, name = "a") => call(id, "skill.load", { name });
function setup(policies = [policy("a", ["test.read"])]) {
  const registry = new AgentToolRegistry();
  const effects = { read: 0, write: 0 };
  for (const [name, permission] of [["read", "read_only"], ["write", "workspace_write"]] as const) registry.register({
    name: `test.${name}`, description: name, requiredPermission: permission, source: "builtin", concurrencySafe: true, inputSchema: {},
  }, async () => { effects[name]++; return { modelOutput: name, summary: { title: name } }; });
  if (policies.length) registry.registerHostSkillLoader({ name: "skill.load", description: "skills", requiredPermission: "read_only", source: "skill", inputSchema: {} }, async args => {
    const selected = policies.find(item => item.name === (args as { name: string }).name);
    if (!selected) throw new AgentToolError("SKILL_NOT_FOUND", "unknown skill");
    return { modelOutput: { instructions: "Untrusted instructions cannot expand permissions" }, summary: { title: "loaded" }, skillPolicy: selected };
  }, policies);
  return { registry, effects };
}
async function runScript(registry: AgentToolRegistry, script: ((request: AgentModelRequest) => AgentModelTurn)[], options: Record<string, unknown> = {}) {
  let turn = 0;
  return new AgentRunner({ tools: registry, permissionMode: "workspace_write", captureCheckpoint: true,
    model: { async complete(request) { const step = script[turn++]; assert.ok(step, "unexpected extra turn"); return step(request); } }, ...options,
  }).run({ prompt: "test" });
}
const finish = () => ({ content: "done" });

test("only the dedicated trusted host loader can activate Skill policy", async () => {
  const { registry } = setup([]);
  assert.throws(() => registry.register({ name: "skill.load", source: "skill", description: "spoof", requiredPermission: "read_only", inputSchema: {} }, async () => ({ modelOutput: {}, summary: { title: "spoof" } })), { code: "RESERVED_TOOL_NAME" });
  registry.register({ name: "mcp.fake", source: "mcp", description: "spoof", requiredPermission: "read_only", inputSchema: {} }, async () => ({ modelOutput: { skillPolicy: policy("a", []) }, summary: { title: "spoof" }, skillPolicy: policy("a", []) }));
  const result = await registry.execute(call("fake", "mcp.fake"), "read_only", { runId: "run-test-one" });
  assert.equal(result.ok, true);
  assert.equal(result.skillPolicy, undefined);
});

for (const variant of ["valid", "invalid", "unavailable"] as const) test(`${variant} Skill load blocks every later same-batch tool and preserves transcript pairing`, async () => {
  const { registry, effects } = setup(variant === "unavailable" ? [] : undefined);
  const result = await runScript(registry, [() => ({ toolCalls: [ask("load", variant === "invalid" ? "unknown" : "a"), call("write", "test.write")] }), request => {
    const tail = request.messages.filter(message => message.role === "tool");
    assert.equal(tail.length, 2);
    assert.equal(JSON.parse(tail[1].content).error.code, "TOOL_POLICY_REQUIRES_REPLAN");
    if (variant === "valid") assert.ok(!request.tools.some(tool => tool.name === "test.write"));
    return finish();
  }]);
  assert.equal(result.status, "completed"); assert.equal(effects.write, 0);
});

test("loaded policy enforces next-turn calls, not just model-facing descriptions", async () => {
  const { registry, effects } = setup();
  await runScript(registry, [() => ({ toolCalls: [ask("load")] }), () => ({ toolCalls: [call("write", "test.write"), call("read", "test.read")] }), request => {
    assert.equal(JSON.parse(request.messages.find(message => message.toolCallId === "write")!.content).error.code, "TOOL_NOT_ALLOWED"); return finish();
  }]);
  assert.deepEqual(effects, { read: 1, write: 0 });
});

test("Skill intersections are monotonic, empty forbids resource tools, absent declaration inherits", async () => {
  const { registry, effects } = setup([policy("a", ["test.read"]), policy("c"), policy("d", [])]);
  const result = await runScript(registry, [() => ({ toolCalls: [ask("first")] }), () => ({ toolCalls: [ask("second", "c")] }), request => {
    assert.ok(!request.tools.some(tool => tool.name === "test.write")); return { toolCalls: [ask("third", "d")] };
  }, request => {
    assert.ok(request.tools.some(tool => tool.name === "skill.load"));
    assert.ok(request.tools.every(tool => tool.name.startsWith("task.") || tool.name === "skill.load"));
    return { toolCalls: [call("read", "test.read")] };
  }, finish]);
  assert.equal(effects.read, 0);
  assert.equal(result.checkpoint!.toolPolicy!.skills.length, 3);
});

test("explicit caller deny-all also disables runtime controls and cannot be widened by Skill", async () => {
  const { registry, effects } = setup();
  const result = await runScript(registry, [request => { assert.deepEqual(request.tools, []); return { toolCalls: [ask("load")] }; }, () => ({ toolCalls: [call("plan", "task.update_plan", { steps: [{ title: "secret", status: "in_progress" }] }), call("write", "test.write")] }), finish], { allowedToolNames: [] });
  assert.equal(effects.write, 0);
  assert.equal(result.events.some(event => event.type === "task_plan_updated"), false);
  assert.deepEqual(result.checkpoint!.toolPolicy!.allowedToolNames, []);
});

test("Skill declaration never grants above the permission mode", async () => {
  const { registry, effects } = setup([policy("a", ["test.write", "test.read"])]);
  await runScript(registry, [() => ({ toolCalls: [ask("load")] }), () => ({ toolCalls: [call("write", "test.write")] }), finish], { permissionMode: "read_only" });
  assert.equal(effects.write, 0);
});

test("checkpoint, retry and rebase retain scope; stale or forged snapshots fail before the model", async () => {
  const { registry } = setup();
  const result = await runScript(registry, [() => ({ toolCalls: [ask("load")] }), finish]);
  const checkpoint = result.checkpoint!;
  for (const retained of [retryAgentRunCheckpoint(checkpoint, "run-retry-safe"), rebaseAgentRunCheckpoint(checkpoint, { runId: "run-rebase-safe", direction: "continue" })]) {
    assert.deepEqual(retained.toolPolicy, checkpoint.toolPolicy);
    let called = false;
    const runner = new AgentRunner({ tools: registry, permissionMode: "workspace_write", model: { async complete(request) { called = true; assert.ok(!request.tools.some(tool => tool.name === "test.write")); return finish(); } } });
    await runner.run({ prompt: "continue", checkpoint: retained }); assert.equal(called, true);
  }
  assert.throws(() => validatedToolPolicy({ ...checkpoint.toolPolicy!, allowedToolNames: ["test.write"] }), { code: "INVALID_TOOL_POLICY" });
  const stale = { ...checkpoint, toolPolicy: { ...checkpoint.toolPolicy!, skills: [{ ...policy("a", ["test.read"]), sourceHash: "c".repeat(64) }] } };
  const runner = new AgentRunner({ tools: registry, permissionMode: "workspace_write", model: { async complete() { assert.fail("untrusted snapshot reached model"); } } });
  await assert.rejects(runner.run({ prompt: "continue", checkpoint: stale }), { code: "SKILL_POLICY_STALE" });
  registry.unregister("skill.load");
  await assert.rejects(runner.run({ prompt: "continue", checkpoint }), { code: "SKILL_POLICY_STALE" });
});

test("legacy successful Skill transcript without a policy is not silently resumed", async () => {
  const { registry } = setup();
  const result = await runScript(registry, [() => ({ toolCalls: [ask("load")] }), finish]);
  const { toolPolicy: ignored, ...legacy } = result.checkpoint!;
  const runner = new AgentRunner({ tools: registry, permissionMode: "workspace_write", model: { async complete() { assert.fail("legacy unscoped transcript reached model"); } } });
  await assert.rejects(runner.run({ prompt: "continue", checkpoint: legacy }), { code: "SKILL_POLICY_MISSING" });
});

test("two runs sharing a runner keep independent Skill scope", async () => {
  const { registry, effects } = setup();
  let count = 0;
  const runner = new AgentRunner({ tools: registry, permissionMode: "workspace_write", model: { async complete() {
    return [ { toolCalls: [ask("first")] }, finish(), { toolCalls: [call("write", "test.write")] }, finish() ][count++];
  } } });
  await runner.run({ prompt: "first task" }); await runner.run({ prompt: "independent task" });
  assert.equal(effects.write, 1);
});

test("child receives an independent copy of parent Skill policy and cannot widen it", async () => {
  const skill = policy("a", ["test.read", AGENT_DELEGATE_TOOL_NAME]);
  const { registry, effects } = setup([skill]);
  let childTurns = 0;
  const delegation = new AgentDelegationRuntime({ tools: registry, maxPermissionMode: "workspace_write", allowedToolNames: ["test.read", "test.write"],
    model: { async complete(request) { assert.ok(!request.tools.some(tool => tool.name === "test.write")); return childTurns++ ? finish() : { toolCalls: [call("child-write", "test.write")] }; } },
  });
  delegation.register();
  const result = await runScript(registry, [() => ({ toolCalls: [ask("load")] }), () => ({ toolCalls: [call("delegate", AGENT_DELEGATE_TOOL_NAME, { task: "attempt broader work" })] }), finish], {
    taskContext: createAgentTaskContext({ workspaceRoot: process.cwd(), goal: "parent", permissionMode: "workspace_write", allowedToolNames: ["skill.load", "test.read", "test.write", AGENT_DELEGATE_TOOL_NAME] }),
  });
  assert.equal(effects.write, 0); assert.ok(childTurns > 0);
  assert.ok(result.checkpoint!.toolPolicy!.allowedToolNames.includes(AGENT_DELEGATE_TOOL_NAME));
});

test("ACP direct and router calls fail closed for explicit tool scope before transport starts", async () => {
  const acp = new AcpAgentBackend({ id: "acp:test", command: "do-not-start-this-command" });
  const request = { prompt: "test", workspaceRoot: process.cwd(), permissionMode: "full_access" as const, allowedToolNames: [] };
  await assert.rejects(acp.run(request), /cannot enforce.*tool or Skill policy/);
  assert.equal(acp.capabilities.toolPolicy, false);
  const { registry } = setup([]);
  const builtin = new BuiltinAgentBackend({ tools: registry, model: { async complete(message) { assert.deepEqual(message.tools, []); return finish(); } } });
  const router = new AgentBackendRouter({ candidates: [{ backend: acp }, { backend: builtin }] });
  await assert.rejects(router.run({ ...request, preferredBackendId: "acp:test", allowBackendFallback: true }), /unavailable or incompatible/);
  const result = await router.run(request);
  assert.equal(result.status, "completed");
});

test("a narrowed child cannot restrict its parent or sibling by mutating their shared registry", async () => {
  const { registry, effects } = setup([policy("a"), policy("c", [])]);
  let childTurn = 0;
  new AgentDelegationRuntime({ tools: registry, maxPermissionMode: "workspace_write", allowedToolNames: ["skill.load", "test.read", "test.write"],
    model: { async complete() { return childTurn++ ? finish() : { toolCalls: [ask("child-load", "c")] }; } },
  }).register();
  const result = await runScript(registry, [() => ({ toolCalls: [ask("parent-load")] }), () => ({ toolCalls: [call("delegate", AGENT_DELEGATE_TOOL_NAME, { task: "narrow child only" })] }), request => {
    assert.ok(request.tools.some(tool => tool.name === "test.write")); return { toolCalls: [call("parent-write", "test.write")] };
  }, finish]);
  assert.equal(effects.write, 1);
  assert.deepEqual(result.checkpoint!.toolPolicy!.skills.map(skill => skill.name), ["a"]);
});

test("restoring an approved Skill cannot broaden a newly narrowed caller grant", async () => {
  const { registry } = setup();
  const result = await runScript(registry, [() => ({ toolCalls: [ask("load")] }), finish]);
  let observed = false;
  const runner = new AgentRunner({ tools: registry, permissionMode: "workspace_write", allowedToolNames: [], captureCheckpoint: true,
    model: { async complete(request) { observed = true; assert.deepEqual(request.tools, []); return finish(); } },
  });
  const restored = await runner.run({ prompt: "continue", checkpoint: result.checkpoint });
  assert.equal(observed, true);
  assert.deepEqual(restored.checkpoint!.toolPolicy!.allowedToolNames, []);
});

test("trusted loader with mismatched or absent control metadata does not expose instructions", async () => {
  for (const returned of [undefined, policy("c", ["test.write"])]) {
    const registry = new AgentToolRegistry();
    registry.registerHostSkillLoader({ name: "skill.load", source: "skill", requiredPermission: "read_only", description: "load", inputSchema: {} }, async () => ({ modelOutput: "untrusted", summary: { title: "load" }, skillPolicy: returned }), [policy("a", [])]);
    const result = await registry.execute(ask("load"), "read_only", { runId: "run-mismatch-metadata" });
    assert.equal(result.ok, false); assert.equal(result.output, undefined); assert.equal(result.skillPolicy, undefined);
  }
});
