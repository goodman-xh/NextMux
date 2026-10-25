import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyModelError, formatModelError, MODEL_ERROR_LOCALES, type ModelErrorKind } from '../lib/errors.js';

const cases: ReadonlyArray<readonly [string, ModelErrorKind]> = [
  ['image_reference_unsupported', 'model_not_supported_here'],
  ['media_model_kind_unsupported', 'model_not_supported_here'],
  ['upstream_media_protocol_unsupported', 'model_not_supported_here'],
  ['video_model_kind_unsupported', 'model_not_supported_here'],
  ['upstream_video_protocol_unsupported', 'model_not_supported_here'],
  ['media_reference_required', 'invalid_request'],
  ['video_reference_required', 'invalid_request'],
  ['video_duration_unsupported', 'invalid_request'],
  ['video_aspect_unsupported', 'invalid_request'],
  ['video_resolution_unsupported', 'invalid_request'],
  ['video_request_shape_unsupported', 'invalid_request'],
];

for (const [code, expectedKind] of cases) {
  test(`comic admission ${code} uses localized guidance and preserves diagnostics`, () => {
    const value = { status: 400, error: {
      code, message: 'Admission diagnostic: selected route cannot accept these settings.',
      parameter: 'video.durationSeconds', details: { providerCode: 'opaque-provider-diagnostic' },
    } };
    const classified = classifyModelError(value, { source: 'relay' });
    assert.equal(classified.kind, expectedKind);
    assert.equal(classified.code, code);
    assert.equal(classified.httpStatus, 400);
    assert.equal(classified.parameter, 'video.durationSeconds');
    assert.match(classified.detail, /Admission diagnostic/);
    assert.ok(classified.detail.includes(code));
    assert.match(classified.detail, /opaque-provider-diagnostic/);
    const english = formatModelError(value, 'en', { source: 'relay' });
    assert.equal(english.action, expectedKind === 'model_not_supported_here' ? 'switch_model' : 'settings');
    assert.equal(english.retryable, false);
    for (const locale of MODEL_ERROR_LOCALES) {
      const formatted = formatModelError(value, locale, { source: 'relay' });
      assert.equal(formatted.kind, expectedKind);
      assert.ok(formatted.text.length > 12, locale);
      assert.ok(formatted.actionLabel, locale);
      assert.doesNotMatch(formatted.text, /Admission diagnostic|opaque-provider-diagnostic|undefined|null/);
      assert.equal(formatted.detail, classified.detail);
      assert.equal(formatted.retryable, false);
      if (locale !== 'en') assert.notEqual(formatted.text, english.text, locale);
    }
    assert.match(formatModelError(value, 'zh-CN', { source: 'relay' }).text,
      expectedKind === 'model_not_supported_here' ? /模型|支持/ : /请求|参数/);
  });
}

test('comic admission wrappers preserve the recorded upstream diagnosis', () => {
  const result = classifyModelError({ code: 'video_reference_required', status: 400,
    readableError: { kind: 'content_refused', detail: 'Recorded provider moderation diagnostic', source: 'own_api' },
  }, { source: 'relay' });
  assert.equal(result.kind, 'content_refused');
  assert.equal(result.source, 'own_api');
  assert.match(result.detail, /Recorded provider moderation diagnostic/);
  assert.match(result.detail, /video_reference_required/);
});
