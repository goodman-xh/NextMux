import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, AgentCouncilDispatcher, AgentDelegationRuntime,
  buildCouncilLeadInstructions, buildCouncilSpecialistInstructions, computeChildInvocationKey,
  createAgentTaskContext, resolveAgentCouncilSlot, durableCheckpointHash, AgentRunInterruptedError,
  retryAgentRunCheckpoint, estimateAgentMediaTokens, AGENT_SKILL_LOAD_TOOL_NAME,
  type AgentSteeringMessage, type AgentCouncilSlotSpec,
  type AgentRunCheckpoint, type AgentDelegateOutput } from '../lib/index.js';
import { compactRetainedMediaAttachments } from '../lib/context-memory.js';

test('Council never dispatches to a lead-only pool and routes an unknown explicit slot by its role', () => {
  const slots = [{ slotId: 'lead', modelId: 'lead-model', roles: ['lead'] as const }];
  assert.equal(resolveAgentCouncilSlot(slots, 'qa', undefined, 0), undefined);
  const byRole = resolveAgentCouncilSlot([...slots, { slotId: 'worker', modelId: 'worker-model', roles: ['backend'] }],
    'backend', 'missing-slot', 0);
  assert.equal(byRole?.slotId, 'worker'); assert.equal(byRole?.routeSource, 'role_match');
  assert.equal(new AgentCouncilDispatcher([null] as unknown as AgentCouncilSlotSpec[]).resolve('qa', undefined, 'invalid'), undefined);
});

test('queued goal replaces the task anchor and context before the first resumed model step', async () => {
  const tools = new AgentToolRegistry();
  const initial = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    taskContext: createAgentTaskContext({ goal: 'OLD GOAL', allowedToolNames: [] }),
    model: { complete: async () => ({ content: 'Prior result' }) },
  }).run({ prompt: 'OLD GOAL', runId: 'goal-initial-run' });
  const updates = [{ id: 'goal-update-1', kind: 'goal_update', content: 'NEW GOAL', createdAt: '2026-10-20T01:02:03.000Z' }] as AgentSteeringMessage[];
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    takeSteeringMessages: () => updates.splice(0),
    model: { complete: async request => {
      assert.match(request.instructions!, /NEW GOAL/);
      assert.doesNotMatch(request.instructions!, /OLD GOAL/);
      assert.match(request.messages.at(-1)!.content, /supersedes[\s\S]*NEW GOAL/);
      return { content: 'Updated result' };
    } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(initial.checkpoint!, 'goal-resumed-run') });
  assert.doesNotMatch(result.checkpoint!.taskAnchor!.content, /OLD GOAL/);
  assert.match(result.checkpoint!.taskAnchor!.content, /NEW GOAL/);
});

test('media pruning protects the newest user attachments rather than arbitrary history index zero', () => {
  const image = { kind: 'image' as const, name: 'old.png', mimeType: 'image/png' as const, dataBase64: 'YQ==' };
  const audio = { kind: 'file' as const, name: 'current.wav', mimeType: 'audio/wav', dataBase64: 'Yg==' };
  const messages = compactRetainedMediaAttachments([
    { role: 'user', content: 'Historical task', attachments: [image] },
    { role: 'assistant', content: 'Historical answer' },
    { role: 'user', content: 'Current task', attachments: [audio] },
    { role: 'assistant', content: 'Working' },
  ], 0);
  assert.equal(messages[0].attachments, undefined);
  assert.match(messages[0].content, /old.png[\s\S]*bytes=1/);
  assert.deepEqual(messages[2].attachments, [audio]);
});

test('a goal saved while paused supersedes the old question on durable resume', async () => {
  const tools = new AgentToolRegistry();
  const writer = async (cp: AgentRunCheckpoint) => ({ handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
    admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 });
  const paused = await new AgentRunner({ tools, permissionMode: 'read_only', onDurableCheckpoint: writer,
    requestUserInput: async () => ({ status: 'cancelled' }),
    model: { complete: async () => ({ toolCalls: [{ id: 'obsolete-question', name: 'task.request_user_input', arguments: {
      prompt: 'Choose for the old goal', options: [{ id: 'one', label: 'One' }],
    } }], usage: { inputTokens: 1, outputTokens: 1 } }) },
  }).run({ prompt: 'Old goal', runId: 'paused-goal-original' });
  assert.equal(paused.stopReason, 'user_input_cancelled');
  const queue: AgentSteeringMessage[] = [{ id: 'updated-paused-goal', kind: 'goal_update', content: 'New goal without the old question', createdAt: '2026-10-20T00:00:00Z' }];
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true, onDurableCheckpoint: writer,
    takeSteeringMessages: () => queue.splice(0),
    model: { complete: async request => {
      assert.match(request.instructions!, /New goal without the old question/);
      return { content: 'Updated paused goal complete', usage: { inputTokens: 1, outputTokens: 1 } };
    } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(paused.checkpoint!, 'paused-goal-resume') });
  assert.equal(result.status, 'completed');
  assert.equal(result.checkpoint?.userInputStopReason, undefined);
});

const councilSlots: readonly AgentCouncilSlotSpec[] = [
  { slotId: 'lead', modelId: 'lead-model', roles: ['lead'] },
  { slotId: 'planning', modelId: 'planning-model', roles: ['architecture'] },
  { slotId: 'frontend', modelId: 'frontend-model', roles: ['ui_design'] },
  { slotId: 'backend', modelId: 'backend-model', roles: ['systems'] },
  { slotId: 'generalist', modelId: 'generalist-model', roles: ['generalist'] },
];

test('Council role routing invokes the assigned model and supplies scoped acceptance criteria', async () => {
  const tools = new AgentToolRegistry(), dispatcher = new AgentCouncilDispatcher(councilSlots);
  const calls: string[] = [];
  const runtime = new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only',
    model: { complete: async () => { assert.fail('unassigned lead model must not impersonate a specialist'); } },
    resolveChildExecution: request => {
      const decision = dispatcher.resolve(request.input.role, request.input.slotId, request.input.task)!;
      return { ...decision, instructions: buildCouncilSpecialistInstructions(decision, request.input.acceptanceCriteria),
        model: { complete: async req => {
          calls.push(decision.modelId);
          assert.match(req.instructions!, /Role Boundary/);
          assert.match(req.instructions!, /Verify the assigned output/);
          assert.equal(req.messages[0].content, request.input.task);
          return { content: 'Verified output', usage: { inputTokens: 1, outputTokens: 1 } };
        } } };
    } });
  for (const [role, slotId] of [['planning', 'planning'], ['frontend', 'frontend'], ['backend', 'backend'],
    ['qa', 'generalist'], ['review', 'generalist'], ['delivery', 'generalist'],
    ['architecture', 'planning'], ['ui_design', 'frontend'], ['systems', 'backend']] as const) {
    const result = (await runtime.handler({ role, task: `Self-contained task for ${role}`,
      acceptanceCriteria: ['Verify the assigned output'] }, { runId: 'council-routing-root' })).modelOutput as AgentDelegateOutput;
    assert.equal(result.slotId, slotId);
    assert.equal(result.modelId, `${slotId}-model`);
  }
  assert.equal(calls.length, 9);
  const lead = buildCouncilLeadInstructions(councilSlots);
  assert.match(lead, /self-contained.*acceptanceCriteria/);
  assert.match(lead, /unavailable or fails/);
  assert.match(buildCouncilLeadInstructions([]), /Continue.*yourself/);
  assert.match(buildCouncilLeadInstructions([null, null, null] as unknown as AgentCouncilSlotSpec[]), /Continue.*yourself/);
});

test('Council concurrent requests rotate atomically, keep assignments, and exclude lead-only fallback', async () => {
  const slots = [...councilSlots, { slotId: 'generalist2', modelId: 'generalist2-model', roles: ['generalist'] as const }];
  const dispatcher = new AgentCouncilDispatcher(slots);
  const decisions = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    await Promise.resolve();
    return dispatcher.resolve(i % 2 ? 'qa' : 'review', undefined, `request-${i}`)!;
  }));
  assert.deepEqual(decisions.map(item => item.slotId), Array.from({ length: 20 }, (_, i) => i % 2 ? 'generalist2' : 'generalist'));
  decisions.forEach((decision, i) => assert.strictEqual(dispatcher.resolve(i % 2 ? 'qa' : 'review', undefined, `request-${i}`), decision));
  assert.equal(dispatcher.resolve('qa', 'backend', 'explicit')?.slotId, 'backend');
  const fallback = new AgentCouncilDispatcher(councilSlots.slice(0, 4), max => max - 1);
  for (const role of ['qa', 'review', 'delivery'] as const) assert.equal(fallback.resolve(role, undefined, role)?.slotId, 'backend');
  assert.equal(computeChildInvocationKey({ parentRunId: 'root', task: 'plan', role: 'architecture' }),
    computeChildInvocationKey({ parentRunId: 'root', task: 'plan', role: 'planning' }));
});

test('an unavailable specialist route returns an explicit tool failure without running the lead model', async () => {
  for (const resolved of [undefined, { slotId: 'broken-specialist', modelId: 'unavailable-model' }]) {
  const tools = new AgentToolRegistry();
  new AgentDelegationRuntime({ tools, allowedToolNames: [], maxPermissionMode: 'read_only',
    resolveChildExecution: () => resolved, model: { complete: async () => { assert.fail('no route'); } } }).register();
  const result = await tools.execute({ id: 'unavailable', name: 'agent.delegate', arguments: { task: 'Bounded check', role: 'qa' } },
    'read_only', { runId: 'unavailable-root' });
  assert.equal(result.error?.code, 'COUNCIL_ROUTE_UNAVAILABLE');
  assert.match(result.error!.message, /yourself.*no specialist/);
  }
});

test('latest goal during a tool batch survives compaction, lost ACK, and restart without resurrecting its plan', async () => {
  const tools = new AgentToolRegistry(), pending: AgentSteeringMessage[] = [];
  const goal = (id: number): AgentSteeringMessage => ({ id: `goal-update-${id}`, kind: 'goal_update', content: `GOAL ${id}`, createdAt: '2026-10-20T02:00:00+09:00' });
  let operations = 0, saved: AgentRunCheckpoint | undefined;
  tools.register({ name: 'fixture.long_batch', description: 'Queue goals during a batch', source: 'builtin', requiredPermission: 'read_only', inputSchema: { type: 'object' } }, async () => {
    operations++;
    pending.push(goal(1), goal(2), goal(3));
    return { modelOutput: 'batch completed', summary: { title: 'batch completed' } };
  });
  const writer = async (cp: AgentRunCheckpoint) => {
    saved = structuredClone(cp);
    if (cp.activeGoal) throw new Error('crash after persisting the goal');
    return { handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
      admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 1 };
  };
  await assert.rejects(new AgentRunner({ tools, permissionMode: 'read_only', maxTurns: 1, maxTotalTurns: 4,
    onDurableCheckpoint: writer, takeSteeringMessages: () => pending.splice(0),
    model: { complete: async () => ({ toolCalls: [
      { id: 'obsolete-plan', name: 'task.update_plan', arguments: { steps: [{ id: 'old', title: 'Deliver the obsolete goal', status: 'in_progress' }] } },
      { id: 'long-batch', name: 'fixture.long_batch', arguments: {} },
    ] }) },
  }).run({ prompt: 'OLD GOAL', runId: 'goal-durable-initial', history: Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `Historical goal ${i}` })) }), AgentRunInterruptedError);
  assert.equal(operations, 1);
  assert.equal(saved!.activeGoal!.content, 'GOAL 3');
  assert.equal(saved!.activeGoal!.createdAt, goal(3).createdAt);
  assert.equal(saved!.taskPlan, undefined);
  const resumed = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    maxTurns: 1, maxTotalTurns: 4,
    onDurableCheckpoint: async cp => ({ handle: 'resume-11111111-1111-4111-8111-111111111111', scopeId: cp.executionScopeId!,
      admissionId: cp.pendingToolBatch?.admissionId, checkpointHash: durableCheckpointHash(cp), revision: 2 }),
    takeSteeringMessages: () => [goal(3)],
    model: { complete: async req => {
      assert.match(req.instructions!, /GOAL 3/);
      assert.doesNotMatch(req.instructions!, /OLD GOAL|GOAL 1|GOAL 2/);
      return { content: 'Updated work complete' };
    } },
  }).run({ prompt: 'ignored', checkpoint: retryAgentRunCheckpoint(saved!, 'goal-durable-resume') });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.events.filter(event => event.type === 'steering_applied').length, 0);
  assert.equal(operations, 1);
});

test('original message timestamps survive history validation, retry and repeated compaction', async () => {
  const tools = new AgentToolRegistry();
  const at = '2026-09-01T01:02:03+09:00', createdAt = '2026-09-01T01:02:04+09:00';
  const initial = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    model: { complete: async () => ({ content: 'first' }) },
  }).run({ prompt: 'current', runId: 'timestamp-first', history: [{ role: 'user', content: 'history', at, createdAt }] });
  const cp = retryAgentRunCheckpoint(initial.checkpoint!, 'timestamp-retry');
  assert.equal(cp.messages[0].at, at);
  assert.equal(cp.messages[0].createdAt, createdAt);
  assert.equal(cp.createdAt, initial.checkpoint!.createdAt);
  const stamped = { ...cp, messages: [...cp.messages,
    ...Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, content: `Older message ${i}`, at, createdAt })),
    { role: 'user' as const, content: 'retained', at, createdAt }] };
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', captureCheckpoint: true,
    maxTurns: 1, maxTotalTurns: 4, model: { complete: async () => ({ content: 'done' }) },
  }).run({ prompt: 'ignored', checkpoint: stamped });
  const retained = result.checkpoint!.messages.find(message => message.content === 'retained')!;
  assert.ok(result.checkpoint!.messages.length < stamped.messages.length, 'the fixture must actually compact older history');
  assert.equal(retained.at, at);
  assert.equal(retained.createdAt, createdAt);
});

test('multi-workspace read_file deduplication scopes by workspaceBindingId and large array tool outputs truncate gracefully (D1-08, D1-09)', async () => {
  const tools = new AgentToolRegistry();
  let readCallCount = 0;
  tools.register({
    name: 'workspace.read_file',
    description: 'Read a file',
    source: 'builtin',
    requiredPermission: 'read_only',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, workspace: { type: 'string' } } },
  }, async input => {
    const args = input as { path: string; workspace: string };
    readCallCount++;
    return {
      modelOutput: {
        workspaceBindingId: args.workspace,
        path: args.path,
        startLine: 1,
        endLine: 10,
        totalLines: 10,
        truncated: false,
        sha256: `${args.workspace}-${readCallCount}`,
        content: `content-from-${args.workspace}-call-${readCallCount}`,
      },
      summary: { title: `Read ${args.path}` },
    };
  });
  tools.register({
    name: 'workspace.list_files',
    description: 'List many files',
    source: 'builtin',
    requiredPermission: 'read_only',
    inputSchema: { type: 'object' },
  }, async () => ({
    modelOutput: {
      files: Array.from({ length: 2500 }, (_, i) => ({ path: `packages/pkg-${i}/src/component-${i}.tsx`, size: i })),
    },
    summary: { title: 'Listed files' },
  }));

  let turn = 0;
  const seenToolMessages: string[][] = [];
  const runner = new AgentRunner({
    tools,
    permissionMode: 'read_only',
    maxTurns: 4,
    model: {
      complete: async req => {
        turn++;
        seenToolMessages.push(req.messages.filter(m => m.role === 'tool').map(m => m.content));
        if (turn === 1) {
          return {
            toolCalls: [
              { id: 'r1', name: 'workspace.read_file', arguments: { path: 'src/index.ts', workspace: 'ws-frontend' } },
              { id: 'r2', name: 'workspace.read_file', arguments: { path: 'src/index.ts', workspace: 'ws-backend' } },
              { id: 'l1', name: 'workspace.list_files', arguments: {} },
            ],
          };
        }
        return { content: 'Done' };
      },
    },
  });
  const res = await runner.run({ prompt: 'Inspect both workspaces', runId: 'd1-08-09' });
  assert.equal(res.status, 'completed');
  const turn2Tools = seenToolMessages[1]!.map(item => JSON.parse(item));
  // Neither ws-frontend nor ws-backend read of src/index.ts should be marked superseded!
  assert.equal(turn2Tools[0].output.content, 'content-from-ws-frontend-call-1');
  assert.equal(turn2Tools[0].output.superseded, undefined);
  assert.equal(turn2Tools[1].output.content, 'content-from-ws-backend-call-2');
  assert.equal(turn2Tools[1].output.superseded, undefined);
  // Large array tool output is truncated gracefully instead of failing with TOOL_OUTPUT_TOO_LARGE
  assert.equal(turn2Tools[2].ok, true);
  assert.equal(turn2Tools[2].outputTruncated, true);
  assert.ok(turn2Tools[2].output.files.length < 2500 && turn2Tools[2].output.files.length > 0);
});

test('durable pendingToolBatch updates policyFingerprint when skill.load narrows tool policy mid-batch (D1-10)', async () => {
  const tools = new AgentToolRegistry();
  const skillPolicy = { id: 'a'.repeat(64), name: 'alpha', sourceHash: 'b'.repeat(64), allowedToolNames: ['fixture.allowed_after_skill'] };
  tools.registerHostSkillLoader({
    name: AGENT_SKILL_LOAD_TOOL_NAME,
    description: 'Load skill',
    source: 'skill',
    requiredPermission: 'read_only',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  }, async () => ({
    modelOutput: { loaded: 'skill-alpha' },
    skillPolicy,
    summary: { title: 'Loaded skill-alpha' },
  }), [skillPolicy]);
  tools.register({
    name: 'fixture.allowed_after_skill',
    description: 'Allowed tool',
    source: 'builtin',
    requiredPermission: 'read_only',
    inputSchema: { type: 'object' },
  }, async () => ({
    modelOutput: { ok: true },
    summary: { title: 'Ran allowed tool' },
  }));

  let savedAfterSkill: AgentRunCheckpoint | undefined;
  let checkpointCount = 0;
  await assert.rejects(
    new AgentRunner({
      tools,
      permissionMode: 'read_only',
      onDurableCheckpoint: async cp => {
        checkpointCount++;
        // Crash right after skill.load completes and persists its completed state in pendingToolBatch
        const skillCall = cp.pendingToolBatch?.calls.find(c => c.call.name === AGENT_SKILL_LOAD_TOOL_NAME);
        if (skillCall?.state === 'completed') {
          savedAfterSkill = structuredClone(cp);
          throw new Error('simulated crash after skill.load commit');
        }
        return {
          handle: 'resume-11111111-1111-4111-8111-111111111111',
          scopeId: cp.executionScopeId!,
          admissionId: cp.pendingToolBatch?.admissionId,
          checkpointHash: durableCheckpointHash(cp),
          revision: checkpointCount,
        };
      },
      model: {
        complete: async () => ({
          toolCalls: [
            { id: 'call-skill', name: AGENT_SKILL_LOAD_TOOL_NAME, arguments: { id: 'a'.repeat(64) } },
            { id: 'call-next', name: 'fixture.allowed_after_skill', arguments: {} },
          ],
        }),
      },
    }).run({ prompt: 'Load skill and run', runId: 'd1-10-run' }),
    AgentRunInterruptedError,
  );
  assert.ok(savedAfterSkill?.pendingToolBatch);
  const resumed = await new AgentRunner({
    tools,
    permissionMode: 'read_only',
    onDurableCheckpoint: async cp => ({
      handle: 'resume-11111111-1111-4111-8111-111111111111',
      scopeId: cp.executionScopeId!,
      admissionId: cp.pendingToolBatch?.admissionId,
      checkpointHash: durableCheckpointHash(cp),
      revision: ++checkpointCount,
    }),
    model: {
      complete: async () => ({ content: 'Resumed cleanly after skill.load' }),
    },
  }).run({ prompt: 'ignored', checkpoint: savedAfterSkill! });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.finalText, 'Resumed cleanly after skill.load');
});

test('MIME line-wrapped and URL-safe base64 image headers decode dimensions accurately and duplicate lead roles are excluded (D1-29)', () => {
  // 512x512 PNG header encoded as base64 with MIME \r\n line breaks and URL-safe alphabet
  const pngHeader = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(pngHeader, 0);
  pngHeader.writeUInt32BE(512, 16);
  pngHeader.writeUInt32BE(512, 20);
  const standardB64 = pngHeader.toString('base64');
  const mimeWrappedUrlSafe = `${standardB64.slice(0, 16)}\r\n${standardB64.slice(16)}`.replace(/\+/g, '-').replace(/\//g, '_');
  const expectedTokens = estimateAgentMediaTokens('image/png', standardB64, undefined);
  assert.equal(expectedTokens, 2_833 + 5_667);
  assert.equal(estimateAgentMediaTokens('image/png', mimeWrappedUrlSafe, undefined), expectedTokens);

  const duplicateLeadSlots = [{ slotId: 'lead-dup', modelId: 'lead-model', roles: ['lead', 'lead'] as const }];
  assert.equal(resolveAgentCouncilSlot(duplicateLeadSlots, 'qa', undefined, 0), undefined);
});

test('shortenLongestStrings retains 65% head + 35% tail without splitting UTF-16 surrogate pairs (D10-A1)', async () => {
  const tools = new AgentToolRegistry();
  const hugeLog = `BUILD_PREAMBLE_START\n${'🚀'.repeat(90_000)}\nFATAL_COMPILER_ERROR: undefined symbol at tail`;
  tools.register(
    {
      name: 'process.run',
      description: 'Run build',
      source: 'builtin',
      requiredPermission: 'read_only',
      concurrencySafe: true,
      inputSchema: { type: 'object' },
    },
    async () => ({
      modelOutput: { exitCode: 0, stdout: hugeLog },
      summary: { title: 'Run build' },
    }),
  );

  let inspectedStdout = '';
  let turn = 0;
  const result = await new AgentRunner({
    tools,
    permissionMode: 'read_only',
    model: {
      complete: async req => {
        turn += 1;
        if (turn === 1) {
          return { toolCalls: [{ id: 'build-1', name: 'process.run', arguments: { cmd: 'make' } }] };
        }
        const toolMsg = req.messages.find(m => m.role === 'tool' && m.toolCallId === 'build-1')!;
        const parsed = JSON.parse(toolMsg.content);
        assert.equal(parsed.outputTruncated, true);
        inspectedStdout = parsed.output.stdout;
        return { content: 'Inspected build log' };
      },
    },
  }).run({ prompt: 'Run build', runId: 'd10-a1-run' });

  assert.equal(result.status, 'completed');
  assert.match(inspectedStdout, /^BUILD_PREAMBLE_START/);
  assert.match(inspectedStdout, /…\[truncated \d+ characters\]…/);
  assert.match(inspectedStdout, /FATAL_COMPILER_ERROR: undefined symbol at tail$/);
  // Ensure no lone high or low UTF-16 surrogates exist after slicing
  const hasLoneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(inspectedStdout);
  assert.equal(hasLoneSurrogate, false);
});

test('repeatedToolBatchTurns detects identical-argument loops even when volatile fields change every call (D10-A2)', async () => {
  const tools = new AgentToolRegistry();
  let calls = 0;
  tools.register(
    {
      name: 'workspace.status',
      description: 'Status with volatile timing fields',
      source: 'builtin',
      requiredPermission: 'read_only',
      concurrencySafe: true,
      inputSchema: { type: 'object' },
    },
    async () => {
      calls += 1;
      return {
        modelOutput: {
          clean: true,
          durationMs: calls * 13,
          elapsedMs: calls * 17,
          timestamp: `2026-10-22T00:00:0${calls}Z`,
          pid: 1000 + calls,
          startedAt: calls * 100,
          completedAt: calls * 100 + 13,
        },
        summary: { title: 'Status' },
      };
    },
  );

  let turns = 0;
  const result = await new AgentRunner({
    tools,
    permissionMode: 'read_only',
    model: {
      complete: async () => {
        turns += 1;
        return {
          toolCalls: [{ id: `status-${turns}`, name: 'workspace.status', arguments: { branch: 'main' } }],
        };
      },
    },
  }).run({ prompt: 'Check status', runId: 'd10-a2-run' });

  assert.equal(result.stopReason, 'repeated_tool_calls');
  assert.equal(calls, 8);
});

test('concurrencySafe tools execute in parallel even when onDurableCheckpoint pendingToolBatch is active (D10-A3)', async () => {
  const tools = new AgentToolRegistry();
  let active = 0;
  let maxActive = 0;
  for (const id of ['a', 'b', 'c']) {
    tools.register(
      {
        name: `workspace.read_${id}`,
        description: `Read ${id}`,
        source: 'builtin',
        requiredPermission: 'read_only',
        concurrencySafe: true,
        inputSchema: { type: 'object' },
      },
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 25));
        active -= 1;
        return {
          modelOutput: { id },
          usage: { inputTokens: 2, outputTokens: 1 },
          summary: { title: `Read ${id}` },
        };
      },
    );
  }

  let turn = 0;
  let revision = 0;
  const statesObserved: string[][] = [];
  const result = await new AgentRunner({
    tools,
    permissionMode: 'read_only',
    maxParallelToolCalls: 3,
    onDurableCheckpoint: async cp => {
      if (cp.pendingToolBatch) {
        statesObserved.push(cp.pendingToolBatch.calls.map(c => `${c.call.id}:${c.state}`));
      }
      return {
        handle: 'resume-11111111-1111-4111-8111-111111111111',
        scopeId: cp.executionScopeId!,
        admissionId: cp.pendingToolBatch?.admissionId,
        checkpointHash: durableCheckpointHash(cp),
        revision: ++revision,
      };
    },
    model: {
      complete: async req => {
        turn += 1;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: 'call-a', name: 'workspace.read_a', arguments: {} },
              { id: 'call-b', name: 'workspace.read_b', arguments: {} },
              { id: 'call-c', name: 'workspace.read_c', arguments: {} },
            ],
          };
        }
        assert.deepEqual(
          req.messages.filter(m => m.role === 'tool').map(m => m.toolCallId),
          ['call-a', 'call-b', 'call-c'],
        );
        return { content: 'All three read in parallel with durable checkpoints' };
      },
    },
  }).run({ prompt: 'Read a, b, c', runId: 'd10-a3-run' });

  assert.equal(result.status, 'completed');
  assert.equal(maxActive, 3);
  assert.deepEqual(statesObserved, [
    ['call-a:prepared', 'call-b:prepared', 'call-c:prepared'],
    ['call-a:running', 'call-b:running', 'call-c:running'],
    ['call-a:completed', 'call-b:completed', 'call-c:completed'],
  ]);
});
