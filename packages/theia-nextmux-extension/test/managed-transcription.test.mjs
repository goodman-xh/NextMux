import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createManagedTranscriber } from '../lib/node/nextmux-managed-transcription.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { modelFailureText } from '../lib/browser/nextmux-model-errors.js';

const offeringId = '11111111-1111-4111-8111-111111111111';
const quote = `kq1_${'a'.repeat(64)}`;

async function audioFixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-managed-asr-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'audio.wav');
    await writeFile(path, Buffer.alloc(128, 1));
    return path;
}

test('managed transcription sends one quoted multipart request and preserves timed segments', async t => {
    const audioPath = await audioFixture(t);
    const calls = [];
    const transcriber = createManagedTranscriber({
        endpoint: 'https://relay.example/api/gateway/audio/transcriptions', deviceId: 'device-1',
        requestId: 'comic-asr-stable', model: 'whisper-fixture',
        route: { automaticRouting: false, offeringId, keyPriceQuoteId: quote, zeroDataRetention: true, dataCollection: 'deny' },
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return Response.json({ text: '你好', language: 'zh', segments: [{ text: '你好', start: 0.125, end: 0.875 }] },
                { headers: { 'x-nextmux-request-id': 'upstream-1' } });
        },
        responseError: () => assert.fail('the response succeeded'),
        transportError: () => assert.fail('the response was readable')
    });
    const result = await transcriber.transcribe({ audioPath, locale: 'zh-CN' });
    assert.deepEqual(result, {
        segments: [{ text: '你好', startMs: 125, endMs: 875 }], language: 'zh', providerRequestId: 'upstream-1'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://relay.example/api/gateway/audio/transcriptions');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers['x-nextmux-device-id'], 'device-1');
    assert.equal(calls[0].init.headers['idempotency-key'], 'comic-asr-stable');
    const body = calls[0].init.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get('model'), 'whisper-fixture');
    assert.equal(body.get('offeringId'), offeringId);
    assert.equal(body.get('automaticRouting'), 'false');
    assert.equal(body.get('keyPriceQuoteId'), quote);
    assert.equal(body.get('zeroDataRetention'), 'true');
    assert.equal(body.get('dataCollection'), 'deny');
    assert.equal(body.get('language'), 'zh');
    assert.equal(body.get('response_format'), 'verbose_json');
    assert.deepEqual(body.getAll('timestamp_granularities[]'), ['segment']);
    assert.equal(body.get('file').name, 'audio.wav');
    assert.equal(body.get('file').type, 'audio/wav');
    assert.equal(body.get('file').size, 128);
});

test('managed transcription refuses untimed output and does not invent subtitle timing', async t => {
    const audioPath = await audioFixture(t);
    let calls = 0;
    const transcriber = createManagedTranscriber({
        endpoint: 'https://relay.example/api/gateway/audio/transcriptions', deviceId: 'device-1',
        requestId: 'comic-asr-stable', model: 'whisper-fixture', route: { offeringId },
        fetchImpl: async () => { calls++; return Response.json({ text: 'No timestamps' }); },
        responseError: () => assert.fail('the response succeeded'),
        transportError: () => assert.fail('the response was readable')
    });
    await assert.rejects(transcriber.transcribe({ audioPath }), error => error.code === 'INVALID_TRANSCRIPT_TIMESTAMPS');
    assert.equal(calls, 1);
    await assert.rejects(transcriber.transcribe({ audioPath, signal: AbortSignal.abort() }), error => error.code === 'CANCELLED');
    assert.equal(calls, 1, 'an aborted request does not upload');
});

test('service requires explicit cost consent and a valid quote or direct price ceiling before an audio upload', async t => {
    const audioPath = await audioFixture(t);
    const uploads = [];
    class Service extends NextMuxPlatformServiceImpl {
        async getPrivacySettings() { return { requireZeroDataRetention: true, denyDataCollection: true }; }
        async deviceId() { return 'device-1'; }
        async timedMediaFetch(url, init) {
            uploads.push({ url, init });
            return Response.json({ segments: [{ text: 'ready', start: 0, end: 0.5 }] });
        }
    }
    const service = new Service();
    const route = { connectionId: `managed:fixed:${offeringId}`, model: 'whisper-fixture', keyPriceQuoteId: quote, costConfirmed: true };
    await assert.rejects(service.managedComicShotTranscriber({ requestId: 'comic-asr-stable', managedRoute: { ...route, costConfirmed: false } }),
        error => error.code === 'ASR_COST_CONFIRMATION_REQUIRED');
    await assert.rejects(service.managedComicShotTranscriber({ requestId: 'comic-asr-stable', managedRoute: { ...route, keyPriceQuoteId: undefined } }),
        error => error.code === 'PRICE_AUTHORIZATION_REQUIRED');
    assert.equal(uploads.length, 0);
    const transcriber = await service.managedComicShotTranscriber({ requestId: 'comic-asr-stable', managedRoute: route });
    await transcriber.transcribe({ audioPath });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].init.body.get('offeringId'), offeringId);
    assert.equal(uploads[0].init.body.get('keyPriceQuoteId'), quote);
    assert.equal(uploads[0].init.body.has('zeroDataRetention'), false);
    assert.equal(uploads[0].init.body.has('dataCollection'), false);
    assert.deepEqual(JSON.parse(uploads[0].init.body.get('privacyPreference')), { mode: 'advisory-v1', zeroDataRetention: true, dataCollection: 'deny' });
    const direct = await service.managedComicShotTranscriber({ requestId: 'comic-asr-direct', managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model: 'whisper-fixture', keyPriceQuoteId: quote,
        maximumPriceMicros: 600, costConfirmed: true
    } });
    await direct.transcribe({ audioPath });
    assert.equal(uploads.length, 2);
    assert.equal(uploads[1].init.body.get('keyPriceQuoteId'), quote);
    assert.equal(uploads[1].init.body.get('maximumPriceMicros'), '600');
    await assert.rejects(service.managedComicShotTranscriber({ requestId: 'comic-asr-direct', managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model: 'whisper-fixture', maximumPriceMicros: -1, costConfirmed: true
    } }), error => error.code === 'PRICE_AUTHORIZATION_REQUIRED');
});

test('an unknown post-upload outcome is marked for billing review and is unsafe to retry', async t => {
    const audioPath = await audioFixture(t);
    class Service extends NextMuxPlatformServiceImpl {
        async getPrivacySettings() { return { requireZeroDataRetention: false, denyDataCollection: false }; }
        async deviceId() { return 'device-1'; }
        async timedMediaFetch() { throw new Error('Connection lost after upload'); }
    }
    const service = new Service();
    const transcriber = await service.managedComicShotTranscriber({ requestId: 'comic-asr-stable', managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model: 'whisper-fixture', maximumPriceMicros: 600, costConfirmed: true
    } });
    await assert.rejects(transcriber.transcribe({ audioPath }), error => error.code === 'BILLING_TRANSPORT_UNKNOWN'
        && error.retrySafe === false && error.recoveryMode === 'billing_review');
    service.timedMediaFetch = async () => new Response('invalid gateway response');
    await assert.rejects(transcriber.transcribe({ audioPath }), error => error.code === 'BILLING_TRANSPORT_UNKNOWN'
        && error.retrySafe === false && error.recoveryMode === 'billing_review');
});

test('managed transcription relay errors use the existing formatter in all desktop locales', async t => {
    const audioPath = await audioFixture(t);
    class Service extends NextMuxPlatformServiceImpl {
        async getPrivacySettings() { return { requireZeroDataRetention: false, denyDataCollection: false }; }
        async deviceId() { return 'device-1'; }
        async timedMediaFetch() {
            return Response.json({ code: 'INSUFFICIENT_BALANCE', message: 'Balance is too low' }, { status: 402 });
        }
    }
    const service = new Service();
    const transcriber = await service.managedComicShotTranscriber({ requestId: 'comic-asr-stable', managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model: 'whisper-fixture', keyPriceQuoteId: quote, costConfirmed: true
    } });
    let failure;
    try { await transcriber.transcribe({ audioPath }); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'INSUFFICIENT_BALANCE');
    const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    const localized = locales.map(locale => modelFailureText(locale, failure));
    assert.equal(localized.length, 12);
    for (const text of localized) assert.ok(text && text !== 'Balance is too low');
    assert.notEqual(localized[0], localized[1]);
});

test('service cloud transcription waits and resumes the same multipart key without persisting audio',async t=>{
 const audioPath=await audioFixture(t),root=join(audioPath,'..'),requestId='66666666-6666-4666-8666-666666666666',bodies=[];let submits=0;
 class Service extends NextMuxPlatformServiceImpl{nextmuxDataRoot(){return root;}async getPrivacySettings(){return{};}async deviceId(){return'device-1';}async timedMediaFetch(_url,init){submits++;bodies.push(init.body);assert.equal(init.headers['idempotency-key'],'original-audio-wait');return submits===1?Response.json({code:'waiting_capacity',details:{requestId,bodyHash:'a'.repeat(64),waitingCapacity:true,canResume:true,providerAccepted:false,retryAfter:1}},{status:409}):Response.json({segments:[{text:'same audio',start:0,end:1}]});}}
 const service=new Service();service.mediaDeliveryAccountId='owner';const transcriber=await service.managedComicShotTranscriber({requestId:'original-audio-wait',managedRoute:{connectionId:`managed:fixed:${offeringId}`,model:'fixture',maximumPriceMicros:600,costConfirmed:true}});const result=await transcriber.transcribe({audioPath});assert.equal(result.segments[0].text,'same audio');assert.equal(submits,2);assert.deepEqual(new Uint8Array(await bodies[0].get('file').arrayBuffer()),new Uint8Array(await bodies[1].get('file').arrayBuffer()));
});
