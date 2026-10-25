import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { BillingReceiptPanel } from '../lib/browser/nextmux-billing-receipt-panel.js';
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const id = '00000000-0000-4000-8000-000000000001';
class Service extends NextMuxPlatformServiceImpl { async deviceId() { return 'fixture-device-00000001'; } }

test('restart receipt RPC only posts the owned original recovery URL and exposes no executable tools/private state', async () => {
    const service = new Service(); const calls = [];
    service.networkFetch = async (url, init) => {
        calls.push({ url, init });
        return Response.json({ call: { id }, response: { model: 'fixture', content: '<script>never execute</script>', toolCalls: [{ name: 'delete' }], providerState: { secret: 'not exposed' } }, billing: { currency: 'USD', chargedMicros: 1000 } });
    };
    const receipt = await service.recoverManagedReceipt(id);
    assert.equal(receipt.status, 'recovered');
    assert.deepEqual(receipt.result, { model: 'fixture', content: '<script>never execute</script>', toolCallCount: 1, currency: 'USD', chargedMicros: 1000 });
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, `/api/gateway/responses/${id}/recover`);
    assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.body, undefined);
    await assert.rejects(service.recoverManagedReceipt('../responses'), { code: 'INVALID_REQUEST_ID' });
    assert.equal(calls.length, 1);
});

test('pending, review and expired are distinct; auth and foreign IDs never become successful recovery', async () => {
    const service = new Service();
    for (const [code, expected] of [['billing_finalization_pending', 'pending'], ['billing_review_required', 'review'], ['response_replay_expired', 'expired']]) {
        service.networkFetch = async () => Response.json({ ok: false, code, message: 'fixture', requestId: id }, { status: 409 });
        assert.equal((await service.recoverManagedReceipt(id)).status, expected);
    }
    service.networkFetch = async () => Response.json({ ok: false, code: 'billing_recovery_rate_limited', requestId: id, recoveryMode: 'billing_review' }, { status: 429, headers: { 'retry-after': '10' } });
    const review = await service.recoverManagedReceipt(id);
    assert.equal(review.status, 'review'); assert.equal(review.retryAfterMs, 10_000);
    service.networkFetch = async () => Response.json({ ok: false, code: 'device_auth_required', message: 'fixture' }, { status: 401 });
    await assert.rejects(service.recoverManagedReceipt(id), { code: 'device_auth_required' });
    service.networkFetch = async () => Response.json({ call: { id: 'other' }, response: { content: 'private' }, billing: { currency: 'USD', chargedMicros: 0 } });
    await assert.rejects(service.recoverManagedReceipt(id), { code: 'INVALID_BILLING_RECEIPT' });
});

test('recovery entry is localized, bounded, account-owned and does not share composer/queue/tool paths', async () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'ru', 'ar', 'hi']) {
        const markup = renderToStaticMarkup(React.createElement(BillingReceiptPanel, { locale, service: {}, usage: [], afterRecovery: async () => {} }));
        assert.doesNotMatch(markup, /undefined|dangerouslySetInnerHTML/);
        assert.match(markup, /maxlength="36"/i); assert.match(markup, /novalidate/);
    }
    const source = await readFile(new URL('../src/browser/nextmux-billing-receipt-panel.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /completeManagedGateway|startAgentRun|answerAgent|taskQueue|dangerouslySetInnerHTML/);
    assert.match(source, /if \(!active.current\) return/);
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(widget, /<BillingReceiptPanel\b/, 'advanced request recovery stays out of the normal settings page');
});
