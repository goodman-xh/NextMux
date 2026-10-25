import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { AgentToolRegistry, WorkspaceToolRuntime } from "../lib/index.js";

// An edit changes only the lines it edits: a mixed CRLF/LF file keeps every untouched line's own ending, a
// consistently CRLF file stays CRLF, and an LF file stays LF (audit DK-A3).
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function workspace(t: TestContext, files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nextmux-line-endings-")));
  const dir = join(root, "workspace");
  await mkdir(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(root, "checkpoints"), permissionMode: "full_access" });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { dir, registry };
}

const patchFile = async (registry: AgentToolRegistry, path: string, before: string, patch: string, id: string) => {
  const result = await registry.execute({ id, name: "workspace.apply_patch", arguments: { path, patch, expectedSha256: sha(before) } },
    "full_access", { runId: `run-${id}`, executionScopeId: `scope-${id}` });
  assert.equal(result.ok, true, result.error?.message);
};

test("a patch on a mixed CRLF/LF file changes only the patched line", async t => {
  const mixed = "first\r\nsecond\nthird\r\nfourth\n";
  const { dir, registry } = await workspace(t, { "mixed.txt": mixed });
  await patchFile(registry, "mixed.txt", mixed, "@@ -1,4 +1,4 @@\n first\n-second\n+SECOND\n third\n fourth\n", "mixed");
  assert.equal(await readFile(join(dir, "mixed.txt"), "utf8"), "first\r\nSECOND\nthird\r\nfourth\n");
});

test("lines added to a mixed file take the ending of the line before them", async t => {
  const mixed = "a\r\nb\r\nc\nd\n";
  const { dir, registry } = await workspace(t, { "added.txt": mixed });
  await patchFile(registry, "added.txt", mixed, "@@ -1,4 +1,5 @@\n a\n+a2\n b\n c\n d\n", "added");
  assert.equal(await readFile(join(dir, "added.txt"), "utf8"), "a\r\na2\r\nb\r\nc\nd\n");
});

test("a consistently CRLF file stays CRLF and an LF file stays LF", async t => {
  const crlf = "one\r\ntwo\r\n", lf = "one\ntwo\n";
  const { dir, registry } = await workspace(t, { "crlf.txt": crlf, "lf.txt": lf });
  await patchFile(registry, "crlf.txt", crlf, "@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n", "crlf");
  await patchFile(registry, "lf.txt", lf, "@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n", "lf");
  assert.equal(await readFile(join(dir, "crlf.txt"), "utf8"), "one\r\nTWO\r\n");
  assert.equal(await readFile(join(dir, "lf.txt"), "utf8"), "one\nTWO\n");
});
