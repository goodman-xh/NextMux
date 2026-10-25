import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute current source without requiring another whole desktop bundle build.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const source = await readFile(new URL('../src/common/nextmux-text-attachment.ts', import.meta.url), 'utf8');
const exports = {};
Function('exports', compile(source))(exports);
const { decodeTextAttachment, TextAttachmentDecodeError, TEXT_ATTACHMENT_MAX_BYTES, TEXT_ATTACHMENT_MAX_CHARACTERS } = exports;
const utf8 = text => Buffer.from(text, 'utf8');
const utf16 = (text, endian = 'le') => {
    const bytes = Buffer.from(text, 'utf16le');
    if (endian === 'be') bytes.swap16();
    return Buffer.concat([Buffer.from(endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]), bytes]);
};

test('strict UTF-8, UTF-8 BOM and BOM-declared UTF-16 LE/BE preserve identical CSV and Unicode text', () => {
    for (const text of ['Name,Count\r\napple,2', '名称,数量\r\n苹果🍎,2', '']) {
        for (const bytes of [utf8(text), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(text)]), utf16(text), utf16(text, 'be')]) assert.equal(decodeTextAttachment(bytes), text);
    }
});

test('no guessed legacy encoding, NUL, invalid UTF-8, odd UTF-16 bytes or unpaired surrogates can enter text protocol', () => {
    for (const bytes of [Buffer.from('ASCII', 'utf16le'), Buffer.from([0xc3, 0x28]), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]),
        Buffer.from([0xff, 0xfe, 0x41]), Buffer.from([0xfe, 0xff, 0x41]), Buffer.from([0xff, 0xfe, 0x00, 0xd8]), Buffer.from([0xfe, 0xff, 0xdc, 0x00]),
        utf8('hello\0world'), utf16('hello\0world'), utf16('hello\0world', 'be'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])]) {
        assert.throws(() => decodeTextAttachment(bytes), error => error instanceof TextAttachmentDecodeError && error.reason === 'invalid');
    }
});

test('byte and character budgets are unchanged and apply after BOM-aware decoding', () => {
    assert.equal(TEXT_ATTACHMENT_MAX_BYTES, 512 * 1024); assert.equal(TEXT_ATTACHMENT_MAX_CHARACTERS, 120000);
    for (const encode of [utf8, utf16, text => utf16(text, 'be')]) {
        assert.equal(decodeTextAttachment(encode('中'.repeat(120000))).length, 120000);
        assert.throws(() => decodeTextAttachment(encode('a'.repeat(120001))), error => error.reason === 'too_large');
    }
    assert.throws(() => decodeTextAttachment(Buffer.alloc(TEXT_ATTACHMENT_MAX_BYTES + 1, 0x61)), error => error.reason === 'too_large');
});

test('decoder honors Uint8Array offsets and does not mutate the original attachment bytes', () => {
    const bytes = utf16('名称,数量\n苹果,2', 'be'); const copy = Buffer.from(bytes);
    const padded = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]);
    assert.equal(decodeTextAttachment(padded.subarray(6, 6 + bytes.length)), '名称,数量\n苹果,2');
    assert.deepEqual(bytes, copy);
});

const widgetSource = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(['attachmentExtension', 'attachmentMimeType', 'textAttachmentExtension', 'classifyAttachment', 'attachmentRecordFromBytes', 'composerFilesFromTransfer', 'decodableTextAttachment']);
const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && wanted.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, wanted.size);
const WidgetMethods = Function('decodeTextAttachment', 'TextAttachmentDecodeError', 'TEXT_ATTACHMENT_MAX_BYTES', `${compile(`class WidgetMethods { imageMimeType() { return undefined; } bytesToBase64(bytes) { return Buffer.from(bytes).toString('base64'); } ${methods.join('\n')} }`)}; return WidgetMethods;`)(decodeTextAttachment, TextAttachmentDecodeError, TEXT_ATTACHMENT_MAX_BYTES);

test('actual widget upload classification sends UTF-16 BOM CSV/TXT as ordinary text attachments', () => {
    const widget = new WidgetMethods();
    for (const name of ['Windows-table.csv', 'Windows-table.tsv', '说明.txt']) {
        for (const bytes of [utf16('名称,数量\r\n苹果,2'), utf16('名称,数量\r\n苹果,2', 'be')]) {
            const result = widget.attachmentRecordFromBytes(name, 'file:///synthetic', bytes, '', 'fixture-id');
            assert.deepEqual(result.attachment, { kind: 'text', name, content: '名称,数量\r\n苹果,2' });
            assert.equal(result.size, bytes.length); assert.equal('dataBase64' in result.attachment, false);
        }
    }
});

test('actual widget keeps malformed or oversized text as a file that the host decodes and truncates on send', () => {
    const widget = new WidgetMethods();
    // Like LibreChat, long or non-UTF-8 text is not rejected: it stays a file and is read as text when sent.
    for (const [name, bytes] of [['bad.txt', utf16('A\0B')], ['large.txt', utf16('a'.repeat(120001))], ['gbk.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3])]]) {
        const record = widget.attachmentRecordFromBytes(name, '', bytes, '', 'fixture');
        assert.equal(record.attachment.kind, 'file', name); assert.equal(record.attachment.mimeType, 'text/plain', name);
    }
    const larger = widget.attachmentRecordFromBytes('large.csv', '', Buffer.alloc(512 * 1024 + 1, 0x61), '', 'fixture');
    assert.equal(larger.attachment.kind, 'file'); assert.equal(larger.attachment.mimeType, 'text/csv');
    const binary = widget.attachmentRecordFromBytes('table.xlsx', '', Buffer.from([0x50, 0x4b, 0, 0]), '', 'fixture');
    assert.equal(binary.attachment.kind, 'file');
});

test('common source, notebook, configuration and patch formats remain text attachments', () => {
    const widget = new WidgetMethods();
    for (const name of ['main.kts', 'analysis.ipynb', 'component.vue', 'script.lua', 'Cargo.lock', 'Makefile', '.gitignore', 'changes.patch']) {
        const result = widget.attachmentRecordFromBytes(name, 'file:///synthetic', utf8('name = "nextmux"\n'), '', `text-${name}`);
        assert.equal(result.attachment.kind, 'text', name);
    }
    for (const name of ['reference.avif', 'archive.zip', 'diagram.tiff']) {
        const result = widget.attachmentRecordFromBytes(name, 'file:///synthetic', Buffer.from([1, 2, 3, 4]), '', `file-${name}`);
        assert.equal(result.attachment.kind, 'file', name);
    }
});

test('dropped files fall back to DataTransferItems when Chromium has not populated FileList', () => {
    const widget = new WidgetMethods();
    const file = (name, size = 1, lastModified = 1) => ({ name, size, lastModified });
    const first = file('report.pdf', 12, 10), duplicate = file('report.pdf', 12, 10), second = file('notes.md', 4, 11);
    const getAsFile = value => () => value;
    const fromItems = widget.composerFilesFromTransfer({ files: [], items: [
        { kind: 'string', getAsFile: getAsFile(undefined) },
        { kind: 'file', getAsFile: getAsFile(first) },
        { kind: 'file', getAsFile: getAsFile(duplicate) },
        { kind: 'file', getAsFile: getAsFile(second) }
    ] });
    assert.deepEqual(fromItems, [first, duplicate, second], 'matching metadata does not establish matching bytes');
    assert.deepEqual(widget.composerFilesFromTransfer({ files: [first, first, duplicate], items: [] }), [first, duplicate]);
});
