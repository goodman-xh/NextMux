import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TEXT_PREVIEW_MAX_BYTES,
  decodeUtf8TextPreview,
  filePreviewErrorText,
  filePreviewRequestIsCurrent,
  isTextPreviewCandidate,
  prepareTextFilePreview
} from '../lib/browser/nextmux-file-preview.js';

const utf8 = value => new TextEncoder().encode(value);

test('ambiguous multi-root files have a clear localized error in every supported language', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    const text = filePreviewErrorText(locale, 'ambiguous');
    assert.ok(text?.trim()); assert.notEqual(text, filePreviewErrorText(locale, 'missing'));
  }
});

test('plain UTF-8 text is previewable regardless of extension', () => {
  for (const [name, content] of [
    ['notes.txt', 'plain text\nsecond line'],
    ['README.md', '# Heading\n'],
    ['config.json', '{"ok":true}\n'],
    ['workflow.yaml', 'name: verify\n'],
    ['server.log', '2026-01-01 ready\n'],
    ['Dockerfile', 'FROM node:22\n'],
    ['script.ts', 'export const ready = true;\n'],
    ['中文.txt', '普通 UTF-8 文本\n']
  ]) {
    assert.deepEqual(decodeUtf8TextPreview(utf8(content)), { kind: 'text', content }, name);
  }
});

test('binary and invalid UTF-8 bytes are rejected', () => {
  assert.deepEqual(decodeUtf8TextPreview(Uint8Array.from([0x50, 0x4e, 0x47, 0, 1, 2])), { kind: 'binary' });
  assert.deepEqual(decodeUtf8TextPreview(Uint8Array.from([0xc3, 0x28])), { kind: 'binary' });
});

test('the drawer text policy accepts common text names, extensionless files, and rejects known binary media', () => {
  for (const name of ['notes.txt', 'README.md', 'config.json', 'workflow.yaml', 'workflow.yml', 'server.log', 'Dockerfile', 'LICENSE', '.env']) {
    assert.equal(isTextPreviewCandidate(name), true, name);
  }
  for (const name of ['image.png', 'archive.zip', 'movie.mp4', 'font.woff2']) {
    assert.equal(isTextPreviewCandidate(name), false, name);
  }
});

test('large valid UTF-8 text within the bounded drawer budget remains previewable', () => {
  const content = '2026-09-01 ready\n'.repeat(60_000);
  const bytes = utf8(content);
  assert.ok(bytes.byteLength > 512 * 1024, 'the fixture must be larger than the removed legacy preview cap');
  assert.ok(bytes.byteLength < DEFAULT_TEXT_PREVIEW_MAX_BYTES);
  assert.deepEqual(prepareTextFilePreview(bytes), { kind: 'text', content });
});

test('oversized input is rejected before decoding while a caller-supplied positive limit is explicit', () => {
  const bytes = Uint8Array.from({ length: 33 }, () => 0xff);
  assert.deepEqual(prepareTextFilePreview(bytes, { maxBytes: 32 }), {
    kind: 'too-large',
    sizeBytes: 33,
    maxBytes: 32
  });
});

test('ANSI-colored logs remain UTF-8 text instead of being mistaken for binary content', () => {
  const content = `${'\u001b[32m2026-09-01 ready\u001b[0m\n'.repeat(200)}done\n`;
  assert.deepEqual(prepareTextFilePreview(utf8(content)), { kind: 'text', content });
});

test('a file preview result only belongs to the request and conversation that started it', () => {
  assert.equal(filePreviewRequestIsCurrent(4, 4, 'conversation-b', 'conversation-b'), true);
  assert.equal(filePreviewRequestIsCurrent(5, 4, 'conversation-b', 'conversation-b'), false);
  assert.equal(filePreviewRequestIsCurrent(4, 4, 'conversation-c', 'conversation-b'), false);
});
