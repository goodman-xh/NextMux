import {
    isCanvasDurationValid, type CanvasAudioGenerationCapability, type CanvasCombinationConstraint, type CanvasDurationRule,
    type CanvasModeCapability, type CanvasModelCapability, type CanvasModelCapabilityEvidence, type CanvasOutputVariant,
    type CanvasReferenceRule
} from '@nextmux/comic-core';
import { canvasRegistryFamily, listCanvasRegistryModels } from '@nextmux/comic-core/canvas-model-registry';
import type { CanvasAdapterPolicy } from './nextmux-canvas-adapter-policy';
import type { DesktopVideoModelFacts } from './nextmux-platform-protocol';
import { videoModelGuide } from './nextmux-video-model-guide';

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
const disabledReference: CanvasReferenceRule = { supported: false, maxCount: 0 };
// What the media compiler transmits (node/nextmux-canvas-generation.ts); quality picks a tier-priced image output.
const mappedParameters = new Set(['negativePrompt', 'width', 'height', 'requestSubtitles', 'quality']);

function durationIntersection(rules: readonly (CanvasDurationRule | undefined)[], listed?: readonly number[],
    bounds: readonly { readonly min: number; readonly max: number }[] = []): CanvasDurationRule | undefined {
    if (rules.some(rule => !rule)) return undefined;
    // The current queue only accepts whole seconds, at most 300. Never apply the guide's fallback
    // after an empty intersection: a contradictory listing must remove the option.
    const seconds = Array.from({ length: 300 }, (_, index) => index + 1).filter(value =>
        rules.every(rule => isCanvasDurationValid(rule!, value)) && (!listed?.length || listed.includes(value))
        && bounds.every(bound => value >= bound.min && value <= bound.max));
    if (!seconds.length) return undefined;
    return seconds.length === 1 ? { kind: 'fixed', seconds: seconds[0] }
        : { kind: 'enum', seconds, defaultSeconds: seconds[0] };
}

function audioIntersection(registry: CanvasAudioGenerationCapability | undefined,
    route: CanvasAudioGenerationCapability | undefined, verifiedOptionalControl = false, verifiedManagedShape = false): CanvasAudioGenerationCapability | undefined {
    if (!registry || !route) return undefined;
    // A current managed shape certificate proves the transmitted audio boolean; a captured
    // catalog's omitted control cannot replace that exact quoted choice.
    if (verifiedManagedShape) return route;
    // §8 supportAudio=0 omits generateAudio; it does not promise a silent native output.
    // An independently verified native soundtrack remains required, with no switch offered.
    if (route.mode === 'required') return route;
    if (registry.mode === 'required') return route.mode === 'optional' ? registry : undefined;
    // A verified own API switch is independent of the captured Neowow route's omitted control.
    if (verifiedOptionalControl && route.mode === 'optional' && registry.mode === 'unsupported') return route;
    if (registry.mode === 'unsupported' || route.mode === 'unsupported') return { mode: 'unsupported', defaultEnabled: false };
    return { mode: 'optional', defaultEnabled: registry.defaultEnabled && route.defaultEnabled };
}

function referenceIntersection(registry: CanvasReferenceRule | undefined, route: CanvasReferenceRule | undefined,
    transportCount?: number): CanvasReferenceRule {
    if (!registry?.supported || !route?.supported || transportCount === 0) return disabledReference;
    const maxCount = Math.min(registry.maxCount, route.maxCount, transportCount ?? Infinity);
    if (!(maxCount > 0)) return disabledReference;
    const result: Record<string, unknown> = { ...registry, ...route, supported: true, maxCount };
    for (const key of ['formats', 'aspectRatios', 'codecs', 'resolutions'] as const) {
        const spec = registry[key], limit = route[key];
        const values = spec && limit ? spec.filter(value => limit.some(candidate => same(value, candidate))) : spec ?? limit;
        if (values && !values.length) return disabledReference;
        if (values) result[key] = values;
    }
    for (const key of ['maxBytes', 'maxDurationSeconds', 'maxTotalDurationSeconds', 'maxWidth', 'maxHeight', 'maxFrameRate', 'maxAspectRatio'] as const) {
        const values = [registry[key], route[key]].filter((value): value is number => value !== undefined);
        if (values.length) result[key] = Math.min(...values);
    }
    for (const key of ['minDurationSeconds', 'minWidth', 'minHeight', 'minFrameRate', 'minAspectRatio'] as const) {
        const values = [registry[key], route[key]].filter((value): value is number => value !== undefined);
        if (values.length) result[key] = Math.max(...values);
    }
    for (const [min, max] of [['minDurationSeconds', 'maxDurationSeconds'], ['minWidth', 'maxWidth'], ['minHeight', 'maxHeight'],
        ['minFrameRate', 'maxFrameRate'], ['minAspectRatio', 'maxAspectRatio']]) {
        if (typeof result[min] === 'number' && typeof result[max] === 'number' && Number(result[min]) > Number(result[max])) return disabledReference;
    }
    return result as unknown as CanvasReferenceRule;
}

function combinationIntersection(registry: readonly CanvasCombinationConstraint[] | undefined,
    route: readonly CanvasCombinationConstraint[] | undefined, references: NonNullable<CanvasModeCapability['referenceRules']>): CanvasCombinationConstraint[] {
    return (registry ?? []).flatMap(spec => {
        const limit = route?.find(candidate => candidate.combination === spec.combination);
        if (!limit || spec.combination.split('+').some(kind => kind !== 'none' && !references[kind as keyof typeof references]?.supported)) return [];
        const constraint: Record<string, unknown> = { combination: spec.combination };
        for (const [key, kind] of [['maxImages', 'image'], ['maxVideos', 'video'], ['maxAudios', 'audio']] as const) {
            const max = Math.min(spec[key] ?? Infinity, limit[key] ?? Infinity, references[kind]?.maxCount ?? 0);
            if (Number.isFinite(max)) constraint[key] = max;
        }
        for (const key of ['maxTotalBytes', 'maxTotalDurationSeconds'] as const) {
            const values = [spec[key], limit[key]].filter((value): value is number => value !== undefined);
            if (values.length) constraint[key] = Math.min(...values);
        }
        return [constraint as unknown as CanvasCombinationConstraint];
    });
}

/** Keep only combinations the existing compiler can turn into queue-sized dimensions. */
function dimensionsFit(variant: CanvasOutputVariant, aspect: string): boolean {
    if (variant.resolution === 'auto') return aspect !== 'auto';
    const exact = variant.dimensions?.[aspect];
    const square = /^(\d+)x(\d+)$/iu.exec(variant.resolution);
    const short = /^(\d+)p$/iu.exec(variant.resolution)?.[1];
    const pixels = short ? Number(short) : ({ '1k': 1080, '2k': 1440, '4k': 2160 } as Record<string, number>)[variant.resolution.toLowerCase()];
    const [across, down] = aspect.split(':').map(Number), ratio = across / down;
    const size = exact ?? (square ? { width: Number(square[1]), height: Number(square[2]) }
        : pixels && ratio > 0 ? { width: Math.round((ratio >= 1 ? pixels * ratio : pixels) / 2) * 2,
            height: Math.round((ratio >= 1 ? pixels : pixels / ratio) / 2) * 2 } : undefined);
    return Boolean(size && [size.width, size.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096));
}

/** Fixed model metadata ∩ verified transport ∩ every nonempty route listing. Unknown transport
 * fields stay unknown; the catalog cannot promote them into usable options. No network or clock. */
export function intersectCanvasRegistryCapability(capability: CanvasModelCapability, policy: CanvasAdapterPolicy,
    facts?: DesktopVideoModelFacts, limits?: CanvasModelCapabilityEvidence['videoLimits'], canonicalModel?: string): CanvasModelCapability {
    const family = canvasRegistryFamily(capability.providerModelId) ?? (canonicalModel ? canvasRegistryFamily(canonicalModel) : undefined)
        ?? (policy.registryFamilyId ? listCanvasRegistryModels(policy.kind).find(candidate => candidate.id === policy.registryFamilyId) : undefined);
    if (!family) return capability;
    const sources = new Set([...capability.sources, ...family.sources, `canvas-model-registry:${family.id}`]);
    const restricted = (mode: string, field: string): void => { sources.add(`canvas-registry/intersection:${mode}:${field}`); };
    const durationBounds = family.restrictions.flatMap(restriction => restriction.outputDuration ? [restriction.outputDuration] : []);
    const resolutionBounds = family.restrictions.flatMap(restriction => restriction.outputResolutions ? [restriction.outputResolutions] : []);
    const guide = facts ?? videoModelGuide(capability.providerModelId);
    const verifiedOptionalAudioControl = policy.adapter === 'official' && policy.audioControlVersion === 1;
    const verifiedManagedShapeAudio = policy.adapter === 'managed' && Boolean(policy.videoShapeQuoteId && policy.videoShapeProofs?.length);
    const modes = family.modes.flatMap(spec => {
        const route = capability.modes.find(candidate => candidate.mode === spec.mode);
        if (!route || !policy.modes.includes(spec.mode)) {
            restricted(spec.mode, 'mode:transport');
            if (!route && policy.modes.includes(spec.mode)) restricted(spec.mode, 'mode:not-declared-by-route');
            if (spec.firstFrame && !policy.firstFrameField) {
                restricted(spec.mode, 'firstFrame:not-transmitted');
                if (policy.adapter === 'template') restricted(spec.mode, 'template:missing_first_frame');
            }
            if (spec.lastFrame && !policy.lastFrame) {
                restricted(spec.mode, 'lastFrame:not-transmitted');
                if (policy.adapter === 'template') restricted(spec.mode, 'template:missing_last_frame');
            }
            return [];
        }
        const image = family.kind === 'image';
        if (spec.firstFrame && (!route.firstFrame || !policy.firstFrameField || limits?.frameImages?.length && !limits.frameImages.includes('first_frame'))
            || spec.lastFrame && (!route.lastFrame || !policy.lastFrame || limits?.frameImages?.length && !limits.frameImages.includes('last_frame'))) {
            restricted(spec.mode, 'frames:transport-or-listing'); return [];
        }
        const audio = image ? undefined : audioIntersection(spec.audioGeneration, route.audioGeneration, verifiedOptionalAudioControl, verifiedManagedShapeAudio);
        if (!image && !audio && !(route.outputVariants ?? []).some(output => audioIntersection(spec.audioGeneration, output.audioGenerationOverride, verifiedOptionalAudioControl, verifiedManagedShapeAudio))) {
            restricted(spec.mode, 'audio:unknown-or-conflicting'); return [];
        }
        if (spec.audioGeneration?.mode === 'unsupported' && route.audioGeneration?.mode === 'required') sources.add('canvas-registry/audio-control-vs-native-output');
        if (JSON.stringify(spec.audioGeneration) !== JSON.stringify(audio)) restricted(spec.mode, 'audio:transport');
        const specVariants = (spec.outputVariants ?? []).filter(variant => resolutionBounds.every(bound => bound.some(value => same(value, variant.resolution))));
        const variants = (route.outputVariants ?? []).flatMap(output => {
            const automatic = output.resolution === 'auto';
            const canDeriveAuto = image ? Boolean(policy.imageAspectRatios?.length) : policy.videoAutoOutput?.resolution === 'auto';
            if (automatic && !canDeriveAuto) { restricted(spec.mode, 'resolution:auto-not-derived'); return []; }
            const matching = automatic ? specVariants : specVariants.filter(variant => same(variant.resolution, output.resolution));
            if (!matching.length || !automatic && [facts?.resolutions, limits?.resolutions].some(list => list?.length && !list.some(value => same(value, output.resolution)))) {
                restricted(spec.mode, 'resolution:spec-or-listing'); return [];
            }
            // Provider-owned resolution requires an aspect valid at every possible spec output.
            // Aspect auto is a distinct input-driven option: the compiler measures the carried
            // first frame/reference and resolves an accepted ratio (or supported omission). The
            // absence of literal 'auto' in a provider listing does not forbid that derivation.
            const derivedRatios = (policy.videoAutoAspect?.aspectRatios ?? []).filter(ratio => {
                    if (typeof ratio !== 'string') return false;
                    const [width, height] = ratio.split(':').map(Number);
                    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
                        && (!output.requestShapes || output.requestShapes.some(shape => shape.aspectRatio === ratio)) && dimensionsFit(output, ratio);
                });
            const canResolveAutoAspect = Boolean(policy.videoAutoAspect && (policy.videoAutoAspect.omitAspectRatio || derivedRatios.length));
            const autoFromFirstFrame = !image && canResolveAutoAspect && spec.firstFrame === true && route.firstFrame === true
                && Boolean(policy.firstFrameField) && policy.videoAutoAspect?.firstFrame === true;
            const autoFromReferenceImage = !image && canResolveAutoAspect && !spec.firstFrame && policy.videoAutoAspect?.referenceImage === true
                && spec.referenceRules?.image?.supported === true && route.referenceRules?.image?.supported === true
                && spec.referenceRules.image.maxCount > 0 && route.referenceRules.image.maxCount > 0 && policy.maxImageReferences > 0;
            const specAuto = matching.every(variant => variant.aspectRatios?.includes('auto'));
            const aspects = (matching[0].aspectRatios ?? []).filter(aspect => {
                if (!matching.every(variant => variant.aspectRatios?.includes(aspect))) return false;
                if (aspect === 'auto') return specAuto && (autoFromFirstFrame || autoFromReferenceImage);
                return output.aspectRatios?.includes(aspect)
                    && [facts?.aspectRatios, limits?.aspectRatios, image ? policy.imageAspectRatios : policy.videoAspectRatios ?? policy.videoAutoOutput?.aspectRatios]
                        .every(list => !list?.length || list.includes(aspect)) && dimensionsFit(output, aspect);
            });
            if (specAuto) {
                if (aspects.includes('auto')) sources.add(`canvas-registry/auto-aspect:${spec.mode}:${autoFromFirstFrame ? 'measured-first-frame' : 'measured-reference-image'}`);
                else restricted(spec.mode, canResolveAutoAspect ? 'aspectRatio:auto-input-not-transmitted' : 'aspectRatio:auto-no-measured-ratio-or-omission');
            }
            if (!aspects.length) { restricted(spec.mode, 'aspectRatio:spec-or-transport-or-listing'); return []; }
            if (automatic || JSON.stringify(aspects) !== JSON.stringify(output.aspectRatios)) restricted(spec.mode, 'output:spec-and-adapter-derived');
            const duration = image ? undefined : durationIntersection([spec.duration, output.durationOverride ?? route.duration,
                ...(output.durationOverride && route.duration ? [route.duration] : []),
                ...matching.flatMap(variant => variant.durationOverride ? [variant.durationOverride] : [])],
                undefined, durationBounds);
            const listedDuration = !image && duration ? durationIntersection([duration], limits?.durations) : duration;
            const durationLists = [guide.clipSeconds, policy.durations,
                ...(spec.mode === 'referenceToVideo' ? [policy.durationsWithImageReferences, guide.clipSecondsWithReferences] : []),
                ...(/^(?:1080p|[124]k)$/iu.test(output.resolution) ? [guide.clipSecondsHighRes] : [])];
            const effectiveDuration = image ? undefined : durationLists.reduce<CanvasDurationRule | undefined>((effective, list) =>
                effective ? durationIntersection([effective], list) : undefined, listedDuration);
            const variantAudio = image ? undefined : matching.reduce<CanvasAudioGenerationCapability | undefined>((effective, variant) =>
                audioIntersection(variant.audioGenerationOverride ?? spec.audioGeneration, effective, verifiedOptionalAudioControl, verifiedManagedShapeAudio), output.audioGenerationOverride ?? audio);
            if (spec.audioGeneration?.mode === 'unsupported' && variantAudio?.mode === 'required') sources.add('canvas-registry/audio-control-vs-native-output');
            if (!image && (!effectiveDuration || !variantAudio)) { restricted(spec.mode, 'duration-or-audio:empty'); return []; }
            return [{ ...output, aspectRatios: aspects, defaultAspectRatio: aspects.includes(output.defaultAspectRatio ?? '') ? output.defaultAspectRatio : aspects[0],
                ...(effectiveDuration ? { durationOverride: effectiveDuration } : {}), ...(variantAudio ? { audioGenerationOverride: variantAudio } : {}),
                ...(aspects.includes('auto') ? { derivedAspectRatio: { inputRole: autoFromFirstFrame ? 'firstFrame' as const : 'referenceImage' as const,
                    aspectRatios: derivedRatios, tolerance: 0.02, allowOmission: policy.videoAutoAspect!.omitAspectRatio } } : {}),
                ...(output.dimensions ? { dimensions: Object.fromEntries(Object.entries(output.dimensions).filter(([aspect]) => aspects.includes(aspect))) } : {}) }];
        });
        if (!variants.length) { restricted(spec.mode, 'mode:no-effective-output'); return []; }
        const frameImageRule = spec.frameImageRule ? route.frameImageRule ? referenceIntersection(spec.frameImageRule, route.frameImageRule) : spec.frameImageRule : route.frameImageRule;
        if ((spec.firstFrame || spec.lastFrame) && frameImageRule?.supported === false) { restricted(spec.mode, 'frameImageRule:empty'); return []; }
        const references = {
            image: referenceIntersection(spec.referenceRules?.image, route.referenceRules?.image, policy.maxImageReferences),
            video: referenceIntersection(spec.referenceRules?.video, route.referenceRules?.video, policy.referenceVideos ? undefined : 0),
            audio: referenceIntersection(spec.referenceRules?.audio, route.referenceRules?.audio, policy.referenceAudios ? undefined : 0)
        };
        const combinations = combinationIntersection(spec.combinationConstraints, route.combinationConstraints, references);
        if ((spec.mode === 'imageToImage' || spec.mode === 'referenceToVideo') && !combinations.some(combination => combination.combination !== 'none')) {
            restricted(spec.mode, 'references:no-transmittable-combination'); return [];
        }
        if (JSON.stringify(references) !== JSON.stringify(spec.referenceRules)) restricted(spec.mode, 'references:counts-formats-and-transport');
        if (JSON.stringify(combinations) !== JSON.stringify(spec.combinationConstraints)) restricted(spec.mode, 'combinationConstraints:exact-signatures');
        const effectiveVariants = variants.flatMap(output => {
            if (!output.requestShapes) return [output];
            const proof = output.requestShapes.filter(shape => output.durationOverride && isCanvasDurationValid(output.durationOverride, shape.durationSeconds)
                && (shape.referenceImages === 0 || references.image.supported && shape.referenceImages <= references.image.maxCount
                    && combinations.some(combination => combination.combination === 'image' && shape.referenceImages <= (combination.maxImages ?? Infinity)))
                && (output.aspectRatios.includes(shape.aspectRatio) || output.aspectRatios.includes('auto') && output.derivedAspectRatio?.aspectRatios.includes(shape.aspectRatio)));
            if (!proof.length) { restricted(spec.mode, 'requestShapes:no-complete-hold-proof'); return []; }
            const ratios = new Set(proof.map(shape => shape.aspectRatio));
            const derived = output.derivedAspectRatio ? { ...output.derivedAspectRatio, aspectRatios: output.derivedAspectRatio.aspectRatios.filter(ratio => ratios.has(ratio)) } : undefined;
            const aspects = output.aspectRatios.filter(aspect => aspect === 'auto' ? Boolean(derived?.aspectRatios.length || derived?.allowOmission) : ratios.has(aspect));
            if (!aspects.length) { restricted(spec.mode, 'requestShapes:no-proven-aspect'); return []; }
            const duration = durationIntersection([output.durationOverride], proof.map(shape => shape.durationSeconds));
            return [{ ...output, aspectRatios: aspects, defaultAspectRatio: aspects.includes(output.defaultAspectRatio ?? '') ? output.defaultAspectRatio : aspects[0],
                requestShapes: proof, ...(duration ? { durationOverride: duration } : {}), ...(derived ? { derivedAspectRatio: derived } : {}) }];
        });
        if (!effectiveVariants.length) { restricted(spec.mode, 'mode:no-effective-proven-output'); return []; }
        const parameters = (route.parameters ?? []).filter(parameter => mappedParameters.has(parameter.key));
        if (family.imageOptions?.qualityLevels?.length || family.imageOptions?.imageCountOptions.some(count => count !== 1)
            || spec.parameters?.some(parameter => !parameters.some(candidate => candidate.key === parameter.key))) restricted(spec.mode, 'parameters:not-transmitted');
        const baseDuration = image ? undefined : durationIntersection([spec.duration, route.duration], limits?.durations, durationBounds);
        const duration = image ? undefined : [guide.clipSeconds, policy.durations,
            ...(spec.mode === 'referenceToVideo' ? [policy.durationsWithImageReferences, guide.clipSecondsWithReferences] : [])]
                .reduce<CanvasDurationRule | undefined>((effective, list) => effective ? durationIntersection([effective], list) : undefined, baseDuration);
        if (!image && JSON.stringify(duration) !== JSON.stringify(route.duration)) restricted(spec.mode, 'duration:registry-and-listing');
        const mode: CanvasModeCapability = { ...route, outputVariants: effectiveVariants,
            defaultResolution: effectiveVariants.find(variant => variant.resolution === route.defaultResolution)?.resolution ?? effectiveVariants[0].resolution,
            ...(duration ? { duration } : {}), ...(audio ? { audioGeneration: audio } : {}),
            firstFrame: Boolean(spec.firstFrame && route.firstFrame && policy.firstFrameField), lastFrame: Boolean(spec.lastFrame && route.lastFrame && policy.lastFrame),
            ...(frameImageRule ? { frameImageRule } : {}),
            referenceRules: references, combinationConstraints: combinations, parameters,
            preserveInputAudio: Boolean(spec.preserveInputAudio && route.preserveInputAudio && policy.preserveOriginalAudio),
            audioDrivenVideo: Boolean(spec.audioDrivenVideo && route.audioDrivenVideo && policy.referenceAudios) };
        return [mode];
    });
    for (const route of capability.modes) if (!family.modes.some(mode => mode.mode === route.mode)) restricted(route.mode, 'mode:not-in-spec');
    return { ...capability, displayName: family.displayName, modes,
        defaultMode: modes.some(mode => mode.mode === capability.defaultMode) ? capability.defaultMode : modes[0]?.mode,
        status: capability.status === 'available' && !modes.length ? 'unknown' : capability.status,
        version: `${capability.version}:registry-v1:${JSON.stringify([family.id, modes])}`, sources: [...sources] };
}
