import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyModelError, formatModelError, MODEL_ERROR_LOCALES } from '../lib/errors.js';

const codes = ['platform_quantity_tariff_required', 'wallet_no_hold_control_unavailable'];
const refusal = (code: string) => ({ status: 503, error: { code,
  message: 'Token billing requires the configured no-hold wallet; no model request was sent',
  details: { providerAccepted: false, notDispatched: true, localPolicy: true,
    retrySafe: false, retryable: false, reasonCode: 'platform_usage_tariff_missing' } } });

test('known billing admission refusals retain their cause through HTTP and persisted error wrappers', () => {
  for (const code of codes) {
    const wire = refusal(code);
    for (const value of [wire, { responseBody: JSON.stringify(wire), statusCode: 503 },
      { code: code.toUpperCase(), httpStatus: 503, kind: 'provider_error', source: 'relay' }]) {
      const failure = classifyModelError(value, { source: 'relay' });
      assert.equal(failure.kind, 'billing_unavailable');
      assert.equal(failure.httpStatus, 503);
      assert.match(failure.detail, new RegExp(code, 'i'));
      assert.equal(formatModelError(JSON.parse(JSON.stringify(failure)), 'zh-CN').kind, 'billing_unavailable');
    }
  }
});

test('all 12 locales explain billing unavailability without exposing implementation or inviting retry', () => {
  assert.equal(MODEL_ERROR_LOCALES.length, 12);
  for (const code of codes) {
    const texts = new Set<string>();
    for (const locale of MODEL_ERROR_LOCALES) {
      const failure = formatModelError(refusal(code), locale, { source: 'relay' });
      assert.equal(failure.action, 'none', locale);
      assert.equal(failure.actionLabel, '', locale);
      assert.equal(failure.retryable, false, locale);
      assert.ok(failure.text.length > 20, locale);
      assert.doesNotMatch(failure.text, /no.hold|wallet|tariff|required|NO_HOLD_V1|Durable Object|503|platform_usage/i, locale);
      texts.add(failure.text);
    }
    assert.equal(texts.size, 12);
    const chinese = formatModelError(refusal(code), 'zh-CN', { source: 'relay' });
    assert.match(chinese.text, /平台计费暂时不可用.*尚未发送给模型.*联系平台支持/);
    assert.doesNotMatch(chinese.text, /模型服务暂时发生错误|稍后重试|充值|切换中转|核账/);
  }
});

test('billing implementation details stay in the diagnostic disclosure', () => {
  const failure = formatModelError({ ...refusal(codes[1]),
    parameter: 'NO_HOLD_V1', providerReason: 'Durable Object wallet control unavailable' }, 'zh-CN', { source: 'relay' });
  assert.equal(failure.kind, 'billing_unavailable');
  assert.match(failure.detail, /Durable Object/);
  assert.doesNotMatch(failure.text, /Durable Object|NO_HOLD_V1|wallet/);
});

test('accepted outcome uncertainty is never replaced by a not-dispatched billing message', () => {
  for (const code of codes) {
    for (const guard of [{ acceptanceUnknown: true }, { recoveryMode: 'billing_review' }, { kind: 'billing_review_required' }]) {
      const failure = formatModelError({ ...refusal(code), ...guard }, 'zh-CN', { source: 'relay' });
      assert.equal(failure.kind, 'billing_review_required');
      assert.equal(failure.action, 'none');
      assert.doesNotMatch(failure.text, /尚未发送给模型/);
    }
    assert.equal(classifyModelError({ ...refusal(code), code: 'BILLING_INITIALIZATION_PENDING' }).kind, 'request_initialization_pending');
  }
});

test('unrecognized 503 errors retain existing provider error handling', () => {
  const failure = formatModelError({ status: 503, error: { code: 'provider_unavailable' } }, 'zh-CN');
  assert.equal(failure.kind, 'provider_error');
  assert.equal(failure.action, 'retry');
});
