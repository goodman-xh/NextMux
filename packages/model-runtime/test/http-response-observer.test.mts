import test from 'node:test';
import assert from 'node:assert/strict';
import { postJson, OfficialModelError } from '../lib/http.js';

const options = {
    endpoint: new URL('https://api.example.com/v1/chat/completions'),
    headers: {}, body: { model: 'selected-model' }, timeoutMs: 0
};

test('bounded response observation precedes HTTP/envelope rejection and never dispatches another request', async () => {
    for (const [status, payload, code] of [
        [429, { error: { code: 'rate_limit' }, usage: { prompt_tokens: 20, completion_tokens: 2 } }, 'RATE_LIMITED'],
        [200, { error: { code: 'provider_failure' }, usage: { prompt_tokens: 10, completion_tokens: 1 } }, 'REQUEST_REJECTED']
    ] as const) {
        let calls = 0, observations = 0, inputTokens: number | undefined;
        await assert.rejects(postJson({ ...options,
            fetchImpl: async () => { calls++; return new Response(JSON.stringify(payload), { status }); },
            onResponsePayload(raw) {
                observations++;
                inputTokens = (raw as { usage: { prompt_tokens: number } }).usage.prompt_tokens;
            }
        }), (error: unknown) => error instanceof OfficialModelError && error.code === code);
        assert.equal(calls, 1);
        assert.equal(observations, 1);
        assert.equal(inputTokens, payload.usage.prompt_tokens);
    }
});

test('missing/failed observers do not change ordinary successful or rejected transport behavior', async () => {
    const payload = { answer: 'same decoded payload' };
    for (const onResponsePayload of [undefined, () => { throw new Error('observer failed'); }]) {
        assert.deepEqual(await postJson({ ...options, onResponsePayload, fetchImpl: async () => new Response(JSON.stringify(payload)) }), payload);
        await assert.rejects(postJson({ ...options, onResponsePayload, fetchImpl: async () => new Response('{"error":{"code":"bad"}}') }), (error: unknown) => error instanceof OfficialModelError && error.code === 'REQUEST_REJECTED');
    }
});

test('unreadable or oversized responses never produce accounting observation', async () => {
    let observations = 0;
    for (const response of [new Response('not JSON'), new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })]) {
        await assert.rejects(postJson({ ...options, fetchImpl: async () => response, onResponsePayload: () => { observations++; } }));
    }
    assert.equal(observations, 0);
});
