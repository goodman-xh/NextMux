import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { verifyDesktopBackendFreshness } from '../../../scripts/verify-desktop-backend-freshness.mjs';

const modules = ['nextmux-platform-service', 'nextmux-conversation-store', 'nextmux-agent-run-state-store'];
const bootstrap = "require('./lib/backend/electron-main.js');\n";
const storeVersion = version => `const storage={};storage.CONVERSATION_STORE_WRITER_VERSION=${version};storage.CONVERSATION_STORE_READER_VERSION=${version};\n`;
const main = storeVersion(2) + `class Store { async deleteProject() {} async isDeletedSession() {} }
class Service {
 async getMerchantCatalog(id, after, force=false) { after = after ?? undefined; return after; }
 async getMerchantDiscoveredModels(id, after='', force=false) { if(after=after??'',!id)throw new Error('invalid'); return after; }
 async deleteProjectConversationHistory() {}
}
`;
async function fixture(t, { linked = false, sourceKind = 'ts' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-backend-freshness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = join(root, 'payload'), reference = join(root, 'current-build'), sourceRoot = join(root, 'source');
  const write = async (base, path, data) => { const file = join(base, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, data); };
  const sources = [], sourcesContent = [];
  for (const module of modules) {
    const compiled = module === 'nextmux-conversation-store' ? storeVersion(2) : `// current ${module}\n`;
    await write(sourceRoot, `packages/theia-nextmux-extension/lib/node/${module}.js`, compiled);
    await write(payload, `node_modules/@nextmux/theia-extension/lib/node/${module}.js`, compiled);
    const path = `packages/theia-nextmux-extension/${sourceKind === 'ts' ? 'src' : 'lib'}/node/${module}.${sourceKind}`;
    const content = sourceKind === 'ts' ? `// current TypeScript ${module}\n` : compiled;
    await write(sourceRoot, path, content);
    sources.push(`file:///synthetic-repo/${path}`); sourcesContent.push(content);
  }
  for (const destination of [reference, payload]) {
    await write(destination, 'package.json', JSON.stringify({ main: 'bootstrap.cjs' }));
    await write(destination, 'bootstrap.cjs', bootstrap);
    await write(destination, 'lib/backend/electron-main.js', "const startup = {THEIA_BACKEND_MAIN_PATH: resolve(__dirname, 'main.js')};\n");
    await write(destination, 'lib/backend/main.js', main + (linked ? '//# sourceMappingURL=main.js.map\n' : ''));
    if (linked) await write(destination, 'lib/backend/main.js.map', JSON.stringify({ version: 3, file: 'main.js', sources, sourcesContent, names: [], mappings: 'AAAA' }));
  }
  return { root, payload, reference, sourceRoot, write,
    verify: path => verifyDesktopBackendFreshness(path || payload, { sourceRoot, referenceDesktop: reference }) };
}

test('production qualification follows the actual startup chain and passes without unreferenced debug maps', async t => {
  const f = await fixture(t), result = await f.verify();
  assert.equal(result.passed, true);
  assert.deepEqual(result.entryChain, ['package.json:main', 'bootstrap.cjs', 'lib/backend/electron-main.js', 'lib/backend/main.js']);
  assert.deepEqual(result.sourceMapModes, { 'electron-main': 'production-no-map', main: 'production-no-map' });
  assert.equal(Object.keys(result.compiledInputSha256).length, 3);
  assert.equal(result.formatVersions.CONVERSATION_STORE_READER_VERSION, 2);
  assert.equal(result.nativeArtifactsModified, false);
});

test('a current extension folder cannot conceal an old active backend bundle or redirected bootstrap', async t => {
  for (const [path, content, expected] of [
    ['lib/backend/main.js', `${main}\n// older bundle`, /Stale or mismatched qualification artifact/],
    ['bootstrap.cjs', "require('./node_modules/@nextmux/theia-extension/lib/node/nextmux-platform-service.js');", /bootstrap is stale/],
    ['package.json', JSON.stringify({ main: 'old-entry.js' }), /Actual package entry/],
  ]) {
    const f = await fixture(t); await f.write(f.payload, path, content); await assert.rejects(f.verify(), expected);
  }
});

test('production rejects orphaned maps instead of treating an unrelated sourcesContent as proof', async t => {
  const f = await fixture(t);
  await f.write(f.payload, 'lib/backend/main.js.map', JSON.stringify({ version: 3, sources: [], sourcesContent: [] }));
  await assert.rejects(f.verify(), /Unreferenced backend source map must not ship/);
});

test('linked maps must match the current bundle/map pair and exact current TS or JS compiler input', async t => {
  for (const sourceKind of ['ts', 'js']) {
    const f = await fixture(t, { linked: true, sourceKind });
    const verified = await f.verify(); assert.equal(Object.keys(verified.embeddedSourceSha256).length, 3);
    const map = JSON.parse(await readFile(join(f.payload, 'lib/backend/main.js.map'), 'utf8'));
    map.sourcesContent[1] = '// previous store before permanent-deletion support';
    await f.write(f.payload, 'lib/backend/main.js.map', JSON.stringify(map));
    await assert.rejects(f.verify(), /Stale or mismatched qualification artifact/);
    await f.write(f.reference, 'lib/backend/main.js.map', JSON.stringify(map));
    await assert.rejects(f.verify(), /Embedded backend source is stale: nextmux-conversation-store/);
  }
});

test('RPC checks execute the actual bundled nullish expressions, not a marker in a map or current source', async t => {
  const f = await fixture(t);
  const broken = main.replace('after = after ?? undefined', 'after = after || undefined');
  for (const destination of [f.reference, f.payload]) await f.write(destination, 'lib/backend/main.js', broken);
  await assert.rejects(f.verify(), /Cursor must use nullish normalization/);
  const late = main.replace('after = after ?? undefined; return after;', "if (!after) throw new Error('old validation'); after = after ?? undefined; return after;");
  for (const destination of [f.reference, f.payload]) await f.write(destination, 'lib/backend/main.js', late);
  await assert.rejects(f.verify(), /must normalize the cursor before validation/);
});

test('runtime store must contain deletion/tombstone methods and the current reader/writer version', async t => {
  const f = await fixture(t);
  for (const [broken, expected] of [
    [main.replace(storeVersion(2), storeVersion(1)), /preserve permanent-deletion tombstones/],
    [main.replace('async isDeletedSession() {}', ''), /Required compiled backend method/],
  ]) {
    for (const destination of [f.reference, f.payload]) await f.write(destination, 'lib/backend/main.js', broken);
    await assert.rejects(f.verify(), expected);
  }
  for (const destination of [f.reference, f.payload]) await f.write(destination, 'lib/backend/main.js', main);
  await f.write(f.payload, 'node_modules/@nextmux/theia-extension/lib/node/nextmux-conversation-store.js', storeVersion(1));
  await assert.rejects(f.verify(), /Packaged backend compiler input is stale/);
});

test('the same gate reads the final ASAR without executing it or changing its contents', async t => {
  const f = await fixture(t);
  const require = createRequire(import.meta.url), builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const archive = join(f.root, 'app.asar'); await builderRequire('@electron/asar').createPackage(f.payload, archive);
  const before = await readFile(archive), result = await f.verify(archive);
  assert.equal(result.passed, true); assert.deepEqual(await readFile(archive), before);
});
