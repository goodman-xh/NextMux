import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { upstreamPrivacyPreference } from '../lib/common/nextmux-upstream-privacy-preference.js';
import { decideAppPlugin } from '../lib/node/nextmux-app-plugin-decisions.js';
import { invokeNativeDecision } from '@nextmux/model-runtime/decision-adapter';

const id = '11111111-1111-4111-8111-111111111111';
const quote = `kq1_${'a'.repeat(64)}`;
const preference = { mode: 'advisory-v1', zeroDataRetention: true, dataCollection: 'deny' };
const settings = { requireZeroDataRetention: true, denyDataCollection: true };
const questions = { next: { type: 'choice', criteria: { left: 'Left', right: 'Right' } } };
const assertAdvisory = body => {
    assert.deepEqual(body.privacyPreference, preference);
    assert.equal(Object.hasOwn(body, 'zeroDataRetention'), false);
    assert.equal(Object.hasOwn(body, 'dataCollection'), false);
    assert.equal(Object.hasOwn(body, 'provider'), false);
};

test('all checkbox combinations use advisory metadata for fixed/automatic coding/comic requests', () => {
    const service = Object.create(NextMuxPlatformServiceImpl.prototype);
    for (const mode of ['fixed', 'automatic']) for (const workbench of ['coding', 'comic']) {
        for (const requireZeroDataRetention of [false, true]) for (const denyDataCollection of [false, true]) {
            const selected = { requireZeroDataRetention, denyDataCollection };
            const route = mode === 'fixed' ? { mode, offeringId: id } : { mode, registryModelId: id };
            const body = service.managedGatewayBody(route,
                { messages: [], tools: [], workbench, conversationId: 'privacy-fixture' }, selected);
            const enabled = requireZeroDataRetention || denyDataCollection;
            assert.deepEqual(body.privacyPreference, upstreamPrivacyPreference(selected));
            assert.equal(body.privacyPreference.mode, 'advisory-v1');
            assert.equal(body.privacyPreference.zeroDataRetention, enabled);
            assert.equal(body.privacyPreference.dataCollection, enabled ? 'deny' : 'allow');
            assert.equal(Object.hasOwn(body, 'zeroDataRetention'), false);
            assert.equal(Object.hasOwn(body, 'dataCollection'), false);
        }
    }
});

test('explicit API constraints remain separate from the desktop preference', () => {
    const service = Object.create(NextMuxPlatformServiceImpl.prototype);
    const body = service.managedGatewayBody({ mode: 'fixed', offeringId: id },
        { messages: [], tools: [], workbench: 'coding', conversationId: 'privacy-fixture', zeroDataRetention: true, dataCollection: 'deny' },
        { requireZeroDataRetention: false, denyDataCollection: false });
    assert.deepEqual(body.privacyPreference, { mode: 'advisory-v1', zeroDataRetention: false, dataCollection: 'allow' });
    assert.equal(body.zeroDataRetention, true);
    assert.equal(body.dataCollection, 'deny');
});

test('managed image, speech, music and effect POSTs send preferences without changing the content', async () => {
    const service = new NextMuxPlatformServiceImpl(), calls = [];
    service.baseUrl = 'https://platform.example';
    service.getPrivacySettings = async () => settings;
    service.deviceId = async () => 'synthetic-device';
    service.characterReferenceDataUrls = async () => [];
    service.withLegacyCapacity = async (_key, _body, submit) => submit();
    service.networkFetch = async (_url, init) => {
        const body = JSON.parse(init.body); calls.push(body);
        return new Response(new Uint8Array([1]), { headers: { 'content-type': body.kind === 'image' ? 'image/png' : 'audio/mpeg',
            'x-nextmux-extension': body.kind === 'image' ? 'png' : 'mp3' } });
    };
    for (const kind of ['image', 'speech', 'music', 'sound_effect']) {
        const input = { connectionId: `managed:fixed:${id}`, keyPriceQuoteId: quote, model: 'fixture',
            prompt: 'unchanged input', text: 'unchanged input', width: 1024, height: 1024, voice: 'fixture', format: 'mp3', durationSeconds: 5 };
        await service.requestManagedMedia({ id: 'fixture', kind, idempotencyKey: `privacy-${kind}` }, input, new AbortController().signal);
        assertAdvisory(calls.at(-1));
        assert.equal(calls.at(-1).input[kind === 'speech' ? 'text' : 'prompt'], 'unchanged input');
    }
    assert.equal(calls.length, 4, 'no fallback or repeated generation is added');
});

test('managed video creation sends preferences and keeps the accepted task flow', async () => {
    const service = new NextMuxPlatformServiceImpl(), calls = [];
    service.baseUrl = 'https://platform.example';
    service.getPrivacySettings = async () => settings;
    service.deviceId = async () => 'synthetic-device';
    service.withLegacyCapacity = async (_key, _body, submit) => submit();
    service.remoteTaskOf = () => undefined;
    service.noteRemoteTask = async () => {};
    service.mediaPollingStartedAt = () => 0;
    service.timedMediaFetch = async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return Response.json({ job: { id, status: 'completed', providerName: 'fixture', model: 'fixture' } });
    };
    service.fetchVideoOutput = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
    service.streamVideoOutput = async () => ({ relativeUri: 'fixture.mp4' });
    service.reportVideoMeasurement = async () => {};
    await service.requestManagedVideo('', { id: 'fixture', kind: 'video', idempotencyKey: 'privacy-video' },
        { connectionId: `managed:fixed:${id}`, keyPriceQuoteId: quote, model: 'fixture', prompt: 'unchanged video input', durationSeconds: 5, width: 1024, height: 576 },
        new AbortController().signal);
    assert.equal(calls.length, 1);
    assertAdvisory(calls[0]);
    assert.equal(calls[0].prompt, 'unchanged video input');
});

test('plugin decisions read the latest preference only for managed calls', async () => {
    const calls = []; let reads = 0;
    const connection = { id: 'own', protocol: 'openrouter', baseUrl: 'https://relay.example/api/v1',
        models: [{ id: 'typesafe/jev-1.13', outputModalities: ['decisions'] }] };
    const host = { baseUrl: 'https://platform.example', deviceId: async () => 'synthetic-device',
        privacyPreference: async () => { reads++; return preference; }, connections: async () => [connection], connectionKey: async () => undefined,
        fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ answers: { next: { choice: 'left' } } }); } };
    const common = { state: 'unchanged state', questions };
    assert.equal((await decideAppPlugin(host, { ...common, model: { source: 'nextmux', model: 'typesafe/jev-1.13', offeringId: id } })).ok, true);
    assertAdvisory(calls[0]); assert.equal(calls[0].state, common.state); assert.equal(reads, 1);
    host.privacyPreference = async () => assert.fail('own API must not read managed preferences');
    assert.equal((await decideAppPlugin(host, { ...common, model: { source: 'connection', connectionId: 'own', model: 'typesafe/jev-1.13' } })).ok, true);
    assert.equal(Object.hasOwn(calls[1], 'privacyPreference'), false);
    assert.equal(calls.length, 2);
});

test('the native decision adapter never leaks NextMux preference fields to own or local protocols', async () => {
    for (const [protocol, suffix] of [['nextmux_decisions', '/v1/decisions'], ['openrouter_decisions', '/api/alpha/decisions'], ['systemone', '/v1/systemone']]) {
        let sent;
        await invokeNativeDecision({ protocol, endpoint: `https://fixture.example${suffix}`, model: 'typesafe/jev-1.13', state: 'fixture', questions,
            privacyPreference: preference, fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ answers: {} }); } });
        assert.equal(Object.hasOwn(sent, 'privacyPreference'), protocol === 'nextmux_decisions');
        assert.equal(sent.state, 'fixture');
    }
});
