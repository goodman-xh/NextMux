import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, ManagedProcessSession, selectProcessSnapshotChunks, WorkspaceToolRuntime } from '../lib/index.js';

test('many small terminal chunks remain successful and every cursor page is readable by the model', async () => {
  const retained = Array.from({ length: 6000 }, (_, i) => ({ sequence: i + 1, stream: 'pty' as const, text: 'x' }));
  const tools = new AgentToolRegistry(); let cursor = 0, recovered = '', turns = 0;
  tools.register({ name: 'process.read', description: 'Read isolated output', source: 'builtin', requiredPermission: 'read_only', inputSchema: { type: 'object' } },
    async () => {
      const chunks = selectProcessSnapshotChunks(retained, cursor, 65536);
      return { modelOutput: { processId: 'proc-pagination', chunks, nextSequence: chunks.at(-1)?.sequence ?? cursor,
        latestSequence: retained.length, hasMore: (chunks.at(-1)?.sequence ?? cursor) < retained.length,
        running: false, exitCode: 0 }, summary: { title: 'Read', outcome: 'succeeded' } };
    });
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete(request) {
    const last = request.messages.at(-1);
    if (last?.role === 'tool') {
      assert.ok(last.content.length < 120000);
      const data = JSON.parse(last.content); assert.equal(data.ok, true);
      const page = data.output; assert.equal(page.chunks[0].sequence, cursor + 1);
      recovered += page.chunks.map((c: { text: string }) => c.text).join(''); cursor = page.nextSequence;
      if (!page.hasMore) return { content: 'Read every chunk' };
    }
    return { toolCalls: [{ id: `page-${++turns}`, name: 'process.read', arguments: {} }] };
  } } }).run({ runId: 'process-output-pagination', prompt: 'Read all isolated output' });
  assert.equal(result.status, 'completed'); assert.equal(cursor, 6000); assert.equal(recovered, 'x'.repeat(6000));
  assert.ok(turns > 1); assert.ok(result.events.filter(e => e.type === 'tool_completed').every(e => e.ok));
});

test('control-character escaping is counted and internal secret snapshots remain complete', () => {
  const chunks = Array.from({ length: 40 }, (_, i) => ({ sequence: i + 1, stream: 'stdout' as const, text: '\u0001'.repeat(4096) }));
  const page = selectProcessSnapshotChunks(chunks, 0, 80000);
  assert.ok(page.length > 0 && page.length < chunks.length);
  assert.ok(JSON.stringify(page).length <= 80001);
  assert.deepEqual(selectProcessSnapshotChunks(chunks, 0, Number.MAX_SAFE_INTEGER), chunks);
  assert.deepEqual(selectProcessSnapshotChunks(chunks, page.at(-1)!.sequence, 80000)[0], chunks[page.length]);
});

test('real process pages preserve escaped output and terminal exit metadata', { timeout: 10000 }, async () => {
  const session = new ManagedProcessSession({ command: process.execPath, args: ['-e', "process.stdout.write(String.fromCharCode(1).repeat(100000))"],
    cwd: process.cwd(), env: process.env, timeoutMs: 5000, tty: false, outputCharacterLimit: 200000 });
  await session.ready(); const full = await session.waitForExit(); let cursor = 0, text = '';
  assert.equal(full.exitCode, 0);
  for (;;) {
    const page = session.snapshot(cursor, 80000); assert.ok(JSON.stringify(page).length < 120000);
    assert.equal(page.running, false); assert.equal(page.exitCode, 0); assert.equal(page.truncated, false);
    text += page.chunks.map(c => c.text).join(''); assert.ok(page.nextSequence >= cursor); cursor = page.nextSequence;
    if (!page.hasMore) break; assert.ok(page.chunks.length > 0);
  }
  assert.equal(text, '\u0001'.repeat(100000));
});

test('termination returns a bounded success acknowledgement and leaves remaining output readable', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nm-terminate-output-'));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: directory, checkpointRoot: join(directory, '.checkpoints'), permissionMode: 'full_access' });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  let ready!: () => void; const outputReady = new Promise<void>(resolve => { ready = resolve; }); let output = 0;
  try {
    const started = await tools.execute({ id: 'start-output', name: 'process.start', arguments: { command: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(200000));setInterval(()=>{},1000)"], tty: false } }, 'full_access',
      { runId: 'terminate-output', onOutput: chunk => { output += chunk.text.length; if (output >= 200000) ready(); } });
    assert.equal(started.ok, true); await outputReady;
    const processId = (started.output as { processId: string }).processId;
    const terminated = await tools.execute({ id: 'stop-output', name: 'process.terminate', arguments: { processId } }, 'full_access', { runId: 'terminate-output' });
    assert.equal(terminated.ok, true); assert.ok(JSON.stringify(terminated.output).length < 120000);
    const page = terminated.output as { nextSequence: number; hasMore: boolean; running: boolean };
    assert.equal(page.running, false); assert.equal(page.hasMore, true);
    const followup = await tools.execute({ id: 'read-stopped', name: 'process.read', arguments: { processId, afterSequence: page.nextSequence, waitMs: 0 } }, 'full_access', { runId: 'terminate-output' });
    assert.equal(followup.ok, true); assert.ok((followup.output as { nextSequence: number }).nextSequence > page.nextSequence);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});
