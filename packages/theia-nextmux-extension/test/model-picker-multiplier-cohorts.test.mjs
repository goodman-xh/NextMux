import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const prices = require('../lib/browser/nextmux-offering-price.js');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const render = widget.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === 'renderCodingWorkbench');
const names = ['priceVariantRoutes', 'withPriceVariants'];
const declarations = names.map(name => {
  const n = render.body.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name));
  const next = render.body.statements[render.body.statements.indexOf(n) + 1];
  return n.getText(ast) + (name === 'priceVariantRoutes' ? '\n' + next.getText(ast) : '');
}).join('\n');
const compile = ts.transpileModule(`${declarations}; return { priceVariantRoutes, withPriceVariants };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const create = new Function('modelPickerRelayKey', ...Object.keys(prices), compile);
const route = (id, multiplierBps, extra = {}) => ({ id, kind: 'managed_gateway', offering: {
  id, canonicalModel: 'maker/model', multiplierBps, price: { currency: 'USD', mode: 'reference_multiplier', multiplierBps, inputPerMillionMicros: 100 }, ...extra
} });
function run(routes, activeModelRouteId = '') {
  const context = { activeModelRouteId, routesForRelay: () => routes, modelKeyForRoute: r => r.offering.canonicalModel };
  return create.call(context, 'managed:merchant-one', ...Object.values(prices));
}

test('same model and multiplier merge, different multipliers retain the correct selectable route', () => {
  const a = route('api-a', 10000), duplicate = route('api-b', 10000, { price: { currency: 'USD', mode: 'reference_multiplier', inputPerMillionMicros: 101 } }), different = route('api-c', 20000);
  const result = run([a, duplicate, different]);
  const rows = result.withPriceVariants([{ id: 'maker/model', label: 'Model', model: 'maker/model' }]);
  assert.deepEqual(rows.map(r => r.variantRouteId), ['api-a', 'api-c']);
  assert.ok(rows.every(r => r.variantOf === 'maker/model'));
  assert.equal(new Set(rows.map(r => r.id)).size, 2);
});

test('an existing selection inside a merged multiplier row remains pinned to that selected route', () => {
  const result = run([route('api-a', 10000), route('api-b', 10000)], 'api-b');
  const rows = result.withPriceVariants([{ id: 'maker/model', model: 'maker/model' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].variantRouteId, 'api-b');
});

test('merchant-set prices with no multiplier keep differing real quotes separate', () => {
  const own = amount => ({ price: { currency: 'USD', mode: 'direct', inputPerMillionMicros: amount }, multiplierBps: null });
  const result = run([route('api-a', null, own(100)), route('api-b', null, own(200)), route('api-c', null, own(100))]);
  assert.deepEqual(result.priceVariantRoutes.get('maker/model').map(r => r.id), ['api-a', 'api-b']);
});

test('different models and currencies do not merge, and own API rows are unchanged', () => {
  const result = run([route('api-a', 10000), route('api-b', 10000, { canonicalModel: 'maker/other' }),
    route('api-c', 10000, { price: { currency: 'CNY', mode: 'reference_multiplier', inputPerMillionMicros: 100 } })]);
  assert.equal(result.priceVariantRoutes.get('maker/model').length, 2);
  assert.equal(result.priceVariantRoutes.get('maker/other').length, 1);
  const own = { id: 'own/model', model: 'own/model' };
  assert.equal(result.withPriceVariants([own])[0], own);
});
