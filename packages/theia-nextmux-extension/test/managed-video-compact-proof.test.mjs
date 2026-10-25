import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCanvasProvenVideoShapes, validateCanvasGenerationParameters } from '@nextmux/comic-core';
import { buildManagedCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, canvasAdapterInputIssues } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { compileCanvasGenerationJob } from '../lib/node/nextmux-canvas-generation.js';

const quote = `kq1_${'a'.repeat(64)}`, id = '11111111-1111-4111-8111-111111111111';
const proof = () => ({ version: 1, outputs: [
    { resolution: '720p', aspectRatio: '16:9', width: 1280, height: 720 },
    { resolution: '720p', aspectRatio: '9:16', width: 720, height: 1280 }
], durations: [4, 6, 8], rules: [
    { outputs: [0, 1], firstFrame: false, lastFrame: false, requestAudio: false, referenceCounts: [0], minDurationSeconds: 4 },
    { outputs: [0, 1], firstFrame: true, lastFrame: false, requestAudio: false, referenceCounts: [0], minDurationSeconds: 6 },
    { outputs: [0, 1], firstFrame: true, lastFrame: true, requestAudio: false, referenceCounts: [0, 1], durationSeconds: [6, 8] },
    { outputs: [0, 1], firstFrame: false, lastFrame: false, requestAudio: false, referenceCounts: [1, 2], durationSeconds: [6] }
] });
const offering = (groups = proof()) => ({ id, providerName: 'Fixture relay', providerModelCode: 'fixture-video', displayName: 'Compact proof',
    status: 'active', category: 'video', keyPriceQuoteId: quote, capabilities: ['text_to_video', 'image_to_video', 'reference_to_video', 'native_audio'],
    mediaInput: { firstFrame: true, lastFrame: true, referenceImages: true, maxReferences: 2 },
    videoLimits: { resolutions: ['720p'], aspectRatios: ['16:9', '9:16', '21:9'], durations: [4, 6, 8], shapeQuoteId: quote, provenShapeGroups: groups } });
const picture = (role, name, order = 0, metadata = { width: 1918, height: 1080 }) => ({ role, order, kind: 'image',
    versionId: `${name}-version`, assetId: `${name}-asset`, uri: `nextmux.media/${name}.png`, metadata: { mimeType: 'image/png', byteLength: 100, ...metadata } });
const first = picture('firstFrame', 'first'), last = picture('lastFrame', 'last', 1), reference = picture('referenceImage', 'reference', 2);
const snapshot = (capability, { mode = 'firstLastFrame', inputs = [first, last, reference], aspectRatio = '16:9', durationSeconds = 6 } = {}) => ({
    modelId: capability.providerModelId, capabilityVersion: capability.version, mode, prompt: 'Preserve the scene.',
    inputFingerprint: 'compact-proof-snapshot', resolvedInputs: inputs, parameters: { resolution: '720p', aspectRatio, durationSeconds }
});
const compile = (capability, policy, frozen = snapshot(capability), keyPriceQuoteId = quote) => compileCanvasGenerationJob({
    canvasId: 'compact-canvas', projectId: 'project-11111111-1111-4111-8111-111111111111', nodeId: 'compact-node',
    idempotencyKey: 'same-compact-click', connectionId: `managed:fixed:${id}`, capability, adapterPolicy: policy, snapshot: frozen, keyPriceQuoteId,
    cost: { billing: 'platform_billed', description: 'Synthetic compact proof' }
});

test('compact and legacy certificates produce the same effective managed modes and exact queued input', () => {
    const route = offering(), decoded = decodeCanvasProvenVideoShapes(route.videoLimits).shapes;
    const legacy = { ...route, videoLimits: { ...route.videoLimits, provenShapeGroups: undefined, provenShapes: decoded } };
    const cap = buildManagedCanvasCapability(route), legacyCap = buildManagedCanvasCapability(legacy), policy = buildManagedCanvasAdapterPolicy(route);
    assert.deepEqual(cap.modes, legacyCap.modes);
    assert.deepEqual(policy.videoShapeProofs, decoded);
    const request = compile(cap, policy);
    assert.equal(request.input.firstFrameUri, first.uri);
    assert.equal(request.input.lastFrameUri, last.uri);
    assert.deepEqual(request.input.characterReferenceUris, [reference.uri]);
    assert.deepEqual([request.input.width, request.input.height, request.input.durationSeconds, request.input.requestAudio], [1280, 720, 6, false]);
    assert.equal(cap.modes[0].audioGeneration.mode, 'unsupported', 'a false-only quote cannot advertise an enabled audio control');
    assert.ok(cap.sources.includes('videoLimits.provenShapeGroups:complete-current-quote'));
    assert.throws(() => compile(cap, policy, snapshot(cap, { durationSeconds: 4 })), { code: 'CANVAS_CAPABILITY_INVALID' });
    assert.throws(() => compile(cap, policy, snapshot(cap, { inputs: [first, last, reference, picture('character', 'second', 3)] })), { code: 'CANVAS_CAPABILITY_INVALID' });
});

test('compact quote mismatch, ambiguous formats and malformed dimensions close both consumers', () => {
    const valid = offering();
    for (const route of [
        { ...valid, keyPriceQuoteId: `kq1_${'b'.repeat(64)}` },
        { ...valid, videoLimits: { ...valid.videoLimits, shapeQuoteId: undefined } },
        { ...valid, videoLimits: { ...valid.videoLimits, shapeQuoteId: 'kq1_invalid' } },
        { ...valid, videoLimits: { ...valid.videoLimits, provenShapes: [] } },
        offering({ ...proof(), outputs: [{ ...proof().outputs[0], width: 1278 }] }),
        offering({ ...proof(), extra: true }),
    ]) {
        const cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
        assert.deepEqual(cap.modes, []);
        assert.equal(cap.status, 'unknown');
        assert.ok(canvasAdapterInputIssues(policy, 'video', { connectionId: `managed:fixed:${id}`, model: 'fixture-video', prompt: 'test',
            keyPriceQuoteId: quote, generationMode: 'imageToVideo', firstFrameUri: first.uri, resolution: '720p', aspectRatio: '16:9',
            width: 1280, height: 720, durationSeconds: 6, requestAudio: false }).length > 0);
    }
    const cap = buildManagedCanvasCapability(valid), policy = buildManagedCanvasAdapterPolicy(valid);
    assert.throws(() => compile(cap, policy, snapshot(cap), `kq1_${'b'.repeat(64)}`), { code: 'CANVAS_PRICE_QUOTE_CHANGED' });
});

test('compact managed auto allows only a proved measured ratio and exact output pixels', () => {
    const groups = proof();
    groups.rules = groups.rules.map(rule => ({ ...rule, outputs: [1] }));
    const route = { ...offering(groups), providerModelCode: 'bytedance/seedance-2.5' };
    const cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
    const portrait = picture('firstFrame', 'portrait', 0, { width: 768, height: 1376 });
    const frozen = snapshot(cap, { mode: 'imageToVideo', inputs: [portrait], aspectRatio: 'auto' });
    const request = compile(cap, policy, frozen);
    assert.deepEqual([request.input.aspectRatio, request.input.width, request.input.height], ['9:16', 720, 1280]);
    const wide = picture('firstFrame', 'wide', 0, { width: 2330, height: 1000 });
    const unproven = snapshot(cap, { mode: 'imageToVideo', inputs: [wide], aspectRatio: 'auto' });
    assert.ok(validateCanvasGenerationParameters(cap, unproven.mode, unproven.parameters, unproven.resolvedInputs).some(issue => issue.path === 'aspectRatio'));
    assert.throws(() => compile(cap, policy, unproven), { code: 'CANVAS_CAPABILITY_INVALID' });
    assert.throws(() => compile(cap, policy, { ...frozen, parameters: { ...frozen.parameters, width: 722, height: 1280 } }), { code: 'CANVAS_CAPABILITY_INVALID' });
});

test('an exact current audio-on-only certificate keeps its fixed required audio choice', () => {
    const groups = proof();
    groups.rules = groups.rules.map(rule => ({ ...rule, requestAudio: true }));
    const route = offering(groups), cap = buildManagedCanvasCapability(route), policy = buildManagedCanvasAdapterPolicy(route);
    assert.ok(cap.modes.length > 0);
    assert.equal(policy.audioRequestEnabled, true);
    const queued = compile(cap, policy, snapshot(cap, { mode: 'imageToVideo', inputs: [first], durationSeconds: 6 }));
    assert.equal(queued.input.requestAudio, true);
    assert.throws(() => compile(cap, policy, { ...snapshot(cap, { mode: 'imageToVideo', inputs: [first], durationSeconds: 6 }), parameters: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 6, generateAudio: false } }), { code: 'CANVAS_CAPABILITY_INVALID' });
    const issues = canvasAdapterInputIssues(policy, 'video', { connectionId: `managed:fixed:${id}`, model: 'fixture-video', prompt: 'test',
        keyPriceQuoteId: quote, generationMode: 'imageToVideo', firstFrameUri: first.uri, resolution: '720p', aspectRatio: '16:9',
        width: 1280, height: 720, durationSeconds: 6, requestAudio: true });
    assert.deepEqual(issues, []);
});
