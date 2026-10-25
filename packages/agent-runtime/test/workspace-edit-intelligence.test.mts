import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import test, { type TestContext } from "node:test";

import { AgentToolRegistry, WorkspaceToolRuntime, type ToolExecutionContext } from "../lib/index.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const calc = "function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n";

interface Workspace {
  readonly dir: string;
  readonly registry: AgentToolRegistry;
  readonly formatted: string[];
}

async function workspace(t: TestContext, options: { readonly formatFile?: (filePath: string) => Promise<void> } = {}): Promise<Workspace> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-edit-intelligence-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  await writeFile(join(dir, "calc.js"), calc);
  const formatted: string[] = [];
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: dir,
    checkpointRoot: join(root, "checkpoints"),
    permissionMode: "full_access",
    ...(options.formatFile ? { formatFile: async (filePath: string) => { formatted.push(filePath); await options.formatFile!(filePath); } } : {}),
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { dir, registry, formatted };
}

const context = (): ToolExecutionContext => ({ runId: `run-${Math.random().toString(36).slice(2)}`, executionScopeId: "scope-edit-intelligence" });

const read = async (dir: string, path: string): Promise<string> => readFile(join(dir, path), "utf8");

// ---------- Cline #1: bounded +/- 25 line window on patch mismatch ----------

test("a mismatched patch reports a bounded 25-line context window with 1-based line numbers", async t => {
  const { dir, registry } = await workspace(t);
  const lines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(dir, "big.txt"), `${lines.join("\n")}\n`);
  // Neither the removed line nor its replacement exists anywhere in the file,
  // so no stage can apply and the patch is not a re-play of an applied edit.
  const result = await registry.execute({
    id: "patch-miss", name: "workspace.apply_patch",
    arguments: { path: "big.txt", patch: "@@ -1,1 +1,1 @@\n-alpha\n+beta\n", expectedSha256: sha(`${lines.join("\n")}\n`) },
  }, "full_access", context());
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "PATCH_FAILED");
  const message = result.error?.message ?? "";
  // The closest line is "line 1" (line 1); the window must reach at least 25 lines below it.
  assert.match(message, /Closest context around line 1/);
  assert.match(message, /^26: line 26$/m, "the window extends to line 26 (best line + 25)");
  assert.doesNotMatch(message, /^80: line 80$/m, "the window stays bounded");
});

// ---------- OpenCode #6: workspace.replace_in_file ----------

test("replace_in_file replaces a unique exact snippet and reports the new sha256", async t => {
  const { dir, registry } = await workspace(t);
  const before = sha(calc);
  const result = await registry.execute({
    id: "replace-1", name: "workspace.replace_in_file",
    arguments: { path: "calc.js", replacements: [{ oldText: "return a + b;", newText: "return a * b;" }], expectedSha256: before },
  }, "full_access", context());
  assert.equal(result.ok, true, result.error?.message);
  assert.match(await read(dir, "calc.js"), /return a \* b;/);
  assert.equal((result.output as { sha256: string }).sha256, sha(await read(dir, "calc.js")));
});

test("replace_in_file applies replacements in order, each on the previous result", async t => {
  const { dir, registry } = await workspace(t);
  const result = await registry.execute({
    id: "replace-seq", name: "workspace.replace_in_file",
    arguments: { path: "calc.js", expectedSha256: sha(calc), replacements: [
      { oldText: "return a + b;", newText: "return a - b;" },
      { oldText: "return a - b;", newText: "return a / b;" },
    ] },
  }, "full_access", context());
  assert.equal(result.ok, true, result.error?.message);
  assert.match(await read(dir, "calc.js"), /return a \/ b;/);
  assert.equal((result.output as { replacements: number }).replacements, 2);
});

test("replace_in_file refuses an ambiguous match without replaceAll and replaces all with it", async t => {
  const { dir, registry } = await workspace(t);
  await writeFile(join(dir, "dup.txt"), "x = 1;\ny = 2;\nx = 1;\n");
  const ambiguous = await registry.execute({
    id: "replace-amb", name: "workspace.replace_in_file",
    arguments: { path: "dup.txt", replacements: [{ oldText: "x = 1;", newText: "x = 9;" }] },
  }, "full_access", context());
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error?.code, "REPLACE_AMBIGUOUS");
  assert.match(ambiguous.error?.message ?? "", /more than one location/);
  assert.equal(await read(dir, "dup.txt"), "x = 1;\ny = 2;\nx = 1;\n", "an ambiguous match never writes");

  const all = await registry.execute({
    id: "replace-all", name: "workspace.replace_in_file",
    arguments: { path: "dup.txt", replacements: [{ oldText: "x = 1;", newText: "x = 9;", replaceAll: true }] },
  }, "full_access", context());
  assert.equal(all.ok, true, all.error?.message);
  assert.equal(await read(dir, "dup.txt"), "x = 9;\ny = 2;\nx = 9;\n");
});

test("replace_in_file smart fallbacks match curly quotes, CRLF and indentation", async t => {
  const { dir, registry } = await workspace(t);
  // Curly quotes: the file keeps them, the model typed straight quotes.
  await writeFile(join(dir, "quotes.txt"), "const note = \u201Chello\u201D;\n");
  const quotes = await registry.execute({
    id: "replace-quotes", name: "workspace.replace_in_file",
    arguments: { path: "quotes.txt", replacements: [{ oldText: '"hello"', newText: '"goodbye"' }] },
  }, "full_access", context());
  assert.equal(quotes.ok, true, quotes.error?.message);
  assert.match(await read(dir, "quotes.txt"), /goodbye/);

  // CRLF file edited with a multi-line LF snippet: the exact stage cannot match,
  // so the line-ending tolerant stage has to splice the block back as CRLF.
  await writeFile(join(dir, "crlf.txt"), "first\r\nsecond\r\nthird\r\n");
  const crlf = await registry.execute({
    id: "replace-crlf", name: "workspace.replace_in_file",
    arguments: { path: "crlf.txt", replacements: [{ oldText: "first\nsecond", newText: "first\nSECOND" }] },
  }, "full_access", context());
  assert.equal(crlf.ok, true, crlf.error?.message);
  const crlfText = await read(dir, "crlf.txt");
  assert.equal(crlfText, "first\r\nSECOND\r\nthird\r\n", "the file keeps its CRLF endings around the replaced block");

  // Indentation: the model typed a tab where the file uses spaces, so only the
  // per-line trimmed stage can match; the inserted block re-indents to the file.
  await writeFile(join(dir, "indent.txt"), "function f() {\n    return 1;\n}\n");
  const indent = await registry.execute({
    id: "replace-indent", name: "workspace.replace_in_file",
    arguments: { path: "indent.txt", replacements: [{ oldText: "\treturn 1;\n}", newText: "return 2;" }] },
  }, "full_access", context());
  assert.equal(indent.ok, true, indent.error?.message);
  assert.equal(await read(dir, "indent.txt"), "function f() {\n    return 2;\n");
});

test("replace_in_file failure reports the closest context instead of a bare mismatch", async t => {
  const { dir, registry } = await workspace(t);
  const failed = await registry.execute({
    id: "replace-miss", name: "workspace.replace_in_file",
    arguments: { path: "calc.js", replacements: [{ oldText: "return a % b;", newText: "return 0;" }] },
  }, "full_access", context());
  assert.equal(failed.ok, false);
  assert.equal(failed.error?.code, "REPLACE_FAILED");
  assert.match(failed.error?.message ?? "", /Closest context around line 2/);
  assert.match(failed.error?.message ?? "", /2:   return a \+ b;/);
  assert.equal(await read(dir, "calc.js"), calc);
});

test("replace_in_file accepts replacements stringified as JSON text (schema coercion)", async t => {
  const { dir, registry } = await workspace(t);
  const result = await registry.execute({
    id: "replace-coerced", name: "workspace.replace_in_file",
    arguments: {
      path: "calc.js",
      replacements: JSON.stringify([{ oldText: "return a + b;", newText: "return a - b;" }]),
      expectedSha256: sha(calc),
    },
  }, "full_access", context());
  assert.equal(result.ok, true, result.error?.message);
  assert.match(await read(dir, "calc.js"), /return a - b;/);
});

test("replace_in_file enforces optimistic concurrency like the other write tools", async t => {
  const { registry } = await workspace(t);
  const stale = await registry.execute({
    id: "replace-stale", name: "workspace.replace_in_file",
    arguments: { path: "calc.js", replacements: [{ oldText: "return a + b;", newText: "x" }], expectedSha256: sha("wrong") },
  }, "full_access", context());
  assert.equal(stale.ok, false);
  assert.equal(stale.error?.code, "STALE_WRITE");
});

// ---------- OpenCode #7: formatFile hook ----------

test("the host formatter runs after every committed write and refreshes the model-visible sha256", async t => {
  let formatCalls: string[] = [];
  const { dir, registry, formatted } = await workspace(t, {
    formatFile: async filePath => {
      formatCalls.push(basename(filePath));
      const current = await readFile(filePath, "utf8");
      await writeFile(filePath, `${current.replace(/\n*$/, "\n")}// formatted\n`, "utf8");
    },
  });
  const written = await registry.execute({
    id: "format-write", name: "workspace.write_file",
    arguments: { path: "calc.js", content: calc, expectedSha256: sha(calc) },
  }, "full_access", context());
  assert.equal(written.ok, true, written.error?.message);
  assert.match(await read(dir, "calc.js"), /\/\/ formatted$/m);
  assert.equal((written.output as { sha256: string }).sha256, sha(await read(dir, "calc.js")), "the returned sha256 matches the formatted bytes");
  assert.deepEqual(formatCalls, ["calc.js"]);

  // The refreshed sha keeps the next edit valid.
  const patched = await registry.execute({
    id: "format-patch", name: "workspace.apply_patch",
    arguments: { path: "calc.js", patch: "@@ -1,1 +1,1 @@\n-function add(a, b) {\n+function sub(a, b) {\n" },
  }, "full_access", context());
  assert.equal(patched.ok, true, patched.error?.message);

  const replaced = await registry.execute({
    id: "format-replace", name: "workspace.replace_in_file",
    arguments: { path: "calc.js", replacements: [{ oldText: "return a + b;", newText: "return a - b;" }] },
  }, "full_access", context());
  assert.equal(replaced.ok, true, replaced.error?.message);
  assert.match(await read(dir, "calc.js"), /return a - b;/);
  assert.equal(formatted.length, 3, "write_file, apply_patch and replace_in_file each format once");
});

test("a failing formatter never fails an already committed edit", async t => {
  const { dir, registry } = await workspace(t, { formatFile: async () => { throw new Error("formatter crashed"); } });
  const written = await registry.execute({
    id: "format-broken", name: "workspace.write_file",
    arguments: { path: "calc.js", content: calc, expectedSha256: sha(calc) },
  }, "full_access", context());
  assert.equal(written.ok, true, written.error?.message);
  assert.equal(await read(dir, "calc.js"), calc);
});

// ---------- OpenCode #8: ENOENT NFD/NFC recovery and sibling suggestions ----------

test("a read of an NFC-named file stored as NFD succeeds and a near miss suggests siblings", async t => {
  const { dir, registry } = await workspace(t);
  // macOS stores file names in NFD; the model asks with the NFC spelling.
  await writeFile(join(dir, "caf\u00e9.txt".normalize("NFD")), "coffee\n");
  const recovered = await registry.execute({
    id: "read-nfd", name: "workspace.read_file", arguments: { path: "caf\u00e9.txt".normalize("NFC") },
  }, "full_access", context());
  assert.equal(recovered.ok, true, recovered.error?.message);
  assert.equal((recovered.output as { content: string }).content, "coffee\n");

  const missing = await registry.execute({
    id: "read-miss", name: "workspace.read_file", arguments: { path: "calc.jss" },
  }, "full_access", context());
  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, "PATH_NOT_FOUND");
  assert.match(missing.error?.message ?? "", /Did you mean one of: calc\.js\?/);
});

// ---------- OpenCode #10: nested AGENTS.md injection ----------

test("touching a subdirectory surfaces its nested AGENTS.md once", async t => {
  const { dir, registry } = await workspace(t);
  await mkdir(join(dir, "src", "ui"), { recursive: true });
  await writeFile(join(dir, "src", "AGENTS.md"), "UI rules: keep components small.\n");
  await writeFile(join(dir, "src", "ui", "button.ts"), "export const button = 1;\n");
  await writeFile(join(dir, "AGENTS.md"), "root rules\n");

  const first = await registry.execute({
    id: "read-button", name: "workspace.read_file", arguments: { path: "src/ui/button.ts" },
  }, "full_access", context());
  assert.equal(first.ok, true, first.error?.message);
  const instructions = (first.output as { nestedInstructions?: { path: string; content: string }[] }).nestedInstructions ?? [];
  assert.deepEqual(instructions.map(entry => entry.path), ["src/AGENTS.md"]);
  assert.match(instructions[0]!.content, /UI rules/);

  const second = await registry.execute({
    id: "read-button-2", name: "workspace.read_file", arguments: { path: "src/ui/button.ts" },
  }, "full_access", context());
  assert.equal(second.ok, true);
  assert.equal((second.output as { nestedInstructions?: unknown }).nestedInstructions, undefined, "an already injected instruction file is not repeated");

  const rootRead = await registry.execute({
    id: "read-root", name: "workspace.read_file", arguments: { path: "calc.js" },
  }, "full_access", context());
  assert.equal(rootRead.ok, true);
  assert.equal((rootRead.output as { nestedInstructions?: unknown }).nestedInstructions, undefined, "the workspace-root instruction file is the host's, not injected here");
});

// ---------- OpenCode #12: compound command / out-of-workspace write analysis ----------

test("a command that writes outside the workspace is surfaced on the approval request", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-outside-write-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  const outside = join(root, "outside");
  await mkdir(outside);
  const requests: Record<string, unknown>[] = [];
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "workspace_write",
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const contextWithApproval: ToolExecutionContext = {
    runId: "run-outside-write", executionScopeId: "scope-outside-write",
    requestPermissionApproval: async request => { requests.push(request as unknown as Record<string, unknown>); return true; },
  };
  // allowOutsideWorkspace skips the sandbox wrapper, so the approval path (and
  // its write analysis) is the one under test.
  const result = await registry.execute({
    id: "outside", name: "process.run",
    arguments: { command: "touch", args: [join(outside, "x.txt")], allowOutsideWorkspace: true },
  }, "workspace_write", contextWithApproval);
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(requests.length, 1, "the unsandboxed approval was requested");
  assert.equal(requests[0]!.outOfWorkspaceWrite, true);
  assert.equal(requests[0]!.compoundCommand, false, "a single command is not compound");
  const paths = requests[0]!.outOfWorkspacePaths as string[];
  assert.ok(paths.some(path => path.endsWith("x.txt")), `expected the outside path, got ${JSON.stringify(paths)}`);
  assert.equal(requests[0]!.autoIgnoreAfterMs, 10_000);
  await assert.doesNotReject(readFile(join(outside, "x.txt"), "utf8"), "an approved command really runs");
});

test("a compound command writing outside the workspace is flagged as compound on the request", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-compound-write-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  const outside = join(root, "outside");
  await mkdir(outside);
  const requests: Record<string, unknown>[] = [];
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "workspace_write",
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const contextWithApproval: ToolExecutionContext = {
    runId: "run-compound-write", executionScopeId: "scope-compound-write",
    requestPermissionApproval: async request => { requests.push(request as unknown as Record<string, unknown>); return true; },
  };
  const result = await registry.execute({
    id: "compound", name: "process.run",
    arguments: {
      command: "/bin/sh",
      args: ["-c", `touch ${JSON.stringify(join(outside, "a.txt"))} && touch ${JSON.stringify(join(outside, "b.txt"))}`],
      allowOutsideWorkspace: true,
    },
  }, "workspace_write", contextWithApproval);
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.compoundCommand, true, "the compound operators are visible on the request");
  assert.equal(requests[0]!.outOfWorkspaceWrite, true);
  const paths = requests[0]!.outOfWorkspacePaths as string[];
  assert.ok(paths.some(path => path.endsWith("a.txt")) && paths.some(path => path.endsWith("b.txt")), `expected both outside paths, got ${JSON.stringify(paths)}`);
});

test("an unanswered out-of-workspace write approval auto-ignores after the bounded window", { timeout: 20_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-auto-ignore-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  const outside = join(root, "outside");
  await mkdir(outside);
  let release: (() => void) | undefined;
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "workspace_write",
  });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const contextNeverAnswered: ToolExecutionContext = {
    runId: "run-auto-ignore", executionScopeId: "scope-auto-ignore",
    requestPermissionApproval: () => new Promise<boolean>(resolve => { release = () => resolve(true); }),
  };
  const started = Date.now();
  const result = await registry.execute({
    id: "never", name: "process.run",
    arguments: { command: "touch", args: [join(outside, "y.txt")], allowOutsideWorkspace: true },
  }, "workspace_write", contextNeverAnswered);
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "PERMISSION_DENIED");
  assert.ok(elapsed >= 9_000 && elapsed < 15_000, `auto-ignore should bound the wait, took ${elapsed}ms`);
  await assert.rejects(readFile(join(outside, "y.txt")), { code: "ENOENT" }, "an ignored approval never runs the command");
  release?.();
});

// ---------- Cline #3 / OpenCode #2: line cap + spill file ----------

test("a single over-long output line is capped and the full output is spilled for inspection", async t => {
  const { dir, registry } = await workspace(t);
  const script = "process.stdout.write('x'.repeat(5000) + '\\n' + 'tail\\n');";
  const result = await registry.execute({
    id: "long-line", name: "process.run",
    arguments: { command: process.execPath, args: ["-e", script] },
  }, "full_access", context());
  assert.equal(result.ok, true, result.error?.message);
  const stdout = (result.output as { stdout: string }).stdout;
  assert.match(stdout, /\.\.\.\[line truncated\]/);
  assert.ok(!stdout.includes("x".repeat(5_000)), "the capped line does not reach the model in full");
  assert.match(stdout, /\[Full unclipped output saved to \S+\.log\. Use workspace\.read_file with startLine\/endLine or workspace\.search_text to inspect omitted lines\.\]/);
  const spillPath = /saved to (\S+)\. Use/.exec(stdout)![1]!;
  assert.match(basename(spillPath), /^proc-[0-9a-f-]{36}\.log$/, `expected a process-id spill file name, got ${spillPath}`);
  const spilled = await readFile(spillPath, "utf8");
  assert.ok(spilled.includes("x".repeat(5_000)), "the spill file holds the unclipped output");
  assert.ok(!spillPath.startsWith(dir), `the spill file stays out of the user's project, got ${spillPath}`);
  assert.ok(spillPath.includes(`${sep}nextmux-tool-output${sep}`), `expected the app's spill folder, got ${spillPath}`);
  // The file the model is pointed to is readable with the named tools, in every permission mode, and never writable.
  for (const mode of ["read_only", "workspace_write", "full_access"] as const) {
    const read = await registry.execute({ id: `read-spill-${mode}`, name: "workspace.read_file", arguments: { path: spillPath, startLine: 1, endLine: 2 } },
      mode, { runId: `run-spill-${mode}`, executionScopeId: `scope-spill-${mode}` });
    assert.equal(read.ok, true, `${mode}: ${read.error?.code} ${read.error?.message}`);
    const searched = await registry.execute({ id: `search-spill-${mode}`, name: "workspace.search_text", arguments: { path: spillPath, query: "tail" } },
      mode, { runId: `run-spill-search-${mode}`, executionScopeId: `scope-spill-search-${mode}` });
    assert.equal(searched.ok, true, `${mode}: ${searched.error?.code} ${searched.error?.message}`);
  }
  const overwrite = await registry.execute({ id: "write-spill", name: "workspace.write_file", arguments: { path: spillPath, content: "x" } },
    "workspace_write", { runId: "run-spill-write", executionScopeId: "scope-spill-write" });
  assert.equal(overwrite.ok, false, "a spill file is not writable through the file tools");
});

test("output whose ring evicted its middle is spilled with the head and tail preserved", async t => {
  // A small output limit forces the ring to evict its middle.
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-spill-")));
  const runtime = await WorkspaceToolRuntime.create({
    workspaceRoot: root, checkpointRoot: join(root, "checkpoints"), permissionMode: "full_access",
    limits: { maxOutputChars: 2_048 },
  });
  const spillRegistry = new AgentToolRegistry();
  runtime.registerTools(spillRegistry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  // The session ring never retains fewer than 4_096 characters, so the output
  // has to clear that floor before the ring starts evicting its middle.
  const script = "for (let i = 0; i < 2_000; i += 1) process.stdout.write(`line ${i}\\n`);";
  const result = await spillRegistry.execute({
    id: "evicted", name: "process.run",
    arguments: { command: process.execPath, args: ["-e", script] },
  }, "full_access", { runId: "run-evicted", executionScopeId: "scope-evicted" });
  assert.equal(result.ok, true, result.error?.message);
  const stdout = (result.output as { stdout: string }).stdout;
  assert.match(stdout, /\.\.\.\[truncated\]\.\.\./);
  assert.match(stdout, /line 0\n/, "the evicted head is preserved");
  assert.match(stdout, /line 1999/, "the retained tail is preserved");
  assert.match(stdout, /\[Full unclipped output saved to /);
});

// ---------- OpenCode #12: what counts as a write outside the workspace ----------

async function outsideWriteFixture(t: TestContext, name: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `nextmux-${name}-`)));
  const dir = join(root, "workspace");
  const outside = join(root, "outside");
  await mkdir(dir);
  await mkdir(outside);
  const requests: Record<string, unknown>[] = [];
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "workspace_write" });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const approving: ToolExecutionContext = {
    runId: `run-${name}`, executionScopeId: `scope-${name}`,
    requestPermissionApproval: async request => { requests.push(request as unknown as Record<string, unknown>); return true; },
  };
  return { dir, outside, registry, requests, approving };
}

test("discarding output to /dev/null or a descriptor is not a write outside the workspace", async t => {
  const f = await outsideWriteFixture(t, "devnull");
  const result = await f.registry.execute({
    id: "devnull", name: "process.run",
    arguments: { command: "/bin/sh", args: ["-c", "echo hi > /dev/null 2>&1; echo quoted '> /etc/not-a-target'"], allowOutsideWorkspace: true },
  }, "workspace_write", f.approving);
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(f.requests.length, 1, "the unsandboxed command still asks once");
  assert.equal(f.requests[0]!.outOfWorkspaceWrite, undefined, `no outside write expected, got ${JSON.stringify(f.requests[0]!.outOfWorkspacePaths)}`);
  assert.equal(f.requests[0]!.autoIgnoreAfterMs, undefined, "an ordinary approval never ignores itself");
  assert.equal(f.requests[0]!.compoundCommand, true);
});

test("a relative write target that leaves the workspace is flagged with its resolved path", async t => {
  const f = await outsideWriteFixture(t, "relative");
  const result = await f.registry.execute({
    id: "relative", name: "process.run",
    arguments: { command: "touch", args: ["../outside/rel.txt", "inside.txt"], allowOutsideWorkspace: true },
  }, "workspace_write", f.approving);
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(f.requests[0]!.outOfWorkspaceWrite, true);
  assert.deepEqual(f.requests[0]!.outOfWorkspacePaths, [join(f.outside, "rel.txt")], "only the target outside the workspace is listed");
});

test("a file tool writing outside the workspace asks with the target and the bounded window; a read does not", async t => {
  const f = await outsideWriteFixture(t, "external-file");
  const target = join(f.outside, "notes.txt");
  const written = await f.registry.execute({ id: "write-outside", name: "workspace.write_file", arguments: { path: target, content: "hello\n" } },
    "workspace_write", f.approving);
  assert.equal(written.ok, true, written.error?.message);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]!.scope, "external_file");
  assert.equal(f.requests[0]!.detail, "write");
  assert.equal(f.requests[0]!.outOfWorkspaceWrite, true);
  assert.deepEqual(f.requests[0]!.outOfWorkspacePaths, [target]);
  assert.equal(f.requests[0]!.autoIgnoreAfterMs, 10_000);
  assert.equal(await readFile(target, "utf8"), "hello\n");
  const read = await f.registry.execute({ id: "read-outside", name: "workspace.read_file", arguments: { path: target } }, "workspace_write", f.approving);
  assert.equal(read.ok, true, read.error?.message);
  assert.equal(f.requests[1]!.detail, "read");
  assert.equal(f.requests[1]!.outOfWorkspaceWrite, undefined);
  assert.equal(f.requests[1]!.autoIgnoreAfterMs, undefined);
});

test("replace_in_file re-indents a snippet written at another depth and never overlaps matches", async t => {
  const { dir, registry } = await workspace(t);
  // The model copied the block with 8 spaces; the file indents it with 4. The new block takes the file's depth,
  // keeps its inner depth, and a closing line indented less than the snippet's base moves out with it.
  await writeFile(join(dir, "nested.js"), "class A {\n    run() {\n        return 1;\n    }\n}\n");
  const deeper = await registry.execute({
    id: "replace-deeper", name: "workspace.replace_in_file",
    arguments: { path: "nested.js", replacements: [{ oldText: "        run() {\n            return 1;\n        }",
      newText: "        run() {\n            if (ready) {\n                return 2;\n            }\n        }" }] },
  }, "full_access", context());
  assert.equal(deeper.ok, true, deeper.error?.message);
  assert.equal(await read(dir, "nested.js"), "class A {\n    run() {\n        if (ready) {\n            return 2;\n        }\n    }\n}\n");

  // A dedented line of the new text (written at 4 under an 8-space base) moves out by the same amount.
  await writeFile(join(dir, "dedent.py"), "def f():\n    if x:\n        y()\n");
  const dedent = await registry.execute({
    id: "replace-dedent", name: "workspace.replace_in_file",
    arguments: { path: "dedent.py", replacements: [{ oldText: "            y()", newText: "            y()\n        z()" }] },
  }, "full_access", context());
  assert.equal(dedent.ok, true, dedent.error?.message);
  assert.equal(await read(dir, "dedent.py"), "def f():\n    if x:\n        y()\n    z()\n");

  // Three closing braces hold two overlapping two-line matches; replaceAll takes them one after another.
  await writeFile(join(dir, "braces.js"), "a\n  }\n  }\n  }\nb\n");
  const overlap = await registry.execute({
    id: "replace-overlap", name: "workspace.replace_in_file",
    arguments: { path: "braces.js", replacements: [{ oldText: "}\n}", newText: "}", replaceAll: true }] },
  }, "full_access", context());
  assert.equal(overlap.ok, true, overlap.error?.message);
  assert.equal(await read(dir, "braces.js"), "a\n  }\n  }\nb\n", "one non-overlapping pair is folded, the third brace stays");
});

test("two runtimes editing one file at once: the second edit is refused as stale, never written over the first", async t => {
  const { dir, registry } = await workspace(t);
  const second = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(dir, "..", "checkpoints-2"), permissionMode: "full_access" });
  t.after(() => second.dispose());
  const other = new AgentToolRegistry();
  second.registerTools(other);
  const expectedSha256 = sha(calc);
  const [first, late] = await Promise.all([
    registry.execute({ id: "race-a", name: "workspace.replace_in_file",
      arguments: { path: "calc.js", expectedSha256, replacements: [{ oldText: "a + b", newText: "a + b + 1" }] } }, "full_access", context()),
    other.execute({ id: "race-b", name: "workspace.replace_in_file",
      arguments: { path: "calc.js", expectedSha256, replacements: [{ oldText: "a + b", newText: "a - b" }] } }, "full_access", context()),
  ]);
  const outcomes = [first, late].map(result => result.ok ? "ok" : result.error?.code).sort();
  assert.deepEqual(outcomes, ["STALE_WRITE", "ok"], JSON.stringify([first.error, late.error]));
  const text = await read(dir, "calc.js");
  assert.ok(text === calc.replace("a + b", "a + b + 1") || text === calc.replace("a + b", "a - b"), text);
});
