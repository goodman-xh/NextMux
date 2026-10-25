import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { managedHistoryInputId, prepareManagedHistoryBody } from '../lib/node/nextmux-media-delivery-history.js';

const bytes = Buffer.alloc(20 * 1024 * 1024, 3), base64 = bytes.toString('base64');
const asset = { sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, mimeType: 'audio/wav' };
const body = duplicate => ({ instructions: 'fixture', messages: [
    { role: 'user', content: 'Keep every input', attachments: [{ kind: 'file', dataBase64: base64 }] },
    { role: 'assistant', content: '', outputParts: [{ type: 'audio', asset, dataBase64: base64 }] },
    ...(duplicate ? [{ role: 'assistant', content: '', outputParts: [{ type: 'audio', asset, dataBase64: base64 }] }] : [])
] });
const options = fetch => ({ baseUrl: 'https://fixture.invalid', clientRequestId: 'logical-request-original',
    deviceId: async () => 'fixture-device', fetch, legacyAvailable: async () => false });

test('plain text and small ordered history do not call an upload endpoint or ask for credentials', async () => {
    const opts = { ...options(async () => assert.fail('no network')), deviceId: async () => assert.fail('no identity read') };
    for (const original of [{ messages: [{ role: 'user', content: 'hi' }] },
        { messages: [{ role: 'assistant', outputParts: [{ type: 'audio', asset, dataBase64: 'AA==' }] }] }]) {
        const result = await prepareManagedHistoryBody(original, opts);
        assert.equal(result.body, original); assert.deepEqual(result.uploadIds, []);
    }
});

test('combined legal history and current attachment over 48 MiB use one deduplicated binary handle without losing context', async () => {
    let calls = 0; const original = body(true);
    assert.ok(Buffer.byteLength(JSON.stringify(original)) > 48 * 1024 * 1024);
    const result = await prepareManagedHistoryBody(original, options(async (url, init) => {
        calls++; assert.equal(url, 'https://fixture.invalid/api/gateway/history-inputs'); assert.equal(init.method, 'POST');
        assert.equal(init.headers['x-nextmux-device-id'], 'fixture-device'); assert.equal(init.headers['x-nextmux-history-sha256'], asset.sha256);
        assert.deepEqual(Buffer.from(init.body), bytes);
        return Response.json({ ok: true, id: init.headers['x-nextmux-history-id'], ...asset, expiresAt: Date.now() + 60_000 });
    }));
    assert.equal(calls, 1); assert.equal(result.uploadIds.length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(result.body)) < 48 * 1024 * 1024);
    assert.equal(result.body.messages[0].attachments[0].dataBase64, base64);
    assert.deepEqual(result.body.messages[1].outputParts[0].asset, asset);
    assert.equal(result.body.messages[1].outputParts[0].historyInputId, result.body.messages[2].outputParts[0].historyInputId);
    assert.equal(result.body.messages[1].outputParts[0].dataBase64, undefined);
    assert.equal(original.messages[1].outputParts[0].dataBase64, base64);
    assert.equal(result.uploadIds[0], managedHistoryInputId('logical-request-original', asset));
    assert.notEqual(result.uploadIds[0], managedHistoryInputId('different-logical-request', asset));
});

test('old workers fall back to original digest only with local proof that no output cleanup was attempted', async () => {
    let checked = 0;
    const result = await prepareManagedHistoryBody(body(false), { ...options(async () => new Response('', { status: 404 })),
        legacyAvailable: async assets => { checked++; assert.deepEqual(assets, [asset]); return true; } });
    assert.equal(result.legacy, true); assert.equal(checked, 1);
    assert.deepEqual(result.body.messages[1].outputParts, [{ type: 'audio', asset }]);
    assert.equal(result.body.messages[0].attachments[0].dataBase64, base64);
});

test('a possibly deleted historical asset never silently falls back to a missing cloud descriptor', async () => {
    await assert.rejects(prepareManagedHistoryBody(body(false), options(async () => new Response('', { status: 404 }))), /TRANSPORT_UNAVAILABLE/);
});

test('invalid upload evidence or transport interruption never submits or repeats a model request', async () => {
    let calls = 0;
    await assert.rejects(prepareManagedHistoryBody(body(false), options(async () => { calls++; throw new TypeError('lost upload ACK'); })));
    assert.equal(calls, 1);
    await assert.rejects(prepareManagedHistoryBody(body(false), options(async (_url, init) =>
        Response.json({ ok: true, id: init.headers['x-nextmux-history-id'], ...asset, sha256: 'a'.repeat(64), expiresAt: Date.now() + 1000 }))), /UPLOAD_INVALID/);
});

test('47 MiB optimization threshold does not become a new hard limit for an otherwise legal 48 MiB body', async () => {
    const original = body(false); original.instructions = 'x'.repeat(21 * 1024 * 1024);
    const result = await prepareManagedHistoryBody(original, options(async (_url, init) =>
        Response.json({ ok: true, id: init.headers['x-nextmux-history-id'], ...asset, expiresAt: Date.now() + 60_000 })));
    const size = Buffer.byteLength(JSON.stringify(result.body));
    assert.ok(size > 47 * 1024 * 1024 && size < 48 * 1024 * 1024);
});
