import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AgentRunInterruptedError, type AgentRunCheckpoint } from '@nextmux/agent-runtime';
import { createRequire } from 'node:module';
import { OfficialModelError, boundedSecret, boundedModel, validatedBaseUrl } from '../lib/http.js';
import { normalizeMediaTemplate } from '../lib/media-api-template.js';
import { classifyModelError, formatModelError, hasModelErrorTranslation, MODEL_ERROR_KINDS, MODEL_ERROR_LOCALES } from '../lib/errors.js';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const adapters = ['ai-sdk-adapter', 'anthropic-adapter', 'assistant-output-replay', 'bedrock-discovery', 'client', 'cohere-adapter', 'cohere-attachments', 'discovery', 'gemini-adapter', 'http', 'ollama-adapter', 'ollama', 'openai-adapter', 'openrouter', 'output-parts'];
for (const adapter of adapters) test(`${adapter}: fixed diagnostic text reaching a parent model is English`, async () => {
  const source = await readFile(new URL(`../src/${adapter}.ts`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(`${adapter}.ts`, source, ts.ScriptTarget.Latest, true);
  let checked = 0;
  function visit(node: import('typescript').Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      assert.doesNotMatch(node.text, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, `${adapter}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}`);
      checked += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(checked > 0);
});

test('model diagnostics, stable params, and raw detail survive snapshots used by delegated calls', () => {
  const error = new OfficialModelError('INVALID_REQUEST', 'Invalid model request field', { params: { field: 'provider.order', maximum: 3 }, retrySafe: true });
  const snapshot = JSON.parse(JSON.stringify(error));
  assert.equal(error.message, 'Invalid model request field');
  const checkpoint: AgentRunCheckpoint = { version: 1, runId: 'child', nextTurn: 1, segment: 0, messages: [], seenToolCallIds: [], usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date(0).toISOString() };
  const child = new AgentRunInterruptedError(error, checkpoint);
  assert.equal(child.message, error.message, 'the real child runner preserves the English model diagnostic');
  assert.equal(child.code, error.code);
  assert.equal(snapshot.message, error.message, 'the parent-model error-message path remains English');
  assert.equal(snapshot.messageKey, 'model.invalid_request');
  assert.deepEqual(snapshot.params, { field: 'provider.order', maximum: 3 });
  assert.equal(snapshot.domain, 'model');
  assert.deepEqual(error.data.params, snapshot.params);
  assert.equal(snapshot.retrySafe, true);
  for (const locale of MODEL_ERROR_LOCALES) {
    const shown = formatModelError({ message: error.message, data: error.data }, locale);
    assert.equal(shown.domain, 'model');
    assert.equal(shown.parameter, 'provider.order');
    assert.deepEqual(shown.params, snapshot.params);
    assert.ok(shown.detail.includes(error.message));
    if (locale !== 'en') assert.notEqual(shown.text, formatModelError(error, 'en').text);
  }
});

test('built-in validation errors expose English parent-model messages without altering user values', () => {
  for (const [run, code] of [[() => boundedSecret(''), 'INVALID_API_KEY'], [() => boundedModel(''), 'INVALID_MODEL'], [() => validatedBaseUrl('not a URL', false), 'INVALID_BASE_URL']] as const) {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof OfficialModelError);
      assert.equal(error.code, code);
      assert.match(error.message, /^[A-Za-z]/);
      assert.doesNotMatch(error.message, /\p{Script=Han}/u);
      assert.ok(error.messageKey);
      assert.deepEqual(error.params, {});
      return true;
    });
  }
});

test('unknown domain errors have localized domain fallback and preserved diagnostics, never model advice', () => {
  for (const domain of ['media', 'comic', 'operation'] as const) for (const locale of MODEL_ERROR_LOCALES) {
    const raw = '工程文件无法保存 / opaque_failure_731';
    const metadata = { domain, code: 'UNRECOGNIZED_LOCAL_REASON', messageKey: 'unknown.future.reason', params: { field: 'story.title' }, detail: raw, kind: 'unknown' };
    for (const value of [metadata, { message: raw, readableError: metadata }, { data: { readableError: metadata } }]) {
      const failure = formatModelError(value, locale, { source: 'relay' });
      assert.equal(failure.domain, domain);
      assert.equal(failure.action, 'none');
      assert.equal(failure.retryable, false);
      assert.ok(failure.detail.includes(raw));
      assert.ok(failure.text);
      assert.notEqual(failure.text, raw);
      assert.doesNotMatch(failure.text, /model request|模型请求|模型請求/i);
    }
  }
});

test('translation coverage cannot be satisfied by English fallback', () => {
  const expected = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  assert.deepEqual([...MODEL_ERROR_LOCALES].sort(), expected.sort());
  for (const locale of expected) for (const kind of MODEL_ERROR_KINDS) assert.equal(hasModelErrorTranslation(locale, kind), true, `${locale}/${kind}`);
  assert.equal(hasModelErrorTranslation('unknown-locale', 'unknown'), false);
  assert.equal(hasModelErrorTranslation('en-US', 'unknown'), false, 'aliases are fallback, not a separately authored catalog');
  assert.equal(hasModelErrorTranslation('en', 'missing' as typeof MODEL_ERROR_KINDS[number]), false);
  assert.equal(formatModelError({ kind: 'unknown' }, 'unknown-locale').text, formatModelError({ kind: 'unknown' }, 'en').text);
});

const templateCases: Array<[Record<string, unknown>, string, string]> = [
  [{ submit: { path: 'relative' } }, 'submit.path', 'invalid_path'],
  [{ submit: { body: 'not JSON' } }, 'submit.body', 'invalid_json_object'],
  [{ submit: { body: '' } }, 'submit.body', 'required'],
  [{ submit: { body: 'x'.repeat(8001) } }, 'submit.body', 'too_long'],
  [{ poll: { path: 'relative' } }, 'poll.path', 'invalid_path'],
  [{ poll: { method: 'PUT' } }, 'method', 'invalid_method'],
  [{ downloadPath: 'relative' }, 'downloadPath', 'invalid_path'],
  [{ idField: 'bad path' }, 'idField', 'invalid_field_path'],
  [{ submit: { headers: { Authorization: 'secret' } } }, 'headers', 'header_not_allowed'],
  [{ auth: 'none' }, 'auth', 'invalid_auth'],
  [{ images: 'invalid' }, 'images', 'invalid_images'],
  [{ kind: 'invalid' }, 'kind', 'invalid_kind'],
  [{ referenceAspect: '2:1' }, 'referenceAspect', 'invalid_aspect'],
  [{ kind: 'music', vocalReference: { mode: 'nope' } }, 'vocalReference', 'invalid_mode'],
  [{ kind: 'music', referenceSong: { mode: 'upload', upload: { path: 'bad' } } }, 'referenceSong.upload.path', 'invalid_path'],
];
for (const [draft, field, reason] of templateCases) test(`media template ${field}/${reason}: structured metadata does not require prose parsing`, () => {
  assert.throws(() => normalizeMediaTemplate(draft), (error: unknown) => {
    const structured = error as Error & { code: string; messageKey: string; params: { field: string; reason: string } };
    assert.equal(structured.code, 'media_template_invalid');
    assert.equal(structured.messageKey, 'media_template.invalid');
    assert.equal(structured.params.field, field);
    assert.equal(structured.params.reason, reason);
    assert.ok(classifyModelError(structured).detail.includes(structured.message));
    return true;
  });
});


test('fixed model codes select UI semantics independently of diagnostic prose', () => {
  for (const [code, expected] of [['INVALID_REQUEST', 'invalid_request'], ['DISCOVERY_CREDENTIALS_MISSING', 'auth_missing'], ['INVALID_TOOL_CALL', 'tool_call_invalid'], ['REQUEST_TOO_LARGE', 'upload_too_large']] as const) {
    const error = new OfficialModelError(code, 'Any unrelated diagnostic wording', { params: { field: 'model' } });
    assert.equal(formatModelError(error, 'en').kind, expected);
    assert.equal(formatModelError(JSON.parse(JSON.stringify(error)), 'ja').kind, expected);
  }
});

test('specific media provider failures keep localized quota, rate-limit and refusal diagnoses across RPC snapshots', () => {
  const { MediaRuntimeError } = require('../../media-core/lib/runtime.js');
  const cases = [
    { status: 429, body: { error: { code: 'insufficient_quota', message: 'Monthly quota reached' } } },
    { status: 429, error: { code: 'rate_limit_exceeded', message: 'Too many requests' }, headers: { 'retry-after': '7' } },
    { error: { code: 'content_policy_violation', message: 'Provider safety reason' } },
  ];
  for (const provider of cases) {
    const error = new MediaRuntimeError('REQUEST_REJECTED', { domain: 'media', messageKey: 'media.image_service_rejected_the_request', params: {}, message: 'The image service rejected the request' }, false, undefined, provider);
    for (const value of [error, error.readableError, JSON.parse(JSON.stringify({ code: error.code, message: error.message, data: error.data }))]) {
      for (const locale of MODEL_ERROR_LOCALES) {
        const result = formatModelError(value, locale);
        const expected = formatModelError(provider, locale, { source: 'own_api' });
        assert.equal(result.domain, 'media');
        assert.equal(result.providerFailure, true);
        assert.equal(result.kind, expected.kind, `${locale}: generic media rejection must not hide the provider cause`);
        assert.equal(result.text, expected.text);
        assert.equal(result.action, expected.action);
        assert.ok(result.detail.includes('Monthly quota reached') || result.detail.includes('Too many requests') || result.detail.includes('Provider safety reason'));
      }
    }
  }
});

test('local media business failures remain domain errors even when code words or route context resemble provider failures', () => {
  const { MediaRuntimeError } = require('../../media-core/lib/runtime.js');
  const entry = { domain: 'media', messageKey: 'media.image_service_rejected_the_request', params: {}, message: 'The image service rejected the request' };
  const local = new MediaRuntimeError('REQUEST_REJECTED', entry, false);
  for (const locale of MODEL_ERROR_LOCALES) for (const source of ['own_api', 'relay'] as const) {
    for (const value of [local, { ...entry, code: 'REQUEST_REJECTED', kind: 'invalid_request' }, { ...entry, kind: 'rate_limited', source: 'local' }]) {
      const result = formatModelError(value, locale, { source });
      assert.equal(result.providerFailure, undefined);
      assert.equal(result.kind, 'unknown');
      assert.equal(result.action, 'none');
      assert.equal(result.text, formatModelError(entry, locale).text);
    }
  }
});

test('unknown provider failures still use stable media fallback while explicit provider provenance survives serialization', () => {
  const value = { domain: 'media', messageKey: 'media.unknown.future', params: {}, kind: 'unknown', providerFailure: true, source: 'own_api', detail: 'Opaque upstream diagnostic' };
  for (const locale of MODEL_ERROR_LOCALES) {
    const result = formatModelError(JSON.parse(JSON.stringify(value)), locale);
    assert.equal(result.providerFailure, true);
    assert.equal(result.kind, 'unknown');
    assert.equal(result.action, 'none');
    assert.equal(result.text, formatModelError({ ...value, providerFailure: undefined, source: undefined }, locale).text);
    assert.match(result.detail, /Opaque upstream diagnostic/);
  }
});
