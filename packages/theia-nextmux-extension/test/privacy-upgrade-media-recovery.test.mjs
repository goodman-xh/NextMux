import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { legacyCapacityJournal } from '../lib/node/nextmux-managed-task-authority.js';

const origin = 'https://privacy-upgrade.invalid', userId = 'original-owner';
const offeringId = '11111111-1111-4111-8111-111111111111';
const route = { automaticRouting: false, offeringId };
const oldPrivacy = { zeroDataRetention: true, dataCollection: 'deny' };
const serverBodyHash = 'c'.repeat(64);
class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return this.root; }
    async getPrivacySettings() { return { requireZeroDataRetention: false, denyDataCollection: false }; }
    async deviceId() { return 'privacy-upgrade-device'; }
    async mediaJobStore() { return { setCapacityWaiting: async () => {} }; }
    async noteRemoteTask() {}
}
async function fixture(t, originalBody) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-privacy-upgrade-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const requestKey = randomUUID(), requestId = randomUUID(), service = new Service();
    Object.assign(service, { root, baseUrl: origin, mediaDeliveryAccountId: userId });
    const scope = { root, platformOrigin: origin, userId, requestKey, body: originalBody };
    await legacyCapacityJournal(scope, { requestId, serverBodyHash, delivery: 'waiting_capacity' });
    let recoveries = 0;
    service.networkFetch = async url => {
        assert.equal(String(url), `${origin}/api/gateway/responses/${requestId}/recover`);
        recoveries++;
        return Response.json({ code: 'waiting_capacity', details: { requestId, bodyHash: serverBodyHash,
            waitingCapacity: true, canResume: true, providerAccepted: false } }, { status: 409 });
    };
    return { root, service, requestKey, requestId, scope, recoveries: () => recoveries };
}
for (const kind of ['image', 'speech']) test(`upgraded queued ${kind} submits the original privacy wire body`, async t => {
    const input = kind === 'image' ? { prompt: 'original image', negativePrompt: '', width: 512, height: 512 }
        : { text: 'original speech', voice: 'fixture', format: 'wav' };
    const originalBody = { ...route, ...oldPrivacy, kind, input };
    const f = await fixture(t, originalBody), recover = f.service.networkFetch;
    let posts = 0;
    f.service.networkFetch = async (url, init) => {
        if (String(url).endsWith('/recover')) return recover(url, init);
        assert.equal(String(url), `${origin}/api/gateway/media`);
        assert.deepEqual(JSON.parse(init.body), originalBody);
        assert.equal(init.headers['idempotency-key'], f.requestKey);
        posts++;
        return new Response(new Uint8Array([1, 2, 3]), { headers: {
            'content-type': kind === 'image' ? 'image/png' : 'audio/wav',
            'x-nextmux-extension': kind === 'image' ? 'png' : 'wav', 'x-nextmux-request-id': f.requestId
        } });
    };
    const result = await f.service.requestManagedMedia({ id: 'job', idempotencyKey: f.requestKey, kind },
        { ...input, connectionId: `managed:fixed:${offeringId}`, model: 'fixture' }, new AbortController().signal);
    assert.equal(result.requestId, f.requestId);
    assert.equal(posts, 1); assert.equal(f.recoveries(), 1);
    assert.equal((await legacyCapacityJournal(f.scope)).delivery, 'submitted');
});
test('upgraded queued video uses the original privacy fields and original create key', async t => {
    const input = { prompt: 'original video', negativePrompt: '', durationSeconds: 5, width: 1280, height: 720 };
    const originalBody = { ...route, ...oldPrivacy, ...input };
    const f = await fixture(t, originalBody); let posts = 0;
    f.service.timedMediaFetch = async (url, init) => {
        assert.equal(url, `${origin}/api/gateway/video/jobs`);
        assert.deepEqual(JSON.parse(init.body), originalBody);
        assert.equal(init.headers['idempotency-key'], f.requestKey); posts++;
        return Response.json({ job: { id: randomUUID(), status: 'failed', error: { code: 'FIXTURE_COMPLETED' } } });
    };
    await assert.rejects(f.service.requestManagedVideo(f.root, { id: 'job', kind: 'video', idempotencyKey: f.requestKey },
        { ...input, connectionId: `managed:fixed:${offeringId}`, model: 'fixture' }, new AbortController().signal),
        error => error.code === 'FIXTURE_COMPLETED');
    assert.equal(posts, 1); assert.equal(f.recoveries(), 1);
});
test('upgraded queued transcription restores its nested route before constructing multipart', async t => {
    const audio = Buffer.alloc(128, 1), model = 'fixture';
    const originalBody = { model, route: { ...route, maximumPriceMicros: 600, ...oldPrivacy },
        language: 'zh', audioBase64: audio.toString('base64') };
    const f = await fixture(t, originalBody), audioPath = join(f.root, 'audio.wav');
    await writeFile(audioPath, audio); let posts = 0;
    f.service.timedMediaFetch = async (url, init) => {
        assert.equal(url, `${origin}/api/gateway/audio/transcriptions`);
        assert.equal(init.headers['idempotency-key'], f.requestKey);
        assert.equal(init.body.has('privacyPreference'), false);
        assert.equal(init.body.get('zeroDataRetention'), 'true');
        assert.equal(init.body.get('dataCollection'), 'deny');
        assert.equal(init.body.get('maximumPriceMicros'), '600');
        assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), audio); posts++;
        return Response.json({ segments: [{ text: 'original subtitle', start: 0, end: 1 }] });
    };
    const transcriber = await f.service.managedComicShotTranscriber({ requestId: f.requestKey, managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model, maximumPriceMicros: 600, costConfirmed: true
    } });
    const result = await transcriber.transcribe({ audioPath, locale: 'zh-CN' });
    assert.equal(result.segments[0].text, 'original subtitle');
    assert.equal(posts, 1); assert.equal(f.recoveries(), 1);
    assert.equal((await legacyCapacityJournal(f.scope)).delivery, 'submitted');
});
