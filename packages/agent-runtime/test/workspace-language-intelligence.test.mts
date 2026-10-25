import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../lib/index.js';
import { DefaultWorkspaceDiagnostics, type WorkspaceDiagnosticProvider } from '../lib/workspace-diagnostics.js';
import { InstalledLanguageServerDiagnostics } from '../lib/workspace-lsp-diagnostics.js';
import { parseProjectStructure } from '../lib/workspace-project-map.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(t: TestContext, diagnostics?: WorkspaceDiagnosticProvider) {
  const base = await mkdtemp(join(tmpdir(), 'nm-language-'));
  await mkdir(join(base, 'workspace'));
  const root = await realpath(join(base, 'workspace'));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access', diagnostics });
  const registry = new AgentToolRegistry(); runtime.registerTools(registry);
  let id = 0;
  const execute = (name: string, args: unknown) => registry.execute({ id: `language-${++id}`, name, arguments: args }, 'full_access', { runId: 'language-run' });
  t.after(async () => { await runtime.dispose(); await rm(base, { recursive: true, force: true }); });
  return { root, runtime, execute };
}

test('write_file returns only newly introduced real TypeScript semantic errors after line shifts', async t => {
  const f = await fixture(t);
  const before = 'export const existing: string = 1;\n';
  const after = '\n' + before + 'export const introduced: boolean = 3;\n';
  await writeFile(join(f.root, 'app.ts'), before);
  const written = await f.execute('workspace.write_file', { path: 'app.ts', content: after, expectedSha256: sha(before) });
  assert.equal(written.ok, true);
  const result = (written.output as any).diagnostics;
  assert.equal(result.status, 'checked', JSON.stringify(result));
  assert.equal(result.sha256, sha(after));
  assert.equal(result.existingErrorCount, 1);
  assert.equal(result.newErrors.length, 1);
  assert.equal(result.newErrors[0].code, '2322');
  assert.equal(result.newErrors[0].line, 3);
  await f.runtime.restoreCheckpoint((written.output as any).checkpointId);
  assert.equal(await readFile(join(f.root, 'app.ts'), 'utf8'), before);
});

test('apply_patch resolves imported types and reports introduced semantic errors', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'model.ts'), 'export interface User { name: string }\n');
  const before = "import type { User } from './model.js';\nexport const user: User = { name: 'Ada' };\n";
  await writeFile(join(f.root, 'app.ts'), before);
  const written = await f.execute('workspace.apply_patch', { path: 'app.ts', expectedSha256: sha(before),
    patch: "@@ -1,2 +1,2 @@\n import type { User } from './model.js';\n-export const user: User = { name: 'Ada' };\n+export const user: User = { name: 42 };\n" });
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal((written.output as any).diagnostics.status, 'checked');
  assert.equal((written.output as any).diagnostics.newErrors[0].code, '2322');
});

test('diagnostic service failure never prevents an edit and never claims no errors', async t => {
  const f = await fixture(t, { snapshot: async () => { throw new Error('offline'); } });
  const result = await f.execute('workspace.write_file', { path: 'app.ts', content: 'const broken: number = "x";' });
  assert.equal(result.ok, true);
  assert.equal((result.output as any).diagnostics.status, 'unavailable');
  assert.equal((result.output as any).diagnostics.newErrors, undefined);
  assert.match(await readFile(join(f.root, 'app.ts'), 'utf8'), /broken/);
});

test('file changed during post-write checking makes diagnostics stale', async t => {
  let calls = 0, root = '';
  const f = await fixture(t, { snapshot: async request => {
    if (++calls === 2) await writeFile(join(root, request.path), 'external edit');
    return { status: 'ready', source: 'fixture', sha256: request.sha256, errors: [] };
  } }); root = f.root;
  const result = await f.execute('workspace.write_file', { path: 'app.ts', content: 'const value = 1;' });
  assert.equal(result.ok, true);
  assert.equal((result.output as any).diagnostics.status, 'stale');
  assert.equal((result.output as any).diagnostics.newErrors, undefined);
});

test('a stale provider version cannot be used as a clean baseline', async t => {
  const f = await fixture(t, { snapshot: async () => ({ status: 'ready', source: 'fixture', sha256: sha('old'), errors: [] }) });
  const result = await f.execute('workspace.write_file', { path: 'app.ts', content: 'new' });
  assert.equal(result.ok, true);
  assert.equal((result.output as any).diagnostics.status, 'unavailable');
  assert.match((result.output as any).diagnostics.reason, /version_mismatch/);
});

test('compiler project budget is explicit instead of silently checking a partial project', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'tsconfig.json'), JSON.stringify({ files: Array.from({ length: 501 }, (_, i) => `file${i}.ts`) }));
  const diagnostics = new DefaultWorkspaceDiagnostics(f.root); t.after(() => diagnostics.dispose());
  const content = 'export const value = 1;';
  const result = await diagnostics.snapshot({ path: 'file0.ts', content, sha256: sha(content) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'project_file_budget_exceeded');
});

test('Python, Go and Rust map real definitions and imports, excluding lookalikes in comments and strings', async () => {
  const fixtures = [
    ['sample.py', 'import os\n# def fake(): pass\ntext = "class Fake:"\nclass Actual:\n    def method(self, value: int) -> str:\n        return str(value)\n', ['Actual', 'method']],
    ['sample.go', 'package demo\nimport "fmt"\n// func Fake() {}\ntype Actual struct { Name string }\nfunc (a Actual) Method() string { return fmt.Sprint(a.Name) }\n', ['Actual', 'Method']],
    ['sample.rs', 'use std::fmt;\n// fn fake() {}\nstruct Actual { value: i32 }\nimpl Actual { fn method(&self) -> i32 { self.value } }\n', ['Actual', 'method']],
  ] as const;
  for (const [path, source, names] of fixtures) {
    const map = await parseProjectStructure(path, source, 100);
    assert.equal(map.parser, 'tree-sitter-wasm');
    assert.equal(map.syntaxErrors, false);
    assert.deepEqual(map.symbols.map(symbol => symbol.name), [...names]);
    assert.ok(map.imports.length);
    assert.ok(map.symbols.every(symbol => symbol.line > 0 && symbol.signature.length > 0));
  }
});

test('project_map exposes multiline syntax structures and grammar errors honestly', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'lib.py'), 'def mapped(\n    arg: int,\n) -> int:\n    return arg\n');
  const result = await f.execute('workspace.project_map', {});
  assert.equal(result.ok, true);
  const file = (result.output as any).files.find((item: any) => item.path === 'lib.py');
  assert.equal(file.syntaxIndexed, true);
  assert.equal(file.symbols[0].name, 'mapped');
  assert.match(file.symbols[0].signature, /arg: int/);
  const invalid = await parseProjectStructure('bad.rs', 'fn broken( {', 10);
  assert.equal(invalid.syntaxErrors, true);
});

for (const mode of ['push', 'pull', 'stale', 'unversioned'] as const) test(`LSP ${mode} transport requires fresh diagnostics for the edited document`, async t => {
  const f = await fixture(t);
  const provider = new InstalledLanguageServerDiagnostics(f.root, { python: { command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/diagnostic-language-server.mjs', import.meta.url)), mode], language: 'python' } });
  t.after(() => provider.dispose());
  const content = 'unknown_name';
  const result = await provider.snapshot({ path: 'sample.py', content, sha256: sha(content) });
  assert.equal(result.status, mode === 'push' || mode === 'pull' ? 'ready' : 'unavailable');
  if (result.status === 'ready') {
    assert.equal(result.errors?.[0]?.code, 'undefined-name');
    const clean = await provider.snapshot({ path: 'sample.py', content: 'known = 1', sha256: sha('known = 1') });
    assert.equal(clean.status, 'ready'); assert.deepEqual(clean.errors, []);
  } else assert.equal(result.reason, 'fresh_versioned_diagnostics_unavailable');
});

test('project_map extracts multiline arrow/function variable signatures and class constructor/accessor members (D1-11)', async t => {
  const f = await fixture(t);
  await writeFile(
    join(f.root, 'widget.ts'),
    [
      'export const compute = (',
      '  x: number,',
      '  y: string,',
      '): number => {',
      '  return x + y.length;',
      '};',
      'export const render = function(',
      '  label: string,',
      '): string {',
      '  return label.trim();',
      '};',
      'export class Counter {',
      '  #v = 0;',
      '  constructor(initial: number) { this.#v = initial; }',
      '  get value(): number { return this.#v; }',
      '  set value(next: number) { this.#v = next; }',
      '}',
    ].join('\n'),
  );
  const res = await f.execute('workspace.project_map', {});
  assert.equal(res.ok, true);
  const file = (res.output as any).files.find((item: any) => item.path === 'widget.ts');
  assert.ok(file);
  const byName = new Map<string, any[]>(['compute', 'render', 'constructor', 'value'].map(k => [k, []]));
  for (const sym of file.symbols) {
    byName.get(sym.name)?.push(sym);
  }
  assert.equal(byName.get('compute')?.[0]?.kind, 'function');
  assert.match(byName.get('compute')?.[0]?.signature ?? '', /x: number, y: string/);
  assert.equal(byName.get('render')?.[0]?.kind, 'function');
  assert.match(byName.get('render')?.[0]?.signature ?? '', /label: string/);
  assert.equal(byName.get('constructor')?.length, 1);
  assert.match(byName.get('constructor')?.[0]?.signature ?? '', /constructor\(initial: number\)/);
  assert.equal(byName.get('value')?.length, 2);
});

test('DefaultWorkspaceDiagnostics queues concurrent snapshots and resolves symlinked node_modules (D1-13, D1-15)', async t => {
  const f = await fixture(t);
  const externalStore = await mkdtemp(join(tmpdir(), 'nm-pnpm-store-'));
  t.after(() => rm(externalStore, { recursive: true, force: true }));
  const pkgTarget = join(externalStore, 'pkg-a');
  await mkdir(pkgTarget, { recursive: true });
  await writeFile(join(pkgTarget, 'package.json'), JSON.stringify({ name: 'pkg-a', types: 'index.d.ts' }));
  await writeFile(join(pkgTarget, 'index.d.ts'), 'export declare function greet(name: string): string;\n');
  await mkdir(join(f.root, 'node_modules'), { recursive: true });
  await symlink(pkgTarget, join(f.root, 'node_modules', 'pkg-a'));

  const diagnostics = new DefaultWorkspaceDiagnostics(f.root);
  t.after(() => diagnostics.dispose());

  const cancelledController = new AbortController();
  cancelledController.abort();
  const validSource = "import { greet } from 'pkg-a';\nexport const msg: string = greet('world');\n";
  const brokenSource = "import { greet } from 'pkg-a';\nexport const bad: number = greet('world');\n";
  await writeFile(join(f.root, 'a.ts'), validSource);
  await writeFile(join(f.root, 'b.ts'), brokenSource);

  const [cancelledRes, validRes, brokenRes] = await Promise.all([
    diagnostics.snapshot({ path: 'a.ts', content: validSource, sha256: sha(validSource), signal: cancelledController.signal }),
    diagnostics.snapshot({ path: 'a.ts', content: validSource, sha256: sha(validSource) }),
    diagnostics.snapshot({ path: 'b.ts', content: brokenSource, sha256: sha(brokenSource) }),
  ]);
  assert.equal(cancelledRes.status, 'unavailable');
  assert.equal(cancelledRes.reason, 'cancelled');
  assert.equal(validRes.status, 'ready');
  assert.deepEqual(validRes.errors, []);
  assert.equal(brokenRes.status, 'ready');
  assert.equal(brokenRes.errors?.length, 1);
  assert.equal(brokenRes.errors?.[0]?.code, '2322');
});

test('InstalledLanguageServerDiagnostics singleflight startup and cancellation does not blacklist language (D1-14)', async t => {
  const f = await fixture(t);
  const provider = new InstalledLanguageServerDiagnostics(f.root, {
    python: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/diagnostic-language-server.mjs', import.meta.url)), 'push'],
      language: 'python',
    },
  });
  t.after(() => provider.dispose());

  const abortController = new AbortController();
  abortController.abort();
  const aborted = await provider.snapshot({
    path: 'sample.py',
    content: 'unknown_name',
    sha256: sha('unknown_name'),
    signal: abortController.signal,
  });
  assert.equal(aborted.status, 'unavailable');

  const [r1, r2] = await Promise.all([
    provider.snapshot({ path: 'sample.py', content: 'unknown_name', sha256: sha('unknown_name') }),
    provider.snapshot({ path: 'sample2.py', content: 'known = 1', sha256: sha('known = 1') }),
  ]);
  assert.equal(r1.status, 'ready');
  assert.equal(r1.errors?.[0]?.code, 'undefined-name');
  assert.equal(r2.status, 'ready');
  assert.deepEqual(r2.errors, []);
});
