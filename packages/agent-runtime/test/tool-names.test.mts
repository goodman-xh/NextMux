import assert from "node:assert/strict";
import test from "node:test";
import { createToolNameCodec, providerToolAlias, rewriteToolReferences } from "../lib/index.js";

test("tool names on the wire are readable and the prompt names them the same way", () => {
  const tools = [{ name: "tabs.open_app" }, { name: "tabs.list" }, { name: "workspace.apply_patch" }, { name: "process.run" }, { name: "search" }];
  const codec = createToolNameCodec(tools);
  assert.equal(codec.encode("tabs.open_app"), "tabs_open_app");
  assert.equal(codec.encode("search"), "search");
  assert.equal(codec.decode("tabs_open_app"), "tabs.open_app");
  assert.equal(codec.decode("tabs.open_app"), "tabs.open_app", "a model copying the dotted name still reaches the tool");
  const prompt = "Call tabs.list first, then tabs.open_app. Use workspace.apply_patch, never process.run for patches. Not tabs.listing or my.tabs.list.";
  assert.equal(rewriteToolReferences(prompt, tools, codec),
    "Call tabs_list first, then tabs_open_app. Use workspace_apply_patch, never process_run for patches. Not tabs.listing or my.tabs.list.");
});

test("collisions and invalid names still get unique provider-safe aliases", () => {
  const tools = [{ name: "a.b" }, { name: "a_b" }, { name: "网页.打开" }];
  const codec = createToolNameCodec(tools);
  const aliases = tools.map(tool => codec.encode(tool.name));
  assert.equal(new Set(aliases).size, 3);
  for (const alias of aliases) assert.match(alias, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(codec.encode("a_b"), "a_b", "a tool already named a_b keeps its name");
  assert.match(providerToolAlias("x".repeat(70) + ".y"), /^nmx_[0-9a-f]{12}_/);
  for (const tool of tools) assert.equal(codec.decode(codec.encode(tool.name)), tool.name);
});
