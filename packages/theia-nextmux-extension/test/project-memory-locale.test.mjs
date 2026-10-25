import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { projectMemoryText, projectMemoryTextKeys, projectMemoryTranslationCount, projectMemoryErrorKey } from '../lib/browser/nextmux-project-memory-locale.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('all twelve languages cover memory controls, adoption review, empty states and errors', () => {
    for (const locale of locales) {
        assert.equal(projectMemoryTranslationCount(locale), projectMemoryTextKeys.length, locale);
        for (const key of projectMemoryTextKeys) {
            const text = projectMemoryText(locale, key);
            assert.ok(text?.trim(), `${locale}.${key}`);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u, `${locale}.${key}`);
        }
        if (locale !== 'en') for (const key of ['title', 'empty', 'adoptHint', 'verificationPlaceholder', 'conflict', 'failed']) {
            assert.notEqual(projectMemoryText(locale, key), projectMemoryText('en', key), `${locale}.${key} must not fall back to English`);
        }
    }
});

test('version and date interpolation remains consistent across every language', () => {
    for (const locale of locales) for (const key of projectMemoryTextKeys) {
        const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        assert.deepEqual(placeholders(projectMemoryText(locale, key)), placeholders(projectMemoryText('en', key)), `${locale}.${key}`);
        assert.doesNotMatch(projectMemoryText(locale, key, { version: '42', date: '2026-09-19' }), /\{\w+\}/);
    }
    assert.match(projectMemoryText('fr', 'version', { version: '42', date: '2026-09-19' }), /42.*2026-09-19/);
});

test('host error codes and RPC messages resolve to translated guidance without echoing private diagnostics', () => {
    const cases = [
        [{ code: 'PROJECT_MEMORY_CONFLICT' }, 'conflict'],
        [{ code: -32603, data: { code: 'PROJECT_MEMORY_CONFLICT' }, message: 'Internal error' }, 'conflict'],
        [new Error('Memory changed; reload before saving'), 'conflict'],
        [new Error('Review the current memory revision before adopting'), 'conflict'],
        [{ code: 'PROJECT_MEMORY_SCOPE' }, 'scope'], [{ code: 'INVALID_WORKSPACE' }, 'scope'],
        [{ code: 'PROJECT_MEMORY_TOO_LARGE' }, 'tooLarge'], [{ code: 'PROJECT_MEMORY_FULL' }, 'full'],
        [{ code: 'PROJECT_MEMORY_NOT_FOUND' }, 'notFound'], [{ code: 'EEXIST' }, 'exists'],
        [{ code: 'PROJECT_MEMORY_INVALID' }, 'invalid'],
        [new Error('Sensitive diagnostic /private/project/value'), 'failed']
    ];
    for (const [error, key] of cases) {
        assert.equal(projectMemoryErrorKey(error), key);
        for (const locale of locales) assert.doesNotMatch(projectMemoryText(locale, projectMemoryErrorKey(error)), /Sensitive diagnostic|\/private\/project/);
    }
    assert.equal(projectMemoryErrorKey(new Error('network'), 'loadFailed'), 'loadFailed');
    const key = projectMemoryErrorKey({ code: 'PROJECT_MEMORY_CONFLICT' });
    assert.notEqual(projectMemoryText('en', key), projectMemoryText('ja', key), 'an existing error can follow a locale change');
});

test('real memory panel renders localized labels, placeholders and Arabic direction', () => {
    const require = createRequire(import.meta.url);
    const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
    const React = coreRequire('react');
    const { renderToStaticMarkup } = coreRequire('react-dom/server');
    const originalCssLoader = require.extensions['.css'];
    require.extensions['.css'] = () => undefined;
    let ProjectMemoryPanel;
    try { ({ ProjectMemoryPanel } = require('../lib/browser/nextmux-project-memory-panel.js')); }
    finally {
        if (originalCssLoader) require.extensions['.css'] = originalCssLoader;
        else delete require.extensions['.css'];
    }
    const escape = text => renderToStaticMarkup(React.createElement(React.Fragment, null, text));
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(ProjectMemoryPanel, {
            locale, workspaceRoot: '/projects/example', api: {}, onClose() {}, onOpenFile() {}, async onOpenDesign() {}
        }));
        for (const key of ['title', 'close', 'intro', 'createDesign', 'refresh', 'new', 'loading', 'save', 'sourceHelp', 'contentPlaceholder']) {
            assert.ok(html.includes(escape(projectMemoryText(locale, key))), `${locale}.${key}`);
        }
        assert.equal(html.includes('dir="rtl"'), locale === 'ar');
        assert.ok(html.includes('data-nmx-literal="true"'), 'the global text translator must preserve these locale-aware labels');
        assert.match(html, /dir="ltr"[^>]*>user:/, 'source prefixes remain editable in their stable storage syntax');
    }
});
