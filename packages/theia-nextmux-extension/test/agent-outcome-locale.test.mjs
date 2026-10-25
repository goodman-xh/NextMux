import assert from 'node:assert/strict';
import test from 'node:test';

const {
  agentFailureTitle,
  agentOutcomeText,
  desktopFailureMessage,
  normalizeDesktopFailure,
  runtimeFinalText,
  isModelSwitchPolicyFailure
} = await import(process.env.NEXTMUX_AGENT_OUTCOME_LOCALE_MODULE_URL
  || '../lib/browser/nextmux-agent-outcome-locale.js');

test('output truncation has a localized runtime pause message', () => {
  const result = { stopReason: 'output_truncated', finalText: 'runtime canonical copy', finalMessage: { origin: 'runtime', stopReason: 'output_truncated' } };
  assert.match(runtimeFinalText('en', result), /output limit without making progress/);
  assert.match(runtimeFinalText('zh-CN', result), /没有新进展.*暂停/);
  assert.doesNotMatch(runtimeFinalText('zh-CN', result), /output_truncated/);
});

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const keys = ['completed', 'paused', 'mediaContextPaused', 'mediaContextBody', 'cancelled', 'model_timeout', 'rate_limited', 'model_unavailable', 'model_auth', 'tool_failed', 'waiting_user', 'insufficient_balance', 'switch_policy_invalid', 'route_unavailable', 'privacy_route_unavailable', 'model_not_ready', 'price_changed', 'network_failed', 'failed', 'continueTask', 'resumeContextHint', 'cancelledBody', 'fallbackBody'];

test('agent terminal outcomes are available in every desktop language', () => {
  for (const locale of locales) {
    for (const key of keys) assert.ok(agentOutcomeText(locale, key).trim(), `${locale}:${key}`);
  }
});

test('custom API socket errors and legacy official wording use localized source-neutral network text', () => {
  for (const locale of locales) {
    for (const message of ['无法连接官方模型服务', '无法连接模型服务']) {
      const failure = { code: 'UND_ERR_SOCKET', message, kind: 'failed', retryable: true, retrySafe: false, resumable: false };
      assert.equal(desktopFailureMessage(locale, failure), agentOutcomeText(locale, 'network_failed'));
      assert.equal(desktopFailureMessage(locale, message), agentOutcomeText(locale, 'network_failed'));
      const normalized = normalizeDesktopFailure(locale, failure);
      assert.equal(normalized.code, failure.code);
      assert.equal(normalized.kind, failure.kind);
      assert.equal(normalized.retryable, true);
      assert.notEqual(normalized.retrySafe, true);
      if (locale !== 'en') assert.notEqual(normalized.message, agentOutcomeText('en', 'network_failed'));
    }
  }
});

test('stable failure categories select a specific title', () => {
  assert.equal(agentFailureTitle('en', { code: 'TIMEOUT', message: 'timeout', kind: 'model_timeout', retryable: true, resumable: true }), 'Model connection timed out');
  assert.equal(agentFailureTitle('zh-CN', { code: 'PROCESS_START_FAILED', message: 'failed', kind: 'tool_failed', retryable: false, resumable: true }), '工具执行需要处理');
  assert.equal(agentFailureTitle('zh-CN', { code: 'wallet_balance_insufficient', message: 'failed', kind: 'waiting_user', retryable: false, resumable: false }), '余额不足 · 请充值后继续');
});

test('gateway failures are safe and localized for the conversation surface', () => {
  const invalidPolicy = { code: 'SWITCH_POLICY_INVALID', message: 'Invalid model-switch policy', kind: 'failed', retryable: false, resumable: false };
  assert.equal(desktopFailureMessage('en', invalidPolicy), 'Model-switch settings are invalid. Choose the model again and retry.');
  assert.equal(desktopFailureMessage('zh-CN', { code: 'WALLET_BALANCE_INSUFFICIENT', status: 402, message: 'insufficient balance' }), '余额不足 · 请充值后继续');
  const normalized = normalizeDesktopFailure('en', invalidPolicy);
  assert.equal(normalized.code, 'SWITCH_POLICY_INVALID');
  assert.equal(normalized.message, 'Model-switch settings are invalid. Choose the model again and retry.');
  assert.equal(isModelSwitchPolicyFailure(invalidPolicy), true);
  assert.equal(isModelSwitchPolicyFailure('模型切换设置已失效，请重新选择模型后重试。'), true,
    'live legacy error strings are recognized before a structured failure is persisted');
});

test('nested gateway envelopes preserve actionable balance failures', () => {
  for (const value of [
    { error: { code: 'wallet_balance_insufficient', status: 402, message: 'Add funds' } },
    { failure: { code: 'WALLET_BALANCE_INSUFFICIENT', httpStatus: 402 } },
    { details: { code: 'insufficient_balance', message: 'insufficient balance' } }
  ]) {
    assert.equal(desktopFailureMessage('zh-CN', value), '余额不足 · 请充值后继续');
    const normalized = normalizeDesktopFailure('zh-CN', value);
    assert.ok(['WALLET_BALANCE_INSUFFICIENT', 'INSUFFICIENT_BALANCE'].includes(normalized.code.toUpperCase()));
    assert.equal(normalized.kind, 'waiting_user');
  }
});

test('legacy privacy route failures map to route_unavailable instead of blaming privacy settings', () => {
  const failure = { code: 'ROUTE_PRIVACY_UNAVAILABLE', status: 400, message: 'No available route meets your privacy settings' };
  assert.equal(desktopFailureMessage('zh-CN', failure), agentOutcomeText('zh-CN', 'route_unavailable'));
  assert.equal(desktopFailureMessage('en', failure), agentOutcomeText('en', 'route_unavailable'));
  assert.equal(normalizeDesktopFailure('zh-CN', failure).kind, 'model_unavailable');
});

test('upstream route failures never leak internal gateway codes', () => {
  assert.equal(desktopFailureMessage('zh-CN', { code: 'upstream_model_unsupported', status: 502, message: 'This credential does not support the selected model' }), '当前模型线路暂时不可用，请选择其他线路后重试。');
  assert.equal(desktopFailureMessage('en', { code: 'upstream_credential_invalid', status: 502, message: 'The selected route needs a replacement credential' }), 'Model connection needs attention');
  assert.equal(desktopFailureMessage('en', { code: 'upstream_rate_limited', status: 503, message: 'The selected route is rate limited' }), 'Model rate limit reached');
  assert.equal(desktopFailureMessage('en', { code: 'upstream_balance_unavailable', status: 503, message: 'The selected route has insufficient upstream balance' }), 'Model service is temporarily unavailable');
  assert.equal(normalizeDesktopFailure('en', { code: 'upstream_model_unsupported', status: 502, message: 'unsupported' }).kind, 'model_unavailable');
});


test('actual price-quote 409 envelope keeps actionable copy despite unknown readable metadata in every language', () => {
  const original = {
    code: 'PRICE_QUOTE_CHANGED', message: 'Refresh the model catalog and confirm the current price before sending again',
    readableError: { kind: 'unknown', detail: 'Model request failed\nRefresh the model catalog and confirm the current price before sending again price_quote_changed\nPRICE_QUOTE_CHANGED',
      httpStatus: 409, code: 'PRICE_QUOTE_CHANGED', source: 'relay' },
    kind: 'waiting_user', retryable: false, resumable: false, retrySafe: false,
    billing: { kind: 'platform', currency: 'USD', chargedMicros: 1333, requestCount: 1 }
  };
  const before = structuredClone(original);
  for (const locale of locales) {
    for (const error of [original, { failure: original }, { error: original }]) {
      assert.equal(desktopFailureMessage(locale, error), agentOutcomeText(locale, 'price_changed'));
      const normalized = normalizeDesktopFailure(locale, error);
      assert.equal(normalized.message, agentOutcomeText(locale, 'price_changed'));
      assert.equal(normalized.code, 'PRICE_QUOTE_CHANGED');
      assert.equal(normalized.kind, 'waiting_user'); assert.equal(normalized.retryable, false); assert.equal(normalized.resumable, false);
      assert.notEqual(normalized.retrySafe, true); assert.deepEqual(normalized.billing, original.billing);
      // Actual snapshots are top-level; the provider classifier also supports
      // an error envelope. Its pre-existing failure-wrapper detail handling is
      // outside this presentation precedence change.
      if (!('failure' in error)) {
        assert.match(normalized.readableError.detail, /price_quote_changed|PRICE_QUOTE_CHANGED/);
        assert.match(normalized.readableError.detail, /Refresh the model catalog/);
      }
    }
  }
  assert.deepEqual(original, before, 'presentation does not rewrite original diagnostic evidence or billable usage');
});

test('explicit known price codes precede unknown metadata without reclassifying arbitrary provider messages', () => {
  for (const code of ['PRICE_QUOTE_INVALID', 'PRICE_AUTHORIZATION_INVALID', 'PRICE_QUOTE_CHANGED', 'PRICE_CHANGED']) {
    const error = { code: code.toLowerCase(), message: 'Original diagnostic', readableError: { kind: 'unknown', detail: 'Original diagnostic', code, source: 'relay' } };
    assert.equal(desktopFailureMessage('en', error), agentOutcomeText('en', 'price_changed'));
  }
  const other = { code: 'UNRELATED_PROVIDER_FAILURE', message: 'price quote changed in arbitrary provider text',
    readableError: { kind: 'unknown', detail: 'price quote changed in arbitrary provider text', source: 'relay' } };
  assert.notEqual(desktopFailureMessage('en', other), agentOutcomeText('en', 'price_changed'));
});

test('provider prose mentioning prices does not claim a platform quote change without its protocol code', () => {
  for (const message of [
    'price quote changed in arbitrary provider text',
    'The price authorization was invalid in an unrelated example.',
    '报价没有变化，这是上游返回的示例文本。'
  ]) {
    for (const value of [
      message,
      { message },
      { code: 'UNRELATED_PROVIDER_FAILURE', message },
      { message, readableError: { kind: 'unknown', detail: message, source: 'relay' } },
      { failure: { code: 'UNRELATED_PROVIDER_FAILURE', message,
        readableError: { kind: 'unknown', detail: message, source: 'relay' } } }
    ]) {
      const before = structuredClone(value);
      for (const locale of locales) {
        assert.notEqual(desktopFailureMessage(locale, value), agentOutcomeText(locale, 'price_changed'));
        assert.notEqual(normalizeDesktopFailure(locale, value).message, agentOutcomeText(locale, 'price_changed'));
      }
      assert.deepEqual(value, before);
    }
  }
});
