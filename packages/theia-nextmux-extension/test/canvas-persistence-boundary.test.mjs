import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCanvasDocument } from '@nextmux/comic-core';
import { ComicCanvasStore } from '../lib/node/nextmux-canvas-store.js';

async function rejectedSettings(settings) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-canvas-persistence-boundary-'));
    try {
        const store = new ComicCanvasStore(root), projectId = 'project-persistence-boundary';
        const document = createCanvasDocument({ id: 'canvas-persistence-boundary', projectId });
        const current = (await store.save(document, 0, projectId)).canvas;
        const file = join(root, 'nextmux.canvas.json'), original = await readFile(file, 'utf8');
        await assert.rejects(store.save({ ...current, settings }, current.revision, projectId), { code: 'CANVAS_INVALID' });
        assert.equal(await readFile(file, 'utf8'), original, 'the accepted document bytes must survive a rejected save');
    } finally { await rm(root, { recursive: true, force: true }); }
}

test('real canvas store refuses transient blob URLs with mixed or uppercase schemes', async () => {
    for (const uri of ['BLOB:temporary-preview', 'BlOb:temporary-preview', ' BLOB:preview', '\tblob:preview', 'Bl\nOb:preview', '\u0000\u001fBl\tO\rb:\npreview\u0000']) {
        assert.equal(new URL(uri).protocol, 'blob:');
        await rejectedSettings({ preview: uri });
    }
});

test('real canvas store refuses nested password, cookie and refresh token credentials', async () => {
    for (const key of ['password', 'cookie', 'refreshToken', 'refresh_token', 'refresh-token']) {
        await rejectedSettings({ modelConnection: { [key]: 'credential-fixture' } });
    }
});
