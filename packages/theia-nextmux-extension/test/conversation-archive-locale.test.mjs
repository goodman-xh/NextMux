import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveText } from '../lib/browser/nextmux-conversation-archive-locale.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const keys = ['title', 'description', 'privacy', 'exportAll', 'exportSelected', 'chooseArchive', 'previewTitle', 'previewSummary', 'conflicts', 'skipConflicts', 'copyConflicts', 'cancel', 'importNow', 'importing', 'exporting', 'chooseImport', 'chooseExport', 'exported', 'imported', 'failed', 'busyHint', 'historyDisabled', 'saveFailed', 'existing', 'copyExists', 'noConversations', 'warnings'];

test('archive controls and privacy warnings exist in all twelve desktop languages', () => {
    for (const locale of locales) for (const key of keys) {
        const value = archiveText(locale, key);
        assert.equal(typeof value, 'string', `${locale}.${key}`);
        assert.ok(value.trim(), `${locale}.${key}`);
        if (locale !== 'en') assert.notEqual(value, archiveText('en', key), `${locale}.${key} must not silently fall back to English`);
    }
    assert.match(archiveText('en', 'description'), /not project files, credentials or execution queues/);
    assert.match(archiveText('en', 'privacy'), /not encrypted/);
    assert.match(archiveText('en', 'privacy'), /may contain keys/);
});

test('archive preview and outcome counts retain the same placeholders in every language', () => {
    const values = { conversations: 23, attachments: 17, bytes: '512 KiB', count: 11, imported: 7, skipped: 3 };
    for (const locale of locales) for (const key of keys) {
        const expected = [...archiveText('en', key).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        const actual = [...archiveText(locale, key).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        assert.deepEqual(actual, expected, `${locale}.${key}`);
        assert.doesNotMatch(archiveText(locale, key, values), /\{\w+\}/);
    }
});
