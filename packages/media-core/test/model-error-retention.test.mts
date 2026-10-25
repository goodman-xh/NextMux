import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyModelError } from '@nextmux/model-runtime/errors';
import { MediaJobStore, MediaRuntimeError, requestOpenAICompatibleImage, requestGeminiImage, requestMiniMaxMusic, requestChatAudioMusic } from '../lib/index.js';

const base = { endpoint: new URL('https://fixture.invalid/v1/generate'), apiKey: 'fixture-only', model: 'fixture-model', idempotencyKey: 'error-fixture-0001', prompt: 'Fixture', width: 1024, height: 1024 };

test('native image errors preserve status, parameter and retry delay without changing retry behavior', async () => {
  await assert.rejects(requestOpenAICompatibleImage({ ...base, fetchImpl: async () => Response.json({ error: {
    code: 'insufficient_quota', message: 'You exceeded your current quota.', param: 'model' }
  }, { status: 429, headers: { 'retry-after': '8' } }) }), (error: unknown) => {
    assert.ok(error instanceof MediaRuntimeError);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryable, true);
    assert.equal(error.readableError.kind, 'provider_quota_exhausted');
    assert.equal(error.readableError.parameter, 'model');
    assert.equal(error.readableError.retryAfterSeconds, 8);
    assert.equal(error.data.readableError.source, 'own_api');
    return true;
  });
});

test('Gemini blocked images and OpenRouter music SSE errors retain moderation reasons', async () => {
  await assert.rejects(requestGeminiImage({ ...base, fetchImpl: async () => Response.json({ promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'Image blocked by safety policy.' } }) }),
    (error: unknown) => error instanceof MediaRuntimeError && error.readableError.kind === 'content_refused' && /safety/.test(error.readableError.detail));
  await assert.rejects(requestChatAudioMusic({ ...base, format: 'mp3', fetchImpl: async () => new Response('data: {"error":{"code":"content_policy_violation","message":"Music request blocked by content policy"}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) }),
    (error: unknown) => error instanceof MediaRuntimeError && error.readableError.kind === 'content_refused');
});

test('MiniMax application errors under HTTP 200 preserve native status_code and explanation', async () => {
  await assert.rejects(requestMiniMaxMusic({ ...base, model: 'music-3.0', fetchImpl: async () => Response.json({ base_resp: { status_code: 1008, status_msg: 'Insufficient balance' } }) }), (error: unknown) => {
    assert.ok(error instanceof MediaRuntimeError);
    assert.equal(error.code, 'REQUEST_REJECTED');
    assert.equal(error.readableError.kind, 'provider_quota_exhausted');
    assert.match(error.readableError.detail, /1008/);
    return true;
  });
});

test('media failures keep the diagnostic after a queue file round-trip', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-media-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await MediaJobStore.create({ root });
  const now = '2026-09-28T00:00:00.000Z';
  const job = await store.enqueue({ idempotencyKey: 'media-error-fixture-01', kind: 'image', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'fixture-model', prompt: 'Fixture', width: 1024, height: 1024 },
    cost: { billing: 'provider_billed', description: 'Fixture provider' } }, { now });
  await store.confirm(job.id, { now });
  await store.claimNext('media-worker-fixture1', { now });
  const readableError = classifyModelError({ error: { code: 'invalid_request', message: 'Invalid parameter: "size"', param: 'size' } }, { source: 'own_api' });
  await store.fail(job.id, 'media-worker-fixture1', { code: 'REQUEST_REJECTED', message: 'Provider rejected this request', retryable: false, readableError }, { now });
  const restored = await (await MediaJobStore.create({ root })).get(job.id);
  assert.equal(restored.failure?.readableError?.kind, 'invalid_request');
  assert.equal(restored.failure?.readableError?.parameter, 'size');
  assert.match(restored.failure?.readableError?.detail || '', /Invalid parameter/);
  assert.equal(restored.failure?.retryable, false);
});
