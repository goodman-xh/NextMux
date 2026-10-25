import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionPluginCompatibility, decisionTransportForModel, invokeNativeDecision, invokeTevDecision } from '../lib/decision-adapter.js';

for (const [protocol, endpoint, images] of [
  ['nextmux_decisions', 'https://platform.example/v1/decisions', false],
  ['openrouter_decisions', 'https://openrouter.ai/api/alpha/decisions', false],
  ['systemone', 'http://127.0.0.1:8080/v1/systemone', true],
] as const) test(`native decisions capture request/response: ${protocol}`, async () => {
  let body: Record<string, unknown> | undefined;
  const result = await invokeNativeDecision({ protocol, endpoint, model: 'decision-model', state: 'current screen',
    questions: { next: { choices: ['wait', 'continue'] } }, ...(images ? { images: ['data:image/png;base64,YQ=='] } : {}), headers: { authorization: 'Bearer fixture' },
    fetchImpl: (async (url, init) => { assert.equal(String(url), endpoint); assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture'); body = JSON.parse(String(init?.body));
      return Response.json({ answers: { next: { choice: 'wait' } }, usage: { input_tokens: 30 } }); }) as typeof fetch,
  });
  assert.equal(body?.state, 'current screen'); assert.equal('messages' in body!, false); assert.equal('images' in body!, images);
  assert.equal(result.response.status, 200); assert.deepEqual(result.payload, { answers: { next: { choice: 'wait' } }, usage: { input_tokens: 30 } });
});

test('declared decision purpose never authorizes a generic OpenAI Decisions endpoint or remote images', async () => {
  assert.equal(decisionTransportForModel({ id: 'liquid/d1', outputModalities: ['decisions'] }, 'openrouter'), 'openrouter_decisions');
  assert.equal(decisionTransportForModel({ id: 'typesafe/jev-1.13', outputModalities: ['decisions'] }, 'openai'), undefined);
  assert.equal(decisionTransportForModel({ id: 'typesafe/jev-1.13', output: ['text'], outputJson: '[\"decisions\"]' }, 'openrouter'), undefined);
  assert.equal(decisionTransportForModel({ id: 'fastino/GLiNER-2.5-Decide', outputModalities: ['text'] }, 'openrouter'), undefined);
  assert.equal(decisionTransportForModel({ id: 'legacy/opaque', displayName: 'Jev quick decisions', output: [] }, 'openrouter'), 'openrouter_decisions');
  for (const protocol of ['nextmux_decisions', 'openrouter_decisions'] as const) {
    await assert.rejects(invokeNativeDecision({ protocol, endpoint: protocol === 'nextmux_decisions' ? 'https://platform.example/v1/decisions' : 'https://openrouter.ai/api/alpha/decisions',
      model: 'typesafe/jev-1.13', state: '', questions: {}, images: ['data:image/png;base64,YQ=='],
      fetchImpl: (async () => { assert.fail('unsupported images must be rejected before transport'); }) as typeof fetch }), { code: 'decision_images_unsupported' });
  }
});

test('Tev uses its published Chat format, preserves usage and never fabricates confidence', async () => {
  const model = 'togethercomputer/tev1-4b-experimental';
  assert.equal(decisionTransportForModel({ id: model, outputModalities: ['decisions'] }, 'openrouter'), 'tev1_chat');
  const questions = { next: { type: 'choice', instructions: 'Choose a move', criteria: { wait: 'Wait', right: 'Move right' } } };
  let calls = 0;
  const invocation = { model, endpoint: 'https://openrouter.ai/api/v1/chat/completions', state: 'coin on right', questions,
    fetchImpl: (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body)), decision = JSON.parse(body.messages[1].content);
      assert.equal(body.model, model); assert.equal(body.max_tokens, 8); assert.equal(body.reasoning.enabled, false);
      assert.deepEqual(decision.options, [{ label: 'A', key: 'wait', description: 'Wait' }, { label: 'B', key: 'right', description: 'Move right' }]);
      return Response.json({ id: 'receipt', choices: [{ message: { content: 'B' } }], usage: { prompt_tokens: 33, completion_tokens: 1, cost: 0.000003 } });
    }) as typeof fetch };
  const result = await invokeTevDecision(invocation);
  const payload = result.payload as { answers: unknown; usage: unknown; id: string };
  assert.deepEqual(payload.answers, { next: { type: 'choice', choice: 'right' } });
  assert.deepEqual(payload.usage, { prompt_tokens: 33, completion_tokens: 1, cost: 0.000003 }); assert.equal(payload.id, 'receipt');
  for (const invalid of [{ a: { type: 'score', criteria: ['low', 'high'] } }, { a: questions.next, b: questions.next }, { a: { type: 'choice', criteria: { only: 'Only' } } }]) {
    await assert.rejects(invokeTevDecision({ ...invocation, questions: invalid }), { code: 'decision_choice_only' });
  }
  assert.equal(calls, 1);
  assert.equal(decisionPluginCompatibility({ model }, [{ type: 'choice', optionCount: 2, minConfidence: 0 }]), undefined);
  assert.equal(decisionPluginCompatibility({ model }, [{ type: 'choice', optionCount: 2, minConfidence: 0.3 }]), 'decision_choice_only');
  assert.equal(decisionPluginCompatibility({ model }, [{ type: 'score', optionCount: 2, minConfidence: 0 }]), 'decision_choice_only');
});

test('decision adapters preserve paid late receipts and non-JSON error responses', async () => {
  const controller = new AbortController();
  const result = await invokeNativeDecision({ protocol: 'nextmux_decisions', endpoint: 'https://platform.example/v1/decisions',
    model: 'm', state: '', questions: {}, signal: controller.signal,
    fetchImpl: (async () => { controller.abort(); return Response.json({ nextmux: { charged_micros: 12 } }, { status: 402, headers: { 'retry-after': '5' } }); }) as typeof fetch,
  });
  assert.deepEqual(result.payload, { nextmux: { charged_micros: 12 } }); assert.equal(result.response.headers.get('retry-after'), '5');
  const rejected = await invokeNativeDecision({ protocol: 'systemone', endpoint: 'http://localhost:8080/v1/systemone', model: 'm', state: '', questions: {},
    fetchImpl: (async () => new Response('model unavailable', { status: 503 })) as typeof fetch });
  assert.equal(rejected.payload, 'model unavailable'); assert.equal(rejected.response.ok, false);
});

test('native decisions reject protocol mismatches and bound response bytes', async () => {
  let called = 0;
  await assert.rejects(invokeNativeDecision({ protocol: 'openrouter_decisions', endpoint: 'https://example.com/v1/chat/completions',
    model: 'm', state: '', questions: {}, fetchImpl: (async () => { called++; return Response.json({}); }) as typeof fetch }), { code: 'decision_protocol_unsupported' });
  assert.equal(called, 0);
  await assert.rejects(invokeNativeDecision({ protocol: 'systemone', endpoint: 'http://localhost:8080/v1/systemone', model: 'm', state: '', questions: {},
    fetchImpl: (async () => new Response('x'.repeat(2_000_001))) as typeof fetch }), { code: 'decision_response_too_large' });
});
