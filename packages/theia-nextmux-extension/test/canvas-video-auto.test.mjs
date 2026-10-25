import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueRequest } from '@nextmux/media-core';
import { mediaTemplateVariables, normalizeMediaTemplate, renderMediaBody } from '@nextmux/model-runtime/media-template';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';
import { fitOpenRouterVideoRequest } from '../lib/node/nextmux-openrouter-video-limits.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const connectionId = 'official-11111111-1111-4111-8111-111111111111';
const projectId = 'project-11111111-1111-4111-8111-111111111111';
const model = 'bytedance/seedance-2.0';
const connection = { id: connectionId, providerId: 'openai', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };
const videoFacts = { ...videoModelGuide(model), source: 'guide', resolutions: [], aspectRatios: [] };
const frame = { role: 'firstFrame', order: 0, versionId: 'version-first', assetId: 'asset-first', kind: 'image', uri: 'nextmux.media/first.png',
    metadata: { mimeType: 'image/png', byteLength: 100, width: 1024, height: 1024 } };
const cost = { billing: 'provider_billed', description: 'Fixture' };
const cap = () => buildOfficialCanvasCapability(connection, model, {}, { videoFacts });
const policy = () => buildOfficialCanvasAdapterPolicy(connection, model, { videoFacts });
const snapshot = (capability, parameters = {}) => ({ modelId: model, capabilityVersion: capability.version, mode: 'imageToVideo',
    prompt: 'The character walks through the doorway', inputFingerprint: 'fixture-fingerprint', resolvedInputs: [frame],
    parameters: { resolution: 'auto', aspectRatio: '4:3', durationSeconds: 7, ...parameters } });
const compile = (frozen, capability, adapterPolicy, extra = {}) => enqueueRequest(compileCanvasGenerationJob({ canvasId: 'canvas-fixture', projectId,
    nodeId: 'node-fixture', idempotencyKey: 'fixture-click', connectionId, snapshot: frozen, capability, adapterPolicy, cost, ...extra }));

function transportFixture(listed) {
    const service = new NextMuxPlatformServiceImpl(), calls = [], uploads = [];
    service.mediaConnection = async () => ({ connection, apiKey: 'fixture-key' });
    service.openRouterVideoLimits = async () => listed;
    service.videoReferenceDataUrl = async (_root, uri) => { uploads.push(uri); return 'data:image/png;base64,ZmFrZQ=='; };
    service.characterReferenceDataUrls = async () => [];
    service.noteRemoteTask = async () => {};
    service.timedMediaFetch = async (url, init) => {
        calls.push({ url: String(url), ...init });
        return Response.json({ id: 'fixture-provider-task', url: 'https://media.openrouter.ai/fixture.mp4', status: 'completed' });
    };
    service.fetchVideoOutput = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
    service.streamVideoOutput = async () => ({ fixture: 'completed' });
    service.comicCanvasPromptTranslations = new ComicPromptTranslationCache();
    service.validateCanvasMediaBilling = async () => {};
    return { service, calls, uploads };
}

test('auto video compilation preserves project dimensions and the frozen ratio without sending resolution', () => {
    const capability = cap(), adapterPolicy = policy(), frozen = snapshot(capability), before = structuredClone(frozen);
    const request = compile(frozen, capability, adapterPolicy, { canvasSize: { width: 1000, height: 740 } });
    assert.equal(Object.hasOwn(request.input, 'resolution'), false);
    assert.equal(request.input.width, 1000);
    assert.equal(request.input.height, 740);
    assert.equal(request.input.aspectRatio, '4:3');
    assert.equal(request.input.durationSeconds, 7);
    assert.equal(Number.isSafeInteger(request.input.durationSeconds), true);
    assert.equal(request.input.referenceAssetUris, undefined);
    assert.equal(request.input.firstFrameUri, frame.uri);
    assert.deepEqual(frozen, before);
    assert.throws(() => compile(frozen, capability, adapterPolicy), { code: 'CANVAS_DIMENSIONS_UNKNOWN' });
    assert.throws(() => compile(snapshot(capability, { durationSeconds: 7.5 }), capability, adapterPolicy,
        { canvasSize: { width: 1000, height: 740 } }), { code: 'CANVAS_CAPABILITY_INVALID' });
});

test('the prepared auto video snapshot records project dimensions and compiles to the same queued values', async () => {
    const capability = cap(), adapterPolicy = policy(), authored = snapshot(capability), { service } = transportFixture();
    service.canvasProjectSize = async () => ({ width: 1000, height: 740 });
    const frozen = await service.prepareCanvasSnapshot(authored, { workspaceRoot: '/fixture', connectionId, cost }, projectId, adapterPolicy, capability);
    assert.equal(frozen.parameters.width, 1000);
    assert.equal(frozen.parameters.height, 740);
    assert.equal(frozen.parameters.aspectRatio, authored.parameters.aspectRatio);
    assert.equal(frozen.parameters.durationSeconds, authored.parameters.durationSeconds);
    const request = compile(frozen, capability, adapterPolicy);
    assert.deepEqual({ width: request.input.width, height: request.input.height, aspectRatio: request.input.aspectRatio, durationSeconds: request.input.durationSeconds },
        { width: frozen.parameters.width, height: frozen.parameters.height, aspectRatio: frozen.parameters.aspectRatio, durationSeconds: frozen.parameters.durationSeconds });
    assert.equal(frozen.prompt, authored.prompt, 'prepared snapshot preserves all authored shot text');
    assert.equal(request.input.prompt, [
        'Start from the supplied first-frame image. Continue into the requested action without replaying a previous action or holding a still image.',
        'Keep each referenced character distinct, with the same face, hairstyle, body and outfit. Do not swap or merge identities. Use the supplied scene and lighting as the starting state. Follow explicit changes to appearance, scene, action and camera in the shot description.',
        'Shot description:', frozen.prompt
    ].join('\n'), 'queued first-frame video adds the exact built-in continuity instructions once');
    const plain = { ...frozen, mode: 'textToVideo', resolvedInputs: [] };
    assert.equal(compile(plain, capability, adapterPolicy).input.prompt, frozen.prompt, 'a video without visual inputs adds no continuity instructions');
    assert.equal(request.input.referenceAssetUris, undefined);
    assert.equal(request.input.firstFrameUri, frozen.resolvedInputs.find(input => input.role === 'firstFrame').uri);
    assert.equal(Object.hasOwn(request.input, 'resolution'), false);
    assert.equal(compile(frozen, capability, adapterPolicy, { canvasSize: { width: 720, height: 1280 } }).input.width, frozen.parameters.width);
});

test('a canvas auto Seedance submission without a listing is identical to the desk provider request', async () => {
    const capability = cap(), request = compile(snapshot(capability), capability, policy(), { canvasSize: { width: 1000, height: 740 } });
    const canvas = transportFixture(), desk = transportFixture(), signal = new AbortController().signal;
    const canvasJob = { ...request, id: 'media-job-canvas-fixture' };
    await canvas.service.requestOfficialVideo('/fixture', canvasJob, request.input, signal);
    const deskInput = { connectionId, model, prompt: request.input.prompt, durationSeconds: 7, width: 1000, height: 740, referenceAssetUris: [frame.uri] };
    await desk.service.requestOfficialVideo('/fixture', { ...canvasJob, sceneId: 'scene-desk-fixture', input: deskInput }, deskInput, signal);
    assert.equal(canvas.calls.length, 1);
    assert.equal(desk.calls.length, 1);
    assert.deepEqual(canvas.uploads, [frame.uri]);
    assert.deepEqual(JSON.parse(canvas.calls[0].body), JSON.parse(desk.calls[0].body));
    assert.deepEqual(JSON.parse(canvas.calls[0].body), { model, prompt: request.input.prompt, duration: 7, aspect_ratio: '4:3', resolution: '720p',
        frame_images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZQ==' }, frame_type: 'first_frame' }] });
});

for (const [name, listed] of [
    ['duration', { durations: [10], resolutions: [], aspectRatios: ['4:3'], frameImages: ['first_frame'] }],
    ['aspect ratio', { durations: [7], resolutions: [], aspectRatios: ['16:9'], frameImages: ['first_frame'] }]
]) test(`the canvas adapter still refuses a fitted change to the frozen ${name} before submission`, async () => {
    const capability = cap(), request = compile(snapshot(capability), capability, policy(), { canvasSize: { width: 1000, height: 740 } });
    const { service, calls, uploads } = transportFixture(listed);
    await assert.rejects(service.requestOfficialVideo('/fixture', { ...request, id: 'media-job-canvas-fixture' }, request.input, new AbortController().signal),
        { code: 'CANVAS_ADAPTER_PARAMETER_CHANGED' });
    assert.deepEqual(calls, []);
    assert.deepEqual(uploads, []);
});

const templateRoutes = [
    { name: '1212', model: 'video_veo3.1_fast', seconds: [8], maxReferences: 3, referenceAspect: '16:9',
        body: '{"prompt":"{{prompt}}","firstFrameUrl":"{{first_frame}}","lastFrameUrl":"{{last_frame}}","urls":"{{references}}","aspectRatio":"{{aspect_ratio}}","size":"{{resolution}}"}' },
    { name: 'MiniMax H3', model: 'video_minimax_h3', seconds: Array.from({ length: 12 }, (_, index) => index + 4), maxReferences: 9, referenceAspect: '',
        body: '{"prompt":"{{prompt}}","first_frame":"{{first_frame}}","last_frame":"{{last_frame}}","images":"{{references_csv}}","ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}"}' },
    { name: 'Omni', model: 'video_omni', seconds: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15], maxReferences: 4, referenceAspect: '',
        body: '{"prompt":"{{prompt}}","aspectRatio":"{{aspect_ratio}}","resolution":"pro","sound":"on","duration":"{{seconds_text}}","image_url":"{{references_csv}}","firstFrameUrl":"{{first_frame}}","lastFrameUrl":"{{last_frame}}","watermark":"0"}' },
    { name: 'Wan', model: 'video_wan_3.0', seconds: Array.from({ length: 27 }, (_, index) => index + 4), maxReferences: 10, referenceAspect: '',
        body: '{"prompt":"{{prompt}}","first_frame":"{{first_frame}}","last_frame":"{{last_frame}}","images":"{{references_csv}}","ratio":"{{aspect_ratio}}","duration":"{{seconds_text}}","generate_audio":"true"}' }
];

function templateFixture(config) {
    const template = normalizeMediaTemplate({ preset: 'wuyin', kind: 'video', images: 'link', seconds: config.seconds, maxReferences: config.maxReferences,
        referenceAspect: config.referenceAspect, submit: { method: 'POST', path: '{base}/{model}', body: config.body }, poll: { method: 'GET', path: '{base}/detail?id={id}' } });
    const route = { ...connection, protocol: 'async_media_template', baseUrl: 'https://api.wuyinkeji.com/api', providerSettings: { mediaTemplate: template } };
    const facts = { ...videoModelGuide(config.model), source: 'template', resolutions: [], aspectRatios: [] };
    const capability = buildOfficialCanvasCapability(route, config.model, {}, { videoFacts: facts });
    const adapterPolicy = buildOfficialCanvasAdapterPolicy(route, config.model, { videoFacts: facts });
    const transport = transportFixture();
    transport.service.mediaConnection = async () => ({ connection: route, apiKey: 'fixture-key' });
    transport.service.waitForMedia = async () => {};
    transport.service.timedMediaFetch = async (url, init) => {
        transport.calls.push({ url: String(url), ...init });
        return Response.json(init.method === 'POST' ? { data: { id: 'fixture-provider-task' } }
            : { data: { status: '2', result: 'https://media.openrouter.ai/fixture.mp4' } });
    };
    const frozen = { ...snapshot(capability), modelId: config.model, mode: 'textToVideo', resolvedInputs: [],
        parameters: { resolution: 'auto', aspectRatio: config.name === '1212' ? '16:9' : '1:1', durationSeconds: 8 } };
    return { ...transport, template, capability, adapterPolicy, frozen };
}

for (const config of templateRoutes) test(config.name === 'Wan' ? 'the Wan template restores only its image-driven registry modes'
  : `the ${config.name} template without output listing submits the same rendered body as the desk`, async () => {
    const { service, calls, template, capability, adapterPolicy, frozen } = templateFixture(config);
    if (config.name === 'Wan') {
        assert.deepEqual(capability.modes.map(mode => mode.mode), ['imageToVideo', 'firstLastFrame']);
        assert.throws(() => compile(frozen, capability, adapterPolicy, { canvasSize: { width: 1200, height: 1000 } }), { code: 'CANVAS_CAPABILITY_INVALID' });
        assert.deepEqual(calls, []);
        return;
    }
    const size = config.name === '1212' ? { width: 1600, height: 900 } : { width: 1200, height: 1000 };
    const request = compile(frozen, capability, adapterPolicy, { canvasSize: size });
    assert.equal(Object.hasOwn(request.input, 'resolution'), false);
    assert.equal(request.input.width, size.width);
    assert.equal(request.input.height, size.height);
    await service.requestOfficialVideo('/fixture', { ...request, id: 'media-job-canvas-fixture' }, request.input, new AbortController().signal);
    const deskBody = renderMediaBody(template.submit.body, mediaTemplateVariables({ model: config.model, prompt: frozen.prompt, seconds: 8,
        ...size, references: [] }));
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.deepEqual(JSON.parse(calls.find(call => call.method === 'POST').body), deskBody);
    assert.equal(deskBody.aspectRatio || deskBody.ratio, config.name === '1212' ? '16:9' : '1:1');
    if (config.name === '1212') assert.equal(deskBody.size, '720p');
    if (config.name === 'Omni') assert.equal(deskBody.resolution, 'pro');
});

test('a template auto request cannot override the desk-derived frozen ratio before submission', async () => {
    const { service, calls, capability, adapterPolicy, frozen } = templateFixture(templateRoutes[0]);
    const request = compile({ ...frozen, parameters: { ...frozen.parameters, aspectRatio: '16:9' } }, capability, adapterPolicy,
        { canvasSize: { width: 1200, height: 1000 } });
    await assert.rejects(service.requestOfficialVideo('/fixture', { ...request, id: 'media-job-canvas-fixture' }, request.input, new AbortController().signal),
        { code: 'CANVAS_ADAPTER_PARAMETER_CHANGED' });
    assert.deepEqual(calls, []);
});

test('an accepted template task resumes polling despite changed ratio facts without submitting again', async () => {
    const { service, calls, capability, adapterPolicy, frozen } = templateFixture(templateRoutes[0]);
    const request = compile({ ...frozen, parameters: { ...frozen.parameters, aspectRatio: '16:9' } }, capability, adapterPolicy,
        { canvasSize: { width: 1200, height: 1000 } });
    const job = { ...request, id: 'media-job-canvas-fixture', remoteTask: { taskId: 'fixture-provider-task', submittedAt: '2026-09-30T12:00:00.000Z' } };
    await service.requestOfficialVideo('/fixture', job, request.input, new AbortController().signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.match(calls[0].url, /detail\?id=fixture-provider-task$/u);
    assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('a managed H3 catalog 2K variant compiles to the same dimensions and resolution understood by the desk fitter', () => {
    const durations = Array.from({ length: 11 }, (_, index) => index + 5);
    const route = { id: '11111111-1111-4111-8111-111111111111', providerName: 'Fixture managed', providerModelCode: 'minimax/hailuo-3', displayName: 'Hailuo 3',
        status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId, capabilities: ['text_to_video', 'image_to_video', 'video_native_audio'],
        mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
        videoLimits: { durations, resolutions: ['2K'], aspectRatios: ['16:9'], shapeQuoteId: managedQuoteId,
          provenShapes: syntheticManagedVideoProof({ resolutions: ['2K'], aspectRatios: ['16:9'], durations, frameStates: [[false, false], [true, false]] }) } };
    const capability = buildManagedCanvasCapability(route), adapterPolicy = buildManagedCanvasAdapterPolicy(route);
    const frozen = { ...snapshot(capability, { resolution: '2K', aspectRatio: '16:9' }), modelId: route.providerModelCode, mode: 'textToVideo', resolvedInputs: [] };
    const request = compile(frozen, capability, adapterPolicy, { connectionId: `managed:fixed:${route.id}`, keyPriceQuoteId: managedQuoteId,
        cost: { billing: 'platform_billed', description: 'Fixture managed billing' } });
    assert.equal(request.input.width, 2560);
    assert.equal(request.input.height, 1440);
    assert.equal(request.input.resolution, '2K');
    assert.equal(request.input.referenceAssetUris, undefined);
    assert.deepEqual(fitOpenRouterVideoRequest({ durations, resolutions: ['2K'], aspectRatios: ['16:9'], frameImages: ['first_frame'] },
        { ...request.input, hasPicture: false }), { duration: 7, resolution: '2K', aspectRatio: '16:9', firstFrame: false });
});
