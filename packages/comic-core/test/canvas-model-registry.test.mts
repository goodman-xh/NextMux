import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canvasRegistryFamily, listCanvasRegistryModels } from '../lib/canvas-model-registry.js';
import {
  validateCanvasGenerationParameters, type CanvasCapabilityInput, type CanvasModeCapability, type CanvasModelCapability,
} from '../lib/canvas-capabilities.js';

// This fixture was extracted from the fenced JSON in canvas-spec.md §22, without reading supplied JS.
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/canvas-model-registry-spec22.json', import.meta.url), 'utf8'));
function technical(row: Record<string, unknown>, kind: 'image' | 'video') {
  const omitted = kind === 'video' ? ['name', 'description', 'tags', 'badges'] : ['model_display_name', 'model_description'];
  return Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.includes(key)));
}
function numericFields(value: unknown, prefix = ''): [string, number][] {
  if (typeof value === 'number') return [[prefix, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => numericFields(item, `${prefix}.${key}`));
}

test('registry preserves every §22 technical field and number in spec order, excluding four Midjourney entries', () => {
  assert.equal(snapshot.videoModels.length, 23);
  assert.equal(snapshot.imageModels.length, 19);
  for (const kind of ['video', 'image'] as const) {
    const original = (kind === 'video' ? snapshot.videoModels : snapshot.imageModels).filter((row: Record<string, unknown>) => row.provider !== 'MIDJOURNEY');
    const families = listCanvasRegistryModels(kind);
    assert.equal(families.length, kind === 'video' ? 23 : 15);
    assert.equal(new Set(families.map(family => family.id)).size, families.length);
    families.forEach((family, index) => {
      const row = original[index];
      assert.equal(family.specId, row.value ?? row.model_name);
      assert.deepEqual(family.raw, technical(row, kind), family.specId);
      assert.deepEqual(numericFields(family.raw), numericFields(row), `${family.id}: exact snapshot numbers`);
      assert.ok(family.sources.some(source => source.includes('§22')));
      assert.ok(!/Neo|Mj-/i.test(family.displayName));
      assert.strictEqual(canvasRegistryFamily(family.id), family);
      assert.strictEqual(canvasRegistryFamily(family.specId), family);
    });
  }
  assert.equal(canvasRegistryFamily('Midjourney-v 8.2'), undefined);
  assert.equal(canvasRegistryFamily('openrouter/flux-example'), undefined);
});

test('every video generation type retains its own exact resolution and ratio matrix and duration rule', () => {
  const modeNames = { TEXT_TO_VIDEO: 'textToVideo', IMAGE_TO_VIDEO: 'imageToVideo', REFERENCE_TO_VIDEO: 'referenceToVideo' };
  for (const row of snapshot.videoModels) {
    const family = canvasRegistryFamily(row.value)!;
    assert.deepEqual(family.modes.map(mode => mode.mode), row.generationTypes.flatMap((generation: { value: keyof typeof modeNames }) => {
      const mode = modeNames[generation.value];
      return generation.value === 'IMAGE_TO_VIDEO' && row.supportFirstLastFrame ? [mode, 'firstLastFrame'] : [mode];
    }));
    for (const generation of row.generationTypes) {
      const mode = family.modes.find(mode => mode.mode === modeNames[generation.value as keyof typeof modeNames])!;
      assert.deepEqual(mode.outputVariants?.map(variant => ({ resolution: variant.resolution, aspectRatios: variant.aspectRatios })),
        generation.resolutions.map((resolution: { value: string; aspectRatios: { value: string }[] }) => ({ resolution: resolution.value, aspectRatios: resolution.aspectRatios.map(aspect => aspect.value) })), family.id);
      assert.deepEqual(mode.duration, { kind: 'range', ...row.durationRange, step: row.durationRange.step ?? 1, defaultSeconds: row.durationRange.min });
      assert.equal(mode.audioGeneration?.mode, row.supportAudio === 0 ? 'unsupported' : row.supportAudio === 1 ? 'optional' : 'required');
      assert.equal(mode.audioGeneration?.defaultEnabled, row.supportAudio === 2);
    }
    assert.equal(family.audioUpload, row.supportAudioUpload);
    assert.equal(family.firstLastFrame, row.supportFirstLastFrame);
    assert.equal(family.draft, row.supportDraft);
    const firstLast = family.modes.find(mode => mode.mode === 'firstLastFrame');
    if (firstLast) {
      assert.equal(firstLast.firstFrame, true);
      assert.equal(firstLast.lastFrame, true);
      const imageMode = family.modes.find(mode => mode.mode === 'imageToVideo')!;
      assert.deepEqual(firstLast.outputVariants?.map(variant => variant.resolution),
        imageMode.outputVariants?.filter(variant => row.provider !== 'KLING' || variant.resolution.toLowerCase() === '1080p').map(variant => variant.resolution));
    }
  }
});

test('every image retains size casing, exact ratios, qualities, structured reference limit and inclusive image counts', () => {
  for (const row of snapshot.imageModels.filter((row: { provider: string }) => row.provider !== 'MIDJOURNEY')) {
    const family = canvasRegistryFamily(row.model_name)!;
    assert.deepEqual(family.imageOptions?.sizes, row.supported_sizes);
    assert.deepEqual(family.imageOptions?.aspectRatios, row.supported_aspect_ratios);
    assert.deepEqual(family.imageOptions?.qualityLevels, row.quality);
    assert.equal(family.imageOptions?.referenceImageLimit, row.max_reference_images);
    assert.deepEqual(family.imageOptions?.rawImageCountOptions, row.image_count_options);
    assert.deepEqual(family.imageOptions?.outputFormats, row.supported_output_formats);
    assert.equal(family.imageOptions?.seed, row.support_seed);
    assert.equal(family.imageOptions?.customAspectRatio, row.support_custom_aspect_ratio);
    const [min, max] = row.image_count_options.map(Number);
    assert.deepEqual(family.imageOptions?.imageCountRange, { min, max });
    assert.deepEqual(family.imageOptions?.imageCountOptions, Array.from({ length: max - min + 1 }, (_, index) => min + index));
    assert.equal(family.modes.find(mode => mode.mode === 'imageToImage')?.referenceRules?.image?.maxCount, row.max_reference_images);
  }
  assert.equal(canvasRegistryFamily('gpt-image-2')?.imageOptions?.referenceImageLimit, 10);
  assert.equal(canvasRegistryFamily('gpt-image-2-official')?.imageOptions?.referenceImageLimit, 16);
  assert.deepEqual(canvasRegistryFamily('wan-2.7-image-pro')?.imageOptions?.imageCountOptions, [1, 2, 3, 4]);
});

test('reference formats, bytes, durations, sides, fps, codecs, aspect range and exact combo signatures retain snapshot constraints', () => {
  const combinations = { audio_only: 'audio', image_only: 'image', video_only: 'video', image_audio: 'image+audio', image_video: 'image+video', video_audio: 'video+audio', image_video_audio: 'image+video+audio' };
  for (const row of snapshot.videoModels) {
    const family = canvasRegistryFamily(row.value)!;
    if (row.featureConfig.comboLimits) {
      assert.deepEqual(family.combinationConstraints, Object.entries(row.featureConfig.comboLimits).map(([key, limit]: [string, any]) => ({
        combination: combinations[key as keyof typeof combinations],
        ...(limit.max_images !== undefined ? { maxImages: limit.max_images } : {}),
        ...(limit.max_videos !== undefined ? { maxVideos: limit.max_videos } : {}),
        ...(limit.max_audios !== undefined ? { maxAudios: limit.max_audios } : {}),
      })));
    }
    for (const kind of ['image', 'video', 'audio'] as const) {
      const rule = family.referenceRules![kind];
      const media = row.mediaConstraints?.[kind];
      const extra = row.featureConfig.extraLimits?.[`${kind}_constraints`];
      assert.deepEqual(rule.formats, media?.formats ?? extra?.formats);
      assert.equal(rule.maxBytes, (media?.max_size_mb ?? extra?.max_size_mb) === undefined ? undefined : (media?.max_size_mb ?? extra?.max_size_mb) * 1024 * 1024);
      if (extra?.duration_range_s) {
        const [min, max] = extra.duration_range_s.split('-').map(Number);
        assert.equal(rule.minDurationSeconds, media?.min_duration ?? min);
        assert.equal(rule.maxDurationSeconds, media?.max_duration ?? max);
      }
      assert.equal(rule.maxTotalDurationSeconds, extra?.total_duration_s);
      if (extra?.side_range_px) {
        const [min, max] = extra.side_range_px.split('-').map(Number);
        assert.equal(rule.minWidth, min); assert.equal(rule.minHeight, min);
        assert.equal(rule.maxWidth, max); assert.equal(rule.maxHeight, max);
      }
      if (extra?.fps_range) {
        const [min, max] = extra.fps_range.split('-').map(Number);
        assert.equal(rule.minFrameRate, min); assert.equal(rule.maxFrameRate, max);
      }
      const aspect = media?.aspect_ratio_range ?? extra?.aspect_ratio_range?.split('-').map(Number);
      assert.equal(rule.minAspectRatio, aspect?.[0]); assert.equal(rule.maxAspectRatio, aspect?.[1]);
      assert.deepEqual(rule.codecs, extra?.codecs);
      assert.deepEqual(rule.resolutions, extra?.resolutions);
    }
  }
});

test('special snapshot exceptions remain explicit and modes do not widen from flags', () => {
  const seedance = canvasRegistryFamily('seedance-2.5')!;
  assert.equal(seedance.referenceRules?.image.maxCount, 30);
  assert.equal(seedance.referenceRules?.video.maxCount, 10);
  assert.equal(seedance.referenceRules?.audio.maxCount, 10);
  assert.equal(seedance.referenceRules?.image.minAspectRatio, 0.4);
  assert.equal(seedance.referenceRules?.image.maxAspectRatio, 2.5);
  assert.ok(seedance.combinationConstraints?.some(combination => combination.combination === 'audio' && combination.maxAudios === 10));
  assert.equal(seedance.modes.find(mode => mode.mode === 'imageToVideo')?.frameImageRule?.maxBytes, 30 * 1024 * 1024);
  assert.equal(seedance.modes.find(mode => mode.mode === 'firstLastFrame')?.frameImageRule?.maxCount, 2);
  const h3 = canvasRegistryFamily('minimax-h3')!;
  assert.equal(h3.restrictions.find(restriction => restriction.outputDuration)?.outputDuration?.min, 4);
  assert.equal(h3.restrictions.find(restriction => restriction.maxRequestBodyBytes)?.maxRequestBodyBytes, 64 * 1024 * 1024);
  assert.deepEqual(canvasRegistryFamily('seedance-2.0-fast')?.restrictions.find(restriction => restriction.outputDuration)?.outputDuration, { min: 4, max: 12 });
  assert.equal(canvasRegistryFamily('seedance-2.5-draft')?.draft, false);
  assert.ok(canvasRegistryFamily('seedance-2.5-draft')?.restrictions.some(restriction => restriction.description.includes('supportDraft=false')));
  const wan = canvasRegistryFamily('wan-3.0')!;
  assert.deepEqual(wan.modes.map(mode => mode.mode), ['imageToVideo', 'firstLastFrame']);
  assert.equal(wan.audioUpload, true);
  assert.equal(wan.modes[0].audioGeneration?.mode, 'unsupported');
  assert.equal(wan.referenceRules?.audio.supported, true);
  for (const id of ['happyhorse-1.0', 'veo-3.1', 'veo-3.1-fast']) {
    const family = canvasRegistryFamily(id)!;
    const mode = family.modes.find(mode => mode.mode === 'referenceToVideo')!;
    assert.ok(mode.referenceRules?.image?.supported);
    assert.equal(mode.referenceRules?.image?.maxCount, id === 'happyhorse-1.0' ? 9 : 3);
    assert.deepEqual(mode.combinationConstraints, [{ combination: 'image', maxImages: id === 'happyhorse-1.0' ? 9 : 3 }]);
  }
  const vidu = canvasRegistryFamily('vidu-q3-pro')!;
  assert.deepEqual(vidu.modes.find(mode => mode.mode === 'textToVideo')?.outputVariants?.map(variant => variant.resolution), ['720p', '1080p']);
  assert.deepEqual(vidu.modes.find(mode => mode.mode === 'imageToVideo')?.outputVariants?.map(variant => variant.resolution), ['720p', '1080p', '2k']);
});

test('registry is immutable and its browser import graph has no node runtime modules', () => {
  const family = listCanvasRegistryModels('image')[0];
  assert.ok(Object.isFrozen(family));
  assert.ok(Object.isFrozen(family.raw));
  assert.ok(Object.isFrozen(family.imageOptions?.imageCountOptions));
  const registrySource = readFileSync(new URL('../src/canvas-model-registry.ts', import.meta.url), 'utf8');
  const dataSource = readFileSync(new URL('../src/canvas-model-registry-snapshot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(registrySource + dataSource, /(?:from\s+['"]node:|require\(['"](?:node:|fs|path))/);
});

const guardParameters = { resolution: '720p', aspectRatio: '16:9', durationSeconds: 5, generateAudio: false };
function guardModel(mode: CanvasModeCapability): CanvasModelCapability {
  return {
    id: 'guard-fixture', providerId: 'fixture', providerModelId: 'fixture-model', displayName: 'Verified input guard',
    version: 'fixture-v1', status: 'available', sources: ['constructed exact input contract'],
    modes: [{ outputVariants: [{ id: '720p', resolution: '720p', aspectRatios: ['16:9'] }],
      duration: { kind: 'fixed', seconds: 5 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false }, ...mode }],
  };
}

test('continuous input aspect bounds accept exact endpoints and reject outside, missing and invalid dimensions', () => {
  const model = guardModel({ mode: 'referenceToVideo',
    referenceRules: { image: { supported: true, maxCount: 1, minAspectRatio: 0.4, maxAspectRatio: 2.5 } },
    combinationConstraints: [{ combination: 'image', maxImages: 1 }] });
  const input = (width?: number, height?: number): CanvasCapabilityInput => ({
    id: 'reference-image', role: 'referenceImage', kind: 'image', metadata: { width, height },
  });
  for (const [width, height] of [[400, 1000], [1000, 400], [800, 800]]) {
    assert.deepEqual(validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [input(width, height)]), []);
  }
  for (const [width, height] of [[399, 1000], [1001, 400]]) {
    const issues = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [input(width, height)]);
    assert.ok(issues.some(issue => issue.code === 'INPUT_LIMIT_EXCEEDED' && issue.path === 'inputs.referenceimage.0.aspectRatio' && issue.inputId === 'reference-image'));
  }
  const missing = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [input(400)]);
  assert.ok(missing.some(issue => issue.code === 'INPUT_METADATA_UNKNOWN' && issue.path.endsWith('.aspectRatio')));
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const issues = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [input(width, 1000)]);
    assert.ok(issues.some(issue => issue.code === 'INPUT_METADATA_INVALID' && issue.path.endsWith('.width')));
  }
});

test('reference video codec and resolution restrictions require measured metadata independently of output settings', () => {
  const model = guardModel({ mode: 'referenceToVideo',
    referenceRules: { video: { supported: true, maxCount: 1, formats: ['mp4'], maxBytes: 1024,
      minDurationSeconds: 2, maxDurationSeconds: 30, minFrameRate: 24, maxFrameRate: 60,
      minAspectRatio: 0.4, maxAspectRatio: 2.5, codecs: ['h264', 'h265'], resolutions: ['480p', '720p', '1080p'] } },
    combinationConstraints: [{ combination: 'video', maxVideos: 1 }] });
  const valid: CanvasCapabilityInput = { id: 'reference-video', role: 'referenceVideo', kind: 'video',
    metadata: { format: 'mp4', byteLength: 1024, durationMs: 2000, width: 400, height: 1000, frameRate: 24, codec: 'H264', resolution: '1080P' } };
  assert.deepEqual(validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [valid]), []);
  assert.deepEqual(validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [{ ...valid,
    metadata: { ...valid.metadata, durationMs: 30000, width: 1000, height: 400, frameRate: 60, codec: 'h265', resolution: '480p' } }]), []);
  const unknown = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [{ ...valid,
    metadata: { ...valid.metadata, codec: undefined, resolution: undefined } }]);
  assert.deepEqual(unknown.map(issue => [issue.code, issue.path, issue.inputId]), [
    ['INPUT_METADATA_UNKNOWN', 'inputs.referencevideo.0.codec', 'reference-video'],
    ['INPUT_METADATA_UNKNOWN', 'inputs.referencevideo.0.resolution', 'reference-video'],
  ]);
  const invalid = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [{ ...valid,
    metadata: { ...valid.metadata, codec: 'av1', resolution: '4k' } }]);
  assert.deepEqual(invalid.map(issue => [issue.code, issue.path]), [
    ['INPUT_FORMAT_INVALID', 'inputs.referencevideo.0.codec'], ['INPUT_FORMAT_INVALID', 'inputs.referencevideo.0.resolution'],
  ]);
  // A deserialized capability input can violate its TypeScript type; reject it without throwing.
  for (const value of [null, 0, false, {}, []]) {
    const malformed = { ...valid, metadata: { ...valid.metadata, codec: value, resolution: value } } as unknown as CanvasCapabilityInput;
    const issues = validateCanvasGenerationParameters(model, 'referenceToVideo', guardParameters, [malformed]);
    assert.deepEqual(issues.map(issue => [issue.code, issue.path, issue.inputId]), [
      ['INPUT_METADATA_INVALID', 'inputs.referencevideo.0.codec', 'reference-video'],
      ['INPUT_METADATA_INVALID', 'inputs.referencevideo.0.resolution', 'reference-video'],
    ]);
  }
  // A selectable 720p output never validates an unmeasured or forbidden source-video resolution.
  assert.equal(guardParameters.resolution, '720p');
});

test('first and last frames are independently checked against explicit image metadata limits', () => {
  const model = guardModel({ mode: 'firstLastFrame', firstFrame: true, lastFrame: true,
    frameImageRule: { supported: true, maxCount: 2, formats: ['jpeg', 'png'], maxBytes: 1024,
      minWidth: 256, maxWidth: 5760, minHeight: 256, maxHeight: 5760, minAspectRatio: 0.4, maxAspectRatio: 2.5 } });
  const first: CanvasCapabilityInput = { id: 'first-boundary', role: 'firstFrame', kind: 'image',
    metadata: { mimeType: 'image/png', byteLength: 1024, width: 256, height: 640 } };
  const last: CanvasCapabilityInput = { id: 'last-boundary', role: 'lastFrame', kind: 'image',
    metadata: { mimeType: 'image/jpeg', byteLength: 1024, width: 5760, height: 2304 } };
  assert.deepEqual(validateCanvasGenerationParameters(model, 'firstLastFrame', guardParameters, [first, last]), []);
  const unknown = validateCanvasGenerationParameters(model, 'firstLastFrame', guardParameters, [{ ...first, metadata: undefined }, last]);
  assert.ok(unknown.length >= 4);
  assert.ok(unknown.every(issue => issue.code === 'INPUT_METADATA_UNKNOWN' && issue.path.startsWith('inputs.firstFrame.0.') && issue.inputId === first.id));
  const invalid = validateCanvasGenerationParameters(model, 'firstLastFrame', guardParameters, [first, { ...last,
    metadata: { mimeType: 'image/gif', byteLength: 1025, width: 640, height: 255 } }]);
  assert.ok(invalid.every(issue => issue.path.startsWith('inputs.lastFrame.0.') && issue.inputId === last.id));
  for (const field of ['byteLength', 'height', 'aspectRatio']) {
    assert.ok(invalid.some(issue => issue.code === 'INPUT_LIMIT_EXCEEDED' && issue.path.endsWith(`.${field}`)));
  }
  assert.ok(invalid.some(issue => issue.code === 'INPUT_FORMAT_INVALID' && issue.path.endsWith('.format')));
  const duplicate = validateCanvasGenerationParameters(model, 'firstLastFrame', guardParameters, [first, { ...first, id: 'duplicate-first' }, last]);
  assert.ok(duplicate.some(issue => issue.code === 'INPUT_COUNT_EXCEEDED' && issue.path === 'inputs.firstFrame'));
});
