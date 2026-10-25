import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry, parseTextToolCalls, textToolCallHoldback, type AgentRunEvent } from "../lib/index.js";

const tools = [
  { name: "workspace.read_file", inputSchema: { type: "object", properties: { path: { type: "string" }, startLine: { type: "integer" } }, required: ["path"] } },
  { name: "process.run", inputSchema: { type: "object", properties: { command: { type: "string" }, args: { type: "array" } }, required: ["command"] } },
  { name: "tool.search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];
const read = [{ name: "workspace.read_file", arguments: { path: "README.md" } }];

test("replies seen from relays on 2026-09-30 become the calls they spell out", () => {
  const samples: Record<string, string> = {
    "grok-4.6 fenced JSON": '```json\n{"name": "workspace_read_file", "arguments": {"path": "README.md"}}\n```',
    "grok-4.6 parameters": '```json\n{"name": "nmx_5522bb5b65eb_workspace_read_file", "parameters": {"path": "README.md"}}',
    "qwen3-coder XML": "<function=workspace_read_file>\n<parameter=path>\nREADME.md\n</parameter>\n</function>",
    "qwen-vl-plus flat": '```json\n{\n  "tool": "workspace.read_file",\n  "path": "README.md"\n}\n```',
    "qwen-vl-ocr name{}": 'nmx_5522bb5b65eb_workspace_read_file{"path": "README.md"}',
    "qwen-vl-max positional": 'workspace.read_file("README.md")',
    "gpt-3.5 fenced positional": '```\nworkspace.read_file("README.md")\n```',
    "hermes": '<tool_call>\n{"name": "workspace_read_file", "arguments": {"path": "README.md"}}\n</tool_call>',
    "hermes unclosed": '<tool_call>{"name": "workspace_read_file", "arguments": "{\\"path\\": \\"README.md\\"}"}',
    "pythonic keyword": "[workspace_read_file(path='README.md')]",
    "OpenAI shape": '{"type": "function", "function": {"name": "workspace_read_file", "arguments": "{\\"path\\":\\"README.md\\"}"}}',
    "kimi": "<|tool_calls_section_begin|><|tool_call_begin|>functions.workspace_read_file:0<|tool_call_argument_begin|>{\"path\": \"README.md\"}<|tool_call_end|><|tool_calls_section_end|>",
    "deepseek": "<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>workspace_read_file\n```json\n{\"path\": \"README.md\"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>",
    "invoke": '<function_calls>\n<invoke name="workspace_read_file">\n<parameter name="path">README.md</parameter>\n</invoke>\n</function_calls>',
    "function json body": '<function=workspace_read_file>{"path": "README.md"}</function>',
    "function name attr json body": '<function name="workspace_read_file">{"path": "README.md"}</function>',
    "tool_call wrapping function": '<tool_call>\n<function=workspace_read_file>\n<parameter=path>\nREADME.md\n</parameter>\n</function>\n</tool_call>',
    "tool_call wrapping invoke": '<tool_call>\n<invoke name="workspace_read_file">\n<parameter name="path">\nREADME.md\n</parameter>\n</invoke>\n</tool_call>',
    "unescaped newline in JSON string": '<tool_call>{"name": "process_run", "arguments": {"command": "echo 1\necho 2"}}</tool_call>',
    "deepseek v3.2 DSML": '<｜DSML｜function_calls>\n<｜DSML｜invoke name="workspace_read_file">\n<｜DSML｜parameter name="path" string="true">README.md</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>',
    "deepseek ascii DSML": '<|DSML|function_calls>\n<|DSML|invoke name="workspace_read_file">\n<|DSML|parameter string="true" name="path">README.md</|DSML|parameter>\n</|DSML|invoke>\n</|DSML|function_calls>',
    "deepseek missing call_end before calls_end": '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>workspace_read_file\n{"path": "README.md"}<｜tool▁calls▁end｜>',
    "glm arg_key arg_value": '<tool_call>workspace_read_file\n<arg_key>path</arg_key>\n<arg_value>README.md</arg_value>\n</tool_call>',
  };
  for (const [label, text] of Object.entries(samples)) {
    const expected = label === "unescaped newline in JSON string"
      ? [{ name: "process.run", arguments: { command: "echo 1\necho 2" } }]
      : read;
    assert.deepEqual(parseTextToolCalls(text, tools), { preamble: "", calls: expected }, label);
  }
});

test("typed parameters, several calls and a short preamble before a tagged block", () => {
  assert.deepEqual(parseTextToolCalls("<function=workspace_read_file>\n<parameter=path>\na b.md\n</parameter>\n<parameter=startLine>\n12\n</parameter>\n</function>", tools)?.calls,
    [{ name: "workspace.read_file", arguments: { path: "a b.md", startLine: 12 } }]);
  assert.deepEqual(parseTextToolCalls('<invoke name="workspace_read_file"><parameter name="path" string="true">a b.md</parameter><parameter string="false" name="startLine">12</parameter></invoke>', tools)?.calls,
    [{ name: "workspace.read_file", arguments: { path: "a b.md", startLine: 12 } }]);
  assert.deepEqual(parseTextToolCalls("<function=process_run><parameter=command>\npwd\n</parameter></function>", tools)?.calls,
    [{ name: "process.run", arguments: { command: "pwd" } }]);
  assert.deepEqual(parseTextToolCalls(`tool.search(query='foo \\"bar\\" \\'baz\\'')`, tools)?.calls,
    [{ name: "tool.search", arguments: { query: `foo "bar" 'baz'` } }]);
  const writeTool = [{ name: "workspace.write_file", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } }];
  assert.deepEqual(
    parseTextToolCalls('<function=workspace.write_file><parameter=path>src/a.ts</parameter><parameter=content>const tag = "</parameter>";\nexport default tag;</parameter></function>', writeTool)?.calls,
    [{ name: "workspace.write_file", arguments: { path: "src/a.ts", content: 'const tag = "</parameter>";\nexport default tag;' } }],
  );
  assert.deepEqual(parseTextToolCalls('I will look first.\n<tool_call>{"name":"tool_search","arguments":{"query":"git"}}</tool_call>\n<tool_call>{"name":"process_run","arguments":{"command":"git","args":["status"]}}</tool_call>', tools),
    { preamble: "I will look first.", calls: [{ name: "tool.search", arguments: { query: "git" } }, { name: "process.run", arguments: { command: "git", args: ["status"] } }] });
  assert.deepEqual(parseTextToolCalls('process_run(command="git", args=["status", "--short"])\nworkspace_read_file(path="a.ts")', tools)?.calls,
    [{ name: "process.run", arguments: { command: "git", args: ["status", "--short"] } }, { name: "workspace.read_file", arguments: { path: "a.ts" } }]);
  assert.deepEqual(parseTextToolCalls('[{"name":"workspace_read_file","arguments":{"path":"a"}},{"name":"tool.search","arguments":{"query":"b"}}]', tools)?.calls.map(call => call.name),
    ["workspace.read_file", "tool.search"]);
});

test("prose, examples, unknown tools and mixed replies are ordinary text", () => {
  for (const text of [
    "The README is at the root. Call workspace.read_file with path README.md to see it.",
    "call nmx_5522bb5b65eb_workspace_read_file with path is README.md",
    '```json\n{"compilerOptions": {"strict": true}}\n```',
    '{"name": "delete_everything", "arguments": {}}',
    'unknown_tool(path="a")',
    '<tool_call>{"name": "workspace_read_file", "arguments": {"path": "a"}}</tool_call>\nThen I will summarize everything for you.',
    `${"Long explanation. ".repeat(40)}<tool_call>{"name":"workspace_read_file","arguments":{"path":"a"}}</tool_call>`,
    'workspace.read_file("a", "b", "c")',
    '<function=workspace_read_file><parameter=path>README.md</parameter>',
    '<invoke name="workspace_read_file"><parameter name="path">README.md</parameter>',
    '<tool_call><function=workspace_read_file><parameter=path>README.md</parameter>',
    "```bash\nnpm test\n```",
    "",
  ]) assert.equal(parseTextToolCalls(text, tools), undefined, text.slice(0, 60));
  assert.equal(parseTextToolCalls('{"name": "workspace_read_file", "arguments": {"path": "README.md"}}', []), undefined, "no tools offered, nothing to call");
});

test("streaming holds back only what may still become a call", () => {
  const hold = (text: string): string => text.slice(0, textToolCallHoldback(text, tools));
  assert.equal(hold("The file"), "The file");
  assert.equal(hold("work"), "", "may be the start of workspace_read_file(");
  assert.equal(hold("workspace is clean"), "workspace is clean");
  assert.equal(hold('{"name": "workspace'), "");
  assert.equal(hold("```json\n{"), "");
  assert.equal(hold("```bash\nnpm test"), "```bash\nnpm test");
  assert.equal(hold("I will read it.\n<tool_"), "I will read it.\n");
  assert.equal(hold("I will read it.\n<tool_call>{\"name\""), "I will read it.\n");
  assert.equal(hold("I will read it.\n<function name"), "I will read it.\n");
  assert.equal(hold("I will read it.\n<function name="), "I will read it.\n");
  assert.equal(hold("I will read it.\n<invoke name="), "I will read it.\n");
  assert.equal(hold("I will read it.\n<｜DSML｜"), "I will read it.\n");
  assert.equal(hold("I will read it.\n<|DSML|invoke "), "I will read it.\n");
  // A tag still arriving at the end of a chunk, namespace included or not, never reaches the visible stream.
  for (const tail of ["<", "<inv", "<invoke", "<antml", "<function", "<invoke name=", "<｜DS", "<|DSML|tool_c", "<|tool_c"]) {
    assert.equal(hold(`I will read it.\n${tail}`), "I will read it.\n", tail);
  }
  assert.equal(hold("Use a <b> tag here"), "Use a <b> tag here");
  assert.equal(hold("anything"), "anything");
  assert.equal(textToolCallHoldback("{".padEnd(40_000, " "), tools), 40_000, "a very long held reply is shown after all");
  assert.equal(textToolCallHoldback("work", []), 4);
});

test("the runner runs a call a model wrote as text, and the user never sees the raw call", async () => {
  const registry = new AgentToolRegistry();
  const reads: unknown[] = [];
  registry.register({ name: "workspace.read_file", description: "Read a file", inputSchema: tools[0].inputSchema,
    requiredPermission: "read_only", source: "builtin" }, async input => {
    reads.push(input);
    return { modelOutput: { text: "# Fixture" }, summary: { title: "Read README.md" } };
  });
  let turns = 0;
  const seen: AgentRunEvent[] = [];
  const result = await new AgentRunner({ tools: registry, permissionMode: "read_only", model: {
    async complete(request) {
      turns += 1;
      if (turns === 1) {
        for (const delta of ["I'll read it.\n", "<tool_", "call>{\"name\": \"workspace_read_file\", ", "\"arguments\": {\"path\": \"README.md\"}}</tool_call>"]) {
          await request.onTextDelta?.(delta);
        }
        return { content: "I'll read it.\n<tool_call>{\"name\": \"workspace_read_file\", \"arguments\": {\"path\": \"README.md\"}}</tool_call>" };
      }
      const toolMessage = request.messages.find(message => message.role === "tool");
      assert.ok(toolMessage, "the result went back to the model as a tool result");
      for (const delta of ["The README ", "starts with a heading."]) await request.onTextDelta?.(delta);
      return {};
    },
  } }).run({ prompt: "What is in README.md?", runId: "run-text-tool-call-001"});
  seen.push(...result.events);
  assert.equal(result.status, "completed");
  assert.deepEqual(reads, [{ path: "README.md" }]);
  const shown = seen.filter((event): event is Extract<AgentRunEvent, { type: "assistant_delta" }> => event.type === "assistant_delta").map(event => event.delta).join("");
  assert.equal(shown, "I'll read it.\nThe README starts with a heading.");
  assert.equal(result.finalText, "The README starts with a heading.");
});

test("a held reply that is not a call is shown in full", async () => {
  const registry = new AgentToolRegistry();
  registry.register({ name: "workspace.read_file", description: "Read a file", inputSchema: tools[0].inputSchema,
    requiredPermission: "read_only", source: "builtin" }, async () => ({ modelOutput: {}, summary: { title: "Read" } }));
  const seen: AgentRunEvent[] = [];
  const text = '```json\n{"compilerOptions": {"strict": true}}\n```';
  const result = await new AgentRunner({ tools: registry, permissionMode: "read_only", model: {
    async complete(request) {
      for (const delta of [text.slice(0, 9), text.slice(9, 20), text.slice(20)]) await request.onTextDelta?.(delta);
      return {};
    },
  } }).run({ prompt: "Show a tsconfig", runId: "run-text-tool-call-002" });
  seen.push(...result.events);
  assert.equal(result.finalText, text);
  assert.equal(seen.filter((event): event is Extract<AgentRunEvent, { type: "assistant_delta" }> => event.type === "assistant_delta").map(event => event.delta).join(""), text);
});
