import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatModelError } from '@nextmux/model-runtime/errors';
import { MEDIA_ERROR_LOCALES, MEDIA_ERROR_MESSAGE_KEYS, mediaErrorCatalogProblems, formatMediaDomainError } from '../../model-runtime/lib/media-error-locales.js';
import { MediaCoreError, MediaRuntimeError, MediaJobStore, MEDIA_QUEUE_FILE, safeInteger, boundedText, failure, mediaMessage, renderSrt, renderVtt, renderAss, formatSrtTimestamp, normalizeComfyUiBaseUrl, parseComfyUiWorkflowTemplate, timedTranscriptToSubtitleCues, planMediaExecution, createElevenLabsAdapter, type EnqueueMediaJobRequest } from '../lib/index.js';

const now = '2026-09-28T00:00:00.000Z';
const worker = 'media-worker-language-audit';
const request: EnqueueMediaJobRequest = { idempotencyKey: 'language-audit-media-001', kind: 'image', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001', input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'fixture', prompt: '作者原文 — A story', width: 1024, height: 1024 }, cost: { billing: 'provider_billed', description: 'Original billing detail' } };
const params = { label: 'duration', nodeId: 'node-3', index: 2, name: 'pollUrl', minimum: 1, maximum: 100, MAX_ACTIVE_JOBS: 2000 };

test('WP3: every media reason has a complete 12-locale catalog independently of script similarity', () => {
  assert.deepEqual(mediaErrorCatalogProblems(), []);
  assert.ok(MEDIA_ERROR_MESSAGE_KEYS.length >= 240);
  for (const key of MEDIA_ERROR_MESSAGE_KEYS) {
    for (const locale of MEDIA_ERROR_LOCALES) {
      const text = formatMediaDomainError(key, params, locale);
      assert.ok(text, `${key}/${locale}`);
      assert.ok(text.trim(), `${key}/${locale}`);
      assert.doesNotMatch(text, /\{(?:label|minimum|maximum|nodeId|index|name|MAX_ACTIVE_JOBS)\}/);
    }
  }
  for (const unknown of ['unknown_key', 'toString', 'constructor', '__proto__']) {
    assert.equal(formatMediaDomainError(`media.${unknown}`, {}, 'ja'), undefined);
    assert.doesNotThrow(() => formatModelError(mediaMessage(`media.${unknown}`), 'ja'));
  }
});

test('WP3: every explicit source message identity is backed by the shared browser-safe catalog', async () => {
  const known = new Set([...MEDIA_ERROR_MESSAGE_KEYS, 'media.unknown']);
  for (const file of ['store', 'validation', 'subtitle', 'runtime', 'comfyui', 'transcription', 'providers']) {
    const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/mediaMessage\("([^"]+)"/g)) assert.ok(known.has(match[1]), `${file}: ${match[1]}`);
    assert.doesNotMatch(source, /new Media(?:Core|Runtime)Error\([^\n]*,\s*["'`][^\n]*\p{Script=Han}/u);
  }
});

test('WP3: validation and subtitle reasons keep parameters and distinct keys for the same code', () => {
  let first: MediaCoreError | undefined;
  assert.throws(() => safeInteger(1.5, 'duration', 1, 300), error => {
    assert.ok(error instanceof MediaCoreError);
    first = error;
    assert.equal(error.code, 'INVALID_MEDIA_REQUEST');
    assert.deepEqual(error.params, { label: 'duration', minimum: 1, maximum: 300 });
    assert.equal(error.message, 'duration must be an integer from 1 to 300');
    assert.match(formatModelError(error, 'es').text, /entero.*1.*300/);
    return true;
  });
  assert.throws(() => boundedText(null, 'duration', 100), error => {
    assert.ok(error instanceof MediaCoreError);
    assert.equal(error.code, first?.code);
    assert.notEqual(error.messageKey, first?.messageKey);
    return true;
  });
  assert.throws(() => formatSrtTimestamp(-1), error => error instanceof MediaCoreError && error.messageKey === 'media.subtitle_timestamp_is_outside_the_24_hour_limit');
  assert.throws(() => renderSrt([], 24, 23), error => error instanceof MediaCoreError && error.params.maximum === 23);
});

test('WP3: local ComfyUI, transcription and provider validation expose English diagnostics plus semantic metadata', () => {
  for (const run of [
    () => normalizeComfyUiBaseUrl('not-a-url'),
    () => parseComfyUiWorkflowTemplate({ version: 999 }),
    () => timedTranscriptToSubtitleCues([], 24, 1000),
  ]) {
    assert.throws(run, error => {
      assert.ok(error instanceof MediaRuntimeError);
      assert.equal(error.domain, 'media');
      assert.ok(error.messageKey.startsWith('media.'));
      assert.doesNotMatch(error.message, /\p{Script=Han}/u);
      const formatted = formatModelError(error, 'ja');
      assert.notEqual(formatted.text, error.message);
      assert.doesNotMatch(formatted.text, /model request failed/i);
      return true;
    });
  }
  const adapter = createElevenLabsAdapter({ providerId: 'elevenlabs', modelId: 'music_v1', endpoint: new URL('https://fixture.invalid'), apiKey: 'fixture-only' });
  assert.throws(() => adapter.createMusic!({ model: 'wrong-model' } as never), error => error instanceof MediaRuntimeError && error.messageKey === 'media.selected_music_model_does_not_match_the_adapter');
});

for (const billing of ['free', 'provider_billed', 'platform_billed'] as const) {
  test(`WP3: ${billing} recovery remains localized after a durable queue round-trip`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-media-language-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const store = await MediaJobStore.create({ root });
    const value = { ...request, cost: { ...request.cost, billing } };
    const job = await store.enqueue(value, { now });
    if (billing !== 'free') await store.confirm(job.id, { now });
    await store.claimNext(worker, { now });
    await store.releaseWorker(worker, { now });
    await store.recoverInterrupted({ now });
    const restored = await (await MediaJobStore.create({ root })).get(job.id);
    assert.equal(restored.failure?.domain, 'media');
    assert.equal(restored.failure?.messageKey, billing === 'free' ? 'media.recovery_local_interrupted' : 'media.recovery_provider_outcome_unknown');
    assert.equal(restored.failure?.retryable, billing === 'free');
    assert.equal(restored.cost.messageKey, `media.cost.${billing}`);
    assert.equal((restored.input as { prompt: string }).prompt, '作者原文 — A story');
    for (const locale of MEDIA_ERROR_LOCALES) {
      assert.equal(formatModelError(restored.failure, locale).text, formatMediaDomainError(restored.failure!.messageKey!, {}, locale));
    }
  });
}

test('WP3: old recovery records migrate by code, keep raw diagnostic details, and never parse prose', () => {
  for (const message of ['应用在媒体结果确认前退出', 'Unrelated Spanish: error desconocido']) {
    const restored = failure({ code: 'MEDIA_OUTCOME_UNKNOWN', message, retryable: false });
    assert.equal(restored.messageKey, 'media.recovery_provider_outcome_unknown');
    assert.match(restored.readableError!.detail, new RegExp(message));
    assert.equal(formatModelError(restored, 'fr').text, formatMediaDomainError(restored.messageKey!, {}, 'fr'));
  }
  const unknown = failure({ code: 'NEW_LOCAL_ERROR', message: '不应直接放行的未知错误', retryable: false });
  assert.equal(unknown.messageKey, 'media.unknown');
  assert.match(formatModelError(unknown, 'es').detail, /未知错误/);
  assert.doesNotMatch(formatModelError(unknown, 'es').text, /\p{Script=Han}|model request failed/u);
  const platform = failure({ code: 'MEDIA_REQUEST_FAILED', message: 'The platform rejected the route.', messageKey: 'platform_media.no_route', params: { capability: 'video' }, retryable: false });
  assert.equal(platform.messageKey, 'platform_media.no_route');
  assert.deepEqual(platform.params, { capability: 'video' });
});

test('WP3: model errors retain provider detail while second-argument metadata supports RPC adapters', () => {
  const original = new MediaRuntimeError('REQUEST_REJECTED', mediaMessage('media.music_service_rejected_the_request'), false, undefined, { error: { code: 'content_policy_violation', message: 'Provider safety reason' } });
  assert.equal(original.readableError.kind, 'content_refused');
  assert.equal(original.readableError.providerFailure, true);
  const restored = failure({ code: original.code, message: original.message, readableError: original.readableError, retryable: false });
  assert.equal(restored.readableError?.providerFailure, true);
  assert.equal(formatModelError(restored, 'es').kind, 'content_refused');
  assert.match(original.readableError.detail, /Provider safety reason/);
  const wrapped = new MediaRuntimeError('CANCELLED', { domain: 'media', messageKey: 'media.media_job_was_cancelled', params: {} }, false);
  assert.equal(wrapped.message, 'Media job was cancelled');
  assert.equal(wrapped.readableError.providerFailure, undefined);
  assert.equal(formatModelError(wrapped, 'es', { source: 'own_api' }).action, 'none');
});

test('WP3: persisted failures retain validated comic, model and operation presentation domains', () => {
  for (const domain of ['comic', 'model', 'operation'] as const) {
    const metadata = { domain, kind: 'unknown' as const, messageKey: `${domain}.specific_reason`, params: { count: 2 }, detail: 'Original detail' };
    const restored = failure({ code: 'SUBTASK_FAILED', message: 'Subtask failed', retryable: false, readableError: metadata });
    const roundTrip = failure(JSON.parse(JSON.stringify(restored)));
    assert.equal(roundTrip.domain, domain);
    assert.equal(roundTrip.readableError?.domain, domain);
    assert.equal(roundTrip.messageKey, metadata.messageKey);
    assert.deepEqual(roundTrip.params, metadata.params);
    assert.equal(formatModelError(roundTrip, 'es').text, formatModelError(metadata, 'es').text);
  }
});

test('WP3: adding billing presentation cannot invalidate a pre-migration paid idempotency identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-media-cost-language-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = await MediaJobStore.create({ root });
  const job = await store.enqueue(request, { now });
  const legacyHash = createHash('sha256').update(JSON.stringify({ kind: request.kind, projectId: request.projectId, sceneId: request.sceneId, shotId: request.shotId, input: request.input, cost: request.cost, maxAttempts: 3 })).digest('hex');
  assert.equal(job.payloadHash, legacyHash);
  const file = join(root, MEDIA_QUEUE_FILE);
  const state = JSON.parse(await readFile(file, 'utf8'));
  delete state.jobs[0].cost.messageKey;
  delete state.jobs[0].cost.params;
  await writeFile(file, JSON.stringify(state));
  assert.equal((await store.enqueue(request, { now })).id, job.id);
});

test('WP3: subtitle export preserves authored text and media plans use explicit presentation identities', () => {
  const text = '你好、hello — hola';
  for (const renderer of [renderSrt, renderVtt, renderAss]) assert.ok(renderer([{ text, startFrame: 0, durationFrames: 24 }], 24).includes(text));
  const local = planMediaExecution({ kind: 'subtitle', input: { frameRate: 24, cues: [] } }, []);
  assert.equal(local.messageKey, 'media.plan_local');
  assert.equal(local.domain, 'media');
  assert.doesNotMatch(local.reason, /\p{Script=Han}/u);
  const blocked = planMediaExecution({ kind: 'image', input: request.input }, []);
  assert.equal(blocked.messageKey, 'media.plan_blocked');
});
