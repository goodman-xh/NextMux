import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Load the changed source without depending on concurrently generated package output.
const require = createRequire(import.meta.url);
function loadSource(relativePath, dependencies = {}) {
    const module = { exports: {} };
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    } }).outputText;
    new Function('require', 'module', 'exports', output)(
        name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), module, module.exports);
    return module.exports;
}
const archive = loadSource('../../model-runtime/src/platform-media-archive-locales.ts');
const catalog = loadSource('../../model-runtime/src/platform-media-error-locales.ts', {
    './platform-media-archive-locales.js': archive
});
const messages = loadSource('../src/common/nextmux-media-messages.ts', {
    '@nextmux/model-runtime/errors': { ...require('@nextmux/model-runtime/errors'), ...catalog }
});
const { fetchMediaWithLifetime, assertVideoContainer } = loadSource('../src/node/nextmux-media-transfer.ts', {
    '../common/nextmux-media-messages': messages
});

function checkMetadata(error, code, key, params = {}, retryable = false) {
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal(error.messageKey, `platform_media.${key}`);
    assert.deepEqual(error.params, params);
    assert.equal(error.readableError.domain, 'media');
    assert.equal(error.readableError.code, code);
    assert.equal(error.readableError.messageKey, error.messageKey);
    assert.deepEqual(error.readableError.params, params);
    assert.doesNotMatch(error.message, /\p{Script=Han}/u);
    assert.notEqual(error.message, 'Media operation failed.');
    return true;
}

test('transfer reasons have explicit twelve-locale messages and preserve millisecond values', () => {
    for (const key of ['media_cancelled', 'transfer_idle_timeout', 'transfer_total_timeout', 'video_container_invalid']) {
        const params = key.includes('timeout') ? { timeoutMs: 1250, timeoutKind: key.includes('idle') ? 'idle' : 'total' } : {};
        const english = catalog.formatPlatformMediaError(`platform_media.${key}`, params, 'en');
        for (const locale of catalog.PLATFORM_MEDIA_LOCALES) {
            const text = catalog.formatPlatformMediaError(`platform_media.${key}`, params, locale);
            assert.ok(text, `${key}/${locale}`);
            assert.doesNotMatch(text, /\{[^}]+\}/u, `${key}/${locale}`);
            if (locale !== 'en') assert.notEqual(text, english, `${key}/${locale} must not use the English fallback`);
            if (key.includes('timeout')) assert.ok(text.includes('1250'), `${key}/${locale}`);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u);
        }
    }
    for (const locale of catalog.PLATFORM_MEDIA_LOCALES) {
        assert.notEqual(catalog.formatPlatformMediaError('platform_media.transfer_idle_timeout', { timeoutMs: 1250 }, locale),
            catalog.formatPlatformMediaError('platform_media.transfer_total_timeout', { timeoutMs: 1250 }, locale));
    }
});

test('pre-aborted transfers preserve cancellation behavior and semantic metadata', async () => {
    const caller = new AbortController();
    caller.abort();
    let fetched = false;
    await assert.rejects(fetchMediaWithLifetime(async () => { fetched = true; }, 'https://fixture.invalid', {}, caller.signal),
        error => checkMetadata(error, 'CANCELLED', 'media_cancelled'));
    assert.equal(fetched, false);
});

test('waiting for headers uses the idle deadline and aborts the fetch with the structured error', async () => {
    let fetchSignal;
    await assert.rejects(fetchMediaWithLifetime((_url, init) => new Promise((_resolve, reject) => {
        fetchSignal = init.signal;
        fetchSignal.addEventListener('abort', () => reject(fetchSignal.reason), { once: true });
    }), 'https://fixture.invalid', {}, new AbortController().signal, 20, 1000, 2000),
    error => checkMetadata(error, 'MEDIA_TIMEOUT', 'transfer_idle_timeout', { timeoutKind: 'idle', timeoutMs: 20 }, true));
    assert.equal(fetchSignal.aborted, true);
});

for (const kind of ['idle', 'total']) {
    test(`a stalled response body reports the ${kind} timeout and cancels the reader`, async () => {
        let fetchSignal, cancelled = 0;
        const response = await fetchMediaWithLifetime(async (_url, init) => {
            fetchSignal = init.signal;
            return new Response(new ReadableStream({ cancel() { cancelled++; } }));
        }, 'https://fixture.invalid', {}, new AbortController().signal, 1000,
        kind === 'idle' ? 20 : 1000, kind === 'total' ? 20 : 2000);
        await assert.rejects(response.arrayBuffer(), error => checkMetadata(error, 'MEDIA_TIMEOUT', `transfer_${kind}_timeout`,
            { timeoutKind: kind, timeoutMs: 20 }, true));
        assert.equal(fetchSignal.aborted, true);
        assert.equal(cancelled, 1);
    });
}

test('supported containers retain their MIME behavior; rejected data has a semantic error', () => {
    const mp4 = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom')]);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    assert.equal(assertVideoContainer(mp4, 'application/octet-stream'), 'video/mp4');
    assert.equal(assertVideoContainer(mp4, 'video/quicktime'), 'video/quicktime');
    assert.equal(assertVideoContainer(webm, 'application/octet-stream'), 'video/webm');
    for (const [prefix, mime] of [[mp4, 'text/html'], [Buffer.from('{"error":"failed"}'), 'video/mp4'],
        [Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypavif')]), 'video/mp4']]) {
        assert.throws(() => assertVideoContainer(prefix, mime), error => checkMetadata(error, 'INVALID_VIDEO_OUTPUT', 'video_container_invalid'));
    }
});
