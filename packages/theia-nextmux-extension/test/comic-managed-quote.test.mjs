import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// The comic adaptation runs on the step's text route. A platform (managed) route is only served
// under the catalog price it was shown with, so the run must carry that quote.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicAgentRoute', 'managedModelRoute']);
const methods = [];
(function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, names.size);
const { bindPriceQuote } = await import('../lib/common/nextmux-price-quote.js');
globalThis.__bindPriceQuote = bindPriceQuote;
const compiled = ts.transpileModule(`const bindPriceQuote = globalThis.__bindPriceQuote;\nexport class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('a platform text route for comic adaptation carries its catalog price quote', () => {
    const h = new Harness();
    const quote = `kq1_${'a'.repeat(64)}`;
    const fixed = h.comicAgentRoute({ route: { kind: 'managed_gateway', automatic: false, offering: { id: 'offer-1', keyPriceQuoteId: quote } } }, 'conv-1');
    assert.deepEqual(fixed, { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'offer-1', keyPriceQuoteId: quote }, conversationId: 'conv-1' });
    const automatic = h.comicAgentRoute({ route: { kind: 'managed_gateway', automatic: true, registryModelId: 'reg-1', offering: { id: 'offer-2', keyPriceQuoteId: quote } } }, 'conv-2');
    assert.equal(automatic.route.keyPriceQuoteId, quote);
    const own = h.comicAgentRoute({ route: { kind: 'official_connection', connection: { id: 'official-1', model: 'm' } } }, 'conv-3');
    assert.deepEqual(own, { kind: 'official_connection', connectionId: 'official-1', model: 'm' });
});
