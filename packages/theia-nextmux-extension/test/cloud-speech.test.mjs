import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudSpeechService } from '../lib/node/nextmux-cloud-speech.js';
import { CloudSpeechEngine } from '../lib/browser/nextmux-cloud-speech-engine.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const forbidden = () => assert.fail('Retired speech must not read credentials, capture or upload');

test('legacy cloudEnabled true cannot upload or expose accounts; old settings and audit remain untouched', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-disabled-speech-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const saved = JSON.stringify({ version: 1, cloudEnabled: true, connectionId: 'old-account' });
    const audit = '{"old":"historical-receipt"}\n';
    await writeFile(join(root, 'speech-settings-v1.json'), saved);
    await writeFile(join(root, 'speech-intents-v1.ndjson'), audit);
    const service = new CloudSpeechService({ root, accounts: forbidden, credential: forbidden, fetch: forbidden });
    assert.deepEqual(await service.state(), { cloudEnabled: false, accounts: [] });
    await assert.rejects(service.configure({ cloudEnabled: true, connectionId: 'old-account' }), /SPEECH_SYSTEM_DICTATION_ONLY/);
    assert.deepEqual(await service.configure({ cloudEnabled: false }), { cloudEnabled: false, accounts: [] });
    for (const request of [undefined, null, {}, { connectionId: 'old-account', dataBase64: 'fixture-audio' }]) {
        await assert.rejects(service.transcribe(request), /SPEECH_SYSTEM_DICTATION_ONLY/);
        await assert.rejects(service.transcribe(request), /SPEECH_SYSTEM_DICTATION_ONLY/);
    }
    assert.equal(await readFile(join(root, 'speech-settings-v1.json'), 'utf8'), saved);
    assert.equal(await readFile(join(root, 'speech-intents-v1.ndjson'), 'utf8'), audit);
});

test('actual platform RPC rejects old enabled transcription before credential/configuration/network access', async () => {
    const service = new NextMuxPlatformServiceImpl();
    service.nextmuxDataRoot = forbidden;
    service.readOfficialConnectionIndex = forbidden;
    service.readOfficialCredential = forbidden;
    service.networkFetch = forbidden;
    assert.deepEqual(await service.getCloudSpeechSettings(), { cloudEnabled: false, accounts: [] });
    await assert.rejects(service.configureCloudSpeech({ cloudEnabled: true, connectionId: 'old-account' }), /SPEECH_SYSTEM_DICTATION_ONLY/);
    for (let n = 0; n < 2; n++) await assert.rejects(service.transcribeCloudSpeech({ requestId: 'legacy-request', dataBase64: 'fixture-audio' }), error => error.code === 'SPEECH_SYSTEM_DICTATION_ONLY');
    assert.deepEqual(await service.cancelCloudSpeech('legacy-request', 'legacy-owner'), { cancelled: true });
});

test('legacy browser adapter refuses capture and releases every already-open track, without recorder or retry', async t => {
    t.mock.method(globalThis, 'fetch', forbidden);
    const stops = [];
    const engine = new CloudSpeechEngine({ transcribe: forbidden, createRecorder: forbidden, onTranscript: forbidden });
    assert.equal(await engine.readiness(), 'unsupported');
    await assert.rejects(engine.start({ stream: { getTracks: () => [
        { stop() { stops.push('one'); throw new Error('already-ended'); } }, { stop() { stops.push('two'); } }
    ] } }), /SPEECH_SYSTEM_DICTATION_ONLY/);
    assert.deepEqual(stops, ['one', 'two']);
});
