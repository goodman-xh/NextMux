import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const id = '00000000-0000-4000-8000-000000000001';
const oldTask = { taskId: id, submittedAt: new Date(Date.now() - 7 * 60 * 60_000).toISOString() };
function fixture(kind = 'video', settings = {}) {
    const template = normalizeMediaTemplate({ preset: 'custom', kind,
        submit: { path: '{base}/generate', body: '{"model":"{{model}}","image":"{{first_frame}}","references":"{{references}}"}' },
        poll: { path: '{base}/tasks/{id}' }, idField: 'id', statusField: 'status', doneValues: ['done'], failedValues: ['failed'],
        images: 'data_url', maxReferences: 4, ...settings });
    const connection = { id, protocol: 'async_media_template', model: 'fixture', label: 'Fixture', providerName: 'Fixture',
        baseUrl: 'https://provider.fixture.invalid/v1', providerSettings: { mediaTemplate: template } };
    const service = new NextMuxPlatformServiceImpl();
    service.baseUrl = 'https://platform.fixture.invalid';
    service.deviceId = async () => 'fixture-device';
    service.getPrivacySettings = async () => ({});
    service.mediaConnection = async () => ({ connection, apiKey: 'fixture-key' });
    service.noteRemoteTask = async (_root, job, task) => service.acceptedRemoteTasks.set(job.id,
        { ...task, submittedAt: new Date().toISOString() });
    service.characterReferenceDataUrls = async () => ['data:image/png;base64,ZmFrZQ=='];
    service.convertPicture = async bytes => bytes;
    service.waitForMedia = async () => {};
    const calls = [];
    service.networkFetch = async (url, init) => {
        calls.push({ url: String(url), ...init, abortedWhenSent: init.signal?.aborted });
        return init.method === 'POST' ? Response.json({ id }) : Response.json({ status: 'failed', message: 'Fixture refusal' });
    };
    const input = { connectionId: `official-${id}`, model: 'fixture', prompt: 'Keep the character', durationSeconds: 5, width: 1280, height: 720, format: 'mp3' };
    const job = { id: `media-job-${id}`, kind, input, idempotencyKey: 'comic-single-paid-call',
        projectId: `project-${id}`, sceneId: `scene-${id}`, shotId: `shot-${id}`, cost: { billing: 'provider_billed', description: 'Fixture' } };
    const run = (signal = new AbortController().signal) => service.requestTemplateMedia('/fixture', job, input, connection, 'fixture-key', signal, false);
    return { service, connection, template, input, job, calls, run };
}

test('templates reject a wrong kind or unsupported reference input before any request', async () => {
    for (const settings of [{ images: 'none' }, { maxReferences: 0 }, { submit: { path: '{base}/generate', body: '{"prompt":"{{prompt}}"}' } }]) {
        const f = fixture('image', settings);
        f.input.characterReferenceUris = ['cast.png'];
        await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
    }
    const f = fixture(); f.job.kind = 'image';
    await assert.rejects(f.run(), { code: 'MEDIA_KIND_UNSUPPORTED' });
    assert.equal(f.calls.length, 0);
});

test('unsupported first/last frames and excessive references never reach a paid template POST', async () => {
    for (const patch of [{ firstFrameUri: 'first.png' }, { lastFrameUri: 'last.png' }, { referenceAssetUris: ['a.png', 'b.png'] }]) {
        const f = fixture('video', { images: 'none', maxReferences: 0 });
        Object.assign(f.input, patch);
        await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
    }
});

test('a first frame cannot hide an additional unsupported reference or silently replace character references', async () => {
    for (const patch of [
        { firstFrameUri: 'first.png', referenceAssetUris: ['extra.png'] },
        { referenceAssetUris: ['first.png', 'extra.png'], characterReferenceUris: ['character.png'] }
    ]) {
        const f = fixture('video', { maxReferences: 0, submit: { path: '{base}/generate', body: '{"image":"{{first_frame}}"}' } });
        Object.assign(f.input, patch);
        await assert.rejects(f.run(), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
    }
});

test('own API execution checks exact model availability and output kind before reading credentials or submitting', async () => {
    for (const metadata of [{ available: false, outputModalities: ['image'] }, { outputModalities: ['text'] }, { outputModalities: ['video'] }]) {
        const f = fixture('image');
        f.connection.protocol = 'openai_chat_completions';
        f.connection.discoveredModels = [{ id: 'fixture', ...metadata }];
        f.service.readOfficialConnectionIndex = async () => [f.connection];
        await assert.rejects(NextMuxPlatformServiceImpl.prototype.mediaConnection.call(f.service, id, 'image', 'fixture'), { code: 'MEDIA_MODEL_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
    }
});

test('native video and local workflows cannot silently discard character pictures', async () => {
    const native = fixture(); native.connection.protocol = 'gemini_generate_content';
    native.input.characterReferenceUris = ['character.png'];
    await assert.rejects(native.service.requestOfficialVideo('/fixture', native.job, native.input, new AbortController().signal), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
    assert.equal(native.calls.length, 0);
    const local = fixture('image'); local.input.connectionId = 'comfyui:local'; local.input.characterReferenceUris = ['character.png'];
    await assert.rejects(local.service.executeMediaJob('/fixture', local.job, new AbortController().signal), { code: 'MEDIA_MODEL_UNSUPPORTED' });
    assert.equal(local.calls.length, 0);
});

test('a picture-format refusal ends a paid template request without a second submission', async () => {
    const f = fixture('image'); f.input.characterReferenceUris = ['cast.png'];
    f.service.networkFetch = async (url, init) => {
        f.calls.push({ url: String(url), ...init });
        return Response.json({ message: 'Unsupported JPEG image format; only PNG is accepted' }, { status: 400 });
    };
    await assert.rejects(f.run(), { code: 'VIDEO_REQUEST_FAILED' });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(JSON.parse(f.calls[0].body).references, ['data:image/png;base64,ZmFrZQ==']);
});

test('native OpenRouter video rejects mixed or excessive picture inputs without dropping them or submitting', async () => {
    for (const model of ['google/veo-3.1-fast', 'kwaivgi/kling-v3.0-pro']) {
        const f = fixture(); f.connection.protocol = 'openai_chat_completions';
        f.connection.baseUrl = 'https://openrouter.ai/api/v1'; f.input.model = model;
        f.input.referenceAssetUris = ['first.png']; f.input.characterReferenceUris = ['character.png'];
        await assert.rejects(f.service.requestOfficialVideo('/fixture', f.job, f.input, new AbortController().signal), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
        assert.equal(f.calls.length, 0);
    }
    const f = fixture(); f.connection.protocol = 'openai_chat_completions';
    f.connection.baseUrl = 'https://openrouter.ai/api/v1'; f.input.model = 'google/veo-3.1-fast';
    f.input.characterReferenceUris = ['character.png'];
    f.service.openRouterVideoLimits = async () => ({ durations: [8], resolutions: ['720p'], aspectRatios: ['16:9'], frameImages: ['first_frame'] });
    f.service.characterReferenceDataUrls = async () => Array.from({ length: 5 }, () => 'data:image/png;base64,ZmFrZQ==');
    await assert.rejects(f.service.requestOfficialVideo('/fixture', f.job, f.input, new AbortController().signal), { code: 'VIDEO_CAPABILITY_UNSUPPORTED' });
    assert.equal(f.calls.length, 0);
});

test('an accepted template cancellation sends its declared upstream request with a fresh signal', async () => {
    const f = fixture('music', { cancel: { method: 'PUT', path: '{base}/tasks/{id}/cancel', body: '{}' } });
    const controller = new AbortController();
    f.service.waitForMedia = async () => { controller.abort(); await NextMuxPlatformServiceImpl.prototype.waitForMedia.call(f.service, 0, controller.signal); };
    await assert.rejects(f.run(controller.signal), { code: 'CANCELLED' });
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    const cancel = f.calls.find(call => call.method === 'PUT');
    assert.equal(cancel.url, `https://provider.fixture.invalid/v1/tasks/${id}/cancel`);
    assert.equal(cancel.abortedWhenSent, false);
    assert.equal(cancel.headers.authorization, 'Bearer fixture-key');
});

test('a cancelled upstream template job has a clear terminal cancellation state', async () => {
    const f = fixture('music');
    f.service.networkFetch = async (_url, init) => init.method === 'POST' ? Response.json({ id }) : Response.json({ status: 'canceled' });
    await assert.rejects(f.run(), error => error.code === 'CANCELLED' && error.retryable === false);
});

test('an accepted job is followed for as long as the provider keeps it, however old, and never re-submitted', async () => {
    // Models may work for days: no wall-clock cutoff, only the provider's own verdict (or the user's stop) ends a job.
    const following = f => { let polls = 0; f.service.networkFetch = async (url, init) => {
        f.calls.push({ url: String(url), ...init }); polls += 1;
        return Response.json(polls < 5 ? { status: 'running' } : { status: 'failed', message: 'Fixture refusal' });
    }; return () => polls; };
    const template = fixture('music'); template.job.remoteTask = oldTask;
    const templatePolls = following(template);
    await assert.rejects(template.run(), error => error.code !== 'MEDIA_TIMEOUT');
    assert.equal(templatePolls(), 5, 'a seven-hour-old job is still followed');
    assert.equal(template.calls.filter(call => call.method === 'POST').length, 0);
    const native = fixture(); native.job.remoteTask = oldTask;
    native.connection.protocol = 'openai_chat_completions';
    following(native);
    await assert.rejects(native.service.requestOfficialVideo('/fixture', native.job, native.input, new AbortController().signal), error => error.code !== 'MEDIA_TIMEOUT');
    assert.equal(native.calls.filter(call => call.method === 'POST').length, 0);
});

test('a managed video keeps its accepted job while running, and a user stop cancels upstream without re-submitting', async () => {
    for (const cancel of [false, true]) {
        const f = fixture(); f.job.remoteTask = cancel ? { ...oldTask, submittedAt: new Date().toISOString() } : oldTask;
        f.input.connectionId = `managed:fixed:${id}`;
        const controller = new AbortController();
        let polls = 0;
        f.service.networkFetch = async (url, init) => {
            f.calls.push({ url: String(url), ...init });
            if ((init.method || 'GET') === 'GET') polls += 1;
            return Response.json({ job: { id, status: cancel || polls < 5 ? 'running' : 'failed', error: 'Fixture refusal' } });
        };
        if (cancel) f.service.waitForMedia = async () => { controller.abort(); await NextMuxPlatformServiceImpl.prototype.waitForMedia.call(f.service, 0, controller.signal); };
        await assert.rejects(f.service.requestManagedVideo('/fixture', f.job, f.input, controller.signal), error => cancel ? error.code === 'CANCELLED' : error.code !== 'MEDIA_TIMEOUT');
        if (!cancel) assert.equal(polls, 5, 'a seven-hour-old managed job is still followed');
        assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
        assert.equal(f.calls.filter(call => call.method === 'DELETE').length, cancel ? 1 : 0);
    }
});

test('a slow portrait is waited for, however long, and only an explicit stop cancels it', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture('image');
    f.service.comicProjectStore = async () => ({ read: async () => ({ project: { id, styleBible: '', characters: [{ id: 'character', name: 'Hero', appearance: 'A hero' }] } }) });
    let started, aborted = false;
    const executing = new Promise(resolve => { started = resolve; });
    f.service.executeMediaJob = async (_root, _job, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); started();
    });
    const pending = f.service.generateComicCharacterPortrait({ workspaceRoot: '/fixture', characterId: 'character',
        connectionId: `official:${id}`, model: 'fixture', billing: 'provider_billed' });
    const rejected = assert.rejects(pending, { code: 'PORTRAIT_CANCELLED' });
    await executing;
    t.mock.timers.tick(60 * 60_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(aborted, false, 'an hour of work is not cut off');
    await f.service.cancelComicCharacterPortrait('/fixture', 'character');
    await rejected;
});
