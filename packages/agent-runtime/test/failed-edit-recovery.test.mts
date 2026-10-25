import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { AgentRunner, AgentToolRegistry, WorkspaceToolRuntime } from "../lib/index.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const calc = "function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n";

async function workspace(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-failed-edit-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  await writeFile(join(dir, "calc.js"), calc);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "full_access" });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { dir, registry, runtime };
}

// A small model (Voxtral Small 24B, 2026-09-30) wrote its first patch without an "@@" hunk. That parse error wrote
// nothing, yet the ledger recorded the scope as "unknown" and blocked every later edit of calc.js as a replay.
test("a corrected patch after a rejected one applies; the rejection explains the format", async t => {
  const { dir, registry } = await workspace(t);
  const context = { runId: "run-failed-edit", executionScopeId: "scope-failed-edit" };
  const bad = "*** Begin Patch\n*** Update File: calc.js\nfunction multiply(a, b) {\n  return a * b;\n}\n*** End Patch";
  const rejected = await registry.execute({ id: "bad", name: "workspace.apply_patch", arguments: { path: "calc.js", patch: bad, expectedSha256: sha(calc) } }, "full_access", context);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.code, "PATCH_INVALID");
  assert.match(rejected.error?.message ?? "", /"@@"[\s\S]*workspace\.write_file/);
  const again = await registry.execute({ id: "same-bad", name: "workspace.apply_patch", arguments: { path: "calc.js", patch: bad, expectedSha256: sha(calc) } }, "full_access", context);
  assert.equal(again.error?.code, "PATCH_INVALID", "an identical bad patch fails the same way, it is not blocked as an unknown side effect");
  const good = "@@ -3,2 +3,6 @@\n }\n-module.exports = { add };\n+function multiply(a, b) {\n+  return a * b;\n+}\n+module.exports = { add, multiply };\n";
  const applied = await registry.execute({ id: "good", name: "workspace.apply_patch", arguments: { path: "calc.js", patch: good, expectedSha256: sha(calc) } }, "full_access", context);
  assert.equal(applied.ok, true, applied.error?.message);
  assert.match(await readFile(join(dir, "calc.js"), "utf8"), /multiply/);
});

test("a run whose edits never applied reports the failed facts without another model/tool turn", async t => {
  const { dir, registry } = await workspace(t);
  await writeFile(join(dir, "calc.test.cjs"), "require('node:test')('add',()=>require('node:assert').equal(require('./calc.js').add(1,2),3));");
  const bad = "function multiply(a, b) {\n  return a * b;\n}";
  let turn = 0, reminded = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "full_access", model: { async complete(request) {
    reminded = request.messages.filter(message => message.role === "user" && /NOT applied[\s\S]*calc\.js/.test(message.content)).length;
    turn += 1;
    if (turn === 1) return { toolCalls: [{ id: "edit", name: "workspace.apply_patch", arguments: { path: "calc.js", patch: bad, expectedSha256: sha(calc) } }] };
    if (turn === 2) return { toolCalls: [{ id: "test", name: "process.run", arguments: { command: process.execPath, args: ["--test", "calc.test.cjs"] } }] };
    return { content: "Done. All tests pass." };
  } } }).run({ prompt: "Add multiply to calc.js", runId: "run-unapplied-edit" });
  assert.equal(reminded, 0, "no new model request is created to correct the report");
  assert.equal(turn, 3, "the volunteered old-file check is retained, with no automatic repair turn");
  const failed = result.events.filter(event => event.type === "tool_completed").filter(event => !event.ok);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].failure?.code, "PATCH_INVALID");
  assert.equal(result.status, "completed");
  assert.equal(result.verification?.status, "failed");
  assert.deepEqual(result.verification?.failedEdits, ["calc.js"]);
  assert.equal(await readFile(join(dir, "calc.js"), "utf8"), calc);
});

test("a failed edit that the model then fixes (absolute path first, relative later) leaves no unapplied edit", async t => {
  const { dir, registry } = await workspace(t);
  const good = "@@ -3,2 +3,3 @@\n }\n-module.exports = { add };\n+function multiply(a, b) { return a * b; }\n+module.exports = { add, multiply };\n";
  let turn = 0, reminded = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "full_access", model: { async complete(request) {
    reminded += request.messages.filter(message => message.role === "user" && /NOT applied/.test(message.content)).length;
    turn += 1;
    if (turn === 1) return { toolCalls: [{ id: "bad", name: "workspace.apply_patch", arguments: { path: join(dir, "calc.js"), patch: "function multiply(a, b) {}", expectedSha256: sha(calc) } }] };
    if (turn === 2) return { toolCalls: [{ id: "good", name: "workspace.apply_patch", arguments: { path: "calc.js", patch: good, expectedSha256: sha(calc) } }] };
    return { content: "Added multiply." };
  } } }).run({ prompt: "Add multiply", runId: "run-fixed-edit" });
  assert.equal(reminded, 0);
  assert.equal(result.verification?.failedEdits, undefined);
  assert.notEqual(result.verification?.status, "failed");
  assert.match(await readFile(join(dir, "calc.js"), "utf8"), /multiply/);
});

// Voxtral Small 24B (2026-09-30) answered "我将按照以下步骤…让我们开始吧。" to every message and never called a tool.
test("a reply that only announces the work gets one nudge to start; answers and questions do not", async t => {
  const { dir, registry } = await workspace(t);
  const announce = "好的，我将按照以下步骤完成任务：\n\n1. 给 calc.js 加一个 multiply 函数。\n2. 运行测试。\n\n让我们开始吧。";
  let turn = 0, nudges = 0;
  const result = await new AgentRunner({ tools: registry, permissionMode: "full_access", model: { async complete(request) {
    nudges = request.messages.filter(message => message.role === "user" && /did not call any tool/.test(message.content)).length;
    turn += 1;
    if (turn === 1) return { content: announce };
    if (turn === 2) return { toolCalls: [{ id: "read", name: "workspace.read_file", arguments: { path: "calc.js" } }] };
    return { content: "calc.js 只有 add，下一步需要你确认是否继续。" };
  } } }).run({ prompt: "给 calc.js 加一个 multiply", runId: "run-announce" });
  assert.equal(nudges, 1);
  assert.equal(result.status, "completed");
  assert.equal(turn, 3);
  for (const content of ["2 + 2 = 4。", "I will now explain: the function adds two numbers?", "要我现在开始修改吗？"]) {
    let calls = 0;
    await new AgentRunner({ tools: registry, permissionMode: "full_access", model: { async complete() { calls += 1; return { content }; } } })
      .run({ prompt: "question", runId: `run-plain-${calls}-${content.length}` });
    assert.equal(calls, 1, `no nudge for: ${content}`);
  }
  let repeats = 0;
  await new AgentRunner({ tools: registry, permissionMode: "full_access", model: { async complete() { repeats += 1; return { content: announce }; } } })
    .run({ prompt: "开始", runId: "run-announce-twice" });
  assert.equal(repeats, 2, "one nudge per run, never a loop");
  assert.ok(dir);
});

test("apply_patch handles blank context lines, indentation shifts, session-cached sha256, and *** Add File creation", async t => {
  const { dir, registry } = await workspace(t);
  const context = { runId: "run-patch-stages", executionScopeId: "scope-patch-stages" };
  const multiParagraph = "function alpha() {\n    const a = 1;\n\n    const b = 2;\n    return a + b;\n}\n";
  await writeFile(join(dir, "multi.js"), multiParagraph, "utf8");

  // 1. Read file once to populate session-cached lastObservedSha256.
  const readRes = await registry.execute({ id: "read-multi", name: "workspace.read_file", arguments: { path: "multi.js" } }, "full_access", context);
  assert.equal(readRes.ok, true);

  // 2. Patch with unprefixed blank context line ("") AND shifted indentation (2 spaces instead of 4) AND omitted expectedSha256.
  const patch = [
    "*** Begin Patch",
    "*** Update File: multi.js",
    "@@",
    "  const a = 1;",
    "",
    "-  const b = 2;",
    "+  const b = 20;",
    "  return a + b;",
    "*** End Patch",
    "",
  ].join("\n");
  const patched = await registry.execute({ id: "patch-multi", name: "workspace.apply_patch", arguments: { path: "multi.js", patch } }, "full_access", context);
  assert.equal(patched.ok, true, patched.error?.message);
  assert.equal(await readFile(join(dir, "multi.js"), "utf8"), "function alpha() {\n    const a = 1;\n\n    const b = 20;\n    return a + b;\n}\n");

  // 3. Create a new file via *** Add File in apply_patch.
  const addPatch = [
    "*** Begin Patch",
    "*** Add File: created.js",
    "+export const created = 42;",
    "*** End Patch",
  ].join("\n");
  const createdRes = await registry.execute({ id: "patch-add", name: "workspace.apply_patch", arguments: { path: "created.js", patch: addPatch } }, "full_access", context);
  assert.equal(createdRes.ok, true, createdRes.error?.message);
  assert.equal(await readFile(join(dir, "created.js"), "utf8"), "export const created = 42;\n");

  // 4. Regex search_text with include filter & list_files with pattern filter.
  const listRes = await registry.execute({ id: "list-glob", name: "workspace.list_files", arguments: { pattern: "*.js" } }, "full_access", context);
  assert.equal(listRes.ok, true);
  assert.equal((listRes.output as { entries: Array<{ path: string }> }).entries.some(e => e.path === "created.js"), true);

  const searchRes = await registry.execute({
    id: "search-regex",
    name: "workspace.search_text",
    arguments: { query: "const\\s+b\\s*=\\s*\\d+", regex: true, include: "*.js" },
  }, "full_access", context);
  assert.equal(searchRes.ok, true);
  assert.equal((searchRes.output as { matches: Array<{ path: string }> }).matches.some(m => m.path === "multi.js"), true);

  // 5. Binary PDF read_file extracts Markdown instead of throwing BINARY_FILE.
  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj << /Length 44 >> stream\nBT /F1 12 Tf 72 712 Td (Quarterly PDF Text) Tj ET\nendstream endobj\n%%EOF\n", "latin1");
  await writeFile(join(dir, "doc.pdf"), pdfBytes);
  const pdfRead = await registry.execute({ id: "read-pdf", name: "workspace.read_file", arguments: { path: "doc.pdf" } }, "full_access", context);
  assert.equal(pdfRead.ok, true, pdfRead.error?.message);
  assert.match((pdfRead.output as { content: string }).content, /Quarterly PDF Text/);
  assert.equal((pdfRead.output as { extractedMarkdown?: boolean }).extractedMarkdown, true);
});

test("apply_patch preserves BOM/CRLF, handles --- a/newfile creation, disambiguates duplicate blocks by hunk line hint, normalizes Unicode quotes, and applies out-of-order hunks (D1-26, D6-01, D6-09, D9-07)", async t => {
  const { dir, registry } = await workspace(t);
  const context = { runId: "run-patch-edge", executionScopeId: "scope-patch-edge" };

  // 1. Preserve UTF-8 BOM + CRLF when patching an existing file even with a CRLF patch payload.
  const crlfBomOriginal = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("const first = 1;\r\nconst second = 2;\r\n", "utf8"),
  ]);
  await writeFile(join(dir, "crlf-bom.ts"), crlfBomOriginal);
  const crlfPatch = "@@ -1,2 +1,2 @@\r\n const first = 1;\r\n-const second = 2;\r\n+const second = 22;\r\n";
  const crlfRes = await registry.execute(
    { id: "patch-crlf", name: "workspace.apply_patch", arguments: { path: "crlf-bom.ts", patch: crlfPatch } },
    "full_access",
    context,
  );
  assert.equal(crlfRes.ok, true, crlfRes.error?.message);
  const crlfUpdatedBytes = await readFile(join(dir, "crlf-bom.ts"));
  assert.deepEqual([...crlfUpdatedBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM preserved");
  assert.equal(crlfUpdatedBytes.subarray(3).toString("utf8"), "const first = 1;\r\nconst second = 22;\r\n");

  // 2. Unified diff creation with --- a/newfile.ts (not /dev/null).
  const unifiedNewPatch = "--- a/brand-new.ts\n+++ b/brand-new.ts\n@@ -0,0 +1,2 @@\n+export const hello = 'world';\n+export const count = 2;\n";
  const newFileRes = await registry.execute(
    { id: "patch-new-a", name: "workspace.apply_patch", arguments: { path: "brand-new.ts", patch: unifiedNewPatch } },
    "full_access",
    context,
  );
  assert.equal(newFileRes.ok, true, newFileRes.error?.message);
  assert.equal(await readFile(join(dir, "brand-new.ts"), "utf8"), "export const hello = 'world';\nexport const count = 2;\n");

  // 3. Disambiguate duplicate blocks using @@ -startLine hint, normalize curly quotes, and apply out-of-order hunks.
  const duplicateAndUnicode = [
    "function blockOne() {",
    "  const label = \u201Chello\u2014world\u201D;",
    "  return 1;",
    "}",
    "",
    "function middle() {",
    "  return 0;",
    "}",
    "",
    "function blockTwo() {",
    "  const label = 'second';",
    "  return 1;",
    "}",
    "",
  ].join("\n");
  await writeFile(join(dir, "dup.ts"), duplicateAndUnicode, "utf8");
  await registry.execute({ id: "read-dup", name: "workspace.read_file", arguments: { path: "dup.ts" } }, "full_access", context);

  // Out-of-order hunks: Hunk 1 targets line 11 (blockTwo's `return 1;`) with shifted indentation so unified diff falls back to applyExactPatchFallback;
  // Hunk 2 targets line 2 (blockOne's curly-quoted line using ASCII quotes).
  const outOfOrderPatch = [
    "@@ -11,3 +11,3 @@",
    "    const label = 'second';",
    "-   return 1;",
    "+   return 2;",
    "  }",
    "@@ -1,4 +1,4 @@",
    "  function blockOne() {",
    '-   const label = "hello-world";',
    '+   const label = "updated-world";',
    "    return 1;",
    "  }",
  ].join("\n");
  const dupRes = await registry.execute(
    { id: "patch-dup", name: "workspace.apply_patch", arguments: { path: "dup.ts", patch: outOfOrderPatch } },
    "full_access",
    context,
  );
  assert.equal(dupRes.ok, true, dupRes.error?.message);
  const dupContent = await readFile(join(dir, "dup.ts"), "utf8");
  assert.match(dupContent, /function blockOne\(\) \{\n  const label = "updated-world";\n  return 1;\n\}/);
  assert.match(dupContent, /function blockTwo\(\) \{\n  const label = 'second';\n  return 2;\n\}/);
});

test("glob brace+comma expansion, ancestor .gitignore in subpaths, CRLF regex search, and non-TTY process output head+tail & ANSI stripping (D1-01, D1-25, D1-27, D6-02, D6-03, D6-04)", async t => {
  const { dir, registry } = await workspace(t);
  const context = { runId: "run-search-proc", executionScopeId: "scope-search-proc" };

  await writeFile(join(dir, ".gitignore"), "ignored-dir/\n", "utf8");
  await mkdir(join(dir, "packages", "sub", "ignored-dir"), { recursive: true });
  await mkdir(join(dir, "packages", "sub", "src"), { recursive: true });
  await writeFile(join(dir, "packages", "sub", "ignored-dir", "secret.ts"), "export const token = 'MATCH_TARGET';\r\n", "utf8");
  await writeFile(join(dir, "packages", "sub", "src", "comp.tsx"), "export const view = 'MATCH_TARGET';\r\n", "utf8");
  await writeFile(join(dir, "packages", "sub", "src", "util.ts"), "export const helper = 'MATCH_FINAL';", "utf8");

  // Subdirectory search respects root .gitignore, matches $-anchored regex on CRLF, and matches final line without trailing newline.
  const searchSub = await registry.execute(
    {
      id: "search-sub",
      name: "workspace.search_text",
      arguments: {
        path: "packages/sub",
        query: "MATCH_(?:TARGET|FINAL)';$",
        regex: true,
        include: "src/*.{ts,tsx},*.js",
      },
    },
    "full_access",
    context,
  );
  assert.equal(searchSub.ok, true, searchSub.error?.message);
  const matchedPaths = (searchSub.output as { matches: Array<{ path: string }> }).matches.map(m => m.path).sort();
  assert.deepEqual(matchedPaths, ["packages/sub/src/comp.tsx", "packages/sub/src/util.ts"]);

  // process.run strips ANSI/CR overwrites, sets GIT_PAGER=cat, and preserves head + tail when truncated.
  const procRes = await registry.execute(
    {
      id: "proc-head-tail",
      name: "process.run",
      arguments: {
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write('10%\\r99%\\r' + '\\x1b[32mHEAD_MARKER_' + (process.env.GIT_PAGER || '') + '\\x1b[0m\\n' + 'M'.repeat(90000) + '\\nTAIL_MARKER_END\\n');",
        ],
      },
    },
    "full_access",
    context,
  );
  assert.equal(procRes.ok, true, procRes.error?.message);
  const out = procRes.output as { stdout: string; truncated: boolean };
  assert.equal(out.truncated, true);
  assert.doesNotMatch(out.stdout, /10%|99%|\x1b\[/);
  assert.match(out.stdout, /^HEAD_MARKER_cat/);
  assert.match(out.stdout, /\.\.\.\[truncated\]\.\.\./);
  // Clipped output (ring-evicted middle and capped lines) also spills the
  // unclipped text and ends with the inspection notice (audit Cline #3).
  assert.match(out.stdout, /TAIL_MARKER_END\n+\[Full unclipped output saved to \S+\.log\. Use workspace\.read_file/);
  const spillPath = /saved to (\S+)\. Use/.exec(out.stdout)![1]!;
  const spilled = await readFile(spillPath, "utf8");
  assert.ok(spilled.includes("M".repeat(90_000)), "the spill file holds the unclipped output");
  assert.match(spilled, /TAIL_MARKER_END\n$/, "the spill file ends with the real tail");
});
