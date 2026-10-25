import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(status = 'queued', connection) {
    const service = new NextMuxPlatformServiceImpl();
    service.baseUrl = 'https://platform.fixture.invalid';
    service.deviceId = async () => 'fixture-device';
    service.readOfficialConnectionIndex = async () => connection ? [connection] : [];
    service.readOfficialCredential = async () => 'fixture-key';
    service.executeMediaJob = async () => { throw new Error('Cancellation must never generate'); };
    service.mediaConnection = async () => { throw new Error('New-generation admission must not block cancelling an accepted task'); };
    let job = { id: `media-${id}`, kind: 'video', status,
        input: { connectionId: connection?.id || `managed:fixed:${id}`, model: 'fixture', prompt: 'Fixture prompt' },
        remoteTask: { taskId: id, submittedAt: new Date().toISOString() } };
    service.mediaJobStore = async () => ({
        get: async () => job,
        cancel: async () => {
            job = job.status === 'running' ? { ...job, cancelRequestedAt: new Date().toISOString() }
                : { ...job, status: 'cancelled' };
            return job;
        }
    });
    const calls = [];
    service.networkFetch = async (url, init) => {
        calls.push({ url: String(url), ...init });
        return new Response(null, { status: 202 });
    };
    const lifetimes = [];
    service.timedMediaFetch = async (url, init, signal, timeoutMs) => {
        lifetimes.push({ timeoutMs, aborted: signal.aborted });
        return NextMuxPlatformServiceImpl.prototype.timedMediaFetch.call(service, url, init, signal, timeoutMs);
    };
    return { service, calls, lifetimes, job,
        cancel: () => service.cancelMediaJob('/fixture', job.id) };
}

for (const status of ['queued', 'paused', 'running']) {
    test(`an accepted managed video cancelled during ${status} recovery sends one bounded DELETE`, async () => {
        const f = fixture(status);
        await f.cancel();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].method, 'DELETE');
        assert.equal(f.calls[0].url, `https://platform.fixture.invalid/api/gateway/video/jobs/${id}`);
        assert.equal(f.calls[0].headers['x-nextmux-device-id'], 'fixture-device');
        assert.deepEqual(f.lifetimes, [{ timeoutMs: 10_000, aborted: false }]);
        if (status !== 'running') {
            await f.cancel();
            assert.equal(f.calls.length, 1, 'a completed local cancellation is idempotent');
        }
    });
}

for (const status of ['queued', 'paused']) {
    for (const protocol of ['openai_chat_completions', 'gemini_generate_content']) {
        test(`an accepted ${protocol} video in ${status} recovery only POSTs its cancel endpoint`, async () => {
            const f = fixture(status, { id, protocol, baseUrl: 'https://provider.fixture.invalid/v1/',
                discoveredModels: [{ id: 'fixture', available: false }] });
            if (protocol === 'gemini_generate_content') f.job.remoteTask.taskId = 'operations/accepted-task';
            await f.cancel();
            assert.equal(f.calls.length, 1);
            assert.equal(f.calls[0].method, 'POST');
            assert.equal(f.calls[0].url, protocol === 'gemini_generate_content'
                ? 'https://provider.fixture.invalid/v1/operations/accepted-task:cancel'
                : `https://provider.fixture.invalid/v1/videos/${id}/cancel`);
            assert.equal(f.calls[0].headers[protocol === 'gemini_generate_content' ? 'x-goog-api-key' : 'authorization'],
                protocol === 'gemini_generate_content' ? 'fixture-key' : 'Bearer fixture-key');
            assert.equal(f.calls[0].body, '{}');
            assert.deepEqual(f.lifetimes, [{ timeoutMs: 10_000, aborted: false }]);
        });
    }
}

for (const method of ['PUT', 'DELETE']) {
    test(`accepted music template recovery cancellation respects ${method} and its declared body`, async () => {
        const template = normalizeMediaTemplate({ preset: 'custom', kind: 'music',
            cancel: { method, path: '{base}/tasks/{id}/cancel', body: '{"task":"{{id}}","model":"{{model}}"}' } });
        const f = fixture('paused', { id, protocol: 'async_media_template',
            baseUrl: 'https://provider.fixture.invalid/v1', providerSettings: { mediaTemplate: template } });
        f.job.kind = 'music';
        await f.cancel();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].method, method);
        assert.equal(f.calls[0].url, `https://provider.fixture.invalid/v1/tasks/${id}/cancel`);
        assert.equal(f.calls[0].headers.authorization, 'Bearer fixture-key');
        assert.deepEqual(JSON.parse(f.calls[0].body), { task: id, model: 'fixture' });
        assert.deepEqual(f.lifetimes, [{ timeoutMs: 10_000, aborted: false }]);
    });
}

test('recovery cancellation without an accepted task never sends a request', async () => {
    const f = fixture('queued'); delete f.job.remoteTask;
    await f.cancel();
    assert.equal(f.calls.length, 0);
});

test('an active controller is only aborted so its request finally block owns upstream cancellation', async () => {
    const f = fixture('running');
    const controller = new AbortController();
    f.service.mediaAbortControllers.set(f.job.id, controller);
    await f.cancel();
    assert.equal(controller.signal.aborted, true);
    assert.equal(f.calls.length, 0);
});

test('a template without an upstream cancel contract only cancels local recovery', async () => {
    const f = fixture('paused', { id, protocol: 'async_media_template',
        baseUrl: 'https://provider.fixture.invalid/v1',
        providerSettings: { mediaTemplate: normalizeMediaTemplate({ preset: 'custom', kind: 'video', cancel: null }) } });
    await f.cancel();
    assert.equal(f.calls.length, 0);
});

test('a declared cancel endpoint on another origin receives no API credential', async () => {
    const f = fixture('queued', { id, protocol: 'async_media_template',
        baseUrl: 'https://provider.fixture.invalid/v1', providerSettings: { mediaTemplate: normalizeMediaTemplate({ preset: 'custom',
            cancel: { method: 'POST', path: 'https://cancel.fixture.invalid/tasks/{id}/cancel' } }) } });
    await f.cancel();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].headers.authorization, undefined);
    assert.equal(new URL(f.calls[0].url).search, '');
});
