import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const runtime = loadCurrentSource(new URL('../../model-runtime/src/errors.ts', import.meta.url));
const { modelFailure, modelFailureText } = loadCurrentSource(new URL('../src/browser/nextmux-model-errors.ts', import.meta.url),
    { '@nextmux/model-runtime/errors': runtime });

for (const code of ['platform_quantity_tariff_required', 'wallet_no_hold_control_unavailable']) {
    test(`${code} survives browser error-card simplification and RPC serialization`, () => {
        const raw = { status: 503, error: { code, message: 'configured no-hold wallet unavailable',
            details: { providerAccepted: false, notDispatched: true, localPolicy: true, retrySafe: false, retryable: false } } };
        const readableError = runtime.classifyModelError(raw, { source: 'relay' });
        for (const value of [raw, JSON.parse(JSON.stringify({ data: { readableError } }))]) {
            for (const locale of runtime.MODEL_ERROR_LOCALES) {
                const expected = runtime.formatModelError(readableError, locale);
                assert.equal(modelFailureText(locale, value, { source: 'relay' }), expected.text);
                const failure = modelFailure(locale, value, { source: 'relay' });
                assert.equal(failure.kind, 'billing_unavailable');
                assert.equal(failure.action, 'none');
                assert.equal(failure.retryable, false);
            }
            assert.match(modelFailureText('zh-CN', value, { source: 'relay' }), /平台计费暂时不可用.*联系平台支持/);
            assert.doesNotMatch(modelFailureText('zh-CN', value, { source: 'relay' }), /no.hold|wallet|503|模型服务暂时发生错误/);
        }
    });
}
