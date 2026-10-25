import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MediaJobStore, enqueueRequest } from '@nextmux/media-core';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const connectionId = 'official-00000000-0000-4000-8000-000000000001';
const wav = () => {
    const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40); return bytes;
};
async function fixture(t, mode = 'upload', cover = false) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-voice-runtime-')); t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'nextmux.media')); const bytes = wav(); await writeFile(join(root, 'nextmux.media/voice.wav'), bytes);
    const reference = { assetUri: 'nextmux.media/voice.wav', durationSeconds: 15, consent: true };
    const field = cover ? 'referenceSong' : 'vocalReference';
    const template = normalizeMediaTemplate({ preset: 'custom', kind: 'music',
        submit: { path: '{base}/generate', body: '{"model":"{{model}}","lyrics":"{{lyrics}}","instrumental":"{{instrumental}}","mode":"{{music_mode}}","voice":"{{vocal_reference}}","song":"{{reference_song}}"}' },
        poll: { path: '{base}/tasks/{id}' }, idField: 'id', statusField: 'status', doneValues: ['done'], failedValues: ['failed'], resultField: 'url',
        [field]: { mode, ...(mode === 'upload' ? { upload: { path: '{base}/upload', fileField: 'sample', idField: 'data.id', expiresInSeconds: 60 } } : {}) }
    });
    const connection = { id: connectionId, model: 'configured-music', label: 'Mock music', providerName: 'Mock', protocol: 'async_media_template',
        providerSettings: { mediaTemplate: template }, baseUrl: 'https://music.example/v1', discoveredModels: [] };
    const project = { id: 'project-00000001', scenes: [{ id: 'scene-00000001', shots: [{ id: 'shot-00000001' }] }], assets: [
        { id: 'asset-reference', kind: 'music', status: 'ready', uri: reference.assetUri, sha256: createHash('sha256').update(bytes).digest('hex') }
    ] };
    const sent = []; let uploadCount = 0, failSubmit = false, failDownload = false, measuredMs = 15000, credential = 'mock-credential';
    const store = await MediaJobStore.create({ root: join(root, 'queue') });
    class Service extends NextMuxPlatformServiceImpl {
        async mediaJobStore() { return store; }
        async comicProjectStore() { return { read: async () => ({ exists: true, project }) }; }
        async mediaConnection() { return { connection, apiKey: credential }; }
        async getMediaRuntimeState() { return { ffmpeg: { path: 'mock-ffmpeg', available: true } }; }
        async probeComicImport() { return { durationMs: measuredMs }; }
        async deviceId() { return 'mock-device'; }
        async waitForMedia() {}
        async writeMediaOutput(_workspace, _job, output, metadata) { return { ...metadata, byteLength: output.length }; }
    }
    const service = new Service();
    service.networkFetch = async (url, init) => {
        const target = new URL(url); sent.push({ url: target.href, init });
        // Media assets are downloaded through the pinned public-DNS route, so the mock answers the DoH lookup.
        if (target.hostname === 'cloudflare-dns.com') {
            const type = Number(target.searchParams.get('type')), name = target.searchParams.get('name');
            return Response.json({ Status: 0, TC: false, CD: false, Question: [{ name, type }],
                Answer: [{ name, type, TTL: 60, data: type === 1 ? '93.184.216.34' : '2606:2800:220:1:248:1893:25c8:1946' }] },
            { headers: { 'content-type': 'application/dns-json' } });
        }
        if (target.pathname === '/api/reference-drops') return Response.json({ url: 'https://drops.example/sample.wav' });
        if (target.pathname.endsWith('/upload')) {
            uploadCount++; assert.ok(init.body instanceof FormData); assert.equal(init.body.get('sample').type, 'audio/wav');
            return Response.json({ data: { id: `upload-${uploadCount}` } });
        }
        if (target.pathname.endsWith('/generate')) {
            if (failSubmit) { failSubmit = false; return Response.json({ message: 'temporary' }, { status: 429 }); }
            return Response.json({ id: 'song-job' });
        }
        if (target.pathname.endsWith('/tasks/song-job')) return Response.json({ status: 'done', url: 'https://cdn.example/song.wav' });
        if (target.hostname === 'cdn.example') {
            if (failDownload) { failDownload = false; return new Response(null, { status: 503 }); }
            return new Response(bytes, { headers: { 'content-type': 'audio/wav' } });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    const request = { kind: 'music', idempotencyKey: `reference-${mode}-${cover}`, projectId: project.id, sceneId: project.scenes[0].id, shotId: project.scenes[0].shots[0].id,
        input: { connectionId, model: connection.model, prompt: 'warm folk', lyrics: '[Verse]\nHello', durationSeconds: 30, format: 'wav',
            mode: cover ? 'cover' : 'generate', [field]: cover ? { assetUri: reference.assetUri, durationSeconds: 15 } : reference },
        cost: { billing: 'provider_billed', description: 'mock provider' } };
    const queued = await store.enqueue(request); await store.confirm(queued.id);
    let job = await store.claimNext(service.mediaWorkerId);
    return { root, service, store, request, connection, sent, get uploads() { return uploadCount; },
        get job() { return job; }, setDuration: value => { measuredMs = value; }, failSubmit: () => { failSubmit = true; },
        setCredential: value => { credential = value; },
        failDownload: () => { failDownload = true; },
        retry: async () => { await store.fail(job.id, service.mediaWorkerId, { code: 'RATE_LIMITED', message: 'mock retry', retryable: true });
            await store.retry(job.id); job = await store.claimNext(service.mediaWorkerId); },
        run: () => service.executeMediaJob(root, job, new AbortController().signal),
        validate: async (patch = {}) => service.validateMediaJobAgainstProject(root, enqueueRequest({ ...request, input: { ...request.input, ...patch } }))
    };
}

for (const mode of ['url', 'base64', 'upload']) test(`generic music template executes ${mode} reference delivery using mocked providers`, async t => {
    const f = await fixture(t, mode); await f.validate(); const output = await f.run(); assert.equal(output.assetKind, 'music');
    const body = JSON.parse(f.sent.find(entry => entry.url.endsWith('/generate')).init.body);
    assert.equal(body.voice, mode === 'url' ? 'https://drops.example/sample.wav' : mode === 'base64' ? wav().toString('base64') : 'upload-1');
    assert.equal(body.mode, 'generate'); assert.equal(body.lyrics, '[Verse]\nHello'); assert.equal(body.song, undefined);
    if (mode === 'url') assert.equal(f.sent.find(entry => entry.url.includes('/api/reference-drops')).init.headers['content-type'], 'audio/wav');
});

test('cover submits a song reference without voice cloning fields', async t => {
    const f = await fixture(t, 'upload', true); await f.validate(); await f.run();
    const body = JSON.parse(f.sent.find(entry => entry.url.endsWith('/generate')).init.body);
    assert.equal(body.mode, 'cover'); assert.equal(body.song, 'upload-1'); assert.equal(body.voice, undefined);
});

test('unsupported capability, explicit negative, missing consent, and actual short audio never submit', async t => {
    const f = await fixture(t);
    await assert.rejects(f.validate({ vocalReference: { ...f.request.input.vocalReference, consent: false } }), error => error.code === 'VOICE_CONSENT_REQUIRED');
    f.setDuration(14999); await assert.rejects(f.validate(), error => error.code === 'MUSIC_REFERENCE_TOO_SHORT'); f.setDuration(15000);
    f.connection.discoveredModels = [{ id: f.connection.model, capabilityDeclarations: { vocal_reference: { support: 'unsupported', source: 'provider_metadata', scope: 'model' } } }];
    await assert.rejects(f.validate(), error => error.code === 'MUSIC_CAPABILITY_UNSUPPORTED');
    f.connection.discoveredModels = []; f.connection.protocol = 'elevenlabs_music';
    await assert.rejects(f.validate(), error => error.code === 'MUSIC_CAPABILITY_UNSUPPORTED');
    assert.equal(f.sent.length, 0);
});

test('failed submission reuses durable upload IDs; expired IDs upload again on retry', async t => {
    const f = await fixture(t); f.failSubmit(); await assert.rejects(f.run());
    assert.equal((await (await MediaJobStore.create({ root: join(f.root, 'queue') })).get(f.job.id)).referenceUploads[0].id, 'upload-1');
    await f.retry(); f.failSubmit(); await assert.rejects(f.run()); assert.equal(f.uploads, 1);
    const cached = (await f.store.get(f.job.id)).referenceUploads[0];
    await f.store.saveReferenceUpload(f.job.id, f.service.mediaWorkerId, { ...cached, expiresAt: Date.now() - 1000 });
    await f.retry(); await f.run(); assert.equal(f.uploads, 2);
});

test('upload IDs are isolated by credential and changed reference bytes are rejected before upload', async t => {
    const f = await fixture(t); f.failSubmit(); await assert.rejects(f.run());
    await f.retry(); f.setCredential('another-mock-account'); f.failSubmit(); await assert.rejects(f.run()); assert.equal(f.uploads, 2);
    const changed = wav(); changed[44] = 1; await writeFile(join(f.root, 'nextmux.media/voice.wav'), changed);
    await assert.rejects(f.run(), error => error.code === 'MUSIC_REFERENCE_CHANGED'); assert.equal(f.uploads, 2);
});

test('an accepted song resumes polling/download after failure without uploading or generating again', async t => {
    const f = await fixture(t); f.failDownload(); await assert.rejects(f.run());
    const saved = await f.store.get(f.job.id); assert.equal(saved.remoteTask.taskId, 'song-job');
    await f.store.saveReferenceUpload(f.job.id, f.service.mediaWorkerId, { ...saved.referenceUploads[0], expiresAt: Date.now() - 1000 });
    await f.retry(); await f.run();
    assert.equal(f.uploads, 1); assert.equal(f.sent.filter(entry => entry.url.endsWith('/generate')).length, 1);
});
