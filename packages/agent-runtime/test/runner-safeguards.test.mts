import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDelegationRuntime, AgentRunInterruptedError, AgentRunner, AgentToolError, AgentToolRegistry,
  rebaseAgentRunCheckpoint, retryAgentRunCheckpoint, type AgentModelProviderEvent, type AgentRunCheckpoint } from '../lib/index.js';

const descriptor = (name: string) => ({ name, description: 'Safeguard fixture', inputSchema: { type: 'object' },
  requiredPermission: 'read_only' as const, source: 'builtin' as const });

test('changing error text and neighboring successes cannot hide identical failed calls', async () => {
  const tools = new AgentToolRegistry();
  let failures = 0, reads = 0, turns = 0;
  tools.register(descriptor('test.fail'), async () => { throw new AgentToolError('PATH_NOT_FOUND', `diagnostic ${++failures}`); });
  tools.register(descriptor('test.read'), async () => ({ modelOutput: { clock: ++reads }, summary: { title: 'Read' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    const turn = ++turns;
    return { toolCalls: [
      { id: `failure-${turn}`, name: 'test.fail', arguments: turn % 2 ? { path: 'missing', mode: 1 } : { mode: 1, path: 'missing' } },
      { id: `read-${turn}`, name: 'test.read', arguments: { turn } },
    ] };
  } } }).run({ prompt: 'Inspect a missing file', runId: 'run-changing-error-001' });
  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(result.turns, 8);
  assert.equal(failures, 8);
  assert.deepEqual(result.checkpoint?.repeatedToolFailures?.map(({ errorCode, count }) => ({ errorCode, count })), [{ errorCode: 'PATH_NOT_FOUND', count: 8 }]);
});

test('successful recovery clears that call failure streak', async () => {
  const tools = new AgentToolRegistry();
  let calls = 0, turns = 0;
  tools.register(descriptor('test.fail'), async () => {
    if (++calls !== 3) throw new AgentToolError('BUSY', `failure ${calls}`);
    return { modelOutput: { recovered: true }, summary: { title: 'Recovered' } };
  });
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    return { toolCalls: [{ id: `recover-${++turns}`, name: 'test.fail', arguments: { path: 'same' } }] };
  } } }).run({ prompt: 'Retry the busy fixture', runId: 'run-success-reset-001' });
  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(calls, 11, 'the success must allow eight new attempts');
});

test('free-form localized tool error codes still produce a valid retry checkpoint', async () => {
  const tools = new AgentToolRegistry();
  let calls = 0, turns = 0;
  tools.register(descriptor('test.fail'), async () => { throw new AgentToolError('文件 不可用', `diagnostic ${++calls}`); });
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    return { toolCalls: [{ id: `localized-${++turns}`, name: 'test.fail', arguments: { path: 'missing' } }] };
  } } }).run({ prompt: 'Retry a localized error', runId: 'run-localized-error-code' });
  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(calls, 8);
  assert.match(result.checkpoint!.repeatedToolFailures![0].errorCode, /^TOOL_ERROR_[A-F0-9]{16}$/);
  assert.equal(retryAgentRunCheckpoint(result.checkpoint!, 'run-localized-error-retry').repeatedToolFailures?.[0].count, 8);
});

test('nonzero process exits with varying diagnostics are failed calls', async () => {
  const tools = new AgentToolRegistry();
  let calls = 0, turns = 0;
  tools.register(descriptor('process.run'), async () => ({ modelOutput: { exitCode: 1, stdout: `FAIL at ${++calls}` }, summary: { title: 'Check failed' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    return { toolCalls: [{ id: `check-${++turns}`, name: 'process.run', arguments: { command: 'node', args: ['--test'] } }] };
  } } }).run({ prompt: 'Verify the project', runId: 'run-failed-process-001' });
  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(calls, 8);
});

test('actual file edits permit a failed project check to run again during repair', async () => {
  const tools = new AgentToolRegistry();
  let checks = 0, turns = 0;
  tools.register({ ...descriptor('workspace.write_file'), requiredPermission: 'workspace_write' }, async () => ({
    modelOutput: { edited: true }, summary: { title: 'Edit', resource: { kind: 'file', path: 'a.ts', action: 'updated' } },
  }));
  tools.register(descriptor('process.run'), async () => ({ modelOutput: { exitCode: ++checks <= 3 ? 1 : 0, stdout: `check ${checks}` }, summary: { title: 'Test' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'workspace_write', model: { async complete() {
    const turn = ++turns;
    return turn <= 4 ? { toolCalls: [
      { id: `edit-${turn}`, name: 'workspace.write_file', arguments: { path: 'a.ts', content: `repair ${turn}` } },
      { id: `check-${turn}`, name: 'process.run', arguments: { command: 'node', args: ['--test'] } },
    ] } : { content: 'Verified' };
  } } }).run({ prompt: 'Repair the project check', runId: 'run-repair-progress-001' });
  assert.equal(result.status, 'completed');
  assert.equal(checks, 4);
  assert.equal(result.verification?.status, 'passed');
});

test('failed-call protection survives interruption and retry, and explicit continuation resets it', async () => {
  const tools = new AgentToolRegistry();
  let failures = 0, turns = 0;
  tools.register(descriptor('test.fail'), async () => { throw new AgentToolError('MISSING', `attempt ${++failures}`); });
  let checkpoint: AgentRunCheckpoint | undefined;
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    if (++turns === 3) throw Object.assign(new Error('Disconnected'), { code: 'CONNECTION_FAILED' });
    return { toolCalls: [{ id: `before-${turns}`, name: 'test.fail', arguments: { path: 'missing' } }] };
  } } }).run({ prompt: 'Read a missing file', runId: 'run-failure-persist-001' }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    checkpoint = error.checkpoint;
    return true;
  });
  assert.equal(checkpoint?.repeatedToolFailures?.[0].count, 2);
  const retried = retryAgentRunCheckpoint(checkpoint!, 'run-failure-retry-001');
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() {
    return { toolCalls: [{ id: `after-connection-${++turns}`, name: 'test.fail', arguments: { path: 'missing' } }] };
  } } }).run({ prompt: 'Continue safely', checkpoint: retried });
  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(failures, 8);
  assert.equal(rebaseAgentRunCheckpoint(result.checkpoint!, { runId: 'run-fresh-direction-001', direction: 'Try after I repaired the environment' }).repeatedToolFailures, undefined);
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'read_only', model: { async complete() { assert.fail('invalid checkpoints must not reach the model'); } } })
    .run({ prompt: 'invalid', checkpoint: { ...retried, repeatedToolFailures: [{ signature: 'bad', errorCode: 'MISSING', count: 2 }] } }), { code: 'INVALID_CHECKPOINT' });
});

for (const mode of ['text', 'reasoning', 'tool'] as const) test(`${mode} streaming is aborted at the byte ceiling even when the adapter never settles`, async () => {
  let upstreamAborted = false;
  await assert.rejects(new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', maxModelOutputBytes: 1024,
    model: { async complete(request) {
      request.signal?.addEventListener('abort', () => { upstreamAborted = true; }, { once: true });
      if (mode === 'text') await request.onTextDelta?.('你'.repeat(342));
      else await request.onProviderEvent?.({ type: mode === 'reasoning' ? 'reasoning.delta' : 'tool_call.delta', itemId: 'output', delta: 'x'.repeat(1025) });
      return new Promise<never>(() => undefined);
    } },
  }).run({ prompt: 'Bound model output', runId: `run-byte-fuse-${mode}` }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    assert.equal(error.code, 'OUTPUT_TOO_LARGE');
    assert.equal(error.failure.retrySafe, false);
    assert.equal(error.checkpoint.nextTurn, 1);
    assert.equal(error.events.some(event => event.type === 'tool_started'), false);
    return true;
  });
  assert.equal(upstreamAborted, true);
});

test('non-streaming tool arguments cannot exceed the byte ceiling or execute a partial action', async () => {
  const tools = new AgentToolRegistry();
  let executed = false;
  tools.register(descriptor('test.write'), async () => { executed = true; return { modelOutput: {}, summary: { title: 'Write' } }; });
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'read_only', maxModelOutputBytes: 1024,
    model: { async complete() { return { toolCalls: [{ id: 'huge-args', name: 'test.write', arguments: { content: 'x'.repeat(1025) } }] }; } },
  }).run({ prompt: 'Do not execute oversized output', runId: 'run-aggregate-byte-fuse' }), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(executed, false);
});

test('oversized completed ordered text retains its reported paid usage', async () => {
  await assert.rejects(new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', maxModelOutputBytes: 1024, acceptOrderedOutput: true,
    model: { async complete() { return { outputParts: [{ type: 'text', text: 'x'.repeat(1025) }], usage: { inputTokens: 7, outputTokens: 400 } }; } },
  }).run({ prompt: 'Bound ordered text too', runId: 'run-ordered-byte-fuse' }), error => {
    assert.ok(error instanceof AgentRunInterruptedError);
    assert.equal(error.code, 'OUTPUT_TOO_LARGE');
    assert.deepEqual(error.checkpoint.usage, { inputTokens: 7, outputTokens: 400 });
    assert.equal(error.checkpoint.usageKnown, true);
    return true;
  });
});

test('the full 256-call budget and skipped final batch produce a valid continuation checkpoint', async () => {
  const tools = new AgentToolRegistry();
  let executions = 0, turns = 0;
  tools.register(descriptor('test.read'), async () => ({ modelOutput: { value: ++executions }, summary: { title: 'Read' } }));
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', maxToolCalls: 256, model: { async complete() {
    const turn = ++turns;
    return { toolCalls: Array.from({ length: turn <= 4 ? 63 : 64 }, (_, index) => ({
      id: `budget-${turn}-${index}`, name: 'test.read', arguments: { turn, index },
    })) };
  } } }).run({ prompt: 'Respect the full supported tool budget', runId: 'run-full-tool-budget' });
  assert.equal(result.stopReason, 'tool_call_limit_reached');
  assert.equal(executions, 256);
  assert.equal(result.checkpoint?.seenToolCallIds.length, 316);
  assert.ok(result.checkpoint!.messages.length > 256);
  assert.equal(retryAgentRunCheckpoint(result.checkpoint!, 'run-full-budget-retry').toolCalls, 256);
  assert.equal(rebaseAgentRunCheckpoint(result.checkpoint!, { runId: 'run-full-budget-new', direction: 'Continue after reviewing the limit' }).toolCalls, 0);
});

test('streaming keeps a model alive; once it falls silent the silence limit ends it, and late reasoning/routes/tools are ignored', async () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lateEvents: Promise<void>[] = [];
  let aborted = false;
  const start = Date.now();
  try {
    await assert.rejects(new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', modelTimeoutMs: 35,
      model: { async complete(request) {
        // 150 ms of output (far past the 35 ms limit) keeps it alive; then it goes silent.
        let sent = 0;
        timer = setInterval(() => { if (++sent <= 30) void request.onTextDelta?.('still streaming\n'); }, 5);
        request.signal?.addEventListener('abort', () => {
          aborted = true;
          clearInterval(timer);
          for (const event of [
            { type: 'provider_reasoning', visibility: 'visible', content: 'late summary', status: 'complete' },
            { type: 'route.switched', route: 'late route' },
            { type: 'tool_call.completed', toolCall: { id: 'late-tool', name: 'test.write', arguments: {} } },
          ] satisfies AgentModelProviderEvent[]) lateEvents.push(Promise.resolve(request.onProviderEvent?.(event)));
        }, { once: true });
        return new Promise<never>(() => undefined);
      } },
    }).run({ prompt: 'Bound endless streaming', runId: 'run-endless-stream-001' }), error => {
      assert.ok(error instanceof AgentRunInterruptedError);
      assert.equal(error.code, 'MODEL_TIMEOUT');
      assert.ok(error.events.some(event => event.type === 'assistant_delta'));
      assert.equal(error.events.some(event => event.type === 'provider_reasoning' || event.type === 'model_route_switched' || event.type === 'tool_started'), false);
      return true;
    });
    await Promise.all(lateEvents);
    assert.equal(aborted, true);
    assert.ok(Date.now() - start >= 150, 'not cut off while it was still streaming');
    assert.ok(Date.now() - start < 1500);
  } finally { if (timer) clearInterval(timer); }
});

test('a delegated child inherits the host model deadline', async () => {
  const tools = new AgentToolRegistry();
  new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only', modelTimeoutMs: 20,
    model: { async complete() { return new Promise<never>(() => undefined); } },
  }).register();
  const started = Date.now();
  const result = await tools.execute({ id: 'delegate-timeout', name: 'agent.delegate', arguments: { task: 'Review a fixture' } }, 'read_only', { runId: 'run-child-deadline-001' });
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 1500);
  assert.equal(result.error?.childReceipt?.outcome, 'failed');
});

test('a model that keeps working is never cut off: no turn ceiling when limits are 0, and signs of life keep the silence timer from firing', async () => {
  const tools = new AgentToolRegistry();
  let reads = 0, turns = 0;
  tools.register(descriptor('test.read'), async () => ({ modelOutput: { page: ++reads }, summary: { title: 'Read' } }));
  const long = await new AgentRunner({ tools, permissionMode: 'read_only', maxTotalTurns: 0, maxToolCalls: 0, model: { async complete() {
    const turn = ++turns;
    return turn <= 300 ? { toolCalls: [{ id: `page-${turn}`, name: 'test.read', arguments: { page: turn } }] } : { content: 'Read every page.' };
  } } }).run({ prompt: 'Read all 300 pages', runId: 'run-long-work-001' });
  assert.equal(long.status, 'completed'); assert.equal(reads, 300);
  // 60 ms of allowed silence, but the model reasons for 300 ms with a sign of life every 20 ms: never cut off.
  const thinking = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', modelTimeoutMs: 60, model: { async complete(request) {
    for (let index = 0; index < 15; index++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      await request.onProviderEvent?.({ type: 'gateway.heartbeat' } as unknown as AgentModelProviderEvent);
    }
    return { content: 'Thought it through.' };
  } } }).run({ prompt: 'Think for a while', runId: 'run-long-think-001' });
  assert.equal(thinking.status, 'completed'); assert.equal(thinking.finalText, 'Thought it through.');
  // A silent connection still ends.
  await assert.rejects(new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', modelTimeoutMs: 40, model: { async complete() {
    await new Promise(resolve => setTimeout(resolve, 400)); return { content: 'late' };
  } } }).run({ prompt: 'Silent', runId: 'run-silent-001' }), (error: { code?: string }) => { assert.equal(error.code, 'MODEL_TIMEOUT'); return true; });
});
