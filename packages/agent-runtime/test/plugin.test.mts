import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentPluginHost,
  AgentRunner,
  AgentToolError,
  AgentToolRegistry,
  type AgentPlugin,
  type ToolExecutionContext,
} from "../lib/index.js";

const context: ToolExecutionContext = { runId: "plugin-test-run", permissionMode: "read_only" };

function readPlugin(id = "nextmux.test-plugin"): AgentPlugin {
  return {
    manifest: { id, version: "1.0.0", scopes: ["global"], toolSource: "builtin" },
    setup(plugin) {
      plugin.registerTool({
        name: "plugin.test_read",
        description: "test plugin tool",
        inputSchema: { type: "object" },
        requiredPermission: "read_only",
        source: "builtin",
        executionKind: "read",
      }, async () => ({ modelOutput: { ok: true }, summary: { title: "plugin read" } }));
      plugin.registerHook("before_model_request", () => { /* lifecycle smoke test */ });
    },
  };
}

test("plugin host installs scoped tools and removes them on uninstall", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  await host.install(readPlugin());
  assert.equal(host.has("nextmux.test-plugin"), true);
  assert.deepEqual(host.toolNames("nextmux.test-plugin"), ["plugin.test_read"]);
  assert.equal(registry.descriptor("plugin.test_read")?.pluginId, "nextmux.test-plugin");
  const result = await registry.execute({ id: "plugin-call", name: "plugin.test_read", arguments: {} }, "read_only", context);
  assert.equal(result.ok, true);
  let disposed = false;
  await host.uninstall("nextmux.test-plugin");
  assert.equal(host.has("nextmux.test-plugin"), false);
  assert.equal(registry.descriptor("plugin.test_read"), undefined);
  assert.equal(disposed, false);
});

test("workspace-scoped plugin refuses execution outside its workspace", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  await host.install({ ...readPlugin("nextmux.workspace-plugin"), manifest: { ...readPlugin("nextmux.workspace-plugin").manifest, scopes: ["workspace"] } }, { kind: "workspace", workspaceRoot: "/workspace/a" });
  const denied = await registry.execute({ id: "scope-denied", name: "plugin.test_read", arguments: {} }, "read_only", {
    ...context, workspaceRoot: "/workspace/b",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "PLUGIN_SCOPE_MISMATCH");
  const allowed = await registry.execute({ id: "scope-allowed", name: "plugin.test_read", arguments: {} }, "read_only", {
    ...context, workspaceRoot: "/workspace/a",
  });
  assert.equal(allowed.ok, true);
});

test("plugin scope and source declarations are enforced", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  await assert.rejects(
    host.install({
      manifest: { id: "nextmux.task-only", version: "1.0.0", scopes: ["task"] },
      setup() { /* no-op */ },
    }, { kind: "global" }),
    (error: unknown) => error instanceof AgentToolError && error.code === "PLUGIN_SCOPE_NOT_ALLOWED",
  );
  await assert.rejects(
    host.install({
      manifest: { id: "nextmux.source-mismatch", version: "1.0.0", toolSource: "mcp" },
      setup(plugin) {
        plugin.registerTool({
          name: "plugin.bad_source",
          description: "bad source",
          inputSchema: { type: "object" },
          requiredPermission: "read_only",
          source: "builtin",
        }, async () => ({ modelOutput: null, summary: { title: "never" } }));
      },
    }),
    (error: unknown) => error instanceof AgentToolError && error.code === "PLUGIN_TOOL_SOURCE_MISMATCH",
  );
  assert.equal(registry.descriptor("plugin.bad_source"), undefined);
});

test("failed setup rolls back tools and hooks", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  await assert.rejects(
    host.install({
      manifest: { id: "nextmux.setup-fails", version: "1.0.0", toolSource: "builtin" },
      setup(plugin) {
        plugin.registerTool({
          name: "plugin.partial",
          description: "partial",
          inputSchema: { type: "object" },
          requiredPermission: "read_only",
          source: "builtin",
        }, async () => ({ modelOutput: null, summary: { title: "partial" } }));
        throw new Error("setup failed");
      },
    }),
    /setup failed/,
  );
  assert.equal(registry.descriptor("plugin.partial"), undefined);
  assert.equal(host.has("nextmux.setup-fails"), false);
});

test("hooks run in registration order and dispose removes them", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  const seen: string[] = [];
  await host.install({
    manifest: { id: "nextmux.hooks", version: "1.0.0" },
    setup(plugin) {
      plugin.registerHook("after_model_response", () => { seen.push("first"); });
      plugin.registerHook("after_model_response", async () => { seen.push("second"); });
    },
    dispose() { seen.push("dispose"); },
  });
  await host.emit("after_model_response", { ok: true });
  assert.deepEqual(seen, ["first", "second"]);
  await host.uninstall("nextmux.hooks");
  assert.deepEqual(seen, ["first", "second", "dispose"]);
  await host.emit("after_model_response", {});
  assert.deepEqual(seen, ["first", "second", "dispose"]);
});

test("scoped hooks only run for the matching workspace execution", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  let calls = 0;
  await host.install({
    manifest: { id: "nextmux.scoped-hooks", version: "1.0.0", scopes: ["workspace"] },
    setup(plugin) { plugin.registerHook("before_model_request", () => { calls += 1; }); },
  }, { kind: "workspace", workspaceRoot: "/workspace/one" });
  await host.emit("before_model_request", {});
  assert.equal(calls, 0);
  await host.emit("before_model_request", {}, { runId: "run-1", workspaceRoot: "/workspace/two" });
  assert.equal(calls, 0);
  await host.emit("before_model_request", {}, { runId: "run-2", workspaceRoot: "/workspace/one" });
  assert.equal(calls, 1);
});

test("runner emits plugin lifecycle hooks around a real model/tool turn", async () => {
  const registry = new AgentToolRegistry();
  const host = new AgentPluginHost({ registry });
  const seen: string[] = [];
  await host.install({
    manifest: { id: "nextmux.runner-hooks", version: "1.0.0", scopes: ["global"], toolSource: "builtin" },
    setup(plugin) {
      plugin.registerTool({
        name: "plugin.runner_tool",
        description: "runner hook fixture",
        inputSchema: { type: "object" },
        requiredPermission: "read_only",
        source: "builtin",
      }, async () => ({ modelOutput: { ok: true }, summary: { title: "fixture complete" } }));
      plugin.registerHook("before_model_request", payload => { seen.push(`before-model:${(payload as { turn: number }).turn}`); });
      plugin.registerHook("after_model_response", payload => { seen.push(`after-model:${(payload as { turn: number }).turn}`); });
      plugin.registerHook("before_tool_execute", payload => { seen.push(`before-tool:${(payload as { toolName: string }).toolName}`); });
      plugin.registerHook("after_tool_execute", payload => { seen.push(`after-tool:${(payload as { toolName: string }).toolName}`); });
    },
  });
  let calls = 0;
  const result = await new AgentRunner({
    model: {
      async complete() {
        calls += 1;
        return calls === 1
          ? { content: "", toolCalls: [{ id: "plugin-tool-call", name: "plugin.runner_tool", arguments: {} }], usage: { inputTokens: 1, outputTokens: 1 } }
          : { content: "done", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    tools: registry,
    pluginHost: host,
    permissionMode: "read_only",
    maxTurns: 2,
    maxTotalTurns: 3,
  }).run({ prompt: "run the fixture", runId: "run-plugin-hooks" });
  assert.equal(result.status, "completed");
  assert.deepEqual(seen, [
    "before-model:1",
    "after-model:1",
    "before-tool:plugin.runner_tool",
    "after-tool:plugin.runner_tool",
    "before-model:2",
    "after-model:2",
  ]);
});
