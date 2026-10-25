import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ConversationArchivePanel } from '../lib/browser/nextmux-conversation-archive-panel.js';
import { archiveText } from '../lib/browser/nextmux-conversation-archive-locale.js';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react');
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const base = { locale: 'en', service: {}, disabled: false, historyEnabled: true, sessionIds: ['a'], selectedSessionId: 'a',
    chooseFile: async () => undefined, beforeOperation: async () => undefined, afterImport: async () => undefined };
const render = patch => renderToStaticMarkup(React.createElement(ConversationArchivePanel, { ...base, ...patch }));

test('real archive component renders localized controls and explicit plaintext privacy guidance', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const html = render({ locale });
        assert.ok(html.includes(archiveText(locale, 'title')));
        assert.ok(html.includes(archiveText(locale, 'privacy')));
        assert.equal((html.match(/<button(?:\s|>)/g) || []).length, 2);
        assert.doesNotMatch(html, /disabled=""/);
    }
});

test('real archive component gates transfer for running tasks, disabled history and absent selections', () => {
    for (const patch of [{ disabled: true }, { historyEnabled: false }]) assert.equal((render(patch).match(/disabled=""/g) || []).length, 2);
    assert.ok(render({ disabled: true }).includes(archiveText('en', 'busyHint')));
    assert.ok(render({ historyEnabled: false }).includes(archiveText('en', 'historyDisabled')));
    assert.equal((render({ sessionIds: [], selectedSessionId: undefined }).match(/disabled=""/g) || []).length, 1);
});

test('archive panel contract locks synchronously and invalidates old previews before replacement or post-import refresh', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-conversation-archive-panel.tsx', import.meta.url), 'utf8');
    assert.match(source, /if \(operation\.current \|\| props\.disabled \|\| !props\.historyEnabled\) return;\s*operation\.current = true;/);
    assert.match(source, /finally \{ operation\.current = false; setBusy\(false\); \}/);
    const choose = source.slice(source.indexOf('const chooseArchive'), source.indexOf('const importFile'));
    assert.ok(choose.indexOf('setPreview(undefined)') < choose.indexOf('previewConversationArchive(uri)'));
    const importing = source.slice(source.indexOf('const importFile'), source.indexOf('const conflicts'));
    assert.ok(importing.indexOf('setPreview(undefined)') < importing.indexOf('await props.afterImport(result)'));
    assert.match(source, /role=\{error \? 'alert' : 'status'\}/);
    assert.match(source, /t\(message\.key, message\.values\)/, 'finished operation labels follow locale changes without erasing the preview');
});
