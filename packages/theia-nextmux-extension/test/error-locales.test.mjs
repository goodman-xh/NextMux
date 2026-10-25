import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const { modelErrorLocale } = loadCurrentSource(new URL('../../model-runtime/src/error-locales.ts', import.meta.url));
const { classifyModelError, formatModelError } = loadCurrentSource(new URL('../../model-runtime/src/errors.ts', import.meta.url));

test('Simplified Chinese provider quota errors identify credit and requested-output limits', () => {
    for (const locale of ['zh-CN', 'zh_CN', 'zh']) {
        assert.equal(modelErrorLocale(locale).messages.provider_quota_exhausted, '服务商额度不足，或本次请求的输出上限超出可用额度。');
    }
});

test('an exhausted own API quota keeps the key valid and offers settings through the formatter', () => {
    const value = { status: 429, error: { code: 'insufficient_quota', message: 'Insufficient credits' } };
    const failure = classifyModelError(value, { source: 'own_api' });
    assert.equal(failure.kind, 'provider_quota_exhausted');
    const shown = formatModelError(failure, 'zh-CN');
    assert.ok(shown.text.startsWith('服务商额度不足，或本次请求的输出上限超出可用额度。'));
    assert.doesNotMatch(shown.text, /模型请求未完成。/);
    assert.match(shown.detail, /Insufficient credits/);
    assert.equal(shown.action, 'settings');
    assert.equal(shown.retryable, false);
    assert.match(shown.text, /账户限额/);
    assert.doesNotMatch(shown.text, /密钥无效|请更换/);
});

test('temporary rate limits and NextMux balance errors retain their distinct reasons', () => {
    const limited = formatModelError({ status: 429, error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } }, 'zh-CN', { source: 'own_api' });
    const balance = formatModelError({ code: 'insufficient_balance' }, 'zh-CN', { source: 'relay' });
    assert.equal(limited.kind, 'rate_limited');
    assert.equal(balance.kind, 'balance_insufficient');
    for (const failure of [limited, balance]) assert.ok(!failure.text.includes('服务商额度不足，或本次请求的输出上限超出可用额度。'));
});

test('OpenRouter output reservation 402 is not misreported as invalid credentials', () => {
    const failure = formatModelError({ status: 402, error: { code: 402,
        message: 'This request requires more credits, or fewer max_tokens. You requested up to 393216 tokens, but can only afford 17494.' } }, 'zh-CN', { source: 'own_api' });
    assert.equal(failure.kind, 'provider_quota_exhausted');
    assert.equal(failure.action, 'settings');
    assert.equal(failure.retryable, false);
    assert.match(failure.text, /输出上限/);
    assert.doesNotMatch(failure.text, /密钥无效|API 无法使用|NextMux 余额不足/);
    assert.match(failure.detail, /393216/);
});

test('all twelve quota translations differ from credential errors and preserve relay routing', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const copy = modelErrorLocale(locale);
        const own = formatModelError({ status: 402, error: { code: 'payment_required' } }, locale, { source: 'own_api' });
        const relay = formatModelError({ status: 402, error: { code: 'payment_required' } }, locale, { source: 'relay' });
        assert.ok(copy.messages.provider_quota_exhausted.length > 20, locale);
        assert.notEqual(copy.messages.provider_quota_exhausted, copy.messages.auth_invalid, locale);
        assert.ok(own.text.includes(copy.advice.provider_quota_exhausted), locale);
        assert.equal(own.action, 'settings', locale);
        assert.equal(relay.action, 'switch_relay', locale);
        assert.equal(relay.retryable, false, locale);
    }
    const auth = formatModelError({ status: 401, error: { code: 'invalid_api_key' } }, 'zh-CN', { source: 'own_api' });
    assert.equal(auth.kind, 'auth_invalid');
    assert.match(auth.text, /密钥无效/);
});

test('upstream quota route failure keeps relay action without an explicit source hint', () => {
    const shown = formatModelError({ kind: 'relay_unavailable', code: 'upstream_balance_unavailable', detail: 'Upstream unavailable' }, 'en');
    assert.equal(shown.action, 'switch_relay');
    assert.match(shown.text, /quota|credit/);
});
