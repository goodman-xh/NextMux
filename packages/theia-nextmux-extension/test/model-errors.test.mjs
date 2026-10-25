import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const runtime = loadCurrentSource(new URL('../../model-runtime/src/errors.ts', import.meta.url));
const dependencies = { '@nextmux/model-runtime/errors': runtime };
const { modelFailure, modelFailureText } = loadCurrentSource(new URL('../src/browser/nextmux-model-errors.ts', import.meta.url), dependencies);
const { DesktopDomainError } = loadCurrentSource(new URL('../src/common/nextmux-domain-errors.ts', import.meta.url));
const { knownDesktopDomainText } = loadCurrentSource(new URL('../src/browser/nextmux-domain-error-locale.ts', import.meta.url), dependencies);
const code = 'TERMINAL_CWD_NOT_ABSOLUTE';
const message = 'The Windows terminal working directory must be an absolute path.';
const diagnostic = 'Windows terminal cwd: C:relative\\项目';

test('Windows unknown failures with a known desktop code keep desktop text through RPC and legacy forms', () => {
    const original = new DesktopDomainError(code, message, undefined, diagnostic);
    const values = [
        original,
        JSON.parse(JSON.stringify({ data: original.data })),
        { code, message: diagnostic },
        { code, message: diagnostic, kind: 'unknown', detail: diagnostic, source: 'own_api' },
        { code, message: diagnostic, data: { readableError: { kind: 'unknown', detail: diagnostic } } }
    ];
    for (const value of values) {
        const expected = knownDesktopDomainText('zh-CN', value);
        assert.equal(expected, 'Windows 终端工作目录必须是绝对路径。');
        const failure = modelFailure('zh-CN', value);
        assert.equal(failure.kind, 'unknown');
        assert.equal(failure.domain, 'operation');
        assert.equal(failure.text, expected);
        assert.equal(modelFailureText('zh-CN', value), expected);
        assert.doesNotMatch(failure.text, /模型请求未完成。/);
        assert.match(failure.detail, /C:relative\\项目/);
        assert.equal(failure.action, 'none');
        assert.equal(failure.actionLabel, '');
        assert.equal(failure.retryable, false);
    }
});

test('known Windows domain errors remain localized for every desktop locale', () => {
    const value = new DesktopDomainError(code, message);
    for (const locale of runtime.MODEL_ERROR_LOCALES) {
        const expected = knownDesktopDomainText(locale, value);
        assert.ok(expected);
        assert.equal(modelFailureText(locale, value), expected);
        assert.notEqual(expected, runtime.formatModelError({ kind: 'unknown', detail: '' }, locale).text);
    }
});

test('explicit model or media identities take precedence over a legacy desktop code', () => {
    for (const domain of ['model', 'media']) {
        const value = { code, domain, messageKey: 'unknown.explicit.identity', kind: 'unknown', detail: diagnostic };
        assert.deepEqual(modelFailure('zh-CN', value), runtime.formatModelError(value, 'zh-CN'));
        assert.equal(modelFailure('zh-CN', value).domain, domain);
    }
});

test('unrecognized failures do not acquire a Windows domain identity from raw prose', () => {
    const value = { code: 'UNRECOGNIZED_WINDOWS_FAILURE', message };
    assert.equal(knownDesktopDomainText('zh-CN', value), undefined);
    assert.equal(modelFailureText('zh-CN', value), '操作未能完成，请查看详情。');
});
