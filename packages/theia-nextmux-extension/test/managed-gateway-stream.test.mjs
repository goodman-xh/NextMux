import assert from 'node:assert/strict';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ProbePlatformService extends NextMuxPlatformServiceImpl {
  consume(response, callbacks = {}) {
    return this.consumeManagedGatewayStream(response, callbacks);
  }
  classify(error) {
    return this.stableAgentRunError(error);
  }
}

test('managed balance exhaustion remains a stable non-resumable user-action failure', async () => {
  const service = new ProbePlatformService();
  const response = new Response([
    { type: 'gateway.started' },
    { type: 'response.failed', error: { code: 'wallet_balance_insufficient', message: 'Balance is insufficient', status: 402 } },
    { type: 'error', error: { code: 'wallet_balance_insufficient', message: 'Balance is insufficient', status: 402, requestId: 'request-balance' } },
  ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(service.consume(response), error => {
    assert.equal(error.code, 'wallet_balance_insufficient'); assert.equal(error.status, 402); assert.equal(error.requestId, 'request-balance');
    const { readableError, ...stable } = service.classify(error);
    assert.deepEqual(stable, { code: 'wallet_balance_insufficient', message: 'Balance is insufficient',
      kind: 'waiting_user', retryable: false, resumable: false, httpStatus: 402, retrySafe: false });
    assert.partialDeepStrictEqual(readableError, { kind: 'balance_insufficient', code: 'wallet_balance_insufficient',
      source: 'relay', httpStatus: 402 });
    return true;
  });
  assert.equal(response.body.locked, false);
});

test('managed gateway errors preserve the no-transparent-retry barrier in the desktop', async () => {
  const response = new Response(JSON.stringify({
    type: 'error',
    error: { code: 'upstream_timeout', message: 'The selected route timed out', status: 504, providerAccepted: true, partial: true, resumable: true, requestId: 'request-fixture' },
  }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(new ProbePlatformService().consume(response), error => {
    assert.equal(error.retrySafe, false);
    assert.equal(error.partial, true);
    assert.equal(error.resumable, true);
    assert.equal(error.requestId, 'request-fixture');
    return true;
  });
  assert.equal(response.body.locked, false);
});

test('buffered managed gateway errors keep the same accepted-request barrier', async () => {
  const response = Response.json({ error: { code: 'upstream_response_invalid', message: 'Incomplete stream' }, details: { providerAccepted: true, requestId: 'accepted-fixture' } }, { status: 502 });
  await assert.rejects(new ProbePlatformService().consume(response), error => error.retrySafe === false && error.requestId === 'accepted-fixture');
});

test('provider usage with missing evidence never becomes known in the desktop stream', async () => {
  const response = new Response([
    { type: 'content.delta', delta: 'answer' },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 }, usageKnown: false },
    { type: 'completed', result: { response: { content: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, usageKnown: false } } } },
  ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
  const result = await new ProbePlatformService().consume(response);
  assert.equal(result.response.content, 'answer');
  assert.equal(result.response.usage.usageKnown, false);
});

test('transport EOF after visible output remains non-resumable and cannot be transparently replayed', async () => {
  const response = new Response('{"type":"response.started"}\n{"type":"content.delta","delta":"partial"}\n', { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(new ProbePlatformService().consume(response), error => {
    assert.equal(error.code, 'INCOMPLETE_STREAM');
    assert.equal(error.partial, true);
    assert.equal(error.resumable, false);
    assert.equal(error.retrySafe, false);
    return true;
  });
  assert.equal(response.body.locked, false);
});

test('managed stream rejects sequence gaps and ignores duplicate frames by task identity', async () => {
  const response = new Response([
    { type: 'gateway.started', streamId: 'stream-a', taskId: 'task-a', sequence: 1 },
    { type: 'gateway.started', streamId: 'stream-a', taskId: 'task-a', sequence: 1 },
    { type: 'content.delta', streamId: 'stream-a', taskId: 'task-a', sequence: 3, delta: 'missing' },
  ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(new ProbePlatformService().consume(response), error => {
    assert.equal(error.code, 'STREAM_SEQUENCE_GAP');
    assert.equal(error.taskId, 'task-a');
    assert.equal(error.lastSequence, 1);
    assert.equal(error.resumable, false);
    assert.equal(error.replayable, false);
    return true;
  });
});

test('managed completion projects only safe URL/title citations and preserves final source ownership', async () => {
  const citations = [{ url: 'https://example.com/final', title: 'Final', encrypted_index: 'PRIVATE' }, { url: 'javascript:alert(1)' }];
  const events = [];
  const response = new Response([
    { type: 'response.completed', citations: [{ url: 'https://example.com/stream' }], usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'completed', result: { response: { content: 'answer', toolCalls: [], citations, usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } } },
  ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
  const result = await new ProbePlatformService().consume(response, { onProviderEvent: event => { events.push(event); } });
  assert.deepEqual(result.response.citations, [{ url: 'https://example.com/final', title: 'Final' }]);
  assert.deepEqual(events.find(event => event.type === 'response.completed').citations, [{ url: 'https://example.com/stream' }]);
  assert.doesNotMatch(JSON.stringify(result.response.citations), /PRIVATE|javascript/);
});

test('buffered managed sources and completed-stream fallback use the same bounded validator', async () => {
  const citations = [{ url: 'https://user:secret@example.com' }, { url: 'https://example.com/source', title: 'Source', raw: 'PRIVATE' }];
  const buffered = await new ProbePlatformService().consume(Response.json({ response: { content: 'answer', toolCalls: [], citations, usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } }));
  const streamed = await new ProbePlatformService().consume(new Response([
    { type: 'response.completed', citations },
    { type: 'completed', result: { response: { content: 'answer', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } } } },
  ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } }));
  assert.deepEqual(buffered.response.citations, [{ url: 'https://example.com/source', title: 'Source' }]);
  assert.deepEqual(streamed.response.citations, buffered.response.citations);
});

test('managed buffered and streamed completion preserve provider output-limit verdicts', async () => {
  const events = [];
  const service = new ProbePlatformService();
  const response = { content: 'partial', finishReason: 'length', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, usageKnown: true } };
  const buffered = await service.consume(Response.json({ response }), { onProviderEvent: event => events.push(event) });
  assert.equal(buffered.response.finishReason, 'length');
  assert.equal(events.find(event => event.type === 'response.completed').finishReason, 'length');
  for (const finishReason of [undefined, 'length']) {
    const streamed = await service.consume(new Response([
      { type: 'response.completed', finishReason: 'length' },
      { type: 'completed', result: { response: { ...response, finishReason } } },
    ].map(value => JSON.stringify(value)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } }));
    assert.equal(streamed.response.finishReason, 'length');
    assert.equal(streamed.response.content, 'partial');
  }
});

test('managed stream accepts the larger same-route reasoning state in its completed receipt', async () => {
  const providerState = { kind: 'openai-chat-reasoning-v1', content: { reasoning: 'x'.repeat(256 * 1024) }, model: 'deepseek-chat' };
  const response = new Response(JSON.stringify({ type: 'completed', result: { response: {
    content: 'partial', finishReason: 'length', toolCalls: [], providerState,
    usage: { inputTokens: 1, outputTokens: 1, usageKnown: true },
  } } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  const result = await new ProbePlatformService().consume(response);
  assert.deepEqual(result.response.providerState, providerState);
  assert.equal(result.response.finishReason, 'length');
});
