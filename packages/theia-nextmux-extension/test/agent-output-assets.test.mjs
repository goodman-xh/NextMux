import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { persistAgentOutputParts, readAgentOutputAsset } from '../lib/node/nextmux-agent-output-assets.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('generated media stays in owner-scoped storage while conversation state receives only immutable references', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-output-assets-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const expectedBytes = Buffer.from(pngBase64, 'base64');
    const parts = await persistAgentOutputParts(root, 'conversation-a', [
        { type: 'text', text: 'Before image' },
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: expectedBytes.length },
        { type: 'text', text: 'After image' },
    ]);

    assert.equal(Object.isFrozen(parts), true);
    assert.deepEqual(parts.map(part => part.type), ['text', 'image', 'text']);
    const image = parts[1];
    assert.equal(image.type, 'image');
    assert.equal(JSON.stringify(parts).includes(pngBase64), false);
    assert.equal(image.asset.sha256, createHash('sha256').update(expectedBytes).digest('hex'));

    const loaded = await readAgentOutputAsset(root, 'conversation-a', image.asset);
    assert.equal(loaded.dataBase64, pngBase64);
    assert.equal(loaded.mimeType, 'image/png');
    assert.equal(loaded.sizeBytes, expectedBytes.length);
    await assert.rejects(readAgentOutputAsset(root, 'conversation-b', image.asset));

    const persistedAgain = await persistAgentOutputParts(root, 'conversation-a', [
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: expectedBytes.length },
    ]);
    assert.deepEqual(persistedAgain[0], image);
    const storageEntries = await readdir(join(root, 'agent-output-assets-v1'));
    assert.equal(storageEntries.length, 1, 'failed reads cannot create arbitrary owner namespaces');
    assert.equal(storageEntries.some(entry => entry.includes('conversation')), false);
});

test('generated media storage rejects non-canonical bytes, forged metadata, and unsafe owners', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-output-assets-invalid-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bytes = Buffer.from(pngBase64, 'base64');
    await assert.rejects(persistAgentOutputParts(root, 'conversation-a', [
        { type: 'image', mimeType: 'image/png', dataBase64: `${pngBase64}\n`, sizeBytes: bytes.length },
    ]));
    await assert.rejects(persistAgentOutputParts(root, 'conversation-a', [
        { type: 'image', mimeType: 'image/svg+xml', dataBase64: pngBase64, sizeBytes: bytes.length },
    ]));
    await assert.rejects(persistAgentOutputParts(root, 'conversation\na', [
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: bytes.length },
    ]));
    await assert.rejects(readAgentOutputAsset(root, 'conversation-a', {
        sha256: 'A'.repeat(64), mimeType: 'image/png', sizeBytes: bytes.length,
    }));
});
