import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Isolated production methods: no desktop account, credentials or full application bootstrap.
const module = { exports: {} };
const cacheSource = readFileSync(new URL('../src/node/nextmux-global-model-catalog.ts', import.meta.url), 'utf8');
new Function('require', 'module', 'exports', ts.transpileModule(cacheSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(createRequire(import.meta.url), module, module.exports);
const { GlobalModelCatalogCache } = module.exports;
const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const service = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const methods = ['getModelCatalogVersion', 'getModelRegistry', 'getGlobalModelCatalog'].map(name => service.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const Harness = new Function('GlobalModelCatalogCache', 'join', 'createHash', 'PlatformRequestError',
    ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(GlobalModelCatalogCache, join, createHash, Error);
const entry = id => ({ id, canonicalModel: `author/${id}`, provider: 'author', displayName: id, input: ['text'], output: ['text'], capabilities: [], aliases: [] });
const catalog = id => ({ models: [entry(id)], updatedAt: 123456 });
const nextTick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nm-catalog-version-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const instance = Object.assign(new Harness(), { baseUrl: 'https://fixture.invalid', nextmuxDataRoot: () => root,
        publicMerchantMetadataVersion: '', publicMerchantMetadataGeneration: 0, merchantSupportReader: { invalidate() {} } });
    for (const key of ['publicMerchantPages', 'publicMerchantRequests', 'merchantCatalogPages', 'merchantCatalogRequests', 'merchantDiscoveredPages', 'merchantDiscoveredRequests']) instance[key] = new Map();
    return { instance, root };
}

test('registry pagination carries one revision and obsolete completion cannot overwrite the new cache', async t => {
    const { instance } = await fixture(t); let version = '11111111', finishOld;
    const paths = [];
    instance.request = async path => {
        if (path === '/api/models/version') return { version };
        paths.push(path);
        const url = new URL(path, instance.baseUrl);
        if (url.searchParams.get('catalogVersion') === '11111111') return new Promise(resolve => { finishOld = resolve; });
        return url.searchParams.get('offset') === '0'
            ? { models: [entry('new-a')], total: 2, nextOffset: 1 }
            : { models: [entry('new-b')], total: 2, nextOffset: null };
    };
    await instance.getModelCatalogVersion();
    const old = instance.getModelRegistry(true);
    version = '22222222'; await instance.getModelCatalogVersion();
    const fresh = await instance.getModelRegistry(true);
    finishOld({ models: [entry('old')], total: 1, nextOffset: null }); await old;
    assert.deepEqual((await instance.getModelRegistry()).map(row => row.id), ['new-a', 'new-b']);
    assert.equal(instance.modelRegistryCache.models, fresh);
    assert.deepEqual(paths.map(path => new URL(path, instance.baseUrl).searchParams.get('catalogVersion')), ['11111111', '22222222', '22222222']);
});

test('global revision refresh partitions the edge URL and old requests cannot replace new memory or disk snapshots', async t => {
    const { instance, root } = await fixture(t); let version = '11111111', finishOld;
    const paths = [];
    instance.request = async path => {
        if (path === '/api/models/version') return { version };
        paths.push(path);
        if (new URL(path, instance.baseUrl).searchParams.get('catalogVersion') === '11111111') return new Promise(resolve => { finishOld = resolve; });
        return catalog('new');
    };
    await instance.getModelCatalogVersion();
    const old = instance.getGlobalModelCatalog(true);
    while (!finishOld) await nextTick();
    version = '22222222'; await instance.getModelCatalogVersion();
    assert.equal((await instance.getGlobalModelCatalog(true)).models[0].id, 'new');
    finishOld(catalog('old'));
    assert.equal((await old).stale, true);
    assert.equal((await instance.getGlobalModelCatalog()).models[0].id, 'new');
    const diskPath = join(root, 'catalogs', `global-models-${createHash('sha256').update(instance.baseUrl).digest('hex').slice(0, 16)}.json`);
    const disk = JSON.parse(await readFile(diskPath, 'utf8'));
    assert.equal(disk.catalogVersion, version); assert.equal(disk.models[0].id, 'new');
    assert.deepEqual(paths.map(path => new URL(path, instance.baseUrl).searchParams.get('catalogVersion')), ['11111111', '22222222']);
});

test('a fresh disk snapshot for another revision is only an offline fallback, never a new revision success', async t => {
    const { root } = await fixture(t); const path = join(root, 'catalog.json');
    const old = new GlobalModelCatalogCache(path, async () => catalog('old'));
    await old.get(false, '11111111');
    let calls = 0;
    const restarted = new GlobalModelCatalogCache(path, async version => { calls++; assert.equal(version, '22222222'); throw Error('offline'); });
    const fallback = await restarted.get(false, '22222222');
    assert.equal(calls, 1); assert.equal(fallback.models[0].id, 'old'); assert.equal(fallback.stale, true);
    const recovered = new GlobalModelCatalogCache(path, async version => { assert.equal(version, '22222222'); return catalog('recovered'); });
    assert.equal((await recovered.get(false, '22222222')).models[0].id, 'recovered');
});
