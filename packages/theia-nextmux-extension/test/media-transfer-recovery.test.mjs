import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { fetchMediaWithLifetime, assertVideoContainer } from '../lib/node/nextmux-media-transfer.js';
import { directVideoResponse } from '../../../apps/cloudflare-platform/src/video.js';

const id = '00000000-0000-4000-8000-000000000001';
const mp4 = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 0, 0, ...Buffer.from('isommp42')]);
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function fixture(t, remote = false) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-media-transfer-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const calls = [], notes = [];
    const service = new NextMuxPlatformServiceImpl();
    service.baseUrl = 'https://platform.fixture.invalid';
    service.nextmuxDataRoot = () => root;
    service.mediaJobStore = async () => ({ setCapacityWaiting: async () => {} });
    service.deviceId = async () => 'synthetic-device';
    service.getPrivacySettings = async () => ({});
    service.waitForMedia = async () => {};
    service.reportVideoMeasurement = async () => {};
    service.getMediaRuntimeState = async () => ({ ffmpeg: {} });
    service.bundledFfmpegPath = () => '';
    service.probeMediaTracks = async () => ({ hasVideo: true });
    // A cross-origin CDN hop is fetched through the public-asset dispatcher, which pins real public DNS
    // (src/node/nextmux-media-https-asset.ts:31). The fixture CDN cannot resolve, so keep the same
    // lifetime-bounded transport and drive it with the fixture's network instead.
    service.fetchPublicHttpsAsset = (target, init, signal) => fetchMediaWithLifetime((url, request) => service.networkFetch(url, request), target, init, signal);
    service.noteRemoteTask = async (_workspace, _job, task) => { notes.push(task); };
    service.mediaOutputPath = async (_workspace, _job, ext) => {
        await mkdir(join(root, 'nextmux.media'), { recursive: true });
        return { absolutePath: join(root, 'nextmux.media', `output.${ext}`), relativeUri: `nextmux.media/output.${ext}` };
    };
    const job = { id: `media-job-${id}`, idempotencyKey: 'same-original-paid-task', ...(remote ? { remoteTask: { taskId: id } } : {}) };
    const input = { connectionId: `managed:fixed:${id}`, keyPriceQuoteId: `kq1_${'a'.repeat(64)}`, prompt: 'Fixture', model: 'video-model', durationSeconds: 5, width: 1280, height: 720 };
    service.networkFetch = async (target, init) => {
        const call = { url: String(target), ...init, headers: new Headers(init.headers) }; calls.push(call);
        if (call.method === 'POST') return json({ job: { id, status: 'running' } });
        if (call.url.endsWith(`/jobs/${id}`)) return json({ job: { id, status: 'completed' } });
        if (call.url.endsWith('/content')) return directVideoResponse({ url: 'https://cdn.fixture.invalid/clip.mp4', authenticated: false });
        assert.equal(call.url, 'https://cdn.fixture.invalid/clip.mp4');
        assert.equal(call.headers.get('x-nextmux-device-id'), null);
        assert.equal(call.headers.get('authorization'), null);
        return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
    };
    return { service, root, job, input, calls, notes };
}

test('A-005 default platform submit → poll → 307 → video file never regenerates or leaks device auth', async t => {
    const f = await fixture(t);
    const output = await f.service.requestManagedVideo(f.root, f.job, f.input, new AbortController().signal);
    assert.deepEqual(await readFile(join(f.root, output.relativeUri)), mp4);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.deepEqual(f.notes, [{ taskId: id }]);
    assert.equal(f.calls[0].headers.get('idempotency-key'), f.job.idempotencyKey);
});

test('A-008 saved platform id resumes by GET; a lost create response reuses the original idempotency key', async t => {
    const resumed = await fixture(t, true);
    await resumed.service.requestManagedVideo(resumed.root, resumed.job, resumed.input, new AbortController().signal);
    assert.equal(resumed.calls[0].method, 'GET');
    assert.equal(resumed.calls.filter(call => call.method === 'POST').length, 0);
    const lost = await fixture(t);
    const network = lost.service.networkFetch;
    let first = true;
    lost.service.networkFetch = async (url, init) => { if (first) { first = false; await network(url, init); throw new Error('response lost'); } return network(url, init); };
    await assert.rejects(lost.service.requestManagedVideo(lost.root, lost.job, lost.input, new AbortController().signal));
    await lost.service.requestManagedVideo(lost.root, lost.job, lost.input, new AbortController().signal);
    assert.deepEqual(lost.calls.filter(call => call.method === 'POST').map(call => call.headers.get('idempotency-key')),
        [lost.job.idempotencyKey, lost.job.idempotencyKey]);
});

test('A-005 redirect helper validates each hop and bounds loops', async t => {
    const f = await fixture(t);
    for (const location of ['http://127.0.0.1/private', 'https://user:password@cdn.fixture.invalid/private']) {
        let calls = 0;
        f.service.networkFetch = async () => { calls++; return new Response(null, { status: 307, headers: { location } }); };
        await assert.rejects(f.service.fetchVideoOutput(new URL(f.service.baseUrl), {}, new AbortController().signal, false));
        assert.equal(calls, 1);
    }
    let calls = 0;
    f.service.networkFetch = async () => { calls++; return new Response(null, { status: 307, headers: { location: '/loop' } }); };
    await assert.rejects(f.service.fetchVideoOutput(new URL(f.service.baseUrl), {}, new AbortController().signal, false), { code: 'VIDEO_REDIRECT_LIMIT' });
    assert.equal(calls, 4);
});

test('A-007 accepted managed task polling 429 remains retryable by GET without a second generation', async t => {
    const f = await fixture(t), network = f.service.networkFetch;
    const waits = [];
    f.service.waitForMedia = async milliseconds => { waits.push(milliseconds); };
    let rateLimited = true, polls = 0;
    f.service.networkFetch = async (url, init) => {
        if (String(url).endsWith(`/jobs/${id}`)) polls++;
        if (String(url).endsWith(`/jobs/${id}`) && rateLimited) {
            rateLimited = false;
            return new Response('{"code":"rate_limited","message":"Retry original task"}', { status: 429, headers: { 'retry-after': '1' } });
        }
        return network(url, init);
    };
    // An accepted task's transient poll failure is retried in place by its saved id, honouring
    // Retry-After, and never becomes a second paid generation (src/node/nextmux-platform-service.ts:19271).
    await f.service.requestManagedVideo(f.root, f.job, f.input, new AbortController().signal);
    assert.equal(polls, 2, 'the rate-limited poll is retried by GET');
    assert.ok(waits.some(milliseconds => milliseconds >= 1000), 'Retry-After is honoured before the retry');
    assert.equal(f.notes[0].taskId, id);
    await f.service.requestManagedVideo(f.root, { ...f.job, remoteTask: f.notes[0] }, f.input, new AbortController().signal);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

for (const mode of ['cancel', 'idle']) {
    test(`A-009 headers arrive but body stalls forever: ${mode} cancels the reader and removes partial output`, async t => {
        const f = await fixture(t);
        const caller = new AbortController();
        let cancelled = 0, fetchSignal;
        const response = await fetchMediaWithLifetime(async (_url, init) => {
            fetchSignal = init.signal;
            return new Response(new ReadableStream({ start(stream) { stream.enqueue(mp4); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'video/mp4' } });
        }, f.service.baseUrl, {}, caller.signal, 1000, 30, 5000);
        const download = f.service.streamVideoOutput(f.root, f.job, response, caller.signal, { provider: 'test', model: 'test', prompt: '' });
        if (mode === 'cancel') setTimeout(() => caller.abort(), 10);
        await assert.rejects(download, { code: mode === 'cancel' ? 'CANCELLED' : 'MEDIA_TIMEOUT' });
        assert.equal(fetchSignal.aborted, true); assert.equal(cancelled, 1);
        assert.deepEqual(await readdir(join(f.root, 'nextmux.media')), []);
    });
}

test('A-013 desktop rejects HTML, JSON and image containers masquerading as video', () => {
    for (const [prefix, mime] of [[mp4, 'text/html'], [Buffer.from('{"video":"url"}'), 'video/mp4'],
        [Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypavif')]), 'video/mp4']]) {
        assert.throws(() => assertVideoContainer(prefix, mime), { code: 'INVALID_VIDEO_OUTPUT' });
    }
});

test('A-015 desktop ElevenLabs caller preserves authored lyrics and instrumental intent', async t => {
    const f = await fixture(t), bodies = [];
    f.service.mediaConnection = async () => ({ apiKey: 'synthetic-fixture', connection: { protocol: 'elevenlabs_music',
        baseUrl: 'https://api.elevenlabs.io/v1', providerName: 'ElevenLabs' } });
    f.service.writeMediaOutput = async () => ({});
    f.service.networkFetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(Buffer.from('ID3fixture')); };
    const input = { connectionId: 'official-fixture', model: 'music_v2_5', prompt: 'Warm folk', format: 'mp3', durationSeconds: 30 };
    await f.service.executeMediaJob(f.root, { ...f.job, kind: 'music', input: { ...input, instrumental: true } }, new AbortController().signal);
    await f.service.executeMediaJob(f.root, { ...f.job, kind: 'music', input: { ...input, lyrics: '[Verse]\nKeep my words' } }, new AbortController().signal);
    assert.equal(bodies[0].force_instrumental, true);
    assert.equal(bodies[1].composition_plan.chunks[0].text, '[Verse]\nKeep my words');
});
