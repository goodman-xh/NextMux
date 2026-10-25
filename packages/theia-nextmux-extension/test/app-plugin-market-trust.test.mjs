import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const market = require('../lib/node/nextmux-app-plugin-market.js');

const bytes = Buffer.from('test package bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const id = 'com.example.trust';
const plugin = { id, latestApprovedVersion: '1.0.0' };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const host = signature => ({ baseUrl: 'https://fixture.invalid', fetch: async url => {
  if (url.includes('/download')) return new Response(bytes, { headers: { 'x-nextmux-plugin-sha256': sha256, 'x-nextmux-plugin-signature': signature } });
  if (url.includes('/api/plugins?')) return json({ plugins: [{ ...plugin, signaturePresent: Boolean(signature), signatureVerified: true }] });
  return json({ plugin: { ...plugin, signaturePresent: Boolean(signature), signatureVerified: true }, versions: [{ version: '1.0.0', sha256, signature }] });
} });

for (const signature of ['', 'invalid-signature']) {
  test(`approved ${signature ? 'signed' : 'unsigned'} market versions retain source and review without claiming verification`, async () => {
    const service = host(signature);
    const list = await market.listAppPluginMarket(service);
    const detail = await market.appPluginMarketDetail(service, id);
    const download = await market.downloadAppPluginFromMarket(service, id, '1.0.0');
    assert.equal(download.ok, true);
    for (const value of [list.plugins[0], detail.plugin, detail.versions[0], download]) {
      assert.equal(value.source, 'marketplace');
      assert.equal(value.reviewStatus, 'approved');
      assert.equal(value.signaturePresent, Boolean(signature));
      assert.equal(value.signatureVerified, false, 'API claims cannot replace verification with the built-in key');
    }
    assert.equal(download.verified, false, 'legacy verification alias stays consistent');
  });
}

test('market download forwards all trust fields to the desktop install inspection', async () => {
  const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'getAppPluginFromMarket').getText(ast);
  const inspected = [];
  const Harness = new Function('window', ts.transpile(`class Harness { ${method} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))({
    nextmuxDesktop: { inspectAppPluginBytes: async (...args) => { inspected.push(args); return { ok: true, ...args[2] }; } }
  });
  for (const signatureVerified of [false, true]) {
    const app = Object.assign(new Harness(), { desktopLocale: 'en', appPluginMarket: {}, update() {},
      platformService: { appPluginLicense: async () => ({ ok: true, paid: false }), downloadAppPluginFromMarket: async () => ({ ok: true, dataBase64: bytes.toString('base64'),
        source: 'marketplace', reviewStatus: 'approved', signaturePresent: true, signatureVerified }) } });
    await app.getAppPluginFromMarket({ id, latestVersion: '1.0.0' });
    assert.deepEqual(inspected.at(-1)[2], { id, version: '1.0.0', source: 'marketplace', reviewStatus: 'approved',
      signaturePresent: true, signatureVerified, verified: signatureVerified });
    assert.equal(app.appPluginInstall.source, 'marketplace');
    assert.equal(app.appPluginInstall.reviewStatus, 'approved');
    assert.equal(app.appPluginInstall.signatureVerified, signatureVerified);
  }
});
