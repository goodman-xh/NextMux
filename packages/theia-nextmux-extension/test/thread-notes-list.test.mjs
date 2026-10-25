import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notes = require('../lib/browser/nextmux-thread-notes.js');

test('Enter continues a numbered note like a Markdown editor', () => {
    assert.deepEqual(notes.continueNoteList('1. buy milk', 11), { value: '1. buy milk\n2. ', caret: 15 });
    assert.deepEqual(notes.continueNoteList('  9. deep', 9), { value: '  9. deep\n  10. ', caret: 16 }, 'indentation and numbers carry on');
    assert.deepEqual(notes.continueNoteList('1. a\n2. b', 4), { value: '1. a\n2. \n2. b', caret: 8 }, 'Enter mid-list inserts the next number');
});

test('Enter on an empty item ends the list, and a line without a number stays plain', () => {
    assert.deepEqual(notes.continueNoteList('1. a\n2. ', 8), { value: '1. a\n', caret: 5 });
    assert.equal(notes.continueNoteList('1. a\nplain text', 15), undefined, 'the user deleted the number: no more automatic numbering');
    assert.equal(notes.continueNoteList('', 0), undefined);
});

test('Backspace right after an automatic number removes the whole marker', () => {
    assert.deepEqual(notes.removeNoteListMarker('1. a\n2. ', 8), { value: '1. a\n', caret: 5 });
    assert.equal(notes.removeNoteListMarker('1. ab', 5), undefined, 'inside text Backspace is ordinary');
});
