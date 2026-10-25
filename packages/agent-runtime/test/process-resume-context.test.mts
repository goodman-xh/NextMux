import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentRunner, AgentRunPauseError, AgentToolRegistry, WorkspaceToolRuntime,
  rebaseAgentRunCheckpoint, retryAgentRunCheckpoint, type AgentModelRequest,
  type AgentModelMessage, type AgentRunCheckpoint } from '../lib/index.js';

const notice = 'PROCESS CONTEXT AFTER CROSS-RUN RESUME:';
const oldRun = 'run-process-before-pause';
const newRun = 'run-process-after-pause';
const oldId = 'proc-10000000-0000-0000-0000-000000000001';
function checkpoint(processHistory = true): AgentRunCheckpoint {
  return { version: 1, runId: oldRun, nextTurn: 2, segment: 1,
    messages: [{ role: 'user', content: 'Continue the server task' }, ...(processHistory ? [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'old-start', name: 'process.start', arguments: { command: 'server' } }] },
      { role: 'tool' as const, toolCallId: 'old-start', content: JSON.stringify({ ok: true, output: { processId: oldId, running: true } }) },
    ] : [])], seenToolCallIds: processHistory ? ['old-start'] : [], usage: { inputTokens: 0, outputTokens: 0 },
    toolCalls: processHistory ? 1 : 0, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString() };
}
function output(request: Pick<AgentModelRequest, 'messages'>, id: string): any {
  const message = request.messages.find(message => message.role === 'tool' && message.toolCallId === id);
  assert.ok(message, `missing result ${id}`);
  return JSON.parse(message.content);
}
async function instructions(saved?: AgentRunCheckpoint, history?: readonly AgentModelMessage[]) {
  let observed = '';
  await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', model: {
    async complete(request) { observed = request.instructions ?? ''; return { content: 'Done' }; },
  } }).run({ prompt: 'Continue', ...(saved ? { checkpoint: saved } : {}), ...(history ? { history } : {}) });
  return observed;
}

test('a real paused process is unavailable in the new run, which gets guidance and can read its own new process', { timeout: 15000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'nm-process-resume-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const first = await WorkspaceToolRuntime.create({ workspaceRoot: base, checkpointRoot: join(base, '.checkpoints'), permissionMode: 'full_access' });
  t.after(() => first.dispose());
  const firstTools = new AgentToolRegistry(); first.registerTools(firstTools);
  const controller = new AbortController();
  const paused = await new AgentRunner({ tools: firstTools, permissionMode: 'full_access', model: {
    async complete(request) {
      assert.equal(request.instructions?.includes(notice), false);
      return { toolCalls: [{ id: 'real-old-start', name: 'process.start', arguments: {
        command: process.execPath, tty: false, args: ['-e', "console.log('ready'); setInterval(()=>{},1000)"],
      } }] };
    },
  }, onEvent(event) {
    if (event.type === 'tool_completed' && event.callId === 'real-old-start') controller.abort(new AgentRunPauseError());
  } }).run({ prompt: 'Start the server then pause', runId: oldRun, signal: controller.signal });
  assert.equal(paused.status, 'paused');
  const saved = paused.checkpoint!;
  const previousId = output(saved, 'real-old-start').output.processId;
  await first.dispose();

  const second = await WorkspaceToolRuntime.create({ workspaceRoot: base, checkpointRoot: join(base, '.checkpoints'), permissionMode: 'full_access' });
  t.after(() => second.dispose());
  const secondTools = new AgentToolRegistry(); second.registerTools(secondTools);
  let turn = 0, currentId = '';
  const rebased = rebaseAgentRunCheckpoint(saved, { runId: newRun, direction: 'Resume the server task' });
  const result = await new AgentRunner({ tools: secondTools, permissionMode: 'full_access', captureCheckpoint: true, model: {
    async complete(request) {
      assert.equal(request.instructions?.split(notice).length, 2);
      assert.match(request.instructions!, /no process has been restarted by checkpoint restoration/);
      assert.match(request.instructions!, /ProcessIds started in the current run remain usable/);
      if (++turn === 1) return { toolCalls: [{ id: 'read-old', name: 'process.read', arguments: { processId: previousId } }] };
      if (turn === 2) {
        assert.equal(output(request, 'read-old').error.code, 'PROCESS_NOT_FOUND');
        return { toolCalls: [{ id: 'start-new', name: 'process.start', arguments: {
          command: process.execPath, tty: false, args: ['-e', "console.log('new-ready'); setInterval(()=>{},1000)"],
        } }] };
      }
      if (turn === 3) {
        const started = output(request, 'start-new'); assert.equal(started.ok, true);
        currentId = started.output.processId; assert.notEqual(currentId, previousId);
        return { toolCalls: [{ id: 'read-new', name: 'process.read', arguments: { processId: currentId, waitMs: 1000 } }] };
      }
      const read = output(request, 'read-new'); assert.equal(read.ok, true); assert.equal(read.output.processId, currentId);
      return { content: 'The new process can be read' };
    },
  } }).run({ prompt: 'Continue', checkpoint: rebased });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.checkpoint?.processResumeContext, { previousRunId: oldRun });
  assert.equal(result.checkpoint?.messages.some(message => message.content.includes(notice)), false);
});

test('fresh tasks, copied process history and cross-run checkpoints without process history get no resume notice', async () => {
  assert.equal((await instructions()).includes(notice), false);
  assert.equal((await instructions(undefined, [{ role: 'assistant', content: JSON.stringify(checkpoint().messages) }])).includes(notice), false);
  for (const saved of [rebaseAgentRunCheckpoint(checkpoint(false), { runId: newRun, direction: 'Continue' }),
    retryAgentRunCheckpoint(checkpoint(false), newRun)]) {
    assert.equal((await instructions(saved)).includes(notice), false);
  }
});

test('same-run checkpoint recovery and retargeting do not label that run\'s live handles as expired', { timeout: 15000 }, async t => {
  for (const saved of [checkpoint(), rebaseAgentRunCheckpoint(checkpoint(), { runId: oldRun, direction: 'Continue' }),
    retryAgentRunCheckpoint(checkpoint(), oldRun)]) {
    assert.equal((await instructions(saved)).includes(notice), false);
  }
  const base = await mkdtemp(join(tmpdir(), 'nm-same-run-process-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: base, checkpointRoot: join(base, '.checkpoints'), permissionMode: 'full_access' });
  t.after(() => runtime.dispose());
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  const started = await tools.execute({ id: 'same-runtime-start', name: 'process.start', arguments: {
    command: process.execPath, tty: false, args: ['-e', "console.log('same-run-ready'); setInterval(()=>{},1000)"],
  } }, 'full_access', { runId: oldRun });
  assert.equal(started.ok, true);
  const processId = (started.output as { processId: string }).processId;
  let turns = 0;
  const saved = checkpoint();
  const liveCheckpoint = { ...saved, messages: saved.messages.map(message => message.role === 'tool'
    ? { ...message, content: JSON.stringify({ ok: true, output: started.output }) } : message) };
  const result = await new AgentRunner({ tools, permissionMode: 'full_access', model: { async complete(request) {
    assert.equal(request.instructions?.includes(notice), false);
    if (++turns === 1) return { toolCalls: [{ id: 'same-run-read', name: 'process.read', arguments: { processId, waitMs: 1000 } }] };
    const read = output(request, 'same-run-read'); assert.equal(read.ok, true);
    assert.equal(read.output.processId, processId); assert.equal(read.output.running, true);
    return { content: 'Readable' };
  } } }).run({ prompt: 'Continue within the same runtime', checkpoint: liveCheckpoint });
  assert.equal(result.status, 'completed');
});

test('cross-run retry preserves one bounded marker through compaction and repeated continuation', async () => {
  const source = checkpoint();
  const long = { ...source, messages: [...source.messages, ...Array.from({ length: 80 }, (_, index) => ({
    role: 'assistant' as const, content: `Historical report ${index}: ${'x'.repeat(800)}`,
  }))] };
  let saved = rebaseAgentRunCheckpoint(long, { runId: newRun, direction: 'Continue' });
  assert.equal(saved.messages.some(message => message.toolCalls?.some(call => call.name === 'process.start')), false,
    'the process call is now in bounded continuity memory');
  for (let index = 0; index < 20; index++) {
    saved = index % 2 ? rebaseAgentRunCheckpoint(saved, { runId: `run-process-continuation-${index}`, direction: 'Continue' })
      : retryAgentRunCheckpoint(saved, `run-process-continuation-${index}`);
    const observed = await instructions(saved);
    assert.equal(observed.split(notice).length, 2);
    assert.equal(observed.includes('Historical report'), false, 'instructions must not duplicate tool history');
    assert.ok(JSON.stringify(saved.processResumeContext).length < 100);
    assert.equal(saved.messages.some(message => message.content.includes(notice)), false);
    assert.ok(JSON.stringify(saved.messages).length < 40_000, 'existing compaction remains bounded');
  }
});

test('invalid process lineage fails before reaching the model', async () => {
  for (const context of [{ previousRunId: oldRun }, { previousRunId: 'bad' }, { previousRunId: newRun, history: 'copied transcript' }]) {
    await assert.rejects(instructions({ ...checkpoint(), processResumeContext: context }), { code: 'INVALID_CHECKPOINT' });
  }
});
