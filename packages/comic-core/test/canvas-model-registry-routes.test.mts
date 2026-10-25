import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_REGISTRY_ALIASES, CANVAS_REGISTRY_NOT_IN_SPEC, canvasRegistryFamilyId } from '../lib/canvas-model-registry-aliases.js';
import { canvasRegistryFamily, listCanvasRegistryModels } from '../lib/canvas-model-registry.js';
import { canvasRegistryRouteAvailability, chooseCanvasRegistryDefault, groupCanvasRegistryRoutes } from '../lib/canvas-model-registry-routes.js';
import type { CanvasModelCapability } from '../lib/canvas-capabilities.js';
import type { CanvasRegistryRoute } from '../lib/canvas-model-registry-routes.js';

function capability(modelId: string, kind: 'image' | 'video', patch: Partial<CanvasModelCapability> = {}): CanvasModelCapability {
  return {
    id: modelId, providerId: 'test', providerModelId: modelId, displayName: modelId, version: 'test:v1', status: 'available', sources: ['test'],
    modes: [{ mode: kind === 'image' ? 'textToImage' : 'textToVideo', outputVariants: [{ id: 'default', resolution: '720p', aspectRatios: ['16:9'] }],
      ...(kind === 'video' ? { duration: { kind: 'fixed', seconds: 8 }, audioGeneration: { mode: 'required', defaultEnabled: true } } : {}) }],
    ...patch
  };
}

function route(modelId: string, kind: 'image' | 'video', key = modelId, patch: Partial<CanvasRegistryRoute> = {}): CanvasRegistryRoute {
  return { key, connectionId: `connection:${key}`, modelId, kind, source: 'test', capabilityHint: capability(modelId, kind), ...patch };
}

test('reviewed real OpenRouter and vendor model IDs map to the exact spec family', () => {
  const pairs = {
    'bytedance/seedance-2.5': 'seedance-2.5',
    'bytedance/seedance-2.0-mini': 'seedance-2.0-mini',
    'minimax/hailuo-3': 'minimax-h3',
    'minimax/hailuo-3-max': 'minimax-h3-max',
    'kwaivgi/kling-v3.0-pro': 'kling-v3',
    'kwaivgi/kling-v3.0-std': 'kling-v3',
    'google/veo-3.1': 'veo-3.1',
    'google/veo-3.1-fast': 'veo-3.1-fast',
    'alibaba/wan-3.0': 'wan-3.0',
    'openai/gpt-image-2': 'gpt-image-2',
    'google/gemini-3-pro-image-preview': 'gemini-3-pro-image',
    'google/gemini-3-pro-image': 'gemini-3-pro-image',
    'qwen/qwen-image-3-pro': 'qwen-image-3.0-pro',
    'bytedance-seed/seedream-5-0-pro': 'seedream-5.0-pro',
    'doubao-seedance-2-5-260628': 'seedance-2.5',
    'MiniMax-H3': 'minimax-h3',
    'kling-v3': 'kling-v3',
    'vidu-q3-pro': 'vidu-q3-pro',
    'veo-3.1-generate-001': 'veo-3.1'
  };
  for (const [modelId, familyId] of Object.entries(pairs)) {
    assert.equal(canvasRegistryFamilyId(modelId), familyId, modelId);
    assert.equal(canvasRegistryFamily(modelId)?.id, familyId, modelId);
  }
});

test('only templates with an explicit spec model identity inherit a family', () => {
  assert.equal(canvasRegistryFamilyId('video_minimax_h3'), 'minimax-h3');
  assert.equal(canvasRegistryFamilyId('video_wan_3.0'), 'wan-3.0');
  assert.equal(canvasRegistryFamilyId('video_veo3.1_fast'), 'veo-3.1-fast');
  // 速创's `video_omni` is Kling's Omni video model (Kling 3.0 Omni: 3–15 s, native sound, first/last frame), so it is Kling v3.
  assert.equal(canvasRegistryFamily('video_omni')?.id, 'kling-v3');
});

test('the alias table has one unambiguous family for every exact id and no fuzzy matching', () => {
  const families = listCanvasRegistryModels();
  assert.deepEqual(Object.keys(CANVAS_REGISTRY_ALIASES), families.map(family => family.id));
  const ids = Object.values(CANVAS_REGISTRY_ALIASES).flat();
  assert.equal(new Set(ids).size, ids.length);
  for (const modelId of ['BYTEDANCE/seedance-2.5', 'bytedance/seedance-2.5:free', 'wan3.0-0826', 'custom/google/veo-3.1', 'Kling v3', 'google/gemini-3-pro-image-20990101']) {
    assert.equal(canvasRegistryFamily(modelId), undefined, modelId);
  }
});

test('catalog identities outside the fixed spec do not acquire fixed family aliases', () => {
  assert.ok(CANVAS_REGISTRY_NOT_IN_SPEC.length > 0);
  for (const model of CANVAS_REGISTRY_NOT_IN_SPEC) assert.equal(canvasRegistryFamily(model.modelId), undefined, model.modelId);
  assert.equal(CANVAS_REGISTRY_NOT_IN_SPEC.some(model => model.modelId === 'minimax/hailuo-3'), false);
  for (const modelId of ['openai/sora-2-pro', 'alibaba/wan-3.0-prime', 'alibaba/wan-2.6', 'google/veo-3.1-lite', 'alibaba/happyhorse-1.1', 'bytedance/seedance-1-5-pro', 'kwaivgi/kling-video-o1']) {
    assert.ok(CANVAS_REGISTRY_NOT_IN_SPEC.some(model => model.modelId === modelId), modelId);
  }
});

test('configured models beyond the fixed catalog retain only independently executable routes', () => {
  const id = 'opaque/future-image';
  const own = route(id, 'image', 'own');
  const relay = route(id, 'image', 'relay', { source: 'merchant', connectionId: 'managed:fixed:fixture' });
  const invalid = route(id, 'image', 'invalid', { capabilityHint: capability(id, 'image', { status: 'unknown' }) });
  const groups = groupCanvasRegistryRoutes('image', [own, relay, own, invalid]);
  assert.deepEqual(groups.slice(0, listCanvasRegistryModels('image').length).map(group => group.family.id), listCanvasRegistryModels('image').map(family => family.id));
  const group = groups.at(-1)!;
  assert.equal(group.family.specId, id);
  assert.equal(group.family.raw, undefined, 'a verified route does not invent a fixed specification');
  assert.deepEqual(group.routes.map(candidate => candidate.key), ['own', 'relay']);
  assert.equal(group.available, true);
  assert.equal(chooseCanvasRegistryDefault('image', [own], 'own').route?.key, 'own');
});

test('unknown image inputs, wrong identities and incomplete output modes cannot create model options', () => {
  const id = 'opaque/unproved';
  const cases = [
    route(id, 'image', 'no-facts', { capabilityHint: undefined }),
    route(id, 'image', 'unavailable', { capabilityHint: capability(id, 'image', { status: 'maintenance' }) }),
    route(id, 'image', 'wrong-model', { capabilityHint: capability('different/id', 'image') }),
    route(id, 'image', 'video-output', { capabilityHint: capability(id, 'video') }),
    route(id, 'image', 'no-output', { capabilityHint: capability(id, 'image', { modes: [{ mode: 'textToImage' }] }) }),
    route(id, 'image', 'no-references', { capabilityHint: capability(id, 'image', { modes: [{ mode: 'imageToImage', outputVariants: [{ id: 'square', resolution: '1024x1024', aspectRatios: ['1:1'] }] }] }) }),
  ];
  assert.equal(groupCanvasRegistryRoutes('image', cases).some(group => group.routes.length), false);
});

test('new video identities keep duration, audio and required-frame validation', () => {
  const id = 'opaque/future-video';
  const good = route(id, 'video', 'verified');
  const missingFrame = route(id, 'video', 'missing-frame', { capabilityHint: capability(id, 'video', {
    modes: [{ ...good.capabilityHint!.modes[0], mode: 'imageToVideo', firstFrame: false }],
  }) });
  const group = groupCanvasRegistryRoutes('video', [good, missingFrame]).at(-1)!;
  assert.equal(group.family.specId, id);
  assert.deepEqual(group.routes.map(candidate => candidate.key), ['verified']);
});

test('grouping follows spec order, retains sources and separates multiple routes for one family', () => {
  const first = route('google/veo-3.1-fast', 'video', 'veo');
  const own = route('bytedance/seedance-2.5', 'video', 'seed-own', { source: 'Own API' });
  const managed = route('bytedance/seedance-2.5', 'video', 'seed-managed', { source: 'Managed', connectionId: 'managed:fixed:seed' });
  const groups = groupCanvasRegistryRoutes('video', [first, own, managed, own, route('openai/sora-2-pro', 'video'), route('openai/gpt-image-2', 'image')]);
  assert.deepEqual(groups.map(group => group.family.id), [...listCanvasRegistryModels('video').map(family => family.id), 'configured:video:openai/sora-2-pro']);
  assert.deepEqual(groups[0].routes.map(candidate => [candidate.key, candidate.connectionId, candidate.source]), [
    ['seed-own', 'connection:seed-own', 'Own API'], ['seed-managed', 'managed:fixed:seed', 'Managed']
  ]);
  assert.ok(groups[0].available);
  assert.equal(groups.flatMap(group => group.routes).length, 4);
  assert.ok(groups.filter(group => !group.routes.length).every(group => !group.available && group.unavailableReason?.code === 'NO_ROUTE'));
});

test('unverified or unusable routes remain visible with a disabling reason', () => {
  const unknown = route('google/veo-3.1', 'video', 'unknown', { capabilityHint: undefined });
  const unavailable = route('google/veo-3.1', 'video', 'maintenance', { capabilityHint: capability('google/veo-3.1', 'video', { status: 'maintenance' }) });
  const missingDuration = route('google/veo-3.1', 'video', 'missing-duration', { capabilityHint: capability('google/veo-3.1', 'video', { modes: [{ mode: 'textToVideo', outputVariants: [{ id: 'default', resolution: '720p', aspectRatios: ['16:9'] }], audioGeneration: { mode: 'required', defaultEnabled: true } }] }) });
  const group = groupCanvasRegistryRoutes('video', [unknown, unavailable, missingDuration]).find(candidate => candidate.family.id === 'veo-3.1')!;
  assert.equal(group.available, false);
  assert.deepEqual(group.routes.map(candidate => candidate.unavailableReason?.code), ['CAPABILITY_UNKNOWN', 'MODEL_UNAVAILABLE', 'NO_EXECUTABLE_MODE']);
  assert.equal(group.routes[0].capabilityHint, undefined);
});

test('route eligibility rejects a mode whose required frame or references cannot be carried', () => {
  const video = capability('google/veo-3.1', 'video');
  const mode = video.modes[0];
  const firstFrame = route('google/veo-3.1', 'video', 'frames', { capabilityHint: { ...video, modes: [{ ...mode, mode: 'imageToVideo', firstFrame: false }] } });
  assert.equal(canvasRegistryRouteAvailability(firstFrame).available, false);
  assert.equal(canvasRegistryRouteAvailability({ ...firstFrame, capabilityHint: { ...video, modes: [{ ...mode, mode: 'imageToVideo', firstFrame: true }] } }).available, true);
  const reference = route('google/veo-3.1', 'video', 'references', { capabilityHint: { ...video, modes: [{ ...mode, mode: 'referenceToVideo', referenceRules: { image: { supported: false, maxCount: 0 } }, combinationConstraints: [{ combination: 'image', maxImages: 3 }] }] } });
  assert.equal(canvasRegistryRouteAvailability(reference).available, false);
});

test('a stale capability hint for another route model cannot enable a registered choice', () => {
  const stale = route('google/veo-3.1', 'video', 'stale', { capabilityHint: capability('google/veo-3.1-fast', 'video') });
  const state = canvasRegistryRouteAvailability(stale);
  assert.equal(state.available, false);
  assert.equal(state.unavailableReason?.code, 'CAPABILITY_UNKNOWN');
  assert.deepEqual(state.unavailableReason?.sources, ['test']);
  assert.equal(chooseCanvasRegistryDefault('video', [stale], 'stale').selection, 'none');
  assert.equal(canvasRegistryRouteAvailability(route('openai/gpt-image-2', 'image', 'wrong-kind', { capabilityHint: capability('openai/gpt-image-2', 'video') })).available, false);
});

test('defaults prefer the studio route when its effective model capability is usable', () => {
  const seed = route('bytedance/seedance-2.5', 'video', 'seed');
  const veo = route('google/veo-3.1-fast', 'video', 'veo');
  const sora = route('openai/sora-2-pro', 'video', 'sora');
  const routes = [veo, sora, seed];
  const studio = chooseCanvasRegistryDefault('video', routes, { key: 'veo', modelId: 'google/veo-3.1-fast' });
  assert.equal(studio.selection, 'studio');
  assert.equal(studio.family?.id, 'veo-3.1-fast');
  assert.equal(studio.route?.key, 'veo');
  const discovered = chooseCanvasRegistryDefault('video', routes, 'sora');
  assert.equal(discovered.selection, 'studio');
  assert.equal(discovered.family?.id, 'configured:video:openai/sora-2-pro');
  assert.equal(discovered.route?.key, 'sora');
  const fallback = chooseCanvasRegistryDefault('video', routes, 'unconfigured');
  assert.equal(fallback.selection, 'firstAvailable');
  assert.equal(fallback.route?.key, 'seed');
});

test('defaults skip unknown studio capabilities and return an explicit reason when none can run', () => {
  const seed = route('bytedance/seedance-2.5', 'video', 'seed', { capabilityHint: undefined });
  const veo = route('google/veo-3.1-fast', 'video', 'veo');
  assert.equal(chooseCanvasRegistryDefault('video', [seed, veo], 'seed').route?.key, 'veo');
  const unknown = chooseCanvasRegistryDefault('video', [seed], 'seed');
  assert.equal(unknown.selection, 'none');
  assert.equal(unknown.family, undefined);
  assert.equal(unknown.route, undefined);
  assert.equal(unknown.reason?.code, 'CAPABILITY_UNKNOWN');
  assert.equal(chooseCanvasRegistryDefault('image', []).reason?.code, 'NO_ROUTE');
});
