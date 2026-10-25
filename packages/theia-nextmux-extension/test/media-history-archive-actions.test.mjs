import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const { MediaHistoryArchiveActions } = require('../lib/browser/nextmux-media-history-archive-actions.js');

test('media history archive buttons distinguish export availability from import availability', () => {
  const props = { busy: false, files: 0, exportLabel: 'Backup finished jobs', importLabel: 'Import job history', onExport() {}, onImport() {} };
  const empty = renderToStaticMarkup(React.createElement(MediaHistoryArchiveActions, props));
  assert.match(empty, /<button type="button" disabled="">Backup finished jobs<\/button>/);
  assert.match(empty, /<button type="button">Import job history<\/button>/);

  const available = renderToStaticMarkup(React.createElement(MediaHistoryArchiveActions, { ...props, files: 1 }));
  assert.doesNotMatch(available, /disabled/);

  const busy = renderToStaticMarkup(React.createElement(MediaHistoryArchiveActions, { ...props, files: 1, busy: true }));
  assert.equal((busy.match(/disabled=""/g) || []).length, 2);
});
