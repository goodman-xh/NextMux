import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const core = require('../app-plugin-core.cjs');
const zipAdapter = require('../app-plugin-zip.cjs');
const ts = require('typescript');
const raw = JSON.parse(readFileSync(new URL('../../../docs/examples/app-plugins/coin-catcher/plugin/plugin.json', import.meta.url), 'utf8'));
const files = new Set(['plugin.json', ...(raw.perception.examples || []), ...raw.perception.signals.filter(signal => signal.image).map(signal => signal.image)]);
const checked = core.validateManifest(raw, { files });
assert.equal(checked.ok, true, checked.errors?.join('\n'));
const manifest = checked.manifest;
const localeSource = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/browser/nextmux-app-plugin-diagnostics-locale.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpile(localeSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), { exports: module.exports, module });
const { appPluginDiagnosticText, appPluginDiagnostics } = module.exports;

test('decision state, criteria and plugin metadata are invariant across all UI locales', () => {
  const modelState = core.renderState(manifest, { locale: 'en' });
  const modelQuestions = core.buildQuestions(manifest, manifest.decisions, 'en');
  const summary = core.modelSummary(manifest);
  assert.doesNotMatch(JSON.stringify([modelState, modelQuestions, summary]), /\p{Script=Han}/u);
  assert.match(modelState, /The basket is about 0\.12 wide/);
  for (const locale of core.LOCALES) {
    assert.equal(core.renderState(manifest, { locale }), modelState, locale);
    assert.deepEqual(core.buildQuestions(manifest, manifest.decisions, locale), modelQuestions, locale);
  }
  assert.match(core.manifestSummary(manifest, 'zh-CN').description, /\p{Script=Han}/u, 'UI metadata retains its own language');
  assert.match(core.renderState(manifest, { goal: '接住二十枚金币', locale: 'ja' }), /接住二十枚金币/, 'user goal is an explicit content exception');
  const withoutEnglish = { ...manifest, knowledge: { 'zh-CN': '不应投影到模型' } };
  assert.doesNotMatch(core.renderState(withoutEnglish, { locale: 'zh-CN' }), /不应投影/);
});

test('manifest and expression diagnostics separate codes and parameters; every UI locale renders them', () => {
  const invalid = core.validateManifest({ ...raw, version: 'broken', knowledge: { en: 'x'.repeat(2001) }, reflexes: [{ when: 'missing_signal > 0', do: Object.keys(raw.actions)[0] }] }, { files });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics.length, invalid.errors.length);
  const length = invalid.diagnostics.find(item => item.path === 'knowledge.en');
  assert.deepEqual(length, { code: 'plugin.length', path: 'knowledge.en', params: { min: 1, max: 2000 } });
  assert.ok(invalid.diagnostics.some(item => item.code === 'plugin.expression_signal' && item.params.value === 'missing_signal'));
  assert.doesNotMatch(JSON.stringify(invalid.errors), /\p{Script=Han}/u);
  for (const locale of core.LOCALES) {
    const rendered = appPluginDiagnostics(locale, invalid);
    assert.equal(rendered.length, invalid.diagnostics.length);
    assert.ok(rendered.every(value => !/\{(?:min|max|value)\}|plugin\./.test(value)));
    assert.ok(rendered.some(value => value.includes('2000')));
    if (locale !== 'en') assert.notEqual(appPluginDiagnosticText(locale, length), appPluginDiagnosticText('en', length), locale);
  }
  assert.deepEqual(core.validateManifest(null).diagnostics, [{ code: 'plugin.expected', path: 'plugin.json', params: { expected: '{}' } }]);
});

test('replay errors and ZIP failures preserve structured diagnostics through JSON', () => {
  const result = core.checkReplay(manifest, { expect: { signals: { arbitrary: 1 } } }, {});
  assert.equal(result.defaultName, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.diagnostics)), [{ code: 'plugin.replay', path: 'arbitrary', params: { expected: '1', actual: 'undefined' } }]);
  assert.throws(() => zipAdapter.readZip(Buffer.from('invalid')), error => {
    assert.deepEqual(error.diagnostic, { code: 'package_size', path: '', params: {} });
    for (const locale of core.LOCALES) assert.doesNotMatch(appPluginDiagnosticText(locale, error.diagnostic), /package_size/);
    return true;
  });
});

test('desktop and platform core files are byte-identical and have no Node adapter dependency', () => {
  const desktop = readFileSync(new URL('../app-plugin-core.cjs', import.meta.url), 'utf8');
  const portable = readFileSync(new URL('../../cloudflare-platform/src/app-plugin-core.cjs', import.meta.url), 'utf8');
  assert.equal(portable, desktop);
  assert.doesNotMatch(portable, /require\(['"]node:|\bBuffer\./);
});
