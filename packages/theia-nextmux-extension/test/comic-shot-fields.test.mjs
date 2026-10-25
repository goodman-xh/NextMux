import assert from 'node:assert/strict';
import test from 'node:test';
import { COMIC_SHOT_FIELD_TEXT, comicShotFieldText } from '../lib/browser/nextmux-comic-studio-text.js';
import { formatComicShotBeats, parseComicShotBeats } from '../lib/browser/nextmux-comic-shot-fields.js';
test('all new shot controls and canonical camera choices have copy in all 12 app languages', () => {
    assert.equal(Object.keys(COMIC_SHOT_FIELD_TEXT).length, 12);
    const keys = Object.keys(COMIC_SHOT_FIELD_TEXT.en);
    assert.equal(keys.length, 55);
    for (const [locale, copy] of Object.entries(COMIC_SHOT_FIELD_TEXT)) {
        assert.deepEqual(Object.keys(copy), keys, locale);
        assert.ok(!Object.hasOwn(copy, 'undefined'), locale);
        for (const key of keys) assert.ok(comicShotFieldText(locale, key)?.trim(), `${locale}: ${key}`);
    }
});
test('editable timed beats round-trip and invalid ranges are rejected', () => {
    const beats = [{ startSeconds: 0, endSeconds: 2, action: '推开门' }, { startSeconds: 2, endSeconds: 4.5, action: '停顿。' }];
    assert.deepEqual(parseComicShotBeats(formatComicShotBeats(beats)), beats);
    assert.deepEqual(parseComicShotBeats(''), []);
    assert.equal(parseComicShotBeats('2-1: backwards'), undefined);
    assert.equal(parseComicShotBeats('a sentence without timing'), undefined);
    assert.deepEqual(parseComicShotBeats('0–2：推开门'), [beats[0]]);
});
