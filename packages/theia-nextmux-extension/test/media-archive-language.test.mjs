import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { archiveMediaMessage } from '../lib/common/nextmux-media-archive-messages.js';
import { mediaMessageText, comicExportMessageText } from '../lib/common/nextmux-media-messages.js';
import { createComicExportHistoryArchive, parseComicExportHistoryArchive, restoreComicExportHistoryRecord } from '../lib/node/nextmux-comic-export-history-archive.js';
import { PLATFORM_MEDIA_ARCHIVE_MESSAGES, formatPlatformMediaArchiveError } from '../../model-runtime/lib/platform-media-archive-locales.js';
import { formatModelError } from '@nextmux/model-runtime/errors';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

const record = { id: 'comic-export-00000000-0000-4000-8000-000000000001', projectRevision: 3, status: 'completed', quality: 'draft', subtitleMode: 'none', completedShots: 2, totalShots: 2, startedAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:10.000Z', finishedAt: '2026-09-28T00:00:10.000Z' };

test('WP3 archive reasons provide explicit translations in every locale, including dynamic limits and file formats', () => {
  for (const unknown of ['missing', 'toString', 'constructor', '__proto__']) {
    assert.equal(formatPlatformMediaArchiveError(`platform_media.archive.${unknown}`, {}, 'fr'), undefined);
    assert.doesNotThrow(() => formatModelError(archiveMediaMessage(unknown), 'fr'));
  }
  for (const [reason, row] of Object.entries(PLATFORM_MEDIA_ARCHIVE_MESSAGES)) {
    assert.equal(row.length, locales.length, reason);
    const message = archiveMediaMessage(reason, { maximum: 123, format: '.nmxcomicexports' });
    assert.equal(message.domain, 'media');
    assert.equal(message.messageKey, `platform_media.archive.${reason}`);
    assert.doesNotMatch(message.message, /\p{Script=Han}/u);
    for (const locale of locales) {
      assert.ok(row[locales.indexOf(locale)]?.trim());
      const expected = formatPlatformMediaArchiveError(message.messageKey, message.params, locale);
      assert.equal(mediaMessageText(message, locale), expected);
      assert.equal(formatModelError(message, locale).text, expected);
      assert.doesNotMatch(expected, /\{maximum\}|\{format\}/);
    }
  }
  assert.match(mediaMessageText(archiveMediaMessage('records_limit', { maximum: 123 }), 'es'), /123/);
  assert.match(mediaMessageText(archiveMediaMessage('choose_file', { format: '.nmxcomicexports' }), 'ar'), /\.nmxcomicexports/);
});

test('WP3 archive restore has explicit provenance, English persisted defaults and localized notices', () => {
  const restored = restoreComicExportHistoryRecord(record);
  assert.equal(restored.restoredHistoryOnly, true);
  assert.equal(restored.messageInfo.messageKey, 'platform_media.archive.restored_notice');
  assert.equal(restored.projectTitle, 'Restored film export history');
  assert.doesNotMatch(restored.message, /\p{Script=Han}/u);
  for (const locale of locales) {
    assert.equal(comicExportMessageText(restored, locale), formatPlatformMediaArchiveError(restored.messageInfo.messageKey, {}, locale));
  }
});

test('WP3 archive validation uses stable codes instead of sentinel prose', () => {
  const raw = createComicExportHistoryArchive('a'.repeat(64), [record]);
  assert.throws(() => parseComicExportHistoryArchive(raw, 'b'.repeat(64)), error => {
    assert.equal(error.code, 'COMIC_EXPORT_HISTORY_WORKSPACE_MISMATCH');
    error.message = 'Completely unrelated diagnostic text';
    assert.equal(error.code, 'COMIC_EXPORT_HISTORY_WORKSPACE_MISMATCH');
    return true;
  });
  assert.throws(() => parseComicExportHistoryArchive('{', 'a'.repeat(64)), { code: 'COMIC_EXPORT_HISTORY_ARCHIVE_INVALID' });
});

test('WP3 archive service methods pass structured messages and preserve existing media-core metadata', async () => {
  const text = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('service.ts', text, ts.ScriptTarget.Latest, true);
  const methods = new Set(['mediaHistoryArchivePath', 'exportMediaJobHistoryArchive', 'importMediaJobHistoryArchive', 'comicExportArchivePath', 'exportComicExportHistoryArchive', 'importComicExportHistoryArchive', 'comicMediaFilesArchivePath', 'comicMediaFilesError', 'assertComicMediaFilesIdle', 'exportComicMediaFilesArchive', 'importComicMediaFilesArchive', 'holdComicExportClear', 'strictComicExportHistory']);
  let count = 0;
  function walk(node) {
    if (ts.isMethodDeclaration(node) && methods.has(node.name.getText(source))) {
      const body = node.getText(source);
      assert.doesNotMatch(body, /error\.message\s*===/);
      assert.doesNotMatch(body, /[\p{Script=Han}]/u, node.name.getText(source));
      if (['exportMediaJobHistoryArchive', 'importMediaJobHistoryArchive'].includes(node.name.getText(source))) assert.match(body, /this\.mediaRequestError\(error\)/);
      count += 1;
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.equal(count, methods.size);
});
