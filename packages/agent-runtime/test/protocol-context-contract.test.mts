import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  AgentRunner, AgentToolRegistry, AgentDelegationRuntime, AGENT_DELEGATE_TOOL_NAME,
  estimateAgentModelInputTokens, estimateAgentMediaTokens, requestOutputTokenLimit,
  type AgentModelRequest, type AgentMessageAttachment,
  type AgentRunCheckpoint, type AgentModelMessage,
} from '../lib/index.js';

function png(level: number): AgentMessageAttachment {
  // Same 256x256 RGB pixels encoded with two different zlib compression levels.
  const crc32 = (bytes: Buffer) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (kind: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(kind), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  const data = Buffer.alloc(256 * (256 * 3 + 1), 128); for (let row = 0; row < 256; row++) data[row * 769] = 0;
  return { kind: 'image', name: 'same.png', mimeType: 'image/png', dataBase64: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data, { level })), chunk('IEND', Buffer.alloc(0))]).toString('base64') };
}
const done = { content: 'done', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };

test('automatic, explicit, output-only and cumulative budgets obey every known request ceiling', async () => {
  for (const [options, expected] of [
    [{ contextWindowTokens: 8000, modelOutputTokenLimit: 700, tokenBudget: { maxOutputTokens: 100000 }, enforceContextOutputLimit: false }, 700],
    [{ modelOutputTokenLimit: 700, tokenBudget: { maxOutputTokens: 100000 }, enforceContextOutputLimit: false }, 700],
    [{ modelOutputTokenLimit: 700 }, 700],
    [{ contextWindowTokens: 8000, modelOutputTokenLimit: 700, tokenBudget: { maxOutputTokens: 200 } }, 200],
    [{ contextWindowTokens: 8000, modelOutputTokenLimit: 9000 }, 7990],
    [{}, undefined],
  ] as const) {
    let captured: AgentModelRequest | undefined;
    const runner = new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', ...options,
      model: { estimateInputTokens: () => 10, async complete(request) { captured = request; return done; } } });
    await runner.run({ prompt: 'Check the capacity' });
    assert.equal(captured?.maxOutputTokens, expected);
  }
});

test('dynamic route capacity applies on each turn and model input ceiling works without a context declaration', async () => {
  let calls = 0;
  const runner = new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    getContextLimits: () => ({ modelInputTokenLimit: 20, modelOutputTokenLimit: 5 }),
    model: { estimateInputTokens: () => 21, async complete() { calls++; return done; } },
  });
  const result = await runner.run({ prompt: 'Check input-only ceiling' });
  assert.equal(result.stopReason, 'context_window_exceeded'); assert.equal(calls, 0);
  assert.equal(requestOutputTokenLimit({ contextWindowTokens: 100, estimatedInputTokens: 90, modelOutputTokenLimit: 50, remainingOutputTokens: 6 }), 6);
});

test('delegation inherits hard ceilings in automatic mode and forwards declared reasoning controls', async () => {
  const tools = new AgentToolRegistry(); let captured: AgentModelRequest | undefined;
  const delegation = new AgentDelegationRuntime({ tools, maxPermissionMode: 'read_only', allowedToolNames: [],
    contextWindowTokens: 8000, modelOutputTokenLimit: 700, enforceContextOutputLimit: false,
    reasoningBudgetTokens: 128, reasoningEnabled: true, reasoningExclude: true,
    model: { async complete(request) { captured = request; return done; } },
  });
  delegation.register();
  const result = await tools.execute({ id: 'delegate-capacity-test', name: AGENT_DELEGATE_TOOL_NAME,
    arguments: { task: 'Review the capacity', maxOutputTokens: 100000 } }, 'read_only', { runId: 'run-delegate-capacity-test' });
  assert.equal(result.ok, true); assert.equal(captured?.maxOutputTokens, 700);
  assert.equal(captured?.reasoningBudgetTokens, 128); assert.equal(captured?.reasoningEnabled, true); assert.equal(captured?.reasoningExclude, true);
});

test('image compression cannot change admission or compaction for runner and provider estimates', async () => {
  const images = [png(0), png(9)]; assert.ok(images[0].kind !== 'text' && images[0].dataBase64.length > 100000);
  for (const providerId of ['ollama', 'anthropic', 'gemini', 'openai', 'custom_openai']) {
    const estimates: number[] = []; let calls = 0;
    for (const attachment of images) {
      const estimateInputTokens = (request: Pick<AgentModelRequest, 'instructions' | 'messages' | 'tools'>) => estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, { providerId });
      estimates.push(estimateInputTokens({ instructions: 'inspect', messages: [{ role: 'user', content: 'image', attachments: [attachment] }], tools: [] }));
      const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only', contextWindowTokens: 32000,
        model: { estimateInputTokens, async complete() { calls++; return done; } },
      }).run({ prompt: 'Inspect the image', attachments: [attachment] });
      assert.equal(result.status, 'completed', providerId);
    }
    assert.equal(estimates[0], estimates[1], providerId); assert.equal(calls, 2);
  }
});

test('audio, video and PDF estimates use observed duration/pages, independently of encoded length', () => {
  for (const [mime, media, tokens] of [
    ['audio/wav', { durationSeconds: 10 }, 320],
    ['video/mp4', { durationSeconds: 10 }, 2630],
    ['application/pdf', { pageCount: 2 }, 16000],
  ] as const) {
    assert.equal(estimateAgentMediaTokens(mime, 'YWJj', media, { providerId: 'gemini' }), tokens);
    assert.equal(estimateAgentMediaTokens(mime, 'YWJj'.repeat(100000), media, { providerId: 'gemini' }), tokens);
  }
  assert.equal(estimateAgentMediaTokens('audio/wav', 'YWJj', undefined, { providerId: 'gemini' }), 19200);
  assert.notEqual(estimateAgentMediaTokens('video/mp4', 'YWJj', undefined), estimateAgentMediaTokens('application/pdf', 'YWJj', undefined));
});

for (const [providerId, protocol] of [
  ['openai', 'openai_chat_completions'], ['openai', 'openai_responses'], ['anthropic', 'anthropic_messages'],
  ['gemini', 'gemini_generate_content'], ['custom_openai', 'openai_chat_completions'], ['ollama', 'openai_chat_completions'],
] as const) test(`${providerId}/${protocol} compacts mixed historical media while preserving current image/audio`, async () => {
  const tools = new AgentToolRegistry();
  const current: readonly AgentMessageAttachment[] = [
    { kind: 'image', name: 'current.png', mimeType: 'image/png', dataBase64: 'YQ==', media: { width: 256, height: 256 } },
    { kind: 'file', name: 'current.wav', mimeType: 'audio/wav', dataBase64: 'Yg==', media: { durationSeconds: 2 } },
  ];
  const contextWindowTokens = Math.max(2000, 3 * estimateAgentModelInputTokens('', [{ role: 'user', content: 'CURRENT MEDIA TASK', attachments: current }], [], { providerId, protocol }));
  const old: AgentModelMessage[] = Array.from({ length: 40 }, (_, index) => [
    { role: 'user' as const, content: `Historical evidence ${index}`, attachments: current.map(item => ({ ...item, name: `old-${index}-${item.name}` })) },
    { role: 'assistant' as const, content: `Historical report ${index}` },
  ]).flat();
  const checkpoint: AgentRunCheckpoint = { version: 1, runId: `media-${providerId}-${protocol}`, nextTurn: 1, segment: 1,
    messages: [...old, { role: 'user', content: 'CURRENT MEDIA TASK', attachments: current }],
    taskAnchor: { role: 'user', content: 'CURRENT MEDIA TASK', attachments: current },
    seenToolCallIds: [], usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, repeatedToolBatchTurns: 0,
    createdAt: '2026-10-20T00:00:00.000Z' };
  let calls = 0;
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', instructions: 'Analyze the current media.', allowedToolNames: [],
    contextWindowTokens, captureCheckpoint: true,
    model: { estimateInputTokens: request => estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, { providerId, protocol }),
      complete: async request => {
        calls++;
        assert.deepEqual(request.messages.flatMap(message => message.attachments ?? []).filter(item => item.name.startsWith('current')), current);
        assert.ok(estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, { providerId, protocol }) <= contextWindowTokens * 0.75);
        assert.match(request.messages.map(message => message.content).join('\n'), /old-.*(?:png|wav)/);
        return done;
      } },
  }).run({ prompt: 'ignored', checkpoint });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 1);
  assert.ok(result.events.some(event => event.type === 'context_compaction_completed'));
});

test('a newest user media message that cannot fit pauses with actionable instructions and retains its bytes', async () => {
  const attachment: AgentMessageAttachment = { kind: 'file', name: 'long.wav', mimeType: 'audio/wav', dataBase64: 'YQ==', media: { durationSeconds: 3600 } };
  const result = await new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    instructions: 'Analyze audio', allowedToolNames: [], contextWindowTokens: 2000,
    model: { complete: async () => { assert.fail('oversized latest media cannot be sent'); } },
  }).run({ prompt: 'Transcribe this audio', attachments: [attachment] });
  assert.equal(result.stopReason, 'media_context_compaction_required');
  assert.match(result.finalText, /shorten or split.*larger context/);
  assert.deepEqual(result.checkpoint?.messages[0].attachments, [attachment]);
});

test('a delegated request consumes only the parent task output allowance that remains', async () => {
  const tools = new AgentToolRegistry();
  const outputLimits: Array<number | undefined> = [];
  const model = {
    estimateInputTokens: () => 10,
    async complete(request: AgentModelRequest) {
      outputLimits.push(request.maxOutputTokens);
      if (outputLimits.length === 1) return {
        content: '',
        toolCalls: [{ id: 'delegate-remaining', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Review one item' } }],
        usage: { inputTokens: 10, outputTokens: 90 },
      };
      assert.equal(outputLimits.length, 2, 'the exhausted task must not call the parent model again');
      return { content: 'Review complete', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
    },
  };
  new AgentDelegationRuntime({ tools, model, maxPermissionMode: 'read_only', allowedToolNames: [],
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  }).register();
  const result = await new AgentRunner({ tools, model, permissionMode: 'read_only',
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  }).run({ prompt: 'Delegate a review after your analysis' });
  assert.deepEqual(outputLimits, [100, 10]);
  assert.equal(result.usage.outputTokens, 100);
  assert.equal(result.stopReason, 'output_token_limit_reached');
});

test('delegations in one tool batch receive successively smaller allowances even with a concurrent descriptor', async () => {
  const tools = new AgentToolRegistry();
  const outputLimits: Array<number | undefined> = [];
  let activeChildren = 0; let maximumActiveChildren = 0;
  const model = {
    estimateInputTokens: () => 10,
    async complete(request: AgentModelRequest) {
      outputLimits.push(request.maxOutputTokens);
      const call = outputLimits.length;
      if (call === 1) return {
        content: '',
        toolCalls: [
          { id: 'delegate-first', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Review the first item' } },
          { id: 'delegate-second', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Review the second item' } },
        ],
        usage: { inputTokens: 10, outputTokens: 90 },
      };
      assert.ok(call <= 3, 'the exhausted task must not call the parent model again');
      activeChildren++; maximumActiveChildren = Math.max(maximumActiveChildren, activeChildren);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeChildren--;
      return { content: 'Review complete', toolCalls: [], usage: { inputTokens: 10, outputTokens: call === 2 ? 6 : 4 } };
    },
  };
  const delegation = new AgentDelegationRuntime({ tools, model, maxPermissionMode: 'read_only', allowedToolNames: [],
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  });
  tools.register({ ...delegation.descriptor, concurrencySafe: true }, delegation.handler);
  const result = await new AgentRunner({ tools, model, permissionMode: 'read_only', maxParallelToolCalls: 2,
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  }).run({ prompt: 'Delegate both independent reviews' });
  assert.deepEqual(outputLimits, [100, 10, 4]);
  assert.equal(maximumActiveChildren, 1);
  assert.equal(result.usage.outputTokens, 100);
  assert.equal(result.stopReason, 'output_token_limit_reached');
});

test('unknown delegated usage prevents further child and parent model requests', async () => {
  const tools = new AgentToolRegistry();
  const outputLimits: Array<number | undefined> = [];
  const model = {
    estimateInputTokens: () => 10,
    async complete(request: AgentModelRequest) {
      outputLimits.push(request.maxOutputTokens);
      if (outputLimits.length === 1) return {
        content: '',
        toolCalls: [
          { id: 'delegate-unknown', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Review the first item' } },
          { id: 'delegate-after-unknown', name: AGENT_DELEGATE_TOOL_NAME, arguments: { task: 'Review the second item' } },
        ],
        usage: { inputTokens: 10, outputTokens: 90 },
      };
      assert.equal(outputLimits.length, 2, 'unknown child usage must block every later model request');
      return { content: 'Review complete without provider usage', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: false };
    },
  };
  new AgentDelegationRuntime({ tools, model, maxPermissionMode: 'read_only', allowedToolNames: [],
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  }).register();
  const result = await new AgentRunner({ tools, model, permissionMode: 'read_only',
    tokenBudget: { maxOutputTokens: 100 }, modelOutputTokenLimit: 1000,
  }).run({ prompt: 'Delegate both reviews' });
  assert.deepEqual(outputLimits, [100, 10]);
  assert.equal(result.usageKnown, false);
  assert.equal(result.tokenBudget?.usageKnown, false);
  assert.equal(result.stopReason, 'token_usage_unknown');
});

test('JPEG metadata before the frame header cannot lower the estimate for identical pixels', async () => {
  const { inflateSync } = await import('node:zlib');
  // A real 1536x768 JPEG generated by Pillow: Image.new('RGB', (1536,768), (128,128,128)).save(..., format='JPEG').
  const jpeg = inflateSync(Buffer.from('eNrt0TlQE1Ecx/H39u2ZbEY2CRgyiyEHJjgMYzargKPjABqFDrztwNsOPBBnLMCbDm/twJsOFa9KFM8OT8BGvLUCb23WXUahsVAKq9//zad6b9687zyrz3pGMirTFWlCKSHUXsR6SsqJLIqSKMiSJCmK7FL9HtXtVrO9vgn+nGBoUk5Q13NjhfHcSEFU1xNF+QVTk6ZphuIls4qNmYUp03AuoYqiqG414PEEjLAeNv55rGtEkxkRCaMRwmmUadTqISH7nQIdGfJrKMd4QZRkxeW2D3RlEI4yxvFMEHje3t1m7xNeE7zhZKnoq6qRInV+o6m1TY6WdXZnVvcOxVK19c2KK2tiIDuYNzmeyJ9iTpteVFwyo3zO3PS8+RWVCxYuWrxk6bLlK1auWr1m7br1GzZu2tywpXHr9h07d+3es7dl3/4DBw8dPnL0WPvxEydPnT5ztuPc+QtdFy9dvnL1+o2em7du37l77/6Dh48eP+nrHxh8/uLlq9dv3r57P/zh46fPX75++/7D6aJ25+/5Y5dmd3E8z3jJ6aJcg3NA44VwUvSWVkk1db6I0ST7y1rbOruVaKp6KLO2vteVFTMH84adtJGyvwtrHlfZaNhY1wBRGbU/j2lkNkm0twAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwH9m9f8Egdm0eA==', 'base64'));
  assert.equal(jpeg.length, 19057);
  const metadata = Buffer.alloc(60004, 0x30);
  metadata[0] = 0xff; metadata[1] = 0xe1; metadata.writeUInt16BE(60002, 2);
  // APP1 metadata leaves the JPEG's encoded pixel stream unchanged, but moves SOF past 98 KiB.
  const padded = Buffer.concat([jpeg.subarray(0, 2), metadata, metadata, jpeg.subarray(2)]);
  assert.ok(padded.length > 131072);
  for (const providerId of ['openai', 'custom_openai', 'anthropic', 'gemini', 'ollama']) {
    const original = estimateAgentMediaTokens('image/jpeg', jpeg.toString('base64'), undefined, { providerId });
    const withMetadata = estimateAgentMediaTokens('image/jpeg', padded.toString('base64'), undefined, { providerId });
    assert.equal(withMetadata, original, providerId);
    if (providerId === 'openai') assert.equal(original, 36835);
  }
});

test('restoring unknown usage cannot authorize a newly added or conflicting token budget', async () => {
  const tools = new AgentToolRegistry();
  const unknownUsageModel = { async complete() {
    return { content: 'Provider omitted usage', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: false };
  } };
  const unbudgeted = await new AgentRunner({ tools, model: unknownUsageModel, permissionMode: 'read_only', captureCheckpoint: true })
    .run({ prompt: 'Capture a task whose provider omitted usage' });
  assert.ok(unbudgeted.checkpoint);
  assert.equal(unbudgeted.checkpoint.usageKnown, false);
  assert.equal(unbudgeted.checkpoint.tokenBudget, undefined);
  const budgeted = await new AgentRunner({ tools, model: unknownUsageModel, permissionMode: 'read_only',
    tokenBudget: { maxOutputTokens: 100 }, captureCheckpoint: true,
  }).run({ prompt: 'Capture the same unknown usage under a budget' });
  assert.ok(budgeted.checkpoint?.tokenBudget);
  const checkpoints = [
    unbudgeted.checkpoint,
    { ...budgeted.checkpoint, tokenBudget: { ...budgeted.checkpoint.tokenBudget, usageKnown: true } },
    { ...budgeted.checkpoint, usageKnown: true },
  ];
  for (const checkpoint of checkpoints) {
    let requests = 0;
    const result = await new AgentRunner({ tools, permissionMode: 'read_only', tokenBudget: { maxOutputTokens: 100 },
      model: { async complete() { requests++; return done; } },
    }).run({ prompt: 'Continue with an output budget', checkpoint });
    assert.equal(requests, 0, 'either persisted unknown-usage flag must prevent another paid request');
    assert.equal(result.stopReason, 'token_usage_unknown');
    assert.equal(result.usageKnown, false);
    assert.equal(result.tokenBudget?.usageKnown, false);
    assert.equal(result.checkpoint?.usageKnown, false);
  }
});
