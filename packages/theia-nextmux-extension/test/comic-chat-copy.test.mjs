import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { comicChatText, COMIC_CHAT_TEXT_LOCALES } from '../lib/browser/nextmux-comic-chat-text.js';
import { deskText, COMIC_DESK_LOCALES } from '../lib/browser/nextmux-comic-desk.js';

const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

/** Keys of one locale's table, read from the source (the tables are module-private). */
function tableKeys(file, variable) {
    const source = readFileSync(new URL(`../src/browser/${file}`, import.meta.url), 'utf8');
    const start = source.indexOf(`const ${variable}`);
    const body = source.slice(start, source.indexOf('\n};', start));
    return [...body.matchAll(/(?:^|[\s,{])([A-Za-z][A-Za-z0-9]*):\s*'/g)].map(match => match[1]);
}

test('漫剧对话 copy exists in all 12 languages with the same placeholders', () => {
    assert.deepEqual([...COMIC_CHAT_TEXT_LOCALES].sort(), [...LOCALES].sort());
    const keys = tableKeys('nextmux-comic-chat-text.ts', 'zhCN');
    for (const key of ['recommended', 'modelTabAgent', 'useForAll', 'noModelHere', 'scopeChat', 'scopeAll', 'addFolder', 'removeFolder', 'recent', 'folderIsComic', 'alreadyInEditor',
        'videoSaved', 'thisChat', 'otherChats', 'allMaterials', 'fromCast', 'chooseFolder']) assert.ok(keys.includes(key), key);
    for (const key of keys) {
        const reference = placeholders(comicChatText('zh-CN', key));
        for (const locale of LOCALES) {
            const text = comicChatText(locale, key);
            assert.ok(text.trim(), `${locale}.${key} is empty`);
            assert.equal(placeholders(text), reference, `${locale}.${key} placeholders`);
        }
    }
    // Every locale spells the new keys itself (no silent fallback to English).
    for (const locale of LOCALES.filter(locale => locale !== 'en')) {
        const variable = { 'zh-CN': 'zhCN', 'zh-TW': 'zhTW', 'pt-BR': 'ptBR' }[locale] || locale;
        const own = new Set(tableKeys('nextmux-comic-chat-text.ts', variable));
        for (const key of ['recommended', 'alreadyInEditor', 'folderIsComic', 'scopeAll']) assert.ok(own.has(key), `${locale} lacks ${key}`);
    }
});

test('制作台 review and confirmation copy exists in all 12 languages with the same placeholders', () => {
    assert.deepEqual([...COMIC_DESK_LOCALES].sort(), [...LOCALES].sort());
    const keys = ['reviewLead', 'looksTitle', 'episodesTitle', 'rewriteLook', 'drawOne', 'drawAll', 'stopAll', 'rewriteEpisode', 'shootConfirmTitle', 'shootConfirm', 'shootConfirmOk',
        'sameCharacter', 'scriptTab', 'sequelTab', 'sequelPlaceholder', 'adapt', 'adaptSequel', 'overwriteTitle', 'overwriteBody', 'overwrite', 'appendAsSequel', 'mismatchTitle',
        'mismatchExpand', 'mismatchCondense', 'continueAdapt', 'adjustSettings'];
    for (const key of keys) {
        const reference = placeholders(deskText('zh-CN', key));
        for (const locale of LOCALES) {
            const text = deskText(locale, key);
            assert.ok(text.trim() && !/undefined/.test(text), `${locale}.${key}`);
            assert.equal(placeholders(text), reference, `${locale}.${key} placeholders`);
        }
    }
    assert.match(deskText('zh-CN', 'overwriteBody', { range: '1–2', next: 3 }), /第 1–2 集.*第 3 集/);
});
