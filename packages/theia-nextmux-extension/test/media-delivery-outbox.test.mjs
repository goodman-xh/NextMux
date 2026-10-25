import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MediaDeliveryOutbox } from '../lib/node/nextmux-media-delivery-outbox.js';

async function fixture(t, overrides = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-delivery-')));
    const file = join(root, 'output.bin'), bytes = Buffer.from('durably downloaded output');
    await writeFile(file, bytes); let now = 10_000, recoverable = false;
    const calls = [], body = { kind: 'media', requestId: randomUUID(), sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const options = { dataRoot: root, baseUrl: 'https://fixture.invalid', accountId: 'user-a', deviceId: 'device-private-a',
        automatic: false, now: () => now, random: () => 0, recoverable: async () => recoverable,
        fetch: async (...args) => { calls.push(args); return Response.json({ ok: true, delivered: true, deleted: true }); }, ...overrides };
    const outbox = new MediaDeliveryOutbox(options);
    t.after(async () => { outbox.dispose(); await rm(root, { recursive: true, force: true }); });
    return { root, file, body, options, outbox, calls, recovery: { type: 'job', workspaceRoot: root, jobId: 'media-job-fixture' },
        ready: () => { recoverable = true; }, advance: value => { now += value; } };
}

test('downloaded file cannot release cloud result until its recoverable job checkpoint exists', async t => {
    const f = await fixture(t); await f.outbox.stage(f.body, f.file, f.recovery); f.advance(1000);
    await f.outbox.flush(); assert.equal(f.calls.length, 0);
    f.ready(); f.advance(30_000); await f.outbox.flush();
    assert.equal(f.calls.length, 1); assert.match(f.calls[0][0], /\/api\/gateway\/media-delivery$/);
    assert.deepEqual(JSON.parse(f.calls[0][1].body), f.body);
    assert.equal((await readdir(f.outbox.directory)).length, 0);
});

test('restart reads persisted ACK and original account/device; ledger never stores credentials or media bytes', async t => {
    const f = await fixture(t); await f.outbox.stage(f.body, f.file, f.recovery);
    const text = await readFile(join(f.outbox.directory, (await readdir(f.outbox.directory))[0]), 'utf8');
    assert.equal(text.includes('device-private-a'), false); assert.equal(text.includes('durably downloaded output'), false);
    f.outbox.dispose(); f.ready(); f.advance(1000);
    const next = new MediaDeliveryOutbox(f.options); t.after(() => next.dispose());
    await next.flush(); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1].headers['x-nextmux-device-id'], 'device-private-a');
    assert.equal(new MediaDeliveryOutbox({ ...f.options, accountId: 'user-b' }).directory === next.directory, false);
    assert.equal(new MediaDeliveryOutbox({ ...f.options, deviceId: 'device-b' }).directory === next.directory, false);
    assert.equal(new MediaDeliveryOutbox({ ...f.options, baseUrl: 'https://different.invalid' }).directory === next.directory, false);
});

test('lost ACK response retries only the same delivery receipt with exponential backoff', async t => {
    let calls = 0;
    const f = await fixture(t, { fetch: async (_url, init) => { calls++; assert.equal(JSON.parse(init.body).kind, 'media');
        if (calls === 1) throw new TypeError('connection reset after server accepted'); return Response.json({ ok: true, delivered: true }); } });
    await f.outbox.stage(f.body, f.file, f.recovery); f.ready(); f.advance(1000);
    await f.outbox.flush(); assert.equal(calls, 1); await f.outbox.flush(); assert.equal(calls, 1);
    f.advance(30_000); await f.outbox.flush(); assert.equal(calls, 2);
});

for (const status of [404, 405]) test(`old server ${status} backs off a day without treating generation as failed`, async t => {
    let calls = 0; const f = await fixture(t, { fetch: async () => { calls++; return new Response('', { status }); } });
    await f.outbox.stage(f.body, f.file, f.recovery); f.ready(); f.advance(1000); await f.outbox.flush();
    f.advance(60_000); await f.outbox.flush(); assert.equal(calls, 1);
    f.advance(24 * 60 * 60_000); await f.outbox.flush(); assert.equal(calls, 2);
});

test('a partial, changed, missing or symlinked local file cannot release its original cloud copy', async t => {
    const f = await fixture(t); await f.outbox.stage(f.body, f.file, f.recovery); f.ready(); f.advance(1000);
    for (const change of [async () => writeFile(f.file, 'short'), async () => writeFile(f.file, 'x'.repeat(f.body.sizeBytes)),
        async () => rm(f.file), async () => { const other = join(f.root, 'other.bin'); await writeFile(other, 'x'.repeat(f.body.sizeBytes)); await symlink(other, f.file); }]) {
        await change(); await f.outbox.flush(); assert.equal(f.calls.length, 0); f.advance(24 * 60 * 60_000);
    }
});

test('ACK worker has two lanes and overlapping flush calls do not duplicate POSTs', async t => {
    let active = 0, peak = 0, count = 0;
    const f = await fixture(t, { fetch: async () => { count++; active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 10)); active--; return Response.json({ ok: true, delivered: true }); } });
    for (let i = 0; i < 8; i++) await f.outbox.stage({ ...f.body, requestId: randomUUID() }, f.file, f.recovery);
    f.ready(); f.advance(1000); await Promise.all([f.outbox.flush(), f.outbox.flush(), f.outbox.flush()]);
    assert.equal(peak, 2); assert.equal(count, 8);
});

test('conflicting receipt cannot overwrite the original durable file evidence', async t => {
    const f = await fixture(t); await f.outbox.stage(f.body, f.file, f.recovery);
    await assert.rejects(f.outbox.stage({ ...f.body, sha256: 'a'.repeat(64) }, f.file, f.recovery), /CONFLICT/);
});

test('background server cleanup accepted with 202 retires local ACK without polling server deletion', async t => {
    const f = await fixture(t, { fetch: async () => Response.json({ ok: true, delivered: true, deleted: false }, { status: 202 }) });
    await f.outbox.stage(f.body, f.file, f.recovery); f.ready(); f.advance(1000); await f.outbox.flush();
    assert.deepEqual(await readdir(f.outbox.directory), []);
});

for (const kind of ['reference', 'history']) test(`${kind} cleanup has a durable retry and requires explicit complete:true`, async t => {
    let calls = 0;
    const f = await fixture(t, { fetch: async (url, init) => {
        calls++;
        assert.match(url, kind === 'reference' ? /\/reference-drops\/release$/ : /\/gateway\/history-inputs$/);
        assert.equal(init.method, kind === 'history' ? 'DELETE' : 'POST');
        assert.equal('sha256' in JSON.parse(init.body), false);
        return calls === 1 ? Response.json({ ok: true, complete: false }, { status: 503 }) : Response.json({ ok: true, complete: true });
    } });
    const body = { ...f.body, kind, ...(kind === 'reference' ? { scope: `media-job-${randomUUID()}` } : { ids: [randomUUID()] }) };
    delete body.requestId;
    const recovery = kind === 'reference' ? { type: kind, scope: body.scope, workspaceRoot: f.root } : { type: kind, workspaceRoot: f.root };
    const proof = f.outbox.cleanupEvidencePath(body); await mkdir(f.outbox.receiptsDirectory, { recursive: true });
    await writeFile(proof, await readFile(f.file));
    await f.outbox.stage(body, proof, recovery); f.ready(); f.advance(1000); await f.outbox.flush();
    assert.equal((await readdir(f.outbox.directory)).length, 1);
    f.advance(30_000); await f.outbox.flush(); assert.equal(calls, 2);
    assert.equal((await readdir(f.outbox.directory)).length, 0);
    await assert.rejects(readFile(proof), { code: 'ENOENT' });
    assert.ok(await readFile(f.file), 'cleanup removes only its private evidence, never generated media');
});

for (const outcome of ['old-worker', 'unknown', 'accepted']) test(`legacy history fallback checks ${outcome} output cleanup evidence`, async t => {
    const f = await fixture(t, { fetch: async () => {
        if (outcome === 'unknown') throw new Error('lost cleanup ACK');
        return outcome === 'old-worker' ? new Response('', { status: 404 }) : Response.json({ ok: true, delivered: true });
    } });
    const body = { ...f.body, kind: 'output', partIndex: 1 };
    await f.outbox.stage(body, f.file, { type: 'output', ownerId: 'conversation-a', runId: 'agent-run-fixture', workspaceRoot: f.root });
    f.ready(); f.advance(1000); await f.outbox.flush();
    assert.equal(await f.outbox.legacyOutputReferencesAvailable([body]), outcome === 'old-worker');
});

test('a legacy request lease prevents a newer cleanup worker from deleting its cloud history concurrently', async t => {
    const f = await fixture(t), body = { ...f.body, kind: 'output', partIndex: 1 };
    await f.outbox.stage(body, f.file, { type: 'output', ownerId: 'conversation-a', runId: 'agent-run-fixture', workspaceRoot: f.root });
    assert.equal(await f.outbox.legacyOutputReferencesAvailable([body]), true);
    f.ready(); f.advance(1000); await f.outbox.flush(); assert.equal(f.calls.length, 0);
    f.advance(7 * 60 * 60_000); await f.outbox.flush(); assert.equal(f.calls.length, 1);
});
