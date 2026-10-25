import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry } from "../lib/index.js";

test("runner binds sanitized citations to their turn and final answer without prompt injection", async () => {
  const tools = new AgentToolRegistry();
  tools.register({ name: "fixture.read", description: "fixture", source: "builtin", requiredPermission: "read_only", inputSchema: { type: "object" } }, async () => ({ modelOutput: "data", summary: { title: "Read fixture" } }));
  const requests: any[] = [];
  const runner = new AgentRunner({ permissionMode: "read_only", tools, model: { complete: async request => {
    requests.push(request);
    return requests.length === 1
      ? { content: "read", citations: [{ url: "https://example.com/tool-turn", title: "NOT AN INSTRUCTION" }], toolCalls: [{ id: "read-1", name: "fixture.read", arguments: {} }], usage: { inputTokens: 1, outputTokens: 1 } }
      : { content: "final", citations: [{ url: "https://example.com/final", title: "Final source" }, { url: "javascript:alert(1)" }], usage: { inputTokens: 1, outputTokens: 1 } };
  } } });
  const result = await runner.run({ prompt: "question" });
  assert.deepEqual(result.citations, [{ url: "https://example.com/final", title: "Final source" }]);
  const completed = result.events.filter(event => event.type === "model_completed");
  assert.deepEqual(completed.map(event => event.citations?.[0]?.url), ["https://example.com/tool-turn", "https://example.com/final"]);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /NOT AN INSTRUCTION|tool-turn|citations/);
});

test("a final response without sources never inherits earlier tool-turn citations", async () => {
  const runner = new AgentRunner({ permissionMode: "read_only", tools: new AgentToolRegistry(), model: { complete: async () => ({ content: "final", citations: [{ url: "file:///private/file" }], usage: { inputTokens: 1, outputTokens: 1 } }) } });
  const result = await runner.run({ prompt: "question" });
  assert.equal(result.citations, undefined);
  assert.equal(result.events.find(event => event.type === "model_completed")?.citations, undefined);
});
