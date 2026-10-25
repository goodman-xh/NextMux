import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_TOOL_ARGUMENTS, invalidToolArguments, repairToolArguments, toolArgumentsLookTruncated, toolCallArguments } from "../lib/tool-arguments.js";

test("tool arguments are repaired when a model wraps, double-encodes or trails a comma", () => {
  assert.deepEqual(repairToolArguments('```json\n{"mode":"replace"}\n```'), { mode: "replace" });
  assert.deepEqual(repairToolArguments(JSON.stringify(JSON.stringify({ a: 1 }))), { a: 1 });
  assert.deepEqual(repairToolArguments('{"scenes":[{"title":"故乡"},],}'), { scenes: [{ title: "故乡" }] });
  assert.deepEqual(repairToolArguments('Here you go: {"a":1} done'), { a: 1 });
  assert.deepEqual(repairToolArguments(""), {});
  assert.equal(repairToolArguments("[1,2]"), undefined, "an array is not an arguments object");
});

test("cut-off arguments are never executed: the model is asked to call again", () => {
  const cut = '{"mode":"replace","scenes":[{"title":"回到故乡","shots":[{"description":"船舱里';
  assert.equal(toolArgumentsLookTruncated(cut), true);
  const marked = toolCallArguments(cut);
  assert.ok(INVALID_TOOL_ARGUMENTS in marked);
  assert.deepEqual(invalidToolArguments(marked), { truncated: true });
  assert.deepEqual(invalidToolArguments(toolCallArguments("not json at all")), { truncated: false });
  assert.equal(invalidToolArguments({ mode: "replace" }), undefined);
});

test("trailing-comma repair leaves commas inside string values alone (B01-03)", () => {
  const raw = '{"path":"a.txt","content":"keep ,} and ,] here","list":[1,2,],}';
  assert.deepEqual(repairToolArguments(raw), { path: "a.txt", content: "keep ,} and ,] here", list: [1, 2] });
  assert.deepEqual(repairToolArguments('{"quote":"say \\",}\\" ok",}'), { quote: 'say ",}" ok' });
});

test("unescaped literal newlines, carriage returns and tabs inside JSON string literals are repaired", () => {
  const raw = '{"path":"src/a.ts","content":"line 1\nline 2\r\n\tindented",}';
  assert.deepEqual(repairToolArguments(raw), { path: "src/a.ts", content: "line 1\nline 2\r\n\tindented" });
  assert.deepEqual(repairToolArguments("```json5\n{\"command\":\"echo 1\necho 2\"}\n```"), { command: "echo 1\necho 2" });
  assert.deepEqual(repairToolArguments(JSON.stringify('```json\n{"path":"src/b.ts",}\n```')), { path: "src/b.ts" });
  assert.equal(repairToolArguments("closing brace only } trailing"), undefined);
});
