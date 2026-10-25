import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalModelCatalogCache } from '../lib/node/nextmux-global-model-catalog.js';

const entry = (id = 'author/model-1') => ({ id, canonicalModel: id, provider: 'author', displayName: 'Model 1',
    input: ['text'], output: ['text'], capabilities: [], aliases: ['model-1'] });
const payload = { models: [entry()], updatedAt: 123456 };

test('multiple windows share one public fetch and fresh restart uses the disk snapshot', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-global-catalog-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'catalog.json');
    let calls = 0, resolve;
    const cache = new GlobalModelCatalogCache(path, () => { calls++; return new Promise(done => { resolve = done; }); });
    const requests = Array.from({ length: 8 }, () => cache.get());
    await new Promise(done => setImmediate(done));
    while (!resolve) await new Promise(done => setImmediate(done));
    resolve(payload);
    const values = await Promise.all(requests);
    assert.equal(calls, 1);
    assert.ok(values.every(value => value.models[0].canonicalModel === 'author/model-1'));
    assert.equal((await cache.get()).updatedAt, 123456);
    const restarted = new GlobalModelCatalogCache(path, () => { throw Error('A fresh disk snapshot must not request the network'); });
    assert.deepEqual(await restarted.get(), payload);
});

test('failed refresh and corrupt remote entries preserve the last valid global directory', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-global-catalog-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'catalog.json');
    let response = payload;
    const cache = new GlobalModelCatalogCache(path, async () => response);
    await cache.get();
    response = { models: [entry(), entry()], updatedAt: 0 };
    assert.deepEqual(await cache.get(true), { ...payload, stale: true });
    response = { models: [entry('new-author/model-2')], updatedAt: 234567 };
    assert.deepEqual(await cache.get(true), response);
    const disk = JSON.parse(await readFile(path, 'utf8'));
    disk.fetchedAt = 0;
    await writeFile(path, JSON.stringify(disk));
    const offline = new GlobalModelCatalogCache(path, async () => { throw Error('offline'); });
    assert.deepEqual(await offline.get(), { ...response, stale: true });
});

test('empty or malformed directory never replaces a cached snapshot and cold failure is visible', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nm-global-catalog-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'catalog.json');
    await writeFile(path, '{broken');
    const cache = new GlobalModelCatalogCache(path, async () => ({ models: [], updatedAt: 0 }));
    await assert.rejects(cache.get(), /Invalid public model directory/);
    assert.equal(await readFile(path, 'utf8'), '{broken');
});
