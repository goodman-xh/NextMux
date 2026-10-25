import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, SUPERSEDED_READ_FILE_NOTICE, continuationOverlap, deduplicateSupersededReadFileMessages, rebaseAgentRunCheckpoint, stitchContinuedText, stripContinuationMetaPreamble, summarizeTitle, type AgentModelClient, type AgentModelRequest, type AgentRunEvent } from '../lib/index.js';
import { buildAgentContinuityMemory, compactOversizedMessages } from '../lib/context-memory.js';

const deltasOf = (events: readonly AgentRunEvent[]): string => events
  .flatMap(event => event.type === 'assistant_delta' ? [event.delta] : []).join('');
const shape = (request: AgentModelRequest) => request.messages.map(message => ({ role: message.role, content: message.content }));

test('the seam of a continued reply drops only a real restatement of its last words', () => {
  assert.equal(continuationOverlap('Hello world, ', 'world, how are you?'), 7);
  assert.deepEqual(stitchContinuedText('Hello world, ', 'world, how are you?'), { stitched: 'Hello world, how are you?', appendedDelta: 'how are you?' });
  // Short coincidences are ordinary text, never a repeat.
  assert.equal(continuationOverlap('a banana', 'a fruit'), 0);
  assert.equal(stitchContinuedText('Part one\n  ', 'Part two').stitched, 'Part one\n  Part two');
});

test('a reply streaming when its connection drops continues from its last shown character on the same turn', async () => {
  const requests: ReturnType<typeof shape>[] = [];
  const events: AgentRunEvent[] = [];
  let calls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      calls += 1;
      requests.push(shape(request));
      if (calls === 1) {
        await request.onTextDelta?.('Hello world, ');
        throw Object.assign(new Error('The model stream ended early'), { code: 'INCOMPLETE_STREAM', providerAccepted: true, partial: true });
      }
      await request.onTextDelta?.('world, how are you?');
      return { content: 'world, how are you?', finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 4 } };
    },
  };
  const result = await new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only', onEvent: event => { events.push(event); } })
    .run({ prompt: 'Greet me', runId: 'run-stream-resume-0001' });
  assert.equal(result.status, 'completed');
  assert.equal(result.turns, 1);
  assert.equal(result.finalText, 'Hello world, how are you?');
  assert.deepEqual(requests[1].at(-2), { role: 'assistant', content: 'Hello world, ' });
  assert.match(requests[1].at(-1)!.content, /^Runtime notice: Your reply was interrupted mid-stream/);
  assert.equal(deltasOf(events), 'Hello world, how are you?', 'only the new suffix is streamed after the drop');
  assert.ok(events.every(event => event.type !== 'assistant_delta' || event.turn === 1));
  assert.equal(events.filter(event => event.type === 'model_retry_scheduled').length, 1);
});

test('a reply cut by a Cloudflare 520-524 or a stream break the model client recognized continues in place', async () => {
  const cases: readonly Record<string, unknown>[] = [
    { status: 520 }, { status: 521 }, { status: 522 }, { status: 523 }, { httpStatus: 524 }, { statusCode: 502 },
    { code: 'MODEL_CALL_FAILED', readableError: { kind: 'stream_interrupted', code: 'stream_cut' } },
    { code: 'MODEL_CALL_FAILED', readableError: { kind: 'network', code: 'econnreset' } },
  ];
  for (const [index, fields] of cases.entries()) {
    let calls = 0;
    const model: AgentModelClient = {
      async complete(request) {
        calls += 1;
        if (calls === 1) {
          await request.onTextDelta?.('Hello world, ');
          throw Object.assign(new Error('Upstream connection dropped'), { providerAccepted: true, partial: true }, fields);
        }
        await request.onTextDelta?.('how are you?');
        return { content: 'how are you?', finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 4 } };
      },
    };
    const result = await new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only' })
      .run({ prompt: 'Greet me', runId: `run-stream-cf-resume-00${index + 1}` });
    assert.equal(result.status, 'completed', `case ${index}`);
    assert.equal(calls, 2, `case ${index}: one continuation`);
    assert.equal(result.finalText, 'Hello world, how are you?', `case ${index}`);
  }
});

test('a 5xx that is really a billing review or a stopped run is never continued', async () => {
  const cases: readonly Record<string, unknown>[] = [
    { status: 503, code: 'billing_review_required' },
    { status: 524, code: 'INCOMPLETE_STREAM', recoveryMode: 'billing_only' },
    { status: 520, code: 'CANCELLED' },
    { code: 'MODEL_CALL_FAILED', readableError: { kind: 'stream_interrupted', code: 'insufficient_balance' } },
  ];
  for (const [index, fields] of cases.entries()) {
    let calls = 0;
    const model: AgentModelClient = {
      async complete(request) {
        calls += 1;
        await request.onTextDelta?.('Partial reply ');
        throw Object.assign(new Error('stream ended early'), { providerAccepted: true }, fields);
      },
    };
    await assert.rejects(new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only' })
      .run({ prompt: 'Write', runId: `run-stream-cf-stop-00${index + 1}` }));
    assert.equal(calls, 1, `case ${index}: not continued`);
  }
});

test('a reply that had started a tool call is not continued from its text', async () => {
  let calls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      calls += 1;
      await request.onTextDelta?.('Checking the files first. ');
      await request.onProviderEvent?.({ type: 'tool_call.started', callId: 'call-1' });
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', providerAccepted: true });
    },
  };
  await assert.rejects(new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only' })
    .run({ prompt: 'Inspect', runId: 'run-stream-resume-0002' }), error => (error as { code?: string }).code === 'ECONNRESET');
  assert.equal(calls, 1);
});

test('a checkpoint kept after a dropped reply resumes it in place', async () => {
  const failing: AgentModelClient = {
    async complete(request) {
      await request.onTextDelta?.('第一部分已经写完，');
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET', providerAccepted: true });
    },
  };
  let checkpoint;
  await assert.rejects(new AgentRunner({ model: failing, tools: new AgentToolRegistry(), permissionMode: 'read_only' })
    .run({ prompt: '写一段说明', runId: 'run-stream-resume-0003' }), error => { checkpoint = (error as { checkpoint: unknown }).checkpoint; return true; });
  const seen: ReturnType<typeof shape>[] = [];
  const resumed = await new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: 'read_only',
    model: { async complete(request) { seen.push(shape(request)); return { content: '第二部分在这里。', finishReason: 'stop' }; } },
  }).run({ prompt: '写一段说明', runId: 'run-stream-resume-0003', checkpoint });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.finalText, '第一部分已经写完，第二部分在这里。');
  assert.equal(seen[0].at(-2)?.content, '第一部分已经写完，');
});

test('a reply cut off by the output limit continues without repeating its last words', async () => {
  const events: AgentRunEvent[] = [];
  let calls = 0;
  const model: AgentModelClient = {
    async complete(request) {
      calls += 1;
      if (calls === 1) {
        await request.onTextDelta?.('The migration keeps every row and ');
        return { content: 'The migration keeps every row and ', finishReason: 'length' };
      }
      await request.onTextDelta?.('every row and rebuilds the index.');
      return { content: 'every row and rebuilds the index.', finishReason: 'stop' };
    },
  };
  const result = await new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only', captureCheckpoint: true, onEvent: event => { events.push(event); } })
    .run({ prompt: 'Explain the migration', runId: 'run-length-seam-0001' });
  assert.equal(result.finalText, 'The migration keeps every row and rebuilds the index.');
  assert.equal(deltasOf(events), result.finalText);
  assert.deepEqual(result.checkpoint?.messages.map(message => message.role), ['user', 'assistant']);
});

test('a conversation from a 1M-token window is re-compacted to fit a 128k model instead of failing', async () => {
  const tools = new AgentToolRegistry();
  tools.register({ name: 'test.read', description: 'Read fixture', inputSchema: { type: 'object' }, requiredPermission: 'read_only', source: 'builtin' },
    async () => ({ modelOutput: { ok: true }, summary: { title: 'Read fixture' } }));
  let window = 1_000_000;
  const requests: ReturnType<typeof shape>[] = [];
  const goal = 'ORIGINAL_GOAL_MARKER: keep the public API stable.';
  const model: AgentModelClient = {
    async complete(request) {
      requests.push(shape(request));
      if (requests.length === 1) {
        // Written for the large window: a huge explanation beside the tool call.
        window = 128_000;
        return { content: `Plan: ${'analysis '.repeat(60_000)}END_OF_ANALYSIS`, toolCalls: [{ id: 'call-read-1', name: 'test.read', arguments: {} }] };
      }
      return { content: 'Done on the smaller model.', finishReason: 'stop' };
    },
  };
  const result = await new AgentRunner({ model, tools, permissionMode: 'read_only', getContextLimits: () => ({ contextWindowTokens: window }) })
    .run({ prompt: 'LATEST_PROMPT finish the task', runId: 'run-window-shrink-0001',
      history: [{ role: 'user', content: `${goal} ${'context '.repeat(2_000)}` }, { role: 'assistant', content: `${'notes '.repeat(3_000)}` }] });
  assert.equal(result.status, 'completed', result.stopReason);
  assert.equal(result.finalText, 'Done on the smaller model.');
  const second = requests[1];
  assert.ok(second.every(message => message.content.length <= 40_000), 'no message keeps its 1M-window size');
  assert.ok(second.reduce((sum, message) => sum + message.content.length, 0) < 128_000 * 2);
  const all = second.map(message => message.content).join('\n');
  assert.equal(all.split('LATEST_PROMPT finish the task').length - 1, 1, 'the current request appears exactly once');
  assert.match(all, /ORIGINAL_GOAL_MARKER/, 'the original goal survives in memory');
  assert.match(all, /END_OF_ANALYSIS/, 'the condensed reply keeps its tail');
});

test('first-turn compaction of a long history never repeats the request it keeps', async () => {
  const requests: ReturnType<typeof shape>[] = [];
  const history = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `OLD_${index} ${'x '.repeat(3_000)}` }));
  await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 32_000,
    model: { async complete(request) { requests.push(shape(request)); return { content: 'ok', finishReason: 'stop' }; } } })
    .run({ prompt: 'ONLY_ONCE_PROMPT answer briefly', runId: 'run-anchor-once-0001', history });
  const all = requests[0].map(message => message.content).join('\n');
  assert.equal(all.split('ONLY_ONCE_PROMPT').length - 1, 1);
  assert.match(requests[0][0].content, /^NEXTMUX_CONTINUITY_V1\n/);
});

test('continuity memory rebuilt for a smaller budget keeps the first goal and one line per file', () => {
  const messages = [
    { role: 'user' as const, content: `FIRST_GOAL ${'constraint '.repeat(400)}` },
    ...[1, 2, 3].flatMap(index => [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: `read-${index}`, name: 'fs.read_file', arguments: { path: 'src/a.ts' } }] },
      { role: 'tool' as const, toolCallId: `read-${index}`, content: JSON.stringify({ ok: true, output: { path: 'src/a.ts', sha256: `${index}`.repeat(64) } }) },
    ]),
    { role: 'user' as const, content: 'Runtime notice: Your reply was cut off by the output limit; continue exactly where you stopped.' },
    { role: 'user' as const, content: 'LATEST_GOAL fix the build' },
  ];
  const large = buildAgentContinuityMemory(messages, undefined, 16_000);
  const parsed = JSON.parse(large.content.slice('NEXTMUX_CONTINUITY_V1\n'.length));
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0], `fs.read_file read-3: src/a.ts sha256=${'3'.repeat(64)}`);
  assert.equal(parsed.goals.some((goal: string) => goal.startsWith('Runtime notice')), false);
  const small = buildAgentContinuityMemory([large], undefined, 1_500);
  assert.ok(small.content.length <= 1_500);
  const goals = JSON.parse(small.content.slice('NEXTMUX_CONTINUITY_V1\n'.length)).goals as string[];
  assert.match(goals[0], /^FIRST_GOAL/);
  assert.ok(goals.some(goal => goal.startsWith('LATEST_GOAL')));
});

test('oversized history messages are bounded, the request being answered stays whole', () => {
  const huge = `HEAD ${'a'.repeat(50_000)}\n## Result\nsrc/feature/file.ts failed\n${'b'.repeat(50_000)} TAIL`;
  const out = compactOversizedMessages([
    { role: 'user', content: huge },
    { role: 'assistant', content: huge, toolCalls: [{ id: 'w1', name: 'fs.write_file', arguments: { path: 'x.ts', content: 'c'.repeat(60_000) } }] },
    { role: 'tool', toolCallId: 'w1', content: JSON.stringify({ ok: true, output: { path: 'x.ts', text: 'd'.repeat(60_000) } }) },
    { role: 'user', content: `CURRENT ${'e'.repeat(30_000)}` },
  ], 4_000, { taskAnchorChars: Number.POSITIVE_INFINITY });
  assert.ok(out[0].content.length <= 4_000 && out[0].content.startsWith('HEAD') && out[0].content.endsWith('TAIL'));
  assert.match(out[0].content, /src\/feature\/file\.ts failed/);
  assert.ok(JSON.stringify(out[1].toolCalls).length < 6_000 && out[1].toolCalls?.[0].id === 'w1');
  assert.equal(out[2].toolCallId, 'w1');
  assert.ok(out[2].content.length <= 4_400);
  assert.equal(out[3].content.length, 30_008, 'the latest request is untouched');
  const foldedAnchor = `CURRENT TASK SCOPE — Original user goal: ${'preserve_exact_constraint '.repeat(300)}`;
  const compactedScope = compactOversizedMessages([
    { role: 'user', content: foldedAnchor },
    { role: 'assistant', content: huge },
  ], 1_200, { taskAnchorChars: Number.POSITIVE_INFINITY });
  assert.equal(compactedScope[0].content, foldedAnchor, 'TASK_SCOPE_PREFIX anchor retains taskAnchorChars when original user message was compacted');
  assert.ok(compactedScope[1].content.length <= 1_200);
});

test('mid-stream balance or billing exhaustion never triggers streamResume or marks failure retryable', async () => {
  const cases: readonly Record<string, unknown>[] = [
    { code: 'INCOMPLETE_STREAM', httpStatus: 402, retryable: true },
    { code: 'STREAM_INTERRUPTED', readableError: { kind: 'balance_insufficient', code: 'insufficient_balance' }, retryable: true },
    { code: 'ECONNRESET', message: 'stream closed early due to insufficient_balance (余额不足)' },
    { code: 'INCOMPLETE_STREAM', details: { code: 'PAYMENT_REQUIRED' } },
  ];
  for (const [index, fields] of cases.entries()) {
    let calls = 0;
    const events: AgentRunEvent[] = [];
    const model: AgentModelClient = {
      async complete(request) {
        calls++;
        await request.onTextDelta?.('Partial output before wallet balance ran out.');
        throw Object.assign(new Error(String(fields.message ?? 'stream ended early')), fields);
      },
    };
    const runner = new AgentRunner({ model, tools: new AgentToolRegistry(), permissionMode: 'read_only', onEvent: event => { events.push(event); } });
    await assert.rejects(
      runner.run({ prompt: 'Write a module', runId: `run-balance-stop-000${index + 1}` }),
      (err: unknown) => {
        const record = err as Record<string, unknown>;
        assert.ok(record);
        return true;
      },
    );
    assert.equal(calls, 1, `case ${index}: must not retry or streamResume on balance exhaustion`);
    const retryEvents = events.filter(event => event.type === 'model_retry_scheduled');
    assert.equal(retryEvents.length, 0, `case ${index}: no model_retry_scheduled event`);
    const attemptFailed = events.find(event => event.type === 'model_attempt_completed' && event.outcome === 'failed');
    assert.ok(attemptFailed && attemptFailed.type === 'model_attempt_completed');
    assert.equal(attemptFailed.failure?.retryable, false, `case ${index}: failure.retryable must be false`);
  }
});

test('stripContinuationMetaPreamble and stitchContinuedText remove continuation meta-commentary and duplicate reopened code fences', () => {
  assert.equal(
    stitchContinuedText('第一段内容，', '继续：\n第二段内容。').stitched,
    '第一段内容，第二段内容。',
  );
  assert.equal(
    stitchContinuedText('第一段内容，', '接上文：第一段内容，第二段内容。').stitched,
    '第一段内容，第二段内容。',
  );
  assert.equal(
    stitchContinuedText('Here is the first part, ', 'Continuing from where I left off:\nthe first part, and the second part.').stitched,
    'Here is the first part, and the second part.',
  );
  // Legitimate prose starting with "继续推进" without a meta-preamble delimiter is untouched.
  assert.equal(
    stitchContinuedText('我们需要', '继续推进这个项目。').stitched,
    '我们需要继续推进这个项目。',
  );
  // Duplicate reopened code fence inside an already-open code block is stripped cleanly.
  const openFencePrefix = 'Here is the implementation:\n```ts\nexport const a = 1;\n';
  const reopenedContinuation = '```ts\nexport const b = 2;\n```';
  assert.equal(
     stripContinuationMetaPreamble(openFencePrefix, reopenedContinuation),
    'export const b = 2;\n```',
  );
  assert.equal(
    stitchContinuedText(openFencePrefix, `继续输出：\n${reopenedContinuation}`).stitched,
    'Here is the implementation:\n```ts\nexport const a = 1;\nexport const b = 2;\n```',
  );
});

test('summarizeTitle strips pasted_file, Attached, and App control tags before extracting the title', () => {
  const prompt = '[App: Chrome (com.google.Chrome)] [Attached image: screen.png] <pasted_file name="log.txt">ERROR line 1\nERROR line 2</pasted_file> Fix the login redirect loop in auth.ts';
  assert.equal(summarizeTitle(prompt), 'Fix the login redirect loop in auth.ts');
});

test('system-continuation prompts do not pollute continuity memory goals or rebased taskAnchor', () => {
  const memory = buildAgentContinuityMemory([
    { role: 'user', content: 'Implement seamless continuation' },
    { role: 'assistant', content: 'Working on it.' },
    { role: 'user', content: '<system-continuation>Continue the task seamlessly from the current state.</system-continuation>' },
  ], undefined, 8_000);
  const parsed = JSON.parse(memory.content.slice('NEXTMUX_CONTINUITY_V1\n'.length));
  assert.equal(parsed.goals.some((g: string) => g.includes('system-continuation')), false);

  const rebased = rebaseAgentRunCheckpoint({
    version: 1,
    runId: 'run-seamless-anchor-0001',
    nextTurn: 2,
    segment: 1,
    messages: [
      { role: 'user', content: 'Original user goal' },
      { role: 'assistant', content: 'Partial progress' },
    ],
    taskAnchor: { role: 'user', content: 'Original user goal' },
    seenToolCallIds: [],
    toolCalls: 0,
    repeatedToolBatchTurns: 0,
    usage: { inputTokens: 10, outputTokens: 10 },
    createdAt: new Date().toISOString(),
  }, {
    runId: 'run-seamless-anchor-0002',
    direction: '<system-continuation>Continue the task seamlessly from the current state.</system-continuation>',
  });
  assert.equal(rebased.taskAnchor?.content, 'Original user goal');
});

test('deduplicateSupersededReadFileMessages replaces older workspace.read_file content and omits stale sha256 while preserving latest read', () => {
  const messages = [
    { role: 'user' as const, content: 'Read and update src/app.ts' },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'read-1', name: 'workspace.read_file', arguments: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'read-1',
      content: JSON.stringify({
        ok: true,
        output: {
          path: 'src/app.ts',
          content: 'export const v = 1;\n'.repeat(100),
          startLine: 1,
          endLine: 100,
          totalLines: 100,
          sha256: 'stale-sha-111',
          truncated: false,
        },
      }),
    },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'read-2', name: 'workspace.read_file', arguments: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'read-2',
      content: JSON.stringify({
        ok: true,
        output: {
          path: 'src/app.ts',
          content: 'export const v = 2;\n',
          startLine: 1,
          endLine: 80,
          totalLines: 80,
          sha256: 'fresh-sha-222',
          truncated: false,
        },
      }),
    },
  ];
  const deduped = deduplicateSupersededReadFileMessages(messages);
  const firstTool = JSON.parse(deduped[2].content);
  const secondTool = JSON.parse(deduped[4].content);
  assert.equal(firstTool.output.content, SUPERSEDED_READ_FILE_NOTICE);
  assert.equal(firstTool.output.superseded, true);
  assert.equal(firstTool.output.sha256, undefined);
  assert.equal(firstTool.output.path, 'src/app.ts');
  assert.equal(firstTool.output.startLine, 1);
  assert.equal(firstTool.output.endLine, 100);
  assert.equal(firstTool.output.totalLines, 100);
  assert.equal(secondTool.output.content, 'export const v = 2;\n');
  assert.equal(secondTool.output.sha256, 'fresh-sha-222');

  // Also normalizes './src/app.ts' and supersedes full-file reads overwritten by workspace.write_file.
  const writeMessages = [
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'read-dot', name: 'workspace.read_file', arguments: { path: './src//app.ts' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'read-dot',
      content: JSON.stringify({
        ok: true,
        output: {
          path: './src//app.ts',
          content: 'export const old = true;\n',
          startLine: 1,
          endLine: 10,
          totalLines: 10,
          sha256: 'sha-before-write',
          truncated: false,
        },
      }),
    },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'write-1', name: 'workspace.write_file', arguments: { path: 'src/app.ts', content: 'export const updated = true;\n' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'write-1',
      content: JSON.stringify({
        ok: true,
        output: {
          path: 'src/app.ts',
          sha256: 'sha-after-write',
        },
      }),
    },
  ];
  const dedupedAfterWrite = deduplicateSupersededReadFileMessages(writeMessages);
  const supersededRead = JSON.parse(dedupedAfterWrite[1].content);
  assert.equal(supersededRead.output.content, SUPERSEDED_READ_FILE_NOTICE);
  assert.equal(supersededRead.output.superseded, true);
  assert.equal(supersededRead.output.sha256, undefined);

  // A truncated later read (e.g. startLine: 1, endLine: 2000, truncated: true) must NOT supersede an earlier un-truncated range read.
  const truncatedMessages = [
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'read-range', name: 'workspace.read_file', arguments: { path: './/src/app.ts' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'read-range',
      content: JSON.stringify({
        ok: true,
        output: {
          path: './/src/app.ts',
          content: 'export const mid = 42;\n',
          startLine: 1000,
          endLine: 1100,
          totalLines: 2000,
          sha256: 'range-sha',
          truncated: false,
        },
      }),
    },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'read-trunc', name: 'workspace.read_file', arguments: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool' as const,
      toolCallId: 'read-trunc',
      content: JSON.stringify({
        ok: true,
        output: {
          path: 'src/app.ts',
          content: 'export const head = 1;\n',
          startLine: 1,
          endLine: 2000,
          totalLines: 2000,
          sha256: 'trunc-sha',
          truncated: true,
        },
      }),
    },
  ];
  const afterTruncated = deduplicateSupersededReadFileMessages(truncatedMessages);
  assert.equal(JSON.parse(afterTruncated[1].content).output.content, 'export const mid = 42;\n');
  assert.equal(JSON.parse(afterTruncated[1].content).output.superseded, undefined);

  // However, an un-truncated read of the same file with ".//src/app.ts" vs "src/app.ts" DOES supersede it.
  const untruncatedMessages = [
    ...truncatedMessages.slice(0, 3),
    {
      role: 'tool' as const,
      toolCallId: 'read-trunc',
      content: JSON.stringify({
        ok: true,
        output: {
          path: 'src/app.ts',
          content: 'export const full = 1;\n',
          startLine: 1,
          endLine: 2000,
          totalLines: 2000,
          sha256: 'full-sha',
          truncated: false,
        },
      }),
    },
  ];
  const afterUntruncated = deduplicateSupersededReadFileMessages(untruncatedMessages);
  assert.equal(JSON.parse(afterUntruncated[1].content).output.content, SUPERSEDED_READ_FILE_NOTICE);
  assert.equal(JSON.parse(afterUntruncated[1].content).output.superseded, true);
});
