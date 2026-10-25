import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { resolveCanvasCapability } from '@nextmux/comic-core';
import { buildManagedCanvasCapability, buildOfficialCanvasCapability } from '../lib/common/nextmux-canvas-capabilities.js';
import { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, OPENROUTER_VIDEO_DEFAULT_RATIOS } from '../lib/common/nextmux-canvas-adapter-policy.js';
import { videoModelGuide } from '../lib/common/nextmux-video-model-guide.js';
import { CanvasServiceError } from '../lib/node/nextmux-canvas-store.js';
import { managedQuoteId, syntheticManagedVideoProof } from './fixtures/canvas-managed-proof.mjs';

const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true), methods = [];
(function walk(node) {
    if (ts.isMethodDeclaration(node) && ['canvasCapability', 'canvasAdapterPolicy'].includes(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, walk);
})(ast);
const deps = { buildManagedCanvasCapability, buildOfficialCanvasCapability, buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, CanvasServiceError };
const compiled = ts.transpileModule(`const { ${Object.keys(deps).join(', ')} } = deps; class Harness { ${methods.join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)(deps);
const model = 'minimax/hailuo-3-max';
const facts = { ...videoModelGuide(model), source: 'listing', resolutions: ['480p', '768p'], aspectRatios: ['16:9', '9:16'] };
const connection = { id: 'official-fixture', providerId: 'openai', providerName: 'Fixture', label: 'Fixture', protocol: 'openai_chat_completions',
    baseUrl: 'https://openrouter.ai/api/v1', updatedAt: '2026-09-30T12:00:00.000Z' };

test('canvas service reuses desk video facts for OpenRouter Hailuo instead of relying on Sora/Veo-only profiles', async () => {
    const harness = new Harness(), reads = [];
    harness.getVideoModelFacts = async (...args) => { reads.push(args); return facts; };
    harness.mediaConnection = async () => ({ connection });
    const capability = await harness.canvasCapability(connection.id, model, 'video');
    assert.deepEqual(reads, [[connection.id, model]]);
    assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
    for (const mode of ['textToVideo']) {
        const resolved = resolveCanvasCapability(capability, { mode, resolution: capability.modes[0].outputVariants[0].resolution });
        assert.deepEqual(resolved.issues, []);
        assert.deepEqual(resolved.variant.aspectRatios, ['16:9', '9:16']);
        assert.deepEqual(resolved.duration.seconds, Array.from({ length: 11 }, (_, index) => index + 5));
        assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true });
    }
    assert.equal((await harness.canvasAdapterPolicy(connection.id, model, 'video')).firstFrameField, 'firstFrameUri');
});

test('managed canvas service keeps exact catalog output limits and explicit input refusal over live facts', async () => {
    const harness = new Harness(), id = '11111111-1111-4111-8111-111111111111', managedModel = 'bytedance/seedance-2.0';
    const offering = { id, providerName: 'Relay', providerModelCode: managedModel, displayName: 'Seedance', status: 'active', category: 'video', keyPriceQuoteId: managedQuoteId,
        capabilities: ['text_to_video', 'image_to_video'], mediaInput: { firstFrame: true, referenceImages: false, maxReferences: 0 },
        videoLimits: { durations: [6, 10], resolutions: ['720p'], aspectRatios: ['9:16'], shapeQuoteId: managedQuoteId,
          provenShapes: syntheticManagedVideoProof({ resolutions: ['720p'], aspectRatios: ['9:16'], durations: [6, 10], frameStates: [[false, false], [true, false]] }) } };
    harness.getVideoModelFacts = async () => ({ ...videoModelGuide(managedModel), source: 'listing', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] });
    harness.getCatalogOffering = async offeringId => { assert.equal(offeringId, id); return offering; };
    const capability = await harness.canvasCapability(`managed:fixed:${id}`, managedModel, 'video');
    const resolved = resolveCanvasCapability(capability, { mode: 'imageToVideo', resolution: '720p' });
    assert.deepEqual(resolved.duration.seconds, [6, 10]);
    assert.deepEqual(resolved.variant.aspectRatios, ['9:16']);
    offering.mediaInput.firstFrame = false;
    const refused = await harness.canvasCapability(`managed:fixed:${id}`, managedModel, 'video');
    assert.deepEqual(refused.modes.map(mode => mode.mode), ['textToVideo']);
});

test('missing Hailuo listing output facts declare the desk auto inputs without guessed output pixels', async () => {
    const harness = new Harness();
    harness.mediaConnection = async () => ({ connection });
    harness.getVideoModelFacts = async () => ({ ...videoModelGuide(model), source: 'guide', resolutions: [], aspectRatios: [] });
    const capability = await harness.canvasCapability(connection.id, model, 'video');
    assert.deepEqual(capability.modes.map(mode => mode.mode), ['textToVideo', 'imageToVideo']);
    assert.deepEqual(capability.modes.find(mode => mode.mode === 'imageToVideo').outputVariants[0].aspectRatios, ['auto']);
    const resolved = resolveCanvasCapability(capability, { mode: 'textToVideo', resolution: 'auto' });
    assert.deepEqual(resolved.issues, []);
    assert.deepEqual(resolved.variant.aspectRatios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
    assert.equal(resolved.variant.dimensions, undefined);
    assert.deepEqual(resolved.duration.seconds, Array.from({ length: 11 }, (_, index) => index + 5));
    assert.deepEqual(resolved.audioGeneration, { mode: 'required', defaultEnabled: true });
    assert.equal(resolved.mode.firstFrame, false);
    assert.ok(resolveCanvasCapability(capability, { mode: 'textToVideo', resolution: '720p' }).issues.some(issue => issue.code === 'RESOLUTION_INVALID'));
});
