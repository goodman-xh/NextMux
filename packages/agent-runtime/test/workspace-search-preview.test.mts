import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentToolRegistry, WorkspaceToolRuntime } from '../lib/index.js';

test('search excerpts show late and cross-chunk matches without growing with the line', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-search-preview-'));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(root, '.nextmux'), permissionMode: 'read_only' });
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const registry = new AgentToolRegistry();
  runtime.registerTools(registry);
  const needle = 'TargetSymbol';
  const lines = ['a'.repeat(100_000) + needle + ' tail',
    'b'.repeat(65_532) + needle + ' boundary tail', 'plain line', needle + ' short'];
  // Keep the boundary case in its own file so its match straddles the 64 KiB
  // stream boundary, independently of the first long line's byte length.
  await writeFile(join(root, 'late.txt'), lines[0]);
  await writeFile(join(root, 'boundary.txt'), lines.slice(1).join('\n'));
  // İ occupies two UTF-8 bytes and expands to two UTF-16 units when folded.
  // The boundary fixture places six ASCII target bytes before the 64 KiB edge.
  await writeFile(join(root, 'unicode.txt'), 'İ'.repeat(1000) + needle + ' x'.repeat(1000));
  await writeFile(join(root, 'unicode-mixed.txt'), 'İ🙂A'.repeat(300) + needle + ' mixed tail');
  await writeFile(join(root, 'unicode-boundary.txt'), 'İ'.repeat(32_765) + needle + ' boundary tail');
  for (const [path, matchCase] of [['late.txt', true], ['boundary.txt', false], ['unicode.txt', false], ['unicode-mixed.txt', false], ['unicode-boundary.txt', false]] as const) {
    const result = await registry.execute({ id: path, name: 'workspace.search_text',
      arguments: { path, query: matchCase ? needle : needle.toLowerCase(), matchCase } },
      'read_only', { runId: 'search-preview' });
    assert.equal(result.ok, true);
    const output = result.output as { matches: { line: number; preview: string }[]; complete: boolean };
    assert.equal(output.complete, true);
    assert.deepEqual(output.matches.map(match => match.line), path === 'boundary.txt' ? [1, 3] : [1]);
    for (const match of output.matches) {
      assert.ok(match.preview.includes(needle), match.preview);
      assert.ok(match.preview.length <= 500);
    }
    if (path === 'boundary.txt') assert.equal(output.matches[1].preview, needle + ' short');
  }
});
