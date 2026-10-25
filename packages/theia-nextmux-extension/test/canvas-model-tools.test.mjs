import assert from 'node:assert/strict';
import test from 'node:test';
import { Module } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Exercise current independent source while parallel integration owns the extension build.
const filename = fileURLToPath(new URL('../lib/common/nextmux-canvas-model-tools.js', import.meta.url));
const source = await readFile(new URL('../src/common/nextmux-canvas-model-tools.ts', import.meta.url), 'utf8');
const instance = new Module(filename);
instance.filename = filename;
instance.paths = Module._nodeModulePaths(dirname(filename));
instance._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { planCanvasModelToolRoute, canvasModelToolMissingRoute, planCanvasOnDeviceToolRoute, isCanvasOnDeviceToolOperation } = instance.exports;

const image = { id: 'version-image-1', assetId: 'asset-image-1', kind: 'image', uri: 'assets/source.png', createdAt: '2026-09-30T12:00:00.000Z', metadata: { width: 512, height: 512 } };
const variant = (side, ratios = ['1:1']) => ({ id: `size-${side}`, resolution: `${side}x${side}`, aspectRatios: ratios, defaultAspectRatio: ratios[0], dimensions: { '1:1': { width: side, height: side } } });
const imageMode = { mode: 'imageToImage', outputVariants: [variant(512), variant(1024), variant(2048)], defaultResolution: '512x512', referenceRules: { image: { supported: true, maxCount: 4 } }, combinationConstraints: [{ combination: 'image', maxImages: 4 }] };
const capability = { id: 'route-1', providerId: 'opaque-provider', providerModelId: 'opaque-model', displayName: 'Opaque', version: 'facts-v1', status: 'available', modes: [imageMode], sources: ['fixture'] };
const plan = (operation, overrides = {}) => planCanvasModelToolRoute({ operation, source: image, capability, ...overrides });
const video = { ...image, id: 'video-1', assetId: 'video-asset', kind: 'video', uri: 'assets/source.mp4', metadata: { width: 512, height: 512, durationMs: 8000 } };
const audio = { ...image, id: 'audio-1', assetId: 'audio-asset', kind: 'audio', uri: 'assets/voice.wav', metadata: { durationMs: 8000 } };
const videoMode = { mode: 'videoEdit', outputVariants: [variant(1024)], duration: { kind: 'fixed', seconds: 8 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false }, audioDrivenVideo: true,
    referenceRules: { video: { supported: true, maxCount: 1 }, audio: { supported: true, maxCount: 1 } }, combinationConstraints: [{ combination: 'video+audio', maxVideos: 1, maxAudios: 1 }] };
const lipOptions = { source: video, references: [{ role: 'audio', version: audio }], capability: { ...capability, modes: [videoMode] }, catalogCapabilities: ['lip_sync'] };

test('four image tools route through declared image editing and preserve frozen references', () => {
    for (const operation of ['image.upscale', 'image.relight', 'image.outpaint', 'image.styleTransfer']) {
        const result = plan(operation, { prompt: 'Keep the character recognizable.' });
        assert.equal(result.status, 'available');
        assert.equal(result.kind, 'image');
        assert.equal(result.mode, 'imageToImage');
        assert.equal(result.modelId, 'opaque-model');
        assert.equal(result.capabilityVersion, 'facts-v1');
        assert.match(result.prompt, /Keep the character recognizable/);
        assert.deepEqual(result.inputs, [{ role: 'referenceImage', version: image }]);
        assert.notEqual(result.inputs[0].version, image);
        assert.ok(Object.isFrozen(result.parameters));
        assert.ok(Object.isFrozen(result.inputs[0].version.metadata));
        assert.equal(Object.isFrozen(image), false);
    }
});

test('upscale selects the highest declared larger output preserving source aspect', () => {
    const result = plan('image.upscale');
    assert.equal(result.status, 'available');
    assert.deepEqual(result.parameters, { resolution: '2048x2048', aspectRatio: '1:1' });
    assert.equal(plan('image.upscale', { parameters: { resolution: '512x512' } }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('image.upscale', { source: { ...image, metadata: undefined } }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('image.upscale', { source: { ...image, metadata: { width: 2048, height: 2048 } } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('output dimensions and source aspect ratio constrain upscale routing', () => {
    const wide = { ...image, metadata: { width: 512, height: 256 } };
    const wideVariant = { id: 'wide', resolution: '1024x512', aspectRatios: ['2:1'], dimensions: { '2:1': { width: 1024, height: 512 } } };
    assert.equal(plan('image.upscale', { source: wide }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('image.upscale', { source: wide, capability: { ...capability, modes: [{ ...imageMode, outputVariants: [wideVariant] }] } }).status, 'available');
    const tooLarge = { ...wideVariant, resolution: '8192x4096', dimensions: { '2:1': { width: 8192, height: 4096 } } };
    assert.equal(plan('image.upscale', { source: wide, capability: { ...capability, modes: [{ ...imageMode, outputVariants: [tooLarge] }] } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('generic image generation and provider/model names grant no image edit route', () => {
    const result = plan('image.outpaint', { capability: { ...capability, providerModelId: 'famous-outpaint-model', modes: [{ ...imageMode, mode: 'textToImage' }] } });
    assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL');
    assert.deepEqual(result.missingCapabilities, ['imageToImage']);
    assert.equal(plan('image.relight', { capability: { ...capability, status: 'unknown' } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('unknown output and reference contracts return explicit capability gaps', () => {
    for (const override of [{ outputVariants: undefined }, { outputVariants: [{ ...variant(1024), aspectRatios: undefined }] }, { referenceRules: undefined }, { combinationConstraints: undefined }]) {
        const result = plan('image.relight', { capability: { ...capability, modes: [{ ...imageMode, ...override }] } });
        assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL');
        assert.ok(result.missingCapabilities.length);
    }
});

test('declared automatic image output permits relight, outpaint and style transfer without guessed pixels', () => {
    const automatic = { ...imageMode, outputVariants: [{ id: 'provider-default', resolution: 'auto', aspectRatios: ['1:1', '16:9'], defaultAspectRatio: '1:1' }], defaultResolution: 'auto' };
    for (const operation of ['image.relight', 'image.outpaint', 'image.styleTransfer']) {
        const result = plan(operation, { capability: { ...capability, modes: [automatic] } });
        assert.equal(result.status, 'available');
        assert.deepEqual(result.parameters, { resolution: 'auto', aspectRatio: '1:1' });
        assert.equal(result.mode, 'imageToImage');
        assert.equal(result.inputs[0].version.id, image.id);
    }
    assert.equal(plan('image.upscale', { capability: { ...capability, modes: [automatic] } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('automatic fitter dimensions cannot promise upscale pixels or outrank explicit outputs', () => {
    const automatic = { id: 'provider-default', resolution: 'auto', aspectRatios: ['1:1'], defaultAspectRatio: '1:1', dimensions: { '1:1': { width: 4096, height: 4096 } } };
    const automaticOnly = { ...capability, modes: [{ ...imageMode, outputVariants: [automatic], defaultResolution: 'auto' }] };
    assert.equal(plan('image.upscale', { capability: automaticOnly }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('image.upscale', { capability: automaticOnly, parameters: { resolution: 'auto', aspectRatio: '1:1' } }).code, 'CANVAS_TOOL_NO_MODEL');
    for (const operation of ['image.relight', 'image.outpaint', 'image.styleTransfer']) assert.equal(plan(operation, { capability: automaticOnly }).status, 'available');
    const mixed = { ...capability, modes: [{ ...imageMode, outputVariants: [automatic, variant(1024), variant(2048)], defaultResolution: 'auto' }] };
    const selected = plan('image.upscale', { capability: mixed });
    assert.equal(selected.status, 'available');
    assert.deepEqual(selected.parameters, { resolution: '2048x2048', aspectRatio: '1:1' });
});

test('an unknown resolution still cannot bypass the image dimensions guard', () => {
    const unknown = { ...imageMode, outputVariants: [{ id: 'unknown', resolution: 'provider-unknown', aspectRatios: ['1:1'] }], defaultResolution: 'provider-unknown' };
    for (const operation of ['image.relight', 'image.outpaint', 'image.styleTransfer']) assert.equal(plan(operation, { capability: { ...capability, modes: [unknown] } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('invalid explicit parameters are rejected without fallback or input mutation', () => {
    const parameters = { resolution: 'nonsense', aspectRatio: '1:1' };
    assert.throws(() => plan('image.relight', { parameters }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
    assert.deepEqual(parameters, { resolution: 'nonsense', aspectRatio: '1:1' });
    assert.throws(() => plan('image.relight', { parameters: { strength: 0.5 } }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
    assert.throws(() => plan('image.relight', { parameters: null }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
});

test('image identity/style inputs retain order; masks and incompatible audio are not dropped', () => {
    const references = [{ role: 'identity', version: { ...image, id: 'identity' } }, { role: 'style', version: { ...image, id: 'style' } }];
    assert.deepEqual(plan('image.styleTransfer', { references }).inputs.map(input => input.version.id), ['version-image-1', 'identity', 'style']);
    assert.equal(plan('image.outpaint', { references: [{ role: 'mask', version: image }] }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.throws(() => plan('image.styleTransfer', { references: [{ role: 'audio', version: audio }] }), { code: 'CANVAS_TOOL_INPUT_INVALID' });
});

test('missing/uploading sources are rejected and do not become generation routes', () => {
    for (const source of [{ ...image, status: 'missing' }, { ...image, status: 'uploading' }, video]) assert.throws(() => plan('image.relight', { source }), { code: 'CANVAS_TOOL_INPUT_INVALID' });
});

test('remaining tools without current typed operation/output transport report no model', () => {
    for (const operation of ['video.upscale', 'video.removeSubtitles', 'video.matting', 'audio.separateVoice', 'audio.separateBackground']) {
        const result = plan(operation, { capability: { ...capability, modes: [imageMode, videoMode] }, catalogCapabilities: [operation, 'lip_sync', 'video_upscale', 'matting', 'depth'] });
        assert.equal(result.status, 'unavailable');
        assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL');
        assert.equal(result.operation, operation);
        assert.ok(result.missingCapabilities.length);
    }
});

test('known missing tool routes need neither a selected model nor a capability lookup', () => {
    for (const operation of ['video.upscale', 'video.removeSubtitles', 'video.matting', 'audio.separateVoice', 'audio.separateBackground']) {
        assert.equal(canvasModelToolMissingRoute(operation).code, 'CANVAS_TOOL_NO_MODEL');
        assert.equal(planCanvasModelToolRoute({ operation }).code, 'CANVAS_TOOL_NO_MODEL');
    }
    for (const operation of ['image.upscale', 'image.relight', 'image.outpaint', 'image.styleTransfer', 'video.lipSync', 'image.matting', 'image.depth', 'video.depth']) assert.equal(canvasModelToolMissingRoute(operation), undefined);
});

test('matting and depth select local tools without a provider or model capability', () => {
    for (const operation of ['image.matting', 'image.depth']) {
        assert.equal(isCanvasOnDeviceToolOperation(operation), true);
        const result = planCanvasModelToolRoute({ operation, source: image });
        assert.equal(result.status, 'local');
        assert.equal(result.kind, 'image');
        assert.equal(result.operation, operation);
        assert.equal(result.modelId, undefined);
        assert.deepEqual(result.parameters, operation === 'image.depth' ? { invert: false } : {});
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.parameters));
    }
    for (const operation of ['image.upscale', 'video.matting', 'audio.separateVoice']) assert.equal(isCanvasOnDeviceToolOperation(operation), false);
});

test('local depth preserves inversion and accepts only explicit boolean settings', () => {
    const parameters = { invert: true };
    const result = planCanvasOnDeviceToolRoute({ operation: 'image.depth', source: image, parameters });
    parameters.invert = false;
    assert.deepEqual(result.parameters, { invert: true });
    for (const invalid of [null, [], { invert: 'true' }, { invert: 1 }, { strength: 0.5 }]) {
        assert.throws(() => planCanvasOnDeviceToolRoute({ operation: 'image.depth', source: image, parameters: invalid }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
    }
    assert.throws(() => planCanvasOnDeviceToolRoute({ operation: 'image.matting', source: image, parameters: { invert: true } }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
});

test('local tools require a ready image and reject unimplemented prompts or references', () => {
    for (const source of [undefined, video, { ...image, status: 'missing' }, { ...image, status: 'uploading' }]) {
        assert.throws(() => planCanvasModelToolRoute({ operation: 'image.matting', source }), { code: 'CANVAS_TOOL_INPUT_INVALID' });
    }
    for (const override of [{ prompt: 'Keep only the person' }, { references: [{ role: 'mask', version: image }] }]) {
        assert.throws(() => planCanvasOnDeviceToolRoute({ operation: 'image.matting', source: image, ...override }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
    }
});

test('lip sync routes only with explicit lip_sync and an audio-driven video edit contract', () => {
    const result = plan('video.lipSync', lipOptions);
    assert.equal(result.status, 'available');
    assert.equal(result.kind, 'video');
    assert.equal(result.mode, 'videoEdit');
    assert.deepEqual(result.parameters, { resolution: '1024x1024', aspectRatio: '1:1', durationSeconds: 8, generateAudio: false });
    assert.deepEqual(result.inputs.map(input => input.role), ['referenceVideo', 'referenceAudio']);
    assert.equal(plan('video.lipSync', { ...lipOptions, catalogCapabilities: [] }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('video.lipSync', { ...lipOptions, capability: { ...capability, modes: [{ ...videoMode, audioDrivenVideo: undefined }] } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('unsupported or unknown media profile evidence cannot be overridden by a catalog flag', () => {
    for (const status of ['unsupported', 'unknown']) assert.equal(plan('video.lipSync', { ...lipOptions, mediaCapabilities: [{ capability: 'lip_sync', status }] }).code, 'CANVAS_TOOL_NO_MODEL');
    assert.equal(plan('video.lipSync', { ...lipOptions, catalogCapabilities: [], mediaCapabilities: [{ capability: 'lip_sync', status: 'supported' }] }).status, 'available');
});

test('lip sync rejects missing audio and incomplete video/audio reference combinations', () => {
    assert.throws(() => plan('video.lipSync', { ...lipOptions, references: [] }), { code: 'CANVAS_TOOL_INPUT_INVALID' });
    assert.equal(plan('video.lipSync', { ...lipOptions, capability: { ...capability, modes: [{ ...videoMode, combinationConstraints: [{ combination: 'video' }] }] } }).code, 'CANVAS_TOOL_NO_MODEL');
});

test('mode extensions not mapped by the media queue are unavailable even when declared', () => {
    const extended = { ...imageMode, parameters: [{ key: 'seed', type: 'number', defaultValue: 42 }] };
    const result = plan('image.relight', { capability: { ...capability, modes: [extended] } });
    assert.equal(result.code, 'CANVAS_TOOL_NO_MODEL');
    assert.deepEqual(result.missingCapabilities, ['parameter transport: seed']);
});

test('valid reference capabilities still respect the existing media queue limit', () => {
    const refs = Array.from({ length: 4 }, (_, index) => ({ role: 'style', version: { ...image, id: `style-${index}` } }));
    const permissive = { ...imageMode, referenceRules: { image: { supported: true, maxCount: 8 } }, combinationConstraints: [{ combination: 'image', maxImages: 8 }] };
    assert.equal(plan('image.styleTransfer', { references: refs, capability: { ...capability, modes: [permissive] } }).code, 'CANVAS_TOOL_NO_MODEL');
});


test('video depth uses a local video source with strict defaults and no model route', () => {
    assert.equal(isCanvasOnDeviceToolOperation('video.depth'), true);
    const result = planCanvasModelToolRoute({ operation: 'video.depth', source: video });
    assert.equal(result.status, 'local'); assert.equal(result.kind, 'video');
    assert.deepEqual(result.parameters, { resolution: 'source', invert: false, smooth: true });
    assert.deepEqual(planCanvasOnDeviceToolRoute({ operation: 'video.depth', source: video,
        parameters: { resolution: '480', invert: true, smooth: false } }).parameters,
        { resolution: '480', invert: true, smooth: false });
    for (const parameters of [{ resolution: 720 }, { resolution: '1080' }, { smooth: 1 }, { invert: 'false' }, { fps: 24 }, { prompt: 'depth' }])
        assert.throws(() => planCanvasOnDeviceToolRoute({ operation: 'video.depth', source: video, parameters }), { code: 'CANVAS_TOOL_PARAMETERS_INVALID' });
    assert.throws(() => planCanvasOnDeviceToolRoute({ operation: 'video.depth', source: image }), { code: 'CANVAS_TOOL_INPUT_INVALID' });
});
