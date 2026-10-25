import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, WorkspaceToolRuntime, createAgentTaskContext, type AgentModelMessage } from '../lib/index.js';
import { toolOutputSpillDirectory } from '../lib/tool-output-spill.js';

// A tool result over 30,000 characters is saved whole and the model is pointed to the file. That file must be one the
// model can actually read back with the named tool, in a read-only run too, and it must not land in the user's project.

test('a long tool result is saved where the model can read it back, outside the project', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-spill-run-')));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(dir, '..', `${dir.split(sep).pop()}-checkpoints`), permissionMode: 'read_only' });
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  const tools = new AgentToolRegistry();
  runtime.registerTools(tools);
  const lines = Array.from({ length: 4_000 }, (_, index) => `line ${index} ${'x'.repeat(8)}`).join('\n');
  tools.register({ name: 'fixture.big', description: 'Returns a long text', source: 'builtin', requiredPermission: 'read_only', inputSchema: { type: 'object' } },
    async () => ({ modelOutput: lines, summary: { title: 'Long output' } }));
  const seen: AgentModelMessage[][] = [];
  let spillPath = '';
  const runner = new AgentRunner({ tools, permissionMode: 'read_only', allowedToolNames: ['fixture.big', 'workspace.read_file'],
    taskContext: createAgentTaskContext({ workspaceRoot: dir, goal: 'Inspect the long output', permissionMode: 'read_only', allowedToolNames: ['fixture.big', 'workspace.read_file'] }),
    model: { async complete(request) {
      seen.push([...request.messages]);
      if (seen.length === 1) return { toolCalls: [{ id: 'big-1', name: 'fixture.big', arguments: {} }] };
      if (seen.length === 2) {
        const result = request.messages.at(-1)!.content;
        spillPath = /saved to (\S+?)\. Read the parts/.exec(result)?.[1] || '';
        return { toolCalls: [{ id: 'read-1', name: 'workspace.read_file', arguments: { path: spillPath, startLine: 1, endLine: 3 } }] };
      }
      return { content: 'done' };
    } } });
  const result = await runner.run({ prompt: 'Inspect the long output', runId: 'run-spill-readback-001' });
  assert.equal(result.status, 'completed');
  assert.ok(spillPath, 'the tool result names the saved file');
  assert.ok(spillPath.startsWith(toolOutputSpillDirectory(dir)), `saved in the app's folder: ${spillPath}`);
  assert.ok(!spillPath.startsWith(dir), 'nothing is written into the project');
  assert.ok((await readFile(spillPath, 'utf8')).includes('line 3999'), 'the file holds the whole result');
  const readBack = seen[2]!.at(-1)!.content;
  assert.match(readBack, /"ok":true/, `the model can read the file back: ${readBack.slice(0, 300)}`);
  assert.match(readBack, /line 0 x/);
});

test('a large attached document is saved in its conversation\'s private folder and read in parts there only', async t => {
  const { saveAttachmentDocument, attachmentDocumentDirectory, ATTACHMENT_DOCUMENT_KEEP } = await import('../lib/index.js');
  const { stat, readdir, mkdir } = await import('node:fs/promises');
  const conversationA = `conversation-a-${process.pid}-${Date.now()}`;
  const conversationB = `conversation-b-${process.pid}-${Date.now()}`;
  t.after(async () => {
    await rm(attachmentDocumentDirectory(conversationA), { recursive: true, force: true });
    await rm(attachmentDocumentDirectory(conversationB), { recursive: true, force: true });
  });
  const text = Array.from({ length: 3_000 }, (_, index) => index === 2_400 ? 'Clause 7.2: the deposit is refundable within 30 days.' : `Line ${index + 1} ${'lorem '.repeat(8)}`).join('\n');
  const saved = saveAttachmentDocument(conversationA, '合同 v2 (final).pdf', text)!;
  assert.ok(saved, 'saved');
  assert.equal(saved.lines, 3_000);
  assert.equal(saved.characters, text.length);
  assert.ok(saved.path.startsWith(attachmentDocumentDirectory(conversationA) + sep), saved.path);
  assert.match(saved.path.split(sep).pop()!, /^合同-v2-final-[0-9a-f]{12}\.md$/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
    assert.equal((await stat(attachmentDocumentDirectory(conversationA))).mode & 0o777, 0o700);
  }
  assert.equal(saveAttachmentDocument(conversationA, '合同 v2 (final).pdf', text)!.path, saved.path, 'the same text keeps its path');

  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-doc-run-')));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const run = async (conversationId: string, calls: readonly { name: string; arguments: Record<string, unknown> }[]) => {
    const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: dir, checkpointRoot: join(dir, '..', `${dir.split(sep).pop()}-checkpoints`), permissionMode: 'read_only' });
    t.after(() => runtime.dispose());
    const tools = new AgentToolRegistry();
    runtime.registerTools(tools);
    const allowedToolNames = ['workspace.read_file', 'workspace.search_text'];
    const results: string[] = [];
    let step = 0;
    const runner = new AgentRunner({ tools, permissionMode: 'read_only', allowedToolNames,
      taskContext: createAgentTaskContext({ workspaceRoot: dir, conversationId, goal: 'Answer from the document', permissionMode: 'read_only', allowedToolNames }),
      model: { async complete(request) {
        if (step > 0) results.push(request.messages.at(-1)!.content);
        const call = calls[step++];
        return call ? { toolCalls: [{ id: `call-${step}`, ...call }] } : { content: 'done' };
      } } });
    const result = await runner.run({ prompt: 'Answer from the document', runId: `run-doc-${conversationId.slice(-12)}-${calls.length}` });
    assert.equal(result.status, 'completed');
    return results;
  };
  const [range, found, wholeRange] = await run(conversationA, [
    { name: 'workspace.read_file', arguments: { path: saved.path, startLine: 2_399, endLine: 2_402 } },
    { name: 'workspace.search_text', arguments: { query: 'deposit is refundable', path: saved.path } },
    { name: 'workspace.read_file', arguments: { path: saved.path, startLine: 1, endLine: 2_000 } },
  ]);
  assert.match(range, /"ok":true/, range.slice(0, 300));
  assert.match(range, /Clause 7\.2/);
  assert.match(found, /"ok":true/, found.slice(0, 300));
  assert.match(found, /Clause 7\.2/);
  assert.doesNotMatch(wholeRange, /saved to .*nextmux-tool-output[^"]*\.txt/, 'reading the document is not spilled into another file');
  const [other] = await run(conversationB, [{ name: 'workspace.read_file', arguments: { path: saved.path, startLine: 1, endLine: 3 } }]);
  assert.match(other, /"ok":false/, 'another conversation cannot read it');
  assert.match(other, /PATH_OUTSIDE_WORKSPACE/);

  // Only the newest documents are kept; a folder in there is left alone.
  await mkdir(join(attachmentDocumentDirectory(conversationB), 'nested'), { recursive: true, mode: 0o700 });
  for (let index = 0; index < ATTACHMENT_DOCUMENT_KEEP + 3; index += 1) saveAttachmentDocument(conversationB, `doc ${index}.txt`, `text ${index}`);
  const names = await readdir(attachmentDocumentDirectory(conversationB));
  assert.equal(names.filter(name => name.endsWith('.md')).length, ATTACHMENT_DOCUMENT_KEEP);
  assert.ok(names.includes('nested'));
});
