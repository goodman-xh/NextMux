import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const { ComicHistoryArchiveActions, LocalDataDiagnosticAction } = require('../lib/browser/nextmux-comic-history-archive-actions.js');

test('comic history actions and diagnostics render distinct busy states', () => {
  const history = renderToStaticMarkup(React.createElement(ComicHistoryArchiveActions, {
    busy: false, files: 1, onExport() {}, onImport() {},
  }));
  assert.match(history, /备份修订历史/);
  assert.match(history, /恢复修订历史/);
  assert.doesNotMatch(history, /disabled/);

  const empty = renderToStaticMarkup(React.createElement(ComicHistoryArchiveActions, {
    busy: false, files: 0, onExport() {}, onImport() {},
  }));
  assert.match(empty, /<button disabled="">备份修订历史<\/button><button>恢复修订历史<\/button>/);

  const archiveBusy = renderToStaticMarkup(React.createElement(LocalDataDiagnosticAction, {
    busy: true, exporting: false, onExport() {},
  }));
  assert.match(archiveBusy, /disabled=""/);
  assert.match(archiveBusy, /导出诊断报告/);
  assert.doesNotMatch(archiveBusy, /正在生成/);

  const diagnosticsBusy = renderToStaticMarkup(React.createElement(LocalDataDiagnosticAction, {
    busy: true, exporting: true, onExport() {},
  }));
  assert.match(diagnosticsBusy, /正在生成/);
});
