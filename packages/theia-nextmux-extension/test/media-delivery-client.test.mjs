import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { persistAgentOutputParts } from '../lib/node/nextmux-agent-output-assets.js';
import { localManagedOutputMessages } from '../lib/node/nextmux-media-delivery-output.js';
import { MediaDeliveryOutbox } from '../lib/node/nextmux-media-delivery-outbox.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const png = Buffer.from(pngBase64, 'base64');
const requestId = '11111111-2222-4333-8444-555555555555';
const request = { idempotencyKey: 'delivery-fixture-original', kind: 'image', projectId: 'project-00000001', sceneId: 'scene-00000001', shotId: 'shot-00000001',
    input: { connectionId: `managed:fixed:${requestId}`, keyPriceQuoteId: `kq1_${'a'.repeat(64)}`, model: 'fixture', prompt: 'Fixture', width: 1024, height: 1024 },
    cost: { billing: 'platform_billed', description: 'fixture; no provider call' } };
async function root(t) {
    const value = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-client-delivery-')));
    t.after(() => rm(value, { recursive: true, force: true })); return value;
}
function serviceAt(root) {
    const service = new NextMuxPlatformServiceImpl();
    service.nextmuxDataRoot = () => root; service.baseUrl = 'https://fixture.invalid';
    service.deviceId = async () => 'device-fixture'; service.mediaDeliveryAccountId = 'user-fixture';
    service.networkFetch = async () => assert.fail('No model request or download is allowed');
    return service;
}

test('subsequent managed image/audio history reads local owner bytes while text-only history does no storage work', async t => {
    const directory = await root(t);
    const parts = await persistAgentOutputParts(directory, 'conversation-a', [{ type: 'text', text: 'Before' },
        { type: 'image', mimeType: 'image/png', sizeBytes: png.length, dataBase64: pngBase64 }]);
    const messages = [{ role: 'assistant', content: 'Before', outputParts: parts }], before = JSON.stringify(messages);
    const next = await localManagedOutputMessages(directory, 'conversation-a', [...messages, ...messages]);
    assert.equal(next[0].outputParts[1].dataBase64, pngBase64);
    assert.equal(next[1].outputParts[1].dataBase64, pngBase64);
    assert.equal(JSON.stringify(messages), before, 'model transport never adds raw bytes to persisted history');
    await assert.rejects(localManagedOutputMessages(directory, 'conversation-b', messages));
    const text = [{ role: 'user', content: 'hello' }];
    assert.deepEqual(await localManagedOutputMessages('/nonexistent/never-read', '', text), text);
});

test('managed outputs stage only after safe file write and wait for real persistent checkpoint before ACK', async t => {
    const directory = await root(t), service = serviceAt(directory), store = await service.mediaJobStore(directory);
    const pending = await store.enqueue(request); await store.confirm(pending.id); const job = await store.claimNext(service.mediaWorkerId);
    let now = Date.now(), calls = 0;
    const outbox = new MediaDeliveryOutbox({ dataRoot: directory, baseUrl: service.baseUrl, accountId: 'user-fixture', deviceId: 'device-fixture',
        now: () => now, random: () => 0, automatic: false, recoverable: record => service.mediaDeliveryRecoverable(record),
        fetch: async (_url, init) => { calls++; assert.equal(JSON.parse(init.body).requestId, requestId); return Response.json({ ok: true, delivered: true }); } });
    t.after(() => outbox.dispose()); service.mediaDeliveryOutboxPromise = Promise.resolve(outbox);
    const output = await service.writeMediaOutput(directory, job, png, { assetKind: 'image', extension: 'png', mimeType: 'image/png',
        provider: 'fixture', model: 'fixture', providerEvidence: { providerRequestId: requestId } });
    await service.stageMediaDelivery(directory, job, output); now += 1000; await outbox.flush(); assert.equal(calls, 0);
    await store.saveCheckpoint(job.id, service.mediaWorkerId, output); now += 30_000; await outbox.flush(); assert.equal(calls, 1);
    await service.stageMediaDelivery(directory, job, output); now += 30_000; await outbox.flush();
    assert.equal(calls, 1, 'workspace refresh never resends an already acknowledged receipt');
    const reopened = serviceAt(directory), saved = await (await reopened.mediaJobStore(directory)).get(job.id);
    assert.equal(saved.checkpoint.sha256, createHash('sha256').update(png).digest('hex'));
    assert.deepEqual(await readFile(join(directory, saved.checkpoint.relativeUri)), png);
});

test('SIGKILL between local file/outbox save and media checkpoint recovers without a model call or download', async t => {
    const directory = await root(t), module = fileURLToPath(new URL('../lib/node/nextmux-platform-service.js', import.meta.url));
    const child = spawn(process.execPath, ['-e', `
      const { NextMuxPlatformServiceImpl } = require(process.argv[1]);
      const [root, request, png, requestId] = JSON.parse(process.argv[2]);
      (async () => {
        const service = new NextMuxPlatformServiceImpl(); service.nextmuxDataRoot = () => root;
        service.baseUrl = 'https://fixture.invalid'; service.deviceId = async () => 'device-fixture'; service.mediaDeliveryAccountId = 'user-fixture';
        service.networkFetch = async () => { throw Error('unexpected network'); };
        const store = await service.mediaJobStore(root), pending = await store.enqueue(request);
        await store.confirm(pending.id); const job = await store.claimNext(service.mediaWorkerId, { now: new Date(Date.now() - 60_000).toISOString() });
        const output = await service.writeMediaOutput(root, job, Buffer.from(png, 'base64'), {assetKind:'image',extension:'png',mimeType:'image/png',provider:'fixture',model:'fixture',providerEvidence:{providerRequestId:requestId}});
        await service.stageMediaDelivery(root, job, output);
        process.kill(process.pid, 'SIGKILL');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, module, JSON.stringify([directory, request, pngBase64, requestId])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const ended = await new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(ended.signal, 'SIGKILL', stderr);
    const service = serviceAt(directory), store = await service.mediaJobStore(directory);
    let calls = 0;
    const outbox = new MediaDeliveryOutbox({ dataRoot: directory, baseUrl: service.baseUrl, accountId: 'user-fixture', deviceId: 'device-fixture',
        now: () => Date.now() + 60_000, random: () => 0, automatic: false, recoverable: record => service.mediaDeliveryRecoverable(record),
        fetch: async () => { calls++; return Response.json({ ok: true, delivered: true }); } });
    t.after(() => outbox.dispose()); service.mediaDeliveryOutboxPromise = Promise.resolve(outbox);
    await outbox.flush(); assert.equal(calls, 0, 'orphan file alone must not authorize cloud deletion');
    await service.ensureMediaRecovery(directory, store);
    const recovered = (await store.list(10))[0];
    assert.equal(recovered.status, 'queued'); assert.ok(recovered.checkpoint, 'sidecar was adopted into the real queue');
    const resumed = new MediaDeliveryOutbox({ ...outbox.options, now: () => Date.now() + 120_000 }); t.after(() => resumed.dispose());
    await resumed.flush(); assert.equal(calls, 1);
});

test('own API and local outputs never stage a platform media deletion', async t => {
    const directory = await root(t), service = serviceAt(directory);
    service.mediaDeliveryOutbox = async () => assert.fail('own API must not access managed cleanup');
    for (const connectionId of ['official:my-key', 'comfyui:local']) await service.stageMediaDelivery(directory,
        { id: randomUUID(), kind: 'image', input: { connectionId } }, { providerEvidence: { providerRequestId: requestId } });
});

test('ordered delivery waits for real run checkpoint plus journal, and replays verified local media even after URL expiry', async t => {
    const directory = await root(t), service = serviceAt(directory), ownerId = 'conversation-ordered-fixture', runId = 'agent-ordered-fixture';
    const sha256 = createHash('sha256').update(png).digest('hex'), asset = { sha256, mimeType: 'image/png', sizeBytes: png.length };
    const result = { call: { id: requestId }, response: { content: 'Saved', outputParts: [{ type: 'text', text: 'Saved' }, { type: 'image', asset }],
        outputAssets: [{ partIndex: 1, ...asset, downloadPath: `/api/gateway/responses/${requestId}/output/1`, expiresAt: Date.now() + 60_000 }] } };
    let now = Date.now(), acks = 0, downloads = 0;
    service.networkFetch = async () => { downloads++; return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length),
        'x-nextmux-call-id': requestId, 'x-nextmux-part-index': '1', 'x-nextmux-sha256': sha256 } }); };
    const outbox = new MediaDeliveryOutbox({ dataRoot: directory, baseUrl: service.baseUrl, accountId: 'user-fixture', deviceId: 'device-fixture',
        now: () => now, random: () => 0, automatic: false, recoverable: record => service.mediaDeliveryRecoverable(record),
        fetch: async () => { acks++; return Response.json({ ok: true, delivered: true }); } });
    service.mediaDeliveryOutboxPromise = Promise.resolve(outbox); t.after(() => outbox.dispose());
    const parts = await service.persistManagedGatewayOutputParts(result, ownerId, undefined, { runId, workspaceRoot: directory });
    now += 1000; await outbox.flush(); assert.equal(acks, 0); assert.equal(downloads, 1);
    const { AgentRunStateStore } = await import('../lib/node/nextmux-agent-run-state-store.js');
    const checkpointId = await new AgentRunStateStore(service.agentCheckpointRoot(directory)).save({ version: 2, runId, executionScopeId: 'scope-ordered-fixture',
        nextTurn: 1, segment: 1, messages: [{ role: 'assistant', content: 'Saved', outputParts: parts }], seenToolCallIds: [],
        usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, repeatedToolBatchTurns: 0, createdAt: new Date().toISOString() },
        { workspaceRoot: directory, conversationId: ownerId, rootRunId: runId, depth: 0 });
    now += 30_000; await outbox.flush(); assert.equal(acks, 0, 'a checkpoint without its durable owner journal is not discoverable');
    await service.agentRunJournalStore().save({ schemaVersion: 1, runId, state: 'running', owner: { workspaceRoot: directory, conversationId: ownerId, rootRunId: runId, depth: 0 },
        workbench: 'coding', permissionMode: 'workspace_write', createdAt: 1000, updatedAt: 1000, checkpointId });
    now += 60_000; await outbox.flush(); assert.equal(acks, 1);
    const reopened = serviceAt(directory); result.response.outputAssets[0].expiresAt = 1;
    const replay = await reopened.persistManagedGatewayOutputParts(result, ownerId);
    assert.deepEqual(replay, parts, 'server-deleted output stays usable from its verified owner file');
});

test('history wrapper leaves text fast path alone, dispatches one fixed logical request and releases only after a result', async t => {
    const service = serviceAt(await root(t)), route = { mode: 'fixed', offeringId: requestId };
    service.getPrivacySettings = async () => ({ requireZeroDataRetention: false, denyDataCollection: false });
    const request = { messages: [{ role: 'user', content: 'text only' }], tools: [], workbench: 'general', conversationId: 'conversation-wrapper' };
    service.getPrivacySettings = async () => assert.fail('text fast path adds no extra settings read');
    assert.deepEqual(await service.withManagedHistoryInputs(route, request, 'same-key', undefined, async prepared => prepared), request);
    service.getPrivacySettings = async () => ({ requireZeroDataRetention: false, denyDataCollection: false });
    const asset = { sha256: createHash('sha256').update(png).digest('hex'), mimeType: 'image/png', sizeBytes: png.length };
    request.messages = [{ role: 'assistant', content: '', outputParts: [{ type: 'image', asset, dataBase64: pngBase64 }] }];
    let dispatched = 0, released = 0;
    service.stageHistoryInputRelease = async ids => { released++; assert.deepEqual(ids, []); };
    await service.withManagedHistoryInputs(route, request, 'same-key', undefined, async () => { dispatched++; return { fixture: true }; });
    assert.equal(dispatched, 1); assert.equal(released, 1);
    await assert.rejects(service.withManagedHistoryInputs(route, request, 'same-key', undefined, async () => { dispatched++; throw new Error('accepted outcome unknown'); }));
    assert.equal(dispatched, 2); assert.equal(released, 1, 'unknown outcome retains temporary inputs for original-request recovery');
});

test('own API temporary reference scope follows the job and cleanup requires confirmed provider terminal state', async t => {
    const { normalizeMediaTemplate } = await import('@nextmux/model-runtime/media-template');
    const directory = await root(t), service = serviceAt(directory), signal = new AbortController().signal;
    const scope = `media-job-${randomUUID()}`;
    service.networkFetch = async (_url, init) => {
        assert.equal(init.headers['x-nextmux-reference-scope'], scope);
        return Response.json({ url: 'https://fixture.invalid/reference.png' });
    };
    assert.equal(await service.referenceDropUrl(png, signal, undefined, scope), 'https://fixture.invalid/reference.png');
    const template = normalizeMediaTemplate({ preset: 'custom', kind: 'image', images: 'link', maxReferences: 1,
        submit: { path: '{base}/generate', body: '{"references":"{{references}}"}' }, poll: { path: '{base}/tasks/{id}' },
        idField: 'id', statusField: 'status', doneValues: ['done'], failedValues: ['failed'], resultField: 'url' });
    const input = { connectionId: 'official:fixture', model: 'fixture', prompt: 'fixture', width: 1024, height: 1024, characterReferenceUris: ['nextmux.media/reference.png'] };
    const job = { id: scope, kind: 'image', input, remoteTask: { taskId: 'already-accepted', submittedAt: new Date().toISOString() } };
    const connection = { id: input.connectionId, providerId: 'fixture', label: 'Fixture', protocol: 'async_media_template', baseUrl: 'https://fixture.invalid', providerSettings: { mediaTemplate: template } };
    service.waitForMedia = async () => {}; const released = [];
    service.stageReferenceRelease = async (...args) => { released.push(args); };
    service.fetchVideoOutput = async () => { throw new Error('download failed after known terminal'); };
    for (const [state, expected] of [['done', 'completed'], ['failed', 'failed'], ['cancelled', 'cancelled']]) {
        service.timedMediaFetch = async (_url, init) => { assert.equal(init.method, 'GET', 'accepted task must never submit again');
            return Response.json({ status: state, url: 'https://fixture.invalid/output.png' }); };
        await assert.rejects(service.requestTemplateMedia(directory, job, input, connection, 'test-only-key', signal, false));
        assert.deepEqual(released.at(-1), [directory, scope, expected]);
    }
    const before = released.length;
    service.timedMediaFetch = async () => { throw new TypeError('poll outcome unknown'); };
    await assert.rejects(service.requestTemplateMedia(directory, job, input, connection, 'test-only-key', signal, false));
    assert.equal(released.length, before, 'transport uncertainty cannot release a still-needed input');
    const aborted = new AbortController(); aborted.abort();
    service.waitForMedia = async () => { throw new Error('cancel requested locally'); };
    await assert.rejects(service.requestTemplateMedia(directory, job, input, connection, 'test-only-key', aborted.signal, false));
    assert.equal(released.length, before, 'sending cancellation is not terminal confirmation');
});

test('a queued video with a durable verified download resumes attachment without GET or model execution', async t => {
    const directory = await root(t), original = serviceAt(directory), store = await original.mediaJobStore(directory);
    const pending = await store.enqueue({ ...request, kind: 'video', idempotencyKey: 'video-download-before-checkpoint',
        input: { ...request.input, durationSeconds: 5, width: 1280, height: 720 } });
    await store.confirm(pending.id); const job = await store.claimNext(original.mediaWorkerId);
    await store.saveRemoteTask(job.id, original.mediaWorkerId, { taskId: requestId, submittedAt: new Date().toISOString() });
    const bytes = Buffer.alloc(24); bytes.writeUInt32BE(24, 0); bytes.write('ftypisom', 4);
    original.getMediaRuntimeState = async () => ({ ffmpeg: { path: 'fixture-probe' } });
    original.probeMediaTracks = async () => ({ nativeAudio: false, nativeSubtitles: false, subtitleCheck: 'not_embedded', checkedAt: new Date().toISOString(), checker: 'ffmpeg' });
    const output = await original.streamVideoOutput(directory, job, new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': '24' } }),
        new AbortController().signal, { provider: 'fixture', model: 'fixture', prompt: 'fixture' });
    await store.releaseWorker(original.mediaWorkerId);
    const resumed = serviceAt(directory); resumed.mediaDeliveryAccountId = undefined;
    await resumed.ensureMediaRecovery(directory, store);
    assert.equal((await store.get(job.id)).status, 'queued'); assert.equal((await store.get(job.id)).checkpoint, undefined);
    resumed.validateMediaJobAgainstProject = async () => assert.fail('no fresh generation validation');
    resumed.executeMediaJob = async () => assert.fail('verified paid result must not generate again');
    resumed.setMediaShotStatus = async () => {}; let attached = 0;
    resumed.attachMediaCheckpoint = async (_root, _job, checkpoint) => { attached++; assert.deepEqual(checkpoint, output); };
    await resumed.runMediaLane(directory, store);
    assert.equal(attached, 1, JSON.stringify(await store.get(job.id))); assert.equal((await store.get(job.id)).status, 'succeeded');
});
