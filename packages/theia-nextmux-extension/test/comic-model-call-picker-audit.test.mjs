import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as eligibility from '../lib/browser/nextmux-comic-model-eligibility.js';
import { dedupeComicPriceVariants } from '../lib/browser/nextmux-comic-step-models.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { videoModelProfile } from '../lib/common/nextmux-video-profiles.js';
import { COMIC_CHAT_ASPECTS, COMIC_CHAT_VIDEO_ASPECTS, comicChatSize } from '../lib/common/nextmux-comic-chat.js';
import { optionalKeyPriceQuoteId } from '../lib/common/nextmux-price-quote.js';
import { routeSupportsModelAttachment } from '../lib/common/nextmux-attachment-support.js';
import { musicMvRequestSeconds } from '../lib/browser/nextmux-music-mv-state.js';
import { musicReferenceSupport } from '../lib/browser/nextmux-music-reference.js';
import { modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import { classifyModelError } from '@nextmux/model-runtime/errors';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicStepCandidateEligible', 'comicMediaVoices', 'comicMediaVoice', 'comicMediaInputAllowed',
    'comicChatCandidates', 'comicChatReferencePolicy', 'comicChatVoices', 'comicChatAspectChoices', 'comicChatSecondsChoices', 'comicChatParams',
    'comicCatalogMediaRoutes', 'comicCatalogTextRoutes', 'comicMediaSupportsKind', 'comicTranscriptionRoutes', 'setMediaDraft', 'comicPlanText', 'createLibraryCharacter']);
const methods = [];
(function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, names.size);
const deps = { ...Object.fromEntries(Object.entries(eligibility).filter(([key]) => key.startsWith('comicRoute'))), dedupeComicPriceVariants, videoModelGuide, videoModelProfile, COMIC_CHAT_ASPECTS, COMIC_CHAT_VIDEO_ASPECTS,
    comicChatSize, optionalKeyPriceQuoteId, routeSupportsModelAttachment, musicMvRequestSeconds, musicReferenceSupport, modelFailureText,
    comicStepText: () => 'Local', comicShotFieldText: () => 'Choose a model that accepts reference images.' };
const compiled = ts.transpileModule(`const {${Object.keys(deps).join(',')}} = deps; class Harness {${methods.join('\n')}}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}; return Harness;`)(deps);
const quote = `kq1_${'a'.repeat(64)}`;
const offering = (id, kind, patch = {}) => ({ id, merchantId: 'm', canonicalModel: id, registryModelId: id, status: 'active', available: true,
    category: ['speech', 'music'].includes(kind) ? 'audio' : kind, input: ['text'], output: [kind === 'music' ? 'audio' : kind],
    capabilities: [kind === 'image' ? 'image_generation' : kind === 'video' ? 'text_to_video' : kind === 'speech' ? 'tts' : 'music_generation'],
    workbenches: ['comic'], keyPriceQuoteId: quote, routeScore: 10, providerName: 'Relay',
    price: { mode: 'direct', currency: 'USD', imageEachMicros: 100, videoSecondMicros: 100, audioPerMillionCharactersMicros: 100 }, ...patch });
const managed = (kind, id, patch = {}) => ({ id: `managed:fixed:${id}`, kind: 'managed', model: id, offering: offering(id, kind, patch) });
const candidate = route => ({ key: `managed:m::${route.id}`, routeId: route.id, model: route.model, label: route.model,
    source: { key: 'managed:m', kind: 'managed', label: 'Relay' }, rank: 1, offering: route.offering });

function fixture(routes = []) {
    const h = new Harness();
    const project = { projectKind: 'novel', frameRate: 24, canvas: { aspectRatio: '16:9', width: 1920, height: 1080 },
        characters: [], assets: [], scenes: [{ id: 's', shots: [{ id: 'shot', durationFrames: 192, visualPrompt: 'Alice walks' }] }] };
    const ui = { mode: 'image', references: [], params: {} };
    Object.assign(h, { mediaDraft: { kind: 'speech', voice: 'alloy', connectionId: '', costConfirmed: false }, videoProfiles: new Map(),
        comicProject: () => project, comicProjectKind: value => value?.projectKind, comicModelKind: () => project.projectKind,
        comicChatUi: () => ui, comicMediaRoute: (_kind, id) => routes.find(route => route.id === id),
        comicStepCandidatesByRoute: kind => routes.filter(route => route.offering?.category === (['speech', 'music'].includes(kind) ? 'audio' : kind)).map(candidate),
        platformCatalog: { offerings: routes.map(route => route.offering) }, selectedMerchantCatalog: undefined,
        merchantPickerSnapshots: new Map(), catalogRemovedMerchants: new Set(), desktopLocale: 'en',
        offeringMerchantId: value => value.merchantId, registryModelSupportsWorkbench: () => true, isModelVisible: () => true,
        update() {}, comicTextRouteChoices: () => [], ct: () => 'No model supports this request.' });
    return { h, project, ui };
}

test('loaded and uncached catalog paths both exclude unavailable generation and text routes', () => {
    const { h } = fixture([managed('image', 'live'), managed('image', 'offline', { available: false })]);
    assert.deepEqual(h.comicCatalogMediaRoutes('image', 'm').map(route => route.model), ['live']);
    h.platformCatalog.offerings = [offering('text', 'text', { workbenches: ['coding'], category: 'coding', output: ['text'], capabilities: ['coding', 'reasoning', 'tools'] }),
        offering('offline-text', 'text', { available: false, workbenches: ['coding'], category: 'coding', output: ['text'], capabilities: ['coding', 'reasoning', 'tools'] })];
    assert.deepEqual(h.comicCatalogTextRoutes('m').map(route => route.canonicalModel), ['text']);
});

test('character/scene image references require an accepting model and actual image transport', () => {
    const routes = [managed('image', 'text-image'), managed('image', 'referenced-image', { input: ['text', 'image'], mediaInput: { referenceImages: true, maxReferences: 4 } }),
        managed('image', 'dropped-image', { input: ['text', 'image'], mediaInput: { referenceImages: false } })];
    const { h, project } = fixture(routes);
    assert.deepEqual(routes.filter(route => h.comicStepCandidateEligible('image', candidate(route))).map(route => route.model), routes.map(route => route.model));
    project.assets.push({ id: 'portrait', kind: 'image', status: 'ready' });
    project.characters.push({ referenceAssetIds: ['portrait'] });
    assert.deepEqual(routes.filter(route => h.comicStepCandidateEligible('image', candidate(route))).map(route => route.model), ['referenced-image']);
    assert.equal(eligibility.comicRouteImageInput(managed('image', 'contradictory', { input: ['text'], mediaInput: { referenceImages: true } }), 'image'), false);
});

test('text-only image steps hide editors; adding a chat image exposes only compatible reference routes', () => {
    const routes = [managed('image', 'generator'), managed('image', 'image-edit', { input: ['text', 'image'], mediaInput: { referenceImages: true } }),
        managed('image', 'ignored-edit', { input: ['text', 'image'], mediaInput: { referenceImages: false } })];
    const { h, ui } = fixture(routes);
    assert.deepEqual(h.comicChatCandidates('image').map(item => item.model), ['generator']);
    ui.references.push({ key: 'reference' });
    assert.deepEqual(h.comicChatCandidates('image').map(item => item.model), ['image-edit']);
    assert.equal(h.comicChatReferencePolicy('image', candidate(routes[0])).limit, 0);
});

test('studio videos respect duration, aspect, resolution and image-project first-frame requirements', () => {
    const good = managed('video', 'veo-3.1', { input: ['text', 'image'], mediaInput: { firstFrame: true, referenceImages: false },
        videoLimits: { durations: [4, 6, 8], aspectRatios: ['16:9', '9:16'], resolutions: ['1080p'] } });
    const { h, project } = fixture([good]);
    assert.equal(h.comicStepCandidateEligible('video', candidate(good)), true);
    project.scenes[0].shots[0].durationFrames = 7 * 24;
    assert.equal(h.comicStepCandidateEligible('video', candidate(good)), false);
    project.scenes[0].shots[0].durationFrames = 8 * 24;
    project.canvas = { aspectRatio: '1:1', width: 1080, height: 1080 };
    assert.equal(h.comicStepCandidateEligible('video', candidate(good)), false);
    project.canvas = { aspectRatio: '16:9', width: 1280, height: 720 };
    assert.equal(h.comicStepCandidateEligible('video', candidate(good)), false);
    project.canvas = { aspectRatio: '16:9', width: 1920, height: 1080 };
    project.projectKind = 'image';
    good.offering.mediaInput.firstFrame = false;
    assert.equal(h.comicStepCandidateEligible('video', candidate(good)), false);
});

test('catalog duration declarations are narrowed without inventing undocumented durations', () => {
    const route = managed('video', 'veo-3.1', { videoLimits: { durations: [4, 6] } });
    assert.deepEqual(eligibility.comicRouteVideoSeconds(route, false, false), [4, 6]);
    assert.deepEqual(eligibility.comicRouteVideoSeconds(route, false, true), []);
    assert.deepEqual(eligibility.comicRouteVideoSeconds(route, true, false), []);
});

test('chat duration and aspect controls follow the chosen route rather than a generic video menu', () => {
    const route = managed('video', 'kling-v3.0-pro', { videoLimits: { durations: [5, 10], aspectRatios: ['9:16'], resolutions: ['1080p'] } });
    const { h, ui } = fixture([route]);
    ui.mode = 'video';
    ui.params.video = { aspect: '1:1', seconds: 8 };
    assert.deepEqual(h.comicChatAspectChoices(candidate(route)), ['9:16']);
    assert.deepEqual(h.comicChatSecondsChoices(candidate(route), 0), [5, 10]);
    assert.deepEqual(h.comicChatParams('video', candidate(route)), { aspect: '9:16', seconds: 5, sound: true });
    route.offering.videoLimits.resolutions = ['720p'];
    assert.deepEqual(h.comicChatCandidates('video'), [], 'a route that cannot accept the chat canvas is hidden');
});

test('managed billing/transport gates override model-name reference and first-frame promises', () => {
    const route = managed('video', 'veo-3.1', { input: ['text', 'image'], price: { mode: 'reference_multiplier' },
        mediaInput: { firstFrame: false, referenceImages: false }, videoLimits: { durations: [8] } });
    const { h, ui } = fixture([route]);
    ui.mode = 'video';
    assert.equal(h.comicChatCandidates('video').length, 1);
    ui.references.push({ key: 'picture' });
    assert.deepEqual(h.comicChatCandidates('video'), []);
    assert.deepEqual(h.comicChatReferencePolicy('video', candidate(route)), { limit: 0, firstFrame: false });
});

test('own API image templates require real image placeholders; OpenAI generators cannot silently drop references', () => {
    const route = { kind: 'official', model: 'custom', connection: { model: 'custom', discoveredModels: [], protocol: 'async_media_template',
        providerSettings: { mediaTemplate: { kind: 'image', images: 'data_url', maxReferences: 2, submit: { body: '{"prompt":"{{prompt}}"}' } } } } };
    assert.equal(eligibility.comicRouteImageInput(route, 'image'), false);
    route.connection.providerSettings.mediaTemplate.submit.body = '{"images":"{{references}}"}';
    assert.equal(eligibility.comicRouteImageInput(route, 'image'), true);
    assert.equal(eligibility.comicRouteImageInput({ kind: 'official', model: 'gpt-image-1', connection: { protocol: 'openai_chat_completions',
        baseUrl: 'https://api.openai.com/v1', discoveredModels: [{ id: 'gpt-image-1', inputModalities: ['text', 'image'] }] } }, 'image'), false);
});

test('own OpenRouter video character references require a verified guide while first frames remain supported', () => {
    const route = model => ({ kind: 'official', model, connection: { protocol: 'openai_chat_completions',
        baseUrl: 'https://openrouter.ai/api/v1', discoveredModels: [{ id: model, inputModalities: ['text', 'image'] }] } });
    assert.equal(videoModelGuide('kling-video-o1').maxReferences > 0, true);
    assert.equal(eligibility.comicRouteImageInput(route('kling-video-o1'), 'references'), false);
    assert.equal(eligibility.comicRouteImageInput(route('kling-video-o1'), 'firstFrame'), true);
    assert.equal(eligibility.comicRouteImageInput(route('veo-3.1'), 'references'), true);
});

test('voices belong to the chosen model: listed own voices, Gemini native names, explicit empty and unknown models', () => {
    const listed = managed('speech', 'unknown-tts', { voices: ['SpeakerA', 'SpeakerB'] });
    const unknown = managed('speech', 'other-unknown-tts');
    const own = { kind: 'official', model: 'custom-tts', connection: { discoveredModels: [{ id: 'custom-tts', voices: ['Kore', 'Puck'] }] } };
    assert.deepEqual(eligibility.comicRouteVoices(own), ['Kore', 'Puck']);
    assert.deepEqual(eligibility.comicRouteVoices(listed), ['SpeakerA', 'SpeakerB']);
    assert.deepEqual(eligibility.comicRouteVoices(unknown), []);
    assert.deepEqual(eligibility.comicRouteVoices(managed('speech', 'tts-1', { voices: [] })), []);
    const gemini = eligibility.comicRouteVoices(managed('speech', 'google/gemini-2.5-flash-preview-tts'));
    assert.equal(gemini[0], 'Kore');
    assert.equal(gemini.includes('alloy'), false);
    const { h } = fixture([listed, unknown]);
    assert.equal(h.comicStepCandidateEligible('speech', candidate(unknown)), false);
    assert.equal(h.comicMediaVoice(listed, 'alloy'), 'SpeakerA');
    assert.equal(h.comicMediaInputAllowed('speech', { voice: 'alloy' }, listed), false);
});

test('request validation refuses dropped image inputs, excessive references and unsupported video sizes before enqueue', () => {
    const image = managed('image', 'image', { input: ['text', 'image'], mediaInput: { referenceImages: true, maxReferences: 1 } });
    const video = managed('video', 'kling-v3.0-pro', { input: ['text', 'image'], mediaInput: { firstFrame: true, referenceImages: false },
        videoLimits: { durations: [5], aspectRatios: ['16:9'], resolutions: ['1080p'] } });
    const { h } = fixture([image, video]);
    assert.equal(h.comicMediaInputAllowed('image', { characterReferenceUris: ['a', 'b'] }, image), true, 'the service makes one reference sheet containing both portraits');
    image.offering.mediaInput.referenceImages = false;
    assert.equal(h.comicMediaInputAllowed('image', { characterReferenceUris: ['a'] }, image), false);
    const request = { durationSeconds: 5, width: 1920, height: 1080, referenceAssetUris: ['first.png'] };
    assert.equal(h.comicMediaInputAllowed('video', request, video), true);
    assert.equal(h.comicMediaInputAllowed('video', { ...request, durationSeconds: 7 }, video), false);
    assert.equal(h.comicMediaInputAllowed('video', { ...request, characterReferenceUris: ['portrait.png'] }, video), false);
    assert.equal(h.comicMediaInputAllowed('video', { ...request, width: 1080 }, video), false);
});

test('template input combinations never discard character references or bypass first/last-frame bindings', () => {
    const route = { id: 'template', kind: 'official', model: 'custom-video', connection: { protocol: 'async_media_template', discoveredModels: [],
        providerSettings: { mediaTemplate: { kind: 'video', images: 'data_url', maxReferences: 2, seconds: [5],
            submit: { body: '{"first":"{{first_frame}}","refs":"{{references}}","last":"{{last_frame}}"}' } } } } };
    const { h } = fixture([route]);
    const input = { width: 1920, height: 1080, durationSeconds: 5, referenceAssetUris: ['frame'], characterReferenceUris: ['cast-a', 'cast-b', 'cast-c'] };
    assert.equal(h.comicMediaInputAllowed('video', input, route), true, 'single implicit frame plus portrait sheets are both bound');
    assert.equal(h.comicMediaInputAllowed('video', { ...input, referenceAssetUris: ['a', 'b'] }, route), false, 'a reference array would suppress portraits');
    assert.equal(h.comicMediaInputAllowed('video', { ...input, firstFrameUri: 'explicit' }, route), false, 'a supplied first frame turns the extra image into a competing reference array');
    assert.equal(h.comicMediaInputAllowed('video', { width: 1920, height: 1080, durationSeconds: 5, lastFrameUri: 'last' }, route), false);
    assert.equal(h.comicMediaInputAllowed('video', { width: 1920, height: 1080, durationSeconds: 5, firstFrameUri: 'first', lastFrameUri: 'last' }, route), true);
    route.connection.providerSettings.mediaTemplate.images = 'none';
    assert.equal(eligibility.comicRouteImageInput(route, 'lastFrame'), false);
});

test('music reference/cover settings offer only routes with their actual audio-input bindings', () => {
    const managedMusic = managed('music', 'music_v1');
    const own = { id: 'official:music', kind: 'official', model: 'song', connection: { protocol: 'async_media_template', discoveredModels: [],
        providerSettings: { mediaTemplate: { kind: 'music', vocalReference: {}, referenceSong: {}, submit: { body: '{"voice":"{{vocal_reference}}","song":"{{reference_song}}"}' } } } } };
    const { h, project } = fixture([managedMusic, own]);
    project.music = { mode: 'cover' };
    assert.equal(h.comicStepCandidateEligible('music', candidate(managedMusic)), false);
    assert.equal(h.comicStepCandidateEligible('music', candidate(own)), true);
    assert.equal(h.comicMediaInputAllowed('music', { mode: 'cover', referenceSong: { assetUri: 'song.mp3' } }, managedMusic), false);
    project.music = { mode: 'generate', vocalSource: 'my_voice' };
    assert.equal(h.comicStepCandidateEligible('music', candidate(managedMusic)), false);
    assert.equal(h.comicStepCandidateEligible('music', candidate(own)), true);
});

test('transcription requires audio input, transcription output/capability, availability, customer price and quote', () => {
    const asr = offering('asr', 'speech', { category: 'audio', input: ['audio'], output: ['transcription'], capabilities: ['transcription'],
        pricingDetails: { dimensions: [{ metric: 'audio_second', user: { amountMicros: 100, unitSize: 1 } }] } });
    const { h } = fixture();
    h.platformCatalog.offerings = [asr, { ...asr, id: 'no-audio', input: ['text'] }, { ...asr, id: 'offline', available: false },
        { ...asr, id: 'tts', output: ['speech'], capabilities: ['tts'] }];
    assert.deepEqual(h.comicTranscriptionRoutes().map(route => route.model), ['Local', 'asr']);
});

test('a fresh media confirmation binds the selected quote; a changed quote or model resets confirmation', () => {
    const route = managed('speech', 'tts-1');
    const { h } = fixture([route]);
    h.mediaDraft.connectionId = route.id;
    h.setMediaDraft({ costConfirmed: true, keyPriceQuoteId: quote });
    assert.equal(h.mediaDraft.costConfirmed, true);
    assert.equal(h.mediaDraft.keyPriceQuoteId, quote);
    route.offering.keyPriceQuoteId = `kq1_${'b'.repeat(64)}`;
    h.setMediaDraft({ costConfirmed: true, keyPriceQuoteId: quote });
    assert.equal(h.mediaDraft.costConfirmed, false);
    h.setMediaDraft({ connectionId: 'new-model', model: 'new-model', costConfirmed: false });
    assert.equal(h.mediaDraft.keyPriceQuoteId, undefined);
});

test('image-motion text planning rejects unsupported attachments before any model call', async () => {
    const { h } = fixture();
    h.comicTextRoute = () => ({ route: { kind: 'managed_gateway', offering: { input: ['text'], output: ['text'], capabilities: ['tools'] } } });
    h.platformService = { planComicText() { assert.fail('an image-incompatible text route must never be charged'); } };
    await assert.rejects(h.comicPlanText('Describe motion', [{ kind: 'image', name: 'source.png', mimeType: 'image/png', dataBase64: 'YQ==' }]), /accepts reference images/);
});

test('library portrait model failures are localized and leave the create action retryable', async () => {
    const route = managed('image', 'image');
    const { h } = fixture([route]);
    h.desktopLocale = 'zh-CN';
    h.comicStepMediaRoute = () => route;
    h.platformService = { createComicCharacterInLibrary: async () => {
        throw Object.assign(new Error('raw supplier diagnostic'), { data: { readableError: classifyModelError({ status: 401,
            body: { error: { code: 'invalid_api_key', message: 'raw supplier diagnostic' } } }, { source: 'own_api' }) } });
    } };
    await h.createLibraryCharacter({ name: 'Alice', appearance: 'red coat', look: 'anime' });
    assert.equal(h.comicLibraryCreating, false);
    assert.match(h.comicLibraryError, /密钥|API/);
    assert.doesNotMatch(h.comicLibraryError, /raw supplier diagnostic/);
});
