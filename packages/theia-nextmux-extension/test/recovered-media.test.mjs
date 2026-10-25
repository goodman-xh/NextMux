import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECOVERED_MEDIA_MAX_BYTES, readBoundedMediaBody, saveRecoveredMedia, validateReceiptMedia } from '../lib/node/nextmux-recovered-media.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const fs = require('node:fs/promises');
const id = '00000000-0000-4000-8000-000000000001';
const owner = 'synthetic-owner-A';
const bytes = Buffer.from('synthetic media fixture');
const sha = value => createHash('sha256').update(value).digest('hex');
const media = changes => ({ kind: 'image', requestId: id, downloadPath: `/api/gateway/media/${id}/result`, extension: 'png', mimeType: 'image/png', sizeBytes: bytes.length, sha256: sha(bytes), expiresAt: Date.now() + 60000, provider: 'Fixture', model: 'Fixture/image', ...changes });
const response = (body = bytes, headers = {}) => new Response(body, { headers: { 'content-type': 'image/png', 'x-nextmux-call-id': id, ...headers } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, changes = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-recovered-media-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const calls = [];
    const options = { dataRoot: root, ownerId: owner, media: media(), baseUrl: 'https://platform.fixture.invalid',
        deviceId: async () => 'synthetic-device', currentOwnerId: async () => owner,
        fetch: async (url, init) => { calls.push({ url, init }); return response(); }, ...changes };
    const directory = join(root, 'recovered-media', sha(owner));
    const target = join(directory, `${id}-${sha(bytes).slice(0, 16)}.png`);
    return { root, directory, target, calls, options };
}

test('receipt permits only the same fixed original-result path and bounded image/speech metadata', () => {
    const valid = media(); assert.deepEqual(validateReceiptMedia(valid, id), valid);
    for (const changed of [{ requestId: 'other' }, { downloadPath: 'https://evil.invalid/output' }, { downloadPath: '/api/gateway/media/../credentials' }, { mimeType: 'text/html' }, { extension: '../../file' }, { kind: 'speech' }, { sizeBytes: 0 }, { sizeBytes: RECOVERED_MEDIA_MAX_BYTES + 1 }, { sha256: 'invalid' }, { expiresAt: NaN }]) assert.throws(() => validateReceiptMedia(media(changed), id), /INVALID_MEDIA_RECEIPT/);
    assert.throws(() => validateReceiptMedia(media(), '../file'), /INVALID_MEDIA_RECEIPT/);
});

test('binary reads cancel oversized chunked bodies, reject bad lengths and keep empty media distinct', async () => {
    let cancelled = 0, reads = 0;
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled++; } });
    await assert.rejects(readBoundedMediaBody(new Response(stream), 5), /RESPONSE_BODY_LIMIT/);
    assert.equal(cancelled, 1); assert.ok(reads <= 3);
    for (const length of ['6', 'bad', '-1']) await assert.rejects(readBoundedMediaBody(response(bytes, { 'content-length': length }), 5), /RESPONSE_BODY_LIMIT/);
    await assert.rejects(readBoundedMediaBody(new Response(null)), /MEDIA_EMPTY/);
});

test('explicit save uses one fixed authenticated GET, returns only a file URI and publishes owner-scoped no-overwrite files', async t => {
    const f = await fixture(t);
    const uri = await saveRecoveredMedia(f.options);
    assert.equal(fileURLToPath(uri), f.target); assert.deepEqual(await readFile(f.target), bytes);
    assert.equal(f.calls.length, 1); assert.equal(String(f.calls[0].url), `https://platform.fixture.invalid/api/gateway/media/${id}/result`);
    assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.redirect, 'error'); assert.equal(f.calls[0].init.headers['x-nextmux-device-id'], 'synthetic-device');
    assert.equal(f.calls[0].init.body, undefined); assert.ok(uri.length < 1000);
    assert.deepEqual(await readdir(f.directory), [f.target.split('/').at(-1)]);
    if (process.platform !== 'win32') assert.equal((await stat(f.target)).mode & 0o777, 0o600);
    assert.equal(await saveRecoveredMedia(f.options), uri);
});

test('concurrent original-result saves publish only one valid destination and clean temporary files', async t => {
    const f = await fixture(t);
    const results = await Promise.all([saveRecoveredMedia(f.options), saveRecoveredMedia(f.options)]);
    assert.equal(results[0], results[1]); assert.deepEqual(await readFile(f.target), bytes);
    assert.equal((await readdir(f.directory)).length, 1);
});

test('owner mismatch, expired receipts and tampered metadata refuse without a download', async t => {
    const f = await fixture(t);
    for (const changes of [{ currentOwnerId: async () => 'other-owner' }, { media: media({ expiresAt: 1 }) }, { media: media({ downloadPath: '//evil.invalid/' }) }]) await assert.rejects(saveRecoveredMedia({ ...f.options, ...changes }));
    assert.equal(f.calls.length, 0); assert.deepEqual(await readdir(f.root), []);
});

test('owner change during download discards late bytes without writing to either account', async t => {
    const pending = deferred(); let current = owner;
    const f = await fixture(t, { currentOwnerId: async () => current, fetch: () => pending.promise });
    const result = saveRecoveredMedia(f.options); await Promise.resolve(); current = 'other-owner'; pending.resolve(response());
    await assert.rejects(result, /MEDIA_OWNER_CHANGED/); assert.deepEqual(await readdir(f.root), []);
});

test('wrong original ID, MIME, size or digest cannot be saved', async t => {
    const f = await fixture(t);
    for (const output of [() => response(bytes, { 'x-nextmux-call-id': 'other' }), () => response(bytes, { 'content-type': 'text/html' }), () => response(Buffer.from('short')), () => response(Buffer.alloc(bytes.length))]) await assert.rejects(saveRecoveredMedia({ ...f.options, fetch: async () => output() }));
    assert.deepEqual(await readdir(f.root), []);
});

test('conflicting existing files and symbolic links are never overwritten or followed', async t => {
    const f = await fixture(t); await mkdir(f.directory, { recursive: true });
    await writeFile(f.target, 'existing-user-data');
    await assert.rejects(saveRecoveredMedia(f.options), /MEDIA_STORAGE_CONFLICT/);
    assert.equal(await readFile(f.target, 'utf8'), 'existing-user-data');
    await rm(f.target); const outside = join(f.root, 'unrelated-file'); await writeFile(outside, bytes); await symlink(outside, f.target);
    await assert.rejects(saveRecoveredMedia(f.options), /MEDIA_STORAGE_CONFLICT/); assert.deepEqual(await readFile(outside), bytes);
});

test('existing file growth between lstat and open refuses before any unbounded read', async t => {
    const f = await fixture(t); await mkdir(f.directory, { recursive: true }); await writeFile(f.target, bytes);
    const originalStat = fs.lstat, originalRead = fs.readFile; let grew = false, unboundedReads = 0;
    fs.lstat = async (...args) => { const result = await originalStat(...args); if (args[0] === f.target && !grew) { grew = true; await writeFile(f.target, Buffer.alloc(4096)); } return result; };
    fs.readFile = async (...args) => { if (args[0] === f.target) unboundedReads++; return originalRead(...args); };
    try { await assert.rejects(saveRecoveredMedia(f.options), /MEDIA_STORAGE_CONFLICT/); assert.equal(unboundedReads, 0); }
    finally { fs.lstat = originalStat; fs.readFile = originalRead; }
});

test('parent directory replacement is detected before creating or publishing under a substituted link', async t => {
    const f = await fixture(t);
    const outside = join(f.root, 'unrelated-directory'); await mkdir(outside);
    const parent = join(f.root, 'recovered-media'); const originalStat = fs.lstat; let swapped = false;
    fs.lstat = async (...args) => {
        const result = await originalStat(...args);
        if (args[0] === parent && !swapped) { swapped = true; await rename(parent, join(f.root, 'parked-original-directory')); await symlink(outside, parent); }
        return result;
    };
    try { await assert.rejects(saveRecoveredMedia(f.options), /MEDIA_STORAGE_UNSAFE/); assert.equal(swapped, true); assert.deepEqual(await readdir(outside), []); }
    finally { fs.lstat = originalStat; }
});

class Service extends NextMuxPlatformServiceImpl {
    async deviceId() { return 'synthetic-device'; }
    async getPrivacySettings() { return { requireZeroDataRetention: true, denyDataCollection: true }; }
}

test('media recovery RPC returns only validated metadata, not binary/base64/provider-private fields', async () => {
    const service = new Service(); const calls = [];
    service.networkFetch = async (url, init) => { calls.push({ url, init }); return Response.json({ call: { id }, billing: { currency: 'USD', chargedMicros: 1234 }, media: { ...media(), base64: 'private-media-payload', providerState: { private: true } } }); };
    const result = await service.recoverManagedReceipt(id);
    assert.equal(result.status, 'recovered'); assert.equal(result.result.content, ''); assert.equal(result.result.media.requestId, id);
    assert.ok(JSON.stringify(result).length < 1500); assert.doesNotMatch(JSON.stringify(result), /base64|providerState|private-media-payload/);
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.body, undefined);
    assert.equal(new URL(calls[0].url).pathname, `/api/gateway/responses/${id}/recover`);
});

test('unknown acceptance rate limiting remains review and preserves its cooldown', async () => {
    const service = new Service();
    service.networkFetch = async () => Response.json({ ok: false, code: 'billing_recovery_rate_limited', details: { acceptanceUnknown: true, recoveryMode: 'billing_review', retryAfter: 10 } }, { status: 429, headers: { 'retry-after': '10' } });
    assert.deepEqual(await service.recoverManagedReceipt(id), { requestId: id, status: 'review', retryAfterMs: 10000 });
});

test('receipt metadata HTTP reads stop at the byte cap even without Content-Length', async () => {
    const service = new Service(); let reads = 0, cancelled = 0;
    service.networkFetch = async () => new Response(new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(700000)); }, cancel() { cancelled++; } }));
    await assert.rejects(service.recoverManagedReceipt(id)); assert.equal(cancelled, 1); assert.ok(reads <= 3);
});

test('managed media pre-dispatch cancellation sends nothing; cancellation after dispatch cannot become retryable', async () => {
    const service = new Service(); const input = { connectionId: 'managed:fixed:00000000-0000-4000-8000-000000000002', model: 'fixture', prompt: 'synthetic', width: 512, height: 512 };
    const job = { kind: 'image', idempotencyKey: 'synthetic-stable-key' }; let calls = 0;
    service.networkFetch = async () => { calls++; throw Object.assign(new Error('Synthetic abort'), { name: 'AbortError' }); };
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(service.requestManagedMedia(job, input, cancelled.signal)); assert.equal(calls, 0);
    try { await service.requestManagedMedia(job, input, new AbortController().signal); assert.fail('Expected unknown result'); }
    catch (error) { const failure = service.mediaFailure(error); assert.equal(failure.code, 'BILLING_TRANSPORT_UNKNOWN'); assert.equal(failure.retryable, false); assert.equal(failure.recoveryMode, 'billing_review'); }
    assert.equal(calls, 1); assert.equal(job.idempotencyKey, 'synthetic-stable-key');
});
